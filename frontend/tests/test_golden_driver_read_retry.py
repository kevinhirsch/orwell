"""0108 golden-path DRIVER robustness — the read-retry seam (regression for the
stochastic golden-path flake, #1474 batch).

The golden replay is byte-DETERMINISTIC (the fixture is served by request key), so a run
that fails only under a slow/contended sandbox is the DRIVER tripping over a TRANSIENT read
blip, not a determinism bug: a SQLite reader momentarily blocked behind a writer surfaces as
a one-call 404 on ``GET /api/history/{session}``, and the assistant row can lag the stream's
return so a just-finished turn reads back with no fresh reply for a beat, then lands. Reproduced
here: an unstressed replay is deterministic, but a CPU-pegged one crashed mid-walk on exactly
that transient 404.

The fix is a bounded, backed-off retry on the driver's IDEMPOTENT GET reads. It is
timing-INDEPENDENT (it converges on the same state regardless of sandbox speed) and NON-masking:
a transient one-call blip is absorbed, while a genuinely persistent failure still surfaces after
the retry budget. These tests pin both halves — no live engine/FE needed."""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

import pytest

import scripts._golden_driver as gd
from scripts._golden_driver import GoldenDriver


def _driver(tmp_path) -> GoldenDriver:
    # The constructor is pure — it boots nothing (only mkdtemp-style bookkeeping), so a bare
    # instance is enough to exercise the read helpers in isolation.
    return GoldenDriver(mode="replay", fixture=str(tmp_path / "f.jsonl"),
                        model="m", work_dir=str(tmp_path))


def _ok_body(payload: dict):
    # `_get` does `with urlopen(...) as r: json.load(r)`; BytesIO satisfies both the context
    # manager and the read() json.load needs.
    return io.BytesIO(json.dumps(payload).encode())


def test_get_absorbs_a_transient_read_blip(tmp_path, monkeypatch):
    """A one/two-call transient failure (the SQLite-behind-a-writer 404) is retried away —
    the walk does not die on a slow sandbox."""
    d = _driver(tmp_path)
    calls = {"n": 0}

    def flaky_urlopen(url, timeout=None):
        calls["n"] += 1
        if calls["n"] < 3:  # two blips, then it clears
            raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
        return _ok_body({"ok": True})

    monkeypatch.setattr(gd.urllib.request, "urlopen", flaky_urlopen)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)  # no real backoff wait

    assert d._get(d.fe, "/api/history/x") == {"ok": True}
    assert calls["n"] == 3  # it retried past both blips rather than raising on the first


def test_get_still_surfaces_a_persistent_failure(tmp_path, monkeypatch):
    """A failure that never clears is NOT masked — the retry budget is bounded and the real
    error propagates, so a genuine break (endpoint truly gone, reply never persisted) still
    fails the gate loudly."""
    d = _driver(tmp_path)
    calls = {"n": 0}

    def always_fail(url, timeout=None):
        calls["n"] += 1
        raise urllib.error.URLError("connection reset by peer")

    monkeypatch.setattr(gd.urllib.request, "urlopen", always_fail)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    with pytest.raises(urllib.error.URLError):
        d._get(d.fe, "/api/history/x")
    assert calls["n"] == GoldenDriver._READ_RETRIES  # exhausted the whole budget before raising


def test_happy_path_reads_once_no_retry_delay(tmp_path, monkeypatch):
    """When the read succeeds first try (the normal case) there is NO extra call and NO backoff
    — the retry seam is byte-identical/zero-cost on a healthy run, so it never perturbs the
    deterministic digest."""
    d = _driver(tmp_path)
    calls = {"n": 0, "slept": 0}

    def ok_urlopen(url, timeout=None):
        calls["n"] += 1
        return _ok_body({"beatSeq": 7})

    monkeypatch.setattr(gd.urllib.request, "urlopen", ok_urlopen)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: calls.__setitem__("slept", calls["slept"] + 1))

    assert d._get(d.fe, "/api/orwell/state") == {"beatSeq": 7}
    assert calls["n"] == 1      # exactly one call
    assert calls["slept"] == 0  # never slept — zero added latency on the happy path


# ── the premiere/week-walk case: the post-turn assistant re-read (_await_new_assistant) ────────
#
# The CI-load flake that #1508 only partly closed: casting finalizes (I1 PASS), then the week walk
# bails on a heavy advance turn ("Let's keep the week moving…") with "no new assistant message
# persisted". Under a contended runner the assistant row can lag the post-stream read for several
# beats before it lands, past #1508's short re-read budget. `_await_new_assistant` is the widened,
# bounded, NON-masking convergence loop — these pin all three halves without a live engine/FE.


def _msgs(n_assistant: int) -> list[dict]:
    """A history snapshot with `n_assistant` assistant rows (plus a user row for realism)."""
    return [{"role": "user", "content": "u"}] + [{"role": "assistant", "content": "a"}] * n_assistant


def test_await_new_assistant_absorbs_a_lagging_persist(tmp_path, monkeypatch):
    """The premiere/week-walk case: the fresh assistant row is ABSENT for the first few history
    reads (the write lagging the stream's return on a loaded runner), then lands. The re-read
    converges on it instead of failing the walk — the flake is absorbed."""
    d = _driver(tmp_path)
    prior = 2  # two assistant turns already banked
    calls = {"n": 0}

    def lagging_history():
        calls["n"] += 1
        # The lagging row lands on the 4th read; the first three still show only `prior`.
        return _msgs(prior if calls["n"] < 4 else prior + 1)

    monkeypatch.setattr(d, "_history", lagging_history)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)  # no real backoff wait

    msgs = d._await_new_assistant(prior)
    assert sum(1 for m in msgs if m.get("role") == "assistant") == prior + 1  # observed the fresh row
    assert calls["n"] == 4  # retried past the lag rather than bailing on the first read


def test_await_new_assistant_still_surfaces_a_true_no_persist(tmp_path, monkeypatch):
    """NON-masking: a turn that genuinely persisted NOTHING is not conjured. The budget is bounded
    (never an infinite loop), and _await_new_assistant returns history with NO new assistant row —
    so _turn's count check still raises loudly. This is the guarantee that keeps the widened budget
    honest."""
    d = _driver(tmp_path)
    prior = 3
    calls = {"n": 0}

    def never_new():
        calls["n"] += 1
        return _msgs(prior)  # never grows

    monkeypatch.setattr(d, "_history", never_new)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    msgs = d._await_new_assistant(prior)
    assert sum(1 for m in msgs if m.get("role") == "assistant") <= prior  # caller will raise on this
    # one initial read + the full retry budget, then it gives up — bounded, never infinite
    assert calls["n"] == 1 + GoldenDriver._ASSISTANT_ROW_RETRIES


def test_await_new_assistant_zero_cost_when_row_present(tmp_path, monkeypatch):
    """When the fresh row is already present on the first read (the normal case — the stream was
    read to its natural close and the row is persisted before [DONE]), there is exactly ONE read and
    NO backoff sleep, so the seam is byte-identical/zero-cost and the deterministic digest (3cb789da)
    is unperturbed."""
    d = _driver(tmp_path)
    prior = 1
    calls = {"n": 0, "slept": 0}

    def fresh_history():
        calls["n"] += 1
        return _msgs(prior + 1)  # already carries the new row

    monkeypatch.setattr(d, "_history", fresh_history)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: calls.__setitem__("slept", calls["slept"] + 1))

    msgs = d._await_new_assistant(prior)
    assert sum(1 for m in msgs if m.get("role") == "assistant") == prior + 1
    assert calls["n"] == 1      # exactly one read
    assert calls["slept"] == 0  # never slept — zero added latency on the happy path


def test_turn_reads_stream_to_close_and_a_never_closing_stream_still_fails(tmp_path, monkeypatch):
    """The stream-read half of the fix. The driver no longer abandons a still-streaming turn at a
    fixed wall-clock deadline (which, under load, cut the connection mid-round BEFORE the narration
    persisted — the row then never existed and no re-read could help). It reads to the NATURAL close,
    bounded by an absolute backstop. NON-masking: a stream that NEVER closes still fails loudly with
    the backstop error rather than hanging forever."""
    d = _driver(tmp_path)
    monkeypatch.setattr(d, "_history", lambda: [])  # the top-of-_turn prior-assistants read

    class _NeverClosing:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, _n):
            return b"data: keep-going\n\n"  # non-empty forever → the stream never naturally closes

    monkeypatch.setattr(gd.urllib.request, "urlopen", lambda *a, **k: _NeverClosing())

    # A monotonic fake clock: the first call sets the backstop, the next jumps well past it so the
    # loop trips the backstop on its first check (no real waiting, timing-independent).
    ticks = iter([1000.0] + [1000.0 + 10 ** 9] * 50)
    monkeypatch.setattr(gd.time, "time", lambda: next(ticks))
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    with pytest.raises(RuntimeError, match="without closing"):
        d._turn("Let's keep the week moving — what does production have for us next?")

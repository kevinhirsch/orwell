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

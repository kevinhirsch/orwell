"""Portrait image-gen error-masking + transient-budget fixes.

Diagnosed from two live prod debug bundles: NPC portraits were 0/16 for an image-OUTPUT model
(`google/gemini-3.1-flash-image`). Every attempt logged `http-404: "No endpoints found that
support tool use"`, and the per-NPC retry budget was permanently exhausted. Root cause lived in
`orwell_portraits._generate_via_chat_completions`, which tried two request shapes:

  1. `modalities: [image, text]`  — the CORRECT native image-output path.
  2. `tools: [openrouter:image_generation]` — a server-tool fallback the image model can't use.

For an image-output model, mechanism #2 is nonsense (the model has no tool support) and
OpenRouter returns a 404 'No endpoints found that support tool use'. The old loop overwrote the
recorded reason on each attempt, so #2's misleading 404 CLOBBERED #1's real failure (very likely a
402 'insufficient credits', which the same account was hitting on narration) — the true cause was
invisible in the logs and the bundle. And a transient/environmental failure (402/429/5xx/transport)
burned the permanent 6-attempt budget the same way a genuine bad-prompt does, so the cast stayed
permanently given-up even after the operator would have added credits.

Three fixes, all pinned here (roles only; httpx fully faked, no network):
  (a) mechanism #1's substantive provider error is the RECORDED reason — the tools-404 never masks
      a 402/credit (or any real #1 error);
  (b) the tools-fallback is SKIPPED when #1 failed for an environmental/definitive reason
      (402/auth/429/5xx/transport) — it can only elicit the misleading 404 — while still running as
      a genuine "modalities not supported" fallback;
  (c) a TRANSIENT failure does NOT burn the permanent reconciler budget: the slot stays eligible
      and self-heals on the next sweep once credits are added, whereas a genuine content failure
      still counts and eventually stands the reconciler down.
"""

import asyncio
import base64
import importlib

import pytest

op = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"


# ── a fake async httpx client (mirrors test_g23_openrouter_image._Client) ───────────────────

class _Resp:
    def __init__(self, status=200, body=None, content=b"", text=""):
        self.status_code = status
        self._body = body if body is not None else {}
        self.content = content
        self.text = text

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Client:
    """Returns `posts` in order (sticking at the last); records every JSON post payload so the
    request SHAPE — and whether the tools attempt was even MADE — can be asserted."""

    def __init__(self, posts=()):
        self._posts = list(posts) if isinstance(posts, (list, tuple)) else [posts]
        self._i = 0
        self.post_payloads = []

    async def post(self, url, json=None, headers=None):
        self.post_payloads.append(json)
        r = self._posts[min(self._i, len(self._posts) - 1)]
        self._i += 1
        return r

    async def get(self, url):
        return _Resp(200, content=b"")


def _err(status, message):
    return _Resp(status, {"error": {"message": message}}, text=message)


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# ── the classifiers (cheap unit pins) ───────────────────────────────────────────────────────

def test_transient_classifier_flags_environmental_failures():
    for ec in ("http-402", "http-429", "http-500", "http-503", "http-401", "http-403",
               "http-408", "image-fetch-http-502", "ConnectError", "ReadTimeout",
               "ConnectTimeout", "TimeoutException", "RemoteProtocolError", "PoolTimeout"):
        assert op._is_transient_gen_error(ec) is True, ec


def test_transient_classifier_leaves_content_failures_alone():
    for ec in ("http-400", "http-404", "http-422", "no-image-in-response", "empty-response",
               "bad-json", "image-decode-failed", "no-model", "no-prompt", "persist-failed",
               "generation-failed", "unknown", None, ""):
        assert op._is_transient_gen_error(ec) is False, ec


def test_tools_fallback_gate_skips_environmental_and_transport():
    # environmental/definitive → the tools attempt cannot help and would only mask the reason
    for status, reason in ((402, "http-402"), (500, "http-500"), (503, "http-503"),
                           (429, "http-429"), (401, "http-401"), (None, "ConnectError")):
        assert op._should_try_tools_fallback(status, reason) is False, reason
    # a genuine "modalities image-output not supported" shape rejection → tools IS a real fallback
    for status, reason in ((400, "http-400"), (404, "http-404"), (200, "no-image-in-response")):
        assert op._should_try_tools_fallback(status, reason) is True, reason


# ── (a) + (b): the 402 is recorded, and the tools-404 never runs / never masks it ───────────

def test_credit_402_survives_and_is_not_masked_by_tools_404():
    op._consume_gen_error(); op._consume_gen_detail()  # clear any stale reason
    # mechanism #1 (modalities) → 402 insufficient credits. The tools-404 (which the _Client would
    # serve NEXT) must never be recorded, because the tools attempt must never even be made.
    client = _Client([
        _err(402, "Insufficient credits. Add more at https://openrouter.ai/credits"),
        _err(404, "No endpoints found that support tool use"),
    ])
    out = _run(op._generate_via_chat_completions(
        client, CHAT_URL, "google/gemini-3.1-flash-image", "p", {}))
    assert out is None
    # the REAL cause is recorded, not the tools-404
    assert op._consume_gen_error() == "http-402"
    detail = op._consume_gen_detail()
    assert detail and "credit" in detail.lower()
    # fix #2: the tools-fallback was never attempted — only the native modalities request went out
    assert len(client.post_payloads) == 1
    assert client.post_payloads[0].get("modalities") == ["image", "text"]
    assert all("tools" not in p for p in client.post_payloads)


def test_tools_fallback_skipped_on_5xx():
    op._consume_gen_error(); op._consume_gen_detail()
    client = _Client([_err(503, "upstream temporarily unavailable"),
                      _err(404, "No endpoints found that support tool use")])
    out = _run(op._generate_via_chat_completions(client, CHAT_URL, "m/image", "p", {}))
    assert out is None
    assert op._consume_gen_error() == "http-503"   # the 5xx, not the tools-404
    assert len(client.post_payloads) == 1          # tools attempt skipped on a 5xx


def test_tools_fallback_skipped_on_transport_error():
    op._consume_gen_error(); op._consume_gen_detail()

    class _Boom(_Client):
        async def post(self, url, json=None, headers=None):
            self.post_payloads.append(json)
            raise RuntimeError("connection reset")

    client = _Boom([])
    out = _run(op._generate_via_chat_completions(client, CHAT_URL, "m/image", "p", {}))
    assert out is None
    assert op._consume_gen_error() == "RuntimeError"  # the transport error, not a tools-404
    assert len(client.post_payloads) == 1             # tools attempt skipped — no HTTP response


def test_tools_fallback_still_runs_when_modalities_returns_no_image():
    # The genuine fallback path must survive: an image-less 200 from #1 (the model doesn't do
    # native output) still tries the server tool, which lands the image.
    op._consume_gen_error()
    no_img = {"choices": [{"message": {"content": "I cannot output images directly."}}]}
    with_img = {"choices": [{"message": {"images": [{"image_url": {"url": _data_url(b"VIATOOL")}}]}}]}
    client = _Client([_Resp(200, no_img), _Resp(200, with_img)])
    out = _run(op._generate_via_chat_completions(client, CHAT_URL, "openai/gpt-5", "p", {}))
    assert out == b"VIATOOL"
    assert len(client.post_payloads) == 2
    assert client.post_payloads[1]["tools"][0]["type"] == "openrouter:image_generation"


def test_mechanism_one_reason_is_not_masked_when_tools_fallback_also_fails():
    # #1 (modalities) returns a 200 with NO image (a genuine "this model doesn't do native output"
    # signal) → #2 legitimately runs; when #2 then fails with the generic tools-404, #1's reason
    # (the real one) stays recorded — the 404 never clobbers it.
    op._consume_gen_error(); op._consume_gen_detail()
    no_img = {"choices": [{"message": {"content": "no image, sorry"}}]}
    client = _Client([_Resp(200, no_img), _err(404, "No endpoints found that support tool use")])
    out = _run(op._generate_via_chat_completions(client, CHAT_URL, "m/chat", "p", {}))
    assert out is None
    assert any("tools" in p for p in client.post_payloads)    # the fallback WAS a legitimate attempt
    assert op._consume_gen_error() == "no-image-in-response"  # #1's reason, not the tools-404


# ── (c): the reconciler budget — transient re-arms; genuine content failure counts ──────────

_STATE = {
    "started": True,
    "player": {"id": "player", "name": "The Player", "status": "active"},
    "house": [
        {"id": "npc:1", "name": "Houseguest One", "status": "active"},
        {"id": "npc:2", "name": "Houseguest Two", "status": "jury"},
        {"id": "npc:3", "name": "Houseguest Three", "status": "active"},
    ],
}
_NAMES = {"player": "The Player", "npc:1": "Houseguest One",
          "npc:2": "Houseguest Two", "npc:3": "Houseguest Three"}


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    d = tmp_path / "portraits"
    monkeypatch.setattr(op, "PORTRAITS_DIR", d)
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(op, "RECONCILE_STATE_PATH", tmp_path / "portrait-reconcile.json")
    monkeypatch.setattr(op, "_LAST_BACKFILL_AT", {})
    monkeypatch.setattr(op, "_SEEN_USERS", {})
    monkeypatch.setattr(op, "_PROVIDER_SEEN", {})
    monkeypatch.setattr(op, "_LAST_MISSING", {})
    monkeypatch.setattr(op, "_NO_PROMPT_LOGGED", {})
    monkeypatch.setattr(op, "_LAST_GEN_ERROR_BY_ID", {})
    monkeypatch.setattr(op, "_RECONCILER_TASK", None)
    return d


def _stub_state(monkeypatch):
    async def fake_state(user=None, **k):
        return _STATE
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda user: True)


def _stub_engine_prompts(monkeypatch):
    async def fake_prompt(hid, user=None):
        return {"houseguestId": hid, "name": _NAMES.get(hid, f"HG {hid}"), "prompt": f"photoreal {hid}"}

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)


class _Gen:
    """A controllable _generate_one: emit a chosen error class (or succeed when `error` is None)."""

    def __init__(self, error="http-402"):
        self.error = error
        self.calls = []

    async def __call__(self, prompt, user, reference_png=None):
        self.calls.append((prompt, user))
        if self.error:
            op._note_gen_error(self.error)
            return None
        return b"\x89PNG-ok-" + prompt.encode()[:8]


def _stub_gen(monkeypatch, error="http-402"):
    gen = _Gen(error=error)
    monkeypatch.setattr(op, "_generate_one", gen)
    return gen


def _store_portrait(user, hid):
    # Store with the ROSTER name + default 'generated' source so the ADR 0013 staleness heal
    # (name-mismatch / wrong-DNA / fingerprint drift) never re-shoots it — matches production writes.
    op._write_portrait(user, hid, b"\x89PNG-fake", _NAMES.get(hid, "stored"))


def _counters(user):
    return op._user_counters(op._load_reconcile_state(), op._safe_user(user))


def test_transient_402_keeps_slot_eligible_and_never_exhausts_budget(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, error="http-402")  # every attempt is a CREDIT failure
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")  # only npc:1 is missing → single-counter clarity

    op.note_user_seen("user-a")
    # Far more sweeps than would exhaust a 6-attempt budget for a genuine content failure.
    for _ in range(60):
        _run(op.reconcile_once())

    counters = _counters("user-a")
    assert "npc_1" in counters, "the slot is still tracked, not permanently discarded"
    # A transient failure burns NO permanent attempt — the slot never approaches the give-up cap.
    assert counters["npc_1"]["attempts"] == 0
    assert counters["npc_1"]["attempts"] < op.RECONCILE_MAX_ATTEMPTS
    # …and the reconciler keeps genuinely retrying it (not stood down) across the sweeps.
    assert len(gen.calls) >= 10

    # Once the operator "adds credits" (the provider now succeeds), the next eligible sweep lands
    # the portrait — no manual lever, no permanently-stuck state.
    gen.error = None
    for _ in range(3):
        _run(op.reconcile_once())
    assert op.portrait_file("user-a", "npc:1") is not None
    assert not _counters("user-a")  # success clears the counter


def test_genuine_content_failure_still_consumes_the_budget(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, error="no-image-in-response")  # a real per-content failure
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")

    op.note_user_seen("user-a")
    for _ in range(200):
        _run(op.reconcile_once())

    # The genuine failure DOES burn the budget and eventually stands the reconciler down.
    assert _counters("user-a")["npc_1"]["attempts"] == op.RECONCILE_MAX_ATTEMPTS
    calls_at_cap = len(gen.calls)
    assert calls_at_cap == op.RECONCILE_MAX_ATTEMPTS
    for _ in range(20):  # well past every cooldown — it has stood down
        _run(op.reconcile_once())
    assert len(gen.calls) == calls_at_cap  # no further attempts once the budget is spent


def test_transient_then_content_failure_flips_to_counting(tmp_portraits, monkeypatch):
    # A slot that failed transiently (no budget burned) must still be able to accrue budget once
    # the failure mode changes to a genuine content failure — the re-arm is not a permanent shield.
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, error="http-402")
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")

    op.note_user_seen("user-a")
    for _ in range(6):
        _run(op.reconcile_once())
    assert _counters("user-a")["npc_1"]["attempts"] == 0  # transient so far → nothing burned

    gen.error = "http-400"  # now a genuine bad-prompt content failure
    for _ in range(200):
        _run(op.reconcile_once())
    assert _counters("user-a")["npc_1"]["attempts"] == op.RECONCILE_MAX_ATTEMPTS

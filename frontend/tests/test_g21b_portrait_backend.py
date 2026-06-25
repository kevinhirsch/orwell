"""Lane G21b — portrait backend: never 400-loop a non-image model, obey the explicit
"Generate" lever, and capture the provider's failure reason.

Context: H2 let a chat model be chosen as the image model (fixed FE-side in G21 / settings.js).
This is the backend half. A mis-set or stale chat model resolves fine but cannot generate —
POSTing it to /images/generations 400s instantly. So:
  • `_is_image_model` recognizes image families and rejects chat/vision models;
  • `image_generation_available` ignores a configured chat model (stays truthful — G20's
    reconciler and the Health "portraits N/M" counter both gate on it);
  • `_generate_one` skips a chat model and falls back to auto-detect, never POSTing a doomed
    request (so the pipeline can't 400-loop);
  • the manual "Generate cast portraits" lever runs NOW (force=True bypasses the auto-poll
    debounce);
  • a failure captures the provider's short reason into the attempt log.

Roles only; generation/network fully monkeypatched (no image API, no engine).
"""

import asyncio
import importlib

import pytest

orwell_portraits = importlib.import_module("src.orwell_portraits")
ai_interaction = importlib.import_module("src.ai_interaction")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _patch_resolver(monkeypatch, resolves):
    """Fake `_resolve_model` that succeeds only for specs matching one of `resolves`
    (substring either way), else raises — mimicking an endpoint that only carries those."""
    def _resolve_model(spec, owner=None):
        for ok in resolves:
            if ok in spec or spec in ok:
                return ("http://x/v1/chat/completions", spec, {})
        raise ValueError("not found: " + spec)
    monkeypatch.setattr(ai_interaction, "_resolve_model", _resolve_model)


# ── _is_image_model classification ─────────────────────────────────────────────

@pytest.mark.parametrize("mid", [
    "openai/gpt-image-1", "openai/dall-e-3", "black-forest-labs/flux.1.1-pro",
    "stability-ai/sdxl", "stabilityai/stable-diffusion-3.5-large",
    "playgroundai/playground-v2.5", "ideogram-ai/ideogram-v3",
    "bytedance/seedream-3-t2i", "google/gemini-2.5-flash-image-preview",
])
def test_is_image_model_accepts_image_families(mid):
    assert orwell_portraits._is_image_model(mid) is True


@pytest.mark.parametrize("mid", [
    "deepseek/deepseek-v4-pro", "anthropic/claude-3.5-sonnet", "openai/gpt-4o",
    "meta-llama/llama-3.3-70b-instruct", "google/gemini-2.5-flash",
    "qwen/qwen2.5-vl-72b-instruct",  # a VISION model: input images, not output
])
def test_is_image_model_rejects_chat_and_vision(mid):
    assert orwell_portraits._is_image_model(mid) is False


# ── image_generation_available stays truthful about a chat model ───────────────

def test_available_false_when_only_a_chat_model_resolves(monkeypatch):
    # The pre-G21 footgun: a chat model is configured and only it exists on the endpoint.
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "deepseek/deepseek-v4-pro", "medium"))
    _patch_resolver(monkeypatch, resolves=["deepseek/deepseek-v4-pro"])
    assert orwell_portraits.image_generation_available("u") is False


def test_available_true_when_a_real_image_model_is_configured(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "black-forest-labs/flux.1.1-pro", "medium"))
    _patch_resolver(monkeypatch, resolves=["flux"])
    assert orwell_portraits.image_generation_available("u") is True


def test_available_true_via_autodetect_when_unset(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "", "medium"))
    _patch_resolver(monkeypatch, resolves=["dall-e-3"])
    assert orwell_portraits.image_generation_available("u") is True


# ── the false-negative fix: a transient catalog probe must not report "no model" ─
# Live bug: image model on auto-detect, the player presses Generate, gets "no image model
# configured", presses again after manually selecting one — same error — then the photos load
# on their own after a delay. Root cause: `_resolve_model` network-probes the provider catalog
# (5s, swallows every error into not-found), so a cold/blipping catalog made every candidate
# raise and we false-negatived, only to succeed on a retry once the catalog was warm. The gate
# now falls back to "is an image-capable endpoint even configured?" (a pure DB read, no probe),
# so a configured endpoint is allowed to TRY on the FIRST press.

def test_available_true_when_catalog_probe_fails_but_endpoint_exists(monkeypatch):
    # A real image model is SELECTED, but the catalog probe fails for everything this instant
    # (transient: cold provider / blip / first-press-before-warm).
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "black-forest-labs/flux.1.1-pro", "medium"))
    _patch_resolver(monkeypatch, resolves=[])  # nothing resolves via the catalog right now
    # …but an image-capable endpoint IS configured (the pure-DB resilient signal).
    monkeypatch.setattr(ai_interaction, "has_image_capable_endpoint", lambda owner=None: True)
    # No false negative: the gate lets generation TRY on the first press.
    assert orwell_portraits.image_generation_available("u") is True


def test_available_true_on_autodetect_when_probe_blips_but_endpoint_exists(monkeypatch):
    # Auto-detect (no model selected), the candidate probes all transiently fail — but an
    # image-capable endpoint exists, so the FIRST Generate press must not false-negative.
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "", "medium"))
    _patch_resolver(monkeypatch, resolves=[])
    monkeypatch.setattr(ai_interaction, "has_image_capable_endpoint", lambda owner=None: True)
    assert orwell_portraits.image_generation_available("u") is True


def test_available_false_when_genuinely_no_endpoint(monkeypatch):
    # The honest absence: nothing resolves AND no image-capable endpoint is configured at all.
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "", "medium"))
    _patch_resolver(monkeypatch, resolves=[])
    monkeypatch.setattr(ai_interaction, "has_image_capable_endpoint", lambda owner=None: False)
    assert orwell_portraits.image_generation_available("u") is False


def test_available_false_when_disabled_even_with_endpoint(monkeypatch):
    # The enable toggle still wins — a disabled setting is never "available".
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (False, "black-forest-labs/flux.1.1-pro", "medium"))
    monkeypatch.setattr(ai_interaction, "has_image_capable_endpoint", lambda owner=None: True)
    assert orwell_portraits.image_generation_available("u") is False


@pytest.mark.parametrize("provider,base_url,expected", [
    ("openai", "https://api.openai.com/v1", True),
    ("openrouter", "https://openrouter.ai/api/v1", True),
    ("groq", "https://api.groq.com/openai/v1", True),
    ("anthropic", "https://api.anthropic.com", False),  # no image transport
])
def test_has_image_capable_endpoint_provider_logic(monkeypatch, provider, base_url, expected):
    # A pure-DB, no-network read: a single enabled endpoint of the given provider family.
    class _Ep:
        def __init__(self, url):
            self.base_url = url
    class _Query:
        def __init__(self, rows):
            self._rows = rows
        def filter(self, *a, **k):
            return self
        def all(self):
            return self._rows
    class _Session:
        def __init__(self, rows):
            self._rows = rows
        def query(self, *a, **k):
            return _Query(self._rows)
        def close(self):
            pass
    import src.database as database
    monkeypatch.setattr(database, "SessionLocal", lambda: _Session([_Ep(base_url)]))
    # ModelEndpoint is referenced only for the .filter column — a stub attribute is enough.
    monkeypatch.setattr(database, "ModelEndpoint",
                        type("ME", (), {"is_enabled": True, "owner": None}))
    monkeypatch.setattr("src.auth_helpers.owner_filter", lambda q, m, o, **k: q)
    assert ai_interaction.has_image_capable_endpoint("u") is expected


def test_has_image_capable_endpoint_false_when_none(monkeypatch):
    class _Query:
        def filter(self, *a, **k):
            return self
        def all(self):
            return []
    class _Session:
        def query(self, *a, **k):
            return _Query()
        def close(self):
            pass
    import src.database as database
    monkeypatch.setattr(database, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(database, "ModelEndpoint",
                        type("ME", (), {"is_enabled": True, "owner": None}))
    monkeypatch.setattr("src.auth_helpers.owner_filter", lambda q, m, o, **k: q)
    assert ai_interaction.has_image_capable_endpoint("u") is False


# ── _generate_one never POSTs a chat model (no 400-loop) ───────────────────────

def test_generate_one_skips_chat_model_no_http(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "deepseek/deepseek-v4-pro", "medium"))
    _patch_resolver(monkeypatch, resolves=["deepseek/deepseek-v4-pro"])  # no image model anywhere

    # If any HTTP call were attempted, this would blow up — proving we short-circuit first.
    def _boom(*a, **k):
        raise AssertionError("must not POST a non-image model")
    monkeypatch.setattr("httpx.AsyncClient", _boom)

    orwell_portraits._consume_gen_error()  # clear stale
    out = _run(orwell_portraits._generate_one("a prompt", "u"))
    assert out is None
    assert orwell_portraits._consume_gen_error() == "no-model"  # honest, not http-400


# ── the manual lever runs now (force bypasses the debounce) ────────────────────

def test_manual_force_bypasses_debounce(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "backfill_allowed", lambda user: False)  # window NOT elapsed

    scheduled = []

    async def fake_backfill(ids, user):
        scheduled.append(list(ids))
        return {"generated": 0, "skipped": 0, "total": 0}
    monkeypatch.setattr(orwell_portraits, "backfill_missing", fake_backfill)

    # Drive inside a RUNNING loop so kickoff_backfill uses loop.create_task (its real call
    # pattern) — never the asyncio.run fallback, which closes the loop and would poison every
    # later test in the session ("no current event loop").
    async def drive():
        # the AUTO poll path respects the debounce…
        assert orwell_portraits.kickoff_backfill(["npc:1"], "u", force=False) is False
        # …the explicit lever runs anyway.
        assert orwell_portraits.kickoff_backfill(["npc:1"], "u", force=True) is True
        await asyncio.sleep(0)  # let the scheduled task run

    _run(drive())
    assert scheduled == [["npc:1"]]  # only the forced run scheduled work


# ── failures capture the provider's reason ─────────────────────────────────────

def test_log_attempt_records_detail_on_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "p.jsonl")
    orwell_portraits.log_attempt("npc:1", False, "http-400", 123,
                                 detail="This model does not support image generation")
    log = orwell_portraits.read_attempt_log()
    assert log and log[-1]["errorClass"] == "http-400"
    assert "does not support" in log[-1]["detail"]


def test_log_attempt_omits_detail_on_success(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "p.jsonl")
    orwell_portraits.log_attempt("npc:1", True, None, 50, detail="ignored")
    log = orwell_portraits.read_attempt_log()
    assert "detail" not in log[-1]


class _FakeResp:
    def __init__(self, body):
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_provider_error_reason_extracts_message():
    r = _FakeResp({"error": {"message": "This model does not support image generation",
                             "code": "unsupported_model"}})
    assert "does not support" in orwell_portraits._provider_error_reason(r)


def test_provider_error_reason_none_on_nonjson():
    assert orwell_portraits._provider_error_reason(_FakeResp(ValueError("not json"))) is None

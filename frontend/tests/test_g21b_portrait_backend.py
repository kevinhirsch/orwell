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

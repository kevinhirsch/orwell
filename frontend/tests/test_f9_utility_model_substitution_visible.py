"""F9 — a config-vs-served model substitution must be VISIBLE, never a silent swap.

Reported: ``utility_model = qwen/qwen3.6-flash`` configured, but ``thinkingmachines/inkling`` served
(per llmIo). That happens when the configured model is hidden/disabled on the endpoint, so the picker
falls through to the endpoint's first enabled chat model. Resolution is unchanged (we don't touch the
novita narration pin), but the swap must now LOG loudly so an operator can see it on /admin/status.
"""
import importlib

import pytest

endpoint_resolver = importlib.import_module("src.endpoint_resolver")
settings_mod = importlib.import_module("src.settings")


def _seed_endpoint(ep_id="ep-or", *, cached_models, hidden_models):
    import json
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.add(ModelEndpoint(
            id=ep_id, name="OpenRouter", base_url="https://openrouter.ai/api/v1",
            api_key="sk-live", is_enabled=True, model_type="llm", owner=None,
            cached_models=json.dumps(cached_models),
            hidden_models=json.dumps(hidden_models),
        ))
        db.commit()
    finally:
        db.close()


def _clear():
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _isolation():
    _clear()
    yield
    _clear()


@pytest.fixture()
def _utility_settings(monkeypatch):
    merged = dict(settings_mod.DEFAULT_SETTINGS)
    merged["default_endpoint_id"] = "ep-or"
    merged["default_model"] = "z-ai/glm-4.7"
    merged["utility_model"] = "qwen/qwen3.6-flash"
    merged["utility_endpoint_id"] = ""     # rides the default endpoint (the ADR 0016 two-tier pair)
    monkeypatch.setattr(settings_mod, "load_settings", lambda: dict(merged))
    monkeypatch.setattr(settings_mod, "get_setting", lambda key, default=None: merged.get(key, default))
    monkeypatch.setattr(settings_mod, "get_user_setting",
                        lambda key, owner, default="": merged.get(key, default))
    return merged


def test_hidden_configured_utility_model_logs_substitution(_utility_settings, caplog):
    # qwen is configured but HIDDEN on the endpoint; inkling is the enabled chat model.
    _seed_endpoint(cached_models=["qwen/qwen3.6-flash", "thinkingmachines/inkling"],
                   hidden_models=["qwen/qwen3.6-flash"])
    with caplog.at_level("WARNING"):
        url, model, _h = endpoint_resolver.resolve_endpoint("utility", owner="u")
    # served model is the endpoint's first enabled chat model (unchanged resolution)…
    assert model == "thinkingmachines/inkling"
    # …but the swap is now LOUD, not silent.
    logs = " ".join(r.message for r in caplog.records)
    assert "substitution" in logs.lower() or "not being served" in logs.lower()
    assert "qwen/qwen3.6-flash" in logs and "thinkingmachines/inkling" in logs


def test_configured_utility_model_served_logs_no_substitution(_utility_settings, caplog):
    # qwen is enabled → it is served, no substitution warning.
    _seed_endpoint(cached_models=["qwen/qwen3.6-flash", "thinkingmachines/inkling"],
                   hidden_models=[])
    with caplog.at_level("WARNING"):
        url, model, _h = endpoint_resolver.resolve_endpoint("utility", owner="u")
    assert model == "qwen/qwen3.6-flash"
    assert not any("substitution" in r.message.lower() for r in caplog.records)

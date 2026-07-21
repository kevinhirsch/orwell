"""#1754 (P0) — narrator↔utility MUTUAL model fallback in ``resolve_endpoint``.

Root cause of the "front-end does not respond during casting" report: the owner's configured UTILITY
model (``qwen/qwen3.6-flash``) is disabled on their OpenRouter endpoint. The old resolver, when a
configured model was hidden/disabled, dropped to *the endpoint's first enabled chat model* — an
ARBITRARY target (``thinkingmachines/inkling`` in the live log). During the casting-finalize burst the
FE fires a cluster of background-authoring / utility calls; the arbitrary substitute was slow/broken,
so the casting turn appeared to hang.

Owner ruling 2026-07-21 — the two configured models are each other's fallback:
  • a call for the NARRATOR/default model, if unavailable, falls back to the configured UTILITY model;
  • a call for the UTILITY model, if unavailable, falls back to the configured NARRATOR/default model;
  • only when BOTH are unavailable do we reach the documented last resort (the endpoint's first
    enabled chat model), logged clearly.

Never substitute an arbitrary "first enabled chat model" while a working configured model exists.
Roles only; no names.
"""
import importlib
import json

import pytest

endpoint_resolver = importlib.import_module("src.endpoint_resolver")
settings_mod = importlib.import_module("src.settings")

_NARRATOR = "z-ai/glm-4.7"
_UTILITY = "qwen/qwen3.6-flash"
_ARBITRARY = "thinkingmachines/inkling"  # an enabled-but-unconfigured model — must never be chosen
                                         # while a configured model is still served.


def _seed_endpoint(ep_id="ep-or", *, cached_models, hidden_models):
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
def _two_tier_settings(monkeypatch):
    """The shipped ADR 0016 two-tier pair: narrator + utility on the one OpenRouter endpoint."""
    merged = dict(settings_mod.DEFAULT_SETTINGS)
    merged["default_endpoint_id"] = "ep-or"
    merged["default_model"] = _NARRATOR
    merged["utility_model"] = _UTILITY
    merged["utility_endpoint_id"] = ""      # rides the default endpoint
    monkeypatch.setattr(settings_mod, "load_settings", lambda: dict(merged))
    monkeypatch.setattr(settings_mod, "get_setting", lambda key, default=None: merged.get(key, default))
    monkeypatch.setattr(settings_mod, "get_user_setting",
                        lambda key, owner, default="": merged.get(key, default))
    return merged


# ── direction 1: utility unavailable → narrator (the owner's exact case) ────────────────────────

def test_utility_unavailable_falls_back_to_narrator(_two_tier_settings):
    """The reported case: utility model disabled → utility-class calls resolve to the SERVED
    narrator model, deterministically — never the arbitrary first-enabled model."""
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY],
                   hidden_models=[_UTILITY])
    _url, model, _h = endpoint_resolver.resolve_endpoint("utility", owner="u")
    assert model == _NARRATOR
    assert model != _ARBITRARY


def test_faithfulness_prefix_unavailable_utility_falls_back_to_narrator(_two_tier_settings):
    """A non-utility utility-tier prefix (faithfulness) inherits the utility model; when that is
    unavailable it, too, mutual-falls-back to the narrator — not the arbitrary model."""
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY],
                   hidden_models=[_UTILITY])
    _url, model, _h = endpoint_resolver.resolve_endpoint("faithfulness", owner="u")
    assert model == _NARRATOR
    assert model != _ARBITRARY


# ── direction 2: narrator unavailable → utility ─────────────────────────────────────────────────

def test_narrator_unavailable_falls_back_to_utility(_two_tier_settings):
    """The mirror: the default/narrator model disabled → default-class calls resolve to the SERVED
    utility model, not the arbitrary first-enabled model."""
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY],
                   hidden_models=[_NARRATOR])
    _url, model, _h = endpoint_resolver.resolve_endpoint("default", owner="u")
    assert model == _UTILITY
    assert model != _ARBITRARY


# ── both unavailable → documented last resort (first enabled), logged clearly ────────────────────

def test_both_configured_unavailable_reaches_last_resort(_two_tier_settings, caplog):
    """Only when BOTH configured models are unavailable do we reach the documented last resort:
    the endpoint's first enabled chat model — and it must log clearly."""
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY],
                   hidden_models=[_NARRATOR, _UTILITY])
    with caplog.at_level("WARNING"):
        _url, model, _h = endpoint_resolver.resolve_endpoint("utility", owner="u")
    assert model == _ARBITRARY  # the only enabled model left
    logs = " ".join(r.message for r in caplog.records).lower()
    assert "last resort" in logs or "neither configured" in logs


# ── no regression: a served configured model is untouched (no substitution) ──────────────────────

def test_served_utility_model_is_untouched(_two_tier_settings, caplog):
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY], hidden_models=[])
    with caplog.at_level("WARNING"):
        _url, model, _h = endpoint_resolver.resolve_endpoint("utility", owner="u")
    assert model == _UTILITY
    assert not any("mutual fallback" in r.message.lower() for r in caplog.records)


def test_served_narrator_model_is_untouched(_two_tier_settings, caplog):
    _seed_endpoint(cached_models=[_NARRATOR, _UTILITY, _ARBITRARY], hidden_models=[])
    with caplog.at_level("WARNING"):
        _url, model, _h = endpoint_resolver.resolve_endpoint("default", owner="u")
    assert model == _NARRATOR
    assert not any("mutual fallback" in r.message.lower() for r in caplog.records)

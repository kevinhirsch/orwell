"""Owner-reported bug: "every time I factory reset or make some change every now and then, a
random model is added to the picker or something" — a model the owner never added shows up in
the chat model picker.

Root cause traced: once an endpoint is CURATED (the game-build trio pin from #1565/owner-ruling
2026-07-13, or an admin's manual hide/pin in the Model Manager), the picker's visible set is
``cached_models`` merged with ``pinned_models`` minus ``hidden_models``. Every LIVE refresh of an
endpoint's model list — the background TTL refresh, an admin's manual "Refresh models" click, the
dedupe re-add-same-endpoint path, or simply the FIRST post-restart probe after a factory reset —
used to REPLACE ``cached_models`` wholesale with whatever the provider currently serves. Any model
id the provider started offering SINCE the endpoint was last curated was never in the OLD
``hidden_models`` snapshot, so it silently joined the VISIBLE set — a "phantom" entry the owner
never explicitly enabled. This reproduces on a factory reset because #860 preserves the endpoint
row (including its stale ``updated_at``/curation snapshot) VERBATIM, so the FIRST refresh the
restarted process performs afterward is exactly the erosion window; it also reproduces on any
ordinary "change every now and then" because the same erosion fires on the routine background TTL
refresh or a manual refresh click.

The fix (``routes.model_routes._apply_refreshed_models``): a live refresh on an endpoint that
already carries a curation signal (anything pinned OR anything hidden) defaults any NEWLY
appeared id to HIDDEN instead of silently making it visible — reversible any time in the model
manager, never lost. An endpoint with NO curation signal (the "browse everything" default shape)
is untouched — byte-identical to before this fix.

Roles only — model ids here are provider ids (app config), never cast material.
"""
import importlib
import json

import pytest

model_routes = importlib.import_module("routes.model_routes")
settings_mod = importlib.import_module("src.settings")

_NARRATOR = "z-ai/glm-4.7"
_UTILITY = "qwen/qwen3.6-flash"
_IMAGE = "google/gemini-3.1-flash-image"
_ARBITRARY_FIRST = "openai/gpt-5.6-luna-pro"
_CATALOG = [_ARBITRARY_FIRST, "openai/gpt-4o", _NARRATOR, _UTILITY, _IMAGE,
            "mistralai/mistral-large", "meta-llama/llama-4-70b"]
_PHANTOM = "anthropic/claude-9-ultra-preview"  # a model the provider adds AFTER curation


def _clear_endpoints():
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _endpoint_isolation():
    _clear_endpoints()
    yield
    _clear_endpoints()


def _model_routes_client(monkeypatch, settings, probed):
    """A TestClient over the real model routes with an in-memory settings store and a
    stubbed provider probe (no network) — mirrors test_oob_default_never_arbitrary.py's harness."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    er = importlib.import_module("src.endpoint_resolver")
    store = dict(settings)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(model_routes, "_load_settings", lambda: dict(store))
    monkeypatch.setattr(model_routes, "_save_settings", lambda s: store.update(s))
    monkeypatch.setattr(settings_mod, "get_setting",
                        lambda key, default=None: store.get(key, default))
    monkeypatch.setattr(model_routes, "_probe_endpoint", lambda *a, **k: list(probed["v"]))
    monkeypatch.setattr(model_routes, "_ping_endpoint",
                        lambda *a, **k: {"reachable": True, "error": None})
    monkeypatch.setattr(er, "resolve_url", lambda u: u)
    app = FastAPI()
    app.include_router(model_routes.setup_model_routes(object()))
    return TestClient(app, raise_server_exceptions=False), store


def _add_curated_openrouter(client, monkeypatch):
    monkeypatch.setattr(settings_mod, "game_build_enabled", lambda: True)
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    assert res.status_code == 200, res.text
    return res.json()


def _visible_ids(client):
    items = client.get("/api/models").json()["items"]
    assert items, "expected at least one endpoint in the picker feed"
    return items[0]["models"]


# ═══════════════════════════════════════════════════════════════════════════════════════
# 1. Unit: _apply_refreshed_models itself
# ═══════════════════════════════════════════════════════════════════════════════════════

class _FakeEndpoint:
    def __init__(self, cached=None, hidden=None, pinned=None):
        self.cached_models = json.dumps(cached) if cached else None
        self.hidden_models = json.dumps(hidden) if hidden else None
        self.pinned_models = json.dumps(pinned) if pinned else None


def test_apply_refreshed_models_hides_a_newly_appeared_id_on_a_curated_endpoint():
    ep = _FakeEndpoint(cached=_CATALOG, hidden=[m for m in _CATALOG if m not in (_NARRATOR, _UTILITY, _IMAGE)],
                        pinned=[_NARRATOR, _UTILITY, _IMAGE])
    model_routes._apply_refreshed_models(ep, _CATALOG + [_PHANTOM])
    hidden = set(json.loads(ep.hidden_models))
    assert _PHANTOM in hidden, "a newly-appeared id on a curated endpoint must default to hidden"
    cached = set(json.loads(ep.cached_models))
    assert _PHANTOM in cached, "the id is still DISCOVERED (cached) — just not silently visible"


def test_apply_refreshed_models_never_hides_a_pinned_id():
    ep = _FakeEndpoint(cached=[_NARRATOR], hidden=["something-else"], pinned=[_NARRATOR])
    model_routes._apply_refreshed_models(ep, [_NARRATOR, "brand-new-pinned-later"])
    # A model that's already pinned must never be auto-hidden even if it looks "new" relative
    # to the old cached snapshot (an admin can pin a not-yet-cached id by hand).
    ep2 = _FakeEndpoint(cached=[_NARRATOR], hidden=[], pinned=[_NARRATOR, "hand-pinned-not-cached"])
    model_routes._apply_refreshed_models(ep2, [_NARRATOR, "hand-pinned-not-cached"])
    hidden2 = set(json.loads(ep2.hidden_models)) if ep2.hidden_models else set()
    assert "hand-pinned-not-cached" not in hidden2


def test_apply_refreshed_models_is_a_noop_on_an_uncurated_endpoint():
    """No pinned, no hidden ⇒ the "browse everything" shape — byte-identical replace, exactly
    like before this fix (an endpoint nobody ever curated has no "owner never added this" set to
    protect)."""
    ep = _FakeEndpoint(cached=[_ARBITRARY_FIRST])
    model_routes._apply_refreshed_models(ep, _CATALOG)
    assert ep.hidden_models is None
    assert set(json.loads(ep.cached_models)) == set(_CATALOG)


def test_apply_refreshed_models_empty_probe_is_a_noop():
    ep = _FakeEndpoint(cached=_CATALOG, hidden=["x"], pinned=["y"])
    before_cached, before_hidden = ep.cached_models, ep.hidden_models
    model_routes._apply_refreshed_models(ep, [])
    assert ep.cached_models == before_cached
    assert ep.hidden_models == before_hidden


# ═══════════════════════════════════════════════════════════════════════════════════════
# 2. End-to-end over the routes: the picker's visible-model COUNT never grows across a refresh
# ═══════════════════════════════════════════════════════════════════════════════════════

def test_manual_refresh_route_does_not_grow_the_picker(monkeypatch):
    """The admin Model Manager's explicit '/model-endpoints/{id}/models?refresh=true' click —
    the "make some change every now and then" trigger — must not surface an un-curated model."""
    probed = {"v": list(_CATALOG)}
    client, _store = _model_routes_client(
        monkeypatch, {"default_endpoint_id": "", "default_model": _NARRATOR,
                      "utility_model": _UTILITY, "image_model": _IMAGE}, probed)
    body = _add_curated_openrouter(client, monkeypatch)
    ep_id = body["id"]

    before = _visible_ids(client)
    before_count = len(before)

    # The provider's catalog grows — a model the owner never touched.
    probed["v"] = list(_CATALOG) + [_PHANTOM]
    r = client.get(f"/api/model-endpoints/{ep_id}/models", params={"refresh": "true"})
    assert r.status_code == 200

    after = _visible_ids(client)
    assert len(after) == before_count, (
        f"the picker's visible model count grew across a refresh: {before} -> {after}"
    )
    assert _PHANTOM not in after, "a model the owner never enabled must not appear in the picker"

    # It's still discoverable (not lost) — just not silently visible.
    manager_view = r.json()
    ids = {row["id"] for row in manager_view}
    assert _PHANTOM in ids
    phantom_row = next(row for row in manager_view if row["id"] == _PHANTOM)
    assert phantom_row["is_hidden"] is True
    assert phantom_row["is_pinned"] is False


def test_background_refresh_does_not_grow_the_picker(monkeypatch):
    """The routine background TTL refresh — no admin action at all — is the OTHER "every now
    and then" trigger; it must not leak an un-curated model into the picker either.

    ``_refresh_caches_bg`` is a closure private to ``setup_model_routes`` (not a module
    attribute), and it dispatches its probe on a daemon thread — so this drives it exactly the
    way production does (``GET /api/models?refresh=true``) and polls the PERSISTED row (not the
    request-scoped cache) until the async refresh lands."""
    from core.database import SessionLocal, ModelEndpoint
    import time

    probed = {"v": list(_CATALOG)}
    client, _store = _model_routes_client(
        monkeypatch, {"default_endpoint_id": "", "default_model": _NARRATOR,
                      "utility_model": _UTILITY, "image_model": _IMAGE}, probed)
    body = _add_curated_openrouter(client, monkeypatch)
    ep_id = body["id"]

    before_count = len(_visible_ids(client))

    probed["v"] = list(_CATALOG) + [_PHANTOM]
    client.get("/api/models", params={"refresh": "true"})  # kicks the bg refresh thread

    def _row_cached_models():
        db = SessionLocal()
        try:
            ep = db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).first()
            return set(json.loads(ep.cached_models)) if ep and ep.cached_models else set()
        finally:
            db.close()

    for _ in range(100):
        if _PHANTOM in _row_cached_models():
            break
        time.sleep(0.02)
    else:
        pytest.fail("background refresh never landed (test setup issue, not the fix)")

    after = _visible_ids(client)
    assert len(after) == before_count, (
        f"a background refresh must not grow the picker's visible model count: got {after}"
    )
    assert _PHANTOM not in after


def test_reset_then_next_refresh_does_not_grow_the_picker(monkeypatch):
    """The factory-reset shape end to end: oobe_reset.py PRESERVES the model_endpoints row
    (cached/hidden/pinned all carried verbatim — #860), so the picker is unchanged IMMEDIATELY
    after a reset. This pins the OTHER half of the owner's report — the FIRST refresh the
    restarted process performs afterward (background TTL or a manual click) must still not
    surface anything the owner didn't curate."""
    probed = {"v": list(_CATALOG)}
    client, store = _model_routes_client(
        monkeypatch, {"default_endpoint_id": "", "default_model": _NARRATOR,
                      "utility_model": _UTILITY, "image_model": _IMAGE}, probed)
    body = _add_curated_openrouter(client, monkeypatch)
    ep_id = body["id"]
    before_count = len(_visible_ids(client))

    # ── Simulate the #860 reset: the model SELECTIONS revert to the OOB defaults, but the
    # endpoint row (cached/hidden/pinned) is carried verbatim — reset_frontend_store's contract.
    store.clear()
    store.update({"default_model": _NARRATOR, "utility_model": _UTILITY, "image_model": _IMAGE,
                  "default_endpoint_id": ep_id})

    # The row itself is untouched by a reset — the picker must be byte-identical right after.
    assert len(_visible_ids(client)) == before_count

    # Now the provider's catalog has grown since the endpoint was curated (real-world drift),
    # and the restarted process's first refresh (background OR the OOBE wizard's re-probe) fires.
    probed["v"] = list(_CATALOG) + [_PHANTOM]
    r = client.get(f"/api/model-endpoints/{ep_id}/models", params={"refresh": "true"})
    assert r.status_code == 200

    after = _visible_ids(client)
    assert len(after) == before_count, (
        f"a reset followed by the next refresh must not grow the picker: {after}"
    )
    assert _PHANTOM not in after

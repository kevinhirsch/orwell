"""T0-4 (telemetry + probe arm) — the endpoint-registration KICKOFF wiring.

``POST /api/model-endpoints`` must fire a best-effort background capability probe for a
freshly-registered LLM endpoint (never for an image endpoint, never when no chat model was
discovered), and the kickoff must never fail the registration response even if the probe
machinery itself blows up. Mirrors the harness in test_no_phantom_model_picker_growth.py.
"""

import importlib

import pytest

model_routes = importlib.import_module("routes.model_routes")
settings_mod = importlib.import_module("src.settings")
cap = importlib.import_module("src.capability_probe")

_NARRATOR = "z-ai/glm-4.7"
_UTILITY = "qwen/qwen3.6-flash"
_IMAGE = "google/gemini-3.1-flash-image"
_CATALOG = [_NARRATOR, _UTILITY, _IMAGE, "mistralai/mistral-large"]


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


def _client(monkeypatch, settings, probed):
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
    monkeypatch.setattr(settings_mod, "game_build_enabled", lambda: False)  # skip curation noise
    app = FastAPI()
    app.include_router(model_routes.setup_model_routes(object()))
    return TestClient(app, raise_server_exceptions=False)


def test_registering_an_llm_endpoint_kicks_the_capability_probe(monkeypatch):
    calls = []
    monkeypatch.setattr(cap, "probe_endpoint_background",
                        lambda ep_id, base_url, api_key, model, **k: calls.append(
                            (ep_id, base_url, api_key, model, k)))
    client = _client(monkeypatch, {"default_model": _NARRATOR}, {"v": _CATALOG})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    assert res.status_code == 200, res.text
    ep_id = res.json()["id"]
    assert len(calls) == 1
    called_ep_id, base_url, api_key, model, kwargs = calls[0]
    assert called_ep_id == ep_id
    assert base_url == "https://openrouter.ai/api/v1"
    assert api_key == "sk-live-test"
    # Prefers the CONFIGURED default_model when it's in the discovered catalog — never an
    # arbitrary first-listed id.
    assert model == _NARRATOR


def test_probe_targets_the_first_chat_model_when_no_default_is_configured(monkeypatch):
    calls = []
    monkeypatch.setattr(cap, "probe_endpoint_background",
                        lambda ep_id, base_url, api_key, model, **k: calls.append(model))
    client = _client(monkeypatch, {}, {"v": _CATALOG})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    assert res.status_code == 200, res.text
    assert len(calls) == 1
    assert calls[0] in _CATALOG  # some discovered chat model — never blank


def test_image_endpoints_are_never_probed(monkeypatch):
    calls = []
    monkeypatch.setattr(cap, "probe_endpoint_background",
                        lambda *a, **k: calls.append(a))
    client = _client(monkeypatch, {}, {"v": ["google/gemini-3.1-flash-image"]})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter Image", "require_models": "true", "model_type": "image"})
    assert res.status_code == 200, res.text
    assert calls == []


def test_an_empty_catalog_never_kicks_the_probe(monkeypatch):
    calls = []
    monkeypatch.setattr(cap, "probe_endpoint_background",
                        lambda *a, **k: calls.append(a))
    client = _client(monkeypatch, {}, {"v": []})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://dead.example/v1", "api_key": "", "name": "Dead", "skip_probe": "true"})
    assert res.status_code == 200, res.text
    assert calls == []


def test_a_broken_probe_kickoff_never_fails_endpoint_registration(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("thread pool exhausted")
    monkeypatch.setattr(cap, "probe_endpoint_background", boom)
    client = _client(monkeypatch, {"default_model": _NARRATOR}, {"v": _CATALOG})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    # The registration itself still succeeds — the probe kickoff is fail-soft.
    assert res.status_code == 200, res.text
    assert "id" in res.json()


# ── T0-4 CodeRabbit minor (PR #1821): deleting an endpoint clears its CapabilityProfile too ─────
# A stale profile left behind after deletion can otherwise keep lighting the capability-red alarm
# on /admin/status for an endpoint that no longer exists — un-actionable RED noise.


def test_deleting_an_endpoint_clears_its_capability_profile(monkeypatch, tmp_path):
    # Isolate capability_probe's OWN settings-store reads/writes (it goes through the real
    # src.settings module, independent of the route-level in-memory `store` the `_client`
    # harness patches for the endpoint-registration path). Verified against the RAW file rather
    # than cap.get_capability_profile() — the `_client` harness patches `settings_mod.get_setting`
    # to read the route's fake in-memory `store` (needed for the registration path's own settings
    # reads), which would shadow the real file `get_capability_profile()` reads through; the
    # DELETE-side fix under test writes through `save_settings` directly, unaffected by that patch.
    import json as _json
    monkeypatch.setattr(settings_mod, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    settings_mod._invalidate_caches()

    monkeypatch.setattr(cap, "probe_endpoint_background", lambda *a, **k: None)  # skip the real kickoff
    client = _client(monkeypatch, {}, {"v": _CATALOG})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    assert res.status_code == 200, res.text
    ep_id = res.json()["id"]

    cap.save_capability_profile(ep_id, {"overallTier": "red", "model": _NARRATOR})
    saved_before = _json.loads((tmp_path / "settings.json").read_text())
    assert ep_id in saved_before.get("capability_profiles", {})

    del_res = client.delete(f"/api/model-endpoints/{ep_id}")
    assert del_res.status_code == 200, del_res.text
    saved_after = _json.loads((tmp_path / "settings.json").read_text())
    assert ep_id not in saved_after.get("capability_profiles", {})


def test_deleting_an_endpoint_with_no_profile_never_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(settings_mod, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    settings_mod._invalidate_caches()
    monkeypatch.setattr(cap, "probe_endpoint_background", lambda *a, **k: None)
    client = _client(monkeypatch, {}, {"v": _CATALOG})
    res = client.post("/api/model-endpoints", data={
        "base_url": "https://openrouter.ai/api/v1", "api_key": "sk-live-test",
        "name": "OpenRouter", "require_models": "true"})
    ep_id = res.json()["id"]
    # No profile was ever saved for this endpoint — deletion must still succeed cleanly.
    del_res = client.delete(f"/api/model-endpoints/{ep_id}")
    assert del_res.status_code == 200, del_res.text

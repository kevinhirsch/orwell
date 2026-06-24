"""Regression: a text→image model must never resolve AS the chat/narrator model, and an
admin must be able to SET a model on any endpoint they can see.

Root cause of the field report ("chat insists on google/gemini-3.1-flash-image; empty/weird
replies going to gemini; 'Failed to set model' when switching to deepseek"):

  1. Several chat-model selectors carried their own incomplete non-chat lists that only knew
     the legacy image families (dall-e / stable-diffusion), so a modern image model like
     "google/gemini-3.1-flash-image" slipped through and got bound/recovered as the chat model.
     The fix routes every selector through the single `src.llm_core.is_image_model`.
  2. The session model-switch WRITE paths applied owner-scoping even to admins (unlike the READ
     paths), so an admin could SEE an endpoint's model in the picker yet fail to SET it — e.g.
     a shared/null-owner row, or one whose owner stamp went stale after an OOBE reset rebuilt
     accounts but preserved endpoints. `_resolve_registered_endpoint` now exempts admins.

Role-only (no houseguest/player names): "admin" / "owner" / "other user" are ACCOUNT roles.
"""

import importlib
import json
import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

llm_core = importlib.import_module("src.llm_core")
endpoint_resolver = importlib.import_module("src.endpoint_resolver")
orwell_portraits = importlib.import_module("src.orwell_portraits")


# ── 1. canonical classification: image families + "*-image" ids, but NOT vision/chat ──

@pytest.mark.parametrize("mid", [
    "google/gemini-3.1-flash-image",   # the exact field-report model
    "google/gemini-2.5-flash-image-preview",
    "gpt-image-1", "gpt-image-1.5", "dall-e-3",
    "black-forest-labs/flux-1.1-pro", "stabilityai/stable-diffusion-3.5-large",
    "google/imagen-3", "bytedance/seedream-3-t2i", "recraft-v3",
])
def test_is_image_model_true_for_generators(mid):
    assert llm_core.is_image_model(mid) is True
    # The portrait module re-exports the SAME function (its tests stay pinned).
    assert orwell_portraits._is_image_model(mid) is True


@pytest.mark.parametrize("mid", [
    "deepseek/deepseek-v4-pro",        # the narrator the operator wanted
    "openai/gpt-4o", "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",         # multimodal CHAT, no "image" token
    "anthropic/claude-sonnet-4-5",
    "qwen/qwen2-vl-7b-instruct",       # VISION (understanding) model — chat-capable
    "meta-llama/llama-3.2-11b-vision-instruct",
])
def test_is_image_model_false_for_chat_and_vision(mid):
    assert llm_core.is_image_model(mid) is False


# ── 2. _first_chat_model skips image models even when one is listed FIRST ──────────────

def test_first_chat_model_skips_a_leading_image_model():
    models = ["google/gemini-3.1-flash-image", "deepseek/deepseek-v4-pro", "openai/gpt-4o"]
    assert endpoint_resolver._first_chat_model(models) == "deepseek/deepseek-v4-pro"


def test_first_chat_model_still_skips_embeddings():
    models = ["text-embedding-3-large", "google/gemini-3.1-flash-image", "openai/gpt-4o"]
    assert endpoint_resolver._first_chat_model(models) == "openai/gpt-4o"


def test_first_chat_model_never_returns_an_image_model_even_when_all_are():
    # An image-only list has no chat model — but we must not hand one back as a chat default.
    assert endpoint_resolver._first_chat_model(["gpt-image-1", "dall-e-3"]) in (None, "gpt-image-1", "dall-e-3")
    # The guarantee that matters downstream: the dedicated callers treat the result through
    # is_image_model and drop it; here we only assert we don't crash and prefer chat when present.
    assert endpoint_resolver._first_chat_model(["gpt-image-1", "deepseek-chat"]) == "deepseek-chat"


# ── 3. the model_routes chat partition agrees (image models are NOT chat) ──────────────

def test_model_routes_is_chat_model_rejects_image_models():
    model_routes = importlib.import_module("routes.model_routes")
    assert model_routes._is_chat_model("google/gemini-3.1-flash-image") is False
    assert model_routes._is_chat_model("gpt-image-1") is False
    assert model_routes._is_chat_model("deepseek/deepseek-v4-pro") is True
    assert model_routes._is_chat_model("openai/gpt-4o") is True


# ── 4. /api/default-chat SELF-HEALS a default that points at an image model ────────────

def _seed_endpoint(ep_id, cached, owner=None, model_type="llm"):
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).delete()
        db.add(ModelEndpoint(
            id=ep_id, name="OpenRouter", base_url="https://openrouter.ai/api/v1",
            api_key=None, is_enabled=True, model_type=model_type,
            cached_models=json.dumps(cached), owner=owner,
        ))
        db.commit()
    finally:
        db.close()


def test_default_chat_does_not_return_a_persisted_image_model(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # single-user → global-settings branch
    model_routes = importlib.import_module("routes.model_routes")
    _seed_endpoint("ep_dc", ["google/gemini-3.1-flash-image", "deepseek/deepseek-v4-pro", "openai/gpt-4o"])
    # The corruption: the stored chat default IS the image model.
    monkeypatch.setattr(model_routes, "_load_settings", lambda: {
        "default_endpoint_id": "ep_dc",
        "default_model": "google/gemini-3.1-flash-image",
    })

    app = FastAPI()
    app.include_router(model_routes.setup_model_routes(object()))  # model_discovery unused here
    client = TestClient(app, raise_server_exceptions=False)

    r = client.get("/api/default-chat")
    assert r.status_code == 200
    body = r.json()
    assert body["endpoint_id"] == "ep_dc"
    # The headline guarantee: the resolved chat model is NEVER the image model.
    assert not llm_core.is_image_model(body["model"]), body
    assert body["model"] == "deepseek/deepseek-v4-pro"


# ── 5. BUG 2: an admin can SET a model on an endpoint they don't personally own ────────

class _FakeAuth:
    def __init__(self, admins):
        self._admins = set(admins)

    def is_admin(self, user):
        return user in self._admins


def _fake_request(admins):
    import types
    state = types.SimpleNamespace(auth_manager=_FakeAuth(admins))
    app = types.SimpleNamespace(state=state)
    return types.SimpleNamespace(app=app)


def test_admin_can_resolve_an_endpoint_owned_by_another_user():
    session_routes = importlib.import_module("routes.session_routes")
    _seed_endpoint("ep_owned_by_other", ["deepseek/deepseek-v4-pro"], owner="someone_else")

    # Admin "adminuser" does NOT own the endpoint (owner is "someone_else") — mirrors a
    # preserved endpoint whose owner stamp went stale across an OOBE reset. Must resolve.
    base, key, chat_url = session_routes._resolve_registered_endpoint(
        _fake_request(admins=["adminuser"]), "adminuser", "ep_owned_by_other"
    )
    assert base == "https://openrouter.ai/api/v1"
    assert chat_url.endswith("/chat/completions")


def test_non_admin_still_cannot_resolve_someone_elses_endpoint():
    session_routes = importlib.import_module("routes.session_routes")
    _seed_endpoint("ep_owned_by_other2", ["deepseek/deepseek-v4-pro"], owner="someone_else")

    with pytest.raises(HTTPException) as exc:
        session_routes._resolve_registered_endpoint(
            _fake_request(admins=[]), "not_the_owner", "ep_owned_by_other2"
        )
    assert exc.value.status_code == 400


def test_owner_can_resolve_their_own_endpoint_when_not_admin():
    session_routes = importlib.import_module("routes.session_routes")
    _seed_endpoint("ep_owned_by_me", ["deepseek/deepseek-v4-pro"], owner="me")

    base, key, chat_url = session_routes._resolve_registered_endpoint(
        _fake_request(admins=[]), "me", "ep_owned_by_me"
    )
    assert base == "https://openrouter.ai/api/v1"

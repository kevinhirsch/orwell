"""Hardening regression: model resolution must not be defeated by an endpoint whose owner
stamp doesn't match the caller, and a chat session pinned to an image model must self-recover.

Field symptom (admin /admin/status, post-OOBE-reset): "Image generation — NO USABLE MODEL"
even though the image model was configured and 16/16 portraits were already generated from
that very endpoint. Root cause: `_resolve_model` and `has_image_capable_endpoint` owner-scoped
with `include_shared=False` and NO admin exemption, so a configured endpoint whose owner is the
admin / null / a stale account (an OOBE reset rebuilds accounts but PRESERVES endpoint rows)
resolved to "not found" for the player. The hardening: admins see the whole pool; everyone else
sees their own endpoints PLUS shared/null-owner rows — matching the request-scoped read paths.

Role-only: "admin" / "owner_a" / "owner_b" are ACCOUNT roles, not houseguest/player names.
"""

import importlib
import json

import pytest

ai = importlib.import_module("src.ai_interaction")
auth_helpers = importlib.import_module("src.auth_helpers")
chat_routes = importlib.import_module("routes.chat_routes")
llm_core = importlib.import_module("src.llm_core")


@pytest.fixture(autouse=True)
def _clean_endpoints():
    """The conftest DB is shared across the whole session and other files seed endpoints;
    these tests assert on EXACT owner-scoping, so start each from an empty endpoints table."""
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()
    yield


def _seed_endpoint(ep_id, *, owner=None, base_url="http://127.0.0.1:1/v1", cached=None, enabled=True):
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).delete()
        db.add(ModelEndpoint(
            id=ep_id, name="OpenRouter", base_url=base_url, api_key=None,
            is_enabled=enabled, model_type="llm",
            cached_models=json.dumps(cached) if cached is not None else None,
            owner=owner,
        ))
        db.commit()
    finally:
        db.close()


# ── has_image_capable_endpoint: admin-exempt, non-admin gets own + shared ──────────────

def test_image_capable_false_for_non_admin_when_endpoint_owned_by_other(monkeypatch):
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: False)
    _seed_endpoint("hc_other", owner="owner_a")
    # owner_b owns nothing and the row isn't shared → correctly unavailable (isolation holds).
    assert ai.has_image_capable_endpoint("owner_b") is False


def test_image_capable_true_for_admin_even_when_endpoint_owned_by_other(monkeypatch):
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: True)
    _seed_endpoint("hc_other2", owner="owner_a")
    # The admin manages the global pool — the stale/foreign owner must NOT hide the endpoint.
    assert ai.has_image_capable_endpoint("the_admin") is True


def test_image_capable_true_for_non_admin_when_endpoint_is_shared(monkeypatch):
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: False)
    _seed_endpoint("hc_shared", owner=None)  # null-owner / shared
    assert ai.has_image_capable_endpoint("owner_b") is True


# ── _resolve_model: same scoping, observed via which error it raises ───────────────────

def test_resolve_model_non_admin_sees_no_endpoints_when_owned_by_other(monkeypatch):
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: False)
    _seed_endpoint("rm_other", owner="owner_a")
    with pytest.raises(ValueError) as exc:
        ai._resolve_model("deepseek/deepseek-v4-pro", owner="owner_b")
    # Scoped out entirely → the "no endpoints" branch, not "model not found".
    assert "No enabled endpoints found" in str(exc.value)


def test_resolve_model_admin_gets_past_scoping_to_the_probe(monkeypatch):
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: True)
    _seed_endpoint("rm_other2", owner="owner_a")
    with pytest.raises(ValueError) as exc:
        ai._resolve_model("deepseek/deepseek-v4-pro", owner="the_admin")
    # Admin is NOT scoped out: the endpoint is visible, so we reach the catalog probe (which
    # fails against the unreachable test URL) and raise the DIFFERENT "not found" error.
    assert "not found on any configured endpoint" in str(exc.value)


# ── _recover_empty_session_model: an image-model session self-recovers to a chat model ──

class _Sess:
    def __init__(self, model, endpoint_url, sid="s1"):
        self.model = model
        self.endpoint_url = endpoint_url
        self.id = sid


def test_recover_switches_an_image_model_session_to_a_chat_model():
    _seed_endpoint("rec_ep", base_url="http://127.0.0.1:1/v1",
                   cached=["google/gemini-3.1-flash-image", "deepseek/deepseek-v4-pro"])
    sess = _Sess(model="google/gemini-3.1-flash-image", endpoint_url="http://127.0.0.1:1/v1")
    repaired = chat_routes._recover_empty_session_model(sess, "s1", owner=None)
    assert repaired is True
    assert sess.model == "deepseek/deepseek-v4-pro"
    assert not llm_core.is_image_model(sess.model)


def test_recover_leaves_a_valid_chat_model_session_untouched():
    _seed_endpoint("rec_ep2", base_url="http://127.0.0.1:1/v1",
                   cached=["deepseek/deepseek-v4-pro", "openai/gpt-4o"])
    sess = _Sess(model="deepseek/deepseek-v4-pro", endpoint_url="http://127.0.0.1:1/v1")
    assert chat_routes._recover_empty_session_model(sess, "s2", owner=None) is False
    assert sess.model == "deepseek/deepseek-v4-pro"


# ── is_admin_user: safe defaults without an auth.json ──────────────────────────────────

def test_is_admin_user_false_for_empty_or_unknown():
    assert auth_helpers.is_admin_user("") is False
    assert auth_helpers.is_admin_user(None) is False
    # An unknown user (no auth.json / not an admin) is never admin and never raises.
    assert auth_helpers.is_admin_user("nobody-by-this-name") is False

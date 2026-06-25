"""A model-less session must FALL BACK to the configured default and bind it — never refuse the send.

The bug (real deployment): a game/canonical session ended up with model="" AND no endpoint binding.
`_recover_empty_session_model` only recovered when the session still pointed at a matching endpoint,
so it returned False → the send was refused ("No model selected") and nothing ever reached the model
API — even though a default (deepseek-v4-pro) WAS configured. The fix resolves the configured default
(then the first enabled endpoint) and binds model + endpoint_url to the session.
"""
import json
import pytest

import routes.chat_routes as chat_routes


@pytest.fixture(autouse=True)
def _clean_endpoints():
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()
    yield


def _seed(ep_id, cached, *, base_url="https://openrouter.ai/api/v1", owner=None):
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.add(ModelEndpoint(
            id=ep_id, name="OpenRouter", base_url=base_url, api_key="k",
            is_enabled=True, model_type="llm", cached_models=json.dumps(cached), owner=owner,
        ))
        db.commit()
    finally:
        db.close()


class _Sess:
    def __init__(self, model="", endpoint_url=""):
        self.model = model
        self.endpoint_url = endpoint_url


def test_model_less_session_binds_the_configured_default(monkeypatch):
    _seed("ep1", ["deepseek/deepseek-v4-pro", "anthropic/claude-x"])
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="", endpoint_url="")  # the stranded game session
    assert chat_routes._recover_empty_session_model(sess, "sX", owner=None) is True
    assert sess.model == "deepseek/deepseek-v4-pro"      # honored the user's configured default
    assert "openrouter.ai" in sess.endpoint_url          # …and bound the endpoint too


def test_default_not_served_by_provider_binds_a_real_chat_model(monkeypatch):
    # The configured default is NOT a model the provider actually serves (e.g. a fictional/renamed id):
    # bind a real chat model the endpoint DOES serve instead of stranding the session on a 404 model.
    _seed("ep1", ["anthropic/claude-x", "meta/llama-y"])
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="", endpoint_url="")
    assert chat_routes._recover_empty_session_model(sess, "sY", owner=None) is True
    assert sess.model in ("anthropic/claude-x", "meta/llama-y")
    assert sess.model != "deepseek/deepseek-v4-pro"


def test_no_configured_default_uses_first_enabled_endpoint(monkeypatch):
    _seed("ep1", ["anthropic/claude-x"])
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("", ""))  # nothing configured
    sess = _Sess(model="", endpoint_url="")
    assert chat_routes._recover_empty_session_model(sess, "sZ", owner=None) is True
    assert sess.model == "anthropic/claude-x"
    assert "openrouter.ai" in sess.endpoint_url


def test_session_with_a_valid_model_is_left_untouched(monkeypatch):
    _seed("ep1", ["anthropic/claude-x"])
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="deepseek/deepseek-v4-pro", endpoint_url="https://openrouter.ai/api/v1")
    assert chat_routes._recover_empty_session_model(sess, "sV", owner=None) is False
    assert sess.model == "deepseek/deepseek-v4-pro"

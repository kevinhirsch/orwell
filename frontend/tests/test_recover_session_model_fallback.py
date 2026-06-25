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


def test_probed_endpoint_substituting_served_model_warns(monkeypatch, caplog):
    # P3: when the endpoint IS probed and the configured default is NOT served, bind a served chat
    # model (existing behavior) AND emit a "bound model not in endpoint served list" WARNING so the
    # next reproduction of "no real completions" points straight here.
    _seed("ep1", ["anthropic/claude-x", "meta/llama-y"])
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="", endpoint_url="")
    with caplog.at_level("WARNING"):
        assert chat_routes._recover_empty_session_model(sess, "sW", owner=None) is True
    assert sess.model != "deepseek/deepseek-v4-pro"
    assert any("not in endpoint served list" in r.getMessage() for r in caplog.records)


def test_probed_endpoint_no_chat_model_refuses_unserved_default(monkeypatch, caplog):
    # P3 (the footgun): a PROBED endpoint that serves the configured default NOWHERE and offers no
    # usable chat model substitute must NOT bind the unserved id (that dispatches every turn to a
    # model the endpoint rejects → 200-empty / blank turn). Refuse + WARN instead.
    _seed("ep1", ["openai/gpt-image-1", "google/gemini-flash-image"])  # only image models served
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="", endpoint_url="")
    with caplog.at_level("WARNING"):
        result = chat_routes._recover_empty_session_model(sess, "sNoServe", owner=None)
    assert result is False                       # refused to bind the unserved default
    assert sess.model != "deepseek/deepseek-v4-pro"
    assert any("not in endpoint served list" in r.getMessage() for r in caplog.records)


def test_unprobed_endpoint_binds_default_but_warns_unverified(monkeypatch, caplog):
    # P3: a genuinely UNPROBED endpoint (no cached_models) keeps the current behavior — trust the
    # configured default — but logs a WARNING that the binding is unverified (cannot confirm served).
    _seed("ep1", [])  # no probed model list
    monkeypatch.setattr(chat_routes, "_default_chat_target", lambda owner: ("ep1", "deepseek/deepseek-v4-pro"))
    sess = _Sess(model="", endpoint_url="")
    with caplog.at_level("WARNING"):
        assert chat_routes._recover_empty_session_model(sess, "sUnprobed", owner=None) is True
    assert sess.model == "deepseek/deepseek-v4-pro"
    assert any("UNVERIFIED" in r.getMessage() for r in caplog.records)

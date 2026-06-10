"""B67 — engine auth end-to-end (ops A1 + A2 + sec B3).

The engine ENFORCES ORWELL_ENGINE_TOKEN but the front-end had no code path to send it — the
documented auth-on config 401'd every call. And under multi-user, the FE's hardcoded
`X-Orwell-User: default` silently collapsed anonymous sessions into one shared sandbox.
"""

import importlib

orwell_engine = importlib.import_module("src.orwell_engine")


def test_token_attached_when_configured(monkeypatch):
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "s3cret")
    h = orwell_engine._user_headers("alice")
    assert h["Authorization"] == "Bearer s3cret"
    assert h["X-Orwell-User"] == "alice"


def test_legacy_token_var_still_works(monkeypatch):
    monkeypatch.delenv("ORWELL_ENGINE_TOKEN", raising=False)
    monkeypatch.setenv("BBAI_ENGINE_TOKEN", "legacy")
    assert orwell_engine._user_headers(None).get("Authorization") == "Bearer legacy"


def test_no_token_no_auth_header(monkeypatch):
    monkeypatch.delenv("ORWELL_ENGINE_TOKEN", raising=False)
    monkeypatch.delenv("BBAI_ENGINE_TOKEN", raising=False)
    assert "Authorization" not in orwell_engine._user_headers("alice")


def test_anonymous_caller_sends_no_user_header(monkeypatch):
    # ops A2: no authenticated owner => NO user header. A single-tenant engine defaults it
    # server-side (unchanged); a multi-user engine refuses it (400) instead of collapsing
    # every anonymous session into one shared "default" sandbox.
    monkeypatch.delenv("ORWELL_ENGINE_TOKEN", raising=False)
    monkeypatch.delenv("BBAI_ENGINE_TOKEN", raising=False)
    assert "X-Orwell-User" not in orwell_engine._user_headers(None)
    assert orwell_engine._user_headers("bob")["X-Orwell-User"] == "bob"


def test_installer_generates_the_token_by_default():
    src = open("../deploy/orwell-install.sh", encoding="utf-8").read()
    assert "ORWELL_ENGINE_TOKEN=$(openssl rand -hex 32" in src

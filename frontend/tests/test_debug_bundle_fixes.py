"""Targeted gates for the 2026-06-23 debug-bundle fixes.

Covers:
  • #581 — the session TTL is tightened (24h default) and ORWELL_SESSION_TTL_HOURS-configurable.
  • #546 — _resolve_llm_fn refuses an image-only model for JSON authoring (fail-soft).
  • #559 — the gateway-wide webhook secret is fail-closed when configured.
  • #560 — the gateway turn path is rate-limited and honors the per-user daily cap.

Roles only; no houseguest/player names.
"""

import importlib

import pytest


# ── #581: session TTL ─────────────────────────────────────────────────────────

def test_session_ttl_defaults_to_24h(monkeypatch):
    monkeypatch.delenv("ORWELL_SESSION_TTL_HOURS", raising=False)
    auth = importlib.reload(importlib.import_module("core.auth"))
    assert auth._token_ttl_seconds() == 24 * 60 * 60
    # Default is well below the old 7-day window.
    assert auth._token_ttl_seconds() < 7 * 24 * 60 * 60


def test_session_ttl_is_configurable(monkeypatch):
    monkeypatch.setenv("ORWELL_SESSION_TTL_HOURS", "48")
    auth = importlib.reload(importlib.import_module("core.auth"))
    assert auth._token_ttl_seconds() == 48 * 60 * 60


def test_session_ttl_clamps_garbage_to_default(monkeypatch):
    auth = importlib.import_module("core.auth")
    for bad in ("not-a-number", "0", "100000"):  # below 1h / above 30d / non-numeric
        monkeypatch.setenv("ORWELL_SESSION_TTL_HOURS", bad)
        assert auth._token_ttl_seconds() == 24 * 60 * 60


# ── #546: image-only utility model guard ──────────────────────────────────────

def test_resolve_llm_fn_skips_image_only_model(monkeypatch):
    cast = importlib.import_module("src.orwell_cast_authoring")
    resolver = importlib.import_module("src.endpoint_resolver")

    # The only resolvable utility model is an image model.
    monkeypatch.setattr(resolver, "resolve_endpoint",
                        lambda kind, owner=None: ("http://x/v1", "flux-1.1-pro", {}))
    monkeypatch.setattr(resolver, "resolve_utility_fallback_candidates",
                        lambda owner=None: [])

    import asyncio
    fn = asyncio.get_event_loop().run_until_complete(cast._resolve_llm_fn("u"))
    # Fail-soft: no text/chat model ⇒ None ⇒ the engine deterministic floor stands.
    assert fn is None


def test_resolve_llm_fn_keeps_text_model(monkeypatch):
    cast = importlib.import_module("src.orwell_cast_authoring")
    resolver = importlib.import_module("src.endpoint_resolver")
    monkeypatch.setattr(resolver, "resolve_endpoint",
                        lambda kind, owner=None: ("http://x/v1", "some-chat-model-v4", {}))
    monkeypatch.setattr(resolver, "resolve_utility_fallback_candidates",
                        lambda owner=None: [])

    import asyncio
    fn = asyncio.get_event_loop().run_until_complete(cast._resolve_llm_fn("u"))
    assert callable(fn)


# ── #559: gateway-wide webhook secret (fail-closed when configured) ───────────

def test_gateway_secret_dormant_when_unset(monkeypatch):
    gr = importlib.import_module("routes.gateway_routes")
    monkeypatch.delenv("ORWELL_GATEWAY_WEBHOOK_SECRET", raising=False)
    assert gr._gateway_secret_ok({}) is True  # no secret ⇒ unchanged


def test_gateway_secret_required_when_configured(monkeypatch):
    gr = importlib.import_module("routes.gateway_routes")
    monkeypatch.setenv("ORWELL_GATEWAY_WEBHOOK_SECRET", "s3cr3t")
    # Missing header ⇒ reject (fail-closed).
    assert gr._gateway_secret_ok({}) is False
    # Wrong header ⇒ reject.
    assert gr._gateway_secret_ok({"X-Orwell-Gateway-Secret": "nope"}) is False
    # Correct header ⇒ allow.
    assert gr._gateway_secret_ok({"X-Orwell-Gateway-Secret": "s3cr3t"}) is True


# ── #560: gateway turn-path rate limit + per-user daily cap ───────────────────

def test_gateway_rate_limit_trips_after_max(monkeypatch):
    tl = importlib.import_module("gateway.turn_limits")
    tl.reset_for_tests()
    monkeypatch.setattr(tl, "RATE_MAX", 3)
    monkeypatch.setattr(tl, "RATE_WINDOW_S", 60.0)
    ident = "telegram:rate-test"
    assert [tl.is_rate_limited(ident) for _ in range(3)] == [False, False, False]
    assert tl.is_rate_limited(ident) is True  # the 4th in-window turn is limited
    tl.reset_for_tests()


def test_gateway_daily_cap_honors_privilege(monkeypatch):
    tl = importlib.import_module("gateway.turn_limits")
    tl.reset_for_tests()

    class _Auth:
        def __init__(self, cap):
            self._cap = cap

        def get_privileges(self, user):
            return {"max_messages_per_day": self._cap}

    # cap of 2: first two allowed, the third is capped.
    auth = _Auth(2)
    assert tl.daily_cap_exceeded("u", auth) is False
    assert tl.daily_cap_exceeded("u", auth) is False
    assert tl.daily_cap_exceeded("u", auth) is True
    tl.reset_for_tests()


def test_gateway_daily_cap_zero_is_uncapped(monkeypatch):
    tl = importlib.import_module("gateway.turn_limits")
    tl.reset_for_tests()

    class _Auth:
        def get_privileges(self, user):
            return {"max_messages_per_day": 0}

    auth = _Auth()
    assert all(tl.daily_cap_exceeded("admin", auth) is False for _ in range(50))
    tl.reset_for_tests()


def test_gateway_daily_cap_fail_open_without_auth():
    tl = importlib.import_module("gateway.turn_limits")
    assert tl.daily_cap_exceeded("u", None) is False
    assert tl.daily_cap_exceeded("", object()) is False

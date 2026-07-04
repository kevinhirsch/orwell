"""Targeted gates for the 2026-06-23 debug-bundle fixes.

Covers:
  • #581 — the session TTL is tightened (24h default) and ORWELL_SESSION_TTL_HOURS-configurable.
  • #546 — _resolve_llm_fn refuses an image-only model for JSON authoring (fail-soft).
  • #559 — the gateway-wide webhook secret is fail-closed when configured.
  • #560 — the gateway turn path is rate-limited and honors the per-user daily cap.
  • Producer's Vault opt-in (mandate #2) — the debug bundle is Vault-free BY DEFAULT and
    includes the live Producer's Vault ONLY behind the explicit ?vault=1 admin opt-in.

Roles only; no houseguest/player names.
"""

import importlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


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


# ── Producer's Vault opt-in in the debug bundle (mandate #2) ──────────────────
#
# THE GATE (the Vault Wall, opt-in form): the downloadable debug bundle stays
# Vault-free BY DEFAULT (byte-identically, as before this change) and may include
# the live Producer's Vault ONLY behind the explicit ?vault=1 admin opt-in. The
# opt-in must be admin-only and unreachable on any non-admin/player path. We plant
# a recognizable Vault sentinel into the sanctioned producerVault unseal and prove:
#   1. the DEFAULT bundle (no param) has NO Vault content (no section, sentinel absent);
#   2. the ?vault=1 bundle (admin) DOES carry the Vault section (sentinel present);
#   3. a non-admin cannot obtain the vault bundle (the admin gate holds, no leak).

ahr = importlib.import_module("routes.admin_health_routes")
orwell_engine = importlib.import_module("src.orwell_engine")

# A recognizable off-screen secret — the kind of content that lives ONLY in the Vault.
_VAULT_SENTINEL = "OFFSCREEN-VAULT-SENTINEL-do-not-leak"

# SEC-4: the Vault-reveal path now requires a GENUINE admin channel, not the AUTH_ENABLED=false
# bypass. In these unit apps (no auth middleware / no admin session) the loopback internal-tool
# token is the legitimate authenticated-admin stand-in, so the tests below exercise the REAL
# reveal path through it. Any request WITHOUT it under auth-off must be refused (the closed hole).
from core.middleware import INTERNAL_TOOL_HEADER, INTERNAL_TOOL_TOKEN
_ADMIN_HDRS = {INTERNAL_TOOL_HEADER: INTERNAL_TOOL_TOKEN}


def _vault_app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


@pytest.fixture
def quiet_bundle(monkeypatch):
    """Make the bundle assemble cheaply + deterministically without a live engine,
    AND plant the Vault sentinel into the sanctioned producerVault unseal."""
    async def fake_snapshot(user):
        return {"generatedAt": "2026-06-25T00:00:00+00:00", "engine": {"ok": True}}

    async def fake_extras(user):
        return {}

    async def fake_producer_vault(user=None):
        # The shape the status-page renderer expects, carrying the sentinel as hidden content.
        return {"winner": None,
                "hiddenStory": [{"type": "scheme", "content": _VAULT_SENTINEL}],
                "twists": [], "evictionVotes": []}

    monkeypatch.setattr(ahr, "_health_snapshot", fake_snapshot)
    monkeypatch.setattr(ahr, "_bundle_extras", fake_extras)
    monkeypatch.setattr(orwell_engine, "producer_vault", fake_producer_vault)


def test_debug_bundle_default_is_vault_free(monkeypatch, quiet_bundle):
    # (1) DEFAULT bundle (no param) — Vault-free: no section, sentinel absent.
    monkeypatch.setenv("AUTH_ENABLED", "false")  # admin posture (gate bypassed)
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 200
    assert _VAULT_SENTINEL not in r.text, "the Vault leaked into the DEFAULT bundle"
    bundle = json.loads(r.content)
    assert "producerVault" not in bundle
    assert "_SPOILERS" not in bundle


def test_debug_bundle_vault_optin_includes_the_vault(monkeypatch, quiet_bundle):
    # (2) ?vault=1 (authenticated admin) — the Vault section is present, sentinel included, marked.
    # SEC-4: the reveal now requires a genuine admin channel even under auth-off; the loopback
    # internal-tool token is the authenticated-admin stand-in in this middleware-less unit app.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle?vault=1", headers=_ADMIN_HDRS)
    assert r.status_code == 200
    assert _VAULT_SENTINEL in r.text, "the opt-in bundle must carry the unsealed Vault"
    bundle = json.loads(r.content)
    assert "producerVault" in bundle
    # the section is clearly labelled as spoiler content
    assert "_SPOILERS" in bundle and "Producer's Vault" in bundle["_SPOILERS"]
    # the sentinel rides inside the producerVault section specifically
    assert _VAULT_SENTINEL in json.dumps(bundle["producerVault"])


def test_debug_bundle_vault_optin_alias(monkeypatch, quiet_bundle):
    # The documented alias ?include_vault=1 behaves identically to ?vault=1.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle?include_vault=1", headers=_ADMIN_HDRS)
    assert r.status_code == 200
    bundle = json.loads(r.content)
    assert "producerVault" in bundle and _VAULT_SENTINEL in r.text


def test_debug_bundle_vault_optin_is_admin_gated(monkeypatch, quiet_bundle):
    # (3) A non-admin cannot obtain the vault bundle — the admin gate holds, nothing leaks.
    monkeypatch.setenv("AUTH_ENABLED", "true")  # default posture, no admin session
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle?vault=1")
    assert r.status_code == 403
    assert _VAULT_SENTINEL not in r.text  # refused BEFORE any Vault content is assembled


def test_debug_bundle_vault_optin_zero_auth_refused_under_auth_off(monkeypatch, quiet_bundle):
    # SEC-4 (the closed hole): AUTH_ENABLED=false must NOT let an UNAUTHENTICATED caller dump the
    # Vault via ?vault=1. Before the fix this returned 200 with the sentinel (a mandate #2 breach
    # on any network-exposed auth-off box). The Vault reveal must be an authenticated admin channel
    # regardless of AUTH_ENABLED, so with no admin credential it is refused — nothing leaks.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle?vault=1")  # NO admin/loopback credential
    assert r.status_code == 403
    assert _VAULT_SENTINEL not in r.text  # refused BEFORE any Vault content is assembled
    # The default (Vault-free) bundle is UNCHANGED under auth-off — it still assembles at 200.
    r2 = client.get("/api/admin/debug-bundle")
    assert r2.status_code == 200
    assert _VAULT_SENTINEL not in r2.text


def test_ops_producer_vault_zero_auth_refused_under_auth_off(monkeypatch, quiet_bundle):
    # SEC-4: the sibling status-page "Unseal" endpoint gets the SAME strict gate.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.post("/api/admin/ops/producer-vault")  # unauthenticated
    assert r.status_code == 403
    assert _VAULT_SENTINEL not in r.text
    # With the loopback admin credential the legitimate reveal still works.
    r2 = client.post("/api/admin/ops/producer-vault", headers=_ADMIN_HDRS)
    assert r2.status_code == 200
    assert _VAULT_SENTINEL in r2.text


def test_debug_bundle_vault_optin_fail_soft(monkeypatch):
    # The opt-in is fail-soft like the rest of the bundle: a broken unseal degrades to an
    # {"error": ...} section, never a 500 — the bundle still assembles and downloads.
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def fake_snapshot(user):
        return {"generatedAt": "2026-06-25T00:00:00+00:00", "engine": {"ok": True}}

    async def fake_extras(user):
        return {}

    async def boom(user=None):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(ahr, "_health_snapshot", fake_snapshot)
    monkeypatch.setattr(ahr, "_bundle_extras", fake_extras)
    monkeypatch.setattr(orwell_engine, "producer_vault", boom)

    client = TestClient(_vault_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle?vault=1", headers=_ADMIN_HDRS)
    assert r.status_code == 200  # never a 500 — the bundle is the operator's last resort
    bundle = json.loads(r.content)
    assert "error" in bundle["producerVault"]


def test_status_page_has_separate_spoiler_bundle_affordance(monkeypatch):
    # The fallback status page exposes a SEPARATE, explicitly-labelled spoiler download
    # (hitting ?vault=1) alongside the plain Vault-free bundle link.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_vault_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert 'href="/api/admin/debug-bundle" download' in body  # the plain link stays Vault-free
    assert 'id="bundle-vault"' in body                        # the separate spoiler control
    assert "/api/admin/debug-bundle?vault=1" in body          # which hits the opt-in
    assert "SPOILERS" in body


def test_admin_health_card_has_separate_spoiler_bundle_affordance():
    # The Settings Health & Logs card carries the SAME separate spoiler control in index.html,
    # wired through a confirm in admin.js. The plain download link stays Vault-free.
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html = open(os.path.join(base, "static", "index.html"), encoding="utf-8").read()
    js = open(os.path.join(base, "static", "js", "admin.js"), encoding="utf-8").read()
    assert 'id="adm-health-bundle"' in html and "/api/admin/debug-bundle" in html
    assert 'id="adm-health-bundle-vault"' in html and "SPOILERS" in html
    assert "adm-health-bundle-vault" in js
    assert "/api/admin/debug-bundle?vault=1" in js

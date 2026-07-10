"""WebSocket Phase-1 — the CSWSH (Cross-Site WebSocket Hijacking) Origin guard (protocol spec §1.1).

A browser attaches the session cookie to a CROSS-SITE WS upgrade automatically, and the HTTP
CORS / TrustedHost middleware does NOT cover a WebSocket handshake — so cookie auth alone cannot stop
a malicious page from opening an authenticated socket to a victim's session. Spec §1.1 REQUIRES an
``Origin`` allowlist enforced BEFORE any ``hello``/``bind``/frame is processed: a foreign-origin
upgrade is refused at accept time (policy-violation close, no ack), while same-origin browser clients
and non-browser/native/test paths (no ``Origin`` header) connect unchanged. This sits ALONGSIDE the
cookie auth (``_ws_current_user``) + owner guard (``_ws_owns``), never in place of them.

Mirrors greptile's repro: a foreign ``Origin`` with a valid session cookie → REJECTED (no accept, no
frames). Roles only; no names.
"""
import asyncio
import importlib

import pytest

from tests.support import ws_harness as H

ws_routes = importlib.import_module("routes.ws_routes")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    H.reset_runs()
    yield
    H.reset_runs()


def _set_engine(monkeypatch, started: bool, beat_seq: int = 3):
    async def _state(user):
        return {"started": started, "beatSeq": beat_seq}
    monkeypatch.setattr(ws_routes, "_engine_state", _state)


# ── the repro: a foreign Origin + a valid cookie is REJECTED before any frame processing ───────────

def test_foreign_origin_with_valid_cookie_is_rejected(run, monkeypatch):
    """The CSWSH attack: a malicious page (evil.example) opens a WS to the victim's server; the browser
    auto-attaches the victim's session cookie. Even though the socket WOULD authenticate, the foreign
    Origin is refused at accept time — no accept, no ack, not one frame processed."""
    monkeypatch.setenv("AUTH_ENABLED", "false")   # the socket would otherwise authenticate as default
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(
            cookies={"session_token": "a-valid-victim-cookie"},
            headers={"origin": "https://evil.example", "host": "victim.example"},
        )
        t = H.spawn(ws)
        # A hello the attacker would send — it must NEVER be processed (the guard closed first).
        ws.client_send({"t": "hello", "cid": "c_00", "d": {"perTabId": "victim-tab"}})
        await asyncio.wait_for(t, timeout=1.0)   # the handler returns immediately after the refusal
        assert ws.accepted is False              # never accepted the upgrade
        assert ws.closed is True                 # policy-violation close
        assert ws.sent == []                     # no ack, no error, no frame — nothing emitted
        # and no canonical binding leaked for the attacker
        assert ogs.get_game_session(None) is None
        await H.aclose_runs()

    run(main())


def test_foreign_origin_opaque_null_is_rejected(run, monkeypatch):
    """A sandboxed/foreign context sends ``Origin: null`` (opaque) — also refused."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "null", "host": "victim.example"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


# ── same-origin browser client (matching Origin) is ACCEPTED — the legitimate path is preserved ────

def test_same_origin_is_accepted(run, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        # The real client connects to ``location.host`` (same-origin): Origin authority == Host.
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_same_origin_with_explicit_default_port_is_accepted(run, monkeypatch):
    """An Origin carrying the scheme's default port (``:443``) still matches a bare Host (defensive
    normalization) — legitimate same-origin, accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://my-house.example:443", "host": "my-house.example"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        await H.stop(ws, t)

    run(main())


def test_lan_same_origin_with_port_is_accepted(run, monkeypatch):
    """LAN/dev exposure (feature 0074): the browser hits ``http://<lan-ip>:7000`` — Origin host:port
    equals Host, so it is same-origin and accepted with NO configured domain (no hard-coding)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://192.168.1.50:7000", "host": "192.168.1.50:7000"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        await H.stop(ws, t)

    run(main())


# ── absent Origin (non-browser / native / test) is ACCEPTED per spec §1.1 ──────────────────────────

def test_absent_origin_is_accepted(run, monkeypatch):
    """A non-browser client (native app, server-side, TestClient) sends no Origin AND does not
    auto-attach a victim cookie — so the CSWSH attack surface never presents here. Spec §1.1: allow."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws()   # no headers at all → the absent-Origin non-browser path
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        await H.stop(ws, t)

    run(main())


# ── a foreign Origin that is EXPLICITLY allowlisted (ALLOWED_ORIGINS) is ACCEPTED ──────────────────

def test_cross_origin_in_allowlist_is_accepted(run, monkeypatch):
    """A cross-origin upgrade whose Origin is in the app's ``ALLOWED_ORIGINS`` (the same origins the
    credentialed CORS layer trusts) is accepted — the guard reuses the app's existing origin model,
    not a new ad-hoc one."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example, https://trusted.example")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        # Origin differs from Host but is on the allowlist.
        ws = H.new_ws(headers={"origin": "https://trusted.example", "host": "backend.example"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        await H.stop(ws, t)

    run(main())


def test_foreign_origin_not_in_allowlist_is_rejected(run, monkeypatch):
    """With an allowlist configured, an Origin NOT on it (and not same-origin) is still refused."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://evil.example", "host": "app.example"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


# ── unit-level checks of the origin helpers ────────────────────────────────────────────────────────

def test_origin_helpers_unit(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert ws_routes._origin_netloc("https://a.example") == "a.example"
    assert ws_routes._origin_netloc("https://a.example:443") == "a.example"
    assert ws_routes._origin_netloc("http://a.example:80") == "a.example"
    assert ws_routes._origin_netloc("http://a.example:7000") == "a.example:7000"
    assert ws_routes._origin_netloc("null") is None
    assert ws_routes._origin_netloc("") is None

    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, *, https://b.example:8443")
    allowed = ws_routes._allowed_ws_origins()
    assert "https://a.example" in allowed
    assert "https://b.example:8443" in allowed
    assert "*" not in allowed

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
        assert ws.close_code == 1008             # the guard contract's close code
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
        assert ws.close_code == 1008
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
        # A TLS terminator (ADR 0074) sets X-Forwarded-Proto=https for the wss browser hop.
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example",
                               "x-forwarded-proto": "https"})
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
        ws = H.new_ws(headers={"origin": "https://my-house.example:443", "host": "my-house.example",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        await H.stop(ws, t)

    run(main())


def test_same_origin_host_carries_default_port_is_accepted(run, monkeypatch):
    """greptile P1 repro: a proxy/edge terminator sets an explicit ``Host: host:443`` while the browser
    sends a bare ``Origin: https://host`` (no default port). The request Host authority is normalized
    the same way as the Origin, so this is SAME-ORIGIN and accepted (not rejected before accept)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example:443",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_same_origin_http_host_carries_default_port_is_accepted(run, monkeypatch):
    """The ws/80 analog: ``Host: host:80`` + bare ``Origin: http://host`` is same-origin, accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://my-house.example", "host": "my-house.example:80"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
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


# ── IPv6-literal same-origin is ACCEPTED (urlsplit strips brackets — the T-Rex repro) ─────────────

def test_ipv6_same_origin_with_port_is_accepted(run, monkeypatch):
    """IPv6 LAN/local-HTTPS exposure (ADR 0074): ``Origin http://[::1]:7000`` + ``Host [::1]:7000`` is
    same-origin. urlsplit strips the brackets off the Origin host, so the authority must be rebuilt
    bracketed to match the Host — else this legitimate client is falsely rejected before accept."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://[::1]:7000", "host": "[::1]:7000"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_ipv6_same_origin_default_port_host_is_accepted(run, monkeypatch):
    """``Origin https://[::1]`` (bare, default 443) + a proxy-set ``Host [::1]:443`` is same-origin:
    the Origin normalizes to ``[::1]`` and the Host default port is stripped to ``[::1]`` — accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://[::1]", "host": "[::1]:443",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


# ── scheme leg: same-host WRONG-scheme rejected; each terminator/direct scheme path accepted ───────

def test_same_host_wrong_scheme_is_rejected(run, monkeypatch):
    """greptile P1 (scheme): a web origin is scheme+host+port. With XFP=https (a TLS deploy), a
    same-HOST but plaintext ``Origin: http://host`` is a DIFFERENT origin — refused (close 1008), so a
    same-host-plaintext page stays outside the CSWSH trust boundary."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://my-house.example", "host": "my-house.example",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.close_code == 1008
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


def test_xfp_https_https_origin_is_accepted(run, monkeypatch):
    """TLS terminator (ADR 0074): XFP=https + a matching ``https://host`` same-origin → accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_direct_uvicorn_ws_http_origin_is_accepted(run, monkeypatch):
    """Direct-uvicorn LAN plaintext: no XFP, request scheme ``ws`` → expected ``http``; a matching
    ``http://host`` same-origin → accepted (the ws→http mapping path)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://my-house.example", "host": "my-house.example"},
                      scheme="ws")
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_wss_request_no_xfp_https_origin_is_accepted(run, monkeypatch):
    """Direct TLS uvicorn (no terminator, no XFP): request scheme ``wss`` → expected ``https``; a
    matching ``https://host`` same-origin → accepted (the wss→https mapping path)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example"},
                      scheme="wss")
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_direct_uvicorn_ws_https_origin_is_rejected(run, monkeypatch):
    """Direct-uvicorn plaintext (ws, no XFP) but the Origin claims ``https://host`` — scheme mismatch
    (expected ``http``), refused. The scheme leg is enforced whenever the external scheme is known."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://my-house.example", "host": "my-house.example"},
                      scheme="ws")
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.close_code == 1008
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


def test_foreign_ipv6_origin_is_rejected(run, monkeypatch):
    """A foreign IPv6 Origin against a DIFFERENT Host is still refused (the fix must not weaken the
    foreign-origin rejection)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://[fe80::dead:beef]:7000", "host": "[::1]:7000"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.close_code == 1008
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


# ── scheme-aware Host port normalization: only the expected scheme's default port is stripped ──────

def test_https_host_port80_wrong_default_port_is_rejected(run, monkeypatch):
    """greptile P1 (port×scheme consistency): under XFP=https, ``Host: victim:80`` must NOT collapse to
    ``victim`` and match ``https://victim`` — ``https://victim:80`` ≠ ``https://victim`` (the port is
    part of the origin). Only the EXPECTED scheme's default port (``:443``) is bare-host-equivalent, so
    a ``:80`` under https is a real port mismatch → refused (close 1008)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://victim.example", "host": "victim.example:80",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.close_code == 1008
        assert ws.sent == []
        await H.aclose_runs()

    run(main())


def test_https_host_port443_default_is_accepted(run, monkeypatch):
    """Under XFP=https, ``Host: victim:443`` normalizes to ``victim`` and matches ``https://victim`` —
    the expected scheme's own default port IS bare-host-equivalent → accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://victim.example", "host": "victim.example:443",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_http_host_port80_default_is_accepted(run, monkeypatch):
    """Direct-uvicorn / http deploy: ``Host: victim:80`` + ``Origin http://victim`` — the expected
    scheme's default port (``:80``) IS stripped → same-origin, accepted."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "http://victim.example", "host": "victim.example:80"},
                      scheme="ws")
        t = H.spawn(ws)
        ack = await H.hello(ws, "per-tab-1")
        assert ack["t"] == "ack"
        assert ws.accepted is True
        await H.stop(ws, t)

    run(main())


def test_ipv6_https_host_port80_not_stripped_is_rejected(run, monkeypatch):
    """IPv6 consistency: under https, ``Host [::1]:80`` is NOT collapsed (only ``:443`` is), so it does
    not match ``https://[::1]`` (netloc ``[::1]``) → refused. Bracket-safety preserved."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _set_engine(monkeypatch, started=True)
    monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)

    async def main():
        ws = H.new_ws(headers={"origin": "https://[::1]", "host": "[::1]:80",
                               "x-forwarded-proto": "https"})
        t = H.spawn(ws)
        await asyncio.wait_for(t, timeout=1.0)
        assert ws.accepted is False
        assert ws.closed is True
        assert ws.close_code == 1008
        assert ws.sent == []
        await H.aclose_runs()

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
        assert ws.close_code == 1008
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
    # IPv6 literals — urlsplit strips the brackets; the authority must be rebuilt bracketed.
    assert ws_routes._origin_netloc("http://[::1]:7000") == "[::1]:7000"
    assert ws_routes._origin_netloc("https://[::1]") == "[::1]"
    assert ws_routes._origin_netloc("http://[::1]:80") == "[::1]"
    assert ws_routes._origin_netloc("http://[fe80::1]") == "[fe80::1]"
    assert ws_routes._origin_netloc("null") is None
    assert ws_routes._origin_netloc("") is None

    # _host_authority is SCHEME-AWARE: it strips ONLY the expected scheme's default port.
    #  * indeterminate scheme ("" — the caller also skips the scheme leg) → best-effort strip either.
    assert ws_routes._host_authority("a.example:443") == "a.example"
    assert ws_routes._host_authority("a.example:80") == "a.example"
    assert ws_routes._host_authority("A.Example:7000") == "a.example:7000"
    assert ws_routes._host_authority("a.example") == "a.example"
    assert ws_routes._host_authority("") == ""
    #  * expected https/wss → strip ONLY :443; a :80 stays (port mismatch under https).
    assert ws_routes._host_authority("a.example:443", "https") == "a.example"
    assert ws_routes._host_authority("a.example:80", "https") == "a.example:80"
    assert ws_routes._host_authority("a.example:443", "wss") == "a.example"
    #  * expected http/ws → strip ONLY :80; a :443 stays.
    assert ws_routes._host_authority("a.example:80", "http") == "a.example"
    assert ws_routes._host_authority("a.example:443", "http") == "a.example:443"
    assert ws_routes._host_authority("a.example:80", "ws") == "a.example"
    # IPv6 Host authority — bracket-safe + scheme-aware.
    assert ws_routes._host_authority("[::1]:443") == "[::1]"          # indeterminate best-effort
    assert ws_routes._host_authority("[::1]:80") == "[::1]"           # indeterminate best-effort
    assert ws_routes._host_authority("[::1]:443", "https") == "[::1]"
    assert ws_routes._host_authority("[::1]:80", "https") == "[::1]:80"   # NOT stripped under https
    assert ws_routes._host_authority("[::1]") == "[::1]"
    assert ws_routes._host_authority("[::443]", "https") == "[::443]"    # literal, not a port

    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example, *, https://b.example:8443")
    allowed = ws_routes._allowed_ws_origins()
    assert "https://a.example" in allowed
    assert "https://b.example:8443" in allowed
    assert "*" not in allowed


def test_expected_external_scheme_unit():
    from types import SimpleNamespace

    class _FW:
        def __init__(self, headers=None, scheme="ws"):
            self.headers = {k.lower(): v for k, v in (headers or {}).items()}
            self.url = SimpleNamespace(scheme=scheme)

    # XFP wins over the request scheme, first value only, lowercased.
    assert ws_routes._expected_external_scheme(_FW(headers={"x-forwarded-proto": "https"}, scheme="ws")) == "https"
    assert ws_routes._expected_external_scheme(_FW(headers={"x-forwarded-proto": "HTTPS, http"})) == "https"
    # No XFP → map the request scheme: ws→http, wss→https.
    assert ws_routes._expected_external_scheme(_FW(scheme="ws")) == "http"
    assert ws_routes._expected_external_scheme(_FW(scheme="wss")) == "https"
    # Already http/https passes through; unknown → "" (scheme leg then skipped by the caller).
    assert ws_routes._expected_external_scheme(_FW(scheme="https")) == "https"
    assert ws_routes._expected_external_scheme(_FW(scheme="")) == ""

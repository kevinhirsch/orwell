"""SEC-5 — the admin/God-Mode channel must NOT collapse onto the player token.

Per CLAUDE.md / audit E27: ORWELL_ENGINE_ADMIN_TOKEN is a SEPARATE secret for the engine's
/admin/* channel (player ⊉ admin). The engine refuses the player token on /admin/* when the admin
secret is configured (proven engine-side). This FE-side regression proves the client never sends
the PLAYER secret on an admin call when the two are configured distinctly — i.e. a valid player
credential cannot authorize an admin route by riding the same header.

Regression guard for the split (complements test_e27_admin_token.py by asserting the NON-collapse
invariant directly). Roles only; no real names.
"""

import asyncio
import importlib

orwell_engine = importlib.import_module("src.orwell_engine")


def test_player_secret_never_sent_on_admin_channel(monkeypatch):
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "player-secret")
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", "admin-secret")
    player = orwell_engine._user_headers("u", admin=False)["Authorization"]
    admin = orwell_engine._user_headers("u", admin=True)["Authorization"]
    # The two channels carry DISTINCT bearer secrets — no collapse.
    assert player == "Bearer player-secret"
    assert admin == "Bearer admin-secret"
    assert player != admin
    # Critically: the admin call must NOT carry the player secret (that would let a player token
    # authorize God Mode if the engine ever mis-checked).
    assert "player-secret" not in admin


def test_admin_channel_selects_admin_secret_on_the_wire(monkeypatch):
    """Driving `/admin/call` must present the admin secret; `/player/call` the player one — the
    separation is real on the transport, not just in a helper."""
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "player-secret")
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", "admin-secret")
    seen = []

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"result": {}}

    class _FakeClient:
        is_closed = False

        async def post(self, url, json=None, headers=None, timeout=None):
            seen.append((url, (headers or {}).get("Authorization")))
            return _Resp()

    monkeypatch.setattr(orwell_engine, "_shared_client", lambda: _FakeClient())
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(orwell_engine._post_tool("/admin/call", "sandboxHealth", {}, "u"))
        loop.run_until_complete(orwell_engine._post_tool("/player/call", "gameStatus", {}, "u"))
    finally:
        loop.close()

    admin_auth = seen[0][1]
    player_auth = seen[1][1]
    assert admin_auth == "Bearer admin-secret"
    assert player_auth == "Bearer player-secret"
    # The player secret is never presented to the admin channel.
    assert "player-secret" not in (admin_auth or "")


def test_admin_falls_back_to_shared_only_when_no_admin_secret(monkeypatch):
    # Single-token deployments (no separate admin secret) intentionally share one token — but that
    # is an operator choice, not a collapse of two configured secrets.
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "only-secret")
    monkeypatch.delenv("ORWELL_ENGINE_ADMIN_TOKEN", raising=False)
    assert orwell_engine._user_headers("u", admin=True)["Authorization"] == "Bearer only-secret"

"""Audit E27 — the admin/God-Mode channel uses its OWN secret.

One shared bearer used to grant any-user impersonation AND God Mode. The engine now demands
ORWELL_ENGINE_ADMIN_TOKEN on /admin/* when it is set (the player token is refused there, 401 —
proven engine-side in tests/integration/edgeHardening.test.ts); this proves the front-end client
sends the right secret per channel.
"""

import importlib

orwell_engine = importlib.import_module("src.orwell_engine")


def test_admin_calls_carry_the_admin_secret(monkeypatch):
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "player-secret")
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", "admin-secret")
    player = orwell_engine._user_headers("u", admin=False)
    admin = orwell_engine._user_headers("u", admin=True)
    assert player["Authorization"] == "Bearer player-secret"
    assert admin["Authorization"] == "Bearer admin-secret"


def test_admin_falls_back_to_the_shared_token_when_unconfigured(monkeypatch):
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "only-secret")
    monkeypatch.delenv("ORWELL_ENGINE_ADMIN_TOKEN", raising=False)
    assert orwell_engine._user_headers("u", admin=True)["Authorization"] == "Bearer only-secret"


def test_admin_channel_path_selects_the_admin_secret_on_the_wire(monkeypatch):
    """_post_tool('/admin/call', ...) must present the admin secret; '/player/call' the player one."""
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
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(orwell_engine._post_tool("/admin/call", "sandboxHealth", {}, "u"))
        loop.run_until_complete(orwell_engine._post_tool("/player/call", "gameStatus", {}, "u"))
    finally:
        loop.close()
    assert seen[0][1] == "Bearer admin-secret"
    assert seen[1][1] == "Bearer player-secret"

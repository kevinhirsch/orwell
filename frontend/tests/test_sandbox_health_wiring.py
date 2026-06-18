"""`sandboxHealth` (God Mode, 0016) is wired to the front end for parity with its four admin
siblings. The engine exposes it on the ADMIN channel (B58: Vault-free sandbox health — week/phase,
integrity status, recent faults, circuit state), but it was the one admin tool with NO front-end
path (no client method, no schema, dropped by the game build). This locks in the cross-reference fix.

Roles only — tool/capability names are app capabilities, not people, so naming them is fine.
"""
import asyncio
import importlib

orwell_engine = importlib.import_module("src.orwell_engine")
from src.agent_tools import GAME_TOOL_KEEP, TOOL_TAGS
from src.tool_execution import _ADMIN_TOOLS
from src.tool_schemas import FUNCTION_TOOL_SCHEMAS


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _schema_names():
    return {s["function"]["name"] for s in FUNCTION_TOOL_SCHEMAS if s.get("type") == "function"}


def test_sandbox_health_is_listed_and_admin_gated():
    # Listed + handed to the agent under the game build (TOOL_TAGS ∩ KEEP), AND admin-gated.
    assert "sandboxHealth" in TOOL_TAGS
    assert "sandboxHealth" in GAME_TOOL_KEEP
    assert "sandboxHealth" in _ADMIN_TOOLS  # the gate at tool_execution blocks non-admins on this set


def test_sandbox_health_has_an_agent_schema():
    assert "sandboxHealth" in _schema_names()


def test_sandbox_health_client_uses_the_admin_channel(monkeypatch):
    captured = {}

    async def fake_post(path, name, args=None, user=None, timeout=None):
        captured.update(path=path, name=name, user=user)
        return {"week": 1, "phase": "hoh", "lastIntegrity": "ok"}

    monkeypatch.setattr(orwell_engine, "_post_tool", fake_post)
    res = _run(orwell_engine.sandbox_health(user="u-admin"))
    assert captured["path"] == "/admin/call"   # the E27 admin channel — never /player/call
    assert captured["name"] == "sandboxHealth"
    assert captured["user"] == "u-admin"
    assert res["lastIntegrity"] == "ok"

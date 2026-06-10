"""U4 chunk 1 — transcript surface: E65 (gamechanged dispatcher + fresh session),
E93 (the played record is not editable), D3/E66 (pending survives reload)."""
import importlib
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
JS = FE / "static" / "js"
CHAT = (JS / "chat.js").read_text(encoding="utf-8")
RENDERER = (JS / "chatRenderer.js").read_text(encoding="utf-8")
DECISION = (JS / "orwellDecision.js").read_text(encoding="utf-8")
ONBOARD = (JS / "orwellOnboarding.js").read_text(encoding="utf-8")
STATUSP = (JS / "orwellStatusPanel.js").read_text(encoding="utf-8")
ROUTES = (FE / "routes" / "orwell_routes.py").read_text(encoding="utf-8")
TOOLS = (FE / "src" / "tool_implementations.py").read_text(encoding="utf-8")


# ── E65: the event finally has a dispatcher ───────────────────────────────────

def test_e65_gamechanged_is_dispatched_from_the_tool_stream():
    assert "new CustomEvent('orwell:gamechanged')" in CHAT
    assert "json.tool === 'createCharacter' || json.tool === 'manageSandbox'" in CHAT


def test_e65_restart_opens_a_fresh_session():
    assert "_orwellFreshSession" in ONBOARD, "the fresh-session seam lives with takeASeat"
    assert "_orwellFreshSession" in CHAT, "createCharacter success must invoke it"
    assert "sessionStorage.removeItem(SEAT_TAKEN_KEY)" in ONBOARD


# ── E93: the played record ────────────────────────────────────────────────────

def test_e93_game_transcript_keeps_only_record_safe_actions():
    assert "_RECORD_SAFE = new Set(['copy', 'fork'])" in RENDERER
    assert "dataset.gameActive === '1'" in RENDERER
    assert "data-game-build" in RENDERER


def test_e93_game_active_flag_is_maintained_by_the_status_poll():
    assert 'dataset.gameActive = "1"' in STATUSP
    assert 'dataset.gameActive = ""' in STATUSP


# ── D3/E66: pending survives a reload ─────────────────────────────────────────

def test_d3_pending_cache_round_trips():
    oe = importlib.import_module("src.orwell_engine")
    oe.remember_pending({"pending": {"kind": "nominations", "options": []}}, user="t")
    assert oe.last_pending(user="t")["kind"] == "nominations"
    oe.remember_pending({"pending": None}, user="t")  # bound ⇒ cleared
    assert oe.last_pending(user="t") is None


def test_d3_every_advanceview_chokepoint_feeds_the_cache():
    assert TOOLS.count("orwell_engine.remember_pending(res") == 2, \
        "do_advance_game AND do_submit_decision must record the pending"
    assert "orwell_engine.remember_pending(res" in ROUTES, "the decision route too"


def test_d3_status_route_serves_the_cached_pending():
    assert 'st["pending"] = orwell_engine.last_pending' in ROUTES
    # The poll must never advance the game (ADR 0003) — the route reads, only.
    assert not re.search(r'def orwell_status.*?advance_game', ROUTES, re.S)


def test_d3_decision_card_rearms_on_boot_and_gamechanged():
    assert "rearmFromStatus" in DECISION
    assert '"orwell:gamechanged", rearmFromStatus' in DECISION.replace("'", '"')


def test_d3_status_route_live(monkeypatch):
    """End-to-end: a cached pending rides the status response."""
    oe = importlib.import_module("src.orwell_engine")
    orwell_routes = importlib.import_module("routes.orwell_routes")

    async def fake_status(user=None):
        return {"week": 2, "phase": "nominations", "hoh": None, "nominees": [], "veto": None}
    monkeypatch.setattr(oe, "game_status", fake_status)
    oe.remember_pending({"pending": {"kind": "nominations", "options": [{"id": "npc:1"}]}}, user=None)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    client = TestClient(app)
    r = client.get("/api/orwell/status")
    assert r.status_code == 200
    body = r.json()
    assert body.get("pending", {}).get("kind") == "nominations"
    oe.remember_pending({"pending": None}, user=None)
    assert client.get("/api/orwell/status").json().get("pending") is None

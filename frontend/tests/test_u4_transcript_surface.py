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


# ── D6/W8: the game build is self-contained (no third-party CDN) ─────────────

def test_d6_game_build_serves_no_jsdelivr():
    import importlib
    from fastapi.testclient import TestClient
    app_mod = importlib.import_module("app")
    client = TestClient(app_mod.app)
    r = client.get("/", headers={"host": "127.0.0.1"})
    # The index may require auth in some configs; only assert when it serves.
    if r.status_code == 200 and "<html" in r.text.lower():
        assert "cdn.jsdelivr.net" not in r.text, "the game build must not reference a CDN (D6/W8)"


# ── E94 (FE half): first-class attach + attachments ride game turns ──────────

def test_e94_composer_paperclip_is_first_class_under_game_build():
    html = (FE / "static" / "index.html").read_text(encoding="utf-8")
    assert 'id="composer-attach-btn"' in html, "the paperclip must live IN the composer row (E94)"
    app_js = (FE / "static" / "app.js").read_text(encoding="utf-8")
    assert "composer-attach-btn" in app_js and "file-input" in app_js, \
        "the paperclip drives the same file-input flow"


def test_e94_game_framing_does_not_strip_attachments(monkeypatch):
    """A game-active turn keeps BOTH the GM framing and the attachment: the
    framing only prepends to the preface; the attachment rides the user
    message's content + metadata untouched."""
    import asyncio
    import importlib
    ch = importlib.import_module("routes.chat_helpers")
    oe = importlib.import_module("src.orwell_engine")

    async def fake_state(user=None, retry=None, timeout=None):
        return {"started": True, "week": 2, "phase": "nominations", "moment": "scene"}

    async def fake_moment(moment, user=None, timeout=None):
        return {"systemPrompt": "GM-FRAMING-SENTINEL: you are the house"}

    monkeypatch.setattr(ch, "_fetch_game_state", fake_state, raising=True)
    monkeypatch.setattr(oe, "get_moment_prompt", fake_moment, raising=False)

    preface = []
    engine_available, game_active, feed_down = asyncio.get_event_loop().run_until_complete(
        ch.apply_game_framing(preface, user="e94"))
    assert game_active is True and feed_down is False
    framed = " ".join(str(p) for p in preface)
    assert "GM-FRAMING-SENTINEL" in framed, "the GM moment prompt frames the turn"

    # The attachment pipeline is independent of the framing: metadata survives.
    pm = ch.PreprocessedMessage(
        enhanced_message="look at this photo from home",
        user_content=[{"type": "text", "text": "look at this photo from home"},
                      {"type": "image_url", "image_url": {"url": "data:image/png;base64,xx"}}],
        text_for_context="look at this photo from home",
        youtube_transcripts=[],
        attachment_meta=[{"name": "home.png", "kind": "image"}],
    )

    class _Sess:
        def __init__(self): self.msgs = []
        def add_message(self, m): self.msgs.append(m)

    class _Handler:
        def update_session_name_if_needed(self, *a, **k): pass

    sess = _Sess()
    ch.add_user_message(sess, _Handler(), pm)
    msg = sess.msgs[0]
    assert msg.metadata == {"attachments": [{"name": "home.png", "kind": "image"}]}
    assert any(isinstance(c, dict) and c.get("type") == "image_url" for c in msg.content), \
        "the image content block rides the game turn"

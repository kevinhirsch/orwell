"""F14 (#1013) — surfacing the eviction goodbye/vote decision card + draining the eviction reveal.

The engine raises a player `goodbye-message` / `eviction-vote` pending at the eviction, and
`advanceGame` correctly NO-OPs on an open player pending. The model, though, narrates "X has been
evicted" with NO mutating tool call — so the chat.js card-dispatch seam (which fires only on an
advanceGame/submitDecision tool RESULT) never fires, and the decision card only ever surfaced via
the slow background poll. The week wedged at `phase:eviction, evicted:null` forever.

This fix is FE error-correction (belt) + guard only — it NEVER resolves the player's decision or
authors an outcome:

  1. a post-turn SURFACE-THE-PENDING belt (src/agent_loop.py) that EMITS the open player pending so
     the card arms immediately (it surfaces the card; it never picks the tone/vote);
  2. an EVICTION-DRAIN allowance on the L39b forced advance so the deterministic NPC reveal beats
     drain UNTIL the engine raises the player pending (then the force no-ops and the belt surfaces it);
  3. a follow-up advanceGame after the goodbye-message POSTs (routes/orwell_routes.py) so the engine
     rolls `goodbye → eviction-result → rollWeek` (submitDecision returns only the goodbye beat).

The route follow-up is driven through a TestClient; the belt + drain are pinned at source level
(every automated gate stubs the LLM, so the generator's live behavior is live-verified, not unit-
tested — see the audit). Tests must FAIL on pre-fix main, PASS after the fix.
"""
import importlib
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
AGENT_SRC = (FE / "src" / "agent_loop.py").read_text(encoding="utf-8")
ROUTES_SRC = (FE / "routes" / "orwell_routes.py").read_text(encoding="utf-8")
CHAT_JS = (FE / "static" / "js" / "chat.js").read_text(encoding="utf-8")
DECISION_JS = (FE / "static" / "js" / "orwellDecision.js").read_text(encoding="utf-8")


def _fresh_engine():
    oe = importlib.import_module("src.orwell_engine")
    oe._LAST_PENDING.clear()
    return oe


# ── (3) the decision-route follow-up advance after a goodbye-message ─────────── #

def test_goodbye_message_triggers_a_follow_up_advance(monkeypatch):
    """A goodbye-message submit returns ONLY the goodbye beat (no roll). The route must then drive
    ONE follow-up advanceGame so the engine delivers `eviction-result → rollWeek`. The card the
    player saw clears and the NEXT week's pending (if any) re-arms — the week never wedges."""
    oe = _fresh_engine()
    orwell_routes = importlib.import_module("routes.orwell_routes")
    calls = {"submit": 0, "advance": 0}

    async def fake_submit(decision, user=None, **_kw):
        calls["submit"] += 1
        # submitDecision returns the goodbye beat and NO new player pending (the roll is owed to advance).
        return {"ok": True, "pending": None}

    async def fake_advance(user=None, **kw):
        calls["advance"] += 1
        # the follow-up advance rolls the result and opens the next week's HOH (no player pending yet).
        return {"ok": True, "pending": None, "phase": "hoh-competition"}

    monkeypatch.setattr(oe, "submit_decision", fake_submit)
    monkeypatch.setattr(oe, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_routes, "_publish_game_updated", lambda *a, **k: None)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    client = TestClient(app)
    r = client.post("/api/orwell/decision", json={"kind": "goodbye-message", "save": "warm"})
    assert r.status_code == 200
    assert calls["submit"] == 1
    assert calls["advance"] == 1, "the goodbye must be followed by exactly one roll advance"


def test_goodbye_message_does_not_advance_when_a_new_player_pending_is_raised(monkeypatch):
    """If the goodbye submit instead surfaces a NEW player pending (e.g. a tie-break the engine now
    needs), the route must NOT advance past it — the player still owes that decision."""
    oe = _fresh_engine()
    orwell_routes = importlib.import_module("routes.orwell_routes")
    calls = {"advance": 0}

    async def fake_submit(decision, user=None, **_kw):
        return {"ok": True, "pending": {"kind": "tie-break", "by": {"id": "player", "name": "P"}}}

    async def fake_advance(user=None, **kw):
        calls["advance"] += 1
        return {"ok": True, "pending": None}

    monkeypatch.setattr(oe, "submit_decision", fake_submit)
    monkeypatch.setattr(oe, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_routes, "_publish_game_updated", lambda *a, **k: None)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    client = TestClient(app)
    r = client.post("/api/orwell/decision", json={"kind": "goodbye-message", "save": "cold"})
    assert r.status_code == 200
    assert calls["advance"] == 0, "a freshly-raised player pending must NOT be advanced past"
    assert oe.last_pending(user=None)["kind"] == "tie-break"


def test_non_goodbye_decisions_do_not_get_the_follow_up_advance(monkeypatch):
    """The follow-up advance is scoped to goodbye-message; a normal nominations submit must NOT
    gain an extra advance (that would skip a beat)."""
    oe = _fresh_engine()
    orwell_routes = importlib.import_module("routes.orwell_routes")
    calls = {"advance": 0}

    async def fake_submit(decision, user=None, **_kw):
        return {"ok": True, "pending": None}

    async def fake_advance(user=None, **kw):
        calls["advance"] += 1
        return {"ok": True}

    monkeypatch.setattr(oe, "submit_decision", fake_submit)
    monkeypatch.setattr(oe, "advance_game", fake_advance)
    monkeypatch.setattr(orwell_routes, "_publish_game_updated", lambda *a, **k: None)

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    client = TestClient(app)
    r = client.post("/api/orwell/decision", json={"kind": "nominations", "choice": ["npc:1", "npc:2"]})
    assert r.status_code == 200
    assert calls["advance"] == 0, "only goodbye-message gets the follow-up roll"


# ── _pending_is_player helper ───────────────────────────────────────────────── #

def test_pending_is_player_recognises_a_real_pending():
    orwell_routes = importlib.import_module("routes.orwell_routes")
    assert orwell_routes._pending_is_player({"kind": "goodbye-message", "by": {"id": "player"}}, None)
    assert orwell_routes._pending_is_player({"kind": "eviction-vote", "by": "player"}, None)
    # No kind / not a dict / None ⇒ not a player gate (fail-closed).
    assert not orwell_routes._pending_is_player({"by": {"id": "player"}}, None)
    assert not orwell_routes._pending_is_player(None, None)
    assert not orwell_routes._pending_is_player({"kind": ""}, None)


# ── (1) the surface-the-pending belt (source-pinned: it surfaces, never resolves) ── #

def test_surface_pending_belt_exists_and_emits_orwell_pending():
    """The belt must, post-turn, read the engine status and EMIT an `orwell_pending` SSE event for
    an open player pending — and it must be gated so it stands down when the model progressed."""
    assert "the SURFACE-THE-PENDING belt" in AGENT_SRC, "the F14 belt must exist"
    idx = AGENT_SRC.find("the SURFACE-THE-PENDING belt")
    window = AGENT_SRC[idx:idx + 2400]
    assert "game_status" in window, "the belt must read the live engine status"
    assert '"type": "orwell_pending"' in window or "'type': 'orwell_pending'" in window, \
        "the belt must emit the orwell_pending stream signal"
    assert "_PROGRESSION_TOOLS" in window, "the belt must stand down when the model already progressed"


def test_surface_pending_belt_never_resolves_the_decision():
    """The belt SURFACES the card only — it must never call submitDecision / pick a tone or vote.
    Scoped to the belt's OWN try/except body (its `_pend_err` handler ends it)."""
    idx = AGENT_SRC.find("the SURFACE-THE-PENDING belt")
    end = AGENT_SRC.find("_pend_err", idx)
    assert end != -1, "the belt's except handler must exist"
    body = AGENT_SRC[idx:end]
    # It may MENTION submitDecision in its comment (explaining the bug), but must never CALL it.
    assert "submit_decision(" not in body, "the belt must NOT resolve the decision"
    assert ".submit_decision" not in body


def test_chat_js_handles_orwell_pending_by_surfacing_the_card():
    """chat.js must translate the new `orwell_pending` SSE event into the existing `orwell:pending`
    DOM event that arms the decision card — and never auto-resolve it."""
    assert "json.type === 'orwell_pending'" in CHAT_JS
    idx = CHAT_JS.find("json.type === 'orwell_pending'")
    window = CHAT_JS[idx:idx + 800]
    assert "orwell:pending" in window, "it must dispatch the card-arming DOM event"


# ── (2) the eviction-drain allowance on the forced advance ──────────────────── #

def test_eviction_drain_allowance_exists():
    """A forced advance must be PERMITTED while phase==eviction with no player pending open yet, so
    the deterministic NPC reveal beats drain until the engine raises the player pending."""
    assert "_want_drain_eviction" in AGENT_SRC, "the eviction-drain term must gate the want-advance"
    assert "_eviction_drain_force" in AGENT_SRC, "the forced advance must have an eviction-drain branch"


def test_eviction_drain_only_when_no_player_pending_open():
    """The drain must read the live pending and force ONLY while no player pending is open — once the
    engine raises the goodbye/vote pending, the drain stops (the belt then surfaces the card)."""
    idx = AGENT_SRC.find("_eviction_drain_force")
    window = AGENT_SRC[idx:idx + 1100]
    assert "game_status" in window, "the drain must read the live pending"
    assert "not (isinstance(_pend_dr, dict)" in window or "_pend_dr" in window, \
        "the drain must gate on the absence of an open player pending"
    # The force gate now also admits the drain (not only the past-rungs level).
    assert re.search(r"_eviction_drain_force\s+or\s+_level\s*>=\s*_ADVANCE_FORCE_LEVEL", AGENT_SRC), \
        "the forced-advance gate must admit the eviction-drain"


def test_eviction_drain_still_double_advance_guarded():
    """The drain reuses the SAME F7 re-read double-advance guard (it forces through the existing
    `_force_ok and _commit_advance_silently` path), so it can never skip a beat under a race."""
    assert re.search(r"_force_ok\s+and\s+await\s+_commit_advance_silently", AGENT_SRC)


# ── (4) the decision-poll cadence was tightened off the 15s wait ────────────── #

def test_decision_poll_cadence_tightened():
    """The backstop poll that catches a pending the chat narrated past must be ~2-3s, not 15s, so
    the eviction card surfaces almost immediately."""
    assert "}, 15000);" not in DECISION_JS, "the slow 15s decision poll must be gone"
    # WS Phase-1 (#1284 pattern): the backstop body moved into a named `_backstopPending`, armed by a
    # WS-guarded managed interval — still the tightened ~2.5s cadence (the permanent SSE/poll fallback).
    assert "setInterval(_backstopPending, 2500)" in DECISION_JS, \
        "the decision poll must run on the tightened ~2.5s cadence"

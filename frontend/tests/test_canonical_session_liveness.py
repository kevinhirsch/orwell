"""GAP-1 + GAP-2-b1 — the canonical game-session binding must never aim the sync layer at a DEAD
session, and a CASTING turn must key its run on the per-tab session (not a foreign canonical one).

Two live-two-window audit gaps this pins (2026-06-27 ship-gate F1–F5):

  GAP-1 (stale binding survives a chat-wipe): the canonical id stored in ``orwell_game_session`` had
  NO liveness check, and ``DELETE /api/sessions/all`` never unbound it — so after an admin chat-wipe
  the whole sync layer (mirror SSE subscribe / history / resume / canonical-run keying) aimed at a
  dangling id that 404s forever, and convergence onto that phantom id collapsed a live window's DOM.
  The fix: unbind on a chat-wipe / on deleting the bound session, and VALIDATE the stored id resolves
  to a live chat-session row before it is handed out (a confirmed-dead id is unbound + falls back).

  GAP-2-b1 (casting reply strips on settle): a casting turn is framed but ``not game_active``; the FE
  gates canonical convergence off until the season is started, so the window stays per-tab — yet the
  run was keyed on the bound canonical id. On settle the window adopted the canonical session and
  reloaded a history WITHOUT the just-streamed reply, so the casting AI bubble vanished. The fix:
  ``_resolve_canonical_session`` only uses the canonical id for a STARTED game; casting stays per-tab.

Name-agnostic; the store path is redirected to a tmp file so tests never touch the real data dir.
"""

import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
chat_helpers = importlib.import_module("routes.chat_helpers")
ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", tmp_path / "orwell_game_session.json")


def _read(*parts):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, *parts), "r", encoding="utf-8") as f:
        return f.read()


# ── GAP-1: store-level liveness + clear-all ───────────────────────────────────

def test_clear_all_game_sessions_unbinds_every_user():
    """The admin wipe-all door deletes every session row, so every binding is now dangling — clearing
    them ALL is what keeps the sync layer from aiming at a dead id forever."""
    ogs.bind_game_session("alice", "sess-A")
    ogs.bind_game_session("bob", "sess-B")
    ogs.clear_all_game_sessions()
    assert ogs.get_game_session("alice") is None
    assert ogs.get_game_session("bob") is None
    # a fresh bind still wins after the wipe (the next season opens clean)
    assert ogs.bind_game_session("alice", "sess-2") == "sess-2"


def test_clear_all_is_idempotent_on_empty_store():
    ogs.clear_all_game_sessions()  # nothing bound — must be a no-op, not an error
    assert ogs.get_game_session("u") is None


def test_resolve_live_keeps_a_live_binding():
    ogs.bind_game_session("u", "sess-A")
    # predicate says it's live -> binding stays, id returned
    assert ogs.resolve_live_game_session("u", lambda sid: True) == "sess-A"
    assert ogs.get_game_session("u") == "sess-A"


def test_resolve_live_unbinds_a_dead_binding():
    """A canonical id that no longer resolves to a live session is UNBOUND as a side effect so the FE
    never subscribes the mirror stream to a dead channel (the GAP-1 DOM-collapse trigger)."""
    ogs.bind_game_session("u", "dead-sess")
    assert ogs.resolve_live_game_session("u", lambda sid: False) is None
    # the dead binding is gone -> next resolve starts clean (clean rebind, no dead-channel subscribe)
    assert ogs.get_game_session("u") is None


def test_resolve_live_failsoft_keeps_binding_on_predicate_error():
    """A transient liveness-lookup error must NEVER unbind a good id — only a CONFIRMED-dead id is
    dropped."""
    ogs.bind_game_session("u", "sess-A")

    def _boom(_sid):
        raise RuntimeError("db hiccup")

    assert ogs.resolve_live_game_session("u", _boom) == "sess-A"
    assert ogs.get_game_session("u") == "sess-A"


def test_resolve_live_none_when_nothing_bound():
    assert ogs.resolve_live_game_session("u", lambda sid: True) is None


def test_canonical_rotation_is_followed_not_dropped():
    """L-F6 / #1745 at the store seam. The canonical id is first-writer-wins and STABLE during a
    started game, so a fixed-session client never rotates under continuous play. It rotates only on a
    season-lifecycle event: a restart/new-season clears the binding, the old chat row is deleted, then
    the new season's first turn rebinds a FRESH chat. ``resolve_live_game_session`` must always resolve
    to a LIVE id — hand out the old chat while it lives, UNBIND it the moment it's dead (never pin a
    dangling id that would 404 the mirror/history forever, the #1085 window-collapse class), then
    FOLLOW to the new binding. This is the server truth a browser reads via GET
    /api/orwell/game-session and the fixed-session driver now re-resolves to on a history 404."""
    live = {"chat-old"}
    is_live = lambda sid: sid in live  # noqa: E731
    # Season 1: the bound chat is live -> resolve hands it out (a client keys the run on it).
    ogs.bind_game_session("u", "chat-old")
    assert ogs.resolve_live_game_session("u", is_live) == "chat-old"
    # Restart/new-season: the old chat row is deleted, so resolve UNBINDS the dead id (rather than
    # pinning a dangling pointer). A resolve now reads clean — no dead-channel subscribe.
    live.discard("chat-old")
    assert ogs.resolve_live_game_session("u", is_live) is None
    assert ogs.get_game_session("u") is None
    # Season 2's first turn rebinds a fresh live chat -> resolve FOLLOWS to the new id. First-writer-
    # wins means the NEW season binds cleanly (the old binding was already cleared), so the client
    # converges on the new chat instead of 404-ing on the old one forever.
    live.add("chat-new")
    ogs.bind_game_session("u", "chat-new")
    assert ogs.resolve_live_game_session("u", is_live) == "chat-new"


def test_first_writer_wins_never_silently_rotates_a_live_binding():
    """The other half of the verdict: while a binding is LIVE, a racing second bind NEVER rotates it
    (first-writer-wins). This is why a started game's canonical id is stable and a fixed-session client
    does not spuriously rotate mid-play — the ONLY id changes are the lifecycle clears above."""
    ogs.bind_game_session("u", "chat-A")
    # a second device racing a different id adopts the incumbent; the binding does NOT flip
    assert ogs.bind_game_session("u", "chat-B") == "chat-A"
    assert ogs.get_game_session("u") == "chat-A"


# ── GAP-1: the GET route validates liveness before handing out the id ──────────

def _app():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return app


def test_game_session_route_unbinds_a_dead_canonical_id(monkeypatch):
    """GET /api/orwell/game-session must not hand out a dangling id: a stored id that no longer
    resolves to a live chat-session row is unbound and reported as null (no dead-channel subscribe)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    # the bound session points at a row that has been deleted (e.g. a chat-wipe that beat the unbind)
    monkeypatch.setattr(orwell_routes, "_is_live_chat_session", lambda sid: False)
    client = TestClient(_app(), raise_server_exceptions=False)
    client.post("/api/orwell/game-session", json={"sessionId": "dead-sess"})
    r = client.get("/api/orwell/game-session")
    assert r.status_code == 200 and r.json()["sessionId"] is None
    # and it stayed unbound (a second resolve is still clean)
    assert client.get("/api/orwell/game-session").json()["sessionId"] is None


def test_game_session_route_keeps_a_live_canonical_id(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(orwell_routes, "_is_live_chat_session", lambda sid: True)
    client = TestClient(_app(), raise_server_exceptions=False)
    client.post("/api/orwell/game-session", json={"sessionId": "live-sess"})
    assert client.get("/api/orwell/game-session").json()["sessionId"] == "live-sess"


# ── GAP-2-b1: a casting turn keys the run on the PER-TAB session ───────────────

def test_casting_turn_keys_run_on_per_tab_session(monkeypatch):
    """A framed but NOT-started (casting) turn must resolve to the PER-TAB session even when a
    canonical id is bound — otherwise the window adopts a foreign canonical session on settle and the
    just-streamed casting reply is reloaded away (A_count 2->1)."""
    # a canonical id IS bound (a peer tab won first-writer), and it's live...
    ogs.bind_game_session("u", "canonical-A")
    monkeypatch.setattr(chat_helpers, "_is_live_chat_session", lambda sid: True)
    # ...but a casting turn (game_active=False) still keys on THIS tab's own session.
    resolved = chat_helpers._resolve_canonical_session(
        "u", "per-tab-B", framed=True, game_active=False
    )
    assert resolved == "per-tab-B"


def test_started_game_turn_keys_run_on_canonical_session(monkeypatch):
    """The correctly-bound LIVE-game mirror is unchanged: a started, framed turn keys on the canonical
    id so every window on the game shares one run."""
    ogs.bind_game_session("u", "canonical-A")
    monkeypatch.setattr(chat_helpers, "_is_live_chat_session", lambda sid: True)
    resolved = chat_helpers._resolve_canonical_session(
        "u", "per-tab-B", framed=True, game_active=True
    )
    assert resolved == "canonical-A"


def test_nonframed_turn_keys_run_on_per_tab_session(monkeypatch):
    """A plain (non-framed) chat is unchanged — always per-tab."""
    ogs.bind_game_session("u", "canonical-A")
    resolved = chat_helpers._resolve_canonical_session(
        "u", "per-tab-B", framed=False, game_active=True
    )
    assert resolved == "per-tab-B"


# ── wiring drift-pins (cheap, no heavy imports) ───────────────────────────────

def test_delete_all_sessions_unbinds_canonical_bindings():
    """DELETE /api/sessions/all must clear EVERY canonical binding — without it each bound id survives
    as a dead pointer the sync layer keeps aiming at."""
    src = _read("routes", "session_routes.py")
    assert "clear_all_game_sessions" in src


def test_delete_session_unbinds_the_canonical_id():
    """Deleting the bound session must unbind it too (not just the wipe-all door)."""
    src = _read("routes", "session_routes.py")
    assert "clear_game_session" in src
    assert "get_game_session(user) == sid" in src


def test_game_session_route_validates_liveness():
    """The GET route resolves through the liveness-validating helper, not the raw getter."""
    src = _read("routes", "orwell_routes.py")
    assert "resolve_live_game_session" in src
    assert "def _is_live_chat_session" in src


def test_resolve_canonical_session_gates_on_game_active():
    """_resolve_canonical_session must thread game_active and key casting per-tab (GAP-2-b1)."""
    src = _read("routes", "chat_helpers.py")
    assert "def _resolve_canonical_session(user, session_id: str, framed: bool, game_active" in src
    assert "if not framed or not game_active:" in src
    # and the build_chat_context call site threads game_active through
    assert "_resolve_canonical_session(user, session_id, framed, game_active)" in src


def test_run_key_falls_back_to_per_tab_when_no_canonical():
    """The run-key derivation still falls back to the per-tab `session` when `ctx.canonical_session`
    is None — so with casting now resolving canonical_session=None (GAP-2-b1), run_key == session and
    NO `canonical_session` switch event fires, which is exactly what stops the settle reload from
    swapping the casting window onto a foreign session and dropping the just-streamed reply."""
    src = _read("routes", "chat_routes.py")
    assert 'run_key = (getattr(ctx, "canonical_session", None) or session) if _framed else session' in src
    # the switch event + adopt-on-settle only fire when run_key DIVERGES from the POST session
    assert "if run_key != session:" in src

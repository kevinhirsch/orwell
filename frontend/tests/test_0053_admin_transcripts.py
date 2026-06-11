"""Feature 0053 — admin transcript retrieval (ruling #14, quiet debug access).

Name-agnostic — "admin" / "user" are ACCOUNT ROLES, never personal names; "player"
is a game role. The transcript API is admin-gated (same require_admin contract as
every other admin route); the export carries the agent's tool-call nodes AND the
player's Diary-Room entries; the surface is read-only; the Settings row is admin-only.

The require_admin gate is proven by the shared pattern (AUTH_ENABLED=true => 403,
AUTH_ENABLED=false => runs) used by test_e70_new_game_gate.py.
"""

import importlib
import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

database = importlib.import_module("core.database")
atr = importlib.import_module("routes.admin_transcript_routes")

DbSession = database.Session
DbChatMessage = database.ChatMessage
SessionLocal = database.SessionLocal


def _app():
    app = FastAPI()
    app.include_router(atr.setup_admin_transcript_routes())
    return app


def _seed_session(owner, title, *, messages):
    """Persist one session + its messages directly into the DB. `messages` is a
    list of (role, content, meta) tuples; content/meta may be dicts/lists."""
    sid = "sess-" + uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        db.add(DbSession(
            id=sid, name=title, owner=owner,
            endpoint_url="http://x", model="m", message_count=len(messages),
        ))
        for role, content, meta in messages:
            db.add(DbChatMessage(
                id="msg-" + uuid.uuid4().hex[:8],
                session_id=sid,
                role=role,
                content=content if isinstance(content, str) else json.dumps(content),
                meta_data=json.dumps(meta) if meta else None,
            ))
        db.commit()
    finally:
        db.close()
    return sid


@pytest.fixture
def seeded():
    """A game session (with tool-call + Diary-Room nodes) owned by 'user', plus a
    plain session owned by 'second'."""
    game_sid = _seed_session(
        "user", "Season transcript",
        messages=[
            ("user", "I want to nominate the swing vote", None),
            ("assistant", "Understood.", {"tool_calls": [
                {"name": "recordInteraction", "arguments": {"summary": "player schemes"},
                 "output": {"ok": True}},
            ]}),
            ("tool", {"result": {"nominees": ["npc:1", "npc:2"]}}, {"tool": "submitDecision"}),
            # The player's Diary-Room entry (player-level OOC) rides the transcript:
            ("assistant", "Noted in the Diary Room.", {"tool_calls": [
                {"name": "diaryRoom", "arguments": {"entry": "DIARY-ROOM-SENTINEL my read"},
                 "output": {"ok": True}},
            ]}),
        ],
    )
    plain_sid = _seed_session(
        "second", "Just a chat",
        messages=[("user", "hello", None), ("assistant", "hi", None)],
    )
    return {"game_sid": game_sid, "plain_sid": plain_sid}


# ── Admin-gating: a non-admin is refused (list + export) ──────────────────────

def test_list_is_admin_gated(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "true")  # default posture, no admin session
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/transcripts")
    assert r.status_code == 403
    # no session metadata of any account is disclosed
    assert seeded["game_sid"] not in r.text and "Season transcript" not in r.text


def test_export_is_admin_gated(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get(f"/api/admin/transcripts/{seeded['game_sid']}?format=json")
    assert r.status_code == 403
    assert "DIARY-ROOM-SENTINEL" not in r.text  # no content disclosed


# ── Admin list: documented shape + filters + pagination ───────────────────────

def test_admin_list_shape_filters_and_pagination(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # bypasses the gate (smoke posture)
    client = TestClient(_app(), raise_server_exceptions=False)

    r = client.get("/api/admin/transcripts")
    assert r.status_code == 200
    body = r.json()
    assert "transcripts" in body and "total" in body and "limit" in body and "offset" in body
    by_id = {t["id"]: t for t in body["transcripts"]}
    # across ALL users
    assert seeded["game_sid"] in by_id and seeded["plain_sid"] in by_id

    entry = by_id[seeded["game_sid"]]
    for key in ("id", "owner", "title", "created_at", "updated_at",
                "message_count", "is_game_session"):
        assert key in entry, f"missing list field: {key}"
    assert entry["owner"] == "user"
    assert entry["title"] == "Season transcript"
    assert entry["message_count"] == 4
    assert entry["is_game_session"] is True  # game marker (carries engine tool nodes)
    assert by_id[seeded["plain_sid"]]["is_game_session"] is False

    # owner filter returns only that owner's sessions
    r2 = client.get("/api/admin/transcripts?user=user")
    owners = {t["owner"] for t in r2.json()["transcripts"]}
    assert owners == {"user"}

    # since filter (far future) returns nothing
    r3 = client.get("/api/admin/transcripts?since=2999-01-01T00:00:00")
    assert r3.json()["transcripts"] == []

    # pagination: limit caps the page; total still counts everything
    r4 = client.get("/api/admin/transcripts?limit=1")
    page = r4.json()
    assert len(page["transcripts"]) == 1
    assert page["limit"] == 1 and page["total"] >= 2


# ── Admin export: both formats, INCLUDING tool-call + Diary-Room nodes ─────────

def test_admin_export_json_includes_tool_and_diary_nodes(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get(f"/api/admin/transcripts/{seeded['game_sid']}?format=json")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == seeded["game_sid"] and body["owner"] == "user"
    msgs = body["messages"]
    # messages carry roles + timestamps
    assert all("role" in m and "timestamp" in m for m in msgs)
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles and "tool" in roles

    blob = json.dumps(body)
    # the agent tool-call nodes (names, args, outputs) survive — the debug value
    assert "recordInteraction" in blob
    assert "submitDecision" in blob
    # the player's Diary-Room entry is included
    assert "DIARY-ROOM-SENTINEL" in blob


def test_admin_export_markdown_carries_the_nodes(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get(f"/api/admin/transcripts/{seeded['game_sid']}?format=md")
    assert r.status_code == 200
    assert "text/markdown" in r.headers.get("content-type", "")
    text = r.text
    assert "recordInteraction" in text
    assert "DIARY-ROOM-SENTINEL" in text
    # the md export discloses the DR inclusion to the operator
    assert "Diary-Room" in text


def test_export_missing_session_is_404(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/admin/transcripts/does-not-exist").status_code == 404


def test_unknown_format_is_rejected(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get(
        f"/api/admin/transcripts/{seeded['game_sid']}?format=csv"
    ).status_code == 400


# ── Read-only: no mutating verb exists on the surface ─────────────────────────

def test_surface_is_read_only(monkeypatch, seeded):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    sid = seeded["game_sid"]
    for verb in (client.delete, client.put, client.patch):
        r = verb(f"/api/admin/transcripts/{sid}")
        assert r.status_code in (404, 405), f"{verb.__name__} should not be routed (read-only)"
    # the source carries no mutating route decorator
    import os
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "routes", "admin_transcript_routes.py"), encoding="utf-8").read()
    assert ".delete(" not in src and ".put(" not in src and ".patch(" not in src
    assert ".post(" not in src  # no writes at all on this surface


# ── UI: one quiet admin-only Settings row; DR caveat in the copy ──────────────

import os as _os

_FE = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
_INDEX = open(_os.path.join(_FE, "static", "index.html"), encoding="utf-8").read()
_ADMIN_JS = open(_os.path.join(_FE, "static", "js", "admin.js"), encoding="utf-8").read()
_SETTINGS_JS = open(_os.path.join(_FE, "static", "js", "settings.js"), encoding="utf-8").read()


def test_transcripts_row_is_admin_only():
    # the card exists, sits inside the admin-only System panel, and carries the
    # admin-only class so it is display:none for a non-admin (settings.js).
    import re
    m = re.search(r'id="adm-transcripts-card"[^>]*class="([^"]*)"|'
                  r'class="([^"]*)"[^>]*id="adm-transcripts-card"', _INDEX)
    assert m, "the Transcripts card must exist in Settings"
    classes = (m.group(1) or m.group(2) or "")
    assert "admin-only" in classes, "the Transcripts card must be admin-only (absent for non-admins)"
    # settings.js is what hides every .admin-only node for a non-admin
    assert ".admin-only" in _SETTINGS_JS
    assert "isAdmin ? '' : 'none'" in _SETTINGS_JS


def test_transcripts_row_is_quiet_no_game_chrome():
    # no nav/game-chrome affordance — the only entry is the System-panel row
    assert 'data-settings-tab="transcripts"' not in _INDEX, "no new nav surface"
    # the row lives inside the System panel, which is admin-only by tab gating
    assert "adm-transcripts-card" in _INDEX


def test_dr_caveat_in_ui_copy():
    # the admin UI copy must note that exports include Diary-Room entries
    assert "adm-transcripts-dr-caveat" in _INDEX
    assert "Diary-Room" in _INDEX
    # tied to the transcripts card copy specifically
    card = _INDEX.split('id="adm-transcripts-card"')[1].split("admin-danger-card")[0]
    assert "Diary-Room" in card and "Diary-Room entries" in card


def test_admin_js_wires_the_transcripts_panel():
    assert "initTranscripts" in _ADMIN_JS
    assert "/api/admin/transcripts" in _ADMIN_JS
    # download links offer both export formats, read-only (no delete control)
    assert "format=json" in _ADMIN_JS and "format=md" in _ADMIN_JS

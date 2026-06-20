"""Feature 0064 — engaging the existing live-sync for the canonical session, Vault-free.

The cross-device hub (`session_events`) is already keyed by session_id; with the canonical session
every device shares the id, so it engages. Verified here at the seam level:

  * a subscriber to a session receives `run-started` / `message-added` / `game-updated`;
  * the payload carries ONLY the session id + the change type — no message body, no Vault content;
  * `game-updated` is the new instant-reconcile ping (0064 §B.3);
  * the owner guard on `/api/chat/events/{id}` refuses another user's session (cross-user isolation).

Roles only. The hub is in-memory, so this drives it directly; the owner guard is asserted at the
route-source level (its DB-backed _verify_session_owner is exercised in the lane-6 W2 test).
"""

import asyncio
import importlib
import json
import os

import pytest

session_events = importlib.import_module("src.session_events")

# A sentinel that must NEVER appear in any sync payload (the Vault Wall: sync carries no game state).
VAULT_SENTINEL = "__VAULT_SECRET__"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


async def _collect_first(session_id, publish_after):
    """Subscribe, then publish, then return the first NON-hello SSE frame."""
    gen = session_events.subscribe(session_id)
    hello = await gen.__anext__()  # the 'connected' hello
    assert "connected" in hello
    publish_after()
    frame = await asyncio.wait_for(gen.__anext__(), timeout=2.0)
    await gen.aclose()
    return frame


def _parse_sse(frame):
    event = None
    data = None
    for line in frame.splitlines():
        if line.startswith("event:"):
            event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data = json.loads(line[len("data:"):].strip())
    return event, data


def test_run_started_reaches_a_subscriber_with_no_body():
    frame = _run(_collect_first("sess-1", lambda: session_events.publish("sess-1", "run-started")))
    event, data = _parse_sse(frame)
    assert event == "run-started"
    assert data == {"session": "sess-1"}  # id only — no message body rides the channel


def test_message_added_carries_only_id_and_type():
    frame = _run(_collect_first("sess-2", lambda: session_events.publish("sess-2", "message-added")))
    event, data = _parse_sse(frame)
    assert event == "message-added"
    assert set(data.keys()) == {"session"}


def test_game_updated_is_the_instant_reconcile_ping():
    """0064 §B.3 — a board change publishes `game-updated`; the non-driving device reconciles its
    HUD instantly instead of waiting on its ~2s poll. Vault-free: id + change-type only."""
    frame = _run(_collect_first("sess-3", lambda: session_events.publish("sess-3", "game-updated")))
    event, data = _parse_sse(frame)
    assert event == "game-updated"
    assert set(data.keys()) == {"session"}


def test_sync_payloads_never_carry_vault_content():
    """Even if a caller tried to ride extra data, the hub only fans out the published dict — and the
    game routes publish NO body. Assert a payload built from a change-type string is sentinel-free."""
    frame = _run(_collect_first("sess-4", lambda: session_events.publish("sess-4", "game-updated")))
    assert VAULT_SENTINEL not in frame
    # The 0064 publishers pass no `data`, so a body can never leak through this channel.
    _event, data = _parse_sse(frame)
    assert "body" not in data and "content" not in data and "secret" not in data


def test_events_route_owner_guard_in_source():
    """Drift pin: the per-session SSE route owner-guards (W2) — a user can never subscribe to another
    user's activity stream. (The DB-backed guard itself is exercised in the lane-6 W2 test.)"""
    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "chat_routes.py"
    )
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    events_block = src.split('@router.get("/api/chat/events/{session_id}")')[1].split("@router.")[0]
    assert "_verify_session_owner(request, session_id)" in events_block

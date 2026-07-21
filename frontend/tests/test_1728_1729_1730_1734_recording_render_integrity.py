"""Recording + render integrity — kevinhirsch/orwell #1728, #1729, #1730, #1734.

These four issues all center on the FE render-row list and the `_auto_record_scene` hidden-layer
fold, so they land together (splitting would self-conflict):

  #1728 (D1/B2) — a cancelled generation must persist ZERO durable assistant rows (T2), and a
    "Try again" regenerate must SUPERSEDE the prior DB row by id rather than leaving it behind
    while a new one is appended (T3). This file pins the id-keyed truncate resolution
    (`SessionManager.keep_count_before_message`) that makes the supersede exact regardless of
    whether the DOM and the DB row count agree — plus the cancel-path source pin (no more
    `inject_messages` on an empty cancelled turn).

  #1729 (B1) — `_auto_record_scene` must reject non-diegetic content (an OOC vent, a stream-drop
    machinery fragment) BEFORE folding it into the hidden layer as an "(overheard)" event. (The
    D2 resumable-stream half of #1729 is explicitly OUT OF SCOPE here — noted as a follow-up.)

  #1730 (B3) — the fold's witness set must be the INTERSECTION of the model's proposed `withIds`
    with the engine's own `whereabouts` presence read, not the model's guess alone.

  #1734 (B4) — `withIds` must be normalized to the canonical `npc:<n>` form and validated against
    the living roster; a malformed/unresolvable entry is rejected and logged, never coerced.

Roles only; no names (project testing rule).
"""
import asyncio

import pytest

from src import agent_loop as al


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_HOUSE = [{"id": "npc:3", "name": "A Houseguest"}, {"id": "npc:5", "name": "Another Houseguest"}]


# ─────────────────────────────────────────────────────────────────────────────
# #1729 (B1) — the non-diegetic content classifier, in isolation.
# ─────────────────────────────────────────────────────────────────────────────

def test_ooc_double_paren_wrap_is_nondiegetic():
    assert al._is_nondiegetic_scene_text("((that was fucking weird, they seemed so combative))")


def test_ooc_prefix_is_nondiegetic():
    assert al._is_nondiegetic_scene_text("ooc: that comp result felt rigged")
    assert al._is_nondiegetic_scene_text("OOC: same, case-insensitive")


def test_stream_drop_machinery_is_nondiegetic():
    assert al._is_nondiegetic_scene_text(
        "The stream dropped before you finished. It ended with:\n\nision. She's got that intense…")


def test_interrupted_continue_machinery_is_nondiegetic():
    assert al._is_nondiegetic_scene_text(
        "Your previous response was interrupted. It ended with:\n\nsomething")


def test_ordinary_in_character_speech_is_diegetic():
    assert not al._is_nondiegetic_scene_text("I told them I'd have their back at the veto meeting.")
    assert not al._is_nondiegetic_scene_text("")
    assert not al._is_nondiegetic_scene_text(None)


# ─────────────────────────────────────────────────────────────────────────────
# #1734 (B4) — withIds normalization/validation, in isolation.
# ─────────────────────────────────────────────────────────────────────────────

_VALID = {"npc:3", "npc:5"}


def test_canonical_ids_pass_through_unchanged():
    ids, rejected = al._normalize_with_ids(["npc:3", "npc:5"], _VALID)
    assert ids == ["npc:3", "npc:5"]
    assert rejected == []


def test_bare_numeric_ints_are_normalized_when_real():
    ids, rejected = al._normalize_with_ids([3, 5], _VALID)
    assert ids == ["npc:3", "npc:5"]
    assert rejected == []


def test_bare_numeric_strings_are_normalized_when_real():
    ids, rejected = al._normalize_with_ids(["3", "5"], _VALID)
    assert ids == ["npc:3", "npc:5"]
    assert rejected == []


def test_unknown_ids_are_rejected_not_coerced():
    # npc:6 is not a living roster member — normalizing "6" to "npc:6" would be a GUESS, not a fact.
    ids, rejected = al._normalize_with_ids(["npc:3", "6", "npc:99", "garbage"], _VALID)
    assert ids == ["npc:3"]
    assert set(rejected) == {"6", "npc:99", "garbage"}


def test_duplicate_ids_are_deduped():
    ids, rejected = al._normalize_with_ids(["npc:3", "npc:3", 3], _VALID)
    assert ids == ["npc:3"]
    assert rejected == []


def test_non_list_withids_is_rejected_wholesale():
    ids, rejected = al._normalize_with_ids("npc:3", _VALID)
    assert ids == []
    assert rejected == ["npc:3"]
    ids2, rejected2 = al._normalize_with_ids(None, _VALID)
    assert ids2 == []
    assert rejected2 == []


# ─────────────────────────────────────────────────────────────────────────────
# `_auto_record_scene` integration — the belt with a stubbed extraction LLM + engine calls.
# ─────────────────────────────────────────────────────────────────────────────

def _drive(monkeypatch, extraction_json, last_user="Let's talk strategy with npc:3",
           narration="They schemed in the backyard for a while.", whereabouts=None,
           whereabouts_raises=False):
    """Run _auto_record_scene with a stubbed extraction LLM, a capturing record_interaction, and a
    stubbed whereabouts read (mirrors the `test_0066_felt_minutes_extraction.py` pattern)."""
    captured = {"llm_called": False, "record_called": False}

    async def fake_llm(*a, **k):
        captured["llm_called"] = True
        return extraction_json

    async def fake_record(content, with_ids=None, kind=None, consequence=None,
                          expected_beat_seq=None, idempotency_key=None, felt_minutes=None, user=None):
        captured["record_called"] = True
        captured["with_ids"] = with_ids
        captured["content"] = content
        return {"recorded": True, "beatSeq": 1}

    async def fake_whereabouts(user=None):
        if whereabouts_raises:
            raise RuntimeError("engine unreachable")
        return whereabouts

    from src import llm_core, orwell_engine as oe
    from routes import chat_helpers
    chat_helpers._LAST_BEAT_SEQ["owner"] = 1
    monkeypatch.setattr(llm_core, "llm_call_async", fake_llm)
    monkeypatch.setattr(oe, "record_interaction", fake_record)
    monkeypatch.setattr(oe, "whereabouts", fake_whereabouts)

    ok = _run(al._auto_record_scene(
        narration=narration, last_user=last_user,
        house=_HOUSE, endpoint_url="http://x", model="m", headers={}, owner="owner"))
    return ok, captured


# ---- #1729 (B1): the recorder gate rejects OOC/machinery before ever calling the extraction LLM.

def test_ooc_last_user_is_rejected_without_calling_extraction_llm(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"x"}',
                     last_user="((that was fucking weird, so combative))")
    assert ok is False
    assert cap["llm_called"] is False, "a rejected OOC turn must never even reach the extraction call"
    assert cap["record_called"] is False


def test_stream_drop_fragment_last_user_is_rejected(monkeypatch):
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"x"}',
        last_user="The stream dropped before you finished. It ended with:\n\nision. She's got that…")
    assert ok is False
    assert cap["llm_called"] is False
    assert cap["record_called"] is False


def test_ooc_wrapped_narration_is_also_rejected(monkeypatch):
    # The narrator marks its OWN HUD/producer asides with the identical ((wrap)) convention —
    # a turn that is entirely a producer aside must not fold as a scene either.
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"x"}',
                     narration="((the site lagged for a second — go ahead))")
    assert ok is False
    assert cap["record_called"] is False


def test_ordinary_scene_still_records(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3"],"kind":"strategy","content":"a real scene"}')
    assert ok is True
    assert cap["record_called"] is True
    assert cap["with_ids"] == ["npc:3"]


# ---- #1730 (B3): the fold witness set is the engine-presence intersection, not the model's guess.

def test_witness_set_drops_offscene_npc_the_model_guessed(monkeypatch):
    # The model proposes BOTH houseguests, but the engine says only npc:3 is actually present —
    # npc:5 must be dropped (no phantom knowledge for a scene they weren't in).
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:3","npc:5"],"kind":"bonding","content":"x"}',
        whereabouts={"room": "kitchen", "present": [{"id": "npc:3", "name": "A Houseguest"}]})
    assert ok is True
    assert cap["with_ids"] == ["npc:3"], "an off-scene id the model guessed must be dropped from the fold"


def test_witness_set_all_offscene_yields_no_fold(monkeypatch):
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:5"],"kind":"bonding","content":"x"}',
        whereabouts={"room": "kitchen", "present": [{"id": "npc:3", "name": "A Houseguest"}]})
    assert ok is False
    assert cap["record_called"] is False


def test_whereabouts_read_failure_fails_open(monkeypatch):
    # A presence-read hiccup must not zero out the whole 0055 safety net — fall back to the
    # roster-validated proposal unchanged.
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:3"],"kind":"bonding","content":"x"}',
        whereabouts_raises=True)
    assert ok is True
    assert cap["with_ids"] == ["npc:3"]


def test_no_whereabouts_present_key_fails_open(monkeypatch):
    # A pre-live-season / non-presence context: whereabouts() returns None entirely (no read at
    # all) — genuinely nothing to filter against, so fail OPEN.
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:3"],"kind":"bonding","content":"x"}',
        whereabouts=None)
    assert ok is True
    assert cap["with_ids"] == ["npc:3"]


def test_valid_empty_presence_read_still_applies_the_filter(monkeypatch):
    # CodeRabbit/Greptile review fix — a VALID whereabouts read reporting an EMPTY room
    # ("present": []) is NOT the same as a failed/absent read: the engine is affirmatively
    # telling us nobody else is there. `if present_ids:` (an empty set is falsy) used to treat
    # this identically to a None/failed read and skip the intersection entirely, letting the
    # model's unverified withIds fold as-is — the exact phantom-witness case #1730 closes. A
    # real empty presence read must still zero out an unverified proposal.
    ok, cap = _drive(
        monkeypatch, '{"withIds":["npc:3"],"kind":"bonding","content":"x"}',
        whereabouts={"room": "kitchen", "present": []})
    assert ok is False, "an empty (but VALID) presence read must reject an unverified withIds proposal"
    assert cap["record_called"] is False


# ---- #1734 (B4): a malformed withIds shape from the extraction is normalized/rejected before it
#      ever reaches record_interaction (composes with B3's presence filter above it).

def test_bare_numeric_withids_reach_record_interaction_normalized(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":[3,5],"kind":"bonding","content":"x"}',
                     whereabouts={"room": "kitchen", "present": [
                         {"id": "npc:3", "name": "A"}, {"id": "npc:5", "name": "B"}]})
    assert ok is True
    assert cap["with_ids"] == ["npc:3", "npc:5"]


def test_malformed_withids_entries_are_dropped_not_coerced(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["npc:3","npc:99","garbage"],"kind":"bonding","content":"x"}')
    assert ok is True
    assert cap["with_ids"] == ["npc:3"], "an unresolvable id must be dropped, never guessed at"


def test_wholly_malformed_withids_yields_no_fold(monkeypatch):
    ok, cap = _drive(monkeypatch, '{"withIds":["nowhere","nobody"],"kind":"bonding","content":"x"}')
    assert ok is False
    assert cap["record_called"] is False


# ─────────────────────────────────────────────────────────────────────────────
# #1728 (D1) — id-keyed supersede: the render-log truncate resolution.
# ─────────────────────────────────────────────────────────────────────────────

from core.session_manager import SessionManager
from core.models import ChatMessage
from core import database as db


def _seq_ordered_ids(session_id):
    s = db.SessionLocal()
    try:
        rows = (
            s.query(db.ChatMessage)
            .filter(db.ChatMessage.session_id == session_id)
            .order_by(db.ChatMessage.seq)
            .all()
        )
        return [r.id for r in rows]
    finally:
        s.close()


def test_keep_count_before_message_resolves_from_db_seq_truth():
    sm = SessionManager()
    sid = "d1-keep-count"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    for i in range(4):
        sm.add_message(sid, ChatMessage("user" if i % 2 == 0 else "assistant", f"m{i}", metadata={}))
    ids = _seq_ordered_ids(sid)
    assert len(ids) == 4

    # Resolve the keep_count that supersedes the LAST message (row index 3) — everything before it.
    kc = sm.keep_count_before_message(sid, ids[3])
    assert kc == 3

    # Resolve the keep_count for the SECOND message (row index 1).
    kc2 = sm.keep_count_before_message(sid, ids[1])
    assert kc2 == 1


def test_keep_count_before_message_unknown_id_returns_none():
    sm = SessionManager()
    sid = "d1-unknown-id"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sm.add_message(sid, ChatMessage("user", "m0", metadata={}))
    assert sm.keep_count_before_message(sid, "not-a-real-id") is None


def test_regenerate_supersedes_by_id_leaves_exactly_one_row():
    """The T3 repro, end to end at the SessionManager layer: a regenerate that resolves
    `truncate_from_id` from DB seq truth and then truncates leaves exactly ONE assistant row for
    the turn (the freshly re-generated one), never two near-identical rows."""
    sm = SessionManager()
    sid = "d1-regen-supersede"
    sm.create_session(sid, "n", "http://x", "m", owner="u")
    sm.add_message(sid, ChatMessage("user", "hi", metadata={}))
    sm.add_message(sid, ChatMessage("assistant", "first take (to be discarded)", metadata={}))
    ids = _seq_ordered_ids(sid)
    assert len(ids) == 2
    ai_row_id = ids[1]

    # The regenerate resolves keep_count from the AI row's id (server seq truth), truncates it
    # away, then the "new" turn appends its own fresh assistant row.
    kc = sm.keep_count_before_message(sid, ai_row_id)
    assert kc == 1
    assert sm.truncate_messages(sid, kc) is True
    assert _seq_ordered_ids(sid) == [ids[0]]  # only the user turn survives the truncate

    sm.add_message(sid, ChatMessage("assistant", "second take (kept)", metadata={}))
    final_ids = _seq_ordered_ids(sid)
    assert len(final_ids) == 2, "exactly one assistant row must survive a regenerate — never two"


# ─────────────────────────────────────────────────────────────────────────────
# #1728 (D1/T2) — cancel = discard: source pin (no inject_messages call on an empty cancel).
# ─────────────────────────────────────────────────────────────────────────────

def _read_chat_js():
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "static", "js", "chat.js")
    with open(path, encoding="utf-8") as f:
        return f.read()


def test_cancelled_bubble_never_persists_an_empty_row():
    js = _read_chat_js()
    fn = js[js.index("function _renderCancelledBubble(holder)"):]
    fn = fn[:fn.index("\n  }\n") + 4]
    assert "inject_messages" not in fn, (
        "a cancelled/empty generation must be DISCARDED, never persisted as an empty "
        "stopped+cancelled assistant row (#1728 T2)"
    )


def test_cancelled_bubble_still_renders_local_indicator():
    js = _read_chat_js()
    fn = js[js.index("function _renderCancelledBubble(holder)"):]
    fn = fn[:fn.index("\n  }\n") + 4]
    assert "[Cancelled by user]" in fn, "the local transient UI feedback must remain"


# ─────────────────────────────────────────────────────────────────────────────
# #1728 (D1/T3) — regenerateFrom must check the truncate response BEFORE mutating the DOM /
# resubmitting: CodeRabbit/Greptile review fix. fetch() never rejects on an HTTP error status, so
# an unchecked truncate 404 (a stale/missing truncate_from_id) used to fall through — the client
# stripped the DOM rows and fired the regenerate ANYWAY, leaving the un-truncated stale DB row
# behind and reintroducing the "two near-identical rows" bug (T3).
# ─────────────────────────────────────────────────────────────────────────────

def _read_chat_message_actions_js():
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "static", "js", "chatMessageActions.js")
    with open(path, encoding="utf-8") as f:
        return f.read()


def _regenerate_from_body():
    js = _read_chat_message_actions_js()
    fn = js[js.index("export async function regenerateFrom(aiMsgElement)"):]
    return fn[:fn.index("\n}\n") + 3]


def test_regenerate_checks_truncate_response_status():
    fn = _regenerate_from_body()
    assert "_truncRes.ok" in fn, (
        "regenerateFrom must inspect the truncate response's HTTP status — fetch() does not "
        "reject on a non-2xx response, so an unchecked 404 silently falls through"
    )
    assert "throw new Error" in fn, "a failing truncate must throw so the existing catch handles it"


def test_regenerate_throws_before_removing_dom_rows_on_truncate_failure():
    fn = _regenerate_from_body()
    ok_check_at = fn.index("_truncRes.ok")
    # Every DOM-mutating / resubmit statement this function performs on the happy path must come
    # AFTER the status check, so a failed truncate never strips rows or fires the regenerate.
    for marker in ("allMsgs[i].remove()", "aiMsgElement.remove()", "_handleChatSubmit(null, userText)"):
        marker_at = fn.index(marker)
        assert ok_check_at < marker_at, (
            f"the truncate response status check must run BEFORE `{marker}` — otherwise a stale/"
            f"missing truncate_from_id (404) leaves the DOM stripped and a duplicate row behind"
        )

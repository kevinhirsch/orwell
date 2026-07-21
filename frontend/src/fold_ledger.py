"""Issue #1728 (B2) — the defer-fold-to-settle pending-fold ledger.

**The bug this closes (BB-Nerd F5/F6, reconciliation T3, joined):** the 0055 `_auto_record_scene`
belt (`src/agent_loop.py`) used to fold a scene's consequence into the hidden relationship/soul
layer *immediately*, mid-stream, the instant the extraction validated. A "Try again" regenerate
produces a brand-new take of the SAME turn and its OWN `_auto_record_scene` call — but the first
take's fold had already committed and can never be un-narrated. Net effect: every regenerate
permanently double-folded the hidden layer, sometimes with content from a take the player never
even saw kept (F6).

**The fix — DEFER-FOLD-TO-SETTLE (owner-ruled primary, per issue #1728).** A scene's fold is no
longer committed at proposal time. It is *staged* here — a small, Vault-free, in-memory, per-
(owner, session) **bounded FIFO queue** — and only actually applied ("settled") once the take that
produced it is confirmed to have survived, i.e. once a NEW turn begins for that same session
(`agent_loop._settle_pending_fold`, called before the new turn generates anything). A regenerate
truncates the superseded row BEFORE any new turn ever starts, and the truncate route
(`routes/history_routes.py::truncate_session`) discards every staged fold ANCHORED to a row that
truncate is about to remove — so a superseded take's fold can never reach the engine.

**Why a QUEUE, not a single slot (PR #1825 Greptile P1 fix #1).** A single-slot "stage always
overwrites" design has a real evaporation hole: if `_settle_pending_fold` hits a *transient*
engine error, it re-stages the PRIOR turn's still-valid fold for retry and lets the new turn
proceed — and if that new turn ALSO reaches `_auto_record_scene`, a plain overwrite would silently
clobber the still-unsettled prior entry, violating mandate #4 (a validated fold must never
evaporate). So `_PENDING[key]` is a small bounded FIFO list, not a single dict:

  * `stage_pending_fold` **appends** — it never overwrites another turn's still-pending entry.
  * Settle **drains oldest-first**, applying each entry's fold with ITS OWN preserved idempotency
    key. A failure re-queues that entry at the FRONT and settling STOPS for this call (never skips
    ahead to a newer entry out of order — the ledger's ordering is the turn ordering).
  * **Bounded** (`_MAX_QUEUE_LEN`, currently 8) — a pathological repeated-settle-failure loop drops
    the OLDEST entry (with a warning log) rather than growing without limit. In practice the queue
    is 0 or 1 entries deep essentially always (settle drains on every turn); depth > 1 only occurs
    across consecutive transient-failure turns, which is not expected to sustain.

**Why entries are ANCHORED to a real row, not just FIFO-ordered (PR #1825 Greptile P1 fix #2 — the
mirror-image bug).** The first queue fix made truncate discard only the TAIL entry. That is wrong
whenever `truncate_from_id` targets an OLDER assistant row: a truncate ALWAYS removes that row AND
every row after it (never just one row in isolation), so an older-row truncate can wipe out a
LATER take's row too — but a tail-only discard would leave that later take's queued fold sitting
in the ledger, and it would settle later as a PHANTOM hidden-layer fold for content the render log
no longer contains (a T-Rex-confirmed repro). The fix: every staged entry carries a `row_anchor` —
the 0-indexed, `seq`-order POSITION of the assistant row it belongs to (the exact unit
`core.session_manager.SessionManager.keep_count_before_message` already produces for the truncate
route, so the two are directly, cheaply comparable with no further DB work at truncate time):

  * `attach_row_anchor` is called ONCE per turn, from `routes/chat_routes.py` right after the
    route persists that turn's assistant reply and gets back its real DB id — the SAME
    `dataset.dbId` seam #1751 already stamps client-side. It anchors the TAIL entry only if it is
    still unattached (a tail that already has an anchor belongs to an OLDER, re-queued turn and
    must never be relabeled with THIS turn's row). At stage time (mid-generation, before the row
    exists) the anchor is `None` — there is a genuinely unavoidable gap between "the extraction
    validated" and "the row has a real id," and this design accepts it rather than guess.
  * `discard_pending_fold(owner, session, keep_count)` discards EVERY entry whose `row_anchor` is
    `>= keep_count` — not just the newest — because that is exactly the set of rows the truncate
    is about to remove. Entries anchored below `keep_count` (an older, already-accepted turn's
    re-queued fold, still sitting there after a settle failure) survive.
  * **FAIL-SAFE, deliberately asymmetric:** an entry whose anchor is still `None` (missing/
    unresolved — the attach step never got a chance to run, an exceedingly narrow race) is ALWAYS
    discarded by a truncate, regardless of `keep_count`. A lost validated fold is a bounded
    mandate-#4 sadness (it can, at worst, evaporate — the SAME risk every deferred design already
    accepts); a phantom fold surviving into the hidden layer for content no longer in the render
    log is exactly the corruption this entire feature exists to prevent, and the two are not
    symmetric risks — when genuinely uncertain, always resolve toward "never fold," never toward
    "maybe fold something that isn't there anymore."
  * **Settle's own last-line belt (`entry_exists_at_settle`)** is the opposite of the truncate
    fail-safe on purpose: an entry that is anchored but whose row-count position no longer exists
    (some non-truncate deletion path — `edit-message`/`delete-messages`/`merge-last-assistant` —
    removed it without ever calling `discard_pending_fold`) is dropped (with a warning), never
    applied nor re-queued (nothing to retry — the row is just gone). A MISSING anchor at settle
    time is treated as "no evidence either way" and settle proceeds normally — unlike truncate,
    settle is not reacting to an active delete event, so there is no matching urgency to assume
    the worst; discarding every never-anchored entry on principle would silently regress every
    turn (which, absent a genuine attach-step outage, is expected to have a real anchor by the
    time the NEXT turn's settle runs — attach happens synchronously within the SAME request that
    staged the fold, long before a client could ever send the next one).

**Idempotency (AC #5).** Each entry's idempotency key is minted ONCE, at stage time, and carried
unchanged through to the engine `recordInteraction` call at settle time (0065 Part B — the engine
dedups a repeated key and returns the prior eventId without re-folding) — so a retried settle, or
a settle that re-applies an already-applied entry, can never double-fold.

**T9 doctrine — the FALLBACK not built here.** The issue also specs a compensating-retract path
(commit immediately, then issue an "un-fold" if the take turns out to have been superseded) as a
fallback for a seam where deferral proves infeasible. No such seam exists on this issue's build
surface (staging is a plain in-process list append with nowhere it can fail before the engine is
ever touched), so retract is NOT implemented — only documented here per the T9 doctrine ("if you
implement deferral, note the retract design as the designated fallback, don't build both"). Were
it ever needed, the shape would be: `record_interaction` grows an explicit `retract` verb/flag
keyed by the ORIGINAL `idempotencyKey` (already unique per scene), which the engine resolves to
the exact prior fold and reverses it via the SAME bounded/seeded magnitude math it applied
forward — never a raw-number roll-back the FE could game. Do not build this unless a real seam
forces it (e.g. a settle point that can only run AFTER the engine has already committed).

**Vault-free / in-memory (mirrors `routes/chat_helpers.py`'s `_DEFERRED_FOLDS`/`_LAST_BEAT_SEQ`,
the established pattern for exactly this class of short-lived, per-owner FE bookkeeping).** The
staged payload is the SAME open-set descriptor `_auto_record_scene` already validates before it
ever reaches here (roster-checked ids, closed-enum kind/direction/emphasis, truncated content) —
nothing secret, nothing engine-authoritative; the engine still owns the fold magnitude at settle
time exactly as it always has. `attach_row_anchor` / `entry_exists_at_settle` do a plain,
Vault-free `ChatMessage` row read (id/`seq` only) — the same table the render log itself lives in,
never the Vault. Process-restart loses unsettled entries (the same tradeoff `_DEFERRED_FOLDS`
already accepts) — acceptable here because the settle window is one HTTP round trip at most, far
shorter than that queue's multi-turn retry horizon.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# (owner, session_id) -> FIFO list of staged fold payloads, oldest first. A key is never present
# with an empty list — an empty queue is represented by the key's absence. See module docstring.
_PENDING: dict[tuple, list] = {}

# A pathological repeated-settle-failure loop must not grow the queue without bound — drop the
# OLDEST entry (with a warning) past this depth. In normal operation the queue is 0-1 deep.
_MAX_QUEUE_LEN = 8


def _key(owner: Optional[str], session_id: Optional[str]) -> tuple:
    return (owner, session_id)


def _make_entry(*, content: str, with_ids: list, kind: str, consequence: Optional[dict],
                 felt_minutes: Optional[int], idempotency_key: str,
                 row_anchor: Optional[int] = None) -> dict:
    return {
        "content": content,
        "with_ids": with_ids,
        "kind": kind,
        "consequence": consequence,
        "felt_minutes": felt_minutes,
        "idempotency_key": idempotency_key,
        # The 0-indexed seq-order position of the assistant row this fold belongs to. Unknown
        # (None) until `attach_row_anchor` fills it in once the row is actually persisted — see
        # the module docstring's "Why entries are ANCHORED" section.
        "row_anchor": row_anchor,
    }


def stage_pending_fold(owner: Optional[str], session_id: Optional[str], *, content: str,
                        with_ids: list, kind: str, consequence: Optional[dict],
                        felt_minutes: Optional[int], idempotency_key: str) -> None:
    """Append a validated scene-fold payload to this (owner, session)'s queue, UNANCHORED
    (`row_anchor=None` — the turn's own row does not exist yet at stage time). Never overwrites an
    existing unsettled entry (PR #1825 fix #1) — a re-queued (settle-failure) entry from an
    earlier turn stays intact and simply settles before this new one (FIFO order). Call
    `attach_row_anchor` once the row is actually persisted."""
    key = _key(owner, session_id)
    q = _PENDING.setdefault(key, [])
    q.append(_make_entry(content=content, with_ids=with_ids, kind=kind, consequence=consequence,
                         felt_minutes=felt_minutes, idempotency_key=idempotency_key))
    if len(q) > _MAX_QUEUE_LEN:
        dropped = q.pop(0)
        logger.warning(
            f"[orwell] fold_ledger: pending queue for session={session_id!r} exceeded "
            f"{_MAX_QUEUE_LEN} entries — dropping the OLDEST staged fold (kind={dropped.get('kind')}) "
            f"to bound the queue; this is a real (if bounded) fold loss and should not happen under "
            f"normal settle-drains-every-turn operation")


def attach_row_anchor(owner: Optional[str], session_id: Optional[str], saved_row_id: str) -> bool:
    """#1728 (B2, PR #1825 fix #2) — attach the REAL persisted row's position to the TAIL entry,
    but ONLY if the tail is still unanchored (i.e. it was staged THIS turn, before its own row
    existed) — an already-anchored tail belongs to an OLDER, re-queued turn and must never be
    relabeled. Called once, right after the route persists the assistant reply and gets back its
    real DB id (`routes/chat_routes.py`, mirroring the #1751 `dataset.dbId` client stamp).

    Resolves the row's 0-indexed seq-order POSITION (the same unit
    `SessionManager.keep_count_before_message` already produces for the truncate route) rather
    than storing the raw row id, so `discard_pending_fold`'s `>= keep_count` comparison needs no
    further DB work at truncate time. Fail-soft: if the row can't be resolved (a racy edge case),
    the entry is simply left unanchored — the truncate fail-safe (discard on any truncate) still
    protects it from becoming a phantom; it just risks the more modest mandate-#4 loss instead.

    Returns True iff an anchor was actually attached."""
    key = _key(owner, session_id)
    q = _PENDING.get(key)
    if not q or q[-1]["row_anchor"] is not None:
        return False
    position = _resolve_row_position(session_id, saved_row_id)
    if position is None:
        return False
    q[-1]["row_anchor"] = position
    return True


def _resolve_row_position(session_id: str, msg_id: str) -> Optional[int]:
    """0-indexed seq-order position of `msg_id` within `session_id`, or None if not found. Mirrors
    `core.session_manager.SessionManager.keep_count_before_message` exactly (same query, same
    ordering) as a free function, so this module needs only the DB the route already depends on —
    not a `SessionManager` instance."""
    from core.database import ChatMessage as DbChatMessage
    from core.database import SessionLocal
    db = SessionLocal()
    try:
        rows = (db.query(DbChatMessage)
                  .filter(DbChatMessage.session_id == session_id)
                  .order_by(DbChatMessage.seq)
                  .all())
        for i, row in enumerate(rows):
            if row.id == msg_id:
                return i
        return None
    finally:
        db.close()


def entry_exists_at_settle(session_id: Optional[str], row_anchor: Optional[int]) -> bool:
    """#1728 (B2, PR #1825 fix #2, item 4) — settle's last-line belt: does a row still occupy
    `row_anchor`'s position (or a later one) in `session_id`'s render log? A cheap COUNT query
    (not a content comparison) — good enough as defense-in-depth against a non-truncate deletion
    path (`edit-message` / `delete-messages` / `merge-last-assistant`) that bypassed
    `discard_pending_fold` entirely.

    `row_anchor=None` returns True (the entry is allowed to settle) — deliberately the OPPOSITE
    of `discard_pending_fold`'s fail-safe: settle isn't reacting to an active delete event, a
    missing anchor here is not evidence of anything, and treating it as "gone" would silently
    regress every ordinary turn (see the module docstring)."""
    if row_anchor is None:
        return True
    if not session_id:
        return True
    from core.database import ChatMessage as DbChatMessage
    from core.database import SessionLocal
    db = SessionLocal()
    try:
        count = db.query(DbChatMessage).filter(DbChatMessage.session_id == session_id).count()
        return row_anchor < count
    finally:
        db.close()


def pop_oldest_pending_fold(owner: Optional[str], session_id: Optional[str]) -> Optional[dict]:
    """Remove and return the OLDEST staged fold for this (owner, session) (FIFO), or None if the
    queue is empty. The caller (settle) owns re-queuing on a failed commit — this module never
    retries on its own."""
    key = _key(owner, session_id)
    q = _PENDING.get(key)
    if not q:
        return None
    entry = q.pop(0)
    if not q:
        del _PENDING[key]
    return entry


def requeue_pending_fold_front(owner: Optional[str], session_id: Optional[str], entry: dict) -> None:
    """Push `entry` back onto the FRONT of this (owner, session)'s queue — used when a settle
    attempt fails on a transient (non-stale-beat) error, so the entry is retried FIRST at the next
    settle opportunity rather than lost or reordered behind a newer entry."""
    key = _key(owner, session_id)
    _PENDING.setdefault(key, []).insert(0, entry)


def discard_pending_fold(owner: Optional[str], session_id: Optional[str], keep_count: int) -> int:
    """#1728 (B2, PR #1825 fix #2) — the supersede-cancel half of defer-fold-to-settle: called from
    the truncate route with the SAME `keep_count` it already resolved from `truncate_from_id`
    (rows at seq-order position `< keep_count` survive; `>= keep_count` are removed). Discards
    EVERY queued entry whose `row_anchor >= keep_count` — not just the newest — because a truncate
    targeting an OLDER row removes that row AND every later one, and a queued fold anchored to one
    of those later rows must not survive to settle as a phantom fold for content the render log no
    longer contains (the second Greptile P1 on PR #1825, T-Rex-confirmed).

    FAIL-SAFE: an entry with a missing/unresolved anchor (`row_anchor is None`) is ALSO discarded
    on ANY truncate, regardless of `keep_count` — see the module docstring's "deliberately
    asymmetric" note. Entries anchored below `keep_count` (an older, already-accepted turn's
    re-queued fold) survive untouched.

    Returns the number of entries actually discarded (0 if none)."""
    key = _key(owner, session_id)
    q = _PENDING.get(key)
    if not q:
        return 0
    survivors = []
    discarded_unanchored = 0
    for e in q:
        if e["row_anchor"] is not None and e["row_anchor"] < keep_count:
            survivors.append(e)
        elif e["row_anchor"] is None:
            discarded_unanchored += 1
    discarded_count = len(q) - len(survivors)
    if discarded_unanchored:
        logger.warning(
            f"[orwell] fold_ledger: discarding {discarded_unanchored} staged fold(s) with a "
            f"missing/unresolved row anchor on truncate (session={session_id!r}) — fail-safe: an "
            f"unanchored entry is never kept across a truncate, even though it MIGHT have "
            f"belonged to a surviving row, because a phantom fold is worse than a lost one "
            f"(mandate #4 vs. the F5 corruption this feature exists to prevent)")
    if survivors:
        _PENDING[key] = survivors
    else:
        _PENDING.pop(key, None)
    return discarded_count


def has_pending_fold(owner: Optional[str], session_id: Optional[str]) -> bool:
    return bool(_PENDING.get(_key(owner, session_id)))


def pending_fold_count(owner: Optional[str], session_id: Optional[str]) -> int:
    return len(_PENDING.get(_key(owner, session_id), ()))


def clear_all() -> None:
    """Test-only reset."""
    _PENDING.clear()

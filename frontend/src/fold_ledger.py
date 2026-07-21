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
(`routes/history_routes.py::truncate_session`) discards the SUPERSEDED take's staged fold as part
of that truncate — so a superseded take's fold can never reach the engine.

**Why a QUEUE, not a single slot (PR #1825 Greptile P1 fix).** A single-slot "stage always
overwrites" design has a real evaporation hole: if `_settle_pending_fold` hits a *transient*
engine error, it re-stages the PRIOR turn's still-valid fold for retry and lets the new turn
proceed — and if that new turn ALSO reaches `_auto_record_scene`, a plain overwrite would silently
clobber the still-unsettled prior entry, violating mandate #4 (a validated fold must never
evaporate). So `_PENDING[key]` is a small bounded FIFO list, not a single dict:

  * `stage_pending_fold` **appends** — it never overwrites another turn's still-pending entry.
  * Settle **drains oldest-first**, applying each entry's fold with ITS OWN preserved idempotency
    key. A failure re-queues that entry at the FRONT and settling STOPS for this call (never skips
    ahead to a newer entry out of order — the ledger's ordering is the turn ordering).
  * **Truncate discards only the TAIL (most-recently-staged) entry** — the fold belonging to the
    take actually being superseded. Any OLDER, already re-queued entries belong to turns that were
    already accepted (settle would have drained them first were they not stuck retrying) and MUST
    survive the truncate; discarding the whole queue would re-open the exact evaporation hole this
    redesign closes.
  * **Bounded** (`_MAX_QUEUE_LEN`, currently 8) — a pathological repeated-settle-failure loop drops
    the OLDEST entry (with a warning log) rather than growing without limit. In practice the queue
    is 0 or 1 entries deep essentially always (settle drains on every turn); depth > 1 only occurs
    across consecutive transient-failure turns, which is not expected to sustain.

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
time exactly as it always has. Process-restart loses unsettled entries (the same tradeoff
`_DEFERRED_FOLDS` already accepts) — acceptable here because the settle window is one HTTP round
trip at most, far shorter than that queue's multi-turn retry horizon.
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
                 felt_minutes: Optional[int], idempotency_key: str) -> dict:
    return {
        "content": content,
        "with_ids": with_ids,
        "kind": kind,
        "consequence": consequence,
        "felt_minutes": felt_minutes,
        "idempotency_key": idempotency_key,
    }


def stage_pending_fold(owner: Optional[str], session_id: Optional[str], *, content: str,
                        with_ids: list, kind: str, consequence: Optional[dict],
                        felt_minutes: Optional[int], idempotency_key: str) -> None:
    """Append a validated scene-fold payload to this (owner, session)'s queue. Never overwrites an
    existing unsettled entry (PR #1825 fix) — a re-queued (settle-failure) entry from an earlier
    turn stays intact and simply settles before this new one (FIFO order)."""
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


def discard_pending_fold(owner: Optional[str], session_id: Optional[str]) -> bool:
    """#1728 — the supersede-cancel half of defer-fold-to-settle: called from the truncate route
    whenever a session's tail is cut. Discards ONLY the most-recently-staged (tail) entry — the
    fold belonging to the take actually being superseded by this truncate. Any OLDER, already
    re-queued entries belong to turns that were already accepted (a truncate can only ever
    supersede the session's latest turn) and MUST survive — discarding the whole queue would
    silently drop an already-valid fold, exactly the evaporation bug this queue redesign fixes.
    Returns True if an entry was actually discarded (for logging/telemetry)."""
    key = _key(owner, session_id)
    q = _PENDING.get(key)
    if not q:
        return False
    q.pop()  # the tail — most recently staged
    if not q:
        del _PENDING[key]
    return True


def has_pending_fold(owner: Optional[str], session_id: Optional[str]) -> bool:
    return bool(_PENDING.get(_key(owner, session_id)))


def pending_fold_count(owner: Optional[str], session_id: Optional[str]) -> int:
    return len(_PENDING.get(_key(owner, session_id), ()))


def clear_all() -> None:
    """Test-only reset."""
    _PENDING.clear()

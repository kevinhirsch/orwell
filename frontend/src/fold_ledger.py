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
(owner, session) pending slot — and only actually applied ("settled") once the take that produced
it is confirmed to have survived, i.e. once a NEW turn begins for that same session
(`agent_loop._settle_pending_fold`, called before the new turn generates anything). A regenerate
truncates the superseded row BEFORE any new turn ever starts, and the truncate route
(`routes/history_routes.py::truncate_session`) unconditionally discards this session's staged fold
as part of that truncate — so a superseded take's fold can never reach the engine. There is at
most one staged fold per (owner, session) at any time: settle always drains whatever is here
before a new one can be staged, so "stage" is a plain overwrite, never a queue.

**Idempotency (AC #5).** The idempotency key is minted ONCE, at stage time, and carried unchanged
through to the engine `recordInteraction` call at settle time (0065 Part B — the engine dedups a
repeated key and returns the prior eventId without re-folding). A settle that fails on a transient
error re-stages the SAME entry (same key) for the next opportunity rather than dropping it
(mandate #4 — a validated fold must never silently evaporate) — a retry of an already-applied
fold is a no-op fold-wise by construction, never a double-apply.

**T9 doctrine — the FALLBACK not built here.** The issue also specs a compensating-retract path
(commit immediately, then issue an "un-fold" if the take turns out to have been superseded) as a
fallback for a seam where deferral proves infeasible. No such seam exists on this issue's build
surface (staging is a plain in-process dict write with nowhere it can fail before the engine is
ever touched), so retract is NOT implemented — only documented here per the T9 doctrine ("if you
implement deferral, note the retract design as the designated fallback, don't build both"). Were
it ever needed, the shape would be: `record_interaction` grows an explicit `retract` verb/flag
keyed by the ORIGINAL `idempotencyKey` (already unique per scene), which the engine resolves to
the exact prior fold and reverses it via the SAME bounded/seeded magnitude math it applied
forward — never a raw-number roll-back the FE could game. Do not build this unless a real seam
forces it (e.g. a settle point that can only run AFTER the engine has already committed).

**Bounded / Vault-free / in-memory (mirrors `routes/chat_helpers.py`'s `_DEFERRED_FOLDS`/
`_LAST_BEAT_SEQ`, the established pattern for exactly this class of short-lived, per-owner FE
bookkeeping).** The staged payload is the SAME open-set descriptor `_auto_record_scene` already
validates before it ever reaches here (roster-checked ids, closed-enum kind/direction/emphasis,
truncated content) — nothing secret, nothing engine-authoritative; the engine still owns the fold
magnitude at settle time exactly as it always has. Process-restart loses an unsettled entry (the
same tradeoff `_DEFERRED_FOLDS` already accepts) — acceptable here because the settle window is
one HTTP round trip at most, far shorter than that queue's multi-turn retry horizon.
"""

from __future__ import annotations

from typing import Any, Optional

# (owner, session_id) -> staged fold payload. At most one entry per key — see module docstring.
_PENDING: dict[tuple, dict] = {}


def _key(owner: Optional[str], session_id: Optional[str]) -> tuple:
    return (owner, session_id)


def stage_pending_fold(owner: Optional[str], session_id: Optional[str], *, content: str,
                        with_ids: list, kind: str, consequence: Optional[dict],
                        felt_minutes: Optional[int], idempotency_key: str) -> None:
    """Stage a validated scene-fold payload for this (owner, session), overwriting any prior
    unsettled entry (settle always drains before a new stage can happen — see module docstring;
    an overwrite here would only mean a settle was skipped somewhere, never a real double-scene)."""
    _PENDING[_key(owner, session_id)] = {
        "content": content,
        "with_ids": with_ids,
        "kind": kind,
        "consequence": consequence,
        "felt_minutes": felt_minutes,
        "idempotency_key": idempotency_key,
    }


def pop_pending_fold(owner: Optional[str], session_id: Optional[str]) -> Optional[dict]:
    """Remove and return the staged fold for this (owner, session), or None if there isn't one.
    The caller (settle) owns re-staging on a failed commit — this module never retries on its
    own."""
    return _PENDING.pop(_key(owner, session_id), None)


def discard_pending_fold(owner: Optional[str], session_id: Optional[str]) -> bool:
    """#1728 — the supersede-cancel half of defer-fold-to-settle: called from the truncate route
    whenever a session's tail is cut, unconditionally, so a superseded take's staged fold NEVER
    reaches the engine. Returns True if an entry was actually discarded (for logging/telemetry)."""
    return _PENDING.pop(_key(owner, session_id), None) is not None


def has_pending_fold(owner: Optional[str], session_id: Optional[str]) -> bool:
    return _key(owner, session_id) in _PENDING


def clear_all() -> None:
    """Test-only reset."""
    _PENDING.clear()

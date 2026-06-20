"""Feature 0064 — the per-game (== per canonical session) TURN LOCK.

One game must have ONE reasoning chain. With two devices on the canonical session (0064 §A), a
second device's submit would otherwise reach `agent_runs.start`, which CANCELS the in-flight run for
that session (it was built for one device's rapid double-send) — stomping the first device's turn
mid-stream and, worse, starting a second LLM reasoning chain writing into the one shared engine
intake.

This lock makes that structurally impossible. The game chat route ACQUIRES the lock before starting
a game-framed run and RELEASES it when the run reaches a terminal state. While held by a DIFFERENT
driver, a second device's game-turn submit is refused with a typed 409 (the route turns the caller
into a live spectator with a Take-over affordance) instead of stomping.

Two identities matter:

  * the DRIVER token (per device/tab) decides the 409 — the SAME driver re-acquiring (its own rapid
    double-send / retry / reconnect) is NOT a second chain and succeeds;
  * a per-acquisition FENCE (a monotonic counter) makes release SAFE under the existing replace-on-
    double-send behavior: when a device's turn-2 replaces its own turn-1, turn-1's terminal callback
    must NOT free turn-2's hold. Release only frees the lock if the caller holds the CURRENT fence.

In-memory, per server process (like `agent_runs` / `session_events`). An FE restart drops the
in-flight run AND clears the lock (fail-open — a new turn can be driven; no run survives a restart by
design). Vault-free: session ids + opaque tokens only, never game state.
"""

from __future__ import annotations

import threading
import uuid
from typing import Dict, Optional, Tuple

# session_id -> (driver token, fence). The fence increments on every (re)acquire so a late terminal
# callback from a replaced run can't free the current hold.
_HELD: Dict[str, Tuple[str, int]] = {}
_LOCK = threading.Lock()


class Hold:
    """An opaque acquisition receipt. Carries the driver token (for the 409 decision) and the fence
    that authorizes its own release. Falsy semantics: a refused acquire returns None, not a Hold."""

    __slots__ = ("driver", "fence")

    def __init__(self, driver: str, fence: int) -> None:
        self.driver = driver
        self.fence = fence


def acquire(session_id: str, driver: Optional[str] = None) -> Optional[Hold]:
    """Try to take the turn for `session_id`.

    Returns a `Hold` receipt on success (driver + the current fence), or ``None`` if the turn is
    already held by a DIFFERENT driver (the caller is a spectator). Re-acquiring with the SAME driver
    token succeeds and bumps the fence (the device's own retry/double-send replaces its prior hold —
    still ONE chain).
    """
    token = driver or uuid.uuid4().hex
    if not session_id:
        return Hold(token, 0)
    with _LOCK:
        cur = _HELD.get(session_id)
        if cur is None or cur[0] == token:
            fence = (cur[1] + 1) if cur is not None else 1
            _HELD[session_id] = (token, fence)
            return Hold(token, fence)
        return None


def release(session_id: str, hold: Optional[Hold] = None) -> None:
    """Release the turn for `session_id`.

    With a `Hold`, only the holder of the CURRENT fence may free it (a stale terminal callback from a
    replaced run is a no-op — it never unlocks a newer turn). With ``None`` (the take-over / Stop
    path), release unconditionally.
    """
    if not session_id:
        return
    with _LOCK:
        cur = _HELD.get(session_id)
        if cur is None:
            return
        if hold is None:
            _HELD.pop(session_id, None)
            return
        if cur[0] == hold.driver and cur[1] == hold.fence:
            _HELD.pop(session_id, None)


def holder(session_id: str) -> Optional[str]:
    """The driver token currently holding `session_id`, or None if free."""
    with _LOCK:
        cur = _HELD.get(session_id)
        return cur[0] if cur is not None else None


def is_held(session_id: str) -> bool:
    return holder(session_id) is not None


def clear(session_id: str) -> None:
    """Force-free a session (tests / a hard reset)."""
    with _LOCK:
        _HELD.pop(session_id, None)

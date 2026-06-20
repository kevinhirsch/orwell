"""Feature 0064 — the per-game turn lock (one driver at a time).

One game must have ONE reasoning chain. With two devices on the canonical session, a second
device's submit must NOT stomp the first's run (agent_runs.start cancels the prior run for a
session) and must NOT start a second chain. The lock makes that structurally impossible:

  * while a game turn is held, a DIFFERENT driver's acquire is REFUSED (the route turns that into a
    409 turn-in-progress + live spectator, never a stomp);
  * the SAME driver re-acquiring succeeds (its own retry/double-send is not a second chain) and the
    older hold can no longer free the lock (fence-scoped release);
  * release frees the turn so the next device can drive;
  * the take-over path (an unconditional release) frees a stuck turn.

Roles only — driver tokens are opaque per-device markers, never names.
"""

import importlib

import pytest

lock = importlib.import_module("src.game_turn_lock")


@pytest.fixture(autouse=True)
def _clean():
    lock.clear("s")
    yield
    lock.clear("s")


def test_a_second_driver_is_refused_while_a_turn_is_held():
    first = lock.acquire("s", "device-A")
    assert first is not None and first.driver == "device-A"
    assert lock.is_held("s")
    # A DIFFERENT device's submit is refused (None) — the route returns 409 instead of stomping.
    assert lock.acquire("s", "device-B") is None
    assert lock.holder("s") == "device-A"  # the first driver still owns the turn


def test_the_same_driver_can_reacquire():
    h1 = lock.acquire("s", "device-A")
    # The same device's retry/double-send is allowed (still ONE reasoning chain), and bumps the fence.
    h2 = lock.acquire("s", "device-A")
    assert h1 is not None and h2 is not None
    assert h2.fence > h1.fence


def test_a_stale_hold_cannot_free_a_newer_acquisition():
    """The replace-on-double-send case: device-A's turn-2 replaces its turn-1. Turn-1's terminal
    callback must NOT free turn-2's hold (or a third device could sneak in)."""
    h1 = lock.acquire("s", "device-A")  # turn 1
    h2 = lock.acquire("s", "device-A")  # turn 2 replaces it (same driver)
    lock.release("s", h1)               # turn 1's late terminal callback — must be a no-op
    assert lock.holder("s") == "device-A"
    assert lock.acquire("s", "device-B") is None  # still held by A's turn 2
    lock.release("s", h2)
    assert not lock.is_held("s")


def test_release_frees_the_turn_for_the_next_device():
    h = lock.acquire("s", "device-A")
    lock.release("s", h)
    assert not lock.is_held("s")
    # Now the other device can drive the NEXT turn.
    assert lock.acquire("s", "device-B") is not None


def test_unconditional_release_is_the_take_over_path():
    lock.acquire("s", "device-A")
    # POST /api/chat/stop releases unconditionally so a take-over always frees a stuck turn.
    lock.release("s")
    assert not lock.is_held("s")


def test_a_missing_session_id_never_holds():
    # Defensive: an empty session id returns a Hold but never registers a lock.
    h = lock.acquire("", "device-A")
    assert h is not None
    assert not lock.is_held("")


def test_a_fresh_acquire_mints_a_token_when_none_is_given():
    h = lock.acquire("s")
    assert h is not None and h.driver
    assert lock.holder("s") == h.driver
    # A different (None-token) caller now races a fresh mint — refused, because the slot is held.
    assert lock.acquire("s") is None


def test_lock_route_source_guards_the_stream():
    """Drift pin: the chat stream route must take the lock before agent_runs.start for a framed turn,
    and refuse with a 409 turn-in-progress instead of stomping the live run."""
    import os

    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "chat_routes.py"
    )
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    assert "game_turn_lock.acquire(session, driver_token)" in src
    assert "turn-in-progress" in src
    assert "game_turn_lock.release(session_id)" in src  # the take-over / stop path

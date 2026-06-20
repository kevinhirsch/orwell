"""Feature 0064 — the canonical per-user game chat session.

Two devices for one account must converge on ONE game session id (so the engine's one-game-per-user
posture is mirrored in the FE and the existing cross-device sync engages). Verified here:

  * two CONCURRENT first-opens for one user return the SAME id (idempotent under concurrency);
  * a different user gets a DIFFERENT id (cross-user isolation, 0021);
  * a season reset / new season ROTATES the binding (no dead-season transcript bleed);
  * a stored id that no longer exists is RE-MINTED;
  * the resolve never returns another user's session.

No names — roles only (the player, a second player, a device). The session-minting/exists hooks are
injected so the suite needs neither a DB nor a running engine.
"""

import importlib
import threading

import pytest

ogs = importlib.import_module("src.orwell_game_session")


@pytest.fixture(autouse=True)
def _isolate_store(tmp_path, monkeypatch):
    """Point the store at a temp file and reset the in-module lock so each test starts clean."""
    store = tmp_path / "orwell_game_session.json"
    monkeypatch.setattr(ogs, "GAME_SESSION_PATH", store)
    yield


def _counter_mint():
    """A mint() that hands out monotonically increasing ids, so a duplicate mint is detectable."""
    box = {"n": 0}

    def mint():
        box["n"] += 1
        return f"sess-{box['n']}"

    return mint, box


def test_two_concurrent_first_opens_resolve_the_same_id():
    """The whole point: two devices hitting resolve at the same instant get ONE session, never two."""
    mint, box = _counter_mint()
    minted = set()  # every id mint() ever produced
    mint_lock = threading.Lock()

    def tracked_mint():
        sid = mint()
        with mint_lock:
            minted.add(sid)
        return sid

    results = []
    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()  # release all threads together to maximize the race
        sid, _created = ogs.resolve_game_session(
            "player", mint=tracked_mint, exists=lambda s: True
        )
        results.append(sid)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(set(results)) == 1, "all devices must converge on one session id"
    assert results[0] == ogs.get_game_session("player")


def test_a_different_user_never_shares_a_session():
    mint, _ = _counter_mint()
    a, _ = ogs.resolve_game_session("player-a", mint=mint, exists=lambda s: True)
    b, _ = ogs.resolve_game_session("player-b", mint=mint, exists=lambda s: True)
    assert a != b
    # And neither resolve can ever return the other user's id.
    assert ogs.get_game_session("player-a") == a
    assert ogs.get_game_session("player-b") == b


def test_second_open_for_same_user_reuses_the_bound_session():
    mint, box = _counter_mint()
    first, created1 = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    assert created1 is True
    second, created2 = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    assert created2 is False
    assert first == second
    assert box["n"] == 1, "the second open must NOT mint a second session"


def test_clear_rotates_the_session_for_a_new_season():
    mint, _ = _counter_mint()
    first, _ = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    ogs.clear_game_session("player")  # the season-reset rotation
    assert ogs.get_game_session("player") is None
    second, created = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    assert created is True
    assert second != first, "a reset must bind a FRESH session (no dead-season bleed-through)"


def test_a_stale_stored_id_is_re_minted():
    mint, _ = _counter_mint()
    first, _ = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    # The bound session no longer exists (deleted out-of-band): a resolve must re-mint, not return
    # the dead id.
    second, created = ogs.resolve_game_session("player", mint=mint, exists=lambda s: False)
    assert created is True
    assert second != first


def test_a_transient_exists_failure_keeps_the_bound_id():
    """If we can't tell whether the stored session still exists, never split the live game by
    re-minting — keep the bound id."""
    mint, box = _counter_mint()
    first, _ = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)

    def boom(_s):
        raise RuntimeError("DB hiccup")

    again, created = ogs.resolve_game_session("player", mint=mint, exists=boom)
    assert created is False
    assert again == first
    assert box["n"] == 1


def test_a_corrupt_store_never_raises():
    ogs.GAME_SESSION_PATH.write_text("{not json", encoding="utf-8")
    assert ogs.get_game_session("player") is None  # falls back to "nobody bound"
    mint, _ = _counter_mint()
    sid, created = ogs.resolve_game_session("player", mint=mint, exists=lambda s: True)
    assert created is True and sid

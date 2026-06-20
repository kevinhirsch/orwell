"""Feature 0064 — the per-user CANONICAL game chat session.

The engine enforces one active game per user (0021); the front-end is a
multi-session chat app, so without a binding every device picks (or mints) its
OWN chat session and the single game splits into parallel conversations. This
store is that binding: `user -> game_session_id`. Every device resolves THIS
session and opens it, so all screens converge on one conversation and the
existing cross-device sync (`session_events` + `agent_runs` + `sessionSync.js`)
finally engages (it is keyed by `session_id`).

Mirrors `orwell_seasons.py`: a small JSON map in ``DATA_DIR``, atomically
written, lock-guarded, keyed by the same `_current_user` identity the rest of
the Orwell relay uses. Vault-free by construction — a session **id** carries no
game secret (the secret state lives behind the engine's Vault Wall, never here).

The factory-reset scrub of ``data/`` already takes it back to OOBE; a season
reset / new-season rotates it explicitly (``clear_game_session``) so a dead
season's transcript never rides as narrator context.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

# Plain JSON map {username: session_id}. Small, human-readable, atomically written.
GAME_SESSION_PATH = Path(DATA_DIR) / "orwell_game_session.json"

# A single process-wide lock makes resolve-or-mint idempotent under concurrency:
# two devices hitting GET /api/orwell/game-session at the same instant serialize
# through here, so the first writer wins and the racing second caller reads back
# the just-written id (re-check inside the lock before minting). This is the
# whole point of the canonical session.
_LOCK = threading.RLock()


def _load() -> dict:
    try:
        return json.loads(GAME_SESSION_PATH.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the game: fall back to "nobody bound".
        return {}


def _key(user: Optional[str]) -> str:
    # A missing user maps to the same "default" bucket the engine uses for
    # single-user posture (identical to orwell_seasons._key).
    return (user or "default").strip() or "default"


def get_game_session(user: Optional[str]) -> Optional[str]:
    """The user's bound game session id, or None if none is bound yet."""
    with _LOCK:
        raw = _load().get(_key(user))
    return raw if isinstance(raw, str) and raw else None


def set_game_session(user: Optional[str], session_id: str) -> None:
    """Bind the user's canonical game session id (atomic, lock-guarded)."""
    if not session_id:
        return
    k = _key(user)
    with _LOCK:
        data = _load()
        data[k] = session_id
        atomic_write_json(str(GAME_SESSION_PATH), data, indent=2)


def clear_game_session(user: Optional[str]) -> None:
    """Unbind the user's canonical session (season reset / new season). The next
    resolve mints a clean session for the new season."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            data.pop(k, None)
            atomic_write_json(str(GAME_SESSION_PATH), data, indent=2)


def resolve_game_session(user: Optional[str], *, mint, exists) -> tuple[str, bool]:
    """Resolve-or-mint the user's canonical session, idempotent under concurrency.

    Holds the store lock across the whole resolve so two simultaneous first-calls
    return the SAME id (first writer wins; the racing caller re-reads it). Mints a
    fresh session (binding it) when the stored id is missing, no longer exists, or
    is unusable.

      mint()  -> a freshly created, user-owned session id (called inside the lock).
      exists(session_id) -> bool: whether the stored id is still a real, owned
                            session (a stale id — deleted session, ownership lost —
                            is re-minted).

    Returns (session_id, created).
    """
    with _LOCK:
        data = _load()
        k = _key(user)
        cur = data.get(k)
        if isinstance(cur, str) and cur:
            try:
                still_there = bool(exists(cur))
            except Exception:
                # If we can't tell, prefer the stored id over re-minting (never
                # split the game on a transient check failure).
                still_there = True
            if still_there:
                return cur, False
        # Missing / stale / unusable — mint and bind a fresh one.
        new_id = mint()
        data[k] = new_id
        atomic_write_json(str(GAME_SESSION_PATH), data, indent=2)
        return new_id, True

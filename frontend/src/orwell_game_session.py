"""Feature 0064 — the per-user CANONICAL game chat session.

The engine enforces one active game per user (0021); the front-end is a multi-session chat app,
so without this binding every device opens its OWN chat and independently drives the one shared
game — two producers, two reasoning chains (the reported two-device bug). This store records the
ONE chat session id that IS the game for a user, so every device converges on it and the existing
cross-device live-sync (`session_events` + `agent_runs` + `sessionSync.js`) engages.

Lives in the FE (chat sessions are FE-owned), mirroring `orwell_seasons.py`: a small JSON map in
``DATA_DIR``, atomically written, keyed by the same user identity the rest of the Orwell relay uses
(`_current_user`). Vault-free by construction — a session **id** carries no game secret. The
factory-reset scrub of ``data/`` takes it back to OOBE; the in-app reset doors clear it explicitly
so a dead season's transcript never narrates the next one.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

# Plain JSON map {username: session_id}. Small, human-readable, atomically written.
GAME_SESSION_PATH = Path(DATA_DIR) / "orwell_game_session.json"

_LOCK = threading.Lock()


def _load() -> dict:
    try:
        return json.loads(GAME_SESSION_PATH.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the game: fall back to "nobody is bound yet".
        return {}


def _key(user: str | None) -> str:
    # A missing user maps to the same "default" bucket the engine uses for single-user posture.
    return (user or "default").strip() or "default"


def get_game_session(user: str | None) -> str | None:
    """The user's bound canonical game session id, or None when nothing is bound yet."""
    with _LOCK:
        raw = _load().get(_key(user))
    if isinstance(raw, str) and raw.strip():
        return raw
    return None


def bind_game_session(user: str | None, session_id: str) -> str:
    """Bind `session_id` as the user's canonical game session — FIRST-WRITER-WINS.

    Idempotent and concurrency-safe (the whole point): if a session is ALREADY bound, the existing
    id is kept and returned (a racing second device adopts it); otherwise `session_id` is bound and
    returned. Returns the EFFECTIVE bound id either way, so the caller always learns which session
    every device should converge on.
    """
    k = _key(user)
    sid = (session_id or "").strip()
    if not sid:
        # Nothing usable to bind — report whatever is already bound (or empty).
        return get_game_session(user) or ""
    with _LOCK:
        data = _load()
        existing = data.get(k)
        if isinstance(existing, str) and existing.strip():
            return existing  # first writer already won; the caller adopts it
        data[k] = sid
        atomic_write_json(str(GAME_SESSION_PATH), data, indent=2)
        return sid


def publish_game_updated(user: str | None) -> None:
    """0064 §B/D (#617) — server-push a "game-updated" ping to every device on the user's canonical
    game session so open pages reconcile their HUD instantly instead of waiting for the next poll.

    Shared helper so BACKGROUND FE-driven write-backs (cast authoring, prewarm, zeitgeist, off-screen
    texture) can fire the same push the route layer's `_publish_game_updated` does after a mutation —
    those enrichment tasks mutate engine state but historically never pushed, leaving pages stale
    (SYNC-STALE). Vault-free: a session id + a change-type string only, no body. Best-effort — a
    publish failure (no binding yet, no event bus) must never break the background task."""
    try:
        from src import session_events
        sid = get_game_session(user)
        if sid:
            session_events.publish(sid, "game-updated")
    except Exception:
        pass


def clear_game_session(user: str | None) -> None:
    """Unbind the user's canonical game session (a season reset / new season). The next resolve
    mints a clean binding for the new season, so a dead season's transcript never rides along."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            del data[k]
            atomic_write_json(str(GAME_SESSION_PATH), data, indent=2)

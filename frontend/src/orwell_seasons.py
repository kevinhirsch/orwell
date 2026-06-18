"""Feature 0057 — per-user season number ("level") progression.

A completed season is a LEVEL. Starting the NEXT season increments the user's season number;
resetting progress mid-season does NOT (you restart the current level, you never skip ahead).

The number is per-USERNAME meta-progression that must survive the engine's per-season sandbox
reset (`forgetUser` rotates the save) — so it lives HERE, in the FE store, NOT in the engine
(which stays cleanly season-scoped, one sandbox = one season). Co-located in the FE ``data/`` dir
so the existing factory-reset scrub of ``data/`` takes it back to season 1 (OOBE), while the
in-app reset-progress action deliberately leaves it untouched.

Vault-free by construction: a season COUNT carries no game secret. Keyed by the same user
identity the rest of the Orwell relay uses (`_current_user`).
"""

from __future__ import annotations

import threading
from pathlib import Path

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

# Plain JSON map {username: season_number}. Small, human-readable, atomically written.
SEASONS_PATH = Path(DATA_DIR) / "orwell_seasons.json"

_LOCK = threading.Lock()


def _load() -> dict:
    try:
        import json
        return json.loads(SEASONS_PATH.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the game: fall back to "everyone is season 1".
        return {}


def _key(user: str | None) -> str:
    # A missing user maps to the same "default" bucket the engine uses for single-user posture.
    return (user or "default").strip() or "default"


def get_season(user: str | None) -> int:
    """The user's current season number (1-based). Defaults to 1 for anyone never incremented."""
    with _LOCK:
        raw = _load().get(_key(user))
    try:
        n = int(raw)
        return n if n >= 1 else 1
    except (TypeError, ValueError):
        return 1


def increment_season(user: str | None) -> int:
    """Advance the user to the NEXT season (level cleared). Returns the new number."""
    k = _key(user)
    with _LOCK:
        data = _load()
        cur = data.get(k)
        try:
            cur = int(cur)
            if cur < 1:
                cur = 1
        except (TypeError, ValueError):
            cur = 1
        data[k] = cur + 1
        atomic_write_json(str(SEASONS_PATH), data, indent=2)
        return data[k]


def reset_season(user: str | None) -> int:
    """Back to season 1 (used by a full account/factory reset, NOT the in-app reset-progress)."""
    k = _key(user)
    with _LOCK:
        data = _load()
        data[k] = 1
        atomic_write_json(str(SEASONS_PATH), data, indent=2)
        return 1

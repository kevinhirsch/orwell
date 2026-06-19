"""Calibration instrumentation — the per-user, append-only season-OUTCOME log.

The owner's calibration question ("passive players coast to Final 2 and lose there — is
that emergent realism or a degenerate plateau?") needs real playtest data, not more guesses.
This is the gather-data-first half: when a season FINISHES, we durably record the PUBLIC,
player-known outcome facts a calibration review needs:

  * the player's final PLACEMENT (winner | runner-up | jury | evicted),
  * how many recorded SOCIAL SCENES the player had (the "did they play a social game?" axis),
  * the player's PUBLIC competition wins (HOH / veto / the final HOH — their visible resume),
  * the final jury-vote MARGIN (how close the finale was).

These are all Vault-FREE, post-finale PUBLIC facts (the same facts the player themselves can
see in the recap / finale reveal / their own Journal). Nothing hidden is recorded — we log
ONLY once the season is over and the outcome is revealed, never pre-reveal hidden state.

Co-located with ``orwell_seasons.py`` in the FE ``data/`` dir (so the existing factory-reset
scrub of ``data/`` takes it back to empty, while the game-only reset leaves it — playtest data
is meta-progression, like the season number). Append-only and IDEMPOTENT per (user, season,
winner-signature): a poll that re-observes the same finished season never double-logs it.

Keyed by the same ``_current_user`` identity the rest of the Orwell relay uses.
"""

from __future__ import annotations

import json
import threading
import time as _time
from pathlib import Path

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

# Plain JSON map {username: [outcome, outcome, ...]}. Small, human-readable, atomically written.
OUTCOMES_PATH = Path(DATA_DIR) / "orwell_outcomes.json"

_LOCK = threading.Lock()

# Keep the per-user log bounded so a long-lived box can't grow it without limit (a calibration
# review wants the recent shape, not an unbounded archive). Generous: dozens of seasons.
_MAX_PER_USER = 200


def _load() -> dict:
    try:
        return json.loads(OUTCOMES_PATH.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the game: fall back to "no log yet".
        return {}


def _key(user: str | None) -> str:
    # A missing user maps to the same "default" bucket the engine uses for single-user posture.
    return (user or "default").strip() or "default"


def _signature(season: int, placement: str, winner_name: str | None) -> str:
    """The idempotency key for a finished season: a poll that re-observes the SAME finished
    season (same level, same outcome, same crowned winner) must never append a duplicate row."""
    return f"{int(season)}|{placement}|{(winner_name or '').strip().lower()}"


def record_outcome(
    user: str | None,
    *,
    season: int,
    placement: str,
    social_scenes: int,
    competition_wins: int,
    jury_margin: int | None,
    winner_name: str | None = None,
    weeks_played: int | None = None,
) -> bool:
    """Append one finished-season outcome row for ``user`` — IDEMPOTENT per (season, placement,
    winner). Returns True if a NEW row was appended, False if this exact finished season was
    already logged (the common case for a poll firing every couple of seconds at the finale).

    All inputs are public, revealed facts — the caller derives them from the engine's Vault-free
    projections AFTER the season is over. This store records; it never reads game state itself.
    """
    sig = _signature(season, placement, winner_name)
    k = _key(user)
    with _LOCK:
        data = _load()
        rows = data.get(k)
        if not isinstance(rows, list):
            rows = []
        # Idempotency: never double-log the same finished season.
        if any(isinstance(r, dict) and r.get("signature") == sig for r in rows):
            return False

        row = {
            "signature": sig,
            "season": int(season),
            "placement": placement,
            "socialScenes": int(social_scenes),
            "competitionWins": int(competition_wins),
            "juryMargin": (int(jury_margin) if jury_margin is not None else None),
            "winnerName": winner_name,
            "weeksPlayed": (int(weeks_played) if weeks_played is not None else None),
            "recordedAt": _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime()),
        }
        rows.append(row)
        # Keep the per-user log bounded (oldest dropped first).
        if len(rows) > _MAX_PER_USER:
            rows = rows[-_MAX_PER_USER:]
        data[k] = rows
        atomic_write_json(str(OUTCOMES_PATH), data, indent=2)
        return True


def outcomes_for(user: str | None) -> list:
    """Every recorded outcome row for one user, oldest first. ``[]`` when none."""
    with _LOCK:
        rows = _load().get(_key(user))
    return list(rows) if isinstance(rows, list) else []


def all_outcomes() -> dict:
    """The whole log, keyed by user — for the admin calibration read. Returns {} when empty."""
    with _LOCK:
        data = _load()
    return {u: (rows if isinstance(rows, list) else []) for u, rows in data.items()}


def reset_outcomes(user: str | None) -> None:
    """Drop one user's outcome log (used by a full account/factory reset path)."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            del data[k]
            atomic_write_json(str(OUTCOMES_PATH), data, indent=2)

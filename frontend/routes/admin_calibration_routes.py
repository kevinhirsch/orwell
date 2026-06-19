"""Calibration instrumentation — the ADMIN read over the per-season outcome log.

Mirrors the 0053 admin-transcript pattern (ruling #14, quiet debug access): a read-ONLY,
``require_admin``-gated API for the app administrator (the 0029 account tier, NOT God Mode)
to review the durable per-user season-OUTCOME log that ``orwell_outcomes.py`` accrues when
seasons finish. This is the "gather real playtest data first" half of the calibration lane —
it lets the operator see, across real games, how often a passive vs. an engaged player coasts
to a goat seat and loses there (the open calibration question), instead of guessing.

  GET /api/admin/calibration/outcomes            — the whole log, keyed by user
  GET /api/admin/calibration/outcomes?user=NAME  — one user's outcome rows

Boundaries (same shape as the transcript routes):
  * VAULT-FREE BY CONSTRUCTION — every row is a public, post-finale, player-known outcome fact
    (placement / social-scene count / public comp wins / final jury margin). The log is written
    only AFTER a season is over and revealed; no hidden or pre-reveal state ever enters it. The
    Vault Wall is enforced upstream at the engine's tool boundary, never re-litigated here.
  * READ-ONLY — there is no edit/delete verb on this surface.
  * Survives the game-only reset (the FE ``data/`` store is preserved) and dies with the factory
    reset (which scrubs ``data/``) — by construction, like the season number it sits beside.
"""

import logging

from fastapi import APIRouter, Request

from core.middleware import require_admin
from src import orwell_outcomes

logger = logging.getLogger(__name__)


def _summarize(rows: list) -> dict:
    """A small, Vault-free roll-up over a user's rows — placement counts + average social scenes —
    so the operator gets the calibration shape at a glance without re-deriving it client-side."""
    placements: dict = {}
    social_total = 0
    counted = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        p = r.get("placement")
        if p:
            placements[p] = placements.get(p, 0) + 1
        s = r.get("socialScenes")
        if isinstance(s, int):
            social_total += s
            counted += 1
    return {
        "seasons": len([r for r in rows if isinstance(r, dict)]),
        "placements": placements,
        "avgSocialScenes": (round(social_total / counted, 2) if counted else None),
    }


def setup_admin_calibration_routes() -> APIRouter:
    router = APIRouter(prefix="/api/admin/calibration", tags=["admin_calibration"])

    @router.get("/outcomes")
    def list_outcomes(request: Request, user: str | None = None):
        require_admin(request)
        if user:
            rows = orwell_outcomes.outcomes_for(user)
            return {"user": user, "outcomes": rows, "summary": _summarize(rows)}
        everyone = orwell_outcomes.all_outcomes()
        return {
            "outcomes": everyone,
            "summary": {u: _summarize(rows) for u, rows in everyone.items()},
        }

    return router

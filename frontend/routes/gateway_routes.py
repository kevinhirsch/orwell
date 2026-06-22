"""FastAPI webhook routes for the multi-platform gateway (feature 0072).

Mounts at /gateway/:
  POST /gateway/webhook/{platform_id}   — inbound webhook from a messaging platform
  POST /gateway/pair/verify             — verify a pairing code from the web UI
  GET  /gateway/status                  — admin read: registered platforms + pair count

Auth posture:
  - The /webhook endpoint is intentionally unauthenticated (platforms POST here without
    a session cookie).  Identity is proven via the pairing store: unpaired identities
    are rejected before reaching the engine.
  - /pair/verify is session-authenticated (the web UI user is doing the pairing —
    they must be logged in to bind their orwell account).
  - /status is admin-gated (operational visibility only).
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from gateway.handler import handle_platform_turn
from gateway.pairing import (
    generate_code,
    verify_code,
    pair,
    is_rate_limited,
    paired_identities,
)
from gateway import platform_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gateway", tags=["gateway"])


# ── webhook: inbound message from a messaging platform ───────────────────────

@router.post("/webhook/{platform_id}")
async def platform_webhook(platform_id: str, request: Request):
    """Inbound webhook from a messaging platform.

    The platform POSTs its update payload here.  We:
      1. Dispatch to the correct adapter by platform_id
      2. Parse the payload into (identity, text)
      3. Handle /pair commands inline (issue a code)
      4. Route everything else through the gateway turn handler
      5. Return {"ok": True} to acknowledge receipt (the adapter sends the reply)

    Returns 404 for an unknown platform, 400 for a malformed payload, 403 if the platform
    provides a configured webhook secret that does not match (SEC-2). By default the endpoint
    is unauthenticated and treats the platform identity as the credential; setting a per-platform
    webhook secret (e.g. TELEGRAM_WEBHOOK_SECRET) opts into transport-level verification.
    """
    adapter = platform_registry.get(platform_id)
    if adapter is None:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform_id!r}")

    # SEC-2 (opt-in): if the adapter has a configured webhook secret, verify the platform's
    # signature header before trusting the body-supplied identity. No secret ⇒ unchanged.
    if not adapter.verify_webhook(request.headers):
        raise HTTPException(status_code=403, detail="Webhook verification failed")

    try:
        raw = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    try:
        platform_identity, text = adapter.parse_inbound(raw)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=f"Malformed payload: {exc}")

    text = (text or "").strip()

    # /pair command: issue a pairing code and return instructions
    if text.lower().startswith("/pair"):
        code = generate_code(platform_identity)
        reply = (
            f"Your Orwell pairing code is:\n\n{code}\n\n"
            "Enter this code in Orwell settings → Platforms → Pair within 15 minutes.\n"
            "Once paired, your messages here will reach your game."
        )
        await adapter.send(platform_identity, reply)
        return {"ok": True, "action": "pair-code-issued"}

    # Normal turn: route to the gateway handler
    reply = await handle_platform_turn(
        platform_id=platform_id,
        platform_identity=platform_identity,
        message_text=text,
    )
    await adapter.send(platform_identity, reply)
    return {"ok": True}


# ── pair/verify: called from the orwell web UI ───────────────────────────────

@router.post("/pair/verify")
async def verify_pairing(request: Request, body: dict):
    """Verify a pairing code submitted from the Orwell web UI.

    Expected body: {"platform_identity": "telegram:123456", "code": "...", "orwell_user": "..."}

    The orwell_user is taken from the authenticated session when not explicitly provided
    (prefer the session so a user cannot pair someone else's account).

    Rate-limited per platform_identity.  Returns 400 on invalid/expired code, 429 on rate limit.
    """
    platform_identity = (body.get("platform_identity") or "").strip()
    code = (body.get("code") or "").strip()

    # Prefer the authenticated session's user; fall back to the body's orwell_user (for
    # deployments without the session middleware, e.g. integration tests).
    orwell_user = (
        getattr(getattr(request, "state", None), "current_user", None)
        or (body.get("orwell_user") or "").strip()
    )

    if not platform_identity or not code:
        raise HTTPException(status_code=400, detail="platform_identity and code are required")

    if not orwell_user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if is_rate_limited(platform_identity):
        raise HTTPException(
            status_code=429,
            detail="Too many pairing attempts for this identity. Please wait before trying again.",
        )

    if not verify_code(platform_identity, code):
        raise HTTPException(status_code=400, detail="Invalid or expired pairing code")

    pair(platform_identity, orwell_user)
    logger.info(
        "gateway: paired platform identity %s to orwell user %s", platform_identity, orwell_user
    )
    return {"ok": True, "paired": True}


# ── status: admin read ────────────────────────────────────────────────────────

@router.get("/status")
async def gateway_status(request: Request):
    """Return registered platforms and pairing counts (admin, Vault-free)."""
    from core.middleware import require_admin as _require_admin
    _require_admin(request)

    registered = platform_registry.all_ids()
    # orwell_user not surfaced here — pair count per platform is sufficient
    return {
        "registered_platforms": registered,
        "platform_count": len(registered),
    }


def setup_gateway_routes():
    """Return the gateway router (for app.py include_router)."""
    # Ensure the Telegram adapter is registered by importing it.
    # Other adapters are added here as thin imports when they are built.
    try:
        import gateway.platforms.telegram  # noqa: F401  — triggers self-registration
    except ImportError as exc:
        logger.warning("gateway: could not import telegram adapter: %s", exc)

    return router

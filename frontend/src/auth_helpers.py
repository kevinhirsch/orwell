"""Shared auth helpers used by all route files."""

import os
from typing import Any, Optional
from fastapi import Request, HTTPException


# Process-level AuthManager singleton (issue #966).
#
# ``AuthManager.__init__`` re-reads ``auth.json`` + ``sessions.json`` from disk
# and logs ("Auth config loaded" / "Loaded N session(s) from disk") on every
# construction. The app holds ONE instance at ``app.state.auth_manager``
# (``app.py``), but several hot per-request / system code paths used to build a
# fresh ``AuthManager()`` each call — producing the ~60s log spam + wasted I/O.
#
# These helpers resolve that one shared instance. The request-scoped app state
# is preferred (so a single app owns the live sessions/cookies); a lazily-built
# module-level instance is the last-resort fallback for request-free / system
# code paths (e.g. the portrait pipeline, background tasks, the daily brief),
# which previously each constructed their own.
_SHARED_AUTH_MANAGER: Any = None


def shared_auth_manager(request: Optional[Request] = None) -> Any:
    """Return the one shared :class:`AuthManager`, never re-reading per call.

    Resolution order:
      1. ``request.app.state.auth_manager`` — the live app singleton, when a
         request context is available.
      2. A process-level cached instance — lazily built ONCE for request-free
         system paths, then reused.

    Construction of ``AuthManager`` is the slow/log-spammy part, so it happens
    at most once here outside the app's own startup instance.
    """
    global _SHARED_AUTH_MANAGER
    if request is not None:
        state = getattr(getattr(request, "app", None), "state", None)
        mgr = getattr(state, "auth_manager", None)
        if mgr is not None:
            return mgr
    if _SHARED_AUTH_MANAGER is None:
        from core.auth import AuthManager
        _SHARED_AUTH_MANAGER = AuthManager()
    return _SHARED_AUTH_MANAGER


def get_current_user(request: Request) -> Optional[str]:
    """Get current username from request state (set by auth middleware)."""
    return getattr(request.state, 'current_user', None)


def effective_user(request: Request) -> Optional[str]:
    """The real human behind the request, for ownership/attribution.

    Cookie sessions resolve to the logged-in username. Bearer ``ody_`` callers
    come through as the sandboxed pseudo-user "api" so they can't wander into
    cookie/user routes by default, but their token was minted by, and belongs
    to, a real owner stamped on ``request.state.api_token_owner``. Routes that
    should attribute a token's actions to that owner (sessions, chat history)
    call this instead of :func:`get_current_user`, so a paired client sees and
    creates the SAME data as the owner's desktop UI rather than a separate
    "api"-owned silo.

    For cookie sessions this is identical to :func:`get_current_user`, so
    swapping a route over is a no-op for browser users. A bearer token with no
    owner falls back to :func:`get_current_user` (the "api" pseudo-user), so it
    never escalates.
    """
    if getattr(request.state, "api_token", False):
        owner = getattr(request.state, "api_token_owner", None)
        if owner:
            return owner
    return get_current_user(request)


def _is_api_token_request(request: Request) -> bool:
    """Return True when middleware authenticated a bearer API token."""
    return bool(getattr(request.state, "api_token", False))


def require_authenticated_request(request: Request) -> str:
    """Allow either a browser session or a valid bearer API token.

    This is intentionally narrower than :func:`require_user`: use it only for
    routes that need authentication but do not read or mutate owner-scoped
    user data. Owner-scoped routes should use ``require_user`` for browser
    sessions or their own API-token scope/owner gate.
    """
    if _is_api_token_request(request):
        return effective_user(request) or ""
    return require_user(request)


def _auth_disabled() -> bool:
    """True when the operator has explicitly turned off auth via .env.
    Mirrors the AUTH_ENABLED parse in app.py / core/middleware.py so the
    three call sites agree on what "off" means."""
    return os.getenv("AUTH_ENABLED", "true").lower() == "false"


def require_user(request: Request) -> str:
    """FastAPI dependency: reject unauthenticated callers when the upstream
    auth middleware was bypassed unexpectedly (e.g. SSRF from a sibling
    service). Returns the resolved username, or "" in single-user / anonymous
    modes where no username is available.

    The three "" cases are:
      1. AUTH_ENABLED=false — the operator explicitly turned auth off.
         The full /login flow is skipped (issue #622), so route-level
         require_user must let the request through too instead of 401-ing
         and forcing the browser to /login.
      2. Unconfigured first-run + loopback caller — pre-setup access from
         localhost so the operator can hit the SPA before creating the
         first admin.
      3. LOCALHOST_BYPASS=true + loopback caller — documented dev bypass.

    Use this on routes that touch user data so middleware misconfig can't
    open them up.
    """
    if _is_api_token_request(request):
        raise HTTPException(403, "API tokens must use a scope-aware API route")

    u = get_current_user(request)
    if u:
        return u
    # Operator-disabled auth: honor it at the route layer too. Without this,
    # routes that depend on require_user 401, the front-end fetch wrapper
    # redirects to /login, and the user sees a login page despite
    # AUTH_ENABLED=false (issue #622). Docker / reverse-proxy deployments
    # hit this because requests arrive from a non-loopback client.host, so
    # the loopback fall-through below never fires.
    if _auth_disabled():
        return ""
    auth_mgr = getattr(request.app.state, "auth_manager", None)
    client = getattr(request, "client", None)
    host = (client.host if client else "") or ""
    is_loopback = host in ("127.0.0.1", "::1", "localhost")
    # LOCALHOST_BYPASS=true is the dev-only "I'm on loopback, skip auth"
    # switch. Mirror the middleware so routes don't 401 the same caller
    # the middleware just let through.
    if is_loopback and os.getenv("LOCALHOST_BYPASS", "false").lower() == "true":
        return ""
    if auth_mgr is not None and getattr(auth_mgr, "is_configured", False):
        raise HTTPException(401, "Not authenticated")
    # Unconfigured / first-run mode: only allow loopback callers.
    if is_loopback:
        return ""
    raise HTTPException(401, "Not authenticated")


def require_privilege(request: Request, key: str) -> str:
    """Reject callers whose `auth.json` privilege flag for `key` is False.
    Returns the username so the route handler can keep using it.

    Admins always have every privilege via `auth_manager.get_privileges`
    (which returns ADMIN_PRIVILEGES wholesale), so this is a no-op for
    them. In unauthenticated single-user mode (`require_user` returns ""),
    privileges aren't enforced.
    """
    user = require_user(request)
    if not user:
        return user
    auth_mgr = getattr(request.app.state, "auth_manager", None)
    if auth_mgr is None:
        return user
    try:
        privs = auth_mgr.get_privileges(user) or {}
    except Exception:
        return user
    if not isinstance(privs, dict):
        privs = {}
    # True = permitted; missing key defaults to permitted (unknown privileges
    # fail open — the UI gates display-side).
    if not privs.get(key, True):
        raise HTTPException(403, f"Your account is not allowed to {key.replace('_', ' ')}.")
    return user


def owner_filter(query, model_cls, user: str, *, include_shared: bool = False):
    """Filter `query` so only rows owned by `user` (and optionally null-owner
    'shared' rows) come through. No-op when `user` is empty (single-user
    mode). Returns the modified query.

    #588 (ADM-NEW-2): `include_shared` defaults to **False** — a NULL-owner row
    must NOT be readable across users by default. A caller that genuinely wants
    shared/global rows opts in explicitly with `include_shared=True`."""
    if not user:
        return query
    if include_shared:
        return query.filter((model_cls.owner == user) | (model_cls.owner == None))  # noqa: E711
    return query.filter(model_cls.owner == user)


def is_admin_user(user: Optional[str]) -> bool:
    """Request-free admin check for background/system code paths that resolve
    endpoints WITHOUT a Request (e.g. the portrait pipeline, `_resolve_model`,
    `has_image_capable_endpoint`). Reads the same ``data/auth.json`` the app's
    AuthManager uses, so it agrees with the request-scoped checks.

    Admins manage the global endpoint pool, so — like the request-scoped read
    paths — they must not be owner-scoped to endpoints they happen to personally
    own. Empty/unknown user, or any failure to load auth, returns False (the
    caller then falls back to owner+shared scoping, which is the safe default)."""
    if not user:
        return False
    try:
        # Reuse the process-level singleton (issue #966) — request-free path.
        return bool(shared_auth_manager().is_admin(user))
    except Exception:
        return False

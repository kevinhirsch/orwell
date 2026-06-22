# src/middleware.py
# Shared middleware, decorators, and request helpers

import os
import re
import secrets

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


# Per-process token that lets the in-app tool layer hit admin-gated
# routes via HTTP loopback (the agent's tool calls don't carry the
# admin user's session cookie). Set once at import; tools read the
# same value from this module. Never persisted or exposed externally.
INTERNAL_TOOL_TOKEN = os.environ.get("ORWELL_INTERNAL_TOKEN") or secrets.token_hex(32)
INTERNAL_TOOL_HEADER = "X-Orwell-Internal-Token"


def is_cors_preflight(method: str, headers) -> bool:
    """True for a genuine CORS preflight: an OPTIONS request carrying the
    Access-Control-Request-Method header. Such requests are credential-less by
    design and must reach CORSMiddleware to be answered -- gating them on auth
    401s the preflight and breaks every cross-origin browser/WebView client.
    Pure so it can be unit-tested without standing up the app."""
    return method == "OPTIONS" and "access-control-request-method" in headers


def require_admin(request: Request):
    """Raise 403 if the current user isn't an admin.
    Allows access when auth is explicitly disabled, or when the request carries
    the in-process internal-tool token used by loopback agent tools.
    """
    # In-process bypass for tool-layer loopback calls. Two paths:
    # (a) header-direct (caller set X-Orwell-Internal-Token), or
    # (b) the auth middleware already validated the token and stamped
    #     request.state.current_user = "internal-tool".
    try:
        hdr = request.headers.get(INTERNAL_TOOL_HEADER)
        if hdr and secrets.compare_digest(hdr, INTERNAL_TOOL_TOKEN):
            return
        if getattr(request.state, "current_user", None) == "internal-tool":
            return
    except Exception:
        pass

    auth_mgr = getattr(request.app.state, "auth_manager", None)
    if os.getenv("AUTH_ENABLED", "true").lower() == "false":
        return
    if not auth_mgr or not auth_mgr.is_configured:
        raise HTTPException(403, "Admin only")
    user = getattr(request.state, "current_user", None)
    if not user or not auth_mgr.is_admin(user):
        raise HTTPException(403, "Admin only")


def require_entitlement(request: Request, entitlement: str):
    """Raise 403 unless the current user holds the named entitlement (feature 0029).

    The server-side gate for app-admin powers (manage_users, manage_llm_settings):
    UI hiding is never trusted. Honors the same loopback / AUTH_ENABLED bypasses as
    `require_admin`. Today every entitlement is admin-carried, so this is a stricter,
    intent-named superset of `require_admin` that finer grants can later relax.
    """
    try:
        hdr = request.headers.get(INTERNAL_TOOL_HEADER)
        if hdr and secrets.compare_digest(hdr, INTERNAL_TOOL_TOKEN):
            return
        if getattr(request.state, "current_user", None) == "internal-tool":
            return
    except Exception:
        pass

    if os.getenv("AUTH_ENABLED", "true").lower() == "false":
        return
    auth_mgr = getattr(request.app.state, "auth_manager", None)
    if not auth_mgr or not auth_mgr.is_configured:
        raise HTTPException(403, "Not permitted")
    user = getattr(request.state, "current_user", None)
    if not user or not auth_mgr.has_entitlement(user, entitlement):
        raise HTTPException(403, "Not permitted")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to all responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        # Generate a per-request nonce for inline scripts
        nonce = secrets.token_hex(16)
        request.state.csp_nonce = nonce

        response = await call_next(request)
        path = request.url.path

        # Tool render endpoints are served inside iframes — allow framing by self
        is_tool_render = path.startswith("/api/tools/") and path.endswith("/render")
        # PDF previews are embedded by the in-app document library. Keep the
        # exception route-scoped so normal app pages remain unframeable.
        is_document_pdf_preview = path.startswith("/api/document/") and path.endswith("/render-pdf")
        # Visual report pages are self-contained HTML — need inline scripts + external images
        is_report = path.startswith("/api/research/report/")

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(self), geolocation=()"

        is_https = (
            request.url.scheme == "https"
            or request.headers.get("X-Forwarded-Proto") == "https"
        )
        if is_https:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        if is_report:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; "
                "font-src 'self'; "
                "img-src 'self' data: blob: https:; "
                "connect-src 'self'; "
                "frame-ancestors 'none'"
            )
        elif is_tool_render:
            # Tool iframe content: skip all framing headers — the iframe's
            # sandbox="allow-scripts" attribute provides isolation.
            # Don't overwrite the route's own restrictive CSP either.
            pass
        elif is_document_pdf_preview:
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; "
                "frame-ancestors 'self'"
            )
        else:
            response.headers["X-Frame-Options"] = "DENY"
            # NOTE: `style-src 'unsafe-inline'` is intentionally retained.
            # `static/index.html` and `static/login.html` ship inline <style>
            # blocks, and several JS modules build runtime `style=""` attrs.
            # Migrating to nonce-only requires templating the HTML files +
            # auditing every JS-set style attribute. Since inline styles
            # don't execute script, the residual risk is visual-only.
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                f"script-src 'self' 'nonce-{nonce}' https://cdn.jsdelivr.net; "
                # fonts.googleapis.com serves the opt-in Google-font stylesheet the
                # theme picker injects (a <link rel=stylesheet>); fonts.gstatic.com
                # serves the actual .woff2 files it references. Both are required or a
                # selected `gf:` font is blocked at runtime and silently falls back to
                # the offline built-ins. The four built-in fonts stay fully offline
                # ('self'); the Google option is an explicit, privacy-disclosed opt-in.
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
                "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; "
                "img-src 'self' data: blob:; "
                "media-src 'self' blob:; "
                "connect-src 'self'; "
                "frame-src 'self'; "
                "frame-ancestors 'none'"
            )
        return response


# ========= PUBLIC-DEPLOYMENT PERIMETER (feature 0067 / ADR 0007) =========
# Self-contained config helpers (no app/db imports) so they unit-test in isolation —
# matching `is_cors_preflight` above, which is "pure so it can be unit-tested without
# standing up the app."

def _env_truthy(value) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def allowed_hosts_from_env(env=None) -> list:
    """The Host-header allow-list for Starlette's TrustedHostMiddleware.

    Reads ALLOWED_HOSTS (comma-separated). Defaults to ["*"] (accept any Host) so
    dev / trusted-LAN deployments are byte-identical to before. A public deployment
    MUST set ALLOWED_HOSTS to its domain(s) — e.g. "your-domain.example,www.your-domain.example" —
    so Host-header attacks are rejected (feature 0067 / ADR 0007).
    """
    env = os.environ if env is None else env
    raw = (env.get("ALLOWED_HOSTS") or "").strip()
    if not raw:
        return ["*"]
    hosts = [h.strip() for h in raw.split(",") if h.strip()]
    return hosts or ["*"]


def assert_public_profile_safe(env=None) -> None:
    """Fail closed for an internet-facing deployment (feature 0067 / ADR 0007).

    When the public profile is selected (ORWELL_PUBLIC truthy) this raises
    RuntimeError — NAMING every offending setting — rather than letting the app
    boot and silently serve the game in the clear or with authentication off. It is
    a no-op when ORWELL_PUBLIC is unset, so the default / single-tenant start path
    is unchanged. app.py calls it at module load, so an unsafe public posture means
    the process exits non-zero instead of starting.

    Unsafe ⇔ any of:
      - AUTH_ENABLED=false        authentication disabled (require_admin short-circuits)
      - LOCALHOST_BYPASS=true     loopback auth bypass enabled
      - SECURE_COOKIES != true    session cookies would not be marked Secure over HTTPS
      - ALLOWED_HOSTS unset/"*"   the Host header is not pinned to your domain
    """
    env = os.environ if env is None else env
    if not _env_truthy(env.get("ORWELL_PUBLIC")):
        return
    problems = []
    if (env.get("AUTH_ENABLED", "true") or "").strip().lower() == "false":
        problems.append("AUTH_ENABLED=false (authentication disabled)")
    if _env_truthy(env.get("LOCALHOST_BYPASS")):
        problems.append("LOCALHOST_BYPASS=true (loopback auth bypass enabled)")
    if (env.get("SECURE_COOKIES", "false") or "").strip().lower() != "true":
        problems.append("SECURE_COOKIES is not 'true' (session cookies would not be marked Secure)")
    if allowed_hosts_from_env(env) == ["*"]:
        problems.append("ALLOWED_HOSTS is unset (the Host header is not pinned to your domain)")
    if problems:
        raise RuntimeError(
            "Refusing to start an ORWELL_PUBLIC (internet-facing) deployment with an unsafe "
            "security posture:\n  - " + "\n  - ".join(problems) + "\n"
            "Fix these in data/.env (AUTH_ENABLED=true, LOCALHOST_BYPASS=false, SECURE_COOKIES=true, "
            "ALLOWED_HOSTS=<your-domain>) — or unset ORWELL_PUBLIC for a trusted-LAN deployment. "
            "See docs/INSTALL.md -> Public deployment."
        )


# ========= LOCAL HTTPS (feature 0074 / ADR 0014) =========
# Pure, self-contained helpers (no app/db imports) for the local TLS terminator — matching the
# perimeter helpers above. The ORWELL_TLS_* variables are the tunable "backend variables" managed by
# the control panel + the admin "Local HTTPS" card; these parse + sanitise them so the route and its
# tests share one definition. Host names become Caddyfile DATA (never a command), but we still reject
# anything that isn't a plausible hostname/IP — defense in depth against a typo or an injected
# directive.

# A single hostname (optional leading "*." wildcard) or a dotted IPv4 — letters/digits/dot/hyphen,
# bounded by an alphanumeric on each end. Deliberately rejects whitespace, slashes, braces, and
# semicolons (the Caddyfile-injection-relevant characters).
_TLS_NAME_RE = re.compile(r"^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$")

# The local hostnames covered when ORWELL_TLS_LOCAL_NAMES is unset.
DEFAULT_LOCAL_TLS_NAMES = ["orwell.lan", "orwell.local"]


def sanitize_tls_names(names) -> list:
    """Filter a comma-string or list of host names to the valid ones (strict allow-list).

    Returns a de-duplicated list preserving first-seen order. Anything that is not a plausible
    hostname/IP (per ``_TLS_NAME_RE``) is dropped — the apply layer must never write an unvetted
    string into the generated Caddyfile."""
    if isinstance(names, str):
        items = names.split(",")
    elif isinstance(names, (list, tuple)):
        items = []
        for n in names:
            items.extend(str(n).split(","))
    else:
        return []
    out: list = []
    seen: set = set()
    for raw in items:
        tok = str(raw).strip()
        if not tok or tok in seen:
            continue
        if _TLS_NAME_RE.match(tok):
            out.append(tok)
            seen.add(tok)
    return out


def local_tls_names_from_env(env=None) -> list:
    """The local hostnames the terminator covers (``ORWELL_TLS_LOCAL_NAMES``), default
    ``orwell.lan,orwell.local``. Always sanitised."""
    env = os.environ if env is None else env
    raw = (env.get("ORWELL_TLS_LOCAL_NAMES") or "").strip()
    if not raw:
        return list(DEFAULT_LOCAL_TLS_NAMES)
    return sanitize_tls_names(raw) or list(DEFAULT_LOCAL_TLS_NAMES)


def tls_mode_from_env(env=None) -> str:
    """The local TLS mode (``ORWELL_TLS_MODE``): ``off`` (default) or ``local``. Anything else
    normalises to ``off`` so an unknown value never silently arms the terminator."""
    env = os.environ if env is None else env
    mode = (env.get("ORWELL_TLS_MODE") or "off").strip().lower()
    return mode if mode in ("off", "local") else "off"

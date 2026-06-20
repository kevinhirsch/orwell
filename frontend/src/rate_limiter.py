# src/rate_limiter.py
"""Generic in-memory rate limiter — sliding window, keyed by IP."""

import os
import threading
import time
from typing import Dict, List


class RateLimiter:
    """Sliding-window rate limiter.

    Usage:
        limiter = RateLimiter(max_requests=5, window_seconds=60)
        if not limiter.check(ip):
            raise HTTPException(429, "Too many requests")
    """

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = window_seconds
        self._log: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()
        self._cleanup_interval = max(window_seconds * 2, 120)

    def check(self, key: str) -> bool:
        """Return True if the request is allowed, False if rate-limited."""
        now = time.monotonic()
        with self._lock:
            self._maybe_cleanup(now)
            timestamps = self._log.get(key, [])
            cutoff = now - self.window
            timestamps = [t for t in timestamps if t > cutoff]
            if len(timestamps) >= self.max_requests:
                self._log[key] = timestamps
                return False
            timestamps.append(now)
            self._log[key] = timestamps
            return True

    def _maybe_cleanup(self, now: float) -> None:
        """Periodically purge stale entries."""
        if now - self._last_cleanup < self._cleanup_interval:
            return
        self._last_cleanup = now
        cutoff = now - self.window
        stale = [k for k, v in self._log.items() if not v or v[-1] <= cutoff]
        for k in stale:
            del self._log[k]


# ========= REAL CLIENT IP BEHIND A PROXY / TUNNEL (feature 0067 / ADR 0007) =========

_PROXY_TRUST_FLAGS = ("ORWELL_PUBLIC", "TRUST_PROXY_HEADERS")


def _trust_proxy_headers(env=None) -> bool:
    """Whether to trust client-IP forwarding headers.

    On for a public deployment (ORWELL_PUBLIC) or when TRUST_PROXY_HEADERS is set;
    OFF by default so a directly-exposed app cannot be spoofed by a forged header.
    """
    env = os.environ if env is None else env
    return any(str(env.get(f, "")).strip().lower() in ("1", "true", "yes", "on") for f in _PROXY_TRUST_FLAGS)


def client_ip(request, env=None) -> str:
    """The real client IP to key rate-limiting / abuse controls on.

    Behind a reverse proxy or tunnel (cloudflared, Caddy, nginx, Pangolin) the
    transport peer — ``request.client.host`` — is the PROXY, typically 127.0.0.1, so
    a per-IP limiter keyed on it collapses to one GLOBAL bucket (every visitor shares
    127.0.0.1, so one user's logins can lock out everyone and an attacker is never
    isolated). When proxy headers are trusted, prefer the forwarded client IP:
    CF-Connecting-IP (Cloudflare), then the first hop of X-Forwarded-For, then
    X-Real-IP. Header trust is gated (see ``_trust_proxy_headers``) so a directly
    exposed deployment can't be spoofed. Falls back to the transport peer, then
    "unknown".
    """
    direct = ""
    client = getattr(request, "client", None)
    if client is not None:
        direct = getattr(client, "host", "") or ""
    if not _trust_proxy_headers(env):
        return direct or "unknown"
    headers = getattr(request, "headers", None) or {}
    get = getattr(headers, "get", None)
    if get is None:
        return direct or "unknown"
    cf = get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    xr = get("x-real-ip")
    if xr:
        return xr.strip()
    return direct or "unknown"

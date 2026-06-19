"""Logging-noise control (L37).

Two recurring sources flooded the on-disk log during the 2026-06-19 prod incident:
the per-poll httpx access lines ("INFO HTTP Request: GET …/models 200" — the warmup /
keepalive / model-discovery probes fire every ~60s and httpx logs each one at INFO), and
the engine-down poll-failure WARNINGs (already throttled in `routes/orwell_routes.py`).

This module owns the httpx-noise half so it is unit-testable WITHOUT importing the whole
FastAPI app (which has heavy side effects at import). `quiet_http_loggers()` raises the
HTTP client loggers to WARNING — real client errors still surface; the steady access drip
is gone. Idempotent and safe to call more than once.
"""
from __future__ import annotations

import logging

# The HTTP client stack that emits per-request access lines. httpx logs the request line at
# INFO; httpcore (its transport) is even chattier at DEBUG. Both are pure noise in this app —
# every meaningful failure already surfaces via our own throttled WARNINGs.
_HTTP_NOISE_LOGGERS = ("httpx", "httpcore")


def quiet_http_loggers(level: int = logging.WARNING) -> None:
    """Raise the httpx/httpcore loggers to `level` (default WARNING) so per-request access
    lines stop filling the log. Errors at WARNING+ still propagate. Idempotent."""
    for name in _HTTP_NOISE_LOGGERS:
        logging.getLogger(name).setLevel(level)

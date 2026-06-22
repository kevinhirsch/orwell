"""Secret redaction for FE log records.

Adapted from Nous Research hermes-agent ``agent/redact.py`` (MIT © 2025 Nous Research).
See ``frontend/ACKNOWLEDGMENTS.md`` for attribution.

This module is **pure** — no I/O, no imports from game logic, no Vault types.
Table-driven so adding a new shape is one line in ``_VENDOR_PREFIXES``.

Wire into any log-path by installing ``RedactingFilter`` on the root (or any)
logging handler — see ``install_log_redaction()``.

Reconciliation with existing helpers:
- ``settings_scrub.py`` — scrubs secret-shaped *keys* from settings dicts
  (for API responses). Different surface; no overlap to deduplicate.
- ``prompt_security.py`` — sandboxes untrusted context for the LLM; no overlap.
"""

from __future__ import annotations

import logging
import re
from typing import Sequence


# ---------------------------------------------------------------------------
# Vendor-prefixed API key shapes
# ---------------------------------------------------------------------------
# Each tuple is (prefix, min-suffix-length).  One regex per entry; a new
# provider token shape is one line here.
_VENDOR_PREFIXES: Sequence[tuple[str, int]] = [
    ("sk-",     10),   # OpenAI / generic  sk-<...>
    ("ghp_",    10),   # GitHub PAT
    ("gsk_",    10),   # Groq
    ("xai-",    10),   # xAI
    ("AIza",    10),   # Google API key
    ("glpat-",  10),   # GitLab PAT
]

# Build one combined regex: alternation of all vendor-prefix patterns.
_vendor_parts = [
    rf"{re.escape(pfx)}[A-Za-z0-9_\-]{{{minlen},}}"
    for pfx, minlen in _VENDOR_PREFIXES
]
_VENDOR_KEY_RE = re.compile("|".join(_vendor_parts))

# ---------------------------------------------------------------------------
# Authorization / x-api-key header value shapes
# ---------------------------------------------------------------------------
# Matches the header name (kept) followed by its value (redacted).
# Covers:
#   Authorization: Bearer sk-…
#   Authorization: Token abc123
#   x-api-key: sk-…
#   x-api-key sk-…  (space-separated, e.g. curl -H style)
_AUTH_HEADER_RE = re.compile(
    r"(?i)\b(Authorization|x-api-key)\b(?:\s*:\s*|\s+)(\S+)",
)

# ---------------------------------------------------------------------------
# URL query-parameter secret shapes
# ---------------------------------------------------------------------------
# Matches ?key=VALUE or &token=VALUE for the common secret param names.
_SECRET_PARAM_NAMES = (
    "key", "token", "secret", "password",
    "api_key", "access_token",
)
_secret_param_alt = "|".join(re.escape(n) for n in _SECRET_PARAM_NAMES)
_URL_PARAM_RE = re.compile(
    rf"(?i)([?&])({_secret_param_alt})=([^&\s#\"']+)",
)

# ---------------------------------------------------------------------------
# Replacement sentinel
# ---------------------------------------------------------------------------
_MASK = "[REDACTED]"


def redact(text: str) -> str:
    """Return *text* with known secret shapes masked.

    - Vendor-prefixed API keys (``sk-…``, ``ghp_…``, etc.) → ``[REDACTED]``
    - ``Authorization`` / ``x-api-key`` header values → ``Authorization: [REDACTED]``
    - URL query-parameter secrets → ``?param=[REDACTED]``
    - All other text is returned **unchanged**.
    """
    if not text:
        return text

    # 1. Vendor-prefixed keys (replace the whole match).
    text = _VENDOR_KEY_RE.sub(_MASK, text)

    # 2. Auth-header values (keep the header name, redact the value).
    text = _AUTH_HEADER_RE.sub(lambda m: f"{m.group(1)}: {_MASK}", text)

    # 3. URL query-param secrets (keep the separator and param name, redact value).
    text = _URL_PARAM_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}={_MASK}", text)

    return text


# ---------------------------------------------------------------------------
# Log-path wiring
# ---------------------------------------------------------------------------

class RedactingFilter(logging.Filter):
    """A ``logging.Filter`` that passes every log record through ``redact()``.

    Install on the root handler (or any handler) so every log record emitted
    by the FE passes through redaction before reaching the log sink:

        handler = logging.StreamHandler()
        handler.addFilter(RedactingFilter())
        logging.getLogger().addHandler(handler)

    Or use ``install_log_redaction()`` for the common single-call setup.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # Mutate the formatted message in-place.  ``getMessage()`` renders
        # %-style args; we scrub the result and stash it back so the formatter
        # picks up the scrubbed text.
        try:
            record.msg = redact(record.getMessage())
            record.args = ()   # args already baked in; clear to avoid double-format
        except Exception:
            # Never suppress a log record due to a redaction failure.
            pass
        return True  # always pass the (now-scrubbed) record through


def install_log_redaction(logger: logging.Logger | None = None) -> "RedactingFilter":
    """Install a ``RedactingFilter`` on *logger* (default: the root logger).

    Idempotent — a second call on the same logger is a no-op.
    Returns the filter instance (useful for testing).
    """
    target = logger or logging.getLogger()
    # Check whether we've already installed a RedactingFilter on this logger.
    for handler in target.handlers:
        for f in handler.filters:
            if isinstance(f, RedactingFilter):
                return f  # already installed

    f = RedactingFilter()
    for handler in target.handlers:
        handler.addFilter(f)

    # If the logger has no handlers yet, attach the filter to a transient
    # handler so callers don't have to worry about handler setup order.
    if not target.handlers:
        _placeholder = logging.NullHandler()
        _placeholder.addFilter(f)
        target.addHandler(_placeholder)

    return f

"""Gateway turn-path abuse controls (issues #559 / #560).

The /gateway/webhook path is unauthenticated by design (platforms POST without a session
cookie) and runs a real LLM turn for the paired user. Two guards live here:

  • A **per-identity sliding-window rate limiter** so a single platform identity (or a
    spoofer reaching the public URL) cannot drive unbounded LLM turns (#560).
  • A **per-user daily turn cap** mirroring the browser path's ``max_messages_per_day``
    privilege. Browser turns count persisted ChatMessage rows; gateway turns are NOT
    persisted as ChatMessage rows, so the gateway keeps its own in-process daily counter
    keyed on the resolved orwell user and gated by the same privilege value (#560).

The webhook **shared-secret** guard (#559) lives in ``routes/gateway_routes.py`` next to the
per-platform ``verify_webhook`` hook.

All state is process-local (single-host deployment target, same as ``gateway/pairing.py``).
Fully fail-soft: a missing auth manager / unparseable privilege never raises here — the
caller decides whether to refuse.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

# ── tunables (env-overridable, ORWELL_GATEWAY_* convention) ───────────────────

# Per-identity rate limit: at most RATE_MAX turns per RATE_WINDOW_S seconds.
RATE_WINDOW_S: float = float(os.getenv("ORWELL_GATEWAY_RATE_WINDOW_S", "60"))
RATE_MAX: int = int(os.getenv("ORWELL_GATEWAY_RATE_MAX", "15"))


@dataclass
class _RateState:
    attempts: list = field(default_factory=list)  # monotonic timestamps of recent turns


# platform_identity -> sliding-window state
_RATE: Dict[str, _RateState] = {}

# orwell_user -> {"day": <UTC date ordinal>, "count": int}
_DAILY: Dict[str, dict] = {}


def is_rate_limited(identity: str) -> bool:
    """True when *identity* has exceeded RATE_MAX turns within the trailing RATE_WINDOW_S.

    Records the attempt on the allowed path (so the window reflects real traffic). Fail-open
    on any unexpected error — a limiter bug must never wedge the gateway.
    """
    try:
        now = time.monotonic()
        st = _RATE.get(identity)
        if st is None:
            st = _RateState()
            _RATE[identity] = st
        cutoff = now - RATE_WINDOW_S
        st.attempts = [t for t in st.attempts if t >= cutoff]
        if len(st.attempts) >= RATE_MAX:
            return True
        st.attempts.append(now)
        return False
    except Exception:
        return False


def _today_ordinal() -> int:
    # UTC day boundary, matching the browser cap's 24h-trailing intent closely enough for a
    # per-day quota (a fixed calendar day is simpler + resets predictably for platform users).
    return int(time.time() // 86400)


def daily_cap_exceeded(user: str, auth_manager) -> bool:
    """True when *user* has hit their ``max_messages_per_day`` privilege via the gateway.

    Mirrors the browser path's cap (``_enforce_chat_privileges``) but counts in-process gateway
    turns, since gateway turns are not persisted as ChatMessage rows. ``cap <= 0`` (the default,
    and all admins) ⇒ never capped. Fail-open if the privilege can't be read.
    """
    if not user or auth_manager is None:
        return False
    try:
        privs = auth_manager.get_privileges(user) or {}
        cap = int(privs.get("max_messages_per_day") or 0)
    except Exception:
        return False
    if cap <= 0:
        return False
    today = _today_ordinal()
    rec = _DAILY.get(user)
    if rec is None or rec.get("day") != today:
        rec = {"day": today, "count": 0}
        _DAILY[user] = rec
    if rec["count"] >= cap:
        return True
    rec["count"] += 1
    return False


def reset_for_tests() -> None:
    """Clear all in-process state (test helper)."""
    _RATE.clear()
    _DAILY.clear()

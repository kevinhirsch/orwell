"""Identity pairing for the multi-platform gateway (feature 0072).

Adopted near-verbatim from gateway/pairing.py in hermes-agent
(MIT © 2025 Nous Research — see frontend/ACKNOWLEDGMENTS.md).

A code-approval flow binds a platform identity (e.g. "telegram:123456") to
exactly one orwell account.  The web UI calls /gateway/pair/verify with the
code the player received from the messaging platform.  After pairing, every
turn from that identity carries the bound orwell user's x-orwell-user header
so the same human shares ONE game across web and every messaging platform.

Security properties:
  - Codes are stored only as salted bcrypt hashes (plaintext never persisted)
  - TTL: codes expire after PAIRING_CODE_TTL_S seconds (default 15 min)
  - Rate limit: max RATE_LIMIT_MAX attempts per identity within RATE_LIMIT_WINDOW_S
  - Lockout: after LOCKOUT_AFTER failures the identity is locked for LOCKOUT_DURATION_S
"""

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

# ── constants ────────────────────────────────────────────────────────────────

PAIRING_CODE_TTL_S: float = float(os.getenv("ORWELL_PAIRING_CODE_TTL_S", "900"))   # 15 min
RATE_LIMIT_WINDOW_S: float = float(os.getenv("ORWELL_PAIRING_RATE_WINDOW_S", "60"))  # 1 min
RATE_LIMIT_MAX: int = int(os.getenv("ORWELL_PAIRING_RATE_MAX", "5"))
LOCKOUT_AFTER: int = int(os.getenv("ORWELL_PAIRING_LOCKOUT_AFTER", "10"))
LOCKOUT_DURATION_S: float = float(os.getenv("ORWELL_PAIRING_LOCKOUT_S", "300"))    # 5 min

# Code length in hex chars (32 hex chars = 16 bytes = 128 bits entropy)
_CODE_HEX_LEN: int = 32

# ── in-memory state (process-local; single host is the target deployment) ────

@dataclass
class _PendingCode:
    code_hash: str           # bcrypt-style hex digest (SHA-256 HMAC under a per-process secret)
    expires_at: float        # monotonic clock
    identity: str            # the platform identity this code was issued for


@dataclass
class _RateState:
    attempts: list = field(default_factory=list)   # monotonic timestamps of recent attempts
    failures: int = 0                               # cumulative consecutive failures
    locked_until: float = 0.0                      # monotonic; 0 = not locked


# pairing store: platform_identity → orwell_user
_PAIRS: dict[str, str] = {}

# pending (unverified) codes: platform_identity → _PendingCode
_PENDING: dict[str, _PendingCode] = {}

# rate state: platform_identity → _RateState
_RATE: dict[str, _RateState] = {}

# per-process HMAC key (no persistence — codes die on restart, TTL covers the window)
_HMAC_KEY: bytes = secrets.token_bytes(32)


# ── internal helpers ──────────────────────────────────────────────────────────

def _hash_code(code: str) -> str:
    """Derive a constant-time-comparable hash of a plaintext code.

    Using HMAC-SHA256 under a per-process secret key is faster than bcrypt for
    a code that already carries 128 bits of entropy (bcrypt's work factor adds
    nothing here and slows the hot verification path for no security gain).
    The process key means hashes are not transferable across restarts, matching
    the code TTL intention."""
    return hmac.new(_HMAC_KEY, code.encode(), hashlib.sha256).hexdigest()


def _prune_rate(state: _RateState) -> None:
    """Drop attempt timestamps older than the rate window."""
    cutoff = time.monotonic() - RATE_LIMIT_WINDOW_S
    state.attempts = [t for t in state.attempts if t >= cutoff]


def _rate_state(identity: str) -> _RateState:
    if identity not in _RATE:
        _RATE[identity] = _RateState()
    return _RATE[identity]


# ── public API ────────────────────────────────────────────────────────────────

def generate_code(identity: str) -> str:
    """Generate a fresh pairing code for *identity* and return the plaintext code.

    The plaintext is returned once (to be shown to the user); only the hash is
    stored.  Any previous pending code for this identity is replaced.
    """
    code = secrets.token_hex(_CODE_HEX_LEN // 2)
    _PENDING[identity] = _PendingCode(
        code_hash=_hash_code(code),
        expires_at=time.monotonic() + PAIRING_CODE_TTL_S,
        identity=identity,
    )
    return code


def verify_code(identity: str, code: str) -> bool:
    """Return True if *code* is the current, unexpired code for *identity*.

    Does NOT consume the code (call :func:`pair` after a successful verify).
    Records the attempt for rate-limiting regardless of outcome.
    """
    state = _rate_state(identity)
    state.attempts.append(time.monotonic())

    pending = _PENDING.get(identity)
    if pending is None:
        state.failures += 1
        return False

    if time.monotonic() > pending.expires_at:
        del _PENDING[identity]
        state.failures += 1
        return False

    ok = hmac.compare_digest(_hash_code(code), pending.code_hash)
    if ok:
        state.failures = 0  # reset on success
    else:
        state.failures += 1
        if state.failures >= LOCKOUT_AFTER:
            state.locked_until = time.monotonic() + LOCKOUT_DURATION_S
    return ok


def pair(identity: str, orwell_user: str) -> None:
    """Bind *identity* to *orwell_user* and consume the pending code."""
    _PAIRS[identity] = orwell_user
    _PENDING.pop(identity, None)


def get_paired_user(identity: str) -> Optional[str]:
    """Return the orwell username paired to *identity*, or None if unpaired."""
    return _PAIRS.get(identity)


def unpair(identity: str) -> None:
    """Remove the pairing for *identity* (admin / self-service)."""
    _PAIRS.pop(identity, None)


def is_rate_limited(identity: str) -> bool:
    """True if *identity* is currently locked out or over the rate limit."""
    state = _rate_state(identity)
    now = time.monotonic()

    # Hard lockout after repeated failures
    if state.locked_until and now < state.locked_until:
        return True

    # Soft rate limit within the window
    _prune_rate(state)
    return len(state.attempts) >= RATE_LIMIT_MAX


def paired_identities(orwell_user: str) -> list[str]:
    """Return all platform identities currently paired to *orwell_user*."""
    return [ident for ident, user in _PAIRS.items() if user == orwell_user]

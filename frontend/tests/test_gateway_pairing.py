"""Tests for gateway/pairing.py (feature 0072).

Verifies:
  - Code generation returns a non-empty plaintext code
  - The code is stored only as a hash (plaintext never retrievable from state)
  - TTL: an expired code is refused
  - Rate limit: max attempts within the window triggers is_rate_limited
  - Lockout: repeated failures trigger lockout
  - Verify/pair/get_paired_user round-trip
  - An incorrect code is refused
  - An unpaired identity returns None

BDD invariant proven:
  "Pairing is hardened — codes are salted-hashed, TTL-bounded, rate-limited,
   and lock out after repeated failures; an expired/incorrect code is refused."
"""

import time
import importlib
import sys

import pytest


# ── helpers ──────────────────────────────────────────────────────────────────

def _fresh_pairing():
    """Return a fresh, isolated copy of the pairing module with clean state.

    Each test gets its own module instance so the in-memory stores don't bleed."""
    # Remove cached module to get a fresh import each time
    for key in list(sys.modules.keys()):
        if key == "gateway.pairing" or key.endswith(".pairing"):
            del sys.modules[key]
    import importlib.util
    import os
    spec = importlib.util.spec_from_file_location(
        "gateway.pairing",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "gateway", "pairing.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def p():
    """A fresh pairing module with clean in-memory state."""
    return _fresh_pairing()


# ── tests ─────────────────────────────────────────────────────────────────────

class TestCodeGeneration:
    def test_generate_returns_nonempty_code(self, p):
        code = p.generate_code("telegram:999")
        assert isinstance(code, str) and len(code) > 0

    def test_generated_code_is_unique(self, p):
        c1 = p.generate_code("telegram:1")
        c2 = p.generate_code("telegram:2")
        assert c1 != c2

    def test_plaintext_not_in_pending_store(self, p):
        code = p.generate_code("telegram:999")
        pending = p._PENDING.get("telegram:999")
        assert pending is not None
        # The plaintext code must NOT be stored — only the hash
        assert code not in str(pending.code_hash)

    def test_code_is_stored_as_hash_not_plaintext(self, p):
        code = p.generate_code("telegram:abc")
        pending = p._PENDING["telegram:abc"]
        # Hash is a hex string of the HMAC-SHA256; length is 64 chars
        assert len(pending.code_hash) == 64
        # The stored hash is NOT the plaintext
        assert pending.code_hash != code

    def test_new_code_replaces_old_pending(self, p):
        p.generate_code("telegram:dup")
        first_hash = p._PENDING["telegram:dup"].code_hash
        p.generate_code("telegram:dup")
        second_hash = p._PENDING["telegram:dup"].code_hash
        # A new code was issued; the hash should differ (high probability for token_hex)
        assert first_hash != second_hash


class TestVerifyAndPair:
    def test_correct_code_verifies(self, p):
        code = p.generate_code("telegram:10")
        assert p.verify_code("telegram:10", code) is True

    def test_incorrect_code_is_refused(self, p):
        p.generate_code("telegram:20")
        assert p.verify_code("telegram:20", "wrong_code") is False

    def test_pair_binds_identity_to_user(self, p):
        code = p.generate_code("telegram:30")
        assert p.verify_code("telegram:30", code)
        p.pair("telegram:30", "alice")
        assert p.get_paired_user("telegram:30") == "alice"

    def test_pair_consumes_pending_code(self, p):
        code = p.generate_code("telegram:31")
        p.verify_code("telegram:31", code)
        p.pair("telegram:31", "bob")
        # Pending code is consumed — a second verify should fail (no pending)
        assert p.verify_code("telegram:31", code) is False

    def test_unpaired_identity_returns_none(self, p):
        assert p.get_paired_user("telegram:99999") is None

    def test_two_identities_paired_to_same_user(self, p):
        c1 = p.generate_code("telegram:100")
        p.verify_code("telegram:100", c1)
        p.pair("telegram:100", "charlie")

        c2 = p.generate_code("signal:100")
        p.verify_code("signal:100", c2)
        p.pair("signal:100", "charlie")

        assert p.get_paired_user("telegram:100") == "charlie"
        assert p.get_paired_user("signal:100") == "charlie"
        assert set(p.paired_identities("charlie")) == {"telegram:100", "signal:100"}

    def test_unpair_removes_binding(self, p):
        code = p.generate_code("telegram:40")
        p.verify_code("telegram:40", code)
        p.pair("telegram:40", "dave")
        p.unpair("telegram:40")
        assert p.get_paired_user("telegram:40") is None


class TestTTL:
    def test_expired_code_is_refused(self, p, monkeypatch):
        code = p.generate_code("telegram:50")
        # Wind the expiry into the past
        pending = p._PENDING["telegram:50"]
        monkeypatch.setattr(pending, "expires_at", time.monotonic() - 1.0)
        assert p.verify_code("telegram:50", code) is False

    def test_expired_code_cleans_up_pending(self, p, monkeypatch):
        code = p.generate_code("telegram:51")
        pending = p._PENDING["telegram:51"]
        monkeypatch.setattr(pending, "expires_at", time.monotonic() - 1.0)
        p.verify_code("telegram:51", code)
        assert "telegram:51" not in p._PENDING

    def test_valid_code_within_ttl_verifies(self, p):
        code = p.generate_code("telegram:52")
        # TTL default is 15 min; immediately verifying must succeed
        assert p.verify_code("telegram:52", code) is True


class TestRateLimit:
    def test_rate_limit_triggers_after_max_attempts(self, p, monkeypatch):
        identity = "telegram:rl"
        monkeypatch.setattr(p, "RATE_LIMIT_MAX", 3)
        # Exhaust the limit with wrong codes (generate one so pending exists)
        p.generate_code(identity)
        for _ in range(p.RATE_LIMIT_MAX):
            p.verify_code(identity, "bad")
        assert p.is_rate_limited(identity)

    def test_rate_limit_resets_after_window(self, p, monkeypatch):
        identity = "telegram:rw"
        monkeypatch.setattr(p, "RATE_LIMIT_MAX", 3)
        monkeypatch.setattr(p, "RATE_LIMIT_WINDOW_S", 0.0)  # window of 0 → always expired
        p.generate_code(identity)
        for _ in range(p.RATE_LIMIT_MAX):
            p.verify_code(identity, "bad")
        # With window=0, all old attempts are pruned on _prune_rate → not rate-limited
        assert not p.is_rate_limited(identity)

    def test_not_rate_limited_initially(self, p):
        assert not p.is_rate_limited("telegram:fresh")


class TestLockout:
    def test_lockout_after_repeated_failures(self, p, monkeypatch):
        identity = "telegram:lock"
        monkeypatch.setattr(p, "LOCKOUT_AFTER", 3)
        monkeypatch.setattr(p, "LOCKOUT_DURATION_S", 9999.0)
        p.generate_code(identity)
        for _ in range(p.LOCKOUT_AFTER):
            p.verify_code(identity, "bad")
        state = p._RATE[identity]
        # After LOCKOUT_AFTER failures the locked_until should be set
        assert state.locked_until > time.monotonic()
        assert p.is_rate_limited(identity)

    def test_lockout_expires(self, p, monkeypatch):
        identity = "telegram:lockexp"
        monkeypatch.setattr(p, "LOCKOUT_AFTER", 2)
        monkeypatch.setattr(p, "LOCKOUT_DURATION_S", 0.0)
        p.generate_code(identity)
        for _ in range(p.LOCKOUT_AFTER):
            p.verify_code(identity, "bad")
        # locked_until is in the past (duration=0) → not locked
        assert not p.is_rate_limited(identity)

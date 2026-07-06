"""SEC-3 — AUTH_ENABLED=false must not be reachable beyond loopback.

`tool_security.owner_is_admin_or_single_user` fail-opens to admin-equivalent tool access
(including `bash`/`python`) whenever `is_configured` is False — a reasonable posture for a
genuinely single-operator, loopback-only install. It stops being safe the instant the process is
reachable beyond loopback: `AUTH_ENABLED=false` skips constructing `AuthMiddleware` entirely (no
session check, no loopback check, on ANY route), so a forgotten port-forward / believed-private LAN
/ VPN misconfiguration on such a box grants any network caller unauthenticated remote code
execution. `assert_public_profile_safe` only fires when `ORWELL_PUBLIC` is explicit, so it does NOT
catch this combination — `assert_auth_off_requires_loopback` is the dedicated fail-closed gate for
it: refuse to boot with AUTH_ENABLED=false and a non-loopback ORWELL_BIND_HOST.

Self-contained: imports only `core.middleware` (loaded via the conftest `core` stub), never boots
the full app.
"""
import pytest

from core.middleware import assert_auth_off_requires_loopback


def test_noop_when_auth_enabled():
    # The default posture (AUTH_ENABLED unset/true) is unaffected regardless of bind host.
    assert_auth_off_requires_loopback({"ORWELL_BIND_HOST": "0.0.0.0"})  # must not raise
    assert_auth_off_requires_loopback({})  # must not raise


def test_noop_when_auth_off_and_bind_defaults_to_loopback():
    # No ORWELL_BIND_HOST set ⇒ the documented default (127.0.0.1) — safe, must not raise.
    assert_auth_off_requires_loopback({"AUTH_ENABLED": "false"})


@pytest.mark.parametrize("bind", ["127.0.0.1", "::1", "localhost"])
def test_noop_when_auth_off_and_bind_is_explicitly_loopback(bind):
    assert_auth_off_requires_loopback({"AUTH_ENABLED": "false", "ORWELL_BIND_HOST": bind})


@pytest.mark.parametrize("bind", ["0.0.0.0", "::", "10.0.0.5"])
def test_refuses_auth_off_with_non_loopback_bind(bind):
    env = {"AUTH_ENABLED": "false", "ORWELL_BIND_HOST": bind}
    with pytest.raises(RuntimeError) as exc:
        assert_auth_off_requires_loopback(env)
    # The refusal NAMES both offending knobs so an operator can fix it without spelunking.
    assert "AUTH_ENABLED" in str(exc.value)
    assert bind in str(exc.value)


def test_refuses_regardless_of_orwell_public():
    # This is precisely the gap assert_public_profile_safe leaves: ORWELL_PUBLIC unset entirely,
    # yet the box is still reachable and auth-off. Must still refuse.
    env = {"AUTH_ENABLED": "false", "ORWELL_BIND_HOST": "0.0.0.0"}
    assert "ORWELL_PUBLIC" not in env
    with pytest.raises(RuntimeError):
        assert_auth_off_requires_loopback(env)

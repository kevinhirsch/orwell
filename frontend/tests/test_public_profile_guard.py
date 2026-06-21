"""Feature 0067 / ADR 0007 — the public-profile fail-closed boot guard + Host allow-list.

Self-contained: imports only `core.middleware` (loaded via the conftest `core` stub), never boots
the full app. Mirrors the engine's fail-closed posture for an internet-facing deployment.
"""
import pytest

from core.middleware import assert_public_profile_safe, allowed_hosts_from_env

SAFE = {
    "ORWELL_PUBLIC": "1",
    "AUTH_ENABLED": "true",
    "LOCALHOST_BYPASS": "false",
    "SECURE_COOKIES": "true",
    "ALLOWED_HOSTS": "hiorwell.com,www.hiorwell.com",
}


def test_noop_when_public_not_selected():
    # Dormant unless ORWELL_PUBLIC is set: even a wildly unsafe posture is ignored, so the
    # default / trusted-LAN start path is byte-identical.
    env = {"AUTH_ENABLED": "false", "LOCALHOST_BYPASS": "true", "SECURE_COOKIES": "false"}
    assert_public_profile_safe(env)  # must not raise


def test_safe_public_profile_boots_green():
    assert_public_profile_safe(dict(SAFE))  # must not raise


@pytest.mark.parametrize(
    "key,bad",
    [
        ("AUTH_ENABLED", "false"),
        ("LOCALHOST_BYPASS", "true"),
        ("SECURE_COOKIES", "false"),
    ],
)
def test_refuses_each_unsafe_knob(key, bad):
    env = dict(SAFE)
    env[key] = bad
    with pytest.raises(RuntimeError) as exc:
        assert_public_profile_safe(env)
    assert key in str(exc.value)  # the refusal NAMES the offending setting


def test_refuses_unpinned_host():
    env = dict(SAFE)
    del env["ALLOWED_HOSTS"]
    with pytest.raises(RuntimeError) as exc:
        assert_public_profile_safe(env)
    assert "ALLOWED_HOSTS" in str(exc.value)


def test_allowed_hosts_default_is_wildcard():
    # Unset / empty ⇒ ["*"] so dev + trusted-LAN are unaffected.
    assert allowed_hosts_from_env({}) == ["*"]
    assert allowed_hosts_from_env({"ALLOWED_HOSTS": ""}) == ["*"]


def test_allowed_hosts_parses_csv():
    assert allowed_hosts_from_env({"ALLOWED_HOSTS": "a.com, b.com"}) == ["a.com", "b.com"]

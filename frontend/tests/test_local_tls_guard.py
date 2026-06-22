"""Feature 0074 / ADR 0014 — the pure local-TLS config helpers in core.middleware.

These names become Caddyfile DATA (never a command), but the apply layer must still reject anything
that isn't a plausible hostname/IP — a strict allow-list (defense in depth against a typo or an
injected directive). Pure functions, no app boot. Roles only — no houseguest names anywhere.
"""
from core.middleware import (
    DEFAULT_LOCAL_TLS_NAMES,
    local_tls_names_from_env,
    sanitize_tls_names,
    tls_mode_from_env,
)


def test_sanitize_keeps_valid_hostnames_and_ips():
    assert sanitize_tls_names("orwell.lan,orwell.local") == ["orwell.lan", "orwell.local"]
    assert sanitize_tls_names("192.168.1.50") == ["192.168.1.50"]
    assert sanitize_tls_names("host,192.168.0.2,sub.example.com") == ["host", "192.168.0.2", "sub.example.com"]
    assert sanitize_tls_names("*.example.com") == ["*.example.com"]  # wildcard allowed


def test_sanitize_rejects_injection_and_whitespace():
    # Spaces, slashes, braces, semicolons, quotes — the Caddyfile-injection-relevant characters.
    assert sanitize_tls_names("bad name") == []
    assert sanitize_tls_names("a;reverse_proxy evil") == []
    assert sanitize_tls_names("x/y") == []
    assert sanitize_tls_names("a{b}") == []
    assert sanitize_tls_names('a"b') == []
    # A mixed list keeps only the valid token.
    assert sanitize_tls_names(["orwell.lan", "bad name", "a;b"]) == ["orwell.lan"]


def test_sanitize_accepts_list_and_comma_string_and_dedups():
    assert sanitize_tls_names(["a", "b,c", "a"]) == ["a", "b", "c"]   # splits + de-dups, order kept
    assert sanitize_tls_names("") == []
    assert sanitize_tls_names(None) == []
    assert sanitize_tls_names(123) == []


def test_local_names_from_env_defaults_and_parses(monkeypatch):
    monkeypatch.delenv("ORWELL_TLS_LOCAL_NAMES", raising=False)
    assert local_tls_names_from_env() == DEFAULT_LOCAL_TLS_NAMES
    monkeypatch.setenv("ORWELL_TLS_LOCAL_NAMES", "box.lan, box.local")
    assert local_tls_names_from_env() == ["box.lan", "box.local"]
    # All-invalid falls back to the default rather than returning an empty cover set.
    monkeypatch.setenv("ORWELL_TLS_LOCAL_NAMES", "bad name, a;b")
    assert local_tls_names_from_env() == DEFAULT_LOCAL_TLS_NAMES


def test_tls_mode_normalises(monkeypatch):
    monkeypatch.delenv("ORWELL_TLS_MODE", raising=False)
    assert tls_mode_from_env() == "off"
    monkeypatch.setenv("ORWELL_TLS_MODE", "local")
    assert tls_mode_from_env() == "local"
    monkeypatch.setenv("ORWELL_TLS_MODE", "LOCAL")
    assert tls_mode_from_env() == "local"
    # An unknown value must never silently arm the terminator.
    monkeypatch.setenv("ORWELL_TLS_MODE", "public")
    assert tls_mode_from_env() == "off"

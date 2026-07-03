"""SEC-3 — tool_security must FAIL CLOSED on an auth config gap.

The agent tool gate (`src/tool_execution.py`) blocks bash/python/etc. for non-admins via
`is_public_blocked_tool(tool) and not owner_is_admin_or_single_user(owner)`. The admin check
treats "no auth configured" as a single-user local build and grants admin (so the sole local
user keeps their shell). The fail-OPEN: if `auth.json` FAILS TO LOAD (corrupt file, IO error,
degraded boot) on a deployment that WAS configured, `is_configured` collapses to False and the
old code granted admin to EVERYONE — i.e. an unauthenticated caller could run bash/python.

The fix distinguishes a genuine first-run (no auth.json yet — legitimately single-user) from a
LOAD FAILURE (a config gap) and fails closed on the latter: it must never grant admin/single-user
when the user store could not be read.

Roles only; no houseguest/player names.
"""

import importlib


auth_mod = importlib.import_module("core.auth")
tool_security = importlib.import_module("src.tool_security")


def _mgr(auth_path):
    return auth_mod.AuthManager(auth_path=str(auth_path))


def test_corrupt_authjson_sets_load_failed(tmp_path):
    p = tmp_path / "auth.json"
    p.write_text("{ this is not valid json ", encoding="utf-8")
    mgr = _mgr(p)
    # A corrupt store must be flagged as a load failure (distinct from "no users yet").
    assert mgr.load_failed is True
    assert mgr.is_configured is False


def test_missing_authjson_is_not_a_load_failure(tmp_path):
    # Genuine first-run: the file simply doesn't exist yet. That is NOT a failure —
    # a fresh local single-user build must still operate.
    p = tmp_path / "auth.json"
    mgr = _mgr(p)
    assert mgr.load_failed is False
    assert mgr.is_configured is False


def test_owner_admin_fails_closed_on_load_failure(tmp_path, monkeypatch):
    """The core fail-OPEN: a corrupt/unreadable user store must NOT grant admin to anyone."""
    p = tmp_path / "auth.json"
    p.write_text("}{ corrupt", encoding="utf-8")
    broken = _mgr(p)
    assert broken.load_failed is True and broken.is_configured is False

    monkeypatch.setattr("src.auth_helpers.shared_auth_manager", lambda request=None: broken)
    # Before the fix this returned True (is_configured==False ⇒ "single user" ⇒ admin), which
    # let is_public_blocked_tool(bash)/etc. through for an unauthenticated caller.
    assert tool_security.owner_is_admin_or_single_user("anyone") is False
    assert tool_security.owner_is_admin_or_single_user(None) is False


def test_genuine_single_user_still_admin(tmp_path, monkeypatch):
    # A genuinely-unconfigured (no file) manager still resolves as single-user admin, so the
    # local OOBE / single-player build keeps its shell.
    p = tmp_path / "auth.json"
    fresh = _mgr(p)
    assert fresh.load_failed is False
    monkeypatch.setattr("src.auth_helpers.shared_auth_manager", lambda request=None: fresh)
    assert tool_security.owner_is_admin_or_single_user("anyone") is True


def test_blocked_tool_denied_when_store_unreadable(tmp_path, monkeypatch):
    """End-to-end intent: with an unreadable store, bash is a public-blocked tool AND the owner
    is not admin ⇒ the enforcement in tool_execution would deny it."""
    p = tmp_path / "auth.json"
    p.write_text("nonsense", encoding="utf-8")
    broken = _mgr(p)
    monkeypatch.setattr("src.auth_helpers.shared_auth_manager", lambda request=None: broken)
    assert tool_security.is_public_blocked_tool("bash") is True
    assert tool_security.owner_is_admin_or_single_user("attacker") is False
    # The AND at the enforcement site therefore blocks:
    assert (tool_security.is_public_blocked_tool("bash")
            and not tool_security.owner_is_admin_or_single_user("attacker"))

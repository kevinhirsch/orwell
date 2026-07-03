"""SEC-1 — first-run admin setup must be ATOMIC (no unauthenticated admin-claim race).

`/api/auth/setup` is (correctly) unauthenticated — it creates the very first admin. The risk is a
race: two concurrent unauthenticated requests both observe `is_configured == False` and both create
an admin account (the second attacker-controlled). `AuthManager.setup()` closes this with a
dedicated `_setup_lock` around the check-and-write, so exactly ONE admin is ever created and every
later setup call is rejected.

This is a regression guard for that atomicity — it drives many concurrent setup() calls (with
distinct credentials) from a thread pool and asserts exactly one wins and it is the FIRST caller's
account. Roles only; no real names.
"""

import concurrent.futures
import importlib

auth_mod = importlib.import_module("core.auth")


def test_only_one_admin_survives_concurrent_setup(tmp_path):
    mgr = auth_mod.AuthManager(auth_path=str(tmp_path / "auth.json"))
    assert mgr.is_configured is False

    # Many racing first-run setups with DISTINCT credentials — as if several unauthenticated
    # clients hit /api/auth/setup at once.
    candidates = [(f"admin{i}", "correct-horse-battery") for i in range(32)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as ex:
        results = list(ex.map(lambda c: mgr.setup(c[0], c[1]), candidates))

    # Exactly one setup() returned True; every other observed is_configured and was refused.
    assert results.count(True) == 1, "more than one concurrent setup created an admin (race!)"
    assert results.count(False) == len(candidates) - 1

    # Exactly one user exists, and it is an admin.
    users = mgr.users
    assert len(users) == 1
    (only_user,) = users.keys()
    assert mgr.is_admin(only_user) is True


def test_setup_refused_once_configured(tmp_path):
    mgr = auth_mod.AuthManager(auth_path=str(tmp_path / "auth.json"))
    assert mgr.setup("first-admin", "correct-horse-battery") is True
    # A later setup — even with the SAME or different creds — never creates a second admin.
    assert mgr.setup("second-admin", "another-strong-pass") is False
    assert len(mgr.users) == 1
    assert "second-admin" not in mgr.users

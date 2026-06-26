"""Issue #966 — stop the per-request `AuthManager()` re-reads (log spam + I/O).

ROOT CAUSE pinned here: `AuthManager.__init__` re-reads auth.json + sessions.json
from disk and logs ("Auth config loaded" / "Loaded N session(s) from disk") on
EVERY construction. The app holds ONE instance at `app.state.auth_manager`
(app.py), but several hot code paths used to build a fresh `AuthManager()` per
call, so the logs spammed roughly every poll interval (~60s) and the disk reads
were wasted.

The contract:
  1. The hot call sites resolve the shared singleton via
     `src.auth_helpers.shared_auth_manager(...)` — NOT a bare `AuthManager()` as
     the primary path. The ONLY sanctioned bare construction is the lazy
     last-resort fallback inside `shared_auth_manager` itself.
  2. `shared_auth_manager()` returns the SAME instance across calls (no re-read),
     and prefers `request.app.state.auth_manager` when a request is available.
  3. The admin check still works end-to-end (behavior unchanged).
"""

import ast
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

FE = Path(__file__).resolve().parents[1]


# --- (1) source-pin: no bare AuthManager() as the primary path in the hot fns ---

# function-or-method name within the file -> the file it lives in.
HOT_SITES = {
    "routes/task_routes.py": ["_is_admin"],
    "routes/note_routes.py": ["_is_admin_or_single_user", "reorder_notes"],
    "src/tool_security.py": ["owner_is_admin_or_single_user"],
    "src/builtin_actions.py": None,  # whole-module sweep (the daily-brief helper)
    "src/auth_helpers.py": ["is_admin_user"],
}


def _function_source(path: Path, fn_name: str) -> str:
    """Return the source text of the named (possibly nested) function/method."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == fn_name:
            found.append(node)
    assert found, f"{fn_name} not found in {path}"
    lines = path.read_text(encoding="utf-8").splitlines()
    out = []
    for node in found:
        end = getattr(node, "end_lineno", node.lineno)
        out.append("\n".join(lines[node.lineno - 1:end]))
    return "\n".join(out)


BARE_CTOR = re.compile(r"\bAuthManager\s*\(")


@pytest.mark.parametrize("rel,fns", list(HOT_SITES.items()))
def test_hot_sites_do_not_construct_a_fresh_authmanager(rel, fns):
    path = FE / rel
    src = path.read_text(encoding="utf-8")
    if fns is None:
        # Whole-module sweep (excluding comment lines): no AuthManager( call.
        code_lines = [ln for ln in src.splitlines() if not ln.lstrip().startswith("#")]
        offenders = [ln for ln in code_lines if BARE_CTOR.search(ln)]
        assert not offenders, f"{rel} still constructs AuthManager(): {offenders}"
        assert "shared_auth_manager" in src, f"{rel} must use shared_auth_manager"
        return
    for fn in fns:
        body = _function_source(path, fn)
        assert not BARE_CTOR.search(body), (
            f"{rel}:{fn} still constructs a fresh AuthManager() — use the singleton "
            f"via shared_auth_manager(...)"
        )
        assert "shared_auth_manager" in body, (
            f"{rel}:{fn} must resolve the shared singleton via shared_auth_manager(...)"
        )


def test_only_sanctioned_bare_ctor_is_the_singleton_fallback():
    """The lone bare `AuthManager()` runtime call lives inside the helper fallback."""
    helper = (FE / "src" / "auth_helpers.py").read_text(encoding="utf-8")
    # Strip comments so the explanatory `# fresh ``AuthManager()`` ...` note is ignored.
    code = "\n".join(ln for ln in helper.splitlines() if not ln.lstrip().startswith("#"))
    ctor_lines = [ln for ln in code.splitlines() if BARE_CTOR.search(ln)]
    assert ctor_lines == ["        _SHARED_AUTH_MANAGER = AuthManager()"], ctor_lines


# --- (2) behavioral smoke: the singleton is reused; admin check still works ---


@pytest.fixture(autouse=True)
def _reset_singleton():
    import src.auth_helpers as ah
    ah._SHARED_AUTH_MANAGER = None
    yield
    ah._SHARED_AUTH_MANAGER = None


def test_shared_auth_manager_is_reused_without_re_reading(tmp_path, monkeypatch):
    import src.auth_helpers as ah
    from core.auth import AuthManager

    constructed = {"n": 0}
    real_init = AuthManager.__init__

    def _counting_init(self, *a, **kw):
        constructed["n"] += 1
        kw.setdefault("auth_path", str(tmp_path / "auth.json"))
        real_init(self, *a, **kw)

    monkeypatch.setattr(AuthManager, "__init__", _counting_init)

    first = ah.shared_auth_manager()
    second = ah.shared_auth_manager()
    third = ah.shared_auth_manager()

    assert first is second is third
    # Lazy construction happens at most once — the whole point of #966.
    assert constructed["n"] == 1


def test_shared_auth_manager_prefers_app_state_singleton(tmp_path):
    import src.auth_helpers as ah
    from core.auth import AuthManager

    app_singleton = AuthManager(auth_path=str(tmp_path / "auth.json"))
    fake_request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(auth_manager=app_singleton)))

    resolved = ah.shared_auth_manager(fake_request)
    assert resolved is app_singleton
    # And without an app-state singleton it falls back to the cached instance.
    assert ah._SHARED_AUTH_MANAGER is None  # untouched by the app-state hit


def test_admin_check_still_works_through_the_singleton(tmp_path, monkeypatch):
    """is_admin_user (the request-free helper) resolves admin correctly."""
    import src.auth_helpers as ah
    from core.auth import AuthManager

    mgr = AuthManager(auth_path=str(tmp_path / "auth.json"))
    # First account is the administrator.
    mgr.create_user("owner", "password123", is_admin=True)
    mgr.create_user("guest", "password123", is_admin=False)
    ah._SHARED_AUTH_MANAGER = mgr

    assert ah.is_admin_user("owner") is True
    assert ah.is_admin_user("guest") is False
    assert ah.is_admin_user(None) is False
    assert ah.is_admin_user("nobody") is False

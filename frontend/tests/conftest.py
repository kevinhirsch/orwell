"""Test setup for the app-admin feature (0029).

The vendored front-end's package `core/__init__.py` eagerly boots the whole app
(llm_core, the database, cryptography), which can't import in a bare test env. The
app-admin logic, though, lives entirely in the self-contained `core.auth` and
`core.middleware` modules. We load just those by stubbing the `core` package so its
heavy `__init__` never runs.
"""

import functools
import os
import pathlib
import sys
import tempfile
import types

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_DIR = os.path.join(FRONTEND_DIR, "core")

if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

# Any test that imports a `core.database`-backed router (e.g. routes.model_routes for
# the agent-tools gating tests) transitively triggers core/database.py's module-load
# init_db(), which opens the app's DB. The default URL is the RELATIVE ./data/app.db,
# and CI's fresh checkout has no frontend/data/ dir → "unable to open database file".
# Point the ORM at a throwaway temp DB before that first import (conftest loads ahead of
# the test modules). setdefault so an explicit DATABASE_URL still wins.
os.environ.setdefault(
    "DATABASE_URL",
    "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-test-db-"), "app.db"),
)

# Replace `core` with a lightweight package stub pointing at the real core/ dir, so
# `import core.auth` / `import core.middleware` load those files WITHOUT executing
# `core/__init__.py`. Idempotent across the session.
_existing = sys.modules.get("core")
if _existing is None or not getattr(_existing, "_orwell_test_stub", False):
    pkg = types.ModuleType("core")
    pkg.__path__ = [CORE_DIR]
    pkg._orwell_test_stub = True
    sys.modules["core"] = pkg


# ── CI lane split: auto-mark the real headless-browser tests as `browser` ────────────
#
# The FE suite's ~11 Playwright tests (they call `sync_playwright`) dominate wall-clock and carry the
# known environmental onboarding-scrim flake (#925/#1148/#930). CI runs them in a SEPARATE serial lane
# (`fe-browser-tests`, with a retry) while the ~340 non-browser tests run PARALLEL under xdist
# (`fe-unit`). Rather than hand-mark every browser file, detect them structurally: any test whose module
# source calls `sync_playwright` is the `browser` lane. Everything else is xdist-safe (verified: the only
# real fixed-port server binds in the whole suite live in `sync_playwright` files; every other port
# reference is a monkeypatched stub string). Select with `-m browser` / `-m "not browser"`.
@functools.lru_cache(maxsize=None)
def _module_launches_browser(path: str) -> bool:
    try:
        return "sync_playwright" in pathlib.Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False


def pytest_collection_modifyitems(config, items):
    for item in items:
        if _module_launches_browser(str(item.fspath)):
            item.add_marker("browser")

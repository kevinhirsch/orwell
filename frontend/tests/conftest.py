"""Test setup for the app-admin feature (0029).

The vendored front-end's package `core/__init__.py` eagerly boots the whole app
(llm_core, the database, cryptography), which can't import in a bare test env. The
app-admin logic, though, lives entirely in the self-contained `core.auth` and
`core.middleware` modules. We load just those by stubbing the `core` package so its
heavy `__init__` never runs.
"""

import os
import sys
import types

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_DIR = os.path.join(FRONTEND_DIR, "core")

if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

# Replace `core` with a lightweight package stub pointing at the real core/ dir, so
# `import core.auth` / `import core.middleware` load those files WITHOUT executing
# `core/__init__.py`. Idempotent across the session.
_existing = sys.modules.get("core")
if _existing is None or not getattr(_existing, "_orwell_test_stub", False):
    pkg = types.ModuleType("core")
    pkg.__path__ = [CORE_DIR]
    pkg._orwell_test_stub = True
    sys.modules["core"] = pkg

#!/usr/bin/env python3
"""Feature 0032 — front-end boot smoke (the running-instance check).

Boots the REAL front-end app and proves the game-build surface reduction holds
*server-side*, not just in unit tests: under the game build every inherited workspace
vertical's router is unmounted (its paths absent from /openapi.json, /api/shell/exec →
404), while the game keep-set (chat, conversation search, the engine MCP bridge, auth)
is mounted; with the game build off, the dropped routers come back. This is the analogue
of deploy/smoke.sh for the engine — it needs a real boot, so it can't be a unit test.

Run locally or in CI:  python3 scripts/boot_smoke.py
Override the interpreter (e.g. a venv) with PYTHON=/path/to/python.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # frontend/
PY = os.environ.get("PYTHON", sys.executable)

# Inherited verticals that must be GONE under the game build. Specific enough not to
# collide with kept endpoints — note "/api/search/" (web-search subpaths) excludes the
# kept bare "/api/search" (conversation search, owned by chat_routes).
DROP_PREFIXES = (
    "/api/shell", "/api/email", "/api/gallery", "/api/compare", "/api/memory",
    "/api/calendar", "/api/contacts", "/api/notes", "/api/tasks", "/api/research",
    "/api/cookbook", "/api/hwfit", "/api/webhooks", "/api/skills", "/api/search/",
    "/api/signature", "/api/document", "/api/editor",
)

_fails: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ok  — " if cond else "  FAIL — ") + label)
    if not cond:
        _fails.append(label)


def boot(game_build: int, port: int):
    """Start uvicorn and wait until /openapi.json answers; returns (process, base_url)."""
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)  # fresh checkout has none
    env = dict(os.environ, ORWELL_GAME_BUILD=str(game_build),
               AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    log = open(f"/tmp/fe-boot-{port}.log", "w")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(60):
        if proc.poll() is not None:
            sys.exit(f"FAIL — uvicorn exited early (game_build={game_build}); see /tmp/fe-boot-{port}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    sys.exit(f"FAIL — server on :{port} never became ready")


def status(base: str, path: str, method: str = "GET") -> int:
    req = urllib.request.Request(base + path, method=method)
    try:
        return urllib.request.urlopen(req, timeout=10).status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def mounted_paths(base: str) -> set[str]:
    with urllib.request.urlopen(base + "/openapi.json", timeout=10) as r:
        return set(json.load(r)["paths"].keys())


def stop(proc) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except Exception:
        proc.kill()


# ── Game build ON: the reduced surface ────────────────────────────────────────
print("==> boot (game build ON)")
proc, base = boot(1, 8190)
try:
    paths = mounted_paths(base)
    check(len(paths) > 50, f"app boots with the keep-set mounted ({len(paths)} paths)")
    leaked = sorted(p for p in paths if p.startswith(DROP_PREFIXES))
    check(not leaked, f"no dropped vertical is mounted (leaked: {leaked})")
    check("/api/search" in paths, "keep-set: conversation search (/api/search) mounted")
    check(any(p.startswith("/api/auth") for p in paths), "keep-set: accounts/auth mounted")
    check(any("mcp" in p for p in paths), "keep-set: engine MCP backend mounted")
    check(status(base, "/") == 200, "keep-set: GET / -> 200")
    check(status(base, "/api/shell/exec", "POST") == 404, "drop: /api/shell/exec -> 404 (gone server-side)")
    check(status(base, "/api/shell/stream", "POST") == 404, "drop: /api/shell/stream -> 404")
finally:
    stop(proc)

# ── Game build OFF: the full workspace returns ────────────────────────────────
print("==> boot (game build OFF)")
proc, base = boot(0, 8191)
try:
    paths = mounted_paths(base)
    check(any(p.startswith("/api/shell") for p in paths), "switch off: shell router mounted again")
    check(status(base, "/api/shell/exec", "POST") != 404, "switch off: /api/shell/exec reachable (not 404)")
finally:
    stop(proc)

print()
if _fails:
    print(f"FE BOOT SMOKE FAILED ({len(_fails)})")
    sys.exit(1)
print("FE BOOT SMOKE PASSED")

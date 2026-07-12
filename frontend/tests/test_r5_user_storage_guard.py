"""R5 / issue #1416 — per-user client-storage isolation guard (fail-closed on absent data-user).

Requirement 0021 is per-user client-LAYER isolation. Every per-user localStorage key must be
namespaced by the physical-world user so two accounts sharing one browser never read/write each
other's transient UI state. Historically each site keyed as

    base + ':' + ((document.body && document.body.dataset.user) || '')

and the `|| ''` fallback collapsed EVERY key into one shared empty-user ("") namespace whenever
document.body.dataset.user was absent — layout/persistence bleeding across users (not a Vault leak,
but a real cross-user isolation defect).

The fix (this suite pins it):
  * a SINGLE shared helper `window.orwellUserKey(name)` (static/js/orwellUserKey.js) that returns a
    per-user key ONLY when data-user is a non-empty string, and otherwise returns null — FAIL-CLOSED,
    so callers SKIP persistence (write NOTHING) instead of sharing the empty-user namespace;
  * every per-user localStorage keying site migrated onto it and null-guarded;
  * the identity is injected on boot (so the fail-closed path is the exception, not the norm).

Two halves: SOURCE-pinned structural checks (the FE pytest lane has no DOM runtime) + a BEHAVIORAL
proof that runs the real helper in Node and shows nothing is written when data-user is absent.
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")

# The non-fenced per-user localStorage keying sites migrated onto window.orwellUserKey.
MIGRATED = (
    "orwellGadget.js",
    "orwellGadgetRail.js",
    "orwellNotice.js",
    "orwellChatHint.js",
    "orwellPremiereTutorial.js",
    "orwellSlots.js",
    "orwellStatusPanel.js",
)


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── STRUCTURAL ───────────────────────────────────────────────────────────────

def test_helper_exists_and_is_fail_closed():
    js = _read("static", "js", "orwellUserKey.js")
    # installed on window for the non-module IIFE panels
    assert "window.orwellUserKey" in js
    # fail-closed: a null return unless data-user is a NON-EMPTY string
    assert 'if (typeof u !== "string" || u === "") return null;' in js
    # it reads the live identity (not a module-load cache)
    assert "document.body.dataset.user" in js


def test_helper_loaded_before_the_per_user_panels_in_index():
    html = _read("static", "index.html")
    assert "/static/js/orwellUserKey.js" in html, "helper must be wired into index.html"
    pos = html.index("/static/js/orwellUserKey.js")
    # it must load BEFORE every panel that derives a per-user key through it
    for panel in MIGRATED:
        assert f"/static/js/{panel}" in html, f"{panel} missing from index.html"
        assert pos < html.index(f"/static/js/{panel}"), (
            f"orwellUserKey.js must load before {panel}"
        )


def test_every_migrated_site_uses_the_guard_and_dropped_the_empty_fallback():
    for panel in MIGRATED:
        js = _read("static", "js", panel)
        assert "window.orwellUserKey(" in js, f"{panel} must derive its key via the shared helper"
        # the collapsing `|| ""` / `|| ''` empty-user fallback on dataset.user must be GONE
        assert 'dataset.user) || ""' not in js, f"{panel} still has the empty-user fallback"
        assert "dataset.user) || ''" not in js, f"{panel} still has the empty-user fallback"


def test_data_user_identity_is_injected_on_boot():
    """DoD #3 — the per-user namespace is always populated for an authed session.

    There is no static `<body data-user>` attribute and no server-side template inject; the identity
    is set CLIENT-SIDE by the boot script in index.html — seeded synchronously from sessionStorage
    then confirmed via /api/auth/status. That is the mechanism that guarantees dataset.user is a real
    user for an authed page, so the helper's fail-closed (skip) branch is the exception, not the norm.
    """
    html = _read("static", "index.html")
    assert "document.body.dataset.user = u;" in html, "boot must set the confirmed identity"
    assert "/api/auth/status" in html, "identity is confirmed from the auth status endpoint"
    assert "orwell-current-user" in html, "identity is seeded synchronously from sessionStorage"


# ── BEHAVIORAL (run the real helper in Node) ─────────────────────────────────

def _run_helper_probe():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral fail-closed proof")
    helper = os.path.join(STATIC, "orwellUserKey.js").replace("\\", "/")
    # A recording localStorage + a MUTABLE document.body.dataset (the helper reads it fresh per
    # call). `guardedWrite` replicates the EXACT call-site idiom every migrated site now uses:
    #   var k = window.orwellUserKey && window.orwellUserKey(base); if (k) localStorage.setItem(...)
    script = (
        "globalThis.window = globalThis;\n"
        "const writes = [];\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;},\n"
        "  setItem(k,v){ writes.push(String(k)); this._d[String(k)]=String(v); },\n"
        "  removeItem(k){ delete this._d[String(k)]; } };\n"
        "const dataset = {};\n"
        "globalThis.document = { body: { dataset } };\n"
        "import fs from 'node:fs';\n"
        f"const src = fs.readFileSync('{helper}', 'utf8');\n"
        "(0, eval)(src);\n"
        "function guardedWrite(base){ const k = window.orwellUserKey && window.orwellUserKey(base);\n"
        "  if (k) { localStorage.setItem(k, '1'); } return k; }\n"
        "const out = {};\n"
        # A) no data-user at all → null, and a guarded write persists NOTHING
        "delete dataset.user;\n"
        "out.absent_key = window.orwellUserKey('base');\n"
        "out.absent_write = guardedWrite('base');\n"
        # B) empty-string user → still null (no shared '' namespace)
        "dataset.user = '';\n"
        "out.empty_key = window.orwellUserKey('base');\n"
        "out.empty_write = guardedWrite('base');\n"
        # C) a real user → the namespaced key, and the write lands under it ONLY
        "dataset.user = 'u1';\n"
        "out.present_key = window.orwellUserKey('base');\n"
        "out.present_write = guardedWrite('base');\n"
        "out.writes = writes;\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_absent_user_is_fail_closed_no_shared_namespace_write():
    out = _run_helper_probe()
    # no identity ⇒ null key ⇒ nothing written
    assert out["absent_key"] is None
    assert out["absent_write"] is None
    # empty-string identity ⇒ still null (never a shared "" namespace)
    assert out["empty_key"] is None
    assert out["empty_write"] is None
    # the ONLY write that ever happened was the namespaced one for the real user
    assert out["writes"] == ["base:u1"], out["writes"]


def test_present_user_writes_only_under_the_namespaced_key():
    out = _run_helper_probe()
    assert out["present_key"] == "base:u1"
    assert out["present_write"] == "base:u1"

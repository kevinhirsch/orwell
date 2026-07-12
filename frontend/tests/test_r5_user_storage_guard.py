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
import re
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


# The per-user key functions in each migrated file. A fail-closed key fn can return null (absent
# data-user), so its RESULT must never be handed straight to Web Storage — that string-coerces null
# into a shared "null" key (the exact isolation hole #1416 closes). Every call site must route the
# key through a local var that is null-checked first.
_PER_USER_KEY_FNS = (
    "dismissKey", "_dismissKey", "offsetKey", "_orderKey",
    "collapseKey", "storageKey", "computeGameKey",
)
# A fail-closed key fn's result is inlined DIRECTLY into a storage call — the regression class
# Greptile's T-Rex found (orwellNotice _onSyncedLayout, orwellSlots saveDragOffset). Must be zero.
_INLINED_KEY_INTO_STORAGE = re.compile(
    r"(?:localStorage\.(?:getItem|setItem|removeItem)|lsGet|lsSet)\(\s*(?:"
    + "|".join(_PER_USER_KEY_FNS)
    + r")\s*\("
)


def test_no_migrated_site_hands_an_unguarded_key_to_web_storage():
    """The #1416 fail-closed guard is only real if a NULL key can NEVER reach Web Storage.

    Every per-user key fn can return null (absent data-user); a null handed to
    getItem/setItem/removeItem coerces to a shared "null" key — the very isolation hole this PR
    closes. So no migrated file may inline a key-fn call directly inside a storage call; the key
    must go through a local var that is null-checked first. This pins the two paths Greptile's
    T-Rex reproduced (orwellNotice _onSyncedLayout, orwellSlots saveDragOffset) plus every sibling.
    """
    offenders = []
    for panel in MIGRATED:
        js = _read("static", "js", panel)
        for m in _INLINED_KEY_INTO_STORAGE.finditer(js):
            line = js.count("\n", 0, m.start()) + 1
            offenders.append(f"{panel}:{line}: {m.group(0)}…")
    assert not offenders, (
        "a per-user key fn's (nullable) result is passed straight to Web Storage — null would "
        "coerce to a shared 'null' key. Route it through a null-checked local var:\n  "
        + "\n  ".join(offenders)
    )


def test_the_two_greptile_paths_now_null_guard_before_storage():
    # orwellNotice.js — the synced-layout remote-dismiss path (_onSyncedLayout).
    notice = _read("static", "js", "orwellNotice.js")
    seam = notice[notice.index("function _onSyncedLayout("):]
    seam = seam[: seam.index("window.addEventListener")]
    assert "var k = dismissKey(id);" in seam and "if (k)" in seam, \
        "the remote-dismiss path must null-guard dismissKey(id) before localStorage.setItem"

    # orwellSlots.js — the drag-end save path (saveDragOffset).
    slots = _read("static", "js", "orwellSlots.js")
    seam = slots[slots.index("saveDragOffset("):]
    seam = seam[: seam.index("restack()")]
    assert "const k = offsetKey(o.key);" in seam and "if (k)" in seam, \
        "the drag-save path must null-guard offsetKey(o.key) before localStorage.removeItem"


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
    # Single-user / no-auth posture: the boot resolves a STABLE default ("local"), never empty, so
    # the fail-closed skip cannot strand localhost persistence (and it never clobbers the server
    # default back to empty). Auth-ON keeps the empty (fail-closed) branch.
    assert "authOff ? 'local' : ''" in html, "no-auth boot must resolve a stable default namespace"
    assert "d.auth_enabled === false" in html


# ── SERVER-SIDE INJECTION (single-user / no-auth posture) ────────────────────

class _StubRequest:
    """Minimal Starlette Request stand-in — the serve helper only reads request.state.csp_nonce."""
    class state:  # noqa: N801
        csp_nonce = ""


def _render_index(monkeypatch, *, auth_enabled: bool, game_build: bool = True) -> str:
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1" if game_build else "0")
    monkeypatch.setenv("AUTH_ENABLED", "true" if auth_enabled else "false")
    monkeypatch.delenv("ORWELL_WS_TRANSPORT", raising=False)
    from app import _serve_html_with_nonce, BASE_DIR
    from src.app_helpers import abs_join
    resp = _serve_html_with_nonce(_StubRequest(), abs_join(BASE_DIR, "static/index.html"))
    return resp.body.decode("utf-8")


def _body_open_tag(html: str) -> str:
    bs = html.find("<body")
    assert bs != -1, "served html has no <body> tag"
    return html[bs: html.find(">", bs) + 1]


def test_no_auth_mode_injects_stable_default_data_user_server_side(monkeypatch):
    # AUTH_ENABLED=false (the single-user / localhost posture browser_smoke boots) ⇒ the server
    # injects a stable default namespace synchronously at parse time, so orwellUserKey() produces a
    # real key and single-user persistence works (gadget order, window layout, dismissed notices).
    html = _render_index(monkeypatch, auth_enabled=False)
    # it lands on the <body> open tag itself (alongside data-game-build), not somewhere stray
    assert 'data-user="local"' in _body_open_tag(html), \
        "no-auth render must inject a stable default data-user on <body>"


def test_auth_enabled_mode_injects_no_server_side_data_user(monkeypatch):
    # AUTH_ENABLED=true (multi-user) ⇒ NO server default on the body: the per-session identity is
    # resolved client-side from /api/auth/status, so a genuinely-missing data-user stays absent and
    # the fail-closed guard skips persistence rather than sharing an empty namespace (#1416 intent).
    html = _render_index(monkeypatch, auth_enabled=True)
    assert "data-user=" not in _body_open_tag(html), \
        "auth-on render must NOT stamp a shared server-side data-user on <body>"


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

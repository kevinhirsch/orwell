"""R5 / issue #1416 — per-user client-storage isolation (namespace by data-user, never shared "").

Requirement 0021 is per-user client-LAYER isolation. Every per-user localStorage key must be
namespaced by the physical-world user so two accounts sharing one browser never read/write each
other's transient UI state. Historically each site keyed as

    base + ':' + ((document.body && document.body.dataset.user) || '')

and the `|| ''` fallback collapsed EVERY key into one shared empty-user ("") namespace whenever
document.body.dataset.user was absent — layout/persistence bleeding across users (not a Vault leak,
but a real cross-user isolation defect).

The fix (this suite pins it):
  * a SINGLE shared helper `window.orwellUserKey(name)` (static/js/orwellUserKey.js) that keys under
    the real data-user when present, and under a STABLE "local" namespace when it is absent/empty —
    NEVER the shared empty ("") one. The empty/absent case is the single-user / no-auth posture
    (AUTH_ENABLED=false, e.g. localhost): exactly ONE effective user, so "local" is correct and lets
    no-auth persistence work. An authed multi-user page always carries a real data-user, so the
    helper never falls back to "local" there — two real users never collide, and "" is never used;
  * every per-user localStorage keying site migrated onto it (null-guards kept, harmless);
  * the "local" fallback lives INSIDE the helper — the boot leaves data-user EMPTY in no-auth mode,
    so surfaces that read data-user DIRECTLY (the per-tab send-outbox / composer draft in the fenced
    chat.js) keep their existing empty-user value and behavior unchanged.

Two halves: SOURCE-pinned structural checks (the FE pytest lane has no DOM runtime) + a BEHAVIORAL
proof that runs the real helper in Node.
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

def test_helper_keys_under_local_when_no_identity_never_empty():
    js = _read("static", "js", "orwellUserKey.js")
    # installed on window for the non-module IIFE panels
    assert "window.orwellUserKey" in js
    # the stable single-user / no-auth namespace, used only when there is no data-user identity
    assert 'var LOCAL_USER = "local";' in js
    # no identity ⇒ the "local" namespace, NEVER the shared empty ("") one
    assert 'if (typeof u !== "string" || u === "") u = LOCAL_USER;' in js
    # it reads the live identity (not a module-load cache) and never returns the empty namespace
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


# The per-user key functions in each migrated file. Their result must never be inlined directly into
# a Web Storage call — it must route through a local var (the null-guards stay as defense-in-depth,
# so a future helper change that reintroduces a null can never string-coerce it into a "null" key).
# This is the exact regression class Greptile's T-Rex found (orwellNotice _onSyncedLayout,
# orwellSlots saveDragOffset).
_PER_USER_KEY_FNS = (
    "dismissKey", "_dismissKey", "offsetKey", "_orderKey",
    "collapseKey", "storageKey", "computeGameKey",
)
_INLINED_KEY_INTO_STORAGE = re.compile(
    r"(?:localStorage\.(?:getItem|setItem|removeItem)|lsGet|lsSet)\(\s*(?:"
    + "|".join(_PER_USER_KEY_FNS)
    + r")\s*\("
)


def test_no_migrated_site_inlines_a_key_fn_directly_into_web_storage():
    """No migrated file may inline a per-user key-fn call directly inside a storage call.

    The key must go through a local var (which the sites null-guard). Pins the two paths Greptile's
    T-Rex reproduced (orwellNotice _onSyncedLayout, orwellSlots saveDragOffset) plus every sibling,
    so a nullable key can never reach Web Storage and coerce to a shared "null" key.
    """
    offenders = []
    for panel in MIGRATED:
        js = _read("static", "js", panel)
        for m in _INLINED_KEY_INTO_STORAGE.finditer(js):
            line = js.count("\n", 0, m.start()) + 1
            offenders.append(f"{panel}:{line}: {m.group(0)}…")
    assert not offenders, (
        "a per-user key fn's result is passed straight to Web Storage — route it through a "
        "null-checked local var instead:\n  " + "\n  ".join(offenders)
    )


def test_the_two_greptile_paths_null_guard_before_storage():
    # orwellNotice.js — the synced-layout remote-dismiss path (_onSyncedLayout).
    notice = _read("static", "js", "orwellNotice.js")
    seam = notice[notice.index("function _onSyncedLayout("):]
    seam = seam[: seam.index("window.addEventListener")]
    assert "var k = dismissKey(id);" in seam and "if (k)" in seam, \
        "the remote-dismiss path must route dismissKey(id) through a guarded local var"

    # orwellSlots.js — the drag-end save path (saveDragOffset).
    slots = _read("static", "js", "orwellSlots.js")
    seam = slots[slots.index("saveDragOffset("):]
    seam = seam[: seam.index("restack()")]
    assert "const k = offsetKey(o.key);" in seam and "if (k)" in seam, \
        "the drag-save path must route offsetKey(o.key) through a guarded local var"


def test_boot_sets_data_user_from_auth_identity_and_leaves_no_auth_empty():
    """The per-user namespace is populated from the session identity on boot.

    There is no static `<body data-user>` and no server-side inject; the identity is set CLIENT-SIDE
    by the boot script — seeded from sessionStorage then confirmed via /api/auth/status. In the
    no-auth posture there is no username, so the boot leaves data-user EMPTY (the "local" fallback is
    owned by the helper, NOT stamped onto the global attribute) — so the fenced send-outbox, which
    reads data-user directly, keeps its existing empty-user value.
    """
    html = _read("static", "index.html")
    assert "document.body.dataset.user = u;" in html, "boot must set the confirmed identity"
    assert "/api/auth/status" in html, "identity is confirmed from the auth status endpoint"
    assert "orwell-current-user" in html, "identity is seeded synchronously from sessionStorage"
    # the identity resolves to the real username or empty — the boot never stamps 'local' globally
    assert "var u = (d && d.username) ? String(d.username) : '';" in html, \
        "boot must leave data-user empty in no-auth mode (the helper owns the 'local' fallback)"
    # and there is no server-side data-user stamp in the served page
    assert 'data-user="local"' not in html, "no-auth persistence is via the helper, not a body stamp"


# ── BEHAVIORAL (run the real helper in Node) ─────────────────────────────────

def _run_helper_probe():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral helper proof")
    helper = os.path.join(STATIC, "orwellUserKey.js").replace("\\", "/")
    # A recording localStorage + a MUTABLE document.body.dataset (the helper reads it fresh per call).
    # `guardedWrite` replicates the exact call-site idiom the migrated sites use.
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
        "function guardedWrite(base){ const k = window.orwellUserKey(base);\n"
        "  if (k) { localStorage.setItem(k, '1'); } return k; }\n"
        "const out = {};\n"
        # A) no data-user at all → the stable 'local' namespace, and a write lands under it
        "delete dataset.user;\n"
        "out.absent_key = window.orwellUserKey('base');\n"
        "out.absent_write = guardedWrite('base');\n"
        # B) empty-string user → still 'local' (never the shared '' namespace)
        "dataset.user = '';\n"
        "out.empty_key = window.orwellUserKey('base');\n"
        # C) a real user u1 → their own namespace, write lands under it
        "dataset.user = 'u1';\n"
        "out.u1_key = window.orwellUserKey('base');\n"
        "out.u1_write = guardedWrite('base');\n"
        # D) a DIFFERENT real user u2 → a distinct namespace
        "dataset.user = 'u2';\n"
        "out.u2_key = window.orwellUserKey('base');\n"
        "out.writes = writes;\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_no_auth_keys_under_stable_local_never_the_shared_empty_namespace():
    out = _run_helper_probe()
    # no identity ⇒ the stable 'local' namespace (NOT 'base:' — the shared empty one)
    assert out["absent_key"] == "base:local"
    assert out["absent_write"] == "base:local"
    # empty-string identity ⇒ still 'local'
    assert out["empty_key"] == "base:local"
    # the shared empty namespace is NEVER produced
    assert "base:" not in out["writes"], out["writes"]
    assert out["absent_key"] != "base:"


def test_multi_user_isolation_two_real_users_never_collide_and_never_local():
    out = _run_helper_probe()
    # each real user keys under their OWN namespace
    assert out["u1_key"] == "base:u1"
    assert out["u2_key"] == "base:u2"
    # two different real users never collide
    assert out["u1_key"] != out["u2_key"]
    # a real user is NEVER the 'local' fallback namespace
    assert out["u1_key"] != "base:local" and out["u2_key"] != "base:local"
    # writes: no-auth landed under :local, the real user under :u1 — never a shared bucket
    assert out["writes"] == ["base:local", "base:u1"], out["writes"]

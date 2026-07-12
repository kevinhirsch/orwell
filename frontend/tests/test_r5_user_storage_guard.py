"""R5 / issue #1416 — per-user client-storage isolation (namespace by data-user, never shared "").

Requirement 0021 is per-user client-LAYER isolation. Every per-user localStorage key must be
namespaced by the physical-world user so two accounts sharing one browser never read/write each
other's transient UI state. Historically each site keyed as

    base + ':' + ((document.body && document.body.dataset.user) || '')

and the `|| ''` fallback collapsed EVERY key into one shared empty-user ("") namespace whenever
document.body.dataset.user was absent — layout/persistence bleeding across users (not a Vault leak,
but a real cross-user isolation defect).

The fix (this suite pins it):
  * a SINGLE shared helper `window.orwellUserKey(name)` (static/js/orwellUserKey.js) with THREE
    branches (#1416b hardened the middle one):
      1. data-user present  → `name:user`  (a real authed user's OWN namespace);
      2. no data-user + an EXPLICIT no-auth signal (window.__ORWELL_NO_AUTH__ === true)
         → `name:local` (the single-user / AUTH_ENABLED=false posture — exactly ONE effective user,
         so "local" is correct and lets no-auth persistence work), NEVER the shared empty ("") one;
      3. no data-user + NO no-auth signal → `null` (FAIL CLOSED — the caller SKIPS the write). This
         is the reviewer's case: a MULTI-user deploy whose server omits data-user must NOT let two
         real users share the ":local" bucket. It is also the pre-auth boot window (before
         /api/auth/status confirms), which is meant to skip.
  * every per-user localStorage keying site migrated onto it and null-guarded (a null key is never
    handed to Web Storage, which would coerce it to a real "null" key);
  * the "local" fallback lives INSIDE the helper, gated on a SEPARATE global — the boot leaves
    data-user EMPTY in no-auth mode, so surfaces that read data-user DIRECTLY (the per-tab
    send-outbox / composer draft in the fenced chat.js) keep their existing empty-user value and
    behavior unchanged.

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

# The per-user localStorage keying sites migrated onto window.orwellUserKey — the original seven
# (#1416) plus the two former-fenced follow-ups migrated in #1416b (orwellWindow.js parked/docked/
# slot-offset-reset, orwellCastPin.js pinned).
MIGRATED = (
    "orwellGadget.js",
    "orwellGadgetRail.js",
    "orwellNotice.js",
    "orwellChatHint.js",
    "orwellPremiereTutorial.js",
    "orwellSlots.js",
    "orwellStatusPanel.js",
    "orwellWindow.js",
    "orwellCastPin.js",
)


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── STRUCTURAL ───────────────────────────────────────────────────────────────

def test_helper_keys_by_identity_with_a_failclosed_multiuser_branch():
    js = _read("static", "js", "orwellUserKey.js")
    # installed on window for the non-module IIFE panels
    assert "window.orwellUserKey" in js
    # the stable single-user / no-auth namespace, used only under an EXPLICIT no-auth signal
    assert 'var LOCAL_USER = "local";' in js
    # branch 1 — a real per-user identity ⇒ that user's OWN namespace
    assert 'if (typeof u === "string" && u !== "") return String(name) + ":" + u;' in js
    # branch 2 — the "local" namespace is gated on the EXPLICIT no-auth signal (#1416b), never bare
    assert "window.__ORWELL_NO_AUTH__ === true" in js
    assert 'if (noAuth) return String(name) + ":" + LOCAL_USER;' in js
    # branch 3 — no identity AND no no-auth signal ⇒ FAIL CLOSED (null), never the shared empty one
    assert "return null;" in js
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


# The per-user key functions in each migrated file. Their result must never be inlined directly into
# a Web Storage call — it must route through a local var (the null-guards stay as defense-in-depth,
# so a future helper change that reintroduces a null can never string-coerce it into a "null" key).
# This is the exact regression class Greptile's T-Rex found (orwellNotice _onSyncedLayout,
# orwellSlots saveDragOffset).
_PER_USER_KEY_FNS = (
    "dismissKey", "_dismissKey", "offsetKey", "_orderKey",
    "collapseKey", "storageKey", "computeGameKey",
    # #1416b follow-ups (orwellWindow.js / orwellCastPin.js)
    "parkedKey", "dockedKey", "pinKey",
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


# ── #1416b — the two former-fenced follow-up files ───────────────────────────

def test_1416b_window_kit_parked_docked_and_slot_reset_use_the_helper_and_guard():
    """orwellWindow.js: parkedKey / dockedKey / the Home-key slot-offset reset key per-user via the
    shared helper, base strings preserved (byte-identical keys for an authed user), all null-guarded.
    """
    js = _read("static", "js", "orwellWindow.js")
    # parkedKey — base 'orwell-win-parked:<id>' preserved; the ':<user>' now derives via the helper.
    assert "window.orwellUserKey('orwell-win-parked:' + id)" in js, \
        "parkedKey must derive 'orwell-win-parked:<id>:<user>' via the shared helper"
    # dockedKey — base 'orwell-<id>-docked' preserved.
    assert "window.orwellUserKey('orwell-' + id + '-docked')" in js, \
        "dockedKey must derive 'orwell-<id>-docked:<user>' via the shared helper"
    # the Home-key slot-offset reset — base 'orwell-slot-offset:<slotKey>' preserved.
    assert "window.orwellUserKey('orwell-slot-offset:' + this.o.slotKey)" in js, \
        "the slot-offset reset key must derive via the shared helper"
    # every parked/docked read+write routes the (nullable) key through a guarded local var
    for fn, end in (("function loadParked(id) {", "function saveParked"),
                    ("function saveParked(id, on) {", "\n\n"),
                    ("function loadDocked(id, dflt) {", "function saveDocked"),
                    ("function saveDocked(id, on) {", "\n\n")):
        body = js[js.index(fn):]
        body = body[: body.index(end, len(fn))]
        assert "= parkedKey(id)" in body or "= dockedKey(id)" in body, f"{fn} must derive a local key var"
        # no nullable key-fn is inlined straight into a Web Storage call
        assert "localStorage.getItem(parkedKey(" not in body
        assert "localStorage.setItem(parkedKey(" not in body
        assert "localStorage.removeItem(parkedKey(" not in body
        assert "localStorage.getItem(dockedKey(" not in body
        assert "localStorage.setItem(dockedKey(" not in body
    # saveParked / saveDocked fail-closed on a null key (skip the write)
    save_parked = js[js.index("function saveParked(id, on) {"):]
    save_parked = save_parked[: save_parked.index("\n}\n")]
    assert "if (!k) return;" in save_parked, "saveParked must skip when the per-user key is null"
    save_docked = js[js.index("function saveDocked(id, on) {"):]
    save_docked = save_docked[: save_docked.index("\n}\n")]
    assert "if (!k) return;" in save_docked, "saveDocked must skip when the per-user key is null"


def test_1416b_cast_pin_uses_the_helper_and_guards_read_and_write():
    """orwellCastPin.js: the pinned flag keys per-user via the shared helper (base
    'orwell-cast-pinned' preserved), and both the read (isPinned) and write (setPinned) null-guard.
    """
    js = _read("static", "js", "orwellCastPin.js")
    assert 'window.orwellUserKey("orwell-cast-pinned")' in js, \
        "pinKey must derive 'orwell-cast-pinned:<user>' via the shared helper"
    # isPinned reads through a guarded local var (never lsGet(pinKey()) inline)
    is_pinned = js[js.index("function isPinned() {"):]
    is_pinned = is_pinned[: is_pinned.index("\n  }")]
    assert "var k = pinKey();" in is_pinned and "k ? lsGet(k)" in is_pinned, \
        "isPinned must route pinKey() through a null-guarded local var"
    assert "lsGet(pinKey())" not in js, "the read must not inline pinKey() into lsGet"
    # setPinned writes through a guarded local var (skip when null)
    set_pinned = js[js.index("function setPinned(on) {"):]
    set_pinned = set_pinned[: set_pinned.index("ensureEl();")]
    assert "var k = pinKey();" in set_pinned and "if (k) lsSet(k," in set_pinned, \
        "setPinned must null-guard the write"
    assert "lsSet(pinKey()," not in js, "the write must not inline pinKey() into lsSet"


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


def test_boot_sets_the_explicit_no_auth_signal_separate_from_data_user():
    """#1416b: the boot sets a SEPARATE no-auth global — never data-user — from auth_enabled.

    The helper's ":local" fallback is gated on window.__ORWELL_NO_AUTH__, set true only when
    /api/auth/status reports auth_enabled === false. It is deliberately NOT stamped onto data-user
    (the fenced #891 send-outbox reads data-user directly, and stamping it broke the outbox). The
    signal is also seeded synchronously from sessionStorage so a reload resolves ":local" without
    waiting on the async confirm.
    """
    html = _read("static", "index.html")
    # the SEPARATE global, driven by the auth posture — not data-user
    assert "window.__ORWELL_NO_AUTH__" in html, "boot must set the separate no-auth signal"
    assert "d.auth_enabled === false" in html, "the no-auth signal comes from auth_enabled"
    # synchronous seed + persist across reloads, keyed under its own sessionStorage slot
    assert "'orwell-no-auth'" in html, "the no-auth posture is seeded/persisted in sessionStorage"
    # the no-auth signal must NOT be the data-user attribute (that would re-break #891)
    assert "dataset.user = '__ORWELL_NO_AUTH__'" not in html
    assert 'dataset.user = "local"' not in html and "dataset.user = 'local'" not in html, \
        "the no-auth signal is a separate global — data-user is never stamped 'local'"


# ── BEHAVIORAL (run the real helper in Node) ─────────────────────────────────

def _run_helper_probe():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral helper proof")
    helper = os.path.join(STATIC, "orwellUserKey.js").replace("\\", "/")
    # A recording localStorage + a MUTABLE document.body.dataset (the helper reads it fresh per call)
    # + a togglable window.__ORWELL_NO_AUTH__ (window === globalThis here). `guardedWrite` replicates
    # the exact call-site idiom the migrated sites use (write only when the helper returns a key).
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
        # C) a real user u1 → their own namespace, write lands under it (first write)
        "dataset.user = 'u1';\n"
        "out.u1_key = window.orwellUserKey('base');\n"
        "out.u1_write = guardedWrite('base');\n"
        # D) a DIFFERENT real user u2 → a distinct namespace
        "dataset.user = 'u2';\n"
        "out.u2_key = window.orwellUserKey('base');\n"
        # B) NO-AUTH branch — the EXPLICIT signal is on ⇒ the stable ':local' namespace
        "window.__ORWELL_NO_AUTH__ = true;\n"
        "delete dataset.user;\n"
        "out.noauth_absent_key = window.orwellUserKey('base');\n"
        "out.noauth_absent_write = guardedWrite('base');\n"   # second (and last) write → base:local
        "dataset.user = '';\n"
        "out.noauth_empty_key = window.orwellUserKey('base');\n"
        # A) MULTI-USER branch — the signal is OFF ⇒ null ⇒ the write is SKIPPED (the reviewer's case)
        "window.__ORWELL_NO_AUTH__ = false;\n"
        "delete dataset.user;\n"
        "out.multi_absent_key = window.orwellUserKey('base');\n"
        "out.multi_absent_write = guardedWrite('base');\n"    # null → SKIP
        "dataset.user = '';\n"
        "out.multi_empty_key = window.orwellUserKey('base');\n"
        "out.multi_empty_write = guardedWrite('base');\n"     # null → SKIP
        # the pre-auth boot window — the signal is literally undefined ⇒ null ⇒ SKIP
        "delete window.__ORWELL_NO_AUTH__;\n"
        "delete dataset.user;\n"
        "out.preauth_key = window.orwellUserKey('base');\n"
        "out.preauth_write = guardedWrite('base');\n"         # null → SKIP
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
    # explicit no-auth ⇒ the stable 'local' namespace (NOT 'base:' — the shared empty one)
    assert out["noauth_absent_key"] == "base:local"
    assert out["noauth_absent_write"] == "base:local"
    # empty-string identity under the no-auth signal ⇒ still 'local'
    assert out["noauth_empty_key"] == "base:local"
    # the shared empty namespace is NEVER produced
    assert "base:" not in out["writes"], out["writes"]
    assert out["noauth_absent_key"] != "base:"


def test_multi_user_isolation_two_real_users_never_collide_and_never_local():
    out = _run_helper_probe()
    # each real user keys under their OWN namespace
    assert out["u1_key"] == "base:u1"
    assert out["u2_key"] == "base:u2"
    # two different real users never collide
    assert out["u1_key"] != out["u2_key"]
    # a real user is NEVER the 'local' fallback namespace
    assert out["u1_key"] != "base:local" and out["u2_key"] != "base:local"
    # writes across the whole probe: the real user under :u1 then the no-auth write under :local —
    # NEVER a shared bucket, and the multi-user / pre-auth attempts wrote NOTHING.
    assert out["writes"] == ["base:u1", "base:local"], out["writes"]


def test_multiuser_missing_data_user_fails_closed_and_skips_never_shares_local():
    """#1416b — the reviewer's exact case: a MULTI-user deploy that omits data-user (no no-auth
    signal) must FAIL CLOSED (null ⇒ skip), never share the ':local' bucket, and never write "".
    """
    out = _run_helper_probe()
    # signal OFF, no/empty data-user ⇒ null (skip), for both the absent and empty-string forms
    assert out["multi_absent_key"] is None
    assert out["multi_absent_write"] is None
    assert out["multi_empty_key"] is None
    assert out["multi_empty_write"] is None
    # the pre-auth boot window (signal literally undefined) ⇒ null (skip) too
    assert out["preauth_key"] is None
    assert out["preauth_write"] is None
    # NONE of the fail-closed cases ever reached Web Storage — no ':local', no shared '', no 'null'
    assert out["writes"] == ["base:u1", "base:local"], out["writes"]
    assert "base:" not in out["writes"] and "base:null" not in out["writes"]
    # and a multi-user missing-identity key is NOT the no-auth ':local' bucket
    assert out["multi_absent_key"] != "base:local"

"""DWE #643 — the kit-agnostic synced-UI-state substrate (orwellSyncedState.js).

The PO gate before the kit epics (#640 gadget / #658 settings-card / #659 tabs): a small reusable
client module that any kit uses to persist a piece of UI state AND get realtime two-window mirror BY
CONSTRUCTION, generalizing the 0064 window-layout seam without re-deriving transport.

Two halves, mirroring the repo convention (test_ws_layout_client.py):

  • BEHAVIORAL — run the REAL orwellSyncedState.js AND the REAL orwellLayoutSync.js together in Node
    against stubbed globals, and prove the substrate end-to-end:
      1. register(key,{apply}).set(partial) emits the EXACT `orwell:window-layout` event the layout
         kit emits — so orwellLayoutSync captures it into the SAME PATCH body (byte-identical adoption:
         the window kit is refactorable onto this with no wire change);
      2. persistence rides that seam — a WS-active flush routes through OrwellWs.sendLayout, HTTP PATCH
         otherwise (inherited, not re-implemented);
      3. realtime MIRROR by construction — a peer change (`orwell:layout-changed`) flows through
         orwellLayoutSync → `orwell:layout-seed` → the registered `apply`;
      4. LWW / own-echo — this tab's own-origin echo is dropped upstream and never reaches `apply`;
      5. the load-order race — a seed that lands before register() is replayed on register.

  • STRUCTURAL — pin the shape so a revert that drops the seam fails.

Name-agnostic; roles only; key-free; nothing here touches the real data dir.
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — the real substrate + the real layout-sync, in Node ──────────────

# Stub window/document/localStorage/fetch/setTimeout/OrwellWs, eval BOTH real IIFEs (layout-sync
# first so its `orwell:layout-seed` dispatcher + capture listener exist, then the substrate), then
# drive register/set/peer-change and assert the end-to-end wiring. setTimeout runs synchronously so
# the debounced flush fires deterministically.
_HARNESS = r"""
const fs = require("node:fs");
const layoutSrc = fs.readFileSync(process.argv[1], "utf8");
const stateSrc  = fs.readFileSync(process.argv[2], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

const CANON = "dev_canonical";
const store = { "orwell-device-id": CANON };
const localStorage = {
  getItem(k) { return (k in store) ? store[k] : null; },
  setItem(k, v) { store[k] = v; },
  removeItem(k) { delete store[k]; },
};

const fetchCalls = [];
global.fetch = function (url, opts) {
  fetchCalls.push({ url: url, opts: opts || {} });
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ windows: {} }); } });
};

const dispatched = [];
const listeners = {};
global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };

let wsActive = false;
const sendLayoutCalls = [];
const wsFrameHandlers = {};

global.window = {
  API_BASE: "",
  localStorage: localStorage,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener() {},
  dispatchEvent(e) {
    dispatched.push({ type: e.type, detail: e.detail });
    (listeners[e.type] || []).forEach(function (fn) { try { fn(e); } catch (_) {} });
    return true;
  },
  OrwellWs: {
    isActive() { return wsActive; },
    onFrame(ch, fn) { (wsFrameHandlers[ch] = wsFrameHandlers[ch] || []).push(fn); },
    sendLayout(d) { sendLayoutCalls.push(d); return true; },
  },
};
global.window.localStorage = localStorage;
global.document = { readyState: "complete", addEventListener() {} };
global.window.document = global.document;
global.setTimeout = function (fn) { try { fn(); } catch (_) {} return 0; };
global.clearTimeout = function () {};

function fire(type, detail) { global.window.dispatchEvent(new global.CustomEvent(type, { detail: detail })); }

// Order matters: layout-sync installs the capture listener + the `orwell:layout-seed` dispatcher;
// the substrate installs the `orwell:layout-seed` -> apply router. Both run synchronously in their
// IIFEs, so the substrate's seed listener is registered before any async GET seed resolves.
(0, eval)(layoutSrc);
(0, eval)(stateSrc);

assert(global.window.OrwellSyncedState && typeof global.window.OrwellSyncedState.register === "function",
  "the substrate must expose OrwellSyncedState.register");

// ── 1. register().set(partial) emits the EXACT capture event the window kit emits ───────────────
const applied = [];
const handle = global.window.OrwellSyncedState.register("gadget:deals", {
  apply: function (state, meta) { applied.push({ state: state, meta: meta }); },
});

const beforeCapture = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length;
handle.set({ collapsed: true });
const captures = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; });
assert(captures.length === beforeCapture + 1, "set() must dispatch exactly one orwell:window-layout");
const cap = captures[captures.length - 1];
// Byte-identical to what orwellWindow.emitWindowLayout(id, state) dispatches: { id, state }.
assert(cap.detail && cap.detail.id === "gadget:deals", "capture detail.id is the key");
assert(cap.detail.state && cap.detail.state.collapsed === true, "capture detail.state is the partial");
assert(Object.keys(cap.detail).length === 2 && "id" in cap.detail && "state" in cap.detail,
  "capture detail is exactly {id, state} — byte-identical to the window kit's emit");

// ── 2. persistence rides the layout-sync seam (HTTP PATCH when WS inactive) ──────────────────────
const patch = fetchCalls.filter(function (c) { return c.opts && c.opts.method === "PATCH"; });
assert(patch.length === 1, "the set() must land as ONE HTTP PATCH via orwellLayoutSync; got " + patch.length);
const body = JSON.parse(patch[0].opts.body);
assert(body.windowId === "gadget:deals", "PATCH names the key");
assert(body.state.collapsed === true, "PATCH carries the state");
assert(body.deviceId === CANON, "PATCH inherits the per-device deviceId (persistence is not re-implemented)");
assert(typeof body.origin === "string" && body.origin.length > 0, "PATCH inherits the per-tab origin");

// ── 2b. WS-active flush routes through sendLayout, NOT a second HTTP PATCH ────────────────────────
wsActive = true;
handle.set({ collapsed: false });
assert(sendLayoutCalls.length === 1, "a WS-active flush must ride OrwellWs.sendLayout; got " + sendLayoutCalls.length);
assert(sendLayoutCalls[0].windowId === "gadget:deals", "sendLayout names the key");
const patchesAfter = fetchCalls.filter(function (c) { return c.opts && c.opts.method === "PATCH"; }).length;
assert(patchesAfter === 1, "the WS leg must NOT also HTTP-PATCH; got " + patchesAfter);
wsActive = false;

// ── 3. realtime MIRROR by construction — a peer change reaches apply ─────────────────────────────
// A peer on another window changed the state; the server fans it back as `orwell:layout-changed`
// (the SSE path re-dispatched by sessionSync, or the WS leg). orwellLayoutSync drops our own origin,
// pre-writes, then dispatches `orwell:layout-seed` — which the substrate routes to apply.
const beforeMirror = applied.length;
fire("orwell:layout-changed", { windowId: "gadget:deals", state: { collapsed: true }, origin: "tab_peer" });
assert(applied.length === beforeMirror + 1, "a peer change must reach the registered apply (realtime mirror)");
const mirror = applied[applied.length - 1];
assert(mirror.state.collapsed === true, "apply receives the peer's merged state");
assert(mirror.meta && mirror.meta.key === "gadget:deals", "apply meta carries the key");

// ── 4. LWW / own-echo — our OWN origin echo is dropped upstream, never reaches apply ─────────────
const beforeSelf = applied.length;
fire("orwell:layout-changed", { windowId: "gadget:deals", state: { collapsed: false }, origin: body.origin });
assert(applied.length === beforeSelf, "our own-origin echo must be suppressed and never reach apply");

// ── 5. load-order race — a seed that lands BEFORE register() is replayed on register ─────────────
// Simulate the initial GET seed for a key nobody has registered yet.
fire("orwell:layout-seed", { windowId: "settings:audio", state: { shown: true } });
const lateApplied = [];
const lateHandle = global.window.OrwellSyncedState.register("settings:audio", {
  apply: function (state) { lateApplied.push(state); },
});
assert(lateApplied.length === 1, "a seed that arrived before register() must be replayed on register");
assert(lateApplied[0].shown === true, "the replayed seed carries the persisted state");
// get() reflects the last-seen state.
assert(lateHandle.get().shown === true, "handle.get() reflects the merged last-seen state");

// ── 6. dispose() makes the handle INERT — no zombie write path ───────────────────────────────────
// A disposed handle closes over `entry`; set()/get() must no-op so it cannot mutate entry.last or
// dispatch capture events after leaving the registry.
const zh = global.window.OrwellSyncedState.register("gadget:zombie", { apply: function () {} });
zh.set({ collapsed: true });
assert(zh.get().collapsed === true, "sanity: the handle persists before dispose");
const capBeforeDispose = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length;
zh.dispose();
zh.dispose();  // idempotent — a second dispose must not throw
const retZombie = zh.set({ collapsed: false });   // no-op after dispose
assert(retZombie === zh, "set() still returns the handle after dispose (chainable no-op)");
const capAfterDispose = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length;
assert(capAfterDispose === capBeforeDispose, "a disposed handle must NOT dispatch orwell:window-layout");
assert(Object.keys(zh.get()).length === 0, "a disposed handle's get() is inert ({})");

// re-register the same key works and is a live, independent handle again.
const zh2 = global.window.OrwellSyncedState.register("gadget:zombie", { apply: function () {} });
const capBeforeReuse = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length;
zh2.set({ collapsed: true });
const capAfterReuse = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length;
assert(capAfterReuse === capBeforeReuse + 1, "a re-registered key dispatches again (live handle)");
// The stale disposed handle must not hijack the fresh registry slot.
zh.set({ collapsed: false });
assert(dispatched.filter(function (e) { return e.type === "orwell:window-layout"; }).length === capAfterReuse,
  "the stale disposed handle stays inert even after the key is re-registered");

// ── 7. the substrate mints NO orwell:gamechanged (g15 single-dispatcher invariant) ──────────────
assert(dispatched.filter(function (e) { return e.type === "orwell:gamechanged"; }).length === 0,
  "the substrate must never dispatch orwell:gamechanged");

console.log("OK");
"""


def _run_node(harness, *modpaths):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral synced-state check")
    proc = subprocess.run(
        [node, "-e", harness, *modpaths],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_synced_state_substrate_end_to_end():
    out = _run_node(
        _HARNESS,
        os.path.join(STATIC, "orwellLayoutSync.js"),
        os.path.join(STATIC, "orwellSyncedState.js"),
    )
    assert "OK" in out


# ── STRUCTURAL — pin the shape so a revert fails ─────────────────────────────────

SRC = _read("static", "js", "orwellSyncedState.js")
INDEX = _read("static", "index.html")


def test_exposes_register_returning_a_handle():
    assert "OrwellSyncedState" in SRC
    assert "function register(" in SRC
    # the handle surface the kits consume
    for member in ("set:", "get:", "dispose:"):
        assert member in SRC, f"the handle must expose {member}"


def test_dispose_makes_the_handle_inert():
    # A per-handle `disposed` flag guards set()/get() — not just a registry delete (which would leave
    # a zombie write path through the closed-over entry).
    assert "disposed" in SRC
    assert "if (disposed) return" in SRC, "set() must early-return when disposed"


def test_capture_uses_the_layout_sync_seam_not_a_new_transport():
    # It must ride the SAME event orwellLayoutSync captures — no new fetch/ws code in the substrate.
    assert "orwell:window-layout" in SRC
    assert "fetch(" not in SRC, "the substrate must not own transport (persistence stays in orwellLayoutSync)"
    # No transport CALL in the substrate (the word may appear in prose describing the seam it rides).
    assert "sendLayout(" not in SRC, "the substrate must not own the WS transport"
    assert "EventSource" not in SRC, "the substrate must not own the SSE transport"


def test_inbound_routes_through_the_seed_seam():
    assert "orwell:layout-seed" in SRC
    assert "addEventListener" in SRC


def test_substrate_never_mints_gamechanged():
    # g15: the single dispatcher stays in platform.js; this module only rides the layout seam.
    assert "new CustomEvent('orwell:gamechanged'" not in SRC
    assert 'new CustomEvent("orwell:gamechanged"' not in SRC


def test_substrate_is_loaded_after_layout_sync():
    # The seed listener must exist before the layout GET seed fires — load order in index.html.
    i_layout = INDEX.find("orwellLayoutSync.js")
    i_state = INDEX.find("orwellSyncedState.js")
    assert i_layout != -1 and i_state != -1, "both scripts must be included"
    assert i_layout < i_state, "orwellSyncedState.js must load AFTER orwellLayoutSync.js"

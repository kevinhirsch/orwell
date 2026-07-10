"""WebSocket Phase-1 — the CLIENT layout wiring (deferred case (d), orwellLayoutSync.js).

The layout store + route landed per-device keyed `(user, deviceId)` (#1283). This is the CLIENT
half: `orwellLayoutSync.js` must now

  1. establish a STABLE per-device token (localStorage — survives reload; distinct from the per-tab
     origin) and thread it through the layout GET (query) + PATCH (body), so the per-device store
     keeps desktop/phone independent (ADR 0017 §5) instead of collapsing to the legacy per-user
     bucket;
  2. when the WS transport is live, route the PATCH through `OrwellWs.sendLayout` (already on the
     wire) and apply an incoming `layout` down-frame to THIS device's other tabs (deviceId match +
     origin self-echo suppression), falling back to the HTTP path when WS is off/inactive.

Two halves, mirroring the repo convention (test_ws_multiplex_isolation.py):
  • BEHAVIORAL — run the REAL orwellLayoutSync.js in Node against stubbed globals; assert the GET
    carries the canonical deviceId, the HTTP PATCH body carries it, the WS-active flush routes
    through sendLayout (and does NOT also HTTP-PATCH), and an incoming `layout` frame is device-
    scoped before it re-dispatches `orwell:layout-changed`.
  • STRUCTURAL — pin the wiring so a revert that drops the deviceId thread / the WS leg fails.

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


# ── BEHAVIORAL — the real orwellLayoutSync.js, in Node ───────────────────────────

# Stub window/document/localStorage/fetch/setTimeout/OrwellWs, eval the REAL IIFE, then drive its
# capture + apply seams and assert the deviceId thread + the WS routing. setTimeout runs
# synchronously so the debounced flush fires deterministically.
_HARNESS = r"""
const fs = require("node:fs");
const src = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

// A per-device token PRE-SEEDED so we can assert the exact canonical value the client sends.
const CANON = "dev_canonical";
const store = { "orwell-device-id": CANON };
const localStorage = {
  getItem(k) { return (k in store) ? store[k] : null; },
  setItem(k, v) { store[k] = v; },
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
// Run the debounce timer synchronously.
global.setTimeout = function (fn) { try { fn(); } catch (_) {} return 0; };
global.clearTimeout = function () {};

function fire(type, detail) { global.window.dispatchEvent(new global.CustomEvent(type, { detail: detail })); }

(0, eval)(src);

// ── 1. LOAD GET carries the canonical deviceId (query) ──────────────────────────
assert(fetchCalls.length >= 1, "load() must GET the layout");
const get = fetchCalls[0];
assert(get.url.indexOf("deviceId=" + CANON) !== -1, "GET must carry the canonical deviceId; got " + get.url);
assert(!(get.opts && get.opts.method), "the load call is a GET (no method)");

// ── 2. HTTP PATCH body carries deviceId + per-tab origin (WS inactive) ──────────
fire("orwell:window-layout", { id: "cast", state: { x: 5, y: 6 } });
const patch = fetchCalls.filter(function (c) { return c.opts && c.opts.method === "PATCH"; });
assert(patch.length === 1, "an HTTP PATCH must fire when WS is inactive; got " + patch.length);
const body = JSON.parse(patch[0].opts.body);
assert(body.windowId === "cast", "PATCH names the window");
assert(body.deviceId === CANON, "PATCH body must carry the canonical deviceId; got " + body.deviceId);
assert(typeof body.origin === "string" && body.origin.indexOf("low-") === 0, "PATCH carries the per-tab origin");

// ── 3. WS-active flush routes through sendLayout, NOT a second HTTP PATCH ────────
wsActive = true;
fire("orwell:window-layout", { id: "finale", state: { open: true } });
assert(sendLayoutCalls.length === 1, "a WS-active flush must ride OrwellWs.sendLayout; got " + sendLayoutCalls.length);
const sl = sendLayoutCalls[0];
assert(sl.windowId === "finale", "sendLayout names the window");
assert(sl.deviceId === CANON, "sendLayout carries the per-device deviceId (the bucket)");
assert(typeof sl.origin === "string" && sl.origin === body.origin, "sendLayout carries the SAME per-tab origin (self-echo)");
const patchesAfter = fetchCalls.filter(function (c) { return c.opts && c.opts.method === "PATCH"; }).length;
assert(patchesAfter === 1, "the WS leg must NOT also HTTP-PATCH; got " + patchesAfter);

// ── 4. an incoming `layout` frame is device-scoped before it applies ────────────
assert(wsFrameHandlers.layout && wsFrameHandlers.layout.length === 1, "the client must register a `layout` onFrame handler");
const onLayout = wsFrameHandlers.layout[0];
function countChanged() { return dispatched.filter(function (e) { return e.type === "orwell:layout-changed"; }).length; }

const before = countChanged();
// A DIFFERENT device's echo is dropped (geometry is per-device — case d).
onLayout({ t: "layout", ch: "layout", d: { windowId: "cast", state: { x: 9 }, deviceId: "dev_OTHER", origin: "tab_x" } });
assert(countChanged() === before, "a different device's layout frame must be dropped");
// THIS device's echo re-dispatches the SAME local event the SSE path produces.
onLayout({ t: "layout", ch: "layout", d: { windowId: "cast", state: { x: 9 }, deviceId: CANON, origin: "tab_x" } });
assert(countChanged() === before + 1, "the same-device layout frame must re-dispatch orwell:layout-changed");
// A frame carrying OUR OWN per-tab origin is still re-dispatched (the downstream listener drops it
// by origin — the WS leg only scopes by device, exactly like the SSE path).
const beforeSelf = countChanged();
onLayout({ t: "layout", ch: "layout", d: { windowId: "cast", state: { x: 1 }, deviceId: CANON, origin: body.origin } });
assert(countChanged() === beforeSelf + 1, "device-scoped re-dispatch is origin-agnostic (origin drop is downstream)");

console.log("OK");
"""


def _run_node(harness, modpath):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral layout-client check")
    proc = subprocess.run(
        [node, "-e", harness, modpath],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_layout_client_threads_deviceid_and_routes_ws_then_http():
    out = _run_node(_HARNESS, os.path.join(STATIC, "orwellLayoutSync.js"))
    assert "OK" in out


# ── STRUCTURAL — pin the wiring so a revert fails ────────────────────────────────

SRC = _read("static", "js", "orwellLayoutSync.js")


def test_stable_per_device_token_in_localstorage():
    # A stable per-device token, keyed in localStorage, distinct from the per-tab ORIGIN.
    assert "orwell-device-id" in SRC
    assert "localStorage" in SRC and "function deviceId(" in SRC


def test_get_and_patch_thread_the_device_id():
    # GET appends the deviceId query; PATCH body carries it.
    assert "deviceId=" in SRC                       # GET query
    assert "deviceId: dev" in SRC or "deviceId:" in SRC   # PATCH body / sendLayout arg


def test_ws_leg_routes_patch_through_sendlayout_with_http_fallback():
    assert "wsActive()" in SRC
    assert "OrwellWs.sendLayout" in SRC
    # the HTTP PATCH stays as the fallback path
    assert "method: 'PATCH'" in SRC


def test_ws_leg_applies_incoming_layout_frames_device_scoped():
    assert "onFrame('layout'" in SRC or 'onFrame("layout"' in SRC
    assert "d.deviceId" in SRC and "deviceId()" in SRC          # per-device scope check
    assert "orwell:layout-changed" in SRC                       # re-dispatch onto the shared seam


def test_ws_registration_is_load_order_robust():
    # register now if OrwellWs is present, else on ws-ready (mirrors platform.js).
    assert "orwell:ws-ready" in SRC


def test_layout_client_never_mints_gamechanged():
    # g15: the single dispatcher stays in platform.js; this module only LISTENS.
    assert "new CustomEvent('orwell:gamechanged'" not in SRC
    assert 'new CustomEvent("orwell:gamechanged"' not in SRC

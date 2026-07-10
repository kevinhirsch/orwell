"""#659 / DWE #660 — the Settings-tab component ADOPTS the synced-state substrate.

The #659 tab COMPONENT (one activation path, ARIA roving tabindex) is built and pinned in
``test_890_659_settings_kit.py``. This file pins the follow-on the #660 kit epic wants: the
SELECTED tab now PERSISTS across sessions AND mirrors in realtime to this device's other windows,
by riding the kit-agnostic synced-state substrate (orwellSyncedState.js, DWE #643) + the bounded
generic ``value`` field the layout store whitelists (#658/#659, orwell_layout.py). No transport is
re-implemented — settings.js is a pure listener/writer on the SAME per-device layout seam the
window kit uses.

Three layers:
  • BEHAVIORAL (Node) — run the REAL orwellLayoutSync.js + orwellSyncedState.js together and drive
    the EXACT ``tab:settings`` / ``{value: <tabId>}`` shape settings.js uses: prove it persists as
    one PATCH carrying the value, mirrors to a peer's ``apply``, and drops our own-origin echo.
  • SERVER round-trip — the tab value survives ``_clean_state`` → ``get_layout`` (persist → restore),
    and per-field LWW lets a later tab overwrite the earlier one.
  • STRUCTURAL — source-pin the settings.js wiring so a revert that drops the adoption fails.

Name-agnostic; roles only; key-free; the store path is redirected to a tmp file.
"""

import importlib
import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")

layout = importlib.import_module("src.orwell_layout")

DEV = "dev-tab"


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — the real substrate + layout-sync, driving the settings-tab shape ────────────────

# Mirrors test_643_synced_state's harness: stub window/document/localStorage/fetch/setTimeout, eval
# BOTH real IIFEs (layout-sync first, then the substrate), then register the SAME key + value-coerce
# settings.js registers and prove the tab value round-trips end to end on the real seam.
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
};
global.window.localStorage = localStorage;
global.document = { readyState: "complete", addEventListener() {} };
global.window.document = global.document;
global.setTimeout = function (fn) { try { fn(); } catch (_) {} return 0; };
global.clearTimeout = function () {};

function fire(type, detail) { global.window.dispatchEvent(new global.CustomEvent(type, { detail: detail })); }

(0, eval)(layoutSrc);
(0, eval)(stateSrc);

// The EXACT registration settings.js makes: key "tab:settings", a value-only string coerce.
const applied = [];
const handle = global.window.OrwellSyncedState.register("tab:settings", {
  coerce: function (p) { return (p && typeof p.value === "string" && p.value) ? { value: p.value } : {}; },
  apply: function (state, meta) { applied.push({ state: state, meta: meta }); },
});

// ── persist: set({value:<tabId>}) lands as ONE PATCH carrying the tab value ───────────────────────
handle.set({ value: "account" });
const captures = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; });
assert(captures.length === 1, "set() must dispatch exactly one capture; got " + captures.length);
assert(captures[0].detail.id === "tab:settings", "capture id is the tab key");
assert(captures[0].detail.state.value === "account", "capture carries the tab value");
const patch = fetchCalls.filter(function (c) { return c.opts && c.opts.method === "PATCH"; });
assert(patch.length === 1, "the tab set() must land as ONE HTTP PATCH; got " + patch.length);
const body = JSON.parse(patch[0].opts.body);
assert(body.windowId === "tab:settings", "PATCH names the tab key");
assert(body.state.value === "account", "PATCH carries the tab value (the #658/#659 generic scalar)");
assert(body.deviceId === CANON, "PATCH inherits the per-device deviceId (persistence not re-implemented)");
assert(typeof body.origin === "string" && body.origin.length > 0, "PATCH inherits the per-tab origin");

// ── the coerce strips everything but a non-empty string value off the wire ────────────────────────
handle.set({ value: 42, junk: "x" });   // non-string value + junk field → coerced to {}
const capsAfter = dispatched.filter(function (e) { return e.type === "orwell:window-layout"; });
const lastCap = capsAfter[capsAfter.length - 1];
assert(!("value" in lastCap.detail.state), "a non-string value must be coerced away (no value on the wire)");
assert(!("junk" in lastCap.detail.state), "junk fields must be coerced away (only a tab id ever crosses)");

// ── mirror: a peer window's tab switch reaches apply (realtime two-window mirror) ─────────────────
const beforeMirror = applied.length;
fire("orwell:layout-changed", { windowId: "tab:settings", state: { value: "appearance" }, origin: "tab_peer" });
assert(applied.length === beforeMirror + 1, "a peer's tab switch must reach apply (realtime mirror)");
assert(applied[applied.length - 1].state.value === "appearance", "apply receives the peer's tab value");
assert(applied[applied.length - 1].meta.key === "tab:settings", "apply meta carries the tab key");

// ── own-echo: our OWN origin echo is dropped upstream, never reaches apply ────────────────────────
const beforeSelf = applied.length;
fire("orwell:layout-changed", { windowId: "tab:settings", state: { value: "account" }, origin: body.origin });
assert(applied.length === beforeSelf, "our own-origin echo must be suppressed and never reach apply");

// ── load-order race: a seed that lands BEFORE register() is replayed on register ──────────────────
fire("orwell:layout-seed", { windowId: "tab:settings2", state: { value: "system" } });
const late = [];
const lateHandle = global.window.OrwellSyncedState.register("tab:settings2", { apply: function (s) { late.push(s); } });
assert(late.length === 1, "a seed that arrived before register() must replay on register (open-before-seed)");
assert(late[0].value === "system", "the replayed seed carries the persisted tab value");
assert(lateHandle.get().value === "system", "handle.get() reflects the last-seen tab value");

// ── g15: the substrate mints NO orwell:gamechanged (the tab is not game state) ────────────────────
assert(dispatched.filter(function (e) { return e.type === "orwell:gamechanged"; }).length === 0,
  "the synced-tab seam must never dispatch orwell:gamechanged");

console.log("OK");
"""


def _run_node(harness, *modpaths):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral synced-tab check")
    proc = subprocess.run(
        [node, "-e", harness, *modpaths],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stdout}\n{proc.stderr}"
    return proc.stdout


def test_settings_tab_round_trips_and_mirrors_on_the_real_seam():
    out = _run_node(
        _HARNESS,
        os.path.join(STATIC, "orwellLayoutSync.js"),
        os.path.join(STATIC, "orwellSyncedState.js"),
    )
    assert "OK" in out


# ── SERVER round-trip — the tab value survives persist → restore, and LWW overwrites ──────────────

@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(layout, "LAYOUT_PATH", tmp_path / "orwell_layout.json")


def _patch(user, wid, state, device=DEV, origin=""):
    return layout.patch_layout(user, device, {"windowId": wid, "state": state}, origin=origin)


def test_settings_tab_value_persists_and_restores():
    """persist → restore: a selected tab id written under `tab:settings` comes back verbatim."""
    saved = _patch("u", "tab:settings", {"value": "system"})
    assert saved["state"] == {"value": "system"}
    restored = layout.get_layout("u", DEV)["windows"]["tab:settings"]["value"]
    assert restored == "system"


def test_settings_tab_value_last_write_wins():
    """Switching tabs overwrites the persisted selection (per-field LWW) — the store never
    accumulates stale tab ids."""
    _patch("u", "tab:settings", {"value": "account"})
    _patch("u", "tab:settings", {"value": "appearance"})
    assert layout.get_layout("u", DEV)["windows"]["tab:settings"]["value"] == "appearance"


# ── STRUCTURAL — pin the settings.js adoption so a revert fails ───────────────────────────────────

SRC = _read("static", "js", "settings.js")
INDEX = _read("static", "index.html")


def test_registers_the_tab_key_through_the_substrate():
    assert "const _SETTINGS_TAB_KEY = 'tab:settings';" in SRC
    assert "window.OrwellSyncedState.register(_SETTINGS_TAB_KEY, {" in SRC
    # a value-only string coerce (only a tab id ever crosses the wire)
    assert "typeof p.value === 'string'" in SRC


def test_swap_to_panel_persists_the_active_tab():
    """_swapToPanel — the ONE controller every activation path shares — is where the selected
    tab gets persisted, so no activation path can skip the sync."""
    fn_start = SRC.index("function _swapToPanel(tab)")
    fn_end = SRC.index("\n}\n", fn_start)
    body = SRC[fn_start:fn_end]
    assert "_persistActiveTab(tab);" in body


def test_open_prefers_the_synced_tab_value():
    """open() resumes the last-selected tab (synced value) ahead of the DOM-active default, while
    keeping the existing G13 landability guard (_tabVisible) so a persisted tab that a non-admin /
    game build can't see still falls back to Appearance/Account."""
    body = SRC[SRC.index("export function open(tab)"):SRC.index("export function close()")]
    # the synced value is consulted BEFORE the DOM-active default in the precedence chain
    assert "|| _syncedTabValue()" in body
    assert body.index("_syncedTabValue()") < body.index("[data-settings-tab].active")
    # the landability fallback is unchanged (the G13 gate still runs)
    assert "if (!_tabVisible(activeTab)) activeTab = _tabVisible('appearance') ? 'appearance' : 'account';" in body


def test_remote_apply_guards_landability_and_reentrancy():
    """A peer/seed tab change only lands a VISIBLE, viewer-permitted tab, and does not re-persist
    (the _applyingRemoteTab guard) so a mirror never echoes back out."""
    assert "let _applyingRemoteTab = false;" in SRC
    fn_start = SRC.index("function _applyRemoteTab(state)")
    fn_end = SRC.index("\n}\n", fn_start)
    body = SRC[fn_start:fn_end]
    assert "_tabLandable(tab)" in body
    assert "_applyingRemoteTab = true;" in body
    # persist is a no-op while applying a remote change
    pfn = SRC[SRC.index("function _persistActiveTab(tab)"):]
    pfn = pfn[:pfn.index("\n}\n")]
    assert "if (_applyingRemoteTab" in pfn


def test_g15_no_ad_hoc_gamechanged_from_the_tab_seam():
    # The tab is a UI projection, not game state — settings.js must never mint the freshness event.
    assert "new CustomEvent('orwell:gamechanged'" not in SRC
    assert 'new CustomEvent("orwell:gamechanged"' not in SRC


def test_substrate_loads_before_settings_can_use_it():
    # settings.js registers lazily (first open()), by which point the deferred substrate has run —
    # but pin that the substrate is actually included so registration can ever succeed.
    assert "orwellSyncedState.js" in INDEX

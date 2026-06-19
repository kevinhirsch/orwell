"""Fix: the producers'-vault (retrospective) and the post-season "New season"
window collided and pushed each other off-screen.

Two root causes, two pins:
  1. Both windows registered the SAME slot ("bottom-right"), so post-season — when
     both are open — they stacked in one corner. They must use DIFFERENT slots.
  2. The slot engine's stacking cursor wrote the base position WITHOUT a viewport
     clamp, so the second (stacked) window was shoved above the top of the viewport.
     Every stacked placement must now run through clampPos.

The clamp math is exercised for real by driving orwellSlots.restackSlot under node
(a real JSDOM-free harness that stubs the few DOM/window bits the function touches),
asserting a slot holding several tall windows keeps every panel inside the viewport.
"""
import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── Root cause 1: distinct slots ────────────────────────────────────────────
def test_retro_and_new_season_use_different_slots():
    retro = _read("static", "js", "orwellRetrospective.js")
    new_season = _read("static", "js", "orwellNewSeason.js")
    # The new-season window keeps bottom-right; the retrospective moved off it.
    assert 'slot: "bottom-right"' in new_season
    assert 'slotKey: "new-season"' in new_season
    assert 'slotKey: "retro"' in retro
    # The retrospective must NOT share the bottom-right corner with new-season.
    assert 'slot: "bottom-right"' not in retro
    assert 'slot: "top-right"' in retro  # the chosen non-colliding slot
    # And no OTHER slotted window may share the retrospective's new slot.
    for other in ("orwellCast.js", "orwellFinale.js", "orwellNewSeason.js"):
        assert 'slot: "top-right"' not in _read("static", "js", other), other


def test_retrospective_keeps_dockable_behaviour():
    # 0054 Phase 2: moving slots must not disturb the dock opt-in.
    retro = _read("static", "js", "orwellRetrospective.js")
    assert "dockable: true" in retro
    assert "defaultDocked: false" in retro


# ── Root cause 2: the stacking offset runs through clampPos ──────────────────
def test_slots_source_clamps_every_placement():
    slots = _read("static", "js", "orwellSlots.js")
    assert "function clampPos(" in slots          # the shared viewport clamp exists
    # restackSlot computes a single left/top through clampPos for EVERY entry.
    assert "clampPos(baseLeft + dx, baseTop + dy" in slots


_HARNESS = r"""
'use strict';
// Minimal DOM/window stubs for the bits orwellSlots.restackSlot touches. We model
// a small viewport and several TALL windows registered in one slot, then assert the
// computed left/top keeps every window inside the viewport (never off the top/sides).
const VW = 800, VH = 600, WINH = 400, WINW = 360;

function makeEl(h) {
  const style = {};
  return {
    isConnected: true,
    style,
    classList: { contains: () => false, add: () => {} },
    offsetParent: {},
    offsetHeight: h,
    offsetWidth: WINW,
    getBoundingClientRect() {
      const left = parseFloat(style.left) || 0, top = parseFloat(style.top) || 0;
      return { left, top, right: left + WINW, bottom: top + h, width: WINW, height: h };
    },
  };
}

global.window = {
  innerWidth: VW, innerHeight: VH,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
};
const _store = {};
global.localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};
global.document = {
  body: { dataset: {}, classList: { contains: () => false } },
  documentElement: {},
  querySelector: () => null,
  addEventListener() {},
};
global.getComputedStyle = () => ({ getPropertyValue: () => "", position: "fixed", display: "block" });
global.MutationObserver = class { observe() {} };
global.ResizeObserver = class { observe() {} };

const src = require("fs").readFileSync(SLOTS_PATH, "utf8");
// Execute the IIFE so window.OrwellSlots gets installed.
(0, eval)(src);

const Slots = global.window.OrwellSlots;
// Three tall windows stacked in one bottom slot — the exact "push each other off
// screen" scenario. Without the clamp the second/third stack above the viewport top.
const els = [makeEl(WINH), makeEl(WINH), makeEl(WINH)];
Slots.register(els[0], "bottom-right", { key: "a" });
Slots.register(els[1], "bottom-right", { key: "b" });
Slots.register(els[2], "bottom-right", { key: "c" });
Slots.restackAll();

const out = els.map((e) => ({
  left: parseFloat(e.style.left),
  top: parseFloat(e.style.top),
  bottom: parseFloat(e.style.top) + WINH,
  right: parseFloat(e.style.left) + WINW,
}));
console.log(JSON.stringify(out));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_stacked_positions_stay_in_viewport():
    slots_path = os.path.join(FRONTEND, "static", "js", "orwellSlots.js")
    harness = "const SLOTS_PATH = " + json.dumps(slots_path) + ";\n" + _HARNESS
    proc = subprocess.run(
        ["node", "-e", harness],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    rects = json.loads(proc.stdout.strip().splitlines()[-1])
    assert len(rects) == 3
    VW, VH = 800, 600
    for r in rects:
        # Never off the top (the original bug) or any other edge: at least a sliver
        # (the clamp keeps >=4px of margin and never lets top go negative).
        assert r["top"] >= 0, r
        assert r["left"] >= 0, r
        assert r["left"] <= VW, r        # not pushed off the right
        assert r["top"] <= VH, r          # not pushed below the viewport

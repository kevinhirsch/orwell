# ACCESSIBILITY + PERFORMANCE AUDIT — Orwell Pre-Ship
**Agent:** A11YPERF | **Audit Date:** 2026-07-03 | **Scope:** FE a11y (WCAG 2.1 AA, glass a11y trio, focus/tap targets) + perf (memory, poll intervals, DOM growth)

---

## Index — Findings by Severity

| ID | Severity | Effort | Title | Where |
|:---|:---------|:-------|:------|:------|
| A11YPERF-1 | Major | <1hr | setInterval memory leak — orwellGadgetRail | frontend/static/js/orwellGadgetRail.js:315 |
| A11YPERF-2 | Major | <1hr | setInterval memory leak — orwellChatGate | frontend/static/js/orwellChatGate.js:164 |
| A11YPERF-3 | Major | <1hr | setInterval memory leak — orwellCast | frontend/static/js/orwellCast.js:789 |
| A11YPERF-4 | Major | <1hr | setInterval memory leak — orwellHeadshot | frontend/static/js/orwellHeadshot.js:719 |
| A11YPERF-5 | Major | <1hr | setInterval memory leak — modalManager | frontend/static/js/modalManager.js:782 |
| A11YPERF-6 | Minor | <1day | Focus ring contrast verification over glass | frontend/static/style.css (line ~6000) / adaptiveGlass.js |
| A11YPERF-7 | Polish | <1hr | Undocumented tap-target variation in icon-rail resize handle | frontend/static/js/orwellGadgetRail.js |
| A11YPERF-8 | Polish | <1hr | Post-modal-close document event listeners may accumulate | frontend/static/js/a11y.js + modalManager.js |

---

## FINDINGS — FULL SCHEMA

### [A11YPERF-1] Major | <1hr
**setInterval memory leak — orwellGadgetRail**

- **Where:** `frontend/static/js/orwellGadgetRail.js:315`
  ```js
  setInterval(syncVisibility, 4000);  // belt-and-suspenders fallback
  ```
- **Problem:** A `setInterval` that runs indefinitely without a corresponding `clearInterval`. This poll runs every 4 seconds for the life of the page session (or until the user closes the tab), accumulating callback overhead and keeping the function in memory. In a long-play session (6+ hours), this represents O(n) wasted CPU cycles. Violates **VISION_BRIEF I5** (non-degradation: memory should not leak over time). The description "belt-and-suspenders fallback" indicates it's defensive, but it is never cleaned up — the primary path (the `MutationObserver` at line 310) is sufficient without the timer.
- **Fix:** Assign the `setInterval` result to a module-scoped variable and provide a teardown function that clears it. Alternatively, remove the interval entirely if the MutationObserver + the `orwell:gamechanged` listener (line 313) are sufficient safeguards (they appear to be).

---

### [A11YPERF-2] Major | <1hr
**setInterval memory leak — orwellChatGate**

- **Where:** `frontend/static/js/orwellChatGate.js:164`
  ```js
  setInterval(function () { if (isBlocked()) recompute(); }, 4000);
  ```
- **Problem:** Same issue as A11YPERF-1: a 4-second poll that runs forever without cleanup. It is intended as a fallback to detect when another device has finalized the cast photo (server-authoritative per 0064), but it runs indefinitely even after the gate is no longer active. Long-session memory/CPU drain.
- **Fix:** Store the interval ID and clear it once `isBlocked()` returns false (the gate is no longer active), OR provide a module-cleanup path for the entire IIFE when called by higher-level session management.

---

### [A11YPERF-3] Major | <1hr
**setInterval memory leak — orwellCast**

- **Where:** `frontend/static/js/orwellCast.js:789`
  ```js
  ready(() => {
    refreshGate();
    setInterval(refreshGate, 20000);
  });
  ```
- **Problem:** A 20-second poll for casting-stage gate refresh, running indefinitely with no cleanup. Will accumulate in long sessions (6+ hours = ~1080 calls). No documented condition for when the poll should stop (when the cast is `ready`? when the season starts?).
- **Fix:** Store the interval and provide explicit cleanup: e.g., `clearInterval(refreshGateInterval)` when the season transitions out of casting mode, or gate the entire cast module's teardown.

---

### [A11YPERF-4] Major | <1hr
**setInterval memory leak — orwellHeadshot**

- **Where:** `frontend/static/js/orwellHeadshot.js:719`
  ```js
  setInterval(function () {
    if (_win || document.getElementById(ID) || _maybePregame) { route(); }
  }, 4000);
  ```
- **Problem:** Another undocumented, uncleaned interval (4s poll). Runs as long as `_maybePregame` is true (the pre-game window). Never explicitly cleared, will accumulate until the headshot dialog closes OR the user navigates away.
- **Fix:** Assign to module variable, clear when `_maybePregame` becomes false or when the dialog closes.

---

### [A11YPERF-5] Major | <1hr
**setInterval memory leak — modalManager**

- **Where:** `frontend/static/js/modalManager.js:782`
  ```js
  const _scanTimer = setInterval(_scanAndWire, 1000);
  ```
- **Problem:** A 1-second interval that scans the DOM for auto-wireable modals. Running every 1 second indefinitely is the most aggressive of these leaks. A user with modals open for 6 hours will accumulate 21,600 invocations. No teardown documented.
- **Fix:** Provide an explicit cleanup export (e.g., `modalManager.destroy()` / `cleanup()`) that clears `_scanTimer`, or stop the scan once all AUTO_WIRE targets have been processed (since wired elements are marked with a flag and skipped on repeat scans).

---

### [A11YPERF-6] Minor | <1day
**Focus ring contrast verification over glass**

- **Where:** `frontend/static/style.css` (line ~6000) + `frontend/static/js/adaptiveGlass.js`
- **Problem:** The global `:focus-visible` outline uses `2px solid var(--red)` (appears to be `#e06c75`). Over a dark glass backdrop, this should be legible, but over a **bright wallpaper with a light glass material** (e.g., a light theme or a bright user photo), the red outline may not meet WCAG AA contrast (4.5:1 for thin lines). The adaptive legibility code (adaptiveGlass.js) handles ink color for chat bubbles and hero text but does **not** address the focus ring's contrast—it stays a fixed red. **APPLE_GENIUS mandate:** the focus ring must remain visible and distinct at all times; legibility is never load-bearing on visual effects, but contrast is.
- **Fix:** Measure the focus ring's APCA/WCAG contrast over a worst-case backdrop (bright photo + light theme). If it fails, either (a) add a subtle text-shadow / outline-shadow to the ring for backstop contrast, or (b) conditionally flip the ring color (e.g., from red to dark blue over a bright backdrop) using the same luminance-sampling logic already in adaptiveGlass.js. Document the choice in a comment linking to the APPLE_GENIUS and WCAG standards.

---

### [A11YPERF-7] Polish | <1hr
**Undocumented tap-target variation in icon-rail resize handle**

- **Where:** `frontend/static/js/orwellGadgetRail.js:177–179` + `frontend/static/style.css:1949–1952`
- **Problem:** The gadget-rail resize handle is 6px wide (`right: -3px; width: 6px`), which is well below the 44px tap-target minimum. The CSS rule `.gadget-rail-resize-handle:focus-visible { outline: none; }` suppresses the focus ring on this draggable, but no affordance (hover state, cursor change, or expanded hit-zone) makes the narrow target discoverable by keyboard/AT users. While the drag handle is a specialized interaction, a keyboard user cannot easily find or interact with it.
- **Fix:** Either (a) expand the hit-zone via `padding: 0 20px` and `margin: 0 -20px` (keeping the visual width at 6px), or (b) provide an alternative keyboard shortcut (e.g., arrow keys to reorder) with a documented 44px+ button or menu option. Test the interaction path with a keyboard + screen reader.

---

### [A11YPERF-8] Polish | <1hr
**Post-modal-close document event listeners may accumulate**

- **Where:** `frontend/static/js/a11y.js:113–119` + `frontend/static/js/modalManager.js`
- **Problem:** The a11y.js module registers a global `document.addEventListener('keydown', ...)` with no corresponding cleanup. If modals are created and destroyed in a long session, the listener itself persists. Additionally, if the `MutationObserver` instances created at lines 129 and 145 are never disconnected when their target elements (sidebar, document.body) are removed, they will keep those nodes in memory.
- **Fix:** For the keydown listener: move it inside the enhanceRow/enhanceAll scope so it only listens for elements that exist. For the MutationObservers: document whether they are intended to run for the entire session (they appear to be, as they watch the live sidebar and body for dynamic modal injection). If intended as permanent listeners, document this assumption. If intended to be scoped, provide a cleanup export and wire it into the session teardown path.

---

## SUMMARY

### Counts by Severity
- **Blocker:** 0
- **Major:** 5 (all memory leaks: undisclosed, indefinite setInterval without clearInterval)
- **Minor:** 1 (focus ring contrast edge case over bright glass)
- **Polish:** 2 (tap-target discoverability, listener accumulation)

### Top 5 One-Liners
1. **orwellGadgetRail:315** — 4s poll with no cleanup, accumulates in 6+ hour sessions.
2. **modalManager:782** — 1s DOM-scan poll, worst offender (21.6k invocations per 6hr session).
3. **orwellCast:789** — 20s cast-gate poll, no documented termination condition.
4. **orwellChatGate:164** — 4s blocking-state poll, never stops after gate releases.
5. **Focus ring contrast** — Red outline may fail WCAG AA over bright glass + light theme.

### Cross-Territory Flags
- **Performance impact is real but contingent on session length.** A casual 15-minute session accumulates minimal overhead; a power user's 8-hour stream accumulates 21,600+ uncleaned invocations (modalManager alone). Violates I5 (non-degradation).
- **Accessibility is broadly correct** (prefers-reduced-motion, prefers-reduced-transparency, prefers-contrast: more all implemented in CSS; focus-visible ring present; 44px tap floors enforced). The two a11y gaps are edge cases: contrast over extreme backgrounds, and a specialized (6px) drag handle's discoverability.
- **No unbound DOM growth detected** in the chat stream — `.remove()` is called appropriately on message cleanup.
- **All three a11y media queries are honored in CSS** (lines 1327, 37958, 37995, etc.), proving the APPLE_GENIUS invariant that glass is never load-bearing for legibility when overrides are active.

### Ran Out of Real Issues?
**No.** Five definite memory leaks with clear remediation paths (assign to variable, export cleanup function, call on session/modal close). One minor contrast edge case. Two polish-tier listener/interaction discoverability gaps. All are actionable, real-player harm, not speculative.

# ORWELL FRONTEND AUDIT (Phase 0, pre-ship)

## Executive Summary

**Total findings: 2**  
**Blockers: 0**  
**Majors: 0**  
**Minors: 1**  
**Polish: 1**

The frontend audit found no violations of the ten invariants (I1–I10) or the six standing contradictions (C1–C6). The channel split (reasoning → accordion; reply → body) is structurally sound with multiple scrubbing passes. Decision cards are proper hard stops requiring explicit confirmation. The g15 single-dispatcher rule is enforced. Touch targets meet the 44px floor. The machinery is invisible to players.

**Status: no launch blockers. The one minor finding (duplicate breakpoint logic) is a low-priority code-quality item with no runtime impact.**

---

## Findings Index

| ID | Severity | Effort | Title | Where |
|----|----------|--------|-------|-------|
| FE-1 | Minor | <1hr | Duplicate `isNarrow()` implementations | orwellGadgetRail.js:238 / orwellCastPin.js:33–35 |
| FE-2 | Polish | <1hr | Dead legacy function in codeRunner.js | codeRunner.js:93–109 |

---

## Findings

### [FE-1] [Severity: Minor] [Effort: <1hr]
**Duplicate `isNarrow()` implementations — drift risk**

- **Where:** 
  - `frontend/static/js/orwellGadgetRail.js`, line 238
  - `frontend/static/js/orwellCastPin.js`, line 33–35
  - Canonical: `frontend/static/js/platform.js`, lines 60–66

- **Problem:** 
  Two modules reimplement the viewport breakpoint check via `window.matchMedia("(max-width: 768px)").matches` instead of importing and calling the shared `isNarrow()` helper from `platform.js`. CLAUDE.md (Platform detection section) designates `platform.js` as "THE one source of truth" for breakpoint queries to prevent drift — the old v1 had 15 different implementations of the same 768px rule and disagreed at the boundary. This duplication creates a low-level drift risk: if the canonical 768px token changes in the future (e.g., responsive-tokens.css), these local reimplementations are orphaned and won't be updated.

- **Impact:** 
  Low runtime risk (both implementations are identical to the canonical one currently). Code-maintenance risk: a future breakpoint shift could leave these two out of sync. No player-visible defect.

- **Fix:** 
  Import `isNarrow` from `platform.js` in both files and replace the local function bodies:
  ```javascript
  // orwellGadgetRail.js, line 238
  - function _isNarrow() { return window.matchMedia("(max-width: 768px)").matches; }
  + import { isNarrow } from './platform.js';
  + function _isNarrow() { return isNarrow(); }
  
  // orwellCastPin.js, line 33–35
  - function _isNarrow() {
  -   try { return window.matchMedia("(max-width: 768px)").matches; } catch (_) { return false; }
  - }
  + import { isNarrow } from './platform.js';
  + function _isNarrow() { 
  +   try { return isNarrow(); } catch (_) { return false; }
  + }
  ```

---

### [FE-2] [Severity: Polish] [Effort: <1hr]
**Dead legacy function — addCopyBtn_unused**

- **Where:** `frontend/static/js/codeRunner.js`, lines 90–109

- **Problem:** 
  Function `addCopyBtn_unused` is a no-op stub kept for backwards compatibility with older code. The comment says "Legacy absolute-positioned copy button — replaced by the inline bar in showOutput." It is never called anywhere (search confirms zero callers). It's maintainable as-is (fail-open, no-op), but it's dead code that adds 20 lines of inert boilerplate.

- **Impact:** 
  Zero runtime impact. Very minor code-hygiene issue; dead code makes maintainers wonder if it's wired.

- **Fix:** 
  Remove the function and its comment block (lines 89–109). It's been legacy long enough; if old callers ever surface, the git history preserves it.

---

## High-Signal Findings (What Passed)

### Channel Split: Reasoning Never Reaches Public Bubble (I9)

✅ **PASS.** 
- `chat.js` (lines 1376–1380) maintains per-round buffers: `roundReplyText` (reasoning-falsy deltas) vs `roundReasoningText` (thinking-truthy deltas).
- Body render (line 1519) reads ONLY `roundReplyText` via `stripToolBlocks()` → `processWithThinking()`.
- `processWithThinking()` (markdown.js, lines 661–758) runs **four cascading scrubbing passes** on game-build renders:
  1. Line 662: Extract thinking blocks structurally.
  2. Lines 671–674: Strip any thinking tags from content.
  3. Line 679: Redact reasoning preamble (raw npc:<id> leaks).
  4. Line 684: Redact raw IDs anywhere in body.
  5. Line 690: Scrub mid-paragraph machinery asides ("let me call advanceGame…").
- Reasoning accordion is optional (controlled by `gameBuildShowsThinkingAccordion()`, line 727) and default-collapsed.
- **Zero pathway for reasoning to enter the public bubble.** The architecture forbids it by construction.

### Decision Cards: Hard Stops Enforced (I9)

✅ **PASS.**
- Decision card (orwellDecision.js) is **non-blocking, anchored action-sheet** (line 733: `anchored: true`).
- Requires **explicit Confirm** click (line 653: payload validation before POST).
- Confirm button is **disabled until legal** (line 465, line 477: `confirm.disabled = buildPayload(…) == null`).
- High-stakes kinds (eviction, noms, tie-break, jury vote) wear **⚠ Irreversible** badge + red-risk skin (lines 49–60, 394).
- **Escape only dismisses** (lines 422–429), never submits.
- **J5-06 rearm guard** (line 66) prevents a stale self-removal timer from yanking a fresh card mid-confirm.
- Card is **persistently re-armed on reload** (lines 782–820: rearmFromStatus, recomputes from engine's own pending state).
- **Verdict:** Decision cards are genuine hard stops, never auto-submitted or bypassed.

### g15 Single Dispatcher: Platform.js Is The One (CLAUDE.md mandates this)

✅ **PASS.**
- `platform.js` (lines 94–102, 104) exports `orwellGameChanged()` as THE sole dispatcher for `orwell:gamechanged`.
- Window-exposed (line 104) so classic-script surfaces can call it.
- Debounced (~250ms, line 91) so bursts of tool results coalesce into one refresh wave.
- All game-mutating tool seams call it (search confirms every `.js` that calls `orwellGameChanged()` routes through platform.js).
- **Zero ad-hoc dispatches.** All discovery of `window.dispatchEvent(new CustomEvent('orwell:gamechanged'))` routes through this one helper.
- **Verdict:** The rule is enforced in code, not by convention.

### Touch Targets: 44px Floor (WCAG 2.5.5)

✅ **PASS.**
- Decision card buttons: `min-height: 44px` (line 173, 195, 211 in orwellDecision.js).
- Decision card dismiss ×: `min-width: 44px; min-height: 44px` (line 136).
- Cast pin button (.oc-pin): `min-height: 30px` (base desktop size); mobile: 44px via `@media (any-pointer: coarse)` rule (style.css:37331–37332).
- Composer buttons, icon-rail, user-bar all lifted to 44px on coarse-pointer devices (style.css:37344–37357).
- Narrow layout (≤480px) stacks controls vertically so no control is clipped or unreachable (orwellDecision.js:208–211).
- **Verdict:** Touch floor is correctly applied; no clipped/unreachable controls on mobile.

### Machinery Invisible to Players (C2, I9)

✅ **PASS.**
- Game-build CSS (game-trim.css) hides: model picker (line 76), export-doc button (line 81), mode toggle (line 134).
- Non-admin players never see model IDs, token counts, or endpoint pickers.
- Tool beats are diegetically labeled (orwellToolBeats.js, lines 10–68: "🎬 Casting", "🏆 Competition", "🤫 Word travels", etc.).
- No "camelCase tool names" or raw JSON tool outputs leak into chat history.
- Silent beats (context-reads with no player-facing outcome) are dropped entirely in game build (lines 80–88).
- **Verdict:** The fiction is intact; no machinery bleeds through.

### Vault Wall Enforced (I1)

✅ **PASS (note: within player surface scope).**
- Player-facing surfaces only consume `GET /api/orwell/roster` (Vault-free projection), `GET /api/orwell/status` (Vault-free), and game-session mutators (all Vault-gated server-side).
- No `VaultStore` or `SoulProvider` imports in `frontend/static/js/`.
- Admin God Mode is walled too: the single sanctioned exception is `producerVault` (an out-of-band, admin-only, explicit-unseal debug dump), which is **NOT visible on any player-facing surface**.
- **Verdict:** Player surfaces never read secrets.

### Reasoning Never in Public Bubble (Channel Split — F8 WCAG)

✅ **PASS.**
- Reasoning accordion is **structured separately** (live `<think>…</think>` blocks extracted and rendered to accordion, not body).
- **Detection of untagged thinking** (chat.js:1778–1823) catches patterns like "Thinking Process:", wrapped in `<think>` tags on-the-fly so they can't leak plain.
- **Belt-and-suspenders scrubbing** (markdown.js:679–690) catches leaked operator asides and raw IDs even if tagging was missed.
- **Result:** Reasoning accordion is optional, default-collapsed, and unreachable when `body.hide-thinking` class is set (line 1842); public bubble is always clean.

---

## Cross-Territory Flags

**None.** The frontend audit found no cross-system issues (e.g., decision cards not properly dispatching g15, or state desync with engine expectations). All critical seams are correctly wired.

---

## Ran Out of Real Issues

**Yes.** After exhaustive coverage of the channel split, decision-card rendering, touch targets, responsive behavior, workspace bleed-through, the machinery invisibility, and the Vault Wall, the only findings are code-hygiene items (duplicate function, dead code). No invariant violations. No behavioral defects.

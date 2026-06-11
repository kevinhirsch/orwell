# 2026-06-11 — DWE window audit (Phase 1): every window-like surface vs. desktop-window-environment norms

**Scope.** Every window-like surface and interactive element of the front-end, audited against
the behavioral norms of a desktop window environment (DWE) by driving the **real UI with
Playwright** — real pointer drags, real keyboard, real reloads; `page.evaluate` asserts state,
never escapes it. The bar is ruling #16: *"a mobile web app that functions as if it's an
installed app — integration and perfection with every placement."* This is the Phase-1
deliverable of the windowing mission: the audit doc only — **no production code changes ride
with it**. Phase 2 (the unified window kit + migration waves) builds from this matrix; the
matrix is the spec.

**Method.** Harness reuses `frontend/scripts/browser_smoke.py`'s boot scaffolding (uvicorn,
`AUTH_ENABLED=false`, `LOCALHOST_BYPASS=true`) and `responsive_matrix.py`'s viewport matrix
(320/390/820/1024/1366/1440, coarse-pointer flags). States driven: **virgin** (fresh FE data),
**engine-down** (the F5 dark house), **casting** (real engine, `started:false`, the real J4
card), **mid-game** (real engine: `POST /api/orwell/new-game` → live status HUD, DR gate,
banner), **finale/post-season** (panel states staged by Playwright **route mocks** on
`/api/orwell/{finale,recap,whereabouts,state}` — the chrome under audit is
state-independent; a full played season re-verifies nothing about window behavior), and
**build=0** (the full inherited workspace; theme/settings modals exercised as the
representative `windowDrag` family). Both builds run; admin-variant surfaces (the J4 card's
"Open Settings" remedy) verified with the real admin flag. Run log: 75 assertion rows, 16
FAIL, screenshots per failure (`./2026-06-11-dwe-window-audit-assets/`). The harness is
scratch (not shipped); every failing cell below carries the Playwright assertion that pins it,
to be wired into `browser_smoke.py` / `responsive_matrix.py` wave by wave in Phase 2.

**Pinned baselines (not findings).** PR #233 landed the no-trap contract the night before this
audit: every holding card carries `[data-ob-dismiss]` + Escape, dismissal leaves **zero
`[inert]` residue**, and the smoke dismisses like a person (the old force-remove hack is gone,
pinned by `frontend/tests/test_j4_no_trap.py`). This audit treats those as the norm-(g)
baseline and **extends** them: 3× mount+Escape cycles leave zero inert residue and a focusable
page (PASS); the **real** J4 card (engine up, no model) carries dismiss + the operable
"Open Settings" remedy (PASS). The harness-workaround sweep starts clean on
`browser_smoke.py`; the **one** workaround this audit's own harness needed is itself finding
F1 (the dock chip must be `evaluate()`-clicked because the dock is invisible — recorded, never
hidden).

---

## 1. Inventory (the denominator)

Window-like surfaces, by family. "Not a window" rows carry the ruling that argues them out of
window norms — they still get identity/escape/a11y/viewport rows.

| # | Surface | Kind | Positioning | Minimize | Persistence | Built by |
|---|---|---|---|---|---|---|
| W1 | `#orwell-social` (The House) | floating window | OrwellSlots `top-right` + windowDrag | modalManager → dock | slot offset `orwell-slot-offset:social:<user>` | own chrome (`orwellSocial.js:119-190`) |
| W2 | `#orwell-finale` (The Finale) | floating window | OrwellSlots `top-left` + windowDrag | modalManager → dock | **two systems**: slot key `finale` (never written) + own `orwell-finale-pos` (raw, unclamped) | own chrome (`orwellFinale.js:77-137`) |
| W3 | `#orwell-presence` | strip (dismissible) | OrwellSlots `bottom-center`, no drag | — (dismiss until room changes) | slot key `presence` (never written — not draggable) | own (`orwellPresence.js:41-68`) |
| W4 | `#orwell-retro` | panel (dismissible) | OrwellSlots `bottom-right`, no drag | — (dismiss per session) | sessionStorage `orwell-retro-dismissed` | own (`orwellRetrospective.js:40-57`) |
| W5 | `#orwell-engine-status` | banner (role=alert) | fixed top, z 11000 | — (dismiss per message) | none (by design) | own (`orwellEngineStatus.js:22-54`) |
| W6 | `#orwell-onboarding` | true modal (holding card) | fixed inset 0, z 99999 | — | one-shot per mount (by design) | own (`orwellOnboarding.js:35-164`) |
| W7 | `#orwell-status` (status HUD) | **not a window** — sidebar chrome (ruling #3/E64) | static flow in `#sidebar` | collapse-in-place | `orwell-status-collapsed:<game>:<user>` | own (`orwellStatusPanel.js:70-162`) |
| W8 | Diary Room (`#orwell-dr-pill` + sidebar btn) | **not a window** — composer mode (ruling #4/E88) | in-composer | — | — | own (`orwellDiaryRoom.js`) |
| W9 | `#orwell-decision-card` | **in-chat card** (ADR 0003: the commitment guardrail lives in the conversation) | in `#chat-history` flow | — | re-arms from `/status` (D3/U4) | own (`orwellDecision.js:122-288`) |
| W10 | `#minimized-dock` ("Windows" rows) | sidebar dock (ruling #10/E95) | static in `#sidebar` | n/a (it IS the minimize target) | `orwell.mobileDockState.v1` (+ legacy chip positions) | modalManager (`_ensureDock`/`_renderDock`) |
| W11 | `#settings-modal` | modal window | `.modal` + windowDrag + windowResize | modalManager (injected `_`) | `winsize-settings-modal` (clamped) | inherited + U2 layout kit |
| W12 | `#theme-modal` | modal window | `.modal` + windowDrag | modalManager | `winsize-…`, remembered dock side | inherited (`theme.js`) |
| W13 | styledConfirm / styledPrompt | true micro-modals | `.modal` overlay | — | — | `ui.js:560-750` (own focus trap + Escape) |
| W14 | Transient menus (export, overflow, kebabs, slash autocomplete, emoji) | popovers | body-appended | — | — | escMenuStack clients (`bindMenuDismiss`) |
| W15 | build=0 tool modals (cookbook, calendar, gallery, tasks, doclib, memory, notes, email, research, compare, prompt, shortcuts, doc pane) | modal windows | `.modal` + windowDrag + modalSnap edge docks + tileManager snap zones | modalManager dock + `_AUTO_WIRE` | `winsize-*`, `orwell-edge-dock-width:*`, remembered dock | inherited family |
| W16 | `#plan-window` | floating pane | windowDrag (standard `.modal-header`) | — | none (transient) | `planWindow.js` |

Interactive-element families swept per surface: buttons/chips (tap targets, names), drag
handles, inputs, the composer, sidebar rows, dock chips.

**n/a argued, not assumed:** W7 (ruling #3 — "this is not a window. No drag, no saved
position, no minimize dock, no z-index"), W8 (ruling #4 — "the Diary Room is not a window"),
W9 (ADR 0003 — a card in the conversation, deliberately not chrome). They keep their
identity/escape/a11y rows in the matrix and are exempt from drag/resize/minimize/stacking.

---

## 2. The surface × norm matrix

Legend: ✅ pass (live-asserted) · ❌ fail (→ finding) · ◐ pass-with-note · — n/a (argued
above) · ⬜ inherited-family cell verified on the representative (theme/settings) and
mechanism-equivalent for the rest (same code path; census §4 proves the equivalence).

| Surface | a identity | b focus/stacking | c drag | d resize | e min/restore | f persistence | g layering/escape | h keyboard/a11y | i viewport | j lifecycle |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 social | ❌ F6 | ❌ F9 (no focus concept; z re-stamped ❌ F9b) | ❌ **F2** (drag dead) | — (fixed size, by design) | ❌ **F1** (dock invisible) + ❌ F4 (no fly-out) | ◐ vacuous (always slot base — F2) | ❌ F7 (Escape blind) | ◐ F6/F10 (min reachable; no kbd move; no role/label) | ✅ sheets clear composer; ❌ F3 (sheet overlap) | ✅ (5× cycles clean) |
| W2 finale | ❌ F6 | ❌ F9 | ❌ **F2**/F5 (drag inert; `mobileSkip:0` fights sheet CSS) | — | ❌ **F1** + F4 | ❌ F5 (dead dual persistence; unclamped restore code) | ❌ F7 | ◐ (has role+label) | ❌ F3 | ✅ |
| W3 presence | ✅ (strip + named dismiss) | — | — (not draggable, argued) | — | — | ✅ (dismiss-until-room-changes) | ◐ (dismiss only; fine for a strip) | ✅ ≥24px at coarse | ✅ D2 clean | ✅ (`beforeunload` clears timer) |
| W4 retro | ✅ | — | — | — | — | ✅ session-scoped | ◐ | ✅ | ✅ D2 clean | ✅ |
| W5 banner | ✅ role=alert | — (top layer, by design) | — | — | — | ✅ reshow-on-new-message | ✅ dismiss works | ◐ (22px × on desktop) | ✅ | ✅ |
| W6 onboarding | ✅ | ✅ focus lands in card; trap holds (smoke-pinned) | — | — | — | ✅ one-shot | ✅ **#233 baseline + extended** (3× cycles, real J4, zero inert) | ✅ | ✅ | ✅ |
| W7 status HUD | ✅ (collapse affordance, aria-expanded) | — (argued) | — | — | ✅ collapse persists per user+game | ✅ | — | ✅ Enter/Space toggle; polite announcer | ✅ sidebar chrome | ✅ |
| W8 DR mode | ✅ pill + named exit | — | — | — | — | — | ✅ Escape exits (composer-scoped) | ✅ focus → composer | ✅ | ✅ (`_orwellDRWired` guard) |
| W9 decision card | ✅ role=group, titled | — | — | — | — | ✅ re-arms from `/status` (U4 gate) | ◐ F11 (no Escape; × only) | ✅ chips focusable, aria-pressed | ✅ in-flow | ✅ |
| W10 dock | ❌ **F1** (invisible while holding chips) | — | ⬜ chip drag (mostly dead code post-E95) | — | n/a | ✅ clamped state restore | — | ❌ F1 (no pointer path at all) | ❌ F1 | ◐ (1s scanner interval, permanent) |
| W11 settings | ✅ full cluster (`_` 24×24 + named ×) | ◐ ui.js promote wins; ❌ F8 (no focus return) | ✅ moves; ◐ clamp incidental (cursor physics) | ✅ 4 handles, `winsize-` clamped | ⬜ (modalManager) | ✅ | ✅ Escape + zero inert | ✅ | ✅ (U2; matrix 37/0/0) | ✅ |
| W12 theme | ✅ | ◐ | ✅/◐ (same) | ⬜ | ⬜ | ⬜ | ✅ Escape | ✅ | ✅ | ✅ |
| W13 styled dialogs | ✅ | ✅ own trap | — | — | — | — | ✅ own Escape (duplication noted, census) | ✅ | ✅ | ✅ |
| W14 menus | ✅ | ✅ LIFO | — | — | — | — | ✅ escMenuStack (menu-over-modal order correct) | ⬜ | ✅ | ✅ (pop-before-call design) |
| W15 tool modals (=0) | ⬜ (injected cluster) | ⬜ two z counters (F9b) | ◐ (clamp incidental) | ⬜ | ❌ **F1** applies (same dock) | ⬜ clamped keys | ⬜ Escape via ui.js arbiter | ⬜ | ⬜ | ◐ (chain-physics chip code dead post-E95, census §4) |
| W16 plan window | ✅ std header | ⬜ | ✅ | — | — | — (transient) | ⬜ | ⬜ | ✅ | ✅ |

Chrome-wide norm (i) anchor: the shipped `responsive_matrix.py` runs **37 pass · 0 xfail ·
0 FAIL** on this tree (chrome-only run, same as CI).

---

## 3. Findings

Severity · surface · norm — symptom → root cause (file:line) → fix spec → the pinning assertion.

### F1 · CRIT · `#minimized-dock` (hits W1, W2, and every W15 modal) · norm e/g
**Minimizing a window loses it: the sidebar "Windows" dock is permanently invisible.**
Minimize hides the panel and renders a chip row into a dock whose computed display is `none` —
there is **no pointer path to restore**. The House panel has no sidebar/rail button, so a
player who clicks `–` loses the approaches surface for the session (modalManager keeps
`isMinimized`, so the poll loop respects the parked state until a full reload). This is the
same trap class PR #233 just fixed for holding cards, on the surface ruling #10 designed as
the cure.
**Root cause:** the U3 chrome PR (2f81c27) moved the dock into the sidebar and gave it base
CSS `#minimized-dock { display: none; … }` (`frontend/static/style.css:842`), while
`_renderDock` still "reveals" it the old way — clearing the inline style
(`dock.style.display = ''`, `frontend/static/js/modalManager.js:330`), which now falls back to
the CSS `none`. The empty branch sets `'none'` explicitly (modalManager.js:318), so the dock
is `none` in **both** branches.
**Why the gates missed it:** `browser_smoke.py`'s T20 check asserts the chip **exists** and
restores it via `page.evaluate(...click())` — evaluate-clicks work on invisible elements. (This
audit's harness had to do the same to proceed — the workaround is this finding.)
**Fix spec:** the kit's dock shows iff it holds ≥1 row (`display` driven by a class, not
inline-vs-CSS ping-pong); every minimizable window must be restorable by **real pointer** and
keyboard; T20 upgrades from evaluate-clicks to trusted clicks.
**Pin:** after `–` on any window: `expect(dock).to_be_visible()` (Playwright visibility, not
DOM existence) and `page.click('.minimized-dock-chip[...]')` (a **trusted** click) restores.
Screenshot: `assets/F1-invisible-windows-dock.png`.

### F2 · MAJOR (CRIT for the affordance) · W1+W2 · norm c/f
**Drag is completely dead on every slot-registered floating panel.** The header advertises
drag (`cursor: move`, `title="Drag to move"`), but the panel never follows the cursor — not
mid-drag, not at drop (live: x stayed 1132 through a 150px drag) — and the "persisted offset"
is structurally always `(0,0)`, so ruling #8's position persistence is **vacuous** for game
panels (they always sit at slot base).
**Root cause:** two shared systems cancel each other. `windowDrag.js` moves the panel by
writing `style.left/top` per mousemove (`windowDrag.js:273-274`); `orwellSlots.js` registers a
`MutationObserver` on `style` that calls `restackAll()` on **every** such write
(`orwellSlots.js:103-111`), instantly re-pinning the panel to slot base + saved offset. At
mouseup, `saveDragOffset` measures the post-restack rect — delta `(0,0)`
(`orwellSlots.js:117-125`).
**Fix spec:** the kit owns drag *and* placement in one system: slot restack pauses while a
registered panel is being dragged (`modal-dragging` class gate), or the kit drives position
through the slot engine itself (drag mutates the offset, slot renders it). Offsets stay
clamped at restore (the existing S11 clamp is correct — keep it).
**Pin:** mid-drag rect differs from start by >60px; post-drop offset key holds the real delta;
position survives an unrelated restack and a reload. Screenshots:
`assets/F2-drag-dead-slot-panels.png`, `assets/F5-finale-drag-inert.png`.

### F3 · MAJOR · W1+W2 (mobile ≤768) · norm i
**Both mobile sheets pin to `top:44px` and overlap each other.** With a finale staging while
an approach is live, social (44→116) and finale (44→243) stack on the same anchor — one sheet
hides the other's header and intercepts its controls (live at 390×844; the D2 collision class,
between two *game* surfaces this time).
**Root cause:** per-panel sheet CSS hard-pins both: `orwellSocial.js:174-181` and
`orwellFinale.js:119-126` (`top: 44px !important` each, no awareness of the other). The slot
engine "stands down" on narrow (`orwellSlots.js:131-138`), so nothing arbitrates sheets.
**Fix spec:** the kit's narrow tier owns sheet stacking the way slots own desktop placement —
one sheet host that stacks by measured height (or one-sheet-at-a-time with a switcher), D2
collision rule structural on narrow too.
**Pin:** with both panels visible at 390×844, their rects must not intersect (the
`responsive_matrix.py` `_intersects` helper, extended to staged game surfaces). Screenshot:
`assets/F3-mobile-sheets-overlap.png`.

### F4 · MAJOR (ruling #19) · W1+W2 (+ every minimize path) · norm e
**No minimize/close motion exists** — `display` flips synchronously (`orwellSocial.js:210-214`);
the E97 contract ships open-only (`orwell-anim-in`, `orwellSlots.js:89-94`, honors reduced
motion ✅). Ruling #19 specifies a Win7-style **fly-out toward the dock** on minimize and a
fly-away on close.
**Fix spec:** the kit's animation contract: open = fade+scale-in (exists), minimize =
scale-down + translate along the path to the dock row, close = scale+fade-away; pronounced
easing; `prefers-reduced-motion` strips all of it (the existing REDUCED gate generalizes).
**Pin:** computed animation/transform present during minimize (and absent under reduced
motion). Screenshot: `assets/F4-no-minimize-flyout.png`.

### F5 · MAJOR · W2 finale · norm c/f
**Finale runs two position systems at once; both lose.** It registers slot key `finale` (never
written — its `onDragEnd` writes its own `orwell-finale-pos` instead,
`orwellFinale.js:156-158`), restores that key **unclamped** (`restorePosition`,
`orwellFinale.js:51-58` — raw left/top, the only unclamped geometry restore in the tree), and
sets `mobileSkip: 0` so touch-drag stays armed on phones where the sheet CSS `!important`-pins
the panel (drag fights CSS and writes junk positions). In practice the slot restack overrides
all of it (F2), so the custom persistence is dead code that still ships its unclamped-restore
bug for whenever F2 is fixed naïvely.
**Fix spec:** delete `POS_KEY`/`restorePosition`/the custom `onDragEnd`; finale becomes a
plain kit window on the slot system like social (one persistence path, clamped, per-user).
**Pin:** plant `orwell-finale-pos = {left:2400, top:1300}` at 1366×768 → panel must render
fully on-screen **via the one sanctioned mechanism** (and after migration the key must not
exist at all).

### F6 · MINOR · W1+W2 · norm a/h
**Identity inconsistency across window families.** Game panels carry minimize-only (`–`,
16×32px on desktop, no close); settings/theme carry the injected full cluster (`_` 24×24 +
named ×); retro/presence/banner carry ×-only; social has no `role`/`aria-label` while finale
has both (`orwellSocial.js:119` vs `orwellFinale.js:75-76`). Five panels hand-build five
chrome variants (census §4).
**Fix spec:** one `.ow-titlebar` + `.ow-controls` cluster from the kit: same order, same
icons, same accessible names, ≥24px targets, on every window; per-window capability flags
(closable, minimizable) decide which buttons render, not which markup got hand-written.
**Pin:** for every `[data-ow-window]`: titlebar exists, controls match the canonical order,
each control ≥24×24, accessible name non-empty. Screenshot: `assets/F6-identity-min-only.png`.

### F7 · MINOR · W1+W2 · norm g
**Floating panels don't participate in Escape at all.** The ui.js arbiter closes hovered
windows, then escMenuStack menus, then `.modal`s (`ui.js:1215-1288`); slot panels are none of
those, so Escape with a panel focused/open does nothing (live).
**Fix spec:** kit windows register on the same dismissal stack as everything else (one stack:
menus → top window → modals), with per-window policy (a strip may opt for dismiss; a window
minimizes or closes per its capabilities).
**Pin:** panel open + Escape ⇒ the panel (top of stack) parks/dismisses; a menu opened above
it dismisses first. Screenshot: `assets/F7-escape-blind-to-panels.png`.

### F8 · MINOR · W11 (generalizes) · norm b
**Closing a modal never returns focus to its opener** (settings → `document.activeElement` =
`BODY`, live). Keyboard users lose their place on every close; the #233 card got this right
(focus lands in the card; page focusable after dismissal) — the rest of the chrome doesn't.
**Fix spec:** the kit records the opener on open and restores focus on close/Escape (the
styledConfirm pattern, `ui.js:560-650`, generalized).
**Pin:** open settings from the gear → close → `document.activeElement` is the gear.
Screenshot: `assets/F8-no-focus-return.png`.

### F9 · MINOR · W1/W2/W11/W15 · norm b
**(a)** No focus concept for panels: nothing raises on click (slot panels never re-stack
visually; live click-to-front check only "passed" via an id-resolution artifact — re-tested:
no raise logic exists), no focused-window affordance.
**(b)** Two competing z escalators: ui.js `_zCounter` (1000+, promotes any visible `.modal`,
`ui.js:1187-1204`) and modalManager `_modalTopZ` (300+, `!important`, stamps panels at
register/restore — live: panels surface at z 301/302 and **jump to 303 on restore**; their
authored CSS `z-index: 9000` is dead). The Escape arbiter picks "top modal" by computed z
across both ladders.
**Fix spec:** one z-authority in the kit (a single counter + scrim/dock bands:
banner > modal > window > strip), click-to-front for non-modal windows, a visible focused
state, Escape keyed to the same order.
**Pin:** open A, open B, click A ⇒ A's z > B's; restore from dock ⇒ restored window tops the
window band; `pickTopModal` order equals visual order.

### F10 · MINOR · all draggable windows · norm h
**No keyboard path moves or resizes any window** (drag-only — and on game panels even drag is
dead, F2). **Fix spec:** kit: focused titlebar + arrow keys moves (Shift = resize), Home
re-docks to slot. **Pin:** focus titlebar, ArrowRight ×5 ⇒ rect moves; offset persists.

### F11 · LOW · W9 decision card · norm g
The card dismisses only via its ×; Escape is ignored (deliberately conservative for a binding
surface, but inconsistent with #233's "Escape is the keyboard way out" for non-binding
dismissal — dismissing the card is explicitly allowed and non-binding).
**Fix spec:** Escape (while the card holds focus) = the × path: dismiss the card, never submit.
**Pin:** focus an option chip, Escape ⇒ card gone, no POST fired.

### Notes (pass-with-note, no finding)
- **Drag clamp (norm c) on the inherited family:** unclamped in code (`windowDrag.js` clamps
  only on window **resize**, :48-78) but unreachable by mouse — the OS cursor can't leave the
  viewport, so neither can the title bar (verified live in the snap-free direction). The kit
  should clamp explicitly anyway (programmatic moves, multi-monitor coordinate restores).
- **Reduced motion:** the slot open-animation honors it (live ✅). modalManager's FLIP dock
  animations don't check it — folded into F1/F4's fix (the kit's one animation contract).
- **Long-lived timers:** 9 `setInterval`s at idle, including modalManager's permanent 1s
  auto-wire scanner (`modalManager.js:1432`) — singletons, not leaks; the kit should own
  registration instead of polling for it.
- **Tap targets at coarse:** PASS live (mobile sheet CSS grows the controls); the 16px-wide
  `–` is a desktop-pointer size (F6 fixes it anyway via the cluster).

---

## 4. Duplication census (norm k — the refactor's evidence)

Mechanism × panel, with file:line of each copy. (Sweep: every `orwell*.js`, modalManager,
modalSnap, escMenuStack, windowDrag, windowResize, tileManager, settings, theme, ui, planWindow.)

| Concern | Copies | Where (file:line) |
|---|---|---|
| Drag engines | **3** | `windowDrag.js:95-372` (shared, mouse+touch+snap) · `modalManager.js:596-1109` (chip/chain/free/dock drag — largely **dead since E95** rows replaced draggable chips; `_wireChipDrag` has no remaining caller in `_renderDock`) · `modalSnap.js:934-970` (dock-width resize drag) |
| Geometry persistence keys | **7 schemes** | `orwell-slot-offset:<key>:<user>` (orwellSlots.js:28, clamped) · `orwell-finale-pos` (orwellFinale.js:22, **unclamped**, F5) · `winsize-<id>` (windowResize.js:127-130, clamped) · `orwell-edge-dock-width:<side>:<id>` (modalSnap.js:24-25, clamped) · `orwell-email-doc-split-width` (modalSnap.js:24) · `orwell-modal-remembered-dock-<id>` (modalManager.js:35-51) · `orwell.mobileDockState.v1` (modalManager.js:179, clamped) |
| Minimize/restore | **3** | modalManager dock (`minimize/restore`, :1195-1259) · status-HUD collapse-in-place (orwellStatusPanel.js:147-161, per ruling #3 — stays) · engine-banner/presence/retro dismiss-with-reshow-rules (3 bespoke variants) |
| Window chrome builders | **6** | orwellSocial.js:183-186 · orwellFinale.js:128-131 · orwellRetrospective.js:65-74 · orwellPresence.js:57-60 · orwellEngineStatus.js:46-47 · onboarding card (orwellOnboarding.js:41-75); vs the shared `.modal-header` family (tool modals, planWindow.js:22-30) + `injectMinimizeButton` (modalManager.js:1324-1367) |
| Escape handling | **5+** | ui.js global arbiter (:1215-1288) · escMenuStack (:22-102) · styledConfirm/styledPrompt own traps (ui.js:628-640, 718-732) · orwellDiaryRoom box-scoped (:141-143) · onboarding card-scoped (orwellOnboarding.js:151) · assorted per-menu handlers (app.js:258, 485, 1772, 1996, 3380) |
| Z escalation | **2 counters + statics** | ui.js `_zCounter` 1000+ (:1187) · modalManager `_modalTopZ` 300+ `!important` (:65-68) · statics: panels 9000 (dead), banner 11000, tour 10001, chips 10030, hints 9998, onboarding 99999, presence 40, retro 45 |
| Poll/backoff loops | **6 near-identical** | status (:285-326) · social (:71-74, 397-406) · finale (:37-43, 251-259) · presence (:25-27, 89-103) · retro (:22-24, 119-133) · engine banner (:92-96) — each its own `_failures`/`_pollDelay`/hidden-tab gate |
| Narrow-viewport switch | **4 styles** | orwellSlots matchMedia 768 (:17, 131-138) · per-panel `@media (max-width:768px)` sheet CSS with `!important` (social :174, finale :119) · windowDrag/windowResize `innerWidth <= mobileSkip` checks (:321, :42) · platform.js `isNarrow()` consumers |

**Keep-list (the kit composes these, not replaces):** `escMenuStack` (sound LIFO contract,
pop-before-call) · `windowDrag`'s gesture/snap engine (add explicit clamp; fold under the kit)
· `windowResize` + `winsize-` persistence (already clamped) · OrwellSlots' slot/offset/clamp
*model* (S11 — the right idea; fix the observer/drag fight) · modalManager's
registry/badge/dock *concept* (fix F1; retire the dead chip-drag/chain code) · the #233
no-trap contract (becomes the kit's modal contract) · ui.js `pickTopModal`+promote (absorbed
into the kit's one z-authority) · the U2/A3 settings layout kit (window **bodies**) ·
`responsive_matrix.py` + `browser_smoke.py` as the gates the kit's assertions ratchet into.

---

## 5. Phase-2 shape (for the record; PRs follow per wave)

One `OrwellWindow` base (JS) + one `.ow-*` CSS family owning: registration
(modalManager+escMenuStack), drag+clamp (slot-aware), resize, focus/z (one authority),
minimize-to-dock (F1 fixed), the E97/ruling-#19 animation contract incl. reduced-motion,
geometry persistence + sanitize (one key scheme, per user+game), a11y
(role/name/keyboard-move/focus-return), teardown. Waves per the mission: kit → status HUD
(stays sidebar chrome — composes title/controls only) → social/approach → Diary Room (button
+ pill stay; kit consumes nothing) → finale → retrospective → settings → theme → remaining
modals/popovers; each wave deletes its bespoke code in the same PR and flips this matrix's ❌
cells to hard assertions in the gates. Ratchet: a source-grep + runtime assert that any
element matching the window selector is kit-managed (no new bespoke drag/persist/minimize).

**ADR 0003 / Vault checks rode along:** every audited surface renders projection data only;
the live mid-game HUD carried no relationship numbers (live-asserted); no window builds or
progresses the game outside the chat (decision card posts to the same validated seam, W9
argued in-chat by design). No CRIT Vault finding.

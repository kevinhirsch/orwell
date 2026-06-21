# Window / Overlay System — Refactor Scope (2026-06-21)

**Status:** SCOPE (precedes a plan; no code yet). **Mode:** read-only architectural pass over the
player-tier front-end window/overlay stack. **Descends from:** the UX Refactor Audit
(`UX-AUDIT-LOG.md`) and the 2026-06-11 DWE window audit (`docs/audits/2026-06-11-dwe-window-audit.md`).

## Why this exists (mandate tie-in)

This work was **scheduled by the UX audit itself**. The J1 remediation deferred a launch-blocker to
a "next gated set" because it could not be fixed without a new window-kit capability
(`UX-AUDIT-LOG.md:191`):

> **J1-25** (cast-photo dialog focus-trap/`aria-modal`/inert) — LAUNCH-BLOCKING a11y, but forcing the
> whole `.ow-*` window kit modal would break the floating-window/lingering model; **needs a per-window
> `modal` option. → next gated set.**

That "next gated set" is this refactor. It also closes the HIGH **cast-photo surface cluster** the
ledger says to "fix together" (`UX-AUDIT-LOG.md:73`) and the cast-IA fragmentation in J2.

## 1. Architecture map

There are **two parallel window worlds** plus a HUD host, glued by shared sub-systems. Post Lane-F the
game surfaces were consolidated onto the kit; the inherited (build=0) workspace was not.

```
                     ESCAPE ARBITER (ui.js:1246, capture-phase, one-per-press)
  escape-scope guard → _closeHoveredWindow → dismissTopMenu → [no modal?] kitWindow.dismissTop → modals

  ── KIT WORLD (.ow-window) ────────┐   ── MODAL WORLD (.modal) ───────┐   ── HUD HOST ──
  OrwellWindow (orwellWindow.js)    │   settings/theme/tool modals      │   gadgetRail (orwellGadgetRail.js)
   • z band 500–980, own _stack     │    • z 1000+ via ui.js _zCounter  │    • content-driven show
   • drag → windowDrag              │    • drag → windowDrag (hand-wired)│    • own drag-reorder + width-resize
   • resize → windowResize          │    • resize → windowResize         │    • own edit-mode drag (PR #438)
   • placement → OrwellSlots        │    • snap/dock → modalSnap/tileMgr  │    • hosts DOCKED kit windows
   • parked persist                 │    • z/focus → ui.js observer       │      (ow-docked; opts out of geometry)
   • docked → mounts into rail ──────────────────────────────────────────►
```

**Load-bearing seams (cite before editing):**

- **Z-index / stacking** — split by family. Kit: own counter `_zTop` 500–980, raised in
  `orwellWindow.js` `raise()`. Modals: single counter in `ui.js` `_zCounter` 1000+, exposed as
  `window._owPromoteModal`; `modalManager._bringToFront` defers to it. Static bands above: banner
  11000, onboarding 99999, chips 10030 (`docs/audits/2026-06-11-dwe-window-audit.md:291`).
- **Focus** — kit: `ow-focused` + click-to-front on `pointerdown` capture; opener stored/restored on
  close (`orwellWindow.js`). Modals: a **separate** focus-return observer in `ui.js` (`_restoreFocus`,
  `_owOpener`). **Two focus-return implementations run in parallel.**
- **Escape / close order** — single arbiter `ui.js:1246`: escape-scope → hovered window →
  `dismissTopMenu` → kit `dismissTop` **only if no modal visible** → modal. A modal always outranks a
  kit window for Escape, enforced by the z-band gap (convention, not structure).
- **Drag** — one engine `windowDrag.js` `makeWindowDraggable` (mouse+touch), used by both worlds;
  slot-fight resolved by a `modal-dragging` gate in `orwellSlots.js`.
- **Resize** — one engine `windowResize.js` `makeWindowResizable`, persists `winsize-<id>`.
- **Snap** — `modalSnap.js` (edge docks) + `tileManager.js` (zone preview/commit). Modal-world only;
  kit windows pass `enableDock:false`.
- **Placement** — `OrwellSlots` (`orwellSlots.js`): measured-height stacking, drag offset
  `orwell-slot-offset:<key>:<user>`, sheet-host on narrow.
- **Minimize / dock** — `modalManager` registry drives the sidebar "Windows" dock (`_renderDock`,
  class-driven `ow-has-rows` visibility). Kit adds a durable parked flag `orwell-win-parked:<id>:<user>`.
- **Gadget rail ↔ windows** — the rail is **game-build-only** (`orwellGadgetRail.js`), content-driven
  visibility. A `dockable:true` kit window re-homes its **whole element** into `#gadget-rail-body`,
  opting out of slot/z/drag/resize/chip-dock. So a **docked** window and a **minimized** window park in
  two different surfaces.
- **Cross-device sync** — `orwellLayoutSync.js` PATCHes `/api/orwell/layout`; the kit emits
  `orwell:window-layout` on every state change and applies remote via `_orwellApplyRemoteLayout`. The
  kit owns all key writes; the sync module never mints keys.

**Game build vs full build:** the **gadget rail exists only in the game build**, so `dockable` kit
windows only have a dock target there. The build=0 workspace's tool modals (cookbook/calendar/gallery/
email) carry the entire modalSnap/tileManager apparatus, none of which the game build exercises.

## 2. Pain points (ranked)

| # | Sev | Pain | Evidence |
|---|---|---|---|
| **P1** | MAJOR | **Two stacking/focus authorities** coordinated by convention (z-band gap), not structure; **two focus-return paths** (kit `opener` vs modal `_owOpener`). The kit has **no modal/scrim/focus-trap/inert capability** — the modal world's scrim proves it can exist, the kit just lacks it. | `orwellWindow.js` `raise()`/opener; `ui.js:1187` `_zCounter`, `:1218` `_owOpener`; DWE audit F9 only PARTIALLY closed (`dwe-window-audit.md:235`) |
| **P2** | MAJOR | **~700 lines of dead chain-physics + chip-drag in `modalManager.js`** (`_wireChipDrag`, `_initChainPhysics`, `_stepChain`, trash-zone) — audit-flagged "no remaining caller" — co-resident with the live `register`/`minimize`/`restore`/`_renderDock` path both worlds depend on. | `dwe-window-audit.md:286`; `_renderDock` never calls `_wireChipDrag` |
| **P3** | MAJOR | **"Minimize" and "dock" land in two different surfaces** — a free window minimizes to the sidebar "Windows" dock; a dockable window docks to the gadget rail. Two gestures, two hosts, two persistence keys, two visibility models, for the same windows. | `modalManager._ensureDock` vs `orwellWindow.js` dock path |
| **P4** | MED | **Four bespoke drag implementations** — window pointer-drag, modal chip/chain (P2), rail edit-mode long-press (PR #438), rail width-resize. The recent grip→edit-mode change fixed the overlay-covers-content bug **structurally** but as a fourth gesture model. | `orwellGadgetRail.js` edit-mode + width-resize |
| **P5** | MED | **Six geometry persistence schemes + a reset button that misses most** — `settings-wiring-audit.md` F3: "Reset window positions" misses `orwell-slot-offset:*` and `orwell-win-parked:*`; four separate clamp implementations. | `settings-wiring-audit.md` F3; `test_f3_window_ratchet.py:77` |
| **P6** | LOW | Six near-identical poll/backoff loops across kit-window consumers. | `dwe-window-audit.md:292`; `orwellFinale.js` `_pollDelay` |
| **P7** | LOW | Prior-audit residue still open (F9 partial, settings F3, refresh-persistence R3 composer-draft privacy). | the three 2026-06-11 audits |

## 3. UX-audit finding → pain-point → direction mapping

The refactor is not orphaned architecture; it retires concrete ledger findings.

| Ledger finding | Sev | What it is | Pain | Closed by |
|---|---|---|---|---|
| **J1-25** | **LAUNCH-BLOCKING** | Cast-photo window has no `aria-modal`/focus-trap/inert; focus escapes into chat | P1 | **A** — per-window `modal` option (focus-trap/inert/aria-modal), unify focus-return |
| **J1-23** | HIGH | No scrim / triple-stacked overlays; "Settings modal proves the scrim exists" | P1 | **A** — kit scrim/backdrop option |
| **J1-04 / J1-34** | HIGH | Floating cast-photo card occludes the live narration (figure-ground) | P1 | **A** — scrim + single z/focus authority |
| **J1-09** | BACKLOG | Welcome modal Escape works but is undiscoverable | (Escape arbiter) | **A** — surfaced while unifying close/escape |
| **J2-09** (=IA-03/J2-04) | MED | Up to four "Cast" surfaces; **two registry rows both titled "The Cast"** (`orwellGadgetRail.js:44,47`) + hidden `#rail-cast`; 87 tiles for 16 HGs | P3 | **B** — unify free-windows + gadgets into one host (one cast home) |
| **J2-04** | LOW (a11y) | Hidden `#rail-cast` mirror present-but-hidden — verify not tab-focusable | P3 | **B** |
| **J2-05** | MED (mobile IA) | Cast roster behind the mobile drawer at premiere; suggests a persistent mobile cast affordance | P3 | **B** — rail-as-single-host gives the mobile affordance |
| **settings F3** | — | "Reset window positions" misses `orwell-slot-offset:*` / `orwell-win-parked:*` | P5 | **A** — fold into the reset sweep |

**Honest caveats:** P2 (dead-code deletion) closes **no** user-facing finding — it is enabling hygiene.
The first **finding-closing** change is J1-25 (the per-window modal option). P5 maps to a sibling audit
(`settings-wiring-audit.md` F3), not J1/J2.

## 4. Directions

| | Approach | Invasiveness | Closes |
|---|---|---|---|
| **A** ⭐ | **Seam-tightening** — merge the two z-counters into one authority, unify focus-return, **add a per-window `modal` option (scrim + focus-trap + inert + aria-modal)** to the kit, delete the dead `modalManager` chain-physics, fix the reset-button key sweep, one shared clamp helper. Families stay distinct. | ~5 files, low risk, ratchet-safe, **no game-build/full-build divergence** | P1, P2, P5 → J1-25, J1-23, J1-04/J1-34, J1-09, settings F3 |
| **B** | **Unify free-windows + gadgets** — make the rail the single host for non-modal game surfaces; minimize and dock become the same gesture into the same place; fold the rail's bespoke drag into the shared helper. Modals untouched. | ~4–5 files, medium risk (dual persistence + game/full-build divergence) | P3, P4 → J2-09, J2-04, J2-05 |
| **C** | **One controller for everything** — migrate `.modal` onto the kit, collapse both z-counters, retire modalSnap/tileManager. This is the explicitly-deferred W15 migration. | every workspace tool, highest risk, least game value | P1–P5, but worst value/risk |

**Recommendation: A now, B as the next milestone, do NOT attempt C.** A closes every named open finding
(incl. the launch-blocker) with independently-shippable, ratchet-safe changes and zero game/full-build
divergence risk. C is the deferred W15 migration — worst value-to-risk for a game-facing product.

## 5. Direction-A plan (sequenced by ledger value)

Each step is independently shippable, gated, and ratchet-safe. Order leads with the launch-blocker.

### A0 — Enabling hygiene: delete the dead `modalManager` chain-physics (P2)
- **Delete** `_wireChipDrag`, `_initChainPhysics`, `_stepChain`, the trash-zone whirlpool — keep the live
  `register`/`minimize`/`restore`/`_renderDock`/`injectMinimizeButton` path.
- **Verify-first:** grep proves no caller (`_renderDock` uses trusted chip *clicks*, not drags); confirm
  no `browser_smoke.py` assertion drives the chain.
- **Closes:** no UX finding (unblocks the dock reasoning for A2/B). **Tests:** existing dock-restore
  smokes must stay green; no new test needed beyond a "no-caller" grep guard.

### A1 — Per-window `modal` option on the kit → **J1-25** (LAUNCH-BLOCKING) + **J1-23/J1-04/J1-34** (HIGH)
- Add an opt-in `modal:true` to `OrwellWindow` that, **without** forcing it on free/lingering windows:
  sets `role=dialog` + `aria-modal=true`, renders a **scrim/backdrop**, **traps focus** within the
  window, marks the background `inert`, and restores focus to the opener on close. Reuse the welcome
  modal's exemplary pattern (`orwellOnboarding.js:110-130,233,264-269`, called out as the model in
  `UX-AUDIT-LOG.md:58,69`).
- Apply `modal:true` to the **cast-photo** window (the J1-25 surface).
- **Closes:** J1-25 (focus-trap/inert/aria-modal), and the scrim half of J1-23/J1-04/J1-34.
- **Tests:** extend `test_f_window_kit.py` (a kit window with `modal:true` has `aria-modal`, traps focus,
  background inert, scrim present, focus returns on close); `browser_smoke.py` cast-photo block asserts
  Escape lands inside the dialog (not `body`) and the scrim dims the page.

### A2 — Single z/focus authority (P1) → underpins J1-23 stacking
- Merge `ui.js` `_zCounter` and the kit `_zTop` into one authority object; unify the two focus-return
  paths (`opener` vs `_owOpener`). Closes DWE audit **F9** (`dwe-window-audit.md:235`).
- **Tests:** `test_g14_z_authority.py` updated to the merged authority (it currently asserts the split);
  Escape-order and dock-restore-z regression checks.

### A3 — Reset-positions sweep + shared clamp (P5) → **settings F3**
- Make "Reset window positions" sweep all six geometry schemes incl. `orwell-slot-offset:*` and
  `orwell-win-parked:*`; route the four clamp implementations through one helper.
- **Tests:** a settings-reset test asserting every geometry key is cleared; `test_f3_window_ratchet.py`
  key-list updated if any scheme is consolidated.

**Blast radius (Direction A):** `modalManager.js` (A0), `orwellWindow.js` + CSS (A1), `ui.js` (A2),
`settings.js` + `orwellWindow.js`/`windowResize.js`/`orwellSlots.js` (A3). Tests to update:
`test_f_window_kit.py`, `test_g14_z_authority.py`, `test_f3_window_ratchet.py`, plus the
`browser_smoke.py` cast-photo + dock blocks. Most likely to regress: Escape ranking if the z-merge
changes `pickTopModal`, and dock-restore z. Cross-device: low — the kit's emit/apply seams are unchanged.

## 6. Smallest valuable first step

**A0** (delete the dead `modalManager` code) is the lowest-risk start and unblocks the dock reasoning —
but it closes no player-facing finding. If leading with player-visible value is preferred, start at
**A1** (the per-window modal option), which retires the audit's #1 launch-blocker (J1-25) and the HIGH
scrim cluster, and do A0 alongside it.

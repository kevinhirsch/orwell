# 2026-06-23 — Window-kit coverage audit (issue #641): every window/modal × OrwellWindow-kit composition

> 📋 **Audit record** · 2026-06-23 · DWE windowing coverage (DOC-ONLY) · **Status:** Plan of record for #641 (window half; #640 is the gadget half).
> **Mode:** read-only source pass over the player-tier front-end (`frontend/static/js/`, `frontend/static/index.html`). **No code changes ride with this pass.**
> **Relates to:** #553 (Settings → kit, the headline), #573 (A0/A2/B window-refactor lane), #643 (shared synced-UI-state substrate mandate), #644 (responsive/touch mandate), #640 (gadget kit).
> **Descends from:** `docs/audits/2026-06-11-dwe-window-audit.md` (Phase-1 matrix) and `docs/audits/2026-06-21-window-system-scope.md` (Direction A/B/C).

## Goal

Enumerate **every window/modal surface** in the front-end, classify each as kit-composed / legacy-`.modal`-reachable / legacy-but-game-build-dropped, gap-check the `OrwellWindow` kit against what each game-build holdout needs, note the **G14 z-order** browser-smoke entanglement, and lay out an ordered, gate-aware migration plan plus the proposed **window convention gate** (anti-fragmentation ratchet, window edition). Acceptance for #641: every game-build window/modal renders via `OrwellWindow`; no game-build surface hand-rolls `.modal`; browser-smoke (incl. G14) green against the kit's z-authority; inherited-only surfaces confirmed dropped.

## Method & sources (verified)

- **Kit composition** = a module calls `window.OrwellWindowKit.create({...})` / `new OrwellWindow(...)` (the seam in `frontend/static/js/orwellWindow.js`, exported as `window.OrwellWindowKit`). The element carries `.ow-window` + `data-ow-window` + the `.ow-*` chrome family.
- **Legacy `.modal`** = a `.modal` / `.modal-content` / `.modal-header` DOM surface, dragged via `windowDrag` hand-wiring, minimized/docked via `modalManager`, z/focus via `ui.js`'s `_zCounter` observer.
- **Game-build reachability** confirmed against `frontend/src/settings.py`: `GAME_KEEP_SET`, `GAME_DROP_SET`, `GAME_DROP_SCRIPTS`, `strip_dropped_scripts()` (drops `<script>` tags server-side) and `is_feature_enabled()` (routers not mounted → 404). The game build (`ORWELL_GAME_BUILD`) is **ON by default**.
- Kit-composer grep (verified): `orwellCast.js`, `orwellFinale.js`, `orwellHeadshot.js`, `orwellNewSeason.js`, `orwellRetrospective.js` are the only `OrwellWindowKit.create` callers. `ui.js` references the kit only to delegate Escape (`OrwellWindowKit.dismissTop()`). `settings.js`'s only `orwellWindow` reference is a *parked-key prefix sweep* in its reset-positions handler (`settings.js:1758`) — **not** composition.

**Correction to the #641 rough scan:** the issue lists `orwellOnboarding`, `orwellLayoutSync`, and `modalManager` as "on the kit." They are **not** kit composers: `orwellOnboarding.js` hand-rolls its own modal (`aria-modal`, `inert`, its own focus trap — the *exemplar* the kit's `modal:true` was modeled on, but it predates and does not call the kit); `orwellLayoutSync.js` is the 0064 sync *transport* (it drives the kit, isn't a window); `modalManager.js` is the dock/minimize *host* the kit composes, not a window. Conversely the scan omitted `orwellNewSeason`/`orwellHeadshot`, which **do** compose the kit. The table below supersedes the rough scan.

---

## 1. Inventory & classification

Class **A** = kit-composed ✅ · **B** = legacy `.modal`, reachable in the game build (must migrate) · **C** = legacy, game-build-dropped (inherited-workspace only — out of scope; listed for completeness) · **N** = not-a-window by ruling (kept for completeness; argued in the 2026-06-11 matrix).

| Surface (id) | File | Kit / legacy | Game-build reachable? | Gap (what's missing to be kit) | Action |
|---|---|---|---|---|---|
| **A — kit-composed ✅** |
| `orwell-cast` (The Cast) | `orwellCast.js:183` | kit ✅ | Yes (keep-set: portraits/status) | — (composes `OrwellWindowKit.create`; dockable) | none |
| `orwell-finale` (The Finale) | `orwellFinale.js:118` | kit ✅ | Yes | — (migrated PR #239; slot key + clamp via kit) | none |
| cast-photo / headshot dialog | `orwellHeadshot.js:413` | kit ✅ (`modal:true`) | Yes (image_gen keep-set) | — (the J1-25 launch-blocker fix; aria-modal + scrim + focus-trap + inert) | none |
| `orwell-newseason` (New Season) | `orwellNewSeason.js:255` | kit ✅ | Yes | — (composes kit) | none |
| `orwell-retro` (Retrospective) | `orwellRetrospective.js:67` | kit ✅ | Yes | — (migrated 2026-06-19, 0054 Phase 2; dockable) | none |
| `ow-smoke-window` etc. (smoke fixtures) | `browser_smoke.py` | kit ✅ | test-only | — | none |
| **B — legacy `.modal`, GAME-BUILD REACHABLE (must migrate)** |
| **`settings-modal` (Settings)** | `index.html:1467`; `settings.js` (`open(tab)` ~:5419, `settingsModule` ~:5490; reset sweep :1758) | **legacy `.modal`** | **Yes** (keep-set: `settings`) | **Headline holdout (#553).** No kit geometry mint/restore (no cross-session position persistence); bespoke `.modal`/`settings-modal-content` centering; own focus trap; injected `modalManager` minimize button; G14-pinned `.modal` z owner. Needs: kit slot+`winsize-` geometry (already kit-capable), focus-trap (kit `modal:true` has it), **edge-dock + header "peek"/opacity if those legacy affordances are kept** (kit GAP — see §3). | **Migrate (gate-aware; re-point G14 — see §4).** |
| `theme-modal` (Theme picker) | `index.html:558`; `theme.js` | **legacy `.modal`** | **Yes** (keep-set: `theme`; the in-game "house look & feel", ruling #13 / 0052) | Same family as Settings: bespoke `.modal`, `windowDrag` hand-wiring (grandfathered in `test_f3_window_ratchet.py:GRANDFATHERED_DRAG`), remembered dock side via `modalSnap`. Needs kit geometry + (if kept) edge-dock. | **Migrate** (sibling of Settings; do right after). |
| `styled-confirm-box` (styledConfirm) | `ui.js:576` (dynamic) | **legacy `.modal`** micro-modal | **Yes** (used for confirm-destructive flows incl. new-game/reset) | Already has `role=dialog` + `aria-modal` + own focus trap + own Escape. Small, transient, *modal-by-nature*. Maps cleanly to kit `modal:true` + `closable`, `minimizable:false`, `resizable:false`, `persistLayout:false`. | **Migrate** (low-risk; or formally exempt as a kit-`modal` micro-dialog — owner call). |
| `styled-prompt-box` (styledPrompt) | `ui.js:657` (dynamic) | **legacy `.modal`** micro-modal | **Yes** | Same as styledConfirm (carries an input). | **Migrate** (alongside styledConfirm). |
| Keyboard-shortcuts view | `settings.js` shortcuts tab; `keyboard-shortcuts.js` | rides Settings | **Yes** | Not a standalone modal — it is a **tab inside `settings-modal`** (smoke drives `#settings-modal [data-settings-tab='shortcuts']`). Migrates *for free* when Settings migrates; verify the tab + the shortcut-rebind UI still mount inside the kit body. | folds into Settings migration |
| **C — legacy `.modal`, GAME-BUILD DROPPED (inherited workspace only; OUT OF SCOPE)** |
| `memory-modal` | `index.html:359`; `memory.js` | legacy `.modal` | **No** — `memory` ∈ `GAME_DROP_SET`; `memory.js` ∈ `GAME_DROP_SCRIPTS` (stripped) | — | confirm dropped (done) |
| `cookbook-modal` | `index.html:1456`; `cookbook.js` | legacy `.modal` | **No** — `cookbook` ∈ drop-set; `cookbook.js`/`cookbookSchedule.js` ∈ drop-scripts | — | confirm dropped (done) |
| `custom-preset-modal` | `index.html:1262`; `presets.js` | legacy `.modal` | **No*** — presets ride the workspace/prompt-library surfaces removed from the game UI (`presets.js` has no game-build entry point; *unverified whether its node is ever opened under the game build — its launcher lives in dropped chrome*). | confirm dropped (likely; **unverified launcher** — see §6) |
| `rename-session-modal` | `index.html:1430`; `sessions.js` | legacy `.modal` | **Unverified** — session rename is plausibly reachable (history is keep-set). The static node exists; whether the game UI exposes a rename launcher is **unverified**. | **VERIFY** (see §6) — if reachable, promote to class B. |
| `library-modal` (doclib) | `sessions.js:2711` (dynamic) | legacy `.modal` | **No** — documents/`document_editor`/`rag` ∈ drop-set | — | confirm dropped (done) |
| build=0 tool modals (calendar, gallery, email, tasks, notes, research, compare, doc pane, assistant, etc.) | `assistant.js`, `tileManager.js`, `workspace.js`, `slashCommands.js`, `group.js`, … | legacy `.modal` family | **No** — all ∈ `GAME_DROP_SET`; routers unmounted (404) + the modalSnap/tileManager snap apparatus the game build never exercises | — | confirm dropped (done) |
| `tourHints`/`tourAutoplay` overlays | `tourHints.js`, `tourAutoplay.js` | legacy overlay | **No** — both ∈ `GAME_DROP_SCRIPTS` (in `index.html` but stripped server-side by `strip_dropped_scripts`) | — | confirm dropped (done) |
| **N — not-a-window by ruling (kept for completeness)** |
| `orwell-onboarding` welcome / setup-wizard modal | `orwellOnboarding.js:65` | own modal (not kit) | Yes | Holding-card modal; the #233 no-trap contract + the exemplar for the kit's `modal:true`. **Owner-argued exception** (one-shot holding card; smoke F-3+ already whitelists `#orwell-onboarding`). Could adopt kit `modal:true` for one-authority hygiene but is **not** a #641 blocker. | optional later |
| `orwell-engine-status` banner | `orwellEngineStatus.js` | own (`.ow-dismiss`) | Yes | Banner, z 11000, role=alert — not a window (whitelisted in smoke F-3+). | none |
| `orwell-presence` strip | `orwellPresence.js` | own (`.ow-dismiss`) | Yes | Dismissible strip; grandfathered `GRANDFATHERED_SLOTS`. Not a window. | none |
| `orwell-status` HUD | `orwellStatusPanel.js` | sidebar chrome | Yes | Ruling #3/E64 — "not a window." | none |
| Diary Room pill/mode | `orwellDiaryRoom.js` | composer mode | Yes | Ruling #4/E88 — composer mode, not a window. | none |
| `orwell-decision-card` | `orwellDecision.js` | in-chat card | Yes | ADR 0003 — a card in the conversation, deliberately not chrome. | none |
| `minimized-dock` ("Windows") | `modalManager.js` | sidebar dock | Yes | Ruling #10/E95 — it IS the minimize target, not a window. | none |
| Transient menus (kebabs, slash, emoji, export, overflow) | `escMenuStack` clients | popovers | Yes | LIFO popovers via `escMenuStack` — not windows (the kit composes `escMenuStack`, doesn't replace it). | none |
| `gadget-rail` host | `orwellGadgetRail.js` | rail host | Yes (game-build only) | Hosts docked kit windows; the *gadget kit* is #640's scope, not this issue. | #640 |

### Classification counts

- **Class A (kit-composed ✅):** 5 shipping game-build windows — `orwell-cast`, `orwell-finale`, cast-photo/headshot, `orwell-newseason`, `orwell-retro` (+ test fixtures).
- **Class B (legacy `.modal`, game-build reachable — MUST MIGRATE):** **4** distinct surfaces — **`settings-modal` (headline, #553)**, **`theme-modal`**, **styledConfirm**, **styledPrompt**; the keyboard-shortcuts view rides Settings (no separate migration). `rename-session-modal` is a **possible 5th pending verification** (§6).
- **Class C (legacy, game-build dropped — out of scope, confirmed dropped):** `memory-modal`, `cookbook-modal`, `library-modal`, `custom-preset-modal`*, the whole build=0 tool-modal family, and the tour overlays. (`custom-preset-modal` launcher: dropped-but-launcher-unverified.)
- **Class N (not-a-window by ruling):** onboarding, banner, presence, status HUD, Diary Room, decision card, dock, menus, gadget rail.

---

## 2. Kit capability inventory (what `OrwellWindow` provides today — verified in `orwellWindow.js`)

Provided by construction, so any migrated window inherits them:
- **Drag** (`windowDrag`, explicit viewport clamp `clampPos`), **resize** (`windowResize`, persisted `winsize-<id>`, edge/corner grips, `mobileSkip:768`), **slot placement** (`OrwellSlots`, one geometry scheme: the clamped slot offset — F5).
- **One z-authority for the window band** (500–980) with click-to-front + `ow-focused`; **opt-in modal tier** (`modal:true`) that draws its z from `window._owNextModalZ()` (ui.js's single monotonic counter, A2) so a kit modal and a legacy `.modal` cannot out-climb each other.
- **`modal:true` chrome:** backdrop scrim (`.ow-scrim`), focus-trap, background `inert`, `aria-modal`, focus-into + focus-return on close.
- **Minimize-to-dock** (Win7 fly-out, ruling #19) + durable parked flag (`orwell-win-parked:<id>:<user>`); **0054 Phase-2 docked mode** (`dockable`, re-homes into `#gadget-rail-body`, opts out of geometry).
- **Geometry persistence + 0064 cross-device sync:** every state change emits `orwell:window-layout` → `orwellLayoutSync` PATCHes `/api/orwell/layout`; remote applied via `_orwellApplyRemoteLayout`; self-echo suppressed (`origin` token + `_applyingRemote`). `persistLayout:false` opts a transient dialog out (always re-center).
- **Escape participation** through ui.js's single arbiter (`dismissTop()`), **keyboard move/resize** on the titlebar (arrows / Shift+arrows / Home), **viewport re-clamp** on browser resize, **one-AbortController teardown**, **non-blocking `setLoading` refresh sliver**.

---

## 3. Kit gap-check for the class-B windows

For each game-build holdout, what the kit needs to fully absorb it:

| Capability the legacy modal relies on | Kit status | Gap / action |
|---|---|---|
| Centered modal-by-nature dialog (Settings/Theme open centered) | ✅ `modal:true` + scrim + focus-trap; slot placement available | none — kit covers it |
| Cross-session geometry persistence (the #553 symptom) | ✅ slot-offset + `winsize-<id>` + 0064 sync | **closes #553** automatically on migration |
| Focus trap + `aria-modal` + inert (Settings' `settings.js:5399` trap) | ✅ kit `modal:true` | replace bespoke trap with kit's |
| Minimize-to-dock (injected `modalManager` button) | ✅ kit owns minimize | replace injected button with kit's `minimizable` |
| Resize with clamped `winsize-` | ✅ `windowResize` (kit uses the **same** `winsize-` key scheme) | none |
| **Edge-docking / snap (`modalSnap` — Theme "remembered dock side", Settings dock-width)** | ⚠️ **MISSING from the kit** — `modalSnap`/`tileManager` are modal-world only; kit windows pass `enableDock:false` | **Owner decision (#553/#641):** either (a) **drop** edge-docking for Settings/Theme on migration (the kit's slot + free-drag + minimize is the replacement; simplest, lowest risk), or (b) **extend the kit** with an edge-dock option folding `modalSnap` under it. Recommend (a) unless the snap-dock is a valued game affordance. |
| **Header "peek" / opacity-on-hover** (#553 mentions a "peek"; *not found in current `settings.js`/`theme.js` source* — **unverified** whether any live Settings/Theme peek exists) | ⚠️ **MISSING from the kit** if a real peek behavior exists | **VERIFY first** (§6). If a live peek exists, **extend the kit** with a header-peek/opacity option (it is a generic window affordance — belongs in the kit, not re-hand-rolled). If it doesn't exist, no gap. |
| 0064 cross-device sync of the modal's open/min/geometry | ✅ kit emits/applies | migration brings Settings/Theme onto cross-device sync for free (a #643 win) |
| #643 shared synced-UI-state substrate | partial — kit already routes geometry through 0064 | no new gap for #641; #643 governs re-homing the substrate kit-agnostically (cross-cutting). |
| #644 responsive/touch (≥44px controls, sheet adaptation, safe-area, dvh) | ✅ kit has the mobile sheet tier + dvh body + R2 cursor suppression | migrating Settings/Theme onto the kit hands them the kit's touch adaptation; verify the Settings tab strip reflows in the kit's sheet tier (responsive-matrix). |

**Net kit gaps to resolve before/with the Settings migration:** (1) **edge-dock/snap** (decide drop vs. extend), (2) **header peek/opacity** (verify it exists; if so, add a kit option). Everything else the kit already provides.

---

## 4. Browser-smoke / G14 finding (the migration's load-bearing entanglement)

The **G14 z-authority gate** in `frontend/scripts/browser_smoke.py` (~:810–873) asserts the **legacy `.modal` family**'s single z-authority by name, using **`theme-modal` + `settings-modal`** as the two representative windows. The assertions that **break the moment Settings (or Theme) migrates off `.modal`**:

- `:850–851` — `const owner = el ? (el.closest('.modal') || {}).id || null : null;` → resolves the topmost surface at the content overlap **by `.modal` ancestor**.
- `:858` — `check(g14.get("owner") == "settings-modal" and g14.get("settingsZ",0) > g14.get("themeZ",0), …)` — **the literal `owner=="settings-modal"` + `settingsZ>themeZ` assertion** the issue calls out. A kit Settings is `.ow-window`, not `.modal`, so `closest('.modal')` returns `null` → `owner` is `null` → **fails**.
- `:845–846` — reads `.modal-content` rects (`t.querySelector('.modal-content')`); a kit window has `.ow-body`, not `.modal-content`.
- `:852–860` — `importants` sweeps `document.querySelectorAll('.modal')` for inline `!important` z; a migrated window leaves the `.modal` set, so the assertion silently stops covering it.
- `:822, :838, :864–873, :904–948` — the G14 + F8 blocks drive `#theme-modal`/`#settings-modal` by `.modal`-family selectors (`.modal-minimize-btn`, `.modal-content`, `.close-btn`, `classList.contains('hidden'|'modal-minimized')`).

**Finding:** migrating Settings (and/or Theme) requires **re-pointing G14 at the kit's z-authority** — the unified `_owNextModalZ` counter from **#573-A2**. Concretely the migration PR must rewrite the G14 block to:
1. resolve the top surface via the kit/modal *union* (`el.closest('[data-ow-window], .modal')`) rather than `.modal` alone;
2. assert the **kit modal tier** (`_owNextModalZ`) orders a fresh-open above a dock-restored window — the same monotonic-counter invariant, expressed against the unified authority that A2 already wired (`orwellWindow.js raise()` reads `window._owNextModalZ`);
3. drive the kit window by `.ow-*` selectors (`.ow-min`, `.ow-close`, `.ow-body`, `[data-ow-window]`).

The Phase-1 audit already flagged G14/F9 as **PARTIAL by design**, deferring "the ui.js/modalManager counter merge … [to] the post-Lane-F W15 migration" — #573-A2 builds that single authority; #641's Settings/Theme migration is what finally **exercises it across both families and re-pegs G14 to it**. Sequencing matters: **A2 (single z authority) must land — or land in the same PR — before Settings migrates**, so the kit modal and any remaining legacy `.modal` share `_owNextModalZ` and G14 can assert one ladder.

Companion gates the migration must keep green: `test_g14_z_authority.py` (re-point to the merged authority — the scope doc notes it "currently asserts the split"), `test_f3_window_ratchet.py` (remove `settings.js`/`theme.js` from `GRANDFATHERED_DRAG` as they migrate — the list is shrink-only), `test_f_window_kit.py`, and the F-3+ rogue-chrome runtime check (~`browser_smoke.py:1611`).

---

## 5. Migration plan (ordered, low-risk, gate-aware)

Each step is independently shippable and ratchet-safe; order leads with prerequisites, then the headline, then the cheap tails.

**Step 0 — Prerequisite: land #573-A2 (single z/focus authority).** Merge ui.js `_zCounter` and the kit `_zTop` into one authority exposed as `_owNextModalZ` (the kit's `raise()` already prefers it). This is the foundation G14 will re-peg to; doing it first means Settings can migrate against a stable single ladder. (Also do #573-A0 dead-code delete opportunistically — pure hygiene, no UX finding.)

**Step 1 — Verify the two open questions (§6) before touching Settings.** Confirm whether a live Settings/Theme **header "peek"/opacity** exists and whether **edge-dock/snap** is a valued affordance to preserve. Resolve the two kit gaps from §3 accordingly: drop them (preferred) or add the kit option(s). Also resolve `rename-session-modal` reachability.

**Step 2 — Migrate `settings-modal` → `OrwellWindow` (the #553 headline).** Rebuild Settings as `OrwellWindowKit.create({ id:'settings-modal' (or a kit id), title:'Settings', modal:true, resizable:true, minimizable:true })`, mounting the existing settings content/tabs (incl. the shortcuts tab) into the kit `.ow-body`. Delete the bespoke `.modal`/`settings-modal-content` centering, the hand-rolled focus trap (`settings.js:5399`), and the injected-minimize wiring; keep the `/settings` open path and the `keyboard-shortcuts.js` wiring (`:114,138-140`). **In the same PR:** re-point G14 + `test_g14_z_authority.py` to `_owNextModalZ` (per §4); remove `settings.js` from `GRANDFATHERED_DRAG`. This single migration **closes #553** (cross-session geometry via the kit's one scheme + 0064 sync) and brings Settings onto cross-device sync (#643) and the kit's touch adaptation (#644).

**Step 3 — Migrate `theme-modal` → `OrwellWindow`.** Sibling of Settings, same recipe; remove `theme.js` from `GRANDFATHERED_DRAG`; fold its remembered-dock-side handling into whatever §1/§3 decided for edge-dock. Re-verify the G14 block (now both representatives may be kit windows — simplify G14 to two kit windows once both migrate).

**Step 4 — Migrate styledConfirm / styledPrompt → kit `modal:true` micro-dialogs.** They already carry `role=dialog`/`aria-modal`/own trap; reframe as `OrwellWindowKit.create({ modal:true, minimizable:false, resizable:false, closable:true, persistLayout:false })` with the message/input in the body. Low risk; or — owner's call — formally **exempt** them as the canonical kit micro-dialog if a full migration is overkill. Either way they must stop hand-rolling `.modal`.

**Step 5 — (Conditional) migrate `rename-session-modal`** iff §6 finds it game-build reachable.

**Step 6 — Confirm-and-close the class-C drops.** No migration; add/keep an assertion that the dropped modal ids (`memory-modal`, `cookbook-modal`, `custom-preset-modal`, `library-modal`, the tool-modal family) are **absent under the game build** (their scripts stripped / routers unmounted). The boot smoke (`boot_smoke.py`) already proves game-build gating server-side; extend with a node-absence check if not already covered.

**Step 7 — Add the window convention gate (anti-fragmentation ratchet, window edition).** See §7.

**Blast radius:** `settings.js` + `index.html` (Settings), `theme.js` + `index.html` (Theme), `ui.js` (styled dialogs + the A2 authority), `orwellWindow.js` (only if a kit gap is filled), and the gates `test_g14_z_authority.py` / `test_f3_window_ratchet.py` / `browser_smoke.py` G14+F8 blocks. Highest regression risk: **G14 Escape-ordering and dock-restore z** if the z-merge changes `pickTopModal` (call out in the migration PR; the scope doc flags the same).

---

## 6. Open questions / unverified (resolve in Step 1)

- **Header "peek"/opacity for Settings/Theme** — #553 mentions a "peek"; **no live peek/opacity-on-hover behavior was found** in the current `settings.js`/`theme.js` source during this pass. **Unverified.** If it exists it is a kit GAP (add a generic header-peek option); if not, no gap.
- **Edge-dock/snap (`modalSnap`) for Settings/Theme** — present in the legacy family; **decide drop vs. extend** before migrating (recommend drop unless valued).
- **`rename-session-modal` reachability** — static node exists (`index.html:1430`); whether the game build exposes a rename **launcher** is **unverified**. If reachable → class B (migrate); if not → class C.
- **`custom-preset-modal` launcher** — node exists; its launcher lives in dropped chrome, so it is **almost certainly** unreachable under the game build, but the launcher path was **not** traced this pass.

---

## 7. Proposed convention gate (anti-fragmentation ratchet — window edition)

Mirror the DWE Lane-F **F-3 ratchet** (`frontend/tests/test_f3_window_ratchet.py`) and its runtime companion (the F-3+ rogue-chrome check in `browser_smoke.py`). The new gate pins:

1. **Source-pin (shrink-only allowlist):** any module that creates a fixed-position dialog surface in the **game build** must compose `OrwellWindowKit` — except an explicit grandfathered set that shrinks as migrations land. As Settings/Theme/styled-dialogs migrate, remove them from `GRANDFATHERED_DRAG` (and add no new entries). New game-build windows that hand-roll `.modal`/`.modal-content`/`.modal-header` chrome **fail the gate**.
2. **Runtime assert (extend F-3+):** the existing rogue-chrome check (`browser_smoke.py:~1611`) whitelists `.modal` as an allowed family. Once the game-build `.modal` holdouts are gone, **tighten** it so that under the game build a Close/Minimize-shaped control inside a fixed surface must belong to `[data-ow-window]` (or the argued exceptions: `minimized-dock`, `orwell-engine-status`, `orwell-onboarding`) — **drop `.modal` from the game-build allowed set** (keep it for build=0 where the inherited family lives).
3. **Cross-cutting inheritance (#643/#644):** per #643, the gate should also assert a migrated window routes persisted state through the shared 0064/synced-UI-state seam (`orwell:window-layout` → `/api/orwell/layout`), not ad-hoc `localStorage`; per #644, the responsive matrix (`responsive_matrix.py`) must cover the migrated windows across phone/tablet/desktop with no new XFAILs and ≥44px controls on coarse pointers.

**Acceptance restated (#641):** every game-build window/modal renders via `OrwellWindow`; no game-build surface hand-rolls `.modal`; `browser_smoke.py` (incl. the re-pointed G14 against `_owNextModalZ`) green; the window ratchet pins it shut; inherited-only surfaces confirmed dropped.

---

## Appendix — Vault / ADR-0003 note

Every surface in this audit renders projection data only; no window builds or progresses the game outside the chat (the decision card posts to the same validated seam; argued in-chat by design). Settings/Theme carry FE config, not engine/Vault state. No Vault finding. This is a chrome-mechanics audit; it does not touch the engine, `src/`, or the Vault Wall.

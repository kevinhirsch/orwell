# 2026-07-15 — Total kit-migration inventory (owner mandate: every window / gadget / element)

> 📋 **Audit record** · 2026-07-15 · DOC-ONLY, read-only source pass. **No code changes ride with this
> doc — it is the complete migration LEDGER only.**
> **Mandate (owner):** "total kit migration" — enumerate EVERY window, gadget, and element across the
> whole front-end that is **not yet on the shared kit**, so nothing is missed, and lay out a per-PR
> wave plan ordered by user visibility (cast-photo upload + generated-photos + gadgets first).
> **Supersedes / extends:** `docs/audits/2026-06-23-window-kit-coverage-audit.md` (windows, #641),
> `docs/audits/2026-06-11-dwe-window-audit.md` (Phase-1 matrix), and the #1606 SET-lane settings work
> (#1634/#1635/#1637). Those closed the **window chrome** for Settings/Theme and a first slice of the
> settings controls; this ledger inventories **everything still bespoke** — windows, gadget internals,
> and element primitives — end to end.

## The kit (target of migration)

- **Windows** → `OrwellWindowKit.create(...)` / `OrwellSheetKit.create(...)` producing `.ow-window`
  (`.ow-titlebar` / `.ow-body`, opt-in `modal:true`, sheet mode). Kit files
  `frontend/static/js/orwellWindow.js`, `orwellSheet.js`; demo `frontend/static/element_kit_demo.html`.
- **Gadgets** → `OrwellGadgetKit.create(...)` producing `.og-card`; notices → `OrwellNoticeKit` (`.on-card`).
- **Controls (OrwellElement primitives, in `frontend/static/style.css`)** → `.ow-btn`
  (`-prominent`/`-secondary`/`-destructive`/`-plain`/sizes), `.ow-select`, `.ow-slider`, `.ow-switch`,
  `.ow-field`/`.ow-input`, `.ow-radio`, `.ow-checkbox`, `.ow-btn-group`, `.ow-segmented`/`.theme-seg`,
  card primitives `.og-card`/`.on-card`.

## Method & sources

Read-only sweep of `frontend/static/index.html`, `frontend/static/login.html`, and
`frontend/static/js/*.js` (there is **no** `frontend/templates/` dir). Kit consumption = a module calls
`window.OrwellWindowKit.create` / `OrwellSheetKit.create` / `OrwellGadgetKit.create` /
`OrwellNoticeKit.create`, or an element carries an `.ow-*` primitive class. Bespoke = legacy `.modal`
family (managed by `modalManager.js`, a separate z-authority — `modalManager.js:63-80`), ad-hoc
`createElement` overlays, or any non-`ow-*` control class / inline-styled interactive element.

### Reachability is load-bearing (the scope split)

The **game build** (`ORWELL_GAME_BUILD`, default ON) removes whole inherited-workspace verticals server
side (`frontend/src/settings.py`): `GAME_KEEP_SET` = `chat, history, onboarding, llm, agent, engine_mcp,
status_panel, portraits, image_gen, accounts, settings, theme, search, web_search`; `GAME_DROP_SET`
forces off `email, calendar, contacts, documents, document_editor, gallery, cookbook, hwfit, compare,
deep_research, research, rag, memory, skills, notes, tasks, shell, web_fetch, youtube, webhooks,
signature, companion, codex, copilot, vault`; and `GAME_DROP_SCRIPTS` strips
`memory.js, skills.js, rag.js, search.js, document.js, gallery.js, cookbook.js, cookbookSchedule.js,
compare/index.js, tourHints.js, tourAutoplay.js`.

So each row below carries a **reachability** verdict:
- **IN SCOPE** — a game-build player-reachable surface (kept feature). These are the real backlog.
- **OUT OF SCOPE (inherited)** — a `GAME_DROP_SET`/`GAME_DROP_SCRIPTS` surface, present in the shared
  source but **not shipped in the game build** (confirmed Class C in the 2026-06-23 audit). Documented
  for completeness so nothing is "missed," but it is **not** part of the game's kit backlog and should
  only be migrated if/when the full inherited workspace build is a target.

Legend: **DONE** (already on the kit) · **ACCEPTED-GAP** (no kit/Apple analog — do NOT migrate) ·
**TODO** (backlog) · **OUT-OF-SCOPE** (inherited, game-build-dropped).

---

## 0. DONE — confirmed against current source (do NOT re-list as TODO)

| Surface | Evidence (file:line) | What migrated |
|---|---|---|
| **Settings window chrome** | `settings.js:319` `OrwellWindowKit.create({id:'settings-modal', modal:true})` reparents `#settings-host`/`.settings-modal-content` (`index.html:1616`); legacy `.modal-header` dropped `settings.js:350` | #553/#660 — kit window (geometry, focus-trap, Escape). *Inner controls still bespoke → §5.* |
| **Theme window chrome** | `theme.js:2672` `OrwellWindowKit.create({id:'theme-modal', modal:true})` reparents `#theme-popup` (`index.html:680`); `_promoteThemeChrome` drops `.modal-header.theme-popup-header`; drag residual closed #1289 | #660/#1289 — kit window. *Inner controls still bespoke → §5.* |
| **styledConfirm / styledPrompt windows** | `ui.js:556` / `ui.js:596` `Kit.create({modal:true, persistLayout:false})` | #660 — the native confirm()/prompt() replacements are kit windows. *Inner buttons/input still bespoke → §4.* |
| **App toast** | `ui.js:249` `OrwellNoticeKit.create({kind:'toast'})`; `showToast` `:266`, `showError` `:360` | #951 — single reused kit notice. |
| **Appearance / visibility toggles** | `index.html:2088–2173` now `.ow-switch` (0 `vis-switch` occurrences anywhere) | #1635 SET-11 — `vis-switch → .ow-switch`. |
| **Theme "Customize" controls** | selects `.ow-select` `index.html:811,822,838,847,901,912`; sliders `.ow-slider` `:950,954`; import/export/apply/clear `.ow-btn ow-btn-secondary` `:828,889,890,966,967,971,972`; segmented `.theme-seg` `:711–717,863–877` | #1634 — theme customize pane on kit primitives. |
| **Settings Account / Data buttons** | `.ow-btn ow-btn-prominent`/`-destructive` `index.html:2212,2235,2254,2266,2274,2285,2536–2717`; login submit `.ow-btn ow-btn-prominent` `login.html:465` | #1634 — account/data actions. |
| **All rail gadget CARDS** | `OrwellGadgetKit.create`: House Status `orwellStatusPanel.js:313`, Deals `orwellDeals.js:118`, Presence `orwellPresence.js:156`, Nightfall `orwellNightStatus.js:76`, Cast-pin `orwellCastPin.js:124`; Room strip `OrwellNoticeKit` `orwellRoomStrip.js:154` | #640 — every gadget card composes the kit. *Two internal controls remain → §3.* |
| **The Cast / Finale / Dossier / Memory Wall / Retrospective / New Season / Headshot / Onboarding / Decision windows** | kit windows: `orwellCast.js:330`, `orwellFinale.js:183`, `orwellDossier.js:139`, `orwellMemoryWall.js:182`, `orwellRetrospective.js:104`, `orwellNewSeason.js:267`, `orwellHeadshot.js:598`, `orwellOnboarding.js:121`; decision sheet `orwellDecision.js:957` | Window chrome all on kit. *Inner-control debt tracked in §1/§2.* |

> ⚠️ **Discrepancy to record (#1637 was PARTIAL).** The claimed-DONE "admin-tab `.admin-btn-*` buttons
> (#1637)" migrated only a subset. The `.admin-btn-sm` / `.admin-btn-add` / `.admin-btn-delete` family is
> still the dominant button class across `settings.js` and `admin.js` (~110 live occurrences — §5/§6).
> Treat the admin-button family as **TODO**, not done.

---

## 1. Cast-photo UPLOAD dialog ("Your Cast Photo", `orwellHeadshot.js`) — IN SCOPE

**Window chrome: DONE** (kit window `orwellHeadshot.js:598`, `modal:true` scrim + focus-trap — the J1-25
launch-blocker fix). Inner controls are **already dual-classed** `.hs-btn … ow-btn ow-btn-*`, where
`.hs-btn` supplies only the Normal/flat-tier fallback (`orwellHeadshot.js:68–98`):

| Element | file:line | Current | Target | Verdict |
|---|---|---|---|---|
| Action buttons (redo/remove/use/more/new/studio/exact/skip/filebtn) | `orwellHeadshot.js:479,480,495,496,497,514,517,518,519` | `hs-btn [hs-btn-ghost] ow-btn ow-btn-secondary/-prominent` | `.ow-btn` (drop `.hs-btn*` fallback once flat-tier parity confirmed) | **effectively DONE** (dual-class intentional) — optional cleanup only |
| Portrait candidate / library tiles | `.hs-cand` `:493`, `.hs-libpick` `:435`, `.hs-libdel` `:435` | bespoke image-thumbnail buttons | — | **ACCEPTED-GAP** (image-thumbnail selection; no kit analog) |

**Net for §1: no functional migration owed** (owner named it first, but it is already kit + dual-class).
Optional micro-lane: delete the `.hs-btn*` fallback classes after verifying flat-tier parity.

---

## 2. GENERATED cast-photos / cast-wall / portrait viewer (`orwellCast.js`) — IN SCOPE

**Window chrome: DONE** (kit window, sheet-capable, `orwellCast.js:330`). There is **no** separate
portrait-lightbox window — the Cast window *is* the generated-photos surface. Residual inner debt:

| Element | file:line | Current | Target | Verdict |
|---|---|---|---|---|
| "Compact pin" toolbar button | `orwellCast.js:322` | `oc-pin ow-btn ow-btn-secondary` | `.ow-btn` (drop `.oc-pin` override) | **effectively DONE** (dual-class) |
| **"Generate cast portraits" button** | `orwellCast.js:327` | `oc-backfill` (bespoke, no `.ow-btn`) | `.ow-btn ow-btn-secondary` | **TODO** |
| Cast portrait cards / tiles | `.oc-hg` `:564`, `.oc-portrait` `:566`, monogram `.oc-ph oc-monogram` `:473` | bespoke portrait cards (display; not buttons) | — | **ACCEPTED-GAP** (portrait tile; no kit analog) |

**Net for §2: 1 TODO** (`.oc-backfill` → `.ow-btn`).

---

## 3. GADGETS — IN SCOPE

Every gadget **card** is on the kit (§0). The gadgets are overwhelmingly read-only panels; only two
internal controls and the rail-host chrome are bespoke.

### 3a. Gadget-internal controls
| Gadget | Element | file:line | Current | Target | Verdict |
|---|---|---|---|---|---|
| Cast-pin | "Open" / "Un-pin" header actions | `orwellCastPin.js:131,132` (via kit `addAction`) | `.og-act` (the gadget kit's OWN action primitive, `orwellGadget.js:84-90,289-291`) | `.ow-btn ow-btn-plain` (fix once in `orwellGadget.js` → migrates every gadget action at once) | **TODO** (single kit-internal fix) |
| House Status | Premiere cast portrait tiles | `orwellStatusPanel.js:645-648` | `.os-tile` (bespoke `<button>` portrait tile) | shared "portrait tile" primitive (not `.ow-btn`) | **ACCEPTED-GAP** (portrait chip; no clean kit analog) |

### 3b. Gadget-rail HOST chrome (not gadget-internal, but rail controls)
| Control | file:line | Current | Target | Verdict |
|---|---|---|---|---|
| Collapse toggle | `index.html:1552` | `.gadget-rail-toggle` | `.ow-btn ow-btn-plain` (icon) | **TODO** |
| Rearrange (edit) | `index.html:1559` | `.gadget-rail-rearrange` (aria-pressed) | `.ow-btn ow-btn-plain` toggle | **TODO** |
| Swap sides | `index.html:1560` | `.gadget-rail-swap` | `.ow-btn ow-btn-plain` (icon) | **TODO** |
| Close drawer | `index.html:1561` | `.gadget-rail-close` | `.ow-btn ow-btn-plain` (icon) | **TODO** |
| Open drawer (mobile FAB) | `index.html:1569` | `.gadget-rail-open` | `.ow-btn ow-btn-plain` (icon) | **TODO** |
| Collapsed-strip per-gadget icons | `orwellGadgetRail.js:239-241` | `.grail-ico` | `.ow-btn ow-btn-plain` (icon) | **TODO** |
| Width resize handle | `orwellGadgetRail.js:748-757` | `.gadget-rail-resize-handle` (`role="slider"`, drag/keyboard grip) | — (drag grip, not `<input type=range>`) | **ACCEPTED-GAP** (poor `.ow-slider` fit) |

**Net for §3: 7 TODO** (1 kit-internal `og-act` fix + 6 rail-host icon buttons).

---

## 4. Confirm / prompt / ask-user dialog INNER controls — IN SCOPE

The dialog **windows** are kit (§0); their inner buttons/input are bespoke `.confirm-btn`.

| Surface | Element | file:line | Current | Target | Verdict |
|---|---|---|---|---|---|
| styledConfirm | cancel / ok buttons | `ui.js:543,547` | `.confirm-btn confirm-btn-secondary` / `-danger`/`-primary` | `.ow-btn` / `.ow-btn-destructive` / `.ow-btn-prominent` | **TODO** |
| styledConfirm/Prompt | footer/msg inline `style.cssText` | `ui.js:538,540,613,620` | inline styles | kit spacing classes | **TODO** (folds in) |
| styledPrompt | cancel / ok buttons | `ui.js:625,629` | `.confirm-btn confirm-btn-secondary`/`-primary` | `.ow-btn` / `.ow-btn-prominent` | **TODO** |
| styledPrompt | text input | `ui.js:615` | `.styled-prompt-input` | `.ow-input` | **TODO** |
| Chat "ask-user" card | close X + "other" send | `chat.js:3262` (`.modal-close ask-user-close`), `chat.js:3341` (`.confirm-btn confirm-btn-primary`) | legacy | `.ow-btn-plain` / `.ow-btn-prominent` | **TODO** (inline chat card, not a window) |

**Net for §4: ~4 TODO controls** (confirm buttons, prompt buttons, prompt input, ask-user buttons).

---

## 5. SETTINGS-window sub-panel controls — IN SCOPE (`settings` is keep-set)

The Settings window is kit, but most panel controls below the Account/Appearance/Theme-Customize slices
(#1634/#1635) are still legacy. These are player-visible (Settings is a kept feature).

### 5a. Toggle switches `.admin-switch` + `.admin-slider` → `.ow-switch`  (the exact pattern Appearance already migrated)
- **index.html (13):** `:491` (memory-in-context — *note: memory dropped, panel may be hidden*), `:581`
  (skills — *dropped*), `:628, :635, :654` (auto-*), `:1780` (Vision), `:1857` (In-Game Time), `:1930`
  (context-tiering), `:1940` (Image Generation), `:1962` (TTS), `:2332` (AI Synthesis), `:2365`
  (signup), `:2377` (new-user is-admin, wrapper `.admin-switch-inline`).
- **settings.js (6):** `:3462, :3467` (email STARTTLS / same-as-imap), `:4791, :4796, :4799` (user email
  form), `:5556` (codex scope — *dropped*).
- Also update the theme-var selector map `theme.js:2565-2566` (`adv-toggleBg`/`adv-toggleActive` point at
  `.admin-switch`).
- **~11 IN-SCOPE switches** (Vision/Time/Image/TTS/Synthesis/auto-*/signup/new-admin/email) + ~4 that ride
  dropped panels.

### 5b. Selects `.settings-select` (+ bare/inline `<select>`) → `.ow-select`
- **`.settings-select` (~33):** `index.html:1704,1708,1712,1728,1732,1745,1753,1768,1772,1785,1800,1806,1812,1866,1872,1878,1884,1906,1916,1945,1949,1967,1975,1984,1999,2300,2309,2321`; `settings.js:3454,3466,4795`.
  *(Caveat: `.settings-select` is reused as a class on numeric `<input>` fields `index.html:1824–1926` —
  co-styled; migrate the true `<select>`s.)*
- **Bare / inline `<select>`:** `index.html:1149` (model-select), `:2402,2450,2470,2474` (adm-ep*);
  `settings.js:1755,4231,4774,5442` (hidden mirror selects).

### 5c. Sliders `.preset-range` → `.ow-slider`
- `index.html:661` (skill-confidence — *skills dropped*), `:1485` (custom temperature), `:1495`
  (custom max-tokens). **~2 IN-SCOPE.**

### 5d. Segmented `.mode-toggle` / `.mode-toggle-btn` (Agent/Chat) → `.ow-segmented`/`.theme-seg`
- `index.html:1445` (wrapper), `:1446,1447` (buttons). **1 control (3 nodes).**

### 5e. Misc settings buttons
- Shortcut reset `.shortcut-action-btn` → `.ow-btn` (`index.html:2193`, `settings.js:2475`). **TODO.**
- Keycap `.shortcut-key` (`settings.js:2474`, rebind buttons) — **ACCEPTED-GAP candidate** (no keycap
  primitive; interactive `<button>` — owner ruling wanted).
- Color-picker per-row reset `.color-reset-btn` (~19: `index.html:743–789,928`) + `.theme-adv-clear-btn`
  `:796` → `.ow-btn-plain` **or ACCEPTED-GAP** (tiny per-row reset).
- Theme import/export residuals `.theme-io-btn` (`index.html:526,527,551` — memory/skills IO, *dropped*).

**Net for §5 (IN SCOPE): ~11 switches + ~36 selects + ~2 sliders + 1 segmented + ~1 shortcut-reset ≈ 51
TODO controls** (plus ~19 color-reset = ruling-dependent).

---

## 6. ADMIN panel controls (`admin.js`) + settings admin forms — IN SCOPE (admin-gated, lower visibility)

The admin panel + provider/endpoint/user-management forms are game-build reachable (settings/accounts
kept) but admin-gated, so lower user-visibility than §1–§5.

| Family | Target | file:line (representative; ~ counts) | Verdict |
|---|---|---|---|
| `.admin-btn-sm` / `.admin-btn-add` / `.admin-btn-delete` | `.ow-btn` / `.ow-btn-destructive` | **admin.js (~24):** `:75,76,77,78,534,535,539,1094,1096,1677-1680,2008,2027,2120,2180-2182,2440,2441,2769` · **settings.js (~65):** `:2772,2794,2815,2816,2838,3390-3392,3471,3476,3805,3806,4104,4115,4246,4382,4487-4511,4661-4674,4801-4814,4898,4902,5185-5190,5317,5385-5388,5451,5567,5568,5589,5596,5606,5611` · **index.html (11):** `:2008,2041,2178,2179,2412,2421,2424,2478,2479,2515,2566` | **TODO** (~110; nearly all also carry inline `style=`) |
| `.admin-switch` in admin.js | `.ow-switch` | `admin.js:96,1544,1567,2244` | **TODO** (4) |
| `.admin-tool-row` | kit row/card | `admin.js:1560` | **TODO** (1) |
| `.admin-danger-card` | kit card (already partly absorbed → `.osc-danger` `orwellSettingsCard.js:109`) | `index.html:2247,2652` | **TODO** (low; card mostly absorbed) |
| Provider picker `.adm-provider-btn` + `.adm-provider-menu` | `.ow-btn-secondary` + popover (§8) | `index.html:2026,2444` (btn); `:2030,2448` (menu) | **TODO** |
| Bare/inline admin `<select>` | `.ow-select` | `admin.js:533`; `index.html:2402,2450,2470,2474` | **TODO** |

**Net for §6: ~115+ TODO controls** (dominated by the ~110 `.admin-btn-*` family).

---

## 7. App chrome buttons — composer / topbar / sidebar / nav rail — IN SCOPE

Player-visible chrome. Many are icon buttons that map to `.ow-btn-plain`; some are candidates to stay as
their own nav pattern (owner call).

| Cluster | Elements (file:line) | Current | Target | Verdict |
|---|---|---|---|---|
| **Composer** | `.input-icon-btn` (`index.html:1356,1361,1386,1392,1398,1404,1410,1418,1424,1431,1437`), `.overflow-menu-item` `:1378` | bespoke icon buttons | `.ow-btn-plain` | **TODO** (11) |
| **Send** | `.send-btn` / `.send-btn-label` `index.html:1449,1450` | bespoke | `.ow-btn-prominent` (the canonical prominent CTA) | **TODO** |
| **Topbar** | `.topbar-rename-btn` `:1270`, `.model-picker-btn` `:1344`, `.model-chat-btn` `:1150`, `.user-bar-btn` `:1253,1256` | bespoke | `.ow-btn-plain` | **TODO** |
| **Sidebar / sections** | `.section-header-btn` `:1044,1051`, `.chats-manage-btn`/`.list-item-plus-btn` `:1113,1130,1214`, `.session-bulk-btn`(+`-danger`) `:1087-1089`, `.hamburger-btn` `:983`, `.section-collapse-btn` `section-management.js:10` | bespoke | `.ow-btn-plain` / `-destructive`; `.list-item` nav pattern may stay | **TODO** (~9) |
| **Left icon-rail** | `.icon-rail-btn` (~20) `index.html:994–1015` | bespoke nav icons | `.ow-btn-plain` **or ACCEPTED** (nav-rail pattern) | **TODO / ruling** |
| **Character/preset (in-chat)** | `.char-action-btn` `:1504,1510,1511`, `.char-expand-btn` `:1517`, `.preset-save-btn` `:1532`, `.compare-parallel-toggle` `:1526` | bespoke | `.ow-btn-secondary`/`-plain` | **TODO** (partly inherited) |
| **Misc close X** | `.close-btn` (`index.html:476,687,1466,1579,1605,1624`; `sessions.js:2797,3167`; `workspace.js:104`; `assistant.js:100`; `planWindow.js:24`) | bespoke | `.ow-btn-plain` **or ACCEPTED** (icon-close); many are on OUT-OF-SCOPE windows | **TODO / ruling** |
| **Onboarding tour** | `.tour-btn-arrow` / `.tour-btn-skip` (~44) `slashCommands.js` (game setup guide — `orwell-highlight`/`orwell-setup-guide` branded, IN SCOPE) | bespoke | `.ow-btn` / `.ow-btn-plain` **or ACCEPTED** (tour chrome) | **TODO / ruling** (~44) |
| **Login (auth page)** | `.pw-toggle` `login.html:445,459`, `.remember-check` `:451`, form inputs | bespoke | `.pw-toggle` = **ACCEPTED-GAP** (in-field reveal); inputs/checkbox = optional | mostly ACCEPTED (submit already `.ow-btn`) |

**Net for §7 (IN SCOPE, excluding ruling-dependent): ~24 TODO** + ruling clusters (icon-rail 20, close-X,
tour 44).

---

## 8. Menus / dropdowns / popovers — NO kit primitive exists (ruling needed)

There is currently **no kit menu-popover primitive**; these transient overlays live outside both the
window kit and the modal system, dismissed via `escMenuStack.js` (infra, not a surface). Migrating them
to the *window* kit would be wrong (they are not windows). Two honest options: (a) **ACCEPTED-GAP** for
the window/element kit as-is, or (b) a **separate future initiative** to add a shared menu-popover kit +
`.ow-btn-plain` menu items. Listed so nothing is missed:

| Surface | file:line | Current | Reachability |
|---|---|---|---|
| model-picker-menu | `index.html:1345` (filled `modelPicker.js:436+`) | `.model-picker-menu` | IN SCOPE |
| overflow-menu (composer) | `index.html:1367`, items `.overflow-menu-item` `:1368,1378` | bespoke | IN SCOPE |
| session-sort-dropdown | `index.html:1061`, `.dropdown-item` `:1062-1078` | `.dropdown sort-dropdown` | IN SCOPE |
| session-actions-dropdown | `index.html:1095` | `.dropdown` | IN SCOPE |
| model-sort-dropdown | `index.html:1137` | `.dropdown sort-dropdown` | IN SCOPE |
| Session row actions dropdown | `sessions.js:496`, items `:506-620` | `.dropdown session-dropdown-menu`, `.dropdown-item-compact` | IN SCOPE |
| Session **folder submenu** | `sessions.js:206` | `.dropdown session-folder-submenu` | IN SCOPE |
| Archive row dropdown | `sessions.js:2444` | `.dropdown session-dropdown-menu archive-dd` | IN SCOPE |
| search-provider-menu / adm-provider-menu | `index.html:2030` / `:2448` | `.adm-provider-menu` | IN SCOPE (admin) |
| Emoji picker | `emojiPicker.js:212` | `.emoji-picker` | IN SCOPE |
| Color picker | `colorPicker.js:99` | `.cp-popover` | IN SCOPE |
| Slash autocomplete | `slashAutocomplete.js:107` | `.slash-autocomplete-popup` | ACCEPTED-GAP (inline typeahead) |
| Message overflow / context popups | `chatRenderer.js:1496,1693` (`.msg-overflow-menu`), `:687,1807` (`.ctx-popup`), `:1885` (`.ctx-detail-popup`) | bespoke | IN SCOPE |
| **search-overlay / search-popup** | `index.html:2730` (`.search-overlay`) + `.search-popup` `:2731` (toggled `search-chat.js:14/28/186`) | bespoke overlay+popup | IN SCOPE — could be a **kit window** (the one true window candidate here) |

**Net for §8: ~14 popover surfaces (ruling-dependent).** One genuine window candidate:
**search-overlay** → could become a kit window.

---

## 9. Bespoke WINDOWS still to migrate → kit window

Split by reachability (the 2026-06-23 audit classified the inherited ones Class C — game-build-dropped).

### 9a. IN SCOPE — game-build reachable bespoke windows (TODO → kit window)
| Surface | file:line | Current | Notes |
|---|---|---|---|
| **rename-session-modal** | `index.html:1575` (`.modal`, `.modal-content` `:1576`, header/body) | legacy `.modal` (fixed `width:400px`) | history kept → reachable; small dialog → kit `modal:true`. *(Prior audit flagged "verify" — session rename is a kept flow.)* |
| **archive-modal** (session archive) | `sessions.js:3160-3169` (`id=archive-modal`, `.modal-content doclib-modal-content`) | legacy `.modal` | opened `openArchive()` `sessions.js:3156`; history-adjacent. |
| **vision-editor overlay** | `chatRenderer.js:340-346` (`.vision-editor-overlay` + `.vision-editor-panel`, own Esc `:334`) | bespoke custom overlay (own scrim/keydown) | opened from image-attachment OCR `chatRenderer.js:171`; vision is kept. → kit window (modal). |
| Static `#toast` element | `index.html:2738` (`.toast`) | **ORPHANED** — no JS references `#toast` (superseded by kit toast §0) | **cleanup:** dead markup, safe to delete. |

### 9b. OUT OF SCOPE — inherited-workspace bespoke windows (game-build-dropped; Class C)
Documented for completeness; **not** in the game kit backlog (migrate only if the full workspace build
becomes a target).
| Surface | file:line | Dropped by |
|---|---|---|
| memory-modal (Brain) | `index.html:472` | `memory` ∈ DROP_SET; `memory.js` stripped |
| cookbook-modal | `index.html:1601` | `cookbook` ∈ DROP_SET; `cookbook.js` stripped |
| custom-preset-modal (prompt editor) | `index.html:1462` | prompt-library / inherited chrome (`presets.js`, `group.js:154`) |
| library-modal (doclib) | `sessions.js:2790` | `documents` ∈ DROP_SET |
| Assistant settings | `assistant.js:90-102` | `companion` ∈ DROP_SET |
| Plan window | `planWindow.js:16-31` | plan mode — inherited |
| Workspace picker | `workspace.js:96-114` | workspace — inherited |
| Group overlay (model-group chat) | `group.js:327-347` | compare/group — inherited |

Their element families are likewise out of scope: `.memory-toolbar-btn`/`.memory-item-btn` (memory),
`.theme-io-btn` memory/skills IO, `.cal-btn` (assistant), `.plan-approve-btn` (planWindow), doclib
buttons — all ride dropped panels.

**Net for §9: 3 TODO windows (+1 dead-markup cleanup) IN SCOPE; 8 inherited windows OUT OF SCOPE.**

---

## 10. ACCEPTED-GAPS (no kit/Apple analog — do NOT migrate)

| Control | file:line | Why |
|---|---|---|
| Native `<input type="color">` | `index.html:743–789,805,927,928` (wired `colorPicker.js:447`, `theme.js:2622`) | native color well; no kit analog |
| `.theme-swatch` preset preview grid | `theme.js:1549,1605` (roving-tabindex listbox `:1360-1367`); host `#themeGrid`/`#themeUserGrid` `index.html:730,734` | theme-preview swatch grid; visual, not a button |
| `.pw-toggle` password reveal | `login.html:445,459` (def `:326-336`) | in-field reveal; no kit analog |
| Headshot image tiles `.hs-cand`/`.hs-libpick`/`.hs-libdel` | `orwellHeadshot.js:435,493` | image-thumbnail selection |
| House Status portrait tiles `.os-tile` | `orwellStatusPanel.js:645` | portrait chip; no clean kit analog |
| Cast portrait cards `.oc-hg`/`.oc-portrait` | `orwellCast.js:564,566` | portrait tile |
| Gadget-rail resize handle `.gadget-rail-resize-handle` | `orwellGadgetRail.js:748` | drag/keyboard grip, not `<input type=range>` |
| Season-progress overlays `#orwell-season-progress`/`-chip` | `orwellSeasonProgress.js:101,189` | `pointer-events:none` display overlays, non-interactive |
| **`.theme-seg`/`.theme-seg-btn`** | `index.html:711-717,863-877` | **this IS the kit segmented primitive** (the target for §5d), not a gap |

**Ruling-dependent (owner call — accept or migrate):** `.shortcut-key` keycaps, `.color-reset-btn`
per-row resets, `.icon-rail-btn` nav rail, `.close-btn` icon-close, `.tour-btn-*` tour chrome, all
menu/popover surfaces (§8).

---

## TODO counts per group (IN SCOPE)

| Group | Surface | TODO count | Notes |
|---|---|---|---|
| §1 | Cast-photo upload (headshot) | **0** functional (dual-class done) | optional `.hs-btn` fallback cleanup |
| §2 | Generated cast wall (`orwellCast.js`) | **1** | `.oc-backfill` → `.ow-btn` |
| §3 | Gadgets (internal + rail host) | **7** | 1 `og-act` kit-internal fix + 6 rail-host icon buttons |
| §4 | Confirm/prompt/ask-user inner controls | **~4** | `.confirm-btn` ×2 dialogs, prompt input, ask-user |
| §5 | Settings sub-panel controls | **~51** | ~11 switches + ~36 selects + ~2 sliders + 1 segmented + 1 shortcut-reset (+~19 color-reset ruling) |
| §6 | Admin panel + admin forms | **~115** | ~110 `.admin-btn-*` + 4 admin switches + tool-row + provider |
| §7 | App chrome (composer/topbar/sidebar) | **~24** | + ruling clusters: icon-rail 20, close-X, tour 44 |
| §8 | Menus / popovers | **~14 surfaces** | ruling-dependent (no kit menu primitive); search-overlay = window candidate |
| §9a | Bespoke reachable windows → kit | **3** (+1 dead-markup cleanup) | rename-session, archive, vision-editor |
| — | **OUT OF SCOPE (inherited)** | 8 windows + their element families | game-build-dropped; documented only |

**Headline IN-SCOPE backlog: ≈ 205 element migrations + 3 windows** (excluding ruling-dependent clusters
and OUT-OF-SCOPE inherited surfaces). The mass is §6 (admin, ~115) and §5 (settings, ~51).

---

## WAVE PLAN (per-PR migration-only lanes, ordered by user visibility)

Ordered per the owner's priority (cast-photo + generated-photos + gadgets first), then most-visible
player chrome, then settings, then admin. **Each lane = one window/surface, migration-only.**

> **File-overlap serialization.** Two shared files are touched by many lanes and MUST be serialized to
> avoid conflicts: **`frontend/static/index.html`** (lanes W2, W3, W5, W6, W9) and
> **`frontend/static/style.css`** (nearly every lane — deletes the retired bespoke rules). Land these
> lanes **one at a time, rebasing between**. Self-contained JS-only lanes (W1 partly, W4, W8) can run in
> parallel with the index.html/style.css chain. **The golden-path fixture is not affected** (these are
> pure CSS/class swaps, no prompt/tool-schema/casting-flow change) — but run the full FE pytest suite
> (`cd frontend && python3 -m pytest tests/`) each lane; the g15/reasoning/render convention gates and
> the keep-set-label gate can trip on class renames.

| Lane | Scope | Files | TODO | Overlap flag |
|---|---|---|---|---|
| **W1 — Cast wall + photo** | `.oc-backfill` → `.ow-btn`; (optional) drop `.hs-btn`/`.oc-pin` fallback classes | `orwellCast.js`, `orwellHeadshot.js`, `style.css` | 1 (+cleanup) | style.css |
| **W2 — Gadget action + rail chrome** | `og-act` → `.ow-btn-plain` (one kit fix migrates Cast-pin); rail-host `.gadget-rail-*` + `.grail-ico` icons → `.ow-btn-plain` | `orwellGadget.js`, `orwellGadgetRail.js`, `index.html`, `style.css` | 7 | **index.html, style.css** |
| **W3 — Composer + topbar + sidebar chrome** | `.send-btn`→`.ow-btn-prominent`; `.input-icon-btn`/`.topbar-*`/`.model-*`/`.section-*`/`.session-bulk-*`/`.hamburger-btn` → `.ow-btn-plain`/variants | `index.html`, `section-management.js`, `style.css` | ~24 | **index.html, style.css** |
| **W4 — Confirm/Prompt/ask-user inner controls** | `.confirm-btn*`→`.ow-btn*`; `.styled-prompt-input`→`.ow-input`; ask-user `.modal-close`/`.confirm-btn` | `ui.js`, `chat.js`, `style.css` | ~4 | style.css (JS-only otherwise — parallelizable) |
| **W5 — Settings switches** | `.admin-switch`/`.admin-slider` → `.ow-switch` (Vision/Time/Image/TTS/Synthesis/auto-*/signup/email) + `theme.js` selector-map | `index.html`, `settings.js`, `theme.js`, `style.css` | ~11 | **index.html, style.css** |
| **W6 — Settings selects + sliders + segmented** | `.settings-select`→`.ow-select`; `.preset-range`→`.ow-slider`; `.mode-toggle`→`.ow-segmented`; `.shortcut-action-btn`→`.ow-btn` | `index.html`, `settings.js`, `style.css` | ~40 | **index.html, style.css** |
| **W7 — Admin panel (admin.js)** | `.admin-btn-*`→`.ow-btn`/`-destructive`; `.admin-switch`→`.ow-switch`; `.admin-tool-row`/`.admin-danger-card`; `.adm-provider-btn` | `admin.js`, `style.css` | ~30 | style.css (admin.js self-contained — parallelizable with W-chain) |
| **W8 — Admin forms in settings.js** | `.admin-btn-*` (~65) in endpoint/email/user forms → `.ow-btn` | `settings.js`, `style.css` | ~65 | style.css (settings.js; serialize vs W5/W6 which also touch settings.js) |
| **W9 — Bespoke reachable windows → kit** | rename-session-modal, archive-modal, vision-editor → `OrwellWindowKit.create`; delete dead `#toast` markup | `index.html`, `sessions.js`, `chatRenderer.js`, `style.css` | 3 (+cleanup) | **index.html, style.css** |
| **W10 — (ruling first) Menus/popovers** | add a kit menu-popover primitive OR formally ACCEPT §8 as-is; then `.dropdown-item`/`.overflow-menu-item` → menu items; search-overlay → kit window | many | ~14 | **needs owner ruling before scoping** |
| **(deferred) Ruling clusters** | `.icon-rail-btn` (20), `.close-btn`, `.tour-btn-*` (44), `.color-reset-btn` (19), `.shortcut-key` — accept or migrate | index.html, slashCommands.js, style.css | ruling | owner call |
| **(out of scope) Inherited windows** | memory/cookbook/preset/library/assistant/plan/workspace/group + their element families | — | — | game-build-dropped; skip unless full workspace build |

**Recommended serialized order of the index.html/style.css chain:** W2 → W3 → W5 → W6 → W9 (rebasing
each). Run **W1, W4, W7** in parallel off to the side (W7 = admin.js self-contained; W4 = ui.js/chat.js;
W1 mostly JS). Sequence **W8 after W5/W6** (all three touch `settings.js`). Land **W10** only after the
menu-primitive ruling.

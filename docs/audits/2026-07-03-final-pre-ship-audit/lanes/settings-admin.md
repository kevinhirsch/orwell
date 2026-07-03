# SETTINGS & ADMIN WIRING — exhaustive re-audit (2026-07-03)

Redo of `docs/audits/2026-06-11-settings-wiring-audit.md`'s control × {wired, persisted,
applied} matrix against the CURRENT build (~3 weeks later; ADR 0016 GLM-4.7 switch, the
0079-0081 overseer/faithfulness dials, the 0057 reset-progress red zone, the 0052 house-theme
launch, and the Liquid Glass / OrwellWindow-kit settings-IA rework have all landed since).
Method: static trace only (no live runtime/ports assigned to this lane) — grep-then-narrow
across `frontend/static/js/{settings,admin,keyboard-shortcuts,theme}.js`, `frontend/static/index.html`,
`frontend/src/settings.py`, `frontend/src/{ai_interaction,tool_schemas,teacher_escalation}.py`,
`frontend/routes/{auth,admin_health,admin_wipe,session,chat_helpers}_routes.py`, and the engine's
`ORWELL_*` env-flag surface (`src/**`). Corroborated re-checks of the 2026-06-11 audit's F1-F6:
**F1 (keybinds never applied) and F3 (window-position reset misses kit keys) are FIXED** —
verified in code, not re-reported as new. F2, F5 are still open (carried forward below,
clearly marked). F4 has gotten *worse* (see SET-10).

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| SET-1 | Major | <1hr | High | `force_tool_choice_at_beats` kill-switch has zero UI anywhere | `frontend/src/settings.py:36-44`, `src/agent_loop.py:4200` |
| SET-2 | Minor | <1hr | Med | `overseer_debug` verbose-telemetry tier has zero UI anywhere | `frontend/src/settings.py:271-280` |
| SET-3 | Major | <1day | High | Ten opt-in "living house" engine flags are raw env vars with NO admin dial at any layer | `src/composition/orchestrator.ts` (multiple), `src/engine/{juryHouse,seededTieSurfacing,triggers,offscreen}.ts` |
| SET-4 | Blocker-adjacent (Major) | <1hr | High | The model's sanctioned `set_theme` lever cannot select the game's OWN house-identity themes | `frontend/src/ai_interaction.py:1472-1476`, `frontend/src/settings.py:405-412` |
| SET-5 | Minor | <1hr | Med | `set_theme` also advertises 6 fictional presets that don't exist and will always 400 | `frontend/src/ai_interaction.py:1354`, `frontend/src/tool_schemas.py:409` |
| SET-6 | Major | <1hr | High | No guardrail on settings that reproduce documented catastrophic regressions (reasoning=off / tiny max_tokens for Narration) | `frontend/static/index.html:1607-1611,1761-1771`, `frontend/src/settings.py:170-205` |
| SET-7 | Major | <1hr | High | The one Danger-Zone wipe surfaced under the game build ("Wipe chats") is missing the GAP-1 canonical-session unbind its sibling route already has, and is unscoped across every user | `frontend/routes/admin_wipe_routes.py:78-87` vs `frontend/routes/session_routes.py:608-638` |
| SET-8 | Minor | <1day | Med | The Token-Economy ledger/soft-alert backend has ZERO UI; the Settings modal's own copy tells the admin to read raw JSON at a bare API URL | `frontend/static/index.html:1757`, `frontend/routes/admin_health_routes.py:531-751` |
| SET-9 | Minor | <1hr | Med | Utility / Faithfulness / Default-Chat / Vision model selects have no exclude-filter for image-only models (inverse of the G21 fix) | `frontend/static/js/settings.js:590-690,736-756` |
| SET-10 | Minor | <1hr | Low | Teacher-escalation config (`teacher_model`/`teacher_enabled`) has been fully deleted from the Settings HTML — worse than the prior audit's single-orphan-toggle finding | `frontend/src/teacher_escalation.py:452,495`, `frontend/static/index.html` (no `teacher` string left) |
| SET-11 | Minor | <1hr | Low | Carried forward, still unfixed: search "Custom" result-count input still doesn't save on its own change | `frontend/static/js/settings.js:1307-1345` (2026-06-11 audit F2) |
| SET-12 | Low | <1hr | Low | Carried forward, still unfixed: 3-way keybind-default-table drift | `frontend/src/settings.py:322-330` vs `frontend/static/js/keyboard-shortcuts.js:7-13` vs `settings.js:2044+` (2026-06-11 audit F5) |
| SET-13 | Polish | <1hr | Low | Stale onboarding-wizard comments still cite the pre-ADR-0016 OOB defaults | `frontend/static/js/orwellOnboarding.js:7-8,260-262` |
| SET-14 | Polish | <1hr | Low | The narrator-reasoning hint text is hardcoded to GLM-4.7 regardless of which model is actually selected | `frontend/static/index.html:1611` |
| SET-15 | Minor | <1day | Med | God-Mode debug ops levers ("Regenerate cast portraits", "Fast-forward to finale") are confirm-gated but leave no visible audit trail in the admin UI beyond a transient status line | `frontend/routes/admin_health_routes.py:1449-1474` |
| SET-16 | Low | <1hr | Low | `reasoning_budget`/`max_tokens_budget` per-class dicts are POSTed as a full replacement object built from only 4 known classes — a 5th class added later (e.g. a future call class) silently has no UI path and reads as the JSON `DEFAULT_SETTINGS` value forever | `frontend/static/js/settings.js:847-946` |

---

## Findings

### SET-1 · Major · <1hr · High
**`force_tool_choice_at_beats` — the ADR 0016 §D forced-tool-choice kill-switch has zero UI**
- Where: `frontend/src/settings.py:36-44` (the DEFAULT_SETTINGS entry + its own comment: *"this is
  the runtime KILL-SWITCH so forcing can be disabled without a redeploy"*); consumed at
  `frontend/src/agent_loop.py:4200`. Grepped every `.js`/`.html` file for `force_tool_choice_at_beats`
  / `forceToolChoice` / `force-tool-choice` — zero hits anywhere in `static/`.
- Problem: this flag forces the engine's `tool_choice` at the closed-set beats where a missed call
  is catastrophic (a stalled ceremony/eviction, a comp winner never read) — i.e. it is the direct
  code-level mitigation for **C1** (the ~0% spontaneous tool-call rate that the whole ~12-guardrail
  belt system exists to paper over). Its sibling dials in the SAME feature family
  (`overseer_mode`, `faithfulness_mode`, `time_of_day_enabled`) all got a Settings-modal control
  (the "Runtime overseer" card, `index.html:1635-1655`) specifically so an operator could flip them
  live without a redeploy — but this one, despite its own comment calling it exactly that kind of
  dial, was never wired to anything. Today the ONLY way to turn it off (e.g. to test whether a
  narrator regression is belt-caused vs. model-caused) is hand-editing `data/settings.json` and
  restarting/waiting out the 2s settings cache.
- Fix: add one toggle to the "Runtime overseer" card (`index.html:1635`) — `Force tool_choice at
  critical beats` — following the exact `overseer_mode`/`faithfulness_mode` `initOverseerModes()`
  pattern in `settings.js:704-724` (same POST to `/api/auth/settings`, same admin-only gate).

### SET-2 · Minor · <1hr · Med
**`overseer_debug` — the verbose corrector-telemetry tier has zero UI**
- Where: `frontend/src/settings.py:271-280` (spellings `off`/`log`/`force`, resolved by
  `src.orwell_overseer_debug.overseer_debug_tier()`); consumed at `admin_health_routes.py:615-625`
  (feeds the debug bundle's `overseerDebug` section) and throughout `agent_loop.py` (3087-3230,
  6163-6190). Grepped every `.js`/`.html` for `overseer_debug`/`overseerDebug` — zero hits.
- Problem: this is the ONE lever an operator needs to actually diagnose C1 ("which guardrail fired,
  did the model even try the tool") — it sits right next to `overseer_mode`/`faithfulness_mode` in
  the settings key namespace and the SAME admin "Runtime overseer" card exists to host exactly this
  kind of dial, but the debug tier can only be set via `ORWELL_OVERSEER_DEBUG` env var or a hand
  edit of `settings.json`. During the 14-day ship window, an operator trying to root-cause a
  narrator tool-under-call bug has no discoverable way to turn this on without reading the source.
- Fix: add a 3-way select (off/log/force) to the "Runtime overseer" card, mirroring the
  `overseer_mode` select verbatim.

### SET-3 · Major · <1day · High
**Ten opt-in "living house" engine flags exist ONLY as raw process env vars — no admin dial exists
at ANY layer, not even `data/settings.json`**
- Where: `process.env.ORWELL_*` reads across the engine: `ORWELL_CAMPAIGNS`
  (`src/composition/orchestrator.ts:619`), `ORWELL_JURY_HOUSE` (`orchestrator.ts:626`,
  `src/engine/juryHouse.ts:28`, `liveSeason.ts:255,1306`), `ORWELL_TRIGGERS`
  (`orchestrator.ts:699`, `src/engine/triggers.ts:21`, `triggerConstants.ts:18`),
  `ORWELL_SECRET_PACING` (`orchestrator.ts:735`), `ORWELL_SEEDED_TIE_SURFACING`
  (`orchestrator.ts:757`, `seededTieSurfacing.ts`, `seededRelationshipConstants.ts:16`),
  `ORWELL_TRAJECTORIES` (`offscreen.ts:205`), `ORWELL_TIME_PER_CONVERSATION`
  (`orchestrator.ts:363`), `ORWELL_SOCIAL_FATIGUE`, `ORWELL_MULTI_NIGHT_FATIGUE`,
  `ORWELL_DISABLE_DIVERSITY` (`src/engine/diversity.ts`).
- Problem: per `docs/features/README.md`, these gate a large swath of the *shipped-but-dormant*
  behavioral-fidelity work (0059 tie-surfacing, 0091 house-event triggers, 0092 secret pacing, 0100
  jury grudge book, 0087 relationship trajectories, ADR 0006 phase-2 fatigue) — exactly the "house
  schemes without you" texture the vision brief (**I7**) calls priority #1. Every one of them is
  engine-boot-time only: there is no FE setting, no MCP admin lever, no `POST /api/auth/settings`
  key, nothing. Compare to `time_of_day_enabled` and `force_tool_choice_at_beats` (SET-1), which at
  least made it into `DEFAULT_SETTINGS` so the FE can push them onto the LIVE engine
  (`set_time_of_day`) with no restart — the pattern exists, it just wasn't extended to any of these
  ten. Today the ONLY way to try "does the deeper off-screen society feel better with jury-house
  grudges/tie-surfacing/secret-pacing on" is to edit the systemd unit's `Environment=` line and
  restart the whole engine process (losing the in-memory sandbox unless `ORWELL_STORE=sqlite`), for
  EVERY one of the ten. For a 14-day ship window this means the single most valuable knob for "does
  turning on more of the built-but-dormant social depth help or hurt" is operationally unreachable.
- Fix: at minimum, thread these through `data/settings.json` the same way `time_of_day_enabled` is
  threaded (FE reads the setting, calls a small new `GameSession` admin method that flips an
  engine-side runtime flag — most of these already read a boolean at call time inside
  `orchestrator.ts`, not just at process boot, so a live push is plausible for several of them
  without an engine restart). Even a read-only "Feature flags" admin panel showing the ten
  ORWELL_* env values as currently resolved (so the operator at least SEES what's on) would close
  most of the practical gap cheaply.

### SET-4 · Major (arguably Blocker-adjacent — a shipped, ruling-mandated feature is unreachable by its intended actor) · <1hr · High
**The model's sanctioned in-fiction `set_theme` lever cannot select the game's OWN house-identity
themes — the actual server-side validation whitelist is missing all 5 house themes AND `glass`**
- Where: `frontend/src/ai_interaction.py:1466-1491` (`do_ui_control`'s `set_theme` handler); the
  hardcoded `known_presets` list at lines 1472-1476 is:
  `["dark","light","midnight","paper","cyberpunk","retrowave","forest","ocean","ume","copper",
  "terminal","organs","lavender","gpt","claude","cute"]`. The FULL real theme catalog lives in
  `frontend/static/js/theme.js:27-58` (`THEMES`) and includes `glass` (the actual OOB
  **default** theme, line 27) plus the 5 house themes led by ruling #13/feature 0052 — `the-feed`,
  `telescreen`, `room-101`, `memory-wall`, `sequester` (lines 33-37, explicitly commented "the
  HOUSE themes lead the picker — the game's identity"). None of those 6 names appear ANYWHERE in
  `ai_interaction.py`, `tool_schemas.py`, or the game-only manifest string
  `GAME_UI_CONTROL_SECTION` (`frontend/src/settings.py:405-412`, which is what's actually injected
  into the narrator's system prompt under the game build). Grepped `the-feed|telescreen|room-101|
  memory-wall|sequester` across every `frontend/src/*.py` and `frontend/routes/*.py` — zero hits
  outside `theme.js`/`orwellHouseThemes.css`.
- Problem: `GAME_UI_CONTROL_SAFE_ACTIONS` (`settings.py:394-397`) explicitly sanctions
  `set_theme`/`create_theme` as "house look & feel (ruling #13 / feature 0052)" — i.e. this is the
  ONE lever the narrator is meant to pull for ambiance shifts (a Diary Room reveal, a twist
  announcement, a mood shift keyed to the week). If the model ever calls `set_theme the-feed` (a
  completely natural in-fiction request — "make it feel like we're being watched," "switch to the
  jury house vibe") or even just `set_theme glass` (the product's own default!), `do_ui_control`
  flatly rejects it: `{"error": "Unknown theme 'the-feed'. Available: ..."}` — none of the game's
  own signature palettes are reachable through its own sanctioned in-fiction control surface. A
  human player CAN pick these manually from the Settings/theme picker (client-side, `theme.js`
  never validates against the server list), so this is a pure model-lever bug, not a player-facing
  dead control — but it means feature 0052's flagship asset is invisible to the one actor
  (the narrator) the `ui_control` "camera direction" design says should be driving ambiance.
- Fix: replace the three independently-hand-maintained lists (`ai_interaction.py:1472-1476`,
  `settings.py:405-412`'s prose enumeration, and the debug-mode `tool_schemas.py:409` description —
  see SET-5) with ONE source of truth — export the theme-name list from `theme.js` as a small static
  JSON (or hand-maintain a single Python constant all three import), and add the 6 missing names.

### SET-5 · Minor · <1hr · Med
**`set_theme` also advertises 6 preset names that don't exist anywhere in the client and will
always be rejected — a second, independent instance of the same list-drift bug**
- Where: `frontend/src/ai_interaction.py:1354` (docstring: *"Apply a theme preset (dark, light,
  paper, nord, dracula, gruvbox, gpt, claude, lavender, etc.)"*) and
  `frontend/src/tool_schemas.py:409` (`set_theme (presets: dark, light, midnight, paper, nord,
  monokai, gruvbox, dracula, cyberpunk, retrowave, forest, ocean, ume, copper, terminal, vaporwave,
  lavender, gpt, coffee, claude)`) both list `nord`, `monokai`, `dracula`, `gruvbox`, `vaporwave`,
  `coffee` as valid `set_theme` presets. None of these six exist in `theme.js`'s `THEMES` map
  (SET-4's grep already confirms it), and none are in the `known_presets` validation whitelist
  that actually gates the call — so a model that reads either of these two descriptions and calls
  `set_theme nord` (this is the FULL-WORKSPACE / debug-build tool description; the game-build
  variant, `tool_schemas.py:1755-1794`, correctly omits a hardcoded name list) gets the exact same
  `{"error": "Unknown theme 'nord'..."}` rejection as SET-4, just from the opposite direction.
- Problem: this is not a game-build issue (the debug-mode `ORWELL_GAME_BUILD=0` path is what carries
  it), but it's the SAME root cause as SET-4 — three lists, none reconciled against the real
  catalog, none reconciled against each other. Left in place, any future drift (a theme renamed or
  removed in `theme.js`) creates a NEW instance of exactly this class of bug with no test catching
  it.
- Fix: same as SET-4 — one shared source of truth, referenced by all three call sites (plus the
  non-game `tool_schemas.py:409` description).

### SET-6 · Major · <1hr · High
**No guardrail on the settings that reproduce this project's own documented catastrophic
regressions — "reasoning off" for Narration, and sub-1000 `max_tokens` for Narration/Casting/
Background-authoring — are plain dropdown/number fields, identical in visual weight to every
other option**
- Where: `frontend/static/index.html:1607-1611` (`set-narratorReasoning`, options
  `default|off|low|medium|high`) and `:1761-1771` (the Token-Economy mirror,
  `set-reasoningNarration`); the per-class `max_tokens_budget` number inputs at
  `set-maxTokensNarration`/`set-maxTokensCasting`/`set-maxTokensAuthoring` (bounded only to
  `256..200000`, `settings.js:928-933`).
- Problem: this codebase's OWN commit history is the evidence. ADR 0016 (`docs/decisions/
  0016-llm-model-selection.md`) exists in large part because a reasoning-enabled model burned its
  entire output budget thinking and never produced a tool call ("the ~0% spontaneous tool-call
  rate is the scar" — C1); `src/settings.py:179-186`'s own comment on `background-authoring`
  documents a LIVE-CONFIRMED 0/15 cast-authoring failure from exactly this pattern (reasoning left
  on, JSON never emitted); PR `6fd0a7f6` fixed a *second* instance of the identical bug class by
  raising `max_tokens_budget.background-authoring` from 1200→3000 because a JSON profile plus even
  a little reasoning couldn't fit in 1200 tokens. Despite ALL of this documented history living in
  the very file that seeds these defaults, the UI offers `reasoning: off` for Narration as a
  same-weight sibling option next to `low`/`medium`/`high` (with only an italic hint sentence below,
  easy to miss), and accepts `max_tokens: 256` for Narration/Casting with only a numeric bound —
  nothing stops an operator from fat-fingering (or deliberately picking, to save cost) the exact
  configuration this project has twice already shipped fixes for.
- Fix: for Narration specifically, block (or `confirm()`-gate with the ADR 0016 rationale inline)
  selecting `reasoning: off` given the narrator is the one call class whose tool-calling MECHANISM
  depends on it per ADR 0016 (`"low" keeps the mechanism; "off" would strip it`); for
  `max_tokens_budget`, raise the effective floor for `narration`/`casting`/`background-authoring`
  above the historically-proven-unsafe range (e.g. 1500) rather than the generic global `256` floor,
  or add an inline warning when a value under ~1500 is entered for those three classes specifically.

### SET-7 · Major · <1hr · High
**The one Danger-Zone wipe surfaced under the game build ("Wipe chats") is missing the exact
canonical-session unbind its own sibling route already carries — and is unscoped across every
user**
- Where: `frontend/routes/admin_wipe_routes.py:71-87` (`DELETE /api/admin/wipe/chats`, the button
  behind `data-wipe-kind="chats"` at `index.html:2535` — per the 2026-06-11 audit, this is the
  ONLY wipe-kind still visible once the game build hides the other 7 Danger Zone rows) versus
  `frontend/routes/session_routes.py:608-638` (`DELETE /api/sessions/all`, which the wipe route's
  own module docstring at line 5-6 says it "mirrors").
- Problem: `session_routes.py:622-630` carries an explicit fix labeled **"GAP-1"**: after deleting
  every `Session`/`ChatMessage` row, it calls `orwell_game_session.clear_all_game_sessions()`,
  with a comment explaining exactly why — *"every canonical game-session binding now points at a
  deleted row... the whole sync layer... aims at a dead session that 404s forever — and
  convergence onto that phantom id can collapse a live window's DOM."* This is precisely the
  #1085 regression class CLAUDE.md documents under "Two regressions to never reintroduce." The
  `admin_wipe_routes.py:78-87` "chats" branch does the IDENTICAL delete (same two tables, same
  `session_manager.sessions.clear()`) but has NO call to `clear_all_game_sessions()` — so an
  admin who clicks the Settings → Danger Zone → "Wipe" button next to "Chats" (the one button
  actually reachable in the shipped game build) mid-season will silently reproduce #1085: the
  canonical game-session id still points at the now-deleted row, and the live two-window mirror
  is left subscribed to a dead channel. Additionally — like its sibling — the delete is completely
  unscoped: `db.query(DbSession).delete()` with no `.filter(DbSession.owner == ...)` even though
  `Session.owner` is an indexed column (`core/database.py:95`), so on a multi-user deployment
  (explicitly a first-class supported scenario per CLAUDE.md: "unlimited users concurrently, each
  fully isolated") one admin clicking THEIR OWN "wipe chats" button destroys every OTHER user's
  live game's session binding too — a concrete violation of the cross-user isolation guarantee
  the project treats as co-equal with the Vault Wall.
- Fix: one-line parity fix — call `orwell_game_session.clear_all_game_sessions()` (or, better,
  the per-user variant if one exists / can be added) from the `kind == "chats"` branch in
  `admin_wipe_routes.py`, and scope both the delete query and the game-session clear to the
  requesting admin's own `owner` unless a distinct "wipe EVERYONE" action is explicitly intended
  (in which case the button's confirm copy should say so).

### SET-8 · Minor · <1day · Med
**The fully-built Token-Economy ledger + soft spend-alert has literally zero presentational UI —
the Settings modal's own help text tells the admin to go read raw JSON at a bare API URL**
- Where: `frontend/static/index.html:1757` — the Token Economy card's own subtitle reads: *"Watch
  spend at `/api/admin/token-economy`."* — a bare, unlinked, monospace API path. The backend
  (`admin_health_routes.py:531-751`, `_token_economy()`) is a genuinely rich, well-designed,
  Vault-free view: recent ledger entries, per-session running cost totals + soft-alert trip state,
  an aggregate summary by call-kind, latest context-%. Grepped every `.js`/`.html` file for
  `token-economy`/`token_economy`/`tokenEconomy` — the ONLY consumer of the data-returning route is
  the route itself; nothing in `static/` ever fetches it.
- Problem: an admin can configure `token_spend_alert_usd` (a real, wired, persisted, applied
  setting — the threshold genuinely gates `check_soft_alert`), but has no way to ever SEE whether
  it tripped, what the running cost is, or where tokens are going by call-class, short of manually
  hitting a raw JSON endpoint in a second browser tab and reading it unformatted. For a
  self-hosted, cost-sensitive product whose entire ADR 0010/0069 investment is "meter and control
  spend," the control half shipped and the visibility half didn't.
- Fix: a minimal read-only card on the `/admin/status` page (which already has comparable live-data
  cards — Health, Transcripts) rendering `_token_economy()`'s existing shape: total spend this
  session, the soft-alert badge, a small table of the aggregate-by-kind summary. Reuses data
  already computed server-side; no new backend work.

### SET-9 · Minor · <1hr · Med
**Utility / Faithfulness / Default-Chat / Vision model selects have no exclude-filter for
image-only models — the inverse of the bug G21 already fixed for the Image select**
- Where: `frontend/static/js/settings.js:590-690` (`initUtilityModel`/`initFaithfulnessModel` —
  both call `_fillModelSelect(modelSel, ep.models, ...)` with the endpoint's FULL unfiltered model
  list) versus `:727-756` (`_isImageModel()` + the Image select's INCLUDE-filter, added specifically
  because *"H2 unified every flat model dropdown onto the chat pool but... left the Image select
  UNFILTERED — so a chat model... could be picked [and] 400s instantly"*).
- Problem: the fix only ran in one direction. `google/gemini-3.1-flash-image` — the product's own
  new OOB DEFAULT image model (`settings.py:69`, shipped in PR #1159) — sits in the exact same
  OpenRouter endpoint model pool that populates the Utility, Faithfulness, and Default-Chat
  dropdowns. Nothing stops an admin from picking it (or any other image-only model) for Utility or
  Faithfulness — both of which do plain chat-completion calls (background JSON authoring,
  narration-faithfulness judging) that an image-generation-only model cannot serve, so the pick
  silently degrades to the deterministic floor / a failed faithfulness judge with no diagnostic
  pointing back at the settings choice.
- Fix: add a symmetric EXCLUDE filter (`!_isImageModel(mid)`) to the Utility, Faithfulness,
  Default-Chat, and Vision-model `_fillModelSelect` calls, reusing the existing `_isImageModel()`
  helper (already data-driven, no hardcoded endpoint list).

### SET-10 · Minor · <1hr · Low
**Teacher-escalation config (`teacher_model`/`teacher_enabled`) has been fully deleted from the
Settings HTML — regressing PAST the prior audit's single-orphan-toggle finding**
- Where: the 2026-06-11 audit's F4 described a hidden-but-present "Teacher" card where H2b had
  wired the endpoint/model selects and left only the enable toggle (`set-teacherEnabledToggle`)
  orphaned. Grepping the current `frontend/static/index.html` for `teacher` returns ZERO matches —
  the entire card (endpoint select, model select, fallback widget, the enable toggle) is gone.
  `teacher_model`/`teacher_enabled` remain live `DEFAULT_SETTINGS` keys, are still read at runtime
  (`src/teacher_escalation.py:452,495`, `routes/skills_routes.py:1019`), and are still referenced
  as a settable alias in the general assistant's `manage_settings` tool description
  (`src/agent_loop.py:357`: *`"teacher model"→teacher_model`*).
- Problem: teacher-escalation is an agent-mode, self-hosted-model feature (student model fails →
  escalate to a teacher, learn a skill) that's plausibly irrelevant under the game build (agent
  mode is force-hidden mid-game per D7, and `skills` is in `GAME_DROP_SET`) — so its disappearance
  from the shipped game's Settings surface may be intentional fallout of the IA rework, not a
  fresh regression. But the settings keys are still alive in `DEFAULT_SETTINGS` and still consumed,
  so this is dead config with NO discoverable path to ever set it (not even the hidden-card path
  the prior audit found) other than a hand JSON edit or the general-assistant `manage_settings`
  tool — which is itself a dropped-workspace surface under the game build.
- Fix: pick one of the two options the prior audit's Wave S3 already proposed — either restore a
  (still hidden-under-game-build, like Research/TTS) card so the full-workspace/debug build keeps
  a real control, or delete `teacher_model`/`teacher_enabled` from `DEFAULT_SETTINGS` entirely and
  let `teacher_escalation.py` treat "unset" as "off." Given the card is now fully gone rather than
  half-wired, deletion is the lower-effort, more honest fix.

### SET-11 · Minor · <1hr · Low — carried forward, still unfixed since 2026-06-11
**Search "Custom" result-count input still doesn't save on its own change**
- Where: `frontend/static/js/settings.js:1307-1345` — `countCustomInput` (`set-
  searchResultCountCustom`) still has no own `change`/`input` listener; only `countSel`'s listener
  toggles its visibility/focus. Re-verified against the current file (line numbers shifted from the
  original F2 report but the code shape is unchanged): typing a custom count and blurring fires no
  request; the value only persists as a side effect of some OTHER search control's save firing
  afterward.
- Fix: unchanged from the original F2 fix spec — `countCustomInput.addEventListener('change',
  saveSearch)`.

### SET-12 · Low · <1hr · Low — carried forward, still unfixed since 2026-06-11
**3-way keybind-default-table drift persists**
- Where: `frontend/src/settings.py:322-330` (server default: `toggle_sidebar: "ctrl+b"`, still has
  `star_session`/`admin_panel` bound to nothing in the runtime keymap) vs. `frontend/static/js/
  keyboard-shortcuts.js:7-13` (`_defaultKeybinds`: `toggle_sidebar: "ctrl+alt+b"`) vs. `settings.js`'s
  own `SHORTCUT_DEFAULTS`/label tables (`:2044+`). The runtime consumer's merge (now correctly
  layering `/api/prefs/keybinds` on top per the F1 fix — see intro) papers over the drift for a
  saved user, but a brand-new profile with no saved keybinds still gets whichever table wins by
  import order, and the dead `star_session`/`admin_panel` entries still appear in the `/shortcuts`
  slash-popup with no handler behind them.
- Fix: unchanged from the original F5 fix spec — one server-served defaults table, both JS files
  consume it; prune or wire `admin_panel`/`star_session`.

### SET-13 · Polish · <1hr · Low
**Stale onboarding-wizard comments still cite the pre-ADR-0016 OOB defaults**
- Where: `frontend/static/js/orwellOnboarding.js:7-8` and `:260-262` — comments describe "the OOB
  defaults — deepseek-v4-pro narrator, gemini-2.5-flash-image portraits," both superseded by ADR
  0016 (`z-ai/glm-4.7` narrator) and PR #1159 (`gemini-3.1-flash-image` portraits). Confirmed these
  are comments only — the actual wizard renders the LIVE resolved `default_model`/`image_model`
  values, not a hardcoded string, so there is no player-facing bug, just documentation rot that
  will mislead the next engineer who reads this file expecting it to describe current behavior.
- Fix: update the two comment blocks to name the current defaults (or better, stop naming a
  specific model in the comment at all and just say "the configured OOB defaults, see
  `src/settings.py: DEFAULT_SETTINGS`").

### SET-14 · Polish · <1hr · Low
**The narrator-reasoning hint text is hardcoded to GLM-4.7 regardless of which model is actually
selected**
- Where: `frontend/static/index.html:1611` — *"Low suits GLM-4.7 (its interleaved thinking is what
  decides tool calls); off is cheapest but can skip a needed call. Same setting as Token Economy →
  Narration."* This sits directly under the Default-Chat-Model endpoint/model selects, so an
  operator who has swapped the Default Chat model to something else entirely (any of the other
  configured endpoints/models) still reads GLM-4.7-specific reasoning advice that may not apply to
  their actual choice.
- Fix: either generalize the copy ("Low reasoning lets a tool-calling-via-thinking model like
  GLM-4.7 decide which tool to call; check your model's own guidance if you've switched away from
  the OOB default") or make it model-aware (only show the GLM-4.7-specific clause when the selected
  model id matches).

### SET-15 · Minor · <1day · Med
**God-Mode debug ops levers ("Regenerate cast portraits", "Fast-forward to finale") leave no
persistent audit trail in the admin UI beyond a transient status line**
- Where: `frontend/routes/admin_health_routes.py:1449-1474` — both `regenPortraits()` and
  `fastForwardFinale()` are confirm-gated (good) and DO log server-side
  (`logger.info`/`logger.warning`), but the ONLY player/admin-visible feedback is `opsMsg.textContent`
  — a single-line status that's overwritten by the next action and lost on page reload. There is no
  "last ops action" history anywhere on `/admin/status` (contrast with the Transcripts /
  Health-snapshot cards, which persist and are re-fetchable).
- Problem: "Fast-forward to finale" is an explicitly DESTRUCTIVE-to-the-narrative action (it can
  make the player lose, per its own confirm copy) fired from the same page as ordinary health
  monitoring; if an admin fires it, gets distracted, and comes back to a finished season, there is
  no record on the page itself of WHAT was done or WHEN — only the FE game state having silently
  jumped. For a debug lever this powerful, that's thin.
- Fix: append each ops-lever invocation (kind, timestamp, actor) to the existing recent-logs ring
  the debug bundle already surfaces (`_recent_logs()`), and render the last few ops actions inline
  under the Danger Zone / ops button row.

### SET-16 · Low · <1hr · Low
**`reasoning_budget`/`max_tokens_budget` are POSTed as a full-replacement dict built from exactly
4 hardcoded classes — a future 5th call class has no UI path**
- Where: `frontend/static/js/settings.js:847-946` — `reasoningEls`/`maxTokensEls` are fixed 4-tuples
  (`narration`, `utility-extraction`, `casting`, `background-authoring`); `saveReasoning()`/
  `saveMaxTokens()` rebuild the WHOLE dict from only those 4 elements every time. `token_policy.
  CALL_CLASSES` is described in the settings.py comments as the actual valid-class source of truth,
  implying it can grow independently of this hardcoded 4-tuple.
- Problem: not a bug today (both lists agree), but it's a silent trap: if `token_policy.CALL_CLASSES`
  ever gains a 5th class (a very plausible future addition — e.g. a `faithfulness` reasoning class
  to pair with the new 0081 faithfulness-judge model, which currently has NO reasoning/max_tokens
  control of its own at all — see the "Faithfulness judge model" card, `index.html:1656-1671`, which
  has endpoint/model/fallback but no reasoning-budget row), the new class's default would be
  set once in `DEFAULT_SETTINGS` and then be COMPLETELY UNREACHABLE from the UI (any save from this
  card would silently omit it, but wouldn't clobber it either since `POST /api/auth/settings` merges
  at the top level — so it's an ORPHAN-KEY-in-waiting, not an active bug).
- Fix: when a `faithfulness` reasoning/max_tokens class is eventually needed (it may already be —
  the faithfulness JUDGE call itself is presumably one of the existing classes or falls through to
  utility/chat defaults, which is itself worth confirming), derive the settings.js element list from
  a shared class registry instead of a hand-maintained 4-tuple.

---

## Coverage / where I looked

Read/grepped exhaustively: `frontend/src/settings.py` (full file, all of `DEFAULT_SETTINGS` +
`DEFAULT_FEATURES` + the game-build gating helpers), `frontend/static/js/settings.js` (targeted
reads across ~2000 of its 5796 lines: AI defaults, token economy, overseer/faithfulness dials,
appearance/window-reset, shortcuts, search, teacher/research/TTS hidden cards), `frontend/static/
js/admin.js` (login-background cosmetic card, ops levers), `frontend/static/js/keyboard-
shortcuts.js` (full runtime keymap-load path), `frontend/static/js/theme.js` (the full `THEMES`
catalog + custom-theme sync, first ~1050 of 3075 lines — did NOT read the rest, which is font/
pattern rendering internals with no settings-wiring surface), `frontend/static/index.html` (grepped
the whole settings-modal DOM for every card/control id), `frontend/routes/{auth,admin_health,
admin_wipe,session,chat_helpers}_routes.py`, `frontend/src/{ai_interaction,tool_schemas,
teacher_escalation}.py`, and the engine's full `ORWELL_*` env-flag surface (`grep -rl` across
`src/`). Cross-checked `docs/decisions/0016*`, `docs/features/README.md` (0075-0107 status rows),
and `git log` since 2026-06-11 on every settings/admin file to separate "still open" from "landed
since." Did NOT: run the live app (no ports assigned to this lane — static trace only, unlike the
2026-06-11 audit's 17 runtime-confirmed cells); read `style.css`/`chat.js` end-to-end (per the
charter's own frugality rule); audit the Users/Tools/Account tabs in depth beyond confirming no
regression since the 2026-06-11 full RT pass (their code shape is unchanged); deep-read
`orwellSlots.js`/`orwellWindow.js`/`modalManager.js` internals (window-position mechanics) since
SET-nothing was found there (F3 already confirmed fixed by inspection of the reset handler alone).

I did not run out of real issues in this territory — the ten-flag dark-feature gap (SET-3) and the
theme-lever gap (SET-4/5) in particular suggest a further pass specifically on "every ORWELL_* env
flag vs. every place a live season reads `process.env`" would likely surface more of the same
class, and I did not exhaustively cross-check every `tool_schemas.py` function description against
its actual dispatcher validation logic beyond `ui_control` (the pattern that produced SET-4/5 may
recur elsewhere, e.g. `switch_model`'s advertised model list vs. actual endpoint availability).

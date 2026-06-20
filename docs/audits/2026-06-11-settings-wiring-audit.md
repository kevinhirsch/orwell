# 2026-06-11 — Settings-wiring audit: every control × {wired, persisted, applied}

> 📋 **Audit record** · 2026-06-11 · Settings wiring × {wired, persisted, applied} (DOC-ONLY) · **Status:** Historical record

**Commission (verbatim).** *"Can we make sure every piece of the settings menu is wired to
something that actually gets changed?"* — i.e. every control in the Settings modal must map to
a real setting that is BOTH persisted AND read/applied. No dead UI (a control that saves
nothing), no dead settings (a saved key never read), no inert toggles (a handler that changes
nothing).

**Scope.** Every interactive control in the Settings modal (`frontend/static/index.html:1320–2202`),
all thirteen tabs — services, ai, search, integrations, email, reminders, appearance, shortcuts,
account, tools, users, system — plus the modal chrome and every dynamically-rendered control
(fallback rows, endpoint rows, user rows, tool toggles, 2FA flow, shortcut rebinds). Each
control gets three verdict links: **(a) WIRED** — a JS handler reads the control and sends it
(`settings.js` / `admin.js` / `app.js` file:line); **(b) PERSISTED** — the value lands in a real
store (`POST /api/auth/settings` → the `DEFAULT_SETTINGS` allowlist, `src/settings.py:32–176` +
`routes/auth_routes.py:461–488`; `PUT /api/prefs/{key}` per-user, `routes/prefs_routes.py:82`;
a dedicated route; or localStorage for client-side preferences); **(c) APPLIED** — the key is
consumed somewhere real (`get_setting`/`get_user_setting` server-side, or a live JS consumer).
DOC ONLY — no production code rides with this audit.

**Method** (the house audit pattern — `2026-06-11-dwe-window-audit.md` /
`2026-06-11-refresh-persistence-audit.md`). Full static trace of every control id through
`settings.js` (5,293 lines post-merge), `admin.js` (2,471 lines), `app.js`, `keyboard-shortcuts.js`,
`censor.js`, and the Python tier (`src/settings.py`, `routes/{auth,prefs,model,admin_wipe,
admin_transcript,admin_health,backup}_routes.py`, consumers in `src/` + `services/`), **plus
runtime confirmation** of 17 sampled cells against the REAL app: uvicorn from `frontend/`
(`ORWELL_GAME_BUILD=1`, **`AUTH_ENABLED=true`** — a real first-run admin + a created non-admin,
FE port 8968) over the real built engine (port 8868), Playwright headless chromium with network
capture (does the change actually serialize?). Each matrix row marked **[RT]** was confirmed
live (the captured POST/PUT payload + a server round-trip); unmarked rows are static trace.
Harness scratch in `/tmp/swa/` (not shipped); results `/tmp/swa/results.json`; the one
visually-demonstrable defect is screenshotted in `./2026-06-11-settings-wiring-audit-assets/`.

**Known in-flight — all three LANDED mid-audit** (PRs #266 G13, #267 H2b, #268 G16 merged to
main while this audit ran; the audit was re-based onto the merged tree `ca8ec16` and every
affected row re-verified statically — the runtime cells ran pre-merge, and the two files
carrying the runtime-pinned defects, `keyboard-shortcuts.js` and the `initSearchSettings`
block, are byte-identical/position-shifted-only across the merge):
**H2b** wired the research-model select and the teacher endpoint+model selects to the shared
model pool (re-verdicted below — one teacher control remains unwired); **G13** shipped the
gating cascades (shortcuts rows for unshipped verticals hide, all-admin-card tab launchers
hide for players, zombie menu triggers cascade); **G16** shipped the refresh-audit F1/F2 fixes
(HUD collapse key, parked-means-parked — introducing new `orwell-win-parked:*` keys that
feed this audit's F3); the Appearance Theme card was already removed (**H3**, PR #265 —
verified gone: the appearance panel carries no theme card; the theme picker's one home is the
sidebar entry).

**The save-path topology (read this first).** There are exactly four persistence paths out of
the modal, and the verdicts hang off them:

1. **`POST /api/auth/settings`** — global, **admin-only** (403 otherwise,
   `auth_routes.py:461–466`), key-allowlisted to `DEFAULT_SETTINGS` (`auth_routes.py:475` —
   unknown keys are silently dropped), int-clamped for the agent knobs. Per the 2026-06-09
   ruling #1, LLM/search config is global-by-design and its tabs are `.admin-only`.
2. **`PUT /api/prefs/{key}`** — per-user, open key space (`prefs_routes.py:82–88`); the
   per-user read seam is `get_user_setting` over the `_PER_USER_KEYS` whitelist
   (`src/settings.py:441–473`).
3. **Dedicated routes** — accounts/2FA (`/api/auth/*`), endpoints (`/api/model-endpoints*`),
   tools (`/api/tools`), users/privileges (`/api/auth/users*`), wipes (`/api/admin/wipe/*`),
   transcripts/health/backup.
4. **localStorage** — the appearance/privacy toggles (`orwell-ui-visibility`,
   `orwell-sensitive-blur`) and window-position keys. Per-browser by design; note the
   account-tab logout deliberately wipes them (`settings.js:2195–2204`, the cross-account
   leakage guard).

---

## 1. The control × {wired, persisted, applied} matrix

Verdict legend: ✅ **LIVE** (wired + persisted + applied) · 🟠 **DEAD-UI** (no save handler) ·
🔴 **DEAD-SETTING** (saved, never read by its runtime consumer) · ⚪ **INERT** (handler changes
nothing) · 🟣 **ORPHAN-KEY** (read but no UI) · **ACTION** (does work, not a setting — argued
per row) · **N/A-dropped** (control inside a dropped vertical: tab CSS-hidden under the game
build *and* its init skipped — `settings.js:2232–2238` — so nothing binds) ·
**N/A-hidden** (card kept in DOM but `hidden style="display:none"`). **[RT]** = runtime-confirmed.

### Modal chrome

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Peek (`#settings-opacity-wrap`) | `settings.js:155` (`initOpacityToggle`) | ephemeral by design | fades the modal live (appearance tab only) | ACTION ✅ |
| Close (`.close-btn`) / Esc / backdrop | `settings.js:86–109` | n/a | closes; Esc closes inner form first | ACTION ✅ |
| Drag header (+ geometry) | `settings.js:47` → `windowDrag` | `winsize-*`/`winpos-*` localStorage | restored on open | ✅ (per refresh-audit M18) |

### services — Add Models (admin-only tab)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Local: URL / type / API key (`adm-epLocal{Url,Type,ApiKey}`) | read by add/test (`admin.js:1091+`) | endpoint store via `POST /api/model-endpoints` | every model dropdown + chat resolution (`src/endpoint_resolver.py`) | ✅ |
| Local Test (`adm-epLocalTestBtn`) | `admin.js` → `POST /api/model-endpoints/test` | n/a | structured online/offline result **[RT]** (bogus URL → `status:'offline'`, not 404) | ACTION ✅ |
| Local Add (`adm-epLocalAddBtn`) | `POST /api/model-endpoints` | endpoint store | models usable in chat/AI tab | ✅ |
| Scan for Servers (`adm-epDiscoverBtn`) | `admin.js:1150` → `GET /api/discover` | n/a | route exists (`model_routes.py:1412`) | ACTION ✅ |
| Ollama (`adm-epOllamaBtn`) | `admin.js:1133` (prefills the URL field from `/api/runtime`) | n/a | helper prefill | ACTION ✅ |
| API: provider picker (`adm-provider-btn/-menu`) + hidden `adm-epProvider` | mirror pattern (`admin.js:782–800`) | — (feeds the add) | — | ✅ |
| API: URL / key / kind / type (`adm-epUrl,ApiKey,Kind,Type`) | read on add/test (`admin.js:937+`) | endpoint store | as above | ✅ |
| API Test / Cancel / Add | `admin.js:890–963` | endpoint store | as above | ACTION ✅ |
| Section collapsibles (Local/API/Quickstart) | `admin.js` toggle handlers | ephemeral | UI state | ACTION ✅ |
| Dynamic endpoint rows: Enable/Disable (`data-adm-toggle-ep`), Delete (`data-adm-del-ep`), Tools mode (`data-adm-tools-select` → `supports_tools`), per-model enable panel, copy-URL | `admin.js:527–545+`, `_saveEpModelState` (`admin.js:722`) | `PATCH/DELETE /api/model-endpoints/{id}` | model availability + native-tool-calling mode at dispatch | ✅ |

### ai — AI Defaults (admin-only tab)

| Control | Wired? | Persisted (key) | Applied? | Verdict |
|---|---|---|---|---|
| Default chat Endpoint/Model (`set-defaultEpSelect`,`set-defaultModelSelect`) | `settings.js:496–513` | `default_endpoint_id`,`default_model` (global; per-user override via prefs seam) | `endpoint_resolver.py:236–245`, `llm_core` | ✅ (empty-options state with zero endpoints, recorded **[RT]**) |
| + Add fallback + fallback rows (`set-defaultAddFallback`,`set-defaultFallbacks`) | `settings.js:427–519` | `default_model_fallbacks` | `endpoint_resolver.py:338` | ✅ |
| Utility Endpoint/Model + fallbacks (`set-utility*`) | `settings.js:567–589` | `utility_endpoint_id`,`utility_model`,`utility_model_fallbacks` | `endpoint_resolver.py:242–243,342–351` | ✅ |
| Vision enable (`set-visionEnabledToggle`) | `settings.js:772–780` | `vision_enabled` | `chat_handler.py:177` | ✅ **[RT]** |
| Vision model (`set-vlModelSelect`) + fallbacks (`set-visionAddFallback`) | `settings.js:772–786` | `vision_model`,`vision_model_fallbacks` | `chat_handler.py:222`, `endpoint_resolver.py:355–356` | ✅ |
| Research card — Endpoint/Model/Search/MaxTokens/timeouts (`set-research{Endpoint,Model,Search,MaxTokens,ExtractTimeout,ExtractConcurrency,RunTimeout}`) | `settings.js:1398–1514` (init runs even though hidden; the Model select is **wired since H2b** — endpoint-scoped pool + `saveResearch` posts it) | `research_*` keys incl. `research_model` | `src/deep_research.py` etc. — **vertical dropped under the game build** | N/A-hidden (card `hidden`, `index.html:1447`; debug build: LIVE) **[RT: card display:none]** |
| Agent: tool-call limit / max steps (`set-agentMaxTools`,`set-agentMaxRounds`) | `settings.js:1581–1600` (client clamp mirrors server) | `agent_max_tool_calls`,`agent_max_rounds` (server-clamped, `auth_routes.py:471–474`) | `chat_routes.py:1152,1156` | ✅ **[RT]** |
| Image gen enable/model/quality (`set-img{EnabledToggle,ModelSelect,QualitySelect}`) | `settings.js:706–716` | `image_gen_enabled`,`image_model`,`image_quality` | `agent_loop.py:1095`, `chat_routes.py:980`, **`orwell_portraits.py:210–212`** (per-user, the 0051 cast portraits) | ✅ **[RT]** |
| TTS card (provider/model/voice/speed/preview/enable — `set-tts*`) | `settings.js:792–964` | `tts_*` keys | `services/tts` — voice routes unmounted (voice flag off) | N/A-hidden (card `hidden`, `index.html:1531` — read-aloud opted out) **[RT: display:none]** |
| Teacher Endpoint/Model selects (`set-teacherEpSelect`,`set-teacherModelSelect`) | **wired since H2b** — `initTeacherModel` (`settings.js:593–671`; endpoint scopes the pool, the endpoint NAME rides inside the saved spec) | `teacher_model` ("model@endpointName") | `teacher_escalation.py:381`, `ai_interaction.py:214` | N/A-hidden (card `hidden`, `index.html:1585`; debug build: LIVE) |
| Teacher **enable** toggle (`set-teacherEnabledToggle`) | **NO JS reference anywhere** (H2b consciously left it: "the toggle's feature stays off") | — | `teacher_enabled` read at `teacher_escalation.py:452,495` — can only ever become true by hand-editing `data/settings.json` | 🟠 DEAD-UI (hidden) + 🟣 ORPHAN-KEY — see F4 |

### search — Web Search (admin-only tab; mounted under the game build per C32)

| Control | Wired? | Persisted (key) | Applied? | Verdict |
|---|---|---|---|---|
| Provider picker (`search-provider-btn/-menu`) + hidden `set-searchProvider` | `settings.js:1199,1231–1249` | `search_provider` | `services/search/core.py:66,139,268` (the in-fiction `web_search` tool path) | ✅ **[RT]** (POST serialized `search_provider:"duckduckgo"`, round-tripped) |
| Results count (`set-searchResultCount`) | `settings.js:1200` | `search_result_count` | `core.py` result slicing | ✅ **[RT]** |
| **Custom count** (`set-searchResultCountCustom`) | **no own change listener** — only read when *another* control fires `saveSearch` (`settings.js:1164–1177`) | only indirectly | — | 🟠 DEAD-UI (partial) **[RT]** — see F2 |
| URL (`set-searchUrl`) | `settings.js:1201` | `search_url` | searxng provider | ✅ |
| API key (`set-searchApiKey`) | `settings.js:1202` | per-provider: `brave_api_key`/`google_pse_key`/`tavily_api_key`/`serper_api_key` (`settings.js:1069–1072,1184–1188`) | `services/search/providers.py` | ✅ |
| CX ID (`set-searchCx`) | `settings.js:1203` | `google_pse_cx` | Google PSE provider | ✅ |
| Fallback chain (chips + add + drag-reorder, `set-searchFallbackChain`) | `settings.js:1264–1338` | `search_fallback_chain` | `core.py` provider chain (`_build_provider_chain`) | ✅ |
| Test (`set-searchTestBtn`) | `settings.js:1343` → `POST /api/search/query` | n/a | **route mounted under the game build** — 200 with live results **[RT]** (the 2026-06-09 S2 dead-tab finding is fixed by C32) | ACTION ✅ |

### appearance (all users; localStorage by design)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| 8 sidebar toggles (`data-ui-key`: sidebar-brand, sidebar-search, sidebar-new-chat, sessions-section, models-section, tool-theme, user-bar, sidebar-settings-btn) | `settings.js:1614–1653` | `orwell-ui-visibility` localStorage | `applyUIVis` (`app.js:2516`) — every target selector verified present in `index.html` | ✅ **[RT]** (models-section: hidden→visible + key written) |
| sidebar-settings-btn extra guard | confirm dialog + `/settings` hint (`settings.js:1629–1646`) | same | same | ✅ |
| Chat area: chat-meta, welcome-text, text-emojis, show-thinking | same handler | same | `applyUIVis` + `applyTextEmojis` + `hide-thinking` body class (`app.js:2531–2537`) | ✅ **[RT]** (hide-thinking class flips) |
| Sensitive Blur (`data-privacy-key="sensitive-blur"`) | `settings.js:1655–1663` | `orwell-sensitive-blur` localStorage | `censor.js:10,47` (live event listener) | ✅ **[RT]** |
| Chat bar: overflow-plus-btn, attach-btn | same handler | same | targets present | ✅ |
| Chat bar: mode-toggle | same handler | same | target force-hidden **while a game is active** (`game-trim.css:78`, D7) — the toggle changes nothing visible mid-game, works pre-game/debug | ✅ with caveat (recorded, by-design D7 — not a finding) |
| ↩ Reset window positions (`reset-window-positions-btn`) | `settings.js:1675–1705` | clears `orwell-status-pos/min`, `orwell-social-pos/min`, `winpos-*`, `winsize-*`, `modal-pos-*` | **misses `orwell-slot-offset:*`** (the key the slot/kit system persists drags under, `orwellSlots.js:28,38`) **and the G16 `orwell-win-parked:*` keys** (`orwellWindow.js:133–142`) | ⚪ INERT for kit windows — see F3 |
| Reset All (`set-uiVisResetBtn`) | `settings.js:1665–1673` | removes `orwell-ui-visibility` | re-syncs + re-applies | ACTION ✅ |

### shortcuts (all users)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Per-action rebind buttons + confirm/reset (dynamic, `#shortcuts-list`) | `settings.js:1898–1996` | `PUT /api/prefs/keybinds` per-user — 200 **[RT]** (C30: the old admin-only 403 path is fixed) | **BROKEN**: the runtime keymap loader reads ONLY `/api/auth/settings` `keybinds` (`keyboard-shortcuts.js:56–58`) and never `/api/prefs/keybinds` — a saved rebind works until reload, then silently reverts while the tab still *displays* it as saved | 🔴 DEAD-SETTING — **F1, MAJOR** **[RT]** |
| Reset Shortcuts (`shortcuts-reset-btn`) | `settings.js:2019–2026` | same path | same gap rides | ACTION ✅ (same F1 caveat) |
| (G13, landed mid-audit) rows for unshipped verticals — the TTS rebind when voice JS is unshipped | `SHORTCUT_REQUIRES`/`_shortcutShipped` (`settings.js:1780–1791,1865`) hide the row + empty category headers | n/a | prevents binding a shortcut that can do nothing here | recorded ✅ (kills a would-be INERT row) |

### account (all users)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Logout (`settings-logout-btn`) | `settings.js:2182–2206` | n/a (revokes session; wipes client state by design) | redirect to /login | ACTION ✅ |
| Change password (3 inputs + `settings-pw-save`) | `settings.js:2051–2081` | `POST /api/auth/change-password` | honest server errors **[RT]** ("Current password is incorrect") | ACTION ✅ |
| 2FA flow (dynamic: setup/verify/disable/cancel/done + code inputs) | `settings.js:2085–2178` | `/api/auth/2fa/{status,setup,confirm,disable}` | login gate | ACTION ✅ |

### email · reminders · integrations (dropped verticals — tabs CSS-hidden, `game-trim.css:59–63`; init skipped under the game build, `settings.js:2232–2238`)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| email: Manage in Integrations, Open Tasks, Writing Style textarea + Extract + Save | handlers exist (`settings.js:2884+`) but **never bound** under the game build | `/api/email/style` etc. — routers 404 (email dropped) | email vertical dropped | N/A-dropped (C31/S3 gating; G13's cascades reinforce) **[RT: tabs display:none]** |
| reminders: channel select + email-from/to + ntfy topic + webhook intg/template + AI-synthesis toggle + Public-App-URL + Send Test + Integrations link | handlers exist (`settings.js:2248–2667`) but never bound under the game build | `reminder_*`, `app_public_url` ∈ `DEFAULT_SETTINGS` (saves would land); test → `/api/notes/fire-reminder` 404 | consumers are the dropped notes/email verticals (`builtin_actions.py:1870`, `email_pollers.py:771`) | N/A-dropped (C31/S3) |
| integrations: + Add Integration (`unified-intg-add-btn`) + dynamic form | `initUnifiedIntegrations` skipped under the game build; the legacy `initIntegrations` admin.js calls targets ids that no longer exist and bails (`settings.js:3042–3046`) | `/api/auth/integrations` CRUD (note: these REMAIN mounted — auth router — admin-gated) | integrations consumers dropped | N/A-dropped (C31/S3) |

### tools — Agent Tools (admin-only tab)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| 52 per-tool toggles + per-category toggles (dynamic) | `admin.js:1512–1559` | `POST /api/tools` → `disabled_tools` + enabled-optional (`model_routes.py:2168–2173`) — round-trip **[RT]** | `chat_routes.py:675–716` (privilege/game-build merge into the live tool set) + agent prompt assembly | ✅ **[RT]** |
| Category expand headers | `admin.js:1492–1504` | ephemeral | UI state | ACTION ✅ |

### users (admin-only tab)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Open signup (`adm-signupToggle`) | `admin.js:317–330` | `POST /api/auth/signup-toggle` **[RT]** | signup gate (`auth_routes.py:108`) | ✅ **[RT]** |
| Per-user rows: Make/Revoke admin, Reset password, Rename, Remove (dynamic) | `admin.js:153–248` | `/api/auth/users/*` (role/password/rename/DELETE) | auth manager; last-admin guard server-side | ACTION ✅ |
| Privilege toggles (7 `data-priv` switches) + Daily message limit | `admin.js:132–150` | `PUT /api/auth/users/{u}/privileges` | `chat_routes.py:675–706` (privileges → disabled tools), `chat_helpers.py:443–469` (`max_messages_per_day` cap) | ✅ |
| Allowed models checkboxes + All/None | `admin.js:283–311` | same privileges PUT (`allowed_models`, `allowed_models_restricted`) | `chat_helpers.py:443–465` (model gate at chat dispatch) | ✅ |
| Add User (username/password/admin + `adm-addBtn`) | `admin.js:332–350` | `POST /api/auth/users` **[RT]** (created the audit non-admin) | account exists, can log in **[RT]** | ACTION ✅ |

### system (admin-only tab)

| Control | Wired? | Persisted? | Applied? | Verdict |
|---|---|---|---|---|
| Export Data (`adm-exportDataBtn`) | `admin.js:2217–2236` | `GET /api/export` → 200 JSON **[RT]** | download | ACTION ✅ (stale copy: the card + payload still describe memories/skills/presets — dropped verticals; S5 leftover, see F6) |
| Import Data (`adm-importDataBtn` + `adm-importFile`) | `admin.js:2238–2270` | `POST /api/import` | restore | ACTION ✅ |
| Transcripts filter + Load + per-row JSON/MD links (0053) | `admin.js:2309–2357` | `GET /api/admin/transcripts` → 200 **[RT]**; 403 non-admin **[RT]** | read-only operator surface | ACTION ✅ |
| Health: Refresh + status page + debug bundle | `admin.js:2360–2431` | `GET /api/admin/health` — live rows rendered (engine REACHABLE) **[RT]** | ops surface | ACTION ✅ |
| Danger Zone: 8 wipe buttons (`data-wipe-kind`) | `admin.js:2274–2306` (delegated, double-confirm) | `DELETE /api/admin/wipe/{kind}` (all kinds exist server-side, `admin_wipe_routes.py:71+`; admin-gated — 403 non-admin **[RT]**) | wipes the category | ACTION ✅ — under the game build only **chats** is visible **[RT]**; the other 7 rows are CSS-hidden (C31/S5, `game-trim.css:83–91`) |

### Cross-cutting runtime cells (authZ honesty — verified-good)

- **Non-admin experience [RT]:** visible tabs are exactly `appearance / shortcuts / account`;
  the modal lands on `account`; `POST /api/auth/settings` → 403; `GET /api/auth/settings` is
  scrubbed (secret keys blanked); `/api/model-endpoints`, `POST /api/tools`,
  `/api/admin/wipe/*`, `/api/admin/transcripts` all 403. **No tab is shown to a user whose
  every action on it 403s** — the 2026-06-09 S1/S4/C30 repairs hold. (Cell ran pre-merge;
  the G13 launcher cascade that landed mid-audit only strengthens this — an all-admin-card
  tab now auto-hides for players, `settings.js:5211–5233`.)
- **Hidden-card honesty [RT]:** the research, teacher, and TTS cards compute `display:none`;
  the email/integrations/reminders nav buttons compute `display:none` under the game build.

---

## 2. Findings

Severity · tab · control — symptom → root cause (file:line) → fix spec.

### F1 · MAJOR · shortcuts · every rebind control — **saved keybinds are never loaded at boot; every custom shortcut silently reverts on reload**
**Symptom [RT]:** rebind Search to `Ctrl+Shift+9` → `PUT /api/prefs/keybinds` 200 → works
immediately (`window._orwellKeybinds.search === 'ctrl+shift+9'`) → **reload** →
`window._orwellKeybinds.search === 'ctrl+k'` while `GET /api/prefs/keybinds` still returns the
custom bind AND the Shortcuts tab still renders the `Ctrl Shift 9` keycaps as saved. The pref
is persisted, displayed, and never applied — for **every** user including the admin.
Screenshot: `assets/R7-shortcuts-after-reload.png`.
**Root cause:** C30 moved the *save* to per-user prefs (`settings.js:1999–2017`) and the *tab's
own render* reads prefs (`settings.js:1836–1843`), but the runtime keymap consumer was never
updated: `initKeyboardShortcuts` seeds `window._orwellKeybinds` from `/api/auth/settings`
`keybinds` only (`keyboard-shortcuts.js:56–58`). Nothing writes the global `keybinds` key
anymore (the UI's old admin path was removed), so the runtime always serves the stale
global/default set. The only moment the pref is live is the page-life of the save
(`settings.js:2011` assigns the window global directly).
**Fix spec:** in `initKeyboardShortcuts`, after the `/api/auth/settings` seed, fetch
`/api/prefs/keybinds` and merge it on top (same layering the tab uses: defaults ← global ←
per-user); keep the in-page assignment on save. One file. While there, collapse the duplicated
default tables (see F5) so the three sources can't drift.
**Pin:** rebind → reload → the new combo fires (and `window._orwellKeybinds` reflects prefs).

### F2 · MINOR · search · `set-searchResultCountCustom` — **the custom result count never saves on its own, and picking "Custom" saves a stale value**
**Symptom [RT]:** select "Custom" → an immediate save fires carrying the OLD count (the
custom input is still empty, so `saveSearch` falls back to the previous value); type `42` +
change/blur → **no request at all**; the 42 persists only when some *other* search control
fires a save (confirmed: touching the URL field then serialized `search_result_count: 42`).
**Root cause:** `countSel` has two change listeners (display toggle `settings.js:1131` + save
`settings.js:1200`) but `countCustomInput` has none — it is only *read* inside `saveSearch`
(`settings.js:1164–1174`).
**Fix spec:** `countCustomInput.addEventListener('change', saveSearch)` (one line), and make
the `countSel === 'custom'` branch skip the save when the custom field is empty/invalid
(save on the input's change instead).
**Pin:** pick Custom, type 42, blur → POST carries 42; round-trip shows 42.

### F3 · MINOR · appearance · `reset-window-positions-btn` — **"Reset window positions" no longer resets the game windows**
**Symptom:** the button's sweep clears the legacy keys (`orwell-status-pos/min`,
`orwell-social-pos/min`) and the `winpos-*`/`winsize-*`/`modal-pos-*` prefixes
(`settings.js:1681–1692`) — but window drags persist under the slot system's
**`orwell-slot-offset:<key>:<user>`** keys (`orwellSlots.js:28,38`, the E91/S11→F2 lineage),
which the button never touches — and since G16 (PR #268, landed mid-audit) a parked window
additionally persists **`orwell-win-parked:<id>:<user>`** (`orwellWindow.js:133–142`), which
the sweep also misses: after "Reset", a dragged House/status window stays dragged and a
parked window stays parked. The only working resets are per-window (titlebar `Home`,
`orwellWindow.js`).
**Root cause:** a stale key list — the reset predates the slot-offset migration and the G16
parked persistence.
**Fix spec:** kit-level (per the F-3 anti-fragmentation ratchet): sweep the
`orwell-slot-offset:` **and** `orwell-win-parked:` prefixes in the same loop and restack/
restore via the kit (or simply remove the keys — the next `restackSlot`/mount re-derives).
Do NOT enumerate per-panel keys again.
**Pin:** drag + park a kit window → Settings → Reset window positions → the window is back
open at its slot base without a reload.

### F4 · MINOR (hidden surface) · ai · teacher card — **the enable toggle is the one control H2b left unwired, feeding an orphan key**
H2b (PR #267, landed mid-audit) wired the research-model and teacher endpoint/model selects to
the shared pool — re-verified in the merged tree. What remains: `set-teacherEnabledToggle` has
**zero** JS references (H2b's own comment: blank model = unset, "the toggle's feature stays
off"), while `teacher_enabled` is still read as the escalation gate
(`teacher_escalation.py:452,495`) — so the feature can only ever be switched on by hand-editing
`data/settings.json`, and the hidden card renders a switch that does nothing. **Fix spec
(pick one):** wire the toggle into `initTeacherModel`'s save (it already posts `teacher_model`)
— or delete the toggle from the card and treat a non-empty `teacher_model` as enabled,
removing the `teacher_enabled` key. Either way the card stays hidden under the game build.

### F5 · LOW · shortcuts · default-table drift — three sources of truth disagree
`settings.py:167–175` (global default: has `star_session`/`admin_panel`, lacks
`tts`/`settings`/`focus_input`/`open_theme`/`fav_session`) vs `settings.js:1727–1738`
(`SHORTCUT_DEFAULTS`: `toggle_sidebar: 'ctrl+b'`) vs `keyboard-shortcuts.js:7–13`
(`_defaultKeybinds`: `toggle_sidebar: 'ctrl+alt+b'`). In practice the server's merged
`keybinds` default papers over the JS drift, and the tab renders only its own category list —
but `star_session`/`admin_panel` in the server default are bound to nothing in the runtime
keymap (no handler), and the `/shortcuts` slash popup (`slashCommands.js:4961–4967`) lists
them. **Fix spec:** one defaults table (serve it from the server; both JS files consume),
prune the dead `admin_panel`/`star_session` actions or wire them. Fold into the F1 PR.

### F6 · LOW · system · Export/Import card copy — stale vertical references
The card promises "memories, presets, settings, skills, preferences" (`index.html:2097`) and
the export payload still carries the dropped verticals' stores (harmless — empty under the
game build). The S5 wipe-list fix (C31) trimmed the Danger Zone but not this card, and the
G13 cascade sweep (landed mid-audit) covered menus/launchers/shortcut rows, not this copy.
**Fix spec:** game-build copy swap ("chats, settings, preferences") — one line, can ride any
settings PR (Wave S2).

### Recorded as correct (no finding)
- **The admin-only POST + scrubbed GET split** (`auth_routes.py:450–488`) and the C30 tab
  gating — verified live for both roles; no control is shown that can only 403.
- **Search is no longer a dead tab** (the 2026-06-09 S2 finding): `/api/search/query` is
  mounted under the game build (C32, `GAME_KEEP_SET`) and the Test button returns live results
  **[RT]**.
- **`mode-toggle` hidden during a live game** (`game-trim.css:78`) — D7 by design; the
  appearance toggle still governs the pre-game/debug surface.
- **Appearance/privacy on localStorage** — per-device by design; wiped on logout as a
  deliberate cross-account-leak guard (`settings.js:2188–2204`).
- **Unknown-key drops in the settings POST** (`auth_routes.py:475`) — the allowlist silently
  ignores unknown keys; today no live control posts an un-allowlisted key (verified by
  payload capture across every save path exercised), so this is a safe guard, not a trap.
- **Config-file-only keys** (no UI by design, read server-side): `search_safesearch`,
  `agent_input_token_budget`/`_hard_max`, `agent_stream_timeout_seconds`,
  `tool_path_extra_roots`, `skill_*`, `task_endpoint_id`/`task_model`, `urgent_email_prompt`,
  `stt_*` (UI removed; `initSttSettings` bails at `settings.js:897`). These are 🟣 ORPHAN-KEYs
  in the strict sense but **deliberate operator knobs** — recommend a one-line comment block in
  `DEFAULT_SETTINGS` marking which keys are UI-backed vs file-only, so the next audit can
  diff mechanically.

---

## 3. Summary count

Grouping rule: each distinct control id is one row; a dynamically-rendered repeating control
(fallback rows, endpoint-row buttons, privilege toggles, tool toggles, 2FA flow) counts as
**one group per behavior**.

| Verdict | Count | Where |
|---|---|---|
| ✅ LIVE (wired + persisted + applied) | **54** | services 12 (3 local-form + 5 api-form fields/picker + 4 endpoint-row behaviors) · ai 14 (every visible select/toggle/fallback group on all five live cards) · search 6 · appearance 16 (15 toggles + blur; mode-toggle carries the D7 caveat) · users 4 (signup + privilege/limit/model groups) · tools 2 (per-tool + per-category groups) — plus, post-H2b, the research-model and teacher ep/model selects are wired-but-hidden (counted under N/A-hidden) |
| ACTION ✅ (does real work; not a setting) | **25** | tests (endpoint ×2, search), add/discover/ollama/cancel, export/import, transcripts, health ×3, wipe group, password/2FA/logout, add-user + 4 user-row actions, reset-all, shortcuts-reset, chrome ×2 |
| 🔴 DEAD-SETTING | **1 surface** (every rebind row on the shortcuts tab rides it) | F1 — per-user keybinds persisted + displayed, never loaded at runtime |
| 🟠 DEAD-UI | **1 visible** (partial: custom result count, F2) + **1 hidden** (the teacher enable toggle — F4; H2b's landing wired the other three) | search · ai |
| ⚪ INERT | **1** (for kit windows only) | F3 — reset-window-positions misses `orwell-slot-offset:*` + `orwell-win-parked:*` |
| 🟣 ORPHAN-KEY | **1 active** (`teacher_enabled` — F4; `teacher_model` gained a writer via H2b) + the deliberate config-file-only set (recorded, not defects) | — |
| N/A-dropped | **16 controls** across email/reminders/integrations | tabs CSS-hidden + init skipped; nothing binds |
| N/A-hidden (by design) | **17**: TTS card (8) · research card's 7 wired-but-hidden inputs · teacher ep/model selects (2, wired post-H2b) | DOM kept so init doesn't throw; all compute display:none **[RT]** |

**The commission, answered.** The settings menu is **substantially honest**: every *visible*
control on every reachable tab is wired to a real save path, persists to a real store, and is
consumed by the runtime — with **three genuine wiring defects**: (1) the Shortcuts tab is a
complete persisted-but-never-applied loop (F1 — the only MAJOR); (2) the search custom-count
input saves only by accident (F2); (3) the window-position reset no longer reaches the windows
players actually drag (F3). Everything else that looks dead is *deliberately* dead — hidden
cards kept for init-safety (and since H2b's mid-audit landing, all but one of their controls
are genuinely wired) and dropped-vertical tabs already CSS-hidden + init-skipped, with G13's
landed cascades closing the zombie-affordance class around them. One residual: the teacher
enable toggle (F4).

---

## 4. Recommended fix waves

Small, separable; each wave lands its pin (browser_smoke or pytest browser case) in the same PR.

- **Wave S1 — the bug (F1 + F5 rides).** `keyboard-shortcuts.js`: merge `/api/prefs/keybinds`
  over the global seed at boot; unify the three default tables (server-served); prune or wire
  the `admin_panel`/`star_session` remnants. Pin: rebind → reload → fires.
- **Wave S2 — small repairs (F2, F3, F6).** `settings.js`: change-listener on
  `set-searchResultCountCustom` (+ skip-empty guard); add the `orwell-slot-offset:` and
  `orwell-win-parked:` prefixes to the reset-button sweep (kit-level); the Export-card copy
  swap. Pins: custom count round-trips; drag + park → reset → open at slot base.
- **Wave S3 — the H2b residue (F4).** Decide the teacher enable toggle: wire it into
  `initTeacherModel`'s save, or delete it and the `teacher_enabled` key together (non-empty
  `teacher_model` = enabled). One decision, a few lines either way.
- **No wave — recorded:** the config-file-only ORPHAN-KEY set gets a marker comment in
  `DEFAULT_SETTINGS` (one docs-grade change, can ride any settings PR) so UI-backed vs
  file-only keys stay mechanically diffable.

**Vault/ADR-0003 note:** every surface exercised is FE/app-tier configuration; no cell touches
engine Vault state; the engine was involved only as the health-card target (REACHABLE) and the
game overlay during boot. No Vault finding.

**Run log:** 17 runtime cells (R1–R13 + probe2 + non-admin lane) — all consistent with the
static trace; mutated settings restored to defaults in-harness; servers torn down; FE data dir
scratch-only (`frontend/data`, gitignored, removed). Harness: `/tmp/swa/audit.py` +
`/tmp/swa/probe2.py` (scratch, not shipped); results `/tmp/swa/results.json`; screenshot
assets in `./2026-06-11-settings-wiring-audit-assets/`.

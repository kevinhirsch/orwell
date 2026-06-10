# Orwell Settings-menu audit — 2026-06-09

A focused supplement to the round-3 audit: the Settings modal, **tab by tab, control by
control** — is each wired (button → `settings.js` handler → server route), does it persist and
take effect, is it correct under the game build, and is authZ enforced server-side. Sources:
`frontend/static/index.html` (panels), `frontend/static/js/settings.js` + `admin.js`,
`frontend/routes/{model_routes,auth_routes,prefs_routes,admin_wipe_routes,backup_routes}.py`,
`frontend/src/settings.py`, `frontend/static/css/game-trim.css`.

## How the game build does (and doesn't) gate Settings

- `index.html` is served with only `strip_dropped_scripts` applied — **no settings panel
  `<div>` is ever removed or gated server-side**; every panel ships to every user.
- The only game-build gating of tabs is **cosmetic CSS**: `game-trim.css:59-63` hides exactly
  three — `email`, `integrations`, `reminders`. Their JS still initializes on every settings
  open and binds controls to 404'd endpoints.
- **The `search` tab is not hidden at all** — fully visible while its vertical is dropped
  server-side (`web_search` ∈ `GAME_DROP_SET`): pure dead UI.
- `tools`/`users`/`system` are admin-hidden by JS and **properly re-checked server-side** on
  every action.

## Summary table

| Tab | In game build? | Shown? | Wired & functional? | Verdict |
|---|---|---|---|---|
| **services** (Add Models) | Yes (keep) | Yes — the *default* tab, not admin-marked | Admin: yes. **Non-admin: 403 on list/add/test, sees "None"** | **MAJOR** |
| **ai** (AI Defaults) | Yes (linchpin) | Yes | Admin: yes. **Non-admin: empty dropdowns + 403 saves** | **MAJOR** |
| **search** | **No** (dropped) | **Yes — ungated** | **No** — Test → `/api/search/query` 404; save no-op | **MAJOR** |
| **integrations** | No (dropped) | CSS-hidden | JS ships; endpoints admin-only/irrelevant | MINOR |
| **email** | No (dropped) | CSS-hidden | No — `/api/email/*` 404; "Open Tasks" no-op | MINOR |
| **reminders** | No (dropped) | CSS-hidden | No — `/api/notes/fire-reminder` 404 | MINOR |
| **appearance** | Yes (keep) | Yes | **Yes** — localStorage, applies live, round-trips | OK |
| **theme modal** (Customize) | Yes (keep) | Yes | Yes — but the full workspace customizer (overbuilt; → C27/V5) | MINOR |
| **shortcuts** | Yes | Yes | **Non-admin save silently 403s but toasts "saved"** | MAJOR (non-admin) |
| **account** | Yes (keep) | Yes | **Yes** — password/2FA/logout all per-user, persist, round-trip | OK |
| **tools** (admin) | Yes | Admin-only | Yes, server-enforced | OK |
| **users** (admin) | Yes | Admin-only | Yes, server-enforced | OK |
| **system** (admin) | Yes | Admin-only | Yes, server-enforced; **wipe list names dropped verticals** | MINOR |

**Root structural mismatch:** the server drops verticals (routers 404) while the Settings UI
for them is either fully visible (`search`) or only CSS-hidden with live JS underneath
(`email`/`reminders`/`integrations`) — and the *keep-set* tabs (`ai`/`services`) work **only
for the admin** because their entire write path is admin-gated.

## Findings

**S1 · CRITICAL (multi-user) / OK (single admin-player) — LLM configuration is admin-only and
the per-user seam is unwired.** The game cannot speak without an LLM endpoint, and every part
of configuring one requires admin: the endpoint list/add/test (`/api/model-endpoints*`,
`require_admin` — `model_routes.py:1421,1488,1684`; non-admin sees "None", `admin.js:448-453`
swallows the 403) and the default chat/utility/vision/agent saves (`POST /api/auth/settings`,
admin-only — `auth_routes.py:461-466`; handlers at `settings.js:474,547,695,1475`). The
backend already supports per-user defaults — `_PER_USER_KEYS` includes
`default_endpoint_id`/`default_model` served by `/api/prefs` (`settings.py:379-388`,
`prefs_routes.py:82`) — **but `settings.js` never calls `/api/prefs`** (grep: zero matches).
The first-run account is admin, so the canonical single-player install works; any signup user
(`is_admin=False`, `auth_routes.py:114`) lands on the default services tab, sees "None," 403s
on everything, and has **no path to give the game a model** — exactly the "unlimited users,
each isolated" scenario the spec mandates. Same root cause as the round-3 installer-key
confusion (A3): LLM config lives entirely behind admin/global settings.
*Fix:* wire the AI-tab model selectors + saves through per-user `/api/prefs` (keys already
whitelisted), keep endpoint *creation* admin-only but make the endpoint *list* readable to
authed users; hide or OOBE-redirect `services`/`ai` for users who can't use them.
*Acceptance:* a non-admin signup user can select a working chat model and the game speaks; no
tab is shown to a user whose every action on it 403s.

**S2 · MAJOR — The `search` tab is a fully visible dead vertical.** Renders ungated
(`index.html:1580-1640`), Test → `POST /api/search/query` (`settings.js:1267`) against an
unmounted router (`app.py:581`, `web_search` dropped) → 404 "✗ Test failed"; the provider/key
save (`settings.js:1094`) writes admin-only global settings that nothing reads under the game
build. *Fix:* add `[data-settings-tab="search"]` to the game-trim hide set (and ideally gate
the panel server-side). *Acceptance:* the tab is absent under the game build, present and
functional with the build off.

**S3 · MINOR — `email`/`reminders`/`integrations`: CSS-hidden, JS alive, endpoints 404.**
`initEmail*/initReminder*/initIntegrations` run on every settings open (`settings.js:
2081-2085`) and bind to dropped endpoints (reminders Test → `/api/notes/fire-reminder` 404;
email accounts → `/api/email/*` 404; the "Open Tasks" button clicks a CSS-hidden element).
The cosmetic-hide-live-code pattern again; `strip_dropped_scripts` covers a fixed script list,
not `settings.js` itself. *Fix:* gate those init calls behind the game-build flag (or remove
the panels server-side). *Acceptance:* no dropped-vertical init runs and no request to a 404'd
endpoint fires under the game build.

**S4 · MAJOR (non-admin) — Shortcuts save lies.** `saveKeybinds()` POSTs the admin-only
settings endpoint (`settings.js:1855-1868`); on 403 the error is swallowed and the toast says
**"Shortcut saved"** while the change lives only in memory and is lost on reload. Keybinds are
also global, not per-user (`settings.py:167`). *Fix:* persist via `/api/prefs` (per-user), or
surface the failure honestly. *Acceptance:* a non-admin keybind change survives reload, or the
user is told it can't be saved.

**S5 · MINOR — System tab's Danger Zone wipes name dropped verticals.** Admin-gated correctly
(`admin_wipe_routes.py:73`, `backup_routes.py:21`), but the wipe list (`index.html:2099-2153`)
offers memory/skills/notes/tasks/documents/gallery/calendar — categories the game build
doesn't have; export/import likewise reference memories/skills/presets. *Fix:* trim to live
game data (chats + the engine save dir; pair with the round-3 backup work, B71).
*Acceptance:* System offers only wipes corresponding to live data.

**S6 · MINOR — Theme/Customize is over-scoped but functional** (full workspace color
customizer incl. code-block colors and font drops for a game with no code blocks). Already
covered by queued **C27** (V5); no new item.

**Verified-good:** the **account** tab (password change, 2FA setup/confirm/disable with
fail-closed status round-trip, logout — all per-user and correctly routed); the **appearance**
tab (localStorage, applies live, admin-guard on the one server-touch hazard); **tools/users/
system** actions all `require_admin` server-side (UI hiding never trusted).

## Design rulings (2026-06-09, post-audit — these override the recommendations above)

The product owner ruled on the findings; the queue items encode the rulings, not the original
recommendations:

1. **S1 ruled: LLM config is GLOBAL by design.** The first admin sets up services/ai and those
   settings are global for all users. Logically-global things are global, unchangeable by, and
   **hidden from** non-admins; user-based **preferences** persist per-profile only. **The
   chat-bar model switcher stays for every user** — selecting among the admin-provisioned
   models is a per-profile preference; what's hidden is the config/management surface. (The
   audit's "per-user LLM config" recommendation is superseded → **C30**.)
2. **S2 ruled: search is NOT pruned — it is critical and must be re-wired.** The agent must be
   able to leverage web search **in-fiction**: a player references something the model doesn't
   know (a new movie, mid-conversation with a houseguest) → the agent silently searches and
   synthesizes the reply **in that houseguest's voice**. Amends the 0032 drop-set → **C32**
   (with the hard guardrail that search informs real-world flavor only, never game truth).
3. **S6 ruled: keep ALL theme customization tools and make them better** (presets on top, AA
   contrast clamp, working harmony/fonts) — the prune recommendation is superseded → folded
   into **C27**.
4. Everything else stands as recommended.

## Queue mapping

- **S1 + S4 → C30** (global LLM config per the ruling + per-profile preferences + honest failures).
- **Search ruling → C32** (re-wire web search as an in-fiction agent capability; amends 0032).
- **S3 + S5 → C31** (settings prune — S2's search-hide is superseded by C32).
- **S6** → folded into **C27** per the ruling (keep + improve).
- S1 also amends the round-3 **B69** acceptance (the "playable after install" readiness check
  must hold for a non-admin user once C30 lands).

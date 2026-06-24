# Settings tabs/controls — player-vs-admin gating investigation (#553)

**Status: REPORT ONLY.** No gating behavior was changed in PR #553 (that PR only fixed the
Settings → OrwellWindow-kit layout). The owner asked for the admin-vs-player split to be
documented before any gating change. Questions for the owner are flagged at the bottom.

## How settings gating works (three independent mechanisms)

1. **`.admin-only` class + `syncAdminVisibility()` (`settings.js:5376-5395`).** On open, every
   `.admin-only` node is shown iff `window._isAdmin`. A cascade also hides any tab *launcher*
   whose panel's cards are **all** `.admin-card.admin-only` (no per-tab name list — a tab that
   drifts to all-admin content auto-hides for players). Note: `.admin-card` is the **visual card
   style**, NOT a gating class; only `.admin-only` gates.
2. **Game-build trim (`static/css/game-trim.css` + `data-game-build` on `<body>`).** The
   `email` / `integrations` / `reminders` tabs are `display:none` under the game build (their
   routers 404), and `initSettings()` skips initializing them (`settings.js:2398`). These are
   inherited-workspace verticals dropped from the game, not an admin/player split.
3. **Auth-state gates (per-control, not admin).** When `auth_enabled === false`
   (`settings.js:2144-2152`) the Logout button, Change-Password card, and 2FA card hide — they
   are inert without auth. `UI_VIS_ADMIN_ONLY` (appearance "UI visibility" toggles,
   `settings.js:1688`) keeps a control visible for admins even when its visibility toggle is off.

## Tab + notable-control classification

| Tab (`data-settings-tab`) | Audience | Gate |
|---|---|---|
| **Add Models** (`services`) | Admin | `admin-only` on nav button |
| **AI Defaults** (`ai`) | Admin | `admin-only` on nav button |
| **Search** (`search`) | Admin | `admin-only` on nav button |
| **Integrations** (`integrations`) | Player* | game-build: `display:none`; full build: player-facing |
| **Email** (`email`) | Player* | game-build: `display:none`; full build: player-facing |
| **Reminders** (`reminders`) | Player* | game-build: `display:none`; full build: player-facing |
| **Appearance** (`appearance`) | Player | always shown |
| **Shortcuts** (`shortcuts`) | Player | always shown |
| **Account** (`account`) | Player | always shown |
| **Agent Tools** (`tools`) | Admin | `admin-only` on nav button + Admin divider/label |
| **Users** (`users`) | Admin | `admin-only` on nav button |
| **System** (`system`) | Admin | `admin-only` on nav button |

\* Integrations/Email/Reminders are not admin-gated in the **full** build (player-facing), but
are **removed entirely** under the game build (the shipped configuration). So under the game
build a player effectively sees only Appearance / Shortcuts / Account, and an admin additionally
sees Add Models / AI Defaults / Search / Agent Tools / Users / System.

### Notable controls within player-facing tabs

| Control | Audience | Gate |
|---|---|---|
| Appearance → Chat Area / Sidebar toggles | Player | always |
| Appearance → "UI visibility" per-element toggles | Player (some admin-kept) | `UI_VIS_ADMIN_ONLY` keeps a few visible to admins when toggled off |
| Shortcuts → rebind list | Player | always |
| Account → name / role / version | Player | always |
| Account → Profile-picture studio | Player | always |
| Account → Logout | Player | hidden when `auth_enabled === false` |
| Account → Change Password | Player | hidden when `auth_enabled === false` |
| Account → Two-Factor Auth | Player | hidden when `auth_enabled === false` |
| Account → Danger Zone "Reset progress" | Player | game-build only (`initAccount` reveals when `data-game-build`) — routes through the engine's one sanctioned reset |
| System → Transcripts / Health & Logs / Public deployment / TLS cards | Admin | inside the admin-only `system` tab AND individually `.admin-only` (double-gated) |

## Vault-Wall note

Nothing in the settings surface reads Vault/secret state — the admin tabs configure plumbing
(models, users, system health, agent tool backend), consistent with mandate #2 (admin/God-Mode
is walled from the Vault too). This investigation found no Vault exposure.

## Questions for the owner (no change made)

1. **Account → Danger Zone "Reset progress" is player-visible** (game-build only). Confirmed
   intentional per feature 0057 (the player restarts their own season). Flagging only because it
   is a consequential, irreversible action surfaced to players — confirm the placement is desired.
2. **No mis-gating found.** Every admin control is behind `admin-only` (and the System cards are
   double-gated); every player-relevant control is reachable by players. The only "player control
   that disappears" cases are auth-state-driven (Logout / Password / 2FA hidden when auth is off),
   which is correct — those controls are inert without auth. No player-relevant control is hidden
   by admin gating, and no admin control leaks to players.

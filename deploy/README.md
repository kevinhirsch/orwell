# deploy/ — one-liner Proxmox install & update

Spec: [`docs/features/0010-deployment-one-liner.md`](../docs/features/0010-deployment-one-liner.md).

The scripts target the engine's standard contract — **`npm run build` + `npm start`** — and the
in-container installer **verifies that contract before building** (a not-yet-runnable checkout
fails clearly instead of half-installing). One Proxmox LXC runs both tiers as systemd services:

```
 LXC (Debian)
   ├─ orwell-engine.service     Node:   npm start  -> MCP server on 127.0.0.1:${ORWELL_ENGINE_PORT}
   └─ orwell-frontend.service   Python: uvicorn app:app on 0.0.0.0:${ORWELL_PORT}
   data: /opt/orwell/data       .env (secrets) + the save (SQLite + souls); preserved across updates
```

## Recommended specs

**Baseline: 4 vCPU / 8 GB RAM** (12 GB disk) — the installer defaults (overridable via `CORES`,
`RAM_MB`, `DISK_GB`). The LLM is **remote**, so CPU is spent on the front-end + engine + **local
embeddings** (fastembed / ONNX, warmed at boot). Give it **more RAM** if you also run in-character
**image generation**, or run several concurrent games. A 2 vCPU / 2 GB box (the old default) is
enough to boot but tends to stall under the embedding warm-up + a live turn — symptoms are a
hung-feeling turn and a brief front-end 502 while the engine catches up.

## Usage

The repo is **private** (ruling #17, 2026-06-10). You authenticate **once, ever**: the
first-install one-liner carries a fine-grained PAT (scope: this repo, **Contents: Read-only**,
nothing else). The installer persists it to the container's `data/.env` (`GIT_TOKEN=…` — the one
file every reset preserves) and wires a git **credential helper** that reads it at use time, so
updates and resets never re-prompt and the token never lands in a remote URL or `.git/config`.

```bash
# install — on the Proxmox host shell (THE one authenticated moment).
# EXPORT the token (in `VAR=x bash -c "$(curl …$VAR…)"` the substitution runs in the OUTER shell
# before VAR= applies, so curl gets an EMPTY token → 404/401). Fetch via the contents API, not
# raw.githubusercontent.com (which 404s for fine-grained PATs). Works with fine-grained OR classic.
export GIT_TOKEN=github_pat_xxx
bash -c "$(curl -fsSL -H "Authorization: Bearer $GIT_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/kevinhirsch/orwell/contents/deploy/orwell.sh?ref=main")"

# update — host or inside the container: run the LOCAL checked-out copy (no GitHub fetch)
bash /opt/orwell/deploy/orwell-update.sh
```

After install, **every maintenance command is the local copy** — `bash
/opt/orwell/deploy/<script>.sh` inside the container, or the same script from a checkout on the
host (it bridges into the LXC via `pct` and, with no local file, runs the **in-container
checked-out copy**). No script fetches branch tips from GitHub anymore (audit E84): the only
GitHub traffic is `git fetch/pull` itself, authenticated by the credential helper.

For an **existing install** that predates the private flip, set the token once:

```bash
bash /opt/orwell/deploy/orwell-update.sh --set-token     # prompts; or GIT_TOKEN=… non-interactive
```

Fine-grained PATs cap at one year — `--set-token` is also the annual rotation (still "once," per
year). Variant for never rotating: a read-only **deploy key** (SSH) pasted into GitHub once and an
SSH `REPO=` URL; the PAT-in-`.env` path is the default because the preserve-`.env` infrastructure
already exists.

The update script works **either** on the Proxmox host **or** inside the container: the app and
its git checkout live in the LXC (the host has no `git` / no app dir), so when run on the host the
script locates the orwell container (by hostname `orwell`) and re-runs itself inside it via `pct` —
the same bridge the installer uses. Override the target with `CTID=<id>` (or `CT_HOSTNAME=<name>`)
if you renamed the container or run more than one. A container provisioned **before** the
`bbai → orwell` rename (app in `/opt/bbai`, `bbai-*` services) is auto-detected and updated in place
— the engine and front-end still honor the deprecated `BBAI_*` env, so its `data/.env` keeps working
untouched.

## Control panel — the `orwell` menu

After install, **`orwell`** (a launcher for `orwell-menu.sh`, installed to `/usr/local/bin/orwell`)
opens a **whiptail** menu over every task below — update, doctor, backup, restore, the two reset
tiers, and the readiness check — so you don't have to remember script paths or flags. It opens on an
ASCII **ORWELL** banner and runs each action with sectioned, step-by-step status lines (`▸` working,
`✓` done, `✗` failed); the installer and the login health panel share the same banner + glyphs. The
login health panel advertises it.

```bash
orwell                      # the interactive menu (inside the container)
orwell doctor --status      # or a direct subcommand (skips the menu — good over SSH / in scripts)
orwell reset-game --yes     # destructive subcommands require --yes off the menu
```

The menu only **dispatches** to the scripts in this directory (the single source of truth for each
task), collecting input through dialogs — a deploy-token password box, a backup picker, a
type-`RESET` confirmation for the resets. The scripts themselves also show inline whiptail dialogs
when run directly on a terminal (the updater's action menu + token box, the doctor's mode picker,
the resets' confirm) and remain **fully non-interactive** for automation, CI, and the
host→container `pct exec` bridge (which has no PTY) — exactly today's flags/env. `whiptail` is
installed by `orwell-install.sh`; without it (or off a TTY) every prompt falls back to plain text.
Shared dialog helpers — and the matching presentation helpers (`ow_logo` / `ow_section` /
`ow_step` / `ow_ok` / `ow_warn` / `ow_fail`, colour auto-disabled off a TTY or under `NO_COLOR`) —
live in `orwell-tui.sh` (sourced; it changes no shell options); `orwell.sh` (the curl-bootstrapped
installer) and `orwell-install.sh` keep their own inline copies — they must each stay one
standalone file.

### Factory reset (back to OOBE)

To scrub **all** game + user data and start over as if freshly installed — every sandbox (saves,
souls, the hidden Vault layer) and the whole front-end store (accounts, settings, uploads) — run it
either **on the Proxmox host** (it bridges into the LXC, like `orwell-update.sh`) or **inside the
container as root**:

```bash
# from the Proxmox host (auto-locates the orwell LXC; CTID=<id> if not named "orwell");
# run from a host checkout, or any local copy of the script — it bridges into the LXC
bash deploy/orwell-factory-reset.sh
bash deploy/orwell-factory-reset.sh --dry-run
bash deploy/orwell-factory-reset.sh --yes

# or directly inside the container
bash /opt/orwell/deploy/orwell-factory-reset.sh             # prompts: type RESET
bash /opt/orwell/deploy/orwell-factory-reset.sh --dry-run   # preview what would be removed
```

`data/.env` — including the deploy `GIT_TOKEN` — survives the scrub, so updates keep working
without a re-prompt.

It stops the services, removes the data, and restarts — the next visit begins at first-run
onboarding. **Config is preserved** (`data/.env`: ports, engine URL, LLM keys), so the box still
boots and reaches your LLM. Unlike `orwell-update.sh` (which never touches `data/`), this is the
one script that deliberately **does**.

> **The engine save dir matters.** The engine writes per-user saves (and the hidden Vault layer)
> to `ORWELL_DATA_DIR`, **defaulting to `./.orwell-data`** if unset. Fresh installs now pin
> `ORWELL_DATA_DIR=<app>/data` so the save lives in `data/`; older installs that predate that pin
> keep their save in `<app>/.orwell-data`. The reset script **resolves the real save dir from
> `.env` and handles both layouts** — an earlier version only scrubbed `data/` and so left the
> game intact on default installs.

### OOBE reset (back to first-run, **keep the API-key / LLM config**)

The "clear everything but my LLM setup" tier — and the one the admin status page's **Factory
Reset (OOBE)** button runs. It wipes **exactly** what a factory reset does (every game sandbox
*and* the whole front-end store — all accounts, chats, sessions, memory, MCP server configs,
uploads, portraits, and every user setting) **except** it preserves the configuration an
operator should never have to re-enter:

* the configured **LLM / image providers** (the `model_endpoints` table in the FE `app.db`),
* the **LLM-selection settings** (which endpoint/model is the default for chat / utility /
  research / vision / image),
* the **encryption keys** that decrypt them (`frontend/data/.app_key`, `.key`) and the legacy
  `frontend/data/api_keys.json`,
* and — like every reset — the engine config **`data/.env`** (ports, tokens, the deploy
  `GIT_TOKEN`, LLM keys), which is **never touched**.

So after the reset the app sits at first-run onboarding (account creation / casting) **with an
LLM already configured**. Same host-aware bridge and flags as the other resets:

```bash
# from the Proxmox host (auto-locates the orwell LXC; CTID=<id> if not named "orwell")
bash deploy/orwell-oobe-reset.sh
bash deploy/orwell-oobe-reset.sh --dry-run
bash deploy/orwell-oobe-reset.sh --yes

# or directly inside the container
bash /opt/orwell/deploy/orwell-oobe-reset.sh             # prompts: type RESET
bash /opt/orwell/deploy/orwell-oobe-reset.sh --dry-run   # preview what would be removed

# or from the control panel
orwell reset-oobe --yes
```

The selective FE-store surgery (export the `model_endpoints` rows + the LLM-selection settings,
wipe the rest, rebuild a fresh `app.db` / `settings.json`) is done by the quarantined Python
helper `frontend/scripts/oobe_reset.py`; the shell script orchestrates the service stop, the
file keep-list, the engine-save scrub, and the restart. The encrypted provider keys are carried
**verbatim** (no re-encryption, no plaintext ever materialized) so they still decrypt under the
preserved `.app_key`. Use the **factory reset** (below) when you want the LLM config gone too.

### Update + Reset (update first, then OOBE — **keep the API-key / LLM config**)

The combined **middle** tier of the three maintenance controls — **Update · Update + Reset ·
Reset** — for when you want a freshly-pulled build **and** a clean first-run box in one action. It
**composes** the two existing scripts (it re-implements neither): it runs the update with restart
suppressed (`orwell-update.sh --no-restart` — pull → rebuild engine → refresh FE deps) and **only
if that succeeds** proceeds to the OOBE reset (`orwell-oobe-reset.sh --yes` — wipe to first-run,
preserving the LLM/provider config, never touching `data/.env`), ending in the **single** final
restart.

**Fail-closed** (the safety contract of a destructive combo): if the **update** fails, the wipe
does **not** run (the box stays on its previous build and nothing is removed); if the reset helper
is missing it refuses up front, removing nothing — so your **API keys are never at risk**. Same
host-aware bridge and flags as the other resets:

```bash
# from the Proxmox host (auto-locates the orwell LXC; CTID=<id> if not named "orwell")
bash deploy/orwell-update-reset.sh
bash deploy/orwell-update-reset.sh --dry-run   # preview both phases; change nothing
bash deploy/orwell-update-reset.sh --yes

# or directly inside the container
bash /opt/orwell/deploy/orwell-update-reset.sh             # prompts: type RESET
bash /opt/orwell/deploy/orwell-update-reset.sh --no-restart # update + scrub, leave services down

# or from the control panel
orwell update-reset --yes
```

This is the script the admin **Update + Reset (OOBE, keep API keys)** button runs. Destructive —
prompts for `RESET` unless `--yes`; `--dry-run` previews. Use the plain **Update** when you only
want the new build (no wipe), or the plain **OOBE reset** when you only want a clean box (no pull).

### Game reset (new season, keep accounts + LLM config)

The lighter sibling of the factory reset: it removes **only game progression** — every per-user
engine sandbox (saves, souls, the hidden Vault layer, in-flight casting intake) — and preserves
**everything else**: `data/.env` (ports, tokens, LLM keys) *and* the entire front-end store
(accounts, sessions, settings, including the LLM endpoint config). Players keep their logins and
the box keeps its LLM setup; the next visit starts a brand-new game at the casting interview.
Same host-aware bridge and flags as the factory reset:

```bash
# from the Proxmox host (auto-locates the orwell LXC; CTID=<id> if not named "orwell")
bash deploy/orwell-game-reset.sh
bash deploy/orwell-game-reset.sh --dry-run
bash deploy/orwell-game-reset.sh --yes

# or directly inside the container
bash /opt/orwell/deploy/orwell-game-reset.sh             # prompts: type RESET
bash /opt/orwell/deploy/orwell-game-reset.sh --dry-run   # preview what would be removed
```

It resolves the engine save dir exactly the way the factory reset does (all three `ORWELL_DATA_DIR`
generations), stops the services while it scrubs, and restarts them after. Use the **factory
reset** instead when you also want accounts/settings gone (full OOBE).

### Web-triggered update (the admin status page)

The admin status page can trigger `orwell-update.sh` and watch its output live. The web tier
runs inside the E85-hardened unit (`User=orwell`, every capability dropped) and structurally
cannot `systemctl` or self-update — so it never executes anything. Instead it drops a **flag
file** (`data/ops/update-requested`; content ignored — **existence only**, never parsed or
executed) and the root-side **path unit** `orwell-ops-update.path` reacts by running the **one
fixed script** (`deploy/orwell-update.sh`) via a oneshot root service, appending stdout+stderr
to `data/ops-update.log` — the same `data/*.log` surface the status page already tails (G1b).
The runner removes the flag *before* the run (a finished run never re-triggers; a request that
lands mid-run earns exactly one follow-up run) and holds a `flock` so overlapping triggers
no-op. The web tier chooses *when*, never *what*.

The **OOBE reset** (keep-API-keys, above) is web-triggerable through the **same pattern**: the
admin status page's **Factory Reset (OOBE)** button (`POST /api/admin/factory-reset`,
admin-gated, demanding a typed **`RESET`** in the browser first) drops the existence-only flag
`data/ops/factory-reset-requested`, and the root-side path unit `orwell-ops-factory-reset.path`
runs the **one fixed script** `deploy/orwell-oobe-reset.sh --yes` via its oneshot root service,
appending output to `data/ops-factory-reset.log`. The full-wipe **factory reset**
(`orwell-factory-reset.sh`, which also drops the LLM config) is deliberately **not**
web-triggerable — only via the shell / control panel.

The combined **Update + Reset** button (`POST /api/admin/update-reset`, admin-gated, demanding a
typed **`RESET`** first) is web-triggerable through the **same pattern**: it drops the
existence-only flag `data/ops/update-reset-requested`, and the root-side path unit
`orwell-ops-update-reset.path` runs the **one fixed script** `deploy/orwell-update-reset.sh --yes`
via its oneshot root service, appending output to `data/ops-update-reset.log`. The script is
fail-closed (a failed update never proceeds to the wipe), so the button is safe to expose. On the
status page the three controls render as a set — **Update Orwell · Update + Reset · Factory Reset
(OOBE)** — and the combined button shows an "Updating + resetting… returning to OOBE" state, then
polls `/api/admin/health` and reloads once both services answer again (the same reconnect path as
the Update button).

The status page also carries a prominent **"Update Orwell (pull + rebuild + restart)"** button
(`POST /api/admin/update`, admin-gated, fixed command — no user input). It confirms first, then
shows an "Updating… reconnecting" state and polls `/api/admin/health`, reloading once both
services answer again. The endpoint runs the update through one of two privilege doors, in
priority order — and never silently 403s on `systemctl`:

1. **The flag trigger (default, recommended).** When `data/ops/` exists (the installer creates
   it), the endpoint just drops the existence-only flag above and the root path unit runs the
   script. **The web tier holds zero privilege; nothing extra is required.**
2. **The detached direct run (opt-in).** Set `ORWELL_UPDATE_DIRECT=1` to force, and
   `ORWELL_UPDATE_SUDO=1` to wrap the run as `sudo -n bash orwell-update.sh`. This path runs the
   fixed script with `subprocess.Popen(start_new_session=True)` (its own session, so the restart
   of `orwell-frontend` can't kill it) and returns `{started:true}` immediately. **Operator
   prerequisites for this path** — because the FE user is non-root and `systemctl`/`git
   pull`/`/etc/systemd` are otherwise denied:
   * Install the scoped sudoers drop-in: re-run `orwell-install.sh` with `ORWELL_UPDATE_SUDO=1`
     (writes `/etc/sudoers.d/orwell-update`, validated with `visudo -c`; grants the `orwell`
     user NOPASSWD for **exactly** `bash orwell-update.sh`, nothing else — see
     `deploy/sudoers/orwell-update`).
   * Clear `NoNewPrivileges=yes` for the FE unit (it blocks setuid `sudo`): add a drop-in
     `/etc/systemd/system/orwell-frontend.service.d/20-update-sudo.conf` with
     `[Service]\nNoNewPrivileges=no`, then `systemctl daemon-reload && systemctl restart
     orwell-frontend`. This relaxes one hardening knob for the FE unit, which is why the
     **flag-trigger door (1) is preferred** — it needs none of this.

Path/log are overridable for tests/dev via `ORWELL_UPDATE_SCRIPT` (default
`/opt/orwell/deploy/orwell-update.sh`) and `ORWELL_UPDATE_LOG` (default
`/opt/orwell/data/update.log`); the command itself is always fixed.

### The login health panel

Entering the container (`pct enter`, ssh) greets you with a live one-glance panel — both
units, both HTTP health probes, whether the tiers agree, the recall provider and model
cache, save count, load/mem, and the play URL — installed automatically by
install/update (`/usr/local/bin/orwell-panel`, hooked for interactive shells only). It is
hard-bounded (1s probe timeouts, ~100ms typical) and can never block a login. Run it any
time with `orwell-panel`.

### Doctor / bounce (when the game misbehaves)

When the chat says **"the live feeds are down"**, the engine banner shows, or things just look
wrong, run the doctor. Like update/factory-reset it is **host-aware**: run it on the **Proxmox
host** and it locates the orwell LXC (hostname `orwell`; `CTID=<id>` / `CT_HOSTNAME=<name>` to
override) and re-runs itself inside, or run it directly **inside the container** (legacy `bbai-*`
units auto-detected):

```bash
# from the Proxmox host (a local copy of the script; it bridges into the LXC)
bash deploy/orwell-doctor.sh
bash deploy/orwell-doctor.sh --status
CTID=112 bash deploy/orwell-doctor.sh --bounce

# or directly inside the container
bash /opt/orwell/deploy/orwell-doctor.sh             # diagnose; restart whatever is unhealthy; verify
bash /opt/orwell/deploy/orwell-doctor.sh --status    # diagnose only — no restarts
sudo bash /opt/orwell/deploy/orwell-doctor.sh --bounce  # force-restart engine + front-end; verify
```

It checks the full chain — units active → engine `/health` → the engine actually **serves tools**
→ the front-end's `/api/orwell/health` reports `engine:true` (the two tiers agree) — flags the
classic `ORWELL_ENGINE_MCP_URL` ↔ `ORWELL_ENGINE_PORT` mismatch in `data/.env`, restarts in
dependency order (engine first), and prints the failing unit's recent journal when a restart
doesn't cure it. Exit `0` means healthy. It also reads `systemd-analyze security` for both units
and warns when a unit's exposure score drifts above the hardening floor (audit E85; override with
`ORWELL_SECURITY_FLOOR=<score>`).

### Known harmless log noise (A11)

The engine's semantic-recall provider (fastembed / onnxruntime) logs, **twice at boot/prefetch**:

```
pthread_setaffinity_np ... error code: 22
```

This is **harmless and expected inside an LXC** whose cgroup cpuset doesn't grant the host CPU
indexes onnxruntime tries to pin its thread pool to. The threads simply run **unpinned** —
inference is unaffected, and it appears **once** (one session, one thread pool, created once),
never per inference. `fastembed-js` doesn't expose ORT's `intraOpNumThreads` to silence it, and
widening the container's cpuset is a worse trade, so there is **nothing to fix** — ignore it.
`orwell-doctor.sh` already filters this exact line out of the failing-unit journal tail (and
notes how many lines it hid) so it can never be mistaken for the actual crash reason.

## Config UX (community-scripts style)

On a TTY the installer shows a **whiptail menu** with every field pre-populated:

- **Use Defaults** — accept the detected/sensible values and go.
- **Advanced** — step through CTID, hostname, cores/RAM/disk, **rootfs & template storage**
  (auto-listed from `pvesm`), bridge, IP (`dhcp` or a static CIDR + gateway), UI port, branch,
  **OS template** (auto-listed from `pveam available`, newest highlighted), and the **LLM
  provider** (Anthropic key or Ollama host — written only into the container's `data/.env`).

**The OS template is resolved and downloaded automatically** (`pveam update` → newest
`debian-12-standard` → `pveam download`, with an offline fallback to one already on disk). This
is the fix for the common `volume 'local:vztmpl/debian-12-standard_…' does not exist` error —
templates are no longer hard-pinned or assumed pre-downloaded.

Non-interactive (piped, or `--default` / `USE_DEFAULTS=1` / `ORWELL_NONINTERACTIVE=1`) uses
defaults. **Every setting is also an env override**, so the same run is fully scriptable:

| Env var | Default | Purpose |
|---|---|---|
| `CTID` | next free id | container id |
| `CT_HOSTNAME` | `orwell` | hostname |
| `CORES` / `RAM_MB` / `DISK_GB` | `4` / `8192` / `12` | resources (recommended baseline 4 vCPU / 8 GB — see **Recommended specs**) |
| `STORAGE` | first `rootdir` storage → `local-lvm` | CT rootfs |
| `TEMPLATE_STORAGE` | first `vztmpl` storage → `local` | where the template is stored |
| `TEMPLATE_NAME` / `TEMPLATE` | newest `debian-12-standard` | pin a specific template |
| `BRIDGE` / `NET` / `GATEWAY` | `vmbr0` / `dhcp` / — | network (`NET` = `dhcp` or a CIDR) |
| `ORWELL_PORT` | `8080` | front-end UI port — ports **below 1024 (e.g. 80) are supported**: the installer/updater grant the hardened unit `CAP_NET_BIND_SERVICE` via a systemd drop-in (removed again when the port moves ≥1024) |
| `CT_ROOT_PASSWORD` | — | optional container **root password for console login** (≥5 chars; fed via stdin, never on a command line). Without it the LXC console rejects every login — use `pct enter <CTID>` from the host, or set one later with `pct exec <CTID> -- passwd` |
| `BRANCH` / `REPO` | `main` / this repo | source to install |
| `GIT_TOKEN` | — | the deploy PAT (private repo; → `data/.env`, never committed) |
| `ANTHROPIC_API_KEY` / `OLLAMA_HOST` | — | LLM provider (→ `data/.env`, never committed) |

```bash
# fully non-interactive example (the 4 vCPU / 8 GB baseline is the default — shown here explicitly)
export GIT_TOKEN=github_pat_xxx
CTID=104 CORES=4 RAM_MB=8192 DISK_GB=12 NET=dhcp ORWELL_PORT=8080 \
  bash -c "$(curl -fsSL -H "Authorization: Bearer $GIT_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/kevinhirsch/orwell/contents/deploy/orwell.sh?ref=main")" --default
```

## Layout

| File | Role |
|---|---|
| `orwell.sh` | Host-side: create the Proxmox LXC, bootstrap the **git checkout** inside it (persisting `GIT_TOKEN` + the credential helper — A4), then run the **checked-out** in-container installer. |
| `orwell-install.sh` | apt + Node 22 (apt-signed repo, no `curl \| bash`) + Python; checkout; verify + `npm run build`; front-end deps from the **pinned `requirements.lock.txt`** (E83); write `.env` (engine token, multi-user mode); register + start services. Also installs **`qemu-guest-agent`** (Proxmox guest tools). |
| `orwell-update.sh` | `git pull` → `npm run build` → restart — **never touches `data/`** (the save). Host-aware: on a Proxmox host it bridges into the LXC (`pct`) via its **local copy** (or the in-container copy — never a GitHub fetch); inside the container it runs directly. `--set-token` persists/rotates the deploy PAT. Auto-detects the app dir (`/opt/orwell`, or legacy `/opt/bbai`) and the matching service names. |
| `orwell-factory-reset.sh` | **Wipe back to OOBE.** Stops the services, removes every per-user game sandbox (saves/souls/Vault under `data/<user>/`) and the entire front-end store (`frontend/data/` — DB, settings, uploads, app key), then restarts so the next visit starts at first-run onboarding. **Preserves `data/.env`** (config). Destructive — prompts for `RESET` unless `--yes`; `--dry-run` previews. |
| `orwell-oobe-reset.sh` | **Wipe back to OOBE, but KEEP the API-key / LLM config.** Same scrub as the factory reset (all accounts, chats, memory, MCP configs, settings, uploads, and every game) **except** it preserves the configured LLM/image providers (`model_endpoints`), the LLM-selection settings, and the keys that decrypt them (`.app_key`, `.key`, `api_keys.json`) — so an LLM is still configured at OOBE. Never touches `data/.env`. Delegates the FE-store surgery to `frontend/scripts/oobe_reset.py`. This is the script the admin **Factory Reset (OOBE)** button runs. Destructive — prompts for `RESET` unless `--yes`; `--dry-run` previews. |
| `orwell-update-reset.sh` | **Update, THEN OOBE reset — the combined middle tier (keep the API-key / LLM config).** Composes the two scripts above (re-implements neither): runs `orwell-update.sh --no-restart` (pull → rebuild → refresh FE deps), and **only if it succeeds** runs `orwell-oobe-reset.sh --yes` (wipe to first-run, preserve the LLM config, single final restart). **Fail-closed** — a failed update never wipes; a missing reset helper refuses up front. Never touches `data/.env`. This is the script the admin **Update + Reset** button runs. Host-aware bridge + `--yes` / `--dry-run` / `--no-restart`; prompts for `RESET` unless `--yes`. |
| `frontend/scripts/oobe_reset.py` | The keep-API-keys FE-store surgery: export `model_endpoints` + the LLM-selection settings, rebuild a fresh `app.db` / `settings.json` carrying ONLY those, so no other table survives. Stdlib-`sqlite3` only (no SQLAlchemy/`core`); idempotent; honors `DATA_DIR` / `DATABASE_URL`. |
| `systemd/orwell-engine.service` | `npm start` (the MCP server). |
| `systemd/orwell-frontend.service` | `uvicorn app:app` (Orwell), reads `ORWELL_ENGINE_MCP_URL`. |
| `systemd/orwell-ops-update.path` | Root-side watcher (G19b): `PathExists=` on `data/ops/update-requested` (written by the sandboxed FE) → starts the runner. Existence-only — flag content is never parsed or executed. |
| `systemd/orwell-ops-update.service` | Oneshot **root** runner (G19b — deliberately unsandboxed; the unit documents why): removes the flag first, takes a `flock`, runs **only** `deploy/orwell-update.sh`, output appended to `data/ops-update.log` (tailed live by the status page). |
| `systemd/orwell-ops-factory-reset.path` | Root-side watcher for the admin **Factory Reset (OOBE)** button: `PathExists=` on `data/ops/factory-reset-requested` → starts the reset runner. Existence-only, same contract as the update watcher. |
| `systemd/orwell-ops-factory-reset.service` | Oneshot **root** runner: removes the flag first, takes a `flock`, runs **only** `deploy/orwell-oobe-reset.sh --yes` (the browser already confirmed `RESET`), output appended to `data/ops-factory-reset.log`. |
| `systemd/orwell-ops-update-reset.path` | Root-side watcher for the admin **Update + Reset** button: `PathExists=` on `data/ops/update-reset-requested` → starts the combined runner. Existence-only, same contract as the other watchers. |
| `systemd/orwell-ops-update-reset.service` | Oneshot **root** runner: removes the flag first, takes a `flock`, runs **only** `deploy/orwell-update-reset.sh --yes` (update with restart suppressed, then OOBE reset with the single final restart; fail-closed), output appended to `data/ops-update-reset.log`. |

## Proxmox guest tools

`qemu-guest-agent` is installed by `orwell-install.sh`, but it is a **VM-only** transport
(virtio-serial) that does not exist in an LXC. The installer therefore **enables it only when that
transport is present** (a real VM); in an LXC it stays installed-but-dormant — the Proxmox host
already manages the container directly (IP in the UI, `pct shutdown`, vzdump backups all work
without an agent), and this avoids a perpetually-failing systemd unit. If a VM deploy mode is added
later, set `qm set <vmid> --agent enabled=1` host-side and the pre-installed agent activates.

## Validation & remaining wiring

- **Automated smoke:** [`deploy/smoke.sh`](./smoke.sh) builds + starts the engine, probes the HTTP
  MCP surface, exercises the player game tools (`createCharacter` → `getGameState` →
  `getMomentPrompt` → `runCompetition`, and proves the removed `resolveCompetition` is refused —
  audit E20), proves channel isolation, and simulates an update (rebuild + restart) — asserting
  **behaviorally** that the pre-update game resumes from disk and the update script never deletes
  the save (E80), that no hidden-layer NUMBER (`physical`/`mental`/`social`/`trust`/`affinity`/
  `threat`) leaks from a player surface, that the **A4 credential helper** hands git the `.env`
  token, and that no deploy script fetches from `raw.githubusercontent.com` (E84). It runs
  offline, locally and in CI (`.github/workflows/ci.yml`).
- **On-host validation** remains the full Proxmox-LXC provisioning (provision → one-liner install →
  curl the UI → update → assert the save survived) — that part can't run in GitHub Actions (no LXC)
  and is the on-box test.
- Two pieces complete the end-to-end game and are owned outside these scripts:
  1. the engine's **HTTP MCP transport** + `build`/`start` entrypoint (the implementer);
  2. the **Orwell → engine MCP** client wiring (`frontend/INTEGRATION.md`).
  The scripts already provision and run both services and pass the engine endpoint via
  `ORWELL_ENGINE_MCP_URL`; once 1 & 2 land, the one-liner yields a playable game.

All secrets live in `/opt/orwell/data/.env` — never committed.

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

## Usage

```bash
# install — on the Proxmox host shell
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell.sh)"
# update — host or inside the container
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell-update.sh)"
```

The update one-liner works **either** on the Proxmox host **or** inside the container: the app and
its git checkout live in the LXC (the host has no `git` / no app dir), so when run on the host the
script locates the orwell container (by hostname `orwell`) and re-runs itself inside it via `pct` —
the same bridge the installer uses. Override the target with `CTID=<id>` (or `CT_HOSTNAME=<name>`)
if you renamed the container or run more than one. A container provisioned **before** the
`bbai → orwell` rename (app in `/opt/bbai`, `bbai-*` services) is auto-detected and updated in place
— the engine and front-end still honor the deprecated `BBAI_*` env, so its `data/.env` keeps working
untouched.

### Factory reset (back to OOBE)

To scrub **all** game + user data and start over as if freshly installed — every sandbox (saves,
souls, the hidden Vault layer) and the whole front-end store (accounts, settings, uploads) — run it
either **on the Proxmox host** (it bridges into the LXC, like `orwell-update.sh`) or **inside the
container as root**:

```bash
# from the Proxmox host (auto-locates the orwell LXC; CTID=<id> if not named "orwell")
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell-factory-reset.sh)"
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell-factory-reset.sh)" -- --dry-run
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell-factory-reset.sh)" -- --yes

# or directly inside the container
bash /opt/orwell/deploy/orwell-factory-reset.sh             # prompts: type RESET
bash /opt/orwell/deploy/orwell-factory-reset.sh --dry-run   # preview what would be removed
```

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
| `CORES` / `RAM_MB` / `DISK_GB` | `2` / `2048` / `8` | resources |
| `STORAGE` | first `rootdir` storage → `local-lvm` | CT rootfs |
| `TEMPLATE_STORAGE` | first `vztmpl` storage → `local` | where the template is stored |
| `TEMPLATE_NAME` / `TEMPLATE` | newest `debian-12-standard` | pin a specific template |
| `BRIDGE` / `NET` / `GATEWAY` | `vmbr0` / `dhcp` / — | network (`NET` = `dhcp` or a CIDR) |
| `ORWELL_PORT` | `8080` | front-end UI port |
| `BRANCH` / `REPO` | `main` / this repo | source to install |
| `ANTHROPIC_API_KEY` / `OLLAMA_HOST` | — | LLM provider (→ `data/.env`, never committed) |

```bash
# fully non-interactive example
CTID=104 CORES=4 RAM_MB=4096 DISK_GB=12 NET=dhcp ORWELL_PORT=8080 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell.sh)" --default
```

## Layout

| File | Role |
|---|---|
| `orwell.sh` | Host-side: create the Proxmox LXC, then run the in-container install. |
| `orwell-install.sh` | apt + Node 22 + Python; clone; verify + `npm run build`; front-end deps; write `.env`; register + start services. Also installs **`qemu-guest-agent`** (Proxmox guest tools). |
| `orwell-update.sh` | `git pull` → `npm run build` → restart — **never touches `data/`** (the save). Host-aware: on a Proxmox host it bridges into the LXC (`pct`) and updates there; inside the container it runs directly. Auto-detects the app dir (`/opt/orwell`, or legacy `/opt/bbai`) and the matching service names. |
| `orwell-factory-reset.sh` | **Wipe back to OOBE.** Stops the services, removes every per-user game sandbox (saves/souls/Vault under `data/<user>/`) and the entire front-end store (`frontend/data/` — DB, settings, uploads, app key), then restarts so the next visit starts at first-run onboarding. **Preserves `data/.env`** (config). Destructive — prompts for `RESET` unless `--yes`; `--dry-run` previews. |
| `systemd/orwell-engine.service` | `npm start` (the MCP server). |
| `systemd/orwell-frontend.service` | `uvicorn app:app` (Orwell), reads `ORWELL_ENGINE_MCP_URL`. |

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
  `getMomentPrompt` → `resolveCompetition`), proves channel isolation, and simulates an update
  (rebuild + restart). It runs offline, locally and in CI (`.github/workflows/ci.yml`), and
  asserts the update script never deletes the save.
- **On-host validation** remains the full Proxmox-LXC provisioning (provision → one-liner install →
  curl the UI → update → assert the save survived) — that part can't run in GitHub Actions (no LXC)
  and is the on-box test.
- Two pieces complete the end-to-end game and are owned outside these scripts:
  1. the engine's **HTTP MCP transport** + `build`/`start` entrypoint (the implementer);
  2. the **Orwell → engine MCP** client wiring (`frontend/INTEGRATION.md`).
  The scripts already provision and run both services and pass the engine endpoint via
  `ORWELL_ENGINE_MCP_URL`; once 1 & 2 land, the one-liner yields a playable game.

All secrets live in `/opt/orwell/data/.env` — never committed.

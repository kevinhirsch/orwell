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
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/orwell.sh)"
# update — host or inside the container
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/orwell-update.sh)"
```

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
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/orwell.sh)" --default
```

## Layout

| File | Role |
|---|---|
| `orwell.sh` | Host-side: create the Proxmox LXC, then run the in-container install. |
| `orwell-install.sh` | apt + Node 22 + Python; clone; verify + `npm run build`; front-end deps; write `.env`; register + start services. Also installs **`qemu-guest-agent`** (Proxmox guest tools). |
| `orwell-update.sh` | `git pull` → `npm run build` → restart — **never touches `data/`** (the save). |
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

- **Validation is an install smoke test on a real Proxmox host / CI** (provision → install →
  curl the UI → update → assert the save survived). It is **not** runnable in the dev sandbox
  and is **not** part of the BDD/unit suite.
- Two pieces complete the end-to-end game and are owned outside these scripts:
  1. the engine's **HTTP MCP transport** + `build`/`start` entrypoint (the implementer);
  2. the **Orwell → engine MCP** client wiring (`frontend/INTEGRATION.md`).
  The scripts already provision and run both services and pass the engine endpoint via
  `ORWELL_ENGINE_MCP_URL`; once 1 & 2 land, the one-liner yields a playable game.

All secrets live in `/opt/orwell/data/.env` — never committed.

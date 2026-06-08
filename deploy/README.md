# deploy/ — one-liner Proxmox install & update

Spec: [`docs/features/0010-deployment-one-liner.md`](../docs/features/0010-deployment-one-liner.md).

The scripts target the engine's standard contract — **`npm run build` + `npm start`** — and the
in-container installer **verifies that contract before building** (a not-yet-runnable checkout
fails clearly instead of half-installing). One Proxmox LXC runs both tiers as systemd services:

```
 LXC (Debian)
   ├─ bbai-engine.service     Node:   npm start  -> MCP server on 127.0.0.1:${BBAI_ENGINE_PORT}
   └─ bbai-frontend.service   Python: uvicorn app:app on 0.0.0.0:${BBAI_PORT}
   data: /opt/bbai/data       .env (secrets) + the save (SQLite + souls); preserved across updates
```

## Usage

```bash
# install — on the Proxmox host shell
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
# update — host or inside the container
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai-update.sh)"
```

## Layout

| File | Role |
|---|---|
| `bbai.sh` | Host-side: create the Proxmox LXC, then run the in-container install. |
| `bbai-install.sh` | apt + Node 22 + Python; clone; verify + `npm run build`; front-end deps; write `.env`; register + start services. |
| `bbai-update.sh` | `git pull` → `npm run build` → restart — **never touches `data/`** (the save). |
| `systemd/bbai-engine.service` | `npm start` (the MCP server). |
| `systemd/bbai-frontend.service` | `uvicorn app:app` (odysseus), reads `BBAI_ENGINE_MCP_URL`. |

## Validation & remaining wiring

- **Validation is an install smoke test on a real Proxmox host / CI** (provision → install →
  curl the UI → update → assert the save survived). It is **not** runnable in the dev sandbox
  and is **not** part of the BDD/unit suite.
- Two pieces complete the end-to-end game and are owned outside these scripts:
  1. the engine's **HTTP MCP transport** + `build`/`start` entrypoint (the implementer);
  2. the **odysseus → engine MCP** client wiring (`frontend/INTEGRATION.md`).
  The scripts already provision and run both services and pass the engine endpoint via
  `BBAI_ENGINE_MCP_URL`; once 1 & 2 land, the one-liner yields a playable game.

All secrets live in `/opt/bbai/data/.env` — never committed.

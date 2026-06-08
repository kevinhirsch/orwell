# deploy/ — one-liner Proxmox install & update (DRAFT scaffold)

Spec: [`docs/features/0010-deployment-one-liner.md`](../docs/features/0010-deployment-one-liner.md).

## Status: DRAFT — not yet functional

The structure is here; the **app build/run steps are `TODO`** until the MVP-1 critical path lands:

1. **Feature 0009 built** — the engine gains `npm run build` + a `bbai-engine` MCP-server start
   entrypoint (today the engine runs via `tsx` with no build/start).
2. **Front-end wired** — odysseus's agent points at the engine's MCP server (see
   `frontend/INTEGRATION.md`), with a real Ollama/Anthropic narration adapter.

Until then, the host installer **refuses to run** unless `BBAI_ALLOW_DRAFT=1` is set, so a broken
one-liner can't circulate. When 1 & 2 land: fill the `TODO(0009)` markers, drop the guard, and
add the install smoke test (0010 §6).

## Layout

| File | Role |
|---|---|
| `bbai.sh` | Host-side one-liner: create the Proxmox LXC, then run the in-container install. |
| `bbai-install.sh` | In-container: apt deps, Node 22, Python, clone, build, config, services. |
| `bbai-update.sh` | In-container: pull, rebuild, restart — **never touches `data/`** (the save). |
| `systemd/bbai-engine.service` | The TS engine (MCP server) unit. |
| `systemd/bbai-frontend.service` | The odysseus front-end (uvicorn) unit. |

## Usage (once functional)

```bash
# install — on the Proxmox host shell
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
# update — host or inside the container
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai-update.sh)"
```

The game's state lives at `/opt/bbai/data` (SQLite save + souls) and is preserved across updates.
All secrets come from `/opt/bbai/data/.env` — never committed.

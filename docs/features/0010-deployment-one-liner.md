# 0010 — One-liner deployment & update (Proxmox, containerized)

> **Status:** Draft. **Priority:** **MVP-1 (blocking)** — per product call, the deploy + update
> scripts are part of MVP 1, not a later add-on.
> **Executable spec:** [`0010-deployment-one-liner.feature`](./0010-deployment-one-liner.feature)

## 1. Summary

Two one-liners, run from the **Proxmox host shell**, in the spirit of the Proxmox VE
community-scripts:

```bash
# install
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
# update
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai-update.sh)"
```

The install creates a **container** and brings up bbai (the TS engine **and** the orwell
front-end, wired over local MCP per feature 0009); the update pulls, rebuilds, and restarts
**without losing the save**. Easy to deploy, easy to update.

The scripts live in [`deploy/`](../../deploy/) (`bbai.sh`, `bbai-install.sh`, `bbai-update.sh`,
`systemd/`). They target the engine's `npm run build` / `npm start` contract and **verify it
before building**. What remains for an end-to-end game is the engine's HTTP MCP transport and the
orwell → engine MCP-client wiring; validation is an **install smoke test on a real Proxmox host**
(not the dev sandbox; not BDD).

## 2. Approach (containerization)

**Primary: Proxmox LXC** (community-scripts idiom — matches the referenced one-liner, lightest,
cleanest UX). One LXC runs both tiers as **systemd services**, wired over local MCP (stdio or
`127.0.0.1` HTTP):

```
 Proxmox host ──one-liner──► LXC (Debian)
                               ├─ bbai-engine.service     (Node: MCP server, feature 0009)
                               └─ bbai-frontend.service   (Python: uvicorn app:app — orwell)
                               data: /opt/bbai/data  (SQLite save + souls; persists across updates)
```

*Alternative (noted, not primary): Docker-compose inside an LXC/VM* — reuses container images
for the two tiers; heavier, less idiomatic for the one-liner. Pick LXC unless we want image-based
distribution.

## 3. Install script — `deploy/bbai.sh` (host) + `deploy/bbai-install.sh` (in-container)

**Host side** (`bbai.sh`): create a Debian 12 LXC (sensible CPU/RAM/disk defaults, DHCP),
then run `bbai-install.sh` inside. Structurally aligns with community-scripts `build.func`
(can source it, or stay self-contained).

**In-container** (`bbai-install.sh`):
1. `apt update`; install `curl git build-essential`, **Node 22** (nodesource), **Python 3.12** + `venv`.
2. `git clone` bbai → `/opt/bbai`.
3. **Engine:** `npm ci` → `npm run build` → provides `bbai-engine` (the MCP server entrypoint, 0009).
4. **Front-end:** `python -m venv frontend/.venv` → `frontend/.venv/bin/pip install -r frontend/requirements.txt`.
5. **Config:** copy `frontend/.env.example` → `/opt/bbai/data/.env`; set ports, LLM provider
   (Ollama host or Anthropic API key), and the engine MCP endpoint.
6. **Services:** write + enable `bbai-engine.service` and `bbai-frontend.service`; start both.
7. Print: `bbai is running at http://<container-ip>:<port>`.

## 4. Update script — `deploy/bbai-update.sh` (idempotent, data-safe)

Inside the container: `cd /opt/bbai` → `git pull` → `npm ci && npm run build` →
`frontend/.venv/bin/pip install -r frontend/requirements.txt` → `systemctl restart bbai-engine
bbai-frontend`. **`/opt/bbai/data` is never touched** (saves/souls preserved — ties to #7
non-degradation). Re-running install is also safe (detects an existing install → updates).

## 5. Config & secrets

- All config via env / `/opt/bbai/data/.env` (LLM provider + keys, ports, MCP endpoint). **No
  secret is ever committed or baked into a script.** `.env.example` documents every variable.
- The container **is** the sandbox (one game namespace); each game's state lives under `data/`.

## 6. Acceptance criteria / Definition of Done

- [ ] On a **fresh Proxmox host**, the install one-liner creates the container and brings the UI
      up reachable on its port, with **no manual steps** beyond entering LLM config.
- [ ] The update one-liner pulls + rebuilds + restarts and the **existing save survives**.
- [ ] Both scripts are **idempotent** (safe to re-run).
- [ ] Secrets come only from env/`.env`; nothing sensitive is committed.
- [ ] An install **smoke test** (CI: provision a container, run install, curl the UI health
      endpoint, run update, assert save intact) passes.

## 7. Dependencies (why this is sequenced after 0009)

The scripts are **designed now**; they go **functional** once the app is runnable end-to-end:
- **0009** built — the engine exposes a **`bbai-engine` MCP-server entrypoint** + `npm run build`
  / start scripts (the engine currently runs via `tsx` with no `build`/`start` — that lands with 0009).
- The **orwell front-end wired** to the engine (per `frontend/INTEGRATION.md`) with a known
  run command (`uvicorn app:app`) and the MCP endpoint configured.
- **#7** persistence: a stable `data/` save path.

So the **MVP-1 critical path** is: build 0009 → engine `start` entrypoint + front-end wiring →
finalize + smoke-test these scripts. MVP 1 is **not done until these are green**.

## 8. Traceability

The referenced Proxmox community-scripts one-liner pattern; feature 0009 (topology); feature
0007 (persistent save); `frontend/INTEGRATION.md` (the two tiers); `CLAUDE.md` sandboxing
("each running game is its own isolated sandbox").

# Installing & updating Orwell

Orwell runs as **two co-located services in one container**:

- **engine** — TypeScript, the MCP server: game rules, the Vault, the permissioned tool API.
- **front-end** — Orwell (Python/FastAPI): the chat UI + LLM connection + agent.

They talk over **local MCP**. The Vault Wall holds: the front-end only ever receives visible
projections, never Vault data.

---

## Requirements

- **Recommended:** a Proxmox VE host (the one-liner creates an LXC for you).
- **Or** any Debian/Ubuntu box with **Node 22+**, **Python 3.12+**, and **git**.
- **An LLM:** a local **Ollama**, or an API key (Anthropic / OpenAI / OpenRouter / …).

---

## Quick install (Proxmox)

The repo is **private**: create a fine-grained PAT once (scope: `kevinhirsch/orwell`,
**Contents: Read-only**, nothing else), then run on the **Proxmox host shell** — this is the
**single authenticated moment**; the token is persisted into the container's `data/.env` and
every later update/reset reads it from there via a git credential helper (no re-prompt, never
in a URL or `.git/config`):

```bash
export GIT_TOKEN=github_pat_xxx   # fine-grained (Contents: Read-only) OR classic (repo scope)
bash -c "$(curl -fsSL -H "Authorization: Bearer $GIT_TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/kevinhirsch/orwell/contents/deploy/orwell.sh?ref=main")"
```

This creates a Debian LXC and installs everything. Override defaults via env before the command:
`CTID`, `CORES`, `RAM_MB`, `DISK_GB`, `BRIDGE`, `STORAGE`, `ORWELL_PORT`. When it finishes it prints
the UI URL.

Fine-grained PATs cap at one year: rotate with `bash /opt/orwell/deploy/orwell-update.sh
--set-token` (also the one-time setup path for an install that predates the private flip).

---

## Configuration — `/opt/orwell/data/.env`

| Variable | Meaning | Default |
|---|---|---|
| `ORWELL_PORT` | front-end UI port | `8080` |
| `ORWELL_ENGINE_PORT` | engine MCP server (loopback) | `8765` |
| `ORWELL_ENGINE_HOST` | engine bind address | `127.0.0.1` |
| `ORWELL_ENGINE_MCP_URL` | front-end → engine | `http://127.0.0.1:8765` |
| `ORWELL_ENGINE_TOKEN` | shared secret required on every engine tool call (the installer generates one) | set by installer |
| `ORWELL_ENGINE_MULTIUSER` | reject a request with no `x-orwell-user` instead of routing to a shared `default` sandbox | `1` (set by installer) |
| `GIT_TOKEN` | the deploy PAT (private repo) — read by the git credential helper at fetch time | set by installer |
| `SECURE_COOKIES` | set `true` behind TLS: front-end session cookies get the `Secure` flag | — (off) |
| `OLLAMA_HOST` **or** `ANTHROPIC_API_KEY` | the LLM (set one) | — |

After editing: `systemctl restart orwell-engine orwell-frontend`.

---

## Control panel — the `orwell` command

Inside the container, **`orwell`** opens a whiptail menu over every maintenance task — no need to
remember script paths or flags:

```bash
orwell            # menu: update · doctor · backup · restore · reset (game/factory) · readiness
```

It dispatches to the scripts below, collecting input through dialogs (a deploy-token password box,
a backup picker, a type-`RESET` confirmation for the destructive resets). Direct subcommands skip
the menu — handy over SSH or in scripts:

```bash
orwell update             # = orwell-update.sh        orwell doctor --status
orwell backup             # orwell restore [FILE]     orwell ready
orwell reset-game --yes   # destructive: --yes required off the menu
orwell reset-factory --yes
```

The individual scripts (`deploy/orwell-*.sh`) also show these dialogs when run directly on a
terminal, and stay fully non-interactive (today's flags/env) for automation, CI, and the
host→container bridge. whiptail is installed by the installer; without it (or off a TTY) the
scripts fall back to plain prompts. The launcher is `deploy/orwell-menu.sh`; the shared dialog
helpers live in `deploy/orwell-tui.sh`.

---

## Update

Run the **local checked-out copy** — no script fetches from GitHub anymore (the repo is private;
`git pull` authenticates via the credential helper + `GIT_TOKEN` in `data/.env`):

```bash
# inside the container — or from the Proxmox host with a checkout (it bridges into the LXC)
bash /opt/orwell/deploy/orwell-update.sh
```

Pulls latest, rebuilds the engine (`npm run build`), refreshes front-end deps from the pinned
`requirements.lock.txt`, and restarts both services. **Your save (`/opt/orwell/data`) is never
touched.**

---

## Manual / non-Proxmox install

```bash
# Private repo: authenticate the clone once with your PAT, then keep the token OUT of git config
# (the credential helper reads it from data/.env at fetch time — set it up below).
git -c credential.helper='!f(){ echo username=x-access-token; echo password=$GIT_TOKEN; };f' \
  clone https://github.com/kevinhirsch/orwell.git /opt/orwell && cd /opt/orwell
npm ci && npm run build                                  # engine
( cd frontend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.lock.txt )
mkdir -p data && cp frontend/.env.example data/.env      # then edit data/.env (LLM + ports)
echo "GIT_TOKEN=github_pat_xxx" >> data/.env && chmod 600 data/.env
git config --system credential.helper \
  '!f(){ echo username=x-access-token; echo "password=$(sed -n s/^GIT_TOKEN=//p /opt/orwell/data/.env)"; };f'

# run the two services (e.g. in two shells, or use the units in deploy/systemd/):
npm start                                                # engine — MCP server
( cd frontend && ./.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080 )   # front-end UI
```

Persistent setup: install the units from `deploy/systemd/` and `systemctl enable --now
orwell-engine orwell-frontend`.

---

## Services & logs

```bash
systemctl status orwell-engine orwell-frontend
journalctl -u orwell-engine -f
journalctl -u orwell-frontend -f
```

---

## Data & backups

State lives in **two** places (B72 — the old prose misstated this):

| Dir | What |
|---|---|
| `/opt/orwell/data/` | engine config — `.env` (incl. the generated `ORWELL_ENGINE_TOKEN`) — and **`saves/`** (the per-user games: JSON snapshots incl. souls + the hidden layer) |
| `/opt/orwell/frontend/data/` | the front-end SQLite (`app.db`: accounts, chats, settings) + uploads |

- **Backup:** `bash deploy/orwell-backup.sh [dest]` — one timestamped tarball covering **both** dirs.
- **Restore:** `bash deploy/orwell-restore.sh <backup.tar.gz>` — stops services, restores, fixes
  ownership, restarts.
- **Readiness:** `bash deploy/orwell-ready.sh` — not just liveness: engine reachable + front-end up
  + an LLM genuinely configured (at least one online model). Exit 0 = a player can sit down and play.
- **Update pin/rollback (B71):** `REF=<sha|tag> orwell-update.sh` pins; `orwell-update.sh --rollback`
  returns to the previous SHA + build. A failed build never restarts services.

Updates never touch either data dir (non-degradation, feature 0007).

---

## Security

- Secrets (LLM keys) live **only** in `/opt/orwell/data/.env` — never committed.
- The engine MCP server binds **loopback** (`ORWELL_ENGINE_HOST=127.0.0.1`); only the front-end UI
  port is exposed. **Engine auth is ON by default** (B67): the installer generates a shared
  `ORWELL_ENGINE_TOKEN` into `data/.env` — the engine enforces it on every tool route (401 without
  it) and the front-end sends it automatically (`Authorization: Bearer …`; `BBAI_ENGINE_TOKEN` is
  the legacy fallback). **Multi-user mode is also ON by default** (audit E32): the installer sets
  `ORWELL_ENGINE_MULTIUSER=1` — every request must assert its `x-orwell-user`, and an anonymous
  front-end call sends NO user header (it is refused, never silently collapsed into a shared
  `default` sandbox). The engine caps the asserted user id at 64 chars and compares the bearer
  token in constant time. Behind TLS, also set `SECURE_COOKIES=true`.
- Each container is its own **sandbox** (one game namespace). The **Vault Wall** keeps secret game
  state off every player-facing surface — enforced structurally, not by prompt.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `engine 'build'/'start' scripts not found` | the engine entrypoint hasn't landed on your branch — update and retry |
| UI not reachable | `systemctl status orwell-frontend`; check the firewall on `ORWELL_PORT` |
| Engine won't start | `journalctl -u orwell-engine -e`; confirm `npm run build` succeeded |
| LLM errors | confirm `OLLAMA_HOST` is reachable or `ANTHROPIC_API_KEY` is set in `.env` |

---

## See also

- [`deploy/README.md`](../deploy/README.md) — deploy internals + the engine contract.
- [`docs/features/0010-deployment-one-liner.md`](features/0010-deployment-one-liner.md) — the deployment spec.

# Installing & updating bbai

bbai runs as **two co-located services in one container**:

- **engine** — TypeScript, the MCP server: game rules, the Vault, the permissioned tool API.
- **front-end** — orwell (Python/FastAPI): the chat UI + LLM connection + agent.

They talk over **local MCP**. The Vault Wall holds: the front-end only ever receives visible
projections, never Vault data.

---

## Requirements

- **Recommended:** a Proxmox VE host (the one-liner creates an LXC for you).
- **Or** any Debian/Ubuntu box with **Node 22+**, **Python 3.12+**, and **git**.
- **An LLM:** a local **Ollama**, or an API key (Anthropic / OpenAI / OpenRouter / …).

---

## Quick install (Proxmox)

Run on the **Proxmox host shell**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
```

This creates a Debian LXC and installs everything. Override defaults via env before the command:
`CTID`, `CORES`, `RAM_MB`, `DISK_GB`, `BRIDGE`, `STORAGE`, `BBAI_PORT`. When it finishes it prints
the UI URL.

---

## Configuration — `/opt/bbai/data/.env`

| Variable | Meaning | Default |
|---|---|---|
| `BBAI_PORT` | front-end UI port | `8080` |
| `BBAI_ENGINE_PORT` | engine MCP server (loopback) | `8765` |
| `BBAI_ENGINE_MCP_URL` | front-end → engine | `http://127.0.0.1:8765` |
| `OLLAMA_HOST` **or** `ANTHROPIC_API_KEY` | the LLM (set one) | — |

After editing: `systemctl restart bbai-engine bbai-frontend`.

---

## Update

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai-update.sh)"
```

Pulls latest, rebuilds the engine (`npm run build`), and restarts both services. **Your save
(`/opt/bbai/data`) is never touched.**

---

## Manual / non-Proxmox install

```bash
git clone https://github.com/kevinhirsch/bbai.git /opt/bbai && cd /opt/bbai
npm ci && npm run build                                  # engine
( cd frontend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt )
mkdir -p data && cp frontend/.env.example data/.env      # then edit data/.env (LLM + ports)

# run the two services (e.g. in two shells, or use the units in deploy/systemd/):
npm start                                                # engine — MCP server
( cd frontend && ./.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080 )   # front-end UI
```

Persistent setup: install the units from `deploy/systemd/` and `systemctl enable --now
bbai-engine bbai-frontend`.

---

## Services & logs

```bash
systemctl status bbai-engine bbai-frontend
journalctl -u bbai-engine -f
journalctl -u bbai-frontend -f
```

---

## Data & backups

Everything stateful is under **`/opt/bbai/data`** — the `.env`, the SQLite save, and the souls.
Back it up by copying that directory; restore by putting it back before starting. Updates never
touch it (non-degradation, feature 0007).

---

## Security

- Secrets (LLM keys) live **only** in `/opt/bbai/data/.env` — never committed.
- The engine MCP server binds **loopback**; only the front-end UI port is exposed.
- Each container is its own **sandbox** (one game namespace). The **Vault Wall** keeps secret game
  state off every player-facing surface — enforced structurally, not by prompt.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `engine 'build'/'start' scripts not found` | the engine entrypoint hasn't landed on your branch — update and retry |
| UI not reachable | `systemctl status bbai-frontend`; check the firewall on `BBAI_PORT` |
| Engine won't start | `journalctl -u bbai-engine -e`; confirm `npm run build` succeeded |
| LLM errors | confirm `OLLAMA_HOST` is reachable or `ANTHROPIC_API_KEY` is set in `.env` |

---

## See also

- [`deploy/README.md`](../deploy/README.md) — deploy internals + the engine contract.
- [`docs/features/0010-deployment-one-liner.md`](features/0010-deployment-one-liner.md) — the deployment spec.

# Vendored: Odysseus — bbai's player front-end + LLM/agent tier

## What this is

A vendored copy of **Odysseus** (https://github.com/pewdiepie-archdaemon/odysseus, MIT —
see [`LICENSE`](./LICENSE) and [`ACKNOWLEDGMENTS.md`](./ACKNOWLEDGMENTS.md), retained intact).
Odysseus is a self-hosted AI workspace: **Python (FastAPI) backend + vanilla-JS PWA**, with a
multi-provider LLM connection (Ollama, OpenAI, OpenRouter, Anthropic, llama.cpp, vLLM) and an
**agent** built on opencode / MCP.

We reuse it as bbai's **player front-end + LLM-connection + agent tier** rather than building
those from scratch.

## Role in bbai (polyglot, two tiers)

- **bbai core** = the TypeScript hexagonal **engine** (`/src`) — game rules, the Vault, ports.
  Stays the single source of truth.
- **`frontend/`** (this) = a **Python service** — the UI + LLM connection + agent. Runs as its
  **own process**, separate from the Node engine.
- They meet over a **permissioned boundary** (below) — the MCP boundary the design always
  planned; the narrative LLM was always meant to sit behind a port.

## Quarantine (important)

`frontend/` is intentionally **outside** bbai's TypeScript tooling — `tsconfig.json`
(`include: src, tests, features`), Vitest (`tests/**`), Cucumber (`docs/features`), and
dependency-cruiser (`src`) do **not** touch it. The Vault-Wall architecture test is unaffected.
Treat `frontend/` as a separate app with its own deps (`requirements.txt`, its own
`package.json`).

## MVP keep-set

**Chat UI + multi-provider LLM connection + agent (MCP/tooling).** The agent is the
integration linchpin — it's what drives the game.

## Integration plan (the refactor — next)

1. The bbai engine exposes the game as a permissioned **MCP server**: `getVisibleStateFor`,
   `recordInteraction`, `resolveCompetition`, `surfaceInformationTo` (the tools in
   `CLAUDE.md` / the spec). These return **only visible-projection data**.
2. Point odysseus's agent (`routes/mcp_routes.py`, `mcp_servers/`) at that MCP server as a
   tool backend; the LLM narrates *Big Brother* by calling the engine tools.
3. **The Vault Wall holds by construction:** `frontend/` never imports `VaultStore` and only
   receives visible projections over the boundary — the model can't leak what it never gets.
4. Build the BB-specific surfaces (narrated scene view, Diary Room, house/houseguest panels)
   on top of the chat shell.

## What was trimmed (footprint only — no application code removed)

Removed to keep the repo lean; none of it affects chat/agent:
- demo media (`docs/*.gif|*.webm`), marketing docs (`docs/`, `ROADMAP`/`SECURITY`/`THREAT_MODEL`/`CONTRIBUTING`),
- deployment scaffolding (`docker/`, `docker-compose*`, `Dockerfile`, build/start/launch/install scripts, `*.service`, `.github/`),
- odysseus's own `tests/`,
- heavy document-export libs (`static/lib/{xlsx,docx,mammoth,html2pdf}*`).

The Python app and front-end JS are intact and coherent.

## Deferred: the deep code-level prune (do against a *running* Python env)

A leaner cut down to **just chat + LLM + agent** — dropping the email, calendar, contacts,
research, cookbook/hwfit, compare, documents/editor, gallery, notes, tasks, voice (tts/stt),
youtube, webhooks, search, shell, and memory/skills verticals (their `routes/` + `services/` +
`static/js/` + `app.py` wiring + `index.html` script tags) — is the next pass. Because it edits
the 1,111-line `app.py` and the front-end shell, it must be **verified against a running
instance** (Python deps installed, config set), not done blind.

## Running odysseus standalone (reference)

See [`README.md`](./README.md) and `requirements.txt` (FastAPI + uvicorn); `.env.example`
documents config. During the refactor we'll run it as the bbai front-end service.

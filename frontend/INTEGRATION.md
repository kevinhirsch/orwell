# Vendored: Orwell — Orwell's player front-end + LLM/agent tier

## What this is

A vendored copy of **Orwell** (https://github.com/kevinhirsch/bbai, MIT —
see [`LICENSE`](./LICENSE) and [`ACKNOWLEDGMENTS.md`](./ACKNOWLEDGMENTS.md), retained intact).
Orwell is a self-hosted AI workspace: **Python (FastAPI) backend + vanilla-JS PWA**, with a
multi-provider LLM connection (Ollama, OpenAI, OpenRouter, Anthropic, llama.cpp, vLLM) and an
**agent** built on opencode / MCP.

We reuse it as Orwell's **player front-end + LLM-connection + agent tier** rather than building
those from scratch.

## Role in Orwell (polyglot, two tiers)

- **Orwell core** = the TypeScript hexagonal **engine** (`/src`) — game rules, the Vault, ports.
  Stays the single source of truth.
- **`frontend/`** (this) = a **Python service** — the UI + LLM connection + agent. Runs as its
  **own process**, separate from the Node engine.
- They meet over a **permissioned boundary** (below) — the MCP boundary the design always
  planned; the narrative LLM was always meant to sit behind a port.

## Quarantine (important)

`frontend/` is intentionally **outside** Orwell's TypeScript tooling — `tsconfig.json`
(`include: src, tests, features`), Vitest (`tests/**`), Cucumber (`docs/features`), and
dependency-cruiser (`src`) do **not** touch it. The Vault-Wall architecture test is unaffected.
Treat `frontend/` as a separate app with its own deps (`requirements.txt`, its own
`package.json`).

## MVP keep-set

**Chat UI + multi-provider LLM connection + agent (MCP/tooling).** The agent is the
integration linchpin — it's what drives the game.

## Integration plan (the refactor — next)

1. The Orwell engine exposes the game as a permissioned **MCP server**: `getVisibleStateFor`,
   `recordInteraction`, `resolveCompetition`, `surfaceInformationTo` (the tools in
   `CLAUDE.md` / the spec). These return **only visible-projection data**.
2. Point Orwell's agent (`routes/mcp_routes.py`, `mcp_servers/`) at that MCP server as a
   tool backend; the LLM narrates *Big Brother* by calling the engine tools.
3. **The Vault Wall holds by construction:** `frontend/` never imports `VaultStore` and only
   receives visible projections over the boundary — the model can't leak what it never gets.
4. Build the BB-specific surfaces (narrated scene view, Diary Room, house/houseguest panels)
   on top of the chat shell.

## Wired now: the onboarding + per-moment narration bridge

A first vertical slice connecting Orwell to the engine lives at **`/orwell`**:

- **`src/orwell_engine.py`** — thin async client to the engine's HTTP MCP player channel
  (`ORWELL_ENGINE_MCP_URL`, default `http://127.0.0.1:8765`): `createCharacter`, `getGameState`,
  `getMomentPrompt`. Consumes only Vault-free results.
- **`routes/orwell_routes.py`** — `GET /api/orwell/{health,state}`, `POST /api/orwell/new-game`
  (runs OOBE), `POST /api/orwell/chat`. The chat route fetches the engine's **managed per-moment
  system prompt**, injects it as the system message, resolves the user's default model via
  Orwell's own `resolve_endpoint("default")`, and calls `llm_call_async`. This is what stops
  the model from answering as a generic assistant — it now speaks **as the game master**.
- **`static/orwell.html` + `static/js/orwell.js` + `static/css/orwell.css`** — character creation
  (the step that was missing past account creation), the house roster, and an in-character chat
  with a **moment selector** (the visible "manage system-prompt injection per moment" control).
- **`app.py`** — serves `/orwell` and mounts the router. Auth-gated by the existing middleware.

### Try it

1. Run the **engine**: from the repo root, `npm run build && ORWELL_ENGINE_PORT=8765 npm start`.
2. Run **Orwell** (this app) and log in; ensure a **default chat model** is set in settings
   (the in-character chat uses it).
3. Open **`/orwell`** → create your houseguest → meet the house → play. The header shows engine
   status; if the engine is down the page says so instead of failing silently.

**Still managed by the engine, not here:** game state lives in the engine process (in-memory
today; persistence is feature 0007). The deep loop (competitions, nominations, votes driving the
phase/moment) is the engine's weekly-loop work (feature 0011) — this bridge will pick up those
moments automatically as the engine advances them.

## What was trimmed (footprint only — no application code removed)

Removed to keep the repo lean; none of it affects chat/agent:
- demo media (`docs/*.gif|*.webm`), marketing docs (`docs/`, `ROADMAP`/`SECURITY`/`THREAT_MODEL`/`CONTRIBUTING`),
- deployment scaffolding (`docker/`, `docker-compose*`, `Dockerfile`, build/start/launch/install scripts, `*.service`, `.github/`),
- Orwell's own `tests/`,
- heavy document-export libs (`static/lib/{xlsx,docx,mammoth,html2pdf}*`).

The Python app and front-end JS are intact and coherent.

## Deferred: the deep code-level prune (do against a *running* Python env)

A leaner cut down to **just chat + LLM + agent** — dropping the email, calendar, contacts,
research, cookbook/hwfit, compare, documents/editor, gallery, notes, tasks, voice (tts/stt),
youtube, webhooks, search, shell, and memory/skills verticals (their `routes/` + `services/` +
`static/js/` + `app.py` wiring + `index.html` script tags) — is the next pass. Because it edits
the 1,111-line `app.py` and the front-end shell, it must be **verified against a running
instance** (Python deps installed, config set), not done blind.

## Running Orwell standalone (reference)

See [`README.md`](./README.md) and `requirements.txt` (FastAPI + uvicorn); `.env.example`
documents config. During the refactor we'll run it as the Orwell front-end service.

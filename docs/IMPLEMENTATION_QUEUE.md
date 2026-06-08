# Implementation queue — prompts for Claude Code & OpenHands

Dispatch these to implementer agents **in order** (respecting `depends on`). Items on different
tracks can run **in parallel** once their deps are met.

**Agent split (suggested, not strict):**
- **Claude Code → the TypeScript engine** (`src/`) — it has built the hexagonal core.
- **OpenHands → the Python front-end** (`frontend/`, vendored orwell).

**Every prompt assumes these house rules** (state them if the agent is fresh): read `CLAUDE.md`
and the named `docs/features/*` spec first; the **Vault Wall is structural** — no outward module
imports `VaultStore`/`VectorIndex`, and `npm run test:arch` (dependency-cruiser) must stay green;
**BDD/TDD-first** — the `.feature` files are the source of truth, make them green; **name-agnostic
tests** (roles only); keep `npm test` green; commit on a feature branch and **open a PR**.

## Order & assignment

| # | Item | Agent | Depends on |
|---|---|---|---|
| A1 | Engine **HTTP MCP transport** | Claude Code | — (McpServer + build/start exist) |
| B1 | Implement **0011 weekly loop** | Claude Code | — |
| A2 | **orwell → engine MCP** client + game driver | OpenHands | A1 |
| B2 | Implement **0012 conversation** (engine side) | Claude Code | B1 |
| B3 | Implement **0013 Diary Room** | Claude Code | B2 |
| B4 | Implement **0014 jury & endgame** | Claude Code | B1 |
| C1 | **BB player surfaces** in orwell | OpenHands | A2, B2 |
| A3 | **Deploy smoke test** | either | A1, A2 |

A1 + B1 start immediately in parallel (one per agent). A2 unblocks the whole front-end track.

---

## Prompts

### A1 — Engine HTTP MCP transport  ·  Claude Code

> In `kevinhirsch/bbai` (TypeScript engine), implement an **HTTP MCP transport** that exposes the
> existing `McpServer` (`src/adapters/mcp/McpServer.ts`) over HTTP per the MCP spec (JSON-RPC, with
> SSE for streaming). Requirements: listen on **`BBAI_ENGINE_PORT`** (default 8765, loopback by
> default); be started by **`npm start`** (build/start already exist); mount **only** the
> per-channel allowlist via `toolsFor(channel)`; **never** add a Vault-reading tool. Read
> `CLAUDE.md` and `docs/features/0009-mcp-tool-boundary.md` first. Keep the Vault Wall: the
> transport module must not import `VaultStore`/`VectorIndex`/the engine root — `npm run test:arch`
> stays green. Add tests: an MCP client lists tools and calls each over HTTP and never receives
> Vault data (extend the sentinel/architecture tests). Keep `npm test` green. Open a PR.

### B1 — Implement 0011 weekly loop  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0011** (`docs/features/0011-weekly-loop-orchestration.{md,feature}`)
> in the **pure domain core**: the weekly phase state machine (HOH → nominations → veto → veto
> ceremony → eviction → repeat) and the season → Final 2 → jury vote → winner. NPC decisions are
> **relationship-driven** (use the existing `src/engine/relationships.ts`); player decision points
> are surfaced and **validated against feature 0005**; jury = the last 9 evictees; last-juror
> tie-break. Pure + **seed-deterministic**. Make the `0011` `.feature` green and keep all gates
> green. Read `CLAUDE.md` first. Open a PR.

### A2 — orwell → engine MCP client + game driver  ·  OpenHands

> In `kevinhirsch/bbai`, wire the vendored **orwell** front-end (`frontend/`, Python FastAPI +
> agent) to drive a *Big Brother* game through the engine's **MCP server**. Read
> `frontend/INTEGRATION.md`, `docs/features/0009-mcp-tool-boundary.md`, and
> `docs/features/0012-conversation-and-scene-system.md`. Tasks: (1) register the engine MCP server
> (URL from env **`BBAI_ENGINE_MCP_URL`**) as a tool backend for orwell's agent — it already
> supports MCP (`frontend/routes/mcp_routes.py`, `frontend/mcp_servers/`); (2) add a "Big Brother"
> game session where the agent drives play by calling the engine tools (`getVisibleStateFor`,
> `renderScene`, `recordInteraction`, `resolveCompetition`, `surfaceInformationTo`) and orwell's
> existing LLM connection (Ollama/Anthropic) **narrates** the returned, Vault-free context;
> (3) **hybrid** interaction — free-text social play, but binding decisions (nominate / veto /
> vote) are explicit, validated tool calls. **Hard constraint:** the front-end consumes **only**
> what the MCP tools return — it never reaches the engine's Vault. Done when: from the orwell UI
> you start a game, get narration, take a turn, and no Vault data appears. Open a PR.

### B2 — Implement 0012 conversation (engine side)  ·  Claude Code

> In `kevinhirsch/bbai`, implement the engine side of feature **0012**
> (`docs/features/0012-conversation-and-scene-system.{md,feature}`): `recordInteraction` (scenes as
> witnessed events — player-present = player knowledge, per 0002), a **`socialRead`** player tool
> (joins the registry with `readsVault: false`; honest, Vault-free, may hint but never names
> off-screen events), and **explicit decision validation** (binding choices go through a validated
> path, never parsed from prose; illegal choices rejected per 0005). NPC dialogue must be
> constrained to what that NPC legitimately knows (0002). Make the `0012` `.feature` green; gates
> green. Open a PR.

### B3 — Implement 0013 Diary Room  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0013** (`docs/features/0013-diary-room.{md,feature}`):
> the player DR is OOC, its content is player knowledge tagged **`NO_NPC_PATHWAY`**, and
> `deriveNpcKnowledge` must **exclude** it (no NPC ever learns DR content); honor the public/private
> gap (NPCs act on public speech, never the DR); NPC confessionals are **Vault-only** and never
> surface (sentinel-clean). Make the `0013` `.feature` green; gates green. Open a PR.

### B4 — Implement 0014 jury & endgame  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0014** (`docs/features/0014-jury-and-endgame.{md,feature}`):
> jury = last 9 evictees; **jury management** shapes votes (relationship + eviction manner); Final 2
> choreography (statements, one question per juror); the **engine decides** the vote (LLM only
> voices), jury-management-dominant with a tunable finale weight; most votes wins, last-juror
> tie-break. Make the `0014` `.feature` green; gates green. Open a PR.

### C1 — BB player surfaces in orwell  ·  OpenHands

> In `kevinhirsch/bbai` `frontend/`, adapt orwell's chat shell into the *Big Brother* player
> experience: a **narrated scene** view, the **hybrid decision prompts** (nominate / veto / vote
> over the legal option set returned by the engine), a **Diary Room** panel, and a
> **house / houseguest** view. Consume **only** MCP tool data (visible projection) — never the
> Vault. Keep the existing chat/LLM/agent plumbing. Open a PR.

### A3 — Deploy smoke test  ·  either

> In `kevinhirsch/bbai`, add an **install smoke test** for `deploy/`: provision a container (a real
> Proxmox LXC, or a Docker/Debian stand-in for CI), run `deploy/bbai-install.sh`, assert the UI
> responds on `BBAI_PORT`, run `deploy/bbai-update.sh`, and assert `/opt/bbai/data` survived.
> Document how to run it on a real Proxmox host. Open a PR.

---

## Still on the feature-maker (me) before they can be queued

- **0015 — Character creation / OOBE** (the human-authored player; the only authored profile).
- **0016 — God Mode / admin port** (admin controls; non-Vault, walled even from the admin).
- **Relationship-model dedicated feature** (promote decision 0002 into a full spec once its math
  firms up).

I'll draft these next; each then gets a prompt here.

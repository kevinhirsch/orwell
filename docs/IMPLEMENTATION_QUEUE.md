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

> ⚠️ **Adjustments to already-built specs — pick these up.** See the
> [Amendments table in `docs/features/README.md`](features/README.md#amendments-to-shipped-specs-implementer-pick-these-up).
> Current: **0004 (Done)** — `CharacterFactory` must also generate **public appearance/identity**
> fields (appearance, age, presentation/style) into `character.md`, seed-stable and free of any
> aptitude/hidden data, to feed the Vault-free **portrait descriptor** (0020 §5, 0004 §8). Small,
> additive; fold it into the built cast generation.

## Order & assignment

| # | Item | Agent | Depends on |
|---|---|---|---|
| A1 | Engine **HTTP MCP transport** | Claude Code | — (McpServer + build/start exist) |
| B5 | Implement **0017 relationship model** | Claude Code | — (`relationships.ts` seam exists) |
| B1 | Implement **0011 weekly loop** | Claude Code | B5 reads it (seam already exists) |
| A2 | **orwell → engine MCP** client + game driver | OpenHands | A1 |
| B2 | Implement **0012 conversation** (engine side) | Claude Code | B1 |
| B3 | Implement **0013 Diary Room** | Claude Code | B2 |
| B4 | Implement **0014 jury & endgame** | Claude Code | B1, B5 |
| B6 | Implement **0015 OOBE** (engine side) | Claude Code | — (0004 done) |
| B7 | Implement **0016 God Mode / admin** | Claude Code | — (0001 done) |
| C1 | **BB player surfaces** in orwell | OpenHands | A2, B2 |
| C2 | **OOBE authoring UI** in orwell | OpenHands | A2, B6 |
| A3 | **Deploy smoke test** | either | A1, A2 |

A1 + B5 start immediately in parallel (one per agent). A2 unblocks the whole front-end track.
**B5 (relationship model) is foundational** — do it early; B1 and B4 read it. B6/B7 are
independent of the gameplay chain (their deps are already green) and can slot into any free
Claude Code slot.

## Progress (this session — onboarding vertical slice)

A first end-to-end slice fixing "no onboarding past account creation" and "the model answers as
a generic assistant" is **landed** (engine tested green; front-end bridge wired):

- **A1 — HTTP MCP transport:** ✅ confirmed present (`HttpMcpServer.ts`); engine port aligned to
  `BBAI_ENGINE_PORT` (8765) to match the deploy/front-end contract.
- **B6 — engine OOBE:** ✅ exposed as Vault-free player tools `createCharacter` / `getGameState`,
  plus `getMomentPrompt` (managed per-moment system prompt). Tested (unit + HTTP + sentinel/arch).
- **A2 / C2 — front-end:** ✅ first slice — `/bbai` page (character creation → house → in-character
  chat) + `routes/bbai_routes.py` + `src/bbai_engine.py`; chat injects the engine's moment prompt
  via orwell's own `resolve_endpoint`/`llm_call_async`. See `frontend/INTEGRATION.md` → "Try it".

Remaining on these: deeper agent/tool-calling integration (let the LLM *call* engine action tools,
not just narrate), surfacing `/bbai` from the main nav/landing, and the weekly-loop moments
(feature 0011) that will advance phase/moment automatically.

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

### B5 — Implement 0017 relationship model  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0017** (`docs/features/0017-relationship-model.{md,feature}`),
> promoting `docs/decisions/0002-relationship-model.md` into the pure domain core (build on the
> existing `src/engine/relationships.ts`). Relationships are **directed, graded, asymmetric edges**
> (trust / affinity / threat / alignment / reliability / confidence) **computed from event history**
> through the holder's `Character` framing — **never** a binary ally/enemy flag, and **no label is
> ever persisted**. Fix the *shape* per the spec (recency-weighting, **betrayal-shock**, **decay**,
> rising confidence with data, dispositional labels); the **numbers are tunable config** alongside
> the temperature constants (0006). Wire the consumers: Houseguest's Choice (0005), targeting via
> `threat`, jury lean (feeds 0014). Pure + **seed-deterministic**. Make the `0017` `.feature` green;
> keep all gates green (esp. that the serialized soul holds signals+history but **no label** — ties
> 0007). Read `CLAUDE.md` first. Open a PR.

### B6 — Implement 0015 OOBE (engine side)  ·  Claude Code

> In `kevinhirsch/bbai`, implement the engine side of feature **0015**
> (`docs/features/0015-character-creation-oobe.{md,feature}`): `runPlayerOOBE(input)` — validate the
> input, reject incomplete profiles, and produce the player's **static `Character`** + **initial
> `Soul`** (emotional baseline + volatility, empty memory, **no** relationship beliefs); then seed
> the house **around** the authored player via `generateHouse(seed, player)` keeping the curated
> ensemble (0004). **Anti-sycophancy is the crux:** the player's P/M/S aptitudes must fall **within
> the same bounds as the NPCs** — no self-min-maxing (ship §9 option **A**, derived/balanced, unless
> told otherwise); the player carries **no** outcome guarantee (0006). The player's authored private
> strategy is player knowledge tagged **`NO_NPC_PATHWAY`** (0013) — no NPC starts knowing it. OOBE
> is OOC (no witnessed event). Make the `0015` `.feature` green; gates green. Read `CLAUDE.md` first.
> Open a PR.

### B7 — Implement 0016 God Mode / admin  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0016** (`docs/features/0016-god-mode-admin.{md,feature}`),
> extending the existing `src/surfaces/admin/AdminPort.ts` and the `ADMIN_TOOLS` allowlist. Add
> useful **non-Vault** admin capability — `overrideMechanic`, `configure` (tunable constants +
> reserve-twist **count**, never content), `manageSandbox` (create/reset/save/load this sandbox) —
> while keeping the **Vault Wall on the admin surface**: no admin module imports `VaultStore`/
> `VectorIndex` (extend the dependency-cruiser rule to `surfaces/admin`), every `ADMIN_TOOLS` entry
> stays `readsVault: false`, and admin output is **sentinel-clean** (extend the 0001 canary to the
> admin surface). Enabling reserve twists must **not** reveal their content/timing to the admin
> (Vault-sealed, 0005). Make the `0016` `.feature` green; gates green. Read `CLAUDE.md` and
> `docs/features/0001-vault-wall-isolation.md` first. Open a PR.

### C2 — OOBE authoring UI in orwell  ·  OpenHands

> In `kevinhirsch/bbai` `frontend/`, add the **character-creation (OOBE) flow** to the orwell UI:
> a first-run, out-of-character intake that collects the player's identity, backstory, public
> persona, archetype lean, and private strategy, validates required fields, and calls the engine's
> OOBE entrypoint (via the MCP client from A2) to author the player and start a new save. Consume
> **only** what the engine returns; the UI never sets the player's stats directly (the engine
> balances them — anti-sycophancy). Keep the existing chat/LLM/agent plumbing. Open a PR.

---

## Still on the feature-maker (me)

All currently-planned specs are drafted (0001–0017). Nothing is blocking the implementer queue.
Future spec work, if it comes up: any **reserve-twist** specifics (stay Vault-held, 0005); a
dedicated **temperature/relationship constants** tuning note once the implementers want concrete
numbers (the *shape* is already fixed in 0006 / 0017); and whatever new product calls surface.

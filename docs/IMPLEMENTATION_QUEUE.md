# Implementation queue — prompts for Claude Code & OpenHands

Dispatch these to implementer agents **in order** (respecting `depends on`). Items on different
tracks can run **in parallel** once their deps are met.

**Agent split (suggested, not strict):**
- **Claude Code → the TypeScript engine** (`src/`) — it has built the hexagonal core.
- **OpenHands → the Python front-end** (`frontend/`, vendored Orwell).

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

## Dispatch strategy — NOW (concurrent Claude Code + OpenHands)

**True state as of 2026-06-08:**
- **Engine: 0001–0031 are Done.** The consequence loop (0023), soul recall (0024), per-user sandboxes
  (0021), reserve twists (0025), the streaming narrator (0027), durable persistence (0030), relationship
  + temperature constants (0026/0028), and now the **runtime orchestrator/integrity watcher (0031)** are
  all green. **The engine core is complete** — only maintenance + future specs remain.
- **Front-end: the game wiring + accounts tier are live** — onboarding/`X-Orwell-User`, the agent lever
  tools (C6), 0020 player UX (C4), and app admin (0029/C7) have all shipped. **One item remains:**
  **C8 — 0032 surface reduction** (prune the vendored workspace down to the game build).
- **C5 / 0004 appearance / C6 / C4 / C7 are complete.**

Two lanes — **Claude Code = engine (`src/`)**, **OpenHands = front-end (`frontend/`)**. The engine lane
is now drained; the active front-end work is the prune.

| Wave | Claude Code (engine) | OpenHands (front-end) |
|---|---|---|
| **1 — now** | *Engine core complete* — no queued feature. Maintenance, future specs, and any review follow-ups. | **C8** (0032 surface reduction) — reduce the front-end to the **game build**: flag-gate + **server-side 404** every dropped vertical (incl. the live **shell** endpoint), drop front-end memory/RAG, prune Settings tabs, behind one **`ORWELL_GAME_BUILD`** switch; then stop shipping the dropped JS; then delete it (deletion tier **verified on a running instance**). Keep **voice** off-by-default. |
| **after** | Future specs as drafted (jury choreography, MVP-2 engine bits, new product calls). | MVP-2 (0022) un-parks once MVP-1 is solid. |

**Coordination rules**
- **Stay in lanes** (engine `src/` vs front-end `frontend/`); don't cross-edit the other's files.
- **0032 is front-end-only** — it must **not** touch `src/` or `cucumber.cjs`; the engine gate
  (`npm test` / `npm run test:arch`) must stay **unaffected** (the front-end is quarantined).
- **0032 tier order:** Tier 1 (flag-gate + 404) → Tier 2 (stop shipping JS) → Tier 3 (delete code).
  Tiers 1–2 go green in CI (`pytest`); Tier 3's DoD is a **documented run on a live instance** (boots,
  onboards, plays a turn, portraits render, accounts/admin work) per `frontend/INTEGRATION.md`.
- **First move NOW:** OpenHands → **C8**. (Claude Code engine lane idle — pick up review/maintenance.)

*(The full per-item prompts are below.)*

## Order & assignment

| # | Item | Agent | Depends on |
|---|---|---|---|
| A1 | Engine **HTTP MCP transport** | Claude Code | — (McpServer + build/start exist) |
| B5 | Implement **0017 relationship model** | Claude Code | — (`relationships.ts` seam exists) |
| B1 | Implement **0011 weekly loop** | Claude Code | B5 reads it (seam already exists) |
| A2 | **Orwell → engine MCP** client + game driver | OpenHands | A1 |
| B2 | Implement **0012 conversation** (engine side) | Claude Code | B1 |
| B3 | Implement **0013 Diary Room** | Claude Code | B2 |
| B4 | Implement **0014 jury & endgame** | Claude Code | B1, B5 |
| B6 | Implement **0015 OOBE** (engine side) | Claude Code | — (0004 done) |
| B7 | Implement **0016 God Mode / admin** | Claude Code | — (0001 done) |
| C1 | **BB player surfaces** in Orwell | OpenHands | A2, B2 |
| C2 | **OOBE authoring UI** in Orwell | OpenHands | A2, B6 |
| A3 | **Deploy smoke test** | either | A1, A2 |

A1 + B5 start immediately in parallel (one per agent). A2 unblocks the whole front-end track.
**B5 (relationship model) is foundational** — do it early; B1 and B4 read it. B6/B7 are
independent of the gameplay chain (their deps are already green) and can slot into any free
Claude Code slot.

## Progress (this session — onboarding vertical slice)

A first end-to-end slice fixing "no onboarding past account creation" and "the model answers as
a generic assistant" is **landed** (engine tested green; front-end bridge wired):

- **A1 — HTTP MCP transport:** ✅ confirmed present (`HttpMcpServer.ts`); engine port aligned to
  `ORWELL_ENGINE_PORT` (8765) to match the deploy/front-end contract.
- **B6 — engine OOBE:** ✅ exposed as Vault-free player tools `createCharacter` / `getGameState`,
  plus `getMomentPrompt` (managed per-moment system prompt). Tested (unit + HTTP + sentinel/arch).
- **A2 / C2 — front-end:** ✅ first slice — `/orwell` page (character creation → house → in-character
  chat) + `routes/orwell_routes.py` + `src/orwell_engine.py`; chat injects the engine's moment prompt
  via Orwell's own `resolve_endpoint`/`llm_call_async`. See `frontend/INTEGRATION.md` → "Try it".

Remaining on these: deeper agent/tool-calling integration (let the LLM *call* engine action tools,
not just narrate), surfacing `/orwell` from the main nav/landing, and the weekly-loop moments
(feature 0011) that will advance phase/moment automatically.

---

## Prompts

### A1 — Engine HTTP MCP transport  ·  Claude Code

> In `kevinhirsch/orwell` (TypeScript engine), implement an **HTTP MCP transport** that exposes the
> existing `McpServer` (`src/adapters/mcp/McpServer.ts`) over HTTP per the MCP spec (JSON-RPC, with
> SSE for streaming). Requirements: listen on **`ORWELL_ENGINE_PORT`** (default 8765, loopback by
> default); be started by **`npm start`** (build/start already exist); mount **only** the
> per-channel allowlist via `toolsFor(channel)`; **never** add a Vault-reading tool. Read
> `CLAUDE.md` and `docs/features/0009-mcp-tool-boundary.md` first. Keep the Vault Wall: the
> transport module must not import `VaultStore`/`VectorIndex`/the engine root — `npm run test:arch`
> stays green. Add tests: an MCP client lists tools and calls each over HTTP and never receives
> Vault data (extend the sentinel/architecture tests). Keep `npm test` green. Open a PR.

### B1 — Implement 0011 weekly loop  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0011** (`docs/features/0011-weekly-loop-orchestration.{md,feature}`)
> in the **pure domain core**: the weekly phase state machine (HOH → nominations → veto → veto
> ceremony → eviction → repeat) and the season → Final 2 → jury vote → winner. NPC decisions are
> **relationship-driven** (use the existing `src/engine/relationships.ts`); player decision points
> are surfaced and **validated against feature 0005**; jury = the last 9 evictees; last-juror
> tie-break. Pure + **seed-deterministic**. Make the `0011` `.feature` green and keep all gates
> green. Read `CLAUDE.md` first. Open a PR.

### A2 — Orwell → engine MCP client + game driver  ·  OpenHands

> In `kevinhirsch/orwell`, wire the vendored **Orwell** front-end (`frontend/`, Python FastAPI +
> agent) to drive a *Big Brother* game through the engine's **MCP server**. Read
> `frontend/INTEGRATION.md`, `docs/features/0009-mcp-tool-boundary.md`, and
> `docs/features/0012-conversation-and-scene-system.md`. Tasks: (1) register the engine MCP server
> (URL from env **`ORWELL_ENGINE_MCP_URL`**) as a tool backend for Orwell's agent — it already
> supports MCP (`frontend/routes/mcp_routes.py`, `frontend/mcp_servers/`); (2) add a "Big Brother"
> game session where the agent drives play by calling the engine tools (`getVisibleStateFor`,
> `renderScene`, `recordInteraction`, `resolveCompetition`, `surfaceInformationTo`) and Orwell's
> existing LLM connection (Ollama/Anthropic) **narrates** the returned, Vault-free context;
> (3) **hybrid** interaction — free-text social play, but binding decisions (nominate / veto /
> vote) are explicit, validated tool calls. **Hard constraint:** the front-end consumes **only**
> what the MCP tools return — it never reaches the engine's Vault. Done when: from the Orwell UI
> you start a game, get narration, take a turn, and no Vault data appears. Open a PR.

### B2 — Implement 0012 conversation (engine side)  ·  Claude Code

> In `kevinhirsch/orwell`, implement the engine side of feature **0012**
> (`docs/features/0012-conversation-and-scene-system.{md,feature}`): `recordInteraction` (scenes as
> witnessed events — player-present = player knowledge, per 0002), a **`socialRead`** player tool
> (joins the registry with `readsVault: false`; honest, Vault-free, may hint but never names
> off-screen events), and **explicit decision validation** (binding choices go through a validated
> path, never parsed from prose; illegal choices rejected per 0005). NPC dialogue must be
> constrained to what that NPC legitimately knows (0002). Make the `0012` `.feature` green; gates
> green. Open a PR.

### B3 — Implement 0013 Diary Room  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0013** (`docs/features/0013-diary-room.{md,feature}`):
> the player DR is OOC, its content is player knowledge tagged **`NO_NPC_PATHWAY`**, and
> `deriveNpcKnowledge` must **exclude** it (no NPC ever learns DR content); honor the public/private
> gap (NPCs act on public speech, never the DR); NPC confessionals are **Vault-only** and never
> surface (sentinel-clean). Make the `0013` `.feature` green; gates green. Open a PR.

### B4 — Implement 0014 jury & endgame  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0014** (`docs/features/0014-jury-and-endgame.{md,feature}`):
> jury = last 9 evictees; **jury management** shapes votes (relationship + eviction manner); Final 2
> choreography (statements, one question per juror); the **engine decides** the vote (LLM only
> voices), jury-management-dominant with a tunable finale weight; most votes wins, last-juror
> tie-break. Make the `0014` `.feature` green; gates green. Open a PR.

### C1 — BB player surfaces in Orwell  ·  OpenHands

> In `kevinhirsch/orwell` `frontend/`, adapt Orwell's chat shell into the *Big Brother* player
> experience: a **narrated scene** view, the **hybrid decision prompts** (nominate / veto / vote
> over the legal option set returned by the engine), a **Diary Room** panel, and a
> **house / houseguest** view. Consume **only** MCP tool data (visible projection) — never the
> Vault. Keep the existing chat/LLM/agent plumbing. Open a PR.

### A3 — Deploy smoke test  ·  either

> In `kevinhirsch/orwell`, add an **install smoke test** for `deploy/`: provision a container (a real
> Proxmox LXC, or a Docker/Debian stand-in for CI), run `deploy/orwell-install.sh`, assert the UI
> responds on `ORWELL_PORT`, run `deploy/orwell-update.sh`, and assert `/opt/orwell/data` survived.
> Document how to run it on a real Proxmox host. Open a PR.

### B5 — Implement 0017 relationship model  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0017** (`docs/features/0017-relationship-model.{md,feature}`),
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

> In `kevinhirsch/orwell`, implement the engine side of feature **0015**
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

> In `kevinhirsch/orwell`, implement feature **0016** (`docs/features/0016-god-mode-admin.{md,feature}`),
> extending the existing `src/surfaces/admin/AdminPort.ts` and the `ADMIN_TOOLS` allowlist. Add
> useful **non-Vault** admin capability — `overrideMechanic`, `configure` (tunable constants +
> reserve-twist **count**, never content), `manageSandbox` (create/reset/save/load this sandbox) —
> while keeping the **Vault Wall on the admin surface**: no admin module imports `VaultStore`/
> `VectorIndex` (extend the dependency-cruiser rule to `surfaces/admin`), every `ADMIN_TOOLS` entry
> stays `readsVault: false`, and admin output is **sentinel-clean** (extend the 0001 canary to the
> admin surface). Enabling reserve twists must **not** reveal their content/timing to the admin
> (Vault-sealed, 0005). Make the `0016` `.feature` green; gates green. Read `CLAUDE.md` and
> `docs/features/0001-vault-wall-isolation.md` first. Open a PR.

### C2 — OOBE authoring UI in Orwell  ·  OpenHands

> In `kevinhirsch/orwell` `frontend/`, add the **character-creation (OOBE) flow** to the Orwell UI:
> a first-run, out-of-character intake that collects the player's identity, backstory, public
> persona, archetype lean, and private strategy, validates required fields, and calls the engine's
> OOBE entrypoint (via the MCP client from A2) to author the player and start a new save. Consume
> **only** what the engine returns; the UI never sets the player's stats directly (the engine
> balances them — anti-sycophancy). Keep the existing chat/LLM/agent plumbing. Open a PR.

---

## Batch 2 — features 0015–0020, in build sequence

0011–0014 + A1 are **built**; the **rename** (BBAI→Orwell) and the **"Orwell IS the game" fold**
are in flight (their own prompts, given separately). This batch finishes the gameplay + player
experience. Build in this order — two agents in parallel where deps allow:

| Step | Item | Agent | Depends on |
|---|---|---|---|
| 1 | **B5** — 0017 relationship model | Claude Code | — (foundational; 0014/0019 read it) |
| 2 | **B8** — 0018 moment orchestration | Claude Code | 0011/0008/0009 (done) |
| 3 | **B6** — 0015 OOBE  +  **B9** — 0004 appearance amendment | Claude Code | 0004; pair B6+B9 (same factory) |
| 4 | **B7** — 0016 God Mode | Claude Code | 0001 (done) — slot anytime |
| 5 | **B10** — 0019 engine decision seam | Claude Code | B5, B8, 0011/0005 |
| 6 | **C3** — 0019 agent play loop | OpenHands | B10 + the fold + 0012 |
| 7 | **B11** — 0020 engine (status + portrait descriptor) | Claude Code | B9 |
| 8 | **C4** — 0020 player UX (panel + decisions + portraits) | OpenHands | B11, C3 |

Claude Code runs the engine track (B5 → B8 → B6/B9 → B7 → B10 → B11); OpenHands picks up C3 once
B10 lands, then C4 once B11 lands. **B5/B6/B7 prompts are above; the new ones (B8–B11, C3–C4):**

### B8 — 0018 narrative & moment orchestration  ·  Claude Code

> In `kevinhirsch/bbai`, implement feature **0018** (`docs/features/0018-narrative-moment-orchestration.{md,feature}`)
> in the engine, promoting the existing `src/engine/momentPrompts.ts` + the `getMomentPrompt` tool
> into a tested spec. The **engine owns the moment** — derive it deterministically from the
> phase/schedule (0011/0008); the narrator can't change it. The managed `MOMENT_PROMPTS` registry
> is the single place for per-moment fragments; the composed prompt = base game-master persona +
> moment fragment + **Vault-free** context (player card + house names + phase). Persona/framing
> ONLY — never the Vault Wall. Make `0018` green: every moment's prompt is **sentinel-free** under a
> fully populated Vault (extend the 0001 canary to `getMomentPrompt`); the moment tracks the engine
> phase; the base persona forbids generic-assistant output; the context carries no stats/souls/
> archetypes/hidden. Keep all gates green. Open a PR.

### B9 — 0004 appearance amendment  ·  Claude Code

> In `kevinhirsch/bbai`, fold the **0004 amendment** into the built `CharacterFactory`
> (`src/engine/characterFactory.ts`): generate **public appearance/identity** fields (appearance,
> approximate age, presentation/style) into the static `Character`, seeded, internally consistent
> with the archetype, **seed-stable** (part of the byte-stable baseline, 0007), and carrying **no**
> P/M/S aptitude or hidden data. These are the Vault-free facets the portrait descriptor (0020)
> reads. Make the new `0004` appearance scenario green (see `docs/features/0004-replayability-and-naming.md`
> §8); keep all gates green. Best paired with **B6** (0015 OOBE) since both touch the factory. Open a PR.

### B10 — 0019 engine decision seam  ·  Claude Code

> In `kevinhirsch/bbai`, implement the **engine** side of feature **0019**
> (`docs/features/0019-agent-driven-play-loop.{md,feature}`): a Vault-free decision seam the agent
> drives — `pendingDecision(state) -> { kind, options[] } | none` returning the engine's **legal**
> option set (per 0011/0005), and `executeDecision(kind, choice)` that **validates** and applies a
> binding choice (rejecting illegal/ineligible per 0005), exposed as player-channel tools
> (`readsVault: false`). Binding state changes happen **only** through this path — never parsed
> from prose; the engine decides outcomes (0006/0011/0014), the agent only voices. Much of
> `pendingDecision`/advance likely already exists in the 0011 weekly loop — reuse it. Make the
> engine-side `0019` scenarios green; gates green. Open a PR.

### B11 — 0020 engine: status + portrait descriptor  ·  Claude Code

> In `kevinhirsch/bbai`, implement the **engine** bits of feature **0020**
> (`docs/features/0020-player-experience.{md,feature}`): a Vault-free **`gameStatus()`** projection
> for the status panel — `{ week, phase, hoh, nominees[], veto: { holder, used } }`, public
> ceremony-level facts only (no hidden votes/targeting), as a player-channel tool
> (`readsVault: false`); and **`portraitDescriptorFor(houseguest)`** — a Vault-free descriptor
> built from `character.md`'s **public appearance facets** (the B9 amendment), excluding aptitudes,
> hidden elements, and `Soul`/Vault. Both **sentinel-clean** under a populated Vault (extend the
> 0001 canary). Make the engine-side `0020` scenarios green; gates green. Depends on **B9**. Open a PR.

### C3 — 0019 agent play loop  ·  OpenHands

> In `kevinhirsch/bbai` `frontend/`, implement the **agent turn-loop** of feature **0019** in
> orwell: the agent drives each turn by calling the engine's Vault-free tools — read visible state,
> narrate the moment (inject `getMomentPrompt`, 0018), and when `pendingDecision` returns options,
> present them and execute the player's binding choice via the validated `executeDecision` (B10).
> **Hybrid input:** free-text social play flows in the chat (recorded as witnessed events, 0012)
> and never makes a binding decision; only the validated path does. The agent **never** invents
> outcomes — it voices what the engine returns. Consume only Vault-free tool data. This runs inside
> the "Orwell IS the game" fold (the game is the main chat). Open a PR.

### C4 — 0020 player experience (MVP-1)  ·  OpenHands

> In `kevinhirsch/bbai` `frontend/`, build **player experience MVP-1** (feature 0020) in orwell: a
> light always-visible **status panel** fed by `gameStatus` (week/phase, HOH & nominees, veto
> status — public only); **inline quick-buttons** for binding decisions rendered from the engine's
> **legal** option set (`pendingDecision`) and executed via the validated path (never typed prose);
> and **photo-style portraits** per houseguest, rendered by orwell's existing image-gen pipeline
> from the engine's **`portraitDescriptorFor`** (B11) — public facets only. Everything shown is
> Vault-free; **"your own standing" stays in narration, not the HUD**. Depends on **B11** + **C3**.
> Open a PR. *(MVP-2 — the rich game UI, feature 0022 — is **deferred**; MVP-1 is being refined.)*

### B12 — 0021 engine: per-user sandbox registry  ·  Claude Code

> In `kevinhirsch/orwell`, implement the **engine** side of feature **0021**
> (`docs/features/0021-game-session-and-save-lifecycle.{md,feature}`): turn the single in-memory
> game into a **per-user sandbox registry** — `sandboxFor(user) -> GameSession` (created on first
> use) — and route **every** player/admin MCP tool call to the asserting user's sandbox (the MCP
> layer resolves the user identity the front-end asserts). **One active game per user**
> (`createCharacter` replaces that user's own game); **unlimited users concurrently**, each fully
> isolated. **Cross-user isolation is the crux:** no call on behalf of user A may return any of
> user B's state — add a **cross-user sentinel test** (mirror the 0001 Vault canary on the user
> axis: seed A's game with sentinels, assert none appear in any of B's tool outputs, and vice-
> versa). The Vault Wall (0001) must still hold inside each sandbox; `npm run test:arch` stays
> green. Make the `0021` engine scenarios green; gates green. **Do this early** — it reshapes the
> sandbox seam, cheaper before more engine work piles on. Read `CLAUDE.md` (sandbox model) first.
> Open a PR.

### C5 — 0021 front-end: assert the authenticated user  ·  OpenHands

> In `kevinhirsch/orwell` `frontend/`, make the front-end **assert the authenticated user identity**
> to the engine on every engine MCP call (the engine binds loopback and keys a sandbox per user —
> B12). Use the already-authenticated account (`request.state.current_user`) as the sandbox key;
> never let one account act as another. Each user sees only **their** game — the chat is their
> window. Done when two logged-in users each get their own isolated game and neither can see the
> other's. Depends on **B12**. Open a PR.

### C6 — Tight, lever-complete system prompts  ·  OpenHands (+ Claude Code)  ·  **START NOW (ready part)**

> In `kevinhirsch/orwell`, make the game agent able to **access and pull every engine lever**. The
> engine's game-master prompt (`src/engine/momentPrompts.ts`, 0018) is already a **tight operating
> manual** that names the levers and says the engine decides outcomes; this closes the gaps around
> it. **Ready part — do now:** the drift test (3) and exposing the two levers that already exist —
> `getVisibleStateFor`, `socialRead` — in (1). The decision levers (0019) and `gameStatus` (0020)
> get exposed as they land (the drift test forces it). Steps:
> 1. **Front-end — expose the full lever set as agent tools.** `frontend/src/agent_tools.py`
>    (`TOOL_TAGS`) + `frontend/src/tool_schemas.py` currently expose only `getGameState`,
>    `runCompetition`, `recordInteraction`, `surfaceInformationTo`. Add the rest the agent should
>    drive — `getVisibleStateFor`, `socialRead`, and (as they land) `pendingDecision` /
>    `executeDecision` (0019) and `gameStatus` (0020) — each as a clean function schema so the
>    model knows **how to access** every lever.
> 2. **Front-end — inject the lever-aware prompt.** Confirm `frontend/routes/chat_helpers.py`
>    injects the engine's `getMomentPrompt` (0018) as the system message on every game turn.
> 3. **Engine — keep the manifest honest.** Mark which `registry.ts` entries are **agent levers**
>    (e.g. an `agentLever: true` field on the game-driving read/action tools — not infra like
>    `getMomentPrompt`/`endOfSessionSummary`), then add a test that **fails if any agent-lever tool
>    is missing from the base prompt's manifest**, so the prompt and the registry never drift.
> Done when the model reliably reads state, resolves comps, records scenes, surfaces info, and
> takes binding decisions **through the engine** — and never invents an outcome. Read
> `docs/features/0018-narrative-moment-orchestration.md` first. Open a PR.

### B13 — 0023 consequence & memory (the live loop)  ·  Claude Code  ·  **TOP MVP-1 PRIORITY**

> In `kevinhirsch/orwell`, implement feature **0023**
> (`docs/features/0023-consequence-and-memory.{md,feature}`) — the MVP-1 backbone, currently the
> biggest gap. **Wire the live game** so player actions have consequences and the house remembers.
> Today `GameSessionAdapter` holds only house+week+phase and `recordInteraction` just logs — change
> that:
> 1. **Apply.** The live game holds a persistent **relationship/soul** state (use
>    `src/engine/relationships.ts`); `recordInteraction` and competition results / votes **fold
>    their hidden impact into it** (a betrayal drops trust + raises threat, etc.). The player's
>    actions change how NPCs feel about them — on the **live** path, not just `simulation.ts`.
> 2. **Hide.** The shift lives in the Soul/Vault and **never** surfaces — extend the 0001 sentinel
>    canary: no opinion number or "their opinion changed" text on any player surface.
> 3. **Persist all event details + derived state to LONG-TERM memory** — wire the real store
>    (`SaveStore`/SQLite per 0007) to the live session; lossless + monotonic (no thinning); survives
>    a process restart.
> 4. **Recall** the full history + hidden state on load — a **superset**, never a reset.
> Make the `0023` `.feature` green (add it to `cucumber.cjs`); keep all gates green. Two impl forks
> (0023 §8) are yours to pick — the tests are agnostic to both. Read `CLAUDE.md` (non-degradation
> mandate) and `docs/features/0002/0007/0017` first. Open a PR.

### B14 — 0024 soul storage & memory recall (md + vector)  ·  Claude Code  ·  **pairs with B13**

> In `kevinhirsch/orwell`, implement feature **0024**
> (`docs/features/0024-soul-storage-and-memory-recall.{md,feature}`): the dynamic `Soul` as a
> **markdown narrative** + an **engine-only vector index**, behind `SoulProvider`, with
> **semantic recall**. `recall(hg, context, k)` returns the *k* semantically-most-relevant past
> memories (use an **`EmbeddingProvider` with a deterministic fake** so recall is testable + seed-
> deterministic — a query about "the veto betrayal" recalls *that* memory, not the most recent
> chat). Recall feeds **both**: it **weights the relationship read** (0017) by relevant history, and
> it **gives the narrator** a specific recalled memory. **Boundary:** the `VectorIndex`/full soul are
> **engine-only** — extend the dependency-cruiser rule so no outward module imports them (exactly
> like `VaultStore`); player-facing recall output is **sentinel-clean** and pathway-filtered (0002).
> The soul **deepens monotonically** (0007); `Character` stays byte-stable. Make `0024` green; gates
> green. **Pairs with B13** (0023 records to the soul + calls recall) — do them together. Open a PR.

### B19 — 0030 durable game persistence (survive restart)  ·  Claude Code  ·  **TOP PRIORITY (bugfix)**

> In `kevinhirsch/orwell`, implement feature **0030**
> (`docs/features/0030-durable-game-persistence-survive-restart.{md,feature}`). **Why it's urgent:**
> the live game holds all state in memory — `GameSessionAdapter` (`house/week/phase/ceremony` fields)
> and `GameSessionRegistry` (a plain `Map`) — and the only `SaveStore` is in-memory, so **every
> engine restart wipes all games**, `GET /api/orwell/state` returns `started:false`, and the
> front-end "Welcome to the house" overlay **re-fires on every load** (user-reported). Fix it by
> wiring **durable** persistence into the LIVE path, reusing the built **0007** `GameState`/`SaveStore`
> contract: (1) add a **disk-backed `FileSaveStore`** (engine-only adapter, per-user JSON under
> `ORWELL_DATA_DIR`) behind the existing `SaveStore` port; (2) add `snapshot(): GameState` /
> `restore(state)` to `GameSessionAdapter` (lossless live-house round-trip — player, NPCs, souls,
> ceremony, week/phase) using the same export/import the off-screen sim already uses; (3) give
> `GameSessionRegistry` a `SaveStore` so `sandboxFor(user)` **loads** a user's latest save into the
> sandbox and every mutating tool (`createCharacter`, `recordInteraction`, `runCompetition`, ceremony
> updates, consequence folds) **saves** afterward. Preserve **0007** co-versioning + non-degradation,
> **0021** per-user isolation **across restart**, and the Vault Wall on the reloaded state
> (dependency-cruiser stays green; the file store is engine-only). Make `0030` green (central test:
> a **new registry over the same store** recalls a `started:true` game → onboarding stops firing);
> gates green. Read `docs/features/0007`, `0021`, `0023` first. Open a PR.

### B15 — 0025 reserve twists (Vault-sealed)  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0025**
> (`docs/features/0025-reserve-twists.{md,feature}`): a small curated pool of classic
> **non-structural** twists (secret power, double eviction, returning-juror battle-back) held in
> **reserve**. The engine, **seeded**, decides if/when one fires at a dramatic beat — **rare**, at
> most the admin-enabled count (0016). The chosen twist + timing are **Vault content**, sealed from
> **both** the player **and** the admin until it fires (extend the 0001 sentinel canary to *both*
> surfaces; cross-check 0016 §5 — enabling reveals neither content nor timing). On fire: record a
> **witnessed reveal event** (0002) + apply the mechanic. **Format-preserving:** the 0005
> eligibility invariants and the 16 → jury-9 → final-2 arc must hold **under** any twist. Make
> `0025` green; gates green. Read `docs/features/0001`, `0005`, `0016` first. Open a PR.

### B16 — 0026 relationship math (firmed update rule & constants)  ·  Claude Code  ·  **grounds B13**

> In `kevinhirsch/orwell`, implement feature **0026**
> (`docs/features/0026-relationship-math.{md,feature}`): firm 0017's shape into a concrete update
> rule + a **single tunable constants module** (sibling to the temperature/richness configs). The
> `apply` rule moves the signals by the per-type `IMPACT` (extend the existing
> `src/engine/relationships.ts` table) × **disposition factor** (from `Character`) × bounded
> **temperature**; **betrayal-shock** is a large single step that **decays slowly** (default
> **sticky/realistic** — the grudge lingers); decay/mean-reversion is **disposition-scaled**;
> confidence rises with data. **The feel is per-game, not global:** a paranoid cast trends sticky, a
> social cast forgiving, temperature varies it — with a **measurable spread across seeds** and
> reproducible by seed. **No number hard-coded outside the constants module** (retunable later, a
> future God-Mode knob). Make `0026` green; gates green. This **grounds B13** (0023's `apply()` uses
> these constants) — do it just before/with B13. Read `docs/decisions/0002` + `docs/features/0017`.
> Open a PR.

### B17 — 0027 NarrativePort LLM adapter  ·  Claude Code (+ OpenHands)

> In `kevinhirsch/orwell`, implement feature **0027**
> (`docs/features/0027-narrative-port-llm-adapter.{md,feature}`): the real async LLM behind
> `NarrativePort`, replacing `EchoNarrativePort`. Async `narrate` + `narrateStream` (token stream);
> **provider-agnostic** (Ollama / Anthropic / OpenAI-compatible) with model/endpoint/key from
> **env** (no secrets in code); **timeout + bounded retries + safe fallback**. **Vault-free by
> construction:** it gets **only** the `NarrationContext` (assembled Vault-free, 0001) — extend the
> context-assembly sentinel test. **Outcomes stay the engine's:** a narration failure or
> hallucination **changes no game state** (the port returns text, never state). In the fold, the
> **front-end `llm_core`** is the deployed realization over MCP (0009) — same two guarantees. A
> **deterministic fake** backs tests. Make `0027` green; gates green. Open a PR.

### B18 — 0028 temperature & emotional-modifier constants  ·  Claude Code

> In `kevinhirsch/orwell`, implement feature **0028**
> (`docs/features/0028-temperature-and-emotional-constants.{md,feature}`): firm 0006's shape into a
> **single tunable constants module** (sibling to `richnessConfig.ts` and the 0026 relationship
> constants) — the temperature **bound/distribution**, the **per-variable weights**, the **emotional
> modifier** (baseline / volatility scale / mean-reversion rate), and the **hidden-element surfacing
> rate**. **Defaults match 0006's calibration** (favorite ~72%, real upsets, player unprotected,
> bounded, never overrides hard rules). The emotional modifier **mean-reverts**; hidden elements
> surface **rarely**. **No number hard-coded outside the module** (a future God-Mode knob). Keep the
> 0006 calibration property green; make `0028` green; gates green. Read `docs/features/0006` +
> `docs/decisions/0001`. Open a PR.

### C7 — 0029 app admin role & user management  ·  OpenHands (+ Claude Code for any engine bit)

> In `kevinhirsch/orwell` `frontend/`, implement feature **0029**
> (`docs/features/0029-app-admin-and-user-management.{md,feature}`). Most of it exists in
> `core/auth.py` (`AuthManager`: `setup`→admin, `create_user`/`delete_user`/`rename_user`,
> `is_admin`, `list_users`, `privileges`, `change_password`) and `routes/auth_routes.py`
> (`/api/auth/users`, `/change-password`) — **close the gaps**:
> 1. **Promote/demote:** add `AuthManager.set_admin(username, is_admin, requesting_user)` (admin-only;
>    **never demote/delete the last admin**) + `POST /api/auth/users/{u}/role`.
> 2. **Admin password reset for others:** `admin_reset_password(username, new_password, admin)` (no
>    current pwd; **revoke that user's sessions**) + `POST /api/auth/users/{u}/password`.
> 3. **Admin-only Users manager in Settings:** surface list/create/promote/demote/reset/rename/delete;
>    show the section **only** when the caller has `manage_users`; **re-check the entitlement
>    server-side** on every endpoint (don't trust the hidden UI).
> 4. **Gate global LLM settings** behind `manage_llm_settings` — a regular user can't change the
>    global model/endpoint config (their own non-privileged prefs are fine).
> Gate on the **named entitlement**, not a bare `is_admin`, so finer grants are a later config
> change. This is the **app/account tier** — distinct from the game's God Mode (0016) and the
> per-user game sandbox (0021). Make `0029` green; `py_compile` clean; smoke on two accounts (an
> admin + a regular user). Open a PR.

### C8 — 0032 front-end surface reduction (the "game build")  ·  OpenHands  ·  **next front-end feature**

> In `kevinhirsch/orwell` `frontend/` (Python; **no engine change**), implement feature **0032**
> (`docs/features/0032-frontend-surface-reduction-game-build.{md,feature}`). Reduce the vendored
> general-purpose workspace to **just the Big Brother game surface** and remove every inherited
> vertical. A partial prune already exists — `static/css/game-trim.css` (CSS-hide only) and 8 keys in
> `src/settings.py` `DEFAULT_FEATURES` — but it's **cosmetic and inconsistent**: routes/JS still ship,
> `web_fetch`/`document_editor`/`rag` are still on, most verticals have **no flag**, and
> **`/api/shell/exec` + `/api/shell/stream` are LIVE** (admin-gated but only CSS-hidden). Do it in
> **three escalating tiers**:
> 1. **Flag-gate + server-side 404 (CI-green).** Extend `DEFAULT_FEATURES` with one flag per dropped
>    vertical, default **off** under a single **`ORWELL_GAME_BUILD`** profile (default on) that forces
>    the **drop-set off / keep-set on**. Gate **route registration** (don't mount a disabled vertical's
>    router) so its endpoints return **404/410**, not just a hidden button — **prove it for the shell
>    endpoints** and flip `web_fetch`/`document_editor`/`rag` off. Drop the front-end **memory/RAG/
>    skills** context injection (the engine's soul/Vault is the only memory; the engine moment prompt,
>    0018, is the only injected framing). Prune the **Settings** tabs to the keep-set.
> 2. **Stop shipping the JS (CI-green).** Don't load dropped modules — especially the ~80-file
>    `static/js/editor/` image editor — taking ~5.4 MB → a fraction.
> 3. **Delete the code (running-instance verified).** Remove the dropped verticals' `routes/` +
>    `services/` + `src/` + `static/js/` + `app.py` wiring + `index.html` tags. Because this edits the
>    large `app.py` and the shell, its DoD is a **documented run on a live instance**: boots, onboards,
>    plays a turn in-character, **renders portraits**, accounts/admin work.
> **Keep-set (must survive every tier):** main chat + streaming/SSE + session history; onboarding
> (`orwellOnboarding.js`); the LLM connection (providers/endpoints/`llm_core`, 0027) **and** the agent's
> **engine MCP tool backend** (`agent_tools.py`/`tool_schemas.py`/`orwell_engine.py` — the linchpin);
> the 0020 surfaces (status, decisions, **portraits — keep the image-GEN path**, distinct from the image
> **editor**/gallery that go); accounts/admin (0029); Settings (pruned) + Theme. **Keep voice (TTS/STT)
> behind a `voice` flag that defaults OFF** (opt-in, not deleted). Make `0032` green via
> `cd frontend && python3 -m pytest tests/` (name-agnostic — roles only; the front-end is quarantined,
> so **do not** touch `cucumber.cjs` and keep `npm test` unaffected). Read `frontend/INTEGRATION.md`
> ("Deferred: the deep code-level prune") first. Open a PR.

### B20 — 0031 game orchestrator & integrity watcher  ·  Claude Code  ·  **next engine feature**

> In `kevinhirsch/orwell`, implement feature **0031**
> (`docs/features/0031-game-orchestrator-and-integrity-watcher.{md,feature}`). The engine is
> **pull-only** today: nothing advances a game between tool calls, the **off-screen sim never ticks
> on the live path**, and **no runtime process verifies integrity**. Build the hybrid:
> 1. **Turn-driven spine** — one `Orchestrator.advance(sandbox, trigger)` that runs the off-screen
>    tick (reuse `simulation.ts`/`offscreen.ts`/`gossip.ts`, 0003), advances to the next meaningful
>    day/phase (0008/0011), folds consequences (0023), persists (0030), then runs the **integrity
>    checkpoint**. Pure-logic, **seed-deterministic** (every advance goes through this one path).
> 2. **`Clock`/`Scheduler` port** (finally) — a real-timer adapter for prod + a **fake-clock**
>    adapter for tests (no real timers anywhere in tests).
> 3. **Background watcher** — behind the scheduler, on a tick: trigger **bounded** off-screen
>    advances on **idle** sandboxes (rate-limited so a long absence can't fast-forward the season),
>    and run the integrity **audit** across all sandboxes, updating a per-sandbox **health record**.
>    The watcher holds **no game logic** — it only *triggers* `advance()` and *reads* health; cadence
>    `0` disables it (pure turn-driven fallback).
> 4. **Integrity checkpoint (fail-closed)** — verify the LIVE state vs the last snapshot:
>    non-degradation (`isSuperset`/`countsNonDecreasing`, 0007), daily-event (0008), eligibility
>    (0005), Vault-Wall sentinel-clean on player **and** admin (0001), cross-user isolation (0021).
>    On failure: **refuse the commit, keep the prior save, record a fault** — never persist a
>    degraded/leaky state.
> 5. **God Mode health surface** — add `sandboxHealth()` to the admin port: **metadata only**
>    (phase, counts, last advance/trigger, integrity status, faults), Vault-free + sentinel-clean;
>    dependency-cruiser stays green (no Vault import); player has no access.
> Make `0031` green (add to `cucumber.cjs`); keep all gates green. Read `docs/features/0003`, `0007`,
> `0008`, `0021`, `0030`, and `0016` first. Open a PR.

### B21 — complete the 0018 lever manifest (drift-guarded)  ·  Claude Code  ·  **small; finishes C6's engine half**

> In `kevinhirsch/orwell` (TS engine), complete the **0018 lever-manifest refinement** that was specced
> but never built. `src/engine/momentPrompts.ts` still names only the original **4** levers
> (`getGameState`, `runCompetition`, `recordInteraction`, `surfaceInformationTo`), while the player tool
> registry (`src/surfaces/tools/registry.ts`) now exposes many more — incl. the live-loop levers
> **`advanceGame`** and **`submitDecision`** (0034) plus `gameStatus`, `getVisibleStateFor`, `socialRead`,
> `renderScene`, `askProducers`. The model discovers them via schemas, but the in-character base prompt
> should **name** them.
> 1. Update the base prompt's **YOUR LEVERS** manifest to name **every agent-driving player lever** the
>    registry exposes (exclude pure infra — `getMomentPrompt`, `endOfSessionSummary`), keeping the
>    engine-decides-outcomes framing.
> 2. **Activate 0018's parked scenarios** — uncomment the block in
>    `docs/features/0018-narrative-moment-orchestration.feature` ("names every player-channel lever",
>    "no lever in the player tool registry is missing from it", "each moment names the lever its beat
>    calls for") and make them green.
> 3. Add a **manifest↔registry drift test** (unit) that fails if any registry agent-lever is missing
>    from the base prompt — optionally via an `agentLever: true` marker on the game-driving entries.
> Manifest is **persona/framing only** — never the Vault Wall; the prompt stays **sentinel-clean** under
> a populated Vault (the 0001 canary on `getMomentPrompt` stays green). Make `0018` green; gates green.
> Open a PR.

### B22 — 0033 engine: `playerTagline` (Vault-free, snarky, state-aware)  ·  Claude Code

> In `kevinhirsch/orwell` (TS engine), implement the **engine** side of feature **0033**
> (`docs/features/0033-dynamic-player-tagline.{md,feature}`): a Vault-free player-channel tool
> **`playerTagline()` → { text }** — a single snarky _Big Brother_ welcome line for the caller's current
> moment, **generated via `NarrativePort`** (0027) from the **Vault-free public projection only**
> (`gameStatus`: week/phase/public standing — **never** hidden votes/targeting/souls/off-screen). One
> line, bounded length; **cache per `(user, week, phase, standing)`** (regenerate when the moment
> advances, not per load); a **pre-game** default line; **fail-open** to a static themed line on
> narrator error/timeout. `readsVault: false`; extend the 0001 canary to `playerTagline`;
> dependency-cruiser green. **Anti-sycophancy:** with a seeded deterministic fake narrator over a
> weak-standing state, the line must **not** flatter. Make the engine-side `0033` scenarios green (add to
> `cucumber.cjs`); gates green. Read `docs/features/0027`, `0020`, `0001` first. Open a PR.

### C9 — 0033 front-end: render the dynamic hero line  ·  OpenHands  ·  **depends on B22**

> In `kevinhirsch/orwell` `frontend/`, implement the **front-end** side of feature **0033**: replace the
> static hero subtitle at `static/js/models.js:571` (`#welcome-sub` ← "Yours for the voyage.") with the
> engine's **`playerTagline`** (B22). Fetch it Vault-free — fold a `tagline` field into the existing
> `GET /api/orwell/state` response (`routes/orwell_routes.py` + `src/orwell_engine.py`), or add a tiny
> `GET /api/orwell/tagline`. **Fail-open:** engine down / field absent ⇒ keep the static line; the
> homepage must **never** block on the tagline. Refresh on the SSE/session-sync tick that already drives
> play. Part of the **0032** game build. `pytest` green; `py_compile` clean; engine gate unaffected.
> Depends on **B22**. Open a PR.

### B23 — 0034 codify the live progression & decision seam (as-built)  ·  Claude Code  ·  **mostly codification**

> In `kevinhirsch/orwell` (TS engine), implement feature **0034**
> (`docs/features/0034-live-weekly-progression-and-decision-seam.{md,feature}`). The capability is
> **already built** (`src/engine/liveSeason.ts`, `GameSessionAdapter.advanceGame()/submitDecision()`, the
> `GameSession` port, the `advanceGame`/`submitDecision` tools + MCP client + agent tools + status panel,
> with unit + integration tests) — but it shipped **without a name-agnostic `.feature`**. Add that spec
> (to `cucumber.cjs`) and **assert the cross-cutting guarantees** so the live loop can't regress: NPC
> beats auto-resolve; the loop **stops** for the player's binding decision and returns the **legal**
> option set; a binding choice changes state **only** via the validated `submitDecision`, **never** from
> prose; **illegal** choices are rejected (0005); each beat **persists** and **survives a restart**
> (0030); the live path is **Vault-free** — and where the explicit Vault sentinel on `advanceGame`/
> `submitDecision`/`gameStatus` output isn't already covered, **add it** (extend the 0001 canary);
> seed-deterministic. Most steps map to the **existing** code — this is codification + targeted
> hardening, not a rebuild. Pairs with **B21** (the manifest must name `advanceGame`/`submitDecision`).
> Make `0034` green; gates green. Read `docs/features/0011`, `0019`, `0005`, `0030`, `0001` first. Open a PR.

### B24 — 0035 start the off-screen watcher in the runtime  ·  Claude Code  ·  **TOP functional priority (mandate #1)**

> In `kevinhirsch/orwell` (TS engine), implement feature **0035**
> (`docs/features/0035-live-offscreen-life-running-watcher.{md,feature}`). 0031 built the `Orchestrator` +
> `GameWatcher` + `Clock`/`Scheduler` port (BDD-green with `FakeClock`), but the **live runtime never
> starts them** and there's **no real-timer Clock adapter** — so the live game has **zero off-screen NPC
> life** (the house is static between turns; a direct miss against **behavioral-fidelity mandate #1**).
> 1. Add a **`SystemClock`** real-timer adapter (sibling to `FakeClock`) implementing the 0031
>    `Clock`+`Scheduler` port (`now` = `Date.now`; `every` = `setInterval(...).unref()`; `cancel` =
>    `clearInterval`).
> 2. **Instantiate + `start()`** a `GameWatcher` over the live `GameSessionRegistry` in `src/main.ts`
>    (or a small runtime root), with graceful **`stop()`** on shutdown.
> 3. **Env config** for cadence/idle/rate-limit (`ORWELL_WATCHER_TICK_MS`/`IDLE_MS`/`MAX_TICKS`, sane
>    defaults; **`TICK_MS=0` disables** ⇒ pure turn-driven).
> Reuse 0031's logic unchanged. **Assert under the running watcher:** idle sandboxes accrue **bounded**
> off-screen consequences; the player sees **no opinion numbers** (extend the 0001 canary); **per-user
> isolation** holds (0021); a long absence advances at most `MAX_TICKS` (no season fast-forward). Tests
> still use **`FakeClock`** (no real timers in tests). Make `0035` green (add to `cucumber.cjs`); gates
> green. Read `docs/features/0031`, `0003`, `0001`, `0021` first. Open a PR.

### B25 — 0036 live social surface: NPC approaches + Diary Room  ·  Claude Code

> In `kevinhirsch/orwell` (TS engine), implement feature **0036**
> (`docs/features/0036-live-social-surface-approaches-and-diary-room.{md,feature}`): expose two
> **built-but-unwired** capabilities as Vault-free live player tools (add to `PLAYER_TOOLS` + the McpServer
> allowlist + the **B21** lever manifest).
> 1. **`socialInitiatives()`** — surface houseguests who, by soul motivation, want to **approach the
>    player now** (source: `src/engine/conversation.ts` `npcInitiatedApproaches()`), with a **public-facing
>    pretext only** (no hidden motive/numbers) — so scenes are **bidirectional**, not only player→NPC.
> 2. **`diaryRoom(entry)`** — record a player DR entry as **OOC player knowledge** tagged `NO_NPC_PATHWAY`
>    via `KnowledgeService.recordDiaryRoom()`; it **may** inform the engine's read of player strategy but
>    **never** NPC behavior.
> **The wall is the crux:** extend 0013's exclusion test to the **live tool** — prove **no NPC ever learns
> DR content** (`deriveNpcKnowledge` excludes it) and NPCs act only on **public** speech; NPC confessionals
> stay **Vault-only**. Both `readsVault:false` + **sentinel-clean** (extend the 0001 canary). Make `0036`
> green (add to `cucumber.cjs`); gates green. Read `docs/features/0012`, `0013`, `0002`, `0001` first. Open a PR.

### C10 — 0036 front-end: surface approaches + a Diary-Room entry point  ·  OpenHands  ·  **READY — API wired; UI only**

> In `kevinhirsch/orwell` `frontend/`, build the **player-facing UI** for feature **0036** per its design
> note **§7** (`docs/features/0036-…md`). The engine tools **and the front-end API are already wired** — you
> only build the UI on top of these live, Vault-free routes:
> - `GET /api/orwell/initiatives` → `{ initiatives: [{ houseguest: { id, name }, pretext }] }` — surface the
>   approachers **unobtrusively** in the main chat (a small dismissible "**{name}** {pretext}" affordance by
>   the composer); acting on one starts a normal scene, ignoring is fine. Refresh on the status-panel cadence.
> - `POST /api/orwell/diary-room` `{ entry }` → `{ recorded: true }` — a clearly-labelled **Diary Room** entry
>   point (button/panel) for a private confessional; confirm on success; make the **OOC / "the house never
>   hears this"** nature explicit.
> **Constraints:** render **only** the route payloads (Vault-free); **fail open** (no approach chip on
> empty/error, graceful inline error for DR — never block the chat); keep it in the **0032 game-build
> keep-set** (game-in-progress only; survives the prune). **DoD:** `cd frontend && python3 -m pytest tests/`
> green (roles only); the **0032 headless-browser gate** (`scripts/browser_smoke.py`) still loads the keep-set
> with no broken modules; verify on a **running instance** (per `frontend/INTEGRATION.md`). Engine gate
> unaffected (front-end quarantined). Open a PR.

### B26 — 0037 engine: expose a Vault-free `finaleView` read  ·  Claude Code  ·  **small; unblocks C11** — ✅ DONE

> **DONE.** `GameSessionAdapter.finaleView()` is public + on the `GameSession` port; `finaleView` added to
> `PLAYER_TOOLS` + `McpServer` dispatch + `INFRA_LEVERS` (so the lever-manifest drift guard doesn't name it).
> The B42 sentinel sweep now calls it at every beat (incl. the live finale); a behavioral test proves it is
> null off-finale and mirrors `AdvanceView.finale` during one (no votes/script/tally/lean). arch + gate green.

> In `kevinhirsch/orwell` (TS engine), promote the existing private `GameSessionAdapter.finaleView()` to a
> **read tool** `finaleView(): FinaleView | null` on the `GameSession` port + `PLAYER_TOOLS` + `McpServer`
> dispatch (per `docs/features/0037-…md` §8.1). `readsVault: false`; classify it **infra** (add to
> `INFRA_LEVERS`, like `gameStatus`/`playerTagline`) so the lever-manifest drift guard doesn't require naming
> it. It returns the **same Vault-free projection** already proven on `AdvanceView.finale` — names + current
> stage + the reveals SO FAR only, **never** a lean/tally/eviction-manner/pre-reveal winner. Extend the 0001
> sentinel canary to `finaleView`; `npm run test:arch` + `npm test` green. Open a PR.

### C11 — 0037 front-end: render the interactive finale  ·  Claude Code  ·  **depends on B26** — ✅ DONE

> **DONE** (built in the Claude Code lane). `GET /api/orwell/finale` → `{ finale: FinaleView | null }`
> (fail-open) + an `orwell_engine.finale_view` client over the B26 tool. `static/js/orwellFinale.js` — a
> self-contained, fail-open, draggable/minimizable polling panel (sibling of `orwellSocial.js`, no new module
> deps, script-tagged after the social panel): shown only while a finale stages, it renders the finalists, the
> stage, and the vote reveal IN ORDER with a tally of the revealed votes only (never a pre-reveal winner). The
> player's turn is surfaced as composer-prefill shortcuts (player-finalist → statement/appeals; player-juror →
> finalist vote); binding submission flows through the chat-agent `submitDecision` seam. `tests/test_orwell_finale.py`
> (3, fail-open) + 184 pytest green; the 0032 headless-browser keep-set gate stays green (`orwellFinale.js`
> loads cleanly). No new `submitDecision` kind ⇒ no C12 relay change.

> In `kevinhirsch/orwell` `frontend/`, build the finale **presentation UI** for feature **0037** per its design
> note **§8** — the direct parallel to 0036's C10, in the same self-contained, fail-open, game-gated patterns as
> `orwellStatusPanel.js` / `orwellSocial.js`:
> - **Route:** `GET /api/orwell/finale` → `{ finale: FinaleView | null }` (mirror `/status`; add an
>   `orwell_engine.finale_view` client over the **B26** `finaleView` tool). Fail-open to `{ finale: null }`.
> - **`orwellFinale.js`** — a polling panel shown **only while a finale is staging**: the two **finalists**,
>   the **stage** (`statements|questions|vote|reveal`), and the **vote reveal IN ORDER** (`reveals[]` as they
>   appear, with a running tally of **revealed** votes only — **never** a pre-reveal winner/tally). On
>   completion the crown lands via `AdvanceView.winner`.
> - **Player decisions** (`finale-statement` / `finale-answer` with the legal `appeals[]` + the asking juror /
>   `juror-vote` over the two finalists) are surfaced as **composer-prefill shortcuts** (like `orwellSocial`'s
>   approach chips); binding submission still flows through the chat-agent `submitDecision` seam — the panel
>   only presents the legal options; the engine validates + scores (the prose carries no score).
> **Constraints:** render only the Vault-free payloads; fail-open; **0032 keep-set** (live-finale only, no new
> module deps → browser-smoke safe); script-tag after the social panel. **DoD:** `pytest` green (roles only —
> finalist/juror); the 0032 headless-browser gate stays green; engine gate unaffected; verify on a running
> instance. Depends on **B26**. Open a PR.

---

## Post-audit feature batch (0038–0044) · all Claude Code (engine)

A behavioral-fidelity / anti-sycophancy audit (transcript) found several capabilities **built but unwired**
and two genuine gaps. These specs close them. Build priority: **0038 first** (biggest "feels flat" risk,
pure wiring), then 0039 & 0040 (genuine gaps), then 0041/0042/0043/0044.

### B27 — 0038 live off-screen society  ·  **B27a DONE; B27b remaining**

> **B27a (DONE):** the orchestrator's live off-screen tick (`Orchestrator.defaultApply`) now runs
> `richOffscreenStretch` — **seven varied interaction types** folded into the relationship layer by their true
> nature (was a 4-verb stub). Bounded/seeded/Vault-walled/isolated; unit-gated (`offscreenSociety.test.ts`).
>
> **B27b (remaining) — see `docs/features/0038-…md` §8 for the full design.** (1) **live gossip→player
> diffusion**: the fix is (a) make the **0031 leak heuristic pathway-aware** — flag a hidden event's content
> as a leak only if it appears in the player projection AND is **not covered by the player's legitimate
> `KnowledgeService` facts** (gossip "told-by"/"overheard"/"surfaced" pathways); the **0001 sentinel canary
> stays** the precise guard; (b) keep the rumor a **vague paraphrase** (never the verbatim hidden scene);
> (c) wire `diffuseGossip` into the off-screen tick over a house graph with a **low transmit probability**
> (partial, distorted spread), reaching the player only via a terminating pathway as a belief with
> source+confidence. **Acceptance:** a rumor reaches the player AND the 0031 checkpoint still commits (no
> false leak) AND the 0001 canary stays green. (2) **soul deepening** is **feature 0041**. Then add 0035 +
> 0038 to `cucumber.cjs`. Gates green. Open a PR.

### B28 — 0039 promise & deal tracking

> Implement `docs/features/0039-promise-and-deal-tracking.{md,feature}`. Add a first-class `Deal` model
> (parties/terms/condition/status); make player↔NPC deals (recorded knowledge) + NPC↔NPC deals (Vault-held);
> **reconcile** open deals against binding actions (engine-decided kept/broken, never prose); on break apply
> the **betrayal-shock** fold (0026) + a jury-management demerit (0014) + a witnessed reveal. Persisted (0030);
> Vault-walled (NPC↔NPC reach the player only by 0038 rumor). Add to `cucumber.cjs`. Open a PR.

### B29 — 0040 NPC Diary Room confessionals  ·  **DONE (core)**

> ✅ `src/engine/confessionals.ts` (`confessionalFor` + `recordConfessional`): an engine-grounded private read
> (top-threat target + strongest bond, from the relationship signals — not invented), recorded **Vault-only**
> (hidden, `witnessSet:[npc]`); wired into the live off-screen tick. Proven **walled from the player AND the
> admin** (the admin surface reads no events) + seed-deterministic — `tests/unit/npcConfessionals.test.ts` (5).
> **Remaining:** the **soul-recall feedback** (grounding the NPC's later voice) needs a `SoulStore` in the live
> sandbox — **feature 0041**; optionally fire confessionals specifically at nomination/eviction beats (today
> the trigger is the off-screen tick).

### B30 — 0041 character evolution & season arc  ·  **LINCHPIN (unblocks 0038 + 0040 soul pieces)** — ✅ DONE

> **DONE.** `SoulStore` is wired into the live `EngineCore`/`buildEngineCore` (deterministic embed),
> walled engine-only by dependency-cruiser (soul/vector/embedding types in the forbidden set). The live
> consequence fold (`GameSessionAdapter.commit`) + the off-screen tick (`Orchestrator.defaultApply`) drive
> `src/engine/emotionalArc.ts` (`evolveEmotion`): bounded, mean-reverting soul `emotionalState`/`volatility`
> from real events, a persisted `emotionalHistory` arc, and `recordToSoul`/`recall` live. The evolving
> state modulates the live competition emotional modifier (0006/0028) + a rattled-HOH nomination read
> (`chooseNominationsWithMood`); `CHARACTER` stays byte-stable (0007); no number on any player surface
> (canary extended); persisted across restart (0030). Added to `cucumber.cjs`. Original prompt below.
>
> Implement `docs/features/0041-character-evolution-and-arc.{md,feature}` — **see §8 for the concrete live
> wiring.** The crux: the live sandbox's `buildEngineCore` (`engineRoot.ts`) has **no `SoulStore`** — that's
> why 0038's soul-deepening and 0040's confessional→voice feedback are deferred. (1) Add **`soul: SoulProvider`**
> to `EngineCore`/`buildEngineCore` as `new SoulStore(embed, makeIndex)` with a **deterministic fake embed**
> (seeded hash→vector, like 0024's tests); **extend the dependency-cruiser engine-only forbidden set** so no
> outward surface imports the soul/vector types (like `VaultStore`). (2) Drive `emotionalState`
> `{distress,confidence,volatility}` from **live** events (blindside→distress, survival/win→confidence),
> bounded + mean-reverting (0028 family); call `recordToSoul` on the consequence fold (0023) + the off-screen
> tick (0038). (3) Have the evolving state modulate the **competition emotional modifier** (0006/0028) **and**
> decision leanings; expose `recall` for 0040's voice grounding. Keep `CHARACTER` **byte-stable** (0007); only
> the soul drifts; no emotional number on any player surface (extend the 0001 canary). Add to `cucumber.cjs`.
> Open a PR.

### B31 — 0042 competition library

> Implement `docs/features/0042-competition-library.{md,feature}`. A seeded, tunable `COMPETITION_LIBRARY` of
> `CompetitionDef`s (name, governing/secondary stat, format, Vault-free narrative scaffold) + a deterministic
> `drawCompetition(phase, week, rng, recent)` (no immediate repeats) replacing the hardcoded `HOH_TYPES`/
> `VETO_TYPES`. Resolution stays `resolveCompetition` (engine decides — 0006/0028); the Vault-free result
> carries name+format+narrative (no stats/scores); 0005 eligibility holds. Add to `cucumber.cjs`. Open a PR.

### B32 — 0043 emergent multi-party bloc behavior

> Implement `docs/features/0043-emergent-bloc-behavior.{md,feature}`. A **pure, stateless** `detectBlocs(rel,
> active)` that clusters mutual bonds at decision time (size ~2–5), each bloc deriving a shared target +
> cohesion; add a **bloc term** to nomination/vote leanings (vote-with / shield bloc-mates / target the shared
> enemy); fracture is implicit (recomputed). **Nothing stored** — the serialized soul holds no bloc/label
> (decision 0002; cross-check 0007). Vault-free. Add to `cucumber.cjs`. Open a PR.

### B33 — 0044 strategic nomination & vote refinements  ·  depends on 0039/0041/0043

> Implement `docs/features/0044-strategic-nomination-and-vote-refinements.{md,feature}`. Enrich the **built**
> `chooseNominations` (add pawn/backdoor/bloc-protection, archetype-gated, + the week's political temperature)
> and `npcChoice` (fold bloc 0043 + emotional state 0041 + deal status 0039). Still **engine-decided** + seeded;
> all magnitudes in **one tunable constants module** (sibling to 0026/0028). The threat/political-temperature
> parts can ship first; the bloc/mood/deal terms as those land. Add to `cucumber.cjs`. Open a PR.

---

## Still on the feature-maker (me)

**0001–0036 are built** (0022 deferred). The "continue all wiring" batch shipped the engine + API wiring:
**B24/0035** (SystemClock + `composeRuntime` start the off-screen watcher in `main.ts` — the house now lives
between turns), **B25/0036** (`socialInitiatives` + `diaryRoom` live tools), **B21/0018** (full lever manifest
+ drift guard), **B22/0033** (`playerTagline`), **B23/0034** (live-seam BDD), and front-end **C9/0033** (the
hero line now shows the engine's snarky tagline, fail-open) + the **0036 front-end API** (`/api/orwell/tagline`,
`/initiatives`, `/diary-room` + engine-client methods). Full engine gate green: **214 unit + 213 BDD**.

**The "continue all wiring" batch is done** (C10 = `orwellSocial.js`, merged). Since then the other agents
shipped **0037 — the interactive finale / jury-vote choreography** (engine built & BDD-green: appeal scorer +
staged statements → questions → vote reveal, through the 0034 seam) plus game-UI fixes (draggable HUDs, theme
picker). Engine gate green: **230 unit + 222 BDD**.

**Remaining — ALL implementer-ready (each carries a §8 "Definition of Ready": exact touch points, build
order/deps, test targets, no open decisions):**
- **0038** live off-screen society — **B27a done**; the **live soul-deepening half is now wired by 0041**
  (the off-screen tick `recordToSoul`s each scene); **B27b** (gossip↔checkpoint reconciliation) still ready (0038 §8).
- **0040** NPC confessionals — **done**; soul-recall feedback is now **live** (0041 put the `SoulStore` in the sandbox).
- **0041** character evolution/arc — **✅ DONE (B30, the LINCHPIN).** `SoulStore` is wired into the live
  `EngineCore`; the consequence fold + off-screen tick drive bounded, mean-reverting soul evolution that
  modulates the live competition modifier + a rattled-HOH nomination read; the arc persists + is recall-able;
  `CHARACTER` byte-stable; no number on any player surface. Unblocked the deferred soul halves of 0038 + 0040.
- **0039** promise/deal tracking — **done (B28)** · **0042** competition library (§8) → B31 · **0043** emergent bloc
  behavior (§8, honors ADR 0002) → B32 · **0044** strategic nom/vote refinements (§8) → B33.
- **0037 finale UI** — **B26** (Vault-free `finaleView` read) → **C11** (`orwellFinale.js`), per 0037 §8.
- **0022 — MVP-2 (the rich game UI)** — the one deferred feature (no DoR yet).
- **The audit batches below** — the **full product-audit batch (B34–B60 / C12–C18)** and the **front-end &
  experience batch (B61–B66 / C19–C28)**, both wave-ordered, governed by ADR 0003; audit specs
  **0045–0048 are drafted**, **0049** (B64) still to draft.

**Suggested build order for the implementer agents:** ~~0041 (linchpin)~~ **done** → 0039 (done) / 0043 → 0044
(consumes 0043 + 0041) → 0042 → B27b → 0037 UI — interleaved with the audit batches' waves (**Wave 0 hotfixes
B34–B36/C12 first**; B61/C19 are the highest-leverage experience pair). Each is independently buildable per its §8.
- *(By design, not a gap: the live engine narrator is `EchoNarrativePort`; the front-end narrates via
  `getMomentPrompt`. The `playerTagline` `setNarrator` seam is ready if engine-side narration is ever wired.)*

---

## Product ruling: the house does not exist when the player leaves (2026-06-10)

**Ruling.** The game clock runs only when the player is playing. When the player steps away — closes
the browser, ends the session — **the house ceases to exist**. No background scheming, no NPC social
ticks, no relationship drift, nothing. The lack of real estate is the core mechanic of Big Brother:
nobody leaves the house. Because the player *can* leave and NPCs cannot, any background activity that
accrues during player absence creates a structural playability asymmetry. The engine must not exploit
the player's absence against them.

**Implementation (done — `src/composition/runtime.ts`).** `DEFAULT_WATCHER.tickEveryMs` is now `0`
(pure turn-driven). The watcher is disabled by default. The house **only lives between the player's
own turns** via the existing `Orchestrator.maybeTurnDrivenTick` (one bounded off-screen tick per
player action, already built). If an operator wants real-time background life, they opt in via
`ORWELL_WATCHER_TICK_MS` — but it must never be the default.

**What "a player turn" means.** A player turn is any **state-mutating game action**: `advanceGame`,
`submitDecision`, `recordInteraction`, `makeDeal`, `diaryRoom`, `surfaceInformationTo`,
`createCharacter`. Read-only calls (`getGameState`, `gameStatus`, `playerTagline`, `getMomentPrompt`,
`socialInitiatives`, `runCompetition`) are not player turns — they don't mutate state and don't
trigger the off-screen tick. This is already encoded: only mutating ops call `onPersist()` →
`commitPlayerTurn()` → `touch()` → `maybeTurnDrivenTick()`.

---

## Full product-audit batch (B34–B60 / C12–C18) · 2026-06-09

Dispatch prompts for the **full product audit** (`docs/audits/2026-06-09-product-audit.md`). All gates were
green at audit time — every item below is *unasserted* behavior (a gap between the code and the game's own
mandates), not a failing test. **Read the audit's "Remediation principles (the preferred how)" section first** —
the seven patterns (single outcome authority · the pending-decision seam · validated references in / projections
out · folds in the commit path + constants modules · the orchestrator as the real spine · the versioned snapshot
as the contract · gates on the production path) are the architectural spine of these fixes; a fix that fights one
of them is probably wrong. **Lane note (current reality): OpenHands is not yet configured, so Claude Code owns
both lanes** — the engine items (`src/`, B-numbered) **and** the front-end items (`frontend/`, C-numbered). The
B/C split is kept as a **scope** marker (which tree the change lives in + the quarantine rules), not an agent
assignment; pick up C-items as readily as B-items. When a C-item touches `frontend/`, keep it quarantined from
the TS gate (`cd frontend && python3 -m pytest tests/`; never touch `cucumber.cjs`/`npm test`). House rules apply
(Vault Wall structural; `npm run test:arch` green; BDD/TDD-first; roles-only tests; keep gates green; PR per item).

**Feature-maker note:** four items need a `docs/features/NNNN-*.{md,feature}` spec **drafted first** before the
engine prompt can run — **0045** (B43), **0046** (B48), **0047** (B49), **0048** (B56). Draft them in the existing
spec style (design note + name-agnostic Gherkin) before dispatching those B-items.

| Wave | Item(s) | Lane | Audit ref | Depends on |
|---|---|---|---|---|
| **0 — hotfixes** | ✅ B34 bind+auth · ✅ B35 atomic/tolerant saves · ✅ B36 createCharacter guard · **C12** finale relay + engine-down fail-closed + reset guard *(FE, remaining)* | both | E1·E2·A2 / B3·F2·A2 | — |
| **1 — ground truth** | B37 single comp authority · B38 ceremony folds · B39 knowledge integrity · B40 snapshot completeness · B41 orchestrator spine · B42 live sentinel sweep | engine | A1·A3 / C1 / A4 / C2·C3·C4 / E3·D4 / E8 | B36 (B40 reads the snapshot) |
| **2 — the endgame** | B43 0045 F5→2 · B44 tie-break · B45 Houseguest's Choice · B46 comp intent · B47 jury manner+appeal symmetry · B48 0046 player eviction · B49 0047 eviction night · **B26/C11** finale UI | engine + FE | B1 / B2 / B4 / B5 / A5·A6 / B6 / B7 | B43 first (others extend the F5→2 loop); B26/C11 already queued |
| **3 — the living house** *(merge with 0038–0044)* | **B30/0041 first** · B50 hidden elements · B51 emotional modifier · B52 evictee filters · B53 twists live · B54 live richness gate · B55 loop unification + relationship realism | engine | D1 / D2 / D5 / D6·B8 / D3 / D12·C5·C6 | 0041; D7 folds into B32/B33 |
| **4 — the experience** | **C13** lever drift · **C14** agent-path + immersion · **C15** onboarding/history · **C16** 0022 first slice · B56 0048 + **C17** recap/unseal UI | front-end + engine | F1 / F3·F6 / F5·F7 / F9 / G4 | B56 spec; C17 depends on B56 |
| **continuous** | B57 doc-hygiene · B58 ops (prune/admin/faults) · B59 boundary+catalog · B60 transport robustness · **C18** FE minors | both | H1 / E4·E5·E6 / E7·I / E9–E12 / F8 | — |

---

### B34 — close the engine network boundary (bind + auth + identity)  ·  Claude Code  ·  **Wave 0 hotfix · audit E1** — ✅ DONE

> **DONE.** `HttpMcpServer` binds `127.0.0.1` by default (`ORWELL_ENGINE_HOST` override); an optional
> `ORWELL_ENGINE_TOKEN` is required on every tool route (401 on mismatch; `/health` stays open);
> `ORWELL_ENGINE_MULTIUSER` rejects a missing `x-orwell-user` (400) instead of a shared `"default"`;
> and a non-`createCharacter` call for an unknown user is refused (404) without minting a sandbox.
> All default OFF (single-tenant loopback unchanged). `tests/integration/httpBoundary.test.ts`;
> `docs/INSTALL.md` documents the knobs and agrees with the bind. Original prompt below.

> In `kevinhirsch/orwell` (TS engine), close the cross-user network hole. Today `createHttpMcpServer(...).listen(port)`
> binds **`0.0.0.0`** (`HttpMcpServer.ts:75-77`; `main.ts:41` even logs it) while the deploy docs claim loopback,
> identity is the client-supplied `x-orwell-user` header defaulting to `"default"` (header-less clients silently
> **share** a sandbox), the **admin** channel is equally open, and `sandboxFor` mints a sandbox for any string (memory
> DoS, never evicted). (1) Bind **`127.0.0.1`** by default, host configurable via env. (2) Add a shared-secret
> **`ORWELL_ENGINE_TOKEN`** checked on every request (401 on mismatch). (3) In a multi-user mode flag, **reject** a
> missing/empty user header (400) instead of routing to `"default"`. (4) Cap registry size / require the user to exist
> in the save store for non-`createCharacter` calls. In-process isolation (0021) already holds — this is the network
> edge. **Acceptance:** integration tests — connection refused from a non-loopback bind in default config; 401 without
> the token; 400 (not `"default"` routing) without the user header in multi-user mode; deploy README and actual bind
> agree. Read `docs/features/0021` first. Open a PR.

### B35 — make saves crash-safe (atomic write + tolerant load + handler guards)  ·  Claude Code  ·  **Wave 0 hotfix · audit E2** — ✅ DONE

> **DONE.** `FileSaveStore.saveFor` writes a `.tmp` then `renameSync` (atomic); `loadLatest`
> quarantines a corrupt highest version (`.corrupt`) and steps down to the last good one (null only
> when nothing parses). The HTTP request handler is guarded (→500, splitting a sandbox-resolve
> failure from a bad tool/args→400) and `GameWatcher.onTick` isolates each user in try/catch.
> `tests/unit/saveCrashSafety.test.ts` + the 500-isolation case in `httpBoundary.test.ts`. Prompt below.

> In `kevinhirsch/orwell` (TS engine), stop one corrupt save from crash-looping the engine for **all** users. Today
> `FileSaveStore.saveFor` does a non-atomic `writeFileSync` (truncation on crash), `loadLatest` does an unguarded
> `JSON.parse` with no fallback, and `sandboxFor` runs un-caught inside the HTTP request listener (`HttpMcpServer.ts:52`)
> and the watcher tick (`gameWatcher.ts:49-67`) — so a truncated highest-version file is an uncaughtException → process
> exit, and the same file is "latest" on restart → crash loop. (1) Write to `vNNNNNN.json.tmp` + `renameSync`. (2) In
> `loadLatest`, on parse error **quarantine** the bad file and **step down** to the next-lower version. (3) Wrap the
> HTTP request handler (→ 500) and `GameWatcher.onTick` (→ recorded fault, skip) in try/catch. **Acceptance:** unit —
> truncate the latest version file ⇒ `loadLatest` returns v(N−1) and `sandboxFor` resumes; integration — a corrupt file
> ⇒ one 500, other users unaffected, process alive; the watcher tick over a corrupt-save user does not throw. Open a PR.

### B36 — guard `createCharacter` against wiping a started season  ·  Claude Code  ·  **Wave 0 hotfix · audit A2 (engine half; FE mirror in C12)** — ✅ DONE

> **DONE.** `GameSessionAdapter.createCharacter` refuses to replace a started game unless an explicit
> `confirmRestart` is set — it returns the current state unchanged and writes no new save version, so
> a stray/hallucinated/network call can't wipe an active season. A real restart goes through the admin
> reset path (`registry.resetUser`); `confirmRestart` is not in the player tool's documented schema.
> `tests/unit/createCharacterGuard.test.ts`. Original prompt below.

> In `kevinhirsch/orwell` (TS engine), `GameSessionAdapter.createCharacter` (`:206-228`) unconditionally replaces the
> house, resets to week 1, and **persists** — wiping an active game (reachable by any GM hallucination or network
> caller). Refuse when `started && !confirmRestart` (explicit arg), returning the existing view unchanged; route a real
> restart through admin `manageSandbox reset` / `registry.resetUser` (wired in B58/E5). Honors the non-degradation
> mandate at its single most destructive point. **Acceptance:** a second `createCharacter` without the flag leaves
> state byte-identical (prior save versions intact); the fresh-sandbox onboarding flow is unaffected. Open a PR.

### B37 — one competition authority (`runCompetition`/`resolveCompetition` delegate)  ·  Claude Code  ·  **Wave 1 · audit A1 + A3** — ✅ DONE

> **DONE.** The two-resolver fork is gone. `liveSeason` now owns the single competition resolution
> (`resolveHoh`/`resolveVeto` + a non-mutating `peekCompetition`), and `GameSessionAdapter.runCompetition`
> only PREVIEWS it — the loop (`advanceGame`) crowns the same winner (same seed). It validates references
> (unknown/evicted ids → null) and ignores foreign input (caller subset/stats never used); the win is
> recorded by the loop and survives restart. `momentPrompts.ts` steers ceremony comps to `advanceGame`.
> `tests/unit/runCompetition.test.ts` (9, incl. preview==crown, evicted-never-crowned, survives-restart).
> Original prompt below.

> In `kevinhirsch/orwell` (TS engine), eliminate the two-resolver fork. `runCompetition` (`GameSessionAdapter.ts:418-438`)
> resolves over the **full roster incl. evicted HGs**, accepts arbitrary caller `participantIds`, and records/persists
> **nothing**, while the real HOH/veto winner is computed independently in `advanceGame` with a **different** RNG stream —
> so the narrator can announce winner X while the loop crowns Y (the GM prompt tells it to call both,
> `momentPrompts.ts:76-84`). Per remediation principle #1 (single outcome authority) + #3 (validated references):
> during a live game make `runCompetition`/`resolveCompetition` **delegate** to the loop's already-resolved beat (or
> advance it) — **ids only**, stats resolved from the live house, unknown/evicted ids rejected, foreign fields ignored —
> and **record + persist** a `competition` event. Update `momentPrompts.ts` to steer ceremony comps to `advanceGame`.
> **Acceptance:** unit — at `hoh-competition`, `runCompetition(...)` then `advanceGame()` name the **same** winner; no
> `evictionOrder` member in any pool; caller-supplied stats are ignored; the win is in the event store and survives
> restart. Open a PR.

### B38 — fold hidden consequence into the ceremony beats  ·  Claude Code  ·  **Wave 1 · audit C1 (the consequence-loop hole)** — ✅ DONE

> **DONE.** A `CEREMONY_IMPACTS` table (`relationshipConstants.ts`) maps each consequential act to an
> existing `InteractionType`, and `GameSessionAdapter.foldCeremonyConsequence` applies engine-owned
> directed folds in the commit path: nomination ⇒ nominee→HOH adverse; veto save ⇒ saved→holder bond;
> replacement ⇒ replacement→HOH betrayal-shock-if-trusted; eviction ⇒ evictee→(HOH+voters) adverse +
> survivors→outgoing-HOH threat; comp win ⇒ house→winner threat. Magnitudes come only from the
> constants module; the move persists across restart and never reaches a player surface (0001 canary).
> `tests/unit/ceremonyConsequence.test.ts` (3). Original prompt below.

> In `kevinhirsch/orwell` (TS engine), the 0023 backbone is bypassed by the weekly loop itself: `liveSeason.ts` only
> **reads** relationships — nominations, veto saves, replacements, and eviction votes move no trust/affinity/threat
> (`ConsequenceEngine.recordVoteAgainstPlayer`/`recordCompetitionWin` have zero production callers). The game's most
> consequential acts are the only ones with no consequence. Per remediation principle #4 (folds in the commit path,
> magnitudes in constants): add a `CEREMONY_IMPACTS` table to `relationshipConstants.ts` and apply engine-owned
> directed folds in the commit/advance path — nomination ⇒ nominee→HOH adverse (threat▲ trust▼); veto save ⇒ saved→holder
> bond; replacement ⇒ replacement→HOH betrayal-shock if trusted; eviction ⇒ evictee→(HOH+voters) adverse + survivors'
> threat reads; comp win ⇒ everyone's threat▲ toward the winner. **Acceptance:** unit — after a player-HOH nomination via
> `submitDecision` the nominees' hidden edges toward the player worsen and **persist across snapshot/restore**;
> magnitudes come only from the constants module; **no number appears on any player surface** (extend the 0001 canary).
> Read `docs/features/0023`, `0026` first. Open a PR.

### B39 — anchor surfaced facts; validate recorded interactions  ·  Claude Code  ·  **Wave 1 · audit A4 (+ spec amend 0002/0009)** — ✅ DONE

> **DONE.** (a) `surfaceInformationTo` is anchored: `told-by:<id>` requires the teller to hold or have
> witnessed the fact, `overheard:<eventId>` requires the event to exist — else it is downgraded to a
> **suspicion** (returns null), never knowledge; and it now persists (`onPersist`). (b) `recordInteraction`
> refuses any initiator/witness that is not a LIVING houseguest (a `livingProvider` wired from the session)
> and caps per-call folds. Specs 0002/0009 amended. `tests/unit/knowledgeIntegrity.test.ts` (6). Prompt below.

> In `kevinhirsch/orwell` (TS engine), close the anti-sycophancy hole where the narrator mints ground truth.
> `surfaceInformationTo` accepts any `fact.content` + free-string `pathway` with no check that the claimed teller holds
> the fact or that a pathway event exists (and never persists); `recordInteraction` lets the caller set
> initiator/witnesses/kind/**direction** freely. Per principle #3: (a) require a surfacing's `pathway` to reference a
> **real** fact the claimed teller holds (`told-by:<id>` where `knowledge.knownTo(id)` matches) or an `overheard:<eventId>`
> that exists with the claimed speaker as witness — otherwise record a **suspicion**, not knowledge; add `onPersist`.
> (b) `recordInteraction`: require initiator/witnesses to be **living** houseguests; cap per-turn folds. Amend
> `docs/features/0002` / `0009` to pin the contract. **Acceptance:** unit — an unanchored surfacing is downgraded/refused;
> an interaction naming an evicted houseguest is refused; every player-known fact traces to a recorded source. Open a PR.

### B40 — complete the durable snapshot (knowledge + suspicions + counters + version)  ·  Claude Code  ·  **Wave 1 · audit C2 + C3 + C4** — ✅ DONE

> **DONE.** The knowledge layer now round-trips: `InMemoryKnowledgeService.serialize/load` (facts +
> suspicions + seq/tick) ride in `SessionSnapshot`, `toGameState().knowledge` is populated (the 0031
> checkpoint counts it), `recordInteraction` derives id+ts from the store size (restart-safe — no more
> duplicate ids), and `InMemoryEventStore.record` throws on a duplicate id. A `snapshotVersion` is
> written + validated: an unknown/future version is rejected into a fresh sandbox (no crash), a
> versionless legacy save migrates forward. `tests/unit/snapshotCompleteness.test.ts` (5). Prompt below.

> In `kevinhirsch/orwell` (TS engine), the knowledge layer is **not in the snapshot**: `exportSnapshot` = core + events
> + relationships only; restore builds a fresh empty `InMemoryKnowledgeService`; `toGameState` hardcodes `knowledge: []`
> (`sessionSnapshot.ts:76`) so the 0031 superset checkpoint is structurally **blind** to the loss — after a restart,
> everything houseguests told the player is gone (a silent mandate-#4 violation). Per principle #6 (the snapshot is the
> contract): (1) serialize **knowledge + suspicions** (and the `seq`/`tick` id counters — they restart at 0 today,
> producing **duplicate event ids** the dup-less store accepts and the id-keyed `isSuperset` mis-counts) into
> `SessionSnapshot`; populate `toGameState().knowledge` so the checkpoint guards it; make `InMemoryEventStore.record`
> **throw on duplicate id**. (2) Add a **`snapshotVersion`** field; validate + migrate-or-fault in
> `loadLatest`/`importSnapshot` (an unknown/missing version is a recorded fault, never a silent mis-restore).
> **Acceptance:** restart test — surface a fact + record a DR entry ⇒ new registry over the same dir ⇒ both knowledge
> facts return; pre/post-restart interactions get **distinct** ids + monotonic ts; the checkpoint flags a snapshot whose
> knowledge shrank; an unknown-version snapshot is rejected, not crashed on. Read `docs/features/0007`, `0030`, `0031`
> first. Open a PR.

### B41 — make the orchestrator the real per-sandbox spine  ·  Claude Code  ·  **Wave 1 · audit E3 (+ fixes D4 flood)** — ✅ DONE

> **DONE.** The registry's save-on-mutation `onPersist` now routes through `Orchestrator.commitPlayerTurn`
> (`registry.setCommit`, wired in `composeRuntime`): every player mutation runs the fail-closed integrity
> checkpoint — a leaky/degrading commit is rolled back and NOT persisted — and `touch`es the user.
> `idleSince` returns `+Infinity` for a never-active user (not-yet-idle), so the watcher stops flooding
> off-screen ticks mid-scene; in pure turn-driven mode (`tickEveryMs:0`) each turn fires one bounded
> off-screen tick so the house still lives. Health reports `lastTrigger:"player-turn"`.
> `tests/unit/orchestratorSpine.test.ts` (4). Original prompt below.

> In `kevinhirsch/orwell` (TS engine), player turns **bypass** the orchestrator — nothing outside tests calls
> `advance(user,"player-turn")`/`touch`, so the fail-closed integrity checkpoint (0031) **never runs on a player action**
> (a leaky/degrading player-turn commit persists immediately via `onPersist`), and because `touch` never fires
> `idleSince` is `-Infinity` so the watcher's idle gate is **always true** (off-screen ticks flood every wake, even
> mid-scene — audit D4). Per principle #5 (the orchestrator is the real spine): route mutating player-channel tool calls
> through `Orchestrator.advance` (or make the registry's `onPersist` a **checkpoint-then-save**), and `touch(user)` on
> every player call; treat never-active as **not-yet-idle**; in turn-driven mode (`TICK_MS=0`) trigger one **bounded**
> off-screen tick per player turn (audit D4/M6). **Acceptance:** a leak-injecting `submitDecision` (test seam) is rolled
> back and **not** persisted; an actively-calling user accrues **no** off-screen ticks until `idleTickAfterMs` after their
> last call; with `tickEveryMs:0`, N player turns ⇒ hidden-event count still grows; health shows `lastTrigger:"player-turn"`
> after a real HTTP player call. Read `docs/features/0031`, `0035` first. Open a PR.

### B42 — make the sentinel canary bite the live game  ·  Claude Code  ·  **Wave 1 · audit E8 (+ m12)** — ✅ DONE

> **DONE.** `tests/property/liveSentinel.property.test.ts` wires the sweep to the **registry resolver's**
> object graph (not a standalone adapter), plants unique sentinels into every kind of live hidden state
> (NPC backstory + soul memory via snapshot→restore, the SoulStore, a hidden event, the Vault, another
> NPC's knowledge), proves they're genuinely planted, then drives a full game to a winner sweeping
> **every** player + admin tool — including the finale — for a leak. The finale-projection lock is
> asserted (no pre-reveal winner; no `votes`/`script`/`tally` serialized). Coverage check asserts every
> `PLAYER_TOOLS`/`ADMIN_TOOLS` name was swept. Original prompt below.

> In `kevinhirsch/orwell` (TS engine), the sentinel sweep (`mcp.property.test.ts`) runs against a **standalone** adapter
> disconnected from the sentinel fixture, so for `advanceGame`/`submitDecision`/`gameStatus`/`playerTagline`/
> `socialInitiatives`/`getGameState`/`getMomentPrompt`/`runCompetition` the canary **can never fire** — the live hidden
> state these could leak (relationship numbers, NPC stats/souls, pre-reveal finale tally) carries no sentinel; the only
> live guard is the UAT's four format-coupled regexes, and the orchestrator's leak sweep is substring-only over hidden
> event content (won't catch numbers/soul text/tally). Per principle #7 (gates on the production path): build the sweep
> over a **registry-built** sandbox whose generated hidden stats/soul text/relationship-derived strings embed sentinels
> (engine-side post-process of `CharacterFactory` output), sweep **all** `PLAYER_TOOLS`/`ADMIN_TOOLS` incl. the full
> finale, and add a finale-projection lock (`finaleView.reveals.length === revealIx`; no `votes`/`script` serialize
> pre-reveal). **Acceptance:** every tool name appears in a sentinel sweep wired to the **same object graph the resolver
> serves**; a planted sentinel in any hidden field fails the sweep. Open a PR.

### B43 — 0045 endgame structure (Final 5 → Final 2)  ·  Claude Code  ·  **Wave 2 · audit B1 · NEEDS SPEC FIRST** — ✅ DONE

> **DONE.** The veto field degrades (`vetoFieldSize = min(6, remaining)`; the draw already yields it,
> now asserted at F5/F4); Final 4 resolves on the sole non-HOH/non-nominee vote; and **Final 3 is a
> final-HOH personal eviction** — `liveSeason` skips nominations/veto, runs a final-HOH competition
> (outgoing-HOH restriction lifted), and the final HOH evicts one of the other two via a new
> `final-eviction` binding decision (pending for the player; argmax-threat for an NPC; manner recorded).
> No empty-electorate 0–0 path remains. 0005 prose amended; 0011/0034/0037 stay green.
> `tests/unit/endgame.test.ts` (7) + `0045-endgame-structure.feature` (6, in `cucumber.cjs`). Prompt below.

> Draft and implement **feature 0045** (`docs/features/0045-endgame-structure.{md,feature}`). Today the late game is
> mathematically broken: 0005 demands a veto field of **exactly six** (impossible at F5/F4), and **Final 3 is not
> modeled** — at 3 active the loop runs a full nomination/veto week ending in `evictionVoters = ∅` ⇒ a permanent 0–0
> "tie" silently resolved by `npcChoice(hoh)` (`liveSeason.ts:224-228`). Amend 0005 with **field-size degradation**
> (veto field = `min(6, remaining)`; at **F4** the veto holder is the **sole** eviction vote) and add the **F3** branch
> (skip nominations/veto; a final-HOH competition; the final HOH personally evicts via a new `final-eviction`
> `submitDecision` kind — pending if the player, relationship-driven if NPC, manner recorded). Per principle #2 (the
> pending-decision seam). **Acceptance:** a seeded season reaches F2 with **every** late-week ceremony legal under the
> amended predicates; player-as-final-HOH gets the binding choice; eligibility invariance under temperature preserved;
> 0011/0034/0037 scenarios stay green. Read `docs/features/0005`, `0011`, `0034`, `0037` first. Open a PR.

### B44 — player-HOH eviction tie-break (pending decision)  ·  Claude Code  ·  **Wave 2 · audit B2** — ✅ DONE

> **DONE.** `liveSeason` splits the eviction tally (`countEvictionVotes` → `resolveEvictionBeat` →
> `commitEviction`): on a tie, if the HOH is the **player** the loop PAUSES on a new `tie-break` pending
> decision (the two nominees are the options; illegal pick refused) instead of the silent
> `npcChoice(player)`. An NPC HOH still auto-resolves; the decision survives a restart. Ports + adapter
> gain the `tie-break` kind; every full-game driver/UAT handles it (terminal `else` is now kind-generic
> so tie-break/final-eviction can't hang a drive). `tests/unit/tieBreak.test.ts` (4). Prompt below.

> In `kevinhirsch/orwell` (TS engine), a player HOH **never** breaks a tied eviction vote: `npcChoice(s.hoh!)` fires even
> when `s.hoh === ctx.player` (`liveSeason.ts:178-182`), deciding via the **hidden** player→NPC threat edges the player
> has never seen (an agency + anti-sycophancy violation; guaranteed at F3, common at F5). Add a **`tie-break`** pending
> decision kind (per principle #2): on an even tally with the player as HOH, pause and return the two nominees as the
> legal set; resume with the player's pick. NPC HOHs still resolve automatically. **Acceptance:** unit — player HOH +
> engineered tied NPC votes ⇒ loop pauses with `tie-break`; an illegal pick is refused; the chosen nominee is evicted;
> restart mid-pending resumes (0030). Open a PR.

### B45 — "Houseguest's Choice" pauses for the player  ·  Claude Code  ·  **Wave 2 · audit B4** — ✅ DONE

> **DONE.** `vetoParticipants` gains `playerChoosesOwn`: when the PLAYER draws the chip the draw
> **defers** (no `picked`, field a player short) instead of `chooseStrongestBond` reading the player's
> hidden bonds. `liveSeason`'s veto beat pauses on a new `houseguests-choice` pending decision (the
> candidates are the options); on the player's pick the field completes and the veto comp resolves
> (`applyDecision` now takes the beat rng so the resume is deterministic). An NPC draw still auto-picks;
> `peekCompetition` returns null while deferred; survives a restart. Ports + adapter + drivers/UAT
> updated. `tests/unit/houseguestsChoice.test.ts` (4). Original prompt below.

> In `kevinhirsch/orwell` (TS engine), the veto draw auto-picks for the player: `liveSeason.ts:368-371` passes
> `chooseStrongestBond` **unconditionally**, so when the player draws the chip the engine picks the sixth player using
> the player's **hidden** bond edges (canon says the player "may hold Houseguest's Choice if drawn"). Make the
> veto-competition beat two-phase (principle #2): run the draw; if `houseguestsChoice.holder === player`, set a
> **`houseguests-choice`** pending with the legal candidate set **before** resolving the comp; resume with the player's
> pick. NPC holders keep `chooseStrongestBond`. **Acceptance:** unit — a seeded draw giving the player the chip pauses
> the loop with the legal candidates; an illegal pick is refused; an NPC holder still auto-picks; the resolved 6-player
> field includes the pick; restart mid-pending resumes. Open a PR.

### B46 — live competition intent (compete / throw / play safe)  ·  Claude Code  ·  **Wave 2 · audit B5** — ✅ DONE

> **DONE.** A `comp-intent` pending fires before each comp the player plays (HOH if eligible, veto if a
> puller); `winnerOf` threads the player's declared intent into a real `CompetitionIntents` (the 0028
> throw/play-safe penalties); NPCs stay compete. The intent is consumed when the comp resolves and is
> immutable after (the pending is cleared ⇒ a late declaration is refused); survives a restart. The
> pending's `options` ARE the three intents (compete first = default), so the generic decision path +
> front-end pick from them. 0034 amended. `tests/unit/compIntent.test.ts` (4) — throw measurably lowers
> the player's win rate across seeds; the lock refuses post-beat intent. Original prompt below.

> In `kevinhirsch/orwell` (TS engine), the player **never declares competition intent** — every live resolution builds an
> empty `CompetitionIntents` (`liveSeason.ts:136`, `GameSessionAdapter.ts:435`), so the Bible-mandated, immutable
> compete/throw/play-safe choice (and the `throwPenalty`/`playSafePenalty` constants) is dead. Surface a **`comp-intent`**
> pending decision before each comp the player plays (default `compete` if skipped) and thread the `CompetitionIntents`
> into `winnerOf`; the immutability lock already exists in `competitionOutcome.ts` — feed it a real map. Amend
> `docs/features/0034`. **Acceptance:** unit — a declared `throw` measurably lowers the player's live win rate across
> seeds; intent submitted **after** the beat resolves is refused (lock); NPC intents may stay `compete` for now. Read
> `docs/features/0006`, `0034` first. Open a PR.

### B47 — jury manner applies to the player; symmetric finale appeals  ·  Claude Code  ·  **Wave 2 · audit A5 + A6** — ✅ DONE

> **DONE** (built **per the RULING below**). **A5:** `recordEvictionManner` no longer exempts the player —
> when the player is a responsible houseguest (HOH/evict-voter), the evictee records their manner toward the
> player like any NPC, so jury management cuts both ways (and the evictee→player resentment folds into the
> hidden layer at eviction, 0023). **A6 (ruling 1):** `runFinale` now has **every juror question BOTH
> finalists** (9×2 = **18** Q&A) — the player-finalist answers all 9 themselves, the NPC uses `bestAppeal`
> for all 9. No `(finalist, juror)` pair is ever unanswered, so the asymmetry vanishes at the root and the
> `appealMade` back-fill is a never-hit safety guard; CLAUDE.md's per-finalist canon stands. **Ruling 2:**
> the jury/finale magnitudes are extracted to **`src/engine/juryConstants.ts`** (`JURY_WEIGHTS`, signed
> `MANNER_LEAN`, `MANNER_THRESHOLDS`, `APPEAL`) — extraction only, 0037 calibration unchanged. Tests:
> the player records manner toward a juror they evicted + a juror they blindsided votes for them less (A5);
> the 18-Q&A leaves no unanswered pair + identical reads ⇒ a coin flip (A6 symmetry); choreography asserts
> 18 questions. 0014/0037 specs updated. *(An earlier build of this item shipped the pre-ruling 9-Q + neutral
> approach in #142; this is the ruling-compliant correction.)* Original prompt below.

> In `kevinhirsch/orwell` (TS engine), jury management — the signature mechanic — is **inert against the player**:
> `liveSeason.ts:209` skips recording eviction **manner** toward the player, so `juryLean`'s second-largest term
> (betrayed −0.6 / blindsided −0.5) is structurally **zero** for a player-finalist while fully applying to NPC finalists.
> Separately, `appealMade` back-fills `bestAppeal` for every **unasked** (finalist, juror) pair **including the player's**
> (`liveSeason.ts:250-257`) — the engine plays the player's finale **optimally** for the half of the jury they don't
> answer. (1) Delete the `r === ctx.player` manner exemption (the finale `mend` appeal already exists for redemption).
> (2) Score unasked pairs as a **neutral** default (or ask both finalists per juror), scoring player and NPC finalists
> **symmetrically**; resolve the canon line (CLAUDE.md says one question per juror *per finalist* = 18; Bible + code say
> 9 — pick one in `docs/features/0014`/`0037`). **Acceptance:** unit (mirroring the existing manner test with the player
> as the responsible finalist) — a juror the player blindsided votes for them measurably less; player and NPC finalists
> are scored symmetrically. Read `docs/features/0014`, `0037` first. Open a PR.
>
> **RULING (2026-06-10, supersedes the open choices above — build exactly this):**
> 1. **A6 = each juror questions BOTH finalists** (9×2 = **18** Q&A): `runFinale`'s `questions`
>    becomes every juror × every finalist (today `jury.ts:164` alternates `finalists[i % 2]`). The
>    **player-finalist answers all 9 themselves** (pend `finale-answer` per question); the NPC
>    finalist uses `bestAppeal` for all 9. No "unasked" pairs exist ⇒ the asymmetry vanishes at the
>    root; CLAUDE.md's "one question per juror" *per finalist* canon stands (no doc change needed).
>    Keep the `appealMade` back-fill (`liveSeason.ts:313-320`) as a never-hit safety guard.
> 2. **Extract `src/engine/juryConstants.ts`** (mirror `relationshipConstants.ts`): the manner
>    weights (betrayed −0.6 / blindsided −0.5 / respected +0.4 / disrespected −0.4, `jury.ts:48-51`),
>    `JURY_WEIGHTS` (`jury.ts:38`), the manner thresholds `TRUST_BETRAYAL`/`THREAT_BLINDSIDE`
>    (`liveSeason.ts:246-247`), and the appeal magnitudes (`jury.ts:82-93`). Extraction only — no
>    number changes; keeps the 0037 calibration green.
> *Current anchors (audit line numbers drifted):* the A5 player exemption is now
> `liveSeason.ts:261` (`if (r === evictee || r === ctx.player) continue;` in `recordEvictionManner`,
> called from `applyEviction:279` — covers the 0045 final-eviction too). *Test deltas:* the
> finale-count test (`liveSeason.test.ts:246-261`) now expects **9** player `finale-answer` stops
> (was even-indexed ~5); add the A5 test mirroring the manner-effect pattern at
> `liveSeason.test.ts:276-296` with the **player** as the responsible finalist.

### B48 — 0046 player eviction & the juror's seat  ·  Claude Code  ·  **Wave 2 · audit B6 · NEEDS SPEC FIRST** — ✅ DONE

> **DONE.** Feature 0046 built & green (in `cucumber.cjs`). `GameStateView.player.status` now marks the
> player `active` → `jury` (evicted into the last-9 jury — derived from the public eviction order + cast
> size) or `evicted` (pre-jury); the projection switches `moment` to a `jury` / `evicted` `MOMENT_PROMPTS`
> fragment. **Juror knowledge model = ceremonies-as-broadcast** (the spec's recommendation, made canonical):
> a sequestered juror keeps witnessing the PUBLIC ceremony beats (non-hidden house-events) and nothing
> private — already enforced by the 0002 witness model (off-screen scenes + confessionals exclude the
> player), so the juror's knowledge provably contains only the broadcast facts. The season completes for ANY
> eviction index (the loop plays NPCs to Final 2 + a winner without the player), and a player evicted into the
> jury still casts their own vote at the 0037 finale; out-of-game status survives a restart. `tests/unit/
> playerEviction.test.ts` (6) + the name-agnostic `.feature`. The pre-jury terminal recap ties to 0048
> (out of scope). Original prompt below.

> Draft and implement **feature 0046** (`docs/features/0046-player-eviction-and-jury.{md,feature}`) — the game's most
> common ending has **no spec**. Spec the player-evicted paths: **pre-jury** ⇒ a closure beat + a defined season-end
> state (ties to B56/0048); **jury** ⇒ a defined **juror knowledge model** (jurors witness ceremonies-as-broadcast only,
> or nothing + evictee gossip — pick one and wire it into `KnowledgeState`; this also fixes 0014's "jurors observe the
> remainder", which is incompatible with the 0002 witness model), bounded spectate/fast-forward pacing to the finale,
> then the existing 0037 juror interactivity. Add `player.status: "active" | "jury" | "evicted"` to `GameStateView` and a
> `MOMENT_PROMPTS` fragment for spectating/jury (today the projection never marks the player out — `GameSessionAdapter.ts:441-463`).
> **Acceptance:** a season where the player is evicted at **any** index completes; juror knowledge provably contains only
> the defined-pathway facts; the Vault Wall holds throughout; the post-eviction view marks the player and
> `momentForPhase` selects the jury framing. Read `docs/features/0002`, `0014`, `0037` first. Open a PR.

### B49 — 0047 eviction night live (reveal + goodbye messages)  ·  Claude Code  ·  **Wave 2 · audit B7** — ✅ DONE

> **DONE** (the 0047 spec already existed — built straight from its §8; the "NEEDS SPEC FIRST" tag was
> stale). The weekly eviction is staged through the 0034 seam like the finale: a new `EvictionProgress`
> sub-state machine in `liveSeason.ts` reveals the (engine-decided) votes ONE AT A TIME in a seeded order
> (`applyEviction` split into `recordEvictionManner` + `removeEvictee` + `rollWeek` so the week-roll defers
> past the goodbyes), then an evictee goodbye + goodbye messages from a seeded selection whose
> relationship-derived tone (warm/respectful/cold) folds into the evictee's manner (jury lean, 0014). A
> Vault-free `EvictionView` (`{stage, nominees, votesRevealed}`) lands on `AdvanceView` — names + the votes
> read so far only, never a pre-reveal tally or the evictee before the last vote. **No new pending decision
> kind** (eviction-vote / tie-break unchanged) ⇒ no FE relay mirror needed. `tests/unit/evictionNight.test.ts`
> (6) + the name-agnostic `.feature`; the tie-break/eviction unit tests updated to drive through the reveal.
> Original prompt below.

> Draft and implement **feature 0047** (`docs/features/0047-eviction-night-live.{md,feature}`). The weekly eviction —
> the show's defining beat, ~13×/season — emits one line (`liveSeason.ts:403`); the finale got staged choreography (0037)
> but evictions didn't. Stage it through the **0034 seam** like 0037: an **ordered, one-at-a-time vote reveal**
> (revealed-only tally — never a pre-reveal winner), an **evictee goodbye** beat, and **goodbye messages** from selected
> houseguests recorded as events that feed eviction **manner** (0037 §4.2) and **jury lean**. Reveal order is
> engine-decided + seeded (principle #1). **Acceptance:** reveal order is deterministic by seed; **no** pre-reveal tally
> leaks (extend the 0001 canary); a respectful vs. cold goodbye **measurably** moves the evictee's juror lean. Read
> `docs/features/0034`, `0037`, `0014` first. Open a PR.

### B50 — live NPC hidden elements (generation)  ·  Claude Code  ·  **Wave 3 · audit D1** — ✅ DONE

> **DONE.** The production `Character` now carries `hiddenElements: HiddenElement[]` — `generateHouse` mints
> **3–6 distinct, seeded, typed** elements per NPC (`secret-motive` / `pre-game-tie` / `concealed-aptitude` /
> `divergent-persona`) off a **side rng** (hashed off the name) so the main house stream stays byte-stable
> (stats/names/0007); the player's is empty (they author `privateStrategy`). `richOffscreenStretch` takes a
> `hiddenElementsOf` lookup and, gated by `hiddenSurfaces` on a **per-scene side rng** (zero perturbation of
> the existing off-screen stream), occasionally slips one element into the scene's HIDDEN content — the
> orchestrator's off-screen tick wires it. Engine-side throughout (NPC `Character` is never projected); the
> element reaches the player only if a later pathway carries it. `tests/property/hiddenElements.property.test.ts`
> (3): every NPC has 3–6 distinct elements + the player none; seed-reproducible; over a season the surfacing
> rate sits at the configured ~5% and **no** detail crosses to the player projection / their witnessed events.

> In `kevinhirsch/orwell` (TS engine), live NPCs have **no hidden elements at all** — the production `CharacterFactory`
> (`characterFactory.ts:56-73`) generates archetype/style/stats/background only; "tons of hidden elements" exist solely in
> the 0003 **test stub** (`characters.ts` HIDDEN_POOL), and `hiddenSurfaces()` has no production caller, so the rare-reveal
> "treat" loop (a pillar of 0003 + the mandate) **cannot occur in a real game**. (Distinct from 0041, which is soul
> *evolution*.) Extend `generateHouse` to mint **3–6 seeded, typed** hidden elements per NPC (secret motive, pre-game tie,
> concealed aptitude, divergent persona…) stored **engine-side** (Vault/Soul), and wire `hiddenSurfaces(rng)` into
> off-screen scenes/conversations so an element occasionally enters event content (hidden until a pathway carries it).
> **Acceptance:** property test on the **live** path — every seeded house has ≥3 hidden elements per NPC; over a season
> ≤ `hiddenSurfacingRate` of moments surface one; the player projection contains **none** without a pathway event;
> same seed ⇒ same elements. Read `docs/features/0003`, `0024` first. Open a PR.

### B51 — wire the emotional modifier into live competitions  ·  Claude Code  ·  **Wave 3 · audit D2** — ✅ DONE

> **DONE.** The core was already live via **0041** (the line refs below are stale): `ctx.emotionalOf` feeds
> the live soul `emotionalState` into `winnerOf`/the 0028 modifier, `evolveFromBeat` inflects comp wins / ally
> blindsides, mean-reversion + snapshot are in place. This closes the two real gaps: **(1) nominated ⇒
> negative** — a new `"nominated"` `EmotionalEvent` (valence −0.35) inflected at the live `nominations` (and
> the veto-ceremony replacement) beat, so a nominee carries the rattle INTO the veto and their odds dip below
> their calm baseline; **(2) `rel.decay(DECAY_RATE)` on week rollover** (audit C5) — the previously-uncalled
> decay now runs on each `eviction-result` beat, eroding untended extreme edges toward baseline so the house
> doesn't pin over a season. `tests/unit/emotionalModifierLive.test.ts` (6): a rattled competitor wins the
> veto measurably less than at baseline; the live nominees' state drops once the ceremony resolves; a season
> of rollovers decays pinned edges toward neutral; same seed ⇒ identical trajectory; snapshot/restore preserves
> states. (`season.ts` stays 0.5 — it is the test-only one-shot sim, no soul source.)

> In `kevinhirsch/orwell` (TS engine), the emotional modifier is structurally **zero** on every live comp —
> `emotionalState: 0.5` is hard-coded for every competitor (`liveSeason.ts:135`, `season.ts:78`), `emotionalModifier()`
> has no production callers, and nothing updates a soul's emotional state — so the Luck-replacement ADR exists only in
> tests (this is the comp-input wiring, distinct from KNOWN 0041 storage). Track per-houseguest `emotionalState` in the
> session (seeded at `soul.emotionalBaseline`), update it via `emotionalModifier(current, circumstance, temperatureRoll)`
> at consequential beats (nominated ⇒ negative, comp win ⇒ positive, ally evicted ⇒ negative; constants in
> `temperatureConstants.ts`), and pass it into `winnerOf`; also call `rel.decay(DECAY_RATE)` on week rollover (audit C5).
> **Acceptance:** unit — a nominee's veto win rate is measurably **below** their non-nominated baseline across seeds;
> states **mean-revert** when calm; same seed ⇒ same trajectory; snapshot/restore preserves states. Read
> `docs/features/0006`, `0028`, `0026` first. Open a PR.

### B52 — evicted houseguests stop living  ·  Claude Code  ·  **Wave 3 · audit D5** — ✅ DONE

> **DONE.** Of the three pools, `runCompetition` already excluded evictees (caller ids validated against
> `evictionOrder`; the default field is the loop's `s.active`). The two real leaks are closed: the
> **off-screen society** (`orchestrator.ts` `defaultApply`) now filters the pool to LIVING NPCs
> (`!evictionOrder`), so no evictee schemes, folds relationships, or confessions after leaving (the stretch is
> skipped when too few remain to pair, and the day-event guards an empty pool); and **`socialInitiatives`**
> now draws approaches only from living NPCs, so an evictee never "wants a word." `tests/unit/evicteesStopLiving.test.ts`
> (3): post-eviction off-screen scenes/confessionals never name an evictee (and the living house DID keep
> scheming — non-vacuous); no evictee is ever offered as an approach; an evictee is rejected as a competition
> participant and never the default winner. Jury still forms from `evictionOrder` — they stop ACTING, not existing.

> In `kevinhirsch/orwell` (TS engine), evictees keep scheming: the off-screen pool (`orchestrator.ts:206-207`),
> `socialInitiatives` (`GameSessionAdapter.ts:156-168` / `conversation.ts:57-65`), and `runCompetition`'s default pool
> (`:424-427`) all ignore `live.evictionOrder` — so an evicted houseguest folds relationship impacts, gives confessionals
> ("I need X gone"), and can "want a word with you" weeks after leaving (a fidelity break the player will notice). Filter
> all three pools by `evictionOrder` (and `active` once B43 lands). **Acceptance:** unit — no evictee id appears in
> off-screen scenes/confessionals/initiatives/competition pools after eviction. Open a PR.

### B53 — fire reserve twists in the live game (+ double-eviction mechanics)  ·  Claude Code  ·  **Wave 3 · audit D6 + B8**

> In `kevinhirsch/orwell` (TS engine), 0025's reserve twists are computed but **never fire live** —
> `loadReserveTwists`/`maybeFireTwist` are referenced only by tests/BDD; nothing in composition loads, seals, or fires a
> twist, and `double-eviction` is a **label with no math** (`reserveTwists.ts`). (1) At `createCharacter`,
> `loadReserveTwists(count, seededRng)` into the sandbox's Vault (sealed from player **and** admin until it fires —
> extend the 0001 canary to both); persist it via `SessionSnapshot` (`InMemoryVaultStore` is wired but absent from the
> snapshot — audit I7). (2) In week rollover, `maybeFireTwist(week)`; implement at minimum **double-eviction** as a
> compressed second cycle (HOH→noms→veto→vote within the same "night") **reusing the hard rules verbatim**, and define
> its week/jury-order semantics (audit B8: one reign, two eviction ceremonies, both count for jury order). **Acceptance:**
> BDD — a seeded game with a loaded double-eviction fires it **exactly once** at the sealed beat; invisible to player +
> admin until fired; 0005 eligibility holds within the compressed cycle; the jury-9 / final-2 arc is preserved. Read
> `docs/features/0025`, `0005`, `0016` first. Open a PR.

### B54 — measure richness on the production path  ·  Claude Code  ·  **Wave 3 · audit D3**

> In `kevinhirsch/orwell` (TS engine), the 0003 richness property tests run `simulateSeason` (`simulation.ts`, **no
> production callers**) which force-sets `reveals = 1` if none surfaced (`:113-115`) and whose `offscreenProb` is both the
> generator input and (effectively) the asserted threshold — **the test asserts its own input**, and the live game could
> drop to zero off-screen life with every gate green. Per principle #7: re-point the richness metrics at the **live
> spine** — a property test driving `Orchestrator.advance` + `advanceGame` over a full seeded season (the UAT path) that
> computes `richnessMetrics` from the sandbox's **real EventStore**; delete the `reveals=1` back-stop (or assert it never
> triggers). **Acceptance:** the richness property test consumes only production-path events; offscreen-share / type-
> diversity / surfacing thresholds hold across ≥20 seeds; the test **fails** if `defaultApply` stops recording typed
> scenes. Read `docs/features/0003` first. Open a PR.

### B55 — unify the season loop; ground relationship reads  ·  Claude Code  ·  **Wave 3 · audit D12 + C5 + C6**

> In `kevinhirsch/orwell` (TS engine), the calibration sim (`season.ts`) **diverges in rules** from the live loop —
> `vetoParticipants` without the Houseguest's-Choice chip, different comp types, no manner/appeals, and dead duplicate
> decision helpers (`WEEK_PHASES`/`pendingNominationDecision`/`validateNominations`) — so the 0006 calibration + outcome
> property tests verify mechanics the player **never plays**. Either implement `playSeason` **as a driver over**
> `newLiveSeason`/`advance` (auto-answering player pendings with NPC policy) or delete the duplicated helpers and document
> the sim as **calibration-only**; the outcome/calibration suites must exercise the same `advance` the live game runs.
> While here, fix the **seed realism** (audit C5/C6): seed first impressions near baseline with **archetype-informed**
> threat priors and `confidence < knowledge threshold` (today uniform [0,1] at confidence 0.5 ⇒ day-one hunches count as
> firm knowledge); wire archetype→disposition and serialize it; call `decay()` on week rollover (if not already done in
> B51). **Acceptance:** one source of weekly-loop truth; the calibration property green against the live `advance`; move-in
> reads are **suspicions**, threat priors correlate with public archetype. Open a PR.

### B56 — 0048 season retrospective & the Vault unsealing  ·  Claude Code  ·  **Wave 4 · audit G4 · NEEDS SPEC FIRST · highest fun-per-effort**

> Draft and implement **feature 0048** (`docs/features/0048-season-retrospective-and-unsealing.{md,feature}`) — the
> biggest *fun* payoff the corpus never discusses, and the finished-season lifecycle (0021's archive deferral was never
> picked up). **Product decision in the design note first** (recommended: yes, the Wall opens **post-season**, **only
> after** the winner event, **only** for that finished season, **player-triggered**). Then: (1) an end-of-season **recap**
> surface built from the **event record** (arc highlights — not narrator memory, principle #7); (2) the **unsealed hidden
> story** (off-screen scheming, confessionals, the twist that never fired) exposed via a dedicated post-season read tool;
> (3) the **finished → new-season** lifecycle (terminal state + a clean "start a new season" path, tying to B36's reset
> guard). **Acceptance:** unsealing is **impossible while a season is live** (the 0001 sentinel canary stays green
> pre-finale); the recap is generated from stores, not the narrator; the finished-season state is explicit and a new
> season starts cleanly. Pairs with **C17** (the FE surface). Read `docs/features/0021`, `0001`, `0007` first. Open a PR.

---

### C12 — front-end hotfixes: finale relay + engine-down fail-closed + reset guard  ·  Claude Code (front-end lane)  ·  **Wave 0 · audit B3 + F2 + A2 (FE)**

> In `kevinhirsch/orwell` `frontend/`, three Wave-0 fixes. (1) **Finale is unplayable** — the agent relay's
> `submitDecision` enum allows only `nominations|veto-decision|replacement|eviction-vote` and hard-rejects everything
> else, **silently dropping** `statement`/`appeal` (`tool_schemas.py:1319`, `tool_implementations.py:4650-4653`), so any
> player reaching jury/Final 2 dead-stops — **the season can't be won**. Extend the schema enum with `finale-statement`/
> `finale-answer`/`juror-vote` + `statement` (string) and `appeal` (enum `own-game|mend|connect|discredit-rival`, per
> `src/engine/jury.ts:69`); extend `do_submit_decision`'s whitelist + forwarded keys. (2) **Engine-down mid-game fails
> open into an outcome-inventing chatbot** (`chat_helpers.py:551-569`): when a game-framed session loses the engine,
> fail **visibly-closed for game content** — inject a minimal "the feed is down, do not continue the game story; Big
> Brother will resume shortly" instruction and surface a HUD banner (never freeform narration). (3) Mirror **B36**'s
> `createCharacter` guard at `POST /api/orwell/new-game` (409 when started without an explicit `confirm`) and route
> restart through admin `manageSandbox reset`. **DoD:** a UAT-style FE test drives `finale-statement → finale-answer →
> juror-vote` to a crowned winner; engine-down + game-active history yields a refusal-to-continue framing; a second
> new-game on a started sandbox is refused. `pytest` green; engine gate unaffected. Open a PR.

### C13 — close the lever drift (`diaryRoom` + `socialInitiatives` agent tools)  ·  Claude Code (front-end lane)  ·  **Wave 4 · audit F1**

> In `kevinhirsch/orwell` `frontend/`, the moment prompt advertises levers the agent **cannot pull**:
> `resolveCompetition`, `socialInitiatives`, `diaryRoom` are named in `momentPrompts.ts` but absent from
> `FUNCTION_TOOL_SCHEMAS`/`TOOL_TAGS`/`ORWELL_GAME_TOOLS` — so the **Diary Room in chat is narrated but never recorded**
> (only the HUD modal records — violating the hold-the-line rule) and the narrator can never spontaneously have an NPC
> approach the player (half the bidirectional-scenes mandate). Add `diaryRoom` + `socialInitiatives` to the schemas/tags/
> keep-set with `do_diary_room`/`do_social_initiatives` wrappers (the Python clients already exist in
> `orwell_engine.py:154-163`); either expose `resolveCompetition` or remove it from `BASE_GAME_MASTER_PROMPT`. Add a
> **drift test** asserting every player-channel tool in `registry.ts` (minus documented exclusions) has a FE schema and
> every lever named in the base prompt is callable. **DoD:** a "diary room" agent turn produces a **recorded** engine
> entry; `pytest` green; engine gate unaffected. Open a PR.

### C14 — game turns always act; clean the immersion bleed  ·  Claude Code (front-end lane)  ·  **Wave 4 · audit F3 + F6**

> In `kevinhirsch/orwell` `frontend/`, two play paths **narrate without ever acting** — sync `POST /api/chat` gets the
> moment prompt but **no tools/no escalation**, and `can_use_agent=False` users are flipped back to plain chat **after**
> game auto-escalation (`chat_routes.py:554-557,668-670`) — producing consequence-free imitation gameplay. For
> game-active sessions, **force the agent path** with tools collapsed to exactly `GAME_TOOL_KEEP` (game tools aren't a
> privilege surface — they're the game), or refuse game framing on tool-less paths (tie into C12's fail-closed framing).
> Also fix the **immersion bleed** (audit F6): under `game_build_enabled()`, restyle game-tool thread nodes diegetically
> (no raw `advanceGame`/JSON/`npc:7`/"engine error") and swap the appended "You are an AI assistant with tool access"
> preamble for a game-consistent one on game-framed turns (it currently **contradicts** the game prompt's "never say you
> are an AI"). **DoD:** a `can_use_agent=False` user's game turn still produces engine tool calls (or an explicit
> refusal); a rendered game turn shows no raw tool JSON by default; a prompt-assembly test asserts "You are an AI
> assistant" never co-occurs with the game-master prompt. `pytest` green. Open a PR.

### C15 — onboarding holding-state + new-season history fence  ·  Claude Code (front-end lane)  ·  **Wave 4 · audit F5 + F7**

> In `kevinhirsch/orwell` `frontend/`, (1) **onboarding fails open to a generic workspace** — engine unreachable ⇒ the
> overlay never mounts (`orwellOnboarding.js:127-134`) and the player lands on "type /setup to get started" with tips
> referencing **dropped** verticals ("web search and code execution", "Compare mode"). Show a game-branded **holding card**
> ("The house is dark — Big Brother will return") when `/api/orwell/state` fails, and replace the tips/default tagline with
> game-flavored ones under `game_build_enabled()`. (2) **Stale season history contaminates a new game** — `createCharacter`
> resets the engine but the chat session keeps the entire previous season in context (`chat_helpers.py:589`), so the
> narrator blends casts. On a successful restart, **start a fresh chat session** (or inject a hard "NEW SEASON — disregard
> all prior season events" fence). **DoD:** browser smoke asserts the holding card renders under the game build when the
> engine is down (no tip names a dropped vertical); a test asserts the first post-restart turn carries **no** prior-season
> messages in the LLM payload. `pytest` + the 0032 headless gate green. Open a PR.

### C16 — 0022 first slice: roster, recap, decision cards  ·  Claude Code (front-end lane)  ·  **Wave 4 · audit F9 (unparks 0022)**

> In `kevinhirsch/orwell` `frontend/`, ship the highest-value slice of the deferred **0022** rich UI, all from Vault-free
> projections the engine already returns, in the self-contained/fail-open/game-gated pattern of
> `orwellStatusPanel.js`/`orwellSocial.js`: (1) a **houseguest roster** panel (names + status from `getGameState`);
> (2) a **"previously on…" session-open recap** (synthesized from `getVisibleStateFor` — facts the player knows +
> observable behavior only, **never** a read on where they stand, per 0020); (3) **decision cards** that render the
> engine's `pending` (prompt + **legal option set** + pick counts from `advanceGame`) and bind **only** via the validated
> `submitDecision` — fixing audit **F4** (today a model misreading prose can submit a vote the player never made). Add a
> moment-prompt note (engine side — fold into the same PR or a sibling B-item): "on `pending`, present via `ask_user` with exactly
> the engine options; `submitDecision` only with an explicit selection." **DoD:** a scripted agent test where a pending
> turn yields an `ask_user` whose options equal the engine's legal set and **no** `submitDecision` is issued in the same
> round as the question; roster/recap render Vault-free; `pytest` + 0032 headless gate green. Read `docs/features/0020`,
> `0022` first. Open a PR.

### C17 — 0048 front-end: season recap & the unsealed story  ·  Claude Code (front-end lane)  ·  **Wave 4 · audit G4 · depends on B56**

> In `kevinhirsch/orwell` `frontend/`, build the **post-season** presentation for feature **0048** (B56): a recap surface
> (arc highlights from the engine's Vault-free recap read) and — **only after the winner event** — a player-triggered
> **"watch the season back"** view over the now-unsealed hidden story (off-screen scheming, confessionals, the twist that
> never fired) from B56's post-season read tool. Same fail-open, game-gated patterns; render **only** the route payloads.
> **The wall stays absolute pre-finale:** the unseal affordance must not exist (or must 404) while a season is live.
> **DoD:** the unseal view is unreachable mid-season; the recap renders from the engine read, not chat memory; `pytest` +
> 0032 headless gate green; verify on a running instance. Depends on **B56**. Open a PR.

---

### B57 — doc-hygiene pass (the authoritative docs mis-instruct)  ·  Claude Code / feature-maker  ·  **continuous · audit H1–H9**

> In `kevinhirsch/orwell`, one PR refreshing the authoritative docs that currently contradict the live status and
> mis-instruct a fresh implementer (per audit §H). Refresh `bb-sim-spec.md`'s stale Refinements block ("0023 is the
> biggest gap"), §11 (pre-ADR relationship shape), §12 (the daily-event scenario **omits** "significant house event" — a
> literal reading fails every legal social day), §16; close out `CLAUDE_CODE_INSTRUCTIONS.md` §15 (only the embedding
> provider is genuinely open); annotate legacy Bible §11's wrong jury-start number; clear the two **satisfied** Amendments-
> table rows + the stale 0004 banner; sync the ~25 "Status: Draft" headers on Done features to the README legend;
> reconcile the queue's contradictory "NOW" blocks; fix ADR-0002's **inverted** confidence wording; reconcile the 0010
> Proxmox-smoke claim; remove 0009 §8's stale sync-narrate flag; fix CLAUDE.md's claims that `consequence.ts` folds live
> impacts and that the orchestrator is the single advance path. Also (H2) add the **as-built** tool names
> (`runCompetition`/`submitDecision`/`advanceGame`) to the older specs that still say `resolveCompetition`/
> `executeDecision`/`advancePhase`; (H3) pin 0033's "standing" to public ceremony facts; (H4) pin admin save/load vs the
> 0007 ratchet + account-deletion→sandbox-data; (H5–H9) the smaller notes. Docs-only; no gate impact. Open a PR.

### B58 — ops: save pruning, live admin state, fault surfacing  ·  Claude Code  ·  **continuous · audit E4 + E5 + E6**

> In `kevinhirsch/orwell` (TS engine), three operational gaps. (1) **Unbounded disk** (E4): a full snapshot file per
> mutation, never pruned, snapshot size linear in events ⇒ O(n²) disk — retain a bounded window (last K + periodic
> checkpoints; non-degradation requires the **latest** save be a superset, not every historical file). (2) **Admin/God
> Mode is decorative** (E5): `inspect` returns a never-updated stub, `overrideMechanic`/`manageSandbox("reset")` mutate a
> stub nothing reads (disconnected from `registry.resetUser`), and `sandboxHealth` is exposed by **no tool** — feed
> `adminState` from `session.snapshot()` on mutation, route reset to `registry.resetUser` (used by B36/C12), and add a
> Vault-free **`sandboxHealth`** admin tool. (3) **Faults are silent** (E6): on a checkpoint fault the rollback works but
> nobody can see health, the watcher retries identically, and faults accumulate unbounded — log to stderr with user+kind,
> add a **circuit breaker** (skip a sandbox after K consecutive faults, flag in health), cap stored faults. **Acceptance:**
> a 10k-tick FakeClock soak ⇒ ≤K files/user, latest still a superset; admin inspect reflects live week/phase after
> `advanceGame`; `manageSandbox reset` re-onboards; a forced-leak apply ⇒ stderr log + health fault over `/admin/call` +
> sandbox skipped after K. Read `docs/features/0007`, `0016`, `0031` first. Open a PR.

### B59 — close the boundary gaps + the engine cleanup catalog  ·  Claude Code  ·  **continuous · audit E7 + I**

> In `kevinhirsch/orwell` (TS engine), (1) **dependency-cruiser rule gaps** (E7): OUTWARD omits
> `src/adapters/narrative/**` and `src/main.ts` (the most leak-sensitive outward consumers); VAULT omits
> `EmbeddingProvider.ts` and the engine modules that **hold** hidden logic/state (`relationships.ts`, `confessionals.ts`,
> `offscreen.ts`, `gossip.ts`, `liveSeason.ts`) — a surface could import `confessionalFor`/`relationshipLabel` today
> without tripping the gate. Extend both rule sets and ensure `npm run test:arch` actually runs in CI (depcruise was
> absent in the audit container). (2) The **cleanup catalog** (audit §I): consolidate tunables into the constants modules
> (manner thresholds, the duplicated veto-save `0.6`, all `JURY_WEIGHTS`/manner/`appealEffect` numbers → a new
> `juryConstants.ts`, approach jitter, decay 0.5, `SOCIAL_DAY_PROB`, twist load prob, orchestrator `interactions:3`) with
> a grep gate + one constants-injection retune test; pass through the dead `offscreenInteractions` config; and wire-or-
> move the dead production exports (`ConsequenceEngine` — collapse the duplicate fold in `EngineCommandsAdapter` to one
> implementation; the 0019 `decisions.ts` seam; `producerPrompt`/`deriveNpcKnowledge` — route any future NPC knowledge
> through it; etc.); fix `applyDecision`'s veto arm clearing `pending` before validating, and the `nominees.filter(()=>true)`
> no-op. **Acceptance:** `vaultBoundaryViolations()` fails when a surfaces/services/mcp/**narrative** module type-imports
> any engine-only module; the constants grep gate passes; the duplicate fold is one implementation. Open a PR.

### B60 — transport robustness + determinism  ·  Claude Code  ·  **continuous · audit E9–E12**

> In `kevinhirsch/orwell` (TS engine), harden the HTTP transport and the RNG/ts hygiene. (E9) Add a request **body-size
> cap** (256KB), a request **timeout**, basic per-tool **arg validation**, and map non-validation throws to **500** (today
> all errors → 400, so engine bugs masquerade as client errors). (E10) Resolve the McpServer **inside** the `end` handler
> (not at request start) to close the sandbox-swap race that loses a player action; ideally serialize per-user with a
> promise queue (also future-proofs an async narrator). (E11) **Preload** saved users at boot (enumerate the save dir, or
> lazily on first wake) so the house doesn't freeze at every deploy until each user's next request. (E12) Thread the
> **sandbox seed** into `beatRng` and `runCompetition`'s RNG (today `beatRng` keys off the player **name** only and
> `runCompetition`'s rng is identical across all users/games), and adopt **one monotonic per-sandbox tick** for event `ts`
> (today per-producer ts semantics differ, so ordering by ts is meaningless). **Acceptance:** an oversize body is rejected;
> a non-validation throw returns 500; two same-named games have distinct comp streams; events sort by a coherent ts. Open
> a PR.

### C18 — front-end minor cleanup  ·  Claude Code (front-end lane)  ·  **continuous · audit F8**

> In `kevinhirsch/orwell` `frontend/`, the small items from audit F8: gate the `game-trim.css` `<link>` behind the build
> flag (today unconditional, so `ORWELL_GAME_BUILD=0` debug still hides workspace chrome); offer the five canonical
> archetypes as suggestions in onboarding (free-text still allowed) with a hint that certain words shape hidden stats;
> add **polling backoff** + a shared `httpx.AsyncClient` for the HUDs (today two HUDs × 20s poll forever, new client per
> request); add a short (2–3s) timeout for the framing engine calls so a hung engine doesn't stall a turn ~60s; and add
> the missing **drift/injection tests** (pin `ORWELL_GAME_TOOLS`/schemas to `registry.ts`; assert `build_chat_context`
> prepends the moment prompt when `started=true`). The single-user-mode God-Mode exposure (F8g) is mitigated by B36/C12's
> reset guard — note it. **DoD:** `pytest` + the 0032 headless gate green; engine gate unaffected. Open a PR.

---

## Front-end & experience batch (B61–B63 / C19–C27) · 2026-06-09

Dispatch prompts for the **front-end & experience audit** (`docs/audits/2026-06-09-frontend-experience-audit.md`).
**Read `docs/decisions/0003-conversation-is-the-game.md` first — it governs the SHAPE of every item here.**
The beta proved the loop: a good LLM + the Bible + secrets *is* the game; the engine exists only to fix four
degradations (leaks / sycophancy / memory-thinning / sameness) and otherwise **get out of the model's way**. So
these prompts are deliberately written *light*: **prefer removing context to adding it; hand the model facts to
voice, never scripts to recite; UI is for guardrails (confirm-on-binding) and memory (the wall), not for replacing
talk.** If a fix here would add framing the model doesn't need, script what it should improvise, or move play out
of conversation into a dashboard — it's the wrong shape (ADR 0003's litmus test). Same lanes/house rules as the
audit batch above; OpenHands isn't configured, so Claude Code owns both (B/C is a scope marker).

**Amendments to the audit batch (C12–C18) — pick these up when you build those items:**
- **C12** ← also handle the **mid-scene tool-error** path (N5): an outcome-tool error must yield a "feed glitched,
  try again" beat, never a narrated winner — i.e. the game preamble (C19) must *not* carry the generic "a failed
  tool is not a stopping condition — improvise" rule. Resume-specific severity: the longer the transcript, the more
  convincing a fake continuation (F2).
- **C13** ← the prompt also advertises a **second, non-existent** comp lever `resolveCompetition` (N4) — collapse the
  manifest to one comp lever (pairs with B37/B61); the unrecorded in-chat Diary Room (U8) needs the same "the house
  never hears this" banner as the modal, or unify on one DR affordance.
- **C14** ← **substitute, don't restyle** (N3): on `game_active` turns, assemble a minimal game preamble *instead of*
  `_AGENT_PREAMBLE`/`_AGENT_RULES`, not in addition to them. Also strip `npc:`/`phase:`/`pick:` from tool results
  before they reach the model (N6). (Now scoped as **C19**.)
- **C15** ← exact dropped-vertical strings + happy-path/paint-order flash (J8/R1), game-frame the setup copy (J9),
  factory-reset must also clear FE game sessions (J12). (Folded into **C23**.)
- **C16** ← split into the **confirm-on-binding guardrail** (C20, ADR-0003-light — *not* a decision-card builder) and
  **the memory wall** (C21, roster/jury/self-status/portraits); U1's full `pending` data is the source either way.
- **C18** ← add Page-Visibility gating + coalesce `/state`+`/initiatives` (P2); pin the `game-trim.css` link to the
  build flag (P4).

| Wave | Item(s) | Lane | Audit ref |
|---|---|---|---|
| **FE-0 — make it a game** (highest leverage, mostly small) | **B61** cast voices + prompt · **C19** minimal game preamble · **C22**§premiere · **C20** confirm-on-binding · **C21** memory wall | engine + FE | N1·N2·N4·N5·N7 / N3·N6 / J1 / U1·U2 / U3·V2 |
| **FE-1 — make it reliable** | **B62** lifecycle moment fragments · **C22** lifecycle beats + new-season · **C23** onboarding onramp · **C24**§HUD-resilience | engine + FE | J1·J2·J7 / J3·J4 / J5·J6·J8·J9 / U5 |
| **FE-2 — make it reachable** | **C25** accessibility · **C26** mobile · **C27**§bundle | FE | A1–A6 / M1–M3 / P1·P3·P4 |
| **FE-3 — make it whole** | **B63** jury/self-status projection · **C24** beat dividers + social texture · **C27** identity + labels | engine + FE | U3 / U4·U6·U7 / V1·V3·R2 |

---

### B61 — cast voices: surface the public persona to the narrator + a light voice directive  ·  Claude Code  ·  **FE-0 · headline · audit N1+N2 (+N4/N5/N7 prompt edits)**

> In `kevinhirsch/orwell` (TS engine). **This is the single biggest immersion win and it's mostly already paid for.**
> The narrator is fed 15 names + a status word (`renderGameContext`, `momentPrompts.ts:127-140`; `HouseguestCard` =
> `{id,name,status}`) while the engine already mints **Vault-free public facets** per NPC — archetype, strategyStyle,
> background, age, appearance, presentation, a `PortraitDescriptor.vibe` (`characterFactory.ts:56-66, 311-335`),
> already blessed outward-safe by the portrait pipeline. Per **ADR 0003** ("hand the model facts to voice, never
> scripts to recite" + "anchors, not personalities-in-a-can"): (1) add a Vault-free `cast: CastVoiceCard[]` to
> `GameStateView` (or a `getCastVoices` read tool) = `{id,name,status,archetype,strategyStyle,background,age,
> appearance,presentation}` — **exclude** stats/soul/emotionalState/relationship edges/hidden elements; (2)
> `renderGameContext` emits **one short vibe line per active NPC** ("Bemir Sason — mastermind, plays under-the-radar;
> a bartender; 34, polished") and drops evicted houseguests; (3) add a tight **VOICE-DISTINCTNESS** block to
> `BASE_GAME_MASTER_PROMPT` — distinct, archetype-grounded, **consistent week-to-week** voices, and the boundary
> *"never invent biography beyond the supplied facets + recorded events"* — kept to a few sentences (ADR 0003:
> minimal context). While in the prompt, also: **cut** the non-existent `resolveCompetition` lever (N4), add a
> one-line **ground-truth cadence** ("read getGameState/gameStatus; never state week/phase/HOH/noms from memory;
> progress beats only via advanceGame", N7), and a one-line **error rule** ("if a tool errors, don't narrate an
> outcome — say the feed glitched, retry", N5). Seed-stable facets ⇒ the voice anchor never drifts; soul *evolution*
> stays hidden (0041). **Acceptance:** the started-game prompt lists each active NPC's public vibe; two
> different-archetype NPCs get demonstrably different descriptors; a sentinel-embedded soul/stat string never appears
> in `cast`/`renderGameContext` output over a **registry-built** sandbox (extends E8/B42); a drift test asserts the
> prompt names the cast fields + the consistency rule and no longer names `resolveCompetition`. **Also (ruling
> 2026-06-10, v1-audit §3.9 — "finality language"):** add one line to the prompt — voice unresolved outcomes as
> *reads* ("the house looks like…"), never as settled results; results exist only when the engine resolves/reveals
> them. Read ADR 0003, `docs/features/0018`, `0004` first. Open a PR.

### B62 — server-initiated lifecycle moments (premiere / re-entry / terminal), recap from the store  ·  Claude Code  ·  **FE-1 · audit J1+J7+J2 (engine half)**

> In `kevinhirsch/orwell` (TS engine), give the front-end the engine support to open and close a season with
> narration instead of dead air. Today the moment prompt attaches only on a player keystroke, so the game opens on an
> empty chat (J1), resume is a frozen transcript (J7), and there's no ending (J2). Per **ADR 0003** ("long-term
> memory is the store, recalled — never the chat, remembered"): add three **moment kinds** + Vault-free read support
> the FE can fetch to render a *server-initiated* beat — **premiere** (move-in framing for a just-created game),
> **re-entry** (a fresh-morning continuation grounded in current phase + recent **witnessed** events from the event
> store, **never a recap of chat text**), and **terminal** (season-end: result + week, from the record). All
> synthesized from the stores so a brand-new/limited context window loses nothing (the memory-survival fix). No new
> dialogue authored — these are *framing facts + a moment fragment* the model voices. **Acceptance:** the engine
> exposes a premiere/re-entry/terminal moment + the Vault-free facts each needs; a re-entry beat references the
> correct week/phase and only witnessed events; outputs are sentinel-clean. Pairs with **C22**. Read ADR 0003,
> `docs/features/0018`, `0030`, `0002` (witness model) first. Open a PR.

### B63 — Vault-free jury-status & player-standing facts for the memory wall  ·  Claude Code  ·  **FE-3 · audit U3 (engine half)**

> In `kevinhirsch/orwell` (TS engine), the roster the FE wants to render (C21) needs two tiny **public-fact**
> additions: (1) mark evictees who are **jurors** (a `status:"juror"` once jury forms, or expose a public `juryStart`
> week) so the jury can be tracked; (2) ensure the player's own **ceremony role** is derivable from public facts
> (the player card vs `hoh`/`nominees`/`veto.holder`) — these are facts a real houseguest sees on the memory wall,
> **not** a standing read ("safe"/"target"), which stays forbidden (0020). No numbers, no souls. **Acceptance:** the
> projection distinguishes active / juror / evicted; the player's HOH/nominee/veto role is computable from the
> Vault-free projection alone; sentinel sweep clean. Read `docs/features/0020`, `0014` first. Open a PR.

### C19 — minimal game preamble (substitute, not append) + diegetic tool results  ·  Claude Code (front-end lane)  ·  **FE-0 · audit N3+N6 (replaces C14's restyle)**

> In `kevinhirsch/orwell` `frontend/`. Per **ADR 0003** ("prefer removing context to adding it"), the biggest
> reliability+immersion win is *less* prompt, not more. Today `build_chat_context` prepends the GM prompt to
> `_AGENT_PREAMBLE` ("You are an AI assistant with tool access…") + `_AGENT_RULES` (`agent_loop.py:62-111`) — pages of
> email/cookbook/calendar/document rules, including *"a failed tool is not a stopping condition — improvise"* (which
> instructs the model to invent outcomes, N5) and *"don't search for things you already know"* (which invites
> narrating from stale context, N7). On **`game_active`** turns, assemble a **minimal game preamble instead** of the
> generic one: a single in-fiction tool-calling paragraph + only the rules that touch game tools; the GM prompt is the
> sole persona authority. Gate strictly on `game_active` so non-game chat is untouched. Also (N6): give game-tool
> results a diegetic formatter that **strips `npc:`/`phase:`/`pick:`** and maps ids→names before the result reaches
> the model. **DoD:** "You are an AI assistant" never co-occurs with the GM prompt; no email/cookbook/calendar rule
> text in a game-active turn's system messages; no `npc:\d+`/`phase:`/`pick:` token in a game-active tool-result fed
> to the model; `pytest` green; engine gate unaffected. Read ADR 0003 first. Open a PR.

### C20 — confirm-on-binding (the light decision guardrail)  ·  Claude Code (front-end lane)  ·  **FE-0 · audit U1+U2, reframed per ADR 0003**

> In `kevinhirsch/orwell` `frontend/`. The engine returns a full Vault-free `pending` decision view (prompt, legal
> `options[]`, `pick` count, `appeals[]`) that the FE entirely ignores, so binding choices are prose guesses with no
> confirmation (U1/U2). **Per ADR 0003, the fix is a guardrail, NOT a decision-card-builder UI** — play stays in
> conversation; only the *commitment* gets structured. When an `advanceGame`/`submitDecision` response carries a
> non-null `pending`: present the engine's `prompt` + legal `options` (and `appeals` for finale answers) and require a
> **single explicit confirm** before `submitDecision` fires, enforcing `pick` exactly. The player can still type their
> reasoning/speech and have it voiced — the binding value comes only from the confirmed selection, never parsed prose
> (the F4 invariant). Keep it light: a confirm affordance on the message, not a full modal dashboard. **DoD:** a
> pending-nominations turn requires selecting exactly 2 and an explicit confirm before any `submitDecision`; a hedge
> in prose cannot bind; the finale's statement→answer(appeal)→vote flow each require confirm; `pytest` green. Read
> ADR 0003 first. Open a PR.

### C21 — the memory wall (roster · jury · self-status · portraits)  ·  Claude Code (front-end lane)  ·  **FE-0 · audit U3+V2 (depends B63 for jury)**

> In `kevinhirsch/orwell` `frontend/`. The status HUD shows 4 lines of a 16-person game (U3). **Per ADR 0003, UI here
> serves *memory*, not play** — render the facts a real houseguest sees on the memory wall, all Vault-free and already
> returned by the engine: the **roster** (`getGameState().house[]` `{name,status}`) grouped Active / Jury / Evicted
> with eviction-order trail; **attrition** (N/16); the player's own **ceremony role** badge (HOH / ON THE BLOCK / VETO
> — derived from public facts via B63, **never** a safe/target standing read, 0020); and **portraits** keyed to the
> houseguest ids (the `portraits`/`image_gen` keep-set capability has no consumer today — wire it to the engine's
> appearance facets / `portraitDescriptorFor`). No stats, souls, relationship numbers. **DoD:** roster matches
> `house[]` exactly across the season; jury seats marked once formed; player role shown from public facts; portraits
> render; a sentinel test proves the surface returns no Vault data; `pytest` + 0032 headless gate green. Read ADR
> 0003, `docs/features/0020`, `0022` first. Open a PR.

### C22 — render the lifecycle beats + a guarded new-season path  ·  Claude Code (front-end lane)  ·  **FE-1 · audit J1+J7+J2+J3 (depends B62)**

> In `kevinhirsch/orwell` `frontend/`, render the server-initiated beats B62 exposes so the season has a curtain-up,
> a way back in, and an ending (today: dead air on start, a frozen transcript on resume, no terminal state). On
> `createCharacter` success push the **premiere** beat as the first assistant message (no user input); on session
> re-open with `game_active` push the **re-entry** morning beat; on a season ending render a **terminal card**
> (won / evicted week-N / jury chose X) with a **guarded "New season"** affordance (J3) — confirm + start a fresh chat
> session (so old-season context can't bleed, F7), routed through the B36 reset guard. **DoD:** chat shows a premiere
> with no user input; reopening shows one re-entry beat referencing the right week/phase; reaching an ending shows a
> terminal card; "New season" requires confirm and the first post-restart turn carries no prior-season messages;
> `pytest` + 0032 headless gate green. Depends on **B62** (+ B36/C12). Open a PR.

### C23 — onboarding onramp: model-gate sequencing, authoring depth, game-framed copy  ·  Claude Code (front-end lane)  ·  **FE-1 · audit J4+J5+J6+J8+J9 (extends C15)**

> In `kevinhirsch/orwell` `frontend/`, fix the first-run path. (J4) Before mounting onboarding, probe model
> readiness; if no model, show a game-branded "connect a feed source to begin" step linking to setup, *then* author —
> and never render the raw "No model selected for this chat" error on a game-active/onboarding session (today a fresh
> install dead-ends there immediately after authoring). (J5/J6, **lightly** per ADR 0003) add an optional
> backstory + a `NO_NPC_PATHWAY` **private-strategy** field (0015) and one line communicating the balanced-stats
> stance ("like every houseguest, balanced, never invincible") — a few fields, not an RPG builder. (J8/J9) under the
> game build, replace the "type /setup" welcome + the dropped-vertical tips ("web search and code execution",
> "Compare mode") with game-framed copy, and don't let the generic welcome paint when onboarding will mount (also
> covers C15's R1). **DoD:** fresh install yields one guided path (model → character → premiere); the raw model error
> never shows on a game session; private strategy round-trips as `NO_NPC_PATHWAY` knowledge; no dropped-vertical
> string under the game build; `pytest` + 0032 headless gate green. Read ADR 0003, `docs/features/0015` first. Open a PR.

### C24 — HUD resilience · ceremony beat dividers · NPC-initiated social texture  ·  Claude Code (front-end lane)  ·  **FE-1/FE-3 · audit U4+U5+U6+U7**

> In `kevinhirsch/orwell` `frontend/`, three play-surface fixes. (U5) The HUDs `hidePanel()` on *any* error so they
> vanish on a transient engine blip — distinguish engine-error (keep last-known values + a subtle offline dot) from
> no-active-game (hide); share one poller across the two panels. (U4) Give narrated **ceremony beats** visual weight:
> diegetic labels for game-tool thread nodes ("📺 Production", "🗳 Your move") with raw JSON hidden under the game
> build, and a full-width **beat divider** ("— Nomination Ceremony · Week 3 —") from `AdvanceView.event.beat` +
> `status` on ceremony advances. (U6/U7, per ADR 0003 "facts to voice, not scripts") the NPC-approach chip should
> prefill **NPC-initiated** framing ("⟨Name⟩ catches your eye and drifts over—") rather than the canned, direction-
> inverted "I pull ⟨name⟩ aside"; allow 2–3 concurrent approaches; move dismissals server-side. (Engine-side pretext
> variety stays D8/B-lane; here, vary the prefill and stop reciting one line.) **DoD:** an injected 502 leaves the
> panel visible with stale-state indication; a ceremony turn renders a labelled divider with no raw JSON; approaches
> render NPC-initiated framing, ≥N concurrent; `pytest` + 0032 headless gate green. Open a PR.

### C25 — accessibility batch (keyboard + screen-reader play)  ·  Claude Code (front-end lane)  ·  **FE-2 · audit A1–A6**

> In `kevinhirsch/orwell` `frontend/`, make the game layer accessible (the base app is; the game HUDs aren't). (A1)
> Trap focus in the onboarding modal, `inert` the background, restore focus on close (today Tab walks into the dead
> chat behind it — every new keyboard/SR player). (A2) Make the approach chips and Diary-Room actions real
> `<button>`s (or role+tabindex+Enter/Space) and trap+Escape the DR dialog (today the core "pull someone aside"
> interaction is mouse-only). (A3) Keep the status live-region always in the DOM and announce **deltas** only ("New
> nominee: …"), not a full re-read every 20s. (A4) Replace `opacity` dimming with explicit AA-checked colors and add
> a contrast clamp to the theme apply path. (A5) Stream narration into an off-live buffer and announce once on
> completion (today it's a per-token stutter to SR). (A6) `aria-hidden` the decorative loader; mirror interactive
> `title`s to `aria-label`. **DoD:** axe-core clean on the onboarding/social/status surfaces; the game is fully
> operable by keyboard and screen reader; HUD text ≥4.5:1 across shipped + a generated light theme; `pytest` + 0032
> headless gate green. Open a PR.

### C26 — mobile batch (make a full season playable on a phone)  ·  Claude Code (front-end lane)  ·  **FE-2 · audit M1–M3**

> In `kevinhirsch/orwell` `frontend/`, the verdict today is *a season is not playable on a phone* (fixed-position
> HUDs overlap the composer, draggable panels strand off-screen, modals don't fit short viewports). (M1) Under a
> mobile breakpoint, dock the two HUDs into the sidebar / a bottom sheet — never free-float over the composer (today
> two 220px `position:fixed; z-index:9000` panels collide with the composer's own mobile machinery; **zero media
> queries** in any game file). (M2) Restore the default `mobileSkip` so HUDs aren't touch-draggable on phones (they're
> docked per M1), and clamp-to-viewport after every drag end. (M3) Give the onboarding/DR cards `max-height:90vh;
> overflow:auto` and stop touch-dragging the DR. **DoD:** at 390×844 neither HUD overlaps the composer or latest
> message; HUDs not free-draggable on a phone; onboarding submit reachable at 390×667 landscape; `pytest` + 0032
> headless gate green; verify on a phone-width viewport. Open a PR.

### C27 — real game bundle, asset diet, visual identity & enum labels  ·  Claude Code (front-end lane)  ·  **FE-2/FE-3 · audit P1+P3+P4 + V1+V3+V5+R2**

> In `kevinhirsch/orwell` `frontend/`. (P1) The script-strip is a **no-op** — it removes files `index.html` never
> references while the multi-MB inherited bundle (`settings.js` 274KB, `chat.js` 251KB, `slashCommands.js` 268KB,
> `admin.js` 126KB…) parses on every load. Ship a real game bundle (a tree-shaken entry importing only the game
> keep-set + chat), or at minimum gate the inherited mega-module `<script>` tags through the same build flag.
> (P3) Drop the CDN KaTeX/Mermaid under the game build (no math/diagrams in BB). (P4) Gate the `game-trim.css` `<link>`
> on the build flag (today it's the one game-build asset the flag doesn't control). (V1, per ADR 0003: still light)
> a game-branded landing/hero (season title, "Enter the house" CTA = onboarding) + BB composer placeholder, instead
> of the generic "type /setup" workspace. (V3) Map engine phase enums → player labels ("Veto Ceremony", not
> `veto-ceremony`); no raw enum in any HUD. (V5, **RULING 2026-06-09: keep ALL theme customization tools and make
> them better** — do NOT prune: add curated season presets *on top of* the full customizer, wire an AA contrast
> clamp into the theme apply path (a11y A4), and keep the harmony generator + custom fonts working.) (R2) Gate
> the residual inherited modals/"Save to Documents" export so no dropped-vertical control is keyboard-reachable under
> the game build. **DoD:** game-build page weight drops materially (`admin.js`/`presets.js` absent); no jsdelivr
> request on a game-build load; `ORWELL_GAME_BUILD=0` restores full workspace chrome; no raw enum or dropped-vertical
> control in the player surface; `pytest` + 0032 headless gate green. Read ADR 0003 first. Open a PR.

---

### Addendum (same-session feedback) — presence, lingering, NPC coherence & testability · B64–B66 / C28

ADR 0003 was refined in-session (principles 4, 7, 8 + the new Testability section): UI may
**augment** the chat intelligently but never **replace** a game-building interaction; **lingering is
play** (mill around rooms, learn who's present/adjacent, talk to anyone while NPCs keep playing
*their* game, and nothing force-marches the week); **people must make sense** (one place at a time,
knowledge-scoped speech, stable persona); and each principle must be **testable structurally** where
possible — that section is the contract these items must satisfy. Read ADR 0003 before any of them.

### B64 — 0049 house presence & lingering play  ·  Claude Code  ·  **FE-1/FE-3 · ADR 0003 §4/§7 · spec drafted 2026-06-10**

> **Spec is drafted** (`docs/features/0049-house-presence-and-lingering.{md,feature}`, per the v1-transcript
> audit ruling — `docs/audits/2026-06-10-v1-transcript-meta-feedback-audit.md` §3.7: note overhearing is
> **bidirectional**, NPCs overhearing the player included). Implement **feature 0049** to green:
> a **light** spatial model that makes unhurried, information-gathering play real (ADR 0003 §7). Keep it
> minimal — this is *facts the narrator queries*, not a simulation the player operates. (1) **Rooms +
> adjacency** — the canonical BB house spaces (kitchen, living room, backyard, bedrooms, HOH room,
> diary room…) + a static adjacency map, in the pure domain core. (2) **Occupancy** — every active
> houseguest is in exactly **one** room per tick (the §8 coherence invariant); movement only between
> adjacent rooms; clustering is **seeded** and driven by the relationship/agenda layer (allies drift
> together, schemers seek empty rooms), deterministic by seed; evicted houseguests are nowhere (ties
> D5). (3) A Vault-free **`whereabouts()`** player read: who is in the player's room + who is in
> **adjacent** rooms — *facts a houseguest could see/hear*, never their motives or hidden state. (4)
> **Co-presence grounds 0002** — being in a room together is a witness pathway; an NPC in the next room
> can be *overheard* (a partial/low-confidence pathway), so milling and eavesdropping become real,
> recorded information-gathering. (5) **Lingering never advances the week** — moving rooms, milling,
> and talking are zero-beat social turns; only the explicit decision seam (`advanceGame`/`submitDecision`)
> progresses phase, and the daily-event invariant is satisfied by the day's *scheduled* beat, never by
> steamrolling a gathering player. **Acceptance (structural, per the ADR):** a property test asserts
> one-room-per-houseguest and adjacency-only movement across a seeded season; `whereabouts()` is
> sentinel-clean and contains only co-present/adjacent **public** facts; co-presence produces witness
> events and adjacency produces lower-confidence overhear pathways (extends 0002 tests); **N consecutive
> mill/move/talk turns leave week+phase+ceremony unchanged** and the watcher treats milling as activity
> (no idle fast-forward). Read ADR 0003 (§7 + Testability), `docs/features/0002`, `0008`, `0035` first.
> Open a PR.

### B65 — NPC coherence: knowledge-scoped narration context (people must make sense)  ·  Claude Code  ·  **FE-0/FE-1 · ADR 0003 §8 · the structural guard**

> In `kevinhirsch/orwell` (TS engine), make "people must make sense" (ADR 0003 §8) **structural**, the
> Vault way: an NPC can only speak from what it legitimately knows, so enforce it on the *context the
> narrator receives*, not on the prose. Add a Vault-free **per-NPC voicing projection** — given an NPC
> id, assemble the context to voice that NPC from **only** their legitimate knowledge: their
> witnessed/told facts (0002 `KnowledgeService`), their current room/co-presence (B64), their stable
> public persona facets (B61's cast card), and their relationship-derived *behavior* (never the numbers).
> It must **exclude** other houseguests' private knowledge, any hidden/Vault content, and souls/edges.
> This is the seam B61's voice directive needs to be safe: the model is *handed* a knowledge-bounded
> NPC and cannot voice what that NPC never learned. **Acceptance (structural):** a sentinel planted in
> facts **outside** an NPC's knowledge set never appears in that NPC's voicing context across a
> registry-built sandbox (mirrors the 0001 canary on the per-NPC axis); the projection is byte-stable
> for the persona facets (no drift across turns/context windows); an NPC in one room has no co-presence
> fact for a scene in another room. Read ADR 0003 (§8 + Testability), `docs/features/0002`, `0001`, and
> B61 first. Open a PR.

### B66 — the ADR-0003 testability harness (reusable structural assertions)  ·  Claude Code  ·  **FE-2 · ADR 0003 Testability section**

> In `kevinhirsch/orwell`, build the reusable test scaffolding the ADR's Testability section promises,
> so these principles are enforced, not aspirational, and stay green as the game grows. Add helpers +
> property tests for: **presence coherence** (one room per HG, adjacency-only movement, seeded
> occupancy — B64); **knowledge-scoped speech** (the per-NPC sentinel sweep — B65); **persona stability**
> (the public facets fed to the narrator are byte-identical every turn — B61); **lingering safety** (N
> social/mill turns ⇒ no phase/week/ceremony change; milling counts as watcher activity — B64); and an
> **augment-not-replace guard** (no front-end UI control reaches a game-progressing engine action except
> the validated `submitDecision` behind an explicit confirm — a dependency/registry assertion mirroring
> the Vault-Wall rule). Where only a transcript-level eval is possible (distinct voices, tone), it may
> *supplement* but never *replace* a structural test. **Acceptance:** each principle has at least one
> structural test wired into `npm run test:unit` (and, for the FE guard, the front-end pytest gate);
> the suite fails if presence/ knowledge-scope/persona-stability/lingering invariants regress. Read ADR
> 0003 (Testability) first. Open a PR.

### C28 — augment the chat with presence, never replace it (whereabouts surface)  ·  Claude Code (front-end lane)  ·  **FE-1/FE-3 · ADR 0003 §4/§7 (depends B64)**

> In `kevinhirsch/orwell` `frontend/`, surface presence so milling is legible **without** moving play
> out of the chat (ADR 0003 §4: augment, never replace). Render `whereabouts()` (B64) as an **ambient**
> ground for the conversation — who's in the room with the player and who's nearby — as a light,
> dismissible presence strip / part of the memory wall (C21), *not* a click-to-act room navigator: the
> player still moves, mills, asks "who's here?", and talks **in prose**, and the engine grounds the
> narration. Approaches (C24) and any "drift to the backyard" remain conversational intents the model
> acts on, never UI buttons that progress the game. Vault-free, fail-open (no strip on empty/error).
> **DoD:** the presence strip shows only co-present/adjacent public facts; no UI control advances phase
> or initiates a scene by itself (the augment-not-replace guard, B66); `pytest` + 0032 headless gate
> green. Depends on **B64** (+ C21). Read ADR 0003 first. Open a PR.

---

## Operations, security & test-integrity batch (B67–B72 / C29) · 2026-06-09 (round 3)

Dispatch prompts for the **operations/security/test-integrity audit**
(`docs/audits/2026-06-09-operations-security-tests-audit.md`). This batch is **cross-cutting** —
it touches `deploy/`, `frontend/`, `src/`, and the test suite — so the B/C split is again just a
**scope** marker (engine/infra vs. front-end Python), not an agent assignment; **Claude Code owns
all of it**. The through-line the audit found: *the front-end ↔ engine boundary is where the real
operational risk concentrates, and the green test gate gives false confidence on three of the four
mandates.* Two findings ship-broken **today** (the engine-token footgun B67; the live knowledge-drop
B68); three more re-point the mandate gates at the production loop (B69/B70). House rules apply
(Vault Wall structural; `npm run test:arch` green; BDD/TDD-first; roles-only tests; keep gates green;
PR per item).

> **Good news the audit confirmed (no work needed):** the front-end's **own** security posture is
> sound — the authenticated-user → engine-sandbox-key trust path **cannot be spoofed** (the key is
> server-derived from the session, never client input), dropped dangerous verticals are **truly
> unmounted server-side** (404 even for admins), and auth/sessions/multi-tenant isolation are
> well-built. No critical or major app-security bypass. The items below are operations, test-integrity,
> and minor hardening.

| Wave | Item | Lane (scope) | Audit ref |
|---|---|---|---|
| **R-0 — ships broken today** | B67 engine-token end-to-end + multi-user header · B68 live knowledge-drop | deploy+FE+engine / engine | A1·A2·secB3 / C1 (=product C2) |
| **R-1 — re-point the mandate gates** | B69 live richness + fairness + sentinel · B70 structural test/CI gaps | tests+engine | C2·C3·C6 / C4·C7·C8·C9 |
| **R-2 — production-grade deploy** | B71 atomic/rollback update + boot-preload + real smoke · B72 root-drop + hardening + backup/DR + hygiene | deploy/systemd (+engine runtime) | A4·A6·A7 / A5·A8·A9·A3·A10 |
| **R-1 — FE hardening** | C29 secure-cookies + proxy rate-limit + stray verticals + entitlements + deps + isolation test | front-end | secB2·B4·B5·B6·B7 + testC5 |
| **R-0 — Settings ruling** | C30 global LLM config (admin-set, hidden from non-admins; chat-bar picker stays per-profile) + per-profile prefs | front-end | settings S1·S4 · ruling |
| **R-0 — search re-wire** | C32 web search as an in-fiction agent capability (amends 0032) | front-end + engine prompt | ruling 2026-06-09 |
| **R-2 — Settings prune** | C31 dead-JS gating + live-data wipes (search prune superseded by C32) | front-end | settings S3·S5 |
| **R-2 — tagline** | C33 hero tagline genuinely AI-generated (curated/static only as fallback) | front-end + engine | ruling 2026-06-09 |

> **Reconciliation still owed:** a 4th audit pass (every prior finding → fixed/partial/open) was
> started and parked. Confirmed fragments: **E3** (orchestrator bypassed by player turns) and the
> **finale relay** (product B3 / front-end C12) are **STILL OPEN**; **0041's emotional-arc is genuinely
> live** (real production callers) but its competition modifier is **unverified for fairness** (→ B69).
> Resume that pass before closing prior items as done.

### B67 — wire `ORWELL_ENGINE_TOKEN` end-to-end; fix multi-user header semantics  ·  Claude Code (deploy + FE + engine)  ·  **R-0 · CRITICAL · ops A1 + A2 + sec §B3**

> In `kevinhirsch/orwell`, close the engine-auth footgun. The engine **enforces**
> `ORWELL_ENGINE_TOKEN` on every route (`src/adapters/mcp/HttpMcpServer.ts:92`), but the front-end has
> **no code path to send it** (`frontend/src/orwell_engine.py:24-27,172-181` send only the user header)
> and the installer never sets it — so the documented way to turn auth on (`docs/INSTALL.md:103-104`,
> "the front-end must then send it") returns **401 on every call and bricks the game**, while the only
> working config runs the engine **unauthenticated** behind nothing but the loopback bind. (1) **FE:**
> read `ORWELL_ENGINE_TOKEN` (+ `BBAI_ENGINE_TOKEN` fallback) and attach `Authorization: Bearer <token>`
> in both `_call` and `_admin_call` when set. (2) **Installer:** auto-generate a token
> (`openssl rand -hex 32`) into `.env` so engine auth is **on by default** even co-located. (3)
> **Multi-user (ops A2):** the engine rejects only a *missing* `x-orwell-user`, but the FE defaults it to
> `"default"` (`orwell_engine.py:27`), so `ORWELL_ENGINE_MULTIUSER=1` silently collapses anonymous
> sessions into one shared sandbox — make the FE send **no** user header when there's no authenticated
> owner (engine 400s), or have the engine treat literal `"default"` as unauthenticated under multi-user.
> *(The authenticated-user path is already sound — don't change how the key is derived from the session.)*
> **Acceptance:** with the token set in `.env`, the FE completes a full create→advance→decision turn and a
> tokenless `curl /player/call` 401s; with it unset, behavior is unchanged; under multi-user an anonymous
> FE call is refused, not routed to `default`. Read `docs/features/0021`, `0009` first. Open a PR.

### B68 — stop dropping the player's knowledge layer on save (live non-degradation)  ·  Claude Code (engine)  ·  **R-0 · CRITICAL · test C1 (= product-audit C2)**

> In `kevinhirsch/orwell` (TS engine), a real **non-degradation regression ships today**: the live
> durable snapshot hardcodes `knowledge: []` (`src/engine/sessionSnapshot.ts:79`) and `SessionSnapshot`
> has **no knowledge field** (`:38-41`), so the player's accumulated knowledge (facts surfaced by
> pathway, suspicions) is **discarded on every save** and not restored on restart — the old version's
> exact "memory thinning" failure, reproduced. The non-degradation gate passes anyway because it runs a
> **different** state builder (`gameProgression.ts`) whose `counts()`/`isSuperset` *do* track knowledge
> (`saveState.ts:75,91`), and the live durable test (`durablePersistence.test.ts`) never asserts
> knowledge survives. Per remediation principle #6 (the snapshot is the contract): add `knowledge`
> (and suspicions + the id/ts counters, product-audit C3) to `SessionSnapshot`, serialize it from /
> load it into `InMemoryKnowledgeService`, populate `toGameState().knowledge` so the 0031 checkpoint
> guards it. **Add the live-path test that was missing:** surface ≥1 fact to the player via pathway →
> save + new registry over the same `FileSaveStore` dir → assert the factId and
> `counts(restored).knowledge >= counts(before).knowledge` survive. **Acceptance:** the new live restart
> test fails before the snapshot fix and passes after; `isSuperset` over the live path includes
> knowledge. Read `docs/features/0007`, `0030`, `0002` first. Open a PR.

### B69 — re-point the mandate gates at the production loop (richness · fairness · sentinel)  ·  Claude Code (tests + engine)  ·  **R-1 · MAJOR · test C2 + C3 + C6**

> In `kevinhirsch/orwell` (TS engine), three "green" gates measure the wrong thing — the headline
> invariants run against fixtures disconnected from `liveSeason.ts`. Per remediation principle #7 (gates
> on the production path):
> 1. **Richness (mandate #1, C2):** the property test **and the gated BDD 0003** compute
>    `richnessMetrics(simulateSeason(...))`; `simulateSeason` (`src/engine/simulation.ts`) is imported by
>    **nothing in production**, hardcodes `reveals` 0/1 (`:100`) so `maxRevealsPerMoment ≤ 1` is
>    impossible to violate, and **force-sets a reveal if none occurred** (`:116-118`) so `surfacingRate>0`
>    is a tautology. Re-point `richnessMetrics` at a real `Orchestrator`/`liveSeason` run's EventStore
>    over a full season; **delete the `reveals=1` backstop**; quarantine `simulation.ts`.
> 2. **Anti-sycophancy (mandate #3, C3):** fairness is tested only at the pure `resolveCompetition` unit
>    with no soul modifier; the **live** loop wires the 0006/0028/0041 emotional modifier and a sign
>    error there would protect the player unseen. Add a live statistical test — favorite-win band **and**
>    `winRate(player) == winRate(npc)` at identical stats+soul over N seeds — and tighten the loose
>    65–80% band toward the documented ~72%.
> 3. **Sentinel (mandate #2, C6):** the canary injects sentinels into `buildEngineCore` (narrow) and the
>    UAT leak check is a fixed numeric regex, so a hidden **content string** the live loop generates (a
>    confessional line) leaking verbatim into `getMomentPrompt` is invisible. Tag live-generated hidden
>    content with a unique sentinel and assert it never appears on any player-channel response across
>    seeds.
> **Acceptance:** mutating the live reveal gate to "never reveal" fails the richness test; injecting a
> +0.1 player modifier into the live competition path fails the fairness test; echoing a seeded live
> confessional sentinel on a player surface fails the canary. Read `docs/features/0003`, `0006`, `0001`
> first. Open a PR.

### B70 — close the structural test & CI gaps (boundary · 0038 · coverage)  ·  Claude Code (tests + CI)  ·  **R-1 · MAJOR · test C4 + C7 + C8 + C9**

> In `kevinhirsch/orwell`, four gaps let mandate-violating regressions through a green gate:
> 1. **C4 — the narrative adapter is outside the Vault boundary.** `.dependency-cruiser.cjs` OUTWARD
>    covers `surfaces|services|outwardRoot|adapters/mcp` but **not** `adapters/narrative/` — the literal
>    pipe to the model; wiring `VaultStore`/`SoulStore` into `LlmNarrativePort` to "enrich" narration
>    would pass. Add `^src/adapters/narrative/` to OUTWARD. *Acceptance:* a temporary
>    `import type { VaultStore }` in `LlmNarrativePort.ts` fails `test:arch`.
> 2. **C7 — feature 0038 is spec'd but un-gated.** `docs/features/0038-live-offscreen-society.feature`
>    has 6 scenarios and **zero step definitions** (26 undefined steps), absent from `cucumber.cjs` —
>    implying coverage of Vault-isolation + cross-user + gossip behaviors that doesn't exist. Either gate
>    it with real steps (pairs with B27b's gossip→player work) or move the `.feature` to `drafts/` so the
>    repo stops implying coverage.
> 3. **C8 — CI never runs coverage.** `.github/workflows/ci.yml` runs the functional gate but no
>    `test:cov`/thresholds, so coverage can silently regress. Add a coverage job with per-directory branch
>    thresholds (`src/engine`, `src/composition`, `src/adapters/engine` ≥ 90%).
> 4. **C9 — the 97.6% headline masks the orchestrator rollback path.** `src/composition/orchestrator.ts:
>    184-200` (the fail-closed integrity checkpoint's rollback — what protects against persisting a
>    degraded/leaky state) and `GameSessionAdapter` finale-answer rejection (81% branch) are uncovered.
>    Add tests: force an integrity failure → assert rollback + **no** persist; cover the finale-answer
>    reject path.
> **Acceptance:** all four above; dropping a covered branch below threshold fails CI. Open a PR.

### B71 — production-grade deploy: atomic/rollback updates, boot preload, real smoke  ·  Claude Code (deploy + engine runtime)  ·  **R-2 · MAJOR · ops A4 + A6 + A7**

> In `kevinhirsch/orwell` `deploy/` (+ a small `src/` runtime change), make the deploy lifecycle safe:
> 1. **A4 — atomic, pinned, rollback-able updates.** `orwell-update.sh:66-72` does
>    `git reset --hard origin/main` **then** `npm ci && build` under `set -e`, so a build failure leaves
>    the tree on new `main` with the old `dist/`; it always pulls unpinned `main` with no rollback. Build
>    **before** committing to the swap (restart only on build success; leave the prior checkout on
>    failure), add `REF`/`TAG` pinning, and keep the prior `dist`/SHA for `--rollback`.
> 2. **A6 (= product-audit E11) — preload saved users at boot.** The watcher iterates only **in-memory**
>    `registry.usernames()` (`gameWatcher.ts:52`, `registry.ts:155-157`); at process start the map is
>    empty, so every restart (incl. every update) **freezes all saved users' off-screen society** until
>    each next call. At `runtime.start()`, enumerate `saveStore` users and warm their sandboxes.
> 3. **A7 — a smoke test that proves the system works.** `deploy/smoke.sh` starts only the engine and
>    stops at `createCharacter` — a green run is compatible with a broken FE or a non-advancing game. Add
>    a stage that boots the FE on `ORWELL_PORT`, hits a real route, and drives one
>    create→advance→decision turn through the FE, including one pass with `ORWELL_ENGINE_TOKEN` set
>    (proving B67).
> **Acceptance:** a forced build failure leaves services on the previous build with a clear message + a
> pin/rollback path; after a restart with N saved users and a live watcher, off-screen events accrue with
> no prior request; smoke fails if the FE can't reach the engine or a turn can't complete. Read
> `docs/features/0030`, `0035`, `0031` first. Open a PR.

### B72 — deploy hardening & operability: drop root, backup/DR, dir split, hygiene  ·  Claude Code (deploy/systemd + docs)  ·  **R-2 · MAJOR · ops A5 + A8 + A9 + A3 + A10**

> In `kevinhirsch/orwell` `deploy/` + `docs/INSTALL.md`, make the box operable and least-privilege:
> 1. **A5 — drop root + systemd hardening.** Neither unit sets `User=`; both run as **root** with an
>    internet-facing FastAPI app (`orwell-frontend.service:12` binds `0.0.0.0`). Create an `orwell` system
>    user, `chown` app+data, set `User=orwell`, and add `NoNewPrivileges=yes`, `ProtectSystem=strict`,
>    `ProtectHome=yes`, `PrivateTmp=yes`, `ReadWritePaths=` scoped to the two data dirs.
> 2. **A8 — backups, readiness, DR.** "Backups" is prose that **misstates the layout** (the FE SQLite is
>    `frontend/data/app.db`; engine saves are JSON under `data/` — two dirs, one undocumented). Ship
>    `orwell-backup.sh`/`orwell-restore.sh` covering **both** dirs, document the layout correctly, and add
>    a **readiness** check (engine reachable + FE up + **LLM configured**).
> 3. **A3 — installer writes a key the FE never reads.** Install writes `ANTHROPIC_API_KEY`
>    (`orwell-install.sh:84-90`) but the live engine narrator is `EchoNarrativePort` and the FE reads
>    `OPENAI_API_KEY`/`settings.json` (`constants.py:34-36`) — so "configured" is a **false signal** and a
>    fresh box isn't playable. Map the installer prompt to the names the FE consumes, or change the copy to
>    "configure the LLM in Settings after install."
> 4. **A9 — saves + secrets share one dir.** `/opt/orwell/data` holds both saves and `.env`; factory-reset
>    keeps only a file literally named `.env` (`orwell-factory-reset.sh:172-174`) — fragile once B67 adds a
>    generated token. Put saves in `data/saves/` distinct from `data/.env`; scrub the subdir wholesale; fix
>    the script's stale `ORWELL_DATA_DIR` comment.
> 5. **A10 — hygiene.** Mark `EnvironmentFile=-` optional (manual installs before `.env` fail confusingly);
>    document the FE-without-engine degraded behavior (`Wants=` not `Requires=`); support `REF=` +
>    document verifying the piped script (unpinned root `curl|bash`); set a journald `SystemMaxUse=` cap +
>    `SyslogIdentifier=`; assert a dummy key never appears in captured logs.
> **Acceptance:** `systemctl show -p User` is non-root and the game still plays; a documented
> backup→wipe→restore round-trips a game and readiness returns non-OK when the LLM is unconfigured; a
> fresh install is either playable with zero UI config or the docs say plainly it isn't; reset removes
> only the saves subdir + FE store. Open a PR.

### C29 — front-end app-security hardening + the sandbox-isolation regression test  ·  Claude Code (front-end)  ·  **R-1 · MINOR (posture) · sec §B2/B4/B5/B6/B7 + test C5**

> In `kevinhirsch/orwell` `frontend/`, the app-security posture is **sound** (no bypass) — these are the
> minor-but-worth-it hardening items the audit flagged before a multi-user/internet deploy, plus the one
> missing regression test:
> 1. **C5 — guard the trust path that's correct today.** Nothing asserts the engine `X-Orwell-User` key
>    is derived from `request.state.current_user` rather than client input, or that two authed users get
>    **distinct** sandboxes. Add an FE test that **fails if** a route forwards a client-supplied `user` or
>    routes an authenticated user to `"default"`.
> 2. **B2 — two inherited verticals survive the game build.** `vault_routes` (Bitwarden/`bw` CLI,
>    `app.py:737`) and `mcp_routes` (register external MCP servers incl. `stdio` = arbitrary host binary,
>    `app.py:693`) are mounted **unconditionally** (admin-only, so not an escalation path, but outside the
>    "game and nothing else" keep-set). Route both through `mount_optional` under their own keep flags;
>    assert they 404 under `ORWELL_GAME_BUILD=1`.
> 3. **B5 — `SECURE_COOKIES` defaults false** (`auth_routes.py:141`) and the installer doesn't set it.
>    Default it true in the deploy env or auto-set `Secure` on `X-Forwarded-Proto: https`.
> 4. **B4 — rate-limiting keys on `request.client.host`** (`auth_routes.py:79-81`), which behind the
>    anticipated reverse proxy is the proxy IP — all users share one bucket. Key on a trusted
>    `X-Forwarded-For` (left-most, only behind a configured trusted proxy) and/or add per-username lockout.
> 5. **B6 — wire the dead entitlement layer.** `require_entitlement`/`has_entitlement` exist but **no
>    route calls them** (all use bare `require_admin`); route LLM-settings + user-management through
>    `require_entitlement` so a future non-admin grant actually works.
> 6. **B7 — pin `frontend/requirements.txt`** (only `pydantic>=2.0` is pinned) with a lockfile/hashes.
> **DoD:** the isolation test fails if the route trusts a client `user`; `/api/vault/config` and
> `/api/mcp/servers` 404 under the game build; `pytest` + the 0032 headless gate green; engine gate
> unaffected. Open a PR.

### C30 — settings model ruling: global LLM config (admin-set, hidden from non-admins) · per-profile preferences  ·  Claude Code (front-end)  ·  **R-0 · CRITICAL (multi-user) · settings S1 + S4 · RULING 2026-06-09**

> In `kevinhirsch/orwell` `frontend/`, implement the **settings model ruling** (see the addendum in
> `docs/audits/2026-06-09-settings-menu-audit.md`): **the first admin sets up the LLM (services/ai)
> and those settings are GLOBAL for all users** — logically-global things are global, unchangeable
> by, and **hidden from** non-admins; **user-based preferences persist per-profile**, never globally.
> Concretely:
> 1. **Mark `services` and `ai` admin-only** (join `tools`/`users`/`system` in `syncAdminVisibility`,
>    `settings.js:5060-5062`) so a non-admin never sees LLM config at all — today they land on
>    `services` as the **default tab**, see "None", and 403 on every action (`model_routes.py:1421,
>    1488,1684`, `auth_routes.py:461-466`). Pick a sensible non-admin default tab (account or
>    appearance).
> 2. **Verify and test that a non-admin actually inherits the global LLM config** — the global
>    `default_chat` endpoint/model must drive a non-admin's game turn with zero settings interaction
>    (this is the crux of the ruling: admin configures once, everyone plays). **The chat-bar model
>    switcher STAYS for every user** (ruling): selecting *among* the admin-provisioned
>    endpoints/models is a per-profile preference (persist via the `_PER_USER_KEYS`
>    `default_endpoint_id`/`default_model` seam, `settings.py:379-388` / `prefs_routes.py:82`),
>    layered over the global default — what's hidden is the config/management surface (endpoints,
>    keys, global defaults), never the picker.
> 3. **Per-profile preferences done right (S4):** `saveKeybinds()` swallows the admin-only 403 and
>    toasts "Shortcut saved" while nothing persists (`settings.js:1855-1868`). Persist keybinds via
>    per-user **`/api/prefs`** (`prefs_routes.py:82`), and apply the same rule to any other genuine
>    preference (appearance is localStorage today — optionally migrate to `/api/prefs` for
>    cross-device). No preference ever writes the global settings store.
> 4. Amend **B69**'s readiness check: "playable after install" must hold for a **non-admin** user —
>    admin sets the model once, a fresh non-admin account plays with zero config.
> **DoD:** a non-admin sees no `services`/`ai`/LLM surface anywhere; their game speaks using the
> admin's global config with zero setup; their keybind change persists per-profile across reload and
> does NOT affect other users; an admin's change to the global model affects everyone; `pytest`
> green; engine gate unaffected. Open a PR.

### C31 — finish the Settings game-build prune (no dead tabs, no live JS behind hidden ones)  ·  Claude Code (front-end)  ·  **R-2 · MAJOR · settings S3 + S5 (S2 superseded by C32)**

> In `kevinhirsch/orwell` `frontend/`, close the cosmetic-hide-live-code pattern in the Settings
> modal (`docs/audits/2026-06-09-settings-menu-audit.md` S3/S5). **Note the ruling: `search` is NOT
> pruned — it is re-wired as a core in-game capability by C32** (the settings tab becomes
> admin-only global config like services/ai, per C30). Remaining prune work:
> (1) `email`/`reminders`/`integrations` are CSS-hidden (`game-trim.css:59-63`) but their `init*`
> handlers still run on every settings open (`settings.js:2081-2085`) and bind controls to 404'd
> endpoints (reminders Test → `/api/notes/fire-reminder`; email → `/api/email/*`). Gate those
> `init*` calls behind the game-build flag, and ideally strip the dropped panels **server-side**
> (extend the `index.html` rewrite that already does `strip_dropped_scripts`).
> (2) Trim the admin **System** tab's Danger-Zone wipe list + export/import to live game data —
> today it names memory/skills/notes/tasks/documents/gallery/calendar (`index.html:2099-2153`),
> categories the game build doesn't have (pair with **B71/B72**'s backup work; chats + the engine
> save dir are the real categories).
> **DoD:** under the game build no settings-originated request hits a 404'd endpoint (network-spy
> test); System offers only live-data wipes; with `ORWELL_GAME_BUILD=0` the full inherited Settings
> works unchanged; `pytest` + the 0032 headless gate green. Open a PR.

### C32 — re-wire web search as an in-fiction agent capability (the house knows the real world)  ·  Claude Code (front-end + engine prompt)  ·  **R-0 · CRITICAL · RULING 2026-06-09 · amends 0032**

> In `kevinhirsch/orwell`, implement the **search ruling**: the LLM must be able to **leverage web
> search in-character** — when the player references something the model doesn't know (say, a new
> movie, mid-conversation with a houseguest), the agent quickly searches, gathers results, and
> synthesizes an appropriate **in-game response in the voice of whoever the player is talking to**.
> This **amends feature 0032**: `web_search` moves from the drop-set to the **keep-set** (see the
> amendments table in `docs/features/README.md`).
> 1. **Re-mount the vertical:** remove `web_search` from `GAME_DROP_SET` (`settings.py:215`) so the
>    router mounts (`app.py:581`) and `/api/search/query` works under the game build; keep the
>    Settings `search` tab, **admin-only** (global provider/key config, per the C30 ruling) — its
>    Test button now actually tests.
> 2. **Expose it to the agent:** add `web_search` to the game build's agent tool surface
>    (`GAME_TOOL_KEEP` / `agent_tools.py` / schemas) so the model can call it during game turns.
>    Fail-soft: if no provider is configured, the tool returns a clean "no search available" result
>    — the model improvises in character, never errors at the player.
> 3. **In-fiction synthesis (the crux):** add a moment-prompt clause (engine,
>    `src/engine/momentPrompts.ts` — pairs with C19's preamble work): real-world references may be
>    looked up **silently**; results are woven into the houseguest's voice ("oh I saw the trailer
>    before we came in the house!") — never presented as search output, never breaking fiction.
>    **Hard guardrail (anti-sycophancy + ADR 0003):** search informs **flavor and real-world
>    knowledge only** — it must never resolve a game fact, outcome, or hidden state; game truth
>    comes only from the engine tools. NPC knowledge of the real world is fine (houseguests lived
>    in it until move-in day); awareness of events *after* move-in is a fiction-consistency choice
>    the prompt should handle gracefully (the house has no internet — a houseguest can know the
>    movie, not this week's box office).
> 4. **Diegetic rendering:** the search tool-node must not break immersion (pair with C14/F6's
>    restyle — e.g. a quiet "📺 production research…" node, raw results never dumped in the
>    transcript).
> **DoD:** under the game build, a scripted agent turn where the player mentions a real-world topic
> can call `web_search` and the reply is in the NPC's voice with no raw search output in the
> transcript; with no provider configured the turn still completes in character; search results
> never feed a `submitDecision`/game-outcome path (assert: no search-derived content in binding
> calls); the Settings search tab is admin-only and its Test works; `pytest` + the 0032 headless
> gate green; engine gate green. Open a PR.

### C33 — the snarky hero tagline is genuinely AI-generated (not the curated fallback)  ·  Claude Code (front-end + engine)  ·  **R-2 · MINOR · RULING 2026-06-09**

> In `kevinhirsch/orwell`, make the player tagline (0033) **actually AI-generated** when a game is live,
> reserving curated/static text for the fail-open path only. Today it is **never** model-generated:
> `GameSessionAdapter.playerTagline()` (`src/adapters/engine/GameSessionAdapter.ts:232-256`) only calls
> a narrator if `this.narrator` is set, and **`setNarrator` is never called in the live composition**
> (`outwardRoot.ts` wires `EchoNarrativePort` and nothing wires the tagline narrator) — so every live
> tagline is the hardcoded `SNARKY_TAGLINES[standing]` curated line, and the front-end client
> (`orwell_engine.player_tagline`) just relays it. Per ADR 0003 (engine supplies Vault-free facts, the
> **front-end LLM voices**), generate the line where the real model lives:
> 1. **Front-end generates it** from the engine's Vault-free standing/state (`gameStatus` + the engine's
>    curated line as a seed/anchor) via the existing `llm_core`/`llm_call_async` path, with a tight
>    anti-sycophantic instruction (a weak standing must NOT flatter — keep 0033's calibration). One line,
>    bounded length; **cache per `(user, week, phase, standing)`** so it regenerates only when the moment
>    advances, not per page load (mirror the engine cache at `GameSessionAdapter.ts:102-103,234-236`).
> 2. **Fallback chain, in order:** FE LLM line → the engine's curated `SNARKY_TAGLINES[standing]`
>    (still Vault-free, state-aware) → the static **"The house is waiting."** (PR #136). Never blank,
>    never blocks the homepage (keep the fail-open contract + `test_orwell_social.py`).
> 3. **Pre-game** (no started game) keeps a themed default — generation only kicks in once there's state
>    to be snarky about.
> *(Alternative if engine-side generation is ever preferred: wire a real `NarrativePort` via the
> existing `setNarrator` seam in the live root — but the FE-LLM path is the ADR-0003-consistent choice
> and needs no new engine narrator.)*
> **Vault-free by construction:** the tagline is built only from the public standing projection — never
> hidden votes/targeting/souls/off-screen (extend the 0001 canary on `playerTagline` already covers the
> engine side; assert the FE prompt carries no Vault field). **DoD:** with a live game + LLM configured,
> the hero line varies and is model-written (not one of the fixed curated strings); with the LLM/engine
> down it falls through curated → "The house is waiting." without blocking; cached per moment; `pytest`
> green; engine gate unaffected. Read `docs/features/0033-dynamic-player-tagline.md` + ADR 0003 first.
> Open a PR.

## The casting interview (feature 0050) · 2026-06-10 — ✅ DONE

### B73 — 0050 the casting interview: producer-led character creation  ·  Claude Code (engine + FE)  ·  **product ruling 2026-06-10 · ADR 0003 · evolves 0015 — ✅ DONE**

> **DONE** (spec `docs/features/0050-casting-interview.{md,feature}`; in `cucumber.cjs`). Character
> creation is now the game's first SCENE, not a form: pre-game, the chat is the producer's "get to
> know the cast" interview. Engine: the `character-creation` moment prompt is the full interview
> operating manual (producer persona, coverage list, the canonical archetype/style **manifest
> generated from `ARCHETYPES`** — drift-tested, ending protocol); `CreateCharacterReq` carries the
> distillation (`personaArchetype`/`personaStrategyStyle`, `backstory`, `motivation`,
> `privateStrategy`, `interviewNotes[]`); the deepeners seed `Character.background` + the player's
> `Soul.memory` (pre-game memories, snapshot-durable per 0030) and the player-only fields; the
> creation return carries the **casting card** (`characterType`, `strategyStyle`, per-aptitude
> **tier words** standout/solid/scrappy, story, motivation) — qualitative only, no number crosses
> (the persona sentinel test now proves the card carries words and the payload no floats).
> Front-end: `apply_game_framing` injects the interview moment **pre-game under the game build**
> (the missing seam — pre-game chat had no game framing at all); the `createCharacter` FE schema's
> archetype enum was DRIFTED (five stale labels) — replaced with the canonical 12 + the deepener
> params, with a C13-style drift test parsing `characterFactory.ts`; `orwellOnboarding.js` is now
> the interview **gate** ("the producers will see you now" → prefill the composer, never auto-send;
> quick-start name-only fallback kept as the no-model escape hatch, audit J4). 0015's invariants
> all hold (balanced bounds, OOC/no-witness, B36 no-wipe). 7 BDD scenarios + 12 unit + 8 pytest.
> **Evolving mechanic** — anticipated next steps in 0050 §9 (richer derived signals, NPC casting
> tapes, producer follow-ups rereading the interview).

### B73b — 0050 v2: incremental intake — the modal is GONE; the chat acquires everything  ·  Claude Code (engine + FE)  ·  **product ruling 2026-06-10 — ✅ DONE**

> **DONE.** Ruling: the authoring data must be "acquired through the actual chat with Orwell instead of
> being a modal popup", and "OOBE can be half done … the status of which determines what the next step
> is within the game engine." Engine: a new `updateCasting` player tool records answers AS THEY LAND
> (any subset; notes append) into a durable pre-game intake (`SessionCore.casting` — a half-done
> interview survives a restart, 0030); `castingStatusOf` (pure, `src/engine/castingIntake.ts`) computes
> { known, missing, next, ready } in the engine's ask-order — **the engine, not the model, owns the next
> step**; the pre-game `GameStateView`/moment prompt carry the live status ("already on file — do not
> re-ask"); `createCharacter` finalizes FROM the intake (`playerName` now optional; rejected if no name
> anywhere); the casting tools (`createCharacter`/`updateCasting`/`getMomentPrompt`) may mint a fresh
> user's sandbox (HttpMcpServer allowlist). Front-end: `apply_game_framing` fetches the interview moment
> pre-game (fallback: a producer-voiced static steer); the C23 authoring form is **deleted** —
> `orwellOnboarding.js` keeps only the J4 model-gate + F5 dark-house holding cards and the seat hand-off
> (fresh chat session per interview = the F7 fence, then prefill "I take my seat for the casting
> interview." — never auto-send); `updateCasting` wired through schemas/agent allowlists/executor with
> the C13-style enum drift tests now covering both casting tools. 4 new BDD scenarios (11 total) +
> 8 new unit (20) + FE pytest green.

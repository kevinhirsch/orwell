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

### B26 — 0037 engine: expose a Vault-free `finaleView` read  ·  Claude Code  ·  **small; unblocks C11**

> In `kevinhirsch/orwell` (TS engine), promote the existing private `GameSessionAdapter.finaleView()` to a
> **read tool** `finaleView(): FinaleView | null` on the `GameSession` port + `PLAYER_TOOLS` + `McpServer`
> dispatch (per `docs/features/0037-…md` §8.1). `readsVault: false`; classify it **infra** (add to
> `INFRA_LEVERS`, like `gameStatus`/`playerTagline`) so the lever-manifest drift guard doesn't require naming
> it. It returns the **same Vault-free projection** already proven on `AdvanceView.finale` — names + current
> stage + the reveals SO FAR only, **never** a lean/tally/eviction-manner/pre-reveal winner. Extend the 0001
> sentinel canary to `finaleView`; `npm run test:arch` + `npm test` green. Open a PR.

### C11 — 0037 front-end: render the interactive finale  ·  OpenHands  ·  **depends on B26**

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

### B30 — 0041 character evolution & season arc  ·  **LINCHPIN (unblocks 0038 + 0040 soul pieces)**

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
- **0038** live off-screen society — **B27a done**; **B27b** (gossip↔checkpoint reconciliation) ready (0038 §8).
- **0040** NPC confessionals — **done (core)**; soul-recall feedback rides on 0041.
- **0041** character evolution/arc — **Ready (§8), the LINCHPIN** (wires `SoulStore` into the live sandbox →
  unblocks the deferred soul halves of 0038 + 0040). → B30.
- **0039** promise/deal tracking (§8) → B28 · **0042** competition library (§8) → B31 · **0043** emergent bloc
  behavior (§8, honors ADR 0002) → B32 · **0044** strategic nom/vote refinements (§8) → B33.
- **0037 finale UI** — **B26** (Vault-free `finaleView` read) → **C11** (`orwellFinale.js`), per 0037 §8.
- **0022 — MVP-2 (the rich game UI)** — the one deferred feature (no DoR yet).

**Suggested build order for the implementer agents:** 0041 (linchpin) → 0039 / 0043 → 0044 (consumes 0043 +
0041) → 0042 → B27b → 0037 UI. Each is independently buildable per its §8; 0044 reads best after 0043/0041.
- *(By design, not a gap: the live engine narrator is `EchoNarrativePort`; the front-end narrates via
  `getMomentPrompt`. The `playerTagline` `setNarrator` seam is ready if engine-side narration is ever wired.)*

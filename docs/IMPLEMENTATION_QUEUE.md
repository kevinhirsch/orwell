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
- **Engine: 0001–0025 + 0027 are Done.** The consequence loop (0023), soul recall (0024),
  per-user sandboxes (0021), reserve twists (0025), and the real streaming narrator (0027 — `LlmNarrativePort`)
  are all green. **Three items remain:** 0030 (durable persistence — bugfix), 0026 (relationship math
  constants), 0028 (temperature constants).
- **Front-end: basic game wiring is live** (`orwellOnboarding.js`, `orwellRoutes.py`, `orwellEngine.py`,
  `X-Orwell-User` assertion already wired). **Three items remain:** C6 (lever-complete agent tools),
  C4 (0020 player UX — status panel, inline decisions, portraits), C7 (0029 app admin — promote/demote,
  password reset, user manager UI, LLM-settings gate).
- **C5 is complete** — `_current_user(request)` → `X-Orwell-User` is already wired end-to-end in
  `frontend/routes/orwell_routes.py` + `frontend/src/orwell_engine.py`.
- **0004 appearance amendment is complete** — folded into `CharacterFactory` in #70 alongside 0020.

Two lanes — **Claude Code = engine (`src/`)**, **OpenHands = front-end (`frontend/`)** — fully concurrent.

| Wave | Claude Code (engine) | OpenHands (front-end) |
|---|---|---|
| **1 — now** | **B19** (0030 durable persistence) — **top priority / regression fix**: disk-backed `FileSaveStore` + `snapshot()/restore()` on `GameSessionAdapter` + load-on-resume/save-on-mutation in `GameSessionRegistry`. Central test: new registry over same store → `getGameState()` returns `started:true` → welcome overlay stops re-firing. | **C6** (lever-complete agent tools) — expose the full engine lever set as agent tool schemas (`agent_tools.py`/`tool_schemas.py`) and verify `getMomentPrompt` is injected on every game turn. Add a drift test that fails if any agent-lever tool is missing from the prompt manifest. |
| **2** | **B16** (0026 relationship math) — firm the live `apply()` update rule into one tunable constants module; sticky/realistic defaults; measurable per-game feel spread across seeds. Independent of 0030; can run immediately after. | **C4** (0020 player UX) — always-visible status panel (week, phase, HOH, nominees, veto) from `gameStatus`; inline binding-decision buttons from `pendingDecision`/`executeDecision`; per-houseguest portraits from `portraitDescriptorFor` (0004 fields already in `CharacterFactory`). All engine tools are built. |
| **3 — polish** | **B18** (0028 temperature constants) — firm the 0006 calibration into one tunable constants module. Independent; slot in any free engine slot. | **C7** (0029 app admin) — close the AuthManager gaps: `set_admin` + last-admin guard + `/users/{u}/role`; `admin_reset_password` + session revoke + `/users/{u}/password`; admin-only Users manager in Settings; gate global LLM settings behind `manage_llm_settings`. |
| **after** | Engine done — maintenance + future specs. | MVP-2 (0022) un-parks once MVP-1 is solid. |

**Coordination rules**
- **Stay in lanes** (engine `src/` vs front-end `frontend/`); don't cross-edit the other's files.
- **No hard dependencies between waves:** both lanes are fully unblocked — each agent starts Wave 1
  immediately and moves to Wave 2 as soon as their Wave 1 item is green. There is no cross-lane dep.
- **Engine ordering:** B19 → B16 → B18. B19 first (regression); B16 and B18 are independent of each
  other and can swap, but B16 first (more impactful — it changes live gameplay feel).
- **Front-end ordering:** C6 → C4 → C7. C6 first (makes the agent properly lever-complete, which
  makes C4's UX components actually drive the engine correctly); C4 second (the visible player
  experience, biggest lift); C7 third (admin polish, no player-facing urgency).
- **Every item:** keep `npm test` + `npm run test:arch` green; Vault Wall (dependency-cruiser) green;
  add `.feature` to `cucumber.cjs` when it goes green; open a PR per item.
- **First moves NOW:** Claude Code → **B19**; OpenHands → **C6**.

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

---

## Still on the feature-maker (me)

All planned specs through **0030** are drafted (**0001–0025 + 0027 built**; 0026/0028/0029/0030
drafted; 0022 deferred; 0004 amended and already built). **Nothing is blocking the implementer queue
— both agents can start immediately.** Candidate future spec work: MVP-2 (0022) un-parks after MVP-1
is solid; jury-vote choreography; any new product calls.

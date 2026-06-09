# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`orwell` is a rebuild of an immersive, single-player, text-based **_Big Brother_ simulation**
as a web application. The system is game master, narrator, and the voice of every NPC
houseguest. A prior version ran entirely inside one LLM chat context; this rebuild moves
game state into **external, permissioned stores** behind a **hexagonal architecture** so
that the deterministic rules, the secret state, and the narration are cleanly separated.

**Status: under active implementation (BDD/TDD-first).** Features **0001–0037 are built**
(0022 / MVP-2 is the one deferral): the eight priority invariants, the MCP seam, the one-liner
deploy, the gameplay loop, the MVP-1 batch — including the **living, persisted consequence loop
(0023)** that was the long-standing critical gap (act → hidden impact → persist → recall is wired
into the live game) — and the live-loop batch (game build, tagline, live decision seam, running
off-screen watcher, social surface, interactive finale — the 0037 finale *UI* is still pending).
The game is **folded into the main chat**: the player-facing tier is the vendored **Orwell**
front-end (`frontend/`, Python) talking to the TS engine over MCP (see
[Architecture](#architecture-hexagonal)). Priority-ordered feature specs live in `docs/features/`
(now through **0044**). **Current focus: the post-audit batch 0038–0044** (behavioral-fidelity /
anti-sycophancy wiring — **0041, the linchpin, is now built** (the `SoulStore` is live in the sandbox,
souls evolve and modulate behavior), 0039 and 0040 done, 0038 partially done; remaining: B27b, 0042–0044).
See [Current status](#current-status) and `docs/IMPLEMENTATION_QUEUE.md`.

## Source of truth — read these first

The design is fully specified. **Read `docs/CLAUDE_CODE_INSTRUCTIONS.md` first** (the build
brief and complete decision log), then `docs/bb-sim-spec.md` (the v3 domain spec). These two
are authoritative and reference each other as companions.

| File | Role |
|---|---|
| `docs/CLAUDE_CODE_INSTRUCTIONS.md` | **Build brief & decision log** — start here. Architecture directives, workflow, hard "do-nots", milestones, open decisions (§15). |
| `docs/bb-sim-spec.md` | **v3 domain spec** — concept, persistence model, Vault Wall, behavioral-fidelity mandate, the BDD invariants (§12), open decisions (§16). |
| `docs/decisions/` | **Decision records (ADRs)** — accepted refinements to the canonical mechanics (drop Luck → emotional modifier; Character/Soul split; organic relationship model; veto "Houseguest's Choice"). |
| `docs/features/` | **Priority-ordered feature specs** — each `NNNN-*.md` (design note) + `NNNN-*.feature` (executable Gherkin), built in order. `README.md` there holds the live per-feature **status index** and the **Amendments to shipped specs** table (implementers must pick those up). |
| `docs/IMPLEMENTATION_QUEUE.md` | **Live work queue** — per-item implementation prompts (B/C-numbered), dispatch order + dependencies, and the truest prose snapshot of what's done vs. remaining. |
| `docs/legacy/BB_GameBible.md` | **Legacy reference only.** The old chat-prompt implementation being replaced. Source of the *concrete* mechanics, but its fixed player persona / names are illustrative — never hard-code them. |

## The non-negotiable mandate

These four priorities override convenience. A mechanically-correct but behaviorally-thin or
leak-prone build is a **failure state**, not a partial success.

1. **Behavioral fidelity is priority #1.** Reproduce the *full social texture* of a real
   _BB_ episode — drama, nuance, hidden conversations, and **off-screen NPC-to-NPC scheming
   the player never witnesses**. Tests must verify *richness*, not just mechanics.
2. **The Vault Wall is absolute and structural.** Secret state can never reach the player —
   enforced in code at the port/tool boundary, *never* by prompt wording. The model "cannot
   leak what it never receives." **God Mode / admin is walled from the Vault too** (the human
   has never read it and must not be able to — spoilers ruin the game above all else).
3. **Anti-sycophancy.** The deterministic core + seeded randomness decide outcomes; the LLM
   only *narrates*. Ground truth lives in the stores and is *queried*, never "remembered"
   and bent to please the player.
4. **Non-degradation.** Persisted detail must **never** be lost across saves and should
   *accumulate and deepen* over a game. The old version's secret store thinned out over time;
   do the exact opposite.

## Architecture (hexagonal)

Keep the **domain core pure and dependency-free** (no I/O) regardless of stack choices.
Everything else sits behind ports.

- **Domain core** — the Game Bible as code: the weekly loop (HOH → nominations → veto →
  veto ceremony → eviction → jury → final two), eligibility/legality rules,
  **stat-+-temperature-weighted** competition resolution, votes, win conditions, and the
  daily-event invariant. Fully unit-testable with a seeded `RandomnessSource`.
- **Ports (interfaces)** — at minimum: `GameStateRepository`, `VaultStore` (**engine-only**),
  `JournalStore`, `EventStore`, `KnowledgeService`, `NarrativePort` (the LLM),
  `RandomnessSource` (**seedable**), `Clock`/`Scheduler`, `CharacterFactory`, `SoulProvider`.
- **Adapters** — DB adapter(s) for relational/graph state and the event record; soul storage
  (md and/or vector); **MCP server(s)** exposing *permissioned* tools to the narrative LLM
  (e.g. `getVisibleStateFor(entity)`, `recordInteraction`, `resolveCompetition`,
  `surfaceInformationTo(player, fact, pathway)`); the LLM adapter behind `NarrativePort`.

**The permission boundary is the whole point.** No player-facing **or** admin/God-Mode-facing
adapter or tool may depend on `VaultStore`. A surface is not "done" until a test proves it
returns no Vault data.

### Three channels → ports

- **Administrator / God Mode** — admin-only meta port (configure, override mechanics, inspect
  **non-Vault** state, manage the sandbox). Walled from the Vault even for the admin.
- **Player-level** — out-of-character strategy/directives within the player's agency.
- **In-character** — narrative interactions.

Each running game is its own isolated sandbox — keyed to the **physical-world user**: **one
active game per user**, **unlimited users concurrently**, each fully isolated. **Cross-user
isolation** is a first-class guarantee *alongside* the Vault Wall (no call for user A may return
user B's game — secret or not). The chat is each user's window into *their* game. (Feature 0021.)

## The event / visibility model (build this carefully — it caused real bugs before)

There is **one `EventStore`** holding every interaction. **Visibility is per-event metadata —
a witness set + a hidden flag — not a function of which store the data lives in.**

- **Player-witnessed = not secret.** If the player is in an event's witness set, it is the
  player's knowledge (Journal-visible). Do **not** mislabel witnessed events as off-screen/
  secret — that was a concrete past bug where the Vault wrongly logged events the player was
  present for.
- **The Vault holds only genuinely off-screen/hidden content** — NPC-to-NPC scenes whose
  witness set excludes the player, plus hidden attributes and confessionals.
- **Propagation only via in-game pathways.** A hidden fact reaches the player only when an NPC
  tells them, they overhear, etc. — modeled explicitly in `KnowledgeService`. The Vault Wall
  stays intact because surfacing is an explicit, traceable event. A houseguest can only know
  what they witnessed or were told; if there's no pathway, they don't know it (they may
  *suspect*, but cannot *know*). Hidden facts also **diffuse NPC-to-NPC along the social graph**
  (gossip), drifting with each retelling, so what reaches the player can be a distorted belief
  held with a source + confidence — diffusion runs in the hidden layer and only updates the
  player's knowledge when a pathway terminates at the player (ties to `docs/decisions/0002`).
- **Diary Room / confessionals are events too.** NPC confessionals are Vault-only content
  (off-screen, witness set excludes the player). The player's Diary Room is a *player-level,
  OOC* channel: its content is the **player's own knowledge** but has **no in-game pathway to
  any NPC** — it may inform the engine's read of player strategy, **never** NPC behavior. (DR
  mechanics are concrete in the legacy Bible §6–§7; the provisional domain model is spec §11.)

## The consequence & memory loop (the MVP-1 backbone — feature 0023)

Recording an event is only half the loop. Every happening — a conversation, a competition win, a
vote, a scheme — must also **fold its hidden impact into the relationship/soul layer** and
**persist**:

```
happening → recorded event (witness set + hidden flag)
          → engine applies its HIDDEN impact to the relationship/soul layer
            (trust/affinity/threat move — the player's action changes how they feel about them)
          → persisted to long-term memory: every event detail + the derived hidden state
          → recalled in full on return / restart — the house still remembers.
```

The opinion change lives in the **hidden layer** (Soul/Vault) — the player **never sees the
numbers**, only the later behavior. That is the Vault Wall working: the change is real, recorded,
and invisible. **This is the point of the game.** It is now **green** (feature 0023): the live
game wires events (0002), relationships (0017/0026), and persistence (0007/0030) together —
`recordInteraction` records the event, `src/engine/consequence.ts` folds its hidden impact into
the relationship/soul layer, and the orchestrator (`src/composition/orchestrator.ts`) persists it
with a fail-closed integrity checkpoint (0031). Hold the line that made it work: **never ship an
action that is narrated but never recorded** — it has no consequence and no memory.

## Characters, souls & per-moment temperature

- **Only the player's profile is human-authored** (first-run OOBE). **All NPC profiles are
  generated** by `CharacterFactory`, constrained to plausible _BB_ contestant archetypes
  (internally consistent, reality-TV-plausible). Generate **tons of hidden elements** per
  character; public persona may match or wildly diverge from hidden attributes; hidden
  elements surface **rarely** (gated by the temperature roll) and profiles **evolve** as the
  game proceeds. Souls may be md and/or vector-backed.
- **Static `CHARACTER` vs dynamic `SOUL`.** A houseguest's stable baseline (archetype, core
  competition aptitudes, identity, backstory, baseline temperament) is **static `CHARACTER`**
  ("facts"); evolving state — current **emotional** state, accumulated memory, leanings, and
  **relationship beliefs** — is the **dynamic `SOUL`** (md + vector). Relationships are **not**
  binary ally/enemy flags: they are directed, graded, asymmetric, uncertain beliefs
  (trust/affinity/threat…) computed from event history, and any "ally / best-friend / enemy"
  label is **organic and emergent** — read through the holder's own character framing, never
  stored (`docs/decisions/0002`). The competition **emotional modifier** (a baseline that grows
  more or less volatile with circumstances + temperature) and the veto "Houseguest's Choice"
  both read the dynamic soul. See `docs/decisions/`.
- **The player forms their own reads (human-driven).** The engine computes both `NPC→player` and
  `player→NPC` relationship edges from history — but **never shows the player a number** and never
  asserts how they feel ("you trust them"). Player-facing surfaces show **facts the player knows +
  observable houseguest behavior**; the player **infers** trust and threat themselves. Paranoia and
  loyalty are the human's to form (features 0017/0020/0023). The model is computed and hidden; the
  *feeling* is theirs.
- **Temperature is per-moment, not a global knob.** Each gameplay moment rolls temperature
  across *all* involved variables (outcomes, expression, NPC initiative, which secret
  surfaces, alliance shifts, volatility…). It governs variance/surprise but **never** overrides
  hard rules (eligibility, the Vault Wall) or archetype-grounded outcome weighting. Drive it
  through the seedable `RandomnessSource` so distributions are testable.
- **Bidirectional scenes.** NPCs hold goals from their profiles that make them approach the
  player, *and* the player can initiate. Neither side initiates everything.

## Canonical game mechanics (from the legacy Game Bible — still authoritative)

- **Cast:** 16 houseguests (player + 15 NPCs). **Jury of 9. Final 2.** Classic format, no
  core-structure twists (one or two production twists may be held in reserve).
- **A "week" = one HOH reign** (HOH comp → eviction), not seven calendar days.
- **Veto competition:** **six** players — the HOH, the two nominees, and **three by chip
  draw**. One chip is **"Houseguest's Choice"**: whoever draws it picks the sixth player
  instead of a random name (NPCs choose by soul motivation — their strongest available bond
  per the relationship model, `docs/decisions/0002`). The player can't influence which chips
  are drawn, but may hold Houseguest's Choice if drawn.
- **Eligibility/legality (hard rules):** the **outgoing HOH cannot play** for the next HOH;
  the **veto winner cannot be named replacement nominee**; all houseguests except the HOH and
  the two nominees vote at eviction (HOH breaks ties).
- **Competition stats:** **Physical, Mental, Social** (no Luck stat). Outcomes are weighted by
  relevant stat vs. competition type + **temperature** plus an **emotional modifier** sourced
  from the houseguest's soul — **never** story convenience; the engine never protects the
  player. Emotional state is a *character/soul* attribute, not a fourth competition stat. The
  player may declare intent (compete / throw / play safe) before a comp and cannot change it
  retroactively.
- **Daily-event invariant:** every in-game day contains ≥1 meaningful event
  (comp, nomination/veto ceremony, vote/eviction, or significant house event).
- **Standard weekly cadence:** Day 1 HOH comp → Day 2 nominations → Day 3 veto comp →
  Day 4 veto ceremony → Day 5 eviction, with the next HOH beginning immediately. A genuine
  rest day is a rare producer judgment call, **not** the default.
- **Jury & endgame:** the final **9 evictees** form the jury; how the player treats houseguests
  on the way out genuinely influences their later vote (jury management is a real mechanic). At
  Final 2 each finalist gives a statement and takes one question per juror. **Ties:** the HOH
  breaks an eviction-vote tie; the **last-evicted juror** breaks a tied jury vote.

## Workflow (BDD/TDD — follow strictly)

1. Translate the `bb-sim-spec.md` §12 invariants into **failing `.feature` files first**;
   implement to green; refactor.
2. **Strict priority order:** Vault isolation (incl. God Mode) → event visibility &
   propagation → behavioral fidelity → replayability/naming → competition eligibility →
   outcomes by stats+temperature → persistence non-degradation → daily-event.
3. Domain core under fast unit tests with the **seeded** `RandomnessSource`.
4. **Property-based tests** for randomness/temperature distributions and for behavioral-
   richness thresholds.

Suggested milestones M1–M8 are in `docs/CLAUDE_CODE_INSTRUCTIONS.md` §12 (start: pure domain
core, then ports + in-memory adapters with Vault/God-Mode isolation green).

## Testing rules (HARD)

- **No names in tests — roles only** (HOH, nominee, evictee, veto winner, NPC, player).
- **Sample saves are FORMAT ONLY.** Never ingest their *content* as canonical, seed, or test
  data. This includes the example persona and names in `docs/legacy/`.
- A player-facing **or admin** path isn't done until a test proves it returns **no** Vault data.
- Test that off-screen NPC life **exists** and that witnessed events are **not** secret.

## Hard "do-nots"

- Don't hold game state in a chat context window as the source of truth.
- Don't hard-code any protagonist, houseguest name, or persona (incl. the legacy example).
- Don't reference names in tests; don't ingest sample-save content as data.
- Don't rely on prompt wording for the Vault Wall — enforce it in code.
- Don't let the narrative layer decide or alter outcomes.
- Don't expose Vault contents to **anyone** at runtime, including admin/God Mode.
- Don't mislabel player-witnessed events as off-screen/secret.
- Don't let persisted detail degrade over time.

## Building & testing

Stack: **TypeScript / Node 22**, hexagonal, pure domain core. Test lanes: **Vitest**
(unit/property), **Cucumber.js** (the executable `.feature` specs), **fast-check** (property /
distribution), and **dependency-cruiser** (the *structural* Vault-Wall test — proves no outward
module imports `VaultStore`/`VectorIndex`, type-only imports included). Datastore is
**in-memory** today; **SQLite (`better-sqlite3`) → Postgres** and **sqlite-vec → pgvector**
(the latter engine-only) land behind their ports with the persistence/soul features.

| Command | What it does |
|---|---|
| `npm install` | Install dev dependencies. |
| `npm test` | Full gate: `typecheck` → `build` → unit/property/arch → BDD. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | Bundle the engine entrypoint to `dist/main.js` (esbuild). |
| `npm start` | Run the built engine — the HTTP MCP server (`ORWELL_ENGINE_PORT`, default 8765; `ORWELL_PORT` / `BBAI_*` are legacy fallbacks). |
| `npm run test:unit` | Vitest — unit, property, and the dependency-cruiser boundary test. |
| `npm run test:bdd` | Cucumber.js over the **implemented** `.feature` files. |
| `npm run test:arch` | dependency-cruiser CLI (forbidden-edge report). |
| `npm run test:cov` | Vitest with v8 coverage (excludes `src/ports/**` and `src/main.ts`). |
| `npm run test:watch` | Vitest watch mode. |

- Single unit file: `npx vitest run tests/unit/visibility.test.ts`.
- Single BDD scenario: `NODE_OPTIONS='--import tsx' npx cucumber-js docs/features/0001-vault-wall-isolation.feature:LINE`.
- `cucumber.cjs` `paths` lists only the **implemented** features; add the next `.feature` there as each is built to green (priority order). It is the canonical list of what is wired into the BDD gate.
- **Test setup:** `tests/support/sandbox.ts` is the canonical test-environment factory — use it (not manual wiring) when adding new unit or integration tests. BDD step definitions use `features/support/world.ts`.
- **UAT lane:** `tests/uat/fullGameUat.test.ts` plays a full game to completion (bypasses HTTP to avoid CI stale-loop flakes); it runs as part of `vitest run`.
- **Runtime env:** `ORWELL_DATA_DIR` is the per-user save dir (default `.orwell-data` — the factory-reset script must scrub it); `ORWELL_WATCHER_TICK_MS` / `ORWELL_WATCHER_IDLE_MS` / `ORWELL_WATCHER_MAX_TICKS` tune the live off-screen watcher (`TICK_MS=0` disables it → pure turn-driven).
- **Front-end tests:** `cd frontend && python3 -m pytest tests/` (its own pytest gate, quarantined — never touches `cucumber.cjs` / `npm test`); `frontend/scripts/browser_smoke.py` is the headless-browser keep-set gate. The reduced game surface is controlled by `ORWELL_GAME_BUILD` (default **on**; `=0` restores the full inherited workspace).
- **Deploy** (`deploy/`): `orwell-install.sh` / `orwell-update.sh` (host-aware, legacy-aware) provision the engine + front-end as systemd units (`deploy/systemd/`); `deploy/smoke.sh` is the post-deploy check; `orwell-factory-reset.sh` scrubs all data (incl. the engine's `.orwell-data`) back to OOBE. Front-end (`frontend/`, Python/FastAPI) is its own quarantined app — see `frontend/INTEGRATION.md`.

**Source layout:** `src/domain` (pure core, no I/O) · `src/ports` (interfaces — `VaultStore`,
`VectorIndex`, `EmbeddingProvider`, `SoulProvider` are **engine-only**; outward ports include
`EngineCommands`, `GameSession`, `NarrativePort`/`StreamingNarrativePort`, `SaveStore`/
`UserSaveStore`) · `src/services` (`VisibleStateService` / `SummaryService` — outward-safe) ·
`src/surfaces` (`player/`, `admin/`, `tools/` — no Vault handle by construction) · `src/adapters`
(`inmemory/`, `engine/` (the live `GameSessionAdapter` / `EngineCommandsAdapter`, `FileSaveStore`,
`SoulStore`), `mcp/` (`McpServer` / `HttpMcpServer`), `narrative/` (`LlmNarrativePort`,
`DeterministicNarrator`, `Echo…`), `embedding/`, `random/`, `time/`) · `src/engine` (the season
loop `season.ts` + the live loop `liveSeason.ts`, plus `conversation.ts`, `relationships.ts`,
`consequence.ts` (the hidden-impact fold), `gossip.ts`, `offscreen.ts`, `confessionals.ts`,
`momentPrompts.ts`, and tunable constants) · `src/composition`
(`engineRoot` wires the Vault; `outwardRoot`/`appRoot` never do; `orchestrator.ts` is the single
per-sandbox game-advance path with a fail-closed integrity checkpoint, driven by `gameWatcher.ts`
over a `registry` of per-user sandboxes; `runtime.ts` composes + starts the live watcher from
`src/main.ts`). BDD steps + support in `features/`; unit/property/
architecture/integration tests in `tests/`. The
`.feature` files in `docs/features/` remain the source of truth. The **player-facing tier** is the
vendored **Orwell** front-end in `frontend/` (Python/FastAPI) — its own app, quarantined from the
TS tooling (see `frontend/INTEGRATION.md`).

## Current status

Built BDD/TDD-first, in priority order:

- **0001 — Vault Wall isolation:** ✅ green (player + admin surfaces; boundary proven by
  dependency-cruiser; sentinel + property tests; fixed tool allowlist).
- **0002 — Event visibility & propagation:** ✅ green (witness-derived visibility with a
  store-enforced invariant against mislabeling; pathway-only propagation; knowledge vs
  suspicion; Diary-Room isolation; NPC-to-NPC gossip diffusion with provenance/confidence/drift).
- **0003 — Behavioral fidelity:** ✅ green (seeded multi-day simulation; off-screen-heavy
  social life, alliance churn over a computed relationship model, rare/bounded hidden-element
  surfacing — richness asserted as property thresholds in `src/engine/richnessConfig.ts`).
- **0004 — Replayability & naming:** ✅ green (`CharacterFactory`: a 16-cast — one OOBE-authored
  player + 15 procedurally-named NPCs; curated/balanced ensemble; Character/Soul split; no
  hard-coded name list; no cross-seed identity carryover; same-seed reproducible).
- **0005 — Competition eligibility:** ✅ green (pure-core hard rules: outgoing-HOH exclusion,
  veto-winner-can't-be-replacement, six-player veto draw with the "Houseguest's Choice" chip,
  eviction voters + HOH tiebreak; invariant under temperature and reserve twists).
- **0006 — Outcomes by stats + temperature:** ✅ green (stat-vs-type + bounded per-moment
  temperature roll + soul emotional modifier, no Luck; reproducible by seed; favorite wins a
  calibrated strong majority (~72%) but loses real upsets; player unprotected; intent immutable).
- **0007 — Persistence non-degradation:** ✅ green (serializable `GameState`; lossless
  round-trip; co-versioned `SaveStore` (Vault+Journal bump together); cross-save superset +
  monotonic counts; the dynamic soul deepens materially while the static character is byte-stable).
- **0008 — Daily-event invariant:** ✅ green (ceremony-driven scheduler; every in-game day
  carries a meaningful event; a week = one HOH reign, HOH comp → eviction; at most one optional
  social day per week (often none), and even it carries a significant house event).

- **0009 — MCP tool boundary (M5):** ✅ green (a permissioned `McpServer` mounts only the
  channel allowlist; read tools come from the visible projection, action tools cross a Vault-free
  `EngineCommands` port; the adapter has no Vault/vector/engine-root dependency — dependency-cruiser
  rule extended to cover it; every tool output proven sentinel-free; channels isolated).

**All eight priority invariants (0001–0008) plus the M5 MCP seam (0009) are implemented and
green.** The engine is also **runnable**: `npm run build` → `npm start` serves the HTTP MCP
API the front-end calls (`src/main.ts` → `src/adapters/mcp/HttpMcpServer.ts`), with a static
"no secrets committed" guard. `npm test` runs clean: typecheck → build → unit/property/arch →
all BDD scenarios.

**Gameplay loop:** **0011 — weekly loop orchestration** is ✅ green (`src/engine/season.ts`): a
pure, seed-deterministic season — HOH → noms → veto → ceremony → eviction down to Final 2 + a
jury vote (last-9 jury, last-juror tie-break); NPC decisions are relationship-driven (threat/
trust), player decision points are surfaced and validated. **0012–0014** (conversation & scene
system, Diary Room, jury & endgame) are ✅ green too.

**Renamed & folded:** the project is now **Orwell** (repo `kevinhirsch/orwell`); the game is
**folded into the main chat** — the vendored Orwell front-end (`frontend/`) drives play through
the engine's MCP tools, and the engine supplies a **tight, per-moment game-master system prompt**
(0018) with a **lever manifest** (the model knows how to access and pull every engine lever).

**MVP-1 batch (0015–0031) — green** (the canonical list is `cucumber.cjs` `paths`): 0015 OOBE ·
0016 God Mode · 0017 relationship model · 0018 moment orchestration · 0019 agent play loop · 0020
player experience MVP-1 · 0021 per-user sandboxes · **0023 consequence & memory** (the former
critical gap — now wired into the live game) · 0024 soul storage & semantic recall (md + vector) ·
0025 reserve twists (Vault-sealed) · 0026 relationship math · 0027 the real LLM `NarrativePort` ·
0028 temperature/emotional constants · 0030 durable persistence (survive engine restart) · 0031
per-sandbox game orchestrator & integrity watcher. **0022** (player experience MVP-2) is **deferred**.

**Live loop batch (0032–0037) — built:** **0034** (live weekly progression & decision seam) and
**0037** (the interactive finale / jury-vote choreography: appeal scorer + staged statements →
per-juror questions → ordered vote reveal, through the 0034 seam) are BDD-gated in `cucumber.cjs`.
**0033** (`playerTagline`), **0035** (the off-screen watcher actually started in the runtime —
`SystemClock` + `composeRuntime`; the house lives between turns), and **0036** (`socialInitiatives`
+ `diaryRoom` live tools) shipped unit-gated. **0032** (front-end surface reduction / the game
build) is Python-only, tested in `frontend/tests/` with pytest — never added to `cucumber.cjs`.
The 0037 **finale UI** is still pending (B26 `finaleView` read tool → C11 `orwellFinale.js`).

**Post-audit batch (0038–0044) — in progress.** A behavioral-fidelity / anti-sycophancy audit
found capabilities **built but unwired** plus genuine gaps; the per-item prompts are in
`docs/IMPLEMENTATION_QUEUE.md` (B27–B33). **0041** character evolution & arc — **the linchpin — is
✅ green** (`src/engine/emotionalArc.ts` + `engineRoot` now wires a `SoulStore` into the live
sandbox): consequential beats + the off-screen tick drive bounded, mean-reverting soul evolution
that modulates the live competition modifier (0006/0028) and a rattled-HOH nomination read, the arc
persists + is recall-able, `CHARACTER` stays byte-stable, and no number crosses to the player.
**This unblocked the deferred soul halves of 0038 + 0040.** **0038** live off-screen society: varied
interaction types run live (B27a ✅) **+ live soul-deepening (via 0041)**; the **gossip→player
diffusion** + pathway-aware leak heuristic (B27b) remain. **0039** (promise/deal tracking, ✅) and
**0040** (NPC confessionals, ✅ — now with **live** soul-recall feedback) are green. **0042**
(competition library), **0043** (emergent bloc behavior), and **0044** (strategic nom/vote
refinements) are drafts.

**Verifying current state.** Because the status prose drifts, trust the code over this section:
`cucumber.cjs` `paths` is the live list of BDD-gated features, and `git log --oneline` shows which
`NNNN` features last merged green. Run `npm test` for the authoritative pass/fail.

**Remaining work:** the post-audit batch — B27b (0038 gossip→player diffusion), 0042–0044 (0039,
0040, **and 0041 the linchpin are done**); the 0037 finale UI (B26 `finaleView` + C11 `orwellFinale.js`);
**0022** MVP-2 (the one deferred feature); 0010's container smoke test on a real Proxmox host; the
deferred real relational adapters (SQLite/Postgres, sqlite-vec/pgvector — souls/vectors run
in-memory + file today); and full MCP/JSON-RPC over the current HTTP transport. *(By design, not a
gap: the live engine-side narrator is `EchoNarrativePort` — narration happens in the front-end via
`getMomentPrompt`; the `playerTagline` `setNarrator` seam is ready if engine-side narration is ever
wired.)*

## Open decisions (remaining)

**Resolved:** tech stack, datastore, and vector adoption (above); soul storage = markdown +
vector behind `SoulProvider`; non-degradation strategy = superset + monotonic-count + lossless
round-trip (`docs/features/0007-persistence-non-degradation.md`); drop Luck → emotional
modifier; Character/Soul split; organic relationship model; veto "Houseguest's Choice"
(`docs/decisions/`). **Mostly resolved — none block current work:**

1. ✅ **Temperature & emotional-modifier constants** — **resolved**: the *shape* is fixed in
   `docs/features/0006-…` / `docs/decisions/0001`, and the numbers are firmed into the single tunable
   module `src/domain/temperatureConstants.ts` (**feature 0028**). Only fine-tuning remains.
2. ✅ **Relationship-model math** — **resolved** by **feature 0026** (`src/engine/relationshipConstants.ts`):
   signal set, update rule, recency/decay, betrayal-shock, thresholds (promotes `docs/decisions/0002`).
3. ✅ **Jury choreography** — **resolved** by **feature 0037** (the live interactive finale: statements →
   per-juror questions → ordered vote reveal). Reserve twists stay Vault-held (0025).
4. **Embedding provider** — which model backs `EmbeddingProvider` at runtime (a deterministic
   fake covers seeded tests). *(The one genuinely-open item.)*

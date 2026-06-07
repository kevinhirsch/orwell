# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`bbai` is a rebuild of an immersive, single-player, text-based **_Big Brother_ simulation**
as a web application. The system is game master, narrator, and the voice of every NPC
houseguest. A prior version ran entirely inside one LLM chat context; this rebuild moves
game state into **external, permissioned stores** behind a **hexagonal architecture** so
that the deterministic rules, the secret state, and the narration are cleanly separated.

**Status: scaffolded, pre-implementation.** The stack is chosen (TypeScript / Node,
hexagonal) and a failing-first Vault-Wall test is wired — see
[Building & testing](#building--testing). Priority-ordered feature specs live in
`docs/features/`. The next engineering work is to turn feature 0001 from red to green, then
proceed down the priority order BDD/TDD-first.

## Source of truth — read these first

The design is fully specified. **Read `docs/CLAUDE_CODE_INSTRUCTIONS.md` first** (the build
brief and complete decision log), then `docs/bb-sim-spec.md` (the v3 domain spec). These two
are authoritative and reference each other as companions.

| File | Role |
|---|---|
| `docs/CLAUDE_CODE_INSTRUCTIONS.md` | **Build brief & decision log** — start here. Architecture directives, workflow, hard "do-nots", milestones, open decisions (§15). |
| `docs/bb-sim-spec.md` | **v3 domain spec** — concept, persistence model, Vault Wall, behavioral-fidelity mandate, the BDD invariants (§12), open decisions (§16). |
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

Each running game is its own isolated sandbox (own state namespace/instance).

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
  *suspect*, but cannot *know*).
- **Diary Room / confessionals are events too.** NPC confessionals are Vault-only content
  (off-screen, witness set excludes the player). The player's Diary Room is a *player-level,
  OOC* channel: its content is the **player's own knowledge** but has **no in-game pathway to
  any NPC** — it may inform the engine's read of player strategy, **never** NPC behavior. (DR
  mechanics are concrete in the legacy Bible §6–§7; the provisional domain model is spec §11.)

## Characters, souls & per-moment temperature

- **Only the player's profile is human-authored** (first-run OOBE). **All NPC profiles are
  generated** by `CharacterFactory`, constrained to plausible _BB_ contestant archetypes
  (internally consistent, reality-TV-plausible). Generate **tons of hidden elements** per
  character; public persona may match or wildly diverge from hidden attributes; hidden
  elements surface **rarely** (gated by the temperature roll) and profiles **evolve** as the
  game proceeds. Souls may be md and/or vector-backed.
- **Static `CHARACTER` vs dynamic `SOUL`.** A houseguest's stable baseline (archetype, core
  competition aptitudes, identity, backstory) is **static `CHARACTER`** data; evolving state —
  current **emotional** state, relationships incl. persistent `ALLIES` / `BEST_FRIEND` (filled
  once enough interaction data exists), accumulated memory and leanings — is the **dynamic
  `SOUL`** (md + vector). The competition **emotional modifier** and the veto "Houseguest's
  Choice" both read the dynamic soul. See `docs/decisions/`.
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
  instead of a random name (NPCs choose by soul motivation — e.g. an `ALLY` or `BEST_FRIEND`).
  The player can't influence which chips are drawn, but may hold Houseguest's Choice if drawn.
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

**Stack (resolved):** TypeScript / Node 22, hexagonal. Test lanes: **Cucumber.js** (BDD
`.feature` files), **Vitest** (unit), **fast-check** (property / distribution), and
**dependency-cruiser** (the Vault-Wall architecture test). Datastore: **SQLite now**
(`better-sqlite3`) **→ Postgres-ready**, behind ports, with in-memory adapters for tests.
Vectors are adopted from day one (**sqlite-vec → pgvector**) behind an **engine-only**
`VectorIndex`.

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run depcruise     # Vault Wall: no outward module may import VaultStore / VectorIndex
npm run test:unit     # vitest
npm run test:bdd      # cucumber-js — currently the FAILING 0001 Vault-Wall scenario
npm test              # all of the above, in sequence
```

**A single failing test is wired by design:** `npm run test:bdd` runs the first scenario of
feature 0001 and is **red** until the player surface renders from the visible projection;
typecheck, depcruise, and unit are green. Turning it green is the first implementation task.

**Source layout:** `src/domain` (pure core, no I/O) · `src/ports` (interfaces — `VaultStore`
and `VectorIndex` are **engine-only**) · `src/adapters` (in-memory now; SQLite/vector later) ·
`src/surfaces` (player + admin — no Vault handle by construction) · `src/app` (composition
roots — only the engine root wires the Vault). BDD steps in `test/bdd`, unit tests in
`test/unit`. The `.feature` files remain the source of truth in `docs/features/`.

## Open decisions (remaining)

**Resolved:** tech stack, datastore, and vector adoption (above); soul storage = markdown +
vector behind `SoulProvider`; non-degradation strategy = superset + monotonic-count + lossless
round-trip (`docs/features/0007-persistence-non-degradation.md`). **Still to confirm — none
block the Vault-Wall slice:**

1. **Temperature constants** — distributions, per-variable weighting, bounds, and the
   hidden-element surfacing rate. The *shape* is fixed in `docs/features/0006-…`; the numbers
   are tunable config still to be set.
2. **Jury choreography & twists/specials** — jury-of-9 sequester and the tie-breaks are
   settled; the precise jury-vote staging and any reserve twists remain to design (low
   priority; twists stay Vault-held).
3. **Embedding provider** — which model backs `EmbeddingProvider` at runtime (a deterministic
   fake covers seeded tests); finalize at wiring time.

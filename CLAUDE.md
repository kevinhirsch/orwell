# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`bbai` is a rebuild of an immersive, single-player, text-based **_Big Brother_ simulation**
as a web application. The system is game master, narrator, and the voice of every NPC
houseguest. A prior version ran entirely inside one LLM chat context; this rebuild moves
game state into **external, permissioned stores** behind a **hexagonal architecture** so
that the deterministic rules, the secret state, and the narration are cleanly separated.

**Status: under active implementation (BDD/TDD-first).** The stack is chosen (TypeScript /
Node, hexagonal) and features **0001 (Vault Wall) and 0002 (event visibility) are green** —
see [Building & testing](#building--testing). Priority-ordered feature specs live in
`docs/features/`; work proceeds down that order. Next: 0003 (behavioral fidelity).

## Source of truth — read these first

The design is fully specified. **Read `docs/CLAUDE_CODE_INSTRUCTIONS.md` first** (the build
brief and complete decision log), then `docs/bb-sim-spec.md` (the v3 domain spec). These two
are authoritative and reference each other as companions.

| File | Role |
|---|---|
| `docs/CLAUDE_CODE_INSTRUCTIONS.md` | **Build brief & decision log** — start here. Architecture directives, workflow, hard "do-nots", milestones, open decisions (§15). |
| `docs/bb-sim-spec.md` | **v3 domain spec** — concept, persistence model, Vault Wall, behavioral-fidelity mandate, the BDD invariants (§12), open decisions (§16). |
| `docs/decisions/` | **Decision records (ADRs)** — accepted refinements to the canonical mechanics (drop Luck → emotional modifier; Character/Soul split; organic relationship model; veto "Houseguest's Choice"). |
| `docs/features/` | **Priority-ordered feature specs** — each `NNNN-*.md` (design note) + `NNNN-*.feature` (executable Gherkin), built in order. |
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
  *suspect*, but cannot *know*). Hidden facts also **diffuse NPC-to-NPC along the social graph**
  (gossip), drifting with each retelling, so what reaches the player can be a distorted belief
  held with a source + confidence — diffusion runs in the hidden layer and only updates the
  player's knowledge when a pathway terminates at the player (ties to `docs/decisions/0002`).
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
  competition aptitudes, identity, backstory, baseline temperament) is **static `CHARACTER`**
  ("facts"); evolving state — current **emotional** state, accumulated memory, leanings, and
  **relationship beliefs** — is the **dynamic `SOUL`** (md + vector). Relationships are **not**
  binary ally/enemy flags: they are directed, graded, asymmetric, uncertain beliefs
  (trust/affinity/threat…) computed from event history, and any "ally / best-friend / enemy"
  label is **organic and emergent** — read through the holder's own character framing, never
  stored (`docs/decisions/0002`). The competition **emotional modifier** (a baseline that grows
  more or less volatile with circumstances + temperature) and the veto "Houseguest's Choice"
  both read the dynamic soul. See `docs/decisions/`.
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
| `npm test` | Full gate: `typecheck` → `test:unit` → `test:bdd`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test:unit` | Vitest — unit, property, and the dependency-cruiser boundary test. |
| `npm run test:bdd` | Cucumber.js over the **implemented** `.feature` files. |
| `npm run test:arch` | dependency-cruiser CLI (forbidden-edge report). |
| `npm run test:watch` | Vitest watch mode. |

- Single unit file: `npx vitest run tests/unit/visibility.test.ts`.
- Single BDD scenario: `NODE_OPTIONS='--import tsx' npx cucumber-js docs/features/0001-vault-wall-isolation.feature:LINE`.
- `cucumber.cjs` `paths` lists only the **implemented** features; add the next `.feature` there as each is built to green (priority order).

**Source layout:** `src/domain` (pure core, no I/O) · `src/ports` (interfaces — `VaultStore`
and `VectorIndex` are **engine-only**) · `src/services` (visible-state / summary — outward-safe)
· `src/surfaces` (`player/`, `admin/`, `tools/` — no Vault handle by construction) ·
`src/adapters` (`inmemory/`, `narrative/`, `random/`; SQLite/vector later) · `src/engine`
(off-screen simulation) · `src/composition` (`engineRoot` wires the Vault; `outwardRoot` never
does). BDD steps + support in `features/`; unit/property/architecture tests in `tests/`. The
`.feature` files in `docs/features/` remain the source of truth.

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

`npm test` runs clean: typecheck + unit/property/architecture + all BDD scenarios. Next in
priority order: **0005 — competition eligibility**.

## Open decisions (remaining)

**Resolved:** tech stack, datastore, and vector adoption (above); soul storage = markdown +
vector behind `SoulProvider`; non-degradation strategy = superset + monotonic-count + lossless
round-trip (`docs/features/0007-persistence-non-degradation.md`); drop Luck → emotional
modifier; Character/Soul split; organic relationship model; veto "Houseguest's Choice"
(`docs/decisions/`). **Still to confirm — none block current work:**

1. **Temperature & emotional-modifier constants** — distributions, per-variable weighting,
   bounds, hidden-element surfacing rate, volatility / mean-reversion. The *shape* is fixed in
   `docs/features/0006-…` and `docs/decisions/0001`; the numbers are tunable config.
2. **Relationship-model math** — signal set, update rule, recency/decay, betrayal-shock,
   thresholds (`docs/decisions/0002`, Proposed).
3. **Jury choreography & twists/specials** — sequester and tie-breaks are settled; precise
   jury-vote staging and any reserve twists remain (low priority; twists stay Vault-held).
4. **Embedding provider** — which model backs `EmbeddingProvider` at runtime (a deterministic
   fake covers seeded tests).

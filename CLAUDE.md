# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`orwell` is a rebuild of an immersive, single-player, text-based **_Big Brother_ simulation**
as a web application. The system is game master, narrator, and the voice of every NPC
houseguest. A prior version ran entirely inside one LLM chat context; this rebuild moves
game state into **external, permissioned stores** behind a **hexagonal architecture** so
that the deterministic rules, the secret state, and the narration are cleanly separated.

**Status: feature-complete through the drafted spec set (BDD/TDD-first; 2026-06-11).** Every
feature **0001–0050 is built and green except 0022 / MVP-2 (the one deferral)** — plus **0053**
(admin transcripts, FE-side) — covering: the eight
priority invariants, the MCP seam, the one-liner deploy, the gameplay loop, the MVP-1 batch —
including the **living, persisted consequence loop (0023)** (act → hidden impact → persist →
recall, wired into the live game) — the live-loop batch, the endgame batch (Final 5 → Final 2,
player eviction & the juror's seat, eviction night live), the post-audit batch (0038 live
society + gossip diffusion, 0039 deals, 0040 confessionals, **0041 character evolution — the
linchpin**, 0042 competition library, 0043 emergent blocs, 0044 strategic noms/votes), 0048
retrospective/unsealing, 0049 house presence & lingering, and 0050 the casting interview.
**Every batch in `docs/IMPLEMENTATION_QUEUE.md` is ✅ DONE** (each item carries its verifying
artifact) — through the B/C audit waves (B34–B73 / C12–C33), the round-4 UI & runtime audit
(D1–D11), the round-5/6 full-product-audit campaign (the E/P/W/S/T parallel lanes + the
prioritized UI track U1–U5), and the 2026-06-11 close-out lanes (cross-lane tails, the
T-remainder, 0053, E86a fastembed). The **campaign close-out ledger** in
`docs/audits/2026-06-10-full-product-audit.md` is **the authoritative open-items list going
forward**. *(2026-06-11, post-ledger: the **DWE windowing lane** — Lane F — shipped end to end:
the window audit (`docs/audits/2026-06-11-dwe-window-audit.md`), the `OrwellWindow` kit +
`.ow-*` family, the migration waves, and the F-3 anti-fragmentation ratchet; new FE windows
MUST compose the kit.)* The game is **folded into the main chat**: the player-facing tier is the vendored
**Orwell** front-end (`frontend/`, Python) talking to the TS engine over MCP (see
[Architecture](#architecture-hexagonal)). Priority-ordered feature specs live in
`docs/features/` (through **0053**; 0052 — the house themes — shipped FE-side from the audit
spec with no standalone file; 0051 in-character images shipped 2026-06-11, PR #235, and its
follow-on **portrait/headshot lane** — Lane G — extended it FE-side: cast-portrait generation &
backfill, the casting headshot studio + player-uploaded/AI account avatar, portrait variety, and
the game-build provider gating (OpenRouter image models via `/chat/completions`)). **New work starts as a new spec/queue
item** — the remaining known deferrals are listed under [Current status](#current-status); the
governing design rulings are `docs/audits/2026-06-09-product-audit.md` ("Remediation
principles"), the **product-owner rulings #1–#21** in `docs/audits/2026-06-10-full-product-audit.md`,
and ADR `docs/decisions/0003`.

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
| `docs/IMPLEMENTATION_QUEUE.md` | **Live work queue** — per-item implementation prompts (B/C/D/U/L-numbered lanes), dispatch order + dependencies, and the truest prose snapshot of what's done vs. remaining. |
| `docs/audits/` | **Audit record & rulings.** `2026-06-10-full-product-audit.md` carries the product-owner **rulings #1–#21** and the **campaign close-out ledger** (the authoritative open-items list); `2026-06-10-v1-transcript-meta-feedback-audit.md` reconstructs the v1 game from its logged transcripts (why the Bible's emphatic passages exist). The 2026-06-11 **house-audit pattern** (real FE + real engine driven headless under Playwright, DOC-ONLY) produced `2026-06-11-dwe-window-audit.md` (windowing), `2026-06-11-refresh-persistence-audit.md` (every transient UI state × reload), and `2026-06-11-settings-wiring-audit.md` (every settings control × {wired, persisted, applied}). |
| `docs/legacy/BB_GameBible.md` | **Legacy reference only.** The old chat-prompt implementation being replaced. Source of the *concrete* mechanics, but its fixed player persona / names are illustrative — never hard-code them. Same rule for the vendored v1 transcripts in `docs/legacy/meta-feedback/`. |

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

**The conversation is the game (`docs/decisions/0003`).** The beta proved the loop — a good LLM +
the Bible + secrets *is* the game. The engine exists only to fix the four degradations above
(leaks / sycophancy / memory-thinning / sameness) and otherwise **get out of the model's way**:
prefer removing context to adding it; hand the model *facts to voice*, never *scripts to recite*;
UI may **augment** the chat intelligently but never **replace** an interaction that builds or
progresses the game; **lingering is play** (the player can mill around any room, learn who's
present/adjacent, and talk to anyone — while those NPCs keep playing *their* game, and nothing
force-marches the week); **people must make sense** (one place at a time; speech scoped to what
each NPC legitimately knows; stable public persona); replayability is engine-seeded, and
long-term memory is the store *recalled*, never the chat *remembered*. Each of these is
**testable structurally** where possible (see the ADR's testability section). Don't "improve"
the game into a dashboard.

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
the **live** folds happen in the adapters: `EngineCommandsAdapter.recordInteraction` records the
event and folds its hidden impact, and `GameSessionAdapter` folds ceremony beats
(`foldCeremonyConsequence`) and soul evolution (`evolveFromBeat`); `src/engine/consequence.ts` is
the older 0023 module (off-screen-sim path). The orchestrator (`src/composition/orchestrator.ts`)
persists each turn with a fail-closed integrity checkpoint (0031). Hold the line that made it
work: **never ship an action that is narrated but never recorded** — it has no consequence and no
memory.

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
- **Eviction votes are secret ballots** (audit E12): the staged reveal reads anonymized ballots
  ("a vote to evict …"); per-voter attribution unseals **only** in the 0048 post-season
  retrospective. The player authors their **own goodbye messages** (a `goodbye-message` pending —
  tone is the player's choice; the engine never speaks for them, E34), and a player-juror asks
  their **own finale question** (E37).
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
- Don't hard-code a **fixed cast** (ruling #1, 2026-06-10): name corpora are raw material, but no
  full-name+persona pairing may be hard-coded, and the legacy Bible's names stay banned. (NPC names
  are seeded samples from the vendored real-name corpora — never a fixed list, never a paired identity.)
- Don't reference names in tests; don't ingest sample-save content as data.
- Don't rely on prompt wording for the Vault Wall — enforce it in code.
- Don't let the narrative layer decide or alter outcomes.
- Don't expose Vault contents to **anyone** at runtime, including admin/God Mode.
- Don't mislabel player-witnessed events as off-screen/secret.
- Don't let persisted detail degrade over time.

## Building & testing

Stack: **TypeScript / Node 22**, hexagonal, pure domain core. Test lanes: **Vitest**
(unit/property), **Cucumber.js** (the executable `.feature` specs), **fast-check** (used
selectively — most "property" suites are seeded fixed-loop distribution tests, which is
adequate for their claims; audit T18), and **dependency-cruiser** (the *structural* Vault-Wall
test — proves no outward module imports `VaultStore`/`VectorIndex`, type-only imports
included). Datastore is
**in-memory** today; **SQLite (`better-sqlite3`) → Postgres** and **sqlite-vec → pgvector**
(the latter engine-only) land behind their ports with the persistence/soul features.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (dev toolchain + the one runtime dep, `fastembed`, pinned exact). |
| `npm test` | Full gate: `typecheck` → `build` → unit/property/arch → BDD. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | Bundle the engine to `dist/main.js` + the embedding worker to `dist/embedWorker.js` (esbuild; `fastembed` stays external). |
| `npm start` | Run the built engine — the HTTP MCP server (a plain HTTP tool API; it does **not** yet speak MCP/JSON-RPC — that envelope is a known deferral). `ORWELL_ENGINE_PORT`, default 8765; `ORWELL_PORT` / `BBAI_*` are legacy fallbacks. |
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
- **Runtime env:** `ORWELL_DATA_DIR` is the per-user save dir (default `.orwell-data` — the factory-reset script must scrub it). **Pure turn-driven is the DEFAULT** (`ORWELL_WATCHER_TICK_MS=0` — ruling 2026-06-10: the game clock is the player's play-clock; the house lives between the player's own turns via one bounded off-screen tick per turn and does **not** exist while the player is away — NPCs can't leave the house, the player can, so background advances during an absence are a structural disadvantage). `ORWELL_WATCHER_TICK_MS` / `ORWELL_WATCHER_IDLE_MS` / `ORWELL_WATCHER_MAX_TICKS` opt in to the wall-clock watcher — never the default. HTTP edge: `ORWELL_ENGINE_HOST` (default loopback), `ORWELL_ENGINE_TOKEN` (shared secret on every tool route), `ORWELL_ENGINE_ADMIN_TOKEN` (a **separate** secret for `/admin/*` — player ⊉ admin, audit E27), `ORWELL_ENGINE_MULTIUSER` (reject a missing `x-orwell-user` instead of routing to "default"). Semantic recall: `ORWELL_EMBEDDINGS=fastembed` (the deploy default; unset ⇒ deterministic fake), `ORWELL_EMBED_CACHE` (model cache dir), `ORWELL_TEST_FASTEMBED=1` (opt-in real-model integration test — tests never depend on real embeddings otherwise).
- **Front-end tests:** `cd frontend && python3 -m pytest tests/` (its own pytest gate, quarantined — never touches `cucumber.cjs` / `npm test`); `frontend/scripts/boot_smoke.py` boots the real app and proves the game-build gating server-side; `frontend/scripts/browser_smoke.py` is the headless-browser keep-set gate; `frontend/scripts/responsive_matrix.py` is the viewport×surface matrix gate (Stream S, ruling #16 — overflow/overlap/tap-target checks with an XFAIL registry). The reduced game surface is controlled by `ORWELL_GAME_BUILD` (default **on**; `=0` restores the full inherited workspace).
- **Running locally (two processes):** the engine and front-end are **separate services**. Engine — `npm run build && npm start` (HTTP MCP on `ORWELL_ENGINE_PORT`, default 8765). Front-end — `cd frontend && python3 -m uvicorn app:app --host 127.0.0.1 --port 7000`, pointed at the engine via `ORWELL_ENGINE_MCP_URL` (default `http://127.0.0.1:8765`); it consumes **only** Vault-free projections (handshake in `frontend/INTEGRATION.md`). `deploy/smoke.sh` boots both and drives a full turn end-to-end (the same path CI's deploy-smoke job runs).
- **CI** (`.github/workflows/ci.yml`): four jobs — the full engine gate (`npm test`), the coverage gate (`npm run test:cov` against per-directory **branch thresholds** in `vitest.config.ts`: engine 90 / composition 88 / adapters-engine 82 — ratchet up only), the deploy smoke (`bash -n` every script + `deploy/smoke.sh`, which boots the real engine **and** front-end and drives a full turn), and the front-end job (py_compile → pytest → boot smoke → browser smoke → responsive matrix).
- **Deploy** (`deploy/`): the repo is **private** (ruling #17) — `orwell.sh` (run on the Proxmox host) creates the LXC, persists the one-time `GIT_TOKEN` PAT into `data/.env` with a git credential helper, and runs `orwell-install.sh` (apt + Node 22 + Python, pinned `requirements.lock.txt`, systemd units from `deploy/systemd/`, hardened per E85; UI ports <1024 get a `CAP_NET_BIND_SERVICE` drop-in; optional `CT_ROOT_PASSWORD` for console login). Maintenance scripts are host-aware (bridge into the LXC via `pct`), run from the **local checkout** (never a GitHub fetch of branch tips), and fall back to a legacy container named `bbai` (ruling #6): `orwell-update.sh` (also `--set-token` for PAT rotation) · `orwell-doctor.sh` (diagnose/bounce) · `orwell-backup.sh` / `orwell-restore.sh` · **two reset tiers** — `orwell-game-reset.sh` (new season: clears every engine sandbox, **preserves** accounts/sessions/LLM config/`data/.env`, ruling #2) vs `orwell-factory-reset.sh` (back to OOBE: also wipes the front-end store; preserves only `data/.env`) · `orwell-login-panel.sh` (the interactive-shell health panel, ruling #21 — never blocks a login) · `orwell-ready.sh` · `deploy/smoke.sh` + `smoke_turn.py` (post-deploy checks). Front-end (`frontend/`, Python/FastAPI) is its own quarantined app — see `frontend/INTEGRATION.md`.

**Source layout:** `src/domain` (pure core, no I/O) · `src/ports` (interfaces — `VaultStore`,
`VectorIndex`, `EmbeddingProvider`, `SoulProvider` are **engine-only**; outward ports include
`EngineCommands`, `GameSession`, `NarrativePort`/`StreamingNarrativePort`, `ImageGenerationPort`
(0051 — **outward by construction**: the engine emits only Vault-free portrait prompts, the FE owns
the concrete provider), `SaveStore`/`UserSaveStore`) · `src/services` (`VisibleStateService` / `SummaryService` — outward-safe) ·
`src/surfaces` (`player/`, `admin/`, `tools/` — no Vault handle by construction) · `src/adapters`
(`inmemory/`, `engine/` (the live `GameSessionAdapter` / `EngineCommandsAdapter`, `FileSaveStore`,
`SoulStore`), `mcp/` (`McpServer` / `HttpMcpServer`), `narrative/` (`LlmNarrativePort`,
`DeterministicNarrator`, `Echo…`), `embedding/` (`FastembedEmbedding` + its worker-thread bridge,
`DeterministicEmbedding` — the test adapter and runtime fallback), `image/`
(`NoopImageGenerationPort` — the null adapter used when no image-capable provider is wired; 0051),
`random/`, `time/`) ·
`src/engine` (the season loop `season.ts` + the live loop `liveSeason.ts`, plus `conversation.ts`,
`relationships.ts`, `consequence.ts` (the original 0023 hidden-impact fold module — the **live**
folds run in `GameSessionAdapter`/`EngineCommandsAdapter`), `gossip.ts`, `offscreen.ts`,
`confessionals.ts`, `deals.ts`, `blocs.ts`, `presence.ts`, `emotionalArc.ts`,
`competitionLibrary.ts`, `houseEvents.ts`, `castingIntake.ts`, `momentPrompts.ts`,
`portraitPrompts.ts` (the Vault-free, public-facets-only portrait-prompt builder) +
`imageConstants.ts` (0051 per-turn/-week generation budget caps), `data/` (the
vendored real-name corpora), and tunable constants) · `src/composition`
(`engineRoot` wires the Vault; `outwardRoot`/`appRoot` never do; `orchestrator.ts` is the
per-sandbox **commit/integrity spine** with a fail-closed checkpoint — game advances also flow
through the session's `advanceGame`/`submitDecision`, with the orchestrator as the commit hook —
driven by `gameWatcher.ts` over a `registry` of per-user sandboxes; `runtime.ts` composes +
starts the live watcher from `src/main.ts`). **There is ONE sanctioned season-restart door**
(audit D1/R1): `registry.resetUser` → `Orchestrator.forgetUser` + save-dir rotation — the
player channel's confirmed `createCharacter` restart delegates through that same hinge, a
refused commit throws typed (409, never 200-then-rollback), and `POST /api/orwell/new-game` is
admin-gated. Never add a second restart path. BDD steps + support in `features/`; unit/property/
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
  hard-coded name list; no cross-seed identity carryover; same-seed reproducible). Amended by
  E38/D8 (2026-06-10): NPC names are **seeded samples from the vendored real-name corpora**
  (`src/engine/data/`), and live `createCharacter` defaults to a **persisted entropy seed** —
  the same player name never replays the identical season; explicit seeds are for tests/replays.
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

**Live loop batch (0032–0037) — built:** **0034** (live weekly progression & decision seam),
**0035** (the off-screen watcher wired into the runtime — `SystemClock` + `composeRuntime`; since
the 2026-06-10 ruling it is **opt-in, not the default**: the house lives between the player's own
turns via per-turn ticks and does not exist while the player is away — BDD-gated via B70), and
**0037** (the interactive finale / jury-vote choreography: appeal scorer + staged statements →
per-juror questions → ordered vote reveal, through the 0034 seam) are BDD-gated in `cucumber.cjs`.
**0033** (`playerTagline`) and **0036** (`socialInitiatives` + `diaryRoom` live tools) shipped
**unit-gated** (a recorded deviation — see their spec headers; audit E87a). **0032** (front-end surface reduction / the game
build) is Python-only, tested in `frontend/tests/` with pytest — never added to `cucumber.cjs`;
**0029** (app administrator role & user management — the account tier, not God Mode) is likewise
front-end pytest-validated.
The 0037 **finale UI is built** (B26 — the Vault-free `finaleView` read tool on the `GameSession`
port / `PLAYER_TOOLS` — plus C11, the `frontend/static/js/orwellFinale.js` panel over an
`orwell_engine.finale_view` client; fail-open to `{ finale: null }`).

**Post-audit batch (0038–0044) — ✅ complete (2026-06-10).** **0041** character evolution & arc
— **the linchpin** — is green (`src/engine/emotionalArc.ts` + a live `SoulStore`): consequential
beats + the off-screen tick drive bounded, mean-reverting soul evolution that modulates the live
competition modifier (0006/0028) and a rattled-HOH read; the arc persists and is recall-able;
`CHARACTER` stays byte-stable; no number crosses to the player. **0038** live off-screen society
is fully green (varied scenes, live soul-deepening, B27b gossip→player diffusion with the
pathway-aware 0031 leak heuristic). **0039** (deals), **0040** (confessionals with live
soul-recall), **0042** (the competition library — curated defs + seeded no-repeat draws +
Vault-free narrative scaffolds on the result view), **0043** (emergent blocs — derived per read,
never stored, per ADR 0002), and **0044** (strategic nominations & enriched votes —
disposition-gated pawn/backdoor/direct tactics, political temperature, mood/bloc/deal-aware
votes, all magnitudes in `src/engine/decisionConstants.ts`) are green and BDD-gated.

**Endgame batch (0045–0047) — green** (Wave 2 of the product-audit queue; BDD-gated in
`cucumber.cjs`): **0045** endgame structure (the explicit Final 5 → Final 4 → Final 3 → Final 2
ladder replacing a generic late-game loop), **0046** player eviction & the juror's seat (the
player can genuinely lose — `GameStateView.player.status`; evicted pre-jury ⇒ terminal recap,
jury ⇒ the player serves as a juror under a defined **juror knowledge model**: jurors witness
ceremonies-as-broadcast only), and **0047** eviction night live (staged vote reveal + goodbye
messages). **0048** (season retrospective & the Vault unsealing — `seasonRecap` from the record
+ the one sanctioned, code-gated post-season Vault read, with its front-end panel) and **0049**
(house presence & lingering play — rooms/adjacency in the pure core, seeded occupancy, the
`whereabouts` lever, overheard-pathway eavesdropping, per ADR 0003) are **✅ green and
BDD-gated**. **0050 — the casting interview — is green** (BDD-gated): character creation is the
game's first scene, acquired **through the chat, no modal** — pre-game, the chat is a
producer-led "get to know the cast" interview (the `character-creation` moment prompt carries
the canonical casting-sheet manifest, drift-tested, plus the live casting status). The intake
is **incremental**: `updateCasting` records answers as they land into a durable pre-game intake
(half-done OOBE survives a restart and resumes), the **engine** computes what's captured /
missing / the next step, and `createCharacter` finalizes from it (persona, backstory,
motivation, private strategy, interview notes seed the Character/Soul datastore) returning a
**casting card** (character type, strategy, per-aptitude tier words — qualitative only, no
number crosses). **The product-audit, front-end & experience, and ops/security/test-integrity
waves (B34–B73 / C12–C33) all landed** — every queue item is marked ✅ with its verifying
artifact.

**Rounds 4–7 (2026-06-10/11) — the audit campaign — ✅ landed end to end.** The round-4 UI &
runtime audit (D1–D11), the round-5/6 full product audit (rulings #1–#21; E/P/W/S/T/C parallel
lanes), the prioritized UI track (U1–U5, rulings #15/#16), and the close-out lanes all shipped:
the **one sanctioned restart door** (D1/R1 — season 2 commits clean and survives an engine
restart; typed 409 refusals); knowledge-integrity hardening (pathway anchoring requires content
lineage; `resolveCompetition` removed from the player channel — `runCompetition` is the single
outcome authority; `recordInteraction` requires the player witnessed, folds budgeted);
**the social sim made consequential** (deals horizon-aware, every binding actor reconciled,
honoring pays via the new `reliability` evidence signal; gossip receipt folds move third-party
reads; per-role arc emotions; structured confessionals with live soul-recall); player agency
(secret ballots E12, player-authored goodbyes E34, the player-juror's own question E37, the
witnessed veto-chip draw E35); **real-name casts + entropy seeds** (E38/D8); **jury calibration**
(L9 — passive jury-reach ruled emergent realism; finale wins must be comp-earned; the permanent
gate is `tests/property/juryReach.property.test.ts`); the hardening sweep (default-deny
dependency-cruiser, two-tier HTTP auth, deeper live sentinel sweeps, fsync save durability);
ops (the single-PAT private-repo flow, E85 systemd hardening, the A12 login health panel); the
FE UI system (responsive tokens + the matrix gate, settings repair, sidebar chrome, the
played-record transcript surface, the five 0052 house themes, game-build trims); **E86a** the
real fastembed `EmbeddingProvider`; and **0053** admin transcripts (FE pytest lane). The
**campaign close-out ledger** at the end of `docs/audits/2026-06-10-full-product-audit.md` is
the authoritative open-items list going forward.

**Verifying current state.** Because the status prose drifts, trust the code over this section:
`cucumber.cjs` `paths` is the live list of BDD-gated features, and `git log --oneline` shows which
`NNNN` features last merged green. Run `npm test` for the authoritative pass/fail.

**Remaining work** (the queue is drained; new work starts as a new spec/queue item — and the
**close-out ledger** in `docs/audits/2026-06-10-full-product-audit.md` is the authoritative
open-items list): **0022** MVP-2 (the one deferred feature); 0010's container smoke on a real Proxmox host — which is also the
real-host verification the A4 single-PAT deploy design still needs (do it during the
private-repo flip); the deferred real relational adapters (SQLite/Postgres, sqlite-vec/pgvector
— souls/vectors run in-memory + file today); full MCP/JSON-RPC over the current HTTP transport;
the **playtest-gated calibration revisit** (passive players coast to Final 2 in ~half of seasons
and lose there — ruled emergent realism for now; the largest open game-feel question); the
post-campaign UI follow-ups **A5–A7** (per-theme particles backgrounds, the frosted-top fix, the
fly-out minimize/close animation); the low-priority sweep defects **A8–A10** (`humanize` mangles
the word "player(s)" in beat prose; expected-empty-tick integrity-fault log noise; the
Houseguest's-Choice pending presents `options` but expects the pick on `vote`); and the R3
partial (late-season latency still grows with the O(events) snapshot export — improved, not
eliminated; an incremental-snapshot item if play feels it). *(The ADR 0004 fastembed adapter is
now BUILT — E86a, 2026-06-11.)* *(By design, not a gap: the live engine-side narrator is
`EchoNarrativePort` — narration happens in the front-end via `getMomentPrompt`; the
`playerTagline` `setNarrator` seam is ready if engine-side narration is ever wired.)*

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
4. ✅ **Embedding provider** — **decided AND built** (ADR `docs/decisions/0004`; E86a,
   2026-06-11): **fastembed, local ONNX** (the JS port + model both version-pinned) is the
   runtime `EmbeddingProvider` — warmed up at boot (`ORWELL_EMBEDDINGS=fastembed`, the deploy
   default), served synchronously through a worker-thread bridge, with the deterministic fake
   as both the test adapter and the whole-process fallback when the model is unavailable.
   *(No genuinely-open decisions remain.)*

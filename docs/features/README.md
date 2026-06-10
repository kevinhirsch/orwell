# Feature specs

Drafted, stack-agnostic feature definitions for the `orwell` build. Each feature is authored
here **before** implementation and handed to an implementer (a separate Claude Code
instance). The author drafts; the implementer builds to green and refactors.

## Convention

Each feature is two files, numbered by **build priority** (lower = built first):

| File | Role |
|---|---|
| `NNNN-<slug>.md` | **Design note** — context, scope, the port/tool contracts involved, test strategy, acceptance criteria, and an implementer handoff with open questions. |
| `NNNN-<slug>.feature` | **Executable spec** — Gherkin scenarios. Failing-first; the implementer makes them pass. |

## Rules these specs must hold to

- **BDD/TDD-first.** The `.feature` file is written to fail, then implemented to green
  (`docs/CLAUDE_CODE_INSTRUCTIONS.md` §9, `docs/bb-sim-spec.md` §12).
- **Roles only, never names.** No houseguest or player names appear in scenarios — only
  roles (player, admin, NPC, HOH, nominee, evictee, veto winner). Fixtures are **generated**;
  sample-save content is format-only and is never used as seed/test data.
- **Definition of done** (per `CLAUDE_CODE_INSTRUCTIONS.md` §11): a passing name-agnostic
  feature test; Vault isolation verified on the relevant player **and** admin surfaces;
  domain logic unit-tested with a **seeded** randomness source; no Vault read reachable from
  any player- or admin-facing adapter/tool.

## Build priority order

From `docs/CLAUDE_CODE_INSTRUCTIONS.md` §9. Draft and build in this order:

1. **Vault isolation (incl. God Mode)** — `0001-vault-wall-isolation`
2. Event visibility & propagation
3. Behavioral fidelity
4. Replayability / naming
5. Competition eligibility
6. Outcomes by stats + temperature
7. Persistence non-degradation
8. Daily-event invariant

## Status legend

`Draft` (authored, awaiting implementation) · `Ready` (accepted for build) ·
`In progress` · `Done` (feature green on player **and** admin surfaces).

## Index

| # | Feature | Priority | Status |
|---|---|---|---|
| 0001 | [Vault Wall isolation](./0001-vault-wall-isolation.md) | 1 | Done |
| 0002 | [Event visibility & propagation](./0002-event-visibility-and-propagation.md) | 2 | Done |
| 0003 | [Behavioral fidelity](./0003-behavioral-fidelity.md) | 3 | Done |
| 0004 | [Replayability & naming](./0004-replayability-and-naming.md) | 4 | Done · **amended** |
| 0005 | [Competition eligibility](./0005-competition-eligibility.md) | 5 | Done |
| 0006 | [Outcomes by stats + temperature](./0006-outcomes-by-stats-and-temperature.md) | 6 | Done |
| 0007 | [Persistence non-degradation](./0007-persistence-non-degradation.md) | 7 | Done |
| 0008 | [Daily-event invariant](./0008-daily-event-invariant.md) | 8 | Done |
| 0009 | [MCP tool boundary](./0009-mcp-tool-boundary.md) | M5 | Done |
| 0010 | [One-liner deployment & update](./0010-deployment-one-liner.md) | MVP-1 | Done |
| 0011 | [Weekly loop orchestration](./0011-weekly-loop-orchestration.md) | Gameplay | Done |
| 0012 | [Conversation & scene system](./0012-conversation-and-scene-system.md) | Gameplay | Done |
| 0013 | [The Diary Room](./0013-diary-room.md) | Gameplay | Done |
| 0014 | [Jury & endgame](./0014-jury-and-endgame.md) | Gameplay | Done |
| 0015 | [Character creation (OOBE)](./0015-character-creation-oobe.md) | Gameplay | Done |
| 0016 | [God Mode (admin port)](./0016-god-mode-admin.md) | Foundational | Done |
| 0017 | [Relationship model](./0017-relationship-model.md) | Foundational | Done |
| 0018 | [Narrative & moment orchestration](./0018-narrative-moment-orchestration.md) | Gameplay | Done |
| 0019 | [Agent-driven play loop](./0019-agent-driven-play-loop.md) | Gameplay | Done |
| 0020 | [Player experience (status panel, decisions, portraits)](./0020-player-experience.md) | Player UX | Done |
| 0021 | [Game session & save lifecycle (per-user sandboxes)](./0021-game-session-and-save-lifecycle.md) | Foundational | Done |
| 0022 | [Player experience MVP-2 (rich game UI)](./0022-player-experience-mvp2.md) | Player UX | **Deferred** |
| 0023 | [Consequence & memory (living, persisted loop)](./0023-consequence-and-memory.md) | **MVP-1 backbone** | Done |
| 0024 | [Soul storage & memory recall (md + vector)](./0024-soul-storage-and-memory-recall.md) | Foundational | Done |
| 0025 | [Reserve twists (Vault-sealed, engine-timed)](./0025-reserve-twists.md) | Gameplay | Done |
| 0026 | [Relationship math (firmed update rule & constants)](./0026-relationship-math.md) | Foundational | Done |
| 0027 | [NarrativePort LLM adapter (the real narrator)](./0027-narrative-port-llm-adapter.md) | Integration | Done |
| 0028 | [Temperature & emotional-modifier constants](./0028-temperature-and-emotional-constants.md) | Foundational | Done |
| 0029 | [App administrator role & user management](./0029-app-admin-and-user-management.md) | App / accounts | Done |
| 0030 | [Durable game persistence (survive engine restart)](./0030-durable-game-persistence-survive-restart.md) | **MVP-1 / bugfix** | Done |
| 0031 | [Game orchestrator & integrity watcher (per-sandbox)](./0031-game-orchestrator-and-integrity-watcher.md) | Foundational | Done |
| 0032 | [Front-end surface reduction (the "game build")](./0032-frontend-surface-reduction-game-build.md) | App / front-end | Done |
| 0033 | [Dynamic player tagline (snarky, state-aware hero line)](./0033-dynamic-player-tagline.md) | Player UX | Done |
| 0034 | [Live weekly progression & binding-decision seam](./0034-live-weekly-progression-and-decision-seam.md) | Gameplay (as-built) | Done |
| 0035 | [Live off-screen life (start the watcher in the runtime)](./0035-live-offscreen-life-running-watcher.md) | **Functional — behavioral fidelity** | Done |
| 0036 | [Live social surface: NPC approaches + the Diary Room](./0036-live-social-surface-approaches-and-diary-room.md) | **Functional — playability** | Done |
| 0037 | [Live jury-vote choreography (the interactive finale)](./0037-live-jury-vote-choreography.md) | Gameplay | **Done** — engine + finale UI (B26 `finaleView` read · C11 `orwellFinale.js`) |
| 0038 | [Live off-screen society (wire the real sim into the watcher)](./0038-live-offscreen-society.md) | **Behavioral fidelity** | Varied society + live soul-deepening (via 0041) · *gossip→player (B27b) pending* |
| 0039 | [Promise & deal tracking (first-class deals)](./0039-promise-and-deal-tracking.md) | Gameplay / anti-sycophancy | Done |
| 0040 | [NPC Diary Room confessionals (Vault-only interiority)](./0040-npc-confessionals.md) | Behavioral fidelity | Done · soul-recall feedback live (0041) |
| 0041 | [Character evolution & season arc](./0041-character-evolution-and-arc.md) | Foundational | **Done — linchpin: SoulStore live; souls evolve + modulate behavior + recall** |
| 0042 | [Competition library (variety + narrative formats)](./0042-competition-library.md) | Gameplay | **Ready (DoR §8)** |
| 0043 | [Emergent multi-party bloc behavior](./0043-emergent-bloc-behavior.md) | Foundational | **Ready (DoR §8)** |
| 0044 | [Strategic nomination & vote refinements](./0044-strategic-nomination-and-vote-refinements.md) | Gameplay / anti-sycophancy | **Ready (DoR §8)** |
| 0045 | [Endgame structure (Final 5 → Final 2)](./0045-endgame-structure.md) | Gameplay / correctness | **Done** — veto field degrades · F4 sole vote · F3 final-HOH eviction |
| 0046 | [Player eviction & the juror's seat](./0046-player-eviction-and-jury.md) | Gameplay / player UX | **Done** — player.status active/jury/evicted · ceremonies-as-broadcast juror knowledge · B48 |
| 0047 | [Eviction night live (reveal + goodbyes)](./0047-eviction-night-live.md) | Gameplay | **Done** — staged one-at-a-time vote reveal · goodbye→manner · Vault-free EvictionView · B49 |
| 0048 | [Season retrospective & the Vault unsealing](./0048-season-retrospective-and-unsealing.md) | Lifecycle / payoff | **Ready (DoR §8)** · B56 |
| 0049 | [House presence & lingering play (rooms, occupancy, overhearing)](./0049-house-presence-and-lingering.md) | **Behavioral fidelity / ADR 0003** | **Ready (DoR §8)** · B64 |
| 0050 | [The casting interview (producer-led character creation)](./0050-casting-interview.md) | Player UX / ADR 0003 | **Done** — interview-in-chat · casting card (qualitative) · Soul-memory seeding |

Each row is shipped as its own auto-merged PR. 0001–0008 are the priority invariants; 0009 is
the M5 integration seam (the engine's outward tool API for the front-end / agent), 0010 is the
MVP-1 one-liner deploy/update, and 0011+ are the gameplay loop & player experience. 0015 is the
single human-authored profile (the player); 0016 is the second walled surface (God Mode, walled
from the Vault even for the admin); 0017 promotes [decision 0002](../decisions/0002-relationship-model.md)
(the organic relationship model) into an executable spec. 0018–0019 make **Orwell *is* the game**
playable in the main chat: 0018 is the engine-owned per-moment narrator framing (the model speaks
as the house, never a generic assistant); 0019 is the agent turn-loop that drives play by calling
engine tools while the engine decides every outcome. 0021 makes it **multi-tenant**: one active
game per physical-world user, a sandbox per user, unlimited concurrent games across users — adding
**cross-user isolation** as a new guarantee alongside the Vault Wall.

## Amendments to shipped specs (implementer: pick these up)

Changes made to **already-built** features after they shipped. They are small, additive, and keep
every existing guarantee — but the implementer must fold them into the built code.

| Spec | Amendment | Why |
|---|---|---|
| **0004** (Done) | `CharacterFactory` also generates **public appearance/identity** fields (appearance, age, presentation/style) into the static `Character` (`character.md`); seed-stable, no aptitude/hidden data. See [0004 §8](./0004-replayability-and-naming.md#8-amendment--public-appearance-fields-for-0020-portraits). | Feeds the **Vault-free portrait descriptor** so houseguests look like who they are ([0020](./0020-player-experience.md) §5). |
| **0023** (Done) | The **persist → recall** half is **not durable** in the live game — `GameSessionAdapter`/`GameSessionRegistry` keep state in memory and the only `SaveStore` is in-memory, so an engine restart wipes every game. [0030](./0030-durable-game-persistence-survive-restart.md) wires a **disk-backed** `SaveStore` + load-on-resume/save-on-mutation into the live registry. | A started game must survive a restart; otherwise the onboarding overlay re-fires every load (user-reported). |
| **0032** (Done) | **`web_search` moves from the drop-set to the keep-set** (ruling 2026-06-09): the router mounts under the game build, the agent tool surface includes it, and the Settings `search` tab stays as **admin-only global config**. The agent uses it **in-fiction** — real-world references are looked up silently and synthesized in the houseguest's voice; search informs flavor/real-world knowledge **only**, never a game fact or outcome (engine tools remain the sole game truth). Implementation prompt: queue **C32**. | The model must handle real-world references the player makes mid-conversation (e.g. a new movie) without breaking character — critical to "the conversation is the game" (ADR 0003). |

New cross-cutting expectations introduced by drafts (not yet built, listed so the implementer
plans for them): **0020** adds `gameStatus` (a Vault-free public-state projection for the status
panel) and `portraitDescriptorFor` (a Vault-free descriptor over 0004's public appearance facets);
**0018/0019** formalize `getMomentPrompt` + the `pendingDecision`/`executeDecision` decision seam
(the engine surfaces the legal option set; binding choices execute only through validation).

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

The **[index](#index)** below is the single source of truth for per-feature status — the prose in
`CLAUDE.md` and the audit ledgers can drift, so the index is reconciled against the actual code.

| Token | Meaning |
|---|---|
| ✅ **Built** | Shipped and gated (see the **Gate** column). |
| 🚧 **Built · follow-on owed** | Shipped, with one named remaining item (host smoke, browser render, an FE chunk…). |
| 📝 **Spec only** | Authored, not yet built. |
| ⏸ **Deferred** | Intentionally not built. |

**Gate** — how the feature is verified: `BDD` (Cucumber, listed in `cucumber.cjs`) · `unit` (Vitest) ·
`FE` (front-end pytest) · `engine` (Vitest, no `.feature`) · `scripts` (deploy) · `—` (none yet).

> **Audit (2026-06-20).** Every feature **0001–0063** was cross-checked against its source artifact
> (not its prose). **No orphaned or untracked unbuilt specs.** Not-built specs: **0022**
> (⏸ deferred). **0064** (live multi-device game sync) shipped its **stopgap** (the canonical game
> session — every device on one chat) 2026-06-20; the Messenger-style sync + window/HUD layout sync
> are the owed follow-on. **0062** (the move-in zeitgeist snapshot) **shipped 2026-06-20** —
> BDD-gated, frozen +
> seed-reproducible + flavor-only (outcome-invariant). Tracked here and in the authoritative
> [open-items ledger](../audits/2026-06-10-full-product-audit.md).

## Index

| # | Feature | Gate | Status |
|---|---|---|---|
| 0001 | [Vault Wall isolation](./0001-vault-wall-isolation.md) | BDD | ✅ Built |
| 0002 | [Event visibility & propagation](./0002-event-visibility-and-propagation.md) | BDD | ✅ Built |
| 0003 | [Behavioral fidelity](./0003-behavioral-fidelity.md) | BDD | ✅ Built |
| 0004 | [Replayability & naming](./0004-replayability-and-naming.md) | BDD | ✅ Built · amended (E38/D8: real-name corpora + entropy seed) |
| 0005 | [Competition eligibility](./0005-competition-eligibility.md) | BDD | ✅ Built |
| 0006 | [Outcomes by stats + temperature](./0006-outcomes-by-stats-and-temperature.md) | BDD | ✅ Built |
| 0007 | [Persistence non-degradation](./0007-persistence-non-degradation.md) | BDD | ✅ Built |
| 0008 | [Daily-event invariant](./0008-daily-event-invariant.md) | BDD | ✅ Built |
| 0009 | [MCP tool boundary](./0009-mcp-tool-boundary.md) | BDD | ✅ Built |
| 0010 | [One-liner deployment & update](./0010-deployment-one-liner.md) | scripts | 🚧 Built · real-Proxmox-host smoke owed |
| 0011 | [Weekly loop orchestration](./0011-weekly-loop-orchestration.md) | BDD | ✅ Built |
| 0012 | [Conversation & scene system](./0012-conversation-and-scene-system.md) | BDD | ✅ Built |
| 0013 | [The Diary Room](./0013-diary-room.md) | BDD | ✅ Built |
| 0014 | [Jury & endgame](./0014-jury-and-endgame.md) | BDD | ✅ Built |
| 0015 | [Character creation (OOBE)](./0015-character-creation-oobe.md) | BDD | ✅ Built |
| 0016 | [God Mode (admin port)](./0016-god-mode-admin.md) | BDD | ✅ Built |
| 0017 | [Relationship model](./0017-relationship-model.md) | BDD | ✅ Built |
| 0018 | [Narrative & moment orchestration](./0018-narrative-moment-orchestration.md) | BDD | ✅ Built |
| 0019 | [Agent-driven play loop](./0019-agent-driven-play-loop.md) | BDD | ✅ Built |
| 0020 | [Player experience (status, decisions, portraits)](./0020-player-experience.md) | BDD | ✅ Built |
| 0021 | [Game session & save lifecycle (per-user sandboxes)](./0021-game-session-and-save-lifecycle.md) | BDD | ✅ Built |
| 0022 | [Player experience MVP-2 (rich game UI)](./0022-player-experience-mvp2.md) | — | ⏸ Deferred |
| 0023 | [Consequence & memory (the MVP-1 backbone)](./0023-consequence-and-memory.md) | BDD | ✅ Built |
| 0024 | [Soul storage & memory recall (md + vector)](./0024-soul-storage-and-memory-recall.md) | BDD | ✅ Built |
| 0025 | [Reserve twists (Vault-sealed, engine-timed)](./0025-reserve-twists.md) | BDD | ✅ Built · amended B53 (fires live) |
| 0026 | [Relationship math](./0026-relationship-math.md) | BDD | ✅ Built |
| 0027 | [NarrativePort LLM adapter](./0027-narrative-port-llm-adapter.md) | BDD | ✅ Built |
| 0028 | [Temperature & emotional-modifier constants](./0028-temperature-and-emotional-constants.md) | BDD | ✅ Built |
| 0029 | [App administrator role & user management](./0029-app-admin-and-user-management.md) | FE | ✅ Built |
| 0030 | [Durable game persistence (survive restart)](./0030-durable-game-persistence-survive-restart.md) | BDD | ✅ Built |
| 0031 | [Game orchestrator & integrity watcher](./0031-game-orchestrator-and-integrity-watcher.md) | BDD | ✅ Built |
| 0032 | [Front-end surface reduction (the "game build")](./0032-frontend-surface-reduction-game-build.md) | FE | ✅ Built |
| 0033 | [Dynamic player tagline](./0033-dynamic-player-tagline.md) | unit | ✅ Built · recorded deviation E87a |
| 0034 | [Live weekly progression & decision seam](./0034-live-weekly-progression-and-decision-seam.md) | BDD | ✅ Built |
| 0035 | [Live off-screen life (running watcher)](./0035-live-offscreen-life-running-watcher.md) | BDD | ✅ Built |
| 0036 | [Live social surface (approaches + Diary Room)](./0036-live-social-surface-approaches-and-diary-room.md) | unit | ✅ Built · recorded deviation E87a |
| 0037 | [Live jury-vote choreography (the finale)](./0037-live-jury-vote-choreography.md) | BDD | ✅ Built · + finale UI |
| 0038 | [Live off-screen society](./0038-live-offscreen-society.md) | BDD | ✅ Built |
| 0039 | [Promise & deal tracking](./0039-promise-and-deal-tracking.md) | BDD | ✅ Built |
| 0040 | [NPC confessionals](./0040-npc-confessionals.md) | BDD | ✅ Built |
| 0041 | [Character evolution & arc (the linchpin)](./0041-character-evolution-and-arc.md) | BDD | ✅ Built |
| 0042 | [Competition library](./0042-competition-library.md) | BDD | ✅ Built |
| 0043 | [Emergent bloc behavior](./0043-emergent-bloc-behavior.md) | BDD | ✅ Built |
| 0044 | [Strategic nomination & vote refinements](./0044-strategic-nomination-and-vote-refinements.md) | BDD | ✅ Built |
| 0045 | [Endgame structure (Final 5 → Final 2)](./0045-endgame-structure.md) | BDD | ✅ Built |
| 0046 | [Player eviction & the juror's seat](./0046-player-eviction-and-jury.md) | BDD | ✅ Built |
| 0047 | [Eviction night live (reveal + goodbyes)](./0047-eviction-night-live.md) | BDD | ✅ Built |
| 0048 | [Season retrospective & the Vault unsealing](./0048-season-retrospective-and-unsealing.md) | BDD | ✅ Built |
| 0049 | [House presence & lingering play](./0049-house-presence-and-lingering.md) | BDD | ✅ Built |
| 0050 | [The casting interview](./0050-casting-interview.md) | BDD | ✅ Built |
| 0051 | [In-character images](./0051-in-character-images.md) | unit + FE | ✅ Built · browser-smoke render landed (`browser_smoke.py:1166` asserts a real sized portrait `<img>` + zero placeholders) |
| 0052 | House themes (five seasons) | FE | ✅ Built · shipped FE-side, no standalone spec file |
| 0053 | [Admin transcript retrieval](./0053-admin-transcripts.md) | FE | ✅ Built |
| 0054 | [Control-room gadget rail](./0054-gadget-rail.md) | FE | ✅ Built · Phase 1 (HUD rail) + Phase 2 (dock windows) |
| 0055 | [Social play moves the weights](./0055-social-play-weights.md) | FE | ✅ Built · the `_auto_record_scene` guarantee |
| 0056 | [Season-to-season character continuity](./0056-season-character-continuity.md) | unit + FE | ✅ Built |
| 0057 | [Seasons as levels](./0057-seasons-as-levels.md) | FE | ✅ Built · live browser validation landed (`browser_smoke.py:1197` validates the season-progress bar + "Season N" chip + new-season window) |
| 0058 | [Deep character profiles](./0058-deep-character-profiles.md) | BDD | ✅ Built · Phase 1 + Phase 2 |
| 0059 | [Hidden seeded relationships](./0059-hidden-seeded-relationships.md) | engine | ✅ Built · orientation-aware via 0063 |
| 0060 | [Story-thread scheduler (0058 Phase 2)](./0060-story-thread-scheduler.md) | BDD | ✅ Built |
| 0061 | [Player self-eviction](./0061-player-self-eviction.md) | BDD | ✅ Built |
| 0062 | [Move-in zeitgeist snapshot](./0062-world-snapshot-zeitgeist.md) | BDD + FE | ✅ Built · `src/engine/zeitgeist.ts` (frozen + seed-reproducible + flavor-only) **+ the FE `web_search` capture lane** (`frontend/src/orwell_zeitgeist.py`) writing the real move-in zeitgeist back via `recordWorldSnapshot` |
| 0063 | [Casting diversity floor](./0063-casting-diversity-floor.md) | BDD | ✅ Built |
| 0064 | [Live multi-device game sync](./0064-live-multi-device-game-sync.md) | FE | ✅ Built · canonical session (A) + Messenger serialization (C) + window/HUD layout sync (F) + `game-updated`/cast-photo/once-only (B/D) |
| 0065 | [Cast pre-warm: deep-author before portraits](./0065-cast-prewarm.md) | BDD + FE | ✅ Built · wired the `recordCastProfile` write-back onto the player channel (was rejected at the MCP boundary) + `preSeedCast` pre-game cast + `createCharacter` adoption + FE author-warm-early / portrait-warm-gated |
| 0066 | [In-game time of day & the nightly sleep economy](./0066-in-game-time-and-sleep.md) | unit + integration | ✅ Built (ADR 0006) · the five-phase clock + character-driven bedtimes + the diegetic bound + the player's `turnIn` bedtime lever + a hidden bounded sleep→comp penalty + the HUD clock/rest cue. **Opt-in** (`ORWELL_TIME_OF_DAY`, default off) so the seeded calibration spine is byte-identical. Gate: `tests/unit/timeOfDay*.test.ts` + `sleepCompetition.test.ts` (recorded deviation, like 0033/0036/0055) |
| 0067 | [Public internet exposure & internet-grade hardening (hiorwell.com)](./0067-public-internet-exposure.md) | FE + scripts | 🚧 Built · follow-on owed (host smoke) (ADR 0007) · the hardening floor — FE `ORWELL_BIND_HOST` loopback default + `--proxy-headers`, the fail-closed public-profile boot guard, `TrustedHostMiddleware`, the real-client-IP login-throttle fix behind the tunnel — + a `deploy/expose/` kit (**Cloudflare Tunnel + Access** chosen; Pangolin / Caddy documented) + the INSTALL public-deployment runbook. Engine **unchanged**; Vault Wall + 0021 isolation untouched. Gate: `frontend/tests/test_public_profile_guard.py` · `test_trusted_host.py` · `test_login_throttle.py` · `test_public_deploy_config.py`. Owed: real-host smoke (folds into 0010) |
| 0068 | [Admin "Public deployment / Connect to the internet" (UI-driven exposure)](./0068-admin-public-deployment.md) | FE + scripts | 🚧 Built · follow-on owed (host smoke) (ADR 0007; drives 0067) · an admin Settings→System panel + a token-paste **Connect** wizard using a Cloudflare **remotely-managed** tunnel, applied through the existing privileged **ops** mechanism (flag→root oneshot→`orwell-ops-public-deployment.sh`: `.env` upsert + cloudflared install/run + FE restart + token shred) with live tunnel/URL status. Routes/UI/deploy built; request-time fail-closed validation reuses `assert_public_profile_safe`; token write-only. Gate: `test_public_deployment_{routes,ui,ops}.py`. Engine **unchanged**; Cloudflare-account steps stay dashboard-side. Owed: real-host smoke (folds into 0010) |
| 0069 | [Token economy: metered LLM boundary, reasoning budget & non-degrading context tiering](./0069-token-economy-and-context-budget.md) | FE | ✅ Built (ADR 0010) · A: meter the one LLM boundary (full usage envelope incl. cached/reasoning/cost + context-%, Vault-free, admin-only `/api/admin/token-economy` + soft spend-alert) · B: token **policy per call class**, `reasoning` budget now SENT provider-aware (admin-editable `reasoning_budget`) · C: per-session stickiness + opt-in high-token provider-pin · D: opt-in non-degrading context tiering (escalate before lossy compaction). FE/adapter-only; engine/closed set untouched; player never sees a number. Gate: `frontend/tests/test_adr0010_*.py`, full FE suite green |


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
| **0004** (Done) | **(satisfied — implemented)** `CharacterFactory` also generates **public appearance/identity** fields (appearance, age, presentation/style) into the static `Character` (`character.md`); seed-stable, no aptitude/hidden data. Built in `src/engine/characterFactory.ts` (`generateAppearance`). See [0004 §8](./0004-replayability-and-naming.md#8-amendment--public-appearance-fields-for-0020-portraits). | Feeds the **Vault-free portrait descriptor** so houseguests look like who they are ([0020](./0020-player-experience.md) §5). |
| **0023** (Done) | **(satisfied — implemented by 0030)** The **persist → recall** half was **not durable** in the live game — state was memory-only, so an engine restart wiped every game. [0030](./0030-durable-game-persistence-survive-restart.md) (Done) wired the **disk-backed** `FileSaveStore` + load-on-resume/save-on-mutation into the live registry. | A started game must survive a restart; otherwise the onboarding overlay re-fires every load (user-reported). |
| **0018** (Done) | **B61 cast voices**: the woven game context now carries each ACTIVE houseguest's **curated public persona facets** (archetype, strategy style, background, age, appearance, presentation) as the narrator's per-person voice anchor, and `HouseguestCard` projects the same facets (+ a `jury` seat distinct from pre-jury `evicted`). The 0018 scenario wording drops "archetypes" from the banned list — stats, souls, and `hiddenElements` remain walled (the B42 live sentinel sweep now tags `hiddenElements`, not `background`, as the hidden string field). | The narrator was voicing 15 houseguests from a name + status word — structurally voiceless NPCs (experience audit N1/N2); the facets were already Vault-free for portraits (0004/0020). |
| **0025** (Done) | **B53 live firing**: the sealed reserve twists now fire in the LIVE game — `createCharacter` loads + seals the schedule (loop state + a Vault `reserved-twist` audit copy, both persisted: the snapshot now carries the Vault, audit I7), and a sealed **double eviction** runs the same night as a compressed second cycle (HOH → noms → veto → vote, the 0005 hard rules verbatim; same week number, two eviction ceremonies, both count for jury order; the outgoing HOH cannot take the second crown). New `twist-reveal` beat + moment prompt; three live scenarios appended to the .feature. | The twists were computed but never fired live (audit D6 + B8) — the pure module was proven, the game never used it. |
| **0009** (Done) | **Audit E20/E21 (2026-06-10)**: the caller-supplied-stats `resolveCompetition` tool is **removed from the player channel** (registry + dispatch + the `EngineCommands` port) — `runCompetition` over the LIVE house is the single outcome authority (B37); the pure domain `resolveCompetition` stays for tests/engine. `recordInteraction` now **requires the player in the witness set** (the player initiating counts; their seat is made explicit) and budgets hidden folds **per beat per directed edge** on top of the per-call cap. The `.feature` scenarios are amended accordingly (absence + refusal; the end-to-end loop expects the refusal). | E20: a seed-shoppable second resolver — caller stats + caller seed, nothing recorded, no folds — sat one call away on the player channel. E21: a witness set excluding the player minted off-screen "ground truth", and identical repeated calls could pump a hidden edge without bound. |
| **0004** (Done) | **(satisfied — implemented, PR #217)** **E38 / product ruling #1 (2026-06-10):** NPC names are **seeded samples from vendored real-name corpora** (`src/engine/data/givenNames.ts` + `surnames.ts`), replacing phoneme synthesis. The do-not is amended to "**no fixed cast**": corpora are raw material; no full-name+persona pairing is hard-coded (BDD-proven); the legacy Bible's names stay banned (excluded from the corpora); cross-seed carryover is measured on **identity**, not bare first names; the inverse realism gate (every part corpus-membered) is in the BDD. | The generated names read as gibberish on the game's first screen — the product ruling requires names "determined based on what could be a real name." |
| **0047** (Done) | **(satisfied — implemented, PR #217)** **E12+T2:** eviction votes are **secret ballots** — the staged reveal reads anonymized ballots ("a vote to evict …"), `EvictionView` drops voter attribution, and the per-week ballots unseal only in the 0048 retrospective (`RetrospectiveView.evictionVotes`). **E34:** a surviving player records their **own goodbye message** via a new `goodbye-message` pending (tone = the player's choice, folded via `goodbyeMannerFor` exactly as NPC tones; the engine never authors a player goodbye). Two scenarios appended. | Real-BB ballot secrecy (rogue votes, paranoia) was impossible, and the engine spoke for the player on jury management's signature lever. |
| **0037** (Done) | **(satisfied — implemented, PR #217)** **E37:** the player-JUROR asks their own finale question via a new scoreless `juror-question` pending (free text; the finalist's answer remains engine-chosen). Scenario appended. **E35 (with 0005/0042):** the veto chip draw is now a witnessed `veto-draw` beat preceding any winner, and ANY player in the drawn field — chip-drawn included — declares the canonical comp intent; **E36:** the Final-4 veto pending carries the honest (possibly empty) legal save set and refuses a save it cannot honor. | The juror's seat auto-answered the player's own question; the chip draw was invisible; the F4 "use" choice was accepted then silently inverted. |
| **0032** (Done) | **`web_search` moves from the drop-set to the keep-set** (ruling 2026-06-09): the router mounts under the game build, the agent tool surface includes it, and the Settings `search` tab stays as **admin-only global config**. The agent uses it **in-fiction** — real-world references are looked up silently and synthesized in the houseguest's voice; search informs flavor/real-world knowledge **only**, never a game fact or outcome (engine tools remain the sole game truth). Implementation prompt: queue **C32**. | The model must handle real-world references the player makes mid-conversation (e.g. a new movie) without breaking character — critical to "the conversation is the game" (ADR 0003). |
| **0039** (Done) | **(satisfied — implemented, audit E42/E43/E46/T1)** Deals are **horizon-aware**: `safety`/`vote` bind through *their week's* eviction (the vote endpoint or `expireWeekScoped` at the rollover); `final-two`/`target-other` bind until broken. **Honoring pays**: each honoring binding action applies the bounded `DEAL_IMPACTS.honored` fold (trust/alignment + the E54 `reliability` evidence signal); `BindingAction.alternatives` scopes honor to actions where the partner was a real option. **Every binding actor reconciles** — NPC eviction votes, HOH tie-breaks, and the Final-3 eviction flow through `bindingActionsFor` in the live commit path, not only the player's actions. **NPC↔NPC deals exist**: the tightest unbound NPC pair occasionally seals a Vault-held pact at nominations (`DECISION.npcDeal`), binding through the same ledger. Live gate: `tests/integration/liveDealReconciliation.test.ts`. | The audit found deals self-extinguishing after one ceremony, honoring building no trust, NPC votes never reconciled, and `npcOnly()` dead — three shipped systems were flavor, not consequence (Theme 6). |
| **0040** (Done) | **(satisfied — implemented, audit E55/C12)** Confessionals are **structured** (`ConfessionalContext`: trigger + soul-derived mood + seeded phrasing — content names its trigger and varies across a season), fire at **nominations, the veto ceremony, AND eviction night**, and finally reach the confessor's own soul (`recordConfessionalToSoul` is called live, mirrored into `soul.memory` so recall survives a restart). | One canned line all season (also the 0048 unsealing payoff), noms-only firing, and the recall half unwired (zero `recordConfessionalToSoul` callers). |
| **0041** (Done) | **(satisfied — implemented, audit E50/E51/E52)** Off-screen scene emotions are **per-role** (`offscreenEmotion(type, role)`: a betrayal's initiator *schemes*, the partner is *betrayed*; `recordOffscreenScene` evolves both). The dead arc vocabulary fires live: `survived-vote` for the surviving nominee at every eviction; `comp-loss` for contested losers (the veto field; the final-3 crown). `evolveEmotion` carries ADR 0001's bounded per-moment temperature roll (`emotional.swingTemperatureWeight`, seeded side rng) and **delegates to the canonical 0028 `emotionalModifier`** (one swing formula, soul-specific baseline). | The betrayer was given the victim's emotion while the victim's soul never moved; half the 0041 vocabulary never fired; the live swing skipped the ADR 0001 roll beside a dead parallel formula. |
| **0026/0017** (Done) | **(satisfied — implemented, audit E47/E48/E54 + E44)** `EdgeSignals` gains ADR 0002's **`reliability`** evidence signal (fed by honored deals, veto saves, protective votes; torn down by betrayal-shock; consumed by `bondStrength` via `RELIABILITY_WEIGHT`; never decays; lossless round-trip with legacy-save defaults). `CEREMONY_IMPACTS` holds **named impact objects**: `comp-won` is `{threat:+0.14}` only (the house keeps liking its winner) and the eviction fold scales by recorded **manner** (`EVICTION_MANNER_SCALE`). Gossip **receipt folds** (`GOSSIP_HEARD`, confidence-scaled, never the player's own edges) let a rumor genuinely move third-party reads. | A comp win soured the whole house on its winner; a fully-expected eviction folded full betrayal-shock; trust was pure sentiment with no evidence channel; a rumor never changed any mind (Theme 6). |
| **0028** (Done) | **(satisfied — implemented, audit E52/E53)** `variableWeights` is pruned to the fields with REAL consumers: `initiative` (the `rankApproaches` ordering-variance band) and `allianceShift` (the `chooseStrongestBond` near-tie wobble); the four consumer-less fields are deleted. `EmotionalConstants` gains `swingTemperatureWeight`; `emotionalModifier` takes an optional per-soul `baseline` and is the ONE live swing formula (0041 delegates to it). | The "temperature is per-moment, per-variable" config was decorative (zero consumers) while subsystems rolled ad-hoc variance — a config that drives nothing is a lie. |
| **0036** (Done) | **Audit E60 (2026-06-10)**: `socialInitiatives` no longer ships an engine-authored pretext line ("wants a word with you"). The projection carries a **coarse categorical motive** — `bond` (the tie drives the approach) or `probe` (the threat read does) — computed from the same `rankApproaches` agenda; the GM voices it in its own words and the FE chip maps it to short UI copy. Never a relationship number. | ADR 0003 principle 2 names the canned pretext as the smell: hand the model the FACT/drive, let it write the line. The drive was computed and then discarded. |
| **0050** (Done) | **0065 — photo-first OOBE (2026-06-20):** the casting interview now **opens on the cast photo** ("producers ask what you look like before anything else"). New scalar `castPhoto` on `UpdateCastingReq` (`"uploaded"` \| `"skipped"`; any non-empty string marks it handled) is the **FIRST entry of `CASTING_COVERAGE`**, so a fresh interview's `next`/`missing[0]` is the cast photo before the name. Engine-driven and **OPTIONAL** — it does **NOT** gate casting `ready` (name-only), so `createCharacter` finalizes whether the photo was uploaded or skipped. Flows through the existing intake plumbing (ordinary scalar; merge/overwrite/capture/status iterate the coverage list) and the Vault-free `updateCasting` boundary untouched. The `character-creation` moment prompt opens the producer on the 📷 panel accordingly. See [0050 Amendment (0065)](./0050-casting-interview.md#amendment-0065--the-cast-photo-is-the-first-casting-step-photo-first-oobe). | The cast photo was an afterthought ("get one before you wrap"); making it casting step #1 matches "what do you look like?" being the first thing real casting asks — while staying skippable so it never blocks a player who doesn't want a photo. |
| **0023/0055** (Done) | **[ADR 0005](../decisions/0005-split-authority-by-openness.md) — generative-consequence path + expressive-non-collapse gate (PR #355, 2026-06-20):** `recordInteraction` / the 0023 `ConsequenceEngine` accept an optional, Vault-free `consequence` descriptor (per-edge `{ toward, direction, emphasis? }` + `rationale`). The model proposes the *shape* (which edge moves, which direction, relative `emphasis`); the engine still owns the bounded, seeded *magnitude* (`direction`→base impact, `emphasis`→a clamped 0.6/1.0/1.4 multiplier — **no raw number crosses**). `kind` stays the floor: no descriptor ⇒ byte-identical fold. The MCP boundary shape-guards a malformed descriptor (clean 400, not a 500); the FE schema/client forward it and the 0055 `_auto_record_scene` can propose one. New permanent gate: `tests/unit/expressiveNonCollapse.test.ts` + `frontend/tests/test_expressive_non_collapse.py` (the WINNER/NEW-HOH desync branches were phase-scoped so creative prose can't trip a board-outcome rail-correction). | A growing LLM↔engine sync spine risked flattening creative play by forcing the open set (the meaning/texture of social play) through a closed 7-way `kind` enum; ADR 0005 splits authority by **openness**, not layer, and makes non-collapse a regression gate. |
| **0006** (Done) | **Staged-rounds evolution (owner decision):** a competition is now an **endurance-style sequence of visible ELIMINATION ROUNDS** over the still-in field — each round the player picks their approach (compete / throw / play-safe) for THAT round, seeing who remains, and the lowest score DROPS until one stands. Reuses the 0006/0028 math (`resolveElimination` reads the same scores to pick the lowest); the staged sub-loop is `CompetitionProgress` / `advanceCompetition` in `src/engine/liveSeason.ts`, surfacing a per-round `comp-round` pending (with the **still-in field**) through the existing decision seam (the FE per-round prompt replaces the single binding popup). **Anti-sycophancy holds per round**: each round's approach is committed BEFORE it resolves (structured selection only — never prose), LOCKED after, adaptation forward-only. Favorite-win calibration holds (≈73%, inside the 65–80% band) — `tests/unit/stagedCompetition.test.ts`. See [0006 §8](./0006-outcomes-by-stats-and-temperature.md#8-staged-rounds-evolution-the-per-round-approach). | The single up-front, irrevocable approach was too rigid — the player committed blind to how the field would narrow. Strategy should adapt to the field as it thins (everyone left an ally → throw; a threat still in → keep competing), while the per-round commit-before-result keeps a loss from being re-labeled a "throw." |

New cross-cutting expectations introduced by drafts (not yet built, listed so the implementer
plans for them): **0020** adds `gameStatus` (a Vault-free public-state projection for the status
panel) and `portraitDescriptorFor` (a Vault-free descriptor over 0004's public appearance facets);
**0018/0019** formalize `getMomentPrompt` + the `pendingDecision`/`executeDecision` decision seam
(as built: `submitDecision`, with `advanceGame` driving the loop — the engine surfaces the legal
option set; binding choices execute only through validation).

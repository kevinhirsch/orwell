# BACKEND-DEEP audit — TS engine (src/) + Python FE glue (frontend/src, frontend/routes)

Findings from the lead investigator are numbered BE-1..BE-2x. Two parallel sub-agents
contributed BE-101..BE-1xx (MCP boundary / write-back wiring / GameSessionAdapter) and
BE-201..BE-2xx (FE Python game glue). All ranges are independent; no dedup needed across
ranges but see "Corroboration" notes where a sub-agent independently hit the same seam.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| BE-1 | Major | <1hr | High | Most of the 0087-0100 behavioral-fidelity layers are permanently dark in the shipped game (no deploy/settings wiring) | `deploy/orwell-install.sh`, `src/adapters/engine/GameSessionAdapter.ts:349-411` |
| BE-2 | Major | <1day | High | Season-over-season notoriety (0104) is fully built end-to-end but structurally unreachable — no caller ever sets `carriesNotoriety` | `src/composition/registry.ts:573-579`, `src/ports/GameSession.ts:582` |
| BE-3 | Minor | <1hr | Med | Reserve-twist pool advertises 3 twist kinds; 2 of 3 are unimplemented and silently filtered, diluting the real twist rate to roughly a third of what `TWIST_LOAD_PROB` implies | `src/engine/reserveTwists.ts:14-20`, `src/adapters/engine/GameSessionAdapter.ts:342,3513-3516` |
| BE-4 | Minor | <1day | Med | `surfaceInformationTo`'s boolean `surfaced` result is a Vault-content oracle: repeated content-lineage probes can infer fragments of hidden event text without ever "receiving" it | `src/adapters/inmemory/InMemoryKnowledgeService.ts:99-163`, `src/adapters/engine/EngineCommandsAdapter.ts:348-356` |
| BE-5 | Minor | <1hr | Low | `recordImageBeat` is the only FE write-back lever with no `expectedBeatSeq`/`idempotencyKey` support, unlike every sibling mutating tool | `src/adapters/engine/EngineCommandsAdapter.ts:367-403`, `src/adapters/mcp/McpServer.ts:162-165` |
| BE-6 | Minor | <1hr | Low | `InMemoryEventStore.query()` defaults to the FULL unfiltered log (Vault-hidden events included) when called with no filter — safety is opt-in per caller, not fail-closed by construction | `src/adapters/inmemory/InMemoryEventStore.ts:50-66` |
| BE-7 | Polish | <1hr | Low | `SqliteVectorIndex`'s `dbPath` parameter and on-disk `openVecDatabase` path are dead in production (the one call site always passes `:memory:`), leaving the class's persistence-flavored doc comments misleading | `src/adapters/sqlite/SqliteVectorIndex.ts:99-114`, `src/composition/engineRoot.ts:64` |
| BE-8 | Minor | <1day | Med | `politicalTemperature`'s runaway-threat detector (which forces every HOH to "play direct", collapsing pawn/backdoor tactics for the week) is public, single-signal, and can be starved permanently once one houseguest's read stays hot — worth re-checking against late-game small-house math | `src/engine/season.ts:67-82` |
| BE-9 | Minor | <1day | Med | `breakSeverityScale`'s `vague` / explicit-term paths are mutually exclusive by construction (an "exactly one of" contract enforced nowhere), so a deal minted with BOTH `expiresWeek` and `vague:true` silently takes the `vague` branch only — no validation rejects the malformed combination | `src/domain/deal.ts:46-59`, `src/engine/deals.ts:51-58` |
| BE-10 | Minor | <1day | Med | `DealLedger.reconcile`'s week-scoped "kept" resolution only fires on a `vote-evict` action; a `safety`/`vote` deal whose bound party is never a voter that week (e.g. they become the HOH or a nominee) relies entirely on `expireWeekScoped` at the NEXT eviction-result — if a double-eviction night's first half evicts the bound party themselves mid-cycle, the still-open deal is never reconciled for them and rides forward with a stale `madeWeek` | `src/engine/deals.ts:134-189`, `src/adapters/engine/GameSessionAdapter.ts:6437-6445` |
| BE-11 | Minor | <1hr | Med | The GM system prompt (`BASE_GAME_MASTER_PROMPT`) is injected in full on every turn and is enormous (1000+ lines of prose rules); combined with the token-economy mandate (0069) this is a standing per-turn cost that is never trimmed/cached across turns in the engine layer — flag for the token-economy lane, not fixed here | `src/engine/momentPrompts.ts:39-...` |
| BE-12 | Minor | <1day | Med | `vetoParticipants`' Houseguest's-Choice deferral path (`playerChoosesOwn`) computes the deferred candidate list from `pool` (the non-puller pool) rather than re-deriving eligibility from current game state — if a houseguest is evicted/self-evicted between the draw and the player's deferred pick (a live, turn-driven game where the player can walk away mid-decision) the candidate snapshot could offer a since-departed houseguest | `src/domain/eligibility.ts:83-125` |
| BE-13 | Minor | <1hr | Low | `hasPriorImageFor` does a full linear scan of every `image-shown` event on EVERY `recordImageBeat` call (no index/cache), unlike the analogous `currentBeatKey` incremental-cache pattern used elsewhere in the same file — a late-season house with many portrait regenerations pays O(n) per image call | `src/adapters/engine/EngineCommandsAdapter.ts:405-414` |
| BE-14 | Minor | <1day | Med | `IMPLEMENTED_TWISTS` gates which reserve twists actually load, but the filter runs AFTER `loadReserveTwists` already consumed RNG draws proportional to `RESERVE_POOL.length` (3) — if a future twist is added to the pool without also adding to `IMPLEMENTED_TWISTS`, the seeded RNG stream for existing seeds does not change (good), but the effective enable rate for the one shipped twist silently drops further as the pool grows, with nothing enforcing that `IMPLEMENTED_TWISTS` tracks `RESERVE_POOL` | `src/engine/reserveTwists.ts:17`, `src/adapters/engine/GameSessionAdapter.ts:342` |
| BE-15 | Polish | <1hr | Low | `TwistKind`/`RESERVE_POOL` naming ("secret-power") collides conceptually with the unrelated, fully-built 0093 "secret power" (leverage) feature — same vocabulary, two disjoint systems, real risk of a future maintainer wiring the wrong one or assuming 0093 implements the reserve twist | `src/engine/reserveTwists.ts:14`, `src/adapters/engine/GameSessionAdapter.ts:5810` |

Sub-agent index ranges (full detail in their own sections below): **BE-101..BE-103**
(MCP boundary / GameSessionAdapter / write-back wiring) and **BE-201..BE-211** (FE Python
game glue).

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| BE-101 | Major | <1day | High | Unvalidated `consequence.edges[].direction`/`emphasis` values crash the call OR silently write NaN into the permanent hidden relationship layer | `src/adapters/mcp/McpServer.ts:70-78`, `src/engine/consequence.ts:139-141`, `src/engine/relationshipConstants.ts` |
| BE-102 | Major | <1hr | High | `recordInteraction`'s `toward` / `consequence.edges[].toward` bypass the B39 living-houseguest check, letting a caller fold relationship impact onto an evicted juror or invented id — a jury-tilting side channel | `src/adapters/engine/EngineCommandsAdapter.ts:166-171,240-274` |
| BE-103 | Minor | <1hr | Low | `worldSnapshotView()` is fully implemented (port+adapter) but never wired into the registry/McpServer — dead read endpoint, nothing calls it | `src/ports/GameSession.ts:1699`, `src/adapters/engine/GameSessionAdapter.ts:7005-7017` |
| BE-201 | Major | <1hr | High | `DEFAULT_SETTINGS["max_tokens_budget"]` bakes flat 4096/2048 caps for narration/casting on every fresh install, silently reintroducing the reasoning-model truncation bug the token-policy module was built to prevent | `frontend/src/settings.py:196-205`, `frontend/src/token_policy.py:56-67`, `frontend/src/agent_loop.py:3997-4009` |
| BE-202 | Major | <1day | High | The outcome guard's if/elif short-circuit + pre-commit-only tally scoping lets a fabricated vote-count/"unanimous" claim reach the player in the same beat as a real eviction | `frontend/routes/chat_helpers.py:1148-1236` |
| BE-203 | Major | <1hr | Med-High | The 0081 active-faithfulness reframe/reground correction silently no-ops on every single-tenant (`AUTH_ENABLED=false`) deployment — degrades "active" mode to "shadow" mode | `frontend/src/agent_loop.py:2478-2493,2568-2581` |
| BE-204 | Minor | <1hr | Low-Med | The 0065 Part D sync ledger is written every turn but has no reader anywhere (no admin route/UI) | `frontend/src/orwell_sync_ledger.py:245-259` |
| BE-205 | Major | <1day | High | The presence/identity desync guard's verb list ("leaning") collides with the idiomatic phrasing for legitimate off-screen scheming, risking false-positive re-ground nags against the exact behavior the game is mandated to produce | `frontend/routes/chat_helpers.py:1301-1329,1391-1415` |
| BE-206 | Minor | <1hr | Med | `_model_max_output_tokens` is Anthropic-only despite being used as the generic model-aware fallback for every provider; every non-Claude model (including the actual OOB defaults) falls to a flat 8192 | `frontend/src/llm_core.py:598-625` |
| BE-207 | Minor | <1hr | Low | Calibration comp-win counter only matches present-tense, player-first phrasing — undercounts wins in the instrumentation log | `frontend/routes/orwell_routes.py:250-263` |
| BE-208 | Minor | <1hr | Low | `_backfill_with_cas`'s double-stale "give up" case is indistinguishable from a benign no-op — a genuine race-loss (mandate #4 risk) isn't logged distinctly | `frontend/src/agent_loop.py:1978-2019` |
| BE-209 | Polish | <1hr | Low | `settings.py` and `token_policy.py` maintain independently-diverging "defaults" for the same reasoning-effort class with no single source of truth | `frontend/src/settings.py:170-187`, `frontend/src/token_policy.py:38-45` |
| BE-210 | Minor | <1day | Med | The wrong-nominee guard's first-name-collision exemption can false-negative when two active houseguests share a first name | `frontend/routes/chat_helpers.py:1783-1809` |
| BE-211 | Polish | <1hr | Low | `resolve_token_policy` looks up admin overrides by the raw (possibly-unresolved) `call_class` instead of the resolved fallback class | `frontend/src/token_policy.py:137-153` |

---

## LEAD FINDINGS — FULL DETAIL

### [BE-1] [Severity: Major] [Effort: <1hr] [Value: High]
Most of the built behavioral-fidelity enrichment layers never run in the shipped game
- Where: `deploy/orwell-install.sh:255-263` (writes `data/.env`); flag reads at
  `src/adapters/engine/GameSessionAdapter.ts:349` (`ORWELL_CAMPAIGNS`), `:361`
  (`ORWELL_TRAJECTORIES`, 0087), `:371` (`ORWELL_TRIGGERS`, 0091), `:381`
  (`ORWELL_SECRET_PACING`, 0092), `:390` (`ORWELL_JURY_HOUSE`, 0100), `:4319`
  (`ORWELL_SEEDED_TIE_SURFACING`), `:409-411` (`ORWELL_TIME_PER_CONVERSATION`,
  `ORWELL_SOCIAL_FATIGUE`, `ORWELL_MULTI_NIGHT_FATIGUE` — the 0066 Phase-2 extensions).
- Problem: every one of these layers is coded, unit-tested, and documented as "built" —
  they are relationship trajectories (0087), NPC trigger-eruptions (0091), the secret-pacing
  drip (0092), the jury-house grudge (0100), named-alliance tie surfacing, and three
  sleep-economy depth extensions. All default OFF via a raw `process.env.ORWELL_X === "1"`
  read, by deliberate design (so the seeded calibration/UAT spine stays byte-identical when
  off). But `orwell-install.sh` — the ONE place that writes the production `data/.env` — only
  ever sets `ORWELL_CAMPAIGNS=1` (see the comment "NPC campaigns (0085): the live game runs
  the strategic-campaign layer ... the deploy opts in here"). None of the others are set
  anywhere in `deploy/`, and unlike the ADR-0006 time-of-day clock (which gets a genuine
  runtime toggle via `GameSessionAdapter.setTimeOfDayEnabled` wired to a FE settings default
  `"time_of_day_enabled": True` in `frontend/src/settings.py:35`, re-applied every FE boot via
  `set_time_of_day`), grepping `frontend/src/settings.py` and `frontend/src/orwell_engine.py`
  for `trajector|trigger|secret_pacing|jury_house|tie_surfacing|social_fatigue|multi_night|
  per_conversation` returns NOTHING — there is no settings key, no admin toggle, no FE-boot
  reapplication for any of them. The only way any of these ever fires in the real deployed
  product is an operator manually editing `data/.env` on the box, which nothing prompts them
  to do. Given the owner's own verdict that the shipped product feels thin/unplayable and the
  vision's #1 priority is behavioral fidelity/richness (I7), this is very plausibly a real
  contributor: a large fraction of the "richness" work that exists in the codebase to make the
  house feel alive literally never executes in production.
- Fix: either (a) add each flag to the `data/.env` block `orwell-install.sh` writes (mirroring
  the `ORWELL_CAMPAIGNS=1` line) once each feature's calibration is confirmed safe to enable by
  default, or (b) give each the same `setXEnabled`-style runtime toggle + FE settings default
  that `time_of_day` already has, so at minimum an admin can turn them on without SSHing into
  the box and hand-editing `.env`. At minimum, this should be a conscious go/no-go decision
  recorded somewhere (currently it reads as an oversight, not a decision — the code comments
  for each flag say "the live deploy does [enable it]", which is false for six of the seven).

### [BE-2] [Severity: Major] [Effort: <1day] [Value: High]
0104 cross-season notoriety is fully wired but can never activate — `carriesNotoriety` is never set
- Where: `src/composition/registry.ts:573-579` (`if (req.carriesNotoriety)
  fresh.session.setNotoriety(this.notorietyStore.read(user));`); the field is declared at
  `src/ports/GameSession.ts:582` (`carriesNotoriety?: boolean;`). Persist/read side is fully
  built: `src/engine/notoriety.ts` (`deriveNotoriety`, `notorietyBias`), the accumulate call at
  `registry.ts:763`, `src/adapters/engine/FileUserNotorietyStore.ts`, and the consuming fold in
  `GameSessionAdapter.ts:3990-3992`.
- Problem: `grep -rn "carriesNotoriety"` across `src/` AND `frontend/` (both `.ts` and `.py`)
  turns up exactly three lines: the field declaration, the one `if` check, and a code comment.
  No route, no tool call, no FE flow, no test-adjacent caller ever sets it to `true`. The
  registry's own comment even frames it as "the DIEGETIC opt-in (R4): the player returns as
  the SAME character" — implying there should be a player-facing choice ("play again as
  yourself" vs. "start fresh") that flips this flag on a new-season/restart request. That
  choice does not exist anywhere in the front end. The result: the engine faithfully derives
  and persists a `NotorietySummary` after every season (this part DOES run — it's on the
  unconditional `accumulate` path), but the read-back that would make a returning player's
  reputation precede them into a new cast is dead code in practice. This is a fully-built
  feature (spec 0104) that is invisible to every player who ever restarts a season, silently
  regressing what CLAUDE.md's own feature index would lead you to believe is a shipped
  capability.
- Fix: wire a caller. The natural seam is the player-channel restart path (the confirmed
  `createCharacter` restart / `POST /api/orwell/new-game` per CLAUDE.md's "ONE sanctioned
  season-restart door") — surface a real choice to the player (or default it to `true` when
  the same user account restarts, since the whole point per the spec is "the same physical
  user" carrying reputation across seasons) and thread it through to the `createCharacter`/
  restart request that ultimately reaches `registry.ts:573`.

### [BE-3] [Severity: Minor] [Effort: <1hr] [Value: Med]
Reserve-twist "curated pool" of 3 is silently 1-of-3 implemented, diluting the real fire rate
- Where: `src/engine/reserveTwists.ts:14-20` (`TwistKind`, `RESERVE_POOL`,
  `TWIST_LOAD_PROB = 0.5`); the filter is at
  `src/adapters/engine/GameSessionAdapter.ts:342` (`IMPLEMENTED_TWISTS = new
  Set(["double-eviction"])`) and `:3513-3516` (`loadReserveTwists(...).filter((t) =>
  IMPLEMENTED_TWISTS.has(t.kind))`).
- Problem: `loadReserveTwists` draws a twist kind uniformly from `RESERVE_POOL` (currently
  `["secret-power", "double-eviction", "battle-back"]`) for each of `count` slots, each slot
  independently ~50% likely to load at all (`TWIST_LOAD_PROB`). Only AFTER the seeded draw does
  `GameSessionAdapter` filter out any kind not in `IMPLEMENTED_TWISTS` — which today is just
  `double-eviction`. So of the ~50% of slots that load anything, only ~1/3 of those survive the
  post-hoc filter, meaning the REAL effective chance any given slot ends up producing a live
  twist is roughly `TWIST_LOAD_PROB / 3 ≈ 17%`, not the `50%` the constant's own name and doc
  comment ("Chance an enabled reserve slot actually loads a twist") suggest to a reader. This is
  exactly the kind of half-wired-spec gap the charter's C6 calls out: `secret-power` and
  `battle-back` read, from the type system and the exported pool, as live production twists on
  par with `double-eviction`; they are not, and nothing enforces or documents that
  `IMPLEMENTED_TWISTS` must be kept in lockstep with `RESERVE_POOL`.
- Fix: either implement `secret-power` and `battle-back` (they are named, spec'd BB staples —
  competition-immunity/safety powers and a battle-back/redemption bracket), or shrink
  `RESERVE_POOL` to just the implemented kinds and recompute `TWIST_LOAD_PROB` against the
  smaller pool so the documented probability matches reality. At minimum add a same-file
  assertion/comment tying `IMPLEMENTED_TWISTS` to `RESERVE_POOL.length` so a future pool
  addition doesn't silently dilute the rate further.

### [BE-4] [Severity: Minor] [Effort: <1day] [Value: Med]
`surfaceInformationTo`'s boolean result is a Vault-content oracle
- Where: `src/adapters/inmemory/InMemoryKnowledgeService.ts:99-163` (`surfaceInformationTo`,
  `pathwayAnchored`, `contentDerivedFrom`); exposed outward via
  `src/adapters/engine/EngineCommandsAdapter.ts:348-356` and the `surfaceInformationTo` MCP
  tool case in `McpServer.ts:372-373`.
- Problem: `surfaceInformationTo` returns `{ ok: true, surfaced: boolean }`. `surfaced` is
  `true` only when `pathwayAnchored` confirms the claimed content is a genuine substring/
  fragment (≥4 chars via `MIN_FRAGMENT`) of something the named teller/overheard-event actually
  contains — including Vault-hidden event content the player was never a witness to
  (`pathwayAnchored`'s `told-by` branch scans `this.events.query()`, the FULL unfiltered log,
  for ANY event the teller witnessed, hidden or not). This is a deliberate and correct
  anti-fabrication guard (I3 — "the model cannot mint ground truth") for a SINGLE call. But the
  narrator/model can call `surfaceInformationTo` many times across a session with different
  guessed `fact.content` strings for the same `pathway: "told-by:<npc>"` and observe the
  `surfaced` boolean each time. Because the anchoring check is exact-substring based
  (`contentDerivedFrom`), an adversarial (or merely exploratory, greedy) sequence of guesses can
  binary-search toward exact fragments of Vault-hidden event text without the model ever being
  handed that text directly — a classic oracle side-channel. It doesn't hand over the full
  secret in one shot, and exploiting it requires many deliberate, low-value tool calls a
  narration-focused model is unlikely to make organically, so this is Minor rather than
  Blocker — but it is a genuine crack in "the model cannot leak what it never receives",
  because here it can *infer* what it never received, one probe at a time.
- Fix: rate-limit/cap `surfaceInformationTo` failures (repeated `surfaced: false` from the same
  caller/pathway in a short window should refuse further attempts, similar to the existing
  per-beat fold budgets elsewhere in the same adapter family), and/or make a failed anchor check
  return a FLAT `{ ok: true, surfaced: false }` with no distinguishing signal beyond that
  (already true) while also not allowing unlimited retries per beat — tie it into the same
  `MAX_FOLDS_PER_PAIR_PER_BEAT`-style per-beat cap pattern already used for
  `recordInteraction`.

### [BE-5] [Severity: Minor] [Effort: <1hr] [Value: Low]
`recordImageBeat` is the one write-back lever missing the closed-set sync-spine (beatSeq/idempotency)
- Where: `src/adapters/engine/EngineCommandsAdapter.ts:367-403` (no `expectedBeatSeq` param,
  no `guardBeatSeq` call); compare to `recordInteraction`/`surfaceInformationTo` in the same
  file, both of which call `this.guardBeatSeq(req.expectedBeatSeq)` first. The MCP arg-shape
  guard for `recordImageBeat` (`McpServer.ts:162-165`) also has no `expectedBeatSeq`/
  `idempotencyKey` case, unlike `moveTo`, `makeDeal`, `confide`, etc.
- Problem: every other FE-driven mutating lever documented in CLAUDE.md's "closed-set sync
  spine" section (0065) accepts an optional `expectedBeatSeq` so a stale FE call against a
  superseded board is refused with a typed 409 rather than silently applying against dead
  state. `recordImageBeat` — itself one of the FOUR named "FE-driven write-backs" in CLAUDE.md —
  has no such guard. In practice a portrait generation is unlikely to be safety-critical the
  way a nomination or vote is, so this is Minor, but it is inconsistent with the stated
  invariant ("mutating tools take an optional `expectedBeatSeq`") and means a race where the FE
  requests an image generation against a beat that has since rolled over (e.g. the player
  advanced past a ceremony while a slow image-gen call was in flight) is recorded and budget-
  charged against the CURRENT beat/week window with no way for the caller to detect the board
  moved out from under it.
- Fix: add `expectedBeatSeq?: number` to `recordImageBeat`'s request shape and call
  `this.guardBeatSeq(req.expectedBeatSeq)` before the budget check, matching every sibling
  write-back; add the corresponding `requireShape` guard case in `McpServer.ts`.

### [BE-6] [Severity: Minor] [Effort: <1hr] [Value: Low]
`EventStore.query()` fails OPEN (returns Vault-hidden content) by default, not closed
- Where: `src/adapters/inmemory/InMemoryEventStore.ts:50-66`.
- Problem: `query(filter: EventQuery = {})` with no arguments — or with a filter object that
  sets none of `witnessedBy`/`hidden`/`type` — takes the "fast path" and returns the ENTIRE
  unfiltered event log, hidden Vault content included. Today's only outward-reachable caller
  (`VisibleStateService.ts:65`) correctly passes `{ witnessedBy: entity }`, and the other
  unfiltered call sites are engine-internal (`InMemoryKnowledgeService.pathwayAnchored`,
  `EngineCommandsAdapter.hasPriorImageFor` — the latter DOES filter by `type`). So there is no
  PROVEN leak today. But CLAUDE.md itself calls out that exactly this class of mistake — "a
  concrete past bug where the Vault wrongly logged events the player was present for" / events
  mislabeled — has bitten this codebase before, and the store's own contract makes the SAFE
  call (explicit filter) opt-in effort and the UNSAFE call (bare `.query()`) the path of least
  resistance for a future author adding a new outward-reachable summary/read tool. This is
  exactly the kind of structural landmine the Vault Wall mandate says should be impossible "by
  construction," and today it is possible by omission.
  - Where: `src/adapters/inmemory/InMemoryEventStore.ts:50-66`
- Fix: add a second, clearly-named method for the genuinely-unfiltered read (e.g.
  `queryAll()` / `queryUnsafe()`) used only by the two engine-internal call sites that need it,
  and make plain `query()` require at least one of `witnessedBy`/`hidden` to be supplied
  (throw or return `[]` otherwise) so an outward caller cannot get the full log by accident.

### [BE-7] [Severity: Polish] [Effort: <1hr] [Value: Low]
`SqliteVectorIndex`'s on-disk path is dead code, contradicting its own doc comments
- Where: `src/adapters/sqlite/SqliteVectorIndex.ts:99-114`; the only call site is
  `src/composition/engineRoot.ts:64` (`sqliteVectorIndexFactory()` — no `dbPath` argument).
- Problem: the module's doc comments describe it as "the relational analogue of
  `InMemoryVectorIndex`, the datastore plan's `sqlite-vec → pgvector` step" and the
  constructor/factory both accept an optional `dbPath` for a persistent file — but the ONE
  production call site never passes one, so `openVecDatabase` always opens `:memory:`. This is
  actually the CORRECT behavior (soul vector indexes are cheaply re-derived from the persisted
  markdown text via `SoulStore`'s `rebuildSoulIndex` on every restart, so persisting the vectors
  themselves would be pure overhead) — but the doc comments and the still-present `dbPath`
  parameter read as if on-disk persistence is a real, exercised code path, which will mislead
  the next person who touches `ORWELL_STORE=sqlite` into thinking vector data survives a
  restart on disk when in fact only `SqliteSaveStore`'s snapshot blobs do.
- Fix: either delete the unused `dbPath` parameter/on-disk path from `SqliteVectorIndex` (kept
  only for tests, which could instead construct their own `:memory:` db directly), or update
  the doc comment to state plainly that the vector index is ALWAYS `:memory:` in this codebase
  today and explain why that's fine (the rebuild-on-restore guarantee) rather than implying a
  persistence story that doesn't exist.

### [BE-8] [Severity: Minor] [Effort: <1day] [Value: Med]
`politicalTemperature`'s "runaway threat" read can permanently override nomination tactics late-game
- Where: `src/engine/season.ts:67-82` (`politicalTemperature`), consumed at
  `src/engine/season.ts:115-117` (`nominationStrategy`: `politicalTemperature(active,
  rel).runaway ? "direct" : DECISION.nomination.tacticFor[disposition]`).
- Problem: `politicalTemperature` computes each houseguest's house-wide "menace" (mean threat
  read by everyone else) and flags `runaway` when the gap between the top menace and the median
  exceeds `DECISION.nomination.runawaySpread`. Once flagged, EVERY HOH that week — regardless of
  their own disposition (loyalist/schemer/neutral) — is forced to play "direct" (skip
  pawn/backdoor tactics entirely). In a shrinking house (Final 6/5/4), a single very-online
  competitor's threat read from a small `readers` pool can produce a large spread almost
  permanently once a genuine frontrunner emerges — meaning the tactical layer (backdoors, pawns,
  the whole point of `nominationStrategy` existing) can effectively switch off for the entire
  back half of a season once one player is perceived as dominant, which is itself a
  plausible-but-untested emergent behavior worth a dedicated calibration check (is `runaway`
  actually rare in the back half of a season, or does it saturate?). The code comment already
  self-flags a related bias ("an upper-central pick... biased spread DOWN") but doesn't address
  whether `runaway` saturates as the house shrinks.
- Fix: add a calibration/property test asserting the `runaway` rate stays bounded (doesn't
  approach 100%) across the back half of a simulated season (Final 8 downward), the same way
  the jury-reach and gradient calibration gates already bound other emergent rates.

### [BE-9] [Severity: Minor] [Effort: <1day] [Value: Med]
No validation that a deal's `vague` and `expiresWeek` fields are mutually exclusive
- Where: `src/domain/deal.ts:46-59` (`Deal.expiresWeek`/`Deal.vague` doc comments: "EXACTLY
  one of two forms"); consumed at `src/engine/deals.ts:51-58` (`breakSeverityScale`: `if
  (deal.vague) return ...; if (deal.expiresWeek !== undefined && currentWeek !== undefined)
  ...`).
- Problem: the type `Deal` allows both `expiresWeek` and `vague: true` to be set
  simultaneously — nothing in `DealLedger.make()` (`src/engine/deals.ts:91-113`) or at the MCP
  boundary enforces "exactly one." If a future caller (or a bug in the FE's deal-negotiation
  extraction) supplies both, `breakSeverityScale` silently takes the `vague` branch and the
  `expiresWeek` value becomes dead data that still surfaces to the player as a term ("the
  `expiresWeek` term IS the player's OWN knowledge" per the doc comment) while the engine
  privately treats the deal as vague for severity purposes — a small, hard-to-notice mismatch
  between what the player is told a deal's term is and how the engine actually scores breaking
  it.
- Fix: reject (or normalize — e.g. `vague` wins and `expiresWeek` is dropped) the combination
  at `DealLedger.make()`'s call boundary, with a comment explaining the precedence so it's a
  documented choice rather than an accident of branch order.

### [BE-10] [Severity: Minor] [Effort: <1day] [Value: Med]
Week-scoped deal resolution can miss a bound party who is evicted mid-double-eviction
- Where: `src/engine/deals.ts:134-189` (`reconcile`, `expireWeekScoped`);
  `src/adapters/engine/GameSessionAdapter.ts:6437-6445` (the `commit()` call site, gated on
  `ev.beat === "eviction-result"`); the double-eviction week-number hold-open logic in
  `src/engine/liveSeason.ts:1050-1079` (`rollWeek`).
- Problem: `expireWeekScoped(currentWeek)` is the catch-all that resolves a week-scoped
  (`safety`/`vote`) deal `kept` once `currentWeek > madeWeek`, for the case where the bound
  party's `vote-evict` action never happened to explicitly reconcile it (e.g., they became HOH
  or a nominee and didn't vote that week). During a double-eviction night, `rollWeek` holds
  `s.week` CONSTANT across the first eviction (so the compressed second cycle runs "the same
  week"), only incrementing once the SECOND eviction resolves. If the bound party is EVICTED in
  the FIRST half of a double-eviction night, their open week-scoped deal is never explicitly
  reconciled (they can't cast a `vote-evict` action once evicted) and `expireWeekScoped` is not
  called until the SECOND eviction-result lands in the same beat sequence — which does happen
  in-order today, so the deal likely still resolves correctly by the time the night ends. This
  is flagged as Minor/worth-a-test rather than a proven bug because the current single call
  site happens to cover it, but there is no direct test asserting a week-scoped deal bound to a
  double-eviction's FIRST evictee resolves correctly (vs. silently riding forward as "open" with
  a stale `madeWeek` if the call ordering in `commit()` were ever refactored).
- Fix: add a unit test pinning "a `safety` deal bound to a houseguest evicted in the FIRST half
  of a double-eviction night resolves `kept` (not left dangling `open`) by the time the night's
  second eviction lands," so a future refactor of the `commit()` sequencing can't silently
  regress it.

### [BE-11] [Severity: Minor] [Effort: <1hr] [Value: Med] — cross-territory flag for the token-economy / narration-fidelity lane
The full GM system prompt is very large and re-sent verbatim every turn
- Where: `src/engine/momentPrompts.ts` (`BASE_GAME_MASTER_PROMPT`, ~180+ lines of dense prose
  rules, always injected per CLAUDE.md's own description: "The front-end injects
  `buildSystemPrompt(moment, state)` as the system message on every turn").
- Problem: this is an engine-authored constant, so it's within this lane's territory to flag,
  but the actual cost/caching behavior lives in the FE's token-economy code (0069) — noting it
  here so that lane can check whether this prompt benefits from provider-side prompt caching
  (many OpenAI-compatible/Anthropic-compatible endpoints support a cached-prefix discount) and
  whether it's being invalidated turn-to-turn by anything that changes earlier in the message
  (e.g., a per-turn timestamp or counter baked into the SAME system message ahead of the cache
  boundary, which would defeat prefix caching entirely).
- Fix: not actioned in this lane — flagged for the token-economy/FE lane to verify prompt-cache
  eligibility and confirm nothing volatile is interleaved ahead of the stable prose block.

### [BE-12] [Severity: Minor] [Effort: <1day] [Value: Med]
Houseguest's-Choice deferred-pick candidate list is a static snapshot, not re-validated at pick time
- Where: `src/domain/eligibility.ts:65-125` (`vetoParticipants`), specifically the
  `deferredHolder`/`candidates` computation at lines 114-121.
- Problem: when the PLAYER draws the "Houseguest's Choice" chip, the draw pauses
  (`deferredHolder` is set) and the candidate list is snapshotted once, immediately, from the
  pool minus everyone already drawn. The actual pick decision is then surfaced to the player as
  a `PendingDecision` (`houseguests-choice` in `liveSeason.ts`) and resolved on a LATER turn,
  once the player responds. In the live, turn-driven game (not the pure one-shot sim), a
  meaningful amount of real time and player action can occur between the draw and the
  resolution — including, per feature 0061, a SELF-EVICTION by the player or (per the
  eligibility rules elsewhere) another houseguest becoming unavailable. Nothing re-validates
  that every id in the frozen `candidates` list is still a living, eligible houseguest at the
  moment `applyDecision` actually consumes the pick — it is the CALLER's job in
  `GameSessionAdapter`/`liveSeason.applyDecision` to have not created that gap, and a scan of
  `liveSeason.ts:1728-1745` (the `houseguests-choice` case in `applyDecision`) shows it trusts
  the `req.choice` against `s.pending.options` (the same frozen list) rather than re-checking
  liveness against `s.active` at resolution time.
- Fix: at minimum add a defensive re-check in `applyDecision`'s `houseguests-choice` branch
  that the chosen id is still in `s.active` (mirroring the liveness checks already present
  elsewhere, e.g. `runCompetition`'s "any caller-supplied id must be a LIVING houseguest"), and
  a test that self-evicting between the draw and the pick doesn't let the departed houseguest be
  selected into the veto field.

### [BE-13] [Severity: Minor] [Effort: <1hr] [Value: Low]
`hasPriorImageFor` re-scans the whole image-event log on every call
- Where: `src/adapters/engine/EngineCommandsAdapter.ts:405-414`.
- Problem: `this.events.query({ type: "image-shown" }).some(...)` is a full linear filter/scan
  of every image-generation event ever recorded for the sandbox, run on every single
  `recordImageBeat` call (once per image shown to the player). The same file already has a
  deliberate incremental-cache pattern for an analogous "has this already happened" style
  question (`currentBeatKey`'s `beatKeyCache`, explicitly built to avoid exactly this class of
  O(events) rescan — see its own comment about the "season-length latency tail"). A season with
  many portrait regenerations (cast reshoots, the studio's "regenerate" per CLAUDE.md's
  portrait-lane description) will pay this cost repeatedly; likely small in absolute terms
  (image events are a small fraction of the log) but inconsistent with the file's own stated
  performance discipline elsewhere.
- Fix: maintain a `Set<EntityId>` of houseguests with at least one prior image, populated
  incrementally alongside `imageTurnCount`/`imageWeekCount`, instead of re-querying the event
  log each time.

### [BE-14] [Severity: Minor] [Effort: <1day] [Value: Med]
No guardrail ties `IMPLEMENTED_TWISTS` to `RESERVE_POOL` — see BE-3 for the concrete impact
- Where: `src/engine/reserveTwists.ts:17`, `src/adapters/engine/GameSessionAdapter.ts:342`.
- Problem: (see BE-3 for the current dilution effect) — this entry specifically flags the
  MAINTENANCE gap: there is no compile-time or test-time assertion that every kind in
  `RESERVE_POOL` is either present in `IMPLEMENTED_TWISTS` or explicitly documented as
  reserved-for-later, so the drift between "what the type system advertises" and "what the live
  loop can run" can only widen silently as more twist kinds are added to the pool for future
  work.
- Fix: a small unit test asserting `RESERVE_POOL.every(k => IMPLEMENTED_TWISTS.has(k) ||
  DOCUMENTED_UNIMPLEMENTED.has(k))`, forcing any future pool addition to make an explicit
  choice.

### [BE-15] [Severity: Polish] [Effort: <1hr] [Value: Low]
Naming collision between the reserve-twist "secret-power" and the built 0093 "secret power" (leverage) feature
- Where: `src/engine/reserveTwists.ts:14` (`TwistKind = "secret-power" | ... `);
  `src/adapters/engine/GameSessionAdapter.ts:5810` ("0093 — the secret-power per-moment seeded
  rng...").
- Problem: these are two completely unrelated systems that happen to share the exact phrase
  "secret power": the reserve twist is a production-style special-power twist (never
  implemented, per BE-3); the 0093 feature is the fully-built "wield a learned secret as
  leverage in a deal" mechanic. A reader grepping for "secret power" (as this audit did) gets
  both and has to read carefully to realize they're unrelated. Low risk today, but a real trap
  for a future implementer tasked with "finish the secret-power twist" who might assume 0093
  already covers it (it doesn't — 0093 has nothing to do with reserve twists or Vault-sealed
  production surprises).
- Fix: rename the twist-pool kind to something unambiguous (e.g. `"immunity-power"` or
  `"instant-safety"`) before ever implementing it, to avoid the collision.

---

## COVERAGE — what was read vs. not

**Read closely (full or near-full file read):** `src/domain/eligibility.ts`,
`src/domain/competitionOutcome.ts`, `src/domain/knowledge.ts`, `src/domain/deal.ts`,
`src/engine/season.ts`, `src/engine/jury.ts`, `src/engine/decisions.ts`, `src/engine/blocs.ts`,
`src/engine/gossip.ts`, `src/engine/consequence.ts`, `src/engine/deals.ts`,
`src/engine/reserveTwists.ts`, `src/engine/leverage.ts`, `src/engine/timeOfDay.ts`,
`src/engine/campaigns.ts` (partial — first ~120 lines), `src/engine/confessionals.ts` (partial
— first ~100 lines), `src/engine/presence.ts` (partial — first ~140 of 431 lines),
`src/adapters/engine/EngineCommandsAdapter.ts` (full, 415 lines),
`src/adapters/inmemory/InMemoryKnowledgeService.ts` (full), `src/adapters/inmemory/
InMemoryEventStore.ts` (full), `src/adapters/sqlite/SqliteSaveStore.ts` (full),
`src/adapters/sqlite/SqliteVectorIndex.ts` (full), `src/adapters/mcp/McpServer.ts` (full),
`src/composition/engineRoot.ts` (full), `src/engine/liveSeason.ts` (large sections: state
shapes, eviction/vote/jury/tie-break/self-eviction/clock logic — roughly 700 of 1845 lines),
`src/engine/momentPrompts.ts` (first ~220 of 1128 lines — the base GM prompt), `src/engine/
characterFactory.ts` (targeted: `uniqueName` + function index).

**Delegated to sub-agents (their own coverage notes are in their sections below):**
`src/adapters/engine/GameSessionAdapter.ts` (7378 lines — cross-referenced for the four-place
write-back wiring, beatSeq/409 handling, eligibility edge cases), `src/adapters/mcp/
HttpMcpServer.ts`, `src/surfaces/tools/registry.ts`, `src/ports/GameSession.ts`/
`EngineCommands.ts`, `src/composition/registry.ts` (cross-user isolation angle),
`src/composition/orchestrator.ts`; on the FE side: `frontend/src/agent_loop.py`,
`frontend/routes/chat_helpers.py`, `frontend/src/orwell_outcomes.py`, `frontend/src/
orwell_sync_ledger.py`, `frontend/src/orwell_engine.py`, `frontend/src/orwell_game_session.py`,
`frontend/src/token_policy.py`, `frontend/src/settings.py` (game-related flags only),
`frontend/src/orwell_cast_authoring.py`/`orwell_prewarm.py`/`orwell_zeitgeist.py`,
`frontend/src/orwell_token_ledger.py`, `frontend/src/tool_implementations.py` (game tools only).

**NOT reviewed at all (explicit gap — genuinely out of budget, not "looked and found
clean"):** `src/engine/characterFactory.ts` (~950 of 1075 lines unread — the appearance/
backstory/hidden-element generation bodies), `src/engine/diversity.ts` (518 lines, unread),
`src/engine/houseSuspicion.ts`, `src/engine/suspicion.ts`, `src/engine/houseEvents.ts`,
`src/engine/secretPacing.ts`, `src/engine/seededTieSurfacing.ts`, `src/engine/trajectory.ts`,
`src/engine/triggers.ts`, `src/engine/confidence.ts`, `src/engine/alliances.ts`,
`src/engine/calibration.ts`, `src/engine/simulation.ts`, `src/engine/schedule.ts`,
`src/engine/richness.ts`/`richnessConfig.ts`, `src/engine/voice.ts`, `src/engine/zeitgeist.ts`,
`src/engine/producerPersona.ts`, `src/engine/diaryRoom.ts`, `src/engine/emotionalArc.ts`,
`src/engine/gameProgression.ts`, `src/engine/deepProfile.ts`, `src/engine/castingIntake.ts`,
`src/engine/competitionLibrary.ts`, `src/domain/house.ts`, `src/domain/gender.ts`,
`src/domain/physicalCharacteristics.ts`, `src/domain/voiceProfile.ts`, `src/domain/humanize.ts`,
`src/domain/saveState.ts`, `src/domain/temperature.ts`/`temperatureConstants.ts`, all of
`src/adapters/narrative/*` (the LLM adapter + `DeterministicNarrator`/`EchoNarrativePort`),
`src/adapters/embedding/*` (fastembed worker + bridge), `src/adapters/random/SeededRandom.ts`,
`src/adapters/time/*`, `src/adapters/inmemory/InMemoryGameStateRepository.ts`,
`src/adapters/inmemory/InMemorySaveStore.ts`, `src/adapters/inmemory/
InMemoryVectorIndex.ts`, `src/adapters/inmemory/InMemoryVaultStore.ts` (peeked only — not
closely read), `src/adapters/engine/FileSaveStore.ts` (grepped only, not fully read),
`src/adapters/engine/SoulStore.ts` (grepped only), `src/adapters/engine/decisionFields.ts`,
`src/adapters/engine/humanize.ts`, `src/composition/appRoot.ts`/`outwardRoot.ts`/`runtime.ts`
(grepped only), `src/composition/gameWatcher.ts` (grepped only), `src/surfaces/admin/
AdminPort.ts`, `src/surfaces/player/*`, `src/services/SummaryService.ts` (grepped only). On the
FE side, the entire remaining ~150 files under `frontend/src/` and `frontend/routes/` outside
the game-specific slice the sub-agent covered (all the generic chat-workspace plumbing —
email, calendar, documents, RAG, MCP manager, etc. — out of scope for this lane by the
charter's own framing, but noted for completeness).

Given the size of `src/engine/` (~130 files) and `src/adapters/engine/GameSessionAdapter.ts`
alone (7378 lines — larger than this entire lane's other files combined), this pass should be
read as a first deep sweep, not an exhaustive one; the unreviewed list above is a reasonable
target for a follow-up pass, particularly `characterFactory.ts`/`diversity.ts` (cast-distinctness
correctness, I6) and `secretPacing.ts`/`trajectory.ts`/`triggers.ts` (the newest, least-audited
0087-0092 layer, compounded by BE-1's finding that they don't even run today).

---

## SUB-AGENT A — MCP boundary / GameSessionAdapter / write-back wiring

### [BE-101] [Severity: Major] [Effort: <1day] [Value: High]
Unvalidated `consequence.edges[].direction`/`emphasis` enum values crash the request or silently write NaN into the permanent hidden relationship layer
- Where: `src/adapters/mcp/McpServer.ts:70-78` (requireShape only checks `typeof === "string"`, never enum membership); `src/engine/consequence.ts:139-141` (`foldGenerativeConsequence`); `src/engine/relationshipConstants.ts:144-148` (`scaleImpact`) and `:252-261` (`CONSEQUENCE_DIRECTION_IMPACTS`); `src/engine/relationships.ts:147-166` (`applyOneDirection`/`clamp01`)
- Problem: `recordInteraction`'s optional `consequence` descriptor (ADR 0005, the generative fold path a live LLM populates) carries `direction: ConsequenceDirection` and `emphasis: ConsequenceEmphasis` — TypeScript closed-set types, but the MCP boundary (`requireShape`, McpServer.ts:66-81) only checks each is *a string*, never that it is one of the recognized literal values. Downstream, `foldGenerativeConsequence` does `CONSEQUENCE_DIRECTION_IMPACTS[e.direction]` and `CONSEQUENCE_EMPHASIS[e.emphasis ?? "notable"]` with no fallback: (a) an unrecognized `direction` (e.g. an LLM writes `"much-warmer"` instead of `"warmer"`) makes `base` `undefined`, and `scaleImpact(undefined, factor)` calls `Object.entries(undefined)`, which throws `TypeError: Cannot convert undefined or null to object` (verified) — an uncaught exception the transport maps to a bare 500. Because the throw happens *after* `this.events.record(...)` already appended the scene to the event log but *before* `this.onPersist?.()` runs, the "failed" call is not actually a no-op: the phantom event (and any relationship folds already applied for earlier, valid edges in the same array) stays live in the sandbox and gets silently absorbed into the very next successful commit. (b) an unrecognized `emphasis` (e.g. `"extreme"`) makes `factor` `undefined`; `v * undefined = NaN` in `scaleImpact`, and `clamp01(NaN)` is `NaN` — so `e.trust`/`e.affinity`/`e.threat`/`e.alignment` on that edge become permanently `NaN` with **no error at all**. NaN then propagates through every future arithmetic update on that edge for the rest of the season (competition modifiers, jury reads, gossip weighting), silently corrupting core hidden game state — breaching mandate #3 (caller-controlled garbage becomes an undefined magnitude) and mandate #4 (persisted detail must never corrupt). The sibling `kind`-only path already guards this exact class of bug (`INTERACTION_KINDS.has(req.kind)` gates use of `kind`), so this is a regression/gap specific to the newer ADR-0005 generative path. Existing tests (`tests/integration/edgeHardening.test.ts:171-172`) only check for *missing* `toward`/`direction` fields, not invalid *values*.
- Fix: In `requireShape`'s `consequence.edges[]` loop, validate `direction` against the literal `ConsequenceDirection` set and `emphasis` against `slight|notable|strong` (refuse with `EngineRefusal` on an unrecognized value, matching the pattern already used for `kind`). Defense-in-depth: also make `foldGenerativeConsequence` skip/no-op an edge whose `direction`/`emphasis` doesn't resolve to a known constant, instead of indexing a lookup table with no fallback.

### [BE-102] [Severity: Major] [Effort: <1hr] [Value: High]
`recordInteraction`'s `toward` field (both the flat form and inside `consequence.edges[]`) bypasses the B39 living-houseguest validation, letting a caller fold a relationship change onto an evicted/jury houseguest or an invented id
- Where: `src/adapters/engine/EngineCommandsAdapter.ts:166-171` (the B39 liveness loop validates only `req.initiator` + `req.witnessSet`), `:266-274` (`partnerNames = req.toward ?? …` used unchecked), `:240-260` (`foldGenerativeConsequence(..., genEdges, spend)` where `spend` never checks liveness)
- Problem: The code comment at EngineCommandsAdapter.ts:164-165 states "an interaction may only name LIVING houseguests — never an evicted or invented one," and the loop enforces this for `initiator` and every id in `witnessSet`. But `req.toward` ("Whose hidden opinion of the initiator moves") and the ADR-0005 `consequence.edges[].toward` are *never* checked against `this.livingProvider()`. `session.livingIds()` explicitly excludes every evicted houseguest — including jurors — from "living," so a scene's `witnessSet`/`initiator` can never legitimately reference a juror. Yet a caller can still pass e.g. `{ initiator: PLAYER, witnessSet: [PLAYER], kind: "betrayal", toward: ["<a-juror's-id>"] }` and `foldHiddenImpact`/`rel.applyImpactDirected` will apply the fold anyway (relationship edges are lazily created on any id, alive or not) — moving that juror's hidden opinion of the player with **no actual scene, no witness, no in-game pathway**. Since jurors' relationship-derived reads feed the deterministic jury vote at the finale (I2/I4: outcomes must come from the deterministic core over genuine recorded history), this is a real side-channel that lets a hallucinating or adversarial LLM tool call directly tilt jury sentiment, bypassing the entire "the conversation is the game" / witnessed-event model. It also lets a caller name a wholly invented id, silently seeding a garbage relationship edge that persists forever. Every sibling targeting mechanism in the same file *does* enforce liveness on its target — `makeDeal`'s `with` (`isActiveOther` check), `formAlliance`'s `members`, and `resolveWieldedSecret`'s `subject` for `exposeSecret`/`tradeSecret` (`isActiveNpc`) — confirming this is an inconsistency/oversight rather than an intentional design choice.
- Fix: Include every id in `req.toward` (and every `edges[].toward` in the `consequence` descriptor) in the same B39 `living` validation loop (or filter them through `this.livingProvider`/an `isActiveNpc`-equivalent before they reach `foldHiddenImpact`/`foldGenerativeConsequence`), consistent with `makeDeal`/`formAlliance`/`exposeSecret`.

### [BE-103] [Severity: Minor] [Effort: <1hr] [Value: Low]
`worldSnapshotView()` is fully implemented but wired to nothing — an unreachable read endpoint (partial four-place wiring, read side)
- Where: `src/ports/GameSession.ts:1699` (interface method); `src/adapters/engine/GameSessionAdapter.ts:7005-7017` (full implementation); `src/surfaces/tools/registry.ts` (no `worldSnapshotView` entry in `PLAYER_TOOLS`); `src/adapters/mcp/McpServer.ts` (no `requireShape` case, no `callTool` dispatch case, no import)
- Problem: `worldSnapshotView()` is a complete, documented, Vault-free projection of the 0062 move-in zeitgeist snapshot — implemented on `GameSessionAdapter` exactly like every other port method — but it was never added to `PLAYER_TOOLS`, never given a `requireShape` case, and never given a `callTool` dispatch case in `McpServer.ts`. A repo-wide search confirms zero callers anywhere (not the registry, not McpServer, not internally from `getMomentPrompt`/`momentPrompts.ts`, which builds its own player/off-screen zeitgeist fragments directly off `this.worldSnapshot` via a private `worldContext()` method instead). This is the mirror image of the documented `recordCastProfile`/`recordWorldSnapshot` four-place-wiring gotcha: steps "1-2 done" (port + adapter), steps "3-4 missing" (registry + McpServer) — except here nothing ever calls it, so it silently no-ops as fully dead, untestable code rather than causing a visible runtime failure.
- Fix: Either wire `worldSnapshotView` through the same four places as any other read tool (add to `PLAYER_TOOLS`, add a `callTool` case in `McpServer.ts`; no `requireShape` case needed, it takes no args) if a consumer is planned, or remove the dead port method/implementation if the moment-prompt-embedded zeitgeist (`worldContext()`) is the only intended reach channel.

**Sub-agent A coverage:** Reviewed in full — `src/ports/GameSession.ts`, `src/ports/EngineCommands.ts`, `src/surfaces/tools/registry.ts`, `src/adapters/mcp/McpServer.ts`, `src/adapters/mcp/HttpMcpServer.ts`, `src/adapters/engine/EngineCommandsAdapter.ts`, `src/composition/registry.ts`, `src/composition/orchestrator.ts`, `src/engine/deals.ts`, `src/domain/deal.ts` (partial); targeted sections of `GameSessionAdapter.ts` (beatSeq/idempotency machinery, decision-input mapping, pending-view rendering, alliance/deal/secret-power methods, cast-profile/cast-identity write-backs, world-snapshot methods, tagline/premiere helpers). NOT reviewed line-by-line: the bulk of ceremony/eligibility internals in `src/engine/liveSeason.ts` (HOH eligibility, veto Houseguest's-Choice chip logic, replacement-nominee/veto-winner rules, tie-break resolution — only the adapter's thin translation layer was seen), staged-competition presentation code, sleep/time-of-day economy, trigger-eruption/campaign/jury-house tick internals, `src/engine/consequence.ts`'s older `ConsequenceEngine` class (only the top of the file), `src/composition/engineRoot.ts`, `outwardRoot.ts`, `jsonRpc.ts`, `healthMetrics.ts` (not opened at all).

---

## SUB-AGENT B — FE Python game-glue audit

### [BE-201] [Severity: Major] [Effort: <1hr] [Value: High]
`DEFAULT_SETTINGS` bakes a flat `max_tokens_budget` for narration/casting, silently reintroducing the reasoning-model truncation vector on every fresh install
- Where: `frontend/src/settings.py:196-205` (`DEFAULT_SETTINGS["max_tokens_budget"]`) vs `frontend/src/token_policy.py:56-67` (`_DEFAULT_MAX_TOKENS`) and `frontend/src/agent_loop.py:3997-4009` (`_effective_max_tokens` resolution)
- Problem: `token_policy.py`'s own comments explain at length that narration/casting must default to `max_tokens: None` so the call site substitutes a generous model-aware cap — a flat literal "re-introduced the #835 truncation vector for reasoning models (deepseek-v4-pro counts reasoning+visible against max_tokens, so a flat 4096 truncated narration mid-reply)". But `settings.py`'s `DEFAULT_SETTINGS` seeds `"max_tokens_budget": {"narration": 4096, "casting": 2048, ...}` — its own comment even claims these "Defaults mirror `token_policy._DEFAULT_MAX_TOKENS`", which is false (that dict has `None` for narration/casting). Because `load_settings()` does `{**DEFAULT_SETTINGS, **saved}`, every fresh deployment's `get_setting("max_tokens_budget", {})` always returns a dict with narration=4096/casting=2048 already present. `resolve_token_policy` cannot distinguish "the operator explicitly chose 4096" from "nobody touched this key" — it treats the seeded default exactly like an "explicit, in-band admin override" (ADR 0010 #1), so `_effective_max_tokens` in `agent_loop.py` always takes the 4096/2048 branch and the `_model_max_output_tokens(model)` model-aware fallback path is dead code in production. Any admin who selects a heavy-reasoning model (deepseek-v4-pro, qwen3, etc. — all explicitly named in the surrounding comments as the failure mode) for narration or casting gets truncated mid-reply out of the box. Violates I2-adjacent narration integrity and directly contradicts the non-degradation intent behind this fix.
- Fix: remove "narration"/"casting" from `DEFAULT_SETTINGS["max_tokens_budget"]` (or seed them with a sentinel the resolver treats as "unset") so `get_setting` only returns an override once an admin actually edits it; add a regression test that exercises the REAL `load_settings()`/`get_setting()` path end-to-end (not a hand-built settings dict) to catch this class of defeat — the existing `test_narration_maxtokens_no_truncate.py` never touches `DEFAULT_SETTINGS` at all.

### [BE-202] [Severity: Major] [Effort: <1day] [Value: High]
The pre-emission/post-turn outcome guard's if/elif chain plus pre-commit-only tally scoping lets a fabricated vote tally slip through in the same beat as a real eviction
- Where: `frontend/routes/chat_helpers.py:1148-1236` (`_narration_claims_outcome`), specifically the eviction branch at `1171-1187` vs the tally branch at `1202-1211`
- Problem: `_narration_claims_outcome` is a single `if/elif` chain — only the FIRST matching claim category is ever evaluated for a given text. A narrated sentence that both correctly reports an eviction ("the house votes to evict Alex") AND fabricates a tally/majority claim ("...9-1", "unanimously") only gets checked against the eviction branch; once that branch decides the eviction itself is legitimate (count moved, correct evictee), `desync` stays `None` and the function returns early — the `elif` tally branch is never reached, so the fabricated tally is never held. Independently, that branch only fires when `after.get("evicted") == before.get("evicted")` (i.e., BEFORE the commit) — per the guard's own doc, "the engine's staged reveal hands over anonymized ballots only — it never gives a tally and never lets the player count to a result," yet a tally narrated in the SAME beat as the real commit (a very natural place for a model to say "by a vote of 9 to 1...") is architecturally exempt from the check on two independent grounds. This is called both pre-emission (`screen_streamed_outcome`, streamed per-sentence) and post-turn — same detector, same gap — so a phantom/never-revealed vote count can reach the player screen. Violates I2 (engine decides outcomes) and the explicit secret-ballot mandate.
- Fix: decouple the claim checks so each `_CLAIM_*` category is evaluated independently (collect all matches instead of short-circuiting on the first `if`), and drop the `after.get("evicted") == before.get("evicted")` precondition from the tally/majority branch during the eviction phase — a numeric/majority tally is a fabrication whether or not the commit already landed, since the engine never reveals one at all.

### [BE-203] [Severity: Major] [Effort: <1hr] [Value: Med-High]
The 0081 active-faithfulness "reframe"/"reground" correction silently no-ops on every single-tenant deployment
- Where: `frontend/src/agent_loop.py:2478-2493` (`_faith_queue_reground`), used by `_do_reframe`/`_do_reground` at `2568-2581`
- Problem: every other guard in this desync family (`record_post_turn_desync_check`, `screen_streamed_outcome`, `screen_streamed_nominee`, `record_post_turn_presence_check`) keys its per-turn `_DESYNC_REGROUND`/`_LAST_BEAT_SIG` state via `_desync_key(user)`, specifically because — per that function's own comment — "keying the baseline on `None` makes the guard EFFECTIVELY INERT" under `AUTH_ENABLED=false` single-tenant deploys (the #1045 fix). `_faith_queue_reground` was never updated to use `_desync_key`: it indexes `_DESYNC_REGROUND` by the raw `owner` and does `if store is None or owner is None: return False` — i.e. it unconditionally refuses to queue anything when `owner is None`. Since single-tenant mode (the mode ADR 0014's local/LAN HTTPS deploy targets) always has `owner=None`, the 0081 "active" faithfulness mode's `adopt`-lever recording still fires (it doesn't go through this function), but the `reframe`/`reground` levers — the ones meant to steer the model back onto a closed-set-consistent narration after a detected slip — are permanently dead for that whole deployment mode. The judge still detects and logs the slip, but the correction never reaches the model, so "active" mode silently degrades to "shadow" mode for closed-set slips, single-tenant only.
- Fix: route `_faith_queue_reground` through `routes.chat_helpers._desync_key(owner)` exactly like its siblings, dropping the `owner is None` bail.

### [BE-204] [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
The 0065 Part D sync ledger (`orwell_sync_ledger.py`) is write-only in production — no route ever reads it
- Where: `frontend/src/orwell_sync_ledger.py:245-259` (`get_recent`), written from `frontend/src/agent_loop.py:3066`
- Problem: `record_turn` is called every turn and does a locked, atomic JSON-file write per turn (bounded to 200 entries/user). Its sibling `orwell_token_ledger.get_recent` is consumed by `frontend/routes/admin_health_routes.py:555` for an admin view, but grepping the whole `frontend/` tree shows `orwell_sync_ledger.get_recent`/`clear` are called ONLY from test files — no admin route, no UI, exposes the structured per-turn data (beatSeqBefore/After, nudgesFired, autoBackfills, staleRejections, idempotencyHits) anywhere. The only externally-visible effect is the flattened `logger.info` line, which the log-ring viewer does surface — but the whole point of persisting a structured JSON entry (vs. just logging) is to support querying/filtering that never got wired up.
- Fix: either wire an admin route/panel that calls `get_recent` (mirroring `admin_health_routes.py:555`'s token-ledger pattern), or if the structured store was superseded by the log-ring approach, drop the per-turn `atomic_write_json` call and keep only `_log_line` to stop paying an unread disk-write cost every turn.

### [BE-205] [Severity: Major] [Effort: <1day] [Value: High]
The presence/identity desync guard's verb list includes words that are common idioms for off-screen strategic narration, risking false-positive re-ground nags against exactly the "off-screen NPC-to-NPC scheming" behavior the game is mandated to produce
- Where: `frontend/routes/chat_helpers.py:1301-1329` (`_SCENE_VERBS` / `_stages_in_scene`), consumed by `record_post_turn_presence_check` (`1391-1415`)
- Problem: `_SCENE_VERBS` includes "leans"/"lean"/"leaning"/"leaned" and "watches"/"watch"/"watching"/"watched" as physical in-scene staging verbs, matched whenever a houseguest's name appears within ~2 words before one of them (`_stages_in_scene`). But "leaning" is also the standard idiom for a houseguest's strategic inclination — e.g. "Marcus is leaning toward flipping the vote" or "the house is leaning toward evicting Priya" — a completely legitimate, mandate-encouraged description of an ACTIVE but off-screen houseguest's game state (mandate I7: "off-screen NPC-to-NPC scheming the player never witnesses"). Because `_stages_in_scene` doesn't distinguish the idiomatic sense from a physical-presence claim, and the guard flags any `active_offscene` houseguest matched this way (not just evicted ones — a much more frequently true condition), a perfectly correct narration turn describing off-screen scheming gets a spurious "RE-GROUND ON WHO IS IN THE ROOM" directive injected into the NEXT turn's prompt, nagging the model to stop doing exactly what it was mandated to do. The guard's own design goal states "HIGH-PRECISION by construction (a false positive nags the model on a clean turn)" — this verb collision undermines that goal on what is likely a common phrasing.
- Fix: drop "leans"/"lean"/"leaning"/"leaned" (and audit "watches"/"watching" similarly) from `_SCENE_VERBS`, or require an adjacent physical-location cue (e.g. "leaning against the X") rather than a bare name+verb match, before treating it as a staged-in-scene claim.

### [BE-206] [Severity: Minor] [Effort: <1hr] [Value: Med]
`_model_max_output_tokens` is Anthropic-only despite being used as the generic "model-aware" fallback for every provider
- Where: `frontend/src/llm_core.py:598-625`, consumed generically at `frontend/src/agent_loop.py:4004-4007`
- Problem: the function's docstring and call sites describe it as "the model-aware DEFAULT output cap" used whenever no explicit override exists (`agent_loop.py`'s `_effective_max_tokens`, reached today only if BE-201 is fixed, or already reached for any admin who has cleared their `max_tokens_budget` override). But `_ANTHROPIC_OUTPUT_CAPS` only recognizes Claude-family substrings ("haiku-3", "claude-3-5", "opus-4", "sonnet-4", "haiku-4"); every other model this product actually ships with as default or recommends (z-ai/glm-4.7 the OOB default, deepseek/deepseek-v4-pro, qwen3, etc. — all explicitly named elsewhere in the codebase as the reasoning models this whole mechanism was built to protect) falls through to the flat `_DEFAULT_OUTPUT_TOKENS = 8192`. 8192 is not obviously "generous" headroom for a heavy interleaved-reasoning model's combined reasoning+visible budget (the same failure class the surrounding comments describe for 4096) — it is just a different flat constant with a "model-aware" name that doesn't actually vary for the majority of supported providers.
- Fix: extend the sizing table (or query a models-metadata source) to cover the actual default/recommended non-Anthropic models, or rename/document the function to make clear it only differentiates within the Anthropic family and pick a larger, still-safe universal floor (e.g. 16k+) for everything else.

### [BE-207] [Severity: Minor] [Effort: <1hr] [Value: Low]
Calibration outcome logging undercounts a player's public competition wins on past-tense recap phrasing
- Where: `frontend/routes/orwell_routes.py:250-263` (`_count_player_comp_wins`)
- Problem: the function only matches lines that `str.startswith(needle + " wins ")` (present tense, player-name-first). If `season_recap`'s `highlights` ever phrases a win in the past tense ("Jordan won the Power of Veto") or in a different word order, the player's `competitionWins` field silently comes out as 0 for that win in the append-only `orwell_outcomes.json` log — the one piece of data this instrumentation feature exists to get right. Not player-facing (admin/instrumentation only), but a quiet accuracy bug in a feature whose entire value is data fidelity.
- Fix: widen the match to accept "wins"/"won" and don't require the win phrase to be the very first token of the line (search for the player-name + comp-name co-occurrence instead of a strict prefix).

### [BE-208] [Severity: Minor] [Effort: <1hr] [Value: Low]
`_backfill_with_cas`'s retry-once semantics can mask a second, unrelated failure as a plain "skip"
- Where: `frontend/src/agent_loop.py:1978-2019`
- Problem: on a second consecutive `StaleBeatError` the function reconciles and returns `None` (documented as "re-derivable next turn"). But `None` is also the sentinel `_auto_record_scene`/`_auto_move_player`/etc. use for "nothing to do" in several other early-return paths (e.g. no roster, no valid ids). A caller cannot distinguish "the board raced twice and we gave up" (worth escalating/logging louder, since it means a real concurrent-write conflict) from "there was nothing worth recording this turn" (the common, benign case) — both just log at info/warning and silently move on. Given mandate #4 ("a novel move must never evaporate") is the explicit reason the retry-once logic exists, a double-stale scene loss deserves a distinguishable signal rather than folding into the same code path as "nothing happened."
- Fix: have `_backfill_with_cas` return a small tagged result (e.g. a 3-state enum: applied / no-op / evaporated-on-race) so callers can log the race-loss case distinctly, and consider surfacing it on the `log_rings` overseer channel the way `_auto_record_scene`'s "no parseable JSON" gap already is.

### [BE-209] [Severity: Polish] [Effort: <1hr] [Value: Low]
Documentation/behavior mismatch: `reasoning_budget` default comment vs. `token_policy` default
- Where: `frontend/src/settings.py:170-187` vs `frontend/src/token_policy.py:38-45`
- Problem: `settings.py`'s `DEFAULT_SETTINGS` seeds `"narration": "low"` with a comment explaining the ADR 0016 GLM-4.7 rationale for departing from `token_policy`'s own class default of `"medium"`. This one is intentional and documented (unlike BE-201's max_tokens case) — but the two modules now have permanently-diverging "defaults" for the same class with no single source of truth, which makes `token_policy._DEFAULT_EFFORT`/`_DEFAULT_MAX_TOKENS` read as misleading documentation of what the shipped defaults actually are. Not a functional bug, but the exact kind of divergence that produced BE-201.
- Fix: either have `settings.py` import its per-class defaults from `token_policy.py`'s constants (single source of truth) or add an explicit cross-reference comment in `token_policy.py` pointing at `settings.py`'s `DEFAULT_SETTINGS` as the actually-effective values.

### [BE-210] [Severity: Minor] [Effort: <1day] [Value: Med]
The wrong-nominee guard's first-name matching can produce a false negative when two active houseguests share a first name
- Where: `frontend/routes/chat_helpers.py:1783-1809` (`_sentence_names_wrong_nominee`)
- Problem: the "don't flag" exemption treats a bare first-name match against the nominee set as legitimate ("first name collides with a real nominee's first name — don't flag"). If the active roster has two houseguests sharing a first name (e.g. "Jordan Vance" is a real nominee and "Jordan Reyes" is not), narration naming "Jordan" ambiguously in on-the-block language would be exempted from the guard even when it's actually "Jordan Reyes" being wrongly staged — because the exemption only checks whether the first-name token collides with a nominee's first name, not whether the specific full name being matched is itself the nominee.
- Fix: when a first-name collision exists between a nominee and a non-nominee, require the fuller context (surrounding surname or explicit disambiguation) before exempting, rather than exempting on any first-name overlap.

### [BE-211] [Severity: Polish] [Effort: <1hr] [Value: Low]
`resolve_token_policy` looks up admin overrides by the raw `call_class` rather than the resolved fallback class
- Where: `frontend/src/token_policy.py:137-153`
- Problem: `resolved_class = call_class if call_class in _DEFAULT_EFFORT else _FALLBACK_CLASS` picks defaults from `resolved_class`, but the two override lookups a few lines later (`overrides.get(call_class)`, `mt_overrides.get(call_class)`) key off the original, possibly-unknown `call_class` instead of `resolved_class`. Harmless today (no caller passes an unknown class), but it's an inconsistency that would silently misbehave the moment a new call class is introduced with a typo'd name that happens to collide with an override key.
- Fix: use `resolved_class` consistently for both the default lookup and the override lookup.

**Sub-agent B coverage:** Reviewed closely — `frontend/src/agent_loop.py` (desync/faithfulness/backfill sections), `frontend/routes/chat_helpers.py` (~lines 960-1850, 2197-2400 — the desync/outcome/presence/nominee/location guards), `frontend/src/orwell_outcomes.py`, `frontend/src/orwell_sync_ledger.py`, `frontend/src/orwell_engine.py`, `frontend/src/orwell_game_session.py`, `frontend/src/token_policy.py` (full), `frontend/src/settings.py` (DEFAULT_SETTINGS + load/get_setting, lines 1-230, 525-600), `frontend/src/orwell_cast_authoring.py` (core machinery, ~lines 1-920), `frontend/src/orwell_token_ledger.py`, `frontend/src/llm_core.py` (token-cap sizing). NOT fully reviewed: the rest of `chat_helpers.py`'s ~2000 remaining lines (session resolution helpers, non-guard framing, unrelated routes), `frontend/src/settings.py`'s remaining ~450 non-Orwell lines, `frontend/src/orwell_cast_identity.py`, the finale/jury choreography FE code, `frontend/src/faithfulness.py` internals (only inferred from call sites), and no live runtime tracing (static analysis only, per read-only instructions).

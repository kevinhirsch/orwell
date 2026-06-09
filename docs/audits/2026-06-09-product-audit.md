# Orwell full product audit — 2026-06-09

Scope: the entire repo — spec corpus (docs/, all 44 feature specs, the legacy Bible), engine
(`src/domain`, `src/engine`), runtime/composition/adapters (`src/composition`, `src/adapters`,
`src/surfaces`), and the front-end player journey (`frontend/`). Conducted as four parallel
deep audits (spec/vision, engine game design, runtime wiring/security, front-end UX),
synthesized and de-duplicated here.

**Baseline:** every existing gate is green — 248 unit/property/arch, all BDD scenarios, 148
front-end pytest. **Nothing below is a failing test.** Every finding is *unasserted* behavior:
a gap between the code and the game's own vision/mandates.

**What's verifiably solid (no findings):** the in-process Vault Wall structure
(`engineRoot`/`outwardRoot` split, `readsVault:false` literal allowlist, hex-encoded user dirs
foreclosing path traversal), in-process per-user isolation (0021), the fail-closed rollback
mechanism itself, the reveal-gated `finaleView` projection, the event mislabel guard, the
server-side game-build gating (drop-set routers never mount; shell 404s proven), front-end
memory/RAG genuinely off under the game build, and the moment prompt injected on both chat
paths.

## Remediation principles (the preferred "how")

The per-finding *Fix:* lines below are all instances of seven architectural patterns. An
implementer should reach for these first; a fix that fights one of them is probably the wrong
fix.

1. **One authority per outcome class.** The live loop (`liveSeason.ts` via `advanceGame`) is
   the *sole* resolver of competitions, ceremonies, and votes. Every other tool that touches
   an outcome (`runCompetition`, `resolveCompetition`) becomes a delegate/replay of the loop's
   already-resolved result — never a second resolver with its own RNG stream. If two code
   paths can each produce a winner, one of them is a bug.
2. **Everything binding goes through the pending-decision seam.** All new player agency —
   tie-break, Houseguest's Choice, competition intent, the F3 final eviction, the finale
   kinds — is expressed as new `pending` kinds on the existing 0034
   `advanceGame`/`submitDecision` contract (engine pauses, returns the legal option set,
   validates the choice, resumes). No new decision mechanisms; no decision ever parsed from
   prose.
3. **Engine-validated references in, projections out.** Tool inputs are *ids the engine
   resolves*, never caller-supplied content: stats come from the live house, surfaced facts
   must reference a recorded hidden event/fact the claimed teller actually holds, witnesses
   must be living houseguests. The narrator supplies *which*, the engine supplies *what*.
4. **Folds live in the commit path; magnitudes live in constants modules.** Hidden
   consequences are applied where persistence already happens (the session commit /
   orchestrator apply), driven by named constants (`relationshipConstants.ts`,
   `temperatureConstants.ts`, a new `juryConstants.ts`) — never inline literals, never in
   adapters, never at the narrator's discretion.
5. **The orchestrator becomes the real spine.** Player-mutating tool calls route through (or
   at minimum `touch`) `Orchestrator.advance`, so the fail-closed integrity checkpoint, idle
   gating, turn-driven off-screen ticks, and health telemetry all fall out of one routing
   change rather than four separate features.
6. **The snapshot is the contract.** Any state the live game holds — knowledge, suspicions,
   id/ts counters, twist state, emotional state — either round-trips through a *versioned*
   `SessionSnapshot` and surfaces in `toGameState` (so the checkpoint can guard it), or it
   effectively doesn't exist. Adding live state without extending the snapshot is the bug
   class behind C2/C3/I7.
7. **Gates measure the production path.** Sentinels are embedded at generation time into the
   registry-built object graph the resolver actually serves; richness is computed from the
   real EventStore over the live spine; drift tests pin prompt ↔ tool registry ↔ front-end
   schemas to each other. A test that proves a property about a fixture proves nothing.

Front-end corollary: under the game build, **fail closed for game content, fail open for the
shell** — an unreachable engine yields a diegetic holding state, never a generic assistant
continuing the story from context.

## The six systemic findings

1. **The consequence loop has a hole at its center.** Nominations, veto saves, replacements,
   and eviction votes — the most consequential acts in the game — fold **zero** hidden
   relationship impact on the live path. The 0023 backbone covers free-form chat but not the
   ceremonies.
2. **Anti-sycophancy is prompt-enforced at four seams.** `runCompetition` and the live loop
   are two unconnected resolvers (the narrator can announce a different winner than the
   binding one); `resolveCompetition` trusts caller-supplied stats; `surfaceInformationTo`
   accepts unanchored "facts"; `recordInteraction` lets the narrator pick the direction of
   hidden moves. "Don't rely on prompt wording" is a hard do-not — these rely on it.
3. **The endgame is broken at every layer.** Final 3 isn't modeled; a player HOH never breaks
   a tied vote (the engine votes *for* them using hidden edges); the player is exempt from
   eviction-manner so jurors structurally can't resent them; the finale is unplayable through
   the front-end (the relay rejects all finale decision kinds); and the player-evicted path —
   the game's most common ending — has no spec at all.
4. **The orchestrator is not the real spine.** Player turns bypass it entirely, so the
   fail-closed integrity checkpoint never runs on player actions, the idle gate is vacuous
   (off-screen scenes flood ~9/min, 24/7, even mid-conversation), and `TICK_MS=0` silently
   removes all off-screen life instead of re-anchoring it to turns.
5. **The network/disk boundary is soft.** The engine binds `0.0.0.0` with no auth and a
   spoofable identity header (cross-user isolation broken at the network edge); one corrupt
   save file crash-loops the engine for all users; the knowledge layer isn't in the durable
   snapshot at all (a silent non-degradation violation the checkpoint is structurally blind
   to).
6. **Fidelity machinery exists but is dead live.** The emotional modifier, competition
   intent, hidden elements, reserve twists, relationship decay/dispositions, suspicions, and
   the richness gates all run only in tests; live richness is measured against a fixture that
   rigs its own metric.

---

## A. Ground truth & anti-sycophancy

**A1 · CRITICAL · NEW — Two unconnected competition resolvers; narrated winner can contradict
the binding one.** `runCompetition` (`GameSessionAdapter.ts:418-438`) resolves over the full
roster (incl. **evicted** houseguests), accepts arbitrary caller `participantIds`, records no
event, folds nothing, persists nothing — while the real HOH/veto winner is computed
independently in `advanceGame` with a different RNG stream (`:253-257`). The GM prompt
instructs the model to use **both** (`momentPrompts.ts:76-84`, `:44-48`).
*Fix:* during a live game `runCompetition` delegates to the engine's already-resolved beat
(same winner, engine field only), records + persists a `competition` event; update the prompt.
*Acceptance:* `runCompetition` then `advanceGame` name the same winner; no evictee in any
pool; the win is in the event store and survives restart.

**A2 · CRITICAL · NEW — `createCharacter` silently wipes a started season.** The engine resets
unconditionally and persists (`GameSessionAdapter.ts:206-228`); `POST /api/orwell/new-game`
has no started-game check (`orwell_routes.py:106-120`); the tool is pinned on every agent turn
(`chat_routes.py:1123`) with only a prose warning; in single-user mode the narrator also holds
God Mode (`tool_execution.py:506-508`), so "reset my game" is one hallucination from data
loss.
*Fix:* engine-side guard (`started` ⇒ require explicit `confirmRestart`), 409 at the route,
restart routed through admin `manageSandbox reset`.
*Acceptance:* second `createCharacter` without the flag leaves state byte-identical; fresh
sandbox flow unaffected.

**A3 · MAJOR · NEW — `resolveCompetition` / `recordInteraction` trust the caller.**
`ResolveCompetitionReq.participants` carries caller-supplied **stats** resolved verbatim
(`EngineCommandsAdapter.ts:61-66`); `recordInteraction` lets the narrator choose
initiator/witnesses/kind/direction freely.
*Fix:* ids only — adapter resolves stats from the live house, rejects unknown/evicted ids;
validate witnesses are living houseguests; cap per-turn folds.
*Acceptance:* caller stats ignored (winner matches engine-stat resolution); interaction naming
an evictee refused.

**A4 · MAJOR · NEW — `surfaceInformationTo` accepts unanchored "facts" (spec + code).** No
spec or code pins the surfaced fact to a real recorded hidden event; the LLM can mint
knowledge and launder it as `told-by:npc:3`. It also never triggers a save
(`EngineCommandsAdapter.ts:68-71`).
*Fix:* amend 0002/0009 — a surfacing must reference an existing fact the claimed teller
actually holds (or an `overheard:<eventId>` that exists); otherwise record a *suspicion*; add
`onPersist`.
*Acceptance:* unanchored surfacing refused/downgraded; every player-known fact traces to a
recorded source.

**A5 · MAJOR · NEW — The player is exempt from eviction-manner.** `liveSeason.ts:209` skips
recording manner toward the player, so `juryLean`'s second-largest term (betrayed −0.6 /
blindsided −0.5) is structurally zero for the player-finalist while fully applying to NPC
finalists. Jury management — the signature mechanic — is inert against the player, in the
player's favor.
*Fix:* delete the exemption (the finale `mend` appeal already exists for redemption).
*Acceptance:* a juror the player blindsided votes for them measurably less across seeds.

**A6 · MAJOR · NEW — Finale appeal asymmetry: the engine plays the player's finale optimally.**
`runFinale` alternates jurors so each finalist answers ~4–5 of 9; `appealMade` back-fills
`bestAppeal` for every unasked pair *including the player's* (`liveSeason.ts:250-257`). Also a
canon conflict: CLAUDE.md says one question per juror *per finalist* (18); the Bible and code
say one per juror (9).
*Fix:* score unasked pairs as a neutral default (or ask both finalists per juror); resolve the
canon line.
*Acceptance:* player and NPC finalists scored symmetrically; player appeal choices affect all
(or a documented neutral-defaulted subset of) jurors.

## B. Endgame & player agency

**B1 · CRITICAL · NEW — Final 3 is not modeled; F5/F4 math is unspecced and degenerate.** At 3
active the loop runs a full nomination/veto week: HOH among 2, the only 2 others auto-nominated,
a meaningless 3-person veto, then `evictionVoters` = ∅ ⇒ a permanent 0–0 "tie" silently
resolved by `npcChoice(hoh)` (`liveSeason.ts:224-228`, `eligibility.ts:101-104`). The spec
side is equally broken: 0005 demands a veto field of *exactly six*, impossible at F5/F4; at F4
the veto holder should be the sole vote; F3 should be the final-HOH ceremony. The season's
climax plays as filler.
*Fix:* **draft feature 0045 "Endgame structure: Final 5→2"** — amend 0005 (field =
min(6, remaining); F4 sole-voter rule) and add the F3 final-HOH eviction as a binding
`submitDecision` (pending for the player; relationship-driven for NPCs, manner recorded).
*Acceptance:* seeded seasons reach F2 with every late-week ceremony legal; player-as-final-HOH
gets the decision; 0011/0034/0037 stay green.

**B2 · CRITICAL · NEW — A player HOH never breaks an eviction tie.** On a tie,
`npcChoice(s.hoh!)` fires even when the HOH is the player (`liveSeason.ts:178-182`), deciding
via the *hidden* player→NPC threat edges the player has never seen. Guaranteed at F3 (B1),
common at F5. The single most dramatic HOH power, silently removed — and the engine asserts
how the player feels.
*Fix:* `tie-break` pending decision kind through the 0034 seam.
*Acceptance:* engineered tie + player HOH ⇒ loop pauses; illegal pick refused; NPC HOH still
auto-resolves; restart mid-pending resumes.

**B3 · CRITICAL · NEW (relay) + KNOWN (UI) — The finale is unplayable through the front-end.**
The agent relay's `submitDecision` enum allows only
`nominations|veto-decision|replacement|eviction-vote` and hard-rejects everything else,
silently dropping `statement`/`appeal` (`tool_schemas.py:1319`,
`tool_implementations.py:4650-4653`); the engine no-ops on kind mismatch. Any player reaching
jury or Final 2 hits a dead stop — the season cannot be won. (The missing `finaleView` tool +
`orwellFinale.js` are the KNOWN B26/C11 items; the relay bug is NEW and independent.)
*Fix:* add the three finale kinds + `statement`/`appeal` params to the schema and relay; ship
B26/C11.
*Acceptance:* a front-end test drives `finale-statement → finale-answer → juror-vote` to a
crowned winner through chat alone.

**B4 · MAJOR · NEW — "Houseguest's Choice" auto-picks for the player.** The live loop passes
`chooseStrongestBond` unconditionally (`liveSeason.ts:368-371`), so when the *player* draws
the chip the engine picks using the player's hidden bond edges — canon agency removed, and the
"never assert how the player feels" rule inverted into action.
*Fix:* two-phase veto beat — player holder ⇒ `houseguests-choice` pending with the legal
candidate set.
*Acceptance:* seeded draw to the player pauses the loop; NPC holders unchanged; resolved field
includes the pick.

**B5 · MAJOR · NEW — Competition intent (compete / throw / play safe) never reaches the live
game.** Every live resolution constructs an empty `CompetitionIntents` (`liveSeason.ts:136`,
`GameSessionAdapter.ts:435`); the Bible mandates the declaration + immutability; the domain
even built the lock — on an always-empty map. Throwing comps is a load-bearing BB strategy.
*Fix:* `comp-intent` pending (default `compete`) before comps the player plays; thread into
`winnerOf`; amend 0034.
*Acceptance:* declared `throw` measurably lowers win rate across seeds; post-beat intent
refused.

**B6 · CRITICAL (spec) · NEW — The player-evicted experience is unspecced and unframed.** No
doc anywhere covers the game's most common ending: pre-jury eviction (game over? closure
beat?), the juror's sequester (what do they witness? juror epistemics are undefined — 0014's
"jurors observe the remainder" is flatly incompatible with the 0002 witness model), pacing of
spectating to the finale. Code-side, the projection never marks the player evicted
(`GameSessionAdapter.ts:441-463`) and no moment fragment frames spectating/jury.
*Fix:* **draft feature 0046 "Player eviction & the juror's seat"** — closure beat; defined
juror knowledge model wired into `KnowledgeState`; bounded spectate/fast-forward; then the
existing 0037 juror interactivity; add `player.status: active|jury|evicted` to the view +
jury/spectator moment prompts.
*Acceptance:* a season with the player evicted at any index completes; juror knowledge
provably contains only the defined pathway facts; Vault holds throughout.

**B7 · MAJOR · NEW — Eviction night has no choreography or goodbye messages.** The weekly
eviction — the show's defining beat, 13×/season — emits one line (`liveSeason.ts:403`); the
Bible specifies one-at-a-time vote reveals + goodbye messages (which feed jury manner). The
finale got staging (0037); evictions didn't.
*Fix:* **draft feature 0047 "Eviction night live"** — ordered per-voter reveal (revealed-only
tally), evictee goodbye beat, goodbye messages recorded as events feeding manner/jury lean.
*Acceptance:* reveal order engine-decided + seeded; no pre-reveal tally; a cold goodbye
measurably moves the evictee's juror lean.

**B8 · MINOR · NEW — Double-eviction semantics undefined.** One reign or two? Affects 0008 day
accounting, voter sets, jury order. Fold into the 0025 amendment (D6).

## C. The consequence & memory loop

**C1 · CRITICAL · NEW — Ceremony beats fold no hidden consequence.** `liveSeason.ts` only
*reads* relationships; nominations, veto saves, replacements, and eviction votes move no
trust/affinity/threat. `ConsequenceEngine.recordVoteAgainstPlayer`/`recordCompetitionWin`
exist with zero production callers. The acts that matter most are the only ones guaranteed to
have no consequence — the project's stated point, bypassed by its own weekly loop.
*Fix:* engine-owned `CEREMONY_IMPACTS` in `relationshipConstants.ts`, folded in the commit
path: nomination ⇒ nominee→HOH adverse; veto save ⇒ bond; replacement ⇒ betrayal-shock if
trusted; eviction ⇒ evictee→responsible + survivors' threat reads; comp win ⇒ threat▲.
*Acceptance:* player-HOH nomination via `submitDecision` adversely moves the nominees' hidden
edges toward the player; persists across restart; numbers never in any view.

**C2 · CRITICAL · NEW — The knowledge layer is not in the durable snapshot.**
`exportSnapshot` = core + events + relationships only; restore builds a fresh empty
`InMemoryKnowledgeService` (`registry.ts:68-81`); `toGameState` hardcodes `knowledge: []`
(`sessionSnapshot.ts:76`) so the 0031 superset checkpoint is structurally blind to the loss;
surfaced fact content lives only in the KnowledgeFact (the event says just
`"surfaced via ${pathway}"`). After a restart, everything houseguests told the player is gone
— a silent mandate-#4 violation.
*Fix:* serialize knowledge + suspicions (+ their seq/tick counters) into `SessionSnapshot`;
populate `toGameState().knowledge`; add `onPersist` to `surfaceInformationTo` (A4).
*Acceptance:* surface + DR entry → restart → both facts visible; checkpoint flags shrunken
knowledge; counts round-trip.

**C3 · MAJOR · NEW — Restore resets id/ts counters ⇒ duplicate event ids.**
`EngineCommandsAdapter.seq` and `InMemoryKnowledgeService.seq/tick` restart at 0 after import;
the store doesn't reject dup ids; `isSuperset` keys by id, so a post-restart save can "contain"
an old id that is actually a different event.
*Fix:* persist counters (or derive `max+1`); store throws on duplicate id.
*Acceptance:* pre/post-restart interactions get distinct ids + monotonic ts.

**C4 · MAJOR · NEW — Snapshots carry no schema version.** `JSON.parse` cast blindly; any shape
change makes old saves load subtly wrong (e.g. missing `finale.appeals` ⇒ mid-finale throw).
*Fix:* `snapshotVersion` + validate/migrate-or-fault in `loadLatest`/`importSnapshot`.

**C5 · MAJOR · NEW — Relationship decay & dispositions never run live.** `decay()` and
`setDisposition` have no production callers; dispositions aren't serialized. Neglect and
mean-reversion — half of 0026 — exist only in tests.
*Fix:* call `rel.decay(DECAY_RATE)` on week rollover; wire archetype→disposition at cast
generation; serialize.

**C6 · MINOR · NEW — First impressions are uniform noise labeled knowledge.** Uniform [0,1]
draws with confidence 0.5 (> the 0.3 knowledge threshold); archetype plays no role (a comp
beast isn't read as a threat).
*Fix:* seed near baseline, archetype-informed threat priors, confidence < knowledge threshold.

## D. The living house (behavioral fidelity)

**D1 · MAJOR · NEW — Live NPCs have no hidden elements at all.** The production
`CharacterFactory` generates none; "tons of hidden elements" exist only in the 0003 test stub
(`characters.ts` HIDDEN_POOL); `hiddenSurfaces()` has no production caller. The rare-reveal
treat loop cannot occur in a real game. (Distinct from 0041, which is soul *evolution*.)
*Fix:* `generateHouse` mints 3–6 seeded, typed hidden elements per NPC (secret motive,
pre-game tie, concealed aptitude, divergent persona), engine-side; wire `hiddenSurfaces` into
off-screen scenes/conversations.
*Acceptance:* property test on the live path — every NPC has ≥3; surfacing rate ≤ the 0028
constant; none in the player projection without a pathway event; seed-stable.

**D2 · MAJOR · NEW — The emotional modifier is structurally zero on every live competition.**
`emotionalState: 0.5` hard-coded for all competitors (`liveSeason.ts:135`, `season.ts:78`);
`emotionalModifier()` has no production callers; nothing ever updates a soul's emotional
state. The Luck-replacement ADR exists only in tests. (Comp-input wiring — distinct from
0041's storage.)
*Fix:* per-houseguest live emotional state seeded at baseline, moved by beats (nominated ⇒
down, win ⇒ up, ally evicted ⇒ down) via the 0028 constants; thread into `winnerOf`.
*Acceptance:* a nominee's veto win rate measurably below their calm baseline across seeds;
mean-reverts; seed-reproducible; survives restart.

**D3 · MAJOR · NEW — The richness gates measure a rigged fixture, not the live game.** The
0003 property tests run `simulateSeason` (no production callers), which force-sets `reveals=1`
if none surfaced — the test asserts its own input. The live game could drop to zero off-screen
life with every richness gate green.
*Fix:* re-point richness metrics at the live spine (drive `Orchestrator.advance` +
`advanceGame` over a seeded season, compute from the sandbox's real EventStore); delete the
back-stop.
*Acceptance:* richness thresholds hold over ≥20 seeds of production-path events; fails if
`defaultApply` stops recording typed scenes.

**D4 · MAJOR · NEW — Idle detection is vacuous; off-screen life floods 24/7 and dies at
TICK_MS=0.** `idleSince` returns −∞ for never-touched users and `touch` is never called live,
so every started sandbox gets 3 ticks/minute forever, even mid-scene (≈9 hidden scenes + 3
confessionals/min; with per-mutation full-snapshot saves this is also the disk story in E4).
And `ORWELL_WATCHER_TICK_MS=0` ("pure turn-driven") silently removes off-screen life,
confessionals, and drift entirely.
*Fix:* `touch` on every player tool call (E3); treat never-active as not-yet-idle; in
turn-driven mode trigger one bounded off-screen tick per player turn.
*Acceptance:* active users accrue no ticks until idle; idle users at most
`maxOffscreenTicksPerWake`; `tickEveryMs: 0` + N turns ⇒ hidden events still grow.

**D5 · MAJOR · NEW — Evicted houseguests keep living.** The off-screen pool, `socialInitiatives`,
and `runCompetition`'s default pool all ignore `evictionOrder` — evictees scheme, give
confessionals ("I need X gone"), and can "want a word with you" weeks after leaving.
*Fix:* filter all three pools.
*Acceptance:* no evictee id in scenes/confessionals/initiatives/comp pools post-eviction.

**D6 · MAJOR · NEW — Reserve twists never fire in a live game; double eviction has no
mechanics.** `loadReserveTwists`/`maybeFireTwist` are referenced only by tests/BDD; nothing in
composition loads or fires a twist, and `double-eviction` is a label with no math anywhere.
*Fix:* load twists into the sandbox Vault at `createCharacter`; check `maybeFireTwist` at week
rollover; implement double-eviction as a compressed second cycle with the hard rules reused;
define week/jury-order semantics (B8).
*Acceptance:* seeded game fires its sealed twist exactly once; invisible to player + admin
until fired; eligibility + arc invariants hold within the compressed cycle.

**D7 · MAJOR · KNOWN-adjacent — NPC strategy is flat threat-max beyond the queued scope.**
Nominations/replacement/votes are pure threat compares; veto save is a bare `trust > 0.6`;
jury lean trust+affinity; no NPC ever throws a comp. 0043/0044 cover blocs and nom/vote
refinements but **not** the veto-save rule, jury-risk reasoning, or NPC comp intent — fold
those into the 0044 draft.

**D8 · MINOR · NEW — Canned surface content.** One pretext for every approach ("wants a word
with you"), one verb phrase per off-screen type, one confessional template, `socialRead` =
counters + two fixed sentences.
*Fix:* derive pretexts from the drive source (bond ⇒ strategy talk, threat ⇒ "has been
watching you"); ≥N distinct templates exercised per season; no template names a hidden event.

**D9 · MINOR · NEW — Confessionals trigger uniform-randomly, never at ceremonies.** The
canonical DR moments (nomination/eviction) produce none.
*Fix:* also record nominee/HOH/evictee confessionals at ceremony beats (Vault-only as now).

**D10 · MINOR · NEW — Ceremony witness sets under-include.** Beats are recorded as witnessed
by `[player, ...participants]` only (`registry.ts:46-54`) — 13 NPCs have no knowledge pathway
to who was evicted. Harmless today; a landmine under B27b's pathway-aware work.
*Fix:* witness set = all active houseguests for ceremony beats.

**D11 · MINOR · NEW — Ambient volunteered social cues missing.** Legacy §6's "the AI
volunteers subtle cues when strong enough to notice" has no covering spec — `socialRead` is
pull-only, 0036 initiatives are approaches. Amend 0012/0036 with a temperature-gated,
Vault-free ambient-cue beat.

**D12 · MAJOR · NEW — Two-loop drift: the calibration sim diverges from the live loop in
rules.** `season.ts` skips the Houseguest's-Choice chip, uses different comp types, has no
manner/appeals; the 0006 calibration and outcome property suites therefore verify mechanics
the player never plays.
*Fix:* implement `playSeason` as a driver over `newLiveSeason`/`advance` (auto-answering
pendings with NPC policy), or demote the sim to documented calibration-only and delete its
duplicated decision helpers.
*Acceptance:* one source of weekly-loop truth; outcome suites exercise the live `advance`.

## E. Runtime spine, security & ops

**E1 · CRITICAL · NEW — The engine HTTP port is unauthenticated, binds 0.0.0.0, and identity
is a spoofable header.** `listen(port)` with no host (`HttpMcpServer.ts:75-77`; `main.ts:41`
even logs `0.0.0.0`) while deploy docs claim loopback; identity = client-supplied
`x-orwell-user` defaulting to `"default"` (two header-less clients silently *share* a
sandbox); the **admin channel** is equally open; `sandboxFor` creates sandboxes for any string
(memory DoS; never evicted). Cross-user isolation — a first-class mandate — is broken at the
network boundary despite being genuinely solid in-process.
*Fix:* bind 127.0.0.1 by default (configurable); shared-secret `ORWELL_ENGINE_TOKEN` checked
per request; reject missing user header in multi-user mode; cap registry size / require a
known user for non-create calls.
*Acceptance:* refused from non-loopback by default; 401 without token; 400 (not `"default"`)
without the header in multi-user mode; deploy docs and bind agree.

**E2 · CRITICAL · NEW — One corrupt save file crashes the engine for all users, forever.**
Non-atomic `writeFileSync` (truncation on crash), unguarded `JSON.parse`, no fallback to
v(N−1), `sandboxFor` un-caught in the request listener (uncaughtException ⇒ process exit) and
in the watcher tick ⇒ crash loop on the same file at every restart. The versioned-file design's
whole purpose — prior versions intact — is unreachable.
*Fix:* temp-file + rename; on parse error quarantine + step down a version; try/catch in the
HTTP handler (500) and watcher tick (fault record).
*Acceptance:* truncate latest ⇒ engine resumes from v(N−1), other users unaffected, process
alive.

**E3 · MAJOR · NEW — Player turns bypass the orchestrator: the integrity checkpoint never runs
on player actions.** Nothing outside tests calls `advance(user, "player-turn")` or `touch`;
the live tool path is `McpServer → session/commands` direct. A degrading or leaky player-turn
commit persists immediately, uncheckpointed. (CLAUDE.md's "single per-sandbox game-advance
path" claim is doc drift.)
*Fix:* route mutating tools through the orchestrator (or make `onPersist` =
checkpoint-then-save); at minimum `touch` on every player call (also fixes D4).
*Acceptance:* a leak-injecting `submitDecision` (test seam) rolls back, unpersisted; health
shows `lastTrigger: "player-turn"` after a real HTTP call.

**E4 · MAJOR · NEW — Unbounded save/disk growth.** A complete snapshot file per mutation,
never pruned, with snapshot size linear in events ⇒ total disk O(n²); D4's permanent tick
stream multiplies it (~3 saves + ~12–16 events/min/user, 24/7).
*Fix:* retain last K versions + periodic checkpoints (non-degradation requires the *latest*
save be a superset, not every historical file).
*Acceptance:* 10k-tick FakeClock soak ⇒ ≤K files; latest still a superset of the first.

**E5 · MAJOR · NEW — Admin/God Mode is decorative.** `inspect` returns a never-updated stub
(`{week:1, phase:"setup", houseguests:[]}`); `overrideMechanic` mutates values nothing reads;
`manageSandbox("reset")` resets the stub, not the game (disconnected from
`registry.resetUser`); `sandboxHealth` is exposed by **no tool** — 0016's contract is unmet in
live composition.
*Fix:* feed `adminState` from `session.snapshot()` on mutation; route reset to `resetUser`;
add a `sandboxHealth` admin tool.
*Acceptance:* admin inspect reflects live week/phase after `advanceGame`; reset re-onboards;
health reachable over `/admin/call`, sentinel-free.

**E6 · MAJOR · NEW — Integrity faults are silent; a faulting sandbox is a house frozen in
amber.** Rollback works, but health is unreachable (E5), nothing notifies anyone, the watcher
retries identically, faults accumulate unbounded in memory.
*Fix:* stderr logging, the E5 health tool, a circuit breaker (skip after K consecutive
faults), fault cap.

**E7 · MAJOR · NEW — Dependency-cruiser rule gaps.** OUTWARD omits `src/adapters/narrative/**`
and `src/main.ts` (the most leak-sensitive outward consumers); VAULT omits
`EmbeddingProvider.ts` (named engine-only by CLAUDE.md) and the engine modules that *hold*
hidden logic/state (`relationships.ts`, `confessionals.ts`, `offscreen.ts`, `gossip.ts`,
`liveSeason.ts` — which carries pre-reveal finale votes). A surface module could import
`confessionalFor` today without tripping the gate.
*Fix:* extend both rule sets; ensure `npm run test:arch` actually runs in CI environments
(depcruise was absent in this container).

**E8 · MAJOR · NEW — The sentinel canary is vacuous for the live session tools.** The property
sweep runs against a standalone adapter disconnected from the sentinel fixture, so for
`advanceGame`/`submitDecision`/`gameStatus`/`playerTagline`/`socialInitiatives`/
`getGameState`/`getMomentPrompt`/`runCompetition` the canary can never fire; the only live
guard is the UAT's four regexes (format-coupled). The orchestrator's leak sweep is
substring-only over hidden event content (won't catch relationship numbers, soul text, finale
tally).
*Fix:* property sweep over a registry-built sandbox whose generated hidden
stats/souls/relationship strings embed sentinels; lock the finale projection
(`reveals.length === revealIx`, no `votes`/`script` pre-reveal).
*Acceptance:* every PLAYER_TOOLS/ADMIN_TOOLS name swept against the same object graph the
resolver serves.

**E9 · MINOR · NEW — HTTP robustness.** No body size cap (unbounded string concat), no request
timeout, all errors mapped to 400 (engine bugs masquerade as client errors), unvalidated arg
casts (missing `witnessSet` ⇒ TypeError).
*Fix:* 256KB cap, per-tool arg validation, 500 for non-validation throws.

**E10 · MINOR · NEW — Sandbox-swap race loses a player action.** `pick()` resolves the sandbox
before the async body read; a watcher fault-rollback/reset in that window means the action
mutates an orphaned graph and its persist exports the *new* sandbox.
*Fix:* resolve inside the `end` handler; ideally a per-user promise queue.

**E11 · MINOR · NEW — The house freezes at every deploy until each user's next request.** The
watcher iterates only in-memory usernames; saved users aren't preloaded at boot.
*Fix:* enumerate the save dir at startup (or lazily on first wake).

**E12 · MINOR · NEW — Determinism & timestamp nits.** `beatRng` is seeded from the *player
name* only (same-named players share comp streams across games); `runCompetition`'s rng is
identical across all users/games; event `ts` semantics differ per producer (per-stretch index
vs store length vs epoch ms vs knowledge tick) so ordering by ts is meaningless.
*Fix:* thread the sandbox seed into both derivations; one monotonic per-sandbox tick for `ts`.

## F. Front-end player experience

**F1 · MAJOR · NEW — Lever drift: the prompt names levers the agent cannot pull.**
`momentPrompts.ts` advertises `resolveCompetition`, `socialInitiatives`, `diaryRoom`; none
exist in the front-end schemas/relay — calls die as "Unknown function call". Consequence: the
**Diary Room in chat is narrated but never recorded** (the hold-the-line rule violated; only
the HUD modal records), and the narrator can never spontaneously have an NPC approach the
player (half the "bidirectional scenes" mandate).
*Fix:* add `diaryRoom` + `socialInitiatives` schemas/wrappers (client functions already
exist); expose or de-advertise `resolveCompetition`; add a registry↔schema drift test.
*Acceptance:* every prompt-named lever callable; a "diary room" agent turn produces a recorded
engine entry.

**F2 · MAJOR · NEW — Engine-down mid-game fails open into an outcome-inventing chatbot.** On
`get_game_state` failure the turn proceeds with no game prompt and no tools but the full game
transcript in context — a generic assistant continues the story from memory, the named failure
state, indistinguishable to the player.
*Fix:* fail visibly-closed for game content ("the feed is down — Big Brother will resume
shortly") + a HUD banner.
*Acceptance:* engine-down + game-active history ⇒ refusal-to-continue framing, not freeform
narration.

**F3 · MAJOR · NEW — Two play paths narrate without ever acting.** Sync `POST /api/chat` gets
the moment prompt but no tools and no escalation; users without `can_use_agent` are flipped
back to plain chat *after* game auto-escalation. Both produce consequence-free imitation
gameplay.
*Fix:* for game-active sessions, force the agent path with tools collapsed to exactly
`GAME_TOOL_KEEP` (game tools aren't a privilege surface — they're the game), or refuse game
framing on tool-less paths.

**F4 · MAJOR · NEW — Binding decisions have no UI affordance; prose can bind unintentionally.**
The engine returns rich pending views (prompt, legal options, pick counts) but nothing renders
them; presentation depends on the model relaying options, and a model misreading "I guess
Dana's been shady" can submit a binding vote the player never explicitly made. Engine legality
checks catch *illegal* choices, not *unintended* ones.
*Fix:* moment-prompt amendment — on `pending`, present via `ask_user` with exactly the
engine's options; `submitDecision` only with an explicit selection. Longer-term (0022): a
decision card rendered from `pending`.
*Acceptance:* a pending turn yields an `ask_user` whose options equal the legal set; no
same-round auto-submit.

**F5 · MAJOR · NEW — Onboarding fails open to a generic AI workspace.** Engine unreachable ⇒
the overlay never mounts, silently; the player lands on "type /setup to get started" with tips
referencing *dropped* verticals ("web search and code execution", "Compare mode").
*Fix:* a game-branded holding card ("The house is dark — Big Brother will return");
game-flavored tips/default tagline under the game build.

**F6 · MAJOR · NEW — Meta machinery leaks into the transcript; the merged prompt contradicts
itself.** Every engine call renders as a tool node with raw JSON (`npc:7`, week/phase, "engine
error: …"); and the appended agent preamble opens "You are an AI assistant with tool access"
directly after the game prompt's "never say you are an AI."
*Fix:* under the game build, restyle game-tool nodes diegetically ("📺 production…") or hide
them; swap the agent preamble for a game-consistent one on game-framed turns.
*Acceptance:* no raw tool JSON by default; "You are an AI assistant" never co-occurs with the
game-master prompt.

**F7 · MAJOR · NEW — Stale season history contaminates a new game.** `createCharacter` resets
the engine but the chat session keeps the entire previous season in context — the narrator
blends casts and phantom alliances. Factory reset scrubs `.orwell-data` but not the front-end
DB.
*Fix:* on successful restart, start a fresh chat session (or inject a hard "NEW SEASON —
disregard prior events" fence).
*Acceptance:* first post-restart turn carries no prior-season messages in the LLM payload.

**F8 · MINOR · NEW (seven small items).** (a) `game-trim.css` linked unconditionally (debug
build still hides workspace chrome); (b) onboarding archetype free-text gives no hint the five
canonical words shape stats; (c) HUD polling never backs off when the engine is down + a new
`httpx.AsyncClient` per request; (d) no latency budget — up to 2 serial engine calls × 30s
before the first LLM token; (e) approach-dismissals are per-browser localStorage; (f) no
drift/injection tests pinning schemas to `registry.ts` or asserting the moment prompt is
prepended; (g) single-user mode grants the narrator God Mode (`_owner_is_admin`) — one
persuaded `manageSandbox reset` from data loss (compounds A2).

**F9 · KNOWN (0022) — What a player would miss most, in priority order:** houseguest roster
panel; "previously on…" session-open recap; decision cards (F4); eviction/ceremony staging in
the chat UI; jury tracker; an observable-behavior `socialRead` button; week recap at HOH
transition; pacing settings (watcher cadence is env-only).

## G. New feature specs to draft

- **G1 · 0045 Endgame structure (Final 5→2)** — CRITICAL; see B1.
- **G2 · 0046 Player eviction & the juror's seat** — CRITICAL; see B6 (includes the juror
  epistemics model 0014/0037 depend on).
- **G3 · 0047 Eviction night live** — MAJOR; see B7.
- **G4 · 0048 Season retrospective & the Vault unsealing** — MAJOR; the biggest *fun* payoff
  nowhere discussed: post-season, player-triggered unsealing of that finished season's hidden
  story (off-screen scheming, confessionals, the twist that never fired) + a recap generated
  from the stores + the finished→new-season lifecycle (currently unspecced: 0021's archive
  deferral was never picked up). Unsealing impossible while live (sentinels stay green
  pre-finale). Highest fun-per-effort item not in any queue.
- **G5 · optional — cast/difficulty shaping**: a seed-time, Vault-free archetype-mix bias via
  OOBE or God Mode (explicitly not per-NPC authoring).
- **G6 · optional — have-not/food-comp texture**: fold into queued 0042 as a special-phase
  social stake, not a new system.

## H. Spec corpus & doc hygiene

- **H1 · one doc-hygiene PR (cheap, high-value — the authoritative docs currently
  mis-instruct):** refresh `bb-sim-spec.md`'s stale Refinements block ("0023 is the biggest
  gap"), §11 (pre-ADR relationship shape), §12 (daily-event scenario omits "significant house
  event" — a literal reading fails every legal social day), §16; close out
  `CLAUDE_CODE_INSTRUCTIONS.md` §15 (only the embedding provider is genuinely open); annotate
  legacy Bible §11's wrong jury-start number; clear the two satisfied Amendments-table rows +
  the 0004 banner; sync the ~25 "Status: Draft" headers on Done features; reconcile the
  queue's contradictory "NOW" blocks; fix ADR-0002's inverted confidence wording; reconcile
  the 0010 Proxmox-smoke claim (spec says host-validated, CLAUDE.md says outstanding); remove
  0009 §8's stale sync-narrate flag; fix CLAUDE.md's inaccurate claims that `consequence.ts`
  folds live impacts and that the orchestrator is the single advance path.
- **H2:** tool-name drift — 0009/0011/0019/0020 spec `resolveCompetition`/`executeDecision`/
  `advancePhase`; as-built is `runCompetition`/`submitDecision`/`advanceGame`. Add as-built
  names to the older specs.
- **H3:** add one clarifying sentence to 0033 pinning "standing" to public ceremony facts
  (resolves the tension with 0020's "never tell the player where they stand").
- **H4:** amend 0016/0021/0029/0030 — admin save/load semantics vs the 0007 monotonic ratchet,
  and the account-deletion ⇒ sandbox-data rule.
- **H5:** note in 0023 that the eager-`apply` fork is now foreclosed (0026/0039/0041 build on
  it).
- **H6:** sharpen 0012's `socialRead` honesty boundary (how hints derive from hidden edges
  without leaking — the same fuzziness behind the 0031 false-leak saga).
- **H7:** name the consumers of `playerStrategyRead` (producer prompts, tagline, 0048 recap)
  so the DR's "informs the engine" clause is real.
- **H8:** 0030/0018 "re-entry beat" — resume opens with a fresh morning scene, never a recap.
- **H9:** record-as-deliberate notes: fixed 16/jury-9/F2 format is canon; drop or implement
  spec §11's "name may change" promise; note the jury tie-break is unreachable in the
  untwisted format (only live under a returning-juror twist); walk-outs/quits optional.

## I. Minor engine catalog

- **I1:** tunables hard-coded outside the constants modules: manner thresholds
  (`liveSeason.ts:194-195`), veto-save `trust > 0.6` (duplicated in two files),
  `JURY_WEIGHTS` + manner magnitudes + all `appealEffect` numbers (→ a `juryConstants.ts`),
  approach jitter, relationship temperature default, confidence-decay 0.5,
  `SOCIAL_DAY_PROB`, twist load probability/beat window, orchestrator `interactions: 3`.
  Acceptance: grep gate + one constants-injection retune test.
- **I2:** `OrchestratorConfig.offscreenInteractions` is dead config (hard-coded 3);
  `Orchestrator.seq` unused.
- **I3:** dead production code to wire or move to test support: `ConsequenceEngine`/
  `restoreMemory` (collapse the duplicate in `EngineCommandsAdapter` to one implementation),
  the 0019 `decisions.ts` seam, `gameProgression.ts`, `simulateOffscreenStretch`, `season.ts`
  decision helpers, `jury.ts` `finalePerformance`/`tallyJuryVote`, `breaksTie`,
  `diaryRoom.ts` `producerPrompt`/`deriveNpcKnowledge` (the DR→NPC wall currently holds
  *vacuously* — route future NPC knowledge through it).
- **I4:** `applyDecision`'s veto case clears `pending` before validating (inconsistent with
  the other arms; an invalid save drops the pending).
- **I5:** `saveable = nominees.filter(() => true)` no-op.
- **I6:** suspicion channel dead live (`addSuspicion` no callers) — `socialRead`'s "something
  feels unsettled" branch can never fire; natural home: the B27b gossip wiring.
- **I7:** `InMemoryVaultStore` wired but unused and absent from `SessionSnapshot` (latent loss
  if ever used — D6's twist wiring will hit this).

## J. Known-queue items confirmed (no new spec needed)

`diffuseGossip` has no production caller (0038 B27b); `SoulStore` absent from the live
`engineRoot` and `sessionSnapshot` narrows `emotionalHistory`/`knowledge` to `[]` (0041 — the
linchpin, confirmed); fixed `HOH_TYPES`/`VETO_TYPES` rotations (0042 — every game's week-1 HOH
is endurance); 0039/0043/0044 not built; finale UI absent (B26/C11); 0022 deferred; bespoke
HTTP not MCP/JSON-RPC; engine-side Echo narrator by design.

---

## Suggested implementation waves

- **Wave 0 — hotfixes (days):** E1 (bind+auth), E2 (atomic saves + tolerant load + handler
  try/catch), A2 (createCharacter guard), B3-relay (finale kinds), F2 (engine-down
  fail-closed).
- **Wave 1 — ground truth (the anti-sycophancy wall in code):** A1, C1, C2, A3, A4, C3, E3
  (orchestrator routing — also fixes D4's flood), E8 (live sentinel sweep).
- **Wave 2 — the endgame:** G1/0045 (F5→F2 structure), B2 (tie-break), B4 (Houseguest's
  Choice), B5 (intent), A5 (manner), A6 (appeal symmetry), G2/0046 (player eviction), B26/C11
  (finale UI), G3/0047 (eviction night).
- **Wave 3 — the living house (merge with the existing 0038–0044 queue):** 0041 first (as
  planned), then D1 (hidden elements), D2 (emotional modifier), D5 (evictee filters), D6
  (twists live), D3 (live richness gate), D12 (loop unification); D7 folds into 0043/0044;
  B27b as queued.
- **Wave 4 — the experience:** F1, F3–F7, F9/0022 first slice (roster, recap, decision cards),
  G4/0048 (retrospective & unsealing).
- **Continuous:** H1 doc-hygiene PR (do early — it's cheap and the authoritative docs
  currently mis-instruct implementers), E4–E7, E9–E12, I-catalog.

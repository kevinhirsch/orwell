# BE-DEEP-2 — Backend exhaustive audit v2 findings

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| BE-DEEP2-1 | Major | <1hr | High | Five shipped behavioral-fidelity engine layers are dead in production — never opted in | `deploy/orwell-install.sh`, `src/adapters/engine/GameSessionAdapter.ts` |
| BE-DEEP2-2 | Major | <1day | High | An engine-only restart silently and permanently disables the ADR-0006 time/sleep economy in the standard (multiuser) deploy | `frontend/routes/chat_helpers.py`, `frontend/app.py`, `src/adapters/engine/GameSessionAdapter.ts` |
| BE-DEEP2-3 | Major | <1hr | High | Whole-house `house-event` records are witnessed by only 2 entities, starving every other houseguest's knowledge/confessional recall of an event their own flavor text says they were in | `src/composition/orchestrator.ts:717-725`, `src/adapters/engine/GameSessionAdapter.ts:5130-5170` |
| BE-DEEP2-4 | Minor | <1day | Med | The "Extension 5" LLM-proposed felt-conversation-duration mechanism is fully unreachable dead code — the only call site never supplies it | `src/composition/orchestrator.ts:367`, `src/adapters/engine/GameSessionAdapter.ts:4925-4933`, `src/engine/sleepConstants.ts:163-195` |
| BE-DEEP2-5 | Polish | <1hr | Med | Admin Health & Logs feature-flag panel doesn't report any of the engine's opt-in behavioral-fidelity flags, so BE-DEEP2-1's dead layers are invisible to an operator | `frontend/routes/admin_health_routes.py:485-497` |
| BE-DEEP2-6 | Minor | <1day | Low-Med | `data/sessions.json` / in-memory session table grows without bound between process restarts — pruned only at boot and lazily per stale token | `frontend/core/auth.py:104-160,549-620` |
| BE-DEEP2-7 | Minor | <1hr | Low-Med | `_LAST_ROSTER` fallback cache keys on `user or ""`, collapsing distinct callers into one shared bucket if identity resolution ever fails for both | `frontend/routes/orwell_routes.py:83-113,121-128` |

Total: **7 findings** (3 Major, 3 Minor, 1 Polish). See "Coverage" at the end for why this
list is shorter than the charter's 25-70 aim and what that means.

---

## BE-DEEP2-1
[BE-DEEP2-1] [Severity: Major] [Effort: <1hr] [Value: High]
Five shipped behavioral-fidelity engine layers are dead in production — never opted in

- **Where:** `deploy/orwell-install.sh:218-283` (the generated `data/.env`); the six flag reads in
  `src/adapters/engine/GameSessionAdapter.ts:349-390,4317-4321,4844-4846` (`ORWELL_CAMPAIGNS`,
  `ORWELL_TRAJECTORIES`, `ORWELL_TRIGGERS`, `ORWELL_SECRET_PACING`, `ORWELL_JURY_HOUSE`,
  `ORWELL_SEEDED_TIE_SURFACING`); `docs/features/README.md` rows 153/157/158/161/166 (all marked
  "✅ Built").
- **Problem:** Features 0087 (relationship trajectories/warming-cooling arcs), 0091 (trigger
  secrets → house-event eruptions), 0092 (secret-pacing drip), 0100 (jury grudge book), and the
  0059 §5 seeded-tie-surfacing follow-on are all fully built, tested, and documented as "✅ Built"
  — each is deliberately **opt-in via an env flag that defaults OFF** so the seeded calibration
  gates stay byte-identical. `orwell-install.sh` (the ONLY place that writes the deployed
  `data/.env`) sets exactly **one** of these flags: `ORWELL_CAMPAIGNS=1` (line 263, with an
  explicit comment: "DEFAULT OFF in code... the deploy opts in here"). The other five are never
  written by the installer, never referenced anywhere else in `deploy/`, and — unlike
  `ORWELL_TIME_OF_DAY` (see BE-DEEP2-2), which has a real runtime-override + FE settings path
  (`AdminPort.setTimeOfDayDelegate`, `frontend/src/settings.py: "time_of_day_enabled": True`,
  `chat_helpers._apply_persisted_time_of_day_once`) — have **no admin delegate, no FE settings
  key, and no other override path at all** (confirmed: `grep -r "setTriggersEnabled\|
  setTrajectoriesEnabled\|setJuryHouseEnabled\|setSecretPacingEnabled\|
  setSeededTieSurfacingEnabled"` across `src/surfaces/admin` and `src/composition` returns
  nothing beyond the flags' own definitions; `grep` for their snake_case FE equivalents across
  `frontend/` returns nothing). The seeded-tie-surfacing code comment
  (`GameSessionAdapter.ts:4306-4308`) even asserts *"The deploy turns it on for the texture"* —
  which is false; it does not. Net effect: on the actual shipped product, NPCs never develop
  warming/cooling relationship arcs, secrets never erupt into house events, secrets never drip
  out on a pacing cadence, jury grudges never accumulate, and pre-game ties never surface via the
  0059 §5 scheduler — five purpose-built enrichments to exactly the mandate's #1 priority
  ("behavioral fidelity... the *full social texture*... a mechanically-correct but
  behaviorally-thin build is a failure state," I7) sit inert. Only 0085/0086 (NPC campaigns) is
  actually live.
- **Fix:** Add the five missing `echo "ORWELL_X=1"` lines to the same block in
  `orwell-install.sh` (mirroring the `ORWELL_CAMPAIGNS=1` precedent and its comment), and add
  them to `orwell-update.sh`'s env-reconciliation path so existing installs pick them up on next
  update. If any of the five is deliberately being held back for further calibration, say so in
  a comment (matching the `ORWELL_CAMPAIGNS` model) rather than leaving a silent gap — and correct
  the false "the deploy turns it on" comment either way.

---

## BE-DEEP2-2
[BE-DEEP2-2] [Severity: Major] [Effort: <1day] [Value: High]
An engine-only restart silently and permanently disables the ADR-0006 time/sleep economy in the standard (multiuser) deploy

- **Where:** `frontend/routes/chat_helpers.py:56-80` (`_TIME_OF_DAY_APPLIED` /
  `_apply_persisted_time_of_day_once`); `frontend/app.py:1108-1126` (`_apply_time_of_day` boot
  task); `src/adapters/engine/GameSessionAdapter.ts:4823-4846` (`timeOfDayOverride` is a
  `private static` field); `deploy/systemd/orwell-engine.service` (`Restart=on-failure`, a
  separate systemd unit from `orwell-frontend.service`).
- **Problem:** Time-of-day (feature 0066/ADR 0006) is a **process-global static override** on the
  engine (`GameSessionAdapter.timeOfDayOverride`), and the engine's own code comment says
  outright: "a restart resets it to `null`" (falls back to `process.env.ORWELL_TIME_OF_DAY`,
  which is never set by the installer — see BE-DEEP2-1's sibling gap — so the reset value is
  OFF). The re-apply story has exactly two paths: (1) `app.py`'s boot task, which is **explicitly
  skipped in multiuser mode** ("a userless boot apply is REFUSED by the engine... Defer to the
  FE's first-framed-turn lazy apply" — and the installer sets `ORWELL_ENGINE_MULTIUSER=1` for
  every production deploy, so this path never runs in practice); and (2)
  `_apply_persisted_time_of_day_once`, which fires **once per FE process, ever** (guarded by the
  module-level `_TIME_OF_DAY_APPLIED` flag that is never reset except by an FE-process restart).
  The engine (`orwell-engine.service`, `Restart=on-failure`) and the front-end
  (`orwell-frontend.service`) are two independent systemd units that can and do restart
  independently — the engine unit's own `Restart=on-failure` is an explicit admission that it
  will sometimes crash and come back. When that happens without the FE also restarting (the
  common case — a crash is not an update), the engine's time-of-day override silently resets to
  OFF, and the FE's one-shot latch means **it is never re-pushed** — until either the FE process
  itself restarts, or an admin happens to open Settings and re-save the `time_of_day_enabled`
  toggle (`routes/auth_routes.py:551-559`, the only other re-apply path, and it only fires when
  that specific key is present in the settings PATCH body). The result: the entire nightly
  presence/bedtime/sleep-debt economy (ADR 0006, celebrated in CLAUDE.md as first-class live
  state) can vanish for the rest of a season with **zero player-visible or admin-visible signal**
  — no log line reaches an operator surface, no health-check flags it (see BE-DEEP2-5).
- **Fix:** Don't gate on "ever applied" — gate on "applied for the engine's *current* boot
  generation." The `/health` endpoint already returns `uptime` (`healthMetrics.ts`); have the FE
  compare the engine's reported uptime/boot-id against the uptime at last successful apply and
  re-push whenever it drops (a restart signature), or simplest: re-apply on every N-minute
  interval regardless of the latch (idempotent per the existing comment — "a benign race just
  re-applies the same value").

---

## BE-DEEP2-3
[BE-DEEP2-3] [Severity: Major] [Effort: <1hr] [Value: High]
Whole-house `house-event` records are witnessed by only 2 entities, starving every other houseguest's knowledge/confessional recall of an event their own flavor text says they were in

- **Where:** `src/composition/orchestrator.ts:507-510,716-725` (the daily-event-invariant house
  event); `src/adapters/engine/GameSessionAdapter.ts:5130-5170` (`runTriggerEruptions` /
  `foldEruptionWitnesses`, feature 0091); `src/engine/houseEvents.ts:41-53` (`HOUSE_EVENT_POOL`);
  `src/engine/confessionals.ts:274,285` (`selectRecentForConfessional` filters
  `witnessedBy: npc`).
- **Problem:** Two independent producers of `type: "house-event"` records both set
  `witnessSet: [PLAYER, someOneNpc]` no matter how house-wide the content actually reads:
  1. The orchestrator's daily-event-invariant beat (`orchestrator.ts:717-725`) records
     `witnessSet: [PLAYER, ids[0]!]` where `ids` is the full list of active (non-evicted) NPCs —
     so **the same single NPC** (whichever is first in house-roster order) is the only
     houseguest, besides the player, who ever "witnessed" any daily house event for the entire
     season. The content pool it draws from (`HOUSE_EVENT_POOL`) is explicitly whole-house
     ("A house meeting...", "...the house calls to order," "A rainy lockdown crams everyone
     inside," "A house-wide hide-and-seek...") — text that only makes narrative sense if
     everyone was there, while the engine's ground truth says only 2 people were.
  2. The 0091 trigger-eruption beat (`GameSessionAdapter.ts:5133-5143`) records the SAME narrow
     `witnessSet: [PLAYER, n.id]` for a public "blow-up / showmance-detonation / mask-slip /
     meltdown" — but the very next line, `foldEruptionWitnesses` (line 5159-5170), computes the
     *correct*, broader set (every living, awake NPC actually co-present in the erupter's room)
     for the **relationship fold** (threat/warmth shift). The engine already knows who was
     really there — it just doesn't reuse that same set for the event's `witnessSet`.
  Per the event/visibility model (CLAUDE.md: "Visibility is per-event metadata — a witness set...
  not a function of which store the data lives in" and I3/I6), this witness set IS the ground
  truth for who can legitimately know/recall a happening. `selectRecentForConfessional` filters
  strictly on `witnessedBy: npc`, so **every houseguest except the one hardcoded witness is
  permanently unable to reference "that blow-up" or "the house meeting" in a reactive
  confessional (0089)** or any other witnessed-event read — even though the recorded content says
  they were standing right there. This is a concrete, structural instance of the "mislabel
  witnessed events" family of bug the project explicitly guards against (CLAUDE.md: "that was a
  concrete past bug"), just in the opposite direction: events are recorded as *unwitnessed* by
  people the fiction says witnessed them.
- **Fix:** For the daily house event, set `witnessSet` to `[PLAYER, ...activeAwakeNpcIds]`
  (the same `ids` array already computed at `orchestrator.ts:510`) instead of `ids[0]` alone. For
  the trigger eruption, compute the `foldEruptionWitnesses` room-co-present set *once*, pass it to
  both the `events.record` call and the relationship fold, so the two never drift apart again.
  Both changes are Vault-safe (the content is already public/generic) and shouldn't perturb
  calibration, since witness-set breadth doesn't feed the seeded outcome streams — but re-run the
  neutrality gates (`triggerOutcomeNeutral`-style) to confirm.

---

## BE-DEEP2-4
[BE-DEEP2-4] [Severity: Minor] [Effort: <1day] [Value: Med]
The "Extension 5" LLM-proposed felt-conversation-duration mechanism is fully unreachable dead code

- **Where:** `src/composition/orchestrator.ts:367` (`advanceClockPerConversation()` — zero args);
  `src/adapters/engine/GameSessionAdapter.ts:4909,4925-4933` (`setPerConversationClockEnabled`,
  `advanceClockPerConversation(opts?)`); `src/engine/sleepConstants.ts:163-195`
  (`ConversationKind`, `conversationHours`).
- **Problem:** `sleepConstants.ts` documents and implements a full "Extension 5" mechanism: a
  scene's *felt* duration (`passing`/`casual`/`game`/`summit`, each with a baseline/min/max hour
  range) that a caller can propose per conversational turn, bounded and committed by
  `conversationHours(kind, proposedHours)`. `GameSessionAdapter.advanceClockPerConversation`
  correctly wires it: `opts?.kind ? conversationHours(opts.kind, opts.proposedHours) :
  CLOCK.perConversationHours` (the 0.5h floor when nothing is proposed). But the **only call
  site anywhere in `src/`** (`orchestrator.ts:367`,
  `this.registry.sandboxFor(user).session.advanceClockPerConversation();`) invokes it with **no
  arguments at all** — so `opts` is always `undefined`, and every conversation turn (when the
  per-conversation clock is even on — itself gated by an instance field
  `perConversationClockEnabled` whose setter `setPerConversationClockEnabled` also has zero
  external call sites, and whose env flag `ORWELL_TIME_PER_CONVERSATION` is likewise never set by
  `orwell-install.sh`) always falls through to the flat 0.5h floor. There is no MCP tool argument,
  no admin delegate, and no FE code path that could ever supply `{kind, proposedHours}`. This
  mirrors BE-DEEP2-1's pattern (a fully-built mechanism nobody wires up) at a smaller scale; it is
  also explicitly named as an open/deferred item in CLAUDE.md's "Current status" section, so it is
  lower-shock than BE-DEEP2-1, but the actual code-level unreachability (not just "untuned") is
  new: it's not merely *off*, the plumbing to ever turn it *on* doesn't exist anywhere in the
  call graph.
- **Fix:** Either wire a real caller (an MCP tool arg on `recordInteraction`/an FE-side per-scene
  kind classification calling `advanceClockPerConversation({kind, proposedHours})`), or, if this
  extension is intentionally parked, delete/comment the now-doubly-dead
  `setPerConversationClockEnabled` setter and the env flag rather than leaving a fully-implemented
  but unreachable code path that a future maintainer will assume works because it's documented so
  thoroughly.

---

## BE-DEEP2-5
[BE-DEEP2-5] [Severity: Polish] [Effort: <1hr] [Value: Med]
Admin Health & Logs feature-flag panel doesn't report any of the engine's opt-in behavioral-fidelity flags

- **Where:** `frontend/routes/admin_health_routes.py:485-497` (`_feature_flags()`).
- **Problem:** The admin Health & Logs card's `_feature_flags()` helper reports `gameBuild`,
  `authEnabled`, `localhostBypass`, `embeddings`, and `multiuser` — but nothing about whether
  campaigns/trajectories/triggers/secret-pacing/jury-house/seeded-tie-surfacing/time-of-day are
  actually active on the running engine. Given BE-DEEP2-1 and BE-DEEP2-2 show these flags can be
  silently off (never deployed, or reset by an engine restart) with no other symptom, there is
  currently **no way for an operator to notice** short of reading engine environment variables by
  hand or grepping logs. This is exactly the kind of silent-degradation risk the admin surface
  exists to catch.
- **Fix:** Extend `_feature_flags()` to also surface the engine's own flag posture — either by
  adding a small Vault-free admin query (`inspectNonVaultState`/a new lightweight engine getter)
  that reports each flag's current boolean, or by having the FE read the same env vars the engine
  reads (imperfect for the per-restart-reset case, but still catches the "never deployed" case).
  Cheap, high leverage: it turns two silent Major bugs into an obviously-visible admin signal.

---

## BE-DEEP2-6
[BE-DEEP2-6] [Severity: Minor] [Effort: <1day] [Value: Low-Med]
`data/sessions.json` / in-memory session table grows without bound between process restarts

- **Where:** `frontend/core/auth.py:104` (`self._sessions: Dict[str, Dict[str, Any]]`),
  `:142-160` (`_load_sessions`/`_save_sessions`), `:556-565` (`create_session_trusted` — mints a
  fresh token with no cap on concurrent tokens per user), `:568-591`/`:596-616`
  (`validate_token`/`get_username_for_token` — the only two places an expired entry is ever
  removed, and only when THAT specific token is next presented).
- **Problem:** Session pruning happens in exactly two circumstances: at process load
  (`_load_sessions`, i.e. only at FE startup) and lazily, per-token, the next time an already-
  expired token happens to be presented again. A token that is minted (every login creates a new
  one; there is no cap and no de-duplication per user/device) and then never revisited — the
  common case for a one-off login, a stale bookmark, or an abandoned device — stays resident in
  both the in-memory `_sessions` dict and the on-disk `data/sessions.json` file for as long as the
  process runs, i.e. potentially the full uptime between deploys/updates on a long-lived systemd
  service (`Restart=on-failure`, not scheduled to restart on any cadence). Over months of a
  household deployment with several logins (browser + mobile + a bearer-token client), this is a
  slow, unbounded accumulation with no visible symptom until someone inspects the file.
- **Fix:** Add a lightweight periodic sweep (a `asyncio` background task in `app.py`, mirroring
  the existing `_keepalive_loop`, running `_load_sessions`'s pruning logic every N hours) instead
  of relying solely on load-time + per-token-lazy pruning.

---

## BE-DEEP2-7
[BE-DEEP2-7] [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
`_LAST_ROSTER` fallback cache keys on `user or ""`, collapsing distinct callers into one shared bucket if identity resolution ever fails for both

- **Where:** `frontend/routes/orwell_routes.py:83-113` (`_LAST_ROSTER`, `_remember_roster`,
  `_last_good_roster`), `:121-128` (`_current_user`), `:661-669` (the roster route's stale-serve
  fallback, `_roster_payload(user, cached, stale=True)`).
- **Problem:** `_current_user(request)` resolves identity via `effective_user(request)` and, on
  any exception, falls back to `getattr(getattr(request, "state", None), "current_user", None)` —
  which can itself be `None`. `_LAST_ROSTER` is a module-level dict keyed by `user or ""`. If
  identity resolution fails to produce a non-empty string for two *different* concurrent
  requests (an auth-layer hiccup, a bearer-token edge case, or a transitional multiuser-mode
  misconfiguration), both collapse into the SAME `""` cache bucket — meaning the roster-cache
  fallback (used specifically when the live engine read fails and the route serves "the last
  roster we built," per the comment at `orwell_routes.py:664-668`) could momentarily hand one
  caller's cast roster to a different caller. Cross-user isolation is called out repeatedly in
  CLAUDE.md as a first-class, structural guarantee ("no call for user A may return user B's
  game — secret or not"); this is a narrow, low-probability edge (requires simultaneous identity-
  resolution failure for two different real users, and only leaks a Vault-free public roster, not
  secret state), but it is a real gap in that guarantee's uniform enforcement, and it is silent —
  no error, no log line distinguishes it from the normal single-user cache hit.
- **Fix:** Refuse to populate/read the fallback cache when `user` is `None`/empty (treat "identity
  unknown" as "no cache," not as "shared anonymous cache"), so a resolution failure degrades to a
  502/served-fresh-attempt instead of a silent cross-caller cache hit.

---

## Coverage

**Systematically covered per the charter's 9 sweeps:**
1. **Feature-delivery sweep** — traced every named engine system (gossip.ts, deals.ts, blocs.ts,
   confessionals.ts, presence.ts, emotionalArc.ts, houseEvents.ts, seededRelationships.ts,
   offscreen.ts) to its actual call site in `orchestrator.ts`/`GameSessionAdapter.ts` and onward
   to a player-visible surface (`VisibleStateService`, `stateDelta`, momentPrompt context, or the
   deliberate Vault-only path for confessionals/blocs/emotionalArc, which is correct-by-design).
   All are wired; the gap found was witness-set *breadth* (BE-DEEP2-3), not absence of wiring.
2. **Half-wired spec sweep** — enumerated every `ORWELL_*` flag read in `src/`, cross-referenced
   each against `deploy/orwell-install.sh` and every admin-delegate call site; found the systemic
   gap in BE-DEEP2-1/4. Cross-checked `docs/features/README.md` rows 0087-0107 against actual
   flag-default/deploy status.
3. **Silent-failure sweep** — read every `catch`/`except` in `src/composition/`,
   `src/adapters/engine/`, `src/adapters/mcp/HttpMcpServer.ts`, and the game-critical FE modules
   (`orwell_sync_ledger.py`, `orwell_game_session.py`, `orwell_token_ledger.py`,
   `session_events.py`, `routes/orwell_routes.py`); all are deliberate, well-commented fail-soft
   patterns with a stated rationale — found BE-DEEP2-6/7 as genuine gaps, no new "swallowed error
   that silently breaks a scene's consequence" beyond what v1 already found.
4. **Tunables sanity** — read `temperatureConstants.ts`, `relationshipConstants.ts`,
   `decisionConstants.ts`, `sleepConstants.ts`/`CLOCK`, `triggerConstants.ts`,
   `notorietyConstants.ts`, `STAGED_TARGET_ROUNDS`; every constant has a real consumer and a
   documented rationale (the codebase runs a "no decorative knob" grep gate per its own audit
   history) — no dead-branch/unreachable-threshold numeric bug found beyond BE-DEEP2-4's
   structural (not numeric) dead path.
5. **Save/load deep** — read `sessionSnapshot.ts`'s full persisted-field list; the one clear
   in-memory-only gap is the `private static` admin-override booleans (BE-DEEP2-2 covers the
   highest-impact instance, time-of-day; the same class of gap applies to the other five flags
   in BE-DEEP2-1, but they have no override mechanism to lose in the first place).
6. **Time/clock** — covered by BE-DEEP2-2 and BE-DEEP2-4; also checked `dayOfWeek`/day-index
   derivation and the 24-hour model math in `sleepConstants.ts` (self-consistent, well-tested per
   its own doc comments).
7. **Admin surface** — verified every route in all 10 `routes/admin_*.py` files calls
   `require_admin` (an initial regex sweep flagged 6 false positives from long docstrings; each
   was manually confirmed present in the function body). No missing gate found. BE-DEEP2-5 is an
   observability gap, not an auth gap. Destructive routes (`admin_factory_reset`,
   `admin_portraits_regenerate`, `admin_reauthor_cast`, `admin_advance_to_finale`) all
   refuse-before-acting and are re-gated server-side independent of the FE confirmation dialog.
8. **Engine HTTP edge** — read `HttpMcpServer.ts` in full: constant-time secret comparison, body
   size cap, per-request timeout, per-user request serialization with a queue that can never
   reject, sandbox-creation allowlisting, typed-error → status-code mapping, JSON-RPC envelope
   parity. Found no new gap — this file is unusually hardened (11 distinct audit-numbered
   guardrails cited in its own comments).
9. **Python server** — checked `subprocess` calls in admin scripts (all fixed-argv, no
   `shell=True`), sqlite usage (the game-relevant path is SQLAlchemy-managed, migrations run at
   startup only, not per-request), `session_events.py`'s SSE lifecycle (bounded ring, grace-period
   teardown, no leak found), and background-task concurrency (`orwell_portraits.py`/
   `orwell_cast_authoring.py` use single-threaded `asyncio` tasks, not real threads, so the
   unlocked dict/set state there is not actually racy). BE-DEEP2-6/7 are the two real findings
   from this sweep.

**Not exhaustively covered / lower confidence:** the `humanize.ts` id/slug disambiguator
(`ID_INTRODUCERS`/`DETERMINERS` word-lists) is a hand-maintained heuristic with a visible history
of point-fixes (#845, #927) for the "player"-as-common-noun collision; I sampled ~10 live
`${...}` templates in `liveSeason.ts` for coverage and found no live miss, but a heuristic word
list is inherently incomplete against future beat templates — I did not find a concrete repro so
did not file it as a finding, but flag it here as a plausible future-regression surface for
whoever adds the next beat template. `agent_loop.py` (5000+ lines, ~103 except blocks, the C1
guardrail-belt territory) got a targeted read of ~15 named functions rather than a full pass; the
belts I read (`_pre_emission_outcome_guard`, `_scrub_game_leak`, `_detect_runaway_call`) all read
as sanctioned error-correction, not authoring, but this file is large enough that a dedicated pass
could plausibly find more.

**Why 7, not 25-70:** this backend has visibly been through many prior audit rounds (comments
cite specific findings E1-E90+, B1-B73, C1-C33, D1-D11, L1-L40+, #-numbered issues throughout) —
nearly every file carries load-bearing rationale comments for exactly the kind of edge case this
sweep hunts for, and the load-bearing invariants (Vault Wall, witness-set-as-truth, per-user
isolation, calibration neutrality) are enforced by dozens of named unit/property tests rather than
convention alone. I did not pad the list with speculative or low-confidence items to hit a number;
each of the 7 above is traced to root cause across 2-4 files with a concrete fix. I would rate
confidence in all 7 as high (each is a direct code/deploy-config read, not inference).

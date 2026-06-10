# 2026-06-10 — Full product audit (round 5): architecture, wiring, FE/UI, game design & player experience

**Scope.** A complete sweep of the repo at `main` (87687c0): the engine's ports/composition/
adapters/surfaces, the pure core and every `src/engine` system against the canonical mechanics
(CLAUDE.md, `bb-sim-spec.md`, ADRs 0001–0004, the legacy Bible rulings), the vendored front-end
(routes, services, all `orwell*.js` panels, the agent loop), the spec/queue/docs record against
the code, and the test/ops/security posture. Seven parallel audit streams; findings merged and
deduplicated. PR #200 (the round-4 UI & runtime audit, D1–D11) is **incorporated by reference**
— its findings are not re-numbered here; where a finding below deepens or extends a D-item, it
says so.

**Baseline.** `npm test` green end-to-end (typecheck → build → 500 unit/property/arch → 315 BDD
scenarios, exit 0); FE pytest + smokes green. As with round 4, **nothing below is a failing
test** — every finding is unasserted behavior, which is itself the recurring meta-finding: the
gates are excellent on the seams they measure and blind on the seams players live on (season 2,
the late game, the social loop's consequences).

**The one-paragraph verdict.** The deterministic skeleton is faithful and well-tested:
eligibility, comp math, the endgame ladder, the finale choreography, persistence, and the Vault
structure all verify clean, and no code path protects the player. The product gap is
concentrated in three places: (1) a **restart/persistence-integrity family** that makes starting
a second season structurally impossible in production (E1–E8, deepening D1); (2) the **social
simulation not mattering** — deals, gossip, blocs, and the emotional arc are built but
disconnected from decisions, so three shipped systems are flavor instead of consequence
(E42–E58); and (3) a **player-experience integrity-and-calibration set** — the player never
reaches the jury (D4), the engine speaks for the player at goodbyes (E34), and the UI has the
D-batch's layout/lifecycle defects plus the panel/sidebar ruling below (E64).

---

## Product-owner rulings recorded this session (2026-06-10)

1. **NPC names must be realistic** — "determined based on what could be a real name." The
   phoneme-mash generator is replaced by seeded sampling from vendored real-name corpora
   (full spec at E38). The 0004 "no hard-coded name list" do-not is amended to "**no fixed
   cast**: name corpora are raw material; no full-name+persona pairing may be hard-coded; the
   legacy Bible's names stay banned."
2. **A game-only reset script must exist and run from the Proxmox host** like the other
   scripts. **Shipped with this audit**: `deploy/orwell-game-reset.sh` — clears every per-user
   engine sandbox (saves, souls, Vault, casting intake), preserves `data/.env` **and** the
   entire front-end store (accounts, sessions, LLM config); same host→LXC bridge, flags, and
   path-sanity guards as `orwell-factory-reset.sh`.
3. **The status HUD lives in the sidebar, always** — the "You / HOH / Noms / Veto / The house ·
   16/16" surface is not a floating window (full spec at E64).
4. **The Diary Room is not a window** — it becomes a **persistent sidebar button** alongside the
   app's other standing buttons (chat, theme, …); no floating dialog (full spec at E88).
5. **"___ wants a word with you" must not spawn at the beginning of the game.** The approach
   surface may remain a window, but no approach fires before the house has actually started
   playing (full spec at E89).
6. **All host-aware deploy/update/reset scripts must also target containers literally named
   `bbai`.** **Shipped with this audit**: `orwell-update.sh`, `orwell-doctor.sh`,
   `orwell-factory-reset.sh`, and the new `orwell-game-reset.sh` now fall back to an LXC named
   `bbai` when no `orwell` container exists (an explicit `CT_HOSTNAME` override disables the
   fallback; error messages name both).
7. **The theme button moves to the bottom of the sidebar, beside the settings icon — icon-only**
   ("non-intrusive but intuitive… it doesn't need to be spelled out"; full spec at E90).
8. **Window positions must persist across refresh** — today a refresh resets floating panels to
   "wrong looking and random" placements (full spec at E91).
9. **Image attach must be streamlined and actually work in-character** — attaching an image
   (or file) is the one analysis input the game wants ("an image to chat about with a
   houseguest"), and today it's one icon hidden behind another; it must be first-class and
   wired so the model analyzes the attachment and responds **in character for the moment**
   (full spec at E94). *Image generation by the model is a future spec, not an audit finding —
   see "Future specs" below.*
10. **Minimized windows must not park at the top of the chatbox.** The chip dock there doesn't
    stay centered as sidebar/viewport width changes — and the placement itself is rejected;
    minimized windows go somewhere sensible (the sidebar) instead (full spec at E95).
11. **The "Save to Documents" export item is removed** under the game build (full spec at E96).
12. **Windows animate on open, close, and minimize** (full spec at E97).
13. **The theme picker leads with 3–6 house themes** — Big Brother / creepy / Orwellian palettes
    on par with the game's identity, placed as the *first* entries in the picker. Specced as a
    feature, not a finding (see "Future specs" — 0052).

**Live-transcript corroboration.** A real premiere-night session transcript supplied during this
audit independently confirms, on screen: the gibberish cast names (E38), approaches firing at
the premiere with the canned "wants a word with you" pretext (E60/E89), raw expandable JSON for
`renderScene`/`socialRead`/`socialInitiatives` tool nodes (E11/D5), the visible composer model
picker with raw model ids (E72), the Agent|Chat mode toggle on game turns (D7), the persona/
preset modal reachable mid-game (E16), the GM breaking the fourth wall to ask "Record this
interaction? Or keep it breezy?" (the E22 enforcement gap surfacing as prompt-level
uncertainty), and message edit/delete controls active on game turns (new — E93).

---

## The E-batch findings

Severity: **CRIT** (breaks play or a mandate) · **HIGH** (mandate-adjacent or player-visible
every game) · **MED** · **LOW**. Category: Bug / Change / Improvement / UX / Test / Ops / Drift.
File references are to `main` @ 87687c0.

### Theme 1 — Restart & persistence integrity (the season-2 family)

- **E1 [CRIT · Bug] Even the *admin* reset resurrects the old season — the orchestrator baseline
  is never invalidated.** `orchestrator.ts:89` (`baselines` map, never cleared), `:209–229`
  (fault ⇒ `registry.restore(user, baseline!)`); `registry.ts:271–277` (`resetUser` builds a
  fresh sandbox, never notifies the orchestrator). After any reset, the next mutation reads as a
  count regression vs. the dead season's snapshot ⇒ degradation fault ⇒ the old game is
  reimported; after 3 faults the circuit opens. This **deepens D1** (the FE using the
  `createCharacter` door is only half the bug — the sanctioned door is broken too).
  *Fix:* `Orchestrator.resetUser(user)` clearing baselines/faults/rngs/health, called via an
  `onReset` hook from `registry.resetUser` (and from a fixed `confirmRestart` path, see E4);
  restart faults must surface as 4xx, never 200-then-rollback (D1). *Test:* compose the real
  runtime, play, reset, play season 2, simulate engine restart ⇒ season 2 persists
  (`lastIntegrity:"ok"`). (Today `opsHardening.test.ts:70` tests reset without `setCommit`
  wired — the production spine is exactly what's untested.)
- **E2 [HIGH · Bug] Pre-game off-screen ticks fabricate hidden history with synthetic NPCs.**
  `orchestrator.ts:233–235` ticks on every commit; `:332` falls back to `npc(1..4)` when no
  house exists; `:162` returns `Infinity` pool size pre-game — so each casting-interview answer
  records hidden scenes + Vault confessionals **before the season exists**, later humanized into
  the real cast's names by `seasonRetrospective` (scheming dated before move-in; non-degradation
  forbids deleting it). *Fix:* no-op the tick when `!session.snapshot().started` (as
  `gameWatcher.ts:56` already does); delete the synthetic pool from `defaultApply`. *Test:*
  two `updateCasting` calls ⇒ zero hidden events pre-`createCharacter`.
- **E3 [HIGH · Bug] A faulted commit returns 200 with a view of rolled-back state.**
  `orchestrator.ts:222–229` (fault path returns void), `registry.ts:183–188` (fire-and-forget),
  `GameSessionAdapter.ts:853` (mid-method `onPersist`). The sandbox is swapped while the old
  one's method is still executing; the FE narrates a beat that officially never happened — the
  literal "narrated but never recorded" failure at the engine seam. *Fix:* propagate the commit
  result; on fault throw a typed "turn refused, state unchanged" error (HTTP 409/500); single
  `onPersist` at end of `commit(ev)`. *Test:* inject a faulting checkpoint, call `advanceGame`
  over HTTP ⇒ error response, `getGameState` unchanged.
- **E4 [MED · Bug] `confirmRestart` is honored on the player channel and leaves the old season's
  events/knowledge/Vault in the sandbox.** `GameSessionAdapter.ts:499` (arg honored though not
  in the documented player schema, `GameSession.ts:162–167`); the path replaces only
  `house/live/deals` — EventStore, KnowledgeService, Vault, relationship edges, souls persist ⇒
  cross-season bleed in recap/retrospective/NPC knowledge (and Vault twist-id collisions,
  `registry.ts:80–84` + `InMemoryVaultStore.ts:15–17` accepting duplicate ids silently).
  *Fix:* strip `confirmRestart` at the MCP boundary for the player channel; restarts route only
  through the (E1-fixed) reset delegate; dedupe `writeHidden` by id. *Test:* player-channel
  `createCharacter` twice with `confirmRestart:true` ⇒ second call no-op; post-reset recap empty.
- **E5 [MED · Bug] An incompatible (future-version) save silently becomes a fresh game and is
  then destroyed by pruning; rollback strands forward-migrated saves.** `registry.ts:203–211`
  (catch ⇒ fresh sandbox "bad save left on disk"), but `FileSaveStore.prune` (`:74–89`) unlinks
  it after ~5 saves; `orwell-update.sh --rollback` then yields contained 500s with no path back.
  *Fix:* quarantine the user dir (`<dir>.incompatible-<ts>`) or refuse service with a clean
  "save needs a newer engine" health fault; never prune what you couldn't validate; document
  rollback-vs-saves. *Test:* `snapshotVersion+1` save → boot → 6 saves ⇒ original still on disk.
- **E6 [MED · Improvement] The first commit after an engine restart is checkpoint-blind.**
  `orchestrator.ts:210–212` accepts the no-baseline commit; boot preload (`runtime.ts:97–99`)
  never seeds baselines — the non-degradation guard has a hole exactly at resume-from-disk,
  where the historical thinning bug lived. *Fix:* `Orchestrator.seedBaseline(user)` from the
  loaded snapshot during preload. *Test:* resumed sandbox dropping a fact ⇒ first commit faults.
- **E7 [MED · Bug] Save failures are fail-open and misclassified.** `registry.ts:238–241` +
  `orchestrator.ts:179/216` (uncaught ⇒ turn proceeds unsaved, no health fault);
  `HttpMcpServer.ts:173–175` classifies any plain `Error` as deliberate ⇒ an `ENOSPC` returns
  **400** and leaks the data-dir path. *Fix:* catch around `saveUser` ⇒ `persist-failure` fault
  + rollback + typed error; classify refusals by an `EngineRefusal` type, not
  `constructor === Error`. *Test:* throwing `saveFor` ⇒ HTTP 500, health fault, state rolled back.
- **E8 [LOW · Ops] `FileSaveStore` durability + user-id length.** `FileSaveStore.ts:66–70` (no
  fsync of file/dir before rename — power loss ⇒ `.corrupt` latest, silent multi-turn step-back);
  `:39` (hex-doubling ⇒ >127-byte user header = `ENAMETOOLONG` 500s). *Fix:* fsync before
  rename; cap `x-orwell-user` ≤64 chars at the HTTP edge (400).

### Theme 2 — Vault Wall & knowledge integrity

- **E9 [HIGH · Bug] `surfaceInformationTo` launders invented facts into full-confidence
  knowledge.** `InMemoryKnowledgeService.ts:110–111` — `overheard:<id>` anchoring checks only
  that *some* event with that id exists; the fact's content is never compared. Any caller with
  one legitimate event id can mint arbitrary "anchored" player knowledge with clean provenance.
  *Fix:* require content derivation from the referenced event (normalized fragment check, as
  `rollOverhears` at `presence.ts:96–101` already produces), or reserve `overheard:` minting to
  the engine and downgrade caller-supplied overhears to suspicion. *Test:* invented content vs.
  a real id ⇒ `surfaced:false`, suspicion only.
- **E10 [MED · Bug] Goodbye-message tones broadcast the hidden affinity matrix weekly.**
  `registry.ts:89–97` witnesses every BeatEvent to the player, incl. `eviction-goodbye` whose
  tone is a threshold read of the hidden edge (`liveSeason.ts:528–533, 597–603`) — three
  calibrated samples of hidden sentiment per eviction, for scenes the player couldn't witness.
  *Fix:* witness goodbyes to `[sender, evictee]` only (the evicted player still gets theirs,
  0046 intact). *Test:* third-party goodbye is hidden and absent from `getVisibleStateFor(player)`.
- **E11 [MED · Change] `npcVoice` is the widest sanctioned aperture and its raw output renders
  in the transcript.** Engine: `GameSessionAdapter.ts:224–261` hands any caller every NPC's
  last-20 known facts + suspicions + full stance matrix on demand, ungated. FE: `npcVoice` (and
  `updateCasting`/`whereabouts`/`seasonRecap`/`seasonRetrospective`) miss `_orwellToolBeats`
  (`chat.js:1117–1136`) so their JSON renders one click away (extends **D5**). *Fix:* FE — the
  five diegetic labels + C13 drift test iterating `ORWELL_GAME_TOOLS`; engine — gate
  `knows/suspects` to co-present/adjacent NPCs via the 0049 model, and cap stances to top-k
  polarized edges (see E59). *Test:* non-adjacent NPC returns persona+stances, no `knows`.
- **E12 [MED · Change] Per-voter eviction attribution kills vote secrecy.** `liveSeason.ts:582`
  reveals `voter → votedFor` pairs to the player beat-by-beat; real-BB ballot secrecy (rogue
  votes, scapegoating, paranoia) is impossible and blocs/deal-breaks are perfectly legible.
  *Fix:* anonymized running tally outward ("a vote to evict X…"); `voteOf` stays engine-internal
  for manner/deal reconciliation; attributions unseal in the 0048 retrospective. *Test:*
  `EvictionView`/reveal events carry no voter identity pre-finish; the retrospective does.
- **E13 [LOW · Change] `voteChoice` mind-reads.** `liveSeason.ts:399` consumes the *nominee's*
  private trust toward the voter inside the voter's decision — decisions must run on the
  holder's own beliefs (ADR 0003 §8). *Fix:* use the voter's own edge (or E54's reliability).
- **E14 [LOW · Improvement] Raw `npc:N` ids leak into visible text on the
  `PlayerSurface.renderLog`/gossip path.** `gossip.ts:64–66`; only adapter-mediated views
  humanize. *Fix:* humanize at the projection (inject a name resolver).
- **E15 [MED · Change] `GET /api/orwell/moment` hands any player the full GM system prompt**
  (lever manifest, casting status, per-moment instruction) — no JS consumes it
  (`orwell_routes.py:67–73`); pure meta-knowledge + prompt-extraction shortcut. *Fix:* delete
  or admin-gate the route.
- **E16 [MED · Change] Player-authored preset system prompts ride the GM stack on game turns.**
  `chat_helpers.py:142–145` prepends the GM prompt onto `preface[0]` = the preset persona; the
  custom-preset modal survives the game build (`index.html:1129–1206`). A player can steer
  narration tone/recording discipline ("always portray the house as adoring me"). *Fix:* drop
  `preset.system_prompt` from the preface when `game_active` (ADR 0003: prefer removing
  context). *Test:* pytest asserting the preface on a game turn contains only the GM prompt.
- **E17 [MED · Change] `search_chats` is in the game-build keep-set** (`agent_tools.py:112`) —
  the GM can "remember" prior seasons and OOC chats, a parallel memory rivaling the stores
  ("memory is the store *recalled*, never the chat *remembered*"). *Fix:* move to
  `GAME_TOOL_OPTIONAL`.
- **E18 [MED · Test] The dependency-cruiser Vault rule is an enumerated denylist.**
  `.dependency-cruiser.cjs:19–25` misses `characterFactory.ts` (generates `hiddenElements`),
  `emotionalArc`, `consequence`, `deals`, `decisions`, `jury`, `blocs`, `presence`,
  `competitionLibrary`. *Fix:* default-deny `OUTWARD → ^src/engine/` (+ engine/inmemory/
  embedding adapters, non-outward composition) with a narrow allowlist; lands green today.
- **E19 [MED · Test] The live sentinel sweep covers most tools only at week 1.**
  `liveSentinel.property.test.ts:94/:103` — per-beat re-sweep is 7 tools; `npcVoice`,
  `whereabouts`, `socialRead`, `seasonRecap`, goodbye/juror surfaces are never swept after the
  house evolves. *Fix:* add cheap reads to the per-beat list + one full post-finish sweep
  (excluding the sanctioned `seasonRetrospective`).

### Theme 3 — Anti-sycophancy & "recorded or it didn't happen"

- **E20 [MED · Bug] `resolveCompetition` is a seed-shopping oracle on the player channel.**
  `surfaces/tools/registry.ts:36` + `EngineCommandsAdapter.ts:112–117` — caller supplies
  participants **with stats** and the seed; nothing recorded, no folds. *Fix:* remove from
  `PLAYER_TOOLS` (keep the pure fn for tests) or delegate to the live loop's already-resolved
  result (remediation principle #1). *Test:* absent from `listTools()`, refused by `callTool`.
- **E21 [MED · Bug] `recordInteraction` can mint hidden (Vault-layer) events and steer hidden
  edges without bound.** `EngineCommandsAdapter.ts:88–92` (player-channel witness set excluding
  the player ⇒ off-screen "ground truth" indistinguishable from engine scenes), `:105–107`
  (caller picks kind/direction; `MAX_FOLDS_PER_INTERACTION` caps per call, not per beat).
  *Fix:* player channel requires `PLAYER ∈ witnessSet`; per-beat/per-pair fold budget. *Test:*
  witness set without player throws; N identical calls move an edge ≤ budget.
- **E22 [HIGH · Improvement] The cardinal sin is enforced only by prompt wording FE-side.**
  `agent_loop.py:68–84` is the entire enforcement; nothing in the agent-stream completion
  (`chat_routes.py:1198–1221`) checks that a narrated `game_active` turn made ≥1 engine write.
  *Fix:* on `[DONE]`, if narration is non-trivial and `_agent_tool_calls` holds zero engine
  writes, fire a server-side fallback `recordInteraction` (bounded digest) + counter. *Test:*
  pytest asserting the guard.
- **E23 [MED · Bug] Instructed retry of `advanceGame` with no idempotency key can
  double-advance a beat.** `agent_loop.py:76–78` ("try the call once more") + 30s client
  timeout where the engine may have committed. *Fix:* on transport failure re-read
  `gameStatus`/pending and report "may already be resolved" (or add an idempotency token).
- **E24 [MED · Bug] Incognito ("Nobody") bypasses all game framing under the game build.**
  `chat_helpers.py:105–106` early-returns; reachable via `/incognito` + hidden checkbox —
  unframed, unrecorded imitation play. *Fix:* under `game_build_enabled()` disable the toggle
  or apply game framing regardless.
- **E25 [MED · Bug] Sync `/api/chat` persists the user message *before* the 409 game-turn
  refusal** (`chat_routes.py:322–342`) ⇒ orphaned/duplicated transcript messages. *Fix:* hoist
  the check before `add_user_message` (or pop on raise).
- **E26 [LOW · Improvement] Idempotent no-op answers look like acceptance.**
  `GameSessionAdapter.ts:805` (stale `kind` ⇒ silent `advanceView(null)`), `:570` (post-start
  `updateCasting` returns an empty "ready" status). *Fix:* explicit `accepted:boolean`/`reason`
  on the views.

### Theme 4 — Cross-user isolation & edge security

- **E27 [HIGH · Security] One shared token grants any-user impersonation *and* God Mode.**
  `HttpMcpServer.ts:112–119` — the same bearer authorizes `/player/call` and `/admin/call` for
  any `x-orwell-user`; the installer writes a single `ORWELL_ENGINE_TOKEN`. *Fix:* separate
  `ORWELL_ENGINE_ADMIN_TOKEN` required on `/admin/*`; optionally HMAC the user id under the
  secret; `crypto.timingSafeEqual` for compares. *Test:* player token on `/admin/call` ⇒ 401.
- **E28 [MED · Security] The B34 anti-spray gate is bypassable and sandbox-minting is
  unbounded.** `GET /:channel/tools` resolves a sandbox for any asserted user
  (`HttpMcpServer.ts:122–124` → `registry.sandboxFor`), making them "known" for later POSTs;
  `SANDBOX_CREATING_TOOLS` lets `updateCasting` mint sandbox + durable disk file per sprayed id.
  *Fix:* serve the static per-channel tool list without resolving; apply `knownUser` to GET;
  LRU-cap un-started intake sandboxes. *Test:* unknown-user `GET /player/tools` ⇒
  `userCount()` unchanged, follow-up POST still 404.
- **E29 [MED · Security] All FE bearer-token (`ody_`) callers collapse into one engine user
  `"api"`.** `app.py:349` + `orwell_routes.py:28–30` (uses `current_user`, not
  `effective_user`) — two tokens from different owners share one game: a direct cross-user
  isolation break. *Fix:* resolve `api_token_owner` in game routes (or 403 bearer callers on
  `/api/orwell/*`). *Test:* two owners' tokens ⇒ two distinct `X-Orwell-User` values.
- **E30 [MED · Bug] Unhandled-rejection crash window in the per-user HTTP queue.**
  `HttpMcpServer.ts:86–92` — a rejecting job on a drained queue (e.g. `send` on a
  timeout-destroyed socket) has no `.catch` ⇒ process exit on modern Node. *Fix:* wrap job
  bodies; `tail.catch(()=>{})` before `finally`.
- **E31 [MED · Bug] Malformed tool args are 500s** (= **D10**, endorsed) — plus
  `McpServer.ts:43–101` casts blindly; add per-tool required-field/shape checks returning
  deliberate 400s with field names.
- **E32 [LOW · Ops] Edge hygiene cluster.** Installer never sets `ORWELL_ENGINE_MULTIUSER=1`
  though FE auth defaults on; `SECURE_COOKIES` defaults off and is never written by the
  installer (document for TLS deploys); reads shouldn't mint sandboxes
  (`orchestrator.ts:307–321` `freshHealth` — add `peekSandbox`).

### Theme 5 — Game design: calibration & player agency

- **E33 [CRIT · Bug] The player never reaches the jury** (= **D4**, endorsed with the round-4
  evidence: 62/62 passive seeded seasons evicted pre-jury; p ≈ (5/14)⁶² under fair play).
  Anti-sycophancy ("never protect the player") cannot mean "the player always loses pre-jury" —
  jury, finale, juror's seat, and eviction night are unreachable content. *Fix:* calibration
  investigation (move-in threat priors; threat-primary noms vs. NPC↔NPC off-screen bond
  deepening while a passive player's edges idle — E45/E57 are co-causes) + a permanent property
  gate ("across N passive seeds the player reaches jury in ≥X%"); re-measure social play after
  D1/E1.
- **E34 [HIGH · Bug] The engine authors the player's goodbye messages.**
  `liveSeason.ts:542–545` samples senders from `s.active` (player included) and `:597–603`
  asserts a tone computed from the hidden player→NPC edge — the engine deciding and narrating
  the player's own feelings, on jury management's signature lever. *Fix:* exclude `PLAYER` from
  `selectGoodbyeSenders`; add an optional `goodbye-message` pending decision (tone +
  model-voiced text) folded via `goodbyeMannerFor` exactly as NPC tones. *Test:* no
  player-sent goodbye beat without a resolved player decision.
- **E35 [MED · Bug] A player drawn into the veto by chip never declares intent, and the chip
  draw isn't a ceremony.** `liveSeason.ts:795–798` pauses for intent only pre-draw-resolution
  for pullers; the draw emits no witnessed BeatEvent (the field appears only on the winner
  event), so the player misses the canonical compete/throw/play-safe declaration and never
  experiences who held Houseguest's Choice. *Fix:* split into `veto-draw` (witnessed event
  naming the six + HC holder/pick; pause for `comp-intent` whenever the player is in the field)
  then `veto-competition`. *Test:* chip-drawn player gets a `comp-intent` pending; a
  `veto-draw` event precedes any winner.
- **E36 [MED · Bug] The F4 veto decision offers "use" then silently inverts it.**
  `liveSeason.ts:851–857/:960–963` — submitting `{use:true}` with no legal replacement resets
  `vetoUsed=false` and narrates "does not use the veto," contradicting the submitted choice and
  the 0034 legal-options contract. *Fix:* surface the F4 rule in the pending's legal set (or
  refuse with the decision standing). 
- **E37 [LOW · Improvement] The player-juror has no question beat at the finale.**
  `liveSeason.ts:710–712` pauses only for a player *finalist*; a juror watches their own
  question auto-answered. *Fix:* a scoreless `juror-question` pending (free text; NPC answer
  still engine-chosen) — the finale-statement precedent shows this is cheap.
- **E38 [HIGH · Bug] NPC names are gobbledygook ("Sheehoaika Peokakith") — product ruling: real
  names.** `characterFactory.ts:134–147` glues random ONSET+NUCLEUS+CODA syllables; the only
  filter is a capitalization regex (`:152`). Violates 0004's own "plausible BB contestant"
  bound and ADR 0003 §8 on the game's first screen. *Fix:* vendored corpora (~300+ given names,
  mixed gender/origin, weighted to the show's 20–40 casting demographic; ~400+ surnames) as
  data modules; seeded sampling without replacement per season; uniqueness as today; RNG draw
  order preserved or re-baselined (appearance/hidden side-streams hash off the name and
  re-derive). Amend the 0004/CLAUDE.md do-not per ruling #1 above. *Tests:* retarget
  `characterCreation.test.ts:50–53` from zero-name-overlap to no-*identity*-carryover; add the
  inverse realism gate (every generated part ∈ corpus — the check `0004:63–64` asked for and
  never got); roles-only rule untouched.
- **E39 [MED · Change] Same name ⇒ byte-identical season** (= **D8**, endorsed; engine evidence
  `GameSessionAdapter.ts:513` `seed = req.seed ?? hashSeed(playerName)`). Entropy default
  (per-creation nonce persisted in the snapshot); explicit seeds remain for tests/replays.
- **E40 [LOW · Change] Final 3 is a single comp** — the canonical three-part HOH
  (endurance → skill → jury-quiz, parts 1&2 winners meet in part 3) is specced away in 0045.
  Optional fidelity upgrade: three `final-hoh-part-N` beats via the comp library with player
  intent per part.
- **E41 [LOW · Improvement] Every season fields all 12 archetypes** —
  `characterFactory.ts:172–177` round-robins full coverage; ensemble *shape* never varies.
  *Fix:* sample with replacement under `ENSEMBLE` constraints (≥6 distinct, ≤3 dupes); widen
  the ±0.05 stat jitter modestly. *Test:* archetype-set varies across seeds; minima hold.

### Theme 6 — The social simulation must matter (behavioral fidelity)

*The highest fidelity-per-line cluster: deals, gossip, and the emotional arc are all built and
all disconnected from decisions. E42+E43+E44 convert three shipped systems from flavor into
consequence.*

- **E42 [HIGH · Bug] NPC eviction votes are never reconciled against deals.** Reconciliation
  runs only for the player's vote and nominate/replace beats (`GameSessionAdapter.ts:808–809`,
  `:857–868`); NPC votes (`liveSeason.ts:404–418`) and NPC HOH tie-breaks (`:591`) bypass
  `DealLedger.reconcile` — though `voteChoice`'s own docstring (`:384–386`) promises the
  betrayal "reconciles with full consequence." *Fix:* reconcile
  `{actor: voter, kind:"vote-evict", targets:[evictee]}` for every voter in `commitStagedEviction`.
  *Test:* an NPC with an open safety deal voting the player out ⇒ deal `broken`,
  `mannerByEvictee` betrayed, witnessed betrayal reveal.
- **E43 [HIGH · Bug] Deals self-extinguish after one ceremony and keeping one never builds
  trust.** `deals.ts:101–104` (first adverse-action-missing-partner ⇒ terminal `kept` — a
  week-2 final-two deal stops binding at the week-3 noms); no positive fold exists for honoring
  (`:89–121`), contradicting the lever manifest ("keeping it builds trust",
  `momentPrompts.ts:74–75`). *Fix:* horizon-aware resolution (safety/vote ⇒ that week's
  eviction; final-two ⇒ F2 or break) + a bounded positive fold per honoring action
  (constants-module magnitude). *Test:* final-two deal still `open()` after an unrelated week-3
  nom; honored safety deal raises trust.
- **E44 [HIGH · Improvement] Gossip never changes anyone's mind.** Diffusion writes
  `KnowledgeService` beliefs (`orchestrator.ts:372–395`, model correct in `gossip.ts:81–135`)
  but noms/votes/saves/blocs/confessionals read only relationship edges — a rumor never moves
  any third party's threat read; the only fold is the tellers bonding. *Fix:* on receipt, a
  small directed fold toward the rumor's subjects keyed by scene type × belief confidence
  (new `GOSSIP_HEARD` constants). *Test:* a betrayal-rumor chain to a future HOH raises the
  subject's nomination ranking vs. the no-rumor control at the same seed.
- **E45 [HIGH · Improvement] Off-screen society is socially incoherent.** `offscreen.ts:88–94`
  — uniform-random partner and nature (allies draw `betrayal` as often as `bonding`); scenes
  ignore the presence model (witness in a different room than the scene,
  `orchestrator.ts:357–364`). *Fix:* weight partner by edges (affinity→bonding,
  alignment→strategy, threat→conflict); gate `betrayal` on an existing bond + incentive;
  require co-presence. *Tests:* betrayal only over above-threshold prior bonds; every
  off-screen witness set co-located in `occupancy`.
- **E46 [MED · Improvement] NPC↔NPC deals don't exist** though comments claim they live in the
  Vault (`GameSessionAdapter.ts:111, 819–820`; `DealLedger.npcOnly()` dead). *Fix:* off-screen
  high-mutual-trust scenes occasionally mint Vault-held NPC deals; reconcile against NPC
  actions (free with E42); breaks drive folds + rumor seeds. *Test:* seeded season produces ≥1
  NPC deal; nothing crosses outward (extend the sentinel).
- **E47 [MED · Change] Winning a comp makes the whole house dislike you.**
  `CEREMONY_IMPACTS["comp-won"] = "conflict"` (affinity −0.16/trust −0.13 from *everyone*,
  `relationshipConstants.ts:120–126`) — allies cool on their own winner. *Fix:* dedicated
  `comp-won` impact `{threat:+0.14}` only (small affinity gain from bloc-mates optional).
- **E48 [MED · Change] A fully-expected, "respected" eviction still folds full betrayal-shock**
  toward every responsible voter (`relationshipConstants.ts:124` + `GameSessionAdapter.ts:767–769`),
  disagreeing with the recorded manner. *Fix:* scale the fold by manner
  (betrayed/blindsided/respected).
- **E49 [MED · Bug] The "departing HOH" eviction fold targets the wrong week's HOH.**
  `GameSessionAdapter.ts:770–771` reads `s.outgoingHoh` before `rollWeek` runs ⇒ the previous
  week's HOH gets the proven-threat fold twice, the current one a week late. *Fix:* fold toward
  `s.hoh`.
- **E50 [MED · Bug] Betrayal scenes give the *betrayer* the betrayed emotion; the victim's soul
  never moves.** `emotionalArc.ts:50–58` + `orchestrator.ts:354` (initiator-only evolution).
  *Fix:* per-role mapping (initiator→`scheme`, partner→`betrayed`); evolve both participants.
- **E51 [MED · Bug] Half the arc vocabulary is dead.** `survived-vote`/`comp-loss` exist only
  inside `emotionalArc.ts` — the emboldened-survivor beat 0041 defines never fires. *Fix:*
  `inflect(survivingNominee,"survived-vote")` on eviction; `comp-loss` for contested losers.
- **E52 [MED · Change] The live emotional swing omits ADR 0001's temperature roll, and the
  canonical `emotionalModifier()` has no production caller** (`emotionalArc.ts:82–87`
  deterministic; `temperatureConstants.ts:79–87` dead) — two parallel formulas, one dead.
  *Fix:* seeded temperature into `evolveEmotion`; delete or delegate to `emotionalModifier`.
- **E53 [MED · Bug] `variableWeights` — the "temperature is per-moment, per-variable" config —
  is decorative** (zero consumers; subsystems roll ad-hoc variance:
  `conversation.ts:50`, `TEMPERATURE_JITTER`, `chooseStrongestBond` default). *Fix:* wire each
  weight to its subsystem or delete the struct. *Test:* changing `variableWeights.initiative`
  changes approach-ordering variance.
- **E54 [MED · Change] ADR 0002's `reliability` signal was never built** — trust is pure
  sentiment, never evidence; with E43, demonstrated loyalty has no representation. *Fix:* add
  `reliability` fed by protective votes/honored deals/veto saves; consume in `vetoSave`,
  `bondStrength`, `juryLean`.
- **E55 [MED · Improvement] Confessionals are one canned template, never reach soul recall.**
  `confessionals.ts:53–55` (identical line all season — also the 0048 unsealing payoff);
  ceremony confessionals fire only at noms; `recordConfessionalToSoul` has zero callers (0040's
  recall half unwired). *Fix:* structured confessionals (trigger/target/mood/surfaced element)
  composed from the beat; record at eviction/veto too; wire soul recording. *Tests:* content
  references its trigger; `soul.recall(npc,"confessional")` post-restore.
- **E56 [MED · Improvement] NPCs never throw or sandbag a competition.**
  `liveSeason.ts:337–340` ("NPCs stay compete for now") — the engine models throw penalties no
  NPC ever uses. *Fix:* derive NPC intent from disposition/strategy-style + state,
  constants-gated (nominees never throw their own veto). *Test:* bounded nonzero NPC throw rate
  respecting gates.
- **E57 [MED · Bug] "One bounded off-screen tick per turn" actually fires per *mutation*.**
  `registry.ts:183–188` + `orchestrator.ts:219,233–235` — a 4-tool-call turn runs 4 ticks
  (12 hidden scenes, 4 reshuffles, 4 rumors/confessionals), force-marching the house and
  flooding the record. *Fix:* debounce to the turn boundary. *Test:*
  `recordInteraction+diaryRoom+advanceGame` ⇒ exactly one `offscreen-tick`.
- **E58 [MED · Improvement] The daily-event invariant is satisfied by a verbatim filler event,
  and in-game days don't exist in the live game.** `orchestrator.ts:405–416` ("A house meeting
  shifts the week.", repeated, player-witnessed, pollutes THE RECORD re-entry facts);
  `schedule.ts` has no production callers; no day index on any view. *Fix:* derive day from the
  beat (hoh=1…eviction=5), expose on `gameStatus`; replace filler with a varied, state-derived
  seeded library, ≤1/day. *Test:* no two consecutive house-events share content.
- **E59 [LOW · Change] `relationshipLabel` is a fixed 3-label taxonomy** (`relationships.ts:43–55`)
  vs. ADR 0002's organic vocabulary; `npcVoice` ships a stance for every living pair each call.
  *Fix:* disposition-framed phrase set; top-k stances (pairs with E11).
- **E60 [LOW · Change] `socialInitiatives` ships the exact canned string ADR 0003 names as a
  smell** (`pretext: "wants a word with you"`, `GameSessionAdapter.ts:454`) while discarding the
  computed drive. *Fix:* coarse categorical motive (`bond | probe`), never the number.
- **E61 [LOW · Improvement] Exact ties resolve by array position, not seed** (`liveSeason.ts:400`,
  `:772` — the player is `active[0]` and loses final-eviction ties; `competitionOutcome.ts:91–92`).
  *Fix:* one rng draw on exact ties. *Test:* tie outcomes vary by seed, not slot.
- **E62 [LOW · Bug] An unimplemented twist kind would wedge the pure twist machine**
  (`rollWeek` runs only `double-eviction` but arms any kind, `liveSeason.ts:482,495–496`;
  only the adapter's `IMPLEMENTED_TWISTS` filter saves it); `battle-back` — the documented
  reason the jury tie-break exists — is unimplemented. *Fix:* drop unrunnable pendings in
  `rollWeek` (recorded as never-fired); implement `battle-back` later.
- **E63 [LOW · Improvement] Determinism & constants hygiene cluster.**
  `applyDecision` defaults `new SeededRandom(1)` (`liveSeason.ts:935` — make rng required);
  `beatRng` reuses one stream per (week,beat) across subsystems (namespace by purpose,
  `GameSessionAdapter.ts:778–788`); `diffuseGossip` default `transmitProb=0.8` vs. the tunable
  `0.25` (`gossip.ts:92` vs `:38`); inline magic numbers (`relationships.ts:163`, `jury.ts:42`,
  `conversation.ts:50`, `GOODBYE_MESSAGE_COUNT`, `ALLY_TRUST_FLOOR`) hoisted to constants
  modules + B59 grep gate; legacy `recordVoteAgainstPlayer` folds the wrong direction
  (`consequence.ts:96–100` — retire or fix); production off-screen ids embed wall-clock time
  breaking the orchestrator's own reproducibility contract (`orchestrator.ts:406–408`);
  hard casts to in-memory adapters in the durable path (`registry.ts:148,162,164` — add
  `serialize/restore` to the engine-only ports before the SQLite adapter lands); dead/drifting
  modules (`ConsequenceEngine`/`restoreMemory`, `SaveStore`+`InMemorySaveStore`,
  `LlmNarrativePort` never composed and `setNarrator` typed against the *sync* port so the
  documented seam doesn't type-check, `PlayerSurface.renderScene(fidelity)` unreachable via
  MCP) — delete or annotate.

### Theme 7 — Front-end UI/UX & immersion (beyond the D-batch)

- **E64 [HIGH · UX · ruling] The status HUD moves into the sidebar, permanently.** Today
  `#orwell-status` is `position:fixed; top:64px; right:14px; z-index:9000`, draggable
  (`orwellStatusPanel.js:21–30, 93–94`) with minimize-to-dock — and it's one of the R2/R4
  colliders. *Ruling:* it is not a window. *Fix spec:* mount the panel as a docked section
  inside `#sidebar` (below the session list), full sidebar width, no drag, no `POS_KEY`, no
  z-index/collision surface; keep the poll/render logic and aria-live announcer untouched; on
  mobile it lives in the existing sidebar drawer (hamburger), removing the C26 park-on-mobile
  special case for this panel. Collapsible within the sidebar is fine; floating is not.
  *Tests:* pytest/browser-smoke assert `#orwell-status` is a descendant of `#sidebar`, never
  `position:fixed`, and the composer/Diary-trigger overlap checks (D2) pass trivially for it.
  *Note:* this shrinks D2's scope to the presence strip + retrospective panel and removes a
  whole colliding window from R4.
- **E65 [HIGH · Bug] `orwell:gamechanged` has four listeners and zero dispatchers.**
  Listeners at `orwellSocial.js:446`, `orwellStatusPanel.js:357`, `orwellFinale.js:225`,
  `orwellEngineStatus.js:99`; no `dispatchEvent` anywhere — so panels never refresh on a new
  game and dismissed approaches (`localStorage orwell-social-dismissed`, keyed by recurring
  `npc:N` ids) suppress season-2 approaches forever. *Fix:* dispatch from `chat.js`
  `tool_output` on successful `createCharacter`/`manageSandbox`, and from onboarding; test for
  a dispatcher, not just listeners. Pair with the in-chat restart needing a fresh session
  (F7 currently runs only at page load) — on restart success, reuse `takeASeat` so a dead
  season's transcript never rides as narrator context.
- **E66 [MED · UX] Pending decisions must survive reload** (= **D3**, endorsed) — concretely:
  expose `pending` on `GET /api/orwell/status` (Vault-free legal-options view) and have
  `orwellDecision.js` render from it on load/poll, rather than only the live
  `orwell:pending` event.
- **E67 [MED · UX] Finale panel parity.** It misses every sibling convention: 5s poll forever
  with no hidden-tab gate or backoff (`orwellFinale.js:19, 218–222`; C18), no mobile
  treatment (`:70–77`; C26/M1), no `role`/`aria-label` and a silent vote reveal (the game's
  most dramatic incremental update; the status HUD's polite announcer is the model). *Fix:*
  slow poll until finale-adjacent phase; sheet/dock-park on ≤768px; `role="complementary"` +
  `aria-live="polite"` reveal announcements.
- **E68 [LOW · Bug] Status-panel poll backoff never recovers while a game is live**
  (`orwellStatusPanel.js:324–340`; success path never resets `_failures` — HUD degrades to
  2-minute refresh after one blip). *Fix:* reset on success like `orwellSocial.js:408`.
- **E69 [LOW · Bug] "11st out / 12nd out / 13rd out"** — `orwellStatusPanel.js:298` ordinal
  logic; reachable every endgame. *Fix:* standard ordinal helper (11–13 ⇒ "th").
- **E70 [LOW · Change] `POST /api/orwell/new-game` bypasses the 0050 casting interview**
  (`orwell_routes.py:205–232` — a soul-shallow character one curl away; no UI consumes it).
  *Fix:* admin-gate or delete in favor of the chat tools (folds into D1's one-door work).
- **E71 [LOW · UX] Panel client state isn't keyed per user/game** (bare `localStorage` keys —
  dismissals/positions shared across accounts and seasons). *Fix:* suffix with username +
  game/seed id.
- **E72 [LOW · UX] The composer model picker shows raw model ids to every player under the
  game build** (`index.html:813`). *Fix:* hide `#model-select` for non-admins (per-user default
  model resolution already exists, `settings.py:388–401`).
- **E73 [LOW · Improvement] Deals are write-only from the player's seat** — no read lever
  (`orwell_engine.py:342–344` is `make_deal` only), so the GM cannot *recall* standing deals
  from the store (and must not from chat). *Fix:* a Vault-free `myDeals` read on the player
  channel (terms/status/week only — the player's own deals, no hidden state); chat-voiced, no
  panel (ADR 0003).
- **E74 [LOW · Improvement] Six independent pollers, four fetching `/api/orwell/state`
  separately.** *Fix:* one shared `orwellState.js` poller broadcasting via the existing
  CustomEvent pattern (halves steady-state volume); also satisfies D11's cache-bust-on-new-game.
- **E75 [LOW · UX] Up to ~9.4s of silent serial framing waits when the engine hangs**
  (`chat_helpers.py:66–78`: 3s + retry 0.4+3s + 3s before the LLM streams). *Fix:* early SSE
  keepalive ("checking the feeds…") or shorten the retry budget.
- **E88 [HIGH · UX · ruling] The Diary Room becomes a persistent sidebar button — no floating
  dialog.** Today the DR is a button inside the social HUD that opens a draggable
  `aria-modal` dialog (`orwellSocial.js:176, 185–186, 236+`). *Ruling:* the entry point is a
  standing sidebar button like chat/theme — always present while a game is active — and the DR
  is not a window. *Fix spec:* move the `📔 Diary Room` trigger into `#sidebar` as a permanent
  nav button; clicking it enters a **Diary Room composer mode** in the chat itself (visible
  in-composer indicator + the existing `POST /api/orwell/diary-room` send path, exit on
  send/escape) — chat-first per ADR 0003, no floating box, no drag handler, no modal focus
  trap to maintain. The social HUD keeps only approaches. *Tests:* browser smoke asserts the
  DR trigger is a `#sidebar` descendant and no `osoc-box` dialog node is created;
  `window._orwellOpenDiaryRoom` seam re-pointed at the composer mode. *Note:* with E64 (status
  HUD) and this, R4's Diary-trigger occlusion becomes unreachable and D2 shrinks to the
  presence strip + retrospective panel.
- **E89 [MED · UX · ruling] NPC approaches must not fire at the very start of the game.**
  `orwellSocial.js` gates only on `st.started` (`:6, :409`), and engine-side `socialInitiatives`
  ranks approaches from move-in — so "___ wants a word with you" can pop before the player has
  had a single unprompted beat in the house. *Ruling:* the approach surface may stay a window,
  but it stays silent at the beginning. *Fix spec:* engine-side gate (preferred, structural):
  `socialInitiatives` returns empty until the first ceremony beat has resolved (e.g. the
  week-1 HOH result is committed) — giving move-in/first-scene space to breathe; FE keeps its
  existing started-gate as the belt. Threshold lives in a constants module, not inline.
  *Test:* a fresh game pre-first-HOH ⇒ `socialInitiatives` empty across seeds; post-HOH ⇒
  approaches resume.
- **E90 [LOW · UX · ruling] The theme button docks at the sidebar bottom, beside settings,
  icon-only.** The theme entry (opens `#theme-modal`, `index.html:444+`) currently sits in the
  main sidebar nav with a text label. *Fix spec:* move it into the sidebar's bottom cluster
  next to the settings icon as an icon-only button (the existing palette SVG from the modal
  header), `title`/`aria-label="Theme"` for tooltip + a11y — no visible text. Same treatment
  under the game build and the full workspace. *Test:* browser smoke asserts the trigger is in
  the bottom cluster, has an accessible name, and renders no text node.
- **E91 [MED · Bug · ruling] Floating-panel positions don't survive a refresh.** Each panel
  saves `{left, top}` on drag-end (`orwellStatusPanel.js:188`, `orwellSocial.js:226`) and has a
  `restorePosition` (`:66/:64`) — yet a refresh observably resets windows to wrong-looking,
  pseudo-random placements. Likely causes to verify: restore running before layout settles
  (clamping against a 0-height viewport), saves firing with stale/parked rects (minimized-to-
  dock state writing the dock position), or `ensureUI` re-creating nodes without re-running
  restore on the poll path. *Fix spec:* restore after first layout (rAF), never save while
  parked/minimized, clamp restored positions to the viewport *and* the D2 collision rule, and
  key positions per user+game (E71). For panels the rulings move out of windows (E64 status,
  E88 Diary Room) this becomes moot; it must work for the survivors (social, presence,
  finale, retrospective, "wants a word"). *Test:* browser smoke drags a panel, reloads,
  asserts the rect is restored within tolerance and passes the overlap checks.
- **E92 [MED · UX/Bug] The chat container is missing bottom padding — the composer touches the
  viewport bottom edge** at any width (user-reported on desktop; `style.css:1931–1946` gives
  `.chat-input-bar` a bottom margin only in `welcome-active` mode, `margin-bottom:30vh`, and
  none in normal chat). *Fix spec:* a small constant bottom inset on the normal state (e.g.
  `padding-bottom: max(10px, env(safe-area-inset-bottom))` on the container or
  `margin-bottom` on `.chat-input-bar`), all viewports; verify the chat-history scroll
  bottom-anchor compensates. *Test:* browser smoke asserts the composer's bounding rect bottom
  sits ≥8px above `window.innerHeight` at 390/820/1440 widths.
- **E93 [MED · Bug] Message edit/delete controls are active on game turns — the player can
  rewrite recorded history.** The live transcript shows `✎ Edit` / `✕ Delete` actions on both
  player messages and GM narration (`msg-action-btn` footers). The chat transcript is the
  *played record* of events the engine has already recorded and folded; editing or deleting it
  desyncs the visible story from the EventStore (and edit-then-regenerate is a re-roll lever —
  an anti-sycophancy hole at the UI layer; the v1 player's own ruling was "I don't want to
  recreate things after the results were shared. That seems like cheating."). *Fix spec:*
  under the game build, on `game_active` sessions: hide edit/delete/regenerate on all
  messages after game start (keep copy); pre-game OOC sessions unaffected. *Test:* pytest/
  browser smoke asserts no edit/delete affordances render on a started game's transcript.
- **E94 [MED · UX/Bug · ruling] Image attach: promote it out of the overflow menu and make it
  work in character.** Today "Attach files" is an overflow-menu item behind the `+` button
  (`index.html` `#overflow-attach-btn`) — one icon hidden behind another — and nothing
  guarantees an attached image reaches the model with game framing intact. *Fix spec:* (a) a
  first-class paperclip button directly in the composer row under the game build (the
  drag-and-drop path stays); (b) verify/wire the attachment pipeline on **game turns**: the
  image rides the agent-stream request to a vision-capable model alongside the GM moment
  prompt, with a one-line framing addition (the player is *showing something* to whoever is
  present in the scene — a photo from home, a found object) so the model analyzes it and
  responds **in character for the moment**, and the beat is recorded via `recordInteraction`
  like any scene (the E22 guard applies); (c) graceful in-fiction refusal when the configured
  model has no vision capability ("the feeds can't read that"). *Tests:* pytest asserting a
  game-turn payload with an attachment keeps the GM framing and the attachment; browser smoke
  asserts the composer-level attach button exists under the game build.
- **E95 [MED · UX · ruling] Relocate the minimized-window dock to the sidebar.** Minimized
  panels currently park as chips at the top of the chatbox; the chip strip doesn't re-center
  when the sidebar toggles or the viewport resizes (stale absolute centering), and the
  placement itself is rejected by ruling. *Fix spec:* dock minimized panels as compact rows in
  a "Windows" cluster at the bottom of `#sidebar` (icon + name, click restores; consistent
  with E64/E88/E90 making the sidebar the game's chrome home); kill the chatbox chip strip;
  the existing `.hidden modal-minimized` pointer-events leak (R2/R4/D2) dies with it. On
  mobile the dock rows live in the sidebar drawer. *Tests:* browser smoke minimizes each
  surviving floating panel and asserts the chip renders inside `#sidebar`, restores on click,
  and no dock element overlaps the composer at any width.
- **E96 [LOW · UX · ruling] Remove "Save to Documents" from the export menu.** The export
  dropdown (`#export-doc-btn`, `index.html` chat top bar) carries the inherited workspace's
  "Save to Documents" — pointing at a Documents feature the game build doesn't surface.
  *Fix spec:* remove/hide the item under the game build (keep Copy/PDF/Rename); if Documents
  is off in the full build config too, delete the dead handler. *Test:* pytest asserts the
  game-build DOM contains no `#export-doc-btn`.
- **E97 [LOW · UX · ruling] Windows animate on open, close, and minimize.** Floating panels
  currently appear/disappear instantly (display toggles; only incidental transitions exist).
  *Fix spec:* one shared animation contract for all game panels — open: fade+scale-in from the
  trigger (~150–200ms ease-out); close: the reverse; minimize: a translate+scale toward the
  E95 sidebar dock row (so the motion *teaches* where the window went); honor
  `prefers-reduced-motion: reduce` by disabling all three. Implement once in the shared panel
  scaffolding rather than per-panel CSS. *Test:* browser smoke asserts the panel root carries
  the transition class and that reduced-motion disables it.

### Theme 8 — Tests & gate integrity

- **E76 [MED · Test] Feature 0023's BDD gate tests the quarantined fixture, not the live
  consequence loop.** `consequence_memory.steps.ts:4` imports `ConsequenceEngine`/`restoreMemory`
  (zero production callers); and the "opinion change is invisible" scenario records the shift
  into a throwaway `freshEngine(1)` then sweeps surfaces the shift never touched
  (`:59–72` — cannot fail by construction). Violates remediation principle #7 on the flagship
  feature. *Fix:* re-point the steps at a registry-built sandbox (the
  `live_progression.steps.ts:151–168` restart pattern is reusable); fold through the sandbox's
  own session before sweeping.
- **E77 [MED · Test] The `no-circular` dep-cruiser rule is enforced nowhere**
  (`tests/support/architecture.ts:43` filters to the Vault rule; `npm test` and CI never run
  `test:arch`). *Fix:* assert all forbidden rules empty, or add the CLI step to CI.
- **E78 [MED · Test] The "no secrets committed" guard scans almost nothing**
  (`secrets.test.ts:18–23`: `deploy/` + root configs only — not `src/`, not the vendored
  `frontend/`). *Fix:* scan all `git ls-files` minus lockfiles/binaries.
- **E79 [LOW · Test] `transportHardening.test.ts` vacuous/racy spots.** `:42` passes with zero
  assertions when the fetch rejects; `:92` real-timer race on the E10 ordering test. *Fix:*
  assert the disjunction + no side effect; gate on entering `callTool` instead of wall time.
- **E80 [LOW · Test] `deploy/smoke.sh` refutes are textual and shallow.** `:88` grep-"proves"
  update never deletes data; `:75` stat-leak refute checks only `"physical":`/`"score` (not
  mental/social/trust/affinity/threat). *Fix:* behavioral sentinel-save check; extend the
  refute list. Also promote the round-4 Playwright harness into `frontend/scripts/` as a
  staged-state UI smoke (per PR #200's method note) once D1–D3 land.
- **E81 [LOW · Test] `src/main.ts` env parsing is untested and coverage-excluded**
  (`ORWELL_ENGINE_MULTIUSER` regex, host plumb). *Fix:* extract `parseEngineEnv(env)` into a
  tested module.
- **E82 [LOW · Test] The legacy-name deny-list is literally names-in-a-test**
  (`replayability.steps.ts:12`). Defensible, but convertible: compute the forbidden set from
  `docs/legacy/` at runtime, or assert corpus-membership once E38 lands (which subsumes it).

### Theme 9 — Ops, deploy & supply chain

- **E83 [MED · Ops] Frontend Python deps are 100% unpinned and reinstalled blind on every
  update** (`requirements.txt`: zero `==`; `orwell-update.sh` runs `pip install -r` each time;
  ADR 0004 claims fastembed is version-pinned — it is not, see E86). *Fix:* `pip-compile`
  lockfile + CI pin-check.
- **E84 [MED · Ops/Security] `curl | bash`-as-root self-update with no integrity check**
  (update/factory-reset host bridges fetch branch-tip from raw.githubusercontent; nodesource
  pipe; mutable CI action tags). *Fix:* execute the already-checked-out in-container copy after
  a pinned-ref fetch, or verify a published SHA-256; pin action SHAs. *(The new
  `orwell-game-reset.sh` inherits the same bridge pattern by consistency — fix all three
  together.)*
- **E85 [LOW · Ops] systemd hardening stops early + frontend unit crash-loops without `.env`.**
  Missing `CapabilityBoundingSet=`, `RestrictAddressFamilies`, `SystemCallFilter=@system-service`,
  `ProtectKernel*`, `RestrictSUIDSGID`, `LockPersonality`, `UMask=0077` (test
  `MemoryDenyWriteExecute` carefully — Node JIT); `orwell-frontend.service` needs a default
  `Environment=ORWELL_PORT=8080` since its EnvironmentFile is optional. Add a
  `systemd-analyze security` floor to `orwell-doctor.sh`.

### Theme 10 — Docs, specs & the queue record

- **E86 [HIGH · Drift] ADR 0004 is accepted but unimplemented, and CLAUDE.md presents it as
  running.** No `fastembed` in `package.json`; the only adapter is `DeterministicEmbedding`
  (whose comment still says "open decision #4"); no deploy script fetches a model — production
  "semantic" recall (0024/0041) runs on a hash-vector fake, undetectable by the gate because
  the fake is the test adapter. *Fix:* build the fastembed adapter (lazy ONNX load, fallback to
  the deterministic embed, pinned lib+model, deploy-time model fetch) **or** amend ADR 0004 to
  "Accepted — adapter not yet built" and move it to the deferral list. Either way CLAUDE.md
  stops overclaiming.
- **E87 [MED · Drift] Doc-hygiene sweep (one B57-style PR).** (a) 0036 and 0033 say "add to
  cucumber.cjs when green" and never were — gate them or record the unit-gated deviation;
  (b) 0029's `.feature` needs the honest "validated by frontend pytest" header like 0010's;
  (c) CLAUDE.md wrongly groups 0035 as "unit-gated" (it's BDD-gated) and never mentions 0029;
  (d) the queue's "Still on the feature-maker" block (lines 874–909) and the "Reconciliation
  still owed" note (`:2076–2080`) contradict the drained banner — stamp HISTORICAL or resolve;
  (e) README indexes 0010 as plain "Done" vs. its own spec's "not done until host-validated";
  (f) B70's stated thresholds (90/90/90) vs. actual (90/88/82); (g) 49 of 50 `.feature` files
  still carry "# DRAFT executable spec" headers; (h) CLAUDE.md should parenthesize that the
  "HTTP MCP server" does not yet speak MCP/JSON-RPC; (i) `cucumber.cjs:44–45` ordering/indent
  cosmetics.

---

## Future specs (new features, not audit findings — start as new `NNNN` specs per the rule)

- **0051 (proposed) — In-character image generation.** The model can *produce* images as part
  of play (a houseguest's sketch, the memory-wall portrait, a "camera still" of a scene),
  rendered inline in the chat. Per the 2026-06-10 ruling this is a feature spec, not a defect:
  it needs its own design pass — which moments may generate (player-requested vs.
  producer-beat), how generation stays Vault-free (prompts built only from the player's
  visible state — the E11/E15 discipline applies to image prompts too), seed/style consistency
  per season so the house looks like itself, cost/latency gating, and graceful absence when no
  image-capable model is configured. Natural pairing: E94's attach flow (analyze in, generate
  out) and D9/E64's portrait surfaces (a generated cast portrait set at season start is the
  obvious first deliverable). Write as `docs/features/0051-in-character-images.{md,feature}`.

- **0052 (proposed) — House themes for the theme picker** *(ruling #13, 2026-06-10)*. Five
  built-in themes that carry the game's identity, defined **first** in the `THEMES` preset
  object so they render as the picker's opening row (`theme.js:617–633` renders
  `Object.entries(THEMES)` in insertion order); each is a full token set in the existing
  preset shape (`bg/fg/red/accent/…` — same keys the `orwell-theme` localStorage payload and
  swatch renderer already consume), body text at WCAG AA contrast, no animated textures (any
  scanline/noise effect is static or `prefers-reduced-motion`-gated):
  1. **The Feed** — night-vision surveillance: near-black green-cast background, phosphor-green
     foreground, desaturated mid-grays, a blinking-REC red reserved for `--red`/alerts.
  2. **Telescreen** — Orwell's CRT: deep charcoal with a faint cyan-white glow for text, pale
     blue panel tint, vignette-dark borders; accent the cold cyan of a screen that watches back.
  3. **Room 101** — institutional dread: gray-green walls, fluorescent off-white text,
     danger-red accent, hard borders (minimal radius via existing tokens where supported).
  4. **Memory Wall** — the gallery after an eviction: near-black blue-charcoal, backlit
     portrait-blue accents, warm tungsten highlight for active elements, dimmed gray for
     "evicted" muted text.
  5. **Sequester** — the jury house: low-contrast wine/maroon depths, brass-gold accent,
     velvet-dark panels; cozy with an undertone of waiting.
  **Frosted glass + delightful animation are critical to these themes** *(ruling addendum,
  2026-06-10)*: house themes ship with translucent, backdrop-blurred surfaces — sidebar,
  floating panels, modals, the minimize dock — (`backdrop-filter: blur(…)` + a translucent
  panel token over the theme background) so the house is always faintly visible through the
  chrome, and with delightful micro-motion as part of the theme identity: the E97 open/close/
  minimize animations tuned per-theme (e.g. The Feed's REC dot pulses; Telescreen powers
  panels on with a brief CRT bloom; Memory Wall backlights swatches on hover), plus soft
  eased hovers on swatches and buttons. Constraints: `prefers-reduced-motion` disables motion
  (never the frost); a no-`backdrop-filter` fallback (solid panel at higher opacity) keeps
  low-end/unsupported browsers legible; frost stays off the chat text column itself
  (readability first); contrast measured against the *effective* blurred composite, not the
  raw token.
  Placement/behavior: house themes appear before `dark/original` and all inherited presets;
  the default theme for fresh game-build installs may switch to **The Feed** (decide at
  implementation — record as its own mini-ruling); custom-theme machinery untouched.
  *Tests:* pytest/browser smoke assert the first five `themeGrid` swatches are the house set,
  each applies (body computed background matches token), frosted surfaces carry the
  backdrop-filter (or the fallback class when unsupported), reduced-motion strips the
  animation classes, and a contrast check on fg/bg pairs passes AA. Write as
  `docs/features/0052-house-themes.{md,feature}` (FE pytest-validated, honest 0029-style
  header — not cucumber-gated).

## Deferral specs (unchanged status, now concretely scoped)

- **0022 MVP-2:** parked correctly; its §4/§8 "player read" cards violate ADR 0002's
  human-driven-reads ruling and must be redesigned (facts-known + observable behavior) before
  un-parking. Most of its plumbing (roster C21, recap C17, decision cards C20) already shipped.
- **0010 Proxmox host smoke:** run `deploy/orwell.sh` on a real host; verify
  install→play→update→data-survival; record it; fix the README status row.
- **Relational adapters:** `better-sqlite3` `SaveStore` + `sqlite-vec` `VectorIndex` behind the
  existing ports; the 0007 property suites are reusable as-is; E63's port-capability fix
  (`serialize/restore` on the engine-only interfaces) is the prerequisite.
- **Full MCP/JSON-RPC:** a JSON-RPC 2.0 envelope (`initialize`/`tools/list`/`tools/call` + SSE)
  over the existing `McpServer.toolsFor(channel)` allowlists, preserving B34/B60/B67; then point
  the FE's real MCP machinery at it.

## What verified sound (keep-list)

Eligibility/legality pure and temperature-proof; 16/9/2 math consistent everywhere; the
Houseguest's-Choice draw incl. player-defers; intent immutability; ~72% favorite calibration;
the endgame ladder topology (F4 sole vote, F3 final eviction); the staged finale (18 Q&A) and
ordered reveals (no pre-reveal winner anywhere); the 0048 unsealing genuinely code-gated on
terminal state; the casting card crossing tier words only; witness/hidden store-invariant;
no player protection anywhere in the engine; the live sentinel sweep's self-auditing coverage
assertion; the exchangeability fairness test on the production loop; B36/B47/B53/B56/B64/B73
status prose matching code; the amendments table fully implemented; zero undefined BDD steps;
the factory-reset script's three-generation path resolution (now shared by the game-reset
script); FE XSS discipline (`textContent`/`esc()`/fixpoint sanitizer) and the
browser-never-reaches-engine guarantee (B66 + loopback bind).

## Recommended wave order

1. **Wave E-CRIT — make seasons restartable and reachable:** E1+D1 (one restart door, baseline
   reset, 4xx on fault), E2, E3, E4 → then re-run the round-4 calibration measurement and land
   E33/D4's jury-reach gate. *(Everything else about the endgame is unreachable content until
   this wave lands.)*
2. **Wave E-SEC — the wall and the edge:** E9, E27, E28, E29, E30, E10, E15, E16, E17, E20,
   E21, E18, E19.
3. **Wave E-SOCIAL — make the simulation matter:** E42, E43, E44, E45, E57, E49, E50, E51,
   E47, E48, E55, E46, E54, E56, E52, E53, E58.
4. **Wave E-PLAYER — agency & first impressions:** E38 (names), E34 (goodbyes), E35, E36, E64
   (sidebar HUD), E88 (sidebar Diary Room), E89 (approach timing), E93 (no editing the record),
   E91 (positions persist), E94 (image attach), E95 (sidebar dock), E65, E66/D3, E22, E23,
   E39/D8, plus the D2/D5–D10 batch from PR #200.
5. **Wave E-POLISH/OPS/DOCS:** the LOW clusters (E8, E13, E14, E26, E32, E37, E40, E41,
   E59–E63, E67–E75, E79–E82, E85, E90, E92, E96, E97), E76–E78, E83/E84, E86/E87. Then the
   0051 future spec.

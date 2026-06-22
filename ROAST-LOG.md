# Orwell — Pre-Launch Exhaustive Roast Ledger

> Companion to `AUDIT-LOG.md` (the careful VIEWED/VERIFIED trace ledger). This file is the
> **exhaustive roast** the owner asked for: every issue / bug / problem / thing-not-wired /
> playtest / UX smell, no matter how small, grounded in **current source (file:line)**.
> Single writer = the lead. Read-only specialists fan out and return findings; the lead
> reconciles, de-dupes, and logs here.

## Hard exclusion (owner directive, 2026-06-22)
**Do NOT roast anything `AUDIT-LOG.md` records as `VERIFIED-FIXED` / `VERIFIED`** (visually
re-confirmed in the playtest harness). Re-roasting a fixed bug is embarrassing. Every entry below
is either (a) OPEN / partial / deferred / latent in the ledger and **re-confirmed still-real in
current source**, or (b) **absent from the ledger entirely** and confirmed in source. The ledger
prose drifts — the code is the oracle, so every roast cites `file:line`.

## Severity legend
`[BLOCK]` launch-blocking · `[POLISH]` high-priority polish · `[LATENT]` latent/potential (same
mechanism, not yet firing) · `[NIT]` small/cosmetic · `[DOC]` documentation drift / not-wired claim

## Status
`PROPOSED` (specialist reported) · `CONFIRMED` (lead verified in source) · `VIEWED` (seen in
telemetry) · `ROOT-CAUSED` · `DUP` (already in AUDIT-LOG) · `REJECTED` (theory w/o mechanism, or
actually fixed) · `FIXED`

## Method
Real stack (TS engine :8765 = ground truth, FastAPI FE :7000), engine-is-truth oracle, harness in
`docs/audits/playtest-harness/`. Static code roast first (this pass), live two-window×device VIEW
to follow on the juiciest. No theory without a traced mechanism.

---

## Lead's own findings (pre-fan-out)

### R-DOC-1 · `[DOC]` · CONFIRMED · CLAUDE.md systematically understates the built feature set
- **Evidence:** `CLAUDE.md` says "through **0069**" / "drafted spec set (0001–0069)" in ≥4 places
  (status header, "Current status", "Open decisions"); but `docs/features/README.md` index ships
  **0070–0074** as ✅ Built (0070 off-screen texture, 0071 redaction/URL guards, 0072 multi-platform
  gateway, 0073 game-build CI wall, 0074 local HTTPS / ADR 0014).
- **Mechanism:** CLAUDE.md is hand-maintained prose; the feature index is reconciled against source.
  The two diverged when 0070–0074 merged without a CLAUDE.md sync. CLAUDE.md even lists ADRs
  "0001–0014" (so 0014/HTTPS is known) yet the feature prose stops at 0069 — an internal contradiction.
- **Why it matters:** CLAUDE.md is the FIRST doc a new implementer/agent reads ("read these first").
  Understating the built surface by 5 features mis-briefs every future contributor about what exists,
  what's wired, and what's launch-relevant (0071 redaction + 0072 gateway + 0074 HTTPS are all
  security-surface).
- **Confidence:** high. Falsifiable by a single grep; already cross-checked both files.

*(More findings appended below as the fan-out returns.)*

---

## Lane 2 — Engine boundary / adapters / MCP / Vault / composition

### R-BND-1 · `[LATENT]` · CONFIRMED (lead-verified in source) · 0070 off-screen-texture write-back bumps the closed-set `beatSeq` — the exact pattern the registry engineered *around*
- **Lens:** distributed consistency (optimistic CAS / lost-update) + architecture (ADR 0005 open-vs-closed split).
- **Evidence:** `src/adapters/engine/GameSessionAdapter.ts:4162-4163` (`recordOffscreenSceneTexture` → `this.persist()`); `:408-414` (`persist()` → `onPersist?.()`); `src/composition/registry.ts:573-586` (the wired `onPersist` = `commit()` → `session.bumpBeatSeq()` at `:583`). **Contrast that proves intent:** `registry.ts:430-443` — the next-season warm explicitly does NOT route through `commit` ("it must NOT bump `beatSeq`… or a BACKGROUND advance-warm would look like a board mutation… and trip a phantom desync"), using `invalidateSnapshot` + blind `saveUser` instead. FE trigger: `frontend/src/orwell_offscreen_texture.py` `kickoff_enrich` is a fire-and-forget `loop.create_task` voicing ≤6 scenes, each calling the write-back with **no `expectedBeatSeq`** and bypassing `_refresh_beat_seq` (`frontend/src/orwell_engine.py:470-476`). Test comment admits the unguarded bump: `tests/unit/offscreenTextureBoundary.test.ts:200-203` ("only textureOverrides and beatSeq (commit counter) differ").
- **Mechanism (lead-verified):** turn completes at `beatSeq=N`; FE refreshes last-seen to N; `kickoff_enrich` then bumps N→N+6 in the background while the player composes T+1. Dominant path (turn-start framing read picks up N+6 before any mutate) is SAFE. Residual race: a texture write commits *between* T+1's framing read (N+2) and its mutating call (carries N+2) → `StaleBeatError` → 409 `stale-beat`. For `advanceGame`/`submitDecision` it reconciles; for the `_backfill_with_cas` belts (`frontend/src/agent_loop.py:1725-1731`) the player's scene/deal/move is **reconciled-and-SKIPPED** — its only consequence fold dropped — attributed to a "genuine concurrent move" that was in fact *the engine's own enrichment task*.
- **Differential:** not a lost update (engine CAS prevents double-apply); not a leak (content-only, boundary-guarded `McpServer.ts:166-177`); distinct from the documented A-S3 latent (that posits a real second device — here the trigger is self-inflicted, so it reproduces in single-tab play). "Harmless, turn-start refresh always closes it" fails: enrichment is async/unbounded in completion vs the player's next mutate, so the interleave window is real (narrow).
- **Why it matters:** ADR 0005's spine — open-set prose must never perturb closed-set machinery. A flavor task can burn a stale-beat reconcile + model re-ground (an extra round, feeding the very S3-LOOP exhaust ADR 0011 fought) AND silently drop a player scene's consequence fold (mandate #4 non-degradation). The correct pattern already exists one function over.
- **Confidence:** high (bump traced end-to-end + test comment). **Falsifier:** route durability through `invalidateSnapshot(user)` + blind `saveUser(user)` (like `warmNextSeason`); a unit test `advance → read beatSeq=B → recordOffscreenSceneTexture → assert beatSeq===B` currently **fails** (returns B+1) and would then pass.
- **Harness-confirmable?:** yes, deterministically, no model: the Vitest assertion above. FE: a pytest that the 0070 path never threads `expected_beat_seq`.

### R-BND-2 · `[LATENT]` · CONFIRMED · `recordWorldSnapshot` shares the same `beatSeq`-bump smell (lower exposure)
- **Evidence:** `src/adapters/engine/GameSessionAdapter.ts:4105` (`recordWorldSnapshot` → `this.persist()`); FE driver `frontend/src/orwell_zeitgeist.py` (best-effort background task).
- **Mechanism:** identical to R-BND-1 but the zeitgeist is captured ONCE, at/just-after game start before the player is deep in mutating turns, so the interleave window rarely overlaps a CAS write. Same principle violation (open-set capture moving the closed-set counter); same fix (durability via `invalidateSnapshot` + blind save).
- **Confidence:** high on the bump, low on live impact. **Falsifier/harness:** same shape as R-BND-1.

**Lane-2 scope confirmed CLEAN (not roasted):** the four-place write-back gotcha is comprehensively closed — all six `GameSession` write-backs (`preSeedCast`, `preSeedNextSeason`, `recordCastProfile`, `recordWorldSnapshot`, `getOffscreenSceneSkeletons`, `recordOffscreenSceneTexture`) + `recordImageBeat` are wired in all four places with a `McpServer.callTool` boundary test each; no outward module imports `VaultStore`/`VectorIndex`/`SoulProvider`; the single restart door holds (`registry.resetUser`); the `beatSeq` commit funnel bumps once-per-commit and rolls back on a refused checkpoint; the SQLite store serializes the whole snapshot as JSON so new fields round-trip without schema drift. **Lane-2 structural smell:** there's no *enforced* seam for "open-set fail-soft write-back persists WITHOUT bumping `beatSeq`" — the correct pattern lives as a prose comment on one call site (`registry.ts:432-443`), so the next two background write-backs to ship both silently took the wrong channel. Same "typechecks, passes arch, wrong at runtime" trap as the dispatch gotcha, but on the consistency axis.

---

## Wave-1 tally (8 static lanes complete, 2026-06-22)
~40 findings. Highest-signal NEW (lead-verified): **ENG-1** (sleep clock ships ON, uncalibrated, anti-sycophancy tilt), **SOC-1** (emergent blocs never surfaced as structure), **NARR-3** (no structural cast-invention guard — bites on `-flash`), **R-BND-1** (open-set write bumps `beatSeq`), **FEPY-1** (casting error renders as GM narration), **FEPY-4** (concurrent stale-409 drops a scene's only consequence fold). Plus a substantial **doc-drift** cluster (DOC-1..8) and two latent **public-exposure security** gaps (EXPOSE-1/2).

---

## Lane 1 — Engine domain core & mechanics (`src/domain`, `src/engine`)

### ENG-1 · `[LATENT·high]` · CONFIRMED (lead-verified) · The time-of-day sleep penalty ships **ON** in the deployed game but **no calibration gate runs that path** — an uncalibrated, player-favoring anti-sycophancy tilt
- **Lens:** anti-sycophancy (mandate #3) + behavioral fidelity + MDA (a static stat laundered as a per-night choice).
- **Evidence:** `frontend/src/settings.py:35` `"time_of_day_enabled": True`; `frontend/routes/chat_helpers.py:77` pushes it to the live engine at boot; `src/adapters/engine/GameSessionAdapter.ts:3001-3010` `timeOfDayOverride` overrides the `ORWELL_TIME_OF_DAY` env default; engine comment `:2997` confirms golden sims set neither ⇒ stay OFF. Penalty math: `liveSeason.ts:869` `npcRestDeficit(stats)=restDeficitFor(bedtimeFor(stats))`; `timeOfDay.ts:103-108` `bedtimeFor = social − physical` (≥0.12 ⇒ late-night ⇒ deficit 1.0); `competitionOutcome.ts:118` `rest = −restPenalty × sleepPenalty(0.15)`. Calibration gates run clock-OFF (`juryReachShared.ts:104`).
- **Mechanism:** an NPC's comp rest penalty is a pure function of its **static** `social − physical` aptitude, recomputed every comp all season, decoupled from what it did that night. Social archetypes carry a permanent ~−0.15 malus (~42% of the temperature band) into every comp; comp-beasts never pay; the **player's** deficit is dynamic and avoidable via the player-only `turnIn` lever. So a savvy human gains an edge the social NPCs structurally cannot escape — on the path the deploy actually runs, which no gate measures.
- **Differential:** not a determinism leak (byte-stable); not a spine regression (band runs OFF). The defect is the deploy-on path being unmeasured + the asymmetry. CLAUDE.md's "opt-in default off" is true of the gates, **false of the shipped product** (cross-ref R-DOC drift).
- **Confidence:** high on mechanism/asymmetry/default-on; med on player-impact magnitude (depends on `turnIn` discoverability). **Falsifier:** re-derive `npcRestDeficit` from each NPC's actual simulated bedtime, OR ship clock-OFF, OR add a clock-ON jury-band gate.
- **Harness-confirmable?:** yes — play a clock-ON seeded season, compare social-archetype vs comp-beast comp-win rates against the spine; or assert `restOf(socialNpc)===1.0` on turn 1 before any night occurred.

### ENG-2 · `[LATENT]` · PROPOSED · `diffuseGossip` internal defaults diverge 3.2× from the named `GOSSIP` tunables
- **Evidence:** `src/engine/gossip.ts:125-126` `transmitProb = deps.transmitProb ?? 0.8` vs `GOSSIP.transmitProb = 0.25` (`:43-48`). Both live callers pass the constant (`orchestrator.ts:578`, `registry.ts:222`) ⇒ dormant.
- **Mechanism:** the fallback contradicts the module's declared spread rate by 3.2×; a future caller/test relying on the default silently gets a wildly over-diffusing rumor layer. Maintenance trap of exactly the "a contradictory constant is a lie" class the codebase audited out elsewhere (E52/E53). Fix: `?? GOSSIP.transmitProb`. **Confidence:** high (literal mismatch).

### ENG-3 · `[NIT]` · PROPOSED · Dead `% pool.length` in `nextHouseEvent`
- **Evidence:** `src/engine/houseEvents.ts:71` `pool[Math.floor(rng.next()*pool.length) % pool.length]` — `rng.next()∈[0,1)` so the modulo is unreachable. Cosmetic dead-branch; the substring-coupled prev-line dedup is fine at current 12-line content.

**Lane-1 CLEARED (not roasted, explicitly checked):** all hard rules correct (outgoing-HOH bar incl. double-eviction 2nd cycle; veto-winner-not-replacement in every path; HOH tie-break; jury-of-9; last-evicted-juror tiebreak; veto field of 6 + Houseguest's-Choice; intent locked pre-result); staged-comp byte-identity holds (`stagedTrajectoryNeutral.test.ts`); zero determinism leaks in `src/domain`+`src/engine`; no decorative constants; anti-sycophancy otherwise intact (`EARNED_WINS≥2` guard); non-degradation intact (6-signal round-trip); Vault holds (overhear surfaces a 60% prefix only). **Lane-1 smell:** the sleep economy is the one place a static stat is laundered into a pseudo-behavioral consequence, asymmetrically + uncalibrated + on-by-default.

---

## Lane 3 — FE Python (agent loop / routes / services)

### FEPY-1 · `[POLISH]` · PROPOSED · Casting / new-chat **mid-stream** upstream error renders inside the "Big Brother" GM bubble (F-S4-C OPEN sibling, Python contributor)
- **Evidence:** `frontend/src/agent_loop.py:3464-3467` converts a mid-stream `data:{"error":…}` into a reply-channel `delta` (`*[Stream error: …]*`, no `thinking` flag) ⇒ renders as body text; a no-game send force-escalates to agent mode (`chat_routes.py:600-601`) so a casting 502/503/504 hits this path.
- **Mechanism:** the in-game F-S4-C fix reclassified only the *pre-stream* `!res.ok` holder to `.msg-system`; the *mid-stream* error stays a body delta in the `msg-ai` bubble with the "Big Brother" label ⇒ a gateway outage reads as in-fiction producer narration (immersion break). **Why it matters:** two fresh tabs or any casting turn during an OpenRouter blip. **Fix:** emit a typed `error` SSE here (Python) and/or reclassify the inline delta (JS). **Confidence:** high.

### FEPY-2 / NARR-2 · `[LATENT]` · CONFIRMED-by-two-lanes · A DeepSeek answer routed entirely into the **reasoning** channel → blank public GM bubble; body never recovered
- **Evidence:** `frontend/src/agent_loop.py:2588-2609` (`_empty_response_fallback` returns `(round_reasoning, None)`) + caller `:4653-4657` (`if _fallback_chunk:` false ⇒ nothing yielded to body). JS side `chat.js:2910,2947-2953` (empty-body fallback only recovers inline `<think>` tags, not channel-routed reasoning).
- **Mechanism:** reasoning deltas are tagged `thinking:true` ⇒ accordion only. When V4 misroutes the *answer* into `reasoning_content` (empty `content`), the fallback recovers it for persistence/return but **not** the visible bubble, AND bypasses the empty-response error ⇒ blank GM bubble + populated Thinking accordion. Asymmetric with the JSON/tool extractors which DO read `reasoning`. **Tier:** Flash's heavier reasoning makes the misroute likelier ⇒ a Pro↔Flash drift surface. **Confidence:** high mechanism, model-stochastic trigger. **Falsifier:** a server site re-emitting reasoning as a non-thinking body delta on empty content — none.

### FEPY-3 · `[LATENT]` · PROPOSED · Per-class `max_tokens` is **not** runtime-editable (ADR 0010 follow-on claimed-but-unwired)
- **Evidence:** `frontend/src/token_policy.py:74` ("no settings override yet"), `:90-91` (`max_tokens = _DEFAULT_MAX_TOKENS[class]` unconditional; only `effort` reads the admin override). Narration cap = **4096** (`:41`). No `appliedMaxTokens`/`finishReason` envelope field.
- **Mechanism:** only reasoning *effort* is admin-tunable; the output *cap* is hardcoded, so a deployment hitting narration truncation can't raise it without code, and nothing tells the admin which cap bit. **Confidence:** high.

### FEPY-4 · `[LATENT]` · PROPOSED (ties A-S3) · A peer-induced stale-409 **silently drops a scene's only consequence fold** (non-degradation mandate #4)
- **Evidence:** `frontend/src/agent_loop.py:1711-1736` (`_backfill_with_cas` reconciles then `return None` ⇒ skipped); the 0055 guarantee routes through it (`_auto_record_scene` `:2070-2073`), same for `makeDeal` (`:2234`), `moveTo` (`:1824`). The compensating `_DESYNC_REGROUND` re-grounds but does NOT re-issue the dropped `recordInteraction`.
- **Mechanism:** two-tab play, a peer's serialized advance bumps `beatSeq` between framing and the belt's mid-turn write ⇒ 409 ⇒ the fold (the only record of a social beat) is dropped; the "re-derives next turn" comment is aspirational (player has moved on). **This is the live trigger BND-1 makes single-tab reproducible** (the engine's own enrichment task can be the "peer"). **Confidence:** med-high it drops, high that nothing re-banks. **Falsifier:** a deferred-retry queue re-issuing the skipped record — absent.

### FEPY-5 · `[NIT/LATENT]` · PROPOSED · `orwell_cast_authoring` write-back silently no-ops on a falsy `accepted` (no log)
- **Evidence:** `frontend/src/orwell_cast_authoring.py:232-237` logs on *exception* but drops a `{accepted:False}`/non-dict return at `:237` with no log line (unlike `orwell_prewarm`/`orwell_zeitgeist` which log refusals). **Mechanism:** the four-place-gotcha's observability blind spot — a genuinely rejected `recordCastProfile` is invisible. **Confidence:** high.

**Lane-3 CLEARED:** A-S5 structured-409 is fully built (`orwell_engine.py:204-214`, consumed code-first `chat_helpers.py:695,714`); ADR 0011 beat-aware suppression resets the right counters (`agent_loop.py:3827-3829`); cold-start two-session window is closed **server-side** (residual is the JS lane); 0071 log redaction installed + effective. **Lane-3 smell:** the FE "error-corrects the model" lattice (~12 nudge/belt/CAS mechanisms) was retrofitted from a sole-writer assumption to a concurrent-writer reality one patch at a time, with **no single per-turn reconciliation owner** — FEPY-2 (model misroute) and FEPY-4 (peer mutate) are the same root: a fold/answer falls through a gap no component owns.

---

## Lane 4 — FE JS client (`frontend/static/js/`)

### FEJS-1 · `[LATENT]` · CONFIRMED (lead-verified) · Per-user client-storage keys collapse to one shared namespace — `data-user` is never set
- **Evidence:** grep of `app.py`/`index.html`/`routes` for `data-user` ⇒ **nothing** (only `data-game-build` is injected, `app.py:886`). 12 readers collapse to `…:""`: `orwellOnboarding.js:217`, `orwellWindow.js:251/268/582`, `orwellGadgetRail.js:219`, `orwellComposerDraft.js:33`, `orwellStatusPanel.js:63`, `orwellCastPin.js:31`, `orwellPremiereTutorial.js:27`, `orwellChatHint.js:44`, `orwellSlots.js:68`, `settings.js:1760`.
- **Mechanism:** `body.dataset.user` is `undefined` ⇒ two accounts on the same browser profile (logout→login) share one keyspace: user B skips welcome (A saw it), may see A's composer draft, inherits A's window geometry/gadget order/cast-pin. Engine cross-user isolation is independently clean (AUDIT-LOG §2.12) — this is purely client-storage namespacing. **Confidence:** high attr-unset, med severity (depends on shared-device multi-account being supported). **Fix:** inject `data-user` like `data-game-build`.

### FEJS-3 · `[POLISH]` · PROPOSED · `orwell:gamechanged` allowlist omits 8 mutating beats (latency, not staleness)
- **Evidence:** `chat.js:2418-2419` allowlists 7 tools; omits `moveTo`/`moveHouseguest`/`makeDeal`/`markHouseguestMet`/`turnIn`/`surfaceInformationTo`/`diaryRoom`/`recordImageBeat` (all real beats). **Differential downgrade:** the turn-end catch-all `orwellGameChanged('turn-settled')` (`chat.js:3326`, above the `_isBg` gate) fires on every terminal path ⇒ the 8 tools refresh ~250ms after settle, not mid-stream. So a sub-second parity asymmetry on long multi-tool turns, not persistent staleness. **Cross-ref SYNC-STALE** (below) for the meatier Python-side gap.

### FEJS-4 · `[LATENT]` (ADR 0011 deferred) · PROPOSED · Per-round AI bubbles `display:none`'d, never unmounted, for the life of a turn → O(rounds) hidden DOM
- **Evidence:** each `agent_step` creates a fresh `.msg-continuation` bubble (`chat.js:2736-2752`); prior round hidden not removed (`:2722,2228,2953,2992`); no per-round `.remove()`. A 20-round spin leaves ~19 hidden bubbles. **Confidence:** high.

### FEJS-5 · `[LATENT]` (ADR 0011 deferred) · PROPOSED · Per-round reasoning accordions accumulate inside the hidden bubbles; only <20-char noise pruned
- **Evidence:** live accordion built per round (`chat.js:1601-1648`); only prune is `<20`-char noise (`:1723`). N rounds → N retained accordions in hidden DOM. Compounds FEJS-4.

### FEJS-2 · `[NIT]` · CONFIRMED · `window.settingsModule` fallback in onboarding is dead — the global is never assigned
- **Evidence:** `orwellOnboarding.js:298` reads `window.settingsModule`; `settings.js:5490-5493` exports a **module** default, no `window.settingsModule =` anywhere. Degrades correctly (clicks `#user-bar-settings` first) so dead code, not a break. (Confirms A-settingsModule latent.)

### FEJS-6 · `[NIT]` · PROPOSED · Dead stall-banner machinery orphaned behind the deliberately-disabled watchdog
- **Evidence:** `_startStallWatchdog` (`chat.js:3597-3603`) is an intentional no-op; its `#stall-banner` builder (`:3564-3596`) + state (`:37-41`) are unreachable. Confirmed nothing re-arms it. Cleanup only.

**Lane-4 CLEARED:** reasoning-channel split is sound (no regex-extract-reply-from-merged; the merged-buffer renders all route through `markdown.js processWithThinking` which scrubs reasoning/`npc:`/asides); g15 single-dispatcher holds (no ad-hoc `new CustomEvent('orwell:gamechanged')`); live↔reload render paths **currently converge** (same `processWithThinking`, role-mask, `msg-continuation`, beat cap). **Lane-4 smell (A-render confirmed real, benign, fragile):** two duplicated render engines (`chat.js` live + `chatRenderer.js` reload) hand-mirror every body-shaping rule with paired "matches the live path" comments and **no shared seam** — the reasoning-scrub convergence (where a drift becomes a *leak*) survives only because both happen to funnel through `processWithThinking`. Fix: a shared `renderAssistantBody()` helper.

---

## Lane 5 — Tests / CI / unwired specs

### TEST-2 · `[LATENT]` · PROPOSED · `recordImageBeat` is the one FE-driven write-back without the mandated `McpServer.callTool` **boundary** test
- **Evidence:** its functional assertion (`tests/unit/portraitPrompts.test.ts:216`) calls the adapter directly; `grep "callTool('recordImageBeat'"` ⇒ empty. The dispatch case is live today (`McpServer.ts:129,301`) and the `liveSentinel` sweep would catch a *fully dead* case — but **not** the historically-real silent-no-op-at-the-boundary (the exact way `recordCastProfile`/`recordWorldSnapshot` shipped dead). **Why it matters:** a silent boundary no-op means shown 0051 images leave no memory event, undetected.

### OPS-CI-1 (= TEST-1 = EXPOSE-3) · `[POLISH]` · CONFIRMED-by-two-lanes · `deploy/expose/host-hardening.sh` is parse-checked + security-linted by **nothing**
- **Evidence:** CI `.github/workflows/ci.yml:322` `for s in deploy/*.sh` (non-recursive); `tests/unit/opsPrivateRepo.test.ts:22` reads `deploy` non-recursively; `find deploy -name '*.sh' -mindepth 2` ⇒ exactly this one file. **Mechanism:** both the `bash -n` syntax gate AND the E84 `curl|bash`/`raw.githubusercontent` security lints skip the one script in `deploy/expose/` — the public-internet hardening script. A syntax error or an introduced remote-pipe ships green. **Fix:** `find deploy -name '*.sh'` / `git ls-files 'deploy/**/*.sh'`. **Confidence:** certain.

### TEST-3 · `[NIT]` · PROPOSED · 14 `docs/features/*.feature` files are un-executable orphans (gated elsewhere, but never run as Gherkin)
- **Evidence:** `.feature` for 0010/0022/0029/0032/0033/0036/0051/0053/0064/0066/0067/0068/0069/0074 exist (e.g. 0064=19 scenarios) but are absent from `cucumber.cjs` paths; zero step defs for 0064/0066/0067/0068/0069/0074. **Differential:** no *coverage* hole (each is gated by FE/unit tests, verified) — but the `.feature` files read as executable contracts that never execute; **0036** even has a `.feature` while its README gate is `unit`. **Fix:** a `spec-only` marker or shelf + a meta-test.

### TEST-4 · `[NIT/disclosed]` · PROPOSED · 16/20 `tests/property/*` are seeded fixed-loop, not fast-check (already disclosed, audit T18)
- **Evidence:** only 4 import fast-check. Down-rated: for distribution claims a fixed seeded set is the right tool; naming smell, not a fitness gap. `replayability`/`outcomes` would benefit from generative coverage but aren't currently making claims their fixed seeds falsify.

**Lane-5 CLEARED:** no `.only`/`.todo`/`xit`/`fdescribe` committed; exactly 1 non-env skip (env-gated `fastembedReal`); anti-sycophancy `juryReach`/gradient gates have real per-win `EARNED_WINS` teeth + completeness checks; sharded heavy lanes can't vacuously pass; CI path-filter has no engine-skip hole; no names-in-tests violation; Vault-Wall depcruise is default-deny + tripwire. **Lane-5 smell:** the gate layer leans on **one generic Vault-leak sweep (`liveSentinel`) as a stand-in for per-tool boundary-functional tests** — it proves *no leak* for every tool but *nothing about whether each tool did its job*; that asymmetry is exactly how write-backs silently no-op'd. A single "every write-back, dispatched through `callTool`, produces its expected mutation" meta-test closes it.

---

## Lane 6 — Deploy / ops / docs drift

### EXPOSE-1 · `[LATENT]` · PROPOSED · Public-profile boot guard omits the bind-host check
- **Evidence:** `frontend/core/middleware.py:199-216` unsafe-set = `{AUTH_ENABLED=false, LOCALHOST_BYPASS=true, SECURE_COOKIES!=true, ALLOWED_HOSTS unset/"*"}`; no `ORWELL_BIND_HOST` check though the status route computes `bindHost` (`admin_public_deployment_routes.py:149`). **Mechanism:** an operator setting `ORWELL_PUBLIC=1` (all pass) + `ORWELL_BIND_HOST=0.0.0.0` (a one-line edit the unit comment invites) boots green on all interfaces, bypassing the cloudflared/Caddy perimeter. LATENT (auth still on ⇒ exposed-but-authenticated). **Falsifier:** `assert_public_profile_safe({ORWELL_PUBLIC:1,…safe…,ORWELL_BIND_HOST:0.0.0.0})` raises.

### EXPOSE-2 · `[LATENT]` · PROPOSED · Cloudflare connector token passed on the `cloudflared` argv
- **Evidence:** `deploy/orwell-ops-public-deployment.sh:206` `cloudflared service install "$(cat "$TOKEN_FILE")"` — token on argv (readable in `/proc/<pid>/cmdline`); the DNS-token sibling (`orwell-ops-tls.sh:116`) deliberately uses an **env var** "so it never shows in ps". The inconsistency is the tell. File lifecycle is otherwise exemplary (0600, shredded). **Fix:** env-var the token.

### EXPOSE-4 · `[POLISH]` · PROPOSED · `host-hardening.sh` ufw reset→allow→enable is a non-atomic remote-lockout window
- **Evidence:** `deploy/expose/host-hardening.sh:25` `ufw --force reset` → `:30/:32` SSH allow → `:42` enable, under `set -Eeuo pipefail`. A failure between reset (defaults deny-incoming) and the SSH allow aborts with no SSH rule ⇒ remote lockout; every re-run `reset`s, discarding coexisting rules. **Fix:** allow-SSH-first / set rules without `reset`.

### EXPOSE-5 · `[NIT]` · PROPOSED · `orwell-https.sh` interactive gate keys on never-assigned `MODE_GIVEN`
- **Evidence:** `deploy/orwell-https.sh:166` `-z "${MODE_GIVEN:-}"`; `grep 'MODE_GIVEN='` ⇒ none (the real flag is `MODE`). The TUI-suppress guard is dead; harmless in the always-`--yes` ops path. (shellcheck SC2154.)

### DOC-1..8 · `[DOC]` · CONFIRMED (R-DOC-1 is the headline; these extend it) · Systematic one-directional "ceiling freeze" across every orientation doc
- **DOC-1** `CLAUDE.md` never mentions 0070–0074 ("feature-complete through 0069"; `grep '007[0-4]'`⇒0). **DOC-2** `README.md:25-27,522-524` calls 0070–0073 "authored and queued, not yet built" — all shipped (PRs #504–#511). **DOC-3** `README.md:557` "ADRs 0001–0013" but ADR 0014 exists + built (`decisions/README.md:21`); CLAUDE.md correctly says 0014 ⇒ the two top docs disagree. **DOC-4** `CLAUDE.md:443` local-run uses FE port **7000** — appears in no other source (prod default 8080: `INSTALL.md:47,141`, `orwell-frontend.service:42`); the brief's "FE 7000" premise inherits this. **DOC-5** `CLAUDE.md:452` omits 6 existing deploy scripts (the whole TLS + public-exposure control surface). **DOC-6** `IMPLEMENTATION_QUEUE.md:7-15` "queue drained / every batch ✅ DONE" stops ~9 features short (newest is 0065). **DOC-7** `docs/CLAUDE_CODE_INSTRUCTIONS.md:45` (the "start here" brief) says "through **0050**" — 24 features stale. **DOC-8** `docs/features/README.md:56` audit-scope says "Every feature **0001–0063** cross-checked" while its own index runs to 0074 — the drift-proof anchor has an internally inconsistent scope line.

**Lane-6 CLEARED:** deploy lane is unusually mature — consistent `set -Eeuo pipefail`, `sanity_path` depth-guards before every `rm -rf`, idempotent env upserts, fail-closed boot guard, secret shredding, correct `pct` host-bridge + `bbai` fallback, A4 local-copy rule. **All three reset-tier contracts honor their claims** (game-reset preserves accounts/LLM config; factory-reset `exec`s oobe-reset; oobe keeps keys+models). systemd hardening (E85) solid. Cast/jury/F2/veto counts + engine port 8765 consistent everywhere. **Lane-6 smell:** the prose froze at staggered ceilings while the *scripts* were extended in lockstep — so the risk is a contributor/operator not knowing the public-exposure + local-HTTPS subsystem (where EXPOSE-1/2 live) even exists.

---

## Lane 7 — Narration fidelity & prompts (DeepSeek V4 Pro/Flash)

### NARR-3 · `[LATENT·near-block on -flash]` · PROPOSED · "EXACT names, never invent" is **prompt-only** — zero structural roster-validation backstop
- **Evidence:** the rule lives entirely in `src/engine/momentPrompts.ts:245-251` + reinforcements (`:518-523,846-849`) + woven roster (`:723-747`); no FE/engine surface validates a narrated name against `state.house[].name`. The only pre-emission guards are the closed-set outcome guard (`chat_helpers.py:954-994`) and the evicted-in-a-room guard (`:1044-1065`) — neither checks name existence.
- **Mechanism:** houseguest **invention** (the most immersion-shattering grounding break, by the prompt's own "THE most important rule") is caught by **nothing** structural — enforcement = model compliance. S3-CORE's "0 inventions" was on `-pro`; the moment runtime config points at Flash (the tier the AUDIT-LOG itself says "invents cast"), an invented name reaches the player unchecked, while strictly-less-critical outcomes/placements DO have guards. The asymmetry is the launch risk. **Falsifier:** wire Flash, diff every Capitalized two-token name in the DOM against `/api/orwell/state`.

### NARR-1 · `[LATENT]` · PROPOSED · Gateway (0072) reasoning scrub is inline-`<think>`-only AND its narrator import is **dead**
- **Evidence:** `frontend/gateway/handler.py:180-181` `from src.agent_loop import _resolve_llm_fn` — but `_resolve_llm_fn` is defined in `orwell_cast_authoring.py:255` (takes `owner`), **not** in `agent_loop` (AST-confirmed) ⇒ `ImportError` caught ⇒ the gateway **always** returns the "not configured" placeholder (never narrates). `scrub.py:20` strips only inline `<think>` tags, not DeepSeek's separate `reasoning` channel or natural-language operator asides. Non-launch-critical surface but a real reasoning-leak/blank transport — the uncovered transport the browser channel-split never covered.

### NARR-4 · `[POLISH]` · PROPOSED · No tier-aware handling anywhere — identical prompt + absent `max_tokens` for Pro and Flash
- **Evidence:** only `flash` refs in `src/`/`routes/`/`js/` are loop-breaker *comments*; no code branches on the resolved model id for prompt length / output cap / verbosity. **Mechanism:** Flash bills reasoning against a 65,536 cap (vs Pro 384,000) and is verbose ⇒ mid-sentence truncation materially likelier, but the F-S4-D `Continue ▸` affordance is tier-blind, and nothing clamps verbosity or sizes UI per tier.

### NARR-5 · `[LATENT]` · PROPOSED · Dormant `token_policy.narration max_tokens: 4096` — resolved every turn, never applied; a pre-armed reasoning-truncation trap
- **Evidence:** `frontend/src/token_policy.py:41` (4096) resolved at `agent_loop.py:3071` but `_apply_reasoning_budget` (`llm_core.py:585-622`) consumes only `policy["reasoning"]`; no consumer of `policy["max_tokens"]`. Today dead (matches "no explicit max_tokens"). The moment the ADR-0010 follow-on wires it (the documented next step), narration hard-caps at 4096 — the exact reasoning-truncation the Anthropic fallback was raised 4096→8192 to avoid. **Gate:** any PR wiring `policy["max_tokens"]` must raise narration off 4096 first. (Ties FEPY-3.)

### NARR-6 · `[LATENT]` · PROPOSED · F-S4-F resume-path roster-reconstruction gate still ABSENT
- **Evidence:** resume replays a **buffered run** (`chat_routes.py:1362-1364`, `session_events.py:35-42`) — it does not re-frame; a one-time mid-gen name drift in the buffer replays verbatim, never reconciled. S3b recommended a gate asserting the resumable-stream path reconstructs the full seeded roster; it doesn't exist. Narrow (new turns re-ground fully) but a refactor could widen it.

**Lane-7 CLEARED:** engine prompt assembly is clean — `renderGameContext`/`buildSystemPrompt`/`portraitPrompts`/`imageConstants` read only Vault-free fields (no stats/souls/hiddenElements/privateStrategy/aptitudes enter a prompt); the FE weaves no game facts of its own; B61 cast-voice walling holds; prompts hand the model **facts to voice, not scripts to recite** (ADR 0003 smell absent). **Lane-7 risk:** NARR-3 — the one grounding rule the prompt calls most important has the weakest (wording-only) enforcement, and it fails exactly on the tier the audit says invents cast.

---

## Lane 8 — Social game: emergent-drama structure & legibility

### SOC-1 · `[LATENT·near-block for genre fidelity]` · CONFIRMED (lead-verified: zero bloc surface in player-facing layers or `renderGameContext`) · Emergent bloc/coalition structure is computed + decision-load-bearing but **never surfaced as structure** to narrator or player
- **Evidence:** `src/engine/blocs.ts:78-159` builds clique-like multi-party blocs (`sharedTarget`/`cohesion`/`loyaltyStrength`), consumed in noms+votes (`season.ts:106-109`, `liveSeason.ts:739,752,1376`). **No player projection references blocs** (lead-verified grep of `src/services`/`src/surfaces`/`frontend/static/js` ⇒ 0). The narrator's standing context `renderGameContext` (`momentPrompts.ts:673-875`) carries week/phase/ceremony/whereabouts/showmances/per-HG vibe but **no bloc structure**; `npcVoice` returns only **pairwise** flat labels (`relationships.ts:45-57`); `socialRead` returns counts + a binary unease hint.
- **Mechanism:** the only social-structure data crossing to the narrator is N independent pairwise edge-labels — there is no path that hands it the **bloc as an object**. So the narrator can voice "Maya is wary of you" but never "Maya, Dana, Griffin have hardened into a three targeting you," because it is never told. The player must reconstruct a coalition from N separate vibes, and the bloc that decides their eviction is an unattributable black box. The panopticon-engine sees every alliance; the watcher it surveils sees only fragments — and the coalition only becomes legible in the post-season retrospective.
- **Differential:** not Vault secrecy (blocs derive from the **public** bond read; 0002 forbids *storing* an alliance object, not *surfacing a derived read*); not covered by pairwise `npcVoice`; distinct from "player forms own reads" (that forbids a threat *meter*, not perceiving an alliance *exists* — the genre's central readable object). **Confidence:** high (absence exhaustively grep-confirmed both by the specialist and the lead). **How the rig VIEWs it:** a `-pro` season passes every grounding check yet feels socially flat — the player is blindsided by coordinated votes with no narrative means to read them coming.

### SOC-3 · `[POLISH]` · PROPOSED · Deal-break drama reaches the player as one log line + a silent sidebar recolor — thin ceremony weight on the marquee social beat
- **Evidence:** a broken player-party deal surfaces as a single witnessed event (`GameSessionAdapter.ts:3452-3454`) + the deals panel recoloring a row (`orwellDeals.js:91,135-165`) on the next poll; the status panel doesn't announce breaks (`announceDeltas` covers only phase/HOH/noms/veto). **Mechanism:** the consequence loop is intact (betrayal-shock + jury demerit + reveal), but presentation has no decision-card-style reveal/announcement — betrayal degrades to a passive state change unless the narrator dramatizes it well, and the under-call family makes that unreliable (worse on Flash). **Ties A-S3/FEPY-4** (a dropped fold erases the beat entirely).

### SOC-4 · `[LATENT]` · PROPOSED · Gossip can move the house against the player, but the standing player-read is content-free and the rumor→player content path is narrator-call-dependent — dramatic-irony asymmetry runs one direction
- **Evidence:** `gossip.ts:108-180` diffuses NPC→NPC and reaches the player only if a chain terminates at them (`:99-100`) AND the narrator calls `surfaceInformationTo`; the only *standing* read `socialRead` (`PlayerSurface.ts:88-91`) is a count + binary unease, never content/provenance. No engine auto-surface of a terminated rumor (unlike the deal-break `onPlayerEvent`). **Mechanism:** given the model under-call tendency, the rumor mill churns (moving NPC votes) while the player gets only generic unease — the irony payload (catch a fragment, suspect, act) rarely fires.

### SOC-2 · `[POLISH]` · PROPOSED · Standing *alignment* legibility absent (vote-count correctly constrained by secret ballot)
- **Evidence:** `orwellStatusPanel.js:295-368` renders titles (Week/Phase/HOH/Noms/Veto/own-badge) — glanceable + engine-accurate — but no who-aligns-with-whom read; `VisibleStateService` has no tally field. **Differential:** a persistent vote tally would break secret-ballot anonymization (correctly avoided); the real gap is SOC-1's alignment read, not the count. POLISH.

**Lane-8 steelman (CLEARED):** coalition/betrayal is **mechanically meaningful, not cosmetic** — `voteChoice` (`liveSeason.ts:731-744`) blends threat×paranoia + `blocTerm` − dealHonor − juryMgmt − bondKeep, all bounded; blocs vote together because every member derives the same bloc; deals fold real consequence (betrayal-shock + jury demerit + reveal); gossip moves third-party minds; the Diary Room wall is structural (`diaryRoom.ts:22-33`); jury management is the dominant finale term. **Lane-8 smell:** Orwell computes genuinely emergent coalition structure and renders **none of it as structure** — the surveillance apparatus never shows the watcher what it sees, which is the one thing the genre exists to do (SOC-1).

---

## Cross-cutting (de-duped across lanes)

### SYNC-STALE · `[LATENT]` · PROPOSED · FE-driven background write-backs mutate engine state but fire **no** `_publish_game_updated` SSE and **no** JS dispatch
- **Evidence (Lane-3/4 convergence):** `preSeedCast`/`recordCastProfile`/`recordWorldSnapshot`/`recordOffscreenSceneTexture`/`preSeedNextSeason` run as background tasks (`frontend/src/orwell_*.py`); `_publish_game_updated` has only 3 callers (`routes/orwell_routes.py`). **Mechanism:** an open page stays stale until the next 20–30s poll after a background enrichment lands — a real eventual-consistency lag (distinct from R-BND-1's beatSeq-bump, same family). **Cross-ref R-BND-1, FEJS-3.**

---

## Live-LLM lane (in progress)
A dedicated background agent is standing up the real stack + wiring the OpenRouter key per `docs/audits/playtest-harness/README.md`, playing an authentic `-pro` persona season (engine = oracle) then probing `-flash` for tier failures. Findings (LIVE-*) land here on return.

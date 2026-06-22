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

## Wave 2 — Responsive / cross-platform (static)

### RESP-1 · `[POLISH]` · PROPOSED · Minimized-window dock row's only close is a 16px hover-faded `×`; E95 removed the drag-close touch equivalent
- **Evidence:** `style.css:1137-1143` (`.minimized-dock-x` 16×16, opacity 0.4, `:hover`→1); `modalManager.js:376-380,392-398` (E95 sidebar row: body-click *restores*, "no drag", so the `×` is the sole close); stale CSS comment `style.css:962-964` still advertises the removed drag-to-trash model.
- **Mechanism:** any minimized kit window (status/cast/retro/presence/finale) docks as a "Windows" sidebar row = the mobile drawer representation; its only close is a 16px glyph failing WCAG 2.5.5 (44) and even 2.5.8 (24), at opacity 0.4 permanently on touch (no hover). **Differential:** not a pointer-affordance-with-touch-equivalent — E95 deleted the drag-close, so the tiny `×` is the literal close on all platforms; not hidden on mobile (grep empty). **Confidence:** high static; falsifier: if the kit forbids minimize ≤768px (then unreachable→LATENT). **Fix:** add `.minimized-dock-x` to the J5-01 `@media (hover:none) and (pointer:coarse)` floor (`style.css:36671`).

### RESP-2 · `[POLISH]` · PROPOSED · Cast-panel `.oc-pin` (28px) + `.oc-backfill` (32px) below the 44px touch floor, excluded from the J5-01 fix
- **Evidence:** `orwellCast.js:156,164,170-172` (min-height 28/32, mobile block only sets `width:auto`); J5-01 floor `style.css:36671-36682` targets chrome selectors only, not panel-body buttons. **Mechanism:** "Generate cast portraits" (`.oc-backfill`) is a universal action rendered on mobile at 32px — undersized tap. **Differential:** not reflow (fixed sub-floor heights); not hidden on mobile; not covered by J5-01 (selector inspection). **Fix:** add the cast-panel body buttons to the J5-01 coarse-pointer floor.

### RESP-3 · `[NIT]` · PROPOSED · Per-message `.copy-btn` is hover-only with no touch fallback (the code-block buttons have one)
- **Evidence:** `style.css:3554-3561` (`.copy-btn` opacity 0, revealed only via `.msg:hover`); contrast `style.css:4184-4188` (code-block buttons DO get `@media (hover:none){…opacity:0.7}`). **Mechanism:** on touch the copy control stays invisible (still hit-testable but undiscoverable). NIT (bubble text stays selectable; nothing lost). **Fix:** mirror the code-block `@media (hover:none)` reveal for `.copy-btn`.

### RESP-4 · `[LATENT]` · PROPOSED · The responsive-matrix gate can't see RESP-1/2 — 36px floor (project floor is 44px), narrow selectors, kit windows unmounted
- **Evidence:** `responsive_matrix.py:312-325` (selectors `button,[role=button],select,.settings-nav-item`; floor `w<36||h<36`); `GAME_SURFACES` `:237-238` doesn't mount panel toolbars; XFAIL empty `:73-76`. **Mechanism:** a 36–43px control passes the gate while violating the project's own 44px CSS floor, and panel-body controls aren't in the scanned DOM ⇒ a whole class of below-44px controls ships CI-green. **This is the guardrail-scope-drift root behind RESP-1/2/3.** **Fix:** align the gate floor to 44px, widen selectors (`a[href]`, interactive `[tabindex]`), mount the kit panels during the coarse-pointer sweep.

**Lane-RESP CLEARED:** the responsive contract is mature — `dvh` w/ `vh` fallbacks across overlays, `env(safe-area-inset-*)` on fixed bottom chrome, a `--composer-clearance` token kept live by Resize/Mutation observers (keyboard-robust), the State-6/J5-01 44px coarse floor genuinely covering titlebars + gadget-rail. The brief's big-ticket warnings (fixed-vh, sheet flush-width, cursor:move-on-touch, sheet/hamburger overlap) are really fixed. **Lane-RESP smell:** the touch floor is enforced + audited at exactly ONE altitude — chrome — while panel bodies and dock rows live just outside both the J5-01 selector list and the gate's DOM, so the guardrail's *scope* drifted behind the surfaces it protects (RESP-4).

---

## Wave 2 — Transient / animation lifecycle (static)

### TRANS-1 · `[POLISH·top FE-correctness candidate]` (agent proposed [BLOCK]) · CONFIRMED (lead-verified structure) · Mid-stream engine-tool error orphans a 50ms `_elapsedTicker` (+100ms wave) on the stuck "running" tool node — fires forever, 20fps DOM mutation
- **Lens:** transient correctness + distributed-consistency (trigger is a 409 stale-beat).
- **Evidence (lead-verified):** intervals armed `chat.js:2305,2314`; cleared at only 4 sites — Stop sweep `:369-371`, new-tool-mounts-clears-old `:2295-2296`, `tool_output` `:2361-2367`, and the **catch-`else`** sweep `:3284-3288`. The `finally` (`:3307-3319`) clears response-timeout/finalizing/aria-busy but has **no `.agent-thread-node.running` sweep**. The error path sets `_streamHadError=true` (`:1483`) and ends via the normal `[DONE]`/break → `finally`, **not** the throwing `catch`. Server: `agent_runs.py:117,129-137` catches a tool exception → emits `event: error` + `data:[DONE]` (graceful close, no client throw); `orwell_engine.py:215,223` raises on 409/5xx/timeout; `tool_output` (`agent_loop.py:4481`) never sent for the failed tool. **The dev comment at `chat.js:3278-3283` admits the leak** ("without this sweep they fire forever on the orphaned node, and auto-recover compounds it") — but parked the sweep in the catch, which the graceful-error close skips.
- **Mechanism:** `tool_start` mounts `.agent-thread-node.running` + arms two intervals; the engine tool raises (canonical: ADR-0065 stale-beat 409 under two-window play); the pump converts to `event: error`+`[DONE]`; the client renders the error and `break`s → `finally` (no sweep); `tool_output` never arrived → node stays `running` with `_elapsedTicker` rewriting its elapsed text 20×/s for the life of the page. Compounds under the ADR-0011 auto-recover cascade.
- **Differential:** not FEJS-6 (different machinery); not the clean-`[DONE]` case alone (rarer); ruled "the finally cleans it" by reading `:3307-3479` (sweeps spinners + `_streamSessionId`, not running-node intervals); ruled "engine tools never raise" by `orwell_engine.py:215/223`. **Severity calibration (lead):** POLISH not BLOCK — leaks a timer + shows a stuck "running" node (the brief's "orphaned node with live timer" / "stuck spinner" class), reachable in normal concurrent play, but does not break game progression. **#1 FE-correctness fix candidate** (one line: add the `:3284` sweep to the `finally`).
- **Confidence:** high (structure lead-verified + dev comment). **Falsifier:** a burst capture under a forced 409 shows the running node's intervals stop at the error frame ⇒ a sweep I missed exists. **Harness-confirmable?:** yes — force a 409 from window B mid-stream in window A; MutationObserver logs `.agent-thread-elapsed` text mutating every ~50ms with no unmount after the error bubble settles.

### TRANS-2 · `[POLISH]` · PROPOSED · The agent-thread running pulse (most-seen game animation) + the gadget-rail pulse family have no `prefers-reduced-motion` guard (WCAG 2.2.2)
- **Evidence:** `style.css:9218` `thread-pulse 1.5s infinite` (arms every tool round); `:789,809,831,9046,9028,9089` (`rail-notes-pulse`/`rail-min-pulse`/`rail-notif-pulse`/`stream-complete-pulse`/`bar-pulse`). Brace-balanced parse of all 17 `@media (prefers-reduced-motion:reduce)` blocks confirms **none** carry these selectors (only `#email-unread-dot` is covered). Contrast: the kit DOES gate (`orwellFinalizing.js:54-57`, `orwellDecision.js:83`, `orwellWindow.js:708,765`).
- **Mechanism:** decorative infinite pulses on persistently-mounted game chrome keep animating under reduced-motion (no blanket `*{animation:none}`); >5s infinite also trips WCAG 2.2.2 pause/stop/hide. **Confidence:** high (brace-balanced verified). **Fix:** extend a reduced-motion block to the decorative-loop selectors (ideally a shared `decorative-loop` class so coverage can't drift).

### TRANS-3 · `[POLISH]` · PROPOSED (corroborates SOC-3 from the transient lens) · Power-transition / ceremony reveal lands as a silent side-panel `textContent` swap — no animated weight
- **Evidence:** `orwellStatusPanel.js:300,302,307` (plain `textContent =` for HOH/noms/veto, no change-flash class; only `.os-chev` has a transition); the SR announce `:234-249` writes to a visually-hidden `#os-announce` (`:165` clip-path); chat-side marker is one static chip (`orwellToolBeats.js:101-124`, mounted `chat.js:2451-2454`, no entrance animation). Grepped all 21 `reveal|ceremony|crown` files — no mid-season ceremony stages an animated power-transition beat (finale/retro DO have ordered reveals).
- **Mechanism:** HOH→noms→veto→eviction reconciles as in-place text substitution in a collapsible panel + one quiet chip; no crown drop / gavel / card flip / row flash. **Steelman:** ADR 0003 makes narration carry the drama, HUD is a quiet ledger — valid; but when the narrator under-calls (worse on Flash) the reveal degrades to exactly this silent flip with no fallback weight (ties SOC-3 + A-S3 dropped-fold). **Fix:** a reduced-motion-gated delta highlight on the changed HUD row (the announce already computes the delta at `:242-247`) and/or a lightweight staged chip reveal for the four ceremony beats — without becoming the dashboard ADR 0003 forbids.

### TRANS-4 · `[NIT]` · PROPOSED · Streaming-status spinners (`whirlpool`, `thinking-dots`/`ai-spinner`) uncovered by reduced-motion (judgment call — essential motion?)
- **Evidence:** `style.css:1067,8888,9466` (infinite spins, none in a reduced-motion block); game-build usage `ui.js:327`, `chat.js:1689,5339`. Down-rated: a loading spinner conveys essential in-progress status (WCAG carves out essential motion), so a slowed/stepped variant — not removal — is the remedy. Flag for an explicit product decision alongside TRANS-2.

**Lane-TRANS CLEARED (lifecycle verified clean):** decision card (`orwellDecision.js` — `_doneTimer` self-removal guarded, reduced-motion gated, 15s backstop bounded), ask_user card (dedup on mount, removed on answer), finalizing indicator (begin/end paired + `finally` net), toast (single shared `#toast`, no stacking, reduced-motion covered `style.css:22186`), OrwellWindow open/minimize/dock (reduced-motion gated throughout). **Lane-TRANS smell:** TRANS-1 — the team KNEW about orphaned tool-node tickers and wrote the sweep, but parked it in the one terminal path (a thrown `catch`) that the graceful server-`event:error` close skips, so the leak survives exactly the concurrent 409 the AUDIT-LOG treats as a live scenario. A single missing line, 20 lines from the fix that already exists.

---

## Wave 2 — UX content & accessibility (static)

### UX-1 · `[POLISH·high quick-win]` (agent proposed [BLOCK]) · CONFIRMED (lead-verified) · Raw kebab-slug IDs injected into the player's finale composer prefill
- **Lens:** content / immersion (machinery-ish leak into the player's own voice).
- **Evidence (lead-verified):** `orwellFinale.js:25-30` (`APPEALS` ids `own-game`/`mend`/`connect`/`discredit-rival`); `:210` `addBtn("→ " + a.label, \`I answer the jury by making my "${a.id}" case.\`)` — button shows `a.label`, but `prefill()` writes `a.id` to `box.value` (visible textarea).
- **Mechanism:** at the finale "questions" stage a player-finalist clicking "Question my rival" gets `…making my "discredit-rival" case.` in their composer — a machine identifier in the player's voice at the game's emotional peak. **Differential:** pure content fault (`a.id` where `a.label` belongs); flow is correct. **Severity (lead):** POLISH not BLOCK — gated behind reaching F2 + using the shortcut, editable before send, doesn't block play; but trivial fix + visible fourth-wall break ⇒ high-priority quick win. **Fix:** `a.label` (or a label-derived phrase); if the LLM needs the slug, send it as a scrubbed hidden prefix. **Confidence:** high (string interpolation unambiguous).

### UX-9 · `[POLISH]` · PROPOSED · Decision-card note "Your selection only — never read from prose" is OOC engine-language delivered via `aria-describedby` on every standard binding card
- **Evidence:** `orwellDecision.js:421` (`multi ? "Select N — only a legal move counts." : "Your selection only — never read from prose."`); the note is the card's `aria-describedby` description (first thing a SR user hears). **Mechanism:** "never read from prose"/"legal move" address the engine boundary, not the houseguest — breaks fiction at nominations/eviction-vote, the most consequential moments. The per-kind overrides (`juror-question`: "Your own words…", `goodbye-message`: "Pick a tone — that's what binds.") prove the fix pattern is understood; the default else-branch just never got it. **Fix:** player-facing reword ("Tap your choice — the house only sees this card, not the chat."). **The lane's biggest smell.**

### UX-2 · `[POLISH]` · PROPOSED · Duplicate `aria-label="The Cast"` on two simultaneous collapsed-gadget-strip buttons (WCAG 4.1.2/2.4.6)
- **Evidence:** `orwellGadgetRail.js:43,47` (both `orwell-cast-pin` and `orwell-cast` have `title:"The Cast"`); strip builder `:169` `b.setAttribute("aria-label", g.title)`. Icons differ (👥/🎬) but `aria-label` overrides the icon ⇒ a SR/voice-control user hears two indistinguishable "The Cast" buttons. **Fix:** differentiate the two registry titles.

### UX-10 · `[POLISH]` · PROPOSED · Finale `.ofin-btn` `min-height:36px` defeats the coarse-pointer 44px floor via specificity
- **Evidence:** `orwellFinale.js:93` (`#orwell-finale .ofin-btn{min-height:36px}`, specificity 0,1,1) beats the responsive-tokens `@media (pointer:coarse){button:not(.tap-exempt){min-height:var(--tap-min)}}` (0,0,1) — so the 44px floor never applies on touch. Distinct from the closed J5-13 (which lifted ~27→36 but didn't notice the specificity defeat). **Mechanism:** the finale's four shortcut buttons (the most time-sensitive touch interaction in the game) ship 36px on touch, 8px below the project floor. **Fix:** add `.tap-exempt` + explicit 44px, or `min-height:max(36px,var(--tap-min,44px))`. (Pairs with RESP-2/4 — the touch-floor guardrail keeps getting beaten by panel-level CSS.)

### UX-3 · `[POLISH]` · PROPOSED · Premiere dismiss button Label-in-Name violation (WCAG 2.5.3)
- **Evidence:** `orwellPremiereTutorial.js:110` visible text "Close guide" but `aria-label="Dismiss the premiere guide"` — visible label absent from the accessible name ⇒ voice-control "click Close guide" fails to match. **Fix:** drop the `aria-label` (let "Close guide" be the name; `title` carries the hint) or prefix it with the visible text.

### UX-5 · `[LATENT]` · PROPOSED · Six static `role="dialog"` elements have no `aria-modal` + unconfirmed focus trap
- **Evidence:** `index.html:334,533,1237,1405,1431,1442` (Brain/Theme/Prompt/Rename/Cookbook/Settings) — grep `aria-modal` ⇒ 0 matches; the OrwellWindow kit sets `aria-modal` for *dynamic* windows but these legacy static modals are outside it. **Mechanism:** without `aria-modal="true"` a SR virtual cursor can wander outside an open modal (Settings is player-reachable every session). LATENT (game-trim may hide some; JS focus-trap existence unconfirmed from markup). **Fix:** add `aria-modal="true"` + verify a JS focus trap.

### UX-7 · `[LATENT]` · PROPOSED · Diary Room mode-entry is announced **silently** to screen readers (display toggle, not content mutation)
- **Evidence:** `orwellDiaryRoom.js:72-77` — pill created `display:none` with `role="status"` and content pre-set; `enterDRMode()` toggles `display`. **Mechanism:** `aria-live` fires on content mutation, not a style change ⇒ entering the private OOC channel (a consequential state change — DR vs public house message) gives a SR user no confirmation. **Fix:** mutate the live-region text content on entry (or start empty + inject on first show).

### UX-4 · `[POLISH]` · PROPOSED · Retrospective vault headings/button contain bare emoji without `aria-hidden` (WCAG 1.1.1)
- **Evidence:** `orwellRetrospective.js:150,171,196` (🔓/🗳/🔐 inline in text nodes; the J3-24 fix wrapped tutorial emoji in `aria-hidden` spans but it wasn't extended here). SR announces "closed lock with key, Open the Producer's Vault" on the key post-season CTA. **Fix:** apply the J3-24 `<span aria-hidden="true">` pattern.

### UX-8 · `[NIT]` · PROPOSED · Finale shortcut buttons' emoji/arrow glyphs unguarded in the accessible name
- **Evidence:** `orwellFinale.js:203,208,210,212` (`btn.textContent = label` incl. ✍/→/🗳) ⇒ "rightwards arrow, Own my game" / "ballot box…, Vote for X". **Fix:** `innerHTML` with `aria-hidden` spans around the glyphs.

### UX-6 · `[NIT]` · PROPOSED · Season chip accessible name is a static placeholder
- **Evidence:** `orwellSeasonProgress.js:174` `aria-label="Season number"` set once, never updated to the actual value ⇒ SR hears "Season number" not "Season 2". **Fix:** set `aria-label` to the live label, or drop it and let `textContent` be the name.

**Lane-UX CLEARED:** strong in-fiction copy throughout — Diary Room pill ("private & out-of-character; the house never hears this"), retrospective Vault CTAs, premiere tutorial, self-evict-cancel ("Cancel — stay in the house"), the Vault-safe decline ("The Vault would not open"). Chat `role="log" aria-live="polite"`, presence `role="status"`, decision-card `role="form"` + `role="alert"` error region, finale SR-only announce region — all structurally correct. Reduced-motion gated across the kit + tutorial. **Lane-UX smell (UX-9):** the OOC engine-language decision-card note is the most consistently present fiction-break — on every binding card, first thing a SR user hears — and the per-kind overrides prove the fix is understood but the default branch was skipped.

---

## Live-LLM lane — COMPLETE (real stack, `-pro` 22 turns + `-flash` 3 turns, 4742 engine calls, $0.95, 28 screenshots)

**Method:** real engine + FE per the harness, authentic in-chat casting → full week-1 (casting→eviction→week-2 roll), engine = oracle. Artifacts: `.audit-telemetry/live-play-roast.md` + `.audit-telemetry/shots/{play,playf}/` (gitignored). **What HELD (keep):** casting finalized promptly (S2-1 did not reproduce), distinct/stable NPC voices, **0 cast inventions / 0 hard machinery leaks / 0 `npc:N` in 55 messages**, anti-sycophancy held (lost both comps "competed", real NPCs won HOH), the staged eviction *reveal* drama, Vault posture clean, `-flash` now DOES `advanceGame` (B5/B6 improved). The conversation really is the game, and it's good. **Three of my static findings were empirically confirmed live** (ENG-1→LIVE-2/3/5, SOC-1→LIVE-10, FEPY-4/A-S3→single-tab repro).

### LIVE-4 · `[BLOCK]` · both tiers · VIEWED · Staged-comp advance-cascade silently skips the nomination + veto ceremonies
- **Lens:** narration faithfulness (omission) + core-loop integrity (the four weekly ceremonies are the BB spine).
- **Evidence:** turn-9 FE ledger `beat=35→42 tools=[advanceGame,submitDecision,advanceGame×3]`; turn-13 `beat=49→56` with **6 advanceGame** crossing veto-draw→comp→ceremony; engine recap holds the skipped beats verbatim ("X nominates Y and Z", "X wins the Power of Veto", "X does not use the veto") — **none narrated in real time** (full 23-message scan). **Flash:** skipped the player's OWN nomination, narration ended "who does [HOH] put on the block?" while engine `noms=[…, the player]`.
- **Mechanism (FE narration, NOT engine):** the engine returns a `BeatEvent` per ceremony (`liveSeason.ts:1288-1294`); the model receives it but keeps advancing to the next decision point, violating the explicit rule `momentPrompts.ts:98-100` ("never narrate past one without advancing it"). The staged comp's many advance-beats invite "just keep advancing"; nothing caps advances at a ceremony boundary.
- **Differential:** the INVERSE of the excluded S3-CORE/B6 (under-call) — here the model OVER-advances. Pro catches up ~2-3 turns late (with a vote retcon, LIVE-7); flash recovers worse. Recovery is luck, not design.
- **Tuning rec:** cap `advanceGame` to ONE ceremony-class beat/turn (staged `comp-elimination` sub-rounds excepted as one logical comp); require a returned ceremony `BeatEvent` (noms/veto-ceremony/eviction) be narrated before any further advance (analogous to `_auto_record_scene`); or emit a `pending` pause at the NPC-HOH nomination. **Confidence:** HIGH. **Falsifier:** any chat message showing a ceremony when it occurred — none did.

### LIVE-7 · `[BLOCK-candidate]` · pro · VIEWED · Narration fabricates the eviction result ahead of the engine, which then contradicts it
- **Evidence:** turn-17 GM narrated "**6 to 4 … [nominee] … is the first to fall … she's gone**" + farewell + walking out; turn-20 the engine returned MORE ballots ("the reveal isn't over"), still `phase=eviction, evicted=[]`, the evictee `active`; true tally was **8-5** (13 voters). The evictee "left" twice; the count retconned.
- **Mechanism:** the staged eviction reveal drips ballots per `advanceGame`, but nothing stops the model narrating the CONCLUSION (evictee named + departure) before the engine's commit beat. **Faithfulness violation** (narration contradicts engine truth); the persisted truth is correct (engine wins), but the player saw a contradiction at a peak moment. **Tuning rec:** forbid narrating the eviction result/departure until the commit beat returns the eviction event; surface "final ballot"/"reveal complete" so the model can't conclude early. **Confidence:** HIGH.

### LIVE-2 · `[POLISH·high]` (0066 tuning; **confirms+extends ENG-1**) · both · VIEWED · A single staged comp burns a full in-game DAY and sweeps the just-crowned HOH asleep
- **Evidence:** week-1 HOH comp drove `timeOfDay` morning/day1→late-night/day2 in one turn (~9 clock ticks); engine `asleep` then included the **HOH who just won**; reproduced week-2. The model narrated the HOH awake to dodge the absurdity — contradicting the engine flag.
- **Mechanism:** `GameSessionAdapter.ts:3299-3302` calls `advanceClock` UNCONDITIONALLY per `advanceBeat`; 0006 staged comps are ~4-8 advance-beats, so one comp consumes >1 day. `awakeSet` (`timeOfDay.ts:120`) has no HOH/ceremony exception. `time_of_day_enabled:True` is the FE default (ENG-1). **Tuning rec:** advance the clock once per LOGICAL comp (skip the tick on inert `comp-elimination` beats); exempt the just-crowned HOH from `awakeSet` for the winning beat. **Confidence:** HIGH.

### LIVE-3 · `[POLISH·high]` (0049/0066 integration) · both · VIEWED · The sleep state is invisible to the narrator; asleep NPCs vanish from rooms with no time cue
- **Evidence:** at late-night the `whereabouts` result lists only the 7 awake NPCs; the 8 asleep (incl. HOH) are absent from every room with **no `asleep`/`timeOfDay` field**; the moment prompt has no "late-night"/"asleep" cue (grep: 0 hits in `momentPrompts.ts`). The model sees a half-empty house with no reason → invents/contradicts (LIVE-5). **Tuning rec:** add `timeOfDay` + `asleep:[…]` to the `whereabouts` result and a one-line "It's late-night; these have turned in: …" to the moment prompt (all already Vault-free in `/status`). **Confidence:** HIGH.

### LIVE-5 · `[POLISH]` · both · VIEWED · Narration clock decoupled from engine — invents wall-clock times ("06:19 PM") while the engine says morning
- **Evidence:** engine `timeOfDay=morning`/day3/`asleep=[]`; narration prefixed "**06:19 PM**" (the engine has no clock-time, only 5 phase labels) + NPCs saying "get some sleep". Direct consequence of LIVE-3. **Rec:** anchor the narrator to the engine phase (same fix as LIVE-3). **Confidence:** HIGH.

### LIVE-8 · `[POLISH·high]` (B3 family) · pro · VIEWED · Eviction→next-week transition is a fragile over-long chain; the goodbye double-surfaces
- **Evidence:** the week-1 eviction needed 13 ballot reveals → a `goodbye-message` pending → a "X leaves the house" commit → week-2 roll; the player authored the goodbye TWICE — free-text (turn 19) AND a structured `[warm/respectful/cold]` tone card (turn 22) for the same goodbye. The model called `advanceGame` repeatedly while the engine sat at `phase=eviction,pending=None` (appeared stuck; an oracle advance found one queued beat that cleanly rolled — engine sound, choreography fragile). **Tuning rec:** request the goodbye ONCE (the structured card owns the binding commit per ADR 0003); make the "leaves the house" commit beat fire exactly once. **Confidence:** HIGH.

### LIVE-1 · `[POLISH]` (grounding/non-degradation) · both · CONFIRMED (lead-verified) · Each NPC carries two contradictory occupations in the prompt; the model voices the placeholder
- **Evidence (lead-verified):** `characterFactory.ts:575` `background = "a ${rng.pick(OCCUPATIONS)} who plays as a ${archetype}"` (a DIFFERENT pool from `pickVocation()`); `momentPrompts.ts:728` surfaces `h.background` AND `:731` `h.vocation` AND `:737` `h.biography` (which re-embeds the placeholder via `deepProfile.ts:249`) → the placeholder appears 2×, the real vocation 1×; the model weights the placeholder non-deterministically. Live: Lexi seeded "stand-up comedian" voiced "bartender"; flash flipped Tiffany postal-carrier→realtor within one comp. The `:571` comment admits `background` is "RETAINED (byte-stable)" — kept for RNG stability but should not be SURFACED.
- **Tuning rec:** make `generateBiography()` use the real `vocation`; drop `h.background` from the momentPrompts roster line (keep the rng pick for byte-stability, stop surfacing its value). **Confidence:** HIGH.

### LIVE-6 · `[POLISH]` (rules grounding) · both · VIEWED · The 1st evictee is narrated as a juror
- **Evidence:** on the 1st eviction (of 15) the GM said "the jury of one … starts tonight" / "She's the first juror now" — but the first ~6 evictees are pre-jury (jury of 9 forms from the final 9); engine `jury:None`. Misleads jury-management strategy. **Rec:** surface a `juryStarted`/`isJuror` flag or the jury-threshold number in the prompt. **Confidence:** HIGH.

### LIVE-10 · `[POLISH]` (social legibility; **confirms SOC-1/SOC-4 LIVE**) · VIEWED · `socialRead` says "Nothing feels out of place" while the player is nominated
- **Evidence:** after the HOH put the player on the block, `socialRead(HOH)` returned "…you've witnessed 68 moments and know 12 things for certain. **Nothing feels out of place right now.**" `socialInitiatives` DOES model NPC scheming (the layer exists) — it just never surfaces a "you're a target" read. Combined with LIVE-4 (nomination not narrated), the player is **doubly blindsided with no readable warning** — the brief's flagged concern, now empirically confirmed. **Rec:** let the affect line reflect observable danger cues; suspense from readable uncertainty, not the surface asserting all is well. **Confidence:** MED.

### LIVE-9 · `[NIT]` (B1 re-confirmed) · pro · VIEWED · Residual "Let me check…" operator-aside in a visible bubble
- **Evidence:** 1/55 messages: "…four to go. **Let me check where the stragglers are** before you hunt them down." (about to call `whereabouts`) — not a hard leak, ~1.8% frequency. **Rec:** the FE leading-meta-sentence strip floated for B1.

### A-S3 single-tab repro (strengthens FEPY-4 / R-BND-1) — NOT a new id
9/4742 tool calls failed `StaleBeatError` (409) in **single-tab** play (no peer): within one multi-round turn the model carries a stale `expectedBeatSeq` after its OWN earlier advance. The FE reconciles (no visible break), but a 409 on a back-fill `recordInteraction`/`moveTo` can drop a scene's consequence fold **without concurrency** — a stronger version of the documented A-S3 risk. **Gate rec:** refresh `expectedBeatSeq` after each of the model's own advances within a turn.

---

## Roast complete — consolidated launch triage
**[BLOCK] (fix before launch):** LIVE-4 (ceremonies skipped) · LIVE-7 (eviction fabricated ahead of engine, BLOCK-candidate).
**[POLISH·high] (top quick wins / clusters):** the **0066 time/sleep cluster** ENG-1+LIVE-2/3/5 (ships on, mistuned, invisible to narrator) · TRANS-1 (orphaned 20fps timer, 1 line) · UX-1 (slug in finale composer, 1 line) · LIVE-8 (goodbye double-surface) · LIVE-1 (dual occupation) · FEPY-1 (casting error as GM narration) · SOC-1+LIVE-10 (coalition illegibility) · R-BND-1/FEPY-4/A-S3 (stale-beat drops folds, single-tab).
**[DOC]:** DOC-1..8 ceiling-freeze drift (CLAUDE.md @0069 vs features @0074; phantom FE port 7000).
**Everything else:** LATENT/NIT tracked above.

---

## R-ARCH-1 · Design question (owner-asked): "Is there any point in leveraging LLM context?"
**Short answer: as a STORE/source-of-truth, no — and a 1M-token window doesn't change the structural reasons. As a per-turn NARRATION working set, yes — but the lever is PRECISION, not VOLUME, and none of the live grounding bugs are context-SIZE problems.** Reasoned by mechanism across four lenses:

- **Vault Wall (the decisive one).** "Leveraging context" as memory means putting the season's history into the prompt. But the full history *contains the Vault* — hidden NPC↔NPC scenes, confessionals, hidden attributes. The architecture's whole guarantee is "the model cannot leak what it never receives" (mandate #2): the engine projects only the **Vault-free, witness-scoped** view (`getVisibleStateFor`, `renderGameContext`). Dumping history into a big window = feeding the Vault to the model = breaking the Wall *by construction*. A larger window only "helps memory" if you breach the Wall, so it can't be the mechanism. **Confirmed clean live:** 0 `npc:N`/0 hidden leaks in 55 messages precisely because the projection is small and curated.
- **Non-degradation (mandate #4 / ADR 0003).** "Long-term memory is the store *recalled*, never the chat *remembered*." The old version degraded *because* it held state in the context window. A 1M window is still a non-durable, non-authoritative, non-queryable, lossy cache with no schema and no consistency guarantee — a bigger cache, not a database. The store + permissioned semantic recall (`KnowledgeService`/embeddings) is strictly better: durable, Vault-safe, deterministically queryable, monotonic. Replacing recall with "stuff it all in context" *re-introduces* the exact degradation the rebuild exists to fix.
- **Faithfulness / DeepSeek V4 attention (frontier-AI lens).** Bigger context does **not** improve grounding and can degrade it: lost-in-the-middle + attention dilution mean effective recall over a packed 1M window is non-uniform, and V4's hybrid **Compressed/Heavily-Compressed Attention** makes long-context recall *lossy by design* — worse on the cheaper Flash tier (where this audit already found the most drift). "Feed it everything" is empirically fragile exactly where fidelity matters most.
- **Game design (ADR 0003: "prefer removing context to adding it; hand the model facts to voice, never scripts to recite").** **The live findings prove the lever is precision, not volume:** LIVE-1 (model voices a *placeholder* occupation because the prompt surfaces TWO jobs), LIVE-3 (sleep state *absent* from `whereabouts`/prompt), LIVE-4 (ceremony beats not narrated before advancing), LIVE-6 (no jury-threshold fact). **Not one** is a "context too small / needs more memory" problem — every one is "the engine projected the *wrong/missing* fact or the *wrong pacing*." Adding context would make LIVE-1/3 *worse* (more surface to contradict); fixing the projection's precision + the advance choreography fixes them.

**Where a large window legitimately earns its keep here (bounded):** carrying more *recent verbatim conversation* per turn so the model holds the thread across a long scene — but that's already the working set, the marginal value past the recent window is low (a season's Vault-free projection is small), and it trades against lost-in-the-middle. **Net recommendation:** do **not** invest in "leverage the LLM context window" as a memory/grounding strategy. Invest the same effort in (a) tightening what the engine *projects* (drop the LIVE-1 placeholder; add the LIVE-3 time/asleep fields — both Vault-free, both in `/status` already) and (b) the LIVE-4 advance/ceremony pacing. The 1M window is a red herring for every bug this audit found; the store-backed, permissioned, recall-on-demand design is the correct one and the live run validated it (clean Vault, non-amnesic recall, stable personas). Keep the context *small and exact*, not large.

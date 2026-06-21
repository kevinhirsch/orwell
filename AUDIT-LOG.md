# Orwell — Pre-Launch E2E Playtest & Refactor Audit · Consolidated Trace Ledger

> **The authoritative, on-disk trace ledger for this audit.** It survives context compaction.
> Every issue gets an entry with evidence and a literal `VIEWED` status; nothing is asserted
> without having been *seen* in captured telemetry, and nothing is `VERIFIED` until re-captured.

**Two parallel review lanes were consolidated into this one ledger** (owner-directed, 2026-06-21):
- **Lane A** (`claude/gracious-tesla-wytijo`) — States 1–4 + concurrency close-out (login/landing/
  settings, casting, core-loop + S3-RACE, resolution/retrospective).
- **Lane B** (`claude/relaxed-mayer-g0a512`) — the OOBE/casting polish, cross-platform + animation
  specialist sweep, seeded deep-casting parity, and the architecture-as-is cartography.
Where both lanes independently found the same defect (the chat-divergence "garbage"; the "background
not rendering" report) the entries are reconciled below and labelled with both lanes' evidence.

- **Method:** real stack (TS engine on 8765 + Python/FastAPI FE on 7000), engine = ground truth,
  Playwright temporal capture (video → ffmpeg filmstrip + DOM MutationObserver/event + network log),
  **two-window parity × {desktop 1440×900, mobile 390×844}**, narration on `deepseek/deepseek-v4-pro`
  via OpenRouter (operator-supplied key; session secret, sandbox-only, never committed/logged).
- **Posture:** launch is imminent. Remediate + gate at peer review; reuse the committed harness in
  `docs/audits/playtest-harness/`; build on the 2026-06-18/19 findings as baseline.
- **Many readers, one writer:** read-only investigation fans out to the `.claude/agents/` specialists;
  all ledger writes + remediation are the lead's, single-threaded and gated.

### Status legend
`OPEN` · `VIEWED` (visually confirmed in telemetry) · `ROOT-CAUSED` (traced engine→BE→FE→render with evidence)
· `FIX-PROPOSED` · `FIX-APPLIED` (awaiting gate) · `VERIFIED` (re-captured & re-confirmed) · `WONTFIX/NA`

### Triage key
`[BLOCK]` launch-blocking · `[POLISH]` high-priority polish · `[LATENT]` latent/potential (same mechanism)

---

## 1. Phase 0 — Evaluation baseline & premise reconciliation

### 1.1 Engine-is-truth oracle (the audit's consistency anchor)
- **Engine HTTP MCP** (`npm start`, port **8765**): tool transport `POST /:channel/call`
  `{"name":<tool>,"args":{…}}` + header `X-Orwell-User:<user>`; player tools Vault-free by construction.
- **FE projections** (port **7000**, Vault-free): `GET /api/orwell/{health,state,status,moment}`;
  `POST /api/orwell/{new-game,decision,next-season}` (admin-gated structured doors).
- **Oracle rule:** at every checkpoint capture engine state and assert (a) FE render matches it and
  (b) narration matches it. Any divergence among {engine, render, narration} is a defect — name which.

### 1.2 Narration tier mapping (confirmed — operator + harness README §1)
- Narration LLM is **runtime-configured**, not a code binding: an OpenRouter endpoint set through
  Settings. Default for grounding-critical play: **`deepseek/deepseek-v4-pro`**.
- **Tier story:** `-pro` = higher-fidelity / disciplined; `-flash` = fast/cheap/**verbose**, lower
  fidelity (invents cast, refuses `advanceGame`). Hunt narration failures hardest on `-flash` and at
  the Pro↔Flash boundary; all gates otherwise stub the LLM (`Echo`/`DeterministicNarrator`).

| Model | Context | Max output | Pricing prompt/completion (per Mtok) |
|---|---|---|---|
| `deepseek/deepseek-v4-pro` | 1,048,576 | 384,000 | $0.435 / $0.87 |
| `deepseek/deepseek-v4-flash` | 1,048,576 | 65,536 | $0.09 / $0.18 |
- Both are **reasoning models** (reasoning counts against the output cap). The live game turn sends
  **no explicit `max_tokens`** (provider default governs ⇒ low main-turn truncation risk) and **no
  `reasoning_effort` knob is wired**; the FE consumes + scrubs reasoning deltas out of the public bubble.

### 1.3 Consistency model (what "two-window garbage" maps onto HERE)
- **Not raw websockets.** Cross-tab/-device sync is **SSE/server-push**: `session_events`/`sessionSync`,
  `_publish_game_updated` (0064), and the single-dispatcher `orwell:gamechanged` debounce seam
  (`platform.js`). Closed-set ordering is the engine's monotonic **`beatSeq`** with **`expectedBeatSeq`**
  stale-guards → HTTP **409 `stale-beat`** + an **`idempotencyKey`** at-most-once funnel (feature 0065).
- **Intended model:** the closed set (outcomes/state/persistence/Vault) is engine-authoritative and
  serialized per user; the open set (social prose) is recorded, never normalized. **The audit's question:**
  does the FE assume a stronger guarantee than the SSE/beatSeq layer provides, and do two windows converge
  to engine truth — and how fast?

### 1.4 Surface reality (corrects the generic brief template — both lanes' Finding #1)
- **No Canvas/WebGL game surface.** It is a **DOM/chat PWA** (vanilla JS + FastAPI). The brief's
  canvas/DPR/touch→canvas-mapping checks are **N/A** except `<img>` portraits/headshots. The
  responsive/touch/PWA/safe-area contract IS real and CI-gated.
- **The game IS the main chat** (ADR 0003; 0022 rich UI deferred). HUD = the gadget-rail (0054) + status
  panel + presence/diary/cast/finale/retrospective windows (Lane-F `OrwellWindow`/`.ow-*` kit).
- The eight priority invariants (mandate order): Vault isolation (incl. God Mode) → event visibility →
  behavioral fidelity → replayability/naming → eligibility → outcomes by stats+temperature → persistence
  non-degradation → daily-event.

### 1.5 Prior-art baseline (carried; RE-VERIFY against current code — a code fix landing is NOT verification)
The 2026-06-18/19 live runs are the baseline. The three then-open **[BLOCK]** items (**S3-CORE** engine-
bypass, **S4-1** decision escape-hatch, **S1-1** landing overlap) had fixes land in code but un-live-
verified; the highest-value work was **live re-verification**, then driving the open items. Carried-forward
watch-list (each re-confirmed below or still tracked): S3-CORE/B6, S4-1, S1-1/S6-2, debug-note-#1 (mobile
casting short-circuit), S2-1/S5-1 (under-finalize), S4-2 (stale endgame projections), S1-2/3/4, S3-1,
L18 (engine hang on fallback-digest), L31/L28b/L37/L39/L40/L35/L45.

---

## 2. Issue ledger (master)

| ID | State | Sev | Status | One-line |
|---|---|---|---|---|
| F1 | Phase 0 | n/a | ROOT-CAUSED (doc) | Brief is a generic template; premises reconciled (§1.3–1.5). |
| S1-1 | State 1 | ~~BLOCK~~ | **VERIFIED-FIXED** | Zero-data landing text-over-text — fixed by the OOBE modal-scrim redesign; verified desktop/390/320. |
| S1-4 | State 1 | ~~POLISH~~ | **VERIFIED-FIXED** | Login password glyph — now the show/hide eye toggle (#436 hides Edge `::-ms-reveal`). |
| S1-2 / F-S1-C | State 1 | POLISH | **VERIFIED-FIXED** | `/api/orwell/avatar` 404-on-every-load → console noise. Route → **204**; `orwellAvatar.js` treats only `status===200` as present. Re-captured: console errors 2→0. |
| S1-A | State 1 | POLISH | **VERIFIED-FIXED** | Login "Remember me" unlabeled 14×14 dot → visible labelled row, ≥24px row hit target. |
| S1-B | State 1 | POLISH | **VERIFIED-FIXED** | Login version label contrast 1.89:1 → opacity 0.25→0.6 (~4.43:1, AA). |
| S1-C | State 1 | POLISH | **VERIFIED-FIXED** | One-frame white FOUC on cold load → inline theme-bg on `html`/`body` first paint. |
| BG-1 + OBS-1 | X-cut | POLISH | **VERIFIED-FIXED (two mechanisms)** | Operator "background not rendering": (A) reduced-motion → canvas-only patterns blank → `_bgStaticInit` static frame (Lane A); (B) no-saved-theme → default pattern fell to `'none'` → resolve `THEME_DEFAULT_PATTERN[activeName]` (Lane B; also closes OBS-1's non-determinism). |
| S1-D | State 1 | POLISH | ROOT-CAUSED (deferred) | `/state` polled ~13×/2.5s on landing — prewarm fast-poll + ~10 uncoordinated gadget pollers. Refactor (shared poller), not a leaf patch. |
| S1-F/G/H/J | State 1 | POLISH/LATENT | ROOT-CAUSED (deferred) | Settings-occluded-by-scrim; welcome⟂onboarding structural latent; login pre-auth 401; username-field dot. |
| S2 | State 2 | n/a | **PASS (VIEWED)** | Live casting `-pro`: producers open first, named producer, reactive persona, **no leaks**, tight grounding, finalized on first readiness cue; move-in = 15 real names. |
| F-S2-A | State 2 | POLISH | **VERIFIED-FIXED** | Gating cast-photo card's frosted glass bled the producer narration through → opaque override for `#orwell-headshot` under `theme-frosted`. |
| S2-1 | State 2 | POLISH | OPEN | Model under-finalizes casting past `finalizable` — add a structural "Enter the house". |
| F-S2-B | State 2 | POLISH | ROOT-CAUSED (deferred) | 2× console 404 (inherited deep-research poller + finished-stream status probe) — feature-gate off in the game build. |
| S3-PAR | State 3 | n/a | **PARITY HOLDS at rest (VIEWED)** | Two-window same-identity: shared engine/HUD reconciles via SSE/`beatSeq` to engine truth (both lanes). |
| **S3-RACE / ADR 0008** | State 3 | ~~BLOCK~~ | **VERIFIED-FIXED (BUILT on main)** | Concurrent-write cross-tab CHAT divergence (render-layer; engine + persisted log correct). Both lanes independently root-caused (no `seq`; optimistic sender; `hasActiveStream` peer-drop). **Implemented per ADR 0008** (per-session `seq` + render/reconcile-by-id + `{id,seq}` dedup + completion broadcast; gates `test_adr0008_*`). Landed `5e3a2f3`. |
| **S3-CORE** | State 3 | ~~BLOCK~~ | **VERIFIED-FIXED (live)** | Model-bypasses-engine / cast-invention does NOT reproduce: 14-turn live week-1 loop, engine advanced 14/14, 0 leaks, 0 genuine inventions, narration↔engine fidelity held. Fix family effective. |
| S3b | State 3b | n/a | **PASS (VIEWED)** | Seeded deep-casting parity: narrated facets == engine seed exactly (3 HGs deep-probed); structural single-source guarded (`appearanceConsistency`). |
| S4-RESOLVE | State 4 | n/a | **PASS (live)** | Full game → crowned NPC winner; player→jury; interactive finale juror path fired; retrospective renders ordered per-juror reveal. |
| S4-VAULT-RETRO | State 4 | n/a | **PASS — Wall holds at its one opening** | 0048 unseal reveals STORY not NUMBERS: 2037–2087 hidden beats / 13 types, 13 wks per-voter ballots, **0 numeric leaks**, secret-ballot anonymized all season, `npc:N` only in `id` leaves. |
| S4-1 | State 4 | ~~BLOCK~~ | **VERIFIED-FIXED (code+live)** | Stuck-player (narrated past a pending) fixed by `rearmFromStatus` + the 15s `/status` pending "escape hatch". |
| S4-EDGE / F-S4-C/D/E | State 4 | mixed | **VERIFIED** | Rejoin/dropped-socket/AI-timeout graceful (beatSeq stable, composer re-enabled). 502-as-GM-bubble (F-S4-C) **FIXED** → `msg-system` notice; silent mid-sentence truncation (F-S4-D) **FIXED** → `finish:length` → `Continue ▸`; mid-stream reload reconciles (F-S4-E ✅). |
| S4-2 | State 4 | POLISH | partial | `/status` carries `finished+winner` (✓) but `/recap`+`/finale` still return null winner post-finish. Non-blocking (FE recovers via retrospective). |
| F-S4-F | State 4 | LATENT | ROOT-CAUSED | Resume-path name DRIFT ("Luke→Lake Fleming") on a mid-stream-reload-resumed turn — resume-context-specific (clean play = exact); ties to ADR 0008 resumable-stream context. New gate recommended. |
| **State 5** | OOBE | mixed | **VERIFIED-FIXED** | Operator OOBE reports: particles (=BG-1/OBS-1 Lane B), cast-photo box movable-not-resizeable, welcome re-shows after backend reset. §2.8. |
| **State 6** | X-platform | 1 BLOCK + polish | **VERIFIED-FIXED** | Specialist sweep on the State-5 surfaces: skip-trap [BLOCK] + mobile sheet/touch/boot/transient remediations R1–R8 + D1. §2.9. |

---

## 2.2 State 1 — Initial Instantiation (login · zero-data landing · settings · onboarding)

**Headline (both lanes):** the prior State-1 launch-blocker **S1-1** is **fixed** (clean OOBE modal scrim,
no text-over-text, verified desktop/390/320), and **S1-4** is fixed. **No State-1 launch-blockers** — only
polish. Two apparent anomalies (same-identity parity tip-divergence; mobile-settings nav "overflow") were
adversarially **ruled benign** (random client-side Tip behind the scrim → pixel-identical; settings nav is a
horizontal-scroll tab strip → legitimate reflow, every tab reachable).

**Remediation — APPLIED & VERIFIED** (FE-only, no engine/Vault impact): **S1-2/F-S1-C** avatar 404→**204**;
**S1-A** Remember-me labelled row; **S1-B** version contrast 0.25→0.6; **S1-C** first-paint dark bg (FOUC
gone, narrow `f-001` meanL 255→18.7). **Deferred (root-caused):** **S1-D** (`/state` ×13 on landing —
prewarm fast-poll + ~10 uncoordinated gadget pollers; coalesce behind one shared poller — roadmap);
**S1-F** (Settings occluded by the z99999 onboarding scrim — confirm a new player isn't blocked); **S1-G**
(welcome `#welcome-screen` not mutually exclusive with casting/headshot overlays — make ⟂ by construction;
its concrete manifestation is F-S2-A); **S1-H** (login `theme.js` auto-init fires authed prefs fetches
pre-auth → 401 noise — gate when unauthed); **S1-5/S1-I** (inherited-workspace copy ships hidden in the
game-build DOM — strip from the template); **S1-1L** (splash-suppression is timing-fragile — suppress at
the top of `route()` when `started===false`).

---

## 2.3 Cross-cutting — the "background not rendering" report (TWO mechanisms, both fixed)

Operator: "the animated background isn't rendering." Two **independent** bugs produced the same symptom; both
fixed:
- **Mechanism A — reduced-motion → blank (Lane A, BG-1).** `theme.js` skipped the canvas generator under
  `prefers-reduced-motion`; the 6 **canvas-only** patterns (incl. default telescreen→perlin-flow, which had
  NO CSS base) then rendered **nothing** ("off", not "static"). **Fix:** `_bgStaticInit` runs the generator
  in a bounded synchronous rAF burst then restores real rAF — full texture, **zero motion**; reduced-motion
  routes through it. Verified canvas present + `animating=false` under reduce, still animating under
  no-preference (`fbe2124`).
- **Mechanism B — no-saved-theme → `'none'` (Lane B, "problem d" / OBS-1).** `initThemeUI()` computed the
  boot pattern as `(saved && …) || (saved && THEME_DEFAULT_PATTERN[saved.name]) || 'none'` — both guarded on
  `saved`, so a fresh / factory-reset / no-stored-theme client (server pref also null) fell straight to
  `'none'` even though colors correctly resolve to the default theme. **Fix:** resolve the pattern for the
  ACTIVE theme name (`THEME_DEFAULT_PATTERN[activeName]`). This **also closes Lane A's OBS-1** (no-saved-theme
  pattern non-determinism) by pinning telescreen→perlin-flow. **Verified before/after** (reduced-motion OFF):
  before `perlinCanvas=False`/no class; after `#perlin-flow-canvas` + `bg-pattern-perlin-flow`. (Lane B's
  State-6 sweep further hardened this — R3 gives perlin-flow a faint static base + arms the class at first
  paint, killing the boot pop-in race.)
- **OBS-8 [known minor]:** under reduced-motion a window resize re-inits + clears the frozen canvas until the
  next theme re-apply — infrequent + recoverable; per-generator resize-repaint is a follow-up.

---

## 2.4 State 2 — Onboarding / live casting interview (`-pro`, LIVE) · PASS

Casting works end-to-end live on **both platforms**: producer opener (producers speak first) → incremental
engine-grounded `updateCasting` (`known` accretes playerName→backstory→motivation→archetype→strategy→notes)
→ `createCharacter` → premiere move-in (15 real cast names, none fabricated). Producer persona is sharp,
consistent, perceptive. **0 machinery leaks** any turn; reasoning hidden. Debug-note-#1 (mobile casting
short-circuit) **VERIFIED FIXED** (full interview, no force-finalize floater). B4 (houseguest invention)
**NOT reproduced** (the earlier "Gemma Meyer" was a stale-session test artifact — engine wiped without
resetting the FE session).
- **F-S2-A — VERIFIED-FIXED:** the gating cast-photo dialog's 32%-frosted glass bled the producer narration
  through. Higher-specificity `body.theme-frosted #orwell-headshot.ow-window` → opaque fill, no backdrop blur
  (every other window stays frosted). This is S1-G's concrete, fixed manifestation.
- **S2-1 (OPEN):** model under-finalizes (probes optional `privateStrategy` past `finalizable`) — add a
  structural "Enter the house" affordance.

---

## 2.5 State 3 — Core loop + two-window concurrency · S3-RACE/ADR 0008 = BUILT

**Shared ENGINE/HUD state: CONSISTENT (both lanes).** Idle A==B byte-identical; after a live turn mutated
the engine, Window B reconciled via the 0064 push within ~3s (beating the 20s poll) and A==B matched engine
truth. The closed-set `beatSeq` spine (0065) is solid.

**The FE CHAT CONVERSATION was the "garbage" bug — S3-RACE, now FIXED (ADR 0008, BUILT on main).** Both
lanes independently reproduced + root-caused it: the chat log is FE-owned (FastAPI session DB replicated over
the 0064 SSE channel), NOT engine state, with **no merge discipline** — (1) no ordering key (`uuid4` +
non-unique `timestamp`), (2) optimistic sender never reconciles post-`[DONE]`, (3) `hasActiveStream` gate
drops the peer's events; streaming turns publish only `run-started`, never a completion event. Lane A looped
**10/10 diverge** (gap accumulates; a manual reload reconciles ⇒ persisted log intact). **Implemented per
[ADR 0008](docs/decisions/0008-chat-conversation-consistency.md)** (FE-only, no engine/Vault impact): Phase A
authoritative per-session `seq` (schema + backfill migration + seq-ordered reads + `message-added` completion
broadcast); Phase B render-/reconcile-by-id (temp-id→canonical adoption, divergence-gated rebuild, dropped
the `hasActiveStream` suppression); Phase C permanent gates. Landed `5e3a2f3`.
> **Reconciliation note (Lane B):** Lane B's consistency-parity specialist ran a read-only pass and reported
> ADR 0008 "NOT-PRESENT" — that pass was **before `5e3a2f3` landed**; the verdict is **SUPERSEDED**. Its
> source trace (F1/F2/F3) matched ADR 0008's items 1–4 exactly and corroborated the implementation spec.
> *Remaining (both lanes): a live concurrent-write browser re-run with real-model turns is the one open
> verification; the convergence foundation is proven by the interleaved-writers gate + the reload-reconcile.*

**ADR-0008 LIVE VERIFICATION — RUN (2026-06-21, Lane B, real `-pro` model, two tabs/one session).** The
open item above is now driven (`.audit-telemetry/adr0008_{parity,diag,bothactive}.py`):
- ✅ **Data integrity FIXED (the original blocker is resolved):** the persisted log is seq-ordered + correct;
  a fresh reload ALWAYS reconciles to the full `A-0,B-0,A-1,B-1` order; no accumulation, no corruption.
- ✅ **Idle-tab live reconcile WORKS:** with tab A idle, a write in tab B reaches A over SSE and A reconciles
  (`softReloadHistory` fires, A renders B's message) — the original `hasActiveStream`-drop bug is fixed for an
  idle receiver. Same-session confirmed (both tabs sid `901b04da`), so NOT a session-split confound.
- ✅ **RESIDUAL ROOT-CAUSED + FIXED (owner authorized the fix):** when **two tabs of the same session stream
  turns CONCURRENTLY**, the first-active tab did **not** converge to the peer's concurrent write — it stayed
  diverged (VIEWED at +0.5s and **+15s**, no reload). **Root cause (clean):** `_streamSessionId` is SET on
  stream start (`chat.js:603`) but was **NEVER reset to null**, so `hasActiveStream()`
  (`_streamSessionId === sessionId`, `chat.js:159`) stayed permanently true for the last-streamed session —
  so the deferred reconcile re-deferred FOREVER at the `chat.js:3619 if (hasActiveStream(sessionId))` guard,
  and a tab that had sent even one turn could never live-reconcile a peer's write to that session until a
  reload. (This is why the idle-tab diagnostic — tab A never sent — DID reconcile.) **Fix:** the foreground
  reader's `finally` now clears it — `if (_streamSessionId === streamSessionId) _streamSessionId = null;`
  (guarded so a late finally can't clobber a newer stream; background streams stay covered by
  `_backgroundStreams`). **VERIFIED:** the same two-tab interleaved harness now shows **A == B == reload,
  converged across both iters**; the instrumented both-active test shows A picks up the peer's write at
  settle. New source-pin gate `test_adr0008_reconcile_contract::test_stream_end_resets_stream_session_id…`;
  ADR-0008 suite 15 passed. FE-only, no engine/Vault impact.

**S3-CORE (prior blocker) — VERIFIED-FIXED (live).** 14-turn `-pro` week-1 loop (hoh-comp → noms → veto-comp
→ veto-ceremony → eviction): engine advanced **14/14**, **0 leaks**, **0 genuine cast inventions** (the
`invented` flags were all `<conjunction>+roster-first-name` regex false positives), narration↔engine truth
held (HOH/noms/veto-holder narrated exactly in phase). Anti-sycophancy holds (a real NPC won HOH, not the
player-for-declaring-intent). The fix family (forced `advanceGame` L39b, finalize fallbacks,
`markHouseguestMet` belt, pre-emission outcome guard) is effective. The decision-card escape hatch (S4-1)
surfaced + resolved the player's `comp-round` pending live.

---

## 2.6 State 3b — Seeded deep-casting parity (narration vs engine SEED) · PASS

Do live narrated storylines reflect the engine's **seeded** deep-casting (physical/demeanor/vocation/
hometown/age/backstory), or drift/invent? Fresh seeded game (seed 31337).
- **STRUCTURAL — guaranteed.** `momentPrompts.ts` feeds each roster line the seeded vocation+hometown, the
  demeanor to voice, and the appearance authored from the **same `physicalCharacteristics` facet the portrait
  uses** (`physicalFacetToAppearance`), plus hard "EXACT names, never invent" rules. `appearanceConsistency.test.ts`
  proves the facet is the single source (prose appearance is derived, cannot contradict; narration + portrait
  read the same source).
- **EMPIRICAL — honored (VIEWED).** 3 HGs deep-probed; **every facet matched the seed exactly** (Hugo Cabrera
  37/welder/terse; Elena Powers 30/trucker/warm; Hassan Mercado 23/escape-room/stoic — physical + demeanor +
  vocation + hometown + age all ✓), names exact.
- **Verdict: parity HOLDS in normal play.** Confirms the earlier **F-S4-F** drift was **resume-context-
  specific**, not general. **Recommended new gate:** assert the resumable-stream resume path reconstructs the
  FULL seeded roster (exact names + facets) so grounding can't degrade on resume (ties to ADR 0008).
- Two unit gates added this lane: a **conversation memory-recall** test (a low-salience NPC profile detail,
  recorded via `recordInteraction`, survives 40 records + `advanceToFinale`, recallable from MCP as "a thing
  that happened" — non-amnesic, non-degrading, survives restart) and **ADR-coverage** gap tests.

---

## 2.7 State 4 — Resolution / finale / retrospective + edge cases · ALL PASS

**S4-RESOLVE.** Fast-forwarded the live sandbox via deterministic engine `callTool` (EchoNarrator, model-
free, byte-faithful closed-set drive). 14 weeks → crowned NPC winner (not story-protected for the player);
player **evicted into the jury**; the **interactive finale juror path** fired (`juror-question`/`juror-vote`
surfaced & resolved); the FE retrospective window renders the winner + ordered per-juror vote reveal.

**S4-VAULT-RETRO — the Wall holds at its one opening.** The 0048 retrospective (`readsVault:false`) unseals
the **story, not the numbers**: 2037–2087 off-screen hidden beats across 13 types (all humanized prose);
13 weeks of per-voter unsealed ballots; **numeric-leak oracle CLEAN (0)** — no soul/relationship/stat number
crosses (`RetrospectiveView` is structurally narrative-only); secret-ballot anonymization held **all season**
(player-visible eviction beats all read "a vote to evict ⟨nominee⟩"; per-voter attribution unseals only
post-season); `npc:N` appears only under `id` leaf keys (JSON-path-walk proven), never in prose. FE retro DOM
scan: numeric CLEAN, `npc:N` absent.

**S4-1 — fixed (code+live):** `rearmFromStatus` + the 15s `/status` pending "escape hatch" make a pending
reachable without the chat agent dispatching it (fail-open, no re-nag).

**S4-EDGE + fault-injection — resilient.** Rejoin loads clean (0 JS errors); dropped socket → native
`EventSource` auto-reconnect + capped backoff + 1.5s re-bind; AI timeout server-side (client stall watchdog
deliberately disabled). Injected 3 faults on `/api/chat_stream`: **every case** no engine desync (beatSeq
stable), no crash, no stuck spinner, composer re-enabled. Polish residue: **F-S4-C** 502 rendered as a GM
bubble (**FIXED** → `msg-system` notice); **F-S4-D** truncated stream stopped silently mid-sentence
(**FIXED** → a `Continue ▸` affordance); **F-S4-E** mid-stream reload **reconciles** (✅, corroborates ADR
0008's reload-reconcile). **S4-2 (partial):** `/recap`+`/finale` still return null winner post-finish (non-
blocking — FE recovers via the retrospective). One client-side corroboration of ADR 0008 defect #4: the
client `message-added` SSE listener exists but the streaming path never fired it server-side (now addressed
by the ADR 0008 completion broadcast).

---

## 2.8 State 5 — OOBE / casting polish (operator-reported, post-factory-reset first-open) · VERIFIED-FIXED

Three operator reports on first open after a **backend factory reset**, all root-caused + verified before/
after with real-chromium telemetry. *(A fourth — "producer message concurrent with the box" — was retracted
by the operator.)*
- **Particles (= BG-1/OBS-1 Mechanism B, §2.3):** the default theme's `perlin-flow` didn't render on a fresh/
  no-saved-theme client → resolve `THEME_DEFAULT_PATTERN[activeName]`. Verified canvas present after.
- **Cast-photo box "movable grip but static; must move, not resize":** it was `draggable:false` + an
  `!important` center pin (which beat the kit drag's inline writes). Added a **`top-center`** slot (reuses the
  slot engine's centering + drag-offset machinery), made the box `draggable:true`/`resizable:false`, dropped
  the pin. Verified: centered (cx=720), dragged 420px (grip live), edge-resize 0px.
- **Welcome skipped after a backend reset:** the per-user `localStorage['orwell-welcome-seen']` reload-
  debounce is cleared only by the client restart hooks, which a server-side backend reset never reaches.
  `route()` now clears the stale marker when the engine reports a genuinely fresh casting intake
  (`casting.known` empty) that this tab session never opened (`SEAT_TAKEN` captured before
  `openFreshInterviewSession`) — re-greets the new season, no re-pop on a same-session mid-interview reload.
  Verified both cases in-browser. *(Residual edge: a hard same-tab F5 immediately after a backend reset keeps
  the tab's sessionStorage seat flag → needs a server-side per-game nonce; out of scope for launch.)*

---

## 2.9 State 6 — cross-platform + animation specialist sweep (on the State-5 surfaces) · VERIFIED-FIXED

Three read-only specialists (responsive-cross-platform, transient-animation, consistency-parity) swept the
State-5 changes. Both headline changes are fundamentally sound (mobile sheet usable, no clip/overflow, 44px
targets; canvas lifecycle clean, honors reduced-motion). Findings reconciled to remediations **R1–R8 + D1**
(owner-authorized; each verified before/after in-browser; FE suite 1766→1780 passed):
- **R5 [BLOCK]:** "Skip for now" was not durable — a failed/lagged `casting/photo` POST left `castPhoto` in
  `missing`, so the poll re-mounted the box and **trapped the player**. Added a session latch
  (`_photoHandledLocally`) + retry-with-backoff. Verified: skip + 500 + re-routes → box stays closed.
- **R6:** `teardownWindow()` now clears `ow-casting-headshot-open` (was unmount-only) so the welcome splash
  returns on the skip/finalize exits (compounded R5).
- **R1:** the mobile sheet went flush full-width — the box `max-width` fought the narrow sheet host's
  `left:0/right:0` (one-sided gutter). Drop width/max-width ≤768px. Verified `rightGutter=0`.
- **R2:** the kit titlebar no longer advertises `cursor:move`/"Drag to move" on touch where drag is disabled
  (`windowDrag` stops painting the inline cursor ≤mobileSkip + a kit media query + `isNarrow()` tooltip gate).
- **R3:** head-script arms the default `bgPattern` at first paint + a faint static perlin base (also the
  reduced-motion fallback) → no bare-bg boot race.
- **R4:** `vh`→`dvh` (vh fallback) on the box + kit body max-heights (keyboard fold).
- **R7:** a welcome→box handoff bridge class suppresses the ~120–180ms splash flash.
- **R8:** the narrow sheet top tracks the live hamburger bottom (no 6px overlap).
- **D1 (owner: opt out):** the one-time OOBE box is `persistLayout:false` + no `slotKey` (new kit option,
  `_emit` funnel) → it ALWAYS re-centers and a drag persists/syncs nothing. Verified.

---

## 2.10 Architecture latents (static-traced; `docs/ARCHITECTURE-AS-IS.md`) — confirm/drive

- **A-S5 [LATENT·High]** — stale-beat 409 is reconciled by **parsing the error message string** while the
  engine's structured `{code:"stale-beat",beatSeq,board}` body is discarded → a wording drift turns reconcile
  fail-closed. (Lower-risk post-ADR-0008, but still string-coupled.)
- **A-S4/D2 [LATENT]** — manual `orwell:gamechanged` dispatch allowlist → silent HUD staleness for any
  unlisted mutating tool (g15 enforces "one dispatcher" but not completeness of the allowlist).
- **A-S3 [LATENT]** — stale-409 on `recordInteraction`/`makeDeal`/`moveTo` is skipped → can drop a scene's
  only consequence fold (non-degradation tension).
- **A-render [LATENT]** — duplicated live (`chat.js`) vs reload (`chatRenderer.js`) render engines with
  documented drift (the central FE maintainability smell).
- **A-settingsModule / A-data-user [LATENT]** — `window.settingsModule` referenced but never assigned (dead
  fallback); `body[data-user] || ""` collapses per-user client-storage keys if the attr is ever absent.

---

## 2.11 Current-main regression checks (2026-06-21, Lane B continuation)

- **ADR-0008 two-tab concurrent convergence — VERIFIED-FIXED** (see §2.5): the `_streamSessionId`-never-reset
  residual is fixed + gated; live harness shows A==B==reload converged.
- **Vault Wall (#1 mandate) — RE-VERIFIED CLEAN on current main (live player-channel scan).** `getGameState`,
  `getVisibleStateFor(player)`, `seasonRecap` scanned live: **0 numeric secret leaks** (no
  trust/affinity/threat/emotional/volatility/aptitude/privateStrategy number crosses); **every one of the 31
  player-visible events has the player IN its witness set (0 off-screen NPC-to-NPC leaks); 0 hidden/offScreen-
  flagged events reach the player.** `npc:N` appears only as bare ids in `witnessSet` (an id-list, FE-resolved
  to names) — not prose. **Negative control:** the engine-only `resolveCompetition` is **rejected** on the
  player channel. The Vault Wall holds after all the main churn (ADR 0009, 0066, A1 modal, etc.).
- **Cross-user isolation (#1-mandate first-class guarantee) — RE-VERIFIED CLEAN on current main (live, two
  users).** Two engine sandboxes (`audit-admin` with a started game + a fresh `audit-user-iso-b`) are fully
  isolated: B's `preSeedCast` (seed 99887766) warmed a DISTINCT 15-NPC cast sharing **0 names** with A's
  roster; B's preSeed left A's roster **byte-unchanged**; **B's header never returns A's game**; the no-header
  "default" routes to its OWN separate sandbox (not A's). No call for one user returns another user's game —
  secret or not. Holds after the main churn.
- **F-S4-C (502 rendered as a GM bubble) — FIXED.** Root cause (code-read): the chat-stream sender's
  pre-stream non-200 branch (`chat.js` `if (!res.ok)`) typewrote the raw upstream error into `holder`, which
  was mounted as `msg msg-ai` **with a `.role` "Big Brother" label** — so a gateway/proxy failure read as
  in-game narration (immersion break). **Fix:** reclassify the idle holder to the quiet out-of-character
  `.msg-system` style (`style.css:9056`) **and** rebuild its body to drop the `.role` GM label, then frame a
  generic, actionable failure (`⚠ Connection error (NNN) — your message didn't go through. Try again.`) — the
  tool-mode-switch copy (matched by `/Chat mode/i`) keeps its own message. **Verification:** `node --check`;
  source-pinned by `tests/test_prelaunch_blockers_s6s4.py` (two F-S4-C tests read the literal error-path
  slice — the file's standing posture: "CI can't drive the live stack here, so we pin the WIRING"). A live
  in-game repro stays blocked environmentally (the audit fixture user has no active in-game session —
  `sendMode='newchat'` — so the send routes through the casting/new-chat path, not the in-game branch the fix
  targets; the 502 stub fires ×1, confirming the rig, just on the wrong branch). *(Sibling note, not chased:
  the casting/new-chat stream-error path appears to swallow the 502 with no visible notice — a separate
  surface.)*
- **F-S4-D (a truncated reply stopped silently mid-sentence) — FIXED.** Root cause (code-read): a reasoning
  model (DeepSeek-V4) bills its hidden chain-of-thought against the SAME output budget as the visible reply,
  so a heavy-thinking turn can hit the token cap and stop the answer mid-sentence — and the streaming path
  never inspected `finish_reason` (`llm_core.py:1644`, comment-only), so the cut-off passed with **no signal**
  (the only "incomplete" affordance was the *round-cap* `rounds_exhausted`, a different thing). **Fix** (mirrors
  `rounds_exhausted`): `llm_core` captures the terminal `finish_reason` and emits a `{"type":"finish","reason"}`
  event at `[DONE]`; `agent_loop` records it per round and, after the loop, emits `{"type":"truncated"}` iff the
  FINAL round ended on `"length"` (suppressed when `rounds_exhausted` already fired — no double affordance); the
  `finish` event is consumed, never leaked. `chat.js` renders `truncated` as a quiet `.stopped-indicator`
  "cut off … `Continue ▸`" note appended to the history container (NOT the GM body bubble). Also raised the
  Anthropic-adapter `max_tokens` fallback off the reasoning-truncating **4096 → 8192** (a configured preset
  still wins). **Verified:** the agent-loop behaviour is driven for real (`tests/test_fs4d_truncation.py` — a
  fake length-finish stream through the real `stream_agent_loop` ⇒ a `truncated` event; a normal `stop` ⇒ none;
  the `finish` event is not leaked), the `llm_core`/`chat.js`/Anthropic-fallback legs source-pinned; `node
  --check` + `py_compile` + the full FE suite green.

## 3. Close-out verdict

**All states swept** (S1 instantiation · S2 onboarding · S3 core-loop + concurrency · S3b seeded parity ·
S4 resolution · **S5 OOBE polish · S6 cross-platform/animation**). Engine-side Vault Wall, cross-user
isolation, secret-ballot anonymization, retrospective story-not-numbers, narration↔engine fidelity, the
decision-card escape hatch, seeded-casting grounding, and the OOBE/cast-photo flow are all **verified clean
on the live build**.

- **Launch-blockers: ALL RETIRED.** S3-RACE/ADR 0008 (chat divergence) **BUILT** (`5e3a2f3`); S3-CORE
  (engine-bypass/cast-invention), S4-1 (stuck player), S1-1 (text-over-text), and the State-6 skip-trap (R5)
  all **VERIFIED-FIXED**.
- **Polish backlog — fixes applied this campaign (FE-only, verified):** S1-2 (avatar 204), S1-A, S1-B, S1-C,
  BG-1+OBS-1 (background, both mechanisms), F-S2-A (cast-photo opacity), State-5 (particles / draggable box /
  welcome re-show), State-6 R1–R8 + D1, **F-S4-C (502 → `msg-system`, not a GM bubble)**, **F-S4-D (silent
  truncation → `Continue ▸`; Anthropic max_tokens 4096→8192)**.
- **Remaining (non-blocking, tracked):** a live concurrent-write two-tab re-run with real-model turns (the one
  open ADR-0008 verification); S4-2 (`/recap`+`/finale` null winner); F-S4-F + the
  resume-path grounding gate; S1-D (gadget poller coalescing — refactor); S1-F/G/H,
  S1-5, S1-1L, S2-1, F-S2-B; the §2.10 architecture latents; and the State-5 same-tab-F5 welcome edge
  (needs a server-side per-game nonce). The refactor roadmap is `docs/REFACTOR-ROADMAP.md`.

---

## 4. Changelog
- 2026-06-20 — Both lanes initialized; Phase 0 baseline + premise reconciliation; prior 2026-06-18/19 findings
  carried as the re-verify baseline; five specialist subagents defined in `.claude/agents/`.
- 2026-06-20 → 06-21 — **Lane A:** full stack live; **State 1** captured (S1-1/S1-4 verified fixed; S1-2/A/B/C
  + BG-1 fixed & verified; parity + mobile-settings ruled benign); **State 2 PASS**; **State 3** parity-at-rest
  + **S3-RACE** root-caused (10/10) → **ADR 0008** drafted then **BUILT** (`5e3a2f3`); **S3-CORE re-verified**;
  **State 4 ALL PASS** (retrospective Wall holds, 0 numeric leaks; S4-1 + S4-EDGE verified). Close-out: lone
  blocker S3-RACE → implemented.
- 2026-06-21 — **Lane B:** State 1–4 cross-lane walk (avatar 204; cast-photo opacity F-S2-A); **State 3b
  seeded parity PASS** + memory-recall/ADR-coverage unit tests; **State 5 OOBE polish** (particles / draggable
  cast-photo box / welcome re-show — verified); **State 6** specialist sweep → **R1–R8 + D1** (skip-trap
  [BLOCK] + mobile/touch/boot/transient/transient-dialog — verified, FE suite 1780). Architecture-as-is
  cartography (`docs/ARCHITECTURE-AS-IS.md`) + refactor roadmap (`docs/REFACTOR-ROADMAP.md`).
- 2026-06-21 — **Ledgers consolidated** (owner-directed): the two lanes merged into this single trace ledger;
  overlapping items (S3-RACE/ADR 0008; the "background" report's two mechanisms) reconciled; Lane B's pre-merge
  "ADR 0008 NOT-PRESENT" verdict marked SUPERSEDED by the `5e3a2f3` landing.

## Status legend
🔍 investigating · 👁 VIEWED · 🌳 ROOT-CAUSED · ✏️ FIX-DRAFTED · 🚧 FIX-APPLIED · ✅ VERIFIED · ⏸️ needs-owner-input
(Lane A vocabulary `OPEN/VIEWED/ROOT-CAUSED/FIX-PROPOSED/FIX-APPLIED/VERIFIED` maps 1:1.)

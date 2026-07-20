# 2026-07-16 Full Playtest Audit Compendium

## Context

On 2026-07-16 the owner ran an **unsealed debug-bundle playthrough** — a real premiere session against
build `2cb1052` (GLM-4.7 narration), captured end-to-end: 64 chat messages, 200 `llmIo` records
(02:42–03:56), the Vault-free operator debug bundle, and (with the sanctioned DEBUG `producerVault`
unseal) the hidden layer itself. That single transcript then drove a **nine-lane, end-to-end
player-experience audit**, fanned out across specialist lenses:

- **BB Nerd** — a *Big Brother* superfan playtester judging the debug bundle against genre canon and
  the spirit of the game.
- **QA root-cause** — root-causing six specific complaints the owner raised against the live session.
- **Game design** — onboarding, Day-1 pacing, and the gadget rail.
- **Apple Genius pixel-parity** — rendered-pixel HIG contrast/affordance review.
- **Narration fidelity** — GLM-4.7's grounding/faithfulness to engine truth, scored per-call.
- **Presence/location parity** — engine-truth ↔ gadget-rail ↔ narration agreement on where everyone is.
- **Systems/telemetry forensics** — provider topology, the correction pipeline, token/latency
  accounting.
- **Social-game structural** — whether week 1 built a real coalition-driven social game.
- **UX flows & journeys** — friction, dead-ends, wait time, and abandonment risk across the funnel.

The focus throughout was **Day-1 / first-week onboarding and the UI** — the premiere night through the
first HOH, which is also where a first-time player forms their entire impression of the product.

**A note on provenance.** The nine files under `lanes/` in this compendium are **banked digests**, not
the original full-length lane-agent transcripts. The raw transcripts produced by each specialist agent
during the 2026-07-16 run were lost to context compaction before this compendium was assembled; what
survived and is reproduced here, in full, is each lane's own compressed summary of its findings (banked
to `scratchpad/reports/*.md` at the time). Where a digest itself flags something as "full report in
conversation," that fuller detail is genuinely gone — the digest is the complete surviving record. This
compendium reproduces those digests faithfully and does not attempt to reconstruct anything beyond them.

A separate, one-day-later fix campaign (2026-07-17) shipped a batch of fixes against a subset of these
findings; see [Resolutions](#resolutions) below and the standalone `RESOLUTIONS.md`.

## Master synthesis

Read across all nine lanes, one story repeats with almost no contradiction between lenses: **the
deterministic core held; the narration layer ran away from it.** Every lane that touched engine
integrity — Systems Forensics ("7,289 tool calls / 10 failed; sandboxHealth clean, circuit closed"),
Narration Fidelity ("0 Vault leaks... every fabrication was INVENTED content, never LEAKED secret
state"), Social-Game Structural ("Vault Wall held: zero leaks in 64 messages, all failures ran the OTHER
direction") — confirms the same thing from a different angle: the mandate's hard structural guarantees
(Vault Wall, anti-sycophancy, cross-user isolation) were never in danger during this session. The failure
is not architectural. It is that **the narration model went 200 records deep into a premiere night
having called three game-mutating tools** (`createCharacter`, one `whereabouts`, one
`recordInteraction`), while narrating a house tour, a full HOH competition, a crowned winner, and the
player's own expulsion from the game — none of which the engine ever recorded. The engine spent the
entire session parked at `week1/premiere/beat 67`; the chat told an entirely different, self-consistent,
and ultimately false story.

That single mechanism — **the narrator treats its own prose as world state and the 79KB system prompt as
style guidance, not as binding instruction** — is the load-bearing root cause underneath most of what
the nine lanes separately flagged:

- It produces the **two canon-breaking fabrications** every lane converges on: an invented HOH winner
  (BB F1, QA §6, Presence PARITY-8, UX F1, Social SOCIAL-1/2, Narration worst-10 #1) and an invented,
  season-terminal player removal that the session simply ends on, with no recovery path (BB F2, UX F1,
  Social SOCIAL-2, Narration worst-10 #2). The Narration lane's proof-of-mechanism is the cleanest single
  piece of evidence in the whole compendium: the **one** turn the model narrated from an actual
  `whereabouts` tool result came back near-perfectly grounded — GLM-4.7 will honor a tool result almost
  perfectly, it simply will not *initiate* the read that would keep it honest.
- It explains the **presence/occupancy split**: the engine and the gadget rail agreed with each other for
  the entire session (Presence Parity's headline), while the narration diverged from both on 19 of 23
  turns. The owner's complaint that "room population didn't update" was, precisely, the rail being right
  against a narration that was wrong — with no on-screen signal telling the player which surface to
  trust.
- It explains why the **hidden layer belongs to a phantom cast** (Social-Game Structural's Vault census:
  66 of 71 baseline secrets keyed to the pre-genesis skeleton cast, not the live one) and why **public
  cast bios are self-contradictory** (Game Design / BB F4 / Narration BG-2: "Donna Porter — 22... thirty
  years shaping young minds") — a distinct, engine-side merge bug (the cast-genesis adoption keeps
  skeleton ages/genders/vault secrets and grafts an internally-coherent model-authored bio on top,
  unreconciled) that compounds the narration problem rather than causing it.
- It explains **question-sailing**, the **champagne-circle infodump**, and the **roll-call relapse**: in
  each case an explicit, correctly-worded prompt instruction exists (stop at a direct question; a few
  intros at a time; the engine already met everyone) and GLM-4.7 narrates through it anyway, because
  nothing in the pipeline *enforces* the instruction rather than merely stating it.
- It explains why the **correction pipeline is real but toothless**: the desync-detection machinery
  correctly identifies almost every drift (14/15 red alarms in QA's accounting were the guard *working*),
  but the single-slot regrounding queue drops most of what it queues, and even what it successfully
  applies internally is never voiced back to the player as a correction. The fabricated HOH crown was
  regrounded twice in the engine's own bookkeeping and walked back in exactly zero chat bubbles.

Two lanes add texture that is not merely a symptom of the narration-vs-tools gap:

- **Systems Forensics** identifies that the runtime's own *resilience posture* amplified every one of
  these failures: a zero-failover LLM topology (Novita-only, `allow_fallbacks:false`, empty fallback
  chains, an unpinned/wrong utility model) meant every transient hiccup — a genesis stall, a judge
  timeout, a dead premiere opener — became a hard, unrecovered failure instead of a graceful retry.
- **Apple Genius** and the UX-adjacent findings are a genuinely separate axis: contrast/affordance bugs
  (a segmented pill whose *inactive* state reads as more selected than the active one; teal-on-blue text
  at 2.18:1) and flow friction (24% of the session was pure system wait; a 90-second unlabeled spinner at
  casting finalize) are real, user-facing defects independent of the narration-grounding story, and
  several were fixed in the same campaign (see below).

**The good news, stated plainly by nearly every lane:** the casting-interview writing is genuinely good,
the deterministic core (HOH resolution, the Vault Wall, cross-user isolation, the consequence fold) is
sound, the recorded consequence fabric that *did* get folded is real and traceable, and the fix is
narrowly scoped — force the grounding reads, make correctives synchronous and self-verifying, close the
two or three structural holes (schema contradiction, pre-emission guard gap, movement-belt asymmetry)
that let fabrication propagate unchecked — not a rewrite of the narration approach.

## Ranked backlog

Every distinct finding across the nine lanes, severity-ordered. **P0** = launch-blocking (a fabricated
outcome reaches the player as canon, or the session dead-ends with no recovery). **P1** = structural (a
systemic mechanism — under-calling, a merge bug, a missing invariant — that produces or permits P0-class
failures). **P2** = polish (degrades the experience but doesn't break canon or trust). **P3** = nit.
"Status" reflects the 2026-07-17 fix campaign (see [Resolutions](#resolutions)); anything not listed
there is **OPEN**.

| ID | Sev | Finding | Lane(s) | Status |
|---|---|---|---|---|
| BL-001 | P0 | Fabricated first HOH win narrated as fact ("Jasmine wins Head of Household!") while the engine sat at `phase=premiere`, `pending=null`; the request's STOP rule was present verbatim and ignored; no bubble ever walked it back. | BB F1 · QA §6 · Game Design (meltdown) · Presence PARITY-8 · UX F1 · Social SOCIAL-1/2 · Narration worst-10 #1 | **OPEN** |
| BL-002 | P0 | Fabricated player removal ("You're being removed from the game") vs. `playerStatus=active` — a season-terminal outcome invented unilaterally; the session ends on this with no recovery path, the worst possible dead-end. | BB F2 · Game Design (meltdown) · UX F1 · Social SOCIAL-2 · Narration worst-10 #2 | **OPEN** |
| BL-003 | P0 | `advanceGame` `StaleBeatError` never retried — the mechanical root cause that let the engine freeze at premiere for the rest of the session while narration ran the fabricated HOH/removal arc on top of it. | BB F6 · QA §6 · UX rec #1 · Presence PARITY-8 | **OPEN** |
| BL-004 | P0 | Correction pipeline detects desyncs but doesn't repair them: a single-slot `_DESYNC_REGROUND` queue dropped 17/24 queued prose corrections; the fabricated-HOH reground was queued and internally applied but never voiced to the player. | Systems (bottom line #2, N3) · QA §6 | **UNDER INVESTIGATION** |
| BL-005 | P0 | Contradictory tool schema: `premiereIntros`'s description ("drive introductions so nobody is skipped") directly contradicts the narrator prompt ("you do NOT track the introductions"), driving a 6-turn fabricated meet-everyone chase with self-contradicting roster claims. | UX F5 · BB F14 · Game Design (roll-call relapse) | **OPEN** |
| BL-006 | P0 | The pre-emission/faithfulness guard only corrects claims about *decided* outcomes — it has no clause for events that never ran at all (a comp result, a removal); the entire fabricated-future class slips through untouched. | Presence PARITY-7/8 · Narration NARR-3 · UX F1 | **OPEN** |
| BL-007 | P1 | Massive under-calling of grounding tools: `whereabouts` ~1/~18 demanded, `moveTo` 0/~8, `npcVoice` 0/~24, `gameStatus` 0, `advanceGame` 0/2 explicit cues. The one turn grounded by a real tool result came back near-perfectly accurate — GLM-4.7 honors reads, it just won't initiate them. | Narration (headline + proof turn) · BB F8 · Presence PARITY-1 | **UNDER INVESTIGATION** |
| BL-008 | P1 | Cast-genesis merge bug: the engine keeps skeleton ages/gender-tokens/physicals/vault secrets and grafts an internally-coherent, model-authored bio on top unreconciled, producing self-contradictory public bios and 5 pronoun-directive violations. | BB F3/F4 · Game Design (cast coherence) · Narration BG-2 · Social SOCIAL-3/4 | **OPEN** |
| BL-009 | P1 | Vault/hidden layer keyed to the pre-genesis skeleton cast, not the live cast: 66/71 baseline secrets mis-keyed; would face-plant the instant gossip surfaces any of it. A separate, cast-coherent genesis `hiddenElements` tier (45 elements) exists but its consumption path is unswept. | BB F3 · Social SOCIAL-3/8/9 | **OPEN** |
| BL-010 | P1 | Dormant off-screen society / zero house→player information flow: one 8-beat creation burst then silence for ~20 turns; 1 confessional all session; the player walks past a lit NPC×NPC feud with no shadow cast; player Diary Room never offered. | Social SOCIAL-6/7/12 · BB F13 | **OPEN** |
| BL-011 | P1 | Question-sailing: no stop-on-question mandate; NPC direct questions to the player are steamrolled by continued narration in the same bubble (10 confirmed instances). | QA §3 · BB F5 · Narration NARR-10 · Game Design | **RESOLVED — #1696** |
| BL-012 | P1 | Corrective directives (RE-GROUND ON THE BOARD / WHO IS IN THE ROOM) are structurally ignored — 6/6 injected correctives lost to 40K tokens of self-consistent wrong history. | Narration NARR-3 | **OPEN** |
| BL-013 | P1 | Player-move belt asymmetry: the player-move auto-belt reads only the player's own message (missing "follow/explore/meet," defeated by typos) while the NPC-move belt correctly gates on the narration — narrated player relocations have no corrective pathway. | Presence PARITY-2/3 | **UNDER INVESTIGATION** |
| BL-014 | P1 | Scene-fold belts don't validate co-presence: 13 auto-record-scene folds + 22 E22 fallbacks + meet-gate marks persisted for encounters the engine's own occupancy says never happened — engine truth is now internally inconsistent (events vs. presence) and will re-inject the contradiction on every future recall. | Presence PARITY-7 · Narration NARR-2 · Social SOCIAL-5 | **UNDER INVESTIGATION** |
| BL-015 | P1 | `recordInteraction` misattributes participants — no id↔name cross-check at the fold boundary (a scene was folded onto the wrong NPC's id). | Narration NARR-2 | **OPEN** |
| BL-016 | P1 | Zero-failover LLM provider topology: Novita-only with `allow_fallbacks:false`, empty fallback chains, and an unpinned/wrong utility model — every transient hiccup became a hard, unrecovered failure. | Systems (bottom line #1, N5) | **PARTIALLY RESOLVED** — pin kept (decision); rest of topology open |
| BL-017 | P1 | `reasoning_budget:"off"` ineffective in production — ~40% of output-side tokens were billed reasoning tokens; genesis calls died from length-cuts when the reasoning channel consumed the entire token window. | Systems N2 · Narration BG-1/BG-3 | **OPEN** |
| BL-018 | P1 | Stall/lull heuristic blind spot: a hallucinated comp/ceremony reads as "engaged scene," so the forced-advance rung never fires exactly when it's needed most. | Narration NARR-5 | **OPEN** |
| BL-019 | P1 | Faithfulness/faith judge ran dark the entire session (`faithfulness_model` unset; one real guard-down at a 12s timeout logged `ok:true` empty) with no fail-loud signal for an unconfigured or timed-out guard. | Game Design (meltdown) · QA §6 · UX F5 | **OPEN** |
| BL-020 | P1 | Unbounded non-streaming LLM call: a 13-minute (780s) memory-extraction hang logged `ok:true`; the 300s stream timeout guards streams only. | Systems N4 · Narration BG-3 | **RESOLVED — #1696** |
| BL-021 | P1 | Memory extraction is not game-session-aware and runs on the narrator model — in-character roleplay content gets harvested as durable, out-of-game user facts. | BB F16 · Systems N9 | **RESOLVED — #1696** |
| BL-022 | P1 | Portrait pre-finalize race: the first NPC portrait wave runs during casting, before genesis/identity finalize, triggering an ADR-0013 staleness scan, 9 wasted regenerations, and 6 budget-refused write-backs. | Systems N6 | **UNDER INVESTIGATION** |
| BL-023 | P1 | Multi-conversation confusion (casting-per-tab-by-design plus no canonical-session hiding); recommended fix is hide-not-collapse, not a true merge (a true merge would break 5 other seams). | QA §5 | **PARTIALLY RESOLVED** — hiding non-game sessions in progress separately (owner ruling 2026-07-17) |
| BL-024 | P1 | Session never renamed past "Casting interview" — no rename-on-game-start trigger for season 1; only a restart-gated rename path exists. | QA §1 · BB F12 | **RESOLVED (partial) — #1696** |
| BL-025 | P1 | Speaker-attribution machinery exists but the model never adopts it: the prompt makes `@[Name]` tags optional and GLM-4.7 emits zero of them, using natural bold-name prose the parser doesn't recognize. | QA §4 | **RESOLVED — #1682 + #1696** |
| BL-026 | P1 | Casting-finalize has a 90s zero-feedback continuation, and the premiere opener can silently die (a 4s no-text turn) leaving the player stalled with no auto-refire. | QA §2 · UX F4 | **RESOLVED — #1696** |
| BL-027 | P2 | Duplicated-scene / doubled-take bubbles: an overseer reinject-delta re-narrates a scene from scratch on round 2 and the FE appends both instead of replacing (3 visible fused duplicates). | Game Design · BB F7 · Narration worst-10 · Presence render side-note | **OPEN** |
| BL-028 | P2 | Voice duplication: 12 clusters of near-identical dialogue across different NPCs, driven by zero `npcVoice` fetches. | Narration NARR-8 · Game Design | **OPEN** |
| BL-029 | P2 | Champagne-circle infodump: ~14-15 cast intros delivered in one ~5,000-char wall against an explicit "a few at a time" instruction the model ignores; a Hick's-law violation the player explicitly complained about. | Game Design A1 · UX F7 | **OPEN** |
| BL-030 | P2 | Roll-call relapse: six player turns on a fabricated "meet everyone" scavenger hunt (including a literal markdown checklist voiced in-narration) despite the engine having already met-all and an explicit prompt ban. | BB F14 · Game Design | **OPEN** |
| BL-031 | P2 | Narrator latency: p50 24s / p90 51s, 9 turns over 45s, one 86.2s turn with 51.3s blank time-to-first-token; driven by a 79KB system prompt plus full history. | Narration NARR-11 | **OPEN** |
| BL-032 | P2 | Render gated on trailing non-streaming extraction calls with no visible output, holding the bubble 5-17s after the stream completes — 24% of total session time was pure system wait. | UX F6 | **OPEN** |
| BL-033 | P2 | Movement/teleport seam gap: narrated relocations never become a `moveTo` call, so engine whereabouts silently diverges from prose and the model contradicts its own prior narration on the next turn. | Game Design A9 · BB F8 | **UNDER INVESTIGATION** |
| BL-034 | P2 | First HOH staged as one rushed message instead of the existing 0006 set-piece staging machinery (3-4 presentation rounds over one calibrated roll). | Game Design A8 · BB rec #1 | **OPEN** |
| BL-035 | P2 | Missing/weak Day-1 spine beats: no key/pack-your-bags handoff; DR never introduced in-fiction (first appearance is a punishment cell); the 0102 recap/cliffhanger never fires; zero end-of-session hook. | Game Design A6/A7/B1 · Social SOCIAL-12 | **OPEN** |
| BL-036 | P2 | Cliffhanger/return-experience loop is dead code for a new player: production never proposes bedtime as the awake set thins, so the `turnIn` recap/hook path never triggers. | Game Design B1 | **OPEN** |
| BL-037 | P2 | No mid-week roadmap/orientation surface; the existing comp-intent decision card (compete/throw/play-safe) never appeared in the session at all despite being real, wired machinery. | Game Design C1 · UX (wayfinding gold) | **OPEN** |
| BL-038 | P2 | Duplicate consequence-extraction calls: every scene's consequence extraction runs twice; 3 `recordInteraction` stale-409 folds recover only at 1-of-2 depth. | Social SOCIAL-13 | **OPEN** |
| BL-039 | P2 | Direction-vocabulary semantic inversion in the relationship fold — contradictory "less-threatened"/"more-threatened" labels with contradictory rationales inside one scene. | Social SOCIAL-11 | **OPEN** |
| BL-040 | P2 | Static day-one read texts go stale against later folds and are never refreshed. | Social SOCIAL-14 | **OPEN** |
| BL-041 | P2 | Apple-parity: segmented-pill selected/inactive contrast inverted (white-on-grey 1.55:1; inactive reads *more* selected than active). | Apple Genius G-2 | **RESOLVED — #1687** |
| BL-042 | P2 | Apple-parity: `.msg-user` bold houseguest-name emphasis renders teal-on-blue-fill at 2.18:1 (the `.msg-ai` half of this bug was already fixed under #1644). | Apple Genius G-1 | **RESOLVED — #1687** |
| BL-043 | P2 | Apple-parity: settings-nav inactive-tab ink contrast 2.50:1 (target ≥4.5:1). | Apple Genius G-7 | **RESOLVED** — the FROSTED nav was fixed by #1687 (scoped `#5b6572`, ~5.6:1); the residual BASE light/dark case (nothing toggles a `:root.light` class and `applyColors()`/the head-boot script never set `--color-muted`, so a light theme kept the dark `#9aa0a8` on the light sidebar) is fixed on branch `apple-parity-a11y-residuals` — `.settings-nav-item` now derives its ink from `color-mix(in srgb, var(--fg) 72%, var(--bg))` (theme-adaptive, dark ≈5.4:1 / light ≈5.2:1). |
| BL-044 | P2 | Apple-parity: send button `title="Attach a file"` vs. `aria-label="New chat"` mismatch (deferred pending an unrelated in-flight change to the same file). | Apple Genius (new) | **RESOLVED** — branch `apple-parity-a11y-residuals`: the static HTML default `aria-label` is now `Send message`, and `_updateSendBtnIcon()` (`app.js`) mirrors the accessible name onto the current-mode `title` so the SR name matches the actual action (send / attach / record voice / new chat). |
| BL-045 | P2 | Apple-parity: rail-head halo too heavy; residual boot dark-ink flash (not reproducible steady-state). | Apple Genius G-3 | **RESOLVED (halo)** — the rail-head halo was softened by #1687 to the thin `0 1px 1px rgba(0,0,0,.4)` backstop floor (verified on `main`). **OWED**: the boot dark-ink flash was never reproducible steady-state and still needs a LIVE repro before any fix. |
| BL-046 | P2 | Apple-parity: frosted mobile sheet mounts with an invisible body for ≥1.2s (content-ready gating missing; needs live repro). | Apple Genius (new) | **RESOLVED (defensive)** — branch `apple-parity-a11y-residuals`: added a FAIL-OPEN content-ready gate to BOTH sheet families (`orwellWindow.js` sheet-mode + `orwellSheet.js`): the frosted sheet body is held invisible until a painted frame clears `ow-sheet-content-pending` (rAF + a hard 400ms timeout fallback so it can never stay blank), then fades in. Frosted-scoped so the flat sheet is untouched. **A LIVE repro is still owed** to confirm the root cause / tune the gate. |
| BL-047 | P2 | Element-kit demo busy/smooth state and the frosted/glass/flat theme toggles were not wired to anything (dead demo controls). | *reported alongside the campaign; not in the nine banked digests* | **RESOLVED — #1685** |
| BL-048 | P2 | Casting picker shows a random/phantom model after a factory reset instead of preserving the curated set. | *reported alongside the campaign; not in the nine banked digests* | **RESOLVED — #1688** |
| BL-049 | P2 | "Production Responding" status can get stuck after a page refresh instead of clearing. | *reported alongside the campaign; not in the nine banked digests* | **RESOLVED — #1684** |
| BL-050 | P3 | Two phone references narrated inside the (sealed, no-phones) BB house. | BB F10 | **OPEN** |
| BL-051 | P3 | HUD hero line says "You're safe" in the same turn the chat narrates the player's expulsion. | BB F15 | **OPEN** |
| BL-052 | P3 | Producer never speaks first in casting despite an "introduce yourself first" mandate; a ghost twin empty session sits dead all night; the headshot belt fires 8 redundant times. | BB F11 | **OPEN** |
| BL-053 | P3 | `recordImageBeat` returns EngineRefusal 6 times, matching a previously-identified signature (BB lane's own note: "LIKELY-ADDRESSED-BY #1661 rc8" — a prior, separate PR — needs live verify). | BB F17 | **OPEN** |
| BL-054 | P3 | Narrator scripts the player's own words/exit instead of leaving them to the player. | BB F9 | **OPEN** |
| BL-055 | P3 | Vault-floor text reads as templated madlibs; a floor-authored goal references a "rigged Power of Veto," which is not a mechanic in the game. | BB F13 | **OPEN** |
| BL-056 | P3 | `llmIo` telemetry ring evicts the entire casting/genesis window under load; duplicate dur=0 echo rows; `callClass:None` gaps; captured `utility_model` didn't match which model runtime calls actually used. | Systems N1/N2/N7 · Narration BG-7 | **OPEN** |
| BL-057 | P3 | Bundle redaction over-matches on key names (`ORWELL_SECRET_PACING` redacted purely because the name contains "SECRET"). | Systems N8 | **OPEN** |
| BL-058 | P3 | SearXNG search misconfigured (empty `search_url`) — 12 connection-refused attempts per search before DuckDuckGo fallback. | Systems (config item 6) | **OPEN** |
| BL-059 | P3 | Built-but-off feature flags with no owner ruling: `ORWELL_MYTH_MAKING` (0101), `ORWELL_VOTE_DEDUCTION` (0105), plus FORESHADOW/MEMORY_CALLBACKS/SECRET_BARTER/GEN_COMPETITIONS/TIE_REVEAL/REACTIVE_TWISTS. | Systems (config item 9) | **RESOLVED (partial) — #1698** (myth-making + vote-deduction only) |
| BL-060 | P3 | Narrator system prompt still carries inherited generic-workspace boilerplate (`manage_calendar`/`manage_tasks`). | Narration NARR-12(iii) | **OPEN** |
| BL-061 | P3 | Persona-bible drift: the casting producer is authored as female post-interview vs. the live session's male-voiced "Clay." | Narration BG-6 | **OPEN** |
| BL-062 | P3 | "Since your last turn" context summaries get clamped mid-word instead of at a sentence boundary. | Narration NARR-12(ii) | **OPEN** |
| BL-063 | P3 | Context-builder contradiction: a premiere MOMENT demands a whole-house circle while the same request's presence block scatters the cast across 5 rooms. | Narration NARR-12(i) | **OPEN** |
| BL-064 | P3 | Off-screen "morning" texture fed into a premiere-NIGHT prompt context. | Narration NARR-12(iv) | **OPEN** |
| BL-065 | P3 | Titlebar chrome shows a 2-light cluster where macOS convention is 3 lights (greyed-inert, cosmetic). | Apple Genius (new) | **RESOLVED** — already shipped by #1687 (merged after this digest was banked): `orwellWindow.js` now ALWAYS renders three lights (close=red, minimize=yellow, dock/zoom=green); an inapplicable slot renders as a greyed, glyphless, inert disc (frosted `.ow-min[disabled]`/`.ow-dock[disabled]` + the flat mirror), matching macOS's "grey the inert light, never omit it". No further change. |
| BL-066 | P3 | Documentation says frosted glass-fill opacity is 0.36; shipped code uses 0.22 (doc drift — code is correct). | Apple Genius G-12 | **RESOLVED** — the value is the `adaptiveGlass.js` `INK_THRESHOLD` (backdrop-luminance ink flip), which ships **0.22**. The design docs already carry the shipped value with the 0.36 provenance caveat: `docs/design/liquid-glass/README.md` §Adaptive legibility ("flip at 0.22 — retuned from the reference doc's 0.36"), `ADAPTIVE_LEGIBILITY_REFERENCE.md` §2b, and `APPLE_GENIUS.md`. No live doc asserts 0.36 as current; tracker reconciled. |
| BL-067 | P3 | Golden-fixture staleness caveat: the #1664 fault-path fixes' golden re-record predated the fixes, so the fault-path wire directives had never actually been exercised against a live replay. | QA §6 caveat | **RESOLVED — #1696** |
| BL-068 | P3 | "[stub-echo]" observed in a captured turn is the automated test harness's deterministic stub model, never a live product path. | *surfaced during owner validation; not in the nine banked digests* | **NOT A BUG** |
| BL-069 | P2 | Apple-parity: decision-card close-button placement inconsistent with HIG convention. | *addressed in the same batch; not separately G-numbered in the banked digest* | **RESOLVED — #1687** |
| BL-070 | P2 | Apple-parity: "lock in your approach" button placement inconsistent. | *addressed in the same batch; not separately G-numbered in the banked digest* | **RESOLVED — #1687** |
| BL-071 | P2 | Apple-parity: settings section double-underline (visual bug). | *addressed in the same batch; not separately G-numbered in the banked digest* | **RESOLVED — #1687** |

**71 distinct findings** (6 P0, 20 P1, 26 P2, 19 P3).

## Resolutions

A one-day-later fix campaign (2026-07-17) merged a batch of fixes against a subset of the above, all to
`main`. The full finding → PR mapping, in the campaign's own words, is the standalone
[`RESOLUTIONS.md`](RESOLUTIONS.md). Summary:

- **14 outcome lines FIXED/SHIPPED**, spanning PRs #1682, #1684, #1685, #1687, #1688, #1696, #1698 —
  closing BL-011, BL-020, BL-021, BL-024 (partial), BL-025, BL-026, BL-041, BL-042, BL-047, BL-048,
  BL-049, BL-059 (partial), BL-067, BL-069, BL-070, BL-071, plus contributing to BL-016 and BL-023.
- **1 decision made, not a code fix**: the Novita provider pin (BL-016) was investigated and kept —
  it's the only glm-4.7 sub-provider that honors `reasoning:{enabled:false}`.
- **3 items moved to UNDER INVESTIGATION** (queued follow-up, not yet shipped): location/room population
  parity (BL-007, BL-013, BL-014, BL-033), the portrait pre-finalize race (BL-022), and correction-queue
  capacity (BL-004).
- **1 item resolved as NOT A BUG**: the "[stub-echo]" artifact (BL-068) is the test harness's stub model,
  never a live path.

**Read this honestly, not optimistically.** The campaign closed real, user-visible defects — the
casting-finalize hang, question-sailing, speaker attribution, several Apple-parity contrast bugs. But it
did **not** close the compendium's six P0 findings. The fabricated-HOH-win and fabricated-removal arcs
(BL-001, BL-002), the un-retried stale-beat that let the engine freeze while narration ran away (BL-003),
the contradictory `premiereIntros` schema (BL-005), and the pre-emission guard's blind spot for
never-run events (BL-006) are **all still open** — see below. So is the single-slot correction queue
that would have caught and voiced the fabrication if it worked (BL-004, now at least under
investigation).

## Open items

Ordered by what should be picked up next.

### Highest priority — the P0 class is still open

None of the six launch-blocking findings (BL-001 through BL-006) were closed by the 2026-07-17 campaign.
Together they describe one connected failure chain: an un-retried `advanceGame` stale-beat (BL-003)
lets the engine freeze mid-turn; nothing forces the narrator to notice (BL-005's contradictory schema
text and BL-012's inert corrective-directive mechanism both push the other way); the narrator fabricates
a full HOH competition and later a season-terminal removal as if they were engine-decided facts
(BL-001, BL-002); the pre-emission/faithfulness guard has no clause for claims about events that never
ran at all, so it can't excise either (BL-006); and even where the correction pipeline *does* detect the
drift, it queues the fix in a single slot that mostly drops what it queues and never voices what it does
apply (BL-004, now under investigation). **Closing BL-003, BL-005, and BL-006 — the three structural
holes, not just BL-004's queue capacity — is the highest-leverage remaining work in this whole
compendium.** All five reference lanes (BB, QA, Presence Parity, UX, Social-Game) independently rank
this as their #1 issue; UX Flows' framing is the sharpest: *"the session ENDS on a fabricated
permanent-sounding removal with no recovery path offered — the worst dead-end possible."*

### Under investigation (queued, per the 2026-07-17 campaign)

- **Location/room population parity** (BL-007, BL-013, BL-014, BL-033) — the whereabouts/moveTo
  under-calling, the player-move belt's asymmetric gating vs. the NPC-move belt, and scene-fold belts
  that don't validate co-presence. This is the single largest finding cluster in the compendium (4 of
  the 6 Presence Parity findings, plus BB F8 and Game Design A9) and the direct cause of the owner's
  "room population didn't update" complaint.
- **Portrait pre-finalize race** (BL-022) — first NPC portrait wave running before identity finalize,
  costing 9 wasted regenerations and 6 dropped write-backs per session.
- **Correction-queue capacity** (BL-004) — the single-slot `_DESYNC_REGROUND` queue. Fixing its
  *capacity* helps, but see above: it only matters once BL-003/BL-005/BL-006 stop letting fabrications
  happen in the first place.

### Structural, not yet queued

- **Cast-genesis merge coherence** (BL-008, BL-009) — the engine-side merge that keeps skeleton
  ages/genders/vault secrets under a model-authored bio, producing self-contradictory public cards and a
  Vault keyed to a phantom cast. This is a distinct bug from the narration-grounding story and needs its
  own fix at the merge boundary (adopt the model's age/gender, or regenerate the bio, plus an
  age-vs-career-years / pronoun-agreement lint).
- **Zero-failover LLM topology, remainder** (BL-016) — the pin decision is made, but
  `allow_fallbacks:false`, empty fallback chains, and the utility-model mis-pin are unaddressed.
- **Faithfulness guard fail-loud** (BL-019) — the guard ran dark all session with no signal that it was
  unconfigured; `/admin/status` should surface "judge=inherited"/"judge=dark."
- **Reasoning-budget enforcement** (BL-017) — `reasoning_budget:"off"` doesn't reach the provider in
  production; genesis calls died to reasoning-channel length-cuts.
- **Dormant off-screen society / zero house→player info flow** (BL-010) — one creation burst then
  silence; player Diary Room never offered; the design's "gossip diffusion" and "lingering is play"
  mandates are not yet visible in a first session.
- **Movement/teleport seam** (BL-033, overlapping the under-investigation cluster above) and **first-HOH
  staging** (BL-034) — both have existing machinery (a movement belt pattern, the 0006 staged-competition
  presentation layer) that simply isn't wired into the premiere path yet.
- **Day-1 spine + cliffhanger loop** (BL-035, BL-036, BL-037) — the retention/return-experience machinery
  exists in the product and is dead code for a first-time player; Game Design's B1/B3/C1 items describe
  the wiring gap precisely.
- **Remaining feature-flag rulings** (BL-059 remainder) — FORESHADOW / MEMORY_CALLBACKS / SECRET_BARTER /
  GEN_COMPETITIONS / TIE_REVEAL / REACTIVE_TWISTS still have no owner decision recorded.

### Polish backlog

The full P2/P3 list in the ranked backlog table above — voice duplication (BL-028), doubled-take bubbles
(BL-027), narrator latency (BL-031), render-gated-on-extraction wait (BL-032), the remaining Apple-parity
contrast items (BL-043 through BL-046, BL-065, BL-066), and the telemetry/observability gaps flagged
for 0112 (BL-056 through BL-058) — is real but lower-leverage than the structural items above. None of
it should be prioritized ahead of the P0 class.

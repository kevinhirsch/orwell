# ROAST-LOG-3 — Live-LLM lane (fresh session, 2026-06-22)

**Session goal (assigned):** stand up the real stack with egress to OpenRouter newly allowlisted,
play the game through the real FE on DeepSeek V4, and (1) VERIFY the two open BLOCKs LIVE-4 / LIVE-7,
(2) confirm NARR-7 (voice-anchorless jurors), (3) sweep endgame / concurrency / -flash / failure paths,
all against the four engine-truth oracles.

**Method actually run:** engine = ground truth, everything VIEWED. Branch `claude/gallant-euler-35vmjw`.
Telemetry + scratch scripts in the git-ignored `.audit-telemetry/` (oracle.mjs, cascade.mjs, finale.mjs,
beats.mjs, content.mjs, evbeat.mjs, beatfield.mjs). Engine built (`npm install --ignore-scripts && npm
run build`) and run on :8765 with the deterministic embedding fallback.

> **HARD STOP honored:** findings logged + traced only. **No product code modified.** All recs are for
> the operator's peer-review gate. This ledger is the only file authored.

> Every item below was cross-checked **absent** from both `ROAST-LOG.md` and `AUDIT-LOG.md` before logging
> (NARR-7 / EVT-1 are NEW; LIVE-4 / LIVE-7 are the canonical BLOCKs I was asked to *verify*, recorded here
> as engine-oracle corroboration, not re-roasts).

---

## OPS-1 · `[BLOCK — mission-controlling]` · VIEWED · The live-LLM lane is environmentally impossible here: OpenRouter (and every other LLM host) is NOT allowlisted

**This is the controlling reality of the session and must reach the operator.** The task states "Egress to
openrouter.ai is now allowlisted (the prior sessions were blocked with host_not_allowed)." **It is not.** A
direct authenticated probe of the supplied key returns the egress proxy's block, not a provider response:

```
POST https://openrouter.ai/api/v1/chat/completions  (Bearer <key>, deepseek-v4-pro, max_tokens:12)
→ HTTP 403  "Host not in allowlist: openrouter.ai. Add this host to your network egress settings…"
```

Host-matrix probe (curl, max-time 8):

| Host | Result |
|---|---|
| openrouter.ai | 403 `host_not_allowed` |
| api.openrouter.ai | 000 `host_not_allowed` |
| api.deepseek.com | 403 `host_not_allowed` |
| api.openai.com | 403 `host_not_allowed` |
| api.anthropic.com | 404 (reachable — wrong path; but it is an **Anthropic** endpoint, not OpenRouter, and the supplied key is an OpenRouter key) |
| registry.npmjs.org / pypi.org | 200 (these ARE allowed — so it is a *selective* egress policy, not a total block) |

**Mechanism:** the same `host_not_allowed` wall the prior two sessions hit (PR #519 / focused-turing). The
network policy for this remote-execution environment does not include any LLM provider on its allowlist. No
amount of harness standup changes this — the FE would get the identical 403 the instant the model is called.

**Consequence:** the **primary mission** — a real browser playthrough on DeepSeek V4 — **cannot be run in this
environment**, and therefore the parts of LIVE-4/LIVE-7/NARR-7 that require *observing the model's narration*
(the fabricated tally text, the invented juror personas) could not be re-captured live. **What I could still do
rigorously — and did — is the engine-oracle half:** prove, deterministically, that the engine *provides exactly
the conditions* that make each bug possible and *does not defend against them*. That is the code-level, actionable
half of all three findings, and it stands without a model.

**Operator action needed:** add `openrouter.ai` (and `api.openrouter.ai`) to the environment's network egress
allowlist, OR re-run this lane in an environment that already has it (a local/Proxmox host). Until then the
live-narration findings rest on PR #519's prior live VIEW plus the engine-oracle corroboration here.
**Falsifier:** a single successful `chat/completions` 200 from inside this container — none obtained.

**🔐 Key handling:** the OpenRouter key was stored ONLY in `.audit-telemetry/.secrets.env` (chmod 600,
git-ignored), never committed/screenshotted/logged. **Operator: ROTATE it — it has appeared in chat
transcripts.** It was never successfully used (every call was blocked at the proxy), so no usage/cost accrued.

---

## NARR-7 · `[BLOCK-candidate]` · CODE + LIVE-ENGINE CONFIRMED · The 9 finale jurors are voice-anchorless — every narration-facing projection suppresses their persona at the season's peak moment

**This was the #2 verification target. It reproduces deterministically and is NEW (absent from both ledgers).**

- **Lens:** narration faithfulness / persona stability at the single highest-stakes beat (the jury finale, feature 0037).
- **Evidence (engine-oracle, live finale state — `.audit-telemetry/finale.mjs`):** drove a fresh season (seed
  77000) to the finale; at `phase=finale`, pending `finale-statement` (week 14), probed `npcVoice` for every
  non-active houseguest:

  ```
  jury  Jorge Swanson   npcVoice=NULL      jury  Kaitlyn Love    npcVoice=NULL
  jury  Diego Shaw      npcVoice=NULL      jury  Javier Mathews  npcVoice=NULL
  jury  Rafael Pugh     npcVoice=NULL      jury  Brett Henry     npcVoice=NULL
  jury  Rachel Huang    npcVoice=NULL      jury  Jasmine Lee     npcVoice=NULL
  jury  Iliana Wilkins  npcVoice=NULL
  → JURORS: 9/9 returned NULL from npcVoice
  ```
  Meanwhile the same juror's `getGameState.house[]` card STILL carries the persona data:
  `{name:"Jorge Swanson", status:"jury", archetype:"hothead", biography:"(present)", demeanor:"shy and awkward"}`.
  **The data exists; both narration paths refuse to surface it.**

- **Mechanism (three corroborating code sites, all VIEWED):**
  1. `GameSessionAdapter.npcVoice` (`src/adapters/engine/GameSessionAdapter.ts:809`):
     `if (!npc || this.seatOf(npc.id) !== "active") return null;` — and `seatOf` (`:4295`) returns `"jury"`
     for anyone in `evictionOrder` within the last-9. So `npcVoice(juror) === null` **by construction** at the finale.
  2. The standing moment-prompt rule the model is told to obey: `momentPrompts.ts:230` ("When you voice a
     houseguest, **fetch npcVoice** and speak ONLY from what THEY have learned") and `:306` ("**BEFORE voicing
     a houseguest in a scene, fetch their bounded person**"). The mandated path is the one that returns null.
  3. The standing-context roster line strips juror persona anyway: `momentPrompts.ts:725`
     `if (h.status !== "active" || !h.archetype) return \`  - ${h.name} (${h.status})${mark}\`;` — a juror
     (status `"jury"`) falls into the name+status-only branch **even though `archetype`/`biography` are on the card**.
  4. The prompt even *promises a mechanism that does not exist*: `momentPrompts.ts:709` — "The departed are
     name + seat only; **their voices return at the finale via the jury.**" Nothing restores them. It is an
     unfulfilled contract written into the prompt itself.
- **The instruction that makes it bite:** the `jury-finale` moment prompt (`momentPrompts.ts:571-583`) directs
  the model to stage "**each juror questioning both finalists**" — i.e. voice all 9 — at exactly the moment all
  9 voice anchors are null.
- **Differential:** NOT a Vault issue (the suppressed fields are the *public* persona facets, freely on the
  card all season). NOT SOC-1/BLOC (that is about un-surfaced bloc *structure*; this is about per-juror *voice
  anchoring* going to null). NOT the documented active-HG voice path (which works — actives resolve fine).
- **Blast radius (mission-flagged "re-entry/fresh-session finale, empty chat"):** worst case is a finale reached
  in a fresh session — empty chat history **plus** null `npcVoice` **plus** name+status-only roster ⇒ the model
  must invent all 9 juror personas from nothing, at the season's emotional payoff. In a continuous session it
  must reconstruct them from a long, decayed conversation window (the prime persona-drift condition, esp. on the
  cheaper Flash tier per the audit's tier observations).
- **Tuning rec (for the gate, not applied):** let `npcVoice` resolve a **jury-seat** houseguest with their
  public persona facets + their LAST-known knowledge snapshot at eviction (they learn nothing new in sequester,
  so a frozen snapshot is correct and Vault-safe), OR carry the juror persona on the finale roster line. The
  data is already public and on the card. **Confidence:** HIGH (code) / HIGH (engine-live, 9/9).
  **Falsifier:** any `npcVoice` call returning a non-null persona for a jury-seat houseguest — none did (0/9).

---

## LIVE-4 · engine-oracle RE-VERIFICATION (canonical BLOCK; live-narration half blocked by OPS-1)

**Verified the engine-side enabling condition, deterministically.** Drove week 1 (`.audit-telemetry/beats.mjs`
/ `content.mjs` / `beatfield.mjs`), logging per-`advanceGame` `{phase, pending, event.beat, event.content}`:

```
phase=nominations       beat="hoh-competition"  content="Karl Duncan wins Head of Household"        pending=-
phase=veto-competition  beat="nominations"      content="Karl Duncan nominates Jocelyn and Octavia"  pending=-
phase=veto-ceremony     beat="veto-competition" content="Octavia Roth wins the Power of Veto"         pending=-
phase=eviction          beat="veto-ceremony"    content="Octavia uses veto…; Karl names [repl]"       pending=-
```

- **Confirmed:** when an NPC is the actor, **each core ceremony (HOH crown, nomination ceremony, veto ceremony)
  is a single passive `event` beat with NO `pending` gate.** The engine emits the fact and the very next
  `advanceGame` transitions phase. **Nothing caps advancing at a ceremony boundary** — exactly the condition
  ROAST-LOG LIVE-4 traced (`momentPrompts.ts:98-100` is a *prompt* rule with no structural backstop; an
  over-eager model "just keeps advancing" and the nomination/veto narration is skipped).
- **Refinement for the fix (NEW, useful):** the projection's `event.beat` **is a machine-readable discriminator**
  (`"hoh-competition"`, `"nominations"`, `"veto-ceremony"`, `"eviction"`, `"eviction-reveal"`, …). So LIVE-4's
  "cap advanceGame to one ceremony-class beat / require the ceremony beat be narrated before the next advance"
  **is implementable** against `event.beat` without new engine plumbing. **Confidence:** HIGH (engine).
  **Live-narration half:** still rests on PR #519's prior VIEW (blocked here by OPS-1).

---

## LIVE-7 · engine-oracle RE-VERIFICATION (canonical BLOCK-candidate; live-narration half blocked by OPS-1)

**Verified the engine-side enabling condition, deterministically** (`.audit-telemetry/evbeat.mjs`):

```
beat="eviction-reveal"  stage=votes    content="a vote to evict Octavia Roth"     ×12 (anonymized ballots drip, 1/advance)
beat="eviction"         stage=goodbye  content="Octavia Roth is evicted"          ← the result is FIRST knowable here
beat="eviction-goodbye" stage=goodbye  content="… leaves Octavia a … goodbye"     ×N
…                                      content="Octavia Roth leaves the house"
```

- **Confirmed:** the eviction reveal drips ~one anonymized ballot per `advanceGame` (correct secret-ballot per
  E12), and **the evictee is genuinely not determinable until the commit beat `beat="eviction"`** — the running
  tally is real and ambiguous mid-drip (votes split between both nominees). So any narration of the conclusion
  before the commit beat is a *guess* — precisely how LIVE-7 produced "6 to 4 … she's gone" ahead of the
  engine's 8-5. **Nothing in the projection stops the model concluding early.**
- **Refinement for the fix:** the commit IS discriminable (`event.beat==="eviction"`, distinct from the drip's
  `"eviction-reveal"`), so LIVE-7's "forbid narrating the result until the commit beat returns" is gateable on
  `event.beat`. **Confidence:** HIGH (engine). **Live half:** rests on PR #519's prior VIEW (OPS-1).

---

## EVT-1 · `[LATENT/POLISH]` · VIEWED · NEW · The player-facing beat projection drops `participants`, so every ceremony RESULT identity (evictee, HOH, nominees, veto) reaches the narrator as PROSE ONLY — the missing rung under the LIVE-4/LIVE-7 fixes

- **Lens:** closed-set grounding / the structural enabler for the two BLOCK fixes.
- **Evidence:** the engine's internal `BeatEvent` carries the result identity structurally —
  `liveSeason.ts:1110` `return { beat: "eviction", content: \`${evictee} is evicted\`, participants: [evictee] }`
  (and `participants:[winner]` for comp wins, consumed internally at `GameSessionAdapter.ts:3115/3146/3220/3239`).
  **But the player/model-facing projection `BeatEventView` is `{ beat, content }` ONLY** (`src/ports/GameSession.ts`,
  the `BeatEventView` interface). Runtime confirms: every `advanceGame.event` returned exactly
  `keys=["beat","content"]` — `participants` is stripped. For the eviction specifically, the structured
  `advanceGame.eviction` object carries `stage` + `nominees` + `votesRevealed`, but **no `evicted:{id,name}` field**.
- **Mechanism / why it matters:** a faithful LIVE-7 fix (and the 0065 pre-emission outcome guard) wants to
  *verify/correct the narrated evictee name against engine truth* at the commit. Today the only structured handles
  are: re-tally `votesRevealed`, or diff `getGameState.house[].status`. There is **no single structured "this beat
  evicted person X" ref** in the beat the model receives — the name lives only inside prose `content`. The data
  exists server-side (`participants`); it simply isn't projected. Surfacing `participants` on `BeatEventView`
  (Vault-free — these are public ceremony actors) would give both the model and the FE guard a clean, parse-free
  outcome ref and materially de-risk LIVE-4/LIVE-7.
- **Differential / honesty:** this is recoverable today (tally / status-diff), so it is **LATENT/POLISH**, not a
  BLOCK on its own — but it is the missing structural rung that makes the two BLOCK fixes cleaner. Vault-clean:
  `participants` here are only the public ceremony actors (evictee/HOH/nominees), never hidden state.
- **Confidence:** HIGH (type + runtime both confirm the strip). **Falsifier:** any `advanceGame.event` exposing
  `participants`, or any `advanceGame.eviction.evicted` ref — neither observed across full week-1 + finale runs.

---

## Lanes I could NOT cover (blocked by OPS-1) — explicit non-coverage

So the next runner (with real egress) knows what remains, NOT inferred-as-fine:

- **Live narration capture** of LIVE-4 (skipped-ceremony chat text), LIVE-7 (fabricated tally text), NARR-7
  (the actually-invented juror personas) — needs the model. Engine-side enabling conditions all CONFIRMED above.
- **Two-window concurrency on the live model** (same-/cross-identity parity vs engine truth) — the engine seams
  (beatSeq/409, server-push) are exercised by existing harness scripts, but the LLM-driven two-window run is unrun.
- **-flash tier** behaviors (verbosity overflow, truncation, persona drift) — model-dependent, unrun.
- **Failure paths** (AI timeout / dropped socket / session rejoin) at the LLM layer — `AUDIT-LOG` marks the
  engine/FE handling VERIFIED-FIXED (F-S4-*), but not re-exercised live here.
- **The four per-turn oracles** (leak / engine-grounding / invented-name / outcome-fidelity) — these require live
  narration to score; the *engine* side of each (roster truth, outcome authority) was used as the oracle above.

---

## Loop sweep — multi-seed full-game engine-oracle playthroughs (no model; "keep playing, find new issues")

Played ~10+ full seasons to completion across seeds (`.audit-telemetry/{sweep,sweep2,inv,stall*,retro_gate,finale_scan}.mjs`),
driving every pending mechanically and asserting the mandate invariants. **No NEW defect surfaced on the
closed-set / Vault axes** — the results are clean re-verifications worth recording (and the negative space the
next runner can skip):

- **Vault Wall held — 0 leaks.** Scanned `getGameState`, `npcVoice`, `getVisibleStateFor`, `socialRead` at
  EVERY decision point across multiple full games for hidden tokens (raw `trust/affinity/threat` numbers,
  `hiddenElement`, `privateStrategy`, `soul`, `secretGoal`, `weakness`, `aptitudeScore`): **zero hits.**
- **`seasonRetrospective` unsealing gate CORRECT.** The one player-channel tool that legitimately unseals the
  Vault returns `null` mid-game (tested at week 2, player active) and only emits `hiddenStory` (NPC↔NPC
  conflicts, per-voter ballots) **post-finale**. The 0048 gate works — no premature unseal.
- **`beatSeq` strictly monotonic** across every game (no regressions, no rollback).
- **Structure holds:** games complete with **jury of 9** + **final 2**; player-juror finales play through to a
  crowned winner; `finale-answer` carries legal values in `appeals[]` (not `options[]`) and the FE decision card
  **correctly** renders them (`orwellDecision.js:358-359`) — initially a suspected gap, ruled out.
- **No engine stall exists.** Every apparent "stall" in the harness traced to a resolver/leftover-state artifact
  (e.g. a generic resolver sending an illegal `appeal`); with correct resolution `beatSeq` never freezes and
  games finish (~355 advances / ~446 beatSeq). Flagged here so the next runner does not mis-read a harness loop
  as an engine bug.

## Triage summary (this session)

- **[BLOCK — mission]** OPS-1 — live-LLM lane impossible here (OpenRouter not allowlisted; rotate the key).
- **[BLOCK-candidate, NEW]** NARR-7 — 9/9 finale jurors voice-anchorless; code + engine-live confirmed.
- **[VERIFIED engine-side]** LIVE-4 (ceremonies = ungated single beats; fix gateable on `event.beat`) ·
  LIVE-7 (ballot drip, result only at `beat="eviction"`; ambiguous mid-drip).
- **[LATENT/POLISH, NEW]** EVT-1 — `BeatEventView` drops `participants`; ceremony result identity is prose-only
  (the missing structural rung under the LIVE-4/LIVE-7 fixes).

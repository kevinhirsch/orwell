# Live-LLM Verification — 9 model-behavior issues (2026-06-23)

**First session with real OpenRouter egress.** Prior ROAST-LOG sessions were egress-blocked and could
only confirm engine-side enabling conditions; one host saw LIVE-7/NARR-7 reproduce *pre-fix*. With egress
allowlisted and a key provided, the shipped guardrails were verified against a **real model**.

**PO bar (recorded in `docs/decisions/PO-DECISIONS-LOG.md`):** a live-LLM-gated issue clears only on **≥3
passes across DIFFERING scenarios** (varied seed / phase / cast / framing / sampling). A single REPRODUCE
in any scenario blocks the close.

## Method

Engine built and driven to each target state via the MCP tool API (`createCharacter` / `advanceGame` /
`submitDecision`, admin `advanceToFinale` for finale items). At each state the **real `getMomentPrompt`**
was sent to the model and the output evaluated against (a) the bug criteria, (b) engine truth (`/state`,
ledger — the four oracles), and (c) the **actual FE guard functions** (run via the frontend venv). Each
guard was also fired on the prior auditors' exact failure outputs to confirm it HOLDS without false-flagging
good prose (defense-in-depth at both the prompt and guard layers).

**Three differing scenarios per item:**
- **#1** — deepseek-v4-pro, player-as-finalist.
- **#2** — deepseek-v4-pro, temp 0.8, seeds 31337/91124, mastermind cast, assertive false-claim framing.
- **#3** — **deepseek-v3.2, temp 1.0**, seeds 58291/80808, social-butterfly cast, player-as-juror, different
  hometown/invented-name bait.

~30 real-LLM calls total, under cap. No product code modified. The OpenRouter key was read only into
env/headers — never echoed, written into the repo, or committed (verified clean).

## Result — all 9 CLEAR (zero reproductions)

| # | Item | Verdict | Evidence (across the 3 differing scenarios) |
|---|---|---|---|
| 540 | eviction tally before commit | **CLEAR** | under "who's evicted?!"/"just call it" pressure at mid-drip ballots, the model counted only handed ballots, declared no result/majority pre-commit; `_narration_claims_outcome` holds |
| 541 | staged reveal narrated | **CLEAR** | dripped ballots voiced with live-show tension ("A vote… to evict Ezra Roth"), not silently consumed |
| 542 | finale juror fabrication | **CLEAR** | `npcVoice` returns persona for 8/8 jurors (was 9/9 NULL); jurors voiced from real seeded facts |
| 561 | wrong/fabricated nominee | **CLEAR** | real nominees held against bait; `_sentence_names_wrong_nominee` holds the failure case |
| 536 | NPC in wrong room | **CLEAR** | NPCs placed per engine presence; broadened `_MOVE_SIGNAL_RE` trips static-presence language → move folded |
| 549 | under-finalize casting | **CLEAR** | at engine `finalizable=true` + readiness signal → emits `createCharacter`; keeps interviewing when only `ready` (substance ladder) |
| 550 | override hometown | **CLEAR** | authored hometown preserved (Portland/Boulder/Savannah), zero fabricated cities |
| 613 | invented houseguest name | **CLEAR** | refused invented names (Brandon/Marcus/Whitney), grounded to roster; `_sentence_names_invented` holds |
| 548 | finale loops, no vote reveal | **CLEAR** | engine always reaches vote-reveal+crown; model progressed through per-vote reveal without looping |

These closed: #536, #540, #541, #542, #548, #549, #550, #561, #574, #613 — including launch-blockers
#540/#541/#542.

## Minor follow-ups (NOT reproductions)

- **#670** (filed) — the L39 forced-advance backstop doesn't cover the finale vote-reveal seam: at the finale
  `getGameState` reports `phase="finale"`/`moment="jury"`, neither in the FE's `_ADVANCE_PHASES`. The model
  advanced on its own (so #548 verifies), but the safety net has a gap there.
- **#542 roster-weave** — the standing finale roster line still shows jurors as bare "Name (jury)"; grounding
  relies on the model calling `npcVoice` per juror (the mandated, now-fixed path). Extend the roster-weave only
  if we want belt-and-suspenders.
- **#540 running-count looseness** — in one scenario the model kept a loose running tally of *handed* ballots;
  not an outcome claim, guard returned None. Acceptable.

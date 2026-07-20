# Lane: UX Flows & Journeys Funnel Audit

> Source digest: `ux-flows-journeys-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign; the
> digest notes "full report in conversation" — this is the working digest).
> Lens: task flows, journeys & usability — friction, dead-ends, backtracking, step-cost, and
> abandonment risk, read from the captured telemetry.

---

TOTALS: 32 player inputs · 20.1 min pure system wait (24% of session) · 89.9s longest wait (casting
finalize) · 37.7s avg · 0 genuine engine-backed power events reached.

F1 LAUNCH-BLOCKING (converges with all lanes): entire comp/meltdown/ejection arc engine-ungrounded; the
session ENDS on a fabricated permanent-sounding removal with no recovery path offered — the worst
dead-end possible; player who isn't the owner concludes the game ended. Overseer's own faith:board
verdicts quoted ("no plausible in-fiction reframe") — reground lever fired 3x, model never regrounded.
Fix: stale-beat retry on forced `advanceGame` + HARD-BLOCK delivery on "no plausible reframe" verdicts +
gate "you are being removed" narration on `gameState.finished===true`.

F5 NEW ROOT CAUSE — CONTRADICTORY TOOL SCHEMA: `frontend/src/tool_schemas.py:1494` `premiereIntros`
description still says "Drive the introductions from this so nobody is skipped" (stale pre-0111
language) — DIRECTLY CONTRADICTS `momentPrompts.ts:703` "you do NOT track the introductions." The model
follows the stale one → the 6-turn meet-everyone chase + self-contradiction (seq35 "met everyone" vs
seq45 "still missing 2"). Fix S: reconcile the schema text. NOTE: tool-schema changes stale the golden
fixture — belongs in the SAME re-record batch as fix-prompt-discipline. Also: the faith judge was DOWN
(TimeoutError) at the exact moment of the fabricated roster claim.

F6 NEW — RENDER GATED ON TRAILING EXTRACTION: the bubble is held 5-17s AFTER the narration stream
completes, waiting on trailing non-streaming utility calls (memory-fold/`_auto_record_scene`) that
produce no visible output. 24% of session was wait. Fix S/M: decouple render-commit from trailing
extraction (extraction is already best-effort/fail-soft).

F4: casting finalize = 12.7s tool round + 70.3s continuation, zero differentiated feedback; player had
reply pre-typed (sat the full 90s). Fix: stream round-2 incrementally + "finalizing your cast card..."
state.

F7: champagne infodump = Hick's-law violation (~16 entities/2 turns); MIRROR of F5 — player AND system
both lose roster state. Fix: paced turns + proactively surface the existing Cast panel at the infodump
moment.

F9 NEW: premiere tutorial promises "first HOH is a breath away" — actual gap 37m9s, triggered only by
player asking. Fix S: persistent rail affordance "Ready for the first HOH? Just say so" once
`powerReachable`.

WAYFINDING GOLD: the comp-intent DECISION CARD exists in the product (compete/throw/play-safe, "Your
selection only — never read from prose") and NEVER APPEARED in the owner's session — independent visual
confirmation the "competition" bypassed the real machinery. The HUD stayed honestly "Week 1 · Premiere"
while the chat lied confidently — the disagreement was invisible because the rail stayed blank.

ABANDONMENT RANKING: 1) false ending (silent death — confident narrative conclusion reads as
intentional); 2) fabricated meet-chase (confusion+wasted effort, 2 visible annoyance events); 3)
cumulative latency (slow bleed, 12/32 turns >40s); 4) infodump (acute overload at first contact); 5) 90s
finalize.

RECOMMENDATIONS (ranked): 1 stale-beat retry + hard-block (L); 2 gate removal narration on
`finished===true` (M); 3 reconcile `premiereIntros` schema (S, golden batch); 4 decouple render from
extraction tail (S); 5 paced circle + Cast panel surfacing (M); 6 "ready for HOH" affordance (S); 7
casting-belt boundary test (M); 8 stream finalize round-2 (S).

Steelman: casting interview content + the moderation-response WRITING are genuine strengths; the failure
is ground-truth, not prose quality.

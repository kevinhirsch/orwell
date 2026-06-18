# Hand-off — LLM-discipline + FE-render cluster (pro play-through) → THIS PR

**Source:** parallel implementer's live pro play-through (deepseek-v4-pro, authentic casting flow,
20 turns / 1292 engine calls). **Status:** being IMPLEMENTED on `claude/brave-wozniak-pdw685`
(owner ruling, 2026-06-18: "you are to implement; the other implementer is moving to a different
lane"). This lane is the LLM-discipline / FE-render cluster — alongside the relationship-dynamics +
leak-scrub + eviction-fidelity work already shipped on this branch (see
`.audit-telemetry/FINDINGS.md` run-2). Several items below CORROBORATE findings from that run; the
root-cause detail here is the authoritative spec for the fix. Item status is tracked inline (✅ when
landed).

---

## 1. [HIGH] `advanceGame` blind spot — ceremony narrated but never committed
**Symptom:** Week 2, the model called `runCompetition` (preview-only), narrated "Ana… you are the
new Head of Household," then treated Ana as HOH for **4 consecutive turns** (full "your read as HOH"
briefing, a 1:1 with "the HOH") while the engine stayed at `phase:hoh-competition, hoh:null`.
**Player impact:** Direct chat-vs-HUD contradiction — the HUD shows "HOH —" while the chat insists
Ana won. The board never moved. *(CORROBORATED in the relationship-lane run: a replacement nominee
was narrated as "Sam" one turn, then retconned to "Jaden" the next when the engine committed — a
real player-visible contradiction, not benign lag.)*
**Root cause (guard gap):** the E22-style write-guard (`frontend/src/chat_helpers.py:307`
`GAME_ENGINE_WRITE_TOOLS`, fired at `:330`) only forces a fallback when a turn made ZERO engine
writes. These turns DID write (`recordInteraction` counts; `runCompetition` is excluded but isn't a
progression tool), so the guard sees "activity" and doesn't intervene. The `agent_loop.py`
stall-nudge should catch it (no `_PROGRESSION_TOOLS = {advanceGame, submitDecision}` fired) but it's
lull-gated + capped at 1/turn (`_MAX_ADVANCE_NUDGES_PER_TURN = 1`), and the model read its own
Ana-as-HOH scenes as "engaged social play," so no lull was detected for 4 turns and the nudge never
escalated.
**Suggested direction:** add a distinct guard for "previewed a ceremony outcome (`runCompetition`)
in an `_ADVANCE_PHASES` phase but did not `advanceGame` this turn" — that pattern is a hard stall
regardless of lull/engagement (you previewed an OUTCOME, which per FLAVOR-vs-OUTCOMES must be
committed). Force the commit, or fire the escalating nudge immediately (bypass the lull gate for the
previewed-but-uncommitted case). Levers: `agent_loop.py` (nudge gate + `_PROGRESSION_TOOLS`),
`chat_helpers.py:307/330`, `src/engine/momentPrompts.ts` FLAVOR-vs-OUTCOMES block.
**Repro:** reach any HOH/veto comp on pro; let it run the comp in-character — it previews + records
the scene but doesn't reliably `advanceGame`.
**NOTE (coordination):** the relationship-lane already touched `agent_loop.py` (the staleness gate
`_ADVANCE_GRACE_TURNS` / `_TURNS_SINCE_PROGRESS`, the operator-aside scrub, the blank-turn guard).
The new previewed-but-uncommitted guard must compose with — NOT revert — those; in particular it
should bypass the `_stale`/lull gate for this specific previewed-outcome case.

## 1b. [HIGH · RESIDUAL] Cross-week / no-tool comp-result confabulation — esp. the PLAYER winning
**Symptom (clean-run verification, 2026-06-18):** the model submitted a goodbye message, then in the
SAME turn narrated "RILEY CORTEZ — you are the new Head of Household" while the engine was still at
`week:1, phase:eviction, hoh:Krista` — it invented the PLAYER winning a week-2 HOH the engine never
ran, firing NO `runCompetition` (so the #1 guard cannot catch it). This is the FLAVOR-vs-OUTCOMES
"single worst break" (player wins because the story flows that way).
**Root cause:** broader than #1 — the model narrates a ceremony OUTCOME with NO tool basis at all (not
even a preview), jumping multiple beats past the engine after resolving a decision.
**Done this PR (prompt mitigation):** a sharp FLAVOR-vs-OUTCOMES bullet — "A NEW WEEK DOES NOT EXIST
until you advanceGame into it… NEVER announce a new HOH/nominees/next-week result — ABOVE ALL the
PLAYER winning — before the game has run that comp… if you catch yourself typing 'you are the new
HOH', STOP." Guard test in `leverManifest`.
**STILL OPEN (structural):** prompt alone is uncertain (the model already violated the general rule).
A structural backstop is the next step but is RISKY in the hot path (must not over-fire on a player
legitimately lingering in an advance-phase). Candidate: when a turn fired `submitDecision` (a decision
resolved) and left the engine at a NON-terminal advance-phase with NO new pending decision, fire a
forceful "advanceGame to the next beat before narrating it" nudge (bypassing the lull/`_progressed`
gate, like #1) so the engine catches up to the real result. Needs careful gating + a play-test before
shipping. Owner ruling stands: nudge, do not auto-advance.

## 2. [MED] Preview/commit lag at every ceremony beat
The model narrates the comp result one turn before it commits (Week-1 veto: "Kaitlyn… you have won
the Power of Veto" while `veto.holder=null`; committed next turn). If the HUD is read between the
narrating turn and the next `advanceGame`, it shows stale/contradictory state (evicted nominee still
on the block, no veto holder). Same fix family as #1 (commit the beat before narrating past it). Ties
to the reload-persistence hardening lane (HUD-vs-chat consistency on refresh).

## 3. [MED] Goodbye-message gate race
The eviction won't roll to the next week until the player authors the evictee's goodbye (engine
raises a `goodbye-message` decision card). The model narrated "moving into Week 2 / kicking off the
HOH comp" for 2 turns before the card surfaced. The ENGINE gate is correct (stayed `week:1,
phase:eviction` until the goodbye was provided); the MODEL races past it. **Direction:** prompt/agent
— treat an open `goodbye-message` pending as a hard stop, same as any decision card.

## 4. [MED] Whereabouts narration drifts from engine truth ("people in two places")
A briefing placed Omar & Dillon in the bathroom and called Bedroom A "empty"; engine whereabouts at
that instant had them elsewhere. Real names, wrong rooms — violates "one place at a time / people
must make sense." **Direction:** the model must read the `whereabouts` lever BEFORE narrating any
room/co-presence scene (prompt emphasis or a per-scene whereabouts inject). *(The relationship-lane's
premiere-prompt fix added "call whereabouts BEFORE describing the room"; generalize it to every
phase.)*

## 5. [LOW] Ungrounded social intel surfaced as player knowledge
"the one whisper you've caught: Ana's heard that Rebecca and Jace are plotting something" — engine
`deals:[]`, no `surfaceInformationTo` pathway recorded. Not a Vault leak, but invented "you know X"
without an in-game pathway. **Direction:** the model must only assert player knowledge that arrived
through a recorded pathway. *(CORROBORATED: "Hunter voted to keep Phoebe last time" narrated in
week 1, before any vote existed.)*

## 6. [LOW] Prose cast-count miscounts
"fourteen becomes thirteen" / "thirteen podiums" after one eviction when 15 of 16 remained (HUD count
correct; only prose miscounts). **Direction:** surface the exact remaining count in the moment
context so the model never does its own arithmetic.

## 7. [LOW · FE-render] Casting-completion welcome-screen flash
After `createCharacter`, the chat briefly reset to the empty welcome/empty-composer state mid
re-render before the messages re-painted. No data loss; reads as "the chat lost my conversation" for
a beat. **Direction:** suppress the welcome/empty state during the casting→game transition re-render.

---

## Verified GOOD — do not regress
Vault Wall at the boundary (no numbers/secrets/raw-JSON/raw-tool-names across 20 turns);
anti-sycophancy on committed beats (player lost both HOH comps to real NPCs); persona layer (stable
distinct NPC voices, real-name grounding for the whole 15-NPC cast); 0049 presence, 0054 gadget rail,
the status HUD count, casting tool-beat chips, auto-session-titling; the E22 guard fired 8× and kept
play from wedging. *(B4 cast-invention did NOT reproduce on pro; B1 operator-asides + B2
decision-double-surface not observed on pro — though the relationship-lane DID see operator-aside
content on a transition turn and shipped a high-precision content scrub for it.)*

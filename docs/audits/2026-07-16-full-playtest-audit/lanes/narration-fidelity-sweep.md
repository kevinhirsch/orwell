# Lane: Narration-Fidelity Sweep

> Source digest: `narration-fidelity-sweep-2026-07-16.md` (banked lane-report digest, 2026-07-16
> campaign; the digest notes "full report in conversation" — the full 200-record/64-message scoring
> pass is not preserved beyond this digest).
> Lens: frontier-AI narration-fidelity — grounding/faithfulness to engine truth, in-persona/in-bounds
> behavior, graceful degradation, model-specific failure modes for GLM-4.7 narration.

---

GLM-4.7 VERDICT: "a capable in-character writer and a non-agent" — obeys the STYLE plane reliably (0
invented names in 25 voiced turns, 0 reasoning leaks, 0 length-truncations, 0 Vault leaks — every
fabrication was INVENTED content, never LEAKED secret state; anti-sycophancy held narrowly: never
gifted the player a win), but ignores the ACTION plane: whereabouts 1 call vs ~18 demanded, moveTo
0/~8, advanceGame 0/2 explicit cues, npcVoice 0/~24, gameStatus 0. Treats the 79KB system prompt as
style guidance and its own history as world state.

THE KEY PROOF (rec 76/77): the ONE turn narrated from an actual whereabouts TOOL RESULT is
near-perfectly grounded — GLM honors tool-role messages almost perfectly but will not INITIATE reads.
⇒ Fix altitude: force whereabouts/gameStatus per-turn (forced `tool_choice`) or inject fresh results as
TOOL-role messages instead of system prose.

NEW MECHANISMS beyond prior lanes:

- NARR-3: 6/6 injected corrective directives (RE-GROUND ON THE BOARD / WHO IS IN THE ROOM) IGNORED —
  the reground/reframe lever family is inert on this model; correctives buried in 79KB system prose
  lose to 40K tokens of self-consistent wrong history. Fix: deliver correctives as last user-role
  message + self-verifying (require the named tool call same turn, else regenerate); make closed-set
  interception SYNCHRONOUS (block-and-regenerate pre-display) — extend the 0065 pre-emission guard to
  comp-winner and player-status claims (it caught neither).
- NARR-2 deepened: rec 84 — the model's ONLY self-initiated `recordInteraction` misattributed the
  Angela scene to `withIds:["npc:15"]` = DEREK (Angela is npc:14). No id↔name cross-check at the
  boundary. Plus gap-repair folded "conflict with=7, edges=7" for phantom witnesses. Fix:
  presence-validate + id↔name clamp at the fold boundary.
- BG-2 THE CAST-MERGE MECHANISM: the model's genesis ensemble was INTERNALLY COHERENT (Donna 58 w/
  30-yr career; Teresa 52) — the ENGINE kept its seeded skeleton ages/pronoun directives and grafted
  the model bios on top unreconciled → Donna 22/30-yr career, Teresa 28/20-yr, FIVE houseguests whose
  (use X) pronoun directive contradicts every pronoun in their own bio (narrator sided with bios). This
  is engine-side merge, refines what #1662 must be verified against. Fix: adopt model age/gender or
  regenerate bio + lint (age vs career-years; pronoun agreement).
- NARR-5: STALL-DETECTOR BLIND SPOT — fabricated set-pieces read as "engaged scene" to the lull
  heuristic, so the forced-advance rung never fires exactly when a comp is being hallucinated (nudge
  fired once at 03:01, never again). Fix: comp/ceremony lexicon in narration + no comp tool this turn ⇒
  escalate to forced rung.
- BG-1: GLM thinking-mode mis-routes strict-JSON to the reasoning channel — 15/23 cast-authoring calls
  emitted the whole profile into reasoning with empty text (the #1662 recover-reasoning-JSON fix
  targets this; verify live).
- BG-3: rec 189 = 13-MINUTE memory extraction, 158,861 reasoning chars (~2/3 of session reasoning
  spend) for two junk fiction-contaminated facts. rec 199 returned narrative prose instead of JSON.
  maxTokens caps text but NOT reasoning.
- NARR-12 CONTEXT-BUILDER DEFECTS: (i) premiere MOMENT demands a whole-house circle while the same
  request's presence block scatters cast across 5 rooms — engine-internal contradiction (fix: engine
  actually convenes the circle/moves presence); (ii) "Since your last turn" summaries clamped
  MID-WORD; (iii) the game narrator prompt still carries inherited workspace boilerplate
  (manage_calendar/manage_tasks!) — strip it (golden-staling, add to the golden batch); (iv) off-screen
  morning texture fed into premiere night.
- NARR-8 full voice-duplication catalog: 12 clusters — collateral-damage chorus = 5 takes across 4
  NPCs; three NPCs share Julia's analytic idiolect; Lily+Mike circle intros re-delivered verbatim as
  fresh dialogue; Bradley's "reverse the polarity" hammered 3x. Mechanism: zero npcVoice fetches. Fix:
  force npcVoice on first voicing per NPC per act + anti-repetition state.
- NARR-10: question-sails now 10 (8 known + rec 88 Angela's two questions orphaned + rec 101 Derek's).
  NPCs never react to being blown off — no memory of their own open questions.
- NARR-11 latency: narrator p50 24s, p90 51s; 9 turns >45s player wait; MSG 49 = 86.2s with 51.3s BLANK
  time-to-first-token; input 32-61K tokens/turn (79KB prompt + full history) is the driver.
- BG-7: 20/200 llmIo slots are dur=0 duplicate echo rows — double-logging evicted the casting-window
  records.
- BG-6: persona bible authored the casting producer as female post-interview vs live "Clay" — cosmetic
  drift risk.

WORST-10 turns ranked: r155 (HOH winner w/ ignored in-request directive) > r192 (removal, final msg,
uncorrectable) > r148 (invented comp+montage on the advanceGame-demanded turn) > r163 (assault w/ 9
phantom witnesses, belt-recorded) > r84 (wrong-NPC fold) > r88 (tour begins) > r184 (invented DR
detention) > r52+56 (doubled take) > r128 (operator aside + unwrapped dashboard) > r142 (86s wait +
self-contradicting fabric).

AGGREGATES: 17/24 post-start turns contradict in-context occupancy; 2 fabricated closed-set arcs across
7 turns; 6 fabricated scenes folded into consequence state; 3 phone/sealed-house breaks; 2 impossible
bios voiced twice each; 3 pronoun-directive violations; 0/0/0 on the clean classes.

RECOMMENDATIONS (ranked): 1 synchronous closed-set interception; 2 presence-validate consequence belts
+ id↔name clamp; 3 force whereabouts (tool-message grounding); 4 stall-detector comp-lexicon
escalation; 5 cast-merge coherence at the engine merge + lint; 6 doubled-take replace-not-append; 7
game-gate memory loop + reasoning caps on utility; 8 correctives as last user-role message,
self-verifying; 9 context hygiene (sentence-boundary clamps, strip workspace boilerplate, convene the
circle, de-dup echo rows); 10 mechanical NPC-voice assist.

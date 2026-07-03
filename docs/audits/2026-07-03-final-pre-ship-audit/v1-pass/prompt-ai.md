# PROMPT / AI SEAM AUDIT — Orwell final pre-ship

Territory: every prompt template, system message, context construction, LLM call, output
parser, error-correction belt, and token/reasoning budget. Audited against VISION_BRIEF
invariants I1–I10 and contradictions C1–C6. Live model probes run against `z-ai/glm-4.7`
(the new ADR-0016 narrator) on OpenRouter.

## Index

| id | severity | effort | title | where |
|----|----------|--------|-------|-------|
| PROMPT-1 | Major | <1hr | Forced `tool_choice` (ADR 0016 §D) defeats the #1127 social runway — the spectator force-march re-opens | agent_loop.py:4180-4229 + chat_helpers `_hold_for_social` |
| PROMPT-2 | Major | <1hr | `max_tokens_budget` seed re-introduces the reasoning-truncation vector token_policy.py fixed (casting sharpest) | settings.py:196-205; token_policy.py:56-67 |
| PROMPT-3 | Minor | <1hr | First-name matching in three belts suppresses / mis-marks on duplicate first names | agent_loop.py:2272-2274; chat_helpers.py:1684-1691,1707-1714 |
| PROMPT-4 | Minor | <1hr | E22 fallback force-records OOC/HUD `((...))` asides as in-game scenes (I3/I4) | chat_helpers.py:2575-2646 |
| PROMPT-5 | Minor | <1hr | Runway hold vs "seize the lull" — a 2-turn hold ignores an off-vocabulary readiness signal | chat_helpers.py:319-335, 2053-2057 |
| PROMPT-6 | Polish | <1day | Stacked grounding directives dilute the frame + fight ADR 0003 "prefer removing context" | chat_helpers.py apply_game_framing:2334-2406 |

Positive verifications (no finding): the Vault Wall is structurally respected in the whole
prompt layer (every `buildSystemPrompt` input is a Vault-free `GameStateView`/projection;
casting echoes are `neutralizeForPrompt`+`JSON.stringify` guarded, C8). Live probe confirms
GLM-4.7 (a) honors `tool_choice:"required"`/named-function, and (b) returns reasoning on the
separate `reasoning` field — NOT the content channel — so ADR 0016's reasoning-hygiene and
force-call bets both hold on the pinned model. No I1/I10 cross-user/Vault leak found in
context construction. The pre-emission outcome/location/nominee guards are correctly
**fail-open** (return emit on any uncertainty/error) so they never suppress a real committed
beat — they only drop phantoms the engine never committed (I2-respecting).

---

## PROMPT-1 [Severity: Major] [Effort: <1hr]
Forced `tool_choice` at ceremony phases overrides the social-runway hold — the exact
spectator "force-march" the #1127 runway exists to prevent re-opens.

- Where: `frontend/src/agent_loop.py:4180-4229` (`_forced_tool_choice_for_beat` gate) ×
  `frontend/routes/chat_helpers.py:1986-2001` (`_hold_for_social`/`_with_moment`) and
  `_LAST_FRAMED_BEAT_KEY` at `apply_game_framing:2307-2320`.
- Problem: When an NPC wins HOH the player is a spectator, and `_pre_resolve_npc_ceremony`
  deliberately HOLDS a 2-turn social runway before driving the nominations — it returns
  `_hold_for_social(game_state)`, which overrides `moment → "social"` but **preserves
  `phase`** (e.g. `"nominations"` / `"veto-competition"`). `apply_game_framing` then stores
  `_LAST_FRAMED_BEAT_KEY[owner] = (week, phase="nominations", moment="social", …)`. The new
  ADR-0016 §D force gate (default-on: `force_tool_choice_at_beats=True`, and GLM honors it)
  reads ONLY `framed_beat_key[1]` = the phase = `"nominations"` — which is in
  `_FORCE_ADVANCE_PHASES`. During the hold there is no player pending (the runway clears on a
  pending), so `_forced_tool_choice_for_beat` returns a forced `advanceGame`. The model is
  FORCED to advance the very ceremony the runway is trying to give the player social time
  before — collapsing the guaranteed social window to zero on the first hold turn. The
  `moment="social"` prompt telling the model to linger is invisible to the force gate, and
  the forced tool call wins on the wire. This is precisely the "it skips all of the social
  narrative gameplay… zero social opportunity… a critical failure" defect #1127 was built to
  fix; the newest belt silently reverts it. (The ceremony itself is still narrated afterward
  via `_ceremony_narration_steer`, so no beat is lost/invented — hence Major, not Blocker —
  but the owner-critical social runway is defeated on the common spectator path.)
- Fix: make the force gate aware of a held runway. Cheapest: in the §D gate skip forcing
  when the framed **moment** is `"social"` while the phase is a ceremony phase (read
  `framed_beat_key[2]`), or expose a `chat_helpers.runway_is_holding(owner)` predicate
  (`_RUNWAY_LEFT.get(_runway_key(owner),0) > 0`) and suppress forcing when true. Add a
  regression test that a runway-held `nominations` turn yields `tool_choice=None`.

## PROMPT-2 [Severity: Major] [Effort: <1hr]
The `max_tokens_budget` settings seed re-introduces the exact reasoning-truncation vector
`token_policy.py` was rewritten to eliminate — sharpest on the casting lane.

- Where: `frontend/src/settings.py:196-205` (`max_tokens_budget: narration=4096, casting=2048`)
  vs `frontend/src/token_policy.py:56-67` (both default to `None` ⇒ model-aware full
  headroom, with an explicit block comment: *"A flat constant here re-introduced the #835
  truncation vector for reasoning models … a flat 4096 truncated narration mid-reply"*).
- Problem: `token_policy` deliberately made narration/casting `None` so a reasoning model
  gets full reasoning+answer headroom. But `DEFAULT_SETTINGS.max_tokens_budget` seeds an
  in-band override (`4096`/`2048`) which — per SOUL lesson 18 and `resolve_token_policy`'s
  precedence — **WINS over the `None` default**. So the fix is dead: the live caps are the
  flat literals again. Live probe against the ADR-0016 narrator confirms the mechanism is
  real on GLM-4.7: OpenRouter counts reasoning tokens against `max_tokens`. At
  `reasoning=low, max_tokens=220` the body was **empty, finish_reason=length**, 228 reasoning
  tokens consumed the whole cap. The **casting** lane is the sharper risk: casting runs
  `reasoning="medium"` (settings.py:178) against the tighter `2048` cap — a probed casting
  turn burned **894 reasoning tokens (~44% of 2048) before any body**; a richer prompt pushes
  reasoning to ~1200-1500 and truncates the visible reply. This is exactly the documented
  #1034 casting symptom ("degenerate ultra-terse turns … the visible body collapses to
  near-nothing after a long reasoning trace"). The FE's `CASTING_REGISTER_NOTE`
  (chat_helpers.py:163-171) tries to fix that collapse with **prompt wording** ("never
  collapse a turn to a bare 'Name.'") — but a token-budget truncation is structural and
  cannot be fixed by wording (I9: structure, not prose). Casting is the first-10-minutes seam
  where a truncated producer turn is most damaging.
- Fix: remove `"narration"` and `"casting"` from the `max_tokens_budget` seed (let them
  resolve to the model-aware `None` default the code intends), OR raise them well clear of the
  reasoning envelope (narration ≥ 8192, casting ≥ 6144). Independently, reconsider casting
  `reasoning=medium` → `low` given the tight cap. Add a source-pin test that narration/casting
  `max_tokens` is not a small flat literal.

## PROMPT-3 [Severity: Minor] [Effort: <1hr]
Whole-word FIRST-NAME matching in three belts causes false positives when two houseguests
share a first name (BB casts routinely do; names are seeded from real-name corpora with no
first-name-uniqueness guarantee).

- Where: `agent_loop.py:2272-2274` (`_auto_mark_premiere_intros`), `chat_helpers.py:1684-1691`
  (`_sentence_places_evicted`), `chat_helpers.py:1707-1714` (`_text_mentions_evicted_houseguest`).
- Problem: Each falls back to matching a houseguest's **first name** as a whole word.
  (a) Premiere: a narration that merely *mentions* "Maya" (not introduces her) marks Maya
  `met`, opening the first-HOH gate before a real introduction — the player never actually
  meets that person, undercutting "15 strangers become distinct people" (core fantasy, I6).
  (b) Location guard: if evicted "Chris Smith" shares a first name with active "Chris Jones",
  the sentence "Chris Jones leans against the kitchen counter" binds the evicted first name
  "Chris" to a presence verb + a house room and is **DROPPED before the player sees it** —
  suppressing a legitimate active-houseguest scene (I2/I9: a real beat suppressed).
- Fix: require a full-name (or name + a stronger introduction cue) match for the premiere
  mark; in the evicted-location screen, skip the first-name variant when any **active**
  houseguest shares that first name (the `activeNames` set is already in the beat signature).
- Cross-territory flag: character-factory / engine agent — confirm the name seeder enforces
  first-name uniqueness within a cast, or these belts stay fragile.

## PROMPT-4 [Severity: Minor] [Effort: <1hr]
The E22 unrecorded-turn fallback force-records OOC/HUD `((…))` producer asides as in-game
scenes, giving a logistics answer an in-game record it should never have (I3/I4).

- Where: `frontend/routes/chat_helpers.py:2575-2646` (`ensure_turn_recorded` → floor digest).
- Problem: The guard fires on ANY completed game turn with ≥80 chars of narration and zero
  engine writes. A model turn that answers an out-of-character HUD/logistics question — which
  the base prompt requires be wrapped in `((double parentheses))` and which explicitly has "no
  in-game pathway to any NPC" (CLAUDE.md) — can exceed 80 chars and carry no write tool, so it
  gets a floor-digest `recordInteraction`. The rich path (`_auto_record_scene`) correctly
  returns False (no houseguest engaged), but the code then falls through to the unconditional
  floor digest of `player_msg + narration`. An OOC producer aside thereby lands in the event
  store as a witnessed scene. `recordInteraction`'s own contract is "the player actually
  witnessed the scene"; an OOC HUD answer is not one.
- Fix: skip `ensure_turn_recorded` when the narration is a fully-wrapped OOC aside (leading
  `((` / `ooc:` after trim), mirroring the diary-room exclusion — the same detection the
  reasoning/render split already uses for OOC marking.

## PROMPT-5 [Severity: Minor] [Effort: <1hr]
The 2-turn social runway hold contradicts the base prompt's "SEIZE the lull" when the
player's readiness phrasing falls outside `_RUNWAY_READY_RE`.

- Where: `chat_helpers.py:319-335` (`_RUNWAY_READY_RE`/`_player_signals_ready`), used at
  `2044-2057` and `2073-2088`.
- Problem: The base prompt (momentPrompts BASE, "PACING IS ENGAGEMENT") tells the model that
  the instant a scene lulls it should glide into the next beat. The runway instead HARD-HOLDS
  the ceremony for `_SOCIAL_RUNWAY_TURNS=2` turns and only a regex-matched readiness cue cuts
  it short. A player who signals readiness in words the regex misses ("alright, that's plenty,
  push me forward", "I've done my rounds") is held an extra turn against both the prompt's
  instruction and their own wish — the model is framed on `social` and forbidden to advance.
  Two guardrails (prompt heuristic + FE regex) encode "is the player ready?" differently (C4).
- Fix: treat a short/closing player reply (the `_LULL_SHORT_CHARS` heuristic the agent loop
  already uses in `_player_turn_is_lull`) as runway-cutting too, not only the readiness regex;
  or shorten the runway ceiling to 1 turn when the player reply is a lull.

## PROMPT-6 [Severity: Polish] [Effort: <1day]
Grounding directives stack up to ~6-deep on a single framed turn, diluting the frame and
fighting ADR 0003's "prefer removing context."

- Where: `chat_helpers.py:2334-2406` — `apply_game_framing` appends, in sequence:
  pending-barrier, location-barrier, premiere-progress, beat-signature re-ground,
  state-delta, presence-movement, attachment framing — on top of `BASE_GAME_MASTER_PROMPT`
  (~460 lines) + the moment fragment + full `renderGameContext` (15 roster lines w/ every
  facet + still-to-meet list).
- Problem: A premiere or post-desync turn can carry several competing "STOP / GROUNDED /
  RE-GROUND / this is CONSISTENTLY the gate" imperatives at once. Beyond token cost (against
  ADR 0003's directive to *remove* context and hand the model facts, not scripts), multiple
  imperative blocks compete for the model's attention and can blunt the one that matters
  (e.g. a pending barrier buried under a delta + presence-movement block). This is the C1
  tension made concrete — the belts are now the frame.
- Fix: consolidate the per-turn appended directives into one ordered "LIVE BOARD — GROUND
  HERE" block with a single priority ordering (pending > location > premiere > delta), and
  drop the delta/presence-movement appends on turns where a hard barrier (pending) is already
  present (they are redundant when the model is pinned to one decision).

---

## Cross-territory flags
- **Engine / character-factory:** PROMPT-3 depends on whether the name seeder guarantees
  first-name uniqueness within a cast. If not, both the premiere auto-mark and the evicted-
  location scrub are fragile — please confirm.
- **Token-economy / settings audit:** PROMPT-2 is a settings-seed vs code-default conflict;
  whoever owns the Token Economy card should verify the admin UI shows the truncation-safe
  defaults and that lowering casting reasoning is acceptable to the PO.
- **Narration-fidelity agent:** the `_faith_check` "active" mode `adopt` lever auto-calls
  `recordInteraction` to canonicalize a model-narrated detail (open-set, mandate-checked
  upstream). Confirm faithfulness default mode is `shadow` at ship (active + adopt is a belt
  that writes on the model's behalf, sanctioned only for open-set canon).

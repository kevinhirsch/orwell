# PROMPT-DEEP — Deep prompt-engineering audit (Orwell pre-ship v2)

Territory read IN FULL: `src/engine/momentPrompts.ts` (all 1128 lines: BASE_GAME_MASTER_PROMPT,
CASTING_INTERVIEW_PROMPT, every MOMENT_PROMPTS fragment, momentForPhase/momentFragment,
physicalLook, renderGameContext, renderStoryFacts, buildSystemPrompt), `src/engine/portraitPrompts.ts`,
`src/engine/castingIntake.ts`. FE belts: `frontend/routes/chat_helpers.py` (apply_game_framing, the
pre-emission/desync/faith seams), `frontend/src/agent_loop.py` (_forced_tool_choice_for_beat,
_auto_record_scene, _ADVANCE_NUDGES ladder, L39b forced advance, eviction-reveal steer, faith
directives), `frontend/src/token_policy.py`, `frontend/src/settings.py` (DEFAULT_SETTINGS reasoning +
max_tokens seeds), ADR 0016. Cross-checked web_search wiring + showmances projection.

Critiqued each prompt rule as game design AND correctness against the vision brief (I1–I10 / C1–C6).

## Index
| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| PROMPT-1 | Major | multi-day | High | BASE prompt is ~420 lines injected EVERY turn (ADR 0003 inversion) | momentPrompts.ts:39-459 |
| PROMPT-2 | Major | <1day | High | 16 voices left to chance — the voice fingerprint is gated behind an unforced npcVoice call | momentPrompts.ts:256-263,374; renderGameContext:914 |
| PROMPT-3 | Major | <1hr | High | narration `max_tokens` seed 4096 re-introduces the truncation vector token_policy explicitly warns against | settings.py:197 vs token_policy.py:56-67 |
| PROMPT-4 | Major | <1day | High | Casting OPENS on the photo/UI button — configuration, not casting; kills the "being cast" first impression | momentPrompts.ts:535-547 |
| PROMPT-5 | Major | <1day | High | `_auto_record_scene` double-fail = ZERO consequence (I4) with no minimal floor record | agent_loop.py:2354-2370 |
| PROMPT-6 | Major | <1day | High | Diary Room moment is 2 lines — the intimacy half of the core fantasy is under-specified | momentPrompts.ts:731-733 |
| PROMPT-7 | Major | <1day | High | The signature blindside payoff has no positive craft guidance | momentPrompts.ts:676-709; social:715 |
| PROMPT-8 | Minor | <1day | Med | Heavy rule repetition (montage/names/outcomes stated 2–4×) dilutes signal | momentPrompts.ts (multiple) |
| PROMPT-9 | Minor | <1hr | Med | `ask_user` given contradictory roles (present binding decisions vs. don't — the card does it) | momentPrompts.ts:135-137,322-323 |
| PROMPT-10 | Minor | <1day | Med | Extraction paraphrase becomes canonical recalled memory — thins season memory vs. the rich narration (I5) | agent_loop.py:2320-2337; renderStoryFacts:1086 |
| PROMPT-11 | Minor | <1hr | Med | Anti-softening floor stated ONLY at eviction, not at noms/veto/comp (sycophancy vector) | momentPrompts.ts:683 vs 639-654 |
| PROMPT-12 | Minor | <1day | Med | "Pacing IS engagement" lets the model bury/delay beats adverse to the player (C4) | momentPrompts.ts:162-171 |
| PROMPT-13 | Minor | <1hr | Med | Casting reasoning=medium + 2048 cap = reveal truncation; also mismatched vs narration=low | settings.py:178,199 |
| PROMPT-14 | Minor | <1hr | Med | `neutralizeForPrompt` 160-char echo truncates the player's OWN backstory/motivation in-prompt | castingIntake.ts:41-44; renderGameContext:853 |
| PROMPT-15 | Minor | <1day | Med | Premiere = 15 sequential intros with no format-variety guidance → flat roll-call at the highest-stakes intro | momentPrompts.ts:582-595 |
| PROMPT-16 | Minor | multi-day | Med | OOC `((wrap))` is a fragile prose convention carrying real rendering weight (I9) | momentPrompts.ts:199-204 |
| PROMPT-17 | Minor | <1day | Med | Full roster detail (10 facets × 15 HGs) every turn incl. off-screen houseguests — bloat | renderGameContext:887-926 |
| PROMPT-18 | Minor | <1day | Med | THE RECORD injected only on re-entry/recap — long live sessions lose early-season memory in-context (I5) | renderStoryFacts:1081; apply_game_framing |
| PROMPT-19 | Minor | <1day | Med | Forced `tool_choice:"required"` at comp phases can over-force on staged/non-binding comp-round turns | agent_loop.py:1519-1526,1486 |
| PROMPT-20 | Minor | <1hr | Med | castPhoto `next`-step nag-loop depends on the FE writing castPhoto="skipped" | castingIntake.ts:55-73; momentPrompts.ts:542-544 |
| PROMPT-21 | Minor | <1day | Med | I7 (the house schemes without you — priority #1) is under-served by the narration guidance | momentPrompts.ts:372-373,415-434,715-730 |
| PROMPT-22 | Minor | <1hr | Low | physicalLook fed every turn for all HGs while the rules say "appearance once" | renderGameContext:905 vs momentPrompts.ts:314-317 |
| PROMPT-23 | Minor | <1hr | Med | web_search real-world instruction is a pacing/derail vector for the narrator | momentPrompts.ts:230-237 |
| PROMPT-24 | Minor | <1hr | Med | Injected "(Production note…)" belt text is a leak surface the reasoning-scrub may not catch | agent_loop.py:1578-1611; 1437-1451 |
| PROMPT-25 | Minor | <1day | Med | `_pre_emission_outcome_guard` can silently DROP legit conditional/hypothetical outcome sentences | agent_loop.py:3009-3030 |
| PROMPT-26 | Minor | <1day | Med | Memory recall not coached in-voice — "the house remembers" reads as flat facts, not lived history | renderStoryFacts:1086-1087 |
| PROMPT-27 | Minor | <1day | Med | Casting anti-gushing + short turns risks a COLD interview vs. the "being cast" warmth (C4) | momentPrompts.ts:495-499 |
| PROMPT-28 | Minor | <1hr | Low | Casting headshot block = 15 lines of anxious UI negative-instructions bloating the producer persona (C2) | momentPrompts.ts:535-547 |
| PROMPT-29 | Minor | <1hr | Med | Premiere list-shrink depends on a synchronous markHouseguestMet; lag → re-introduce (the bug it was meant to fix) | momentPrompts.ts:592-595; renderGameContext:1027 |
| PROMPT-30 | Minor | <1day | Med | All-caps negative framing tuned for DeepSeek may over-suppress GLM-4.7 creativity → flat narration (C1) | momentPrompts.ts:108-134 |
| PROMPT-31 | Polish | <1hr | Low | showmance voicing fully gated on `view.showmances` — verify the projection populates it or the storyline never surfaces | renderGameContext:1052-1054 |
| PROMPT-32 | Polish | <1hr | Low | `default` moment fragment is thin for any unmapped engine phase | momentPrompts.ts:794-796 |
| PROMPT-33 | Polish | <1hr | Low | Casting vs. live-game OOC convention mismatch across the seam | momentPrompts.ts:476-482 vs 199-204 |

---

## Findings

[PROMPT-1] [Severity: Major] [Effort: multi-day] [Value: High]
BASE_GAME_MASTER_PROMPT is ~420 lines injected on EVERY turn — the exact opposite of ADR 0003
- Where: momentPrompts.ts:39-459 (BASE), stacked in buildSystemPrompt:1118-1127 with the moment fragment + renderGameContext (another ~40 lines) + storyFacts + worldContext.
- Problem: ADR 0003 mandates "prefer removing context to adding it; get out of the model's way." The system prompt has instead grown by pure accretion — nearly every past bug bolted on another all-caps paragraph. It is thousands of tokens of rules before any game state. Two harms: (1) instruction dilution — GLM-4.7 at reasoning `low` cannot weight 420 competing lines; the eight hard invariants (Vault Wall, engine-decides, pathways) sit at the same visual priority as "don't narrate your own pen-tapping," so the load-bearing rules lose salience; (2) creative flattening — a wall of prohibition primes cautious, generic "reality-TV drama" prose rather than the paranoid-intimate BB texture the vision sells. Violates the spirit of I9's home (ADR 0003) and undercuts I6/behavioral fidelity by crowding out voice.
- Fix: Restructure, don't just trim. Hoist a tight ~10-line HARD-RULES header (the invariants that must never bend) to the very top. Move the long rationale/examples ("the single worst break…", the glitch-complaint sub-bullets) into shorter directive lines. Gate situational rules by moment (movement/whereabouts rules only when a room scene is live; ceremony rules only at ceremonies) instead of shipping all of them every turn. Target a <150-line base.

[PROMPT-2] [Severity: Major] [Effort: <1day] [Value: High]
The 16 distinct voices (I6) are left to chance — the real differentiator is gated behind an unforced tool call
- Where: The rich voice fingerprint (register, rhythm, fillers, `stressTell`) lives ONLY in npcVoice (momentPrompts.ts:256-263, 374-393). The always-present roster line (renderGameContext:914) carries just `demeanor` ("comes across as X").
- Problem: The prompt itself names the failure ("The house is NOT a room of identical witty, warm… professionals", :250-255) but the mechanism to prevent it is npcVoice, a per-houseguest tool call the model reliably UNDER-calls (the documented root cause behind ~12 belts). There is NO belt forcing npcVoice (unlike advanceGame/recordInteraction). So for every ambient/background houseguest — and any scene where the model doesn't stop to fetch — voicing falls back to a single demeanor phrase, and two "warm" houseguests read identically. This is the single biggest behavioral-fidelity (I6, priority #1) gap in the prompt layer: the season's most-sold promise ("15 strangers become distinct people") depends on a call the model skips.
- Fix: Bake the voice fingerprint into the always-present context. Add each active houseguest's one-line `voice` signature + `stressTell` to the renderGameContext roster line (it is Vault-free public texture, same as demeanor), so distinct cadence is in front of the model every turn without a tool call. Keep npcVoice for the deep per-scene `knows/suspects/mood`. Optionally add a soft npcVoice belt for a houseguest the player directly addresses.

[PROMPT-3] [Severity: Major] [Effort: <1hr] [Value: High]
The narration `max_tokens` seed (4096) re-introduces the exact reasoning-truncation vector token_policy was designed to avoid
- Where: settings.py:197 `max_tokens_budget.narration = 4096` — an in-band override that, per token_policy.py:106-153, WINS over the class default. token_policy.py:56-67 sets narration default to `None` precisely so the call site substitutes a model-aware cap, with a block comment: "A flat constant here re-introduced the #835 truncation vector for reasoning models… a flat 4096 truncated narration mid-reply."
- Problem: GLM-4.7 runs reasoning `low` (ADR 0016) and counts reasoning+visible tokens against `max_tokens`. Narration is the richest output class — a premiere that introduces up to 15 people, a staged competition, or a ceremony set-piece can run long, and the low-reasoning preamble eats into the same 4096. The seed contradicts its own module's stated design and is the highest-weight seam (every CI gate stubs the LLM; the ship-gate concentrates severity here). A mid-reply truncation on a marquee beat is exactly the prior "empty/blocker narration" class.
- Fix: Remove (or sharply raise) the `narration` seed in max_tokens_budget so the model-aware default applies as token_policy intends. If a ceiling is wanted, set it well above a full set-piece + low reasoning (e.g. ≥12k), never 4096.

[PROMPT-4] [Severity: Major] [Effort: <1day] [Value: High]
The casting interview OPENS on the photo/"Choose Your Character" button — configuration, not casting
- Where: momentPrompts.ts:535-547 ("THE HEADSHOT… THIS IS WHERE YOU OPEN. Before any other question…"); castingIntake.ts:55-63 makes castPhoto COVERAGE step #1 so `next` points at it first.
- Problem: The vision's first-10-minutes promise is casting that "feels like being *cast*, not configured." The literal first thing the producer does is talk about a UI button — "tap it to add your cast photo… our team styles it… it's optional." That is workspace plumbing (C2) surfacing at the single highest-value moment of the whole game. The human hook — who are you, why are you here — is deferred behind a photo-upload logistics exchange. A new player's first impression is "configure your avatar," not "you might actually get on this show."
- Fix: Reorder so the producer opens with a real, disarming human question and weaves the photo in naturally within the first beat or two ("—and while we're at it, tap Choose Your Character for your cast shot"). Demote castPhoto out of the pole `next` slot, or have the FE surface the photo control passively so the producer needn't lead with it.

[PROMPT-5] [Severity: Major] [Effort: <1day] [Value: High]
`_auto_record_scene` double-fail folds ZERO consequence (I4) — the backup has no minimal floor
- Where: agent_loop.py:2354-2370. If the extraction returns no parseable JSON, it logs an overseer anomaly and returns False (:2356-2366). If JSON parses but `ids` is empty after roster-filtering, it returns False and records nothing (:2368-2370).
- Problem: This belt exists BECAUSE the narrator already under-called recordInteraction — it is the guarantee that "every scene has consequence" (I4, the cardinal implementation sin if violated). But the guarantee itself is now all-or-nothing on a second LLM call (GLM-4.7-flash) emitting a COMPLEX nested JSON schema (withIds + kind + content + consequence.edges with 8 direction enums, :2323-2334). When that call truncates, mis-formats, or returns empty ids, the marquee social scene folds no hidden impact and is forgotten — the exact degradation the whole architecture exists to prevent. Overseer logging is not a fold.
- Fix: Split the guarantee from the enrichment. First extract the SIMPLE `{withIds, kind, content}` (which reliably parses) and record it to lock the fold; only THEN attempt the richer `consequence` descriptor as a best-effort enrichment. If even the simple extraction fails but the narration clearly names roster houseguests, record a minimal kind-only `strategy` interaction with those names rather than nothing.

[PROMPT-6] [Severity: Major] [Effort: <1day] [Value: High]
The Diary Room moment is 2 lines — the intimacy half of the core fantasy is under-specified
- Where: momentPrompts.ts:731-733 (diary-room): "A private, out-of-character producer aside… Listen; read their game." Lever guidance diaryRoom:450-451 is equally thin.
- Problem: The vision sells "paranoia braided with INTIMACY." The DR/confessional is the backstage soul of Big Brother and the primary intimacy surface — the place the player articulates their reads, fears, and plans (which is itself the fun, and feeds the engine's read of player strategy). The prompt gives the model almost nothing to make the DR sing: no coaching to probe the player's paranoia, reflect their game back, press on a contradiction, or build the confessional-to-camera texture. It's the emptiest high-value moment in the file.
- Fix: Expand the diary-room fragment into a real producer-confessional playbook: prompt the player to voice who they trust/fear and WHY, press when a stated plan contradicts their last move, mirror the tension of the week back, keep it warm and conspiratorial. Still OOC / no NPC pathway (that constraint is correct) — this is about texture, not new mechanics.

[PROMPT-7] [Severity: Major] [Effort: <1day] [Value: High]
The signature blindside payoff has no positive craft guidance — only prohibitions
- Where: The eviction moment (momentPrompts.ts:676-709) handles the vote reveal purely MECHANICALLY (drip anonymized ballots, don't fabricate a tally). The social moment (:715-730) and socialRead lever (:372-373) only hedge against leaking.
- Problem: The vision's two peak moments are (1) being genuinely blindsided by a plot you never saw and (2) pulling off your own. The prompt is meticulous about NOT leaking and NOT foreshadowing (which structurally PERMITS the blindside) but gives zero guidance on how to LAND it — the dramatic irony of the player's false confidence meeting the real result, the room's turn, the "wait, what just happened" beat. The most important emotional payoff in the product is left entirely to the model's instincts while a wall of don'ts surrounds it.
- Fix: Add positive craft direction at the eviction/vote-reveal and post-eviction beats: when the committed result contradicts the player's evident expectation (or an ally the player trusted flips), play the whiplash — the frozen beat, the faces, the recalibration — as the show's signature moment. Explicitly frame it as the payoff the whole hidden layer was building to (without ever revealing the hidden layer).

[PROMPT-8] [Severity: Minor] [Effort: <1day] [Value: Med]
Heavy rule repetition dilutes the signal it's trying to strengthen
- Where: momentPrompts.ts — "never invent a nominee" appears in AUTHORITY (:72-75), the nominations fragment (:640-643), and ceremonyLines (:932-934). Time-montage discipline appears in TIME DISCIPLINE (:146-160), social (:722-730), nominations (:648-654), and re-entry (:757-759). "NAMES ARE FIXED" (:303-309) restates rules already in AUTHORITY/THE HOUSE. OOC-wrap appears at :199-204 and :476-482.
- Problem: Repetition was added reactively each time a rule was violated, on the theory that saying it louder/more helps. On a strong instruction-follower (GLM-4.7) it mostly adds tokens and competes for attention, and it makes the base prompt harder to maintain (a rule change must be found in 3 places). Symptom of prompt-by-accretion (see PROMPT-1).
- Fix: Consolidate each rule to ONE authoritative statement in the base; let moment fragments reference the beat, not re-derive the global rule. Reclaim the tokens for texture.

[PROMPT-9] [Severity: Minor] [Effort: <1hr] [Value: Med]
`ask_user` is given two contradictory roles
- Where: momentPrompts.ts:322-323 "ask_user is ONLY for presenting the game's pending BINDING decision options"; vs :135-137 "the player's own decision card already presents the legal options — set the scene and let that card take the choice; do NOT also re-ask… with ask_user."
- Problem: One rule makes ask_user THE mechanism for binding decisions; the other says the FE decision card already does that, so don't use ask_user. The model gets no clean rule for when ask_user is correct at a binding beat — inviting either a double-ask (card + ask_user, the exact bug :137 warns about) or an omitted surfacing.
- Fix: State it once, unambiguously: the engine's pending decision is surfaced by the FE card; the model NEVER re-presents it with ask_user. Reserve ask_user (if kept at all) for non-binding clarifications only, and say so.

[PROMPT-10] [Severity: Minor] [Effort: <1day] [Value: Med]
The extraction model's paraphrase — not the rich narration — becomes the canonical recalled memory (I5)
- Where: agent_loop.py:2320-2337 asks GLM-4.7-flash for `content: "one concise past-tense sentence"`; that string is what gets recorded (:2372, 2379) and later surfaced verbatim as "THE RECORD" (renderStoryFacts:1086-1087).
- Problem: When the auto-record belt fires (i.e. whenever the narrator under-called), the persisted event is a flat one-sentence flash-model summary, not the scene the player actually lived. Over a season, recalled memory is extraction-quality, not scene-quality — the house "remembers" a thin paraphrase. This is a slow-drip against I5 (non-degradation / detail should accumulate and deepen): the richest version of each scene (the narration) is discarded and the summary canonized.
- Fix: When auto-recording, pass a richer `content` (allow 2–3 sentences capturing the emotional/strategic substance), or attach the salient span of the actual narration as the event content rather than a re-summarized sentence. Preserve depth on the guarantee path.

[PROMPT-11] [Severity: Minor] [Effort: <1hr] [Value: Med]
The anti-softening (anti-sycophancy) floor is stated only at eviction, not systematically
- Where: momentPrompts.ts:683 (eviction) "never soften the count against the player to be kind — the real votes stand, flattering or not." No equivalent at nominations (:639-654), veto-ceremony (:673-675), or the comp fragments.
- Problem: The FLAVOR-vs-OUTCOMES bright line (:108-134) blocks INVENTING a favorable outcome, but the distinct SOFTENING vector — narrating a real ADVERSE outcome so gently/hedged that it misleads the player about their standing — is only explicitly forbidden at eviction. A model with any residual positivity bias can, at a nomination that puts the player on the block or a comp they lost, cushion it into ambiguity. Anti-sycophancy (mandate #3 / I2) should be a systematic floor.
- Fix: Add a one-line "voice adverse outcomes straight — never soften a nomination, a lost comp, or a betrayal to spare the player" to the base FLAVOR-vs-OUTCOMES section so it covers every ceremony, not just eviction.

[PROMPT-12] [Severity: Minor] [Effort: <1day] [Value: Med]
"Pacing IS engagement" asks the model to judge player engagement — a people-pleasing-adjacent read with no guard (C4)
- Where: momentPrompts.ts:162-171 (PACING IS ENGAGEMENT) — "A player deep in a substantive scene… should NEVER be yanked… ride that energy."
- Problem: Judging "is the player engaged / is this substantive" is subjective and adjacent to pleasing the player — the model will read the player's OWN enjoyment as engagement and can indefinitely prolong scenes the player likes while deferring beats they won't (their own nomination, a comp they'll lose). Nothing in the rule prevents engagement-pacing from delaying an ADVERSE beat. Combined with PROMPT-11, this is a real sycophancy channel that the anti-sycophancy mandate doesn't cover.
- Fix: Add a guard: engagement pacing governs WHEN a lull is seized, never WHETHER an adverse beat lands — a beat the game is ready to deliver is never held back because the player is enjoying the current scene. Make "ride the energy" explicitly subordinate to the daily-event/advance cadence.

[PROMPT-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
Casting reasoning=medium under a 2048 cap risks reveal truncation, and is mismatched against narration=low
- Where: settings.py:178 `casting: "medium"` reasoning; :199 `casting: 2048` max_tokens. (Corroborates the prior "casting max_tokens truncation" finding at the config level.)
- Problem: Casting reasoning is MEDIUM (heavier than narration's LOW) while its output cap is TIGHTER (2048 vs narration's already-too-low 4096). Reasoning+visible share the cap, so the casting-card read-back turn (createCharacter returns a full card the producer voices, momentPrompts.ts:559-563) is the most likely to truncate. And the posture is inconsistent: an interview is warmth+probing, not deep analysis — why is it MORE reasoning-heavy than live narration? ADR 0016 justified medium as "quality-sensitive," but the tighter cap undercuts that.
- Fix: Drop casting reasoning to `low` (matching narration) OR raise the casting max_tokens seed to a comfortable reveal-safe value. Don't pair the heaviest reasoning with the tightest cap.

[PROMPT-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
The casting-status echo truncates the player's OWN backstory/motivation to 160 chars in-prompt
- Where: castingIntake.ts:41-44 (`neutralizeForPrompt`, default max=160); renderGameContext:853 echoes each captured field through it. The intake STORES up to scalarMax=500 (castingIntake.ts:28).
- Problem: The producer resumes/finalizes from the CASTING STATUS block, but only ever SEES the first 160 chars of what the player said ("…"-truncated). A player who gave a rich 3-sentence backstory or a nuanced private strategy has it clipped before the model reads it back — so the producer can lose the gold it just mined, re-ask, or reflect a shallow version. The full value persists but is invisible to the model (an in-prompt I5 shortfall at the highest-value interview moment).
- Fix: Raise the echo cap for the substantive casting fields (backstory, motivation, privateStrategy) toward scalarMax; keep the tight flatten (newline/control collapse) for injection safety but don't clip the content the producer needs.

[PROMPT-15] [Severity: Minor] [Effort: <1day] [Value: Med]
Premiere prescribes 15 sequential self-introductions with no format-variety guidance → flat roll-call
- Where: momentPrompts.ts:582-595 — "go person by person until the player has met ALL FIFTEEN… Each houseguest introduces their PUBLIC self — name, where they're from, what they do, one real thing."
- Problem: The premiere is where "15 strangers become distinct people" — the vision's second act. But the prescribed mechanism is a uniform template (name/from/job/one-thing) applied 15 times, which is exactly the "room of identical professionals" failure (:250-255) at the moment it matters most. Fifteen structurally-identical intros in a row read as a checklist, not a cast reveal. This is where PROMPT-2 (voices left to chance) bites hardest.
- Fix: Direct the model to VARY the introduction FORM by demeanor: a loud one grabs the floor, a shy one gets coaxed or introduced by a neighbor, a strategist deflects, a comic riffs — grounded in each STILL-TO-MEET line's demeanor/voice. Introductions should demonstrate difference, not recite a template.

[PROMPT-16] [Severity: Minor] [Effort: multi-day] [Value: Med]
The OOC `((double-parentheses))` convention is a fragile prose contract carrying load-bearing rendering weight (I9)
- Where: momentPrompts.ts:199-204 (model must wrap its ENTIRE reply in `((…))` for OOC answers; the FE renders wrapped text as a producer aside). The casting prompt adds a whole sub-rule against half-wrapping ("renders broken", :476-482).
- Problem: A core I9 behavior (OOC/HUD asides rendered outside the fiction) rests entirely on the model emitting perfectly-balanced parentheses around the whole reply. A forgotten or half wrap makes an OOC logistics answer render as SPOKEN narration (the house "hears" a HUD answer) or an in-character line render as a muted aside. The mandate says structural, not prose-wording, enforcement — yet this is pure wording, and the model must get it byte-perfect every OOC turn.
- Fix: Longer-term, give OOC answers a structural channel (a dedicated field/tool the FE renders as an aside, like the reasoning channel split) rather than depending on parenthesis matching. Short-term, add an FE normalizer that detects a leading `((` without a closing `))` (or `ooc:` prefix) and renders the whole reply as an aside.

[PROMPT-17] [Severity: Minor] [Effort: <1day] [Value: Med]
Full roster detail for all 15 houseguests is rebuilt into context every turn, including the off-screen
- Where: renderGameContext:887-926 — each active houseguest gets age + physicalLook + presentation + genderPresentation + pronouns + demeanor + vocation + hometown + background + biography + the archetype cue.
- Problem: ~10 facets × 15 houseguests is a large recurring block, and most of it is irrelevant to a turn where only the 2–4 people in the room matter (whereabouts already scopes presence). It compounds PROMPT-1's bloat and buries the people who ARE present under a wall of the people who aren't. The departed are already correctly reduced to name+seat (:889) — the same discipline isn't applied to off-screen actives.
- Fix: Give FULL detail only for houseguests in `present`/`nearby` (+ the player); reduce off-screen actives to name + a one-line voice/demeanor anchor. Keep the whole-cast names visible (grounding) without the whole-cast dossier every turn.

[PROMPT-18] [Severity: Minor] [Effort: <1day] [Value: Med]
"THE RECORD" is injected only on re-entry/recap — live turns carry no season-long memory (I5)
- Where: renderStoryFacts:1081-1102 is called for server-initiated lifecycle beats (re-entry, recap). Normal live turns (apply_game_framing game-active path) build the moment prompt + game context but do NOT append THE RECORD.
- Problem: Mid-session continuity relies entirely on the chat window + npcVoice's per-HG knows/suspects. In a long single session, once early-season events scroll out of the context window there is no recall injection — the "house still remembers" (I5) silently degrades to "the house remembers what's in the last N messages." The store IS recalled at re-entry, but not refreshed into a long live session.
- Fix: On live turns, append a compact recalled-record digest (the same recorded-events source, budget-capped, most-salient-first) so long sessions retain early-season memory in-context, not just recent chat.

[PROMPT-19] [Severity: Minor] [Effort: <1day] [Value: Med]
Forced `tool_choice:"required"` at comp phases can over-force on staged / non-binding comp-round turns
- Where: agent_loop.py:1519-1526; `_FORCE_COMP_PHASES = {"hoh-competition","veto-competition"}` (:1486). The gate forces `"required"` whenever no `{runCompetition, advanceGame}` fired THIS turn and no player pending is open.
- Problem: A staged competition resolves ONE roll up front and then plays out as presentation-only `comp-round` beats (per CLAUDE.md, only the first approach binds; later rounds are inert flavor). During those later flavor turns the phase is still "hoh-competition" and the model may legitimately just narrate a round — but because no comp tool fired this turn, the gate forces `"required"`, compelling an unwanted engine call mid-presentation. This corroborates the prior "ceremony montage / forced-tool_choice runway collapse" from a different angle: forcing keys on phase, blind to the staged `binding` flag.
- Fix: Suppress forcing once the comp winner has already been read for this beat (track a per-beat "comp resolved" flag, not just per-turn tool names), or exclude non-binding staged comp-round turns from `_FORCE_COMP_PHASES` forcing.

[PROMPT-20] [Severity: Minor] [Effort: <1hr] [Value: Med]
castPhoto can wedge the `next`-step into a photo nag-loop unless the FE writes castPhoto="skipped"
- Where: castingIntake.ts:55-73 (castPhoto is COVERAGE step #1; `next` = first uncaptured field, castingStatusOf:216-224). momentPrompts.ts:542-544 tells the producer the photo "leaves the CASTING STATUS" only "once it's handled (uploaded OR skipped)."
- Problem: `next` keeps pointing at castPhoto until it is captured. If the player ignores the photo and just starts answering questions, and the FE has NOT written castPhoto="skipped", the engine's NEXT STEP stays "their cast photo" every turn — so the producer is instructed to keep raising the photo while the prompt simultaneously says "don't push past a clear 'no'." The producer is caught between the engine's `next` and the no-nag rule; the player experiences a repeated photo ask.
- Fix: Make `next` skip the OPTIONAL castPhoto once any subsequent field has been captured (i.e. don't let an optional step hold the pole position), and/or ensure the FE reliably writes castPhoto="skipped" the moment the player moves on. Decouple the optional step from the ordered `next`.

[PROMPT-21] [Severity: Minor] [Effort: <1day] [Value: Med]
I7 (the house schemes without you — priority #1) is under-served by the narration guidance
- Where: The player's window into off-screen life is `conspicuous`/whereabouts (renderGameContext:433-434), socialRead (:372-373, "may hint at unease but never names off-screen events"), and confide/surfaceInformationTo. The `social` moment (:715-730) mentions "off-screen scheming the player half-glimpses" but gives no method.
- Problem: Off-screen NPC-to-NPC life is behavioral-fidelity priority #1, and it EXISTS in the engine — but the prompt gives the model almost no positive direction to make the player FEEL the house living without them. The levers to leak distorted intel along legitimate pathways (gossip/confide) exist, yet nothing coaches the model to proactively wield them so the player senses coalitions forming, catches a half-rumor, or notices two people who were tight now cold. The result is a house that schemes in the engine but reads as inert to the player.
- Fix: Add positive guidance to the social/default moments: proactively surface the living house through legitimate pathways — an ally hints at a conversation the player missed (confide), a rumor reaches them distorted (surfaceInformationTo/gossip), a `conspicuous` pair is noticed. Make "the house schemes without you" observable, within the Vault Wall.

[PROMPT-22] [Severity: Minor] [Effort: <1hr] [Value: Low]
physicalLook is fed for every houseguest every turn while the rules say "appearance once, then behavior"
- Where: renderGameContext:905 puts each houseguest's full physical description in the roster on every turn; momentPrompts.ts:314-317 tells the model to describe a body only on first appearance and then stop.
- Problem: The context keeps the physical look in front of the model constantly, which tempts the very re-description the prose rule forbids (and which the cast portrait already supplies). Mild self-contradiction between what the context feeds and what the rules ask.
- Fix: Lead the roster line with demeanor/voice; keep physicalLook but tag it "(portrait already shows this — voice on first appearance only)", or drop it for houseguests not in the room this turn (folds into PROMPT-17).

[PROMPT-23] [Severity: Minor] [Effort: <1hr] [Value: Med]
The web_search real-world-flavor instruction is a pacing/derail vector at the narrator
- Where: momentPrompts.ts:230-237 ("you may QUIETLY use the web_search tool… weave what you learn into that houseguest's own voice").
- Problem: web_search IS wired in the FE, so this is live. But inviting the narrator to search whenever the player references a film/artist/news story adds latency to a chat that's meant to feel like a live feed, and hands the player a lever to derail the game into trivia (ask about real things, model searches, pacing stalls). It also risks the model leaking that it searched. The payoff (flavor) is small versus the derail/latency/leak cost, and it's a rule tuned for a general workspace, not this game.
- Fix: Either gate web_search off for the narrator (improvise real-world flavor in character — the prompt already says to when search is unavailable) or tighten the rule to "rare, one-shot, never mid-beat" and confirm the reasoning-scrub covers any search mention.

[PROMPT-24] [Severity: Minor] [Effort: <1hr] [Value: Med]
Injected "(Production note, not for the player.)" belt text is a leak surface the reasoning-scrub may not catch
- Where: agent_loop.py:1578-1582 (_FORCED_ADVANCE_NUDGE), 1604-1611 (eviction-reveal steer), 1437-1451 (advance nudges), 2461-2474 (faith directives). These are appended to tool results / prompt stream mid-turn.
- Problem: These notes are literal English that names the machinery ("the game has been advanced for you", "call gameStatus/getGameState NOW", "advanceGame"). They rely on the model treating them as private steering. A weak turn that quotes or paraphrases a production note into the visible body leaks the machinery (I9) in plain language — and "(Production note…)" / "advanceGame" is not obviously covered by the reasoning-channel scrub (which targets `npc:<id>` / operator-aside patterns). One parroted note breaks the fiction.
- Fix: Add "(Production note" / bare-lever-name patterns to the FE body scrub (markdown.js processWithThinking) as a structural backstop, and phrase the notes to minimize machinery vocabulary the model might echo.

[PROMPT-25] [Severity: Minor] [Effort: <1day] [Value: Med]
`_pre_emission_outcome_guard` can silently DROP a legitimate conditional/hypothetical outcome sentence
- Where: agent_loop.py:3009-3030 — any sentence matching `_sentence_has_closed_set_claim` that fails `screen_streamed_outcome` is dropped before emission (:3013-3015).
- Problem: The classifier fires on closed-set language (names + safe/nominated/evicted/won). A houseguest's HYPOTHETICAL or CONDITIONAL line ("if they put you up, you're not safe", "imagine if she won HOH") contains that language but asserts no committed board state — yet the async screen (which checks the board) can judge it unsupported and DROP it mid-stream, leaving a jarring gap in otherwise-live narration. This is a suppression belt eating real creative/strategic prose (an I9/C4-adjacent over-correction), the inverse of the sanctioned "drop a phantom outcome."
- Fix: Have the closed-set classifier (or the screen) exempt conditional/subjunctive framing (if/would/could/imagine/what-if) so only ASSERTED committed outcomes are screened; conditional strategy talk streams untouched.

[PROMPT-26] [Severity: Minor] [Effort: <1day] [Value: Med]
Memory recall is never coached in-voice — "the house remembers" reads as flat facts, not lived history
- Where: renderStoryFacts:1086-1087 hands the model a bare bullet list ("- <event>") with "voice these, never invent others." No guidance to recall them AS a houseguest's lived memory with emotional continuity.
- Problem: I5's whole point is that persisted detail should ACCUMULATE and DEEPEN and pay off — the house recalling a promise kept, a betrayal, a week-2 slight in week 8 is the emotional dividend of non-degradation. But the model gets the record as inert facts, so recall comes out as recap ("earlier, X won HOH") rather than lived grudge/loyalty ("you still owe me from that vote"). The payoff of the whole persistence architecture is left un-directed.
- Fix: In renderStoryFacts (and npcVoice guidance), direct the model to voice recalled events as the SPEAKER'S lived memory — grudges, debts, and loyalties carried forward — not a neutral recap. Coach continuity as character, not chronology.

[PROMPT-27] [Severity: Minor] [Effort: <1day] [Value: Med]
Casting's anti-gushing + short-turn rules risk a COLD, transactional interview vs. the "being cast" warmth (C4)
- Where: momentPrompts.ts:495-499 ("NO gushing… A crisp 'good' or 'got it'… Keep your turns short").
- Problem: These rules correctly kill sycophancy — but pushed together (no praise + short turns + "not your buddy") they tilt toward a clipped interrogation. The vision wants casting to "feel like being *cast*" — an electric, flattering-by-being-taken-seriously experience — not a form filled out by a bored gatekeeper. Anti-sycophancy shouldn't cost all warmth; there's tension here with no resolution given to the model.
- Fix: Add the missing warmth vector that isn't flattery: direct the producer to occasionally reflect a sharp READ of the player back ("so you're the type who'd cut your closest ally at final four — noted"). Insight, not praise, is what makes a player feel truly cast, and it stays anti-sycophantic.

[PROMPT-28] [Severity: Minor] [Effort: <1hr] [Value: Low]
The casting headshot block is 15 lines of anxious UI negative-instructions bloating the producer persona (C2)
- Where: momentPrompts.ts:535-547 — "NEVER invent on-screen directions… do NOT say it is 'on your right/left', call it a 'panel', or claim it reads 'Casting headshot'… refer to it by that exact name and nothing else."
- Problem: A third of the casting prompt's opening is defensive plumbing against the model inventing UI chrome. It leaks C2 (workspace machinery worry) into the producer's persona and spends the interview's scarce attention on button semantics instead of interview craft. It's brittle too — it hard-codes the exact control label.
- Fix: Compress to one line ("send them to the Choose Your Character control shown in chat; don't describe its placement"). Folds into PROMPT-4's reorder.

[PROMPT-29] [Severity: Minor] [Effort: <1hr] [Value: Med]
Premiere introductions can repeat if markHouseguestMet lags the narration
- Where: momentPrompts.ts:592-595 ("the instant a houseguest has introduced their public self, call markHouseguestMet"); the STILL-TO-MEET list (renderGameContext:1027-1033) only shrinks when the mark fires.
- Problem: The list-driven design exists precisely to fix the skipped/repeated-introductions bug, but it depends on the mark firing synchronously with each intro. The narrator under-calls tools (the reason the auto-belt exists); if it introduces three people in one turn and marks zero, the next turn's context still lists all three as STILL TO MEET — inviting re-introduction, the exact bug the list was meant to prevent. The belt corrects it eventually but not within the same premiere turn.
- Fix: Have the auto markHouseguestMet belt scan the turn's narration for STILL-TO-MEET names actually introduced and mark them before the next context build — so the list reflects the turn's intros even when the model didn't mark.

[PROMPT-30] [Severity: Minor] [Effort: <1day] [Value: Med]
All-caps prohibition-heavy framing tuned for DeepSeek may over-suppress GLM-4.7 and flatten narration (C1)
- Where: momentPrompts.ts:108-134 (FLAVOR vs OUTCOMES: "the single worst break… steals the game… quietly cheats the player"), and the general register throughout ("STOP.", "NEVER", "HARD RULE").
- Problem: The prompt's aggressive, fear-based tone was calibrated against DeepSeek-v4's failure modes (under-calling, montaging, inventing outcomes). ADR 0016 swapped to GLM-4.7 — a stronger instruction-follower and the #1 open-weight creative writer — betting it needs fewer belts. But the prompt's threatening register is unchanged, and on a compliant creative model, wall-to-wall "the worst thing you can do" priming produces cautious, hedged, generic prose — the opposite of the paranoid-intimate texture the vision wants. The tuning is stale for the new model.
- Fix: Rebalance tone now that the model is stronger: keep the hard invariants firm but strip the catastrophizing rationale, and add positive craft direction (what GOOD looks like) to counterweight the prohibitions. Re-measure narration richness on GLM-4.7 with a lighter prompt (the ADR's owed A/B is the vehicle).

[PROMPT-31] [Severity: Polish] [Effort: <1hr] [Value: Low]
Showmance voicing is fully gated on `view.showmances` — verify the projection actually populates it
- Where: renderGameContext:1052-1054 ("voice romance for THESE pairs only"); the SHOWMANCES ARE RARE rule (:264-271) forbids voicing romance otherwise. `showmances` is defined in the port and produced from seededRelationships.
- Problem: Correct-by-design (romance only when surfaced), but it means the entire showmance storyline is invisible to the narrator unless `view.showmances` is populated end-to-end. If the projection/write-back ever drops it (the recordCastProfile/recordWorldSnapshot silent-no-op class), a seeded showmance simply never surfaces and the player never sees a romance all season — with no error.
- Fix: Add a boundary check that a seeded/developed showmance actually reaches `GameStateView.showmances` the model reads (a test dispatching through the view), so this can't silently no-op like prior write-backs.

[PROMPT-32] [Severity: Polish] [Effort: <1hr] [Value: Low]
The `default` moment fragment is thin for any unmapped engine phase
- Where: momentPrompts.ts:794-796; momentForPhase:800-812 routes any unrecognized phase to `default`.
- Problem: If an engine phase string doesn't match the keyword heuristics, the model gets almost no beat-specific guidance ("Continue the game… pull the lever the beat calls for"). Low probability, but a new/renamed phase silently degrades to generic narration with no beat framing.
- Fix: Make `default` self-orienting (tell the model to read gameStatus + pending and name the beat before narrating), and add a dev assertion that every engine phase maps to a non-default moment.

[PROMPT-33] [Severity: Polish] [Effort: <1hr] [Value: Low]
Casting vs. live-game OOC conventions mismatch across the seam
- Where: momentPrompts.ts:476-482 (casting: "PLAIN PROSE, NO OOC WRAP") vs :199-204 (live game: wrap OOC answers in `((…))`).
- Problem: The two adjacent phases use opposite OOC conventions. A logistics question during casting ("how long does a season take?") gets plain prose; the identical question in-game gets a wrapped aside. The model must switch conventions exactly at createCharacter, and the transition turn (the reveal → premiere) is where it's most likely to carry the wrong habit — a `((wrapped))` casting line or an unwrapped in-game aside.
- Fix: Note the switch explicitly at the casting→premiere handoff ("from here on, OOC answers wrap in `((…))`"), so the convention change is stated at the seam rather than inferred.

---

## Coverage / where I looked
- READ IN FULL: momentPrompts.ts (all 1128 lines), portraitPrompts.ts, castingIntake.ts, token_policy.py, ADR 0016, settings.py reasoning/max_tokens seeds.
- READ NARROWLY (grep-then-read the belt bodies): agent_loop.py `_forced_tool_choice_for_beat`, `_auto_record_scene`, the `_ADVANCE_NUDGES` ladder + grace, L39b forced advance, eviction-reveal steer, faith directives, `_pre_emission_outcome_guard`, `_record_sync_ledger_turn`; chat_helpers.py `apply_game_framing` (the framing/barrier/checkpoint stack).
- VERIFIED: web_search IS wired in the FE (many modules); showmances IS plumbed through the port + adapters (so PROMPT-31 is a verify-the-edge flag, not a confirmed drop).
- NOT deeply covered (out of lane / would need runtime): the FE render/scrub JS internals (markdown.js processWithThinking exact regex — flagged as a dependency in PROMPT-16/24 but not audited line-by-line); the actual GLM-4.7 output quality (no probes run — ADR's owed A/B is the right vehicle); npcVoice's engine-side construction (0084/0088/0105 field content); the desync/faith belts' P3/P4 correction paths beyond the shadow-mode read.
- No live GLM probes were run — every finding is a static read of prompt-as-design; PROMPT-2/3/13/30 are the ones most worth confirming against a real-model A/B.

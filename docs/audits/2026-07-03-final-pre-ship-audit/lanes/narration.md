# NARRATION-FIDELITY LANE — Orwell pre-ship audit v2 (GLM-4.7 / ADR 0016)

Lens: narration as a grounding/faithfulness problem — never contradict/invent/omit engine state,
stay in-persona/in-bounds, never leak machinery or reasoning tokens, degrade gracefully without
desync or loop stalls. NEW findings only (dedupe vs J-1..J-13 + v1 index); several corroborate a
prior finding with a DEEPER mechanism (allowed — raises priority). Live GLM-4.7 probes via OpenRouter
(reasoning=low, tiny max_tokens) reproduced two mechanisms; cited inline.

Model in the run (bundle): `z-ai/glm-4.7`, endpoint openrouter, reasoning narration=**low**,
max_tokens_budget narration=**4096**, embeddings=**fake**, gameBuild=on.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| NARR-1 | Blocker | <1day | High | Empty-body fallback RE-EMITS raw GLM chain-of-thought into the player bubble | agent_loop.py:3490-3494 |
| NARR-2 | Major | <1hr | High | Seeded narration cap `max_tokens=4096` re-introduces truncation/empty-body (reasoning counts against it) | settings.py:197 |
| NARR-3 | Major | <1day | High | ALL grounding guards are POST-turn re-grounds — the phantom reaches the player for a full turn (no pre-emission guard exists) | chat_helpers.py:1262,1391,1418+ |
| NARR-4 | Major | <1hr | High | Invented-houseguest guard misses copula/existential intros ("X is out in the backyard") + single-name phantoms | chat_helpers.py:1303-1329,1443 |
| NARR-5 | Major | <1day | High | Premiere is EXCLUDED from every forced-ground belt — the highest-stakes grounding beat free-narrates the room | agent_loop.py:1489; momentPrompts premiere |
| NARR-6 | Major | <1hr | Med | Casting turns: reasoning=medium + max_tokens=2048 → the J-11 mid-intro truncation root | settings.py:178,199 |
| NARR-7 | Major | <1day | Med | NPC-HOH nominations self-advance ORPHANS the rich `nominations` moment prompt (only a terse steer drives the ceremony) | momentPrompts.ts:639; agent_loop.py:1631 |
| NARR-8 | Minor | <1hr | Med | Streaming mid-sentence truncation (finish_reason=length, non-empty) has no game-mode Continue-stitch | agent_loop.py:3458-3501 |
| NARR-9 | Minor | <1hr | Med | Empty-turn producer line names a "feed glitch" — an I9 machinery tell + blames the player | agent_loop.py:3448 |
| NARR-10 | Minor | <1hr | Med | `default_model_fallbacks: []` → GLM failure yields a raw `{"error":...}` frame to the player (breaks I9) | settings.py:249; agent_loop.py:4478 |
| NARR-11 | Minor | <1hr | Med | Reasoning-leak scrub regex misses GLM CoT openers ("Wait,", "Hmm,", "Actually,", "The player…") | markdown.js:168 |
| NARR-12 | Minor | <1hr | Low | Model-aware output cap is Claude-only (`_ANTHROPIC_OUTPUT_CAPS`) — GLM falls to the 8192 floor | llm_core.py:607-624 |
| NARR-13 | Minor | <1hr | Low | `_supports_thinking` excludes glm; inline `<think>` split only fires at content start → mid-stream think can leak | llm_core.py:644-651,2138 |
| NARR-14 | Minor | <1hr | Med | Deterministic/fake embeddings degrade in-voice memory recall (I5) — recall is recency, not semantics | health.embeddings; env ORWELL_EMBEDDINGS |
| NARR-15 | Minor | <1day | Med | No belt forces `npcVoice` before voicing a houseguest — voice-fingerprint/mood/stressTell silently skipped (I6 drift) | momentPrompts.ts:374; agent_loop belts |
| NARR-16 | Minor | <1hr | Low | Eviction staged-ballot reveal only renders when advanceGame returns the beat — a model that jumps the result skips E12 | agent_loop.py:1598 |
| NARR-17 | Minor | <1hr | Low | No outcome-guard branch for the injected headcount — a wrong "N remain" leaks uncaught | chat_helpers.py:1148; momentPrompts.ts:1045 |
| NARR-18 | Minor | <1hr | Low | GLM narration emits bracketed stage-directions + bold speaker labels ("**Regina:** [she…] \"Hey.\"") — script tell | probe evidence; base prompt VOICE block |
| NARR-19 | Polish | <1hr | Low | Prompt "one reply is fully IC or fully-wrapped" contradicts the two-bubble `((aside))+prose` splitter | momentPrompts.ts:203; markdown.js:226 |
| NARR-20 | Polish | <1hr | Low | Wrong-phase phantom outcomes are deliberately unpoliced — "you're the new HOH" in a lull escapes | chat_helpers.py:1217-1235 |
| NARR-21 | Polish | <1hr | Low | Forced-advance belts + engine self-advance compound the montage they can't see | agent_loop.py:1494-1529 |
| NARR-22 | Minor | <1hr | Low | `renderStoryFacts` re-entry facts are uncapped/unaged — a long season can overflow the tight narration cap | momentPrompts.ts:1081-1102 |

---

## Findings (full schema)

### [NARR-1] [Blocker] [Effort:<1hr] [Value:High] — Empty-body fallback re-emits raw GLM chain-of-thought into the player-visible bubble
- **Where:** `frontend/src/agent_loop.py:3490-3494` (`_empty_response_fallback`, FEPY-2 branch).
- **Problem (I9, the worst leak class):** When the model returns an empty `content` but non-empty
  `round_reasoning`, the fallback does `return round_reasoning, {"delta": round_reasoning}, False` —
  it streams the RAW REASONING as a non-thinking body delta the player reads as the GM's reply. The
  branch's premise ("a thinking model routed the ANSWER into reasoning_content, likelier on Flash")
  is DeepSeek-shaped and **wrong for GLM-4.7**: GLM's `reasoning` channel is genuine interleaved
  chain-of-thought ("The player wants to pull Lorenzo aside. Is the hallway private? The nominees are
  here, so… let me call whereabouts"), NOT a misrouted answer. Re-emitting it dumps operator/machinery
  planning straight into the public bubble. The only defense is `markdown.js scrubReasoningPreamble`,
  which is a LEADING-line/preamble stripper (NARR-11) — it cannot scrub a multi-paragraph CoT whose
  interior lines don't open with an operator phrase, so most of the dump renders.
  **Live evidence:** at `max_tokens=700, reasoning=low` a plain 3-line greeting turn returned
  `finish_reason=length` with `content_len=0` while reasoning was populated — exactly the empty-body +
  reasoning-present state that triggers this branch (probe, this session). GLM burns ~1200 reasoning
  tokens even at effort=low (usage `reasoning_tokens:1204`), so the empty-body state is reachable on
  any budget-tight turn, not a rare edge.
- **Fix:** In `game_mode`, do NOT re-emit `round_reasoning` as body. Treat empty-body+reasoning the
  same as true-empty: emit the in-character retry line + a `truncated` affordance, and/or retry the
  turn with a larger `max_tokens`. Reserve FEPY-2's reasoning-recovery for the specific non-reasoning
  models it was written for (gate on model family, not "reasoning present").

### [NARR-2] [Major] [Effort:<1hr] [Value:High] — Seeded narration `max_tokens=4096` re-introduces the truncation/empty-body vector the token_policy default was built to avoid
- **Where:** `frontend/src/settings.py:196-197` (`max_tokens_budget.narration = 4096`).
- **Problem (grounding/UX):** `token_policy._DEFAULT_MAX_TOKENS["narration"]` is deliberately `None`
  ("use the model-aware default; a flat 4096 truncated narration mid-reply — the #620/#835 warning").
  But the shipped `DEFAULT_SETTINGS` seed overrides narration back to a hard **4096** — and an explicit
  in-band `max_tokens_budget` override WINS over the None default (the file states this for
  background-authoring at line 200-203). On OpenRouter, GLM-4.7 reasoning tokens count against
  `max_tokens`: my probe at a 700 cap returned `finish_reason=length` with EMPTY visible content
  (reasoning consumed it), and at a 2000 cap spent 1204 tokens on reasoning before ~120 visible. On a
  heavy premiere multi-intro or a J-2-style tool-heavy turn, reasoning + a long GLM narration blows
  4096 → mid-sentence truncation (J-11) or, on a reasoning spike, an empty body → NARR-1. The
  carefully-reasoned `None` default is DEAD because of this seed.
- **Fix:** Set `max_tokens_budget.narration` (and `casting`, see NARR-6) to `None`/omit in the seed so
  the model-aware cap stands, OR raise narration to a GLM-appropriate ceiling that leaves visible
  headroom AFTER reasoning (e.g. 12-16k). Verify on the wire that reasoning+visible fits.

### [NARR-3] [Major] [Effort:<1day] [Value:High] — Every grounding guard is POST-turn (next-turn re-ground); the phantom is shown to the player first — there is no pre-emission guard
- **Where:** `chat_helpers.py` `record_post_turn_desync_check` (:1262), `record_post_turn_presence_check`
  (:1391), the NARR-3/#613 invented-houseguest backstop (:1418+). All three stash a directive into
  `_DESYNC_REGROUND[dkey]` consumed on the NEXT turn.
- **Problem (I2/I6 + doc mismatch):** CLAUDE.md and the VISION_BRIEF assert "a pre-emission outcome
  guard corrects a phantom board claim BEFORE the player sees it." The actual streaming path has NO
  pre-emission check — narration streams token-by-token to the DOM live, and the guards only diff the
  after-signature once the turn has FINISHED, re-grounding the following turn. So a phantom eviction,
  a phantom HOH, or a hallucinated houseguest (J-1) is fully rendered and read by the player, who can
  act on it for an entire turn before the correction lands. This is precisely the J-1 gaslight loop
  ("the game told me Audrey was there, then said I mixed up names"): the invention shipped, the
  re-ground fired a turn late. A post-hoc guard cannot satisfy "never contradict engine state" for the
  turn in which the contradiction is displayed.
- **Fix:** Either (a) buffer the closed-set-claim sentences and run `_narration_claims_outcome` before
  releasing the final frame at a ceremony/eviction beat (accept the latency at those few beats), or (b)
  make the docs honest that grounding is next-turn reconciliation, and pair it with the pre-ground
  belts (NARR-5) so the phantom is prevented upstream rather than corrected downstream.

### [NARR-4] [Major] [Effort:<1hr] [Value:High] — The invented-houseguest backstop misses the most common introduction phrasing (copula/existential) and single-name phantoms
- **Where:** `chat_helpers.py:1303-1329` (`_SCENE_VERBS` / `_stages_in_scene`), `:1443`
  (`_TWO_TOKEN_NAME_RE`).
- **Problem (I6):** NARR-3/#613 only flags a **two-token Capitalized name** bound to a verb in
  `_SCENE_VERBS`. That list is all action/speech verbs (says, leans, grins, perches…) and deliberately
  EXCLUDES the copula "is/was/are" and existential "there's/there is". J-1's exact phantom —
  *"through the glass door, Audrey Duran **is** out in the backyard"* — matches neither the verb-pat
  ("is" absent) nor the quote-pat (no quote), so even the two-token backstop never fired. Introductions
  are overwhelmingly copular ("X is a nurse from Ohio", "there's a woman named Audrey by the pool"), so
  the guard is blind to the exact shape a fabricated houseguest takes at the premiere. Separately, a
  phantom introduced by first name only ("Audrey drifts over") is single-token and never matched at all.
- **Fix:** Add copula/existential binding to `_stages_in_scene` (`\bName\b\s+(is|was|are|'s)\b` and a
  `there(?:'s| is| was) ... Name` pattern), and add a single-token check for a Capitalized first name
  NOT present as any roster first-name that is bound to a scene verb OR copula. Keep it post-turn-safe
  by whitelisting the roster first names.

### [NARR-5] [Major] [Effort:<1day] [Value:High] — The premiere is excluded from every forced-ground belt, so the tutorial's "strangers become people" beat free-narrates the room ungrounded
- **Where:** `agent_loop.py:1489` (`_forced_tool_choice_for_beat` — "premiere/finale/twist-reveal are
  deliberately EXCLUDED"); premiere fragment `momentPrompts.ts:568-631` (grounding is prompt-wording
  only); no `_whereabouts_barrier` gate before the first premiere beat.
- **Problem (I2/I6):** The one beat the whole architecture exists to nail (15 strangers become distinct
  people) is the ONE beat with no structural pre-ground. The prompt tells the model "Call whereabouts
  BEFORE you describe ANY room" and "NAMES ARE FIXED" — pure wording, which the mandate says never to
  rely on. GLM under-calls levers (C1 ~0% spontaneous), so it narrates the backyard before reading
  whereabouts/premiereIntros and hallucinates a houseguest (J-1). Forced tool_choice is available and
  GLM honors it (verified for eviction/HOH), but premiere is opted out.
- **Fix:** Add a premiere-first-beat belt: force a `whereabouts` (or `premiereIntros`) tool_choice on
  the opening premiere turn before any room narration is allowed to stream, and gate the first
  descriptive frame on having the real present-set. This is the missing structural enforcement of the
  "most important grounding rule."

### [NARR-6] [Major] [Effort:<1hr] [Value:Med] — Casting turns run reasoning=medium under a 2048 cap — the direct root of J-11's mid-intro truncation
- **Where:** `settings.py:178` (`reasoning_budget.casting = "medium"`), `:199`
  (`max_tokens_budget.casting = 2048`).
- **Problem:** Casting narration (the premiere hand-off that voices multiple houseguest intros in one
  turn) runs at reasoning=**medium** — heavier than narration's low — under a hard **2048** output cap.
  Medium reasoning on GLM easily burns 1.5-3k tokens; with visible intros competing for the same 2048,
  the 5th intro truncates mid-sentence (J-11's "…despite the"). Medium is also unnecessary for casting
  interview turns (short Q&A) and inflates latency on the very first impression a new player gets.
- **Fix:** Drop casting reasoning to "low" and raise/None the casting `max_tokens` seed; or cap
  voiced-intros-per-turn so a single turn never needs >2048 visible tokens.

### [NARR-7] [Major] [Effort:<1day] [Value:Med] — On an NPC-HOH week the engine self-advances past `nominations`, orphaning the rich nominations moment prompt; only a terse steer voices the ceremony
- **Where:** `momentPrompts.ts:639-654` (the well-written `nominations` fragment), `momentForPhase`
  (:800-812), `agent_loop.py:1631` (`_ceremony_narration_steer`, whose comment documents the
  self-advance: "the engine emits one `nominations` beat and SELF-ADVANCES the phase to
  `veto-competition` in the same call").
- **Problem (I2/C3 + J-3 mechanism):** Because `advanceGame` returns the nominations beat but the phase
  has already rolled to `veto-competition`, `momentForPhase(phase)` never lands on the "PLAY THE
  CEREMONY AS A LIVE SET-PIECE" nominations fragment — the model gets the veto-competition fragment
  instead. The only thing driving the nomination ceremony is the terse F8 `_ceremony_narration_steer`
  production note. So the carefully-authored set-piece guidance is dead on NPC-HOH weeks, the ceremony
  collapses into color, and (with the veto phase already active) the model is nudged straight toward
  the next beat — the montage J-3 saw. This is an ENGINE self-advance root, not just model greed.
- **Fix:** Have the engine surface the ceremony beat WITHOUT self-advancing the phase (hold at
  `nominations` until the ceremony is voiced/advanced), OR route the moment prompt off the returned
  BEAT kind rather than the already-rolled phase, so the nominations fragment reaches the model.

### [NARR-8] [Minor] [Effort:<1hr] [Value:Med] — Mid-sentence truncation (finish_reason=length, non-empty body) has no game-mode continuation
- **Where:** `agent_loop.py:3458-3501` (`_empty_response_fallback` only handles the EMPTY-body case).
- **Problem:** When GLM hits the 4096 cap with a non-empty but cut-off body ("…a boyish grin that
  hasn't quite faded despite the"), there is no game-mode auto-continue/stitch — the turn just ends
  mid-word. The `truncated` retry affordance is wired only for the TRUE-empty branch. The player is
  left with a dangling sentence and no one-tap recourse.
- **Fix:** Detect `finish_reason=="length"` with non-empty body in game mode and either auto-issue a
  Continue turn (append the partial as assistant context, request the remainder) or surface the same
  `truncated` affordance the empty branch uses. Best paired with NARR-2 (raise the cap).

### [NARR-9] [Minor] [Effort:<1hr] [Value:Med] — The empty-turn producer line names a "feed glitch" (I9 machinery tell) and blames the player
- **Where:** `agent_loop.py:3448` — `_EMPTY_PRODUCER_LINE = "Production's feed glitched for a second
  there — we lost what just came through. Say that again?"`.
- **Problem (I9):** The BASE prompt explicitly bans referencing "a glitch/bug/loading/refresh, or ANY
  technical problem" in anything the player sees — yet the model-failure fallback line itself says the
  "feed glitched," a direct machinery/technical acknowledgment breaking the fiction at the worst
  moment. It also puts the burden on the player ("Say that again?") after the MODEL failed and (per
  J-2) a 60s+ wait — the player did nothing wrong and has nothing to repeat.
- **Fix:** Reword to a clean diegetic cut that doesn't name a glitch and doesn't demand the player
  re-type ("The feeds hold on the room for a beat, then production picks the moment back up…") and
  drive the retry from the affordance, not a request to the player.

### [NARR-10] [Minor] [Effort:<1hr] [Value:Med] — No fallback model → a GLM failure surfaces a raw error frame to the player
- **Where:** `settings.py:249` (`default_model_fallbacks: []`); `agent_loop.py:4478`
  (`yield {"error": str(err_msg)}`).
- **Problem (I9 / degrade-gracefully):** ADR 0016 describes a fallback chain, but the shipped default
  has none. If GLM-4.7 rate-limits (429), 5xxs, or times out mid-turn, `stream_llm_with_fallback` has
  nothing to fall to and the stream emits an `{"error": …}` frame — an OOC technical error in the
  player's chat, exactly what I9 forbids. On the single seam the ship-gate weighs heaviest, a provider
  hiccup breaks immersion instead of cutting cleanly.
- **Fix:** Seed at least one narration fallback model, and render any terminal LLM error in game mode
  as the diegetic "feeds hold, production picks it back up" cut (NARR-9's reworded line), never a raw
  error string.

### [NARR-11] [Minor] [Effort:<1hr] [Value:Med] — The plain-content reasoning-leak scrub misses common GLM CoT openers
- **Where:** `frontend/static/js/markdown.js:168` (`_REASONING_LINE_RE`).
- **Problem (I9):** The line-anchored operator-phrase alternation covers "let me / i need / i should /
  i'll / first,? i / okay,? so / alright,? so / based on the …" but MISSES the openers GLM-4.7 CoT
  actually uses: "Wait,", "Hmm,", "Actually,", "Let's think", "The player wants/needs…", "Okay, the
  player…", "So the situation is…". Combined with NARR-1 (raw reasoning re-emitted as body), a CoT dump
  whose lines open with these forms sails through the scrub into the public bubble. The scrub is also
  preamble-only, so any operator line after narration begins is reached only by the whole-body pass,
  which requires the same opener list.
- **Fix:** Extend the alternation to include those openers and "the player" (mirroring
  `startsWithReasoningPrefix`'s "the user"); keep the whole-body pass in sync. This is a secondary net —
  the primary fix is NARR-1 (don't emit reasoning as body at all).

### [NARR-12] [Minor] [Effort:<1hr] [Value:Low] — The model-aware output cap is Claude-only; GLM-4.7 falls to the 8192 floor
- **Where:** `frontend/src/llm_core.py:607` (`_ANTHROPIC_OUTPUT_CAPS`), `:616`
  (`_model_max_output_tokens`).
- **Problem:** The "model-aware default" sizing table is literally named for the Anthropic family;
  `z-ai/glm-4.7` matches no needle and returns `_DEFAULT_OUTPUT_TOKENS = 8192`. Today this is masked by
  the NARR-2 4096 override, but the moment an admin clears that override to "use the model default"
  (the documented intent of `None`), narration silently gets 8192 — likely below GLM-4.7's real output
  ceiling and still reasoning-shared. The sizing logic never learned the ADR-0016 narrator.
- **Fix:** Add GLM-4.7 (and the configured fallbacks) to a model-aware caps table with a real ceiling
  that leaves visible headroom after reasoning; rename the table off "Anthropic."

### [NARR-13] [Minor] [Effort:<1hr] [Value:Low] — `_supports_thinking` excludes glm; the inline `<think>` split only fires at content start
- **Where:** `frontend/src/llm_core.py:644-651`, `:2138`.
- **Problem (I9):** `_THINKING_MODEL_PATTERNS` has no "glm", so GLM is not treated as a thinking model.
  The auto-detect that splits an inline `<think>…</think>` out of the content stream is gated on
  `not _first_content_sent and stripped.startswith("<think")` — it only catches a think block at the
  VERY START of content. If a GLM provider variant emits reasoning inline mid-stream (some OpenRouter
  routes fold reasoning into content rather than the `reasoning` field), it won't be split and leaks.
  The channel-routing (`reasoning` field) is the primary defense and mostly holds, but this leaves a
  provider-variance hole with no net.
- **Fix:** Either add glm to `_supports_thinking`, or make the inline `<think>` splitter fire anywhere
  in the stream (not only at content start) under the game build.

### [NARR-14] [Minor] [Effort:<1hr] [Value:Med] — Fake/deterministic embeddings in the run degrade in-voice memory recall (I5)
- **Where:** bundle `health.engine.embeddings.provider = "deterministic"`, `featureFlags.embeddings =
  "fake"`; env `ORWELL_EMBEDDINGS` (deploy default should be `fastembed`).
- **Problem (I5):** The playthrough ran with the deterministic FAKE embedding provider, so semantic
  recall is inert — the house "remembers" via recency/exact-match only, not by meaning. Narration that
  should recall a thematically-relevant earlier scene in-voice ("you told me back on night one you
  don't trust comp beasts") degrades to whatever the recency window carries. If the deploy ships without
  `ORWELL_EMBEDDINGS=fastembed` actually engaging, the accumulate-and-deepen promise thins in the felt
  narration even though persistence is intact.
- **Fix:** Confirm the deploy boots fastembed (health should read `fastembed`, not deterministic);
  fail the boot-smoke if the narrator path is live but embeddings are fake.

### [NARR-15] [Minor] [Effort:<1day] [Value:Med] — Nothing forces `npcVoice` before voicing a houseguest — the voice fingerprint/mood/stressTell is silently skipped (I6 drift)
- **Where:** `momentPrompts.ts:374-393` ("BEFORE voicing a houseguest in a scene, fetch npcVoice");
  no belt in `agent_loop.py` forces it (unlike `whereabouts`, which has a barrier).
- **Problem (I6):** The 0084/0090 voice fingerprint (register, cadence, fillers, `stressTell`) and the
  live `mood`/`currentRead` only reach the model if it calls `npcVoice` — but that call is prompt-wording
  only, and GLM under-calls levers (C1). When skipped, the model voices off the static roster `demeanor`
  clause alone; a probe showed that still yields decent day-one distinctness, but over a season the
  DYNAMIC mood/drift/stress inflection is what keeps two same-archetype houseguests apart and evolves a
  voice under pressure. Without it, voices flatten toward the roster baseline (the "room of identical
  warm professionals" the prompt warns against) and mood never colors the scene.
- **Fix:** Add a soft belt: when a turn stages a houseguest in dialogue and `npcVoice` wasn't called
  this turn, inject a next-turn nudge (or force it at high-stakes scenes). Alternatively fold the voice
  fingerprint + current mood into the roster context so it rides every turn without a call.

### [NARR-16] [Minor] [Effort:<1hr] [Value:Low] — The staged anonymized-ballot reveal (E12) only renders when advanceGame returns the beat; a model that jumps the result skips it
- **Where:** `agent_loop.py:1598` (`_eviction_reveal_steer`) — reactive to an engine reveal beat.
- **Problem (I2 + J-3):** The E12 staged reveal (one anonymized ballot per advance, live-show tension)
  depends on the model calling `advanceGame` per ballot. J-3 saw the model write "the voting has
  finished" and jump to the result — when it does that, `advanceGame` never returns the per-ballot
  reveal beats, so the steer never fires and the designed set-piece is skipped entirely (the season's
  climax reduced to a sentence). The steer error-corrects presence of a beat, not the omission of the
  drip.
- **Fix:** At the eviction phase, drive the ballot drip from the belt side (force an `advanceGame` per
  reveal beat until the result commits, like the eviction-drain allowance) rather than relying on the
  model to walk it; render each ballot as its own beat.

### [NARR-17] [Minor] [Effort:<1hr] [Value:Low] — No outcome-guard branch for the injected headcount — a wrong "N houseguests remain" leaks uncaught
- **Where:** `chat_helpers.py:1148` (`_narration_claims_outcome` covers HOH/noms/veto/eviction/winner/
  tally only); `momentPrompts.ts:1045` injects the exact `remaining` count.
- **Problem (I2):** The context hands the model the exact remaining count precisely because it gets
  arithmetic wrong ("fourteen becomes thirteen"). But if the narration states a wrong count anyway,
  nothing checks it — the desync spine has no headcount branch. A wrong "nine of you left" contradicts
  the board with no re-ground.
- **Fix:** Add a lightweight headcount claim check (regex a stated remaining-count and compare to the
  known `remaining`) to the post-turn desync check, scoped to avoid flavor false-positives.

### [NARR-18] [Minor] [Effort:<1hr] [Value:Low] — GLM narration formats speech as a bracketed screenplay (bold speaker labels + "[stage direction]")
- **Where:** probe evidence (this session): GLM returned `**Regina:** [She doesn't look up from her
  coffee…] "Hey."` — bold speaker labels and bracketed action tags. Base prompt VOICE block
  (`momentPrompts.ts:43-70`) doesn't forbid it (only the casting fragment bans stage directions).
- **Problem (I6/I9 polish):** A bold-name + bracketed-direction script format reads like a screenplay,
  not the immersive live-feed prose the fiction wants, and multiplies markdown-render risk (bold labels
  interacting with the concatenation stutter in J-5). It's consistent enough to be a house style tell.
- **Fix:** Add a one-line VOICE rule to the base prompt: narrate in flowing prose, no bold speaker
  labels, no bracketed [stage directions] — weave action and dialogue into the narration. (Voice
  distinctness itself tested WELL — terse/grandiose/deadpan came through — so this is format, not
  homogenization.)

### [NARR-19] [Polish] [Effort:<1hr] [Value:Low] — Prompt rule "one reply is fully IC OR fully-wrapped OOC" contradicts the two-bubble splitter that supports leading `((aside))` + prose
- **Where:** `momentPrompts.ts:199-204` ("One reply is either fully in-character OR a fully-wrapped OOC
  aside — never both") vs `markdown.js:226-254` (`splitLeadingOocAside` intentionally renders
  `((aside)) + trailing prose` as two bubbles).
- **Problem:** The render layer was built to gracefully handle a leading OOC aside followed by
  in-character prose, but the prompt forbids exactly that shape and calls it "renders broken." The two
  contradict; a model that does the (renderable) split is nonetheless being told it erred, and the
  casting fragment separately warns a leading `((…))` + prose "renders broken" — which the splitter
  fixed. Pick one contract.
- **Fix:** Align the prompt to the render capability (allow a leading OOC aside + IC prose, since the
  splitter handles it), or remove the splitter if the strict rule is intended.

### [NARR-20] [Polish] [Effort:<1hr] [Value:Low] — Wrong-phase phantom outcomes are deliberately unpoliced — "you're the new HOH" narrated in a social lull escapes the guard
- **Where:** `chat_helpers.py:1217-1235` (HOH/nom/veto branches scoped to their own phases "so
  plan/speculation language outside the beat is never policed").
- **Problem (I2):** The scoping is a reasonable anti-false-positive call, but it opens a real hole:
  GLM's classic failure is announcing "you are the new HOH" during a lull BEFORE the comp runs (the
  prompt dedicates a whole paragraph to it). Because the phase isn't an HOH phase yet, the guard treats
  it as flavor and lets it stand — the exact anti-sycophancy break the guard exists for. Prompt-wording
  is the only defense at the moment it matters most.
- **Fix:** For the specific "you are/you're the new HOH / you won HOH" second-person committed claim,
  police it regardless of phase when no HOH crown committed this turn (narrow to committed second-person
  outcome verbs to avoid flavor).

### [NARR-21] [Polish] [Effort:<1hr] [Value:Low] — Forced-advance belts compound the montage they can't detect
- **Where:** `agent_loop.py:1494-1529` (`_forced_tool_choice_for_beat` forces a named `advanceGame`)
  interacting with the engine self-advance (NARR-7).
- **Problem (C1/J-3):** At eviction/HOH beats the belt forces `advanceGame`; because the engine
  self-advances phases (NARR-7) and the eviction-drain allowance lets multiple advances chain in a
  turn, a forced advance can walk several beats in one turn — the belt guarantees grounding but has no
  awareness of the runway/set-piece pacing the vision wants, so it can amplify the montage.
- **Fix:** Cap structural `advanceGame` calls to one ceremony-boundary per turn (except the intended
  eviction-ballot drip), and insert a mandatory runway beat between crown→noms→veto.

### [NARR-22] [Minor] [Effort:<1hr] [Value:Low] — Re-entry `renderStoryFacts` is uncapped/unaged — a long season can overflow the tight narration cap
- **Where:** `momentPrompts.ts:1081-1102` (`renderStoryFacts` emits every `recentWitnessed` event as a
  bullet).
- **Problem (I5 vs NARR-2):** On re-entry the model is handed "THE RECORD" as one bullet per witnessed
  event. The caller selects the set, but if that selection grows with the season, a fat record block
  competes for the same 4096 output cap AND lengthens the prompt on the very turn the player returns —
  raising truncation risk on the re-entry scene that's supposed to re-immerse them.
- **Fix:** Cap/age the recentWitnessed selection to a bounded, most-salient window; rely on
  store-recall (semantic) for depth rather than dumping the full list into the prompt.

---

## Coverage / where I looked
- Read: full `momentPrompts.ts` (base GM prompt + all moment fragments + `renderGameContext` +
  `renderStoryFacts` + `buildSystemPrompt`); the FE belt families in `agent_loop.py` (stall-nudge
  ladder, L39b forced advance, `_forced_tool_choice_for_beat`, `_empty_response_fallback`, eviction/
  ceremony steers, casting fallbacks) and `chat_helpers.py` (pending barrier, whereabouts barrier,
  beat-signature desync spine, presence guard, invented-houseguest backstop); `settings.py`/
  `token_policy.py`/`llm_core.py` token & reasoning budgets and model-aware caps; `markdown.js` render
  scrub + OOC splitter; the debug bundle (model id, budgets, health, embeddings, portraits).
- Live GLM-4.7 probes (OpenRouter, reasoning=low): OOC-wrap compliance (PASS), voice distinctness
  (PASS — terse/grandiose/deadpan distinct), and the truncation/empty-body mechanism (REPRODUCED:
  700-cap → finish_reason=length, empty content; 2000-cap → 1204 reasoning tokens burned).
- NOT covered (other lanes / out of budget): the full `chat.js` stream state machine end-to-end; the
  engine `liveSeason.ts` self-advance internals (inferred from the F8 belt comment — flag for the
  social-game/engine lane to confirm NARR-7); a full multi-week live playthrough to measure voice
  drift across weeks (probe was day-one only); the a11y/latency of the 77s turn (J-2, a11yperf lane).

## Cross-territory flags
- **FE/render lane:** NARR-1 (raw reasoning → body), NARR-8 (no game-mode continue on truncation),
  NARR-11/13 (scrub gaps), NARR-18/19 (script format + OOC-split prompt contradiction).
- **Social-game/engine lane:** NARR-7 (engine self-advance orphans the nominations prompt — confirm in
  liveSeason.ts), NARR-16 (staged-ballot drip), NARR-21 (montage amplification).
- **Config/deploy lane:** NARR-2/6 (max_tokens seeds), NARR-10 (empty fallback chain), NARR-14 (fake
  embeddings in the run — confirm fastembed engages on deploy).
- **A11y/perf lane:** NARR-2/NARR-1 explain the J-2 77s empty turn's model-side mechanism.

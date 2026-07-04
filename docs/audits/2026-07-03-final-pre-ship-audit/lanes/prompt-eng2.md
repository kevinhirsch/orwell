# PROMPT-ENG-2 — the ENTIRE prompt surface as game design (exhaustive pass, audit v2)

Territory: `src/engine/momentPrompts.ts` (all 1129 lines, read in full), the engine prompt-builder
siblings (`producerPersona.ts`, `portraitPrompts.ts`, `zeitgeist.ts` render seam, `castingIntake`
neutralization), `frontend/routes/chat_helpers.py` (apply_game_framing + every injected directive,
full read of the framing/belt region), `frontend/src/agent_loop.py` (full belt inventory, preambles,
scrubbers, guards), `orwell_cast_authoring.py` / `orwell_prewarm.py` / `orwell_zeitgeist.py`,
`token_policy.py` + `settings.py` per-class budgets. 4 live probes against `z-ai/glm-4.7`
(`probe_prompt2.py`; key never printed).

Deduped against v1 PROMPT-1..6 and the ~41-item charter index. Where a v1 finding is corroborated
by new evidence it is marked CORROBORATES, not re-reported.

## Belt inventory (the charter ask): 49 distinct belts/nudges/guards
Framing layer (chat_helpers, 20): FEED_DOWN / PRE_GAME / FALLBACK_GM fallbacks · CASTING_REGISTER_NOTE ·
CASTING_HEADSHOT_ON_FILE_NOTE · pending barrier (+4 per-kind hints + comp-round still-in clamp) ·
location barrier · premiere-progress directive · desync re-ground · state-delta line · presence-movement
line · attachment framing · C-02 pre-resolve advance · social-runway hold (+landed arm + witnessed-noms
override) · re-entry override · E22 floor digest + rich extract · post-turn desync/presence/roster checks ·
streamed outcome/location/nominee screens.
Loop layer (agent_loop, 29): advance stall ladder (3 rungs, grace, first-week grace) · L39b forced
advanceGame · preview-commit nudge · decision-deliver nudge · forced tool_choice (#1154) + rejecter gate ·
peer-advance suppressor · eviction-reveal steer · ceremony-narration steer · _auto_record_scene ·
_auto_record_deal · _auto_confide · _auto_move_player · _auto_move_npc · _auto_mark_premiere_intros ·
NPC-approach nudge · post-season re-approach ladder · narrate nudge · intent-without-action nudge ·
casting finalize ladder + forced createCharacter · casting substance ladder · casting-incomplete steer ·
_auto_record_casting · _faith_check (adopt/reframe/reground) · _scrub_game_leak · pre-emission outcome
guard · empty-response fallback (FEPY-2 + F2) · verifier subagent · runaway-call detector · overseer
verdicts/levers (0079–0081).

## Index

| id | sev | effort | value | title | where |
|----|-----|--------|-------|-------|-------|
| PROMPT2-1 | Major | <1hr | High | ask_user rule is self-contradictory across three layers — double-ask by design | momentPrompts.ts:135-137,322-323; agent_loop.py:88-90 |
| PROMPT2-2 | Major | <1day | High | Casting turns carry the full 9.5k-token live-season BASE (25-lever manual + host persona) under the producer persona | momentPrompts.ts:1111-1128; agent_loop.py:120-123 |
| PROMPT2-3 | Major | <1hr | High | Final-3 sole-vote eviction is framed as a secret-ballot house vote (moment map + reveal steer) | momentPrompts.ts:800-812; agent_loop.py:1593-1612 |
| PROMPT2-4 | Major | <1hr | High | `_RUNWAY_READY_RE` cuts the social runway on the very vocabulary of post-HOH scheming ("noms", "nominate", "next comp") | chat_helpers.py:319-325 |
| PROMPT2-5 | Major | <1hr | High | `_LULL_READY_RE` classifies engaged play as a lull (bare "continue", "come on", "next <word>", "I'm good") | agent_loop.py:1778-1785,1821-1834 |
| PROMPT2-6 | Major | <1hr | High | FEPY-2 empty-body recovery streams RAW reasoning into the public bubble, bypassing both scrub and outcome guard | agent_loop.py:3490-3494,6337-6341 |
| PROMPT2-7 | Major | <1day | High | `turnIn` (the ADR 0006 player bedtime) has no manual entry, no belt, no UI — reachable only via the ~0% spontaneous path | registry.ts:51,152; momentPrompts.ts (absent); agent_loop.py (absent) |
| PROMPT2-8 | Major | <1hr | High | The `user=None` posture still silently disables three belts: delta line, framed-beat-key readers, token ledger | chat_helpers.py:1967; agent_loop.py:4785,4916,6367 |
| PROMPT2-9 | Minor | <1hr | High | `asleep` + player `restStatus` are in the view but never rendered into GAME CONTEXT — the night economy is invisible to the narrator | momentPrompts.ts:1042-1044; GameSession.ts:54-58 |
| PROMPT2-10 | Minor | <1hr | Med | Eviction fragment asserts "the player's OWN vote has already been cast" — false for a nominee or the HOH | momentPrompts.ts:688-690 |
| PROMPT2-11 | Minor | <1hr | High | veto-ceremony fragment is 186 chars — the only ceremony without the #1127 anti-recap / live-set-piece treatment | momentPrompts.ts:673-675 |
| PROMPT2-12 | Minor | <1hr | Med | Premiere STILL-TO-MEET entries lead with the RAW archetype token — the exact F3 (#1016) regression the roster fixed | momentPrompts.ts:1004-1008,1031 |
| PROMPT2-13 | Minor | <1hr | Med | OOC/HUD asides have no grounding contract — probed GLM invented "the Veto Ceremony is scheduled for Day 5" as HUD truth | momentPrompts.ts:185-198; probe 2 |
| PROMPT2-14 | Minor | <1hr | Med | Mixed player message (OOC aside + diegetic action in one line) is unanswerable under "never both in the same turn" | momentPrompts.ts:199-204 |
| PROMPT2-15 | Minor | <1hr | Med | No anti-puppeting rule: player-authored NPC speech/feelings ("Maya said she'd protect me") can be adopted as open-set fact | momentPrompts.ts:76-80 (gap) |
| PROMPT2-16 | Minor | <1hr | Med | Staged comp rounds have zero system-prompt coverage — spoiler + invented-drop-order risk on spectator rounds | momentPrompts.ts:632-672; chat_helpers.py:390-397 |
| PROMPT2-17 | Minor | <1hr | Med | `_scrub_game_leak` drops legitimate fiction: "the engine" (mechanics are in the vocation corpus), "the system" idiom, "Let me check…" host patter | agent_loop.py:2897-2941; vocations.ts:17-18 |
| PROMPT2-18 | Minor | <1hr | Med | P2 re-entry override fires on FE restart mid-conversation → "open a fresh scene" against a live thread; also eats a held runway turn | chat_helpers.py:2287-2322 |
| PROMPT2-19 | Minor | <1hr | Med | Self-evict pending gets the general "bring them to it in the fiction" hint — contradicts the base "the HOUSE NEVER HEARS it" rule | chat_helpers.py:374-406; momentPrompts.ts:216-228 |
| PROMPT2-20 | Minor | <1hr | Med | Player card has no genderPresentation/pronouns — NPCs referring to the player in 3rd person infer gender from the name (the #1140 bug class, unfixed for the player) | GameSession.ts:40-59; momentPrompts.ts:1055 |
| PROMPT2-21 | Minor | <1hr | Med | GAME CONTEXT carries no standing deals/alliances — the narrator can't voice a final-two being honored/dodged without a gameStatus call it under-makes | momentPrompts.ts:1035-1073 (gap) |
| PROMPT2-22 | Minor | <1day | Med | Cast-authoring invites "threads may involve OTHER houseguests" with no roster in the call — authored Vault secrets can name phantom people | orwell_cast_authoring.py:72,209-220 |
| PROMPT2-23 | Minor | <1hr | Low | Casting headshot rule contradicts itself: "THIS IS WHERE YOU OPEN" vs "VARY YOUR ANGLE — open differently each session" | momentPrompts.ts:514-547 |
| PROMPT2-24 | Minor | <1hr | Low | Walk-out flow is double-specified: prose "ask them to CONFIRM" vs requestSelfEviction's confirmation card — when to raise the card is ambiguous | momentPrompts.ts:216-228,343-348 |
| PROMPT2-25 | Polish | <1hr | Med | "You may help with anything unrelated to the game" in FEED_DOWN/PRE_GAME re-opens the vanilla-assistant door under the game build (C2) | chat_helpers.py:124-143 |
| PROMPT2-26 | Polish | <1hr | Low | HOH music-perk clause references a GAME CONTEXT flag that only exists inside the optional zeitgeist block | momentPrompts.ts:239-243; GameSessionAdapter worldContext |
| PROMPT2-27 | Polish | <1hr | Low | Absolute phrase-ban on time transitions fights a legitimately advanced clock ("later that night" when the engine DID move evening→late-night) | momentPrompts.ts:146-160 |
| PROMPT2-28 | Polish | <1hr | Low | "evicted" fragment: "recap the remaining season to its winner if they want to watch" is ambiguous (recap vs drive vs invent) | momentPrompts.ts:747-753 |
| PROMPT2-29 | Polish | <1hr | Low | Casting-turn framing stack: 3 FE notes + preamble on top of the engine casting prompt every turn (casting sibling of v1 PROMPT-6) | chat_helpers.py:2426-2456 |
| PROMPT2-30 | Polish | <1hr | Low | Jury-seat "watches the public ceremonies" deviates from BB sequester canon — flag for the BB-nerd lane | momentPrompts.ts:787-793 |
| PROMPT2-31 | Polish | <1hr | Med | Eviction reveal permits unbounded ballots-per-turn ("then advance the next") — the season's peak beat can compress into one message | momentPrompts.ts:676-709; agent_loop.py:1604-1612 |
| PROMPT2-D1 | Polish | <1day | High | DESIGN: per-NPC voice fingerprints belong IN the roster line (seed-stable), not behind an npcVoice call per NPC per scene | momentPrompts.ts:887-926 |
| PROMPT2-D2 | Polish | <1hr | High | DESIGN: a 3-line "THIS TURN" contract reprise at the END of the system prompt (attention recency) | momentPrompts.ts:1111-1128 |
| PROMPT2-D3 | Polish | <1day | Med | DESIGN: contrastive BAD→GOOD micro-exemplars for the three chronic failure modes (montage, invented tally, operator aside) | momentPrompts.ts BASE |
| PROMPT2-D4 | Polish | <1hr | High | DESIGN: license NPC refusal/hostility explicitly — nothing tells the model an NPC may rebuff, stonewall, lie to, or walk away from the player | momentPrompts.ts:245-263 (gap) |
| PROMPT2-D5 | Polish | <1hr | Med | DESIGN: a "standard week cadence" line in GAME CONTEXT so schedule asides are grounded (pairs with PROMPT2-13) | momentPrompts.ts:1036-1044 |
| PROMPT2-D6 | Polish | <1hr | Low | DESIGN: "one scene, one beat" output contract (≤1 direct question to the player per turn) — probe showed GLM is already decent here | momentPrompts.ts:173-183 |

Corroborations (not re-counted): v1 PROMPT-2 — live probes measured GLM-4.7 at effort=low burning
576–1495 reasoning tokens on 400-token prompts (a 900-cap probe returned an EMPTY body,
finish=length); the `max_tokens_budget` seeds (narration 4096 / casting 2048 + casting reasoning
still "medium" at settings.py:178,196-199) remain the live values, so the truncation vector v1
flagged is confirmed on the pinned model. v1 PROMPT-5 — the runway/lull regex mismatch persists;
PROMPT2-4/5 are the false-POSITIVE complement.

Positive verifications: Vault-freedom of every prompt input re-confirmed (C8 neutralization on casting
echoes; producer persona public-only; portrait prompts public facets only; authoring prompt carries no
player identity — a genuinely good anti-sycophancy design). GLM-4.7 probes: OOC `((…))` wrap discipline
PASSED (fully wrapped, single block); premiere archetype-label leak NOT observed in 1 sample at
effort=low; multi-NPC 5-present scene was well-staged (differentiated postures, no question pile-up).
The E58 dayOfWeek line, the #380 premiere tracker, the LW9 still-in clamp, the F9 pending-kind beat key,
and the #1127 witnessed-noms moment override are all sound designs verified line-by-line.

---

## PROMPT2-1 [Severity: Major] [Effort: <1hr] [Value: High]
ask_user is specified three contradictory ways across the stack — the model is simultaneously told it
MUST, MAY ONLY, and MUST NOT present a pending decision with ask_user.

- Where: `src/engine/momentPrompts.ts:322-323` ("ask_user is ONLY for presenting the game's pending
  BINDING decision options — never to ask whether to call a lever"), `momentPrompts.ts:135-137`
  ("the player's own decision card already presents the legal options — … do NOT also re-ask the same
  decision with ask_user"), and `frontend/src/agent_loop.py:88-90` (GAME_AGENT_PREAMBLE: "When
  advanceGame returns a pending decision, present its options with the ask_user tool (buttons) and
  submit only what the player picks"). All three ride the SAME live-game turn (base prompt + preamble).
- Problem: Rule A says ask_user's sole purpose is pendings; rule B says never use it for pendings
  (the card does it); rule C (the FE preamble, appended after the GM stack) affirmatively commands it
  for pendings. Under contradiction the model's behavior is arbitrary per turn — this is fuel for the
  known double-ask symptom (the same decision surfaced as a card AND as chat buttons) and for stray
  ask_user calls that stall the loop. I9 (decision cards are HARD STOPS) needs exactly one contract.
- Fix: pick the card as the single authority. In GAME_AGENT_PREAMBLE change the ask_user sentence to
  "the player's decision card presents the options — set the scene and WAIT; never re-present a
  pending with ask_user". In the base prompt's lever list, re-scope ask_user to "free-text
  prompts the game does not card (never a pending's options)" or drop the lever line entirely.
  One sentence, one place, one rule.

## PROMPT2-2 [Severity: Major] [Effort: <1day] [Value: High]
Every casting-interview turn carries the full live-season BASE_GAME_MASTER_PROMPT — ~9.5k tokens of
host persona + a 25-lever manual for tools that are not even on the wire.

- Where: `src/engine/momentPrompts.ts:1111-1128` — `buildSystemPrompt` unconditionally leads with
  `BASE_GAME_MASTER_PROMPT` (37,957 chars measured) for every moment including `character-creation`
  (+7.7k chars of CASTING_INTERVIEW_PROMPT). Meanwhile `agent_loop.py:120-123` restricts casting turns
  to 7 tools (`CASTING_TOOLS`), so the manual's makeDeal/whereabouts/npcVoice/confide/exposeSecret/…
  entries describe tools the model cannot call and a house that does not exist yet.
- Problem: (a) ADR 0003 §1 violated at the game's front door — the first-ten-minutes turn pays ~2.5k
  tokens of dead lever manual + live-season rules (TIME DISCIPLINE, WHOLE-HOUSE EVENTS, whereabouts
  shape) that can only distract; (b) persona layering conflict — the BASE opens "You are Big Brother:
  the host…" and the casting fragment then overrides to "you are the PRODUCER", so the producer voice
  competes with a 9.5k-token host frame (a plausible contributor to the #1034 register slips the
  CASTING_REGISTER_NOTE belt exists to patch); (c) it invites the model to reach for absent levers
  (the exact under-/mis-call class every belt fights).
- Fix: split the base: `buildSystemPrompt` for `character-creation` composes a small PRE_GAME core
  (VOICE + never-name-machinery + the OOC rules + the 4 casting levers) + CASTING_INTERVIEW_PROMPT +
  producer voice + casting context. The live-season BASE stays untouched for every other moment.
  Add a unit pin that the casting prompt contains no live-season lever names.

## PROMPT2-3 [Severity: Major] [Effort: <1hr] [Value: High]
The Final-3 eviction (the final HOH's live, personal, sole vote — one of BB's most iconic beats) is
framed by the anonymized secret-ballot machinery, twice.

- Where: `src/engine/momentPrompts.ts:800-812` — `momentForPhase` checks `p.includes("evict")` BEFORE
  `p.includes("final")`, so the engine phase `final-eviction` (liveSeason.ts:48,1483-1492: the final
  HOH evicts one of two, setting the Final 2) resolves to the `eviction` fragment: "The house votes by
  SECRET BALLOT… each advanceGame hands you ONE anonymized ballot… Ballots are anonymous: say 'a vote
  to evict', never WHO cast it." And `agent_loop.py:1593-1595` includes `"final-eviction"` in
  `_EVICTION_STAGE_BEATS`, so `_eviction_reveal_steer` (1604-1612) additionally instructs "the ballots
  are SECRET — never attach it to a voter" — against an engine beat whose own content is fully
  attributed ("X evicts Y, setting the Final 2").
- Problem: At the endgame's climax the model is ordered to anonymize a vote that is canonically public
  and personally cast to the nominees' faces, and to expect a multi-ballot drip when there is exactly
  one attributed decision. Best case it awkwardly reads "a vote to evict…" for a sole vote; worst case
  it stalls waiting for more ballots. When the PLAYER is the final HOH, the fragment also tells them
  "the vote is already in" while the engine is waiting on their final-eviction pending.
- Fix: in `momentForPhase`, match `final-eviction` explicitly before the `evict` check and give it a
  small dedicated fragment (the final HOH stands, addresses both nominees, casts the sole live vote —
  attributed, no ballots); remove `"final-eviction"` from `_EVICTION_STAGE_BEATS` (or branch the steer
  text on that beat to an attributed sole-vote steer).

## PROMPT2-4 [Severity: Major] [Effort: <1hr] [Value: High]
`_RUNWAY_READY_RE` matches the core vocabulary of post-HOH scheming, cutting the #1127 social runway
on exactly the messages it exists to protect.

- Where: `frontend/routes/chat_helpers.py:319-325` — the alternation includes bare `nominate`, `noms?`,
  `hold the`, `start the`, `begin the`, `run it`, and `next (comp|round|beat|ceremony|one)`; used at
  2044-2057 and 2073-2088 to end the runway hold and drive the ceremony NOW.
- Problem: The #1 thing a spectator player does in the post-HOH window is speculate about nominations:
  "do you think she'll nominate me?", "who do you think the noms will be?", "if I'm one of the noms I
  need Derek" — every one of these matches (`nominate`/`noms`) and is treated as "skip ahead", so the
  ceremony is driven immediately and the guaranteed social window collapses to zero on the most
  engaged possible turn. "Will she hold the veto over us?" (`hold the`) and "who wins the next comp?"
  (`next comp`) do the same. The comment claims "Substantive play never matches" — demonstrably false.
  This is the same owner-critical force-march #1127 fixed, re-opened from the language side (C4).
- Fix: require an imperative/first-person frame, not a topic word: drop `nominate|noms?|hold the` from
  the regex entirely and keep only explicit move-on forms ("let's see the noms", "run the ceremony",
  "I'm ready"); or require the match be the message's main clause (e.g. anchor to start/whole-message
  ≤ ~40 chars). Add a test: "do you think she'll nominate me?" must NOT cut the runway.

## PROMPT2-5 [Severity: Major] [Effort: <1hr] [Value: High]
`_LULL_READY_RE` marks richly engaged messages as lulls — bare `continue`, `come on`, `next <anything>`,
`I'm good`, `that's it` anywhere in a message short-circuit the substance check.

- Where: `frontend/src/agent_loop.py:1778-1785`; consumed by `_player_turn_is_lull` (1821-1834) which
  returns True on regex hit REGARDLESS of message length (the ≤70-char check only applies after).
- Problem: `next (one|round|comp|beat)?` has an optional group, so ANY "next <word>" matches ("next
  time I see her I'll push the final-two"); `come on` ("come on, you can trust me" — mid-persuasion!),
  `continue` ("she wants to continue our alliance"), `i'?m good` ("I'm good at comps, that's what
  scares me") all match inside long, strategic messages. A lull turn at a stale advance-phase fires the
  stall ladder (grace is 1 turn in week 1, `_FIRST_WEEK_GRACE_TURNS`), so genuinely engaged play gets
  the "season is not moving" nudge and, past the rungs, the L39b forced advance — the exact behavior
  the owner ruled out ("during good productive engaging social play, auto-nudge should not happen").
  The same regex is half of `_player_signals_casting_ready` (1800-1806), so "I'm good at reading
  people" during casting counts toward the forced createCharacter ladder.
- Fix: only consult `_LULL_READY_RE` when the message is ALSO short (move the regex check behind the
  `len(s) <= _LULL_SHORT_CHARS` gate, or require the match to span ≥50% of the message); fix the
  optional group to `next (one|round|comp|beat)` (required); drop `continue|come on|i'?m good` in
  favor of explicit forms. Add tests with the three quoted engaged messages.

## PROMPT2-6 [Severity: Major] [Effort: <1hr] [Value: High]
The FEPY-2 empty-body recovery re-emits the model's RAW reasoning as the public GM bubble on game
turns — bypassing the leak scrub and the pre-emission outcome guard entirely.

- Where: `frontend/src/agent_loop.py:3490-3494` (`_empty_response_fallback`: "on an empty body with
  reasoning present, we RE-EMIT the reasoning as a non-thinking body delta") and 6337-6341 (the chunk
  is yielded directly to the stream). Neither `_scrub_game_leak` (2953) nor
  `_pre_emission_outcome_guard` (2970) touches this path — both run only on the in-loop streaming
  buffers (4381-4396, 4490-4496).
- Problem: On the turns where this fires, chain-of-thought becomes the fiction: reasoning routinely
  contains machinery talk ("the engine's pending is…", "I should call advanceGame"), meta-deliberation,
  and — because tool results are in-context — outcome material such as a previewed comp winner the
  ceremony hasn't revealed yet. That is a direct I9 violation and a potential I2 spoiler, streamed
  verbatim, on exactly the degraded turns where the model is least coherent. (Distinct from the v1
  empty-narration blocker: this is the recovery branch leaking, not the empty branch.)
- Fix: in game mode, route the FEPY-2 branch through `_scrub_game_leak` + the outcome guard before
  yielding — or, safer, treat game-mode empty-body-with-reasoning the same as true-empty (the F2
  producer line + `truncated` retry) and never surface reasoning as narration. One conditional.

## PROMPT2-7 [Severity: Major] [Effort: <1day] [Value: High]
`turnIn` — the player's ADR 0006 bedtime lever — is taught nowhere and belted nowhere: the sleep
economy's player half rides the measured-~0% spontaneous-tool-call path.

- Where: `src/surfaces/tools/registry.ts:51` (the lever; description says "FE-driven") and :152 (in
  `INFRA_LEVERS`, so the manifest-drift gate does not require it in the prompt);
  `src/engine/momentPrompts.ts` — zero mentions; `frontend/src` — zero drivers/belts (only the
  `orwell:gamechanged` tool list in chat.js:2625 knows the name);
  `frontend/static/js/orwellNightStatus.js:6` — "no bedtime button — the player turns in by SAYING so
  in prose".
- Problem: Every layer assumes another layer owns it. The HUD says prose; the prompt never tells the
  model the lever exists or when to pull it; no `_auto_turn_in` belt error-corrects the omission; the
  registry says "FE-driven" but no FE code calls it. So "I'm heading to bed" gets narrated sleep the
  engine never records: the night never rolls to morning, the rest economy (the hidden comp modifier
  the whole ADR builds to) never engages from the player side, and the fiction claims time the engine
  didn't move (C3). This is precisely the under-call class (I4-adjacent) the codebase's own doctrine
  says needs a belt — every comparable lever (moveTo, makeDeal, confide, recordInteraction) has one.
- Fix: (1) add a base-manual bullet: "turnIn — when the player says they're turning in / going to
  sleep for the night, call turnIn to end their night for real; never narrate them waking to a new
  morning without it"; (2) add a small `_auto_turn_in` belt (regex on "go(ing)? to bed|turn(ing)? in|
  call it a night|going to sleep" in the player message + model narration of sleep + no turnIn fired
  ⇒ call it), mirroring `_auto_move_player`; (3) a boundary test that a goodnight turn moves
  `timeOfDay`.

## PROMPT2-8 [Severity: Major] [Effort: <1hr] [Value: High]
The `user=None` (AUTH_ENABLED=false — the default home posture) bug class is only half-fixed: three
belts remain silently inert single-tenant.

- Where/Problem — three concrete sites, same root as the already-fixed #1127/#1045/#1154 family:
  1. `chat_helpers.py:1967` — `_maybe_delta_line` bails `if user is None`, so the 0065 E2 "since your
     last turn" delta NEVER rides a single-tenant turn (the staleness self-evidence the spine was
     built for is off exactly where most players run).
  2. `agent_loop.py:4785` and `:4916` — `_LAST_FRAMED_BEAT_KEY.get(owner or "")` while the writer keys
     `user or "default"` (chat_helpers.py:2316, the #1154 fix that acknowledged this reader gap
     in-comment). The first-week-grace hint reader and the ADR 0011 PEER-ADVANCE suppressor therefore
     read nothing under auth-off — and two windows on one auth-off game is the canonical local
     mirror posture (#1085/#1086), so the two-tab "20-step loop" the suppressor exists for can return
     exactly there.
  3. `agent_loop.py:6367` — `if _is_live_game and owner:` gates the ADR 0010 token ledger, so the
     token-economy meter records nothing on a single-tenant deploy.
- Fix: one shared resolver (the `_desync_key`/`_runway_key` precedent): route all three through
  `owner or "default"` (matching the writer) or through `_desync_key`. Add a pytest that frames a
  turn with `user=None` and asserts the delta line renders, the beat-key reader resolves, and a ledger
  row lands.

## PROMPT2-9 [Severity: Minor] [Effort: <1hr] [Value: High]
The night economy is invisible to the narrator: `asleep` and the player's `restStatus` are computed,
Vault-free, in the view — and never rendered into GAME CONTEXT.

- Where: `GameSessionAdapter.view()` emits `{ timeOfDay, asleep }` (adapter, time-of-day block) and
  `PlayerCard.restStatus` (`src/ports/GameSession.ts:54-58`, "a cue, never a number");
  `renderGameContext` (momentPrompts.ts:1035-1073) renders ONLY the `timeOfDay` line (1042-1044) —
  no asleep list, no rest cue, anywhere.
- Problem: When Maya has turned in and the player asks "where's Maya?", whereabouts just omits her —
  the model can't say "she turned in an hour ago" (it was never told) so it invents an explanation or
  places her from memory (the exact invented-position class the location barrier fights). The player's
  own tiredness cue — the ONE sanctioned player-facing face of the hidden rest penalty ("you never see
  a number, only the later behavior… and your own body") — never reaches narration, so "you're running
  on empty" texture before a comp can't happen. The HUD gadget shows both; the fiction is blind to
  them (ADR 0003: the chat is the game — the HUD may augment, not replace).
- Fix: two lines in `renderGameContext`, guarded on presence: `- Turned in for the night: X, Y (asleep
  — not available to scenes; voice their absence as having gone to bed, never invent their location).`
  and `- Your own body: {restStatus} (voice it as a felt cue when it matters; never a number).`

## PROMPT2-10 [Severity: Minor] [Effort: <1hr] [Value: Med]
The eviction fragment unconditionally asserts "the player's OWN eviction vote has already been cast
and recorded" — false whenever the player is a nominee (or the HOH).

- Where: `src/engine/momentPrompts.ts:688-690`.
- Problem: Nominees don't vote; the HOH votes only on a tie. On the season's scariest turn — the
  player ON THE BLOCK during the reveal — the system prompt tells the model the player already voted,
  inviting "your vote is in" narration that any BB-literate player instantly clocks as wrong (I6/I10
  texture at the peak beat). Nothing else in the stack corrects it (the pending barrier is gone by
  reveal time).
- Fix: make the claim conditional in the fragment: "If the player was an eligible voter, their ballot
  is already in; a nominee casts no vote — they sit on the block and watch the count; the HOH speaks
  only on a tie." (The ceremony marks in context already tell the model which applies.)

## PROMPT2-11 [Severity: Minor] [Effort: <1hr] [Value: High]
The veto ceremony — the week's biggest chess move — has a 186-character fragment with none of the
protections every sibling ceremony received.

- Where: `src/engine/momentPrompts.ts:673-675` ("Maximize the suspense of the chess move; you voice the
  result.") vs nominations (1,124 chars: live-set-piece, never-recap, exact-nominee grounding),
  eviction (3,093), veto-competition (1,619 incl. chip-draw ritual). Measured via tsx.
- Problem: The known failure modes this family of fragments exists for — recapping the ceremony as
  already-done (#1127), inventing the replacement, re-asking the player's carded veto/replacement
  decision, skipping the medallion ritual — are all live at veto-ceremony and all unaddressed. The
  hard rule "the veto winner cannot be named replacement" appears nowhere in any prompt; the engine
  enforces legality, but the model can narrate an illegal replacement before the engine contradicts it.
  F8's `_ceremony_narration_steer` only fires on the beat's tool-result turn, not on the turns framing
  the moment.
- Fix: bring the fragment to parity (~10 lines): play it live at the reported hour, never as backstory;
  the holder's decision and any replacement are THE GAME's (in gameStatus / the pending card — never
  re-ask, never invent); name the canon ritual (the medallion, "I have chosen… not to use / to use the
  power of veto", the HOH's forced replacement on the spot); the veto winner can never be the
  replacement.

## PROMPT2-12 [Severity: Minor] [Effort: <1hr] [Value: Med]
The premiere STILL-TO-MEET list leads each entry with the raw archetype label — the exact token order
F3 (#1016) proved makes the model narrate the scouting report, fixed in the roster and reintroduced
here.

- Where: `src/engine/momentPrompts.ts:1004-1008` — `observable()` puts `fi.archetype` FIRST, unfenced
  ("· Maya Chen — mastermind, polished athleisure, …"), while the roster line (887-925) deliberately
  DEMOTED the same token to a tail-fenced "(private voice cue, never said aloud: …)" because leading
  with it "made the model narrate the scouting report it was told not to give".
- Problem: The premiere is the single most discovery-critical surface (core fantasy: "15 strangers
  become distinct people"; I8). The header rule ("never a strategy or danger label said aloud") is the
  same prose defense F3 found insufficient against token position. Probe (GLM-4.7, effort=low, 1
  sample) did NOT leak — so severity Minor — but the asymmetry with the roster's own fix is
  unjustified, and weaker/hotter models sit one settings-edit away.
- Fix: mirror the roster's framing: move the archetype to the entry tail as `(private cue, never said
  aloud: mastermind)` — or drop it from the premiere list entirely (the roster line already carries
  the fenced cue for the same houseguest).

## PROMPT2-13 [Severity: Minor] [Effort: <1hr] [Value: Med]
OOC/HUD asides have no grounding contract — probed GLM-4.7 invented a schedule fact in the producer
voice.

- Where: `src/engine/momentPrompts.ts:185-198` (answer state/time/rules questions "as a brief
  producer/HUD aside (quiet, factual…)"); probe 2 (`probe_prompt2.py`): asked "what day is it and when
  is the veto ceremony?" with context carrying only week/phase/day — GLM replied `((It is currently
  Day 3 of Week 2. The Veto Ceremony is scheduled for Day 5.))` — fabricating "Day 5" (canon cadence:
  ceremony day 4), stated flatly as HUD truth.
- Problem: The aside register READS as authoritative production fact, but the model has no rule pinning
  asides to GAME CONTEXT facts and no schedule data to answer the most natural HUD questions ("when is
  the eviction?"). None of the outcome guards screen schedule claims. Players plan around these
  answers; a wrong "the ceremony is tomorrow" is a trust break in the game's own referee voice.
- Fix: one sentence after the MARK-YOUR-OWN-OOC rule: "An aside states ONLY facts the GAME CONTEXT or a
  lever result carries — if the context doesn't say, say production hasn't announced it yet; never
  invent a schedule, a rule, or a number." Pair with PROMPT2-D5 (the cadence line) so the common
  questions are answerable.

## PROMPT2-14 [Severity: Minor] [Effort: <1hr] [Value: Med]
A mixed player message — an OOC aside plus a diegetic action in the same line — is unanswerable under
the "never both in the same turn" rule.

- Where: `src/engine/momentPrompts.ts:199-204` ("One reply is either fully in-character OR a
  fully-wrapped OOC aside — never both") vs 191-193 ("any scene already in progress CONTINUES
  UNINTERRUPTED as if the aside never happened").
- Problem: Players naturally type `((who's HOH again?)) …okay, I go find Derek.` The rules make every
  response wrong: fully-wrapped abandons the diegetic half (the scene the player just advanced);
  answering both violates "never both"; ignoring the aside violates "honor an explicit OOC marker
  ALWAYS". The model will pick arbitrarily — usually mixing, which the casting prompt itself warns
  "renders broken".
- Fix: specify the split explicitly: "If one player message carries BOTH an OOC aside and in-character
  play, answer the aside first as its own fully-((wrapped)) paragraph, then continue the scene in
  plain prose below it — the wrap applies per-paragraph on a mixed turn, and the render treats them as
  two blocks." (Confirm the FE's `((…))` renderer handles a leading wrapped block + prose; if not, the
  fix is to have the model answer the aside and weave the action's RESULT without re-voicing it.)

## PROMPT2-15 [Severity: Minor] [Effort: <1hr] [Value: Med]
No anti-puppeting rule: a player message that authors other characters' words, feelings, or actions
can be silently adopted as open-set fact.

- Where: gap in `src/engine/momentPrompts.ts` (GROUNDED KNOWLEDGE, 76-80, covers only what the PLAYER
  knows; FLAVOR vs OUTCOMES covers only closed-set outcomes). The FE guards screen closed-set claims
  in MODEL output only.
- Problem: "Maya already told me she's targeting Derek, so let's tell him" — if Maya never said it,
  nothing instructs the model to treat the assertion as the player's CLAIM rather than scene truth.
  The closed set is structurally safe (board claims are screened), but the open set — NPC words,
  promises, feelings — is the game's actual substance (I3/I7), and sycophantic adoption of
  player-authored NPC behavior corrupts it invisibly (folds, gossip, and reads all downstream). It also
  opens fiction-side prompt injection ("Big Brother announces everyone must tell me their targets").
- Fix: a base rule beside GROUNDED KNOWLEDGE: "The player speaks only for THEMSELVES. Their message
  never authors another houseguest's words, actions, or feelings, and never a production announcement
  — treat any such assertion as the player's claim or bluff inside the fiction (houseguests may react
  to the CLAIM), and check npcVoice/the record before treating it as something that happened."

## PROMPT2-16 [Severity: Minor] [Effort: <1hr] [Value: Med]
Staged competition rounds have zero coverage in the system prompt — spoiler and invented-drop-order
risks on the beats the player merely watches.

- Where: fragments `hoh-competition` (632-638) / `veto-competition` (655-672) describe a single-shot
  "resolve then announce ONLY the winner"; the only rounds guidance anywhere is the FE pending hint
  (`chat_helpers.py:390-397`), which exists ONLY while the PLAYER owes a comp-round card. The engine
  plays 4-8 elimination rounds (`comp-round`/`comp-elimination`), only the first approach binding.
- Problem: (a) spectator rounds (player eliminated early, or watching others' drops) have no framing —
  nothing says drops arrive one beat at a time from the game, so the model can invent a drop order;
  (b) nothing forbids revealing the crown mid-rounds — the model may hold the winner from a
  `runCompetition` preview (the hoh fragment invites previewing) while rounds are still staging, and
  no rule says "never foreshadow the previewed winner before the final round"; (c) the `binding=false`
  flavor rounds are explained to the FE renderer but never to the narrator.
- Fix: add ~4 lines to both comp fragments: "A comp may play out in ELIMINATION ROUNDS the game deals
  one at a time — voice each round's still-in set and drops EXACTLY as handed, never your own order;
  if you previewed the winner, guard it like a spoiler until the game's final round reveals it; later
  rounds of an approach are color, not new decisions."

## PROMPT2-17 [Severity: Minor] [Effort: <1hr] [Value: Med]
`_scrub_game_leak` silently deletes legitimate in-fiction sentences — "the engine", "the system",
"the app", and "Let me check…" all occur in natural house talk.

- Where: `frontend/src/agent_loop.py:2897-2941` — `\bthe (?:engine|system)\b`, `\bthe app\b`,
  `front[\s-]?end`, and sentence-start `let me (…|check|see what)` drop the WHOLE sentence
  (`_scrub_game_leak`, 2953-2967). The vocation corpus ships "auto mechanic" and "diesel mechanic"
  (`src/engine/data/vocations.ts:17-18`) and tech vocations.
- Problem: A mechanic houseguest cannot talk about their life ("the engine seized on I-40 and that was
  my whole summer") — every such sentence vanishes mid-scene as an unexplained truncation. "You can't
  beat the system" / "they're playing the system" is idiomatic BB strategy talk; "I built the app for
  my food truck" is a plausible backstory line; unquoted host patter "Let me check in with the
  houseguests." starts with an operator opener + `check`. This is the same silent-deletion class the
  2026-06-25 BUG-2 fix partially addressed — the noun side is still over-broad.
- Fix: require machinery co-occurrence for the ambiguous nouns: drop `the engine|the system|the app`
  sentences only when the sentence ALSO contains a game/tool token (advance, record, state, pending,
  tool, resolve) or is sentence-initial meta ("The engine says…"). Remove `check|see what` from
  `_OPERATOR_VERBS` (keep record/advance/log/resolve/call/fetch). Pin with tests using the mechanic
  line and "you can't beat the system".

## PROMPT2-18 [Severity: Minor] [Effort: <1hr] [Value: Med]
The P2 re-entry override keys on process memory, not conversation state — an FE restart mid-session
reframes a live mid-scene turn as "open a fresh scene", and eats a held runway turn.

- Where: `frontend/routes/chat_helpers.py:2287-2322` — `_SESSION_GAME_FRAMED` is process-local; the
  first framed turn of any session THIS process hasn't seen gets `moment = RE_ENTRY_MOMENT`
  (2321-2322), whose fragment (momentPrompts.ts:754-760) instructs "the chat may be empty — open with
  a fresh in-fiction scene… never an out-of-fiction recap". The override also runs AFTER
  `_pre_resolve_npc_ceremony` (2285), so a runway `social` hold is both decremented AND replaced.
- Problem: After a uvicorn restart (deploys, crashes, the doctor script) the player's next message —
  possibly mid-negotiation ("so what did you tell Maya?") — is answered with a scene-reset opening
  instead of the live thread, because the model was told the chat is empty when it isn't (the history
  is on the wire). Secondary: on the first turn of any new tab mid-runway, the held social window
  loses one of its two turns to re-entry framing.
- Fix: only request re-entry when the session's chat history is actually short/empty (the route knows
  the message count) — e.g. `session_id not in _SESSION_GAME_FRAMED AND len(history) <= 2`; and skip
  the runway decrement on a turn whose moment ends up overridden to re-entry.

## PROMPT2-19 [Severity: Minor] [Effort: <1hr] [Value: Med]
The self-evict confirmation pending gets the generic "bring them to it in the fiction" barrier —
directly contradicting the base prompt's "the HOUSE NEVER HEARS OR REACTS" rule for walk-outs.

- Where: `chat_helpers.py:374-406` — `_PENDING_KIND_HINTS` has no `self-evict` entry, so the
  `self-evict` pending (liveSeason kind) falls to `_PENDING_GENERAL_HINT`: "Bring them to it in the
  fiction and take their explicit choice…". The base prompt (momentPrompts.ts:216-228) mandates the
  opposite: bare walk-out intent is OOC, answered as a quiet ((producer aside)); no houseguest reacts.
- Problem: On the turn the confirmation card is up, the strongest directive on the stack (the barrier
  is appended last-ish and framed as "your ONLY job") tells the model to dramatize the quit decision
  in the room — houseguests reacting to a decision that must not exist in the fiction until confirmed.
  If the player cancels, the house has already "seen" a quit that never happened.
- Fix: add a `self-evict` entry to `_PENDING_KIND_HINTS`: "This is the player's PRIVATE walk-out
  confirmation — an out-of-fiction producer matter. Restate the stakes in a quiet ((aside)); the house
  never hears or reacts; their card decides. Do not stage it in the room."

## PROMPT2-20 [Severity: Minor] [Effort: <1hr] [Value: Med]
The player has no pronoun/gender-presentation facet anywhere in the prompt — the #1140 misgendering
class, fixed for all 15 NPCs, remains open for the 16th houseguest.

- Where: `src/ports/GameSession.ts:40-59` (PlayerCard: no genderPresentation) and
  `momentPrompts.ts:1055` — the player line carries name + archetype + style only, while every NPC
  roster line carries "presents as X (use they/them)" precisely because "never infer gender from the
  name" (911).
- Problem: NPCs constantly reference the player in the third person inside dialogue ("she's the
  biggest threat here", goodbye messages, confessionals surfaced at the retrospective, jury talk).
  With no facet, the model infers from the player's name — wrong for unisex names and for any player
  whose presentation differs, and unfixable by the player short of OOC correction every scene.
  The casting interview never asks, either.
- Fix: capture pronouns/presentation at casting (one optional producer beat or derive from the
  player's own phrasing; store on PlayerCard), and render it on the player line: "You are playing as:
  Alex Reyes — presents as a man (use he/him) — …". Same shape as the NPC fix; small engine + intake
  change.

## PROMPT2-21 [Severity: Minor] [Effort: <1hr] [Value: Med]
GAME CONTEXT never carries the player's standing deals or alliances — the layer of state most likely
to be contradicted scene-to-scene rides only behind tool calls the model under-makes.

- Where: `momentPrompts.ts:1035-1073` — the context block has ceremony, whereabouts, showmances,
  premiere, roster; no deals/alliances. The engine tracks both (`deals.ts`, `alliances.ts`;
  gameStatus.alliancePitches exists; the FE has a Deals window).
- Problem: A final-two promised in week 2 shapes every later scene with that houseguest — but the
  narrator only knows it if it happens to call gameStatus/npcVoice this turn (the documented ~0%
  spontaneous-call scar). So the model forgets standing promises: an NPC with a live safety deal
  pitches nominating the player's ally, the player's named alliance is never referenced again, a
  final-two partner reads as a stranger. Every scene contradicting a recorded promise cheapens I4
  ("the house remembers") from the narration side even though the engine remembered perfectly.
- Fix: one compact context line each, present only when non-empty: `- Your standing deals (the game
  adjudicates them; voice the relationship, never the bookkeeping): final-two with Maya (wk2); safety
  this week from Derek (wk3).` and `- Your alliances: The Quiet Storm (you, Maya, Priya).` Vault-free
  (the player is a party to every one).

## PROMPT2-22 [Severity: Minor] [Effort: <1day] [Value: Med]
Cast authoring invites cross-houseguest secret threads while the call carries only ONE houseguest —
authored Vault secrets can name people who don't exist.

- Where: `frontend/src/orwell_cast_authoring.py:72` ("Their threads may involve OTHER houseguests,
  pre-show ties, or personal stakes") + `build_authoring_messages` (209-220): the skeleton is the one
  NPC; no roster is provided.
- Problem: A model told ties-are-welcome but given no cast will either invent a name ("her ex, Jake
  Morrison, is also in the house" — no such houseguest) or write vague ties. Invented-name secrets
  live in the Vault and can surface later via confidences, gossip drift, or the 0048 retrospective —
  where a phantom castmate is an immersion break with receipts. (The engine's recordCastProfile
  validation is documented as splitting/sealing, not as cross-referencing secret text against the
  roster.)
- Fix: either drop the "may involve OTHER houseguests" clause (keep pre-show ties to non-cast people),
  or pass the cast's public name list into the prompt with "any in-house tie must name one of THESE
  exact people"; belt-and-suspenders: engine-side, reject/rewrite a secret containing a capitalized
  two-token name that matches no cast member. Cross-check with the engine lane whether
  `recordCastProfile` already screens this.

## PROMPT2-23 [Severity: Minor] [Effort: <1hr] [Value: Low]
The casting prompt orders two different openings: "THE HEADSHOT — THIS IS WHERE YOU OPEN" vs "VARY
YOUR ANGLE — open differently … each session, so no two interviews feel the same".

- Where: `src/engine/momentPrompts.ts:535-547` (headshot: "Before any other question… casting STEP
  ONE… your first ask") vs 514-519 (vary your opening).
- Problem: Both claim the opening. A rule-following model opens every interview with the same UI CTA
  ("tap the Choose Your Character button") — the most configuration-flavored beat the game has, as
  beat one of the core fantasy's "cast, don't configure" moment — and the vary-rule is dead letter.
  A vibe-following model sometimes buries the headshot ask the FE then has to patch
  (CASTING_HEADSHOT_ON_FILE_NOTE exists because of loops here).
- Fix: subordinate one to the other explicitly: e.g. "Open with ONE disarming producer question in
  your own angle (vary it every session); your SECOND beat is the headshot ask — before the interview
  goes deep." (Or, if the owner wants photo-first, amend VARY YOUR ANGLE to "after the headshot
  beat".) One clause either way.

## PROMPT2-24 [Severity: Minor] [Effort: <1hr] [Value: Low]
Walk-out confirmation is specified twice with different mechanics — prose confirm vs the
requestSelfEviction card — and the trigger for raising the card is ambiguous.

- Where: `momentPrompts.ts:216-228` ("answer it as a quiet producer/HUD aside… name the stakes… and
  ask them to CONFIRM. Only once they explicitly confirm does the game record the walk-out") vs
  343-348 (requestSelfEviction "raises a CONFIRMATION and changes NOTHING… let their confirm card
  decide. NEVER submitDecision a confirmed self-evict yourself").
- Problem: Reading the first block alone, the model asks-and-waits in prose, then (on "yes, I'm sure")
  has no sanctioned way to record it — it was told never to submitDecision the confirm, and the first
  block never mentions the lever. Reading both, it's unclear whether requestSelfEviction fires on the
  FIRST bare intent (raising the card immediately — likely the intended design) or only after a prose
  yes (a redundant double-confirm).
- Fix: merge: in the WALKING OUT block, replace "ask them to CONFIRM" with "call requestSelfEviction —
  it raises the player's own confirmation card and changes nothing until THEY confirm it; your aside
  just names the stakes beside it."

## PROMPT2-25 [Severity: Polish] [Effort: <1hr] [Value: Med]
"You may help with anything unrelated to the game" in both fail-state prompts re-opens the generic
assistant inside the game product.

- Where: `chat_helpers.py:124-131` (FEED_DOWN_PROMPT) and 135-143 (PRE_GAME_PROMPT).
- Problem: Under the game build the product IS the game (C2); these two sentences are the only places
  the stack invites vanilla-assistant behavior. During an engine outage or pre-casting, "write me
  a python script" gets a workspace answer in the Big Brother chrome — tonal break, and it teaches
  players the chat is a general assistant right before immersion is supposed to take hold.
- Fix: replace with a production-voiced boundary: "Anything else, keep it brief and in the production
  voice — this line is for the show." (Non-game build keeps the current sentence.)

## PROMPT2-26 [Severity: Polish] [Effort: <1hr] [Value: Low]
The HOH music-perk rule points at a GAME CONTEXT flag that only exists when the optional zeitgeist
block rendered.

- Where: `momentPrompts.ts:239-243` ("The GAME CONTEXT flags when the reader holds the perk") — the
  flag is `musicAccess` inside `renderZeitgeist`, emitted only when a `worldSnapshot` exists
  (GameSessionAdapter.worldContext returns undefined otherwise — the §8 fail-soft path).
- Problem: On a season whose zeitgeist capture failed/absent, the base rule references a flag that
  never appears — the model either never grants the canon HOH luxury or improvises it. Dangling
  cross-references also erode rule authority generally.
- Fix: emit a one-line `- HOH music perk: you hold it this week.` from `renderGameContext` (the
  adapter already has `hasMusicPerk`), independent of the zeitgeist block; or soften the base clause
  to "when the GAME CONTEXT mentions it; otherwise the house is silent".

## PROMPT2-27 [Severity: Polish] [Effort: <1hr] [Value: Low]
The anti-montage rule bans transition PHRASES absolutely, even when the engine's clock genuinely
moved — colliding with the time-of-day line it tells the model to honor.

- Where: `momentPrompts.ts:146-153` ("never write … 'later that night', 'the next morning'") vs
  1042-1044 (voice THIS timeOfDay). After a real evening→late-night advance (or a turnIn morning
  roll), "later that night" is the truthful, natural connective — but it's banned by literal wording,
  so the model either writes awkward seams between scenes at different hours or (worse) generalizes
  the ban into never acknowledging clock movement.
- Fix: scope the ban to UNEARNED skips: "…never write a time-skip the GAME did not move — when the
  GAME CONTEXT's hour has genuinely advanced since the last beat, mark the transition naturally
  ('later that night…') and set the scene at the new hour."

## PROMPT2-28 [Severity: Polish] [Effort: <1hr] [Value: Low]
The pre-jury "evicted" fragment's viewing offer is ambiguous about what the engine can actually do.

- Where: `momentPrompts.ts:747-753` — "you may recap the remaining season to its winner if they want
  to watch, but they hold no power".
- Problem: "Recap… if they want to watch" conflates two different things: driving the season forward
  beat-by-beat (advanceGame as a spectator — supported) vs summarizing a season that hasn't happened
  yet (impossible — there is nothing to recap until beats resolve). A model reading "recap" may
  narrate the rest of the season as invented summary — the ghost-season failure the post-season
  fragment explicitly wars against.
- Fix: reword: "If they want to watch the season play out, drive it with advanceGame beat by beat and
  voice the public results as broadcasts — never summarize or invent beats the game has not resolved."

## PROMPT2-29 [Severity: Polish] [Effort: <1hr] [Value: Low]
Casting turns stack three FE notes + a preamble on the engine's own casting prompt every turn — the
casting sibling of the v1 PROMPT-6 dilution finding.

- Where: `chat_helpers.py:2426-2456` — engine casting prompt + CASTING_REGISTER_NOTE (every pre-game
  turn, even when the engine prompt fetched fine) + CASTING_HEADSHOT_ON_FILE_NOTE (once photo exists)
  + CASTING_AGENT_PREAMBLE; plus whichever casting ladder nudges fire in-loop.
- Problem: Three "PRODUCTION NOTE/VOICE (not for the player)" blocks with overlapping register/finalize
  instructions compete on a turn whose whole contract is ~6 rules; the engine prompt already carries
  the finalize gate as engine truth. ADR 0003: remove, don't stack.
- Fix: fold CASTING_REGISTER_NOTE's content into the engine CASTING_INTERVIEW_PROMPT (it is static
  register guidance, not FE state) and keep only the state-bearing HEADSHOT note FE-side.

## PROMPT2-30 [Severity: Polish] [Effort: <1hr] [Value: Low]
Jury-seat framing ("from sequester they watch the PUBLIC ceremonies play out — RESULTS only") deviates
from BB sequester canon, where jurors learn only from arriving evictees (+ curated comp footage).

- Where: `momentPrompts.ts:787-793`.
- Problem: A BB-literate player in the jury will notice they "shouldn't know" the week's results in
  sequester; it also flattens a canonical drama source (the newest juror's arrival recontextualizing
  everything). Likely a deliberate 0046 design simplification — flagging for the BB-nerd lane to rule,
  not asserting a defect.
- Fix (if the nerd lane concurs): reframe the jury moment as jury-house beats — results arrive WITH
  each evictee (and the occasional production reel), not as a live broadcast; the engine already has
  `juryHouse.ts` texture to hang it on.

## PROMPT2-31 [Severity: Polish] [Effort: <1hr] [Value: Med]
Nothing bounds ballots-per-turn at the eviction reveal — the season's peak beat can compress into a
single message.

- Where: `momentPrompts.ts:679-681` ("call advanceGame, voice THAT ballot…, then advance the next") +
  the reveal steer (`agent_loop.py:1604-1612`) which forbids advancing only BEFORE narrating, not
  after. The engine's one-beat-per-turn pacing applies to the FE pre-resolve, not to the model's own
  calls.
- Problem: A tool-happy model (GLM honors forcing; spontaneous calls are the goal) can legally drain
  ballot → narrate → ballot → narrate through the whole count in one turn, collapsing the E12 staged
  drip into a wall of text with no player heartbeat between ballots — the exact "presentation over one
  roll" tension the staged design exists for.
- Fix: one clause in the eviction fragment: "Reveal at most one or two ballots per turn — end the turn
  between ballots and let the player live the count; the next ballot waits for you."

## PROMPT2-D1 [Severity: Polish] [Effort: <1day] [Value: High]
DESIGN — put a seed-stable per-NPC voice fingerprint IN the roster line; today the 0084 `voice` field
exists only behind an npcVoice call per NPC per scene.

- Where: `momentPrompts.ts:887-926` (roster lines carry look/demeanor/bio + fenced archetype; no
  verbal fingerprint) vs the npcVoice lever (374-393) which the model must call per houseguest.
- Problem: I6's "~16 DISTINCT voices" currently depends on N tool calls per multi-NPC scene — the
  under-call class again. In practice the model voices most scenes from `demeanor` alone ("comes
  across as blunt"), which converges on registers, not idiolects; the vision brief's own "felt
  quality" ask (distinct people) is bottlenecked here more than anywhere. This is the single highest
  leverage prompt change available: with 15 stable 8-12-word fingerprints ALWAYS in context, every
  scene voices distinct people at zero tool-call cost, and npcVoice remains for mood/knowledge.
- Fix: extend each active roster line with the stored 0084 fingerprint distilled to one clause —
  `speaks: clipped five-word answers, dry needle under stress, filler "look—"` (the engine already
  persists voice/signature/fillers; render ≤12 words of it). Seed-stable by construction, Vault-free,
  ~180 tokens for the whole cast.

## PROMPT2-D2 [Severity: Polish] [Effort: <1hr] [Value: High]
DESIGN — append a 3-line "THIS TURN" reprise at the END of the built system prompt; the beat contract
currently sits at the attention-decay midpoint.

- Where: `momentPrompts.ts:1111-1128` — order is BASE (9.5k tokens) → moment fragment → producer →
  context → world → storyFacts; the FE then appends barriers only on pending/desync turns. On an
  ordinary ceremony turn the moment contract sits ~9.5k tokens deep in a ~15k prompt with nothing
  after the roster restating it.
- Problem: Long-prompt models weight beginnings and ends; the mid-prompt fragment is exactly the rule
  family (play the ceremony live, resolve-before-narrate) that live play shows being dropped. The FE's
  own barrier design proves end-position works — but it only exists on abnormal turns.
- Fix: have `buildSystemPrompt` close with a generated reprise, e.g. `THIS TURN: moment=nominations —
  play the ceremony live at {timeOfDay}; the nominees are {names}; resolve before you narrate; end at
  a natural stop and wait.` (3 lines max, built from the same view; no new state).

## PROMPT2-D3 [Severity: Polish] [Effort: <1day] [Value: Med]
DESIGN — add contrastive BAD→GOOD micro-exemplars for the three chronic failure modes; the base
prompt is 100% imperative prose.

- Where: BASE throughout (montage 146-160, tally 701-709, operator asides 64-66).
- Problem: The three most-relapsed failures (time montage, invented vote tally, operator aside) are
  each defended by long imperative paragraphs; instruction-following research and this repo's own
  history (rules restated 3-5x and still broken) both say a single WRONG:/RIGHT: pair outperforms
  another paragraph. Exemplars also compress: two lines can replace ~10 lines of restatement.
- Fix: per failure mode, one pair, e.g. `WRONG: "The next morning, with nominations behind them…"
  RIGHT: "The kitchen is still buzzing an hour after the crowning…"`; `WRONG: "By a vote of 7-2…"
  (you were handed 3 ballots) RIGHT: voice the 3 ballots and stop.` Keep each ≤2 lines; net token
  change ≈ 0 if the redundant restatements are trimmed in the same pass (ADR 0003).

## PROMPT2-D4 [Severity: Polish] [Effort: <1hr] [Value: High]
DESIGN — explicitly license NPC refusal, coldness, and hostility toward the player; nothing in the
stack does, and LLM default is warm cooperation.

- Where: gap beside DISTINCT REGISTERS (`momentPrompts.ts:249-263`) and the currentRead clause
  (381-387, which shades HOW they engage but never says they may NOT engage).
- Problem: The core fantasy is "an engine structurally incapable of loving you" — but the prompt never
  tells the model an NPC may brush the player off ("not now"), stonewall a pitch, lie to their face,
  visibly dislike them, or end a scene and walk away. Without a license, models make every NPC
  available and every pitch land softly — anti-sycophancy (I8/mandate #3) leaking back in through
  social texture even while outcomes stay honest. `confide` handles deflection for ONE lever; ordinary
  scenes have nothing.
- Fix: ~4 lines in the base: "A houseguest is NOT obliged to engage: when their read of the player is
  guarded/wary (or the moment is wrong), they may deflect, give nothing, lie, cut the scene short, or
  walk away — voice the rebuff as real play, not a puzzle with a key. Not every pitch lands; not every
  question gets an answer. The player earns access; they are never owed it."

## PROMPT2-D5 [Severity: Polish] [Effort: <1hr] [Value: Med]
DESIGN — one "standard week cadence" context line so schedule questions are answerable from facts.

- Where: `momentPrompts.ts:1036-1044` (context has week/phase/day/time; nothing about what comes when).
- Problem: The most common HUD asides ("when's the veto?", "how long till eviction?") have no grounded
  answer in context — probe 2 showed GLM fabricating a schedule in the producer voice (PROMPT2-13).
  The cadence is fixed and public (Day 1 HOH → Day 2 noms → Day 3 veto comp → Day 4 ceremony → Day 5
  eviction; E58's `dayOfWeek` already encodes it).
- Fix: emit `- The week's rhythm (public): HOH day 1 → nominations day 2 → veto comp day 3 → veto
  ceremony day 4 → eviction day 5. Today is day {N}.` one line, engine-true, kills the fabrication
  class at the source.

## PROMPT2-D6 [Severity: Polish] [Effort: <1hr] [Value: Low]
DESIGN — an explicit multi-NPC scene contract (≤1 direct question to the player per turn; background
characters stay background).

- Where: the base covers "one grouping at a time" for WANDERING (173-183) but has no output contract
  for a normal scene with 4-6 people present.
- Problem: The known pile-up failure (several NPCs firing unanswerable direct questions in one turn)
  is only banned in the wandering section; a fire-pit scene with five present has no rule. Probe 3
  (GLM-4.7, 5 present) staged it WELL unprompted — differentiated postures, one live question — so
  this is cheap insurance for weaker/hotter configs rather than a live defect.
- Fix: one line generalizing the existing rule out of the wandering section: "However many people are
  present, a turn carries ONE live thread: at most one direct question aimed at the player; everyone
  else is texture until the player turns to them."

---

## Where I looked / did not look
Read fully: momentPrompts.ts (all), producerPersona.ts, portraitPrompts.ts buildPortraitPrompt,
cast_authoring prompts + guards, zeitgeist FE module header + queries, token_policy.py (all),
settings.py token/reasoning region, chat_helpers.py lines 27-620 + 1963-2500 (framing, runway,
barriers, pre-resolve) + belt indexes across the whole file, agent_loop.py lines 69-180, 668-750,
1380-1900, 2892-3030, 3300-3510, 4180-4260, 6325-6370 + full structural index. Probed GLM-4.7 4x
(premiere intro ×2, OOC aside, multi-NPC scene). NOT covered: the gossip/confessional/deal engine
modules' non-prompt logic (they proved to contain no LLM prompt strings — conversation.ts et al are
fact-providers), chat.js render-side prompt handling beyond the g15 list, the overseer 0079-0081
directive texts in depth, and live two-window behavior (other lanes). I did not run test suites.

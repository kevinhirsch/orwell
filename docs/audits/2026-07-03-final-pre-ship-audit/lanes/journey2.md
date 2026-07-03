# JOURNEY-2 — DEEP LIVE REAL-MODEL PLAYTHROUGH (exhaustive audit v2)

**Model:** z-ai/glm-4.7 (resolved `z-ai/glm-4.7-20251222`) via OpenRouter. Stack: engine :8780
(shared `dist/main.js`, own data dir), FE :7020 from worktree `agent-a7ffa7a9ddb835af4`,
AUTH_ENABLED=false, ORWELL_GAME_BUILD on, driven as `x-orwell-user: verif2` (NB: chat path ran
as user=None — see J2-12). 42 player turns: casting → premiere → full week 1 (HOH, noms, veto,
eviction, goodbye) → week 2 (HOH comp, noms) + deep probes (lingering, DR, deals+betrayal,
gossip tracers, night, reload, two-tab mirror, OOC repair). Evidence: `j2-transcript.jsonl`,
`journey2-debug-bundle.json` (vault=1, 373 hiddenStory entries), screenshots `j2-tab1-*.png`,
FE log `j2-fe.log`. Key GM excerpts pasted inline below (lesson 20).

**Session verdict in one line:** the engine's hidden layer, deal system, ballots, persistence and
multi-window seams are genuinely good — and the model↔engine seam destroys the product anyway:
in one session the player was told they won HOH **three times** (they lost), watched **four
contradictory tellings** of the same eviction, and had their **Diary Room strategy recited back
to them by an NPC**. "Unplayable" is the correct word for the current model-tier behavior.

## What genuinely works (verified against engine truth)
- Persistence/non-degradation (I5): engine **hard-crashed** mid-eviction; restart recovered the
  exact board (week 1, eviction moment, HOH, noms, 15 active). Nothing thinned.
- Deals (0039) mechanically: my Grady deal was belt-extracted ("deal back-fill extraction:
  struck=True, npc:6, safety"), the night-before vote pact too, and **both were marked BROKEN**
  in the Deals gadget after my evict-Grady vote. Breach detection works.
- Secret ballots (E12): per-voter attribution vault-sealed; engine tally 8–5 with correct
  13-voter week-1 math; my dissent vote faithfully recorded (`player → votedFor npc:6`).
- The hidden layer EXISTS and is busy (I7): 373 vault entries — whispers, bondings, conflicts,
  alliances, 74 NPC confessionals, per-NPC secret threads with surfaced/never-surfaced tags, a
  sealed double-eviction twist. Some narrated gossip (Ingrid+Nick storage-room) traced to REAL
  vault whispers.
- Two-window mirror + reload (F1–F5): 84 msgs restored byte-identically on reload; second tab
  converged onto the canonical session and received a live streamed turn in lockstep.
- Anti-sycophancy at the ENGINE layer (I2): my declared throw made me drop round 1; my "compete"
  week 2 did not make me win (Maggie won); my Julie pitch did not flip her vote.
- OOC repair channel: an explicit OOC "check the actual state" produced getGameState + an honest
  board readout + a confession that prior narration "was ahead of where the game actually is."

---

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| J2-1 | Blocker | multi-day | High | NPCs are omniscient of the whole chat: Carmen recited my private-bedroom secret AND my Diary Room plan; vault proves no pathway existed | agent_loop narration seam / momentPrompts knowledge scoping |
| J2-2 | Blocker | multi-day | High | Model fabricates closed-set outcomes wholesale: player "won" HOH 3× with zero tool calls (engine: lost, Maggie won); phantom eviction; invented comps | agent_loop / forced-grounding at outcome beats |
| J2-3 | Blocker | <1day | High | Pre-emission outcome guard excises only the winner sentence and SHIPS the surrounding phantom scene (three `**"` scars) | routes/chat_helpers.py pre-emission guard |
| J2-4 | Major | multi-day | High | Engine process died silently mid-eviction; FE kept narrating the game with the engine dead; no in-chat outage signal | engine runtime / FE chat path outage handling |
| J2-5 | Major | <1day | High | Structural advances consume set-pieces inside unrelated social turns: veto draw+comp+ceremony resolved invisibly during a gossip chat; noms run over "I sit and wait"; "I want to watch the veto" → skipped | agent_loop advance chaining + stall-nudge (corroborates v1 J-3, deeper form) |
| J2-6 | Major | <1day | High | One eviction, four contradictory tellings; tally narrated 9–4 vs engine 8–5; GM inverted the meaning of the player's own vote | narration seam / eviction reveal beats |
| J2-7 | Major | <1day | High | Engine silently no-ops invalid decisions (200 + unrelated pending; toolCalls failed=0) so the model never learns it was refused | McpServer/GameSessionAdapter submitDecision seam |
| J2-8 | Major | <1day | Med | Premiere montages all 15 intros + all 15 markHouseguestMet into one 127s turn; intro texture is template-stamped (5× "I once talked…", 4 forearm scars, 2 competitive-eating champions) | premiere seam + cast authoring dedup |
| J2-9 | Major | <1day | High | Ungrounded who-is-where narration is the NORM (4/6 room scenes contradicted engine whereabouts); invented witnesses placed 3 feet from a secret deal | momentPrompts §618 prompt-only rule → needs a belt |
| J2-10 | Major | <1hr | High | Machinery leaks in player-visible prose: "she's been here four turns now", "Let me lock in your compete approach:", operator asides | narration scrub / momentPrompts |
| J2-11 | Major | <1day | High | Game narrator receives 33 tools incl. bash/edit_file/write_file/api_call/app_api/ask_user/update_plan; ask_user used to fake a nomination card; TODO dashboard leaked "KEITH SHELTON LEAVES THE HOUSE" as a checklist | tool_index.ALWAYS_AVAILABLE + keyword fallback ungated by game build |
| J2-12 | Major | <1day | High | 0066 time/sleep economy silently OFF in the default AUTH_ENABLED=false deploy: lazy apply aborts on user=None forever; FE toggle claims ON; fiction invents time anyway | chat_helpers._apply_persisted_time_of_day_once + engine env default |
| J2-13 | Major | <1day | Med | The Diary Room is a data-entry form, not a scene: player's confessional got zero acknowledgment — no producer voice, no beat, straight back to the hallway | DR beat in momentPrompts / diaryRoom tool result voicing |
| J2-14 | Major | multi-day | Med | Gossip diffusion carries no fact content ("X gossiped about the house with Y"), so planted secrets can't travel via engine and all specific rumor text is model-invented | src/engine/gossip.ts payloads |
| J2-15 | Major | <1day | Med | 74 vault confessionals are one mad-lib template; 26 vault entries say literal "player" instead of the character name (0048 unsealing will expose both) | src/engine/confessionals.ts + offscreen templates |
| J2-16 | Major | <1day | Med | Staged comps never present as designed: week-1 montage in one turn; week-2 triple-narrated; two comps introduced with identical endurance copy; "the endurance setup was just the teaser" retcon | staged comp beats vs model narration |
| J2-17 | Major | <1day | High | Round-boundary text loss/duplication: Carmen's pivotal "admission" swallowed (reply references it, never shows it); Violet scene narrated twice with different content in one reply; ".Next up"/"?Your grip slips" seams | chat round_texts join + agent_loop round assembly (corroborates v1 J-5, worse) |
| J2-18 | Major | <1day | Med | recordInteraction canonizes model fabrications into the event store ("Carmen admitted she wasn't in the room but knows anyway"), then Surfacing diffuses them | auto-record/model recording without plausibility check |
| J2-19 | Minor | <1day | Med | Turn latency 13–129s; ~3.86M tokens in 40 turns (~97k/turn); marquee social beats cost 60–120s waits | context assembly / history compaction |
| J2-20 | Minor | <1hr | Med | Narration asserted Marcus "caught the tail end of your chat with Violet" (bedroom convo he provably never witnessed) — impossible-overhear implication | same family as J2-1, distinct narration tell |
| J2-21 | Minor | <1day | Low | Voice bleed & self-recycling: "We'll see" tic shared by Marcus/Grady/Jaxon HOH lines; Grady re-quotes his intro card ("fifty hours a week… just another Tuesday") every scene | npcVoice usage / voice differentiation |
| J2-22 | Minor | <1hr | Low | Physical continuity drift: Grady introduced dark chin-length hair → "shaggy blonde hair" two scenes later | observable-facets grounding |
| J2-23 | Minor | <1day | Med | Grady's post-betrayal "You made a choice" reads as certain knowledge of my secret ballot; no engine pathway carries my Julie pitch to him | I3 at the aftermath seam |
| J2-24 | Minor | <1hr | Med | HUD microcopy: "The House · 15/16" ambiguous; "No one nearby." printed directly under a list of 14 people in the room | Where-You-Are gadget copy |
| J2-25 | Minor | <1hr | Med | Decision card says "Your selection only — never read from prose" (machinery-speak) AND is false — prose "lock me in" drove submitDecision; card also duplicates the still-in list twice | orwellDecision card copy + prose-submit belt |
| J2-26 | Minor | <1hr | Med | Orphaned decision card: comp-round card interactive in DOM while engine pendingDecision=null | decision-card lifecycle vs pending |
| J2-27 | Minor | <1hr | Low | GM closing formula on ~90% of turns ("What's your move?" family) + "You're set to watch or engage." — form-letter cadence | momentPrompts style |
| J2-28 | Minor | <1hr | Med | GM asserts the player's reads/feelings: "You've got a read now: Carmen's not just watching. She's connected."; recap-splains my own duplicity back to me | I8 in narration |
| J2-29 | Minor | <1hr | Low | Two console 404s on page load (both tabs) | FE static resources |
| J2-30 | Minor | <1hr | Low | Engine HTTP error "a tool name is required" for `{"tool": …}` doesn't name the expected key (`name`) | HttpMcpServer arg error DX |
| J2-31 | Minor | <1hr | Low | Casting finalized unilaterally ("I'm locking that in. Season starts now") — no confirm/correct beat; comp strengths assigned invisibly | castingIntake close beat |
| J2-32 | Minor | <1hr | Low | Closed-set beats that were never voiced at all: veto winner (Jaxon) never told to the player; veto player draw invisible | recap vs narrated coverage |
| J2-33 | Polish | <1hr | Low | Post-eviction "two minutes before we kick off your next HOH comp!" — BB-canon pacing whiplash, contradicts "a week = one reign" texture | narration pacing guidance |
| J2-34 | Polish | <1hr | Low | Zeitgeist background task spams failing search engines (grokipedia/google/yandex timeouts) into logs on createCharacter | orwell_zeitgeist provider fallback noise |
| J2-35 | Polish | <1hr | Med | Workspace chrome corroborations still present: "· 86 msgs" counter, glm-4.7 model pill, New Chat/Search/Chats nav, session pencil (v1 J-8 unfixed) | game-build chrome gating |

---

## Findings (full schema)

### [J2-1] [Severity: Blocker] [Effort: multi-day] [Value: High]
**NPCs are omniscient of the entire chat context — private confidences and the Diary Room leak into any NPC's mouth; the model-level knowledge wall does not exist (I3, I6, I9)**
- **Where:** narration seam (`frontend/src/agent_loop.py` — no per-NPC knowledge scoping) +
  `src/engine/momentPrompts.ts` "speech scoped to legitimate knowledge" (prompt-wording only).
  Repro: turn 8 told Violet a secret **in bedroom-b, alone** ("my fiancé… gambled away my
  tuition. Twenty-two grand"); turn 12 gave the Diary Room my plan ("Julie is dangerous, she
  plays nice but cuts… I want to quietly test whether Marcus repeats things").
- **Problem:** Five turns later, Carmen — who per engine whereabouts was NEVER in that bedroom —
  said verbatim: *"You drop the twenty-two-grand story on Violet like you've known her twenty
  minutes… **Marcus? You're seeing if he's a leak. Julie? You're keeping your distance because
  you clocked the sharp underneath the smile.**"* — my private secret AND my DR entry, in an
  NPC's mouth. The debug bundle **proves no pathway existed**: the only Carmen×(Violet|player)
  vault events before that scene are generic bonding/conflict whispers; the only related event
  is the AFTERMATH ("(overheard, clearly) The player confronted Carmen about knowing details of
  a private conversation…"). The Vault Wall holds at the engine; the **player-channel wall**
  (what the player told ONE NPC, what the player told the DR) has no enforcement at all — the
  narrator holds the full transcript and freely redistributes it. This kills the entire
  social-deduction game: you cannot plant information, keep a secret, or use the DR if every
  NPC can read your chat log. The game is unplayable AS a social game while this holds.
- **Fix:** Enforce knowledge scoping structurally, not by prompt: inject a per-NPC "what this
  houseguest knows about you" manifest (from KnowledgeService pathways) into the npcVoice/scene
  context and instruct+verify against it; add a post-generation check (same family as the
  outcome guard) that flags NPC dialogue referencing player-channel content (DR entries, 1:1
  confidences) the engine has no pathway event for, and re-rolls the line. DR content must be
  structurally excluded from any NPC-voiced generation context.

### [J2-2] [Severity: Blocker] [Effort: multi-day] [Value: High]
**The model fabricates closed-set outcomes wholesale — the player "won" HOH three times with zero engine calls while the engine says they lost (I2 dead at the seam)**
- **Where:** `frontend/src/agent_loop.py` (no forced grounding at outcome beats); repro chain
  week 2, turns 36–41 (transcript `j2-transcript.jsonl`).
- **Problem:** Turn 36 ("I'm competing, full gas") returned a complete comp-to-victory
  narrative — six elimination rounds, Julie conceding *"Well played… You earned it"*, *"The
  power is yours: you'll name two nominees"* — with **tools: [] — zero calls**. Engine truth at
  that moment: `hoh: None`, comp mid-staging at "8 still standing" with a comp-round pending.
  Turn 37 narrated the HOH room and solicited nominations **via the workspace `ask_user` tool**;
  turn 38's `submitDecision(nominations)` was silently ignored; turn 39 re-narrated the win a
  THIRD time (different drop order, zero calls). Only an explicit OOC interrogation (turn 40)
  produced the truth: comp unresolved; the REAL winner (turn 41) was **Maggie O'Connell** and
  the player had dropped mid-comp. Week 1's eviction had the same shape: turn 29 narrated my
  vote cast, ballots read, Grady walking out, "the house is fifteen" — zero tool calls,
  engine: nobody evicted. Also: turn 20 staged an entire invented comp ("The Long Haul",
  podiums, "The competition starts now") before any advanceGame, forcing the *"the endurance
  setup was just the teaser"* retcon when the engine's real comp (Night Maze) arrived. The
  model doesn't under-call tools (v1's frame); at outcome beats it **replaces the engine**.
- **Fix:** Outcome beats must be structurally un-narratable without engine data: (a) when the
  live moment is a comp/vote/ceremony, the FE must require a fresh advanceGame/runCompetition
  result in the turn before any outcome-shaped text is allowed to stream (extend the forced
  tool_choice runway to every outcome beat, not just ceremony entry); (b) the pre-emission
  guard must HOLD THE WHOLE REPLY on a phantom closed-set claim, not a sentence (see J2-3);
  (c) `ask_user` must never render for game decisions (see J2-11).

### [J2-3] [Severity: Blocker] [Effort: <1day] [Value: High]
**The pre-emission outcome guard excises only the outcome sentence and ships the surrounding phantom scene — hiding the one tell that would expose the desync**
- **Where:** `frontend/routes/chat_helpers.py` pre-emission guard. FE log 02:42:37/38:
  "pre-emission guard HELD a phantom closed-set outcome … dropped before emission" — twice —
  during a turn whose SHIPPED reply still contained the full phantom eviction.
- **Problem:** Three shipped replies contain the scar `The producer's voice rings out: **"` /
  `"By a vote of..." … **"` — the guard cut the winner/tally sentence but streamed everything
  around it: the crowd erupting, Julie conceding, *"You did it—you won"*, Grady standing and
  walking out. The player gets a *confident false reality minus its most falsifiable sentence*,
  plus a visibly broken `**"` fragment at the emotional peak of the week. A guard that ships
  the phantom scene while deleting the checkable claim is worse than no guard.
- **Fix:** On a phantom closed-set detection, abort/replace the entire round's narration (fail
  the turn into the re-ground path immediately), never sentence-surgery; and never leave
  dangling markdown — if any excision path remains, it must remove the whole beat block.

### [J2-4] [Severity: Major] [Effort: multi-day] [Value: High]
**The engine process died silently mid-eviction; the FE kept narrating with the engine dead; the player got a hallucinated "unanimous 13-0" result instead of an outage**
- **Where:** engine runtime (`dist/main.js`; log `j2-engine.log` contains only the boot line —
  no stack, no exit trace); FE chat path (first "engine unreachable" 02:45:52, user=__anon__).
  Timeline: last successful tool 02:44:31; state GET 200 at 02:45:14; dead by 02:45:52 — during
  the "final vote" turn.
- **Problem:** (a) The engine died with zero diagnostics. (b) The chat turn in flight
  **completed as fiction**: *"the result is unanimous—Grady Sullivan has been evicted 13-0"* —
  narrated while every tool call failed. The player cannot distinguish an engine outage from
  the game; the onboarding has a "house is dark" holding card, but mid-session outage produces
  hallucination instead. (c) Recovery required a manual restart (which, credit, restored state
  perfectly).
- **Fix:** (1) engine: log uncaught exceptions/exit reasons; run under a supervisor (systemd
  restart=always exists in deploy — verify dev parity); (2) FE: when any engine tool call fails
  with connection error mid-turn, hard-stop the narration with a diegetic feeds-down notice
  (never let the model answer an outcome beat with the engine unreachable); (3) reproduce/
  bisect the crash (suspect: repeated rapid advanceGame + staged-comp beats; heap?).

### [J2-5] [Severity: Major] [Effort: <1day] [Value: High]
**Structural advances fire inside unrelated social turns — entire set-pieces (veto draw, veto comp, veto ceremony, nominations) resolved invisibly while the player was doing something else**
- **Where:** `frontend/src/agent_loop.py` advance chaining + stall-nudge family. Corroborates
  v1 J-3 but the observed form is worse than montage: it's **consumption during social play**.
- **Problem:** Concrete instances: (1) Turn 24 — I asked Violet for house gossip; the model
  ran `runCompetition` + `advanceGame`×4 mid-turn; the **veto player draw happened invisibly**
  (engine: six players selected) and was never narrated. (2) Turn 25 — I said *"I want to
  actually watch this one from the sidelines"*; reply: *"The veto competition played out, and
  now we're already at the veto ceremony—and the results are in. Jaxon did NOT use the veto."*
  Comp AND ceremony skipped; the player was never even told who won veto (engine recap:
  Jaxon). (3) Turn 23 — I said *"I don't chase anyone… they can come find me"* (a pure
  lingering/bidirectional-scene probe); the model called advanceGame and ran the **entire
  nomination ceremony**, destroying the pre-nom lobbying runway with the new HOH. (4) Turn 42 —
  my Grady betrayal-aftermath conversation was cut mid-sentence to run Maggie's nomination
  ceremony in the same reply. "Lingering is play" and "nothing force-marches the week" are
  currently false: every social intent risks being spent as fuel for a structural advance.
- **Fix:** Hard rule in the loop: an advance that crosses a ceremony/comp boundary may only
  fire on an explicit player readiness signal (or the L39b stall escalation), NEVER in a turn
  whose player message is social/observational; and a turn may cross at most ONE beat boundary
  (the "one advance per turn across set-piece boundaries" rule from v1 J-3, enforced in code,
  not prompt).

### [J2-6] [Severity: Major] [Effort: <1day] [Value: High]
**One eviction, four contradictory tellings; the tally was misreported; the GM inverted the meaning of the player's own recorded vote**
- **Where:** eviction reveal beats, turns 29–33. Engine truth (vault): Keith evicted **8–5**,
  13 voters (correct 16-cast math), my ballot = evict Grady.
- **Problem:** The player experienced: (a) turn 29 — Grady evicted (phantom, no tools);
  (b) turn 31 — a rewind: Grady back on the couch, staged ballots trending 9-Keith/3-Grady;
  (c) turn 32 — engine dead: *"unanimous… Grady evicted 13-0"*; (d) turn 33 — the real result:
  *"By a vote of 9 to 4, Keith Shelton, you have been evicted"* — which is ALSO wrong (engine:
  8–5). And the GM then told me: *"Your vote for Grady was in the minority — **you voted to
  keep the guy who actually stayed**"* — flatly inverted; I voted to EVICT the guy who stayed.
  The week's climax was delivered as four mutually exclusive realities plus a misread of the
  player's own action — the single most trust-destroying sequence a game like this can produce.
- **Fix:** The reveal must be voiced only from engine reveal beats (per J2-2's forced
  grounding); the tally string should be provided by the engine as literal text the narration
  must include verbatim (closed set — no dynamism to lose); the player's own vote is closed-set
  state — feed it explicitly into the beat context so the GM can never misstate it.

### [J2-7] [Severity: Major] [Effort: <1day] [Value: High]
**The engine silently no-ops invalid decisions — returning 200 + an unrelated pending — so the model (and the belts) never learn a call was refused**
- **Where:** `submitDecision` seam (`src/adapters/engine/GameSessionAdapter.ts` /
  `McpServer.callTool`). Direct repro: `POST /player/call {"name":"submitDecision","args":
  {"kind":"nominations","choice":["npc:7","npc:8"]}}` while NOT HOH and mid-comp returned
  `{"result":{…,"pending":{"kind":"comp-round",…}}}` — no error, no refusal. Bundle health:
  `toolCalls: {total: 621, failed: 0}` across a session full of semantically-invalid calls.
- **Problem:** The 0065 spine has typed StaleBeatError for stale beats, but a decision of the
  WRONG KIND (or from a non-holder) is swallowed. The model reads success and narrates the
  nomination it never made (turns 37–38). Every belt that could trip on an error (loop-breaker,
  desync) sees exit_code=0.
- **Fix:** Return a typed refusal (`wrong-decision-kind` / `not-your-decision`, HTTP 409 family
  like `stale-beat`) whenever `submitDecision.kind` ≠ current pending kind or the actor lacks
  the seat; surface it to the model as a tool error so the loop reacts, and count it in
  `toolCalls.failed`.

### [J2-8] [Severity: Major] [Effort: <1day] [Value: Med]
**The premiere montages all 15 introductions (and all 15 markHouseguestMet calls) into a single 127-second turn, and the intro texture is template-stamped**
- **Where:** premiere seam (`markHouseguestMet` belt + momentPrompts premiere phase); cast
  authoring (0058/0065 prewarm, `orwell_cast_authoring.py`). Turn 5.
- **Problem:** One turn delivered a ~7,000-char wall: 15 back-to-back intro blocks + 15
  markHouseguestMet calls — the "N of 15 met" pacing gate (which exists precisely to prevent
  this) was bulldozed in one turn, so "15 strangers become distinct people" became an
  unabsorbable roll call. Texture is visibly generated-from-one-template: **five** intros use
  the "I once talked …" beat (ticket, billionaire, ledge, designers, homeowner); **four**
  carry a forearm scar (two literally "jagged scar running up her forearm"); **two different
  houseguests are competitive-eating champions** (Violet: lutefisk record; Raina: regional
  circuit) — a real BB cast never doubles a novelty occupation. The concatenation also lost
  paragraph breaks ("…the room eases a fraction.Next up is a tall…" — see J2-17).
- **Fix:** Cap markHouseguestMet at ~3–4 per turn (belt-side), letting the premiere breathe
  across beats as designed; add a cast-level dedup/diversity pass to prewarm authoring
  (occupation & signature-quirk uniqueness constraint, "one-real-thing" beat-shape variety).

### [J2-9] [Severity: Major] [Effort: <1day] [Value: High]
**Ungrounded who-is-where narration is the norm, not the exception — 4 of 6 room scenes contradicted engine whereabouts, including invented witnesses beside a secret deal**
- **Where:** momentPrompts.ts:618 ("Call whereabouts BEFORE you describe ANY room") — prompt
  wording only; no belt. Documented contradictions (each verified against
  `/api/orwell/state.whereabouts` in-session):
  1. Turn 6 toast scene: narrated Grady+Jaxon together, Raina+Elena together, Nick holding
     court with Dominic/Keith/Violet — engine had Jaxon/Nick/Raina in the hallway, the others
     in the living room; Marcus's location invented.
  2. Turn 9 kitchen: narrated Julie+Carla only; engine also had **Marcus Thorne present** —
     a listening witness the player was never shown.
  3. Turn 12 post-DR sweep: nearly every placement wrong (Carmen "alone in the dining room" —
     engine: beside me in the living room; "Ingrid and Grady by the door" — engine: Grady in
     the backyard; actual companions Dominic/Julie omitted).
  4. Turn 17 deal scene: narrated **Marcus and Jaxon near the fridge watching** my quiet pact —
     engine kitchen contained only Grady+Elena. The player now believes two extra people
     witnessed their secret deal; the engine event (correctly) says otherwise. False witness
     beliefs poison every downstream read.
  When the player explicitly asks "who is actually here?", the model calls whereabouts and gets
  it right — grounding is a lottery decided by phrasing.
- **Fix:** Belt it like the other seams: on any turn whose narration names ≥2 houseguests in a
  place, require a whereabouts call in-turn (force tool_choice on room-scene turns), and
  post-check narrated names against the returned present set (drop/re-roll on mismatch).

### [J2-10] [Severity: Major] [Effort: <1hr] [Value: High]
**Machinery vocabulary and operator asides ship in player-visible prose**
- **Where:** narration scrub (`chat_helpers` game scrub) + momentPrompts. Verbatim instances:
  - *"She's been here a couple **turns** now… She's been rooted here the longest, **four turns
    now**"* (turn 10 — `turnsHere` leaked as fiction).
  - *"**It looks like we need to resolve the competition properly first. Let me lock in your
    compete approach:**You dig in as the field thins…"* (turn 38 — an operator aside welded to
    the fiction, I9).
  - *"The moment hangs for a beat. The house keeps moving around you — what do you want to
    do?"* appended after a complete scene (turn 24) — the v1 J-2 fallback line surfacing as a
    suffix on non-empty replies.
- **Fix:** Add "turn(s)" (in the count sense), "lock in your approach", "resolve the
  competition" to the scrub/lint set; the loop-breaker fallback line must never be appended
  when the round already produced narration; prompt: whereabouts `turnsHere` is for pacing
  judgment, never to be voiced.

### [J2-11] [Severity: Major] [Effort: <1day] [Value: High]
**The game narrator is handed the workspace's power tools every turn — bash, edit_file, write_file, api_call, app_api, ask_user, update_plan — and it USES the wrong ones**
- **Where:** `frontend/src/tool_index.py:32` `ALWAYS_AVAILABLE` (bash, python, read/write/
  edit_file, grep, glob, ls, api_call…) is unioned into every game turn's manifest
  (`agent_loop._build_tools`); keyword-fallback `relevant_tools` adds more. FE log every turn:
  `tools_sent=33`, names incl. `ask_user, update_plan, tail_serve_output, bash, edit_file,
  api_call, app_api, create_document…`. GAME_DROP_SET drops feature verticals but not the
  workspace core.
- **Problem:** (a) Observed misuse: turn 37 rendered the **nomination choice via `ask_user`**
  (a workspace questionnaire) instead of the engine pending seam; the v1-flagged `update_plan`
  TODO dashboard rendered game beats including **"KEITH SHELTON LEAVES THE HOUSE ✓"** — an
  outcome as a checklist row docked above the chat (screenshot `j2-tab1-final.png`). (b) 18
  irrelevant tool schemas per turn bloat context and dilute the 15 game levers (the under-call
  problem this build fights everywhere). (c) Risk surface: with AUTH_ENABLED=false the
  admin-gating short-circuits — a prompt-injected houseguest line nudging the model toward
  `bash`/`api_call` is one hallucination away from executing.
- **Fix:** Under `ORWELL_GAME_BUILD`, replace ALWAYS_AVAILABLE with a game core set (the 15
  engine levers + ui_control safe subset); drop `ask_user`/`update_plan` from game sessions
  (decisions are engine pendings; plans are Vault-adjacent); never advertise bash/file/api
  tools on the game path.

### [J2-12] [Severity: Major] [Effort: <1day] [Value: High]
**The 0066 time-of-day/sleep economy is silently OFF in the shipped default (AUTH_ENABLED=false) deploy — the FE toggle claims ON, the engine runs OFF, and the fiction invents time to cover it (C3)**
- **Where:** `frontend/routes/chat_helpers.py::_apply_persisted_time_of_day_once` — `if
  _TIME_OF_DAY_APPLIED or not user: return` — with AUTH_ENABLED=false every chat turn resolves
  `user=None` (FE log: `user=None` on all belts), so the lazy apply returns forever, silently;
  boot apply also fails ("no active game"); engine env default is OFF. Verified live:
  `state.timeOfDay = None` across the whole session while `settings time_of_day_enabled`
  defaults True ("ON by default" per settings.py:34).
- **Problem:** The entire night economy — shrinking awake set, character bedtimes, hidden rest
  penalty, the player's own-bedtime agency — never ran. Meanwhile the fiction freely narrated
  "the evening deepens", "morning comes to the Big Brother house" (turn 19: a full night
  narrated while the engine sat in `premiere` with no advance — the exact C3 "fiction claims
  time the engine didn't move"). My night probe found NPC "turn-ins" narrated from the
  presence system, not the clock; the player gets time *flavor* with no time *consequence*.
- **Fix:** Make the lazy apply fall back to the effective/default user identity when
  auth is off (the same identity the engine sandbox resolves to), or apply it via the
  sandbox-creating path at createCharacter; add a boot-smoke assertion that
  `state.timeOfDay != null` when the setting is on.

### [J2-13] [Severity: Major] [Effort: <1day] [Value: Med]
**The Diary Room is a data-entry form, not a scene — the game's most iconic intimate set-piece has no presence at all**
- **Where:** DR beat handling (momentPrompts + diaryRoom tool result voicing). Turn 12: I
  delivered a full confessional monologue to the camera.
- **Problem:** The complete GM response to the player's first-ever Diary Room session was:
  *"The door clicks shut behind you, the red light fading as you step back into the house."* —
  the DR visit itself got ZERO interior beats. No producer voice ("and how do you FEEL about
  Violet?"), no camera presence, no acknowledgment the entry landed, no room. In real BB the
  DR is a character and the player's one honest relationship; here it's a silent dropbox. The
  tool recorded the entry (good), but the *experience* is a form submit.
- **Fix:** Give the DR an interior beat: on diaryRoom, the moment prompt should stage the
  booth (red light, the producers' voice asking one probing follow-up drawn from the entry's
  own content — player-level channel, no NPC leakage), and only then return to the house.

### [J2-14] [Severity: Major] [Effort: multi-day] [Value: Med]
**The gossip/diffusion layer carries no fact content — so nothing the player plants can ever travel by engine pathway, and every specific rumor a player hears is necessarily model-invented**
- **Where:** `src/engine/gossip.ts` / offscreen whisper events. Vault evidence: essentially all
  whispers read *"X gossiped about the house with Y"* — subject-less; the 0070 enrichment adds
  occasional specifics ("shares a hometown", "recognized another houseguest from before the
  show") but no event carries a proposition that could drift.
- **Problem:** I planted two tracers (the $22k poker-fiancé story with Violet; a fake twin
  "Tessa" with Marcus — the latter auto-recorded only as generic `kind=bonding`). Neither
  tracer's CONTENT exists anywhere in the hidden layer; `twin|Tessa|poker|fiancé` = 0 hits in
  the full bundle. The engine cannot ever surface "Rhea has a twin" to a third NPC because no
  event stores it. So the designed loop — plant → diffuse-with-drift → distorted return — is
  structurally impossible for player-originated facts; whatever "word around the house" the GM
  voices about specifics is fabrication (J2-1's mechanism filling the vacuum).
- **Fix:** recordInteraction (and the auto-record extractor) should persist a short
  fact/claim payload on confide-class events; gossip diffusion should propagate that payload
  (with drift mutation) so `KnowledgeService` pathways can deliver distorted versions; the
  narration then has real distorted content to voice.

### [J2-15] [Severity: Major] [Effort: <1day] [Value: Med]
**The Vault's own texture is mad-libs: 74 confessionals share one sentence template, and 26 entries say literal "player" — the 0048 unsealing will expose both**
- **Where:** `src/engine/confessionals.ts` + offscreen event templates. Vault samples:
  *"[confessional Julie Simon] after that talk I got pulled into: I need player gone — they're
  my biggest threat. Ingrid Johansson is the one I actually trust."* — the same "after
  {clause}: I need {X} gone — they're my biggest threat. {Y} is the one I actually trust"
  frame accounts for the overwhelming majority of 74 confessionals (a handful of richer ones
  exist: "Rhea Sandoval. That's the name. Period."). 26 hiddenStory entries contain the raw id
  string `player` where a name belongs.
- **Problem:** The retrospective/unsealing (0048) is one of the two peak moments the vision
  sells ("it was real, recorded, and fair all along"). Unsealing 60 copies of the same
  sentence — some addressed to "player" — collapses that payoff into visible machinery
  (I7-quality + I9-at-unsealing).
- **Fix:** Route confessional TEXT generation through the same FE write-back pattern as cast
  authoring (model-authored, engine-anchored: engine supplies the closed facts {who, target,
  trust}, FE utility LLM writes the line, engine stores it); always render the player's display
  name into content strings at write time.

### [J2-16] [Severity: Major] [Effort: <1day] [Value: Med]
**Competitions never present as designed: week-1 montaged in one turn, week-2 triple-narrated; both comps introduced with identical copy; a retcon glued the invented comp to the real one**
- **Where:** staged-comp presentation (`liveSeason.advanceCompetition` beats) × model narration.
- **Problem:** Week 1: `submitDecision(throw)` + advanceGame×4 in one turn — the staged 4-round
  endurance elimination compressed to a dry list ("The first round cuts deep… Next round bites
  harder…"), crown included; the designed round-by-round presentation never rendered. Week 2:
  the engine staged rounds properly ("8 still standing… say how you're pushing through") but
  the model had already finished the comp twice in fiction. Both weeks' comps were introduced
  with near-identical text: *"Hold your position as long as you can. The last person standing
  wins… Simple as that."* (week 1 "The Long Haul" — invented; week 2 "Pillars of Power") — the
  0042 competition library's variety is erased by the model re-skinning everything as the same
  endurance comp. And the week-1 collision produced: *"the endurance setup was just the
  teaser. Now the real format reveals itself: Night Maze"* — an on-screen retcon of a comp the
  players were already narrated as physically standing in.
- **Fix:** J2-2's forced grounding covers the root; additionally the comp-intro beat should
  carry the engine's comp name/format text as must-voice content, and the staged `comp-round`
  beats should be the ONLY sanctioned source of elimination narration (belt: no elimination
  names in prose without a matching beat).

### [J2-17] [Severity: Major] [Effort: <1day] [Value: High]
**Round-boundary assembly loses and duplicates narration: a pivotal NPC line was swallowed (the reply references an "admission" the player never saw); a full scene rendered twice with contradictory content**
- **Where:** agent-loop round assembly / `round_texts` join (v1 J-5 family, but these are
  content-loss instances, not markdown nits).
- **Problem:** (1) Turn 14 — I directly confronted Carmen ("How exactly do you know…?"). The
  shipped reply BEGINS: *"Her expression doesn't change—cool, composed… Just stating facts as
  she sees them.**The moment hangs—Carmen's cool admission hanging in the air**"* — Carmen's
  actual answer (the "admission" the text references twice) was never rendered; it died at a
  round boundary. The player asked the season's most charged question and the answer was
  eaten. (2) Turn 24 — the Violet gossip scene rendered TWICE in one reply, back to back, with
  differing content between versions ("…You're good, Rhea. For now.**You find Violet in the
  dining room…**"). (3) Persistent no-separator seams: "…eases a fraction.Next up is…" ×14
  (premiere), "…who drops this round?Your grip slips." — round texts concatenated without
  paragraph breaks.
- **Fix:** Join round narrations with a paragraph separator; detect and drop a round's text
  when a later round re-narrates the same beat (near-duplicate suppression); when a round's
  visible text references prior-round dialogue, assert the prior round actually emitted
  visible text (the [BUG2-len] counters already exist — alert on emitted_visible=0 followed by
  a reference).

### [J2-18] [Severity: Major] [Effort: <1day] [Value: Med]
**Model fabrications get recorded as engine events and then diffuse — hallucination becomes permanent canon**
- **Where:** `recordInteraction` (model-called) + `_auto_record_scene`; vault Surfacing events.
- **Problem:** After the Carmen leak (itself fabricated, J2-1), the model recorded:
  *"…Carmen admitted she wasn't in the room but knows anyway…"* (recordInteraction, turn 14 —
  note it also mutated $22,000 into "the twenty-two-dollar breakup story"). The vault then
  shows *"(overheard, clearly) The player confronted Carmen about knowing details of a private
  conversation…"* — the fabricated omniscience event diffused to a third party. I4's fold is
  working exactly as designed on POISONED input: model error → persisted → recalled forever
  (and I5 guarantees it never thins). There is no plausibility check between "the model wrote
  a scene" and "the store now remembers it".
- **Fix:** recordInteraction content that references knowledge-state claims ("X knew/admitted
  knowing Y") should be validated against KnowledgeService pathways before folding (or folded
  with a `model-claimed` provenance flag the retrospective can discount); the auto-record
  extractor already produces structured fields — add a pathway sanity check there too.

### [J2-19] [Severity: Minor] [Effort: <1day] [Value: Med]
**Turn economics: 13–129s per turn, ~3.86M tokens for 40 turns**
- **Where:** session stats (`/api/sessions`: total_tokens 3,863,933, message_count 70);
  transcript elapsed fields (premiere 127s, Violet turn 129s, comp turn 82s).
- **Problem:** ~97k tokens/turn average — full history + 33 tool schemas resent every round,
  multi-round turns re-sending everything 5–11×. Cost aside, the *felt* latency puts 1–2
  minute silences behind the game's marquee beats (premiere, comps). Players will read
  60–120s of nothing as a hang (the stall watchdog is deliberately disabled).
- **Fix:** Game-turn context diet: the beatSeq-keyed stateDelta exists — lean on it +
  compaction for long sessions; trim the tool manifest (J2-11) which alone removes ~18
  schemas/round; consider streaming a diegetic "the feeds hold on the house…" typing beat
  during >20s tool phases.

### [J2-20] [Severity: Minor] [Effort: <1hr] [Value: Med]
**Narration asserted an impossible overhear: Marcus "caught the tail end of your chat with Violet"**
- **Where:** turn 10 kitchen scene: *"He caught the tail end of your chat with Violet,
  apparently—his dark eyes flick toward you… like he's still processing what he overheard."*
  My only Violet chat was behind a closed door in bedroom-b (private wing); Marcus was in the
  kitchen throughout (engine whereabouts).
- **Problem:** Same family as J2-1 but a distinct failure mode: the narration doesn't just leak
  content, it invents an *eavesdropping pathway* as an explanation, teaching the player wrong
  rules about the house's privacy physics (the floor plan makes bedroom overhearing from the
  kitchen impossible BY DATA — 0077).
- **Fix:** Covered by J2-1's knowledge-manifest belt; also add "never assert an overhear the
  engine didn't record (Surfacing events are the only source of overhears)" to momentPrompts.

### [J2-21] [Severity: Minor] [Effort: <1day] [Value: Low]
**Voice bleed and intro-card self-recycling flatten the 16 distinct voices**
- **Where:** NPC dialogue across the session. Evidence: "We'll see." used as a signature
  sign-off by Marcus (twice), Grady ("'Fair?' His eyes hold yours… 'We'll see.'"), and both
  HOHs' nomination speeches ending *"I have my reasons… We'll see how the week plays out"*
  (Jaxon week 1, Maggie week 2 — verbatim same two sentences). Grady re-quotes his own intro
  every scene ("fifty hours a week… just another Tuesday" ×3); Marcus's aerospace line morphed
  into Grady's "fifty hours" phrasing.
- **Problem:** I6's "~16 DISTINCT voices" erodes into one narrator wearing hats; identical
  ceremony speeches across two different HOHs is the most visible tell.
- **Fix:** npcVoice returns exist — require a fresh npcVoice call per ceremony speaker; add
  per-NPC catchphrase variety guidance and forbid reusing another houseguest's tic verbatim.

### [J2-22] [Severity: Minor] [Effort: <1hr] [Value: Low]
**Physical continuity drift: Grady's hair changed color mid-week**
- **Where:** Intro (turn 5): "lanky guy with shaggy chin-length hair… dark-circled eyes";
  turn 17: "His **shaggy blonde hair** catches the light"; turn 42 again "shaggy blonde".
- **Problem:** Observable persona facets are supposed to be byte-stable CHARACTER; the model
  freelances appearance details the engine never stated, then contradicts its own.
- **Fix:** Include the authored appearance facet line in the npcVoice/scene context (it exists
  in the deep profile) and instruct: appearance details come only from there.

### [J2-23] [Severity: Minor] [Effort: <1day] [Value: Med]
**Post-betrayal, Grady speaks with un-earned certainty about my secret ballot**
- **Where:** turn 42: *"'You made a choice,' he continues, his tone not quite accusation…
  reading for tells he might have missed the first time."*
- **Problem:** Ballots are anonymized (E12); Grady legitimately knows only the 8–5 tally. My
  Julie pitch ("I'm voting Grady out") had no vault pathway to Grady (Julie's whispers are
  content-free, J2-14). "You made a choice" + "missed the first time" plays as knowledge, not
  suspicion — the drama is right but the epistemics are fabricated; if the player calls it out,
  there's no recorded justification (same trap as Carmen).
- **Fix:** Same knowledge-manifest belt (J2-1); give the moment prompt an explicit "NPCs may
  SUSPECT the player's ballot but never assert it" rule tied to E12.

### [J2-24] [Severity: Minor] [Effort: <1hr] [Value: Med]
**HUD microcopy confusions: "The House · 15/16" and "No one nearby." under a 14-name present list**
- **Where:** right-rail gadgets (`j2-tab1-final.png`): House chip "The House · 15/16"; Where
  You Are: "Backyard — Marcus, Ingrid, …, Raina" then "**No one nearby.**"
- **Problem:** "15/16" (remaining/cast) needs a label ("15 of 16 remain"); "No one nearby"
  means "adjacent rooms are empty" but reads as "you are alone" directly beneath fourteen
  names.
- **Fix:** Copy: "15 of 16 remain" and "Adjacent rooms: empty" (or drop the line when the
  present list is long).

### [J2-25] [Severity: Minor] [Effort: <1hr] [Value: Med]
**The comp decision card's copy leaks machinery and makes a promise the system breaks**
- **Where:** comp-round card (`j2-tab1-final.png`): "This sets how you play the comp. **Your
  selection only — never read from prose.**" + duplicated name list ("Still in with you: …"
  then "Round 1 — Still in: …" with the same 13/14 names).
- **Problem:** (a) "prose" is developer vocabulary on a player card (I9). (b) The promise is
  false in practice: typing "Throw."/"lock me in" in chat DID drive `submitDecision(comp-round)`
  via the model both weeks — so the card claims exclusivity the seam doesn't enforce, and a
  player who typed something offhand ("guess I'd throw this one") risks a locked intent.
  (c) The double list is redundant bulk on an already-tall card.
- **Fix:** Reword ("Locked in only when you confirm here"); either make the card genuinely
  exclusive (engine rejects model-submitted comp-round while a pending card is unacknowledged —
  pairs with J2-7's typed refusals) or delete the claim; collapse the name list to one line.

### [J2-26] [Severity: Minor] [Effort: <1hr] [Value: Med]
**Orphaned decision card: interactive compete/throw/play-safe card in the DOM while engine pendingDecision is null**
- **Where:** observed at turn ~36: screenshot shows the comp-round card with enabled buttons +
  "Lock in your approach"; `/api/orwell/state.pendingDecision` = null at the same moment (the
  model had already submitted the intent tool-side).
- **Problem:** Clicking it would submit a decision the engine no longer expects (silently
  swallowed per J2-7) — and it visually contradicts the chat, which has already moved on.
- **Fix:** The card should subscribe to the pending's identity (beatSeq/kind) and self-dismiss
  when state polls show the pending resolved (the g15 gamechanged event already fires on the
  mutating tool result — wire dismissal to it).

### [J2-27] [Severity: Minor] [Effort: <1hr] [Value: Low]
**GM closing-formula fatigue: nearly every turn ends "What's your move?"**
- **Where:** turns 5,9,10,12,23,25,26,27,30,33,36,42… (*"What's your move as the house gears up
  for the veto draw?"*, *"What's your next move?"*, *"You're set to watch or engage."*)
- **Problem:** The sign-off reads like a form's Submit label and flattens dramatically distinct
  beats into a uniform cadence; "You're set to watch or engage" is a menu, not a scene.
- **Fix:** momentPrompts: end on the scene's own tension at least half the time; explicitly ban
  the literal "What's your (next) move" phrasing more than once per N turns.

### [J2-28] [Severity: Minor] [Effort: <1hr] [Value: Med]
**The GM asserts the player's reads and re-explains their own strategy to them (I8)**
- **Where:** turn 14: *"**You've got a read now: Carmen's not just watching. She's
  connected.**"; turn 27: *"You've played both sides of the fence—your deal with Grady locks in
  a vote to save him, but you've just given Julie the exact opposite pitch."*; turn 20: "your
  plan's locked in… Let someone else wear the target while you float" (narrating my intent back
  as flavor).
- **Problem:** The first hands the player a conclusion they should form; the others narrate the
  player's inner strategy as GM text — the "feelings are yours" line says surfaces show facts
  + observable behavior, the player infers. Small individually; cumulatively it makes the GM
  feel like a co-pilot grading your play.
- **Fix:** momentPrompts already forbids "you trust them" — extend the ban to "you've got a
  read/you've played both sides" summarizing constructions; never restate the player's plan
  unprompted.

### [J2-29] [Severity: Minor] [Effort: <1hr] [Value: Low]
**Two 404 console errors on every page load**
- **Where:** browser console, both tabs, fresh load ("Failed to load resource: … 404" ×2).
- **Problem:** Noise that masks real errors; likely a missing static asset (favicon/font/map).
- **Fix:** Identify via network tab and fix the path or remove the reference.

### [J2-30] [Severity: Minor] [Effort: <1hr] [Value: Low]
**Engine HTTP arg error doesn't name the expected field**
- **Where:** `POST /:channel/call` with `{"tool": "advanceGame"}` → `{"error":"a tool name is
  required"}` — the correct key is `name`.
- **Problem:** The error says a name is required while a name-ish key is present; trivial but
  wastes integrator time (it cost this audit a probe cycle).
- **Fix:** `{"error":"missing field 'name' (the tool to call)"}`.

### [J2-31] [Severity: Minor] [Effort: <1hr] [Value: Low]
**Casting finalizes unilaterally and assigns competition strengths invisibly**
- **Where:** casting close (turn 4): *"So here's your official casting card… I'm locking that
  in. Season starts now."* — no "anything to correct?" beat; `castingCard.strengths` (scrappy/
  standout/solid) appeared in state without any interview question touching physical/mental/
  social self-assessment.
- **Problem:** The one human-authored profile of the game gets closed without consent or a
  strengths conversation; the card's most gameplay-relevant fields are inferred silently.
- **Fix:** One confirm beat before createCharacter ("read it back; anything wrong?"), and one
  interview question that lets the player self-describe comp strengths.

### [J2-32] [Severity: Minor] [Effort: <1hr] [Value: Med]
**Closed-set beats that were never voiced at all: the player never learned who won the veto; the veto draw never happened on screen**
- **Where:** week 1 (turns 24–25). Engine recap: "the veto players are drawn: …", "Jaxon
  Michael wins the Power of Veto". Narration: skipped both; the ceremony was reported only as
  "Jaxon did NOT use the veto" — the player exits week 1 not knowing the veto winner (had to
  infer it).
- **Problem:** Beyond montage (J2-5): entire closed-set facts silently missing from the story.
  The engine's recap highlights are exactly the must-voice list — nothing consumes them.
- **Fix:** Belt: on each ceremony/comp beat transition, diff the engine's new recap highlights
  against what was narrated this turn (string-level is fine) and force-voice the missed ones
  next beat.

### [J2-33] [Severity: Polish] [Effort: <1hr] [Value: Low]
**"You've got two minutes before we kick off your next HOH competition!" — pacing-whiplash copy straight after the eviction**
- **Where:** turn 32 narration (the engine-true week rollover happened next turn anyway).
- **Problem:** Real BB never runs eviction→HOH inside "two minutes" of fiction; it also
  contradicts the game's own "a week = one reign, runway matters" rhythm and primes the player
  to expect force-march.
- **Fix:** momentPrompts: the post-eviction beat is aftermath/goodbyes; the next HOH comp opens
  a NEW beat on its own turn.

### [J2-34] [Severity: Polish] [Effort: <1hr] [Value: Low]
**Zeitgeist background task spams failing search providers at createCharacter**
- **Where:** FE log 02:13: SearXNG connection refused ×4, grokipedia/google/mojeek/yandex/
  startpage timeouts — ~20s of failing fan-out during the premiere turn.
- **Problem:** Fail-soft works, but the noise buries real warnings and burns startup seconds in
  the game's highest-latency turn window.
- **Fix:** Probe-once provider selection (skip configured-but-dead providers for the session);
  log one summary line.

### [J2-35] [Severity: Polish] [Effort: <1hr] [Value: Med]
**Workspace chrome corroborations (v1 J-8) — still shipping**
- **Where:** `j2-tab1-final.png`: header "Week 2 **· 86 msgs** ✏️", composer "glm-4.7" model
  pill, sidebar "New Chat / Search / Chats", session named "game" with rename pencil.
- **Problem:** Corroborates v1 J-8 unfixed (two independent hits — priority raise per charter).
  The msgs counter and model pill are the loudest machinery tells in every screenshot.
- **Fix:** Gate them out under ORWELL_GAME_BUILD (title: week + phase; pill: hidden or
  "The Feed").

---

## Probe-area scorecard (the 9 assigned areas)

1. **Lingering as play — FAILED.** Presence/adjacency is real (engine whereabouts, tracked
   set, turnsHere) and one genuine bidirectional scene fired (Violet approaching in bedroom-b).
   But passive lingering gets punished: "I wait on the couch" ran the nomination ceremony
   (J2-5); room texture is fabricated as often as grounded (J2-9). The house is alive in the
   Vault and inconsistently alive on screen.
2. **Diary Room — FAILED both ways.** As an experience: a silent dropbox (J2-13). As a wall:
   the DR plan surfaced in an NPC's mouth next turn (J2-1) — the single worst violation found.
3. **Deals — MIXED.** Engine-side exemplary: belt-extracted, tracked, breach-detected, canon
   in recap + gadget. Fiction-side: the betrayal's consequences got tangled in the four-way
   eviction retcon (J2-6), and Grady's aftermath knowledge is un-earned (J2-23).
4. **Gossip/pathways — FAILED structurally.** Engine diffusion exists and runs (hundreds of
   whispers, Surfacings with fidelity grades) but carries no fact content (J2-14); planted
   tracers can't travel; NPC "knowledge" of specifics is model-fabricated (J2-1), and one
   fabrication entered canon (J2-18). The one distortion-shaped success: Violet's
   storage-room rumor traced to a real vault whisper.
5. **Night/sleep (0066) — FAILED silently.** The economy never ran (flag dead in default
   deploy, J2-12); night is narrated flavor with no mechanics; no rest cue, no shrinking awake
   set from the clock; the fiction invented a full night the engine never advanced (C3).
6. **Consistency (3 NPCs tracked) — FAILED at placement, PASSED at persona-surface.** Jaxon/
   Carmen/Marcus stayed in-archetype verbally, but placements contradicted engine truth in
   4/6 scenes, Grady's appearance drifted (J2-22), voices share tics (J2-21), and Carmen/
   Marcus both displayed impossible knowledge (J2-1, J2-20).
7. **Ceremony feel / v1 montage — CORROBORATED and worse.** Not just montage: set-pieces
   consumed invisibly inside social turns (J2-5), comps triple-told or one-turn-collapsed
   (J2-16), the eviction told four contradictory ways (J2-6).
8. **Mid-game UX (reload + second tab) — PASSED.** 84 messages restored on reload; second tab
   converged and mirrored a live stream in lockstep; gadgets (deals, presence, season chip)
   populated in both. Residue: orphaned decision card (J2-26), console 404s (J2-29).
9. **Tone/immersion micro-findings — LOGGED.** Machinery vocab in prose (J2-10), GM asserting
   my reads (J2-28), closing-formula fatigue (J2-27), tone-preset goodbye buttons (accepted my
   authored text though — E34 substance held), casting card fait-accompli (J2-31).

## Narration-vs-engine cross-checks (SOUL lesson 22 — 8 claims verified)

| # | Narrated claim | Engine truth (bundle/state) | Verdict |
|---|---|---|---|
| 1 | "Grady Sullivan has been evicted 13-0 unanimous" (t32) | Keith evicted 8–5; engine was DEAD during that turn | FABRICATED |
| 2 | "By a vote of 9 to 4, Keith Shelton evicted" (t33) | 8–5 (13 ballots, correct voter set) | WRONG TALLY |
| 3 | "You voted to keep the guy who actually stayed" (t33) | player→votedFor npc:6 (evict Grady, who stayed) | INVERTED |
| 4 | Player wins week-2 HOH (t36, t39) | hoh: Maggie O'Connell; player dropped mid-comp | FABRICATED ×3 |
| 5 | Carmen knows the $22k bedroom secret + DR plan (t13) | No pathway event exists; only the aftermath Surfacing | FABRICATED (I3) |
| 6 | Violet's rumor: "Ingrid & Nick slipping off to the storage room" (t24) | Vault whisper: verbatim real | GROUNDED ✓ |
| 7 | "Jaxon did NOT use the veto" (t25) | Recap: Jaxon won veto, did not use | TRUE (but winner never voiced) |
| 8 | Deal with Grady struck + broken | Vault/recap: safety+vote deals recorded, both "broke" events canon | GROUNDED ✓ |

## Where I looked / did NOT cover
Covered: full casting→week-2-noms live playthrough (42 turns), all 9 probe areas, engine truth
cross-checks per scene, vault/debug bundle forensics, reload + two-tab mirror under Playwright,
FE log forensics (belts, guards, token/latency), tool-manifest and time-of-day source dives.
NOT covered: mobile viewports (responsive lane), endgame/finale/retrospective beats (weeks 3+ —
though J2-15 predicts the unsealing's quality problem), token-economy settings UI, admin
surfaces beyond debug-bundle, TTS/voice, portrait pipeline beyond logs (note: portraits logged
"cast set for default: generated=1" — 1 of 16?), multi-user isolation (single-user env).

## Cross-territory flags
- **ADVERSARIAL:** bash/edit_file/api_call advertised to the narrator with AUTH_ENABLED=false
  (J2-11) is a prompt-injection→execution candidate; engine silent no-op on invalid decisions
  (J2-7) may mask state-tamper attempts.
- **BACKEND/ENGINE:** the silent engine crash (J2-4) needs a repro hunt; typed-refusal seam
  (J2-7); gossip payloads (J2-14); confessional templating + "player" ids (J2-15).
- **FRONTEND:** guard excision behavior (J2-3), round-assembly loss/dup (J2-17), orphaned
  decision cards (J2-26), game-build tool manifest (J2-11), time-of-day lazy-apply (J2-12).
- **PROMPT-AI:** knowledge-scoping manifest (J2-1/20/23), must-voice recap diffs (J2-32),
  closing-formula and I8 phrasing bans (J2-27/28).

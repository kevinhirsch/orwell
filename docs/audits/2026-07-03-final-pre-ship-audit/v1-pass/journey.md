# JOURNEY / IMMERSION AUDIT — Orwell (live real-model playthrough)

**Model:** z-ai/glm-4.7 (reasoning=low) via OpenRouter, per ADR 0016. Stack booted clean
(engine :8770, FE :7010, all 4 SOUL-lesson-17 traps cleared). Full golden path played as a
first-time player ("Dana"), casting → Week 2 HOH comp.

**Golden-path beats reached:** casting ✅ · premiere ✅ · HOH comp ✅ · nominations ✅ ·
veto comp ✅ · veto ceremony ✅ · eviction + goodbye ✅ · into Week 2 ✅ (all beats hit).

**Evidence:** `journey-debug-bundle.json` (final, vault=1), transcript captured inline below +
in `/tmp/.../tasks/*.output`. Screenshots `shot-desktop-home.png`, `shot-mobile-home.png`,
`pw-desktop.json`, `pw-mobile.json`.

## What genuinely works (state plainly — the core fantasy lands)
- **Casting feels cast, not configured.** A named casting director ("Ava") runs a warm,
  probing interview, files a dossier, refuses to finalize an incomplete one, then hands off to
  a rich premiere. Being-cast fantasy delivered.
- **16 distinct people (I6 strong).** Every houseguest intro carried a differentiated
  occupation, physicality, self-framing, and voice (Mila the brash ER nurse, Mateo the
  grandiose UX designer, Bianca the blunt Aussie engineer, Regina the young tough foreman…).
- **Anti-sycophancy / engine-decides held all game (I2/I8/I10).** Declared *Compete* for HOH
  and was eliminated anyway; voted to evict Maeve and the **house majority overruled me and
  evicted Jada** — a real blindside. Engine truth (producerVault) confirms my dissenting vote
  was faithfully recorded; per-voter attribution stays Vault-sealed (E12 secret ballot).
- **Vault Wall intact (I1).** No hidden state, secret thread, or ballot attribution leaked into
  any player-facing narration across the whole run.
- **`runCompetition` correctly ignores caller participants** (verified in GameSessionAdapter) —
  the model's fabricated veto roster was harmless.
- **Mobile reflows cleanly** — no horizontal scroll at 390px.

---

## Index

| id | severity | effort | title | where |
|---|---|---|---|---|
| J-1 | Major | <1day | Premiere opening beat is ungrounded → invents a phantom houseguest; then blames the player | premiere / momentPrompts.ts §618; agent_loop premiere seam |
| J-2 | Blocker | <1day | Marquee social action returns an empty non-narration; 77s reasoning/room-wander loop never voices the scene | agent_loop.py loop-termination; L39-family belts |
| J-3 | Major | <1day | Every structural transition montages multiple set-pieces into one turn (no runway, no set-piece) | agent_loop advanceGame chaining / stall-nudge belts |
| J-4 | Major | <1hr | `update_plan` workspace tool exposed to the narrator → docked TODO of game objectives | chat.js:2923, agent_loop.py:409, orwellToolBeats.js:59 |
| J-5 | Minor | <1hr | Beat-concatenation stutter + broken markdown in multi-beat turns; "ready?" false-prompt | chat stream round_texts join |
| J-6 | Minor | <1hr | Stale "Welcome to the house / Meet the house →" onboarding card persists after 16/16 met | FE decision-card lifecycle |
| J-7 | Minor | <1hr | Non-binding comp-round card shows compete/throw/play-safe buttons but says "no stakes, locked" | FE comp-round card, `binding` flag |
| J-8 | Minor | <1hr | Workspace machinery visible in game UI: "glm-4.7" model pill, "· NN msgs" counter, New Chat/Search/Chats nav | FE game-build gating |
| J-9 | Minor | <1day | `eviction-vote` pending not rendered as a decision card (model narrated past the hard stop) | FE pending→card render |
| J-10 | Minor | <1hr | Model fabricates `runCompetition` participantIds (incl. the player); harmless but shows roster desync | narration fidelity |
| J-11 | Polish | <1hr | Casting loops one question 3× before finalizing; 5-intro turn truncated mid-sentence (verbosity overflow) | castingIntake / max_tokens |
| J-12 | Minor | <1hr | "N of 15 met" progress counter + hard gate reads gamey/checklist-y; mild force-march vs. "lingering is play" | premiere meet-everyone gate |
| J-13 | Minor | <1hr | `/api/orwell/roster` intermittently returns empty (16 once, empty twice) — Cast/HUD flash risk | orwell_routes.py roster |

---

## Findings (full schema)

### [J-1] [Severity: Major] [Effort: <1day] — Premiere's opening beat is ungrounded, invents a phantom houseguest, then gaslights the player
- **Where:** premiere narration (first beat after `createCharacter`); `src/engine/momentPrompts.ts`
  lines 304–309 ("NEVER invent … a name you make up is an instant, immersion-shattering
  contradiction") and 618 ("Call whereabouts BEFORE you describe ANY room or who-is-present scene").
- **Problem (I2 + I6):** The premiere's opening narration named **"Audrey Duran — petite, light
  olive complexion, animated even from here"** in the backyard. **Audrey Duran does not exist** in
  the 16-person engine roster (real cast: Maeve O'Shea, Shea O'Malley, Klaus Bauer, Mila
  Kowalski…). The model narrated a who-is-present scene *before* calling `whereabouts`/
  `premiereIntros`, so it hallucinated a houseguest with a full name, description, and room
  placement. GM text (premiere): *"through the glass door, Audrey Duran is out in the backyard…"*
  Then when I acted on it ("I walk over to Audrey"), the game replied: ***"There's no Audrey in the
  house, I'm afraid — you might be mixing up names."*** The player didn't mix up names — **the game
  told them Audrey was there**. This gaslights the player about the game's own prior statement on
  the single highest-stakes "15 strangers become distinct people" beat. Room placements also
  shifted between the opening beat (Julian in living room) and the grounded read (Julian in
  backyard). The guardrail is prompt-wording only — exactly what the mandate says never to rely on.
- **Fix:** Add a hard belt (like the other FE belts) that forces a `whereabouts`/`premiereIntros`
  call and injects the real present-set **before** the first premiere room narration is allowed to
  stream; the model must ground before it describes anyone. Do not let the opening beat free-narrate
  the room.

### [J-2] [Severity: Blocker] [Effort: <1day] — The player's marquee social action returns an empty non-narration (model burns a 77s reasoning/room-wander loop and never voices the scene)
- **Where:** `frontend/src/agent_loop.py` (loop termination / step-budget); the reply that shipped
  to the player. Repro: after noms, I typed *"I pull Lorenzo aside privately… quietly float that
  Maeve is the bigger threat… build trust with the new HOH and steer him."*
- **Problem (core loop / I4-adjacent):** The rendered reply was in full: **"The moment hangs for a
  beat. The house keeps moving around you — what do you want to do?"** — nothing else. The model
  spent the entire 77s / ~9,800-output-token turn on `moveTo` ×4 (HOH-room→living-room→hallway→
  hoh-room), `getGameState`, `socialInitiatives`, `npcVoice` ×2, and a long analysis-paralysis loop
  over *"is the hallway private enough (the nominees are here)?"* — its own reasoning repeatedly says
  *"I haven't actually narrated the scene yet! Let me do that now"* and then **ends the turn without
  narrating.** It DID call `recordInteraction` (evt:mcp:163 — the hidden fold happened), so the
  scene has consequence but **zero payoff**: the player used conversation — the game's only
  instrument, its entire promise — on the game's most important actor, and got a shrug after a
  60s+ wait. This is the felt game failing at its core. (It's model-behavior-dependent and may be
  intermittent, but it triggered on a completely natural action.)
- **Fix:** Cap pre-narration tool exploration (e.g. one `moveTo`/`whereabouts` + one `npcVoice`,
  then narrate); when the agent loop terminates a stuck turn on the step budget, its fallback must
  emit the *narrated* scene (or route the auto-record path to also narrate), never the bare "what do
  you want to do?" line. Investigate why the loop exhausts rounds while the model is still saying it
  intends to narrate.

### [J-3] [Severity: Major] [Effort: <1day] — Every structural transition montages multiple set-piece beats into one turn (kills the runway and the set-piece)
- **Where:** `frontend/src/agent_loop.py` advance chaining + the L39-family stall-nudge/forced-advance
  belts. Observed every ceremony transition.
- **Problem (C3 + the vision's "beat-by-beat, no montage" / "unhurried social runway" / "ceremony as
  an exclusive set-piece"):** The model chains `advanceGame` greedily and batches structural beats:
  - HOH **crown → the entire nomination ceremony** in one turn (`advanceGame`×2): Lorenzo won and
    immediately nominated Jada & Maeve — no runway for the player to work the new HOH before noms.
  - Veto **comp fully resolved** in one turn (`runCompetition`+`advanceGame`×4).
  - Eviction **vote → tally → result → goodbye setup → Week 2 → next HOH comp** across one/two turns
    (`submitDecision`+`advanceGame`×4+`runCompetition`+`advanceGame`).
  The "lived aftermath scramble" and the social runway — which the vision calls the heart of the
  game ("lingering IS play") — are skipped, and no ceremony lands as an isolated set-piece. The live
  eviction (the week's climax) also **skipped the designed staged anonymized-ballot reveal (E12)** —
  the model just wrote "the voting has finished" and jumped to the result.
- **Fix:** Do not allow multiple `advanceGame` calls in a single turn across a ceremony boundary;
  make each set-piece one-beat-per-turn with a mandatory pause/runway beat between (HOH→[runway]→
  noms→[runway]→veto…). Ensure the staged eviction ballot reveal actually renders.

### [J-4] [Severity: Major] [Effort: <1hr] — `update_plan` workspace tool is exposed to the narrator and renders a docked TODO of game objectives
- **Where:** `frontend/src/agent_loop.py:409` (tool advertised), `frontend/static/js/chat.js:2923`
  (`plan_update` → `_setStoredPlan` → "live-refresh the docked plan window"),
  `frontend/static/js/orwellToolBeats.js:59` (`'update_plan': '📋 Production notes'`). Not gated by
  `ORWELL_GAME_BUILD`.
- **Problem (C2/C5/I9 + "don't improve the game into a dashboard"):** In the Lorenzo turn the model
  called `update_plan` with a literal workspace checklist:
  `"- [ ] Meet all 15 houseguests (11/15 met)\n- [ ] First HOH competition\n- [ ] Connect with
  Lorenzo (HOH)\n- [ ] Power of Veto competition\n- [ ] First eviction vote"` — then again marking
  steps `[x]`. The beat chip is masked to "📋 Production notes," but `plan_update` refreshes a live
  **docked plan window** with the raw checklist — a spoiler-ish walkthrough/dashboard of future game
  structure, exactly what ADR 0003 forbids. It also **consumed turn budget that contributed to J-2's
  empty narration.**
- **Fix:** Remove `update_plan` (and any other workspace agent/plan tools) from the game-build
  narrator toolset; suppress the docked plan window entirely under `ORWELL_GAME_BUILD`.

### [J-5] [Severity: Minor] [Effort: <1hr] — Beat-concatenation stutter + broken markdown in multi-beat turns; "ready?" false-prompt
- **Where:** chat stream `round_texts` concatenation (multiple agent rounds joined in one bubble).
- **Problem (I9 polish):** When a turn emits multiple round texts they concatenate with no
  separation and markdown breaks: `"…send Maeve O'Shea home.The voting has finished."`,
  `"It's time for the HOH competition.**The second HOH competition is underway"`, a dangling `**`
  on its own line in the eviction reveal, `"Welcome to Big Brother.**SEASON 1 — PREMIERE NIGHT"`,
  and `"Ready to keep pushing?And just like that, the floor drops out."` — the last is also a
  **false-prompt**: the narration asks the player "Ready to keep pushing?" then immediately answers
  itself and resolves the comp without input.
- **Fix:** Join round texts with a paragraph break; ensure each beat's markdown is self-closed;
  suppress a rhetorical "ready?" question when the same turn is going to resolve the beat anyway.

### [J-6] [Severity: Minor] [Effort: <1hr] — Stale "Welcome to the house / Meet the house →" onboarding card never dismisses
- **Where:** FE decision-card lifecycle (welcome/onboarding card). Seen on **both** desktop and
  mobile screenshots after 16/16 met and the HOH comp already running.
- **Problem (I9 — decision cards are hard stops; a stale one confuses):** The card still reads
  *"You'll need to cross paths with all fifteen houseguests before Production calls the first HOH
  competition"* with an active "Meet the house →" button, while the HUD shows 16/16 and the comp-round
  card is live above it. Two stacked cards create ambiguity about what to click.
- **Fix:** Expire/dismiss the welcome card once the meet-everyone gate completes / the HOH comp begins.

### [J-7] [Severity: Minor] [Effort: <1hr] — Non-binding comp-round card shows choice buttons but says the choice is locked
- **Where:** FE comp-round decision card; the `binding` flag on `PendingDecisionView`.
- **Problem:** The card titled "Competition round — keep pushing (no stakes)" renders
  compete/throw/play-safe buttons **and** a "Push through this round" button, while its own body says
  *"Your approach is already locked from the first round, so this is just color"* and *"No stakes here
  — your approach was locked in round one."* Offering intent buttons on an inert, non-binding round is
  misleading — the player thinks they're re-declaring intent.
- **Fix:** When `binding=false`, render color/flavor + a single "continue" affordance only; hide the
  compete/throw/play-safe buttons.

### [J-8] [Severity: Minor] [Effort: <1hr] — Workspace machinery visible in the game UI
- **Where:** FE chat composer + header + left nav under the game build.
- **Problem (C2/I9 — machinery invisible):** Player-visible surface shows a **"z glm-4.7"
  model-picker pill** (names the LLM), a **"· NN msgs" message counter** in the session header, and
  left-sidebar **"New Chat / Search / Chats"** workspace-chat holdovers. In a fiction that forbids
  naming the machinery, the model name and a message counter are direct bleed-through.
- **Fix:** Hide the model pill, the message counter, and the chat-workspace nav items when
  `ORWELL_GAME_BUILD` is on.

### [J-9] [Severity: Minor] [Effort: <1day] — `eviction-vote` hard-stop wasn't rendered as a decision card
- **Where:** FE pending→decision-card render; engine `gameState.pendingKind == "eviction-vote"`.
- **Problem (I9 — hard-stop decisions should render as cards):** At the eviction the model narrated
  *"Now it's your turn"* and listed the two nominees, but emitted **no `ask_user` / vote card**, even
  though the engine had a binding `eviction-vote` pending. The player is left with no explicit control
  (I had to free-text "I vote to evict Maeve"). A first-timer could stall here not knowing how to vote.
- **Fix:** Render binding pending decisions (eviction-vote, goodbye-message, etc.) as a decision card
  from the engine pending state regardless of whether the model calls `ask_user`.

### [J-10] [Severity: Minor] [Effort: <1hr] — Model fabricates `runCompetition` participant list (harmless, but shows roster desync)
- **Where:** veto comp turn; `src/adapters/engine/GameSessionAdapter.ts:7191` (`runCompetition`).
- **Problem:** The model called `runCompetition` with `participantIds:[npc:10,npc:6,npc:3,npc:0,
  npc:2,npc:5]` — including **the player (npc:0)** who declared they weren't playing, plus non-veto
  players (Bianca, Klaus), and omitting real veto players Lorenzo/Javier/Mila. **No outcome impact**
  (the engine validates ids-are-living then ignores caller participants, using the locked veto field —
  Shea, a real veto player, won). But it shows the model doesn't reliably read `veto.players` before
  narrating the field. If it ever narrated the *field* from its own bogus list, it'd contradict truth.
- **Fix:** None required for correctness. Optionally have the veto moment prompt make the model read
  `veto.players` before narrating who competes, to keep tool-call and narration consistent.

### [J-11] [Severity: Polish] [Effort: <1hr] — Casting loops one question; 5-intro turn truncated mid-sentence
- **Where:** `src/engine/castingIntake.ts` finalize gate; per-turn `max_tokens` for premiere intros.
- **Problem:** Ava asked the "why are you here" question **3 times across 3 turns** and refused to
  finalize ("I don't file incomplete dossiers") until answered — character-plausible but risks feeling
  like a wall to a player who just wants in. Separately, when asked to voice all 5 remaining
  houseguests in one turn, the 5th intro (Tanner) **truncated mid-sentence** (*"a boyish grin that
  hasn't quite faded despite the"*) — GLM verbosity overflow against the token cap.
- **Fix:** Accept a clear "ready" signal after 1–2 probes; cap voiced-intros-per-turn (or raise
  max_tokens for premiere-intro turns) so an intro never truncates.

### [J-12] [Severity: Minor] [Effort: <1hr] — "N of 15 met" counter + hard gate reads gamey and mildly force-marches
- **Where:** premiere meet-everyone gate (#380 belt) + its narration.
- **Problem (I9-adjacent / C3):** The GM surfaced *"You've got 11 of 15 houseguests met… the first
  HOH competition can't begin until you've met everyone"* — a mechanical completion counter + a hard
  requirement. It reads like a quest tracker and mildly force-marches against "lingering is play."
  Acceptable onboarding, but the phrasing is a machinery tell.
- **Fix:** Make it diegetic ("a few faces you still haven't crossed") rather than "11 of 15"; don't
  frame the comp as blocked-until-complete.

### [J-13] [Severity: Minor] [Effort: <1hr] — `/api/orwell/roster` intermittently returns empty
- **Where:** `frontend/routes/orwell_routes.py` roster endpoint (has `_last_good_roster` fallback).
- **Problem:** The roster returned 16 cards on the first call and **empty** on two later calls during
  active play. If the Cast HUD panel consumes this without the last-good fallback on every path, it
  can flash empty mid-game.
- **Fix:** Confirm the `_last_good_roster` fallback covers the HUD/Cast panel path; investigate the
  intermittent empty response (likely a mid-mutation read).

---

## Severity tally
- **Blocker: 1** (J-2)
- **Major: 3** (J-1, J-3, J-4)
- **Minor: 8** (J-5, J-6, J-7, J-8, J-9, J-10, J-12, J-13)
- **Polish: 1** (J-11)

## Cross-territory flags (for other lanes)
- **Narration-fidelity lane:** J-1 (premiere hallucinates a houseguest), J-10 (fabricated veto
  roster), J-2 (empty narration on step-budget exhaustion), J-11 (truncation). These are GLM-4.7
  narration-seam issues — the ship-gate weighs this seam heaviest.
- **Transient/animation + FE lane:** J-5 (concatenated beats / broken markdown), J-6 (stale card),
  J-7 (misleading comp-round buttons), J-9 (unrendered decision card).
- **Social-game lane:** J-3 (montaged ceremonies, skipped staged ballot reveal) — the set-piece and
  runway design isn't being honored at runtime.
- **A11y/perf lane:** J-2's 77s turn is also a latency data point.

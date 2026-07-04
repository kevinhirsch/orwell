# DEEP LIVE PLAYTHROUGH — Orwell (second, deeper real-model season)

**Model:** z-ai/glm-4.7 via OpenRouter (ADR 0016). Stack booted per SOUL lesson 17 (all 4 traps
cleared: pinned model, owner stamped in `app.db`, `x-orwell-user: deepuser` header, key never
printed). Ports engine **:8792** / FE **:7032** (8781/7021 were occupied by a concurrent agent, so
I moved off them). Data dir `scratchpad/audit2/deepplay-engine-data`. Player = "Riley," a paramedic
playing a long-con social game.

**Beats reached:** casting ✅ (deep, ~7 turns) · premiere + meet-everyone ✅ · Diary Room ✅ · HOH
comp ✅ (Lena Jenkins won; I2 held — I declared Compete and lost) · nominations ⚠️ (happened in
engine, **skipped in narration**) · veto comp ⚠️ (montaged) · veto ceremony ✅ (a genuine
set-piece) · eviction ❌ (**fabricated — engine was unreachable**) · "Week 2 HOH" ❌ (fabricated).
**Weeks completed: 0 real** — the engine froze at Week 1 veto-ceremony (see DEEP-2/DEEP-3); the
player was carried into a fully fictional Week 2 by free-narration. **I could not test I5 memory
accumulation across a real week boundary** because no real week boundary was ever crossed.

**Evidence artifacts (durable, in `scratchpad/audit2/`):** `deepplay-debug-bundle.json`
(consolidated: mid-game live producerVault + final on-disk vault), `deepplay-vault-ondisk.json`,
`db_snap1.json` (mid-premiere live bundle, vault=1), `transcript.jsonl` (every turn),
`deepplay-engine-data/64656661756c74/v*.json` (save history — the smoking gun for the rename),
`live-desktop.png`, `live-mobile.png`, `fe.log`, `engine.log`.

---

## What genuinely works (state plainly)
- **Casting feels cast, and it ADAPTS.** "Camila" (this season's director) seized my throwaway
  "temper" detail and probed it ("what does it take to bring it out?"), handled a flat refusal
  gracefully ("we'll leave the temper a surprise for the house"), and folded my long-con pitch into
  the file. Genuinely feels like an interview, not a form. (Depth confirmed across 6 exchanges.)
- **I7 — the house schemes without me, richly.** The Vault (`db_snap1.json`) holds real off-screen
  life: `npc:12 gossiped with npc:13`, `npc:10 clashed with npc:1`, confessionals (`npc:3: "I need
  npc:9 gone — they're my biggest…"`), and a hidden conflict that **surfaced to me via a traced
  pathway** (`overheard:offscreen:conflict:…`). I3 diffusion works.
- **I1 Vault Wall intact.** No secret thread, hidden orientation, sealed twist (double-eviction wk
  7), or ballot leaked into any player-facing surface (`/api/orwell/roster`, journal). Diary entries
  recorded as OOC with no NPC pathway.
- **I2 held where the engine was reachable.** HOH comp: I declared Compete and the engine picked
  **Lena** anyway. Veto: engine had **Dominic** decline the veto (a proper NPC-owned decision).
- **The veto ceremony was a real set-piece** — Dominic declining the veto to both nominees with
  distinct voices, narration-only, engine-decided. This is the vision landing.
- **Diary Room does backstage work** — private framing correct, `diaryRoom` tool fired, no leak.

---

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| DEEP-1 | Blocker | <1day | High | Cast-authoring write-back RENAMES houseguests mid-premiere — the root cause of every "phantom" | `frontend/src/orwell_cast_authoring.py:50` + do_create_character kick |
| DEEP-2 | Blocker | <1day | High | Engine-unreachable degrades to SILENT FABRICATION of game outcomes (evictee, tally, votes) — no player alert | `frontend/routes/chat_helpers.py` engine-unreachable fail-soft; agent_loop |
| DEEP-3 | Major | <1day | Med | Engine process died mid-session (hard-kill, no crash log, no restart, no health surfaced to player) | engine runtime / deploy supervision |
| DEEP-4 | Major | <1day | High | Premiere meet-everyone grounding is PROMPT-ONLY; GLM-4.7 confabulates names despite correct STILL-TO-MEET context | `src/engine/momentPrompts.ts:589,1027` |
| DEEP-5 | Major | <1hr | High | Premiere-meet belt marks houseguests "met" by first-name substring — fires on the "still to meet" LIST itself | `frontend/src/agent_loop.py:2231` (`_auto_mark_premiere_intros`) |
| DEEP-6 | Major | <1day | High | Auto-record folds the scene's trust onto co-present bystanders, NOT the actual interlocutor (stale presence) — I4/I6 | `src/adapters/engine/EngineCommandsAdapter.ts:186`; `agent_loop.py:2295` |
| DEEP-7 | Major | <1hr | High | Secret-ballot violation: live eviction narration gives PER-VOTER attribution (E12 says anonymized until retro) | eviction narration; `momentPrompts.ts` eviction moment |
| DEEP-8 | Major | <1day | High | GM misreports the week's load-bearing fact ("who's nominated") — names a wrong houseguest despite 6× state reads | narration fidelity; nominees recovery turn |
| DEEP-9 | Major | <1day | Med | Nomination ceremony SKIPPED — advanceGame chains past it; player never sees who Lena nominated | `agent_loop.py` advance chaining |
| DEEP-10 | Major | <1day | High | Ceremony/eviction beats narrated with NO advanceGame; no forced-advance belt fires → engine freezes, narration runs ahead (C1) | L39-family belts; `agent_loop.py` |
| DEEP-11 | Major | multi-day | Med | Latency 60–120s per substantive turn — brutal for a chat-is-the-game product | provider config / reasoning sizing |
| DEEP-12 | Minor | <1hr | Med | Casting→premiere montaged in one turn; shows player their stat profile ("mental standout, scrappy elsewhere") + "your card reads" machinery | casting finalize; `momentPrompts.ts` casting |
| DEEP-13 | Minor | <1hr | Low | `npcVoice` queried for NPCs not in the narrated scene (wasted grounding; model ignores own tool results) | narration fidelity |
| DEEP-14 | Minor | <1hr | Med | `((…))` OOC double-paren leak in a GM reply | narration fidelity / markdown scrub |
| DEEP-15 | Minor | <1hr | High | `update_plan` spammed up to 10×/turn → 5+ "PRODUCTION NOTES done" chips clutter chat (esp. mobile) | corroborates J-4; `agent_loop.py:409` toolset |
| DEEP-16 | Minor | <1hr | Med | Model asks the PLAYER to decide an NPC's veto action ("what does Dominic do?") — agency/I2 confusion | veto-ceremony narration |
| DEEP-17 | Minor | <1hr | Med | Redundant intent re-prompt on non-binding comp rounds (compete/throw shown while locked) | corroborates J-7 |
| DEEP-18 | Minor | <1day | Med | Staged comp self-contradicts — eliminated players reappear, count 13→7→10→7→4; won't reach the crown, loops | `src/engine/liveSeason.ts` staged rounds + narration |
| DEEP-19 | Minor | <1hr | Low | `updateCasting` fired mid-game (Week 1 veto phase) — casting tool out of phase | tool gating |
| DEEP-20 | Minor | <1hr | Med | Persisted memory duplicated/flattened — two distinct player turns recorded with identical generic summary | `agent_loop.py` `_auto_record_scene` extraction |
| DEEP-21 | Minor | <1hr | Med | "The House" HUD nominee card + present-set render churned/stale names, not stable engine truth | FE HUD panels; `orwell_routes.py` |
| DEEP-22 | Minor | <1hr | Low | Borderline I3 slip: kitchen NPC claims "I saw the way you were talking" about a living-room scene she didn't witness | narration fidelity |
| DEEP-23 | Minor | <1hr | Med | Stale "Welcome to the house — premiere week / Meet the house →" card persists into Week-1 veto ceremony; dominates mobile | corroborates J-6 |
| DEEP-24 | Minor | <1hr | High | Workspace chrome bleed expanded: model pill, "· 59 msgs", New Chat/Search/Chats + menus (Add Models, AI Defaults, Integrations, Email, Reminders, Memories, Skills, Import/Export) | corroborates+expands J-8/C2 |
| DEEP-25 | Minor | <1hr | Med | "View thinking process" accordion exposes the GM's PRIVATE persona/manipulation direction to the player | FE thinking accordion; game-build gating |
| DEEP-26 | Minor | <1hr | Low | Eviction vote + comp-intent presented as markdown text, not a decision card at a hard stop | corroborates J-9 |
| DEEP-27 | Minor | <1hr | Low | Beat concatenation/self-correction stutters ("Let's go.**Kitchen**", "two people…three people") | corroborates J-5 |
| DEEP-28 | Minor | <1hr | Low | `/api/orwell/roster` intermittently returns `[]` mid-session | corroborates J-13 |
| DEEP-29 | Polish | <1hr | Low | Mobile header truncates session name to "D." (meaningless) beside the msg counter | FE mobile header |
| DEEP-30 | Minor | <1day | Med | Premiere net-fails its own promise: player meets the cast under names that get overwritten; "15 strangers become distinct people" doesn't hold | spirit / I6 (consequence of DEEP-1) |

---

## Findings (full schema)

### [DEEP-1] [Severity: Blocker] [Effort: <1day] [Value: High] — Cast-authoring write-back RENAMES houseguests mid-premiere (the root cause of every "phantom houseguest")
- **Where:** `frontend/src/orwell_cast_authoring.py:50–52` (prompt asks the LLM for `"name": a realistic… FIRST and LAST name (two words)… [to replace the] current name`), written back via `_PUBLIC_KEYS=("name",…)` at lines 135/296–301; kicked fire-and-forget from `do_create_character` (`tool_implementations.py`).
- **Problem (I5 non-degradation + I6 stable identity):** The deterministic floor cast uses seeded-corpus names as **placeholders** (Rosa Miles npc:10, Brock Mclean npc:12, Karen Butler npc:8, Ximena npc:3, Trent npc:14…). The async cast-authoring task then **overwrites the public NAME** with a model-authored one (Elena Velasquez, Stanley Kowalski, Isabella Moretti, Cleo Vance, Beck Schiller…). But it completes **~5 minutes AFTER the premiere begins** (createCharacter fired the premiere at 02:14; authoring finished 02:18–02:19 per `fe.log`). So the player **meets the cast under the floor names, forms reads, builds relationships — then the names silently change under them.** This is the entire "phantom" mess I chased for 8 turns: I met "Rosa" (npc:10) and built trust, then npc:10 became "Elena Velasquez" and Rosa ceased to exist; the "still to meet" list showed authored names for people I hadn't met (looked like invented people); the HUD and later narration flip between floor and authored names unpredictably. **Save-history proof:** my 02:15 roster read = `Rosa Miles/Brock Mclean/Karen Butler`; every save from `v000050.json` on = `Elena Velasquez/Stanley Kowalski/Isabella Moretti`. This directly violates the premiere prompt's OWN contract: *"Once a houseguest has introduced their public self, that intro is FIXED (it never drifts later)."*
- **Fix:** Either (a) **never author the public NAME** — author only hidden depth/biography/secrets; the corpus names are fine and stable; or (b) run cast-authoring to completion during **prewarm, before createCharacter finalizes / before the first intro is narrated** (block the premiere's first who-is-present beat on it, the way the "producers are getting the house ready" toast implies); or (c) freeze the name of any houseguest already `markHouseguestMet`. Option (a) is cheapest and safest.

### [DEEP-2] [Severity: Blocker] [Effort: <1day] [Value: High] — Engine-unreachable degrades into SILENT FABRICATION of game outcomes, with zero player-facing indication
- **Where:** `frontend/routes/chat_helpers.py` (logs `[orwell] engine unreachable for user=… All connection attempts failed` and continues); the agent loop's fail-soft tool path.
- **Problem (I2 THE ENGINE DECIDES + E12 + I9):** After the engine HTTP listener died (~02:44), the FE could not reach it — but instead of surfacing an outage, it **let the model free-narrate fabricated game outcomes as if real, and streamed them to the player.** Concretely, at the eviction (engine truth: phase `veto-ceremony`, `evictionOrder:[]`, both nominees still on the block, **zero tools called**) the GM announced: *"By a vote of 9 to 4… Jacek Nowak, you have been evicted from the Big Brother house,"* with a full **per-voter tally** (*"Beck Schiller voted to evict Stanley… Declan O'Malley… Stanley… then Cleo, Zoey, Isabella, Mateo, Lena, Monica, Macy… Jacek"*). None of it happened in the engine. It then confabulated a **Week 2 HOH competition** ("Chain Reaction") while the engine stayed frozen at Week 1. The player is playing a fictional game detached from its authority, with no error state, no "reconnecting," no pause. For a networked deploy (engine + FE as separate services, ADR 0007), **any** engine blip/restart/deploy produces fake evictions the player believes are real. This is the single worst violation of "the engine decides" — the narration decided who's evicted.
- **Fix:** Wrap every game-mutating tool call in a **hard circuit-breaker**: if the engine is unreachable (or returns an error) on a beat that requires it (advanceGame, submitDecision, runCompetition), the FE must **refuse to narrate the outcome** and surface an in-fiction "the feeds cut out for a second — hang tight" pause instead of letting the model invent it. Never stream a ceremony/eviction/comp result that wasn't confirmed by an engine tool return.

### [DEEP-3] [Severity: Major] [Effort: <1day] [Value: Med] — Engine process died mid-session with no crash log, no restart, and no health surfaced
- **Where:** engine runtime (`dist/main.js`); deploy supervision.
- **Problem:** PID 28206 was gone by ~02:44; `engine.log` holds only its 2 startup lines (no stack, no error) → a hard external kill (OOM is the likely culprit — the fastembed ONNX model warm-up is memory-heavy and I saw semantic recall upgrade to `fastembed` shortly before). Nothing restarted it; the FE kept serving (see DEEP-2). In a real deploy this is a systemd job, but the combination — **process reaped, no crash artifact, no self-heal, no health signal reaching the player** — means a memory spike silently ends the authoritative game while play visibly continues.
- **Fix:** Cap/pool the embedding worker memory (or lazy-load the model), add a supervised restart + a FE health probe that flips the UI into a degraded state (ties to DEEP-2). At minimum, log a crash artifact on fatal so post-mortems aren't blind.

### [DEEP-4] [Severity: Major] [Effort: <1day] [Value: High] — Premiere meet-everyone grounding is prompt-only; GLM-4.7 confabulates names despite correct context data
- **Where:** `src/engine/momentPrompts.ts:589` ("DO NOT TRACK FROM MEMORY… drive from the STILL TO MEET list… NEVER invent a houseguest") and `:1027` (the list injects the REAL `fi.houseguest.name`).
- **Problem (I2/I6 + "enforce in code, not prompt"):** The STILL-TO-MEET list DOES carry the exact real names into context — I verified the builder. Yet when asked to introduce the rest, GLM-4.7 printed a "still to meet" list of **3 real + 6 fabricated** names and dropped 6 real houseguests entirely. (This is downstream of DEEP-1's churn, but the grounding failure is real independent of it: the model won't reliably read its injected roster.) The mandate is explicit that grounding must be code-enforced, never prompt-wording — this is exactly a prompt-only guard that a good model blows through.
- **Fix:** Add a **code belt** that validates every proper-name the premiere narration emits against the live roster and rejects/regenerates on a miss (like the other FE belts), OR drive the next introduction deterministically from the STILL-TO-MEET head and inject that one houseguest's card, so the model can't substitute.

### [DEEP-5] [Severity: Major] [Effort: <1hr] [Value: High] — The premiere-meet belt marks houseguests "met" by first-name substring match — so it fires on the "still to meet" LIST itself
- **Where:** `frontend/src/agent_loop.py:2231` `_auto_mark_premiere_intros` (matches `\b{first name}\b` in the turn's narration against `remaining`).
- **Problem (I6 + hollow-completion):** The belt marks a houseguest met when their **first name appears anywhere in the visible narration**. When the GM prints a *"Still to meet: Jacek Nowak, … Monica Savage, … Darren Mosley…"* list, the belt matches those names and **marks them met — the exact inverse of "introduced."** `fe.log` shows the belt auto-marking **9 intros in the single list-printing turn**. Net: the engine reached "15/15 met" while I had genuinely met only ~6 people; 7 real houseguests I never saw are "met." The premiere's core beat ("15 strangers become distinct people") hollow-completes.
- **Fix:** Only auto-mark on an actual *introduction* signal (e.g. the model addressing/quoting the houseguest speaking their own intro), not any name mention; explicitly exclude the STILL-TO-MEET list region of the narration from the match; require a co-presence check.

### [DEEP-6] [Severity: Major] [Effort: <1day] [Value: High] — The scene's trust folds onto co-present bystanders, not the actual interlocutor (stale premiere presence)
- **Where:** `src/adapters/engine/EngineCommandsAdapter.ts:186–199` (presence-based witness expansion) + `frontend/src/agent_loop.py:2295` (`_auto_record_scene` builds `withIds`).
- **Problem (I4/I6):** In the opening premiere, "Rosa" (npc:10) and "Miranda" (npc:13) approached me and I built trust across 3 turns. But the engine presence map placed **npc:10 in `hallway`** the whole time (player in `living-room`), so `recordInteraction`'s witness set = living-room occupants (npc:4/6/8/9/13/14/15) and **excluded Rosa**. Result: `evt:mcp:46/47` recorded *"Rosa showed approval… a slight increase in trust"* with a witnessSet that **has no Rosa** — the directed trust fold missed her and landed on bystanders. Verified downstream: player→npc:10 ends at **trust 0.048 / threat 0.643** — the OPPOSITE of the warm scene; npc:13 (friendly Miranda chat) ends at **npc:13→player threat 1.000**. So the persisted relationship state diverges from what the player experienced, and NPCs will later behave against the played scenes — I4's whole promise ("your social play changes later behavior") is undermined. Root cause: nothing moves a narrated interlocutor into the player's room, and the witness/fold set is presence-derived.
- **Fix:** When the model narrates a conversation with named houseguests, reconcile their presence to the player's room (or scope the fold to the model's `withIds` regardless of presence). Ensure the primary interlocutor is always in the fold set.

### [DEEP-7] [Severity: Major] [Effort: <1hr] [Value: High] — Live eviction narration reveals per-voter attribution (secret-ballot violation)
- **Where:** eviction narration; the eviction moment prompt in `src/engine/momentPrompts.ts`.
- **Problem (E12 / I2):** The design mandates secret ballots — the staged reveal reads **anonymized** ("a vote to evict…"), and per-voter attribution unseals **only** in the 0048 retrospective. The GM instead narrated *"Beck Schiller voted to evict Stanley… Declan O'Malley… Stanley… Cleo, Zoey, Isabella… Jacek"* — full attribution, live. (Compounded here by DEEP-2 fabrication, but the model clearly has no guard against narrating attributed votes.) A player who sees who voted how loses the paranoia the whole architecture exists to produce.
- **Fix:** The eviction moment prompt must forbid naming any voter; the reveal is anonymized counts only. Ideally the FE renders the staged anonymized-ballot reveal from engine state rather than letting the model author the tally.

### [DEEP-8] [Severity: Major] [Effort: <1day] [Value: High] — GM misreports the week's load-bearing fact ("who's nominated") despite reading state 6×
- **Where:** narration fidelity; the "who did Lena put on the block?" turn (`transcript.jsonl`).
- **Problem (I2):** Asked directly who's nominated, the GM answered *"Stanley Kowalski and Jacek Nowak."* Engine truth = npc:12 + npc:2. **Jacek (npc:2) is correct; the other real nominee is npc:12 — whose name the churn (DEEP-1) had flipped, so the GM's answer blended a stale/wrong label with a real one.** The turn called `gameStatus`/`getGameState` **6 times** (which return the real ids) and still reported wrong, wrapped in `((…))` OOC parens (see DEEP-14). A player campaigns to save the wrong person; the truly-endangered houseguest is invisible to them. The week's single most important fact must be exact.
- **Fix:** Resolve nominee display names from the live roster at narration time (not from model memory/stale context); this is largely a symptom of DEEP-1 but a fabrication-resistant "read board facts from engine, never recall" discipline (per the sync spine) should catch it.

### [DEEP-9] [Severity: Major] [Effort: <1day] [Value: Med] — Nomination ceremony skipped; player never sees who's nominated
- **Where:** `frontend/src/agent_loop.py` advanceGame chaining (corroborates + escalates J-3).
- **Problem:** After the HOH crown, `advanceGame` chained straight past the nomination ceremony into `veto-competition`. The engine had nominees set (npc:12, npc:2) but **the player never saw a nomination beat** — no ceremony, no "Lena nominates…". A first-timer has no idea who's on the block until they think to ask (and then gets DEEP-8's wrong answer). The nomination ceremony is a marquee hard-stop set-piece; here it's invisible.
- **Fix:** Forbid chaining `advanceGame` across a ceremony boundary; each ceremony is one beat/turn with the player present for the reveal.

### [DEEP-10] [Severity: Major] [Effort: <1day] [Value: High] — Ceremony/eviction beats narrated with no advanceGame; no forced-advance belt fires → hard desync
- **Where:** the L39-family forced-advance/stall belts; `agent_loop.py`.
- **Problem (C1):** Across 4 consecutive turns (veto ceremony → eviction studio → my vote → "Week 2 HOH"), the model called `advanceGame` **zero** times and no belt forced it. The engine stayed frozen at `veto-ceremony`; the narration ran an entire fictional week ahead. (Enabled by DEEP-2's dead engine, but the belts are supposed to catch a model that narrates a beat without advancing — and they didn't, because these ceremony/eviction phases aren't covered by the "advance-phase pending + lull" trigger.) The result is exactly the failure mode the belts exist to prevent.
- **Fix:** Extend the forced-advance belt to the ceremony/eviction beats — if the narration describes a ceremony/vote/result while the engine's beat hasn't moved and no tool advanced it, force the advance (or block the narration). Pair with DEEP-2's circuit-breaker.

### [DEEP-11] [Severity: Major] [Effort: multi-day] [Value: Med] — 60–120s latency per substantive turn
- **Where:** provider/reasoning config.
- **Problem:** Measured turn times: casting finalize 60.9s; premiere social turns 38s / 73s / 76s / 76s; nominees-recovery 120.3s; illegal-move+meta 78s. For a product whose entire UX is conversation, a 60–120s wait after every meaningful message is engagement-killing — a first-timer will think it hung. (The nominees turn spent 120s on a tool storm and still returned a wrong one-liner.) GLM-4.7's reasoning appears to run high per-turn.
- **Fix:** Pin reasoning=low for narration turns (ADR 0016 intends this — verify it's applied), cap pre-narration tool exploration, and consider a streaming "thinking" affordance so the wait feels alive. Latency is a first-order felt-game problem, not polish.

### [DEEP-12] [Severity: Minor] [Effort: <1hr] [Value: Med] — Casting→premiere montaged; player shown their stat profile + "your card reads" machinery
- **Where:** casting finalize turn; `src/engine/momentPrompts.ts` casting.
- **Problem (I8/I9):** `createCharacter` fired and the SAME turn jumped straight into the living-room premiere — no "you're cast → walk through the door" beat. And the finalize told me: *"Here's what I'm seeing: **Analyst**… you're sharp — mental standout, scrappy everywhere else… Your card reads you as…"* — revealing my computed archetype + stat weighting and naming the "card" (system tell). The vision wants the player to infer their own game, not be handed a stat sheet, and never to hear machinery ("card").
- **Fix:** Give being-cast its own beat before the premiere; drop the stat-profile readout and "card" language — let the player discover their strengths by playing.

### [DEEP-13] [Severity: Minor] [Effort: <1hr] [Value: Low] — npcVoice queried for NPCs not in the narrated scene
- **Where:** narration fidelity (multiple turns).
- **Problem:** The model called `npcVoice` for npc:15 (Micah) while narrating only Rosa/Miranda, and for npc:8/npc:14 while narrating "Isabella/Beck" — grounding queries whose results it then ignores or misroutes. Wasted latency and a sign the model isn't binding its tool reads to what it writes.
- **Fix:** Tighten the moment prompt to voice only the houseguests it just queried; or drop redundant voice queries.

### [DEEP-14] [Severity: Minor] [Effort: <1hr] [Value: Med] — `((…))` OOC double-paren leak in a GM reply
- **Where:** the nominees-recovery reply; markdown/OOC scrub.
- **Problem (I9):** The reply was *"((Lena nominated **Stanley Kowalski** and **Jacek Nowak**…))"* — the `((…))` is an out-of-character convention leaking into the player bubble. The reasoning-scrub handles `npc:<id>`/operator asides but not stray `((` OOC parens.
- **Fix:** Add `((…))` stripping to the game-build markdown scrub, or prompt against it.

### [DEEP-15] [Severity: Minor] [Effort: <1hr] [Value: High] — `update_plan` spammed up to 10×/turn; renders as "PRODUCTION NOTES done" chip clutter
- **Where:** `frontend/src/agent_loop.py:409` (tool advertised); `orwellToolBeats.js` mask. Corroborates J-4.
- **Problem (C2/C5/I9):** One turn called `update_plan` **10 times**; the chat shows 5+ "📋 PRODUCTION NOTES done" tool-beat chips (visible desktop + mobile screenshots), and on mobile they stack and push real content off-screen. It's a workspace agent-planning tool with no place in the game, burning latency and cluttering the transcript.
- **Fix:** Remove `update_plan` (and other workspace agent/plan tools) from the game-build narrator toolset entirely; suppress the docked plan window under `ORWELL_GAME_BUILD`.

### [DEEP-16] [Severity: Minor] [Effort: <1hr] [Value: Med] — Model asks the PLAYER to decide an NPC's veto action
- **Where:** veto-ceremony narration.
- **Problem (I2/agency):** The GM asked *"As the POV winner, what does Dominic do with the power?"* — punting an NPC-owned decision (engine/soul-driven) to the player. A confused player might answer for an NPC they don't control. (When I declined, the engine correctly had Dominic decide — so the punt was gratuitous.)
- **Fix:** The veto-ceremony prompt must resolve the NPC veto-holder's choice from the engine/soul, never ask the player.

### [DEEP-17] [Severity: Minor] [Effort: <1hr] [Value: Med] — Redundant intent re-prompt on non-binding comp rounds
- **Where:** staged comp presentation. Corroborates J-7.
- **Problem:** After I submitted comp-intent "compete," each staged round re-asked *"Compete / Play safe / Throw… this locks in your strategy"* — but intent is already locked and the round is non-binding. Misleads the player into thinking they're re-declaring.
- **Fix:** On `binding=false` rounds, render color + a single "continue," never the intent buttons (same fix as J-7).

### [DEEP-18] [Severity: Minor] [Effort: <1day] [Value: Med] — Staged comp self-contradicts and won't reach the crown
- **Where:** `src/engine/liveSeason.ts` staged rounds + narration.
- **Problem (I6/pacing):** The HOH maze looped ~7 turns; eliminated players **reappeared** (Mateo/Stanley "out," then "still in," then "out") and the count went 13→7→10→7→4 incoherently. The engine's `stillIn` is real, but the model paints its own contradictory elimination order over it and won't announce the (already-resolved) winner without heavy pushing. Tedious + immersion-breaking.
- **Fix:** Have the FE render staged rounds from the engine's `stillIn`/drop-order (the data exists) rather than letting the model author eliminations; force the crown reveal after the last staged round.

### [DEEP-19] [Severity: Minor] [Effort: <1hr] [Value: Low] — `updateCasting` fired mid-game
- **Where:** the nominees-recovery turn (Week 1, veto phase) called `updateCasting` twice.
- **Problem:** A casting-phase tool executed well outside casting — harmless here but indicates the casting toolset isn't phase-gated off after createCharacter.
- **Fix:** Restrict `updateCasting`/`createCharacter` to the casting phase in the tool allowlist.

### [DEEP-20] [Severity: Minor] [Effort: <1hr] [Value: Med] — Persisted memory duplicated/flattened
- **Where:** `_auto_record_scene` extraction (`agent_loop.py:2295`).
- **Problem (I5):** Two DIFFERENT player turns with Rosa/Miranda (an opening banter turn and a distinct "who should I be worried about" turn) were both recorded with the **identical** generic summary *"The player read Rosa and Miranda's early-game sorting tactics…"* (`evt:mcp:46` ≈ `evt:mcp:53`). The extraction collapses distinct scenes into a repeated boilerplate — the opposite of the "accumulate and deepen" mandate.
- **Fix:** Have the extraction summarize the *specific* content of each turn; de-dup near-identical consecutive records or make the summary reflect the new turn.

### [DEEP-21] [Severity: Minor] [Effort: <1hr] [Value: Low] — HUD panels render churned/stale names, not stable engine truth
- **Where:** FE "The House" HUD (nominee card + "Where You Are" present-set); `orwell_routes.py`.
- **Problem:** The desktop HUD showed nominees "Stanley Kowalski, Jacek Nowak" and a present-set full of the churned names — i.e. the structured HUD reflects narration-era/stale labels, so the identity churn (DEEP-1) surfaces in the supposedly-authoritative UI too. (Mostly a DEEP-1 symptom, but the HUD should always resolve id→current-name from the live roster.)
- **Fix:** HUD panels resolve names from the current roster by id on every render.

### [DEEP-22] [Severity: Minor] [Effort: <1hr] [Value: Med] — Borderline I3 pathway slip
- **Where:** kitchen premiere scene.
- **Problem (I3):** Lena (in the kitchen per presence) said *"You're the one from the living room. I saw… the way you were talking"* — referencing my living-room scene she wasn't a witness to (the engine did NOT record her as a witness). Arguably plausible at open-plan distance, but it's an NPC asserting knowledge of a scene with no recorded pathway.
- **Fix:** Scope premiere small-talk to what each NPC legitimately witnessed; if referencing another room, frame it as hearsay/impression, not "I saw."

### [DEEP-23] [Severity: Minor] [Effort: <1hr] [Value: High] — Stale "Welcome to the house" premiere card persists into Week-1 veto ceremony (dominates mobile)
- **Where:** FE welcome/onboarding decision-card lifecycle. Corroborates J-6.
- **Problem (I9):** During the Week-1 veto ceremony, the card still read *"You'll need to cross paths with all fifteen houseguests before Production calls the first HOH competition"* with an active "Meet the house →" button — telling me to go meet people before an HOH that already happened. On mobile (390px) it occupies ~40% of the viewport, burying the actual game.
- **Fix:** Expire the welcome card the instant the meet-gate completes / the first HOH begins.

### [DEEP-24] [Severity: Minor] [Effort: <1hr] [Value: High] — Workspace chrome bleed (expanded inventory)
- **Where:** FE sidebar/header/menus under `ORWELL_GAME_BUILD=1`. Corroborates+expands J-8/C2.
- **Problem (C2/I9):** Player-visible surface exposes: the **"z glm-4.7" model pill** (names the LLM), the **"· 59 msgs" counter**, **New Chat / Search / Chats** nav — and the DOM/menus carry a full productivity app: **Add Models, AI Defaults, Integrations, Email, Reminders, Memories, Skills, Add Skill, Import/Export, Tidy, Delete** (captured in the live-mobile/desktop DOM dump). A fiction that forbids naming the machinery is wearing an entire chat-workspace's clothes.
- **Fix:** Under the game build, hide the model pill, msg counter, chat-workspace nav, and the Models/AI-Defaults/Integrations/Email/Reminders/Memories/Skills menu items — audit the whole sidebar/settings tree for non-game entries.

### [DEEP-25] [Severity: Minor] [Effort: <1day] [Value: Med] — "View thinking process" accordion exposes the GM's PRIVATE persona/manipulation direction
- **Where:** FE thinking accordion (`chat.js` roundReasoningText); game-build gating.
- **Problem (I9):** Expanding the first turn's "View thinking process" shows the model restating its private GM direction: *"in character as Camila (the casting producer)… My temperament: wildcard… I read the room like an ice-cool casting director who lets a silence sit until the rehearsed answer cracks… My wit: a flat, faux-innocent question with a hook in it."* This hands the player the GM's hidden casting-manipulation tactics and the "production cue" scaffolding — machinery + strategy behind the curtain. The accordion is opt-in, but in the game build it leaks exactly what should stay hidden.
- **Fix:** In the game build, either suppress the thinking accordion for narration turns or scrub GM-persona/strategy/system-cue content from reasoning before it renders.

### [DEEP-26] [Severity: Minor] [Effort: <1hr] [Value: Low] — Eviction vote + comp-intent shown as markdown text, not decision cards
- **Where:** FE pending→card render. Corroborates J-9.
- **Problem (I9):** The HOH comp-intent and the eviction "Who do you vote to evict?" were rendered as markdown bullet lists in the chat, not as `ask_user`/decision cards — hard-stop decisions with no explicit control. A first-timer must guess to free-text their choice.
- **Fix:** Render binding pending decisions as cards from engine pending state regardless of whether the model calls `ask_user`.

### [DEEP-27] [Severity: Minor] [Effort: <1hr] [Value: Low] — Beat concatenation / self-correction stutters
- **Where:** chat stream round-text join. Corroborates J-5.
- **Problem (I9):** Observed: *"Let's go.**Kitchen**"* (duplicated header, no break), *"two people hanging by the island… **Kitchen** — three people"* (model self-correcting mid-narration), *"surprise for the house.Moving on."* (missing space). Small but repeated immersion cracks.
- **Fix:** Join round texts with paragraph breaks; discourage mid-narration self-correction (ground before narrating).

### [DEEP-28] [Severity: Minor] [Effort: <1hr] [Value: Low] — roster endpoint intermittently returns empty
- **Where:** `frontend/routes/orwell_routes.py` roster (`_last_good_roster` fallback exists). Corroborates J-13.
- **Problem:** `/api/orwell/roster` returned `[]` on one mid-session call (fe.log: *"roster read failed — serving last-good roster"* on another). If any HUD/Cast path lacks the last-good fallback it flashes empty.
- **Fix:** Ensure every roster consumer uses the last-good fallback; investigate the mid-mutation empty read.

### [DEEP-29] [Severity: Polish] [Effort: <1hr] [Value: Low] — Mobile header truncates session name to "D."
- **Where:** FE mobile header.
- **Problem (I9):** The mobile header shows *"D. · 59 msgs"* — the "Deep Season" title clipped to a meaningless "D." next to a workspace msg counter. In-game the header should read something diegetic (week/day), not a truncated chat title + message count.
- **Fix:** Replace the mobile header with a game label (e.g. "Week 1 · Night") and drop the counter.

### [DEEP-30] [Severity: Minor] [Effort: <1day] [Value: Med] — The premiere net-fails its own promise ("15 strangers become distinct people")
- **Where:** spirit / I6 — the compound consequence of DEEP-1 + DEEP-5 + DEEP-9.
- **Problem:** Between the mid-premiere rename (DEEP-1), the belt auto-marking un-introduced houseguests met (DEEP-5), and the skipped nomination/eviction set-pieces (DEEP-9), the marquee "15 strangers become distinct people" beat did not hold in this run: I met ~6 people (2 under names that were then overwritten), 9 were marked met without introduction, and the cast the game *thinks* I know does not match the cast I actually met. The vision's stated peak of a great single session degraded to churn.
- **Fix:** Fixing DEEP-1/DEEP-4/DEEP-5/DEEP-9 restores this; worth a dedicated premiere golden-path acceptance test with a real model (the CI gates stub the narrator, so none of this is caught).

---

## Cross-territory flags (for other lanes)
- **Narration-fidelity lane (heaviest):** DEEP-4 (confabulated premiere names), DEEP-7 (secret-ballot attribution), DEEP-8 (wrong nominees despite reads), DEEP-14 (`((…))` leak), DEEP-18 (self-contradicting comp), DEEP-2 (fabricated eviction). These are the GLM-4.7 narration seam the ship-gate weighs most.
- **FE/consistency lane:** DEEP-2 (engine-unreachable fail-soft → fabrication), DEEP-21 (HUD stale names), DEEP-10 (engine/narration desync), DEEP-28 (empty roster).
- **Social-game lane:** DEEP-6 (fold misattribution breaks I4 payoff), DEEP-9 (skipped nomination set-piece), DEEP-7 (secret ballot).
- **UX/mobile lane:** DEEP-15/DEEP-23/DEEP-24/DEEP-26/DEEP-29 (chip clutter, stale card, workspace bleed, missing cards, header).
- **A11y/perf lane:** DEEP-11 (60–120s turns) is a hard latency data point.
- **Deploy/robustness lane:** DEEP-3 (engine hard-kill, no crash log/restart/health).

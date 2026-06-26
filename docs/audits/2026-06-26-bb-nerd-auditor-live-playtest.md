# 2026-06-26 — Big Brother Nerd Auditor: live playtest

**Auditor:** the Big Brother Nerd Auditor (`.claude/agents/big-brother-nerd-auditor.md`) — a BB
superfan, low technical literacy, encyclopedic game/BB knowledge. Judges **fidelity to the show and
the spirit of the game**, not the stack.
**Persona played:** *Theo "Recap" Vance — 31, runs a BB recap podcast out of Columbus, OH; strategic-
social superfan* (`docs/audits/playtest-harness/BB_NERD_AUDITOR.md` §2).
**Harness:** `docs/audits/playtest-harness/bbNerdAuditor.mjs` (turn-by-turn mailbox daemon; captures
the player-visible GM text, hidden reasoning, gadget-rail statuses, engine truth, leak/invention
checks, screenshots).
**Stack:** real engine (TS, :8765) + real FE (Python/FastAPI, :7000), **live LLM**
`deepseek/deepseek-v4-pro` via OpenRouter (the OOB default narrator), configured through Settings (key
held only in the git-ignored sandbox). Embeddings = deterministic fake (fine for play).
**Scope played:** a full canonical Week 1 (casting → premiere/meet-everyone → HOH → nominations → veto
→ veto ceremony → eviction) into the start of Week 2 (HOH-comp eligibility). 21 player turns on the live
model. The Week-1 eviction had to be cleared by hand (F14) to reach Week 2.
**Method:** authentic roleplay — the producers open, then every turn written in Theo's voice reacting
to what the house actually said. Binding decisions (comp approach, vote) made by the auditor. Defects
logged, not fixed mid-play.

> **Telemetry note:** per-turn JSON + screenshots live in the git-ignored `.audit-telemetry/` sandbox
> and `/tmp/play/` — never committed. This file is the human-readable record (quotes + engine values
> inline so it stands alone).

---

## Verdict (fan's-eye)

**Once you're in the house, this genuinely plays like Big Brother — and the engine, not the model,
runs the show.** The cast is canon (you + 15, distinct archetype-true houseguests, no hardcoded
names); the premiere runs the correct meet-everyone → HOH ramp; chat, HUD, and engine stayed in
lockstep all week; **anti-sycophancy held hard** (I *competed* for the first HOH and the engine
*eliminated me*; a real NPC won and the win never drifted to the player); the **veto was a canon
six-player chip draw** (HOH + 2 noms + 3 drawn); the **secret ballot held** (the eviction was
announced with no per-voter attribution); NPC voices stayed **distinct and stable** across turns; and
**no production machinery leaked** into the player-visible text across 17 turns (the reasoning model's
thinking stayed in the collapsed accordion).

**But there is one launch-blocker: the game cannot get past the first eviction.** The engine does the
right thing — at the eviction it raises a player **`goodbye-message`** pending ("record your goodbye
message; your own words carry it" — canon E34). **The model never surfaces that decision card.** Instead
it *narrates* the eviction as already done ("Juliana Gaines has been evicted") and then loops —
re-narrating "ready for the next HOH?" every turn while the engine sits at `phase:eviction`,
`evicted:null`, the evictee still in the house, and **never advances to Week 2** (verified directly:
even a `advanceGame` wedges at the goodbye beat; even a lull turn doesn't trigger the FE's forced-advance).
I had to drive the engine by hand — submit the goodbye via `/api/orwell/decision`, then `advanceGame` —
to commit the eviction and reach Week 2. **A normal player would be permanently stuck after their first
eviction** (F14). This is the same bug class as the un-narrated nomination ceremony (F8): the engine is
correct, the model under-drives it. *Earlier in this doc I noted "Juliana evicted" as a positive — that
was the model's narration; the engine had NOT committed it. Corrected here.*

**The secondary soft spot is the rest of the ceremonies.** Competitions *stage out* with elimination
drama, but the **nomination ceremony was never narrated** (noms appeared only in the HUD — F8) and the
**eviction beats** (live vote, goodbyes) are skipped/un-surfaced (F12). For a BB fan those ceremony
beats are the *emotional core*. Everything else is edge polish (onboarding copy, error UX). Fix the
ceremony/decision surfacing — above all the eviction goodbye card — and this is a faithful BB loop.

### ⚠️ Honesty note — a "blocker" that was MY environment, not the game

For a long stretch every casting turn returned *"The model returned an empty response"* / a bare
`Error 400`, and I first (wrongly) hypothesized *"deepseek-v4-pro can't handle the casting tools."*
Root cause was an artifact of my own scripted setup: I registered the model endpoint via the API while
my admin auth was mid-churn, so it saved with **`owner=NULL`**; the session→endpoint matcher
(`routes/chat_routes.py` `_clear_orphaned_session_endpoint` → `auth_helpers.owner_filter`, no
`include_shared`) treats a null-owner endpoint as **"removed"** → 400 on every turn. After stamping the
endpoint `owner`, deepseek-v4-pro casting streamed fine and the whole week played. **Not reported as a
game finding.** The latent code observation it surfaced is F7.

## Findings ledger

| ID | Tag | Sev | Where | What feels off (1 line) | Evidence |
|----|-----|-----|-------|-------------------------|----------|
| **F14** | **CANON+SPIRIT** | **BLOCK** | **eviction → goodbye gate** | **The game wedges at every eviction.** The engine correctly raises a player `goodbye-message` pending (E34), but the model never surfaces the decision card — it narrates "X has been evicted" and loops; the engine stays `phase:eviction, evicted:null`, evictee still in house, and never reaches Week 2 | Turns 17–20 (4 nudges, incl. a lull): engine `evicted:null`, house 15, noms unchanged; direct `advanceGame` wedged at the `goodbye-message` beat (`/api/orwell/status` pending: `{kind:"goodbye-message", by:player, prompt:"record your goodbye message…"}`); only resolved by manually POSTing `/api/orwell/decision` + `advanceGame`. The card *did* render a full week late as a stale "Goodbye message" card (Turn 21) |
| **F16** | **CANON** | **BLOCK** | **eviction outcome fabricated** | **The model narrates the WRONG evictee.** Week 2 it narrated "the majority votes to evict **Trent**" while the engine then tallied **~10–1 and evicted Asher**. The model fabricates an eviction result with no engine basis — and the engine contradicts it. A player trusting the chat believes the wrong person left | Turn 28 GM: "majority … evict Trent Tucker … Trent departing" while engine `phase:veto-competition, evicted:null`; driven manually, the engine's `eviction-reveal` beats tallied 10× "a vote to evict Asher" / 1× Trent → `eviction: Asher Calhoun` |
| **F15** | **CANON** | **POLISH** | **roster not pruned** | The `house[]` roster still lists **15** after two evictions (Juliana + Asher both still in the array) — evicted houseguests aren't removed/flagged in the roster the cast surfaces read | `GET /api/orwell/state` `house[]` length stayed 15 across both evictions |
| **F8** | **CANON+SPIRIT** | **POLISH (high) / soft BLOCK on spirit** | **ceremonies** | **Ceremonies are compressed while comps stage out.** The **nomination ceremony was never narrated** (noms appeared only in the HUD); **eviction night was one summary line** (no staged live vote). The iconic BB ceremony beats are missing | Turn 12→13: chat narrated only the Asher 1:1; engine jumped `nominations → veto-competition` with `noms:[Juliana, Jett]`; GM text had **zero** of nominat*/block/Juliana/Jett; Theo even asked "when did the ceremony happen?" and was ignored. Turn 17 eviction: "*The votes are in … Juliana Gaines is the first to be evicted*" — a result, not a ceremony |
| **F12** | **CANON** | **POLISH** | **eviction night** | The player was **never prompted to author a goodbye message** (E34) and there was **no staged anonymized vote reveal** (E12's "a vote to evict …") — both core eviction-night beats were skipped with the ceremony compression | Turn 17: voted in narration, jumped straight to the evicted result; no `goodbye-message` pending card, no per-vote staging |
| F2 | SPIRIT | POLISH | error UX | A failed turn shows only *"The model returned an empty response. Please try again or switch to a different model"* — a dead-end with no real recourse for a non-technical player | `src/agent_loop.py:3028`; seen repeatedly during the F7 endpoint issue |
| F1 | SPIRIT | POLISH | onboarding | Two near-identical "Production needs the feeds" gates (model gate → setup wizard) read repetitively to a new player | `frontend/static/js/orwellOnboarding.js` `mountHolding` + `mountSetup` |
| F3 | CANON | NIT→POLISH | premiere | NPCs **self-label their strategic archetype** on day-1 intros ("floater route", "I'm a mastermind", "underdog angle") and the GM **tells** the player threats ("As a comp-beast, she's known for…") — real HGs hide their game; the player should infer | Turns 4–6 intros; the engine names archetypes rather than letting reads form |
| F9 | SPIRIT | NIT | post-decision pacing | After the player set their comp approach (intent card), the comp didn't visibly proceed for a turn — took a nudge to start the rounds | Turn 8 (resolve intent) returned the pre-comp text; turn 9 nudge advanced beatSeq 7→31 |
| F11 | CANON | NIT (self-resolving) | ceremony HUD lag | The veto win was narrated a beat before the engine/HUD committed it ("Veto —" while chat said Asher won); it reconciled by eviction | Turn 15 chat: "*Asher … emerged victorious*" while status `veto:—`; Turn 17 HUD finally `veto: Asher Calhoun` |
| F4 | SPIRIT | NIT | gadget: presence | The player's own room is listed **twice** in the "Where You Are" gadget | Turn 3 railText: "Living Room — Asher, Lara … Living Room — Asher, Lara" |
| F5 | CANON | NIT | premiere fiction | On move-in the house is already dispersed (kitchen/backyard/hallway) before introductions, vs. the BB ritual of entering/gathering together | Turn 3 presence across 4 rooms at the first beat |
| F10 | CANON | NIT | cast realism | Mild job clustering across the 15 NPCs (3 marketing, 2 firefighters) — a real BB cast skews more varied | Premiere intros |
| F13 | CANON | NIT | veto draw | The **"Houseguest's Choice"** chip wasn't surfaced in the veto draw narration (all six were "drawn by chip"/seated); the special chip is part of BB veto canon | Turn 14 draw narration |
| F6 | SPIRIT | LATENT | pre-game HUD (DOM) | Pre-game the status DOM carries "Season complete"/"Nightfall" — **not shown** (rail hidden pre-game), latent if it ever renders pre-game | Turn 1 DOM scrape; not in the turn-01 screenshot |
| F7 | — | LATENT | setup robustness | An `owner=NULL` model endpoint is unusable by the chat path and surfaces only as "endpoint was removed" (the Honesty-note root cause) | `chat_routes.py` `_clear_orphaned_session_endpoint`; `owner_filter(include_shared=False)` |

**Tags:** `[CANON]` show-mechanics rule · `[SPIRIT]` felt experience. **Sev:** `[BLOCK]` breaks the
game/illusion · `[POLISH]` noticeable but survivable · `[NIT]` tiny · `[LATENT]` potential.

## Verified GOOD (do not regress)

- **Engine authority / anti-sycophancy** — Theo chose **compete** for the first HOH and the engine
  **eliminated him** (with comp-beast Juliana too); a real NPC (Asher Calhoun) won. The win never
  drifted to the player. This is the #1 thing to protect.
- **Canon cast & format** — **16 total** (player + 15); a diverse, reality-TV-plausible roster with
  **no hardcoded/legacy names**; distinct archetype-true houseguests (villain engineer, comp-beast
  rocker, floater teacher, mastermind marketer, etc.).
- **Canon weekly loop** — premiere meet-everyone gate → HOH comp → nominations → **veto comp = six
  players (HOH + 2 noms + 3 chip-draws)** → veto ceremony → eviction. The structure is right.
- **Eligibility enforced (Week 2)** — the Week-2 HOH field was exactly **the 13 eligible NPCs + the
  player**: the **outgoing HOH (Asher) was excluded** *and* the evictee (Juliana) was gone. The
  outgoing-HOH-can't-play rule is correctly enforced. (Reached only after manually clearing the F14
  eviction wedge.) The HUD also reset noms/veto for the new week.
- **Engine ↔ narration ↔ gadget parity** — the "Where You Are" board, the GM's room descriptions, the
  HOH/noms/veto status, and the engine roster agreed throughout; time-of-day advanced Morning→Afternoon.
- **Secret ballot (E12) + real vote tally** — when driven through the engine, the eviction plays a
  staged **anonymized** reveal ("*a vote to evict ⟨nominee⟩*", never "⟨voter⟩ voted to evict") and the
  engine **tallies real votes**: Week 2 it counted ~10–1 and evicted **Asher**, *overriding* the
  player's lone vote for Trent — the outcome is the house's, not the player's or the model's.
- **Anti-sycophancy at the vote too** — the player's single eviction vote did not decide the result
  (10–1 house majority). Outcomes stay the engine's across comps *and* votes.
- **Vault Wall** — NPCs never revealed hidden targets/state; the HOH's real targets stayed implied and
  the player had to **infer** ("you sense a calculated undertone"). No secret numbers reached the player.
- **Casting** — in-character ("Hugo, the casting desk"), acknowledges the superfan identity, and the
  engine **extracts** intake live (`casting.known.playerName`). Zero machinery leak.
- **Reasoning/body separation** — deepseek-v4-pro's thinking stayed in the collapsed "View thinking
  process" accordion, never the player bubble (verified body vs. `thinking` per turn).
- **Persona consistency** — NPCs held distinct, stable voices across turns (Asher's rambling, hands-
  talking "respect someone who gets the game"; Jett's watchful, gap-toothed, not-victimized read on his
  own nomination).
- **The FULL SEASON completes (structural, model-free fast-forward) — and it's canon.** Driven
  engine-direct from Week 3, the cast thinned **16 → Final 2** across Weeks 3–14 (real roster, in
  sequence); the player (Theo) rode to the **Final 2**; each finalist took questions from **9 jurors**
  (**Jury of 9** ✓); the **jury vote was revealed per-juror** ("Lara Baker votes for Trent Tucker" —
  attributed at the finale, the canon contrast to the secret eviction ballots); **Trent Tucker won 9–0**.
  Anti-sycophancy held at the finale (player lost) and the **anti-floater jury calibration showed** — a
  passive floater who won no comps got **0 jury votes**. No Vault score-keys (`trust/threat/affinity/
  soul`) appeared in the player-facing status across the endgame.

---

## Coverage & blind spots (what was / was NOT tested — read this before trusting the verdict)

**Owner follow-up requested (2026-06-26):** a **live-LLM (model) review of the endgame moments** that
were driven model-free below. *Not done in this pass.* This section is the explicit map of that gap and
every other blind spot, so the verdict above is read with the right scope.

### Tier A — tested LIVE (real `deepseek/deepseek-v4-pro` narration, real FE, ~30 turns)
Casting interview → premiere/meet-all-15 → bedroom pick → **Week 1** (HOH comp + intent card, HOH social
pitch, the un-narrated noms, veto chip-draw/comp/ceremony, eviction *up to the wedge*) → **Week 2** (HOH
comp, HOH pitch, un-narrated noms, veto, eviction *up to the wedge*) → **Week 3** HOH-comp start + the
desync-recovery turn. This is the basis for every leak / persona / parity / sync claim above.

### Tier B — tested MODEL-FREE (engine + EchoNarrator; structure & Vault-safety only, **NO live narration**)
The actual eviction *commits* for W1/W2 (vote tally, NPC goodbyes, player goodbye, `eviction-result`);
the entire **Weeks 3-eviction → 14 fast-forward**; the **finale** (finalist statements, the 9-juror
Q&A via `finale-answer` appeals, the per-juror jury-vote reveal, the winner crown); reaching post-season.
Decisions here were **auto-resolved with arbitrary defaults** (nominate the first two options, vote the
first, veto-not-used, appeal `own-game`) — so the *specific* outcomes (who left each week, the 9–0 vote)
are artifacts of those defaults, **not** strategic play. What's validated is the **structure + Vault-
safety + canon shape**, NOT narration quality or balance.

### Tier C — NOT tested at all (blind spots)
1. **LIVE endgame narration** (the requested follow-up) — finale statements, juror Q&A, the jury-vote
   reveal, the winner announcement, the post-season **retrospective/Vault unseal**: all reached model-
   free. Whether the live model stays grounded / in-persona / leak-free across a 9-juror finale is unknown.
2. **LIVE eviction-subloop narration** — the live model *wedged* before the vote/goodbye/result every
   time (F14/F16), so how it narrates a *committed* eviction live was never observed.
3. **FE decision-CARD rendering** for `eviction-vote`, `goodbye-message`, `replacement`, `finale-
   answer/-statement`, `juror-vote` — all submitted engine-direct here; their live FE card rendering is
   unverified (and F14 shows at least the eviction cards don't surface in chat).
4. **Replacement-nominee flow** — the veto was never *used* (the HOH held it both live weeks), so
   veto-use → replacement nomination is untested. **"Houseguest's Choice" chip (F13)** never surfaced.
5. **Tie-breaks** — HOH breaking an eviction tie, and the last-juror breaking a jury tie — never occurred.
6. **The hidden layer (priority-#1 mandate)** — off-screen NPC-to-NPC scheming, gossip diffusion, deals,
   blocs, confessionals, and whether the Soul/relationship weights **accumulate & deepen** (non-
   degradation) — only the player-facing surface was visible; the Vault itself was **not** inspected
   (that's the held Producer's-Vault export). One positive continuity signal seen: the model recalled
   Theo's Week-1 Asher thread in Week 2.
7. **Diary Room / confessionals** (player OOC channel) — not exercised.
8. **In-character images / portraits** — no image provider wired (text model only); headshot/cast-photo
   generation likely no-op'd and was untested.
9. **Multi-device / concurrency / cross-tab sync** (ADR 0008/0064) — single browser context only.
10. **Mobile / responsive** — desktop 1440×900 only; no mobile viewport / touch.
11. **Time/sleep economy depth** — saw time-of-day advance (Morning→Afternoon→Night) but did not probe
    the nightly presence economy or the hidden sleep/rest competition penalty (0066).
12. **Model coverage** — only `deepseek/deepseek-v4-pro` (the OOB default) was genuinely played; the one
    gpt-4o attempt was on a stale session (invalid). Pro-vs-Flash tier behavior untested.
13. **Replayability** — one cast/seed only; no second season / seed-variation check.
14. **Performance & cost** — no latency/token-cost measurement over a *live* full game (the long run was
    model-free). Live turns on the reasoning model were ~30–90s each.
15. **Admin/God-Mode Vault isolation, settings surfaces, TTS/audio** — not exercised.
16. **The DEBUG BUNDLE + Producer's Vault JSON export** — **held** pending the owner's "testing over"
    confirmation (so the Vault's actual hidden-layer richness is unverified — see #6).

---

## Play log (turn-by-turn highlights)

1. **Casting (Hugo):** in-character open, asks for the cast photo then "who are you?"; engine captures
   `playerName`. Ready-check before start.
2. **Premiere:** `started:true`, `houseCount:15` (+player=16); GM names real roster members (Asher,
   Lara), sets the meet-all-15 → first-HOH ramp.
3. **Meet the house:** met-count advances through real conversation (2→4→9→15); each NPC introduces with
   hometown/job/archetype in a distinct voice. Then a **bedroom pick** (Theo → dining room w/ Arjun & Cora).
4. **HOH comp:** **intent card** (compete/throw/play-safe) — canon. Theo chose **compete**. Staged
   elimination played out (Cora/Eddie/Kylie → … → Theo, Juliana, Michael eliminated); **Asher Calhoun
   crowned** (engine + HUD + narration agree). *(F9: needed a nudge after the intent card.)*
5. **Nominations:** engine committed **Juliana & Jett** and advanced to veto — **but the ceremony was
   never narrated** (F8); noms appeared only in the HUD.
6. **Social game:** Theo pitched Asher (value, not grovel) — Asher in-voice, kept it implied (Vault ✓).
   Nominee Jett handled the block in-persona.
7. **Veto comp:** canon **6-player chip draw** (Asher, Juliana, Jett + Cora, Miguel, Trent); Theo not
   drawn. **Asher won the veto** ("House Scramble"). *(F11: HUD lagged a beat; F13: no Houseguest's-
   Choice chip surfaced.)*
8. **Veto ceremony:** narrated — Asher **did not use it**; noms stayed.
9. **Eviction:** **Juliana Gaines evicted** (Asher's target). Secret ballot respected (E12) — **but the
   eviction night was one summary line** (F8), no staged vote and no player goodbye message (F12).

10. **Eviction wedge (F14):** the eviction **never committed** through normal play (4 nudges incl. a
    lull) — the engine sat at `phase:eviction, evicted:null` with the player `goodbye-message` pending
    never surfaced. Unblocked **by hand** (POST `/api/orwell/decision` goodbye + `advanceGame`); beat 68
    `eviction-result: "Juliana Gaines leaves the house"` finally fired.
11. **Week 2 reached:** the HOH-comp field was the **13 eligible NPCs + Theo** — **Asher (outgoing HOH)
    excluded, Juliana gone** (eligibility ✓); a fresh `comp-round` intent card up. The stale
    "Goodbye message" card rendered here, a week late (F14 surfacing lag).

_Reached the start of Week 2. Authentic multi-week play is blocked by F14 (every eviction wedges until
the goodbye card is surfaced); Week 2 was entered only by manually clearing it, which desyncs the chat
from the engine. Paused here pending direction. The DEBUG BUNDLE + Producer's Vault JSON export are
**held** until the operator confirms testing is over (owner instruction, 2026-06-26)._

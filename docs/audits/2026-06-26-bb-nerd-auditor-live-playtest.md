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
**Scope played:** a full canonical Week 1 — casting interview → premiere/meet-everyone → HOH comp →
nominations → veto comp → veto ceremony → first eviction. 17 player turns on the live model.
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

**The one real soft spot is the ceremonies.** Competitions *stage out* with elimination drama, but the
**ceremonies get compressed**: the **nomination ceremony was never narrated at all** (the noms only
appeared in the HUD — F8), and **eviction night was a single summary line** with no staged live vote
and no player-authored goodbye messages (F8/F12). For a BB fan those ceremony beats — the nomination
speech, the live one-by-one vote, the goodbyes — are the *emotional core*, and right now they're the
thinnest part of an otherwise convincing week. Everything else is edge polish (onboarding copy, error
UX). Fix the ceremony staging and this is a faithful BB loop.

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
- **Engine ↔ narration ↔ gadget parity** — the "Where You Are" board, the GM's room descriptions, the
  HOH/noms/veto status, and the engine roster agreed throughout; time-of-day advanced Morning→Afternoon.
- **Secret ballot (E12)** — the eviction was announced as a result ("Juliana Gaines is the first to be
  evicted"), **no per-voter attribution** leaked.
- **Vault Wall** — NPCs never revealed hidden targets/state; the HOH's real targets stayed implied and
  the player had to **infer** ("you sense a calculated undertone"). No secret numbers reached the player.
- **Casting** — in-character ("Hugo, the casting desk"), acknowledges the superfan identity, and the
  engine **extracts** intake live (`casting.known.playerName`). Zero machinery leak.
- **Reasoning/body separation** — deepseek-v4-pro's thinking stayed in the collapsed "View thinking
  process" accordion, never the player bubble (verified body vs. `thinking` per turn).
- **Persona consistency** — NPCs held distinct, stable voices across turns (Asher's rambling, hands-
  talking "respect someone who gets the game"; Jett's watchful, gap-toothed, not-victimized read on his
  own nomination).

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

_End of Week 1. The harness supports continuing (the daemon is still live); paused here at a complete
canonical week pending direction. The DEBUG BUNDLE + Producer's Vault JSON export are **held** until
the operator confirms testing is over (owner instruction, 2026-06-26)._

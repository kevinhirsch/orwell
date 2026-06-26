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
**Method:** authentic roleplay — the producers open, then every turn written in Theo's voice reacting
to what the house actually said. Binding decisions made by the auditor. Defects logged, not fixed mid-play.

> **Telemetry note:** per-turn JSON + screenshots live in the git-ignored `.audit-telemetry/` sandbox
> and `/tmp/play/` — never committed. This file is the human-readable record (quotes + engine values
> inline so it stands alone).

---

## Verdict (fan's-eye)

**Once you're actually in the house, this feels like Big Brother.** The casting interview is in-
character and warm, the cast is 16 (you + 15) with distinct, archetype-true houseguests, the premiere
runs the correct meet-everyone → first-HOH ramp, and the chat/HUD/engine stay in lockstep (the "Where
You Are" board matched the narration and the engine roster exactly). No machinery leaked into the
player-visible text across casting + premiere, and the reasoning model's thinking stayed correctly in
the collapsed accordion. The friction I hit is **at the edges, before the house** (the setup/onboarding
copy and the error UX), not in the game itself. _Full ledger below; play log continues through Week 1._

### ⚠️ Honesty note — a "blocker" that was MY environment, not the game

For a long stretch every casting turn returned *"The model returned an empty response"* / a bare
`Error 400`. I first hypothesized *"deepseek-v4-pro can't handle the casting tool payload."* **That was
wrong.** Root cause was an artifact of my own scripted setup: I registered the model endpoint via the
API while my admin auth was mid-churn, so it saved with **`owner=NULL`**; the session→endpoint matcher
(`routes/chat_routes.py` `_clear_orphaned_session_endpoint` → `owner_filter`, no `include_shared`)
treats a null-owner endpoint as **"removed"** and returns a 400 on every turn. After stamping the
endpoint `owner`, deepseek-v4-pro casting streamed fine. **This is NOT reported as a game finding.**
The one *latent* observation worth a look (LATENT, low): an endpoint that ends up `owner=NULL` (e.g. a
shared/global endpoint, or one created when `get_current_user` returns empty) is **invisible to the
chat path** and surfaces only as a cryptic *"endpoint was removed"* — see F7.

## Findings ledger

| ID | Tag | Sev | Where | What feels off (1 line) | Evidence |
|----|-----|-----|-------|-------------------------|----------|
| F1 | SPIRIT | POLISH | onboarding | Two near-identical "Production needs the feeds" gates (model gate → setup wizard) read repetitively to a new player | `frontend/static/js/orwellOnboarding.js` `mountHolding` + `mountSetup`, both titled around "Production needs the feeds" |
| F2 | SPIRIT | POLISH | error UX | A failed turn shows only *"The model returned an empty response. Please try again or switch to a different model"* — a dead-end with no real recourse for a non-technical player | `src/agent_loop.py:3028`; observed repeatedly during the F7 endpoint issue |
| F3 | CANON | NIT | premiere narration | GM **tells** the player an NPC's archetype ("As a comp-beast, she's known for…") instead of letting them infer threat from behavior | Turn 4 GM: "Juliana … As a comp-beast, she's known for her competitive spirit" |
| F4 | SPIRIT | NIT | gadget: presence | The player's own room is listed **twice** in the "Where You Are" gadget | Turn 3 railText: "Living Room — Asher, Lara … Living Room — Asher, Lara" |
| F5 | CANON | NIT | premiere fiction | On move-in the house is already dispersed (kitchen/backyard/hallway) before introductions, vs. the BB move-in ritual of entering/gathering together | Turn 3 presence across 4 rooms at the very first beat |
| F6 | SPIRIT | LATENT | pre-game HUD (DOM) | Pre-game the status DOM carries "Season complete" / "Nightfall" — **not shown** (rail hidden pre-game), but latent if the rail ever renders pre-game | Turn 1 railText DOM scrape; not visible in the turn-01 screenshot |
| F7 | — | LATENT | setup robustness | An `owner=NULL` model endpoint is unusable by the chat path and surfaces only as "endpoint was removed" (see Honesty note) | `chat_routes.py` `_clear_orphaned_session_endpoint`; `auth_helpers.owner_filter(include_shared=False)` |

**Tags:** `[CANON]` a show-mechanics rule · `[SPIRIT]` the felt experience. **Sev:** `[BLOCK]`
breaks the game/illusion · `[POLISH]` noticeable but survivable · `[NIT]` tiny · `[LATENT]` potential.

## Verified GOOD (do not regress)

- **Casting interview** — in-character ("Hugo, the casting desk"), warm, acknowledges the player's
  superfan identity, asks for the cast photo then "who are you?", and the engine **extracts** intake
  live (`casting.known.playerName = "Theo Vance"` after one turn). Zero machinery leak.
- **Reasoning/​body separation** — deepseek-v4-pro is a reasoning model; its thinking stayed in the
  collapsed "View thinking process" accordion, never the player bubble (verified body vs. `thinking`
  channel per turn).
- **Cast is canon** — **16 total** (player + 15), Jury-of-9 format implied; the 15 NPCs are a diverse,
  reality-TV-plausible set with **no hardcoded/legacy names** (Juliana Gaines, Arjun Carrillo, Trey
  Gill, Kylie James, Miguel Haney, Eddie Hansen, Trent Tucker, Asher Calhoun, Clay Peters, Tamara
  Simon, Jalen Nichols, Michael Xiong, Lara Baker, Cora Sherman, Jett Marsh).
- **Distinct, archetype-true houseguests** — within two premiere turns: Asher (SF engineer, self-aware
  "villain"), Lara (KC marketer, prove-it), Juliana (tattooed rocker comp-beast), Arjun (warm Honolulu
  firefighter). Real BB archetypes, distinct voices.
- **Premiere ramp is canon** — welcome → **meet all 15** (gated, surfaced as "N of 15 met") → first HOH
  competition. The engine marks houseguests met through natural conversation.
- **Engine ↔ narration ↔ gadget parity** — the "Where You Are" board, the GM's room description, and
  the engine roster agreed exactly (Theo in the Living Room with Asher & Lara; others across kitchen/
  backyard/hallway); status panel correctly read "Week 1 / Premiere / HOH —/ Noms —/ Veto —".
- **No invented houseguests** — every name the GM used in casting + premiere was either the player or
  on the engine roster (the checker's "Theo Vance / San Francisco / Kansas City" flags are the player
  + city names, not fabricated houseguests).

---

## Play log (turn-by-turn highlights)

- **Casting open (Hugo):** "*Hugo here — I run the casting desk … your face. Tap the Choose Your
  Character button … Optional, but you're a superfan — you know the difference between a houseguest
  with a real face and a silhouette … So — Theo Vance. Who are you?*" → engine `casting.known.playerName`.
- **Casting → ready check:** GM mirrors the profile ("*social-strategic player who knows how to turn
  analysis into action … turn those years of podcast commentary into hands-on strategy*") and gates on
  an explicit readiness confirm before starting. Clean.
- **Season start (premiere):** engine `started:true`, `moment:premiere`, `houseCount:15` (+player=16);
  GM: "*Welcome to the Big Brother house, Theo Vance! … surrounded by … Asher Calhoun and Lara Baker …
  you'll meet all 15 other houseguests … then … the first Head of Household competition.*"
- **Meet the house:** met-count advances through real conversation (2 → 4 …); NPCs introduce with
  hometown/job/archetype in distinct voices (see GOOD).

_(continues — HOH competition, nominations, veto, eviction)_

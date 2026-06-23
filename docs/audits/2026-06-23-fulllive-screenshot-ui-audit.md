# Full-Live 3-Season — Screenshot UI-vs-State Audit (2026-06-23)

**What this is.** A forensic cross-reference of the **111 screenshots** captured during the full-live
3-season playtest (DeepSeek V4 *pro* through the real FE) against the engine's **ground truth** at each
turn, to find inconsistencies between *what the UI says* and *what the game state should be*.

**Method.** Screenshots are named `t-<turn>.png` (captured every 3rd turn). Each was aligned to its
ledger turn via `screenshot-truth-ref.json` (turn → season / phase / HOH / noms / veto / evicted-count /
moment), then six independent reviewers read the PNGs and compared the **season progress bar, season
chip, House Status gadget (week/HOH/noms/veto), Cast gadget, presence/nightfall, and chat narration**
against truth — and investigated every mismatch against the per-turn `ledger.json` GM text + the
`run-launch{1,2,3}.log` driver logs. Slices: A t3–60, B t63–120, C t123–180, D t183–240, E t243–300,
F t303–345.

**Artifacts** (in `debug/2026-06-23-full-live-3season-run/`): `ledger.json` (347 turns),
`screenshot-truth-ref.json`, `truth-table.json`, `screenshots.zip` (111 PNGs), `run-launch{1,2,3}.log`,
`live7-eviction-dumps/`. All Vault-free / player-facing; secret-scrubbed.

> **Headline.** The **closed-set board state is rock-solid** across all 111 screenshots / 3 seasons —
> season chip, week, phase, HOH, nominees, veto holder/used, post-veto nominee swaps, and active house
> count matched engine truth turn-for-turn. **Every defect found is a player-status or narration-grounding
> issue, never a wrong board.**

## Findings

| # | Finding | Severity | Issue |
|---|---|---|---|
| UI-1 | Player falsely badged **`You [EVICTED]`** for all of S3 after the in-session season hand-off | HIGH | **#556** (new) |
| UI-2 | Season **progress bar +1** in S3 — a knock-on of UI-1 (player double-counted in `out`) | LOW–MED | #555 (commented) |
| UI-3 | **Cast gadget** renders only the first 2 evictees deep in S3 (later boots drop off) | MED | #554 (extends) |
| UI-4 | **Time-of-day HUD** disagrees with the narration clock every turn (HUD "Morning" vs GM "02:45 AM") | MED | #534 / #537 |
| UI-5 | **Narration ↔ board phase desync** + a **fabricated nominee** ("Harrison" on the block instead of "Mario") | HIGH | **#561** (new) / #540 / #541 / #548 |
| UI-6 | Player **hometown drift** (authored "Savannah" → confabulated "Nashville", hardened into a relationship motif) | MED | #550 (upgraded) |
| UI-7 | Conversation **title stuck "Casting interview · NNN msgs"** through the whole game | LOW | **#557** (new) |

### UI-1 — Player falsely badged "You [EVICTED]" for an entire season (HIGH) → #556
Across **every S3 screenshot (t-111 → t-345)**, House Status shows the player as `You [EVICTED]` (later
`· running on empty`), while the player (Jolene Carter) is the active protagonist — winning HOH, voting,
writing Diary-Room messages, shown active/un-grayed atop the Cast roster.
- **Truth:** S3 engine state `started:true, persona:Jolene Carter, evicted:0→7`; `grep '"status":"evicted"'`
  over the engine logs = **0**. The only real player eviction was **S2 t-105** (the *previous* player, Priya).
- **Root cause:** `frontend/static/js/orwellStatusPanel.js:81` `selfBadge()` returns "EVICTED" when
  `player.status === "evicted"`; that value is **stale from the prior season and never reset on the
  in-session `next-season` hand-off**. Tell-tale: **S1→S2** was clean (badge reset) because that boundary
  involved a **page reload** (driver relaunch); the **in-session S2→S3** rollover left it stale.
- **Knock-on:** inflates the progress bar (UI-2).

### UI-2 — Progress bar +1 in S3 (LOW–MED) → #555 (commented)
The bar is otherwise correct: exact `PHASE_FRACTION` steps, monotone within a season (S1 measured
0 → 2.8 → 5.7 → 12.8%), and **resets cleanly to 0% at both season boundaries** (t-060, t-111). The S3
"+1" is a **knock-on of UI-1**: `computePct` (`orwellSeasonProgress.js`) counts `out` = non-active
houseguests **+ the player if `player.status != "active"`**, so the falsely-evicted player adds ~1/15.
The original "doesn't progress across seasons" suspicion did **not** reproduce. Fix #556, then re-verify.

### UI-3 — Cast gadget shows only the first 2 evictees (MED) → #554
Deep in S3 the grayscale "evicted" section of the Cast gadget only ever shows the **first two** boots
(Alondra, Valentina); evictees #3–#6 are **dropped from the list entirely** rather than rendered
grayscale. The active count (`16 − evicted_count`) stays correct. Same 2-portrait cap as #554
(`orwellCastPin.js:135` `slice(0, 2)`); the fix should render the full evictee set, not just two faces.

### UI-4 — Time-of-day HUD ↔ narration clock desync (MED) → #534 / #537
On the same turn the House Status time-of-day label rotates "Night → Morning → Afternoon → Evening"
while the narration is stamped deep late-night (02:24–03:21 AM). Self-contradictory beside the correct
`running on empty` 2 AM rest cue. Corroborates #534 (chat↔HUD time desync) and #537 (clock advances too
fast — per micro-beat).

### UI-5 — Narration ↔ board phase desync + fabricated nominee (HIGH) → #540 / #541 / #548
From t-309 the model repeatedly runs eviction-vote Diary-Room scenes while the engine board is still in
**veto-competition/ceremony**, re-looping the *same* DR prompt across t-315→330 (a stall), and at **t-309
named "Harrison" on the block — a fabricated nominee** (the real nominee was "Mario", silently dropped).
Also seen in S1 (t-048/051): the HUD showed `You EVICTED · 15/16 · Week 2` while the engine `evicted`
counter was still 0 — the narration concluding the eviction ahead of the engine commit. Corroborates the
LIVE-7 (#540) / LIVE-4 (#541) / finale-loop (#548) family; the nominee fabrication is a new concrete
grounding instance for #541.

### UI-6 — Player hometown drift (MED) → #550
The driver authored Jolene as **"bartender from Savannah"** at casting (no casting stall-breaker fired,
so casting captured it). From **t-126** the model narrates the player saying *"Originally? Little town
outside Nashville"* and "Nashville" **hardens into a load-bearing relationship motif** ("Nashville-and-El-Paso
duo") across S3 — the harness even flags "Your Nashville" as invented (t-207). Confirms #550 and shows it
compounds over a season (worse than a cosmetic nit).

### UI-7 — Conversation title stuck on "Casting interview" (LOW) → #557
The chat top-bar title stays "Casting interview · NNN msgs" the whole game ("516 msgs" at t-345, week 8),
never retitled past casting — the entire game lives in one thread. Wayfinding nit.

## What was verified correct (no defect)
Season chip, week label, phase, HOH, nominees, Power-of-Veto holder + used, post-veto nominee swaps,
active house count (`16 − evicted_count`), grayscale-on-eviction for the houseguests that *are* shown,
and the absence of Vault leaks (`leak: null` throughout) — all matched engine truth across the full run.

## Session issue index (all issues filed 2026-06-23)
**Live-LLM audit BLOCKs/findings** (tracker `ROAST-LOG-3.md`): #540 LIVE-7 · #541 LIVE-4 · #542 NARR-7 ·
#545 CARRY-1 (Vault term leak) · #547 NAME-1/CARRY-2 (names) · #548 finale loop · #549 casting
under-finalize · #550 hometown drift.
**UI/UX** (mobile + windowing): #551 mobile gadget/hamburger placement · #552 mobile side-swap +
persistence · #553 Settings→OrwellWindow kit · #554 Cast Photos 4×4 gallery · #555 progress-bar
multi-season check.
**Screenshot UI audit (this doc):** #556 player EVICTED badge (HIGH) · #557 stale conversation title ·
#561 narration names the wrong nominee (HIGH).
*(Separate parallel "debug-bundle" audit, not this session: #529–#538.)*

## Companion records
- `ROAST-LOG-3.md` — the live-LLM findings ledger (CHAIN-1, LIVE-4/7, NARR-7, POS-1/2/3, NARR-NEW-1/2/3,
  NAME-1, CARRY-1–4).
- `debug/2026-06-23-full-live-3season-run/README.md` — the run + debug-bundle map.

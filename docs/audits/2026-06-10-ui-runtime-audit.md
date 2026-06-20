# Orwell full UI & runtime audit — 2026-06-10 (round 4)

> 📋 **Audit record** · 2026-06-10 · UI & runtime (round 4) · **Status:** Historical record

**Scope.** The complete player-facing surface, audited THREE ways at once: (1) a static map of
every AI-callable game tool to its UI display path; (2) an inventory of the 121 stated UI
behaviors (from the prior audits, the C12–C33 queue items, the FE test suite, the browser
smoke, and specs 0020/0032/0037/0048/0049/0050); (3) a **live runtime audit** — the real
engine + front-end booted as deployed, driven through staged game states (pre-game ·
mid-week pending decision · finale · post-season · season restart) with Playwright across
**three viewports** (mobile 390×844 · tablet 820×1180 · desktop 1440×900), with console,
network, layout-overlap, and pointer-interception instrumentation.

**Baseline:** every existing gate is green (500 unit/property/arch · 315 BDD · 292 FE pytest ·
boot/browser/deploy smokes). **Nothing below is a failing test.** As with the round-1 audit,
every finding is *unasserted* behavior — and this round's headline shows the same blind spot
the round-3 audit warned about: the green gate does not exercise the seam players actually
live on (here: the second season).

---

## The headline: season restart corrupts the game (CRITICAL)

**R1 — A restarted season is never saved; the dead season resurrects on engine restart.**

Evidence chain (reproduced live, deterministic):

1. The FE's sanctioned reset path (`POST /api/orwell/new-game` with `confirm:true`, per
   C12/B36) restarts via the **player-channel** `createCharacter` + `confirmRestart`
   (`frontend/routes/orwell_routes.py` → `orwell_engine.create_character`).
2. The engine's own code says this is the wrong door: `GameSessionAdapter.createCharacter`
   comments *"A real restart goes through the admin reset path (`registry.resetUser`), not
   this tool"* — and `registry.ts:190` confirms the admin reset delegate is where *"B36/C12
   route here"*. The FE never calls it.
3. The orchestrator's fail-closed checkpoint then does exactly what it was built to do: the
   fresh week-1 snapshot is a massive count regression vs. the finished season's baseline ⇒
   **`integrity fault kinds=degradation` on the restart commit and on every player-turn
   commit after it** (77 fault lines logged in one audit session; `sandboxHealth` shows
   `lastIntegrity:"fault"`, circuit OPEN).
4. Faulted commits are rolled back and **never persisted** — after ~60 restarted seasons the
   latest durable save still holds **season 1** (verified: save `seed` = `hashSeed("Audit
   Player")` = the first game; week 14; 1392 events). A real player who finishes a season,
   starts season 2, plays for hours, and restarts the engine **gets their finished season 1
   back**.
5. Mid-flight rollbacks also produce the race we observed: a `new-game` 200 whose state then
   reads as the *old* cast (the checkpoint's restore resurrecting season 1 under the caller),
   and `recordInteraction` returning **500 "internal error"** on the faulted sandbox.

**Why the gate is blind:** every restart test drives `registry.resetUser` (the admin path) or
treats `createCharacter` as the *first* commit; no engine test plays season 1 → FE-style
restart → season 2 **through the orchestrator hooks** and asserts season 2 persists.

**Fix direction:** make the FE reset call the admin reset delegate (or make
`createCharacter+confirmRestart` reset the orchestrator baseline + saves the way
`resetUser` does — one sanctioned door, not two); add the missing end-to-end test
("season 2's first save survives an engine restart"); a fault on the restart commit should
fail the *request* loudly (4xx), never 200-then-rollback.

---

## Critical findings (play-blocking)

**R2 — The composer is unclickable on mobile (presence strip) and on mobile + tablet
post-season (retrospective panel).** The presence strip (`#orwell-presence`) floats mid-screen
over the composer at 390×844 — `safe_click` on `#message` is intercepted; **play is impossible
on a phone** in the audited state (screenshot: the strip covers the input and the two round
composer buttons). Post-season, the retrospective panel (`#orwell-retro`) does the same at
mobile *and* tablet. Root cause is shared: the floating game panels have no viewport-aware
placement/collision rule (C26 made the *HUD sheets* dock, but the presence strip and
retrospective panel float free).

**R3 — A pending decision does not survive a page reload.** `orwellDecision.js` mounts ONLY on
the `orwell:pending` CustomEvent dispatched from a live agent turn (`chat.js:2222`). Reload
the page mid-decision (the exact state a returning player is in — the engine pauses on
`pending` indefinitely) and **no decision card exists, and nothing else in the UI shows a
decision is owed**. The card needs a boot-time re-arm (fetch the pending from
`/api/orwell/state` on load and dispatch the same event).

**R4 — The Diary Room button is unclickable at ALL three viewports.** At default panel
positions the status HUD overlaps the social HUD's Diary trigger (mobile: blocked by the
status sheet's `#os-you`; tablet/desktop: blocked by a roster `<span>` from `#orwell-status`).
The DR modal could not be opened by pointer anywhere. Same root cause family as R2. (A
status-HUD element carrying `class="hidden modal-minimized"` still intercepted clicks —
whatever path adds the dock's `.hidden` must also clear `pointer-events`/`display`.)

**R5 — The player has never reached the jury.** Across **62 consecutive seeded seasons**
(passive driver; also with self-saving veto answers), `player.status` ended `evicted`
(out in the first five) **every single time** — p ≈ (5/14)⁶² under fair play. The first,
fault-free season shows the same outcome, so this is not an artifact of R1. Probable
mechanism: move-in threat priors + the (correct) threat-primary strategic nominations make
the player a standing consensus target while NPC↔NPC bonds deepen every off-screen tick and
the passive player's edges stay at baseline — nobody shields them, everyone noms them.
Whatever the mix, **the anti-sycophancy mandate ("never protect the player") cannot mean
"the player always loses pre-jury"**: jury, finale, and the entire 0046/0037 player-facing
endgame are unreachable content in practice. Needs a calibration investigation + a property
gate (e.g. "across N passive seeds the player reaches jury in ≥X%"). Note: the agent-driven
social game (recordInteraction folds) could not be exercised because of R1's 500s — re-measure
on a clean sandbox after R1 lands.

---

## Major findings

**R6 — Five agent tools leak raw names into the transcript.** `chat.js`'s `_orwellToolBeats`
diegetic-label map is missing `updateCasting`, `whereabouts`, `seasonRecap`,
`seasonRetrospective`, and `npcVoice` — their calls render as raw camelCase tool names in the
chat (exactly the C14/C19 immersion bleed). The C13 drift test checks schema/dispatch but not
display labels: extend it to require a `_orwellToolBeats` entry (or INFRA exemption) for every
lever.

**R7 — The game build still loads KaTeX + Mermaid from a CDN.** Stated functionality (P3/0032)
says these never load under the game build; at all three viewports the bare page requests
`cdn.jsdelivr.net` katex css+js and mermaid js (5 console errors offline). Besides the broken
promise, it's the only third-party dependency in an otherwise self-contained game UI.

**R8 — Generic workspace copy breaks the fiction mid-game.** With no LLM configured, a
started game shows *"Add an AI endpoint from Settings in the sidebar, or paste an
endpoint/API key into the chat"* dead-center — the J4/J8 ruling requires the game-framed
holding copy ("Production needs a feed source…"). The game-framed copy exists for the
pre-game path; the in-game empty-state still uses the inherited workspace string. The
composer's visible `Agent | Chat` mode toggle on game turns is the same bleed family (game
turns must always act — the toggle invites the broken mode).

**R9 — Same name ⇒ identical season.** `createCharacter` defaults `seed = hashSeed(playerName)`
and neither the FE new-game route's UI nor the agent's casting flow ever passes a seed — a
player restarting with the same name replays the byte-identical cast, comps, and winner
(verified: two "Audit Player" seasons, same cast, same `npc:5` winner). Replayability is a
mandate (0004). Default the seed to entropy (time/user-salt) and keep explicit seeds for
tests/replays.

**R10 — No portraits anywhere.** The stated memory wall (C21/V2, spec 0020) puts portraits
beside the roster/status entries; the rendered HUD is text-only at every viewport.

**R11 — Malformed tool args return 500.** Wrong-shaped `recordInteraction` args produce
`500 internal error` (should be a 400 refusal per the B60 transport contract: deliberate
refusal = plain Error = 400). Schema-validate tool args at the HTTP boundary.

---

## Minor findings

- **Tap targets:** the HUD minimize (–, ~15×32px) and close (×, ~28×32px) buttons are under
  the 36–44px floor on mobile (M-class).
- **Finale panel unobservable for an evicted-pre-jury player:** the season fast-forwards in
  one advance, so `finaleView` never stages (defensible per 0046's terminal recap — but with
  R5, no player has ever seen the staged finale; revisit after R5).
- **`/api/orwell/state` short-TTL cache can serve a different game than the engine holds**
  immediately after a restart (visible as the FE/engine disagreeing for a beat) — harmless
  once R1 makes restarts atomic, worth a cache-bust on new-game.
- **npm dev-dependency advisories** (11: vitest/vite/esbuild/cucumber) — dev-only, reported
  in the codebase audit; fold the major-bump upgrade into this wave if convenient.

## What verifiably passed

Status + social HUDs render Vault-free game state and are full-width sheets clear of the
composer on mobile (alone — see R2/R4 for stacking); no horizontal overflow at any viewport;
settings opens with the dropped-vertical tabs hidden; presence/retrospective content correct
(when not occluding); the retrospective 404-gates while live and renders post-season; the
decision card module itself covers **all 11** pending kinds with correct titles, payloads,
pick-count arming, and the confirm-before-binding beat; all 21 game tools have FE schemas +
dispatch (no lever drift); the engine-down banner, boot/browser smokes, a11y focus-trap and
aria-live structures, and the game-build endpoint gating all check out.

## The display architecture (for the record)

HUD panels are *passive viewers* (independent polls of `/api/orwell/*`), deliberately
fail-open; the **only** tool-event-driven surface is the decision card. This is sound — but
it is why R3 exists (an event with no replay) and why tool results and HUD state can tell
different stories for one poll interval. Document it; don't "fix" it into coupling.

---

## Recommended fix queue (wave-ordered)

| # | Item | Sev | Surface |
|---|---|---|---|
| D1 | ✅ PR #215 — One sanctioned restart door: FE reset → admin reset delegate (or baseline-resetting `confirmRestart`); fault on restart ⇒ 4xx; **test: season 2 persists across engine restart** | CRIT | engine + FE route |
| D2 | Floating-panel placement rule: presence strip + retrospective (and any future panel) must never intersect the composer or each other's controls; fix the `.hidden modal-minimized` pointer-events leak | CRIT | FE JS/CSS |
| D3 | Decision-card boot re-arm: fetch pending on load, dispatch `orwell:pending` | CRIT | FE JS |
| D4 | Player-survival calibration: investigate + property-gate jury-reach for a passive player; re-measure social play post-D1 | CRIT | engine |
| D5 | Diegetic labels for the 5 unmapped tools + extend the C13 drift test to display labels | MAJOR | FE JS + test |
| D6 | Vendor or drop KaTeX/Mermaid under the game build | MAJOR | FE |
| D7 | Game-framed in-game holding copy; hide the Agent/Chat toggle on game turns | MAJOR | FE |
| D8 | Entropy default seed (keep explicit seeds for tests); never identical same-name seasons | MAJOR | engine |
| D9 | Portraits in roster/status/decision surfaces (C21/V2 as stated) | MAJOR | FE |
| D10 | 400 on malformed tool args (schema-validate at the boundary) | MAJOR | engine HTTP |
| D11 | Tap-target floor for HUD chrome; cache-bust state on new-game | MINOR | FE |

**Method note.** The runtime harness lives at `/tmp/ui_audit.py` in the audit session and is
worth promoting into `frontend/scripts/` as a staged-state UI smoke once D1–D3 land (it found
every layout bug here in one pass). Screenshots: `/tmp/ui-audit-*.png`.

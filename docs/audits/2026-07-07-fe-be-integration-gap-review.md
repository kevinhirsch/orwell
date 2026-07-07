# FE–BE integration gap review — screenshot-correlated (2026-07-07)

**What this is.** An owner-requested audit of the gap between the engine's capability surface and
what the front-end actually shows — "the BE is conceptually great and mostly built; it just doesn't
map into FE intuitively." Method: the **house-audit pattern** (real FE + real engine driven headless
under Playwright, DOC-ONLY) — a full lifecycle was played and screenshotted end to end: fresh
install → production-setup card → casting interview → `new-game` → premiere → live turns (streamed)
→ comp-round / eviction-vote / goodbye-message / finale-statement / finale-answer decision cards →
finale (player finished 2nd) → retrospective → season reset back to casting. Desktop 1440×900 +
mobile 390×844, default theme, default install posture (no image provider).

**Narration caveat.** The narrator was a scripted OpenAI-compatible stub (the documented
`/api/model-endpoints` + `settings.json` live-model path), so **narration content is not judged
here** — only structure, chrome, state surfacing, and flow. Every finding below is either visible in
chrome the model doesn't author, or verified in code/logs.

**Status: DOC-ONLY.** No product code changed. Each finding carries a suggested fix and, per house
culture, lands with its own gate when implemented.

---

## Executive summary — the three moves

The screenshots say the product's problem is not missing engineering — the decision-card system,
the live board, the night economy, the ops page are genuinely good — it's that **the game's wealth
is invisible at exactly the moments a buyer looks**: the first five minutes, the phone, and the
"what do I actually know / what can I actually do" strategy loop. Three moves, in priority order:

1. **Make the first five minutes look like television.** Today the first screen leads with raw
   model IDs (`google/gemini-3.1-flash-image`), the premiere is an empty chat with a dead
   `HOH — / Noms — / Veto —` board, and the cast is flat colored rectangles. Everything needed for
   a show-opening exists engine-side (cast, archetypes, presence, met-progress). This move is
   mostly presentation-layer work with outsized marketability leverage.
2. **One live truth, zero seams.** The F1–F5 airtight bar was won for the chat mirror, but the
   *composite* still leaks: an intermittent live double-render of a streamed reply, the board
   lagging the ceremony it sits beside, the season-reset path leaving a dead season's transcript
   under a new casting interview, mobile drawer layers colliding, and the in-game clock silently
   never engaging (boot-order). These are seam bugs, not features — the fix lane is small and each
   one is player-trust-critical.
3. **Surface the invisible game.** The engine tracks the player's knowledge (facts, sources,
   confidences), a 50-tool social verb set, recaps, deals, alliances — and the FE exposes none of
   it outside model prose. ADR 0003 says augment-never-replace; a knowledge journal, a houseguest
   dossier, a recap affordance, and a "verbs of the house" playbook are all *augmentations of the
   chat*, all Vault-free, and together they turn "a chat with a nice sidebar" into a legible
   strategy game.

---

## A. Seam bugs (fix lane — each is small, each is trust-critical)

### A1 — Intermittent live double-render of a streamed reply (F5 family) — `P1`

**Seen:** first turn after a reload on a fresh game: the same streamed reply painted as **two
identical bubbles** (both with their own "View thinking process" accordions), while the store
persisted **one** assistant row and a later reload showed the turn once (screenshots
`s-b5-turn-midstream.png`, `s-b6-turn-settled.png`; store showed 8 rows for 4 turns; the stub's
rotating line bank proves it was one completion — two calls would have produced different lines).
A deliberate re-run did **not** reproduce it — this is a race, in the exact family the ship gate
calls the #1 blocker class.
**Where to look:** the live-stream paint vs. the session-sync/`session_events` append for one's own
session (`frontend/static/js/chat.js` round buffers × `sessionSync.js`) — #873 hardened the
`softReloadHistory` reconcile, but this dup appears *during* the live round, before any reconcile.
**Fix suggestion:** extend the #873 MutationObserver harness (`scripts/_capture_873_dedup.py`) to
run N live turns on a *fresh game session right after reload* and fail on any frame with two
same-content `.msg-ai`; instrument the append path with the round's convergence key so a mirror echo
of the in-flight round is dropped by key, not by content equality after settle.

### A2 — In-game clock silently never engages for a first game (boot-order) — `P1`

**Seen:** `time_of_day_enabled: true` is the settings default, yet a full season ran with no
`timeOfDay` in state, no Nightfall gadget, no rest cue — because the FE applies the setting only at
boot, and at boot there was no game: `fe.log` — *"Failed to apply time-of-day setting on boot: no
active game for this user"* (`frontend/app.py:1097–1109`). Nothing re-applies on game creation, so
the marquee 0066/ADR-0006 economy is dark for every game created after FE boot (i.e., **every first
install**) until the FE restarts. Manually calling `setTimeOfDay` mid-season lit everything up
(`r-3-board-week2.png`: 🌙 Night, "Turned in (3)", the "running on empty" rest cue).
**Fix suggestion:** re-apply the setting on `new-game`/`createCharacter` success (the same seam that
kicks pre-warm background tasks in `tool_implementations.py` / `routes/orwell_routes.py`), plus a
boot retry once a game exists. Gate: create a game after boot → state carries `timeOfDay`.

### A3 — The board can contradict the ceremony it sits beside (freshness asymmetry) — `P2`

**Seen:** the goodbye-message card announcing "Trey Wilson has been evicted" while the rail beside
it still reads *"Week 1 · HOH Competition · HOH — · The House 16/16"* (`r-2-card-goodbye-message.png`
vs `r-3-board-week2.png` seconds later). Part of this was the audit driver bypassing the FE seams —
but the underlying contract is real: panels refresh on `orwell:gamechanged` *or* a 20–30 s poll, so
any engine progress that misses the event seam (multi-beat ceremony chains inside one tool round,
cross-device turns landing between polls) leaves the board contradicting the transcript for up to
half a minute at the game's most dramatic beats.
**Fix suggestion:** the panels already receive `beatSeq` on every payload — poll cheaply but render
on change; and let the chat tool-result seam pass the *result's* `beatSeq` to the rail so a
mid-round ceremony chain refreshes panels once per bound beat, not once per debounce.

### A4 — Decision card clips its own helper line; mobile buries Confirm below the fold — `P2`

**Seen:** desktop 1440×900: the card's last helper line ("Make your selection above to enable
Confirm.") renders half-clipped at the card's bottom edge (`s-b9-decision-card.png`,
`s-f5-postgame-turn.png`). Mobile 390×844: the comp-round card fills ~60% of the viewport with two
full rosters of comma-separated names, and **the confirm button is below the fold** with no scroll
affordance (`m-1-chat.png`) — a player can tap options and see nothing arm.
**Fix suggestion:** cap the card's prose region with its own scroll, keep the option row + confirm
row always visible (sticky footer inside the card); on coarse pointers render option chips, not
comma prose; drop the duplicated "Still in with you / Round 1 — Still in" double roster.

### A5 — Mobile gadget drawer: translucent layers collide into unreadability — `P1` (mobile)

**Seen:** `m-3-rail.png` — the drawer's cards stack over the chat *and over each other* with no
scrim: "The House" title double-exposes with "Week 1", the Cast gadget's Open/Un-pin buttons overlap
the "Where You Are" card's text, a user bubble ghosts through the board card, and ghost text bleeds
between every layer. Desktop is fine; the phone — where casual players live — is the broken surface.
**Fix suggestion:** on coarse pointers the drawer should be one opaque (or near-opaque) sheet with a
scrim over the chat; gadget cards inside it opaque, single stacking context; the existing
`responsive_matrix.py` gate grows an assertion that no two gadget cards' boxes intersect in the
open-drawer state.

### A6 — First-run production-setup card: z-collisions and a 30-second dead CTA — `P2`

**Seen:** `s-a1-landing.png` — the "Producers are getting the house ready…" toast overlaps the
modal's own close ×; the Orwell wordmark and two lines of ambient text ghost *through* the card
body; and a primary button on the card stayed `disabled` for 30+ s while pre-warm churned (the
audit's click timed out — `orwellOnboarding.js` gating). A first-run user staring at a disabled
primary button with no progress indication reads "broken", and a misbehaving provider could pin it
indefinitely.
**Fix suggestion:** the card owns its stacking context (nothing ghosts through), the toast docks
below the titlebar instead of over it, and the gated CTA shows *why* it's waiting ("Casting the
house — 15 of 16…") with a fail-open timeout that enables it with the deterministic floor.

### A7 — Season reset: dead season's transcript + a layout-shoving error slab — `P2`

**Seen:** `t-3-after-start-casting.png` — after an engine reset to pre-game, the app shows the
*finished season's* transcript with a new "Choose Your Character" card bolted underneath, while a
full-width white banner ("Big Brother's having a technical moment — Production's on it, hang
tight", `orwellEngineStatus.js:65`) pushes the entire app down as a layout slab rather than
overlaying. The diegetic copy is right; the composition reads broken, and the old season bleeding
into the new casting interview muddies the season boundary ("Casting interview" stayed the session
title from install through finale).
**Fix suggestion:** the degraded banner becomes an overlay (no reflow); a new season archives the
old transcript behind a season divider (or starts a fresh session titled by season) — the session
guard already knows how to protect the live game, this is its counterpart for the *ended* one.

### A8/A9/A10/A11 — small but real — `P3`

- **A8** `sessions.js:2258/2311` polls `stream_status` on sessions with no stream → recurring
  console 404 noise (masks real errors; return 200-empty or gate the poll).
- **A9** With no image provider configured, the cast panel still offers **"Generate cast
  portraits"** and then churns "Generating 16 remaining… (0/16 done)" forever
  (`s-d1-cast-window.png`), while `/admin/status` says "Image generation AVAILABLE" — the
  availability probe trusts config presence, not capability. Gate the button + label on a real
  image-capability probe and say plainly "No portrait model configured — Settings → Models."
- **A10** The admin error table logged `recordInteraction → StaleBeatError` during ordinary play —
  the REFACTOR-ROADMAP **A-S3** risk (a stale 409 can drop a scene's only consequence fold) is not
  hypothetical; it fired inside a 40-minute session. Recommend pulling A-S3 forward from
  "post-launch."
- **A11** `llm-io` shows same-second bursts of identical utility calls when the utility model
  returns unusable output (cast authoring against a bad provider) — add backoff/give-up so a
  misconfigured provider can't burn tokens in a loop (`frontend/src/orwell_cast_authoring.py`).

---

## B. First-impression & fantasy (the marketability layer)

- **B1 — The first screen leads with plumbing.** "Pick your season's models / Narrator model:
  `orwell-stub-narrator` / Portrait model: `google/gemini-3.1-flash-image`" is the very first thing
  a new player reads (`s-a1-landing.png`). Invert the hierarchy: a cold-open ("BIG BROTHER — sixteen
  strangers, one house") with a single **Enter the house** CTA; model choice lives behind a small
  "Production settings" link, with humanized labels ("Narrator: GLM-4.7") and raw IDs only in a
  detail row. The diegetic copy that already exists ("The producers reach out the moment you're
  ready") is the right voice — it's just billed under the config, not over it.
- **B2 — The premiere doesn't look like a premiere.** `s-b1-premiere.png` is an empty chat, a giant
  wordmark, and a board of em-dashes. The engine knows the entire cast, their archetypes, presence
  by room, and the meet-progress gate. A premiere strip (16 portrait tiles that light up as you meet
  people — the "0 of 15 met" counter made visual) would make the first minute *show* the game.
  Related: pre-HOH, hide or reframe the dead `HOH — / Noms — / Veto —` rows ("First HOH tonight")
  — a stats block of dashes reads unfinished.
- **B3 — Placeholder portraits look broken, not stylized.** Flat single-color rectangles with one
  letter (`s-d1-cast-window.png`). This is the single highest-leverage visual fix in the product,
  because it's also the *default install* (no image key). Designed monogram cards — archetype-tinted
  gradient, patterned texture, consistent typography, HOH/nominee/veto/evicted badges — would make
  the no-image-model experience look intentional, and generated portraits become an upgrade instead
  of a rescue.
- **B4 — The narrator has three names.** Bubbles say **Orwell**, tool beats say **PRODUCTION**, the
  fiction says **Big Brother** (`s-b9-decision-card.png`). Pick the diegetic one for the transcript
  (the bubble author is the show, not the app) and let "Orwell" stay the product wordmark.
- **B5 — Wall-clock timestamps inside an in-game world.** Every bubble stamps "12:35 PM" real time
  while the game runs its own day/phase/time-of-day (ADR 0006). Stamp the *game* moment ("Week 1 ·
  Eviction Night" / "Late night") on beats — or at minimum de-emphasize the real clock; it currently
  contradicts the fiction the engine works hard to keep.
- **B6 — Off-brand themes ship in the picker.** The core six (glass, the feed, telescreen, room 101,
  memory wall, sequester) are excellent brand work; "Show all" reveals **GPT**, **claude**,
  **organs**, "cute" etc. from the inherited workspace (`r-11-themes-all.png`). Curate the game
  build's list.
- **B7 — Tool beats read as debug output.** "· ✔ 📺 PRODUCTION done" with a misaligned timeline dot
  and lowercase "done" (`s-d3-diary-room.png`). These beats are *show moments* — style them as
  production slates ("📺 Production — the house moves") and align the rail.
- **B8 — Engine-speak leaks in player-facing copy.** "View thinking process" on every reply, and
  Settings literally says "Show `<think>` collapsible bars" (`s-d7-settings.png`). Rename diegeticly
  ("Production notes"), keep the debug wording for the admin surface.
- **B9 — The journey's CTAs don't share a language.** "Start casting" → "Choose Your Character" →
  "Meet the house" name the same journey three ways across cards; pick one verb set (casting →
  premiere → play).
- **B10 — Idle send button announces "New chat".** The composer's send morphs into
  `aria-label="New chat"` in idle mode — screen-reader users get a wrong (and game-hazardous,
  cf. the A6 session guard) affordance name on the primary control.

---

## C. The invisible game (BE capability with no FE surface)

The player channel exposes ~50 tools. Outside model prose, the FE surfaces almost none of them.
Under ADR 0003 the *prose is the game* — these are augmentations that make the game legible, never
replacements:

- **C1 — No knowledge journal.** The engine tracks exactly what the player knows — facts with
  sources, confidence, distortion (`getVisibleStateFor`, `sealedFromHouse`, trust-gated confidences
  0089, gossip 0038) — and the FE offers no way to review any of it. A season is long; a player who
  can't re-read "what do I know about Ingrid, and who told me" loses the strategy loop the engine
  is built to power. **"The Memory Wall"** (on-brand name already in the theme list!) — a Vault-free
  journal of learned facts grouped by houseguest/week, each with its pathway ("Deja told you,
  Week 2") — is the single biggest BE→FE unlock in the product. Numbers stay hidden; facts the
  player legitimately holds are theirs to browse.
- **C2 — Recaps exist; players can't ask for them.** `dailyRecap` (0102) and `seasonRecap` are
  model-called, deliberately silent beats (`orwellToolBeats.js` `ORWELL_SILENT_BEATS`), with no
  player affordance anywhere. A "📆 Previously, in the house…" rail entry or composer chip that
  *asks the narrator* for the recap (chat-forward, model still voices it) turns a flagship feature
  discoverable.
- **C3 — The social verb set is undiscoverable.** `makeDeal`, `formAlliance`, `joinAlliance`,
  `confide`, `confront`, `tradeSecret`, `exposeSecret`, `accuseTie`, `turnIn`, `askProducers`,
  `requestSelfEviction` — all playable *in prose*, none taught. The premiere card teaches "talk to
  anyone, wander any room" and stops. A one-page diegetic **house handbook** ("Things houseguests
  do: make deals… confide… confront… trade secrets… turn in for the night") plus an occasional
  contextual composer hint (the `OrwellChatHint` registry already exists, shipped empty) closes it
  without a single new mechanic.
- **C4 — Cast tiles are dead ends.** No click-through dossier (verified: no card handler in
  `orwellCast.js`), no role badges, no met/unmet state, no "last seen in the backyard", identical
  "IN THE HOUSE" captions 16×. The dossier view (public persona, what *you* know of them via C1,
  shared history beats, their public alliances/deals with you) is where the C1 journal naturally
  lives per-person. All Vault-free.
- **C5 — Casting flies blind.** The interview loop works, but the rail is empty during the
  product's onboarding climax: 0050's casting status (what's on file / what's missing / ready) is
  engine-side; a small "Casting file" gadget (Name ✓ · Backstory … · Motivation … · Headshot …)
  would pace the interview and cue the finalize moment. (It also fixes the "did it hear me?"
  uncertainty the substance-ladder currently papers over.)
- **C6 — The retrospective is a wall of bullets.** The 0048 unsealing is the season's payoff and it
  renders as ~40 uniform list items ("Kev answers Jorge Marin…" ×9) (`r-6-finished.png`). Group it
  episodically (Week 1 … Finale), lead with the headline beats (blindsides, flipped votes,
  who-wrote-what goodbye), and let the vote-by-vote detail expand.
- **C7 — Endgame opens as a window pile.** Post-finale, the retrospective, the "Season complete"
  card, and the next-season photo studio all auto-open stacked and colliding, no order, no scrim
  (`r-5/r-6`). The finale deserves a sequence (retrospective → then the hand-off), not a pile.
- **C8 — Board polish once alive** (`r-3-board-week2.png`): the "You" row collides its two cues
  ("· running on empty You vote tonight"), "Last out" stayed "—" through an eviction beat, and the
  Nightfall card repeats its moon+word twice. Small copy/layout fixes on the product's best HUD.
- **C9 — Deals/alliances gadgets unverified.** `state.deals` exists and `orwellDeals.js` ships; the
  audit's driver never formed a deal through prose, so the mid-season rendering is unverified —
  worth one manual pass with a real model (same session as the ADR-0012 owed live re-run).

---

## D. What's already right (don't churn these)

The decision-card *semantics* (binding badge, pick-count arming, "tone is what binds", prose stays
open); the live board's role-aware cues ("You vote tonight") and the Nightfall economy; the Diary
Room as a composer mode with its knowledge-wall guarantee; the New-Chat session guard
(`orwellSessionGuard.js`) — genuinely thoughtful; the `/admin/status` ops page (build/engine/tiers/
logs/debug bundles — better than most commercial ops pages); the diegetic error-copy instinct; the
core six theme identities; the game-build settings restraint. The strategy above builds *on* this,
not over it.

---

## Suggested sequencing (if the three moves are accepted)

| Wave | Contents | Size |
|---|---|---|
| 1 — trust | A1, A2, A5, A4, A7 (+A8 noise) | each S–M, independent |
| 2 — first five minutes | B1 cold-open + humanized models, B3 monogram portrait system, B2 premiere strip + board reframe, A6, B9 | M; B3 is the leverage item |
| 3 — legibility | C1 Memory Wall journal, C4 dossiers (reuses C1), C2 recap affordance, C3 handbook + chat hints, C5 casting file | C1/C4 are the big pair; rest S |
| 4 — polish | B4/B5/B7/B8 voice & time system, C6 retrospective, C7 endgame sequence, B6 theme curation, C8 | S each |

Every item stays inside the standing rulings: no numbers cross the wall (C1/C4 surface *facts and
sources*, never weights), the chat remains the game (every new surface is an augmentation or a
prose prompt), and each fix lands with its gate (the A-items name theirs inline).

---

## Appendix — artifacts & method

- Screenshot set + manifest: session scratchpad `shots/` (34 captures, desktop + mobile, three
  rounds: lifecycle, season milestones, casting reset). Key evidence named inline above.
- State dumps: `_initial_state.json`, `_final_state.json`, `_gs_week2.json`, `_engine_state.json`;
  network/console logs `_console.log`, `_net2.log` (the `stream_status` 404s), FE/engine logs.
- Driver: engine `advanceGame`/`submitDecision` on the player channel (UAT shapes) +
  `advanceToFinale` (admin debug lever) for the tail; FE driven through the real composer with a
  scripted OpenAI-compatible streaming stub (SSE + tool_calls), registered via
  `POST /api/model-endpoints`, defaults set in `data/settings.json` (the documented live-model
  path). The player finished 2nd on auto-"compete"/first-option play — pleasing calibration note.

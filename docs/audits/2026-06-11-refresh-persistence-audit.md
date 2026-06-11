# 2026-06-11 — Refresh-persistence audit (Lane G5): every transient UI state × reload

**Commission (verbatim).** *"it seems like sometimes text will prefill, I will refresh, and the
text will not persist. it seems like sometimes there will be some alert that comes through or
some window that pops up, I refresh, and it doesn't persist. we need audits for this."*

**Scope.** Every transient front-end state a refresh can destroy: composer prefills (approach
chip, casting seat, finale move buttons, decision-confirm), the decision card, NPC approach
chips, the engine-status banner, kit-window minimize/restore and dragged positions, Diary-Room
composer mode, settings open/tab state, the status-HUD collapse, presence/retrospective
dismissals, holding cards, and toasts. For each: perform the **real action**, **reload the
page**, and verdict — **SURVIVES** (the state itself is restored) / **RE-ARMS** (the surface
returns from server state within one boot poll) / **LOST** (gone, not re-derived). Each cell
also answers the **policy question** explicitly: *should* it persist? (a suggestion prefill may
be rightly ephemeral; a minimized window snapping open is wrong; an undelivered alert vanishing
is wrong). DOC ONLY — no production code rides with this audit.

**Method** (the DWE-audit pattern, `2026-06-11-dwe-window-audit.md`). The REAL front-end driven
with Playwright headless chromium: uvicorn from `frontend/` (`ORWELL_GAME_BUILD=1`,
`AUTH_ENABLED=false`, `LOCALHOST_BYPASS=true`, FE port 8985) against the **real built engine**
(`node dist/main.js`, port 8875, `ORWELL_DATA_DIR=/tmp/g5-engine`) with a **real created game**
(`POST /api/orwell/new-game`, seed 11 — used live for S1, S7–S12: the social window, drag,
minimize, Diary Room, status HUD, presence). Playwright **route mocks** (sanctioned; noted per
cell) staged the panel states a fresh week-1 game cannot reach: `initiatives` (approach chips),
`status.pending` (the decision card), `finale` (the vote stage), `recap` (the retrospective),
`health` (engine-down banner), `state started:false` + `models` (the casting seat),
`state` 502 (the dark house). 23 assertion cells; 15 scenarios; screenshots for every loss in
`./2026-06-11-refresh-persistence-audit-assets/`. The harness is scratch (`/tmp/g5/audit.py`,
not shipped); every actionable cell below carries the Playwright assertion that pins its fix.

---

## 1. The state × reload matrix

Verdict legend: ✅ SURVIVES · 🔁 RE-ARMS (returns from server state within the boot poll) ·
❌ LOST. "Should persist?" is the policy answer — **recommended**, not silently decided.

| # | Transient state | Driven by | Verdict | Should it persist? | Cause (file:line) |
|---|---|---|---|---|---|
| M1 | Composer: player-**typed** draft (control cell) | real game, typed text | ❌ LOST | **YES** — the player's own words; the web-app norm is a session draft | no module persists `#message` (no draft write anywhere in the keep-set; → F3) |
| M2 | Composer: **approach-chip** prefill | mock `initiatives`, chip click | ❌ LOST | as a *suggestion*, ephemeral is defensible — but it should ride the M1 draft once that exists | `startScene` writes only `box.value` (`orwellSocial.js:196-206`); → F3 |
| M3 | Approach chip **pending highlight** | same | ❌ LOST | with the draft (M2): yes, together | `pendingApproachId` is a module `let` (`orwellSocial.js:75`); → F7 |
| M4 | Approach chips (undismissed) | mock `initiatives` | 🔁 RE-ARMS | n/a — correct (server state) | poll re-renders from `/api/orwell/initiatives` |
| M5 | Approach-chip **dismissal** (×) | same | ✅ SURVIVES | yes — and it does | `DISMISS_KEY` localStorage per user (`orwellSocial.js:28-92`) |
| M6 | Composer: **casting seat** prefill | mock `state started:false` + `models` | ❌ LOST **and never re-arms** | **YES (or re-arm)** — the player lands in an empty chat with no cue; the interview never spoke | seat marker set at prefill time, not at send (`orwellOnboarding.js:199-201`); → F4 |
| M7 | Decision card (pending, undecided) | mock `status.pending` | 🔁 RE-ARMS | n/a — correct (the U4/D3 re-arm, verified live in the browser) | `rearmFromStatus` on boot (`orwellDecision.js:308-321`) |
| M8 | Decision card: **in-progress selection** | same, 2 chips picked | ❌ LOST (card re-arms blank) | acceptable — re-picking is two clicks; note only | `sel` is render-local (`orwellDecision.js:132`); → F6 note |
| M9 | Composer: **decision-confirm** prefill | mock `POST /decision` 200 | ❌ LOST | acceptable — the decision itself is engine-held; only flavor text dies (rides M1 if built) | `orwellDecision.js:279-284`; → F3 |
| M10 | Composer: **finale move-button** prefill | mock `finale` stage `vote` | ❌ LOST | as M2 — suggestion; rides the M1 draft | `prefill()` (`orwellFinale.js:128-134`); → F3 |
| M11 | Finale panel + move buttons | same | 🔁 RE-ARMS | n/a — correct | boot `refresh()` polls `/api/orwell/finale` |
| M12 | Engine-status banner (active problem) | mock `health` down | 🔁 RE-ARMS | n/a — correct: an honest alert must return while the problem is live | boot poll (`orwellEngineStatus.js:90-94`) |
| M13 | Engine-banner **dismissal** | dismiss ×, reload | ❌ LOST (banner re-shows) | **correct as-is** — re-showing an ACTIVE problem is the right default; `dismissedKey` is per-message in-memory (`orwellEngineStatus.js:20`) | by design; recorded, not a finding |
| M14 | Kit window **minimized** (The House) | real game, `.ow-min` | ❌ LOST — **snaps back OPEN**, dock chip gone | **YES** — a parked window must stay parked; snapping open on refresh is wrong | `modalManager._state` in-memory (`modalManager.js:33`); kit `minimize()` persists nothing (`orwellWindow.js:253-282`); poll re-opens (`orwellSocial.js:340`); → F2 |
| M15 | Kit window **dragged position** | real mouse drag −140,+90 | ✅ SURVIVES | yes — and it does (the F2/S11 fix holding: offset `{dx:-140,dy:90}` re-applied clamped) | `orwell-slot-offset:social:<user>` (`orwellSlots.js:28-39,113-126`) |
| M16 | Diary-Room **composer mode** | real game, DR button | ❌ LOST | mode alone: defensible-ephemeral. **But see the F5 hazard** — if drafts (M1) ever persist, DR mode MUST persist with them | `drMode` module `let` (`orwellDiaryRoom.js:15`); → F5 |
| M17 | Diary-Room **entry text** | typed in DR mode | ❌ LOST | YES with M1 — and only WITH M16 (privacy: a DR draft must never restore into a non-DR composer) | same as M1; → F3+F5 |
| M18 | Settings modal open + active tab | trusted click, tab switch | ❌ LOST | **correct as-is** — a settings dialog re-opening itself on refresh would be wrong; geometry (`winsize-*`) already persists separately | no open-state persistence (by design) |
| M19 | Status-HUD **collapse** | real game, header click | ❌ **LOST — a real bug** | YES — it is *specified* to persist per user+game (E71) and writes the key, then restores from a different key | write `orwell-status-collapsed:Audit Subject:` vs boot read `orwell-status-collapsed:` — `_gameKey` is assigned only mid-render (`orwellStatusPanel.js:248`) *after* the build-time restore read (`orwellStatusPanel.js:158-160`); → F1 |
| M20 | Presence-strip dismissal (same room) | real whereabouts, dismiss | ✅ SURVIVES | yes — and it does (returns on room change, by design) | `orwell-presence-dismissed-room` (`orwellPresence.js:19,61-64`) |
| M21 | Retrospective dismissal | mock `recap` finished | ✅ SURVIVES (reload, same tab) | yes — session-scoped is right (a new visit re-offers the payoff surface) | sessionStorage `orwell-retro-dismissed` (`orwellRetrospective.js:62,71`) |
| M22 | Toast | `showToast` 60s, reload | ❌ LOST | **correct as-is** for ephemera — anything that *matters* must arrive as server state (the banner, the card), never only as a toast | `ui.js:300` (transient by design) |
| M23 | Dark-house holding card (engine down) | mock `state` 502, Escape, reload | 🔁 RE-ARMS | n/a — correct: the blocker is real until the engine returns; dismissal is one-shot per mount by design | `route()` on load (`orwellOnboarding.js:228-257`) |

**The commission, answered.** *"Text prefills, I refresh, it does not persist"* — confirmed on
**every** prefill path (M1/M2/M6/M9/M10/M17): the composer has **zero** draft persistence, and
one prefill (the casting seat, M6) is additionally one-shot-marked so it never re-arms either.
*"An alert/window pops up, I refresh, it doesn't persist"* — split verdict: the surfaces backed
by server state all **re-arm correctly** (decision card M7, approach chips M4, finale M11,
banner M12, dark house M23); what genuinely does **not** persist is *client-side window state* —
the minimized/parked state (M14, snaps open + dock chip lost) and the status-HUD collapse (M19,
a straight bug). Those two are the "window that pops up [again]" half of the complaint.

---

## 2. Findings

Severity · surface — symptom → root cause (file:line) → fix spec → the pinning assertion.

### F1 · MAJOR · status HUD (M19)
**The collapse state is written under one key and restored from another — the E71 "persists
per user+game" promise is silently broken; collapse never survives a refresh.**
**Root cause:** `ensurePanel()` performs the one-time restore read at panel build
(`orwellStatusPanel.js:158-160`, `localStorage.getItem(storageKey("orwell-status-collapsed"))`),
but `_gameKey` (declared `""`, `orwellStatusPanel.js:47`) is only assigned later inside the
same first render pass (`orwellStatusPanel.js:248-249`). So the boot read is always
`orwell-status-collapsed:` while every click writes
`orwell-status-collapsed:<player>:<user>` (live-captured: `orwell-status-collapsed:Audit
Subject:`). The persisted value is unreachable forever.
**Fix spec:** compute `_gameKey` *before* the restore read (the status+state payloads are
already in hand when `ensurePanel()` is first called — pass them in), and re-apply the
persisted collapse whenever `_gameKey` changes (game change / season 2), keeping the E71
per-user+game scoping intact.
**Pin:** real game → click `.os-hdr` → reload → `#orwell-status` carries `.os-collapsed` and
`aria-expanded="false"`. Screenshot: `assets/S11-hud-collapse-lost.png`.

### F2 · MAJOR · the window kit (M14 — hits The House, The Finale, and every kit window)
**A minimized window snaps back OPEN on refresh, and its dock chip vanishes.** Live: minimize
The House → `display:none`, dock visible, 1 chip; reload → `display:block`, dock empty. The
player's explicit "park this" gesture is undone by every refresh — the inverse of the F1-class
trap the DWE audit fixed (then: couldn't get it back; now: can't make it stay away).
**Root cause:** minimized state lives only in `modalManager`'s in-memory registry
(`_state` Map, `modalManager.js:33`); the persisted dock state
(`orwell.mobileDockState.v1`, `modalManager.js:179-194`) stores the dock **position** and
free-chip positions but **not which windows are minimized**. The kit's `minimize()`
(`orwellWindow.js:253-282`) writes nothing durable, and each panel's poll re-opens any
non-minimized panel (`orwellSocial.js:340`, `orwellFinale.js:141`).
**Fix spec:** kit-level (per the F-3 ratchet — no per-panel reimplementation): persist the
minimized id set per user (fold a `minimized: []` list into `orwell.mobileDockState.v1`, or a
kit key `orwell-win-minimized:<user>`); on kit `open()`, a persisted-minimized window mounts
**directly into the dock** (chip rendered, panel `display:none`, no open animation); `restore()`
clears the entry. The poll loops need no change — `isMinimized()` already gates them.
**Pin:** minimize `#orwell-social` → reload → `#orwell-social` is not visible AND
`#minimized-dock` is visible with its chip (trusted-click restorable, per the F1 contract).
Screenshots: `assets/S7-before-reload-minimized.png` → `assets/S7-minimized-state-lost.png`.

### F3 · MAJOR · the composer (M1, M2, M9, M10, M17)
**The composer has no draft persistence at all — the player's own typed turn and every
engine-suggested prefill die on refresh.** This is the literal text of the commission. Live:
a typed strategy line, an approach prefill, the decision-confirm line, and a finale vote line
all vanished; nothing re-offers them.
**Root cause:** no module in the keep-set writes `#message` to any storage (verified by grep
across `static/js/` and empirically, S1). The four prefill writers
(`orwellSocial.js:196-206`, `orwellOnboarding.js:206-213`, `orwellDecision.js:279-284`,
`orwellFinale.js:128-134`) all write only the live DOM value.
**Policy recommendation (split, per the commission's own instinct):** the player's **typed**
words should survive (M1: a session-scoped draft is the installed-app norm — ruling #16); pure
**suggestion** prefills are defensibly ephemeral *as suggestions*, but once a generic draft
exists they ride it for free (clearing one is a keystroke; losing your own words is the real
harm). Recommend: debounced `sessionStorage` draft per user+session (`orwell-composer-draft`),
saved on `input`, restored on boot, cleared on send — **gated on F5** (the DR-mode flag must
persist with the draft, see below).
**Pin:** type into `#message` → reload → value restored; send → reload → empty.
Screenshots: `assets/S1-typed-draft-lost.png`, `assets/S3-approach-prefill-lost.png`,
`assets/S4-confirm-prefill-lost.png`, `assets/S5-finale-prefill-lost.png`.

### F4 · MINOR · casting seat (M6)
**The casting-seat prefill is lost AND can never re-arm: the one-shot marker fires at prefill
time, not at send.** `takeASeat()` sets `orwell-interview-open=1` the moment it prefills
(`orwellOnboarding.js:199-201` — before the player has sent anything); sessionStorage survives
a reload, so a refresh before the first send leaves an empty composer, no producer line, and a
marker claiming the interview is "already underway". A brand-new player's very first screen is
the one most likely to be refreshed.
**Fix spec:** set the seat marker on the first **send** (the same composer-submit hook
`orwellSocial.js` uses), or re-run the prefill when pre-game + composer empty + the engine's
casting status shows nothing captured (the 0050 intake already knows). Either preserves the F7
fresh-session fence (the marker still prevents double new-chat clicks).
**Pin:** pre-game boot → composer prefilled → reload → composer carries the seat line again
(or the F3 draft restored it). Screenshot: `assets/S2-casting-seat-prefill-lost.png`.

### F5 · MAJOR (latent hazard — blocks F3) · Diary-Room mode (M16, M17)
**DR mode is in-memory only; today that merely loses the mode + entry text — but the moment F3
ships, a restored confessional draft would land in a NON-DR composer and be SENT TO THE
HOUSE.** The Diary Room's whole contract is "no in-game pathway to any NPC" (CLAUDE.md, the
event model); a refresh mid-confessional must not be the leak. Live today: pill gone, mode
gone, text gone (`drMode` is a module `let`, `orwellDiaryRoom.js:15`; nothing persists it).
**Fix spec:** persist the DR flag WITH the draft (one sessionStorage record:
`{ text, drMode }`), and on boot restore them together — a DR draft re-enters DR mode (pill +
placeholder) before the text reappears. F3 must not merge without this.
**Pin:** enter DR → type → reload → the DR pill is visible AND the draft is in the composer;
and (the hazard pin) a stored DR draft is never restored while `_orwellDiaryRoomActive()` is
false. Screenshots: `assets/S9-before-reload-dr-mode.png` → `assets/S9-dr-mode-lost.png`.

### F6 · MINOR (note) · decision card (M7, M8)
The U4/D3 re-arm **works** (live-verified in the browser: pending in `/status` → the card
remounts on boot) — the in-progress *selection* resets (acceptable: re-picking is two clicks;
the binding act is the explicit Confirm, which is the point of the card). One server-side
caveat recorded while tracing the seam: the re-arm's source, `/api/orwell/status`'s `pending`,
is the FE process's **in-memory** cache (`_LAST_PENDING`,
`frontend/src/orwell_engine.py:488-513`) — an FE service restart mid-decision + a player
refresh shows no card even though the engine still holds the pending decision (the chat path
re-surfaces it on the next turn, so play is never stuck). **Fix spec (deferred):** have
`/status` ask the engine for the live pending view instead of (or as fallback to) the cache.
**Pin:** restart the FE (not the engine) mid-pending → reload → the card still re-arms.

### F7 · LOW · approach pending highlight (M3)
`pendingApproachId` (`orwellSocial.js:75`) is in-memory, so the "pending" chip accent dies
with the prefill. Meaningless to fix alone (the prefill it marks is gone too, F3); fold into
F3's record (`{ text, drMode, pendingApproachId }`) so a restored approach draft keeps its chip
accent and its send-dismisses-the-chip contract. **Pin:** chip click → reload → restored draft
+ `.osoc-chip-pending` present on the same chip.

### Recorded as correct (no finding — pins recommended to keep them honest)
- **M4/M7/M11/M12/M23 re-arms**: approach chips, the decision card, the finale panel, the
  engine banner, and the dark-house card all return from server state within the boot poll —
  this is the right architecture (client chrome is a projection; the server is the truth).
  Worth adding to `browser_smoke.py` as cheap keep-set assertions (reload → surface returns).
- **M13 banner dismissal**: re-showing an *active* problem after refresh is correct (an
  undelivered alert vanishing would be wrong; the inverse — staying dismissed while broken —
  would hide an outage). Per-message dismissal within a page-life is enough.
- **M18 settings**: dialogs re-opening themselves on refresh would be wrong; geometry already
  persists (`winsize-*`).
- **M22 toasts**: ephemeral by design; the standing rule to preserve is *anything that matters
  must also exist as server state* (the banner/card/chips pattern) — a toast may only ever be
  a courtesy copy.
- **M5/M15/M20/M21**: chip dismissals, drag offsets, presence dismissal, retro dismissal all
  survive correctly — the persistence patterns to copy (per-user keys, clamped restores).

---

## 3. Recommended fix waves

Small, separable, in severity-× -cheapness order; each wave deletes its symptom and lands its
pin in `browser_smoke.py` (or a dedicated pytest browser case) in the same PR.

- **Wave R1 — the bug (F1).** `orwellStatusPanel.js`: assign `_gameKey` before the restore
  read; re-apply on game-key change. One file, one pin. (Smallest, and the only cell where a
  *specified* persistence is broken.)
- **Wave R2 — parked means parked (F2).** Kit-level minimized-id persistence + mount-to-dock
  on boot. Touches `orwellWindow.js` + `modalManager.js` only (the F-3 ratchet holds: no
  per-panel code). Pins: minimize → reload → still docked; restore → reload → still open.
- **Wave R3 — the composer draft (F3 + F5 + F7, F4 rides).** One sessionStorage record
  `{ text, drMode, pendingApproachId }` per user+session: saved debounced on input, restored on
  boot (DR mode first), cleared on send; the casting seat marker moves to first-send (F4).
  Ships only with the F5 privacy pin green.
- **Wave R4 — deferred (F6).** `/api/orwell/status` falls back to a live engine pending query
  when `_LAST_PENDING` is cold. Low urgency (the chat path always recovers).

**ADR 0003 / Vault note:** every surface exercised renders projection data only; no cell asked
for or exposed hidden state; the decision-card re-arm and all mocks carry the engine's own
Vault-free view shapes. No Vault finding.

**Run log:** 23 cells — 4 SURVIVES · 5 RE-ARMS · 13 LOST (of which 4 are policy-correct
ephemera: M13, M18, M22, and M9-as-flavor) · 1 of the losses is a hard bug (M19). Harness:
`/tmp/g5/audit.py` (scratch, not shipped); results `/tmp/g5/results.json`; screenshots in
`./2026-06-11-refresh-persistence-audit-assets/`.

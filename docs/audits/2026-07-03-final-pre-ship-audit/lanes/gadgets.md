# PER-GADGET & HUD DEEP LANE — findings

Territory: `orwellStatusPanel.js`, `orwellCast.js` + `orwellCastPin.js`, `orwellDeals.js`,
`orwellPresence.js`, `orwellNightStatus.js` (the "Nightfall" gadget), `orwellFinale.js`,
`orwellDiaryRoom.js`, `orwellRetrospective.js`, `orwellGadgetRail.js`, `orwellGadget.js` (the
shared kit). Cross-checked against engine source (`src/engine/liveSeason.ts`,
`src/adapters/engine/GameSessionAdapter.ts`, `src/ports/GameSession.ts`) wherever a claim
depended on what the engine actually sends, so several findings below are traced end-to-end
(FE render logic ⇄ the exact engine field/beat it reads or fails to read).

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| GADGET-1 | Major | <1hr | High | First-week eviction badge silently suppressed during goodbye stage | orwellStatusPanel.js:84-90 + liveSeason.ts:1277-1292 |
| GADGET-2 | Major | <1hr | High | Self-badge is single-valued — hides simultaneous nominee+veto-holder power | orwellStatusPanel.js:92-105 |
| GADGET-3 | Major | <1day | High | Docked/mobile-default Cast gadget regresses to the old anonymous silhouette the floating window explicitly fixed | orwellCastPin.js:121-134 vs orwellCast.js:444-461 |
| GADGET-4 | Minor | <1hr | Med | Cast-pin faces carry no hover/name affordance at all | orwellCastPin.js:128-134 |
| GADGET-5 | Minor | <1hr | Med | "Twist reveal" beat has no HUD phase label — falls through to a raw word-swap during a sealed-twist night | orwellStatusPanel.js:249-256 + liveSeason.ts:1064-1067 + GameSessionAdapter.ts:6582 |
| GADGET-6 | Major | <1hr | High | Diary Room pill never resets its status text — a stale "Recorded ✓" / error message leaks into the next confessional | orwellDiaryRoom.js:77-95, 119-142, 182-199 |
| GADGET-7 | Major | <1day | High | Closing the Retrospective window is a one-way door — the season's climactic Vault-unseal payoff becomes unreachable for the rest of the session | orwellRetrospective.js:84-89, 96-102, 105-106 |
| GADGET-8 | Minor | <1hr | Med | Season recap hard-caps at the last 12 highlights with no "show more" — can silently drop the season's best early beat at the one moment it's supposed to pay off | orwellRetrospective.js:148-150 |
| GADGET-9 | Major | <1day | High | Finale panel never reads `finale.asking` — Jury Questions never shows WHICH juror is asking | orwellFinale.js (whole file; field documented line 9, never consumed) + GameSession.ts:821-822 |
| GADGET-10 | Minor | <1hr | Med | Finale's 4 canned appeal buttons are identical and non-progressive across every juror's question | orwellFinale.js:264-272 |
| GADGET-11 | Minor | <1hr | Med | Deals gadget has no defensive label for an unrecognized `kind` — unlike Retrospective's own `humanizeStoryType`, a future/legacy deal kind renders its raw machinery string verbatim | orwellDeals.js:34-39, 118-148 |
| GADGET-12 | Minor | <1hr | Med | Your Deals ledger carries no week/date — a season's worth of open+kept+broken deals reads as one undated flat list | orwellDeals.js:118-148 |
| GADGET-13 | Minor | <1hr | Med | No gadget body has a scroll cap except Cast-pin — Deals/Nightfall/Presence/premiere-remaining can balloon the rail with an unbounded list | orwellGadget.js:56-99 (`.og-body`), orwellDeals.js, orwellNightStatus.js:101-114, orwellStatusPanel.js:398-411 |
| GADGET-14 | Minor | <1day | Med | Collapsed gadget rail gives zero visual signal that a docked gadget's content changed — legible power state is lost the moment the rail is collapsed | orwellGadgetRail.js (syncStrip/activeGadgetIds, ~194-236) vs orwellStatusPanel.js's `os-changed` flash |
| GADGET-15 | Polish | <1hr | Low | Finale's `nameOf` fallback ("A houseguest") corroborates the already-logged Deals bug in a second, independent gadget | orwellFinale.js:167 |
| GADGET-16 | Polish | <1hr | Low | Cast-pin's "Compact pin" toggle-styled button (`aria-pressed`) never actually toggles back — clicking it always pins, never un-pins, from that surface | orwellCast.js:358-372 |

---

## GADGET-1 — [Severity: Major] [Effort: <1hr] [Value: High]
First-week eviction badge silently suppressed during the goodbye-message stage

- Where: `frontend/static/js/orwellStatusPanel.js:84-90` (`seatStale`) combined with
  `src/engine/liveSeason.ts:1277-1292` (`commitStagedEviction`) and `:1267-1271` (the
  deferred `rollWeek`/`result` stage).
- Problem: `seatStale(status, state)` suppresses the player's "EVICTED"/"JURY" self-badge
  whenever `!(finished || week > 1 || anyOut)` — i.e. it assumes any eviction that lands
  while `week` is still 1 and no NPC is yet out must be a stale S1→S2 status carried over
  from a prior season (the #556 fix). But `commitStagedEviction` (the REAL vote-tally path
  every live eviction uses) calls `removeEvictee(s, evictee)` — which flips
  `evictionOrder`/`active`, and therefore `player.status` to `"evicted"` via `seatOf()` —
  **immediately**, while `rollWeek()` (the `s.week += 1` that would clear the `seatStale`
  guard) is deferred until the LATER `"result"` stage, which only fires after the entire
  goodbye-message sequence resolves (one pending decision per sender, including the
  player's own goodbye). So if the PLAYER is evicted in the very first week of a season
  (a completely normal, common outcome — not a hangover bug), the House Status HUD's own
  "You" badge shows **nothing** for the player's entire goodbye-message stage: the moment
  they've just been blindsided and are looking at their own status for confirmation, the
  HUD reads as if they're still just a houseguest. This directly undercuts "legible power
  state at a glance" at the single most emotionally loaded moment the game produces (the
  vision brief's peak moment #2 — "pulling off/receiving a blindside"). It self-corrects
  once `rollWeek` finally fires, so it's a race window, not a permanent miss, but that
  window can span several full player turns (a goodbye exchange with 3+ other jurors).
- Fix: `seatStale` needs a truthier signal than `week > 1` — e.g. gate on
  `status.week > 1 || anyOut || (state.player && state.player.status !== "active" &&
  status.phase === "eviction")` (the phase stays `"eviction"` through the whole goodbye
  sequence, per `GameSessionAdapter.ts:6582`), or simplest: only apply the stale-guard when
  `status.phase` is NOT `"eviction"` (a genuine S1→S2 hangover always presents with a
  *fresh* `hoh-competition`/`nominations` phase, never mid-eviction).

## GADGET-2 — [Severity: Major] [Effort: <1hr] [Value: High]
Self-badge is single-valued — a nominee who wins the veto silently loses their "VETO" badge

- Where: `frontend/static/js/orwellStatusPanel.js:92-105` (`selfBadge`).
- Problem: `selfBadge` checks HOH → nominee → veto-holder in that priority order and
  returns the FIRST match as a single string. Per the canonical mechanics
  (`docs/CLAUDE_CODE_INSTRUCTIONS.md` / CLAUDE.md), the veto field is the HOH + the two
  nominees + three chip-draws — so a nominee winning the veto (and therefore holding the
  power to save themselves) is a completely ordinary, high-stakes state. When that happens
  to the player, `noms.includes(me)` matches first and the function returns `"ON THE
  BLOCK"`, and the `veto.holder === me` branch is never reached — the badge never shows
  "VETO" at all. The single most decision-critical fact at that exact moment ("you can save
  yourself") is invisible in the one HUD element whose entire job is "read power-state at a
  glance."
- Fix: render every applicable role, not just the first match — e.g. build an array of
  badges (`["ON THE BLOCK", "VETO"]`) and join them, or render two small badge chips
  side-by-side. `#os-you-badge` is currently a single `<span>`; either multiplex it or add
  a second badge slot.

## GADGET-3 — [Severity: Major] [Effort: <1day] [Value: High]
Docked/mobile-default Cast gadget regresses to the exact anonymous-silhouette problem the floating window fixed

- Where: `frontend/static/js/orwellCastPin.js:121-134` (`OCP_SILHOUETTE` / `faceHtml`) vs.
  `frontend/static/js/orwellCast.js:444-461` (`setPortrait`'s per-person monogram).
- Problem: `orwellCast.js` carries an explicit, well-documented fix (J2-15): a single
  shared 👤 icon for every placeholder "made the 'meet 15 distinct people' payoff read as
  interchangeable placeholders," so it now renders a per-houseguest MONOGRAM (name-derived
  hue + initial) for anyone without a landed portrait. `orwellCastPin.js` — the DOCKED rail
  gadget, which is what mobile players get **by default** (`isPinned()` auto-docks whenever
  `_isNarrow()` and the player hasn't explicitly un-pinned) — was never updated to match: it
  still renders the plain generic `OCP_SILHOUETTE` (a single shared person-outline SVG,
  identical for every houseguest) whenever `hg.portrait` is falsy. During the premiere,
  when portraits are still generating for most/all of the cast, a mobile player's cast
  gadget is a grid of visually identical faceless icons — literally the bug the desktop
  window explicitly fixed, reintroduced on the surface most players actually see it on.
  This directly fights the vision's premiere ideal ("15 strangers become distinct people")
  and I6 (distinct voices/identities) precisely during the game's opening impression.
- Fix: extract `nameHue`/the monogram-render branch from `orwellCast.js` into a small
  shared helper (or just port the same ~10 lines into `orwellCastPin.js`'s `faceHtml`), so
  the docked gadget renders the same per-person monogram instead of `OCP_SILHOUETTE`.

## GADGET-4 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Cast-pin faces carry no name affordance at all, even once portraits land

- Where: `frontend/static/js/orwellCastPin.js:128-134` (`faceHtml`).
- Problem: the compact grid's `<img>` gets `alt="<name>"` (screen-reader only; browsers
  don't show `alt` as a hover tooltip on a successfully-loaded image), and the placeholder
  silhouette gets no text at all — no `title` attribute anywhere on `.ocp-face`. In a
  ~40px grid with up to 16 tiles (`grid-template-columns: repeat(auto-fill, minmax(40px,
  1fr))`), a sighted mouse user has zero way to identify who's who by hovering — they must
  reopen the full cast window to get names. Combined with GADGET-3, during the premiere
  this compact gadget can be a wall of identical, unlabeled faces.
- Fix: add `div.title = hg.name` (and a `aria-label` on the wrapping `<div class="ocp-face">`)
  so hovering (desktop) or a screen-reader tab-through announces the name even for a
  placeholder tile.

## GADGET-5 — [Severity: Minor] [Effort: <1hr] [Value: Med]
"Twist reveal" — a real structural beat — has no HUD phase label; falls through to a raw word-swap

- Where: `frontend/static/js/orwellStatusPanel.js:249-256` (`PHASE_LABELS`) +
  `src/engine/liveSeason.ts:1064-1067` (`rollWeek` setting `s.beat = "twist-reveal"`) +
  `src/adapters/engine/GameSessionAdapter.ts:6582` (`this.phase = s.finished ? "finale" :
  s.beat`).
- Problem: traced end-to-end — a sealed double-eviction twist firing sets the LIVE
  structural `s.beat` to `"twist-reveal"` (this is one of only 8 legal structural `Beat`
  values per the type at `liveSeason.ts:46-64`, distinct from the many presentation-only
  sub-beats). That value flows straight through to `this.phase`, which the `/api/orwell/status`
  route serializes verbatim as `phase`. `orwellStatusPanel.js`'s `PHASE_LABELS` dictionary
  has entries for every OTHER structural phase (`hoh-competition`, `nominations`, …,
  `finale`) but has no `"twist-reveal"` entry, so `phaseLabel()` falls through to
  `String(p).replace(/-/g, " ")` → the generic "twist reveal" (CSS `text-transform:
  capitalize` renders it "Twist Reveal", so it isn't a literal machinery leak, but it is a
  flat, unproduced label standing in for the single explicit "production twist" moment the
  game has — the code's own comment calls the twist night out as deliberately spectacle-
  grade ("the reveal IS the firing"), yet the HUD headline for it is an auto-generated
  fallback rather than authored show copy.
- Fix: add `"twist-reveal": "A twist!"` (or similar produced copy) to `PHASE_LABELS`.

## GADGET-6 — [Severity: Major] [Effort: <1hr] [Value: High]
Diary Room pill never resets its status text between sessions — a stale confessional-result message leaks into the next one

- Where: `frontend/static/js/orwellDiaryRoom.js:77-95` (`ensurePill` — returns the cached
  node, never resets its content), `:119-142` (`enterDRMode` — never touches the pill's
  text/aria-live before showing it), `:182-199` (the submit handler mutates
  `pill.firstElementChild.textContent` in place on both success and failure).
- Problem: `ensurePill()` is memoized (`if (pill) return pill;`) and builds the default
  `"📔 Diary Room — private & out-of-character; the house never hears this."` copy only
  ONCE, the first time the DOM node is created. Every subsequent confessional mutates that
  same node's text in place — to `"📔 Recorded ✓ — between you and the producers."` on
  success, or `"📔 The Diary Room camera glitched — try again."` on failure — and nothing
  ever restores the original prompt copy. `enterDRMode()` just flips `pill.style.display =
  "flex"` without resetting the label. Concretely: submit one confessional successfully,
  exit, and the NEXT time the player opens the Diary Room the pill still reads "Recorded
  ✓ — between you and the producers." (stale success chrome, confusing but harmless) — or
  worse, if the LAST confessional attempt failed, the very next time the player opens a
  brand-new, empty Diary Room session the pill immediately reads "The Diary Room camera
  glitched — try again," with `aria-live="assertive"` still armed, even though they haven't
  typed or submitted anything yet. A player would reasonably read that as "my confessional
  just failed," when in fact no submission has happened this session at all.
- Fix: in `enterDRMode()` (or at the top of `ensurePill()`'s reuse path), reset
  `pill.firstElementChild.textContent` to the canonical prompt string and
  `pill.setAttribute("aria-live", "polite")` every time DR mode is (re-)entered.

## GADGET-7 — [Severity: Major] [Effort: <1day] [Value: High]
Closing the Retrospective window is a one-way door for the whole session — the Vault-unseal payoff can become unreachable

- Where: `frontend/static/js/orwellRetrospective.js:84-89` (`onClose` sets
  `sessionStorage.setItem("orwell-retro-dismissed", "1")`), `:96-102` (`showPanel` is a
  no-op once dismissed), `:105-106` (`render()` bails before even calling `ensurePanel()`
  once the dismiss flag is set).
- Problem: the retrospective (0048) is explicitly one of the two peak moments the whole
  architecture exists to produce (vision brief: "learning it was real, recorded, and fair
  all along"), and its own header comment frames "Open the Producer's Vault" as the payoff
  CTA. But the window's `×` close button is wired to a permanent, session-scoped dismiss:
  once clicked, `render()` refuses to ever rebuild the panel again for the rest of the
  browser tab's life (a reload doesn't help — `sessionStorage` survives a reload of the
  same tab), and there is no other player-visible affordance anywhere in the FE to reopen
  it (`_orwellRetroEnsure` is a headless-test seam only, not a button/menu entry a real
  player can find). A single accidental or exploratory close — entirely plausible on a
  crowded post-season screen with the New Season window also open, fighting for the same
  screen real-estate — permanently forfeits the guided "Open the Untold Story" flow for
  that session; the ONLY residual path is asking the narrator conversationally to recount
  it (if the model's `seasonRetrospective` lever fires unprompted, which is not guaranteed
  and is not a discoverable affordance).
- Fix: either (a) don't treat close as a hard dismiss — make it dockable-and-recoverable
  via a persistent "The Season, Watched Back" entry in the gadget rail regardless of the
  floating-window dismiss (the rail is content-driven and could still show a compact
  "recap available" card that reopens the window), or (b) surface a lightweight, findable
  re-entry point (e.g. a settings-menu or new-chat-sidebar link: "Revisit this season") that
  survives the dismiss.

## GADGET-8 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Season recap hard-caps at the last 12 highlights with no way to see more

- Where: `frontend/static/js/orwellRetrospective.js:148-150` — `for (const h of
  (recap.highlights || []).slice(-12))`.
- Problem: over a full season (potentially 8-10+ weeks each generating multiple highlight
  entries), the recap silently keeps only the LAST 12 highlight strings and drops
  everything earlier — with no "show more," no scroll affordance dedicated to this list, no
  indication anything was cut. Per CLAUDE.md's non-degradation mandate (I5 — "persisted
  detail must never be lost... should accumulate and deepen"), the underlying event record
  is presumably intact; this is purely a rendering cap, but it means the single capstone
  payoff screen of the whole game can quietly omit the season's most dramatic EARLY
  blindside (week 1-2) in favor of whatever happened most recently — exactly the wrong
  bias for a "watched back" reel, which should probably favor the most dramatic/marked
  beats, not just the most recent 12.
- Fix: either lift the cap substantially (e.g. 40, matching `hiddenStory`'s own `.slice(-40)`
  a few lines below) or, better, let the route/engine flag "marquee" highlights and always
  keep those regardless of recency; add a simple "+N earlier" disclosure if truncated.

## GADGET-9 — [Severity: Major] [Effort: <1day] [Value: High]
Finale panel never reads `finale.asking` — Jury Questions never shows WHICH juror is asking

- Where: `frontend/static/js/orwellFinale.js` (the file's own header comment at line 9
  documents the route shape as `{ finale: { stage, finalists[], asking, reveals[] } }`, but
  `asking` is never referenced anywhere else in the file — grep confirms exactly one hit,
  the comment); the engine field is real and populated:
  `src/ports/GameSession.ts:821-822` (`asking: NamedRef | null` — "The juror currently
  asking a question, if any (name only)") and
  `src/adapters/engine/GameSessionAdapter.ts:6823` (`asking: f.stage === "questions" && q
  ? ref(q.juror) : null`).
- Problem: during the `"questions"` stage — CLAUDE.md's own canonical mechanics call out
  "a player-juror asks their OWN finale question" and "takes one question per juror" as a
  real, per-juror mechanic — the FE panel shows only the generic stage label "Jury
  questions" (`STAGE_LABEL`) and four identical canned appeal buttons ("Own my game / Mend
  fences / Connect personally / Question my rival") with zero indication of which of the up
  to 9 jurors is currently asking, or any grounding for what they asked. The engine already
  computes and sends exactly that fact (`finale.asking.name`), Vault-free, for precisely
  this purpose, and the FE simply drops it on the floor. For the game's climactic set-piece
  (Final 2 statements → per-juror Q&A → vote reveal), this is a real legibility gap: the
  player has no HUD cue for "it's Juror X's turn" and must infer everything from chat prose
  alone, and — combined with GADGET-10 below — nothing on screen visibly advances between
  one juror's question and the next.
- Fix: render `finale.asking` (e.g. `"<name> is asking…"` above the appeal buttons),
  hidden when null. Cheap, and it directly grounds a moment the ship-gate's G-series treats
  as part of the golden path.

## GADGET-10 — [Severity: Minor] [Effort: <1hr] [Value: Med]
The four canned appeal buttons are identical and non-progressive across every juror's question

- Where: `frontend/static/js/orwellFinale.js:264-272`.
- Problem: related to GADGET-9 but distinct — even setting aside the missing juror name,
  the `"questions"` stage renders the exact same four buttons (`own-game`, `mend`,
  `connect`, `discredit-rival`) every single time it's the player's turn to answer,
  regardless of how many jurors have already asked or which appeals were already used. A
  9-person jury means up to 9 rounds of an unchanging 4-button menu with no progress
  indicator ("juror 3 of 9") and no memory of which appeal was already made to whom — a
  player could easily lose count of where they are in the sequence purely from the panel.
- Fix: at minimum, add a lightweight progress readout (e.g. "Question N" derived from
  `reveals`/`asking` continuity, or a simple counter the panel tracks per finale-stage
  entry) so the panel visibly advances.

## GADGET-11 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Deals gadget has no defensive humanization for an unrecognized `kind` — unlike Retrospective's own precedent

- Where: `frontend/static/js/orwellDeals.js:34-39` (`KIND_LABEL`) and `:118-148`/`:137`
  (`kind.textContent = " · " + (KIND_LABEL[d.kind] || d.kind || "Deal")`); the engine's
  own type is looser than the FE assumes — `src/ports/GameSession.ts:133`
  (`DealView.kind: string`, NOT the narrower `MakeDealReq.kind` union at line 426) — so
  nothing in the type system guarantees `d.kind` is one of the four known values forever.
- Problem: `orwellRetrospective.js` already had to solve exactly this class of problem for
  `hiddenStory[].type` (its `humanizeStoryType` helper explicitly guards against "a raw
  internal pathway id... never surface it verbatim"). `orwellDeals.js` has no equivalent:
  if a deal's `kind` is ever anything outside the four currently-known strings (a plausible
  risk given 0107's alliance-adjacent work is landing in the same area of the engine, or a
  legacy/cross-version save), the RAW kebab-case machinery string renders verbatim in the
  player-facing "Your Deals" gadget — the exact kind of leak CLAUDE.md's I9 forbids
  ("no engine/tool/app/system talk in anything the player sees").
- Fix: replace the `|| d.kind` fallback with a humanized default (title-case + dash→space,
  mirroring `humanizeStoryType`) instead of the raw string, or simply fall back to the
  existing `"Deal"` literal unconditionally.

## GADGET-12 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Your Deals ledger carries no week/date — a season's worth of promises reads as one undated flat list

- Where: `frontend/static/js/orwellDeals.js:118-148` (`render`).
- Problem: deals are explicitly never removed once kept/broken (the sort just buckets
  `open` → `kept` → `broken`), and per the non-degradation mandate they should accumulate
  all season. But nothing in the row (`odl-who` / `odl-kind` / `odl-terms` / `odl-tag`)
  carries WHEN the deal was struck or resolved. By week 6-8 a player could have half a
  dozen kept/broken deals from wildly different points in the game mixed together with no
  chronological anchor — "who promised me what, and when" is exactly the kind of
  jury-management bookkeeping this panel exists to support, and it's missing the one axis
  (time) that makes a promise-history legible.
- Fix: surface the engine's week-of-formation (if not already tracked, a cheap addition to
  `DealView`) as a small "Week N" tag per row, at minimum for kept/broken (settled) deals.

## GADGET-13 — [Severity: Minor] [Effort: <1hr] [Value: Med]
No gadget body has a scroll cap except Cast-pin — several lists can grow unbounded and balloon the rail

- Where: `frontend/static/js/orwellGadget.js:56-99` (the shared `.og-card`/`.og-body` CSS
  family — no `max-height`/`overflow-y` anywhere in the kit); concretely unbounded in:
  - `orwellDeals.js:118-148` (`#odl-list` — every open+kept+broken deal, all season, one
    div per row, no cap);
  - `orwellNightStatus.js:101-114` (the "Turned in" comma-list — could be up to 15 names
    late in a long season night);
  - `orwellStatusPanel.js:398-411` (`renderPremiere`'s "Still to meet" line — up to 14 names
    during the premiere, the single densest list of the bunch).
  Contrast with `orwellCastPin.js:68-71`, which explicitly caps its own grid at
  `max-height: 188px; overflow-y: auto` specifically because "the gadget stays compact in
  the rail" — the exact concern the other three ignore.
- Problem: the gadget rail is a fixed-width sidebar column; a body that grows without bound
  pushes every gadget below it further down, and on a short viewport can push gadgets (or
  the composer, per the rail's own "anti-overlap belt" comments elsewhere in the codebase)
  out of the visible area entirely. None of these three lists is exotic — a mid/late-game
  season with several deals and most of the house asleep at 2am are both completely normal
  states, not edge cases.
- Fix: apply the same `max-height` + `overflow-y: auto` pattern from `orwellCastPin.js` to
  `#odl-list`, `.onight-list`, and `#os-prem-left` (or lift the fix into the shared
  `.og-body` rule in `orwellGadget.js` so every current and future gadget gets it for free).

## GADGET-14 — [Severity: Minor] [Effort: <1day] [Value: Med]
Collapsed gadget rail gives zero visual signal that a docked gadget's content changed

- Where: `frontend/static/js/orwellGadgetRail.js` (`syncStrip`/`activeGadgetIds`, the
  collapsed icon-strip renderer, ~lines 194-236) vs. the delta-flash treatment in
  `orwellStatusPanel.js` (`.os-changed`/`flashRow`, lines 137-144, 273-302).
  `orwellStatusPanel.js` deliberately gives every power-state change (HOH/noms/veto/phase)
  a `TRANS-3` flash specifically "so a ceremony reveal is never a silent text swap" — but
  that flash lives entirely inside the expanded card, which the collapsed rail's icon strip
  never renders.
- Problem: collapsing the gadget rail is a first-class, persisted, one-tap affordance
  (`COLLAPSE_KEY`), and the collapsed state replaces every gadget with a small icon-only
  strip (`syncStrip`). Nothing in that strip carries any change indicator — no dot, no
  pulse, no color shift on the relevant icon — when the underlying gadget's content
  changes while collapsed (a new HOH crowned, a nomination, a deal going from open to
  broken, a houseguest turning in for the night). A player who collapses the rail to save
  space (very plausible on a narrower desktop window, or simply a personal preference) gets
  NO passive signal that a ceremony just resolved; they must proactively re-expand and
  re-read every gadget to find out. This directly works against "read power-state at a
  glance," specifically for players who use the one control the rail offers for managing
  its own footprint.
- Fix: track a per-gadget "dirty since last viewed while collapsed" flag (cheap: compare a
  content signature, mirroring the `_lastSig` pattern already used in
  `orwellRetrospective.js`) and render a small dot/badge on that gadget's strip icon until
  the rail is expanded again.

## GADGET-15 — [Severity: Polish] [Effort: <1hr] [Value: Low]
Finale's `nameOf` fallback corroborates the already-logged "A houseguest" bug in a second, independent gadget

- Where: `frontend/static/js/orwellFinale.js:167` — `function nameOf(ref) { return (ref &&
  ref.name) || "A houseguest"; }`, used for finalist cards, vote reveals, and the "Vote for"
  buttons.
- Problem: the prior audit pass already logged the Deals gadget's identical `"A
  houseguest"` fallback pattern as a defect (a `NamedRef` missing/losing its `name`). This
  is a second, independently-written instance of the exact same fallback string in a
  completely different gadget/data path (finale reveals/finalists rather than deal
  parties), which raises confidence this is a systemic `NamedRef`-serialization gap rather
  than a one-off — worth folding into whatever fix addresses the original finding rather
  than patching gadget-by-gadget.
- Fix: same as the original finding's fix, applied here too; consider a single shared
  `nameOf`/`otherParty` helper (there are now at least 3 near-identical implementations:
  `orwellDeals.js`, `orwellFinale.js`, and likely others) so a future fix only has to land
  in one place.

## GADGET-16 — [Severity: Polish] [Effort: <1hr] [Value: Low]
Cast-pin's "Compact pin" button is styled as a toggle but only ever pins, never un-pins, from that surface

- Where: `frontend/static/js/orwellCast.js:358-372`.
- Problem: the button carries `aria-pressed` (an ARIA toggle-button pattern, implying a
  second click reverses the first), but its click handler unconditionally calls
  `window.OrwellCastPin.setPinned(true)` — there is no path from this control back to
  `setPinned(false)`. In practice this is nearly unreachable as a live bug (pinning closes
  the floating window the button lives on, so the button vanishes the instant it would
  need to show `aria-pressed="true"`), but the semantics are technically wrong for an AT
  user relying on the pressed-state contract, and it's a small inconsistency with the
  actual un-pin affordance living only in the OTHER surface (`orwellCastPin.js`'s "Un-pin"
  action button).
- Fix: either drop `aria-pressed` from this control (it's a one-way action button, not a
  toggle — a plain `<button>` with a clear label is more honest), or wire the click handler
  to `window.OrwellCastPin.toggle()` so it's a real toggle from either surface.

---

## Coverage / what was and wasn't examined

Read in full: `orwellStatusPanel.js`, `orwellDeals.js`, `orwellPresence.js`,
`orwellCastPin.js`, `orwellNightStatus.js`, `orwellFinale.js`, `orwellDiaryRoom.js`,
`orwellRetrospective.js`, `orwellGadget.js` (the shared kit). Read the load-bearing sections
of `orwellCast.js` (card lifecycle, monogram placeholder, pagination/gallery affordances,
empty/error states, backfill lever, pin wiring) and `orwellGadgetRail.js` (collapse, drawer,
drag-reorder, collapsed strip, anti-overlap guard) via targeted grep-then-read rather than
end-to-end (both are 40+KB files; the sampled sections cover every distinct behavioral
seam — mount/poll/collapse/reorder/drag/strip — so I'm confident the sampling was
representative, not superficial). Cross-checked FE claims against engine ground truth in
`src/engine/liveSeason.ts`, `src/adapters/engine/GameSessionAdapter.ts`, and
`src/ports/GameSession.ts` wherever a finding depended on exactly what the engine computes
or sends (GADGET-1, 2, 5, 9, 11 are all verified this way, not just inferred from FE code).

Did NOT dig into: `orwellSocial.js` (out of this lane's named territory), the settings/theme
windows, or the mobile CSS media-query variants pixel-by-pixel (spot-checked the `@media
(max-width: 768px)` blocks present in each file read; found no NEW mobile-specific defect
beyond what's already captured above). Did not attempt to run a live engine+FE stack to
reproduce GADGET-1/2/5/9 dynamically — these are traced statically end-to-end through the
exact source lines cited, which is a stronger form of evidence than a single screenshot
would have been for a data-flow bug, but a live repro would be the natural next step to
convert these into red tests.

Ran out of new, non-duplicate findings in this territory after the above — every named
gadget got at least 2 distinct findings, most got 3+, and the shared-kit-level pattern
(GADGET-13/14) was traced back to its root in `orwellGadget.js`/`orwellGadgetRail.js` rather
than just flagged per-gadget.

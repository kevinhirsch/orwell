# 2026-07-22 — Full repo audit, playtest & exhaustive backlog (live campaign)

> **Status: LIVE — findings land incrementally as audit lanes complete.** This is the
> 2026-07-22 full-product audit campaign: a 14-lane parallel source audit (BB canon ·
> social-game structure · prose/prompts · FE copy · HIG · UX flows · IA/wayfinding ·
> interaction/feedback · engine bugs · FE bugs · consistency/parity · responsive ·
> Vault-Wall adversary · a11y), plus a **playtest harness run on the real stack**
> (engine with deploy-parity flags + FE, deterministic-model UI capture at both
> breakpoints, then a live-model in-persona roleplay playtest). Every finding is
> adversarially **verified** against source and **deduplicated** against:
> `docs/audits/2026-07-21-campaign-report-and-exhaustive-backlog.md` (T0–T9 + waves),
> `docs/audits/2026-07-22-repo-gap-audit.md` (G1–G25, now filed as GitHub issues),
> `HANDOFF.md` §2–4, and the live open-issue set.
>
> **Contract convention:** each item carries DoR / AC / DoD in the house format
> (per #1775). Items are filed as GitHub issues as they are confirmed; the issue is
> canonical for live state, this doc is the campaign index.

## Method & evidence base

- **Source lanes:** 14 specialist auditors over the working tree @ `b874476` (includes
  #1830 chyrons, #1831 wipeout reel, #1860 gateway fold, #1861 gap-audit P1s), each
  finding re-verified by an independent adversarial pass (default-refute) before entry.
- **Playtest harness:** the committed harness (`docs/audits/playtest-harness/`) against
  the real stack — engine booted with the deploy-parity opt-in flag set (TUN-10,
  single-sourced from `deploy/orwell-env-defaults.sh`), FE with auth ON, admin account,
  game build. Deterministic-model capture: scenes at 1440×900 + 375×812, mechanical
  game-loop with per-turn screenshots. Live-model pass: ADR 0016 deploy pair
  (narrator `z-ai/glm-4.7`), in-persona roleplay per the harness §4 methodology.
- **Severity:** P0 breakage/mandate violation · P1 dead-or-wrong at runtime, or badly
  degrades play · P2 missing guard on a load-bearing invariant / clear defect ·
  P3 polish, debt, improvement.

## Lane status

| Lane | State | Findings (confirmed/total) |
|---|---|---|
| parity (consistency/two-window) | ✅ reported · 🔬 verification running | –/7 |
| a11y | ✅ reported · 🔬 verification running | –/6 |
| bb-canon | 🔄 running | |
| social-game | 🔄 running | |
| prose-prompts | 🔄 running | |
| fe-copy | 🔄 running | |
| hig | 🔄 running | |
| ux-flows | 🔄 running | |
| ux-ia | 🔄 running | |
| interaction | 🔄 running | |
| bugs-engine | 🔄 running | |
| bugs-fe | 🔄 running | |
| responsive | 🔄 running | |
| vault | 🔄 running | |
| playtest (deterministic UI capture) | 🔄 running | |
| playtest (live-model roleplay) | ⏳ queued behind capture | |

---

## Findings

IDs are `R-<lane>-<n>` (R = this 2026-07-22 **R**epo-audit campaign). Verification
verdicts and issue numbers are appended as they land.

### Lane: parity — consistency & two-window/transport parity (7 findings, verification in progress)

#### R-PAR-1 · P1 · `exit-interview` decision kind missing from BOTH transport allowlists — the card renders but can never be confirmed

- **Evidence:** `frontend/routes/orwell_routes.py:1509-1516` (`_DECISION_KINDS` lacks
  `exit-interview`) · `frontend/routes/ws_routes.py:65-71` (same) ·
  `frontend/src/tool_implementations.py:5231-5240` (model-tool copy HAS it) ·
  `frontend/static/js/orwellDecision.js:39,418-421,461,484,501,735` (full card render +
  `payloadFor` posts the kind) · `frontend/tests/test_sync_audit.py:29-46,68-83` (drift
  gate pins its own stale list and scans ONLY `orwell_routes.py`).
- **Description:** the engine raises a real `exit-interview` pending at the player's own
  eviction (0130); the FE renders the card; confirm posts the kind — and both the HTTP
  route and the WS relay refuse it as an unknown kind (mapped to "That move isn't legal
  right now — pick another."). Three hand-copied kind sets exist; only the model-tool copy
  was updated when 0130 shipped, and the drift gate can't see the other two copies.
- **Impact:** at the season's climactic beat — the player's own eviction — the decision
  card is un-confirmable on BOTH transports; the player is told a legal move is illegal.
- **Fix direction:** add the kind to both allowlists; derive ONE canonical kind set (or
  extend `test_sync_audit.py` to lockstep-scan all three copies incl. `ws_routes.py`).

**DoR**
- [ ] Repro pinned: drive a player-eviction to the exit-interview pending on a live
  sandbox, confirm the card 400s on HTTP and `unknown-kind`s on WS.
- [ ] Decision: canonical-set import vs. lockstep test extension (recommend canonical set —
  the third copy proves hand-sync fails).
**AC**
- [ ] `exit-interview` confirm succeeds via `POST /api/orwell/decision` AND the WS
  decision frame; the vote+statement reach the engine.
- [ ] A single canonical kind set (or a three-way lockstep drift gate incl. `ws_routes.py`)
  makes the next added kind unable to drift.
**DoD**
- [ ] AC met; fe-unit test drives an exit-interview confirm over both transports.
- [ ] Full FE pytest suite green.

#### R-PAR-2 · P1 · WS decision relay bypasses the HTTP decision route's load-bearing seams (pending cache, F14 post-goodbye advance, CON-4 stale-beat reconcile, DB1/DB2 debounce)

- **Evidence:** `frontend/routes/ws_routes.py:671-715` (thin `submit_decision` relay) vs
  `frontend/routes/orwell_routes.py:1518-1620` (remember/clear pending at 1584-87, F14
  post-goodbye `advance_game` at 1569-83, CON-4 `_handle_stale_beat` at 1596-1608, refusal
  debounce at 1619) · `orwellDecision.js:900-903` (comment claims exact-handler parity —
  false) · `frontend/src/orwell_engine.py:1339-1345`.
- **Description:** with `ORWELL_WS_TRANSPORT` default-ON, every decision confirm on a
  healthy socket takes the WS relay — which skips the goodbye follow-up advance (the
  eviction week can re-wedge, the exact class F14 closed for HTTP), skips the pending
  cache clear (stale card can re-arm), surfaces error copy for a stale-beat case HTTP
  reconciles silently, and has no refusal-storm debounce.
- **Impact:** on the shipped default transport: eviction-week wedge regression after the
  player's goodbye; stale decision cards; divergent player-visible behavior between two
  windows on different transports.
- **Fix direction:** extract the HTTP handler's post-submit tail into one shared function
  called by both transports (the `make_ws_turn_stream_factory` "one pipeline, two
  transports" shape); pin with a WS-path goodbye test.

**DoR**
- [ ] The full seam inventory of the HTTP tail is enumerated (pending cache, F14 advance,
  CON-4, debounce) and each classified shared-vs-transport-specific.
**AC**
- [ ] A goodbye submitted over WS fires the F14 follow-up advance and `clear_pending`,
  byte-equivalent to the HTTP path.
- [ ] Stale-beat on WS reconciles silently (CON-4 parity); refusal debounce applies.
- [ ] `orwellDecision.js:900-903`'s parity claim becomes true (or the comment is fixed).
**DoD**
- [ ] AC met; fe-unit tests drive goodbye + stale-beat + refusal-storm over the WS path.
- [ ] Full FE pytest suite green; mirror-toolturn CI legs green.

#### R-PAR-3 · P2 · WS-only pre-flight beatSeq CAS on chat turns silently discards the player's typed message

- **Evidence:** `frontend/routes/ws_routes.py:655-656` · `frontend/static/js/orwellWs.js:568-581` ·
  `frontend/static/js/chat.js:1640-1655` (catch: bubble removed, outbox released, no
  notice/retry) · `docs/design/websocket-phase1-protocol.md:543` (case f mandates
  reconcile-and-retry) · HTTP path carries no turn-level CAS.
- **Description:** between a peer window's commit and this window's state-edge delivery,
  the locally-pinned `expectedBeatSeq` is stale; the WS turn is refused pre-write and the
  client erases the optimistic bubble without restoring the composer. The same message
  over SSE is accepted.
- **Impact:** racy but real: silent message loss on the default transport only — violates
  the frozen spec's own acceptance case and the #1599 no-silent-fail-soft ruling.
- **Fix direction:** adopt surfaced beatSeq + auto-retry once (the spec's contract), or
  restore composer text with a visible notice; fe-unit test pins survival.

**DoR**
- [ ] Decide: auto-retry (spec case f) vs. restore-with-notice; decide whether free-text
  turns should carry turn-level CAS at all (D7 input).
**AC**
- [ ] A stale-beat turn refusal never loses the player's text (retried or restored); a
  visible signal exists when not auto-retried.
**DoD**
- [ ] AC met; fe-unit test drives `sendTurn` into stale-beat and asserts text survival;
  FE suite green; protocol doc updated if the CAS is removed for free-text turns.

#### R-PAR-4 · P2 · Gateway turns are invisible to web surfaces (no session row, no game-updated publish, memoryless narration) — and WS mode deleted the poll floor that would mask it

- **Evidence:** `frontend/gateway/handler.py:157` (fold lands — G1 fixed) but zero
  `session_events`/`publish_game_updated` calls in `frontend/gateway/**` ·
  `handler.py:217-220` (narration context = [system, user] only) ·
  `orwellStatusPanel.js:852-877` (WS cancels HUD polls) · `orwell_game_session.py:78-93`
  (the publish seam exists, unused).
- **Description:** post-#1860 the gateway genuinely mutates the engine (fold + beatSeq
  bump + off-screen tick) from outside the FE consistency spine: no transcript row
  reaches any web session, no push fires, and under default-ON WS there is no poll
  fallback — web staleness after a Telegram turn is unbounded; gateway narration also
  can't remember its own prior replies.
- **Impact:** same-identity phone+desktop play shows divergent transcripts and a stale
  web board; the gateway can contradict itself turn to turn.
- **Fix direction:** one-line `publish_game_updated` after `fold_gateway_turn`; persist
  gateway turns into the canonical session (or a visible thread); feed recent history to
  gateway narration; test asserts a gateway turn publishes on the bound canonical session.

**DoR**
- [ ] Decision: canonical-session append vs. dedicated visible thread for gateway turns.
- [ ] Context budget for gateway narration history decided (N recent turns).
**AC**
- [ ] A gateway turn triggers `game-updated` on the bound canonical session (web HUD
  reconciles under WS mode with polls cancelled).
- [ ] Gateway turns appear in the shared transcript surface; gateway narration receives
  its own recent history.
**DoD**
- [ ] AC met; gateway tests cover publish + transcript + history; FE suite green.

#### R-PAR-5 · P2 · F5's HUD/status half has no WS-mode executable gate

- **Evidence:** `docs/audits/playtest-harness/mirror_hud_parity.mjs` (zero
  `ORWELL_WS_TRANSPORT` occurrences) vs the chat gates' per-transport legs
  (`mirror_live_parity.mjs:44-85`, `mirror_toolturn_parity.mjs:40-68`) ·
  `.github/workflows/ci.yml:424-525` (no MIRROR_HUD job) · WS HUD mechanism:
  `orwellStatusPanel.js:852-878`, `orwellDecision.js:1142-1160`, `platform.js:213-225`.
- **Description:** under WS the HUD freshness path is an entirely different mechanism
  (session_events → state/hud frames → `ws:state` edge, polls cancelled), proven only at
  unit level; the only end-to-end HUD-parity gate is SSE-only and not in CI. D7 (full-WS)
  would make the untested mechanism the only one.
- **Impact:** a regression in the WS HUD edge chain ships with all required gates green.
- **Fix direction:** add a WS leg to `mirror_hud_parity.mjs` (per-leg init-script pattern)
  and wire MIRROR_HUD SSE+WS legs into the mirror-parity CI job before D7 lands.

**DoR**
- [ ] Confirm the gate's runtime cost fits the mirror-parity job budget.
**AC**
- [ ] `mirror_hud_parity.mjs` runs SSE and WS legs; the WS leg asserts B's HUD reconciles
  off the `ws:state` edge with polls provably cancelled.
- [ ] Both legs run in CI under the FE path filter.
**DoD**
- [ ] AC met; gate self-test knobs prove it fails a non-mirroring B; CI green.

#### R-PAR-6 · P2 · WS distinct-runId `run-started` during an ACTIVE stream tears down the live tail in both windows (queued turns freeze airing narration)

- **Evidence:** `frontend/static/js/orwellWs.js:488-502` (immediate re-attach; premise
  "new run ⇒ engine work done" false for queue=True) · `frontend/src/agent_runs.py:249-258`
  (queued run registered immediately while prev streams) · `frontend/routes/ws_routes.py:664-665` ·
  SSE defers instead: `sessionSync.js:302-312` · `frontend/tests/test_ws_run_started_reattach.py:395-406`
  (pins the immediate re-attach; no still-streaming scenario).
- **Description:** window B queues a turn while A's run streams; run-started for B's run
  fires now; both windows' clients reset the chat cursor and resubscribe, cancelling the
  old chat channel — A's airing narration freezes mid-sentence until the settle reconcile
  pastes it. SSE handles the same case by deferring the peer attach.
- **Impact:** realtime-mirror quality silently degrades exactly in the concurrent-play
  case the queue-don't-cancel design exists for (no data loss; F1 holds).
- **Fix direction:** defer re-attach while the current tail is fresh (delta within a
  freshness window), or delay the queued run's run-started publish until it drains; add a
  mid-stream-queued-turn scenario to the toolturn gate.

**DoR**
- [ ] Decide client-defer vs. server-delay (client-defer keeps server contract frozen).
**AC**
- [ ] A queued turn no longer interrupts the airing stream's live tail in either window;
  the flake case (quiescent tail, lagging done frame) still re-attaches immediately.
**DoD**
- [ ] AC met; toolturn gate scenario covers mid-stream queue; CI mirror legs green.

#### R-PAR-7 · P3 · Spec-promised WS→SSE downgrade handoff payload (`fromSeq`/`beatSeq`) is emitted but consumed by nobody

- **Evidence:** `frontend/static/js/orwellWs.js:630-641` (emit) ·
  `docs/design/websocket-phase1-protocol.md:509-516` (the contract) · every
  `orwell:ws-inactive` listener ignores the detail (grep `fromSeq` across `static/js`
  hits only `orwellWs.js`).
- **Description:** the downgrade contract's consuming half was never built; masked today
  by the renderer's `{id,seq}` dedupe and the server-side beat tracker. Dead API surface
  a future maintainer (esp. the D7/#1413 render-path work) will trust.
- **Impact:** none observable today; latent double-render/CAS-wedge exposure once the
  compensating mechanisms change.
- **Fix direction:** consume the payload as an explicit SSE splice cursor, or delete the
  dead fields and amend the protocol §6 to name the real mechanisms; add a mid-stream
  downgrade splice test either way.

**DoR**
- [ ] Decide consume vs. delete-and-amend (recommend delete-and-amend unless #1413 needs
  the cursor).
**AC**
- [ ] No dead handoff fields, OR the fields are consumed by the SSE resume splice; the
  protocol doc matches the implementation.
**DoD**
- [ ] AC met; a mid-stream WS→SSE downgrade splice test exists; FE suite green.

---

### Lane: a11y — accessibility structure & CI coverage (6 findings, verification in progress)

*Lane self-deduped against the 2026-07-15 rendered-contrast audit, the `a11y_matrix.py`
XFAIL registry, and #1644 (all in-flight glass-contrast work skipped). The Wipeout Reel
(#1831) was explicitly scoped out — it adds no FE surface (narrator-content only).*

#### R-A11Y-1 · P1 · Reasoning/collapsible accordion toggle is keyboard-unreachable with no ARIA state

- **Evidence:** `frontend/static/js/markdown.js:588-613,693-704,1743-1762` (bare `<div>`,
  click-only delegated handler) · `style.css:8584-8594` + `css/responsive-tokens.css:70-78`
  (CSS styles it as an interactive control) · `a11y.js:17-52` (`enhanceRow` exists but
  `ROW_SELECTOR:21` excludes it).
- **Description:** the "Production notes" reasoning accordion and `createCollapsible`
  (photo descriptions) have no `role`/`tabindex`/`aria-expanded` and no keydown path.
- **Impact:** keyboard-only and SR players can never expand reasoning/photo-description
  content — on effectively every model turn that has it.
- **Fix direction:** extend `ROW_SELECTOR` (or tag `data-a11y-activatable`); toggle
  `aria-expanded` in `_setThinkingExpanded`.

**DoR** — [ ] confirm the accordion list (thinking-header + createCollapsible consumers) is complete.
**AC** — [ ] toggles are Tab-reachable, Enter/Space-operable, expose `aria-expanded`; [ ] axe pass clean on a transcript with an accordion.
**DoD** — [ ] AC met; fe-unit/browser test pins keyboard operability; FE suite green.

#### R-A11Y-2 · P1 · BeatAnnouncement chyrons bypass the app's own SR-broadcast pattern — outcome facts silent for screen readers

- **Evidence:** `orwellDecision.js:1231-1253` (`role="status"` appended into
  `#chat-history`, which `index.html:1320-1324` deliberately sets `aria-live="off"`) ·
  the working pattern `#a11y-announcer` / `orwellAnnounce` (`a11y.js:121-156`,
  `chat.js:3877`) is unused for chyrons.
- **Description:** every committed ceremony fact (HOH/noms/veto/ballots/eviction) renders
  only inside a container silenced for AT.
- **Impact:** SR players get no proactive announcement of the authoritative outcomes —
  the exact facts T0-3 shipped to make trustworthy; they stay dependent on the prose
  channel sighted players just stopped needing.
- **Fix direction:** route chyron text through `window.orwellAnnounce` in addition to the
  visual card.

**DoR** — [ ] decide announcement copy (kicker + headline vs. full body).
**AC** — [ ] each chyron (and one coalesced summary for ballot batches, see R-A11Y-3) fires exactly one announcer message; no re-announce on reconcile.
**DoD** — [ ] AC met; browser test asserts announcer content on a staged chyron mount; FE suite green.

#### R-A11Y-3 · P2 · Staggered eviction-ballot chyron batch floods the live region (~4 announcements/sec)

- **Evidence:** `orwellDecision.js:1255-1261` (260ms stagger; up to ~13 ballot chyrons per
  reveal, kinds at `:1192,1197`).
- **Fix direction:** widen the ballot-batch stagger or emit one coalesced summary
  announcement alongside the per-card visual cadence.

**DoR** — [ ] pair with R-A11Y-2's copy decision. **AC** — [ ] the eviction reveal produces a comprehensible SR sequence (per-ballot at a humane rate, or one summary). **DoD** — [ ] AC met; covered by the R-A11Y-2 test; FE suite green.

#### R-A11Y-4 · P2 · Chyron kicker computes below AA contrast on light-panel themes

- **Evidence:** `orwellDecision.js` `.ow-chyron-kicker` (~1221-1224: 11.2px non-bold at
  `opacity:.65`) over `theme.js:26-50` tokens → light ≈ 3.11:1, paper ≈ 4.06:1 (< 4.5:1);
  glass/dark/midnight pass. Postdates the 2026-07-15 contrast audit and #1644 — untracked.
- **Fix direction:** drop the opacity multiply; use a floored `--fg-muted` token (the HIG
  audit's prescribed fix for the sibling muted-ink class); verify with rendered-pixel
  sampling.

**DoR** — [ ] confirm computed ratios by rendered-pixel sample on light + paper. **AC** — [ ] kicker ≥ 4.5:1 on every stock theme. **DoD** — [ ] AC met; the a11y-matrix contrast sweep covers `.ow-chyron` (see R-A11Y-5); FE suite green.

#### R-A11Y-5 · P1 · The standing a11y CI gate never sweeps the chat transcript — chyrons, bubbles, accordion structurally invisible to it

- **Evidence:** `a11y_matrix.py:375-380` (`_CONTRAST_SELECTOR`) +
  `responsive_matrix.py:297-317` (`GAME_SURFACES`/`CROWD_SELECTOR`) — neither lists
  `#chat-history`; `.ow-chyron` matches no selector; the matrix stages state via the
  engine API so chyrons (rendered only from the live `'orwell:announcements'` dispatch,
  `chat.js:3112`) cannot even render in the harness today.
- **Impact:** any future a11y/layout regression on the app's most-rendered surface ships
  silently forever.
- **Fix direction:** add `#chat-history` to both selector sets; drive a real chyron mount
  during a staged run (the `window.OrwellChyron.render` seam at `orwellDecision.js:1273`).

**DoR** — [ ] pick the chyron-mount mechanism for the harness (test seam vs. driven turn).
**AC** — [ ] axe + rendered-contrast + crowding sweeps include `#chat-history` with at least one bubble, one accordion, one chyron mounted; new XFAILs filed for anything it immediately catches.
**DoD** — [ ] AC met; matrices green (or XFAIL-registered) in CI; registry entries reference this item.

#### R-A11Y-6 · P2 · `a11y_matrix.py` has zero keyboard/focus-trap/focus-restore regression coverage

- **Evidence:** `a11y_matrix.py:522-598` (screenshot + axe + pixel-contrast only; no
  `page.keyboard.press`, no `activeElement` assertions) — while the window kit's mature
  keyboard mechanics (`_trapFocus`, `_focusIntoModal`, focus-return, arrow-move/resize at
  `orwellWindow.js:1113-1148,1328-1348,1710-1717`) have no CI signal.
- **Fix direction:** add a Playwright keyboard pass: Tab-cycle each modal kind (trap
  wraps), Escape → focus returns to opener, Arrow/Shift+Arrow moves/resizes a titlebar.

**DoR** — [ ] enumerate modal kinds to cover. **AC** — [ ] the keyboard pass fails when the trap, restore, or arrow-key alternative breaks. **DoD** — [ ] AC met; wired into the a11y-matrix CI job; runtime within job budget.

---

*(Further lanes land below as they complete.)*

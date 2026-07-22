# 2026-07-22 — Full repo audit, playtest & exhaustive backlog (campaign closed)

> **Status: CLOSED — see the "Campaign closed" note below for exact lane coverage.**
> This is the
> 2026-07-22 full-product audit campaign: a 14-lane parallel source audit (BB canon ·
> social-game structure · prose/prompts · FE copy · HIG · UX flows · IA/wayfinding ·
> interaction/feedback · engine bugs · FE bugs · consistency/parity · responsive ·
> Vault-Wall adversary · a11y), plus a **playtest harness run on the real stack**
> (engine with deploy-parity flags + FE, deterministic-model UI capture at both
> breakpoints, then a live-model in-persona roleplay playtest). The original plan ran a
> second adversarial-verify pass per finding; that pass was **dropped mid-campaign on
> explicit instruction** to prioritize coverage and speed over verification depth, so
> the findings below are **single-pass, source-grounded (file:line evidence) but not
> independently re-verified** — treat them as strong leads to confirm during
> implementation, not as adjudicated verdicts. All findings ARE **deduplicated** against:
> `docs/audits/2026-07-21-campaign-report-and-exhaustive-backlog.md` (T0–T9 + waves),
> `docs/audits/2026-07-22-repo-gap-audit.md` (G1–G25, now filed as GitHub issues),
> `HANDOFF.md` §2–4, and the live open-issue set — each auditor read those sources first
> and was instructed to drop or narrow anything already tracked.
>
> **Contract convention:** each item carries DoR / AC / DoD in the house format
> (per #1775). Items are filed as GitHub issues as they are confirmed; the issue is
> canonical for live state, this doc is the campaign index.
>
> **Campaign closed 2026-07-22.** 4 of 14 planned lanes returned findings before the
> campaign was called (parity, a11y, responsive, vault — 28 findings total); the
> remaining 10 lanes (bb-canon, social-game, prose-prompts, fe-copy, hig, ux-flows,
> ux-ia, interaction, bugs-engine, bugs-fe) and the live-model playtest pass were not
> run. Every P0 and P1 finding from the 4 completed lanes is filed as a GitHub issue
> (#1864–#1871, #1873–#1875, #1877 — see the per-finding sections below for the exact
> mapping). P2/P3 findings remain tracked in this doc with full DoR/AC/DoD contracts;
> file them as issues on a future pass if the backlog wants them individually tracked.

## Method & evidence base

- **Source lanes:** 14 specialist auditors planned over the working tree @ `b874476`
  (includes #1830 chyrons, #1831 wipeout reel, #1860 gateway fold, #1861 gap-audit P1s);
  4 completed (parity, a11y, responsive, vault) before the campaign was closed. Findings
  are single-pass and source-grounded, NOT independently adversarially re-verified — see
  the status note above.
- **Playtest harness:** the committed harness (`docs/audits/playtest-harness/`) against
  the real stack — engine booted with the deploy-parity opt-in flag set (TUN-10,
  single-sourced from `deploy/orwell-env-defaults.sh`), FE with auth ON, admin account,
  game build. **Completed evidence:** deterministic-model capture — login/home/settings/
  theme scenes + the game windows at 1440×900 and 375×812, plus a 14-turn mechanical
  game-loop with per-turn screenshots (`.audit-telemetry/shots/`). **Planned (queued):**
  the live-model in-persona roleplay pass on the ADR 0016 deploy pair
  (narrator `z-ai/glm-4.7`) per the harness §4 methodology — not yet run.
- **Severity:** P0 breakage/mandate violation · P1 dead-or-wrong at runtime, or badly
  degrades play · P2 missing guard on a load-bearing invariant / clear defect ·
  P3 polish, debt, improvement.

## Lane status (campaign closed 2026-07-22)

| Lane | State | Findings | Issues filed |
|---|---|---|---|
| parity (consistency/two-window) | ✅ complete | 7 (2 P1, 4 P2, 1 P3) | #1864, #1866 |
| a11y | ✅ complete | 6 (3 P1, 3 P2) | #1873, #1874, #1875, #1876 |
| responsive | ✅ complete | 8 (5 P2, 3 P3) | #1877 |
| vault (Vault-Wall adversarial) | ✅ complete | 7 (1 P0, 5 P1, 1 P2) | #1865, #1867–#1871, #1872 |
| bb-canon | ⏸️ not run | — | — |
| social-game | ⏸️ not run | — | — |
| prose-prompts | ⏸️ not run | — | — |
| fe-copy | ⏸️ not run | — | — |
| hig | ⏸️ not run | — | — |
| ux-flows | ⏸️ not run | — | — |
| ux-ia | ⏸️ not run | — | — |
| interaction | ⏸️ not run | — | — |
| bugs-engine | ⏸️ not run | — | — |
| bugs-fe | ⏸️ not run | — | — |
| playtest (deterministic UI capture) | ✅ captured — scenes + 14-turn mechanical loop, both breakpoints, `.audit-telemetry/shots/` | evidence for the UI lanes, unconsumed | — |
| playtest (live-model roleplay) | ⏸️ not run | — | — |

**28 findings total this campaign: 1 P0, 13 P1, 11 P2, 3 P3 — all 14 P0/P1 items filed
as GitHub issues.** The 10 unrun lanes and the live-model playtest pass are the natural
next slice of this campaign; the harness, stack-boot script, and dedupe sources are all
in place for a fast resume.

---

## Findings

IDs are `R-<lane>-<n>` (R = this 2026-07-22 **R**epo-audit campaign). No independent
verification pass was run (see the status note above) — issue numbers are cross-referenced
inline on each finding heading.

### Lane: parity — consistency & two-window/transport parity (7 findings, single-pass — not independently re-verified)

#### R-PAR-1 · Issue #1864 · P1 · `exit-interview` decision kind missing from BOTH transport allowlists — the card renders but can never be confirmed

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

#### R-PAR-2 · Issue #1866 · P1 · WS decision relay bypasses the HTTP decision route's load-bearing seams (pending cache, F14 post-goodbye advance, CON-4 stale-beat reconcile, DB1/DB2 debounce)

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
- [ ] A goodbye submitted over WS reaches **semantic parity** with the HTTP path —
  identical state transitions and equivalent observable behavior, including the F14
  follow-up advance and `clear_pending` (not byte-equivalence; the transport framing
  differs by construction).
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

### Lane: a11y — accessibility structure & CI coverage (6 findings, single-pass — not independently re-verified)

*Lane self-deduped against the 2026-07-15 rendered-contrast audit, the `a11y_matrix.py`
XFAIL registry, and #1644 (all in-flight glass-contrast work skipped). The Wipeout Reel
(#1831) was explicitly scoped out — it adds no FE surface (narrator-content only).*

#### R-A11Y-1 · Issue #1873 · P1 · Reasoning/collapsible accordion toggle is keyboard-unreachable with no ARIA state

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

#### R-A11Y-2 · Issue #1874 (consolidated with R-A11Y-3) · P1 · BeatAnnouncement chyrons bypass the app's own SR-broadcast pattern — outcome facts silent for screen readers

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
**AC** — [ ] each single-fact chyron (HOH/noms/veto/replacement/eviction) fires exactly one
announcer message; a multi-ballot eviction reveal fires ONE coalesced summary
announcement (the single ballot-batch policy — see R-A11Y-3), not per-ballot; no
re-announce on reconcile.
**DoD** — [ ] AC met; browser test asserts announcer content on a staged chyron mount; FE suite green.

#### R-A11Y-3 · Issue #1874 (consolidated with R-A11Y-2) · P2 · Staggered eviction-ballot chyron batch floods the live region (~4 announcements/sec)

- **Evidence:** `orwellDecision.js:1255-1261` (260ms stagger; up to ~13 ballot chyrons per
  reveal, kinds at `:1192,1197`).
- **Fix direction:** widen the ballot-batch stagger or emit one coalesced summary
  announcement alongside the per-card visual cadence.

**DoR** — [ ] pair with R-A11Y-2's copy decision. **AC** — [ ] the eviction reveal emits exactly ONE coalesced summary announcement (the single agreed ballot-batch policy shared with R-A11Y-2), not a per-ballot stream, while the visual per-card cadence is unchanged. **DoD** — [ ] AC met; covered by the R-A11Y-2 test; FE suite green.

#### R-A11Y-4 · Issue #1876 (consolidated with R-A11Y-6) · P2 · Chyron kicker computes below AA contrast on light-panel themes

- **Evidence:** `orwellDecision.js` `.ow-chyron-kicker` (~1221-1224: 11.2px non-bold at
  `opacity:.65`) over `theme.js:26-50` tokens → light ≈ 3.11:1, paper ≈ 4.06:1 (< 4.5:1);
  glass/dark/midnight pass. Postdates the 2026-07-15 contrast audit and #1644 — untracked.
- **Fix direction:** drop the opacity multiply; use a floored `--fg-muted` token (the HIG
  audit's prescribed fix for the sibling muted-ink class); verify with rendered-pixel
  sampling.

**DoR** — [ ] confirm computed ratios by rendered-pixel sample on light + paper. **AC** — [ ] kicker ≥ 4.5:1 on every stock theme. **DoD** — [ ] AC met; the a11y-matrix contrast sweep covers `.ow-chyron` (see R-A11Y-5); FE suite green.

#### R-A11Y-5 · Issue #1875 · P1 · The standing a11y CI gate never sweeps the chat transcript — chyrons, bubbles, accordion structurally invisible to it

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

#### R-A11Y-6 · Issue #1876 (consolidated with R-A11Y-4) · P2 · `a11y_matrix.py` has zero keyboard/focus-trap/focus-restore regression coverage

- **Evidence:** `a11y_matrix.py:522-598` (screenshot + axe + pixel-contrast only; no
  `page.keyboard.press`, no `activeElement` assertions) — while the window kit's mature
  keyboard mechanics (`_trapFocus`, `_focusIntoModal`, focus-return, arrow-move/resize at
  `orwellWindow.js:1113-1148,1328-1348,1710-1717`) have no CI signal.
- **Fix direction:** add a Playwright keyboard pass: Tab-cycle each modal kind (trap
  wraps), Escape → focus returns to opener, Arrow/Shift+Arrow moves/resizes a titlebar.

**DoR** — [ ] enumerate modal kinds to cover. **AC** — [ ] the keyboard pass fails when the trap, restore, or arrow-key alternative breaks. **DoD** — [ ] AC met; wired into the a11y-matrix CI job; runtime within job budget.

---

### Lane: responsive — device fidelity, gates & touch (8 findings)

*Lane self-deduped vs RES-1..5, G1–G25, #1822/#1823, #1644. Touch emulation of the
matrix was live-probed and is valid; the findings are the axes it doesn't cover.*

#### R-RSP-1 · P2 · `responsive_matrix.py`'s xpass/staleness detector is dead code — the XFAIL registry can only grow
- **Evidence:** `responsive_matrix.py:126,129-139,951-956` (`xpasses` never appended;
  terminal print unreachable-in-effect) vs the sibling `a11y_matrix.py:186,230-237`
  implementing the same contract correctly. Four live `#1418-*` waivers (:97-103) are
  tracked nowhere else.
- **Impact:** stale waivers are undetectable; viewport-agnostic needles silently absorb
  future unrelated regressions of the same line shape.
- **Fix:** port `xfail_hits` bookkeeping; extract ONE shared XFAIL-registry helper both
  gates consume.
- **DoR** — [ ] confirm shared-helper altitude. **AC** — [ ] a fixed XFAIL prints the
  remove-nudge in both gates; [ ] shared helper. **DoD** — [ ] AC met; gates green in CI.

#### R-RSP-2 · P2 · The matrix emulates a viewport, not a device: DPR=1, no `is_mobile`, no landscape phone tier, no keyboard state
- **Evidence:** `responsive_matrix.py:62-69,820-821`; `a11y_matrix.py:551-553`; live
  probe: hasTouch-only context → `dpr:1`; width-keyed mobile fork (`orwellSlots.js:43`)
  means 844×390 landscape renders full desktop layout at 390px height — never rendered by
  any gate; canvas paths scale by DPR (`theme.js:2811`, `login_bg.js:198`).
- **Fix:** add an 844×390 coarse tier; `device_scale_factor=3, is_mobile=True` on phone
  tiers; a CDP visualViewport-shrink sub-pass.
- **DoR** — [ ] tier list agreed. **AC** — [ ] landscape + DPR3 tiers run; keyboard-shrink
  sub-pass asserts composer/sheet invariants. **DoD** — [ ] AC met; new XFAILs triaged.

#### R-RSP-3 · P2 · `GAME_SURFACES` registry is manual and already wrong — deals/cast/dossier/headshot unregistered while the in-file comment claims deals/cast are scanned; no ratchet for new windows
- **Evidence:** `responsive_matrix.py:297-317` vs `orwellDeals.js:21`, `orwellCast.js:326`,
  `orwellDossier.js:24`, `orwellHeadshot.js:16`; crowding runs with the phone drawer
  closed (:464,:490,:524); `a11y_matrix.py:380` imports the same registry.
- **Impact:** sub-floor fonts/overflows in four live gadgets ship green at every viewport;
  chyron cards (#1830) + wipeout reel (#1831) will land unregistered by default.
- **Fix:** derive the registry from the DOM (or a unit ratchet diffing it against the
  window-kit id census); add a drawer-open full-sweep sub-pass.
- **DoR** — [ ] pick derive-vs-ratchet. **AC** — [ ] all live `orwell-*` surfaces
  registered or explicitly allowlisted out; ratchet fails on an unregistered new window.
  **DoD** — [ ] AC met; matrices green/XFAIL-triaged in CI.

#### R-RSP-4 · P2 · Casting flow (headshot studio + choose-character) has zero rendered coverage at any viewport post-golden-decommission
- **Evidence:** `responsive_matrix.py:167-175` (stage starts past casting);
  `orwellHeadshot.js:16,545-561`; its own R1 comment (:46-48) records a previously-fixed
  narrow-tier bug — the class is now unguarded; the 0108/0113 fixture that covered
  casting visually was decommissioned 2026-07-21.
- **Impact:** the Day-1 mobile funnel (0111 is in flight) can regress with zero CI signal.
- **Fix:** fail-soft matrix sub-pass mounting the headshot studio via its own seam at
  phone tiers (mirror `mount_face_grid_card`'s engine-independent pattern).
- **DoR** — [ ] seam confirmed. **AC** — [ ] headshot + choose-character measured at
  320/390/desktop. **DoD** — [ ] AC met; in CI.

#### R-RSP-5 · P3 · Mobile sidebar drawer never opened by any sweep; `CHROME["sidebar"]` dead; docstring over-claims
- **Evidence:** `responsive_matrix.py:21,309,315-317,350`.
- **Fix:** one drawer-open sub-pass per coarse tier (reuse `_close_drawer` isolation).
- **DoR** — [ ] none. **AC** — [ ] drawer-open state swept for overflow/tap/crowding on
  coarse tiers. **DoD** — [ ] AC met; in CI.

#### R-RSP-6 · Issue #1877 · P2 · Hover-only folder-delete is an invisible-but-tappable 44px destructive control on touch; folder rename is dblclick-only; the gate is structurally blind to the class
- **Evidence:** `style.css:1717-1723` (no `hover:none` fallback; contrast the correct
  pattern at :1411) · `responsive-tokens.css:71-79` (coarse floor inflates it to 44×44) ·
  `sessions.js:801-843` (tap routes to delete-folder-and-all-sessions confirm; rename
  dblclick-only) · `responsive_matrix.py:511` (touch sweep drops `opacity===0` elements).
- **Impact:** undiscoverable, accidentally-hittable destructive affordance on every touch
  device; folder management near-undiscoverable on touch.
- **Fix:** mirror the :1411 `hover:none` fallback; surface folder ops in the manage
  library; teach the gate to FLAG interactive elements that are opacity-0 outside
  `:hover` instead of skipping them.
- **DoR** — [ ] decide reveal opacity. **AC** — [ ] folder delete visibly revealed on
  coarse pointers; a touch-reachable rename path exists; gate flags the class. **DoD** —
  [ ] AC met; FE suite + matrices green.

#### R-RSP-7 · P3 · `.tap-exempt` waiver is one-sided: the compensating ≥44px `::after` hit region is asserted by nothing
- **Evidence:** `responsive_matrix.py:508` (wholesale skip) · `orwellWindow.js:303-322`
  (the compensation) · `models.js:653` (already an uncompensated user).
- **Fix:** for visible `.tap-exempt` controls assert `::after` ≥ 44px (or a parent
  hit-provider) instead of skipping.
- **DoR** — [ ] none. **AC** — [ ] deleting the `::after` rule turns the gate red; the
  `models.js:653` case is compensated or re-classed. **DoD** — [ ] AC met; in CI.

#### R-RSP-8 · P2 · Keyboard avoidance is half-dead: `--vh` has zero consumers; `--composer-clearance` reads `window.innerHeight` (stale under the iOS soft keyboard) — with the binding decision sheet anchored on it
- **Evidence:** `chat.js:5457-5463` (sets `--vh`; repo-wide grep: no `var(--vh` consumer) ·
  `init.js:170-201` (clearance from `innerHeight`, no visualViewport listener) · consumers:
  `orwellFinale.js:162`, `style.css:2064,5800` · the correct pattern exists in-tree
  (`orwellSheet.js:64`, `orwellWindow.js:582`). LATENT (iOS-class; Android masks it).
- **Impact:** iPhone with keyboard open and a binding decision armed: the sheet's Confirm
  can sit under the keyboard; the fab floats mid-keyboard.
- **Fix:** drive `_syncComposerClearance` from visualViewport resize/scroll
  (min(innerHeight, vv.height)); wire `--vh` to a consumer or delete the dead setter;
  CDP keyboard-shrink sub-pass (pairs with R-RSP-2).
- **DoR** — [ ] device-verify on iOS (or accept CDP emulation as proxy). **AC** — [ ]
  clearance token tracks visualViewport; sheet/fab stay above the keyboard under CDP
  shrink; no dead `--vh` seam. **DoD** — [ ] AC met; FE suite + matrix sub-pass green.

---

### Lane: vault — Vault-Wall adversarial audit (7 findings; **1 P0, 5 P1**)

*Lane cleared as safe: orchestrator fault ring, sandboxHealth, sync ledger/belt telemetry,
chyron ballot anonymization (E12), retrospective terminal gate, producerVault quarantine,
0112 TraceRecord. The findings below are the paths that did NOT hold.*

#### R-VLT-1 · Issue #1865 · **P0** · The standard "Vault-free" debug bundle + admin LLM/engine I/O log rings expose hidden-layer content without the producerVault unseal gate

- **Evidence:** `frontend/src/llm_trace.py:342-358` (`record_llm_call` stores FULL request
  messages + response + reasoning; on by default per `admin_health_routes.py:1949`) ·
  `llm_core.py:2568-2583` (narration chokepoint records the full game system prompt) ·
  `GameSessionAdapter.ts:10377-10391` + `momentPrompts.ts:1374-1391` (that prompt carries
  per-present-NPC hidden knows/suspects — ADR-0019 Layer 2) ·
  `orwell_cast_authoring.py:52-94` (0058 "secret bible" completions — secrets/trueGoals/
  weakness — recorded to the same trace) · `admin_health_routes.py:759-800,1067,1216-1218`
  (the `llmIo` section ships in the STANDARD bundle whose meta self-describes "vault-free
  export") · `:1896-1915` (admin log viewer serves the same rings behind `require_admin`
  only, which short-circuits under `AUTH_ENABLED=false`) · `orwell_engine.py:282-295` +
  `log_rings.py:105-125` (`record_io` copies args+result of EVERY player-channel tool —
  npcVoice knows/suspects, skeleton content, manifests — into the admin-readable io ring).
- **Impact:** an operator downloading the standard bundle — designed to be casually
  shared — or opening the status-page log viewer reads NPC secrets, scheme targets, and
  hidden knowledge without touching the sanctioned unseal. An effective third Vault door,
  violating mandate #2 ("admin is walled from the Vault too").
- **Fix direction:** seal prompt/completion content for game call classes by default
  (metrics + redacted content; full content only behind `require_vault_reveal`, exactly
  like producerVault); strip result payloads from `record_io` for hidden-content tools.
  Adversarial test: standard bundle + every admin log source contains no NPC-secret
  string from a seeded game.

**DoR** — [ ] enumerate the sealed call-class list (narration, cast-authoring, off-screen
voicing, zeitgeist) and the hidden-content tool list for `record_io`.
**AC** — [ ] standard bundle + `?source=llmio|io` log streams contain no Vault-derived
string from a seeded game (adversarial fixture proves it); [ ] full content readable ONLY
behind the explicit unseal affordance.
**DoD** — [ ] AC met; the adversarial test is a permanent gate; FE suite green.

#### R-VLT-2 · Issue #1867 · P1 · Game-build "Production notes" accordion shows the model's reasoning to the player — but since ADR-0019 Layer 2 the model RECEIVES secret state; the ruling's safety premise is falsified

- **Evidence:** `chat.js:2254-2283` (the 2026-06-20 ruling comment: "the model receives no
  secret state so showing it is safe") vs `GameSessionAdapter.ts:10386-10391` +
  `momentPrompts.ts:1374-1391` (every narration prompt now carries presentKnowledge);
  knowledge/presence walls guard only the reply (`agent_loop.py:4732-4763`);
  `roundReasoningText` renders unscrubbed (`chat.js:1746,2285-2309`).
- **Impact:** one click in normal play can show the player hidden NPC knowledge and the
  wall's own mechanics. (T0-5/F3 cover reasoning in the BUBBLE; T0-4 pushes reasoning
  INTO this accordion — concentrating the exposure.)
- **Fix direction:** game build defaults hide-thinking ON (reasoning = explicit operator
  opt-in), or route accordion content through the knowledge/presence walls; update the
  stale premise comment; FE test pins it.

**DoR** — [ ] owner call: hide-by-default vs wall-screened accordion.
**AC** — [ ] game-build reasoning is hidden or wall-screened; premise comment updated.
**DoD** — [ ] AC met; FE test green; FE suite green.

#### R-VLT-3 · Issue #1868 · P1 · Gateway turns bypass the knowledge wall, presence wall, and the untagged inline-planning scrub — while receiving the same secret-bearing prompt

- **Evidence:** `gateway/handler.py:117-133` (builds from `getMomentPrompt` incl.
  presentKnowledge), `:77-80` (only outbound filter is `scrub_for_platform`) ·
  `gateway/scrub.py:24-33` (tag-based regex only — cannot match GLM's untagged inline
  planning, the F3 class) · zero gateway calls to `screen_knowledge_wall` /
  `screen_presence_wall` (they live only in `agent_loop.py:4732-4763,6905,7073`) ·
  `handler.py:176-182` relies on prompt wording — the pattern CLAUDE.md bans.
- **Impact:** every multi-platform turn runs with ADR-0019 enforcement reduced to Layer 1
  + prompt wording; sealed-content recitals and inline debugger monologues are
  deliverable verbatim to Telegram.
- **Fix direction:** run gateway replies through both walls (owner-keyed,
  transport-agnostic) + port the inline-planning scrub into `scrub_for_platform`; test: a
  reply staging a non-holder reciting a sealed fact is dropped.

**DoR** — [ ] confirm wall APIs are callable from the gateway context (no request-scoped
deps). **AC** — [ ] gateway replies pass through knowledge + presence walls + the
inline-planning scrub; the staged-recital test drops. **DoD** — [ ] AC met; gateway
tests green; FE suite green.

#### R-VLT-4 · Issue #1869 · P1 · `getOffscreenSceneSkeletons` returns hidden off-screen event content on the player channel — later content enrichments silently widened the "participants and nature only" projection

- **Evidence:** `registry.ts:76` (description: "public participant ids, room, and nature
  only") vs `GameSessionAdapter.ts:10656-10673` (`templateContent = textureOverrides ??
  ev.content` — raw hidden content) which now carries: B50 hidden-element reveal detail
  (`offscreen.ts:408`), the PV1 player-subject clause built from the hidden NPC→player
  edge (`offscreen.ts:119-128,424` — "sizes up <player> as a threat they need gone"), and
  the #1767 scheme-target clause (`offscreen.ts:158-162,438`; ON in deploy). The boundary
  test only asserts no raw float (`offscreenTextureBoundary.test.ts:59-66`).
- **Impact:** a player-channel tool hands out who is scheming against whom and an NPC's
  private read of the player, with no pathway — and the io ring copies it every tick.
- **Fix direction:** skeleton read returns the base slug (or nature+participants only);
  move the clause-bearing brief to an engine-internal voicer seam; harden the boundary
  test to seed PV1/B50/scheme-target scenes and assert no clause leaks; reconcile the
  registry/port docs.

**DoR** — [ ] decide slug-only vs nature+participants shape. **AC** — [ ] player-channel
skeleton read contains no player-read/target/hidden-element clause (seeded adversarial
test); docs match implementation. **DoD** — [ ] AC met; engine gates green.

#### R-VLT-5 · Issue #1870 · P1 · `knowledgeScopeManifest` ships the living house's secret-fact manifest (content + who-knows-what) over the ordinary player channel — producerVault-lite without the unseal

- **Evidence:** `registry.ts:40` (player channel, in `toolsFor`; `INFRA_LEVERS:199-202`
  only hides it from the model's manifest) · `GameSessionAdapter.ts:2210-2255` (for EVERY
  living holder, every distinctive fact incl. NPC-only secrets, humanized content +
  holder names) · fetched per turn (`chat_helpers.py:3016-3019`) and copied into the
  admin io ring (`orwell_engine.py:282-295`). Contrast producerVault's quarantine:
  out-of-band, never in `toolsFor`, explicit unseal.
- **Impact:** any caller with the player token can dump a live who-knows-what manifest of
  the house's secret layer; the io-ring copy makes it a persistent admin spoiler feed.
- **Fix direction:** move the manifest (and the widened `sealedFromHouse` read)
  out-of-band like producerVault (server-internal fetch not in `toolsFor`); exempt its
  payload from `record_io` content capture; test: the player channel's advertised tools
  can never return a fact whose knownTo excludes the player.

**DoR** — [ ] pick the out-of-band transport (internal route vs registry side-channel).
**AC** — [ ] the manifest is unreachable via the advertised player tool list; Layer-3
still functions; io ring holds name+timing only. **DoD** — [ ] AC met; adversarial test
permanent; engine + FE gates green.

#### R-VLT-6 · Issue #1871 · P1 · `npcVoice` hidden knows/suspects stream to the player's browser (SSE `tool_output`) and persist in chat metadata — suppression is a client-side rendering convention

- **Evidence:** `tool_implementations.py:5442-5445` (returns full NpcVoiceView incl.
  knows/suspects) · `agent_loop.py:9098` (every tool result emitted as a `tool_output`
  SSE event, `output[:2000]`) + `:9156-9162` (persisted into message `tool_events`,
  returned by resume/history APIs) · only suppression: `orwellToolBeats.js:114-116`
  (silent-beat RENDERING set) · metadata rides into the bundle's chatStore section.
- **Impact:** per-NPC hidden knowledge is delivered to the player's client on every
  npcVoice call and persists in their session data — DevTools or any client bug spoils
  the season; enforcement "by presentation" is the banned anti-pattern.
- **Fix direction:** server-side, for game-build silent-class engine reads emit a marker
  `tool_output` (name + ok only) and persist `tool_events` without the payload; FE test
  asserts stream + metadata contain no knows/suspects content.

**DoR** — [ ] enumerate the silent-class tool list server-side. **AC** — [ ] SSE stream
and persisted metadata for an npcVoice turn carry no hidden content; model behavior
unchanged. **DoD** — [ ] AC met; FE test permanent; FE suite green.

#### R-VLT-7 · Issue #1872 · P2 · The knowledge-wall guard fails open silently: a manifest fetch failure leaves the wall empty for the TTL window with only debug-level logging

- **Evidence:** `chat_helpers.py:3010-3019` (per-source failures → `logger.debug`),
  `:3030-3033` (total failure → `facts=[]` cached for the TTL → wall returns text
  verbatim), `:3161-3163`; no `record_soft_failure`/RED event on any path (contrast the
  #1599 convention); the failsoft allowlist grandfather (`failsoft_allowlist.yaml:125-131`)
  predates the wall.
- **Fix direction:** RED-eligible `record_soft_failure('knowledge-wall:manifest-fetch-failed')`
  + WARNING; hold last-known-good facts past the TTL instead of caching empty; test pins
  both.

**DoR** — [ ] none. **AC** — [ ] a fetch failure preserves prior facts and reaches the
RED rollup. **DoD** — [ ] AC met; FE suite green.

---

*(Further lanes land below as they complete.)*

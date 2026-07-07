# Road-to-market backlog — waves M0–M4 (2026-07-07)

**What this is.** The consolidated, owner-triaged backlog from the 2026-07-07 FE–BE integration
review session: every actionable item from the screenshot audit
(`docs/audits/2026-07-07-fe-be-integration-gap-review.md`), the faces-in-the-flow idea catalog,
and the market-readiness map — each with a **Definition of Ready** and **Definition of Done**.
Per the queue convention (`docs/IMPLEMENTATION_QUEUE.md` header, 2026-06-23), work is dispatched
from here as **GitHub issues** referencing the M-ids below; this file is the planning source, not
a live work record.

**Owner triage (2026-07-07, binding for this backlog):** the proof system (market item #3) is
**critical** → Wave M0. IP/naming and who-pays (#1/#2) are **owner-parked** (listed at the bottom
with their cheap prep tasks only). Explicitly **excluded by owner call**: demo/trailer (#4),
re-engagement/push (#5), player cost caps (#6), content-tone controls (#7), and everything from
hosted-scale ops through store packaging (#10+). Help/support (#8) is **nice-to-have** → last item
of Wave M4. Excluded items are *not* listed below — this is deliberate scope, not omission.

---

## Global DoR / DoD (apply to every item; per-item lists add only specifics)

**Ready when:**
- The referenced audit finding / idea is read (screenshot evidence named per item lives in the
  audit doc's appendix set), and the item has no unresolved conflict with the standing rulings
  (ADR 0003 the-conversation-is-the-game; the Vault Wall — no number/hidden state ever rendered;
  ADR 0005 never normalize the open set).
- Dependencies (per item) are merged, and any named owner decision inside the item is made.
- The implementer knows which gate lane the change lands in (fe pytest / browser smoke /
  responsive matrix / engine vitest+BDD / CI workflow).

**Done when:**
- The change ships **with its gate** (house rule: a fix without a test that would have caught it
  is not done) and weakens no existing gate (no `-k` subsets, no XFAIL additions without an id).
- `cd frontend && python3 -m pytest tests/` green (FE items) / `npm test` green (engine items);
  UI items attach before/after screenshots to the PR at 1440×900 **and** 390×844.
- Player-facing surfaces prove Vault-freedom where they render game data (a test asserting no
  hidden key/number crosses — the existing casting-leak / redaction gate patterns are templates).
- Docs touched if behavior is documented anywhere (CLAUDE.md FE conventions, INTEGRATION.md,
  features README status).

Sizes: S ≤ ~½ day · M ≈ 1–2 days · L = multi-day. Waves order by leverage; items inside a wave
are parallel unless `Depends` says otherwise.

---

## Wave M0 — finish the proof system (owner: critical; 0108 tail + owed verification)

> **Standing owner decision (2026-07-07, this session):** the production model topology is
> **two-tier** — narration on **GLM 5.2**, utility/background call classes on **Qwen 3.6**
> (locally served in prod; `deepseek/deepseek-v4-flash` as the cloud alternate). The FE's
> existing per-class routing (`default_model` + `utility_model`/`utility_endpoint_id`) carries it
> with zero new code; the golden gate is model-agnostic (fixtures are model-named, keys exclude
> endpoint URLs — a local re-record stays compatible). Qwen 3.6 Flash verified tool-calling clean;
> note it reasons by default (~266 reasoning tokens on a trivial call — ADR-0010 per-class
> reasoning budgets are the lever if utility cost creeps).

### M0-1 · Record + commit the canonical real-model golden fixture — S · **IN PROGRESS (this session)**
Source: 0108 (built, gate dormant). Retargeted by the owner from deepseek-v4-pro to the two-tier
GLM 5.2 + Qwen 3.6 Flash pair; key provided in-session; record run live at time of writing.
- **DoR (met):** key at hand ✓; OpenRouter reachability through the proxy verified ✓; both models
  verified tool-capable ✓; two-tier driver support shipped ✓ (`--model` + `--utility-model`).
- **DoD:** the live run's invariant table reviewed; leak scan clean;
  `frontend/tests/golden/golden_path_glm-5.2.jsonl` committed (mid-write fixtures are never
  committed — the commit IS the gate-arming event); the `golden-path` CI job green on two
  consecutive runs (`--runs 2` digest-equal); **owner:** set the `OPENROUTER_API_KEY` repo secret
  (arms `golden-nightly`) and **rotate the key pasted in chat** after the session.
- **Finding (2026-07-07, first record attempt — fixture invalidated, root-caused, fixes shipped):**
  the first GLM recording was **silently contaminated**: 90 of 251 records carried a stale stub
  model. Forensics (seq stamps are per-process): a **single writer** — the record run itself —
  flipped narration mid-run at seq 144, right after an OpenRouter `502 (200-with-no-JSON-body)`
  at seq 132. Root cause: **`frontend/data` is shared across driver runs** — the persisted
  canonical game-session binding (`data/orwell_game_session.json`) re-bound the walk at game
  start onto a PREVIOUS run's chat session, whose row pins that run's endpoint+model (a stale
  stub endpoint from the audit-era screenshot harness): the **#1086 seam class**, reproduced by
  the harness itself. Structural fixes shipped rather than a one-off cleanup: **format-2
  self-describing fixtures** (leading `meta` line declares the two-tier models; every record
  carries a per-process `writer` stamp), `fixture_integrity_scan` (exactly one writer + no
  record off the declared model set) enforced at **record time and again in the PR replay
  gate**, a driver pre-flight `scrub_stale_state()` (drops the canonical binding, stale
  `golden-path` sessions/endpoints, layout dirt; clears crashed-run port squatters), and
  meta-first `fixture_models()` (the old first-stream heuristic mis-derived two-tier fixtures —
  cast-identity calls stream on the utility tier). Unit gates in `test_0108_golden_path.py`.

### M0-2 · Calibrate invariants I2/I3 against the real belts — S–M
Source: 0108 stub-run findings, now twice-confirmed on real runs pending (I2 opener never fired
headless in any stub cycle; I3 skipped — no headshot beat surfaces headless).
Depends: M0-1 (the GLM run report is the evidence base).
- **DoR:** M0-1's run report at hand; decision noted whether the #967 opener belt is
  client-kicked (if so, the driver emulates the kick) or server-side (if so, its absence is a bug).
- **DoD:** I2 and I3 each either PASS on a real record/replay cycle or are converted into a filed
  issue with the run-report evidence attached; the driver's conditional SKIP for I3 only remains
  if the golden path legitimately has no photo beat under the recorded config.

### M0-5 · Close the residual replay-miss class — M · **OPEN (characterized, instrumented)**
Source: this session's determinism campaign. Four volatility classes are already fixed and
committed (the wall-clock prompt section neutralized key-side; the web-search zeitgeist quiesced;
the off-screen-texture and portrait pipelines quiesced — the ledger-diff finding; the presence
dwell counter neutralized; per-turn + post-create beat-quiesce barriers in the driver). Replay
digest determinism and invariant-vector reproducibility are green; a **residual deterministic R1
miss class remains on the stub fixture** (same misses both runs — a record↔replay divergence, not
a flake).
- **DoR:** the GLM fixture's own `--runs 2` replay result (it either shows the same residual or
  clears it — the stub's compressed pacing may be the trigger); the engine-call ledger
  (`ORWELL_GOLDEN_CALL_LEDGER`) + miss dump (`ORWELL_GOLDEN_DEBUG_DUMP`) diffs from that run.
  **Constraint learned: one driver run at a time — `frontend/data` is shared state** (parallel
  runs cross-clobber model config; two crashes proved it). *Now partially fenced (M0-1 finding):
  the driver pre-flight `scrub_stale_state()` clears cross-run state, and the fixture
  writer/model integrity scan turns any surviving interleave into a hard failure — but the
  shared-data constraint itself stands (a per-run FE data dir is a larger refactor, deliberately
  not taken).*
- **DoD:** replay of the committed real fixture reports **R1 zero misses** on two consecutive
  runs; whatever seam the ledger diff names is fixed with the same discipline as the four above
  (quiesce/neutralize/serialize — never mute); the fix lands with a unit gate in
  `test_0108_golden_path.py`.

### M0-6 · Reconcile the model-tier defaults to the two-tier decision — S (docs + config)
Source: the owner retarget above vs the repo's standing defaults (ADR 0016 names GLM-4.7 +
Seedream; `settings.py` defaults `z-ai/glm-4.7`(chat)/`glm-4.7-flash`(utility); `oobe_reset.py`
resets narrator to `deepseek/deepseek-v4-pro`).
- **DoR:** owner confirms the OOB defaults should BE the two-tier pair (vs merely this
  deployment's settings) — the local-Qwen posture means the OOB cloud default may deliberately
  differ from the owner's own rig.
- **DoD:** ADR 0016 gains an amendment line recording the 2026-07-07 tier decision;
  `settings.py` defaults + `oobe_reset.py` OOB models + the `golden-nightly` model args agree
  with whatever the owner confirms; the settings-wiring source gates updated in the same PR.

### M0-3 · ADR-0008/0012 owed live-LLM two-window re-run + mid-gen-join pin — M
Source: repo's own owed-verification list; market #3 ("prove the real product works").
- **DoR:** real narrator endpoint configured (same lesson-17 recipe as M0-1); the F1–F5 airtight
  bar (`docs/audits/2026-06-27-ship-gate.md`) open beside the run.
- **DoD:** two real windows on one live game verified for F5 parity through a full ceremony
  sequence including a mid-generation join; the mid-gen-join behavior pinned by a test (the owed
  "test pin" from the ADR-0010/0012 residual list); results appended to the ship-gate doc.

### M0-4 · A-S3: stale-409 must not drop a scene's only consequence fold — M (engine)
Source: audit A10 — `recordInteraction → StaleBeatError` fired in an ordinary 40-minute session;
`docs/REFACTOR-ROADMAP.md` A-S3 pulled forward from post-launch.
- **DoR:** repro read (admin error table row); decision on strategy (retry with refreshed
  `beatSeq` vs queue-and-refold) taken from the roadmap's A-S3 sketch.
- **DoD:** a 409'd `recordInteraction` whose scene recorded nothing else re-lands its fold
  (never silently dropped); engine unit test simulating the stale-CAS race; the sync-ledger
  records the recovery; `npm test` green.

---

## Wave M1 — one live truth, zero seams (audit lane A)

### M1-1 · Kill the live double-render race — M · `P1`
Source: audit A1 (`s-b5`/`s-b6`; one completion → two bubbles, one persisted row; intermittent).
- **DoR:** repro conditions noted (first streamed turn after reload on a fresh game); the #873
  harness (`frontend/scripts/_capture_873_dedup.py`) understood as the instrumentation template.
- **DoD:** root cause identified in the live-stream × session-sync append seam (`chat.js` round
  buffers / `sessionSync.js`) and fixed by convergence key, not content-equality; the #873
  harness grows a live-turns-after-reload scenario failing on any frame with two same-content
  `.msg-ai`; runs in `fe-browser-tests`.

### M1-2 · Time-of-day re-applies on game creation — S · `P1` · ✅ DONE (ac4fc5c)
*Shipped 2026-07-07. Root cause was sharper than the audit's guess: the deferred per-turn apply
existed but its `not user` guard skipped anonymous single-tenant play (AUTH off ⇒ user None)
forever. Fixed at three seams (framed-turn lazy apply now covers user=None via the anon→default
mapping; the new-game ops door applies on season start; the boot log demotes the expected
pre-game miss). Gate: `tests/test_m1_2_time_of_day_reapply.py`.*
Source: audit A2 (`app.py:1097` boot-only apply; "no active game" at boot ⇒ clock dark all season).
- **DoD:** `set_time_of_day(get_setting("time_of_day_enabled"))` re-fires on successful
  `new-game`/`createCharacter` (the same seam that kicks the pre-warm tasks); a pytest proving a
  game created *after* FE boot reports `timeOfDay` in state; the fe.log failure line demoted to
  info on the pre-game path (it is expected there).

### M1-3 · Board renders on beatSeq change; ceremony beats kick the rail — S–M · `P2`
Source: audit A3 (goodbye card announcing an eviction beside a board still reading "HOH
Competition · 16/16").
- **DoR:** decision: keep the 20–30s poll cadence but render on `beatSeq` delta + pass the chat
  tool-result's `beatSeq` through the existing `orwellGameChanged` seam (no new dispatcher —
  g15 rule holds).
- **DoD:** a bound ceremony beat refreshes the board within one event tick (not one poll);
  `test_g15_gamechanged.py` still proves exactly one dispatcher; a new gate asserts the board's
  phase label can never lag a committed pending kind by more than one poll interval in the
  mirror-drive harness.

### M1-4 · Decision card: nothing clipped, Confirm always reachable — S · `P1` (mobile) · **IN PROGRESS**
*Anatomy findings (2026-07-07): the double roster is the ENGINE's pending prompt ("Still in with
you: …") + the FE's structured `pending.stillIn` field both rendering — fix FE-side by eliding the
prompt's templated roster sentence only when the structured field renders (fallback: untouched
prose); the clipped helper is `.odec-hint` (flex-basis:100%, order:99) at the card's bottom edge;
mobile Confirm-below-fold needs the PROSE region (`.odec-prompt`/`.odec-stillin`) to scroll
internally on small viewports while `.odec-opts` + the confirm row stay visible. The card already
has three host modes (kit notice card / anchored sheet / bare fallback) — the fix must hold in all
three.*
Source: audit A4 (`s-b9` clipped helper line; `m-1` Confirm below the fold, double roster).
- **DoR:** decision (default yes): option chips instead of comma prose on coarse pointers.
- **DoD:** card prose scrolls internally; option row + confirm row always visible at 1440×900
  and 390×844; the duplicated "Still in with you / Round 1 — Still in" roster collapsed to one;
  helper line never clipped; `responsive_matrix.py` gains a decision-card-confirm-visible
  assertion (XFAIL registered/removed in the same PR per Stream-S rules); existing C20
  browser-smoke decision block untouched and green.

### M1-5 · Mobile gadget drawer: one opaque sheet, a scrim, zero collisions — M · `P1` (mobile)
Source: audit A5 (`m-3` — translucent layer soup, titles double-exposing, buttons overlapping text).
- **DoD:** on coarse pointers the rail opens as an opaque (or ≥.95 alpha) sheet over a scrim;
  gadget cards opaque within it; one stacking context; `responsive_matrix.py` asserts no two
  gadget-card boxes intersect and no drawer text node sits over chat text in the open-drawer
  state on the phone profile.

### M1-6 · First-run card: own stacking context, docked toast, honest gated CTA — S–M · `P2`
Source: audit A6 (`s-a1` — wordmark/ambient text ghosting through the card, toast over the ×,
primary CTA disabled 30+s with no cue).
- **DoD:** nothing renders through the modal; the "producers are getting the house ready" toast
  docks below the titlebar; the gated CTA shows progress ("Casting the house — N of 16…") and
  fail-opens to enabled with the deterministic floor after a bounded wait; browser-smoke
  onboarding block extended to assert the CTA is enabled-or-progressing within the bound.

### M1-7 · Season reset: overlay banner + season divider — M · `P2`
Source: audit A7 (`t-3` — "technical moment" slab reflows the app; dead season's transcript under
the new casting interview; session titled "Casting interview" forever).
- **DoR:** owner-consistent choice confirmed in-PR: archive-behind-divider vs fresh session per
  season (recommend divider + fresh session titled by season, keeping the sanctioned single
  restart door untouched).
- **DoD:** the degraded banner (`orwellEngineStatus.js`) overlays without reflow; after a
  confirmed reset the old transcript is archived behind a "Season N ended" divider (or a fresh
  session starts) with the casting interview starting clean; a pytest covering the reset →
  casting transcript state; no second restart path introduced (D1/R1 rule).

### M1-8 · Silence the stream_status 404 poll — S · `P3` · ✅ DONE (90175e9)
*Shipped 2026-07-07 server-side: idle answers 200 `{"status":"idle"}`; both sessions.js consumers
already branch on `status !== 'streaming'` (the F-8 probe-once client fix stands). Gate:
`tests/test_m1_8_stream_status_idle.py`.*
Source: audit A8 (`sessions.js:2258/2311`).
- **DoD:** polling a session with no live stream returns 200-empty or the client gates the poll
  on stream presence; zero `stream_status` 404s in the browser-smoke console capture.

### M1-9 · Image-capability honesty — S · `P3` · ✅ DONE (cb78b16)
*Shipped 2026-07-07 as an OUTCOME verdict (design finding: `image_generation_available` is
deliberately permissive — the documented false-negative fix — so honesty lives in the last
completed run: 0-of-N attempted ⇒ failing, surfaced in the cast panel copy, the /roster payload,
and the /admin/status row; all-skipped idempotent re-runs never overwrite a real verdict; a
new-season scrub resets it). Gate: `tests/test_m1_9_portrait_honesty.py`.*
Source: audit A9 (cast panel churns "Generating 16 remaining… (0/16)" with no image provider;
admin says "Image generation AVAILABLE").
- **DoD:** the backfill button and the admin label gate on a real image-capability probe (not
  config presence); without a provider the cast panel says "No portrait model configured —
  Settings → Models" and the admin row reads NOT CONFIGURED; pytest source gate on both labels.

### M1-10 · Utility-call retry backoff — S · `P3`
Source: audit A11 (same-second identical cast-authoring bursts against a bad provider).
- **DoD:** background authoring retries carry exponential backoff + a give-up cap per NPC per
  session; a unit test proving a permanently-failing utility model produces a bounded call count;
  the give-up lands in the G11 failure ring (visible on /admin/status), not silence.

---

## Wave M2 — the first five minutes look like television (audit lane B)

### M2-1 · Cold-open first-run — M · `P1`
Source: audit B1 (`s-a1` — raw model IDs above the fantasy). Depends: M1-6.
- **DoR:** decision: cold-open copy voice (existing diegetic copy is the baseline); model config
  demoted behind a "Production settings" link.
- **DoD:** first screen leads with the show fantasy and one **Enter the house** CTA; model names
  render humanized ("Narrator: GLM-4.7") with raw IDs only inside Production settings; no raw
  provider/model id string anywhere on the first screen (pytest source gate); onboarding
  browser-smoke block updated.

### M2-2 · Designed monogram portrait system + role badges — M–L · `P1` (the leverage item)
Source: audit B3 (`s-d1` flat letter-rectangles); prerequisite for M3-* faces work.
- **DoR:** one designed template (archetype-tinted gradient + pattern + typography) approved via
  a static mock in the PR; badge set fixed (HOH crown / nominee target / veto / evicted / winner).
- **DoD:** every placeholder portrait renders the designed monogram (deterministic per
  houseguest id — seeded hue/pattern); role badges composite on any portrait (generated or
  monogram); "IN THE HOUSE" caption only renders when status ≠ default; cast window, rail chips,
  and decision cards consume the same component; browser-smoke asserts monograms render with
  zero image provider configured.

### M2-3 · Premiere cast strip + pre-HOH board reframe — M · `P1`
Source: audit B2 (`s-b1` — empty premiere, `HOH — / Noms — / Veto —`). Depends: M2-2.
- **DoD:** premiere shows the sixteen-tile strip lighting up with the met-progress gate (0/15 →
  15/15), clicking a tile scrolls/focuses the chat (never replaces it — ADR 0003); pre-HOH the
  dead board rows read "First HOH tonight" instead of em-dashes; strip disappears (or docks)
  after the first HOH; Vault-free proof (tiles render only roster/met/public-status data).

### M2-4 · One verb set across the entry journey — S · `P2`
Source: audit B9 ("Start casting" / "Choose Your Character" / "Meet the house").
- **DoD:** one naming line (casting → premiere → play) applied across onboarding card, chat gate
  card, and premiere card; pytest source gate pinning the copy set so it can't re-diverge.

### M2-5 · Narrator identity + production-slate beat styling — M · `P2`
Source: audit B4/B7 (bubbles "Orwell", beats "· ✔ 📺 PRODUCTION done", fiction "Big Brother").
- **DoR:** owner picks the transcript author name (recommend the diegetic show voice; "Orwell"
  stays product chrome). *(Note: final naming may be revisited by parked item P-1 — implement as
  a single constant so the rebrand is one-line.)*
- **DoD:** assistant bubbles carry the chosen diegetic author; tool beats render as production
  slates (aligned rail, styled label, no lowercase "done" debug tail); beat labels stay sourced
  from `orwellToolBeats.js` (single registry); browser-smoke label checks updated.

### M2-6 · In-world timestamps on beats — S–M · `P2`
Source: audit B5 (wall-clock "12:35 PM" inside the fiction). Depends: M1-2 (clock live).
- **DoD:** transcript messages stamp the game moment ("Week 1 · Eviction Night · Late night")
  with the real clock demoted to hover/metadata; pre-game (casting) keeps neutral stamps; render
  contract test for the stamp source; no engine change (the moment is already in state).

### M2-7 · Rename the reasoning surface diegeticly — S · `P3`
Source: audit B8 ("View thinking process"; Settings "Show <think> collapsible bars").
- **DoD:** accordion label + settings copy renamed ("Production notes" family), admin surfaces
  keep the technical wording; the P1 owner ruling (collapsed-by-default, debug-viewable, scrubbed
  public reply) untouched — the existing browser-smoke thinking-split block still green.

### M2-8 · Curate the game build's theme list — S · `P3`
Source: audit B6 (`r-11` — "GPT", "claude", "organs", "cute" inside the fantasy).
- **DoD:** game build's "Show all themes" lists only the curated on-brand set (core six +
  approved extras); Customize stays for power users; dropped themes remain available outside the
  game build; pytest source gate on the game-build theme allowlist.

### M2-9 · Idle send button stops announcing "New chat" — S · `P3`
Source: audit B10 (`aria-label="New chat"` on the composer's primary control in idle mode).
- **DoD:** the send control's accessible name reflects its action in every mode; the session
  guard's New-Chat protection unaffected; a11y assertion added to the browser smoke.

---

## Wave M3 — faces in the flow (idea catalog 1–6)

### M3-1 · The room strip — S · `P1`
Source: idea 1 (presence chips above the composer from `whereabouts.present`). Depends: M2-2.
- **DoD:** a slim strip of portrait chips for the player's current room, dimming on exit, 🌙 on
  turned-in, role badges via M2-2; updates on the existing poll + `orwell:gamechanged` (no new
  dispatcher); collapses gracefully pre-game and on narrow viewports (responsive matrix case);
  Vault-free proof (renders only the whereabouts projection); ADR 0003 note in-PR (augments, no
  click-to-act beyond M3-6's dossier door).

### M3-2 · Speaker-attributed dialogue (the microformat) — M–L · `P1`
Source: idea 2 (the deepest version of the owner's faces idea). Depends: M2-2.
- **DoR:** microformat decided (recommend inverting the existing `npc:<id>` scrub: a sanctioned
  well-formed speaker tag renders as a face chip; malformed still scrubs); **five-place FE wiring
  rule acknowledged** — the prompt change and FE render land in the SAME PR (the c13 lever-drift
  lesson, three occurrences now).
- **DoD:** narration quoting an NPC shows their chip in the bubble gutter beside the line;
  absent/malformed tags fail open to today's plain prose (render-contract test driving
  `markdown.js` with tagged, untagged, and malformed fixtures); `test_c13_lever_drift` green;
  the game-build scrub still redacts raw ids (existing gate); golden fixture regenerated in the
  same PR if the narrator prompt changed (0108 rule).

### M3-3 · One-on-one scene header — M · `P2`
Source: idea 3 (DM-style header when a scene is you + one houseguest). Depends: M2-2, M3-1.
- **DoD:** when `whereabouts` (or the auto-record `withIds`) resolves a two-person scene, the
  chat header morphs to portrait + name + public status, dissolving on room change; never blocks
  or replaces chat input (ADR 0003); Vault-free proof; browser-smoke state-transition check.

### M3-4 · Faces on decisions — S · `P1`
Source: idea 4 + audit's text-only eviction vote. Depends: M2-2, pairs with M1-4.
- **DoD:** nominee/vote/houseguests-choice options render as portrait buttons (monogram
  fallback); the finale jury reveal rows carry faces; pick-count/binding semantics byte-identical
  (C20 gates untouched); responsive matrix covers the face-button grid on the phone profile.

### M3-5 · The player's own face — S · `P2`
Source: idea 5 (headshot exists; the player is the only faceless person in the house).
- **DoD:** the casting headshot/avatar renders on "You" bubbles and the board's You row (initial
  monogram fallback); no layout shift when absent; screenshot pair in PR.

### M3-6 · Every face is a door — S · `P2`
Source: idea 6 (one interaction rule). Depends: M4-1 (dossier exists), M3-1/M3-4/M3-5.
- **DoD:** every portrait chip anywhere (strip, cards, cast window, slates) click-opens that
  houseguest's dossier; one shared handler; keyboard-operable with an accessible name; asserted
  once in the browser smoke over a representative chip in each surface.

---

## Wave M4 — surface the invisible game (audit lane C + ideas 7–16)

### M4-1 · Houseguest dossier view — M · `P1`
Source: audit C4 + idea 12 (cast tiles are dead ends; witnessed-behavior ledger).
- **DoR:** content contract fixed: public persona + met/last-seen + **witnessed** history beats
  + public alliances/deals with the player — facts and sources ONLY, never a weight/number
  (Vault Wall; the player forms their own reads).
- **DoD:** cast-window tiles (and M3-6 chips) open the dossier window (OrwellWindow kit — F-3
  ratchet); every rendered line traces to the player's witness set or public projection, proven
  by a leak test templated on the casting-leak gate; empty states designed ("You haven't crossed
  paths yet"); paging replaced by a full grid in the cast window (audit C4's 2×2 dots finding).

### M4-2 · The Memory Wall (knowledge journal) — L · `P1` (the flagship)
Source: audit C1 (`getVisibleStateFor`/`sealedFromHouse`/confidences have no surface).
Depends: M4-1 (shares the fact-rendering component).
- **DoR:** projection audit first: confirm the engine's knowledge read returns fact + pathway +
  (qualitative) confidence per entry Vault-free; any gap becomes an engine-side spec item BEFORE
  FE work starts.
- **DoD:** a kit window listing what the player knows, grouped by houseguest/week, each fact with
  its pathway ("Deja told you, Week 2 — secondhand"); distorted beliefs render as *beliefs*
  (source + qualitative confidence), never truth-flagged; zero numbers; the leak gate proves the
  whole window renders only player-held knowledge; sidebar entry beside Cast; recall parity
  sanity check (journal content survives reload/restart — the 0007 non-degradation promise made
  visible).

### M4-3 · Recap affordance — S · `P2`
Source: audit C2 (`dailyRecap`/`seasonRecap` are model-called silent beats; players can't ask).
- **DoR:** ADR-0003 shape confirmed: the affordance *asks the narrator* (a prefilled prose turn
  "Previously, in the house…"), never renders engine text directly.
- **DoD:** a rail entry/composer chip sends the recap request through the normal chat path; the
  model's recap lands as narration (dailyRecap stays a silent beat); works pre-noms and
  post-eviction; discoverability copy in the house handbook (M4-4); browser-smoke click-through.

### M4-4 · The house handbook + first chat hints — S · `P2`
Source: audit C3 + idea 14 (fifty verbs, zero discoverability; `OrwellChatHint` ships empty).
- **DoR:** the verb list drawn from `PLAYER_TOOLS`' player-meaningful subset (deals, alliances,
  confide, confront, trade/expose secrets, turn in, ask the producers, self-eviction), written
  as diegetic prose — no tool names.
- **DoD:** a one-page handbook window reachable from the premiere card + sidebar; 3–5 contextual
  hints registered in the existing `OrwellChatHint` registry (e.g. first lull → "you could pull
  someone aside"), each dismissible and once-only; hints keep the empty-registry default OFF the
  non-game build; pytest for hint registry gating.

### M4-5 · Casting file gadget — S · `P2`
Source: audit C5 (0050 status exists engine-side; the interview flies blind).
- **DoD:** during casting the rail shows the file (Name ✓ · Backstory … · Motivation … ·
  Headshot …) straight from the casting-status projection; it disappears at season start;
  fail-open when the engine is down; leak test (casting card only, no derived stats).

### M4-6 · Ceremony slates — M · `P1`
Source: idea 7 (closed-set beats render as designed full-width cards). Depends: M2-2, M2-5.
- **DoR:** slate set fixed (HOH win / nominations / veto win / veto ceremony / eviction result /
  week roll), each rendered FROM ENGINE TRUTH (the tool-result/beat payload), never parsed from
  prose (ADR 0005 closed-set rule).
- **DoD:** each beat inserts a slate card into the transcript (portrait, name, role line) beside
  the model's narration; slates render identically on reload from persisted state; F1 parity
  (mirror window shows the same slate — extend the mirror harness assertion); Vault-free proof;
  reduced-motion respected.

### M4-7 · Episode title cards — S · `P3`
Source: idea 8. Depends: M4-6 (shares the slate component), M2-6.
- **DoD:** week/day transitions render a title slate ("EPISODE 4 — *The Backdoor*"); the title is
  one utility-model call, fail-open to "Day N" (no model ⇒ plain); never blocks the transition.

### M4-8 · Point scene stills at the big beats — S · `P3` (config-gated)
Source: idea 10 (0051 image beats exist). Depends: M4-6.
- **DoD:** with an image provider configured, HOH/eviction slates request one still via the
  existing `recordImageBeat` budget-capped path, composed under the slate; zero-provider install
  renders slates without gaps; budget caps (`imageConstants.ts`) respected — no new spend class.

### M4-9 · Deals & alliances board, verified and first-class — S–M · `P2`
Source: audit C7 + idea 13 (`state.deals` ships; mid-season rendering unverified).
- **DoR:** one real-model mid-season pass (piggyback M0-3's live session) confirming what
  `orwellDeals.js` renders when deals/alliances actually exist — findings recorded before scoping.
- **DoD:** the gadget shows deals you shook on (with duration — 0104 deal-duration data) and
  named alliances you're in (0107 projection), each expiring/dissolving visibly; nothing beyond
  the public/party-to projection (leak test); rail registry row per the kit contract.

### M4-10 · Endgame sequence instead of a window pile — M · `P2`
Source: audit C7/endgame (`r-6` — retrospective + season-complete + photo studio stacked scrimless).
- **DoD:** post-finale surfaces open as a sequence (finale board → retrospective → next-season
  hand-off), each dismissible, one at a time, kit-modal stacking rules obeyed (#870 invariants);
  browser-smoke asserts no two post-finale windows overlap on auto-open.

### M4-11 · Episodic retrospective — M · `P3`
Source: audit C6 (`r-6` — the 0048 payoff as ~40 uniform bullets). Depends: M4-10.
- **DoD:** the retrospective groups by week with headline beats first (blindsides, flipped votes,
  goodbye tones) and vote-by-vote detail behind expanders; unsealing scope unchanged (post-finale
  gate only — 0048's code-gated path untouched); Vault-unseal legitimacy test still green.

### M4-12 · Board polish: You-row, Last out, Nightfall dupe — S · `P3`
Source: audit C8 (`r-3` — cue collision "· running on empty You vote tonight", "Last out —"
through an eviction, moon+word repeated).
- **DoD:** You-row cues separate cleanly at every width (matrix case); "Last out" names the
  evictee from the beat that commits it (or the row hides untilweek 2 if that's the engine
  contract — verified, not assumed); Nightfall card title/body de-duplicated.

### M4-13 · Shareable episode card export — M · `P3`
Source: idea 15. Depends: M4-7 (title), M2-2 (portraits).
- **DoR:** owner OK on the export composition (title, three beats, portraits, season branding) —
  note P-1 naming dependency for any wordmark on the card.
- **DoD:** "Save episode card" renders the recap into a downloadable image entirely client-side
  (no external service — content stays local); the card contains only player-known facts (leak
  test over the composition input); export works with monogram portraits.

### M4-14 · Season poster — S · `P3`
Source: idea 16. Depends: M4-13 (shares the compositor), M4-10.
- **DoD:** post-finale, the retrospective opens under a composed season poster (winner + cast +
  weeks); downloadable via the M4-13 path; monogram-complete without an image provider.

### M4-15 · Player help + in-app problem report — S · `P3` (owner: nice-to-have)
Source: market #8. Depends: M4-4 (handbook is the "how to play" half).
- **DoD:** a "Report a problem" entry (settings + engine-degraded banner) posts a player note to
  the existing `POST /api/orwell/fe-report` ring with the current session id attached — admin
  sees it on /admin/status beside the G11 failures; no new backend surface; rate-limited
  client-side like the ring; copy names where the operator reads it.

---

## Parked (owner-owned decisions — not scheduled; cheap prep only)

### P-1 · IP / naming (Big Brother vocabulary + the "Orwell" collision) — OWNER
Prep task available on request: a vocabulary inventory sweep (every trademark-adjacent string
across prompts, FE copy, theme names, docs) sizing the rebrand before the decision. M2-5
deliberately isolates the transcript author name behind one constant for this reason.

### P-2 · Who pays for inference (BYOK vs hosted) + unit economics — OWNER
Prep task available on request: the cost-per-season instrument — a read-only harness over the
0069 token ledger emitting $/season for N real seasons. No product change; feeds the pricing
decision whenever taken. *(Partially fed by M0-1: the GLM 5.2 + Qwen record run produces the
first real cost-per-week number from the token ledger; the owner's local-Qwen posture drops the
utility tier's marginal cost to ~zero in production.)*

---

*Excluded by owner triage (2026-07-07): demo/trailer, re-engagement/push, player cost caps,
content-tone controls, hosted-scale ops (Postgres tier, billing, telemetry, cloud backup,
monitoring), a11y conformance statement, i18n declaration, store packaging. Revisit only on an
explicit owner call — none of these blocks the waves above.*

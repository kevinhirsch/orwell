# DOC/SPEC/README-DRIFT reconciliation — findings

Lane: doc-drift reconciliation (CLAUDE.md, docs/features/README.md, docs/IMPLEMENTATION_QUEUE.md,
docs/audits/2026-06-27-ship-gate.md, docs/decisions/*, cucumber.cjs) vs actual source-code reality.
Method: every claim below was cross-checked against source files, git log/commit timestamps, and
(where relevant) live GitHub issue state — not re-derived from other docs.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| DOC-1 | Blocker | <1hr | High | Ship-gate's #1 release-blocker gate (F5) claim is itself the *correct* one — but the docs that should corroborate it (features/README.md, ADR-0015) still say the fix is unmerged and the gate is RED, when it merged with "gate green" | `docs/features/README.md:239`, `docs/decisions/0015-*.md:136,187`, commits `d5643cf0`/`bb2c3076`/`14d071c1` |
| DOC-2 | Blocker | <1hr | High | 0080 "Active overseer" mislabeled 📝 spec-only — fully built + tested | `docs/features/README.md:148`, `frontend/src/agent_loop.py:5067-5290`, `frontend/tests/test_0080_active_overseer.py`, `test_0080_overseer_mode_dispatch.py` |
| DOC-3 | Blocker | <1hr | High | CLAUDE.md's "0087–0104 and 0107 ... mostly spec-only" claim (3×) is false | `CLAUDE.md:20-21,45-48,533-535` |
| DOC-4 | Blocker | <1hr | High | 0093 (secrets-as-levers) mislabeled — fully built + BDD-gated | `docs/features/README.md:159`, `src/surfaces/tools/registry.ts:56`, `cucumber.cjs`, `features/step_definitions/secrets_as_power.steps.ts` |
| DOC-5 | Blocker | <1hr | High | 0099 (secrets-as-currency) mislabeled — fully built + BDD-gated | `docs/features/README.md:165`, `registry.ts:57`, `cucumber.cjs`, `secrets_as_currency.steps.ts` |
| DOC-6 | Major | <1hr | High | 0109 (deal-duration) mislabeled — fully built + BDD-gated | `docs/features/README.md:175`, `src/engine/deals.ts`, `domain/deal.ts`, `cucumber.cjs`, `deal_duration.steps.ts` |
| DOC-7 | Blocker | <1hr | High | Number collision: two specs both numbered 0102; the unbuilt-but-PO-resolved "Day-1 experience" one is entirely absent from the README index | `docs/features/0102-day-1-experience.md`, `0102-weekly-recap-cliffhanger.md`, `docs/features/README.md:168` |
| DOC-8 | Major | <1hr | Med-High | Number collision: two specs both numbered 0107; "LLM-call observability" is entirely absent from the README index | `docs/features/0107-llm-call-observability.md`, `0107-named-alliances.md`, `docs/features/README.md:173` |
| DOC-9 | Major | <1hr | High | Ship-gate PARKED bucket cites #905-909 as "awaiting owner rulings" — the owner ruled on them the same day | `docs/audits/2026-06-27-ship-gate.md:141-143`, `docs/decisions/PO-DECISIONS-LOG.md:61-68`, GitHub #875 |
| DOC-10 | Minor | <1hr | Med | Issue-tracker hygiene: #862/#880 still OPEN though the code is fully merged | GitHub issues #862, #880; `registry.ts:56-57` |
| DOC-11 | Major | <1hr | Med-High | IMPLEMENTATION_QUEUE.md self-contradicts: top banner says lanes are DONE; the D1-D11 section header below still says OPEN | `docs/IMPLEMENTATION_QUEUE.md:6-16`, `:2496` |
| DOC-12 | Minor | <1day | Med | Same file: Lane G tail (G1-G14) carries stale OPEN/QUEUED tags; G15 verified done despite "QUEUED" | `docs/IMPLEMENTATION_QUEUE.md:3071-3179` |
| DOC-13 | Major | <1hr | Med-High | CLAUDE.md's ADR table caps at 0014; ADRs 0015/0016 (0016 governs the live narrator model) are omitted | `CLAUDE.md:70`, `docs/decisions/README.md` |
| DOC-14 | Major | <1hr | Med | CLAUDE.md repeatedly says "the spec set runs to 0107" (3×) — actual ceiling is 0109 | `CLAUDE.md:20,45,533` |
| DOC-15 | Minor | <1hr | Low-Med | README status-legend omits the 🟢/❄️ tokens used in 8+ rows | `docs/features/README.md:46-51` vs rows 159,163-165,168,169,175 |
| DOC-16 | Polish | <1hr | Low | README row 0088 has Gate/Status columns transposed | `docs/features/README.md:154` |
| DOC-17 | Minor | <1hr | Med | README 0075 row's "Fast-follow" TODO note is stale — already merged | `docs/features/README.md:143`, PR #1088 |
| DOC-18 | Minor | <1hr | Med | README 0076 row's BDD-deferral rationale is stale — its blocker (0077) already shipped | `docs/features/README.md:144-145` |
| DOC-19 | Minor | <1hr | Low | README's 2026-06-20 "index health" callout is presented as current but is stale for 46 later features | `docs/features/README.md:56-63` |
| DOC-20 | Minor | <1hr | Med | ADR 0012 is the only ADR still tagged bare "Proposed" while downstream docs treat it as shipped | `docs/decisions/README.md` ADR 0012 row |
| DOC-21 | Minor | <1hr | Low-Med | CLAUDE.md cites a 2026-06-21 open-items snapshot as authoritative; it predates and omits the entire 0075-0109 batch | `CLAUDE.md` "Current status" section; `docs/audits/2026-06-21-open-items-verification.md` |
| DOC-22 | Polish | <1hr | Low | Four "Built" features (0029/0033/0036/0053) carry drafted `.feature` files never wired into `cucumber.cjs` | `docs/features/0029-*.feature`, `0033-*.feature`, `0036-*.feature`, `0053-*.feature`; `cucumber.cjs` |

---

## Full findings

```
[DOC-1] [Severity: Blocker] [Effort: <1hr] [Value: High]
The #1 release-blocker gate (ship-gate F5) has three contradicting docs on the SAME DAY, and the
resolution matters for launch confidence
- Where: docs/audits/2026-06-27-ship-gate.md line 39 ("F5 ... ✅ PASS ... window B mirrored A's
  live deepseek stream in lockstep, lag ~0s") vs docs/features/README.md:239 ("Currently RED on
  main ... flips green when R2 unifies the live render path") vs docs/decisions/
  0015-collapse-duplicated-live-render-paths.md:136,187 ("It XPASSes the moment R2 lands" / "The
  harness gate flips RED → green when R2 lands"). Commit timeline (all 2026-06-27): d5643cf0
  22:56 "docs(adr-0015): record the streaming-parity render-path collapse + F5 BDD" (writes the
  "RED"/xfail language into README+ADR) → bb2c3076 23:26 "feat(R2): unify the two-window live
  chat render path" → 14d071c1 23:30 "merge(R2): unify two-window live render path onto
  createStreamRenderer (gate green)" → 577287e8 23:34 adds a MIRROR_LIVE real-provider harness
  mode. `frontend/tests/test_0012_mirror.py` (559 lines) now contains ZERO occurrences of "xfail"
  — the tripwire described in the docs has been removed. `chat.js`'s `resumeStream` now calls
  `createStreamRenderer` (the unified path) directly (lines ~4443-4544). features/README.md's
  last touch is 2026-06-29 — two days AFTER R2 merged — yet its F5 section still reads as if R2
  never landed.
- Problem: the doc that should be the reconciled cross-check (features/README.md) and the ADR
  that defines the acceptance criterion (0015) both describe the single most safety-critical
  launch gate (per the vision brief: "the #1 release blocker") as unresolved/RED, two days after
  the code merged with a commit message declaring "gate green" and the test's xfail tripwire was
  removed. Anyone reading README (the doc CLAUDE.md calls "reconciled against the source") would
  believe F5 is still broken and either (a) block launch unnecessarily re-litigating a fixed
  problem, or (b) — worse — distrust the ship-gate's PASS claim entirely, undermining confidence
  in the one document meant to be the launch-acceptance bar. It's also possible the "gate green"
  self-report in the merge commit is itself optimistic and the doc is right — this needs a human
  to just RUN `run_mirror_gate.sh` once and settle it; right now three docs disagree.
- Fix: run `docs/audits/playtest-harness/mirror_live_parity.mjs` via `run_mirror_gate.sh` once,
  confirm PASS/FAIL, then update BOTH docs/features/README.md:225-241 and
  docs/decisions/0015-collapse-duplicated-live-render-paths.md's status/testability section to
  match reality (strike the "Currently RED" / "XPASSes" language if it passes; if it still fails,
  correct the ship-gate's "✅ PASS" claim and the merge commit's "(gate green)" self-report).
  Wire the harness into CI per ADR-0015's own stated intent ("becomes a required CI gate") so this
  can't drift again.

[DOC-2] [Severity: Blocker] [Effort: <1hr] [Value: High]
0080 "Active overseer" is labeled spec-only in the authoritative feature index, but it's built and tested
- Where: docs/features/README.md:148 — "0080 | ... | spec-only | 📝 Spec · scoping; owner
  rulings open ... Design note + provisional .feature; not in cucumber.cjs." Actual code:
  `frontend/src/agent_loop.py:5067-5290` (a substantial, commented "0080 ACTIVE OVERSEER — the
  reasoning tier as the PRIMARY actor at the stall junction (Model D: primary + floor)" block,
  fail-soft, gated on `overseer_mode()=="active"`, dispatching through `src/overseer.py`'s
  `Signals`/`should_assess`/`LlmOverseer`/`DeterministicOverseer`); `frontend/src/settings.py:265-270`
  (the `overseer_mode` off/shadow/active dial, persisted); two dedicated test files —
  `frontend/tests/test_0080_active_overseer.py` and `test_0080_overseer_mode_dispatch.py`.
- Problem: this is the SAME failure mode as 0093/0099/0109 (finding a built feature under a
  "spec-only" label) but on a feature CLAUDE.md's own coarse summary happens to sweep into "built"
  (the "0075-0086 ... runtime overseer 0079-0081" line) — meaning the two documents disagree with
  each other AND one of them is simply wrong. Per this audit's source-check, README is the wrong
  one here: 0080 is live production code that runs on every stalled turn when the operator flips
  the dial, not a design note. This particular mislabel is especially dangerous because the
  README is the doc CLAUDE.md tells every reader to trust MORE than its own prose ("Trust the
  code over this prose" / "docs/features/README.md — the per-feature status index, reconciled
  against the source") — so this is the "trusted" source itself failing the reconciliation it
  claims to have done.
- Fix: update docs/features/README.md row 0080 to ✅ Built (note the Model-D/primary-plus-floor
  architecture, the off/shadow/active dial, and the two test files as the gate), and audit whether
  any OTHER "spec-only"/"frozen" row in 0087-0109 has a similar FE-only implementation this pass's
  engine-side-only grep missed (this pass checked `frontend/tests/` for 0094-0098/0101-0103/0107
  and found none — but 0080 shows the failure mode exists, so a full `frontend/src` grep per
  remaining "spec-only" row is warranted before trusting any of them).

[DOC-3] [Severity: Blocker] [Effort: <1hr] [Value: High]
CLAUDE.md's headline spec-ceiling claim is false: "0087–0104 and 0107 ... mostly spec-only"
- Where: CLAUDE.md lines 20-21, 45-48, and 533-535 (three separate occurrences of the same
  claim). Cross-checked against docs/features/README.md's own per-row status AND against source:
  of the ~18 numbers in that band, at least 11 are ✅ Built (0087 relationship trajectories,
  0088 living current read, 0089 reactive confessionals, 0090 per-archetype voice, 0091 trigger
  secrets, 0092 secret-pacing drip, 0093 secrets-as-levers [DOC-4], 0099 secrets-as-currency
  [DOC-5], 0100 jury grudge book, 0104 season notoriety, 0107 named alliances) — each with a
  real `src/engine/*.ts` module confirmed present (trajectory.ts, secretPacing.ts, triggers.ts,
  notoriety.ts, juryHouse.ts, voice.ts, alliances.ts all exist in `src/engine/`). Only 8 of the
  18 (0094-0098, 0101, 0102, 0103) are genuinely unbuilt/frozen.
- Problem: this is the exact drift the charter flagged and it sits in the FIRST file every agent
  or engineer reads before touching the codebase. "Mostly spec-only" reads as "don't expect much
  here" — which is precisely how a shipped, BDD-gated, player-facing mechanic (secrets-as-power,
  named alliances, jury grudge book, season notoriety) goes unfound/unmentioned in later work,
  matching the charter's framing exactly ("a wrong map is why finished features ship dark").
- Fix: replace all three occurrences with the accurate split: "0087-0093, 0099-0100, 0104-0107,
  0109 are built; 0094-0098, 0101-0103 remain spec-only/frozen (Producer's-Vault ideas parked or
  awaiting a build slot); 0108 is spec-only (the real-model gate)." Point to
  docs/features/README.md's index as the single source of truth rather than restating a coarse
  range in CLAUDE.md at all (ranges rot; a link doesn't).

[DOC-4] [Severity: Blocker] [Effort: <1hr] [Value: High]
0093 (secrets-as-levers) is fully built and BDD-gated but labeled "not in cucumber.cjs"
- Where: docs/features/README.md:159 — "🟢 PO REVIEW RESOLVED ... Design note + .feature (not in
  cucumber.cjs)." Actual: `cucumber.cjs` DOES list `"docs/features/0093-secrets-as-levers.feature"`
  (10 scenarios); `src/surfaces/tools/registry.ts:56` defines the live player tool `exposeSecret`
  with a full description of the seeded standing-hit/backlash mechanic including a `bluff` path;
  the four-place FE-write-back pattern is complete across `src/ports/GameSession.ts`,
  `src/adapters/engine/GameSessionAdapter.ts`, `registry.ts`, and `src/adapters/mcp/McpServer.ts`;
  step definitions exist at `features/step_definitions/secrets_as_power.steps.ts`.
- Problem: a fully shipped, player-reachable strategic mechanic ("turn a learned secret into
  leverage or an expose") is described as an unbuilt design note. This is a High-value,
  High-confidence mislabel — exactly the "wrong 'spec-only' label on a shippable retention
  feature" the charter calls out by name.
- Fix: update the row to ✅ Built, cite the registry.ts tool descriptions + step defs as the gate,
  and remove the "(not in cucumber.cjs)" clause.

[DOC-5] [Severity: Blocker] [Effort: <1hr] [Value: High]
0099 (secrets-as-currency) — identical mislabel to DOC-4
- Where: docs/features/README.md:165 — same "not in cucumber.cjs" claim. Actual:
  `cucumber.cjs` lists `"docs/features/0099-secrets-as-currency.feature"` (11 scenarios);
  `registry.ts:57` defines the live `tradeSecret` tool (values a secret to the recipient,
  resolves accept/reject, supports the same `bluff` path); step defs at
  `features/step_definitions/secrets_as_currency.steps.ts`.
- Problem: same as DOC-4 — a built, BDD-gated mechanic reads as a design note.
- Fix: same as DOC-4, for the 0099 row.

[DOC-6] [Severity: Major] [Effort: <1hr] [Value: High]
0109 (negotiated deal duration) mislabeled the same way
- Where: docs/features/README.md:175 — "🟢 SPEC (2026-06-27) — BUILD-READY ... Design note (not
  in cucumber.cjs)." Actual: `cucumber.cjs` lists `"docs/features/0109-deal-duration.feature"`
  (5 scenarios); `expiresWeek`/`vague` are implemented in `src/engine/deals.ts`,
  `src/domain/deal.ts`, and `src/engine/relationshipConstants.ts`; step defs exist at
  `features/step_definitions/deal_duration.steps.ts`.
- Problem: same failure mode a third time — this specific feature (betrayal-shock scaling with
  remaining deal life) is one of the more emotionally load-bearing additions in the whole batch
  ("when do you turn on an ally?") and is invisible to anyone trusting the index.
- Fix: same as DOC-4/5.

[DOC-7] [Severity: Blocker] [Effort: <1hr] [Value: High]
Spec number 0102 is used TWICE for two unrelated specs; the index only shows one, and it's the LESS-resolved one
- Where: `docs/features/0102-day-1-experience.md` + `.feature` (git history: `f83bca05
  "docs(0102): the Day-1 experience spec"`, dated after `73f10fba "spec(0102): weekly recap +
  cliffhanger"` — the number was reused) vs `docs/features/0102-weekly-recap-cliffhanger.md` +
  `.feature`. docs/features/README.md:168 lists ONLY the weekly-recap-cliffhanger row under "0102".
  The day-1-experience spec — despite being explicitly "PO REVIEW RESOLVED (owner, 2026-06-27) —
  BUILD-READY" per its own header, and despite its own text calling it "the highest-leverage
  retention surface in the product" — has NO row in the index at all.
- Problem: this is precisely "0102-day-1 build-ready but absent [from the index]" that the
  charter named as a known symptom. A build-ready, PO-approved, retention-critical spec is
  structurally invisible to anyone scanning docs/features/README.md — the exact mechanism by
  which finished (or in this case ready-to-build) work "ships dark." Confirmed still unbuilt via
  source grep (no "needle"/"discover-don't-declare"/champagne-circle-premiere code found) and via
  live GitHub: issue #875 (the umbrella) is still `state: open` as of 2026-06-27T21:21:28Z.
- Fix: rename one of the two files (recommend renumbering `0102-day-1-experience` to the next
  free slot, e.g. 0110, since it is the newer/actively-referenced one per the 2026-06-27
  PO-DECISIONS-LOG entry — OR rename `0102-weekly-recap-cliffhanger` since PO-DECISIONS-LOG
  already says its "filename is now a misnomer — rename to daily recap" for unrelated reasons,
  see DOC-9's sibling note). Either way, add BOTH specs as separate rows in the README index.

[DOC-8] [Severity: Major] [Effort: <1hr] [Value: Med-High]
Spec number 0107 is used TWICE; the index shows only the built one, orphaning the unbuilt one
- Where: `docs/features/0107-llm-call-observability.md` + `.feature` (git: `2126000e
  "docs(spec): 0107 — LLM-call observability"`, PR #1032, docs-only, never built — confirmed via
  source grep: no `TraceSink`/`TraceRecord`/`observability_enabled` anywhere in `frontend/src` or
  `frontend/routes`) vs `docs/features/0107-named-alliances.md` (built Phase A+B — `git log`:
  `3199fa2b`/`8f4395d5`/`6573ce7f`/`4e7f1480`; `src/engine/alliances.ts` exists;
  `formAlliance`/`joinAlliance` are live player tools in `registry.ts:53-54`). Only the
  named-alliances spec appears in docs/features/README.md:173 as "0107"; the observability spec
  has zero index presence.
- Problem: lower player-facing value than DOC-7 (observability is an ops feature), but it's the
  SAME structural bug — a spec silently vanishes from the map because its number got reused by a
  parallel work stream, and `CLAUDE.md`'s own "spec set runs to 0107" line (see DOC-14) doesn't
  even specify WHICH 0107 it means. If this pattern isn't caught structurally, it will recur.
- Fix: renumber `0107-llm-call-observability` to the next free number (0110+) since
  `0107-named-alliances` is the one built and load-bearing; add a row for the observability spec
  once renumbered. Consider a lightweight CI check (a script asserting no two `docs/features/NNNN-*`
  files share a prefix) so a THIRD collision doesn't happen silently again.

[DOC-9] [Severity: Major] [Effort: <1hr] [Value: High]
Ship-gate's PARKED bucket describes a resolved decision as "awaiting owner rulings"
- Where: `docs/audits/2026-06-27-ship-gate.md:141-143` — "PARKED ... the casting-reframe feats +
  PO-questions (#905–909 / #916–918 — these are design proposals awaiting owner rulings)." Same
  date, `docs/decisions/PO-DECISIONS-LOG.md`'s "## 2026-06-27" entry (lines 12-15, 61-68) opens
  with "PO-review board cleared — all nine flagged specs resolved this session" and gives four
  explicit rulings (R1-R4) for exactly #905-909, folded into `docs/features/0102-day-1-experience.md`
  which itself states "🟢 PO REVIEW RESOLVED (owner, 2026-06-27) — BUILD-READY." Verified live via
  GitHub: issue #875 (updated_at 2026-06-27T21:21:28Z) is still open, but its state is "spec
  written and build-ready, not yet implemented" — not "no ruling yet."
- Problem: the ship-gate document's own triage rubric says PARKED items "need a product decision
  ... do not spend agents until decided." If read at face value, this line tells a future agent
  or the owner that #905-909 is blocked on a decision that has, in fact, already been made and
  written down in the SAME day's PO log — risking either (a) needlessly re-litigating settled
  design questions, or (b) never noticing the spec is build-ready and available to dispatch.
- Fix: move #905-909 from PARKED to POST-LAUNCH (or a new "designed, not yet built" bucket) in
  the ship-gate triage, citing `docs/features/0102-day-1-experience.md` + the PO-DECISIONS-LOG
  ruling instead of "awaiting owner rulings." Leave #916-918 in PARKED only if independently
  confirmed still unruled (this pass did not find them referenced anywhere else in the repo).

[DOC-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
GitHub issue tracker itself is stale relative to shipped code (cross-territory flag)
- Where: GitHub issues #862 (0093 secrets-as-levers) and #880 (0099 secrets-as-currency) are
  BOTH still `state: open` (confirmed via `mcp__github__issue_read`), despite the underlying
  mechanics being fully merged into `main` (registry.ts `exposeSecret`/`tradeSecret`, BDD-gated
  per DOC-4/DOC-5).
- Problem: not a markdown-doc issue, but the SAME drift reaching a different source of truth. Any
  audit lane, or the overseer itself, that uses "open GitHub issues" as a proxy for "what's still
  unbuilt" will be misled the same way docs/features/README.md misled this lane before source
  verification. Flagging for the orchestrator since other lanes may lean on issue state.
- Fix: close #862 and #880 with a reference to the merging PRs (per the git log: alliance/secrets
  PRs). Consider a lightweight rule: a spec's `.md` header status flip to "Built" should be
  the trigger to close its tracking issue(s), not a separate manual step.

[DOC-11] [Severity: Major] [Effort: <1hr] [Value: Med-High]
docs/IMPLEMENTATION_QUEUE.md contradicts itself about whether D1-D11 is done
- Where: lines 6-16 (a 2026-06-23-dated banner) state "this file is a historical work record (the
  B/C/D/U/L lanes are ✅ DONE)." Line 2496, ~2500 lines further down, is the section header for
  those very D-lane items: "## UI & runtime audit batch (D1–D11) · 2026-06-10 (round 4) — OPEN" —
  and every one of D1 through D11 (lines 2502-2547) lacks a "✅ DONE" marker, unlike every other
  section in the file. Spot-verified in source: D1 ("one sanctioned season-restart door") is
  actually implemented — `src/composition/orchestrator.ts:134` (`forgetUser`) +
  `src/composition/registry.ts:786` (`resetUser`) — matching CLAUDE.md's own architecture section
  description of this exact mechanism as shipped ("There is ONE sanctioned season-restart door").
- Problem: this is the "live work queue" file (per its own header: "Dispatch these to implementer
  agents in order"). A document that asserts its own completion status inconsistently is
  dangerous in both directions — it could cause an agent to re-dispatch D1-D11 as if unstarted
  (wasted work, or worse, a second competing implementation of "the one sanctioned restart door"),
  or cause a human skimming only the OPEN-tagged section to believe real work remains when it
  doesn't.
- Fix: retroactively mark D1-D11 with "✅ DONE" + a verifying artifact citation (the same
  convention every other completed section in the file uses), since the underlying work is
  confirmed shipped. If any D-item is NOT actually done, flag it explicitly rather than leaving
  the ambiguous bare "OPEN" state.

[DOC-12] [Severity: Minor] [Effort: <1day] [Value: Med]
Same file: Lane G's tail (G1-G15) carries unverified/stale OPEN, QUEUED, and "AWAITING PRODUCT
VERDICT" tags
- Where: `docs/IMPLEMENTATION_QUEUE.md:3078-3179` — G1 ("Health & Logs"), G2 (launcher restore),
  G3 (sidebar padding), G5 (refresh-persistence audit), G6 (settings left rail), G8 (casting
  finalization outage-look) all "OPEN"; G7 ("fold The House into the sidebar") "AWAITING PRODUCT
  VERDICT"; G10-G14 "QUEUED." Spot-verified G15 ("event-driven freshness: orwell:gamechanged
  dispatch sweep") IS done — `frontend/tests/test_g15_gamechanged.py` exists and CLAUDE.md's own
  "Front-end client conventions" section describes the single-dispatcher mechanism as a current,
  load-bearing invariant ("orwell:gamechanged has exactly ONE dispatcher... enforced by
  `test_g15_gamechanged.py`"), yet G15's own line still reads "QUEUED (wave 2)."
- Problem: same risk class as DOC-11, narrower scope. This pass did not verify G1-G4/G6/G8/G10-G14
  individually (out of budget) — flagging for a dedicated sweep rather than asserting they're all
  done. G7's "AWAITING PRODUCT VERDICT" may be a genuinely still-open product question (the House
  sidebar-vs-floating-window redundancy) and should be checked against the current FE, not assumed
  either way.
- Fix: run a fresh pass over G1-G14 specifically (grep the FE for each item's described mechanism,
  same method as this finding), mark each DONE/STILL-OPEN with an artifact citation, and correct
  G15's tag immediately (it is definitely done).

[DOC-13] [Severity: Major] [Effort: <1hr] [Value: Med-High]
CLAUDE.md's ADR table stops at 0014; ADRs 0015 and 0016 exist, are Accepted, and 0016 governs a
currently load-bearing decision
- Where: `CLAUDE.md:70` — "Decision records (ADRs 0001–0014)" lists only 0001-0014.
  `docs/decisions/README.md` and the directory listing show ADR 0015 ("Collapse the duplicated
  live-vs-mirror chat render paths," Accepted 2026-06-27 — see DOC-1) and ADR 0016 ("LLM model
  selection — GLM-4.7 narrator... Seedream portraits," Accepted 2026-06-29, PO direction) both
  exist. ADR 0016 is not a paper decision — commit `1c6e8895 "ADR 0016: GLM-4.7 narrator
  (reasoning-low) + GLM-4.7-Flash utility + narrator reasoning control (#1151)"` and
  `6affae1f "feat(model): default narration model deepseek-v4-pro → z-ai/glm-4.7"` are both on
  `main` — i.e., the CURRENT default narrator model is a decision this un-cited ADR governs. The
  vision brief (a sibling audit document, `scratchpad/audit/VISION_BRIEF.md` C1) already cites
  "ADR 0016 (GLM-4.7)" as a load-bearing contradiction to probe, so other audit lanes are relying
  on an ADR that CLAUDE.md's own table doesn't list.
- Problem: a reader following CLAUDE.md's own pointer ("`docs/decisions/` | Decision records (ADRs
  0001–0014)") would not know the two most recent, currently-operative architecture decisions
  exist at all — including the one that changed the default narrator model out from under
  DeepSeek-V4-Pro (a fact several other parts of CLAUDE.md's own prose still assume, e.g. the ship
  gate references "real DeepSeek-V4-Pro" runs).
- Fix: extend CLAUDE.md's ADR table/prose to "ADRs 0001–0016" and add one-line summaries for 0015
  and 0016 matching the existing style.

[DOC-14] [Severity: Major] [Effort: <1hr] [Value: Med]
CLAUDE.md's "the spec set runs to 0107" is stale — actual ceiling is 0109
- Where: `CLAUDE.md:20` ("Specs now run through 0107"), `:45` ("through 0107"), `:533` ("the spec
  set runs to 0107"). `docs/features/` contains `0108-real-model-golden-path-gate.md/.feature`
  (spec-only) and `0109-deal-duration.md/.feature` (✅ Built, see DOC-6) — both postdate every
  0107 reference in CLAUDE.md, and `git log` shows nothing past 0109 as of HEAD.
- Problem: minor precision drift, but compounds DOC-3/DOC-8's confusion — CLAUDE.md doesn't even
  acknowledge two more numbers exist, one of which (0109) is fully built.
- Fix: bump all three occurrences to "0109" and fold DOC-6's correction in at the same time.

[DOC-15] [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
docs/features/README.md's status legend doesn't define the tokens it uses
- Where: the "Status legend" table (`docs/features/README.md:41-51`) defines only ✅/🚧/📝/⏸.
  The table body uses 🟢 ("PO REVIEW RESOLVED"/"build-ready" — rows 159, 163, 165, 168, 169, 175)
  and ❄️ ("FROZEN — parked, preserved not deleted" — rows 163-164, 169) extensively, with neither
  symbol defined anywhere near the legend.
- Problem: a reader following the documented legend cannot classify roughly 8 rows in the table —
  ironically, several of which (0093/0099/0109) are the SAME rows this audit found to be
  outright mislabeled (DOC-4/5/6), suggesting the newer status vocabulary was invented ad hoc
  without being reconciled into the doc's own stated conventions.
- Fix: add 🟢 ("Build-ready — PO-reviewed and resolved, not yet implemented") and ❄️ ("Frozen —
  reviewed and explicitly parked, not deleted, reopenable") to the legend table.

[DOC-16] [Severity: Polish] [Effort: <1hr] [Value: Low]
README table row for 0088 has its Gate/Status columns transposed
- Where: `docs/features/README.md:154` — "| 0088 | [Living \"current read of you\"]
  (./0088-living-current-read.md) | ✅ built | BDD (Vitest + cucumber + arch) · a living
  per-NPC current read..." Every other row puts a short gate token (BDD/unit/FE/engine/—) in the
  Gate column and an emoji+status prose in the Status column; this row has them swapped (a status
  emoji sits in the Gate column, and gate-description prose leads the Status column).
- Problem: cosmetic, but the table is meant to be machine-scannable (the whole doc's value
  proposition is "the single source of truth" for a quick per-feature check) — a swapped column
  breaks that for anyone parsing it programmatically or scanning columns visually.
- Fix: swap the two cell contents to match every other row's convention.

[DOC-17] [Severity: Minor] [Effort: <1hr] [Value: Med]
README's 0075 row TODO note is stale — the fast-follow already shipped
- Where: `docs/features/README.md:143` — 0075 row ends "...Fast-follow: the FE confide-under-call
  guardrail." Git: `e9a09908 "Merge pull request #1088 ... feat(0075): FE confide under-call
  guardrail (the last 0075 fast-follow)"`, merged 2026-06-26 — ONE DAY BEFORE this same row's own
  cited "passive lie-catch 2026-06-27" update, meaning the row was touched on/after the date the
  fast-follow shipped and the stale TODO wasn't removed.
  `frontend/tests/test_0075_confide_guardrail.py` (227 lines) confirms it's live in
  `frontend/src/agent_loop.py`.
- Problem: reads as outstanding work; a future agent could re-implement an already-shipped
  guardrail, or a reviewer could flag 0075 as "incomplete" incorrectly.
- Fix: delete the "Fast-follow" clause (or change it to "Fast-follow SHIPPED: ... (PR #1088)").

[DOC-18] [Severity: Minor] [Effort: <1hr] [Value: Med]
README's 0076 row justifies missing BDD wiring with a now-false precondition
- Where: `docs/features/README.md:144` — "BDD wiring deferred until the 0077 floor-plan lands."
  `docs/features/0077-house-map-privacy-and-eyeshot.feature` IS built and IS in `cucumber.cjs`
  (confirmed). `docs/features/0076-presence-grounding-and-motivated-movement.feature` has 10
  drafted scenarios and is STILL absent from `cucumber.cjs`.
- Problem: the stated blocking condition resolved, but nobody revisited the decision — 0076 (a
  PR #515 shipped, playtest-relevant fix for "the narrator invents the room") has real unit/FE
  test coverage (`tests/unit/presence.test.ts`, `frontend/tests/test_0076_presence_*.py`) but no
  BDD gate, and the doc's own stated reason to wait no longer applies.
- Fix: either wire `0076-presence-grounding-and-motivated-movement.feature` into `cucumber.cjs`
  now that 0077 has landed, or replace the stale rationale with the real, current reason (if one
  exists) for leaving it BDD-ungated.

[DOC-19] [Severity: Minor] [Effort: <1hr] [Value: Low]
README's "index health" callout is presented as current but is 46 features stale
- Where: `docs/features/README.md:56-63` — "**Audit (2026-06-20).** Every feature 0001–0063 was
  cross-checked against its source artifact (not its prose). No orphaned or untracked unbuilt
  specs." This callout sits directly above the Index table that now runs through 0109 (46 more
  rows added since). None of the collisions (DOC-7/DOC-8) or mislabels (DOC-4/5/6/DOC-2) this
  audit found are covered by — or contradicted by — that 2026-06-20 statement, because they all
  postdate it.
- Problem: a reader skimming the doc sees a confident "no orphaned/untracked specs" reassurance
  immediately before the table and may reasonably (if incorrectly) extend that confidence to the
  whole table, including the parts added after the audit date.
- Fix: either date-scope the callout explicitly ("...through 0063 only; 0064-0109 added since
  have not had an equivalent reconciliation pass — see [this audit] for known gaps") or run a
  fresh equivalent pass covering 0064-0109 and update the callout's date/scope to match.

[DOC-20] [Severity: Minor] [Effort: <1hr] [Value: Med]
ADR 0012 is the only ADR still tagged bare "Proposed" while downstream docs treat it as shipped
- Where: `docs/decisions/README.md` — every ADR row from 0008 onward is annotated "Accepted —
  BUILT" or similar EXCEPT 0012: "Proposed (2026-06-21); the live-stream sibling of 0008..." with
  no Accepted/BUILT marker. Yet: ADR 0015 (Accepted) explicitly frames itself as "the render-layer
  half of 0012," CLAUDE.md's "Front-end client conventions" section states "Two-window realtime
  parity rides on a LIVE canonical-session binding (ADR 0008/0012)" as a present-tense operating
  fact, and the ship-gate's F5 gate (governed by 0012's "Messenger mirror" concept) is reported
  PASS as of 2026-06-27 (see DOC-1 for the complication on that specific claim).
- Problem: an ADR whose own status field says "not yet decided" is being relied on elsewhere as
  settled, shipped architecture — a reader checking ADR status alone would not know whether the
  two-window mirror mechanism is real.
- Fix: update ADR 0012's status field to reflect its actual state (e.g. "Accepted — transport
  half BUILT (0008/0011); render-layer half superseded/completed by ADR 0015" once DOC-1 is
  resolved).

[DOC-21] [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
CLAUDE.md cites a stale open-items snapshot as an authoritative current source
- Where: CLAUDE.md's "Current status" section lists `docs/audits/2026-06-21-open-items-verification.md`
  as one of "the authoritative sources, in order" for status, describing it as "the source-verified,
  tier-organized snapshot of every open item." That file is dated 2026-06-21 and contains ZERO
  mentions of any feature 0075-0109 (confirmed via grep) — i.e., it predates the entire
  Producer's-Vault/PO-review batch this lane audited (dated 2026-06-25 through 2026-06-29).
- Problem: not wrong on its own terms (it was accurate for what it covered), but CLAUDE.md cites
  it without date-scoping the claim, so a reader could reasonably treat it as still comprehensive
  for "every open item" when it's missing over a week of subsequent feature work, including all
  the mislabels this lane found.
- Fix: add a scope note where CLAUDE.md cites this file ("covers work through 2026-06-21; see
  docs/features/README.md for anything after") or commission a follow-up snapshot covering
  0075-0109.

[DOC-22] [Severity: Polish] [Effort: <1hr] [Value: Low]
Four "Built" features carry drafted `.feature` files that were never wired into the BDD runner
- Where: `docs/features/0029-app-admin-and-user-management.feature`,
  `0033-dynamic-player-tagline.feature`, `0036-live-social-surface-approaches-and-diary-room.feature`,
  and `0053-admin-transcripts.feature` all exist as executable Gherkin files, but none appear in
  `cucumber.cjs`'s `paths` array (all four features are correctly marked "FE" or "unit" gated in
  the README, not "BDD" — so this isn't a status mislabel, just dead/orphaned executable-spec
  content).
- Problem: low severity, but these are exactly the kind of artifact that misleads a future author
  into assuming BDD coverage exists ("there's a .feature file, so `npm run test:bdd` must cover
  it") when it silently doesn't and never will under the current gate choice.
- Fix: either wire them into `cucumber.cjs` (if the scenarios are still meaningful and BDD is the
  right gate) or delete them / fold their scenarios into the FE pytest suite's docstrings and note
  in the README row why no `.feature` file is expected, so their absence from `cucumber.cjs`
  reads as intentional rather than an oversight.
```

## Coverage / where this lane looked

- `CLAUDE.md` (full read: header, mandate, architecture, status prose, ADR table, open decisions).
- `docs/features/README.md` (full read, both pages — status legend, full 0001-0109 index,
  amendments table, ship-gate F5 section).
- `docs/features/*.md` for the entire 0087-0109 band (read in full or targeted for: 0087, 0088,
  0089, 0090, 0091, 0092, 0093, 0094-0098 [existence check], 0099, 0100, 0101, 0102 [both files,
  full read of day-1-experience], 0103, 0104, 0105, 0106, 0107 [both files, full read of
  llm-call-observability], 0108, 0109), plus 0075, 0076, 0080 (full read of README rows +
  targeted source verification).
- `docs/IMPLEMENTATION_QUEUE.md` (full 3189-line structure via section-header scan, targeted reads
  of the top banner and the D1-D11/Lane-G tail).
- `docs/audits/2026-06-27-ship-gate.md` (full read, all 147 lines).
- `docs/audits/2026-06-21-open-items-verification.md` (grepped for 0087-0109 band — zero hits,
  confirming its scope).
- `docs/decisions/README.md` + `docs/decisions/0012-*.md` (status field) +
  `docs/decisions/0015-*.md` (full read) + `docs/decisions/PO-DECISIONS-LOG.md` (2026-06-27 and
  2026-06-23 entries).
- `cucumber.cjs` (full read, cross-referenced against every `.feature` file in `docs/features/`).
- Source cross-checks: `src/engine/*.ts` (trajectory, secretPacing, triggers, notoriety,
  juryHouse, voice, alliances, campaigns — existence + spot content), `src/surfaces/tools/registry.ts`
  (exposeSecret/tradeSecret/formAlliance/joinAlliance tool descriptors), `src/composition/
  {orchestrator,registry}.ts` (D1 restart door), `frontend/src/agent_loop.py` (0080 active
  overseer block, 0075 confide guardrail), `frontend/src/settings.py` (overseer_mode),
  `frontend/tests/` (existence checks for 0075/0076/0080 test files; absence checks for
  0094-0098/0101-0103/0107-observability/0102-day1), `frontend/static/js/chat.js`
  (createStreamRenderer/resumeStream unification for DOC-1), `git log` (commit-level evidence for
  nearly every finding — timestamps, PR numbers, merge-base ancestry checks).
- Live GitHub issue state via `mcp__github__issue_read` for #875, #862, #880 (cross-referencing
  doc claims against the actual tracker — DOC-9/DOC-10).

**Not covered / would need more budget:** a full per-row re-verification of docs/features/README.md
for 0001-0074 (spot-checked several via the amendments table and ADR cross-refs, but did not
re-derive each of the 74 earlier rows from source — the 2026-06-20 audit note (DOC-19) plus this
lane's spot checks suggest that range is in better shape than 0075-0109, but it wasn't
exhaustively re-proven here); a full re-sweep of IMPLEMENTATION_QUEUE.md's Lane G items G1-G4,
G6, G7, G8, G10-G14 individually (flagged as DOC-12, budget-limited to spot-checking G1/D1/G15);
SOUL.md was sampled but treated as an intentionally-dated continuity log rather than a
"status source" subject to the same drift standard (it labels its own entries with dates and
self-flags as drifting prose, unlike CLAUDE.md/README's undated blanket claims).

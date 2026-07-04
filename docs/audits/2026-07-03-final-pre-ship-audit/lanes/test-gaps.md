# TEST-COVERAGE BLIND-SPOT AUDIT (lane: test-gaps / agent tag `TCG`)

Territory: `tests/`, `features/`, `frontend/tests/`, `cucumber.cjs`, `vitest.config.ts`,
`.github/workflows/ci.yml`, `docs/features/0108-real-model-golden-path-gate.{md,feature}`,
`docs/REFACTOR-ROADMAP.md`, `docs/audits/2026-06-27-ship-gate.md`, `SOUL.md`, `docs/decisions/0016*`.
Read-only; no suites run; grep-then-narrow throughout.

**Thesis confirmed by direct evidence, not just the ship-gate's own claim:** every engine test
(`tests/unit`, `tests/property`, `tests/uat`, BDD) drives `DeterministicNarrator`/`EchoNarrativePort`
or a fake HTTP transport — grep for `OPENROUTER|real model|deepseek|GLM` inside `tests/` turns up
zero live-model calls, only comments describing *past* manually-discovered incidents that were
hardened into synthetic regression tests. Every FE browser-driven gate (`boot_smoke.py`,
`browser_smoke.py`, `responsive_matrix.py`) hard-codes `AUTH_ENABLED=false` and routes model network
calls through Playwright fakes. The **only** documented real-model validation of the entire
casting→eviction golden path is the **single, manual, unrepeated** 2026-06-27 live-verify run cited
in the ship-gate doc (G1–G9) — there is no automated re-run of it, which is exactly the gap feature
0108 (spec-only, unbuilt) exists to close.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| TCG-1 | Major | <1day | High | Advance stall-nudge ladder is proven only by grepping for source strings, never by a real model that actually ignores the nudge | `frontend/tests/test_orwell_advance_stall_nudge.py`, `frontend/src/agent_loop.py` |
| TCG-2 | Major | <1day | High | The GLM-4.7 `tool_choice`-honoring assumption that the whole forced-call belt (ADR 0016 §D) is built on is explicitly un-verified against a live model | `frontend/tests/test_tool_choice_force.py`, `docs/decisions/0016-llm-model-selection.md` |
| TCG-3 | Major | <1day | High | `_auto_record_scene`'s extraction call is tested only against a hand-scripted well-formed JSON reply, never a real model's classification variance | `frontend/src/agent_loop.py` (`_auto_record_scene`), `frontend/tests/test_0065_backfill_cas.py` |
| TCG-4 | Major | <1day | High | Producers'-opener (#967) and post-photo-resume (#969) tests pin the FE trigger wiring but never assert the model actually opens/resumes when handed the cue | `frontend/tests/test_967_casting_kickoff.py` |
| TCG-5 | Major | <1day | High | The pre-emission / desync outcome guard is regex-matched against a fixed corpus of hand-authored narration strings, never real model phrasing | `frontend/routes/chat_helpers.py` (`_narration_claims_outcome`), `frontend/tests/test_expressive_non_collapse.py` |
| TCG-6 | Minor | <1day | Med | FaithfulnessJudge (0081) is unit-tested with a lambda returning a pre-formed JSON string; a real model's markdown-fenced/off-schema reply shape is untested | `frontend/tests/test_0081_faithfulness_judge.py`, `frontend/src/faithfulness.py` |
| TCG-7 | Minor | <1day | Med-High | The 0080 ACTIVE overseer has never been run end-to-end against any judge (real or scripted-free-text) through the real agent loop | `frontend/tests/test_0080_active_overseer.py`, `frontend/src/agent_loop.py` |
| TCG-8 | Minor | <1day | Med | Cast-authoring richness (≥13/15 deep profiles) is regression-gated only against the ONE historical failure shape (#1067, 9/15) | `tests/unit/castAuthoringCommit.test.ts` |
| TCG-9 | Minor | <1hr | Med | Wrong-nominee / first-name-collision guard is a regex heuristic exercised only with synthetic strings authored by the same engineer who wrote the guard | `frontend/routes/chat_helpers.py:1783-1809` |
| TCG-10 | Major | <1day | High | The reasoning/public-bubble channel split (I9) is tested only against synthetic SSE chunks that already carry a correct `thinking` flag — never a real model's tendency to bleed reasoning-shaped prose into the visible delta | `frontend/static/js/chat.js`, `frontend/tests/test_fs4d_truncation.py` and siblings |
| TCG-11 | Minor | <1hr | Med | `test_orwell_advance_stall_nudge.py` is a textbook stubbed-LLM false-green: it asserts literal strings exist in source, not that the nudge fires/escalates at runtime | `frontend/tests/test_orwell_advance_stall_nudge.py` |
| TCG-12 | Polish | <1hr | Low | `test_l31_premiere_tutorial.py` is pure regex-over-source; its own docstring defers real coverage to browser-smoke, which itself stubs the model | `frontend/tests/test_l31_premiere_tutorial.py` |
| TCG-13 | Minor | <1hr | Med | `test_967_casting_kickoff.py` proves the FE fires the hidden cue, not that the model opens with a producers' line when it receives one | `frontend/tests/test_967_casting_kickoff.py` |
| TCG-14 | Minor | <1hr | Med | `test_0080_active_overseer.py` tests `overseer.py` in isolation with `DeterministicOverseer`; the wiring into `agent_loop.py`'s active dispatch is source-pinned only | `frontend/tests/test_0080_active_overseer.py` |
| TCG-15 | Major | <1day | High | `expressiveNonCollapse` only ever feeds the engine well-formed `consequence.edges[]` values; it can't see BE-101's unvalidated-enum crash/NaN-corruption path a real model would trigger | `tests/unit/expressiveNonCollapse.test.ts`, `src/adapters/mcp/McpServer.ts:70-78` |
| TCG-16 | Minor | <1day | Med | The four-place write-back wiring gotcha (steps 1-2 done, 3-4 missing ⇒ silently dead at runtime) is a repeating, currently-live class — `worldSnapshotView` is the newest instance, and no structural test catches a NEW instance before it's found by hand | `src/ports/GameSession.ts:1699`, `src/adapters/engine/GameSessionAdapter.ts:7005-7017`, CLAUDE.md's own "four-place change" section |
| TCG-17 | Polish | <1day | Low | Heavy sims (`tests/uat/**`, `juryReach`, `calibrationGradient`) are excluded from `test:cov`; a coverage regression whose ONLY exercising path is a heavy sim is invisible to the coverage gate | `vitest.config.ts` (`HEAVY_SIM_FILES`) |
| TCG-18 | Minor | <1day | Med | `src/adapters/engine/**` carries the LOWEST branch-coverage floor (82%) of any gated directory, yet is exactly the directory CLAUDE.md flags as the highest silent-failure-risk class (write-back/beatSeq dispatch) | `vitest.config.ts` thresholds block |
| TCG-19 | Polish | <1hr | Low | `src/main.ts` is coverage-excluded; its env/port/token-resolution branches (`parsePort`, multiuser flag parsing) have zero measured coverage and are asserted nowhere except live boot | `src/main.ts:12-62`, `vitest.config.ts` (`exclude`) |
| TCG-20 | Major | <1day | High | `overseer_mode`/`faithfulness_mode` default to `"off"`; there is no documented run (SOUL.md, ship-gate, any audit) of either in `"active"` against a live model | `frontend/src/settings.py:270,281`, `SOUL.md`, `docs/audits/2026-06-27-ship-gate.md` |
| TCG-21 | Minor | <1day | Med | `ORWELL_STORE=sqlite` (opt-in relational tier, #330) is exercised only by a ~40-line composition smoke test; no heavy sim / UAT / non-degradation gate ever runs a full season under it | `tests/unit/sqliteStoreComposition.test.ts` |
| TCG-22 | Polish | <1hr | Low | `ORWELL_WATCHER_TICK_MS` (opt-in wall-clock watcher) has only env-parsing unit coverage; no integration test drives an actual ticking watcher through a live season | `tests/unit/runtime.test.ts:132` |
| TCG-23 | Major | <1day | High | Every browser-driven E2E gate hard-codes `AUTH_ENABLED=false`; the real multi-user login/session/cross-user-header path is never exercised end-to-end by an actual browser session | `frontend/scripts/boot_smoke.py:51`, `browser_smoke.py:71`, `responsive_matrix.py:95` |
| TCG-24 | Minor | <1day | Med | `ORWELL_ENGINE_MULTIUSER=1` cross-user isolation is unit-tested for header-rejection only; no test drives two concurrent real users' game turns against one live engine process | `src/main.ts:62`, `tests/unit/opsPrivateRepo.test.ts` |
| TCG-25 | Major | <1day | High | Two-window realtime mirror parity (F5, the ship-gate's "#1 release blocker") has exactly one automated CI-shaped gate, and it drives a deterministic FAKE streamed model — the only real-model confirmation is a single unrepeated manual audit | `docs/audits/playtest-harness/mirror_live_parity.mjs`, `docs/audits/2026-06-27-ship-gate.md` (F5 row) |
| TCG-26 | Minor | <1day | Med | Offline/network-drop mid-stream (part of the F3 "offline→online queue+flush" claim) is never simulated with Playwright's real network primitives; the outbox is validated only at the Python function-unit level | `frontend/tests/test_985_p2a_send_queue.py`, `frontend/scripts/browser_smoke.py` (no `set_offline` call anywhere) |
| TCG-27 | Major | <1day | High | An EXISTING test proves (rather than prevents) a mandate-4 violation: a stale-409 during the `_auto_record_scene` E22 fallback backfill silently drops the scene's only consequence fold | `frontend/tests/test_0065_backfill_cas.py::test_e22_fallback_stale_409_is_skipped`, `docs/REFACTOR-ROADMAP.md` (R1c / audit A-S3) |
| TCG-28 | Minor | <1day | Med | No Playwright gate runs two REAL concurrent user sessions (distinct accounts) — every multi-window test is single-tenant (`AUTH_ENABLED=false`) — so I10's "unlimited users concurrently, each fully isolated" has no browser-level regression gate | `frontend/scripts/browser_smoke.py`, `docs/audits/2026-06-27-ship-gate.md` (G9 row: "structurally gated," not browser-gated) |
| TCG-29 | Minor | <1day | Med | Mobile-specific tests (the responsive matrix) run against the same stubbed model path as desktop; no test exercises a real model's variable-length streaming against the mobile keyboard/viewport-height races the responsive lane flags in isolation | `frontend/scripts/responsive_matrix.py:95` |
| TCG-30 | Minor | <1day | Med | `deploy/smoke.sh` / `smoke_turn.py` never drives the actual chat/narration endpoint — it resolves decisions via direct engine tool calls (`/player/call`), so the "one-liner deploy drives a full turn" claim never touches the conversation path | `deploy/smoke_turn.py:22-45` |
| TCG-31 | Major | multi-day | High | Feature 0108 is the structurally right fix, but its scope (as drafted) leaves several of the gaps above uncovered even once built | `docs/features/0108-real-model-golden-path-gate.md` |

---

## FULL FINDINGS

### [TCG-1] [Severity: Major] [Effort: <1day] [Value: High]
The advance stall-nudge escalation ladder is proven by string-grep, not by exercising a model that actually stalls
- Where: `frontend/tests/test_orwell_advance_stall_nudge.py` (all four test functions); the real logic
  lives in `frontend/src/agent_loop.py` (`_ADVANCE_PHASES`, `_PROGRESSION_TOOLS`, `_ADVANCE_NUDGES`,
  `_ADVANCE_STALL_LEVEL`).
- Problem: This is the belt CLAUDE.md itself calls "the #1 playthrough blocker, robust even on strong
  models" — the model narrates a beat and never calls `advanceGame`, freezing the season. The test file
  is candid about its method (it literally reads the source text and `assert`s that specific string
  literals appear, e.g. `assert js.count("# 1 — gentle") == 1`, `assert "STOP. The game is FROZEN" in
  js`). None of the four tests actually DRIVE `stream_agent_loop` with a fake model that omits
  `advanceGame` across three consecutive turns and asserts three escalating nudge messages are
  produced, then a fourth turn recovers. A refactor that renames `_ADVANCE_NUDGES` but keeps the
  runtime behavior intact would fail this test (false negative); a refactor that breaks the escalation
  logic while preserving the string literals would pass it (false positive) — the exact "source-pinned
  convention test" class the charter asked to name concretely. This is precisely the kind of belt whose
  real reliability can only be shown by driving it with a model that plausibly stalls (fixture-replayed
  or live), which is what 0108 would add if its invariant 5 ("no stuck phase") is built to actually
  simulate a stall rather than only replay a run where the model never stalls in the first place.
- Fix: Add a behavioral unit test that drives `stream_agent_loop` (or the narrower nudge-selection
  function directly) with a scripted fake stream that omits `advanceGame`/`submitDecision` for N turns
  in an advance-phase, and assert the actual emitted nudge text escalates through all three rungs and
  then resets on a turn that does call a progression tool. Keep the existing source-pins as a cheap
  smoke layer, but they must not be the ONLY gate on this belt.

### [TCG-2] [Severity: Major] [Effort: <1day] [Value: High]
The entire forced-`tool_choice` belt is built on an explicitly self-admitted, unverified assumption about the new narrator model
- Where: `frontend/tests/test_tool_choice_force.py` (docstring: "the live 'does GLM actually honor the
  forced call' check is OWED separately — these pin the WIRE + the gate"); `docs/decisions/0016-llm-model-selection.md:84` (the design rationale: "GLM-4.7 honoring `tool_choice` unlocks a capability
  DeepSeek V4 blocked").
- Problem: ADR 0016 (accepted 2026-06-29 — four days before the current session's "today") swapped the
  narrator model to GLM-4.7 specifically **because** it is claimed to honor `tool_choice` at
  closed-set beats where "a missed call is catastrophic" (comp resolution, ceremony advance). The test
  file that gates this feature explicitly documents that it stubs the LLM and that the live
  confirmation is "owed separately." A grep of `SOUL.md` and every audit doc for a completed live
  verification of GLM honoring a forced `tool_choice` turns up nothing — only the vendor-claim-shaped
  design rationale in the ADR itself. If the real GLM-4.7 endpoint rejects `tool_choice: "required"`
  the way DeepSeek-V4 did (or silently ignores it and free-text-falls-back, as ADR 0016 says DeepSeek
  does ~40% of the time), the belt this ADR was built to unlock is inert, and — because DeepSeek's
  rejection behavior is HTTP 400 in some providers — a forced call at a comp-resolution beat could even
  hard-fail the turn instead of gracefully degrading. This is the single highest-leverage untested
  assumption in the whole model-selection stack, made days before ship.
- Fix: Before shipping ADR 0016 as the default, run (and keep, as an artifact) at least one live probe
  against the actual `z-ai/glm-4.7` OpenRouter endpoint that sends `tool_choice: "required"` alongside a
  minimal tool schema and confirms a tool call is returned (not a 400, not a free-text fallback). This
  is exactly the shape of check feature 0108's nightly re-record could absorb if the golden-path
  invariants are extended to assert `tool_call_seen: true` at forced beats (see TCG-31).

### [TCG-3] [Severity: Major] [Effort: <1day] [Value: High]
`_auto_record_scene`'s model-classification extraction is tested only against a single hand-authored well-formed reply
- Where: `frontend/src/agent_loop.py` (`_auto_record_scene`, feature 0055); test coverage in
  `frontend/tests/test_0065_backfill_cas.py` (e.g. `fake_llm` returns a fixed
  `'{"withIds":["npc:3"],"kind":"bonding","content":"a bond"}'` string in every test).
- Problem: `_auto_record_scene` is the FE's guarantee that "social play moves the hidden weights" even
  when the narration model skips `recordInteraction` — CLAUDE.md calls this out as a load-bearing
  guardrail against the model's "reliable under-call" of consequence recording. Every test that
  exercises it monkeypatches `llm_call_async` to return a single, syntactically perfect JSON object
  chosen by the test author. There is no test for: the model wrapping the JSON in a markdown code
  fence (a documented failure mode elsewhere in this same codebase — see `test_streaming_empty_
  completion_surface.py`'s existence), the model omitting `withIds`, the model inventing an id not in
  the current house, or the model returning free-text commentary instead of JSON. Because this
  extraction call is itself a narrow, non-conversational LLM call (a good target for constrained
  decoding / a strict schema), its failure mode in production is a silent no-op — the exact "no
  consequence, no memory" cardinal sin CLAUDE.md names as the worst possible failure.
- Fix: Add tests that feed `_auto_record_scene` realistic malformed replies (fenced JSON, missing
  fields, hallucinated ids, plain prose) and assert graceful fail-closed behavior (no crash, no
  phantom event, a countable/loggable miss) rather than only the happy path.

### [TCG-4] [Severity: Major] [Effort: <1day] [Value: High]
The #967 opener and #969 resume tests pin the FE's trigger wiring, never the model's response to being handed the cue
- Where: `frontend/tests/test_967_casting_kickoff.py` (all tests are `_read(...)` + `assert ... in js`
  string checks over `admin.js`/`settings.js`); no equivalent live-model assertion exists for #969
  (post-photo resume) beyond similar wiring pins referenced in `docs/features/0108-real-model-golden-
  path-gate.md`'s own description of these bugs as still only "would have caught... once captured."
- Problem: Both #967 and #969 were ORIGINALLY discovered by a human driving a real model (the FE fired
  the hidden cue correctly and the bug was still user-visible until fixed) — but the regression tests
  that followed only pin that the FE correctly fires the hidden cue. Nothing in the automated suite
  asserts that a model, upon receiving that hidden cue, actually behaves as required (opens without
  restating a question back to the player; resumes narration rather than waiting idle). A future
  prompt change to the cue's wording, or a model swap (see TCG-2 — one just happened), could silently
  reintroduce the exact user-visible symptom #967/#969 originally described while every existing test
  stays green.
- Fix: This is precisely invariants 1-3 of feature 0108 as drafted — prioritize building 0108 (or a
  narrower fixture-replay harness scoped to just casting→premiere) ahead of the broader golden-path
  scope if time is short, since it is the only mechanism that can close this specific, twice-already-
  regressed gap.

### [TCG-5] [Severity: Major] [Effort: <1day] [Value: High]
The desync/pre-emission outcome guard is regex-matched against a fixed, engineer-authored corpus, never real model phrasing
- Where: `frontend/routes/chat_helpers.py` (`_narration_claims_outcome`, the F16-class guard);
  `frontend/tests/test_expressive_non_collapse.py` and the outcome-guard-specific tests referenced in
  `backend-deep.md`'s BE-202/BE-205 findings (same territory, different angle — see cross-territory
  flag below).
- Problem: The guard's job is to catch a model that narrates a vote tally or eviction result before the
  engine has committed it (the exact "genuinely blindsided... it was real, recorded, and fair" promise
  in the vision brief depends on this NEVER happening in reverse — a fabricated result). Its test
  coverage exercises the regex/heuristic against strings the test's author wrote to be either clearly
  inside or clearly outside its jurisdiction. A real model's actual phrasing space is far larger and
  weirder (hedged claims, indirect free-indirect-discourse "she must have won," compound sentences that
  bury the claim mid-clause) — none of which shows up in a synthetic corpus written with the regex
  already in mind. BE-205 (from `backend-deep.md`) independently found the verb list ("leaning")
  collides with legitimate off-screen-scheming phrasing — direct evidence that hand-authored test
  strings do not anticipate real model idiom.
- Fix: Feed the guard a corpus of ACTUAL narration transcripts captured from a live model run (the
  `journey-raw.txt` / `j2-transcript.jsonl` telemetry already captured elsewhere in this audit round is
  a ready source) rather than only synthetic strings, to measure both false-negative (missed leaks) and
  false-positive (BE-205-style) rates against real idiom.
- Cross-territory flag: corroborates `backend-deep.md` BE-202/BE-205 (same guard, different defect
  class) — two independent hits raise this guard's overall risk profile.

### [TCG-6] [Severity: Minor] [Effort: <1day] [Value: Med]
FaithfulnessJudge (0081) is contract-tested with a scripted well-formed reply, never a real model's output-shape variance
- Where: `frontend/tests/test_0081_faithfulness_judge.py` (`_judge(reply)` wraps a lambda returning a
  hand-written string for every prompt); `frontend/src/faithfulness.py` (`FaithfulnessJudge`, "strict
  parsing: any out-of-contract token / unparseable reply ⇒ the deterministic floor").
- Problem: The test suite pins the parsing CONTRACT thoroughly (dimension/class/lever tuples, the
  closed-set wall) but every scripted reply is syntactically perfect JSON. A real reasoning model
  asked to classify faithfulness is likely to wrap its answer in commentary, markdown fences, or
  partial JSON under a token budget — exactly the class of failure `test_fs4d_truncation.py` had to be
  written to catch for the main narration path. Because this feature is default-`off` (see TCG-20) it
  has never been run against a real judge at all, so this specific parsing-robustness gap has never
  even had the chance to be found by accident.
- Fix: Add malformed/wrapped-JSON/truncated-mid-object replies to the judge's test matrix; when the
  feature is turned on for the first live trial, capture the raw replies for a real regression corpus.

### [TCG-7] [Severity: Minor] [Effort: <1day] [Value: Med-High]
The ACTIVE overseer (0080) has never been driven end-to-end against any judge — real or a scripted free-text stand-in
- Where: `frontend/tests/test_0080_active_overseer.py` (imports only `src.overseer`, never
  `src.agent_loop`); the wiring claim ("SOURCE-PIN — `src/agent_loop.py` wires the active path... with
  the legacy `_FORCED_ADVANCE_NUDGE`... kept as the fall-through floor") is asserted by reading
  `agent_loop.py`'s text, not by running it.
- Problem: 0080's whole premise is "the reasoning tier as the primary actor" — i.e., an LLM verdict
  actually steering gameplay-correction levers through `dispatch_lever`. The test suite validates
  `dispatch_lever`'s TRIGGER-ONLY / FAIL-SOFT-FLOOR contract using `DeterministicOverseer` (a stub that
  by definition never disagrees with the "happy" verdict shape), but no test drives the real
  `agent_loop.py` active-mode branch with even a scripted free-text LLM reply standing in for a judge,
  let alone a live one. Combined with the default-off status (TCG-20), this means the feature exists in
  a state where its unit contract is solid but its INTEGRATION has literally never executed once, by
  test or by hand, end-to-end.
- Fix: At minimum, add an agent_loop-level integration test that flips `overseer_mode="active"`,
  supplies a scripted free-text judge reply (including a couple of malformed ones), and asserts the
  correct lever fires through the real loop — not just through `overseer.py` in isolation.

### [TCG-8] [Severity: Minor] [Effort: <1day] [Value: Med]
Cast-authoring richness is regression-gated only against the one historical failure signature (#1067)
- Where: `tests/unit/castAuthoringCommit.test.ts` (docstring: "The live-verify (real deepseek) authored
  only 9/15 cast members... the SAME engine refusal").
- Problem: This is a genuinely good practice (converting a real incident into a permanent regression
  test), but it is necessarily narrow: it fixes the exact non-degradation-checkpoint interaction that
  caused #1067's specific 9/15 shape. It says nothing about a DIFFERENT failure mode producing the same
  symptom (e.g. #1007's `finish_reason=length` truncation mass-fallback, which 0108's invariant 4 is
  explicitly designed to catch and which this engine-side test cannot see, since it never calls a
  model at all). The "≥13/15 deep profiles" richness bar therefore has exactly one shape of regression
  protection and zero protection against the shape that actually motivated 0108.
- Fix: No engine-side fix needed — this is a coverage-shape observation. Prioritize building 0108's
  invariant 4 (or a narrower cast-authoring-only fixture) since it is the only mechanism that can catch
  the #1007-shaped failure this test cannot.

### [TCG-9] [Severity: Minor] [Effort: <1hr] [Value: Med]
The wrong-nominee / first-name-collision guard is validated only with synthetic strings
- Where: `frontend/routes/chat_helpers.py:1783-1809`.
- Problem: `backend-deep.md`'s BE-210 already flags a concrete false-negative case (two active
  houseguests sharing a first name) found by static reading. The reason a static read was needed to
  find it, rather than a test catching it, is that the guard's test coverage (if any — a search of
  `frontend/tests/` for this guard's specific function name returns no dedicated test file) is thin
  relative to the guard's regex-heuristic nature. Heuristic string-matching guards over free-form model
  prose are exactly the class of code that needs a broad adversarial string corpus, not a couple of
  hand-picked examples.
- Fix: Build a small property-style test that generates many first-name-collision permutations
  (varying which of two same-named houseguests is meant) and asserts the guard's behavior is
  intentional (accept/reject) rather than incidental.
- Cross-territory flag: corroborates `backend-deep.md` BE-210.

### [TCG-10] [Severity: Major] [Effort: <1day] [Value: High]
The reasoning/public-bubble channel split is tested only with SSE chunks that already carry a correct `thinking` flag
- Where: `frontend/static/js/chat.js` (`roundReplyText`/`roundReasoningText` split, per CLAUDE.md's own
  "Front-end client conventions" section); test coverage in `frontend/tests/test_fs4d_truncation.py`
  and sibling streaming tests, all of which construct SSE payloads with `"thinking": true/false` set by
  the TEST, not derived from anything a real model actually emitted.
- Problem: This is invariant I9 ("no engine/tool/app/system talk in anything the player sees... reasoning
  never in the public bubble") — one of the ten things the vision brief says makes-or-breaks the whole
  product. The split logic itself (route on the `thinking` boolean) is simple and well covered for ITS
  contract, but the entire safety of the invariant actually rests on the PROVIDER correctly and
  consistently tagging reasoning tokens as `thinking: true` in every chunk, every round, under every
  condition (mid-sentence cutoff, provider-side buffering, a fallback-tier model with different
  reasoning conventions). No test in the suite exercises a chunk stream where the tagging is
  inconsistent, delayed, or absent (e.g. a fallback model that doesn't support the reasoning field at
  all) — which is exactly the scenario a provider outage or model-tier fallback (also newly relevant
  post-ADR-0016) could produce.
- Fix: Add adversarial SSE fixtures — inconsistent/missing `thinking` tags, a fallback-tier response
  with no reasoning field, a tag that flips mid-sentence — and assert the worst case still degrades to
  "everything visible" rather than "reasoning leaks into the body," since a silent channel-split failure
  is invisible until a human happens to read the transcript.

### [TCG-11] [Severity: Minor] [Effort: <1hr] [Value: Med]
Concrete false-green example: `test_orwell_advance_stall_nudge.py` asserts source strings exist, not runtime behavior
- Where: `frontend/tests/test_orwell_advance_stall_nudge.py`.
- Problem: See TCG-1 for the full analysis — this entry exists separately in the index because it is
  the CLEAREST single example of the charter's requested "stubbed-LLM false-green class" pattern: every
  assertion in the file is `assert <literal> in js` or `assert js.count(<literal>) == N`. A developer
  could rename a constant, delete the actual escalation branch it's used in, and leave a comment
  containing the string — the test would still pass.
- Fix: See TCG-1's fix (add a behavior-driving companion test); this entry is the naming/citation the
  charter asked for.

### [TCG-12] [Severity: Polish] [Effort: <1hr] [Value: Low]
Concrete false-green example: `test_l31_premiere_tutorial.py` defers to a browser-smoke that itself stubs the model
- Where: `frontend/tests/test_l31_premiere_tutorial.py` (docstring: "Source-pinned... browser-smoke
  covers the live DOM").
- Problem: The stated escape hatch for this file's admitted source-pin limitation ("browser-smoke
  covers the live DOM") is itself a stubbed-LLM gate (`frontend/scripts/browser_smoke.py` runs with
  `AUTH_ENABLED=false` and routes model calls through Playwright fakes). So the FULL chain — source-pin
  test defers to browser-smoke, browser-smoke stubs the model — never actually proves the premiere
  tutorial card behaves correctly around a real narration stream (e.g. does it appear/dismiss cleanly
  while text is actively streaming, or does a mount/unmount race with the live DOM mutation the way
  other transient UI in this codebase has been shown to?).
- Fix: Low priority given the feature is a light dismissible card, but the docstring's claimed coverage
  chain should be corrected to acknowledge neither layer proves live-model behavior.

### [TCG-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
Concrete false-green example: `test_967_casting_kickoff.py` proves the cue fires, not that the model responds correctly to it
- Where: `frontend/tests/test_967_casting_kickoff.py`.
- Problem: Restated from TCG-4 as its own index citation per the charter's ask for concrete examples —
  every assertion targets `admin.js`/`settings.js` source text (`refreshModels(true)`,
  `orwell:models-changed` dispatch). None targets the model's actual reply to the resulting hidden-cue
  turn.
- Fix: See TCG-4.

### [TCG-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
Concrete false-green example: `test_0080_active_overseer.py` tests the module in isolation, the wiring is source-pinned
- Where: `frontend/tests/test_0080_active_overseer.py`.
- Problem: Restated from TCG-7 as its own index citation — the file's own docstring labels its last
  bullet "SOURCE-PIN," an explicit admission that the `agent_loop.py` wiring is verified by reading
  code, not running it.
- Fix: See TCG-7.

### [TCG-15] [Severity: Major] [Effort: <1day] [Value: High]
`expressiveNonCollapse` cannot see the exact malformed-input crash another lane already found live in the same code path
- Where: `tests/unit/expressiveNonCollapse.test.ts` (feeds only well-formed, if WEIRD, consequence
  descriptors); the actual defect is `backend-deep.md` BE-101: `src/adapters/mcp/McpServer.ts:70-78`
  validates `consequence.edges[].direction`/`emphasis` are strings but never checks enum membership,
  and `src/engine/consequence.ts:139-141` / `relationshipConstants.ts` index a lookup table with the
  unchecked value, producing either an uncaught `TypeError` (an unrecognized `direction`) or a silent,
  PERMANENT `NaN` corruption of the hidden relationship layer (an unrecognized `emphasis`).
- Problem: This is the single cleanest illustration in this whole audit of the "write-back wired 1-2-3,
  dead/dangerous at #4" class the brief asked for by name — except here the danger isn't dead code, it's
  a LIVE, reachable crash/corruption path that the codebase's own dedicated regression gate for this
  exact feature (`expressiveNonCollapse.test.ts`, ADR 0005's testability section) structurally cannot
  exercise, because every fixture in that file was authored to be a valid (if creative) descriptor. A
  real model populating `direction: "much-warmer"` (a plausible paraphrase of the real `"warmer"` enum
  value) or `emphasis: "extreme"` (a plausible paraphrase of `"strong"`) would sail past every existing
  test green and corrupt live game state. This is exactly the class of bug that ONLY a real (or
  realistically-noisy) model input can surface, and the stub used everywhere never produces it.
- Fix: Independent of the underlying code fix already recommended in `backend-deep.md` BE-101 (validate
  enum membership at the MCP boundary), extend `expressiveNonCollapse.test.ts` (or a sibling file) to
  include deliberately-plausible-but-invalid enum values in the malformed-input matrix, specifically
  BECAUSE a real model is likely to produce them.
- Cross-territory flag: this is the SAME defect as `backend-deep.md` BE-101 (Major/High there too) —
  two independent lanes hitting the identical code path from different angles (implementation-review
  vs. test-coverage-review) should raise its priority further.

### [TCG-16] [Severity: Minor] [Effort: <1day] [Value: Med]
The documented "four-place write-back" wiring gotcha keeps recurring and has no structural early-warning test
- Where: `src/ports/GameSession.ts:1699` (`worldSnapshotView` interface method), `src/adapters/engine/
  GameSessionAdapter.ts:7005-7017` (full implementation) — never added to `PLAYER_TOOLS`, never given a
  `requireShape`/`callTool` case in `McpServer.ts` (independently found as `backend-deep.md` BE-103).
- Problem: CLAUDE.md itself documents this exact class of bug at length ("Adding one is a four-place
  change... a missing piece fails silently at runtime... the static gates do NOT catch a missing #4")
  and names `recordCastProfile`/`recordWorldSnapshot` as past casualties, with the fix being "a boundary
  test that dispatches the tool through `McpServer.callTool` for every write-back." But that fix is
  APPLIED PER-INCIDENT (`castPrewarm.test.ts`, `worldSnapshotBoundary.test.ts` are cited as the
  templates) rather than as a structural gate that would catch the NEXT instance before it ships.
  `worldSnapshotView` is a live, currently-shipped example of exactly this pattern (port + adapter
  fully done, registry + McpServer wiring entirely absent) that nothing failed on — it was found by
  `backend-deep.md`'s manual review, not by any test.
- Fix: Add one structural test that walks every method on the `GameSession`/`EngineCommands` port
  interfaces via reflection/type-listing and asserts each has a corresponding `McpServer` dispatch case
  (or is on an explicit allowlist of intentionally-internal methods) — turning the per-incident template
  into a single standing gate that catches the NEXT `worldSnapshotView`-shaped gap automatically.
- Cross-territory flag: corroborates `backend-deep.md` BE-103 (same finding, coverage-gap framing here
  vs. dead-code framing there).

### [TCG-17] [Severity: Polish] [Effort: <1day] [Value: Low]
Heavy sims are excluded from the coverage MEASUREMENT, not just the fast unit run — a coverage-only regression in their exclusive path is invisible
- Where: `vitest.config.ts` (`HEAVY_SIM_FILES`, used to build the `test:cov` exclusion set).
- Problem: The exclusion is well-justified for wall-clock (heavy sims run full seasons many times) and
  the file's own comment states it was re-measured to add no gated-dir branch coverage the rest of the
  live-loop suite doesn't already provide — a defensible, documented tradeoff, not a defect. The
  residual risk is narrower than it sounds: it is a **measurement** gap, not a functional one (the
  heavy sims still RUN in CI's `heavy-sims` job and would fail on a functional regression). The
  remaining risk is specifically a change that only lowers branch coverage in a path exclusively
  reached by the heavy sims' longer seed/turn-count range — such a change would not fail `test:cov`'s
  threshold gate and would only be caught if the heavy sim's own assertions happen to notice.
- Fix: No action needed beyond periodically re-validating the "adds no gated-dir branch coverage" claim
  the file's comment already commits to (it says as much) — flagging here so the audit's coverage
  section is complete, not because it's an active risk.

### [TCG-18] [Severity: Minor] [Effort: <1day] [Value: Med]
The lowest branch-coverage floor sits on the highest write-back-risk directory
- Where: `vitest.config.ts` thresholds block: `src/engine/**` 90, `src/composition/**` 88,
  `src/adapters/engine/**` 82 (the lowest of the three named floors).
- Problem: `src/adapters/engine/` is exactly the directory holding `GameSessionAdapter.ts` and
  `EngineCommandsAdapter.ts` — the two files CLAUDE.md names as the site of the "four-place write-back"
  wiring pattern, the closed-set sync-spine `beatSeq`/`idempotencyKey` guards, and (per TCG-15/BE-101)
  a live unvalidated-input crash path. That this directory carries the LOWEST ratcheted branch floor of
  the three explicitly-named directories means a meaningfully larger fraction of its conditional logic
  can regress silently under the coverage gate than in `engine/` or `composition/` — an inversion of
  where the coverage floor should be tightest given the documented risk concentration.
- Fix: When next ratcheting thresholds (the file's own convention is "ratchet up only"), prioritize
  `adapters/engine/**` over the other two directories, specifically targeting the write-back dispatch
  and beatSeq-guard branches.

### [TCG-19] [Severity: Polish] [Effort: <1hr] [Value: Low]
`src/main.ts`'s real branching logic (env/port/token resolution) has zero measured coverage
- Where: `src/main.ts:12-62` (`parsePort`, the `ORWELL_ENGINE_MULTIUSER` regex-flag parse, token/
  admin-token resolution with legacy `BBAI_*` fallbacks); excluded via `vitest.config.ts`'s `exclude:
  ["src/ports/**", "src/main.ts"]`.
- Problem: Unlike `src/ports/**` (legitimately excluded — confirmed by inspection that the port files
  are pure interface/type declarations with no function bodies to branch on), `main.ts` contains real,
  if small, conditional logic: a fallback chain across four env var names for the port, a regex test for
  the multiuser flag, and similar chains for host/token/admin-token. None of this is asserted by any
  unit test; its only exercise is an actual process boot (deploy smoke, local dev). A regression here
  (e.g. breaking the `BBAI_*` legacy fallback, or the multiuser regex accepting an unintended value)
  would only surface at deploy time, not in CI's fast lane.
- Fix: Extract `parsePort` and the flag-resolution helpers (already separate functions) into a small
  testable module and add direct unit tests; low effort, closes a genuine (if minor) gap rather than
  living inside a coverage exclusion that was really scoped for `src/ports/**`.

### [TCG-20] [Severity: Major] [Effort: <1day] [Value: High]
Two shipped correction systems (overseer, faithfulness) default off and have never been run against a live model in either mode
- Where: `frontend/src/settings.py:270` (`"overseer_mode": "off"`), `:281` (`"faithfulness_mode":
  "off"`); no hit for either mode set to `"active"` (or even `"shadow"`) anywhere in `SOUL.md` or
  `docs/audits/*.md`.
- Problem: Features 0079-0081 are listed as BUILT in CLAUDE.md's status summary, and their unit-level
  contract tests (verdict parsing, lever dispatch, fail-soft floor) are genuinely solid — but "built and
  unit-tested" is not the same claim as "works against a real model," and for THESE features
  specifically, no evidence exists that anyone has ever turned either on and watched it operate against
  live narration, not even once, not even in the single 2026-06-27 live-verify run (which by every
  description ran with default settings). Since these are explicitly framed as anti-sycophancy
  correction layers meant to catch the model doing the WRONG thing, their real value proposition can
  only be assessed by watching them catch (or fail to catch) a real slip — something a deterministic
  stub structurally cannot produce (the stub, by construction, never slips).
- Fix: Before or shortly after ship, run one deliberate live session with `overseer_mode=shadow` (safe,
  non-authoring) and log its verdicts against real narration, to get a first real signal on false-
  positive/negative rates; treat `active` mode as still experimental until that shadow data exists.

### [TCG-21] [Severity: Minor] [Effort: <1day] [Value: Med]
The opt-in SQLite persistence tier has never been exercised across a full season
- Where: `tests/unit/sqliteStoreComposition.test.ts` (74 lines; one soul-recall round-trip and a save/
  load smoke — the file itself is scoped to "the composition flag," not season-length behavior).
- Problem: `ORWELL_STORE=sqlite` is documented as "built and opt-in" (#330) and is the natural next
  choice for anyone deploying beyond a single-host in-memory setup. None of the full-game UAT files
  (`tests/uat/fullGameUat.*.test.ts`), the jury-reach/calibration-gradient property suites, or the
  persistence non-degradation feature's BDD scenarios run under `ORWELL_STORE=sqlite` — they all use
  the default in-memory/file path. The exact property this tier exists to guarantee (durable,
  non-degrading persistence across restarts, feature 0007's core promise) has therefore never been
  proven under the ONE storage backend most likely to be chosen for a real multi-user production
  deploy.
- Fix: Parameterize at least one full-game UAT seed (or a dedicated shorter season) to run under
  `ORWELL_STORE=sqlite` in CI, even if not on every PR (e.g. as part of the heavy-sims matrix).

### [TCG-22] [Severity: Polish] [Effort: <1hr] [Value: Low]
The opt-in wall-clock watcher has only env-parsing coverage, no integration test
- Where: `tests/unit/runtime.test.ts:132` (`watcherConfigFromEnv({ ORWELL_WATCHER_TICK_MS: "0", ... })`
  — a pure config-object assertion).
- Problem: `ORWELL_WATCHER_TICK_MS`/`_IDLE_MS`/`_MAX_TICKS` opt a deployment INTO a background tick
  loop that advances off-screen life on a wall-clock cadence — a materially different runtime shape
  from the pure turn-driven default. Its only test coverage confirms the env vars parse into the right
  config shape; no test starts an actual watcher and confirms it ticks the expected number of times,
  respects the idle/max-ticks bounds, or interacts correctly with a concurrent player turn. Low
  priority because it is explicitly non-default and the ruling that made turn-driven the default
  reduces its real-world exposure, but it is still unbuilt-tested code that could be flipped on for a
  specific deploy need.
- Fix: Add one integration test that starts a `FakeClock`-driven watcher with a small tick count and
  asserts the expected number of off-screen advances occur and stop at the configured bound.

### [TCG-23] [Severity: Major] [Effort: <1day] [Value: High]
Every browser-driven E2E gate hard-codes `AUTH_ENABLED=false` — the real multi-user login path is never exercised end-to-end
- Where: `frontend/scripts/boot_smoke.py:51`, `frontend/scripts/browser_smoke.py:71`,
  `frontend/scripts/responsive_matrix.py:95` (all three set `AUTH_ENABLED="false", LOCALHOST_
  BYPASS="true"` in their launched-process env).
- Problem: Public-internet exposure (0067/0068) and the token economy (0069) are both shipped-built
  features whose entire premise is multiple real, authenticated users on one deployment. Yet the ONLY
  automated browser-level surface tests all deliberately bypass authentication — meaning the actual
  login screen, session-cookie issuance, the `x-orwell-user` header derivation from a real authenticated
  session, and any auth-adjacent UI state (expired session, wrong credentials, concurrent-device
  login) are exercised only by FastAPI `TestClient`-level pytest (real HTTP semantics, but no real
  browser, no real cookie jar, no real page navigation) — never by an actual browser driving a real
  login before playing a turn. A regression that breaks the login page's DOM, a cookie-setting bug that
  only manifests under real browser cookie policy (SameSite, Secure flags relevant to the new HTTPS
  work in 0074/ADR 0014), or a session-expiry mid-game state would have zero automated coverage.
- Fix: Add one browser-smoke variant (even a reduced, lower-frequency CI job) that runs with
  `AUTH_ENABLED=true`, drives the real login form, and confirms a game turn completes post-login —
  distinct from and in addition to the existing `LOCALHOST_BYPASS` fast path.

### [TCG-24] [Severity: Minor] [Effort: <1day] [Value: Med]
Cross-user isolation under real concurrent multiuser load is unit-tested for rejection only, never load-tested
- Where: `src/main.ts:62` (`requireUser` flag), `tests/unit/opsPrivateRepo.test.ts` (the only hit for
  `ORWELL_ENGINE_MULTIUSER` in `tests/`).
- Problem: The test confirms the engine rejects a request missing `x-orwell-user` when the multiuser
  flag is on — an important but narrow property. No test (unit, integration, or E2E) drives two or more
  DISTINCT real user identities issuing concurrent game-mutating calls against one live engine process
  and asserts zero cross-contamination of state under real interleaving (as opposed to the
  single-user two-WINDOW concurrency the F1-F5 gates already cover well). Given "cross-user isolation
  is a first-class guarantee alongside the Vault Wall" per CLAUDE.md, and given this is exactly the kind
  of property that tends to hold in isolated unit tests but break under real concurrent scheduling, this
  is worth a dedicated stress-shaped test.
- Fix: Add an integration test that spins up N concurrent simulated users (distinct `x-orwell-user`
  values) against one `GameSessionRegistry`/engine instance, drives interleaved mutating calls, and
  asserts each user's final state matches only ITS OWN calls.
- Cross-territory flag: relevant to the consistency-parity lane's territory (multi-session integrity) —
  worth confirming whether that lane's findings already cover true multi-USER (not multi-window)
  concurrency, since this lane's evidence suggests it may not be covered anywhere.

### [TCG-25] [Severity: Major] [Effort: <1day] [Value: High]
The ship-gate's "#1 release blocker" (two-window mirror parity) has one automated gate and it's a fake model
- Where: `docs/audits/playtest-harness/mirror_live_parity.mjs` via `run_mirror_gate.sh` (per its own
  description in `docs/audits/2026-06-27-ship-gate.md`: "key-free, deterministic fake streamed model");
  `frontend/tests/test_0012_mirror.py` (described in the same doc as "the fast `xfail` tripwire," i.e.
  not itself a full behavioral proof).
- Problem: F5 ("realtime mirrored parity") is explicitly called out in the ship-gate doc as needing to
  hold under a REAL model's actual streaming characteristics — chunk size, flush cadence, provider-side
  buffering differences, and (per the same doc) it was in fact validated once, live, against deepseek's
  actual stream ("window B mirrored A's live deepseek stream in lockstep"). But that validation is a
  SINGLE, manually-run, unrepeated data point dated 2026-06-27. The permanent CI gate that runs on every
  PR uses a fake stream with presumably fixed, convenient chunking. A regression that only manifests
  under a real provider's actual chunk-timing behavior (e.g. a burstier or laggier stream from a
  different model/provider — relevant again given the ADR 0016 model swap four days after this
  ship-gate doc was written) has no automated path to being caught before it reaches a real user.
- Fix: This is the strongest concrete argument for 0108's nightly re-record job to explicitly also
  drive the two-window mirror scenario against the live model (not just the single-window golden path
  as currently scoped) — see TCG-31.

### [TCG-26] [Severity: Minor] [Effort: <1day] [Value: Med]
Offline/network-drop mid-stream is never simulated with real browser network primitives
- Where: `frontend/tests/test_985_p2a_send_queue.py` (function-level Python unit tests of the outbox
  logic); a grep of `frontend/scripts/browser_smoke.py` for `set_offline`/`context.route(...).abort`
  patterns representing a genuine mid-session disconnect returns nothing.
- Problem: F3 ("smart queueing, no lost sends... offline→online queue + flush in order") is one of the
  five FE-airtight bars the ship-gate calls the top release blocker category. Its outbox LOGIC (retry,
  ordering, de-dup) is well covered at the Python function level, but the actual real-world failure
  mode — a phone losing signal mid-turn while a stream is actively rendering, then regaining
  connectivity — has never been reproduced with Playwright's `context.set_offline(True)` (or an
  equivalent route-abort simulating a dropped connection) against the real page. Python-level tests can
  prove the outbox function is correct given a well-formed sequence of calls; they cannot prove the
  BROWSER correctly detects the drop, correctly queues, and correctly resumes rendering an in-flight
  stream that was cut mid-chunk.
- Fix: Add a browser_smoke (or a dedicated small Playwright script) scenario that toggles
  `context.set_offline(True)` mid-stream, sends a message while offline, restores connectivity, and
  asserts the message lands exactly once and any interrupted stream recovers or is clearly marked.

### [TCG-27] [Severity: Major] [Effort: <1day] [Value: High]
An existing test CERTIFIES a mandate-4 violation rather than gating against it
- Where: `frontend/tests/test_0065_backfill_cas.py::test_e22_fallback_stale_409_is_skipped` (asserts
  `out is False` and the fallback's single-flight slot is released after a stale-409 — i.e., confirms
  the scene is dropped); the documented target fix is `docs/REFACTOR-ROADMAP.md`'s R1c / audit A-S3:
  "a stale-409 on `recordInteraction`/`makeDeal`/`moveTo` is reconciled-and-**skipped**; the only
  recording of a scene can be lost... Verify: a test that forces a stale-409 on the sole recording and
  asserts the fold still lands once."
- Problem: This is the sharpest example in the whole audit of a test that is technically green while
  encoding exactly the failure CLAUDE.md calls "the cardinal implementation sin" ("never ship an action
  that is narrated but never recorded — it has no consequence and no memory"). The E22 fallback
  (`_auto_record_scene`) exists SPECIFICALLY to catch the model's own under-call of `recordInteraction`
  — it is the last line of defense. If that last-resort path ALSO drops the fold on a stale-beat race
  (a race made MORE likely precisely because the fallback fires late, after other turn activity may
  have already advanced the beat), the scene truly has zero consequence with no further backstop. The
  roadmap has correctly identified and prioritized this (R1c, "the highest-value" post-launch latent
  per the roadmap's own framing elsewhere), but as of this audit the FIX's own prescribed verification
  test ("asserts the fold still lands once") does not yet exist — only the test proving the CURRENT
  (undesired) behavior does.
- Fix: Implement R1c (re-attempt the fold against the refreshed `beatSeq`, idempotency-keyed against
  double-apply) and add the roadmap's own prescribed test alongside it; until then, this is a live,
  reachable path where a real player's scene can vanish without a trace, worth weighing as launch-
  relevant rather than purely post-launch given it directly contradicts mandate #4.
- Cross-territory flag: strongly relevant to any lane auditing the consequence/memory loop directly
  (I4) — flagging in case it overlaps with product-gaps/backend-deep findings on the same seam.

### [TCG-28] [Severity: Minor] [Effort: <1day] [Value: Med]
No browser gate runs two real, distinct authenticated users concurrently
- Where: `frontend/scripts/browser_smoke.py` (single-tenant, `AUTH_ENABLED=false` throughout); ship-gate
  G9 ("no cross-user / Vault leak") is marked "✅ structurally gated (dependency-cruiser + tests)" —
  i.e., a static/unit guarantee, not a browser-level one.
- Problem: I10's "unlimited users concurrently, each fully isolated" is asserted true at the ENGINE
  level (the dependency-cruiser Vault-edge check, per-user sandbox unit tests) but has no browser-level
  regression gate proving two real people, in two real browser sessions, with two real accounts, playing
  two different games at the same time, never see a flicker of each other's state through the FE layer
  (session mixing, a shared in-memory cache keyed wrong, a stale cookie routing one user's poll to
  another's session). This is a distinct risk surface from the two-window-SAME-user parity work (F1-F5,
  well covered) and from the engine-level isolation (well covered) — it's specifically the FE's
  session/request-routing layer under real multi-account concurrency.
- Fix: Extend the two-window Playwright harness (already built for F1-F5) with a variant that logs in
  as two DIFFERENT accounts in two contexts and asserts complete state independence — reusing most of
  the existing rig.

### [TCG-29] [Severity: Minor] [Effort: <1day] [Value: Med]
Mobile-specific tests never combine with a real model's streaming behavior
- Where: `frontend/scripts/responsive_matrix.py:95` (`AUTH_ENABLED="false"`, and per the file's own
  comment at line 129, engine tool calls are driven directly rather than through a narration turn for
  most of the matrix).
- Problem: The responsive/mobile lane (this audit's sibling territory) is well-suited to catch layout
  and touch-target issues, but by construction it exercises viewport/breakpoint behavior against static
  or fake-streamed content. Mobile-specific race conditions this audit's charter explicitly asks about
  elsewhere in the codebase (keyboard-open viewport-height shifts, scroll-position preservation during
  an active append) are most likely to actually manifest DURING a real, variable-length, unpredictably-
  paced token stream — not a fake one with convenient timing. No test combines the mobile viewport
  matrix with anything resembling a real model's actual streaming cadence.
- Fix: Lower priority given effort/value tradeoff, but worth a follow-up once 0108's replay
  infrastructure exists: replay a captured real-model stream through the mobile viewport matrix instead
  of a synthetic one.

### [TCG-30] [Severity: Minor] [Effort: <1day] [Value: Med]
The deploy-time smoke never drives the actual conversation/narration endpoint
- Where: `deploy/smoke_turn.py:22-45` (`engine_call` posts directly to `/player/call` on the ENGINE;
  the decision is resolved via the FE's `/api/orwell/decision` route, but the narration/chat streaming
  endpoint itself is never invoked).
- Problem: `deploy/smoke.sh` + `smoke_turn.py` is the CI "deploy smoke" job and is described in
  CLAUDE.md as driving "a full turn end-to-end" — true in the sense of engine mechanics (a decision is
  made and bound) but the actual player-facing conversational path (the chat endpoint, streaming,
  narration rendering) that the game's core fantasy depends on is never touched by this smoke at all.
  A deploy that breaks ONLY the chat/streaming path (e.g. a misconfigured reverse proxy buffering SSE,
  breaking exactly the kind of infra issue a deploy smoke exists to catch) would pass this gate cleanly.
- Fix: Add one additional smoke step that posts to the actual chat-stream endpoint (even with no model
  configured, asserting a sane "no model configured" response rather than a proxy-level failure) to
  extend deploy-smoke's reach to the conversational path, not just the decision-API path.

### [TCG-31] [Severity: Major] [Effort: multi-day] [Value: High]
Feature 0108 is the right structural fix, but as drafted it leaves several of the above gaps uncovered even once built
- Where: `docs/features/0108-real-model-golden-path-gate.md` + `.feature` (spec-only, not yet built).
- Problem: 0108's design is sound and precisely targeted at the core thesis of this audit lane (a
  captured-real-run replay driving the real FE+engine, catching the model↔engine seam regressing). But
  reading its 8 invariants against the specific gaps found in this audit shows real scope gaps worth
  deciding on BEFORE implementation starts, not after:
  1. **No `tool_choice`-honoring assertion.** Given TCG-2 (the GLM-4.7 forced-call assumption is
     entirely unverified), invariant 5 ("no stuck phase") should explicitly assert that forced-`tool_
     choice` beats (comp resolution, ceremony advance per ADR 0016 §D) actually receive a tool call in
     the recorded fixture (`meta.tool_call_seen: true` at those specific call sites) — not just that the
     phase eventually advances via SOME mechanism (which could mask a silent fall-through to the
     stall-nudge belt papering over a `tool_choice` failure).
  2. **No two-window mirror assertion.** Given TCG-25 (F5 is the "#1 release blocker" and its only
     real-model proof is a single manual run), the nightly re-record (which already stands up a real
     model) is the natural place to ALSO drive a second window against the same live session and assert
     mirror parity — a small marginal addition given the harness already exists (`mirror_live_parity.
     mjs`) and the model is already live in that job.
  3. **No overseer/faithfulness-active-mode variant.** Given TCG-20 (0079-0081 has never run live in
     either mode), 0108's replay/record infra is a natural home for an OPTIONAL second fixture recorded
     with `overseer_mode=shadow` (safe) to get the first-ever real signal on that system, even if
     `active` stays out of scope for now.
  4. **Single-model, single-tenant only (acknowledged in the spec's own Out-of-scope), which is
     reasonable for v1** — but the spec should explicitly flag AUTH_ENABLED=true / multi-user (TCG-23/
     TCG-24/TCG-28) and `ORWELL_STORE=sqlite` (TCG-21) as NEXT candidates once the base harness lands,
     so they don't quietly fall off the roadmap the way jury/finale fixtures are already explicitly
     deferred.
  5. **The nightly's "allowed to flake" framing needs a companion metric.** Per the spec, a nightly
     failure surfaces as "an issue comment/annotation, prompting a human to regenerate" — but there's no
     stated retention/trend view of nightly pass rate over time, which is exactly the signal that would
     show a model provider silently degrading (e.g. a quiet GLM-4.7 update that stops honoring `tool_
     choice` — directly relevant to TCG-2). Recommend the nightly persist a simple pass/fail history
     artifact, not just a per-run annotation.
- Fix: Fold items 1-3 into 0108's Gherkin scenarios before implementation (they are additive, not a
  scope expansion of the core mechanism — they reuse the same record/replay seam and the same live
  model already being stood up for the nightly); explicitly list items 4-5 as "future fixtures" in the
  spec's Out-of-scope section (mirroring how jury/finale are already handled) rather than leaving them
  unaddressed by omission.

---

## COVERAGE / WHERE I LOOKED

Read/grepped: `tests/` (unit 223 files, integration 11, property 20, uat 3, calibration 1, architecture,
support), `frontend/tests/` (344 files, sampled ~25 in depth across belts/guards/overseer/faithfulness/
streaming/auth/sync), `cucumber.cjs`, `vitest.config.ts`, `.github/workflows/ci.yml` (all job names +
env wiring), `docs/features/0108-*.{md,feature}` (full), `docs/features/README.md` (status index),
`docs/REFACTOR-ROADMAP.md` (R0-R2), `docs/audits/2026-06-27-ship-gate.md` (F1-F5/G1-G9 rows),
`docs/decisions/0016-llm-model-selection.md`, `SOUL.md` (grepped for GLM/tool_choice/owed),
`deploy/smoke.sh` + `smoke_turn.py`, `frontend/scripts/{boot_smoke,browser_smoke,responsive_matrix}.py`
(env-wiring sections), `src/main.ts`, `src/ports/*.ts` (confirmed pure-interface, no logic),
`src/adapters/narrative/*.ts` + composition roots (confirmed `LlmNarrativePort` is built but never
wired — `EchoNarrativePort` is the live engine narrator, narration lives FE-side), cross-referenced
`backend-deep.md`/`product-gaps.md` for the write-back four-place-wiring class and the outcome-guard
defects (BE-101/BE-103/BE-202/BE-205/BE-210) to corroborate rather than duplicate.

**Not covered (ran out of session budget, not "clean"):** a line-by-line audit of all 344 FE test files
(sampled by pattern/keyword instead — belts, guards, overseer, faithfulness, streaming, auth, sync);
the BDD `.feature` step-definition implementations in `features/step_definitions/` (assumed
representative of their `.feature` files, not separately audited for false-green patterns); the
`tests/architecture/` dependency-cruiser rule set itself (trusted as sound per its role as THE
structural Vault-Wall gate, not re-derived); the calibration-gradient/jury-reach property tests' actual
statistical assertions (accepted their stated purpose at face value). A dedicated pass specifically
diffing `docs/features/README.md`'s built/spec-only reconciliation against `cucumber.cjs`'s `paths` list
for drift would likely surface a few more small gaps but was judged lower-value than the seam-focused
findings above given the time budget.

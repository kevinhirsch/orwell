# Ship-gate re-verification (2026-07-09)

**Mode:** read-only, source-verified re-audit of the launch-acceptance bar in
[`2026-06-27-ship-gate.md`](2026-06-27-ship-gate.md) — the FE-airtight standard **F1–F5** and the
casting→eviction golden path **G1–G9** — against the **current source on `origin/main`**
(`b4be804c`). Every verdict below carries `file:line` evidence, and F5 was **executed**, not
inspected.

> **Verdict (up front): F5 is the SOLE remaining launch blocker.** No second blocker was found.
> F1–F4 are satisfied (mechanisms present, tripwires green, no regression evidence). G1–G9 are
> satisfied **and now gated** by the 0108 golden-path replay, which is **armed and green** (I1–I8
> PASS/SKIP) — contradicting the "dormant, no fixture" prose still in `CLAUDE.md` and the ship-gate
> doc. F5 fails its **executable** gate — I ran it: `mirror_live_parity.mjs` exits **1** on
> `bUsesIncrementalRenderer`. A fix is **in-flight on `claude/f5-mirror-parity-fix`** (not touched
> by this audit).

## How this differs from the 2026-06-27 pass

The 2026-06-27 ship-gate marked **all** of F1–F5 and G1–G9 PASS — F5 "by inspection" on a real
DeepSeek run ("window B mirrored A's live stream in lockstep"). Since then the **executable** F5
gate (`mirror_live_parity.mjs`, ADR 0015 / R2) became the standard, and it **fails** on current
main. So the human-eye PASS and the automated gate now **disagree**, and the ship-gate's own bar is
explicit that *"the FE ships only when F1–F5 are proven by a repeatable harness, not by
inspection"* (`2026-06-27-ship-gate.md:41`). By the letter of that bar, **F5 is BLOCKED.**

The `2026-06-21-open-items-verification.md` headline *"there are no launch-blockers left"* predates
the executable-F5 RED finding and is **stale on that one point** (it was written before the harness
was the gate; ADR 0008/0012 live-mirror verification was filed there as *owed runs*, not a proven
pass — `2026-06-21-open-items-verification.md:69`).

## F-tier — the FE-airtight standard (#1 release blocker)

| # | Gate | Verdict | Evidence |
|---|------|---------|----------|
| F1 | No missing messages | **satisfied** | `message-added` broadcast fires on **every** persist path incl. the streaming save leg (`test_0012_mirror.py:34`, green); resume dedup by server DB-id so a resumed reply keeps a single entrance (`chat.js:4713`, `4810`). 2026-06-27 audit PASS; no regression. |
| F2 | Right status at the right time | **satisfied** | 2026-06-27 audit PASS (send button idle→streaming→newchat, no dead/lying control). No source regression found; decision-card re-arm on boot still wired (`orwellDecision.js`). |
| F3 | Smart queueing, no lost sends | **satisfied** | Outbox enqueue/flush is present and non-re-entrant (`chat.js:3928` `_enqueueSend`, dispatch `:3968`). 2026-06-27 audit PASS. |
| F4 | Multi-window concurrency | **satisfied** | Canonical-session binding + **liveness validation** (`orwell_game_session.py:119` `resolve_live_game_session`; `chat_helpers.py:4121` `_resolve_canonical_session`); casting single-flight (`test_0012_mirror.py:131`); deferred peer-resume so a busy window never drops a peer turn (`test_0012_mirror.py:476`–`510`). 29/29 mirror tripwires green. |
| **F5** | **Realtime mirrored parity** | **BLOCKED** | **Ran** `run_mirror_gate.sh` on current main → `mirror_live_parity.mjs` **exit 1, PASS=false**. See below. |

### F5 — executed, not inspected (the blocker)

Ran `bash docs/audits/playtest-harness/run_mirror_gate.sh` (real engine + deterministic fake model +
FE + a started season). Result:

```
B rendered the turn        : true
B starts DURING A's stream : A firstRender=2688ms · A settled=4595ms · B firstRender=4045ms → true
B uses A's live renderer   : A incrementalStream=true · B incrementalStream=false → FALSE
mirror lag                 : 369ms (budget 2500ms) → true
diagnostics                : A unmounts=30/mounts=37 · B unmounts=2/mounts=4 · settled-identical=true
VERDICT: FAIL — windows DIVERGE during streaming (gate exit 1)
```

- **Sole failing check:** `bUsesIncrementalRenderer` (`mirror_live_parity.mjs:92`, signature
  `:164`). The mirror window B never mounts a `.stream-content` / `.live-reply-content` streaming
  container that the harness can observe — B does **4 mounts** vs A's **37**. The other three checks
  (rendered / starts-during-stream / lag-within-budget) **pass**, and settled transcripts are
  **identical after grace**. So the divergence is in the **live render mechanism/churn**, not final
  content, ordering, or lag.

- **The trap — a GREEN source-pin over a RED behavior gate.** The fast tripwire
  `test_chat_client_mirror_does_not_full_repaint_per_delta` (`test_0012_mirror.py:359`) **passes**:
  the old per-delta `contentDiv.innerHTML = processWithThinking(…)` full-repaint is **gone** from
  `chat.js` (grep count 0), and the mirror path was refactored to `_renderLiveStream`
  (`chat.js:4598`) which *does* `createElement('div').className='live-reply-content'` + append + feed
  `createStreamRenderer` (`chat.js:4638`–`4642`). **The source pin is satisfied; the behavior gate
  is not.** At runtime B converges via a near-settle paint rather than flowing through the
  incremental renderer the way the gate detects. **Do not read the green unit test as F5 passing** —
  the in-flight fix must close the *behavior* gap (make B's live mirror actually stream through, and
  mount, the incremental container), not merely re-satisfy the source string.

- **In-flight:** `claude/f5-mirror-parity-fix` (and `claude/f5-mirror-gate-ci` wiring the harness
  into CI). **Not touched by this audit.**

- **Severity note for the overseer (adversarial, both directions):** by the ship-gate's *letter*
  (the executable gate must pass) F5 is a blocker. By *user-visible* impact it is the **narrowest
  possible** failure in the F-tier — no lost message, no wrong content, no stale control, lag 369 ms,
  settled-identical true; the only defect is that B's *live* render churns differently from A's
  (structural "same incremental renderer" check). It is **not** a dead-screen / Vault / stuck-beat
  class defect. Whether that clears the "FE must be airtight above all else" bar is an owner call,
  but it is the one and only thing standing between current main and an all-green F1–F5.

## G-tier — the casting→eviction golden path

Every G-beat's mechanism is present in source **and** is now asserted by the **armed** 0108
golden-path replay (`frontend/tests/golden/golden_path_glm-5.2.report.json`, regenerated today in
#1251).

| # | Gate | Verdict | Mechanism (file:line) | 0108 replay |
|---|------|---------|----------------------|-------------|
| G1 | Casting opens itself | **satisfied** | client auto-kickoff `orwellOnboarding.js:442`–`455` (`OPEN_GAME_LINE`, user bubble hidden) | I2 **SKIP** by design — browser seam, covered by fe-browser onboarding smoke; live-verified #1082 |
| G2 | Post-photo resume | **satisfied** | `apply_game_framing` tells the model the headshot is already on file (`chat_helpers.py:171`) | I3 **PASS** |
| G3 | Casting finalizes | **satisfied** | createCharacter finalize fallback (`agent_loop.py:1693`) | I1 **PASS** (4 casting turns → started) |
| G4 | Cast richly authored | **satisfied** | FE cast-authoring kickoff + backfill (`orwell_cast_authoring.py:945`, `:1112`) | I4 **PASS** — 15/15 deep-authored |
| G5 | The game advances | **satisfied** | stall-nudge ladder `_ADVANCE_NUDGES` (`agent_loop.py:1438`) + L39b forced advance `_FORCED_ADVANCE_NUDGE` (`:1621`); `_auto_mark_premiere_intros` (`:2332`) | I5 **PASS** — 7 phases, stuck=0, beats 2→92 |
| G6 | No premature outcome leak | **satisfied** | `_pre_emission_outcome_guard` (`agent_loop.py:3325`, wired `:3438`) | I6 **PASS** — no premature result / stale-beat trip |
| G7 | Eviction reads cleanly | **satisfied** | `goodbye-message` pending gates the week roll (`liveSeason.ts:1464`); eviction beat set (`agent_loop.py:1637`) | I6/I8 **PASS** — batched reveal; week rolls |
| G8 | No machinery in the bubble | **satisfied** | operator-aside / `npc:<id>` sentence scrub in the game build (`markdown.js:270`) | I7 **PASS** — every body clean |
| G9 | No cross-user / Vault leak | **satisfied** | structural: `.dependency-cruiser.cjs` forbids outward `VaultStore` imports; `tests/unit/producerVault.test.ts:37` proves the admin allowlist is Vault-free | structurally gated (not a replay invariant) |

### 0108 status correction (doc drift, not a blocker)

`CLAUDE.md` and `2026-06-27-ship-gate.md` describe the 0108 real-model golden-path gate as **shipping
dormant** ("the PR replay job dormant until the first real-model fixture is recorded and committed").
**That is now stale.** A fixture is committed — `frontend/tests/golden/golden_path_glm-5.2.jsonl` +
report, committed **2026-07-09** in #1251 — so the CI **`golden-path`** job (`ci.yml:249`, blocking,
key-free, replays twice) is **armed and green**: invariants **I1, I3–I8 PASS**; **I2 SKIP** by design
(client browser seam, covered by the fe-browser onboarding smoke). This *strengthens* the G-tier: it
is no longer "coded + live-verified once," it is **CI-gated on every golden-touching PR**. (Docs
should be reconciled, but per this audit's read-only scope they are only flagged here.)

## Cross-checks

- **ADR 0017 (transport, PR #1265) / ADR 0018 (living-house, PR #1266):** **not blockers.** Neither
  is on `origin/main` — `docs/decisions/` holds only 0001–0016; both are unmerged/Proposed docs.
  Confirmed absent.
- **`2026-06-21-open-items-verification.md` "no launch-blockers remain":** **stale on F5.** It
  predates the executable-F5 gate becoming the standard; it filed ADR 0008/0012 live-mirror
  verification as *owed runs*, and one of those runs (the executable two-window parity gate) now
  **fails**. Every *other* open item in that snapshot remains post-launch / parked (token economy,
  refactor roadmap R1–R7, window refactor, UX Phase-4, Proxmox host smoke) — none promoted to
  blocker.

## Bottom line

- **F5 is the sole launch blocker.** Confirmed by execution (`mirror_live_parity.mjs` exit 1 on
  `bUsesIncrementalRenderer`), fix in-flight on `claude/f5-mirror-parity-fix`.
- **No second blocker found.** F1–F4 satisfied; G1–G9 satisfied and now CI-gated by the armed 0108
  replay (I1–I8 green/skip-by-design).
- **Two loud caveats:** (1) the F5 **source-pin unit test is green while the behavior harness is
  red** — the fix must close the runtime behavior gap, not the source string; (2) **doc drift** — the
  0108 gate is described as dormant everywhere but is in fact **armed and passing** as of today.

# HANDOFF.md — session-to-session continuity for the Orwell overseer

> **What this is.** The living hand-off: the *current state of play* — what just shipped, what is
> in flight, what is owed, and exactly where the next session picks up. Read this **after**
> `CLAUDE.md` (project brief) and alongside `SOUL.md` (the operating model + hard-won lessons —
> durable discipline lives THERE; point-in-time state lives HERE). Refine this file at every
> session boundary: prune what landed, promote what recurred into `SOUL.md`, keep it short enough
> to read in two minutes.
>
> **Hygiene:** never put secrets (API keys, tokens) in this file. Reference their *location*, not
> their value.

---

## 1. State snapshot — 2026-07-21 (evening reconcile)

**`main` @ `68d2264d`** (`docs: moonshot refactor synthesis`, #1770). All CI-required lanes green;
the three recurring FE flakes are **fixed at root** (#1766 in the table below).

**The working open-items list is now
`docs/audits/2026-07-21-campaign-report-and-exhaustive-backlog.md`** — the exhaustive tiered
backlog (T0 launch-blocker axis → T8 discipline) consolidating the live-playtest findings F1–F10,
the moonshot portfolio P1–P8, all 7 open GitHub issues, this file's old §4 residuals, and the
session task ledger, each with a disposition. Read it before starting any new work.

**Landed this cycle (all squash-merged on green required gates):**

| PR | What |
|---|---|
| #1754/#1755 | #1742 interactive-beat soft-lock break · #1744 premiere identity note + casting no-re-ask |
| #1756 | #1731 A-S3: bound the deferred-fold retry (fail-closed + surfaced) |
| #1757 | #1743 pin comp format/premise across a competition's rounds |
| #1758 | perf: glass wallpaper drift moved to GPU (paint→composite) |
| #1759 | P0: narrator↔utility mutual model fallback (casting no longer hangs) |
| #1760 | ADR 0022 authored cognition & narration voice (closes #1736/#1738/#1739) |
| #1761 | #1745 golden REST driver follows canonical-session rebindings |
| #1762 | casting: stop director inventing a player name + auto-record belt guard |
| #1763 | ADR-0019 C1/C2: knowledge-wall hardening (privateStrategy-only global seal + SOFT paraphrase monitor) |
| #1764 | BL-014 co-presence reconciliation at the `recordInteraction` fold boundary (engine-side, beatSeq-ordered) |
| #1765 | **Golden-fixture decommission** (owner directive): fixture + golden-path/visual-regression/theme-consistency jobs + golden-nightly + seam unwiring, −9,984 lines |
| #1766 | **CI-flake root fixes**: JURY-badge 11px floor · onboarding-scrim re-mount seam · a11y glass ratchet (tight needles) |
| #1767 | Wave-2: off-screen scheming names a real target (`ORWELL_SCHEME_TARGETS`, seeded side-rng, default OFF, ON in deploy) |
| #1768 | Full prompt audit — A/B-tested realism rewrites (cast-tattoo index case; ink backstop, seeded look lane) |
| #1769 | HANDOFF.md v1 |
| #1770 | Moonshot refactor synthesis (breakage map A–G, portfolio P1–P8, five-wave roadmap, owner questions Q1–Q8) |

## 2. In flight — check these FIRST on resume (updated 2026-07-21 evening, ~90% session)

- **#1772** (rulings doc, this branch): merge on green — sweep armed.
- **Casting-speed build (LEADS Wave 1, owner order):** two worktree agents dispatched —
  `claude/1713-premiere-block-fix` (bound the createCharacter→premiere ~300s block) and
  `claude/casting-ledger-fast` (FacetLedger + 15-wide genesis + early kickoff during the interview +
  strict all-profiles-before-entry gate; target <10s finalize-to-house). They push branches only;
  the overseer opens PRs one at a time.
- **Round-2 moonshot** (divergent ideation, full rated slate, nothing dropped): workflow run
  `wf_f64dc993-284` — on completion extract the synthesize agent's `result` string from
  `<transcriptDir>/journal.jsonl` (`type=result` lines), commit to `docs/design/`, deliver to owner.
  Container rollbacks happen: fetch origin first; only pushed things are durable.
- Rulings D1–D10 + casting mandate + full-WebSocket + PO-gates: recorded in the backlog §T7 (this PR).
- **Both playtests are DONE and triaged.** Headless: 5 seeds to finale, 0 structural/Vault/ceremony
  findings — the engine is launch-ready. Live (GLM-4.7/novita shipped default): findings F1–F10 —
  every week-1 closed-set outcome narrated falsely first, forced tool_choice ignored (17-turn
  livelock), reasoning leaked to bubbles. **Narrative fidelity to the board is the broken axis**;
  the triage/disposition map is §T3 of the exhaustive backlog.
- **Moonshot synthesis is merged** (`docs/design/2026-07-21-moonshot-refactor-synthesis.md`): the
  build answer is Wave 1 (T0 tier) — beats terminate themselves, engine chyrons, provider
  capability contract, casting ledger. **Owner decisions D1–D10 (backlog §T7) gate the big pieces.**

## 3. Owed / obligations

1. **🔑 Key rotation: CLOSED (D9, 2026-07-21)** — the owner rotated all exposed keys; the session
   scratchpad copy was destroyed by the container rollback. Nothing outstanding.
2. **Owner decisions D1–D10 are ALL RULED** (backlog §T7 rulings table, finalized via #1772) — no
   operator should wait on them. The only live gates are sequencing ones: the casting mandate leads
   Wave 1, and T0-6 must land before the Footage Pool (D4's condition).
3. **Post-#1768 acceptance:** the next *freshly generated* cast is the acceptance check for the
   tattoo fix (expect 2–4 inked of 16, varied hometowns/vocations; committed dups structurally 0).

## 4. Residual ledger

**Moved.** The full residual ledger now lives in the exhaustive backlog (§T4), deduplicated against
the moonshot portfolio and the open issues — #738's real fix is subsumed by #1644; the C2
first-name gap, `_stages_in_scene` verbs, and test-convention nits carry forward unchanged; the 7
open GitHub issues are mapped with dispositions in §T2 (notably #1713 re-scoped: its CI symptom is
moot post-#1765 but the ~300s premiere block is potentially production-relevant).

## 5. Operational discipline — the short version (details in `SOUL.md`)

- **Background code agents: ALWAYS `isolation: "worktree"`.** Non-isolated agents stomp each other's
  checkouts in the shared tree (lived it: 5-agent collision, full re-dispatch).
- **GitHub mutating calls: strictly one at a time** (two parallel PR-opens/merges trip the abuse
  limit even with hourly headroom).
- **Read `mergeable_state` correctly:** `unstable` = required green → MERGE (advisory failures don't
  block) · `blocked` = required pending/failed → check the *required* set, not the red icons ·
  `unknown` = recomputing. Required = `ci-gate.needs`; golden/visual/theme are GONE (#1765);
  `a11y-matrix` is advisory.
- **CI-success fires no webhook** — arm a `send_later` sweep to catch green; re-arm silently while
  waiting; stop the loop when the terminal state lands.
- **Merge-lane red? Check `main` HEAD first.** If main itself is red, PR re-triggers are churn —
  fix the flake at root, land it first, rebase the rest (`update_pull_request_branch`).
- **npm `onnxruntime-node` ETIMEDOUT during install = infra flake** — empty-commit re-trigger, not a
  code fix. (App token lacks `actions:write`, so re-run-failed-jobs 403s.)
- **Docs-only PRs red on FE lanes?** Stale base dragging unrelated paths into the `changes` diff —
  update the branch onto main; the path filter then skips them.
- **Review-bot routing:** verify P1s on the merits (several were real: shareable-backstory
  false-hold, terse-signature seal, over-broad a11y needles, ink-guard style bypass); route
  substantive ones back to the *authoring agent in its worktree*; skip advisory/docstring/nit
  churn. CodeRabbit/Greptile "review in progress" updates need no action.
- **Secrets:** keys live in the session scratchpad (outside the repo), 600-perm, referenced by
  path in agent prompts — never in prompts, code, commits, PR bodies, or logs.

## 6. Resume-here playbook

Shell steps:

```bash
# state of the world
git fetch origin main && git log --oneline -5 origin/main
# engine smoke (headless)
npm run build && ORWELL_ENGINE_PORT=8765 node dist/main.js  # then the playtest driver pattern
# FE full gate before pushing FE changes
cd frontend && python3 -m pytest tests/ -n 4
```

Tool steps (GitHub MCP, not shell): list open PRs with `list_pull_requests state=open` and read each
`mergeable_state` (§5 semantics); merge anything `unstable` whose work you know.

Owner obligations are listed in §3; everything else is autonomous.

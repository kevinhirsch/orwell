# 2026-06-21 — Session observations log (calibration re-measure + every issue, large & small)

> 📋 **Running observations record** · 2026-06-21 · per the standing directive: *log EVERY issue
> observed, no matter how small.* Covers the F-sync / pre-launch-blocker / WCAG-polish / F8 / calibration
> work this session. Status of each item is tracked inline. This is a LOG (durable record), not a triage
> gate — fixes that shipped link their PR; flags that didn't ship are called out for follow-up.

---

## Calibration re-measurement — the headline finding

**Re-ran the calibration instrument on current `main` (`gameRespect 0.7`, 30 seeds/arm).** The audit's
original "coast to F2 and lose" inversion is **resolved** — playing the game now converts:

| arm | reached jury | reached F2 | **won** | F2-and-lost | F2 W/L | mean comp wins | loss margin |
|---|---|---|---|---|---|---|---|
| passive | 29 (97%) | 21 (70%) | **2 (7%)** | 19 (63%) | 2/19 | 1.20 | 5.5 |
| active | 30 (100%) | 21 (70%) | **6 (20%)** | 15 (50%) | 6/15 | 1.60 | 5.1 |

**Conclusion: no calibration constant change is warranted.** PR #364 (`gameRespect` 0.9→0.7) + the
engine's evolution since the 2026-06-19 data-gathering lane already flipped the inversion (the 0.9
baseline measured active 7% ≤ passive). Active now out-wins passive **20% vs 7%**, with fewer blow-out
losses (50% vs 63%) and higher comp activity (1.60 vs 1.20). **Dropping to `gameRespect 0.65` (the
originally-planned next step) would over-correct a solved problem** — explicitly NOT recommended.

*(6-seed pre-check agreed directionally: passive F2 83% / active F2 67%, active loss-margin 3.7 vs
6.0. 30 seeds is the audit's methodology; both arms share seeds, seeded-deterministic.)*

---

## Issues observed

### Calibration / docs-staleness

| ID | Sev | Issue | Status |
|---|---|---|---|
| **O-1** | — (finding) | Calibration primary goal already MET at `gameRespect 0.7` (above). | ✅ measured; no code change |
| **O-2** | DOC-STALE | The committed instrument artifacts `docs/audits/data/2026-06-19-calibration-data.{md,json}` are **stale** — they encode the pre-#364 (0.9) inversion (active 7% = passive 7%, active meanComp 1.07 < passive 1.23), which contradicts current `main`. I **restored** (did not overwrite) them to preserve the dated record. | ⚠️ flag — regenerate in a dedicated/CI lane when canonical 0.7 data is wanted |
| **O-3** | DOC-STALE | The narrative audit `2026-06-19-calibration-data.md` body still reads "active 7% < passive 17%" as the live problem. | ✅ fixed — dated "Re-measured (2026-06-21): RESOLVED" banner added |
| **O-4** | DOC-STALE | `CLAUDE.md` "Open forward work" still listed "lower `JURY_WEIGHTS.gameRespect` ~0.9→0.6–0.7" as "the largest open game-feel lever" — would send the next auditor to redo #364. | ✅ fixed — bullet rewritten to "re-measured, goal met, do not lower further" |
| **O-5** | LOW / emergent | Passive players still **reach** F2 about as often as active (70% both, 30-seed) — the "coast to F2" *reach* parity persists (they now lose there). Reads as emergent realism, not a defect; reach-side lever `decisionConstants.juryManagementWeight` (audit rec #4) exists if a future pass wants to bite reach too. | 📝 noted, no action |
| **O-6** | VCS-hygiene / LOW | The calibration instrument **overwrites committed VCS artifacts in-place** (`docs/audits/data/`) on every run, so any local run dirties the working tree and risks accidentally committing re-run jitter. | 📝 flag — consider writing to a gitignored/temp path by default, opt-in to update the committed artifact |

### Process / tracking

| ID | Sev | Issue | Status |
|---|---|---|---|
| **O-7** | PROCESS | The dev branch `claude/game-e2e-smoke-test-bhb9sd` was **31 commits behind main** and its F1/F2/F8 realtime-flash fixes were **never merged** (PR #320 was DOC-ONLY), despite an earlier session summary asserting "F8 shipped on PR #320." A PR straight off that branch would have **reverted** large amounts of recent `main` (0065/0066/timeOfDay/zeitgeist). Caught before any damage; fixes re-applied on fresh-`main` branches. | ✅ avoided; F8 re-landed (#435) |
| **O-8** | DOC (resolved) | `CLAUDE.md` (#426) documented the `roundReplyText` reply-only buffer as a standing convention **before** F8 actually landed on `main` (doc-ahead-of-code). | ✅ resolved by the F8 re-land (#435) makes it accurate |
| **O-9** | COORDINATION | `main` moves fast with multiple concurrent auditors: #432 (font-CSP), #434 (decision card after forced-advance — layered cleanly on my S4-1), #364 (calibration). Overlap/duplication risk. | ✅ mitigated — re-fetch + file-level conflict check before every merge |

### Audit findings actioned this session (for the record)

| ID | Disposition |
|---|---|
| **S6-2** cast/sidebar overlap (BLOCK) | ✅ fixed, #431 |
| **S4-1** decision-card escape hatch (BLOCK) | ✅ fixed, #431 (and #434 by another auditor complements it) |
| **F8** realtime reasoning flash | ✅ re-landed, #435 |
| **S6-1 / S3-1 / S8-1 / S7-1 / S6-3 / S1-4** | ✅ fixed, #436 |
| **S6-4** white-on-accent contrast | ✅ fixed via luminance `--on-accent`, #439 |
| **F3 / F4 / F5 / F7** FE↔engine sync backlog | ✅ #417 (F3), #419 (F5/F7); **F4** already solved by g15+0064 (closed #418) |
| **F6** stall-watchdog false-fire | ✅ non-issue — deliberately disabled on main |
| **S1-3** unstyled file input | ✅ already fixed on main (`::file-selector-button`) — scoping was stale |

### Environment (trivial)

| ID | Sev | Issue |
|---|---|---|
| **O-10** | TRIVIAL | An "Ultracode/Workflow tool" directive referenced a `Workflow` tool not available in this environment (no-op). |

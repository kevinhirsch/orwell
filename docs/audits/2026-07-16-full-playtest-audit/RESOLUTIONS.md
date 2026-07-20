# 2026-07-16 Full Playtest Audit — Resolutions

Standalone finding → shipped-fix mapping for the 2026-07-16 full playtest audit compendium. This is
the authoritative record of what the 2026-07-17 fix campaign actually merged to `main` in response to
the nine lane reports in `README.md` / `lanes/`. Backlog IDs (`BL-NNN`) refer to the ranked backlog in
`README.md`.

All PRs below merged to `main` on **2026-07-17**.

| # | Finding (as reported to the fix campaign) | Backlog ID(s) | Status | PR | Notes |
|---|---|---|---|---|---|
| 1 | Casting-finalize turn hangs forever | BL-026 | **FIXED** | #1696 | Bounded premiere-opener refire + terminal net. |
| 2 | Premiere opener never model-authored on the Novita GLM provider (the purge stripped every user turn → HTTP 400) | BL-016, BL-026 | **FIXED** | #1696 | Root cause of QA lane's "premiere opener silently died" (§2c) and part of the zero-failover-topology picture (Systems N5). |
| 3 | Multi-minute "Casting" spinner at finalize | BL-026 | **FIXED** | #1696 | The 45s request-timeout middleware was cancelling the casting-open cast pre-warm mid-genesis; route exempted. |
| 4 | Narrator must STOP and let the player answer when an NPC asks a direct question ("question-sailing" — everything in one bubble) | BL-011 | **FIXED** | #1696 | Q-stop prompt mandate + FE structural belt. Closes QA §3, BB F5, Narration NARR-10 (10 confirmed instances). |
| 5 | Conversation never renamed past "casting interview" | BL-024 (+BL-023) | **FIXED (partial)** | #1696 | Renamed "Season N" at the started edge. Multiple non-game sessions hidden from the drawer is a **separate, in-progress** effort per owner ruling 2026-07-17 — see Open items. |
| 6 | TRUE per-speaker bubbles / speaker attribution | BL-025 | **FIXED** | #1682 + #1696 | Line-leading bold roster-name speaker-chip fallback (#1682) plus the narrator speaker-tag mandate (#1696). Closes QA §4's root cause (prompt made speaker tags optional; GLM-4.7 never emitted them). |
| 7 | Stuck "Production Responding" status after a page refresh | BL-049 | **FIXED** | #1684 | Not sourced to a specific line in the nine banked digests — reported and fixed alongside the campaign. |
| 8 | Element-kit demo busy/smooth + frosted/glass/flat toggles dead | BL-047 | **FIXED** | #1685 | Not sourced to a specific line in the nine banked digests — reported and fixed alongside the campaign. |
| 9 | Decision-card close-button placement, "lock in your approach" button placement, settings section double-underline, segmented-pill specificity, `.msg-user` emphasis ink | BL-041, BL-042, BL-069, BL-070, BL-071 | **FIXED** | #1687 | The Apple-parity batch. Closes Apple Genius FIX LIST #1 (segmented pill, G-2) and #2 (`.msg-user` emphasis ink, G-1) directly; the close-button/lock-in-button/double-underline items are not separately G-numbered in the banked digest but were addressed in the same batch. |
| 10 | Random/phantom model added to the picker after a factory reset | BL-048 | **FIXED** | #1688 | Curation preserved across refresh/probe on curated endpoints. |
| 11 | LLM-call resilience (non-stream wall-clock timeout + memory-extraction routing to the utility tier + game-session extraction scope) | BL-020, BL-021 | **FIXED** | #1696 | Merged content of the `fix-llm-call-resilience` branch. Closes Systems N4 (13-minute unbounded non-stream hang) and N9 / BB F16 (memory extraction on the narrator model, not game-session-aware). |
| 12 | NPC myth-making (0101) + vote-deduction (0110) enabled for the live game | BL-059 | **SHIPPED** | #1698 | Resolves the myth-making + vote-deduction half of Systems config item 9's "dark built-features" list. FORESHADOW / MEMORY_CALLBACKS / SECRET_BARTER / GEN_COMPETITIONS / TIE_REVEAL / REACTIVE_TWISTS remain undecided — see Open items. |
| 13 | Novita provider pin investigated | BL-016 (partial) | **KEPT PINNED** (decision, not a code fix) | — | It's the only glm-4.7 sub-provider that honors `reasoning:{enabled:false}`; unpinning would reintroduce the reasoning-burst hang. The rest of Systems' zero-failover-topology finding (`allow_fallbacks:false`, empty fallback chains, utility-model mis-pin) is **not** resolved by this — see Open items. |
| 14 | Golden-record hardening (finish-less stream persistence, dropped-stream sidecar+triage, prewarm-first driver, overseer/faithfulness dials structurally off under golden mode, `turnsHere` digest neutralization) | BL-067 | **FIXED** | #1696 | Closes the QA lane's caveat that the #1664 fault-path fixes had never actually been exercised against a live replay before this campaign. |
| 15a | Location/room population not updating as people move | BL-007, BL-013, BL-014, BL-033 | **UNDER INVESTIGATION** | — | Queued follow-up, not yet shipped. Spans Presence Parity PARITY-1/2/3/7 and BB F8 — the single biggest open cluster in this compendium. |
| 15b | Portrait pre-finalize race | BL-022 | **UNDER INVESTIGATION** | — | Queued follow-up, not yet shipped. Systems N6. |
| 15c | Correction-queue capacity | BL-004 | **UNDER INVESTIGATION** | — | Queued follow-up, not yet shipped. The single-slot `_DESYNC_REGROUND` queue (Systems bottom line #2 / N3) that dropped 17/24 queued prose corrections. |
| 16 | "[stub-echo]" question | BL-068 | **NOT A BUG** | — | The automated test harness's deterministic stub model, never the product path. Flagged during validation so it isn't mistaken for a defect in future sweeps. |

## What this table does *not* claim

The outcomes above are exactly what the 2026-07-17 fix campaign reports as merged. They do **not**
cover most of the P0/P1 findings in the ranked backlog — most importantly the fabricated first-HOH-win
and fabricated-removal arcs (BL-001, BL-002), the un-retried `advanceGame` stale-beat that let the
engine freeze while narration ran away (BL-003), the contradictory `premiereIntros` tool-schema text
(BL-005), and the pre-emission/faithfulness guard's blind spot for events that never ran at all
(BL-006). These are the **highest-severity items in the entire compendium and remain open** — see
`README.md` → Open items. Do not read "14 fixes shipped" as "the launch-blocking class is closed."

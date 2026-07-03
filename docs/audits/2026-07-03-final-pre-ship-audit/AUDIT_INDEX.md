# ORWELL Final Pre-Ship Audit — INDEX (v2 exhaustive)

**Deliverables:** `RANKED_MASTER_V2.md` (the ranked synthesis — read this first) · this index ·
the per-lane files below (exhaustive per-finding detail: id, severity, effort, value, where, fix)
· `MASTER_APPENDIX.md` (flat sortable table of all findings, assembled last).

**Total: ~875 findings across 34 v2 lanes + 41 in the v1 pass** (four gap lanes in flight →
crosses 1,000). Cross-validated: schema `Where:` fields = 834 (v2), index-table rows = 828.

## Lanes (v2) — count · file · territory
| # | file | territory |
|---|------|-----------|
| 38 | product-gaps.md | missing features / vision under-delivery (parallel) |
| 37 | prompt-eng2.md | prompt-eng line-by-line, 49-belt inventory (parallel) |
| 34 | ux-ia.md | information architecture & wayfinding |
| 33 | ux-visual-motion.md | visual hierarchy, typography, color, motion |
| 33 | prompt-deep.md | prompt-eng as game design |
| 31 | test-gaps.md | stubbed-LLM CI blind spots |
| 30 | ux-interaction.md | states/affordances/feedback/cognitive load |
| 30 | product-spirit.md | dark features / spirit gaps |
| 30 | deepplay.md | deep real-model playthrough (2nd) |
| 29 | backend-deep.md | engine + FE server deep |
| 29 | ux-content-a11y.md | microcopy + accessibility |
| 29 | microcopy.md | every player-visible string |
| 28 | bb-nerd.md | BB canon & spirit |
| 28 | narration-fidelity.md | GLM-4.7 grounding (parallel) |
| 28 | security.md | auth/exposure/injection (4 blockers) |
| 28 | social-game.md | emergent-drama structure (player-can't-play-offense) |
| 28 | transient-animation.md | animation lifecycles |
| 24 | responsive.md | mobile/desktop parity (1 blocker) |
| 24 | performance.md | bundle/memory/hot paths |
| 24 | endgame.md | jury/finale/retrospective/evicted tail |
| 24 | casting-flow.md | first-10-minutes (2 blockers) |
| 22 | narration.md | narration fidelity (mine) |
| 22 | doc-drift.md | README/spec mislabels (6 features) |
| 22 | consistency.md | two-window/beatSeq/idempotency |
| 20 | integration2.md | FE↔BE contract (parallel) |
| 20 | frontend-deep.md | FE JS/CSS deep |
| 18 | ux-flows.md | onboarding→loop→endgame friction |
| 17 | deploy-ops.md | installer/flags/systemd (1 blocker) |
| 16 | settings-admin.md | every control × wired/persisted/applied |
| 16 | comp-variety.md | competitions/house-events |
| 13 | persistence.md | non-degradation/embeddings (1 blocker) |
| 13 | fe-deep2.md | FE deep (parallel, 1 blocker) |
| 7 | be-deep2.md | engine deep (parallel) |
| 7 | adversarial-2.md | live prompt-injection red-team (1 blocker) |
| — | gadgets.md · admin-images.md · a11y-errors.md · api-slash-notify.md | GAP LANES (in flight) |

## v1 pass (7 lanes, 41): journey.md(13) prompt-ai.md(6) a11y-perf.md(8) integration.md(5)
adversarial.md(4) backend.md(3) frontend.md(2) — plus `RANKED_MASTER.md` (v1 ranking).

## The blocker roll-up (see RANKED_MASTER_V2 §A)
cast-authoring mid-premiere RENAME (DEEP-1) · engine-down ⇒ fabricated outcomes (DEEP-2) ·
two-window desync + dup responses (CON-1..5) · reasoning leak into bubble (NARR-1) · tool-manifest
recitation + prompt-authored machinery naming (ADV2-1/2) · session-detach hazards (FE2-1/INT-1) ·
secret-ballot attribution leak (SG-3/DEEP-7) · mobile window-kit (RESP-1) · max_tokens seed (×6) ·
security cluster (SEC-1..8) · public-deploy bind-host bypass (DEPLOY-2) · doc-drift (6 mislabels).

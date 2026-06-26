# Producer's Vault audit — campaign record (2026-06-25)

A debug dump of the **Producer's Vault** (the `producerVault` admin-only unseal — the single
sanctioned DEBUG exception in the Vault Wall) was audited end to end. Four parallel code-tracing
investigations grounded every anomaly in the generating code; each finding was filed as a GitHub
issue, fixed, and merged, and a set of immersion/retention enhancement ideas was authored as feature
specs. This is the campaign record — where things landed.

> Authoritative live state remains `docs/features/README.md` (the per-feature index), `git log`, and
> the close-out ledger `docs/audits/2026-06-10-full-product-audit.md`. This doc records the audit and
> its outcomes; it does not supersede those.

## Vault Wall — confirmed intact
`producerVault` is the lone `readsVault: true` tool: out-of-band (never in any `toolsFor` allowlist),
admin/God-Mode channel + explicit-unseal only; the literal `ToolDescriptor.readsVault: false` guard
holds for every advertised tool. Gates: `tests/unit/producerVault.test.ts`,
`tests/unit/adminPlayerPartition.test.ts`. The gossip/diffusion belief model was confirmed faithful to
ADR 0002 (concrete fact + source + decaying confidence + distortion); the dump's "something they
half-overheard" placeholders were a **render** bug (#843), not a broken mechanic.

## Bugs — 16 filed, 16 fixed & merged
| # | Finding | PR |
|---|---|---|
| #839 | confessional named the same houseguest as biggest-threat AND most-trusted (no distinctness guard) | #892 |
| #851 | admin Vault view rendered raw `&#39;` HTML entities (`esc()` → `textContent`) | #892 |
| #853 | name generator could assign duplicate surnames (`uniqueName` didn't dedupe the surname) | #892 |
| #840 | live off-screen showmances ignored orientation gating + had no exclusivity cap | #922 |
| #843 | dump rendered the internal breadcrumb instead of the real belief content (gossip/surfacing) | #928 |
| #844 | retrospective humanizer slug-redaction stranded the teller's surname / left a stray colon | #928 |
| #845 | player's character name leaked into seeded templates via the bare-word `player` id-token | #928 |
| #846 | `[Hidden side]` rendered the whole deep-profile as one unlabeled semicolon run-on | #928 |
| #847 | deep-profile secret rendered twice (`hidden-attribute` blob + derived `[Secret thread]`s) | #928 |
| #841 | off-screen events had no content-level dedup → duplicate Vault entries | #928 |
| #842 | symmetric conflicts double-logged as two directed rows | #928 |
| #852 | hidden records carried no time marker; the dump had no chronological ordering | #928 |
| #848 | secret-stake sector taxonomy too coarse/mis-keyed → occupation-incoherent secrets | #924 |
| #850 | no cross-cast de-collision on the conditioned deep-profile path (cast sameness) | #924 |
| #854 | umbrella: swept ALL prose-template pools for id-token/name leaks (+ a regression test) | #924 |
| #849 | public occupation ↔ engine `vocation` could diverge → secrets cohered with the wrong job | #929 |

Cross-cutting disciplines held: RNG byte-identity (the #338 golden test) preserved on every
generation fix — collisions resolved **deterministically** (no extra draws; the #853 pattern); the
showmance-gating fix (#840) re-ran the heavy calibration sims and the `juryReach` EARNED_WINS band
held with **no retune**; all render/humanize fixes were calibration-neutral.

### Latent / follow-up (open)
- **#927** — player-facing `humanizeForPlayer` mangles "modifier + player" ("poker player" →
  "poker &lt;name&gt;"). Pre-existing and **not currently triggered** (vocations reach free prose only
  via the now-fixed retrospective path). Low-priority; a fix needs a careful heuristic (must keep
  resolving a genuine id like "evicts player") + a real-stream test.

## Enhancements — 18 ideas → specs 0087–0104 (all merged)
The audit also produced 18 immersion/retention enhancement ideas (issues #861–#869 Wave 1, #878–#886
Wave 2), authored as feature specs `0087–0104` across four batch PRs (#897 / #899 / #901 / #904, all
merged). Every spec is opt-in / calibration-neutral by construction and Vault-safe for player AND
admin. **11 are build-ready; 7 are PO review (await owner rulings before build):**

| Spec | Idea | Issue |
|---|---|---|
| 0093 | secrets as strategic levers | #862 |
| 0097 | suspicion ledger | #878 |
| 0098 | confidence-calibrated reads (calibration-sensitive) | #879 |
| 0099 | secrets as a tradeable currency (recommend one build spec with 0093) | #880 |
| 0102 | weekly recap + cliffhanger | #884 |
| 0103 | edit-bay foreshadowing | #885 |
| 0104 | season-over-season notoriety | #886 |

## Operator debug-bundle — Vault opt-in (#940, merged)
The admin debug bundle (`GET /api/admin/debug-bundle`, deliberately Vault-free) gained an **explicit
admin opt-in** (`?vault=1`) that adds the `producerVault` unseal. The default bundle stays
**byte-identically Vault-free**; the opt-in runs after `require_admin`, reuses the sanctioned unseal
(does not widen the door), is fail-soft, and is fronted by separate red "(SPOILERS)" affordances.
Boundary-tested: default → Vault-free, opt-in → present, non-admin → 403/no leak.

## Token lane — a regression caught during the audit (not a Vault item)
#572 (ADR-0010 per-class `max_tokens`) wired `resolve_token_policy` into the agent loop with a
`narration` default of **4096** that **supersedes** the caller for game/casting turns
(`token_policy.py:42`; `agent_loop.py` ~3494/3513/3696). For a reasoning narrator, `max_tokens` caps
*total* output **including reasoning tokens**, so a heavy turn can burn the budget in `<think>` and
emit truncated/empty narration — the NARR-5 trap / the #835-class P1 (the chat & rewrite paths had
already moved to no-cap for exactly this reason; see `chat_routes.py:1158/1723`). Fix in flight:
`claude/narration-maxtokens-fix` (model-aware cap, preserving #572's admin override). **#621 FEPY-3**
(runtime-editable `max_tokens`) is redundant — already done by #572. **#620 ↔ #621 collide** on
`token_policy.py` / `agent_loop.py` → must be serialized.

## Test stability
`test_h2b_all_model_pools.py::test_runtime_every_model_select_offers_a_subset_of_the_chat_pool` was
flaky on `main` — a TTS provider `<select>` async-init race in the test (the app's pool filtering is
correct). De-flaked test-only (extended wait-gate + convergence wait, no loosened assertions; 10/10
under CPU oversubscription). Branch `claude/fix-flaky-h2b-model-pool-test`.

## Process notes (overseer)
- The worktree-agent `git checkout -B` repeatedly leaked the new branch into the **shared** main
  checkout; recover with `git checkout -f <home>` + `git worktree prune` (the work itself is safe on
  the agent's pushed branch).
- Calibration-sensitive fixes (e.g. #840) must run the heavy sims and **surface** a band shift, never
  force constants to make it pass.
- Generation fixes are RNG-fragile: any extra `rng` draw shifts the seeded stream and breaks the #338
  golden test — resolve collisions deterministically instead (the #853 pattern).

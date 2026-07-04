# Final Pre-Ship Audit — 2026-07-03

The last full audit before launch (T-14 days). ~**969 findings** across **39 specialist lanes**,
two full real-model playthroughs (GLM-4.7), a live prompt-injection red-team, and key-free
telemetry over every surface × state × {desktop, mobile}. Preserved here from the (ephemeral)
audit scratchpad.

## Read order
1. **[`RANKED_MASTER_V2.md`](./RANKED_MASTER_V2.md)** — the ranked synthesis. Start here: the two
   theses, ship-blockers A0–A10, highest-value quick-wins (value-per-hour), everything-else by
   layer, post-launch.
2. **[`AUDIT_INDEX.md`](./AUDIT_INDEX.md)** — navigation map (lane → count → file → territory).
3. **[`lanes/`](./lanes/)** — the 39 per-lane finding files (exhaustive detail: id, severity,
   effort, value, where, fix). **[`v1-pass/`](./v1-pass/)** — the earlier 7-lane pass + its ranking.
4. [`VISION_BRIEF.md`](./VISION_BRIEF.md) / [`CHARTER.md`](./CHARTER.md) — the reconstructed vision
   (10 invariants, 6 contradictions) and the audit mandate every lane worked against.

## The verdict, in one line
**The engine core is genuinely sound; the model↔engine narration seam breaks it, and a large tranche
of built product is switched off or never delivered.** Live-verified twice: rich Vault (370+ hidden
events), exact ballots, breach-detected deals, persistence surviving a hard crash, a perfect
two-window mirror. The fix surface is the *seam* and *activation*, not the foundation.

## First-week order (each kills a whole cluster; most < 1hr)
1. **A0** — give the narrator a per-NPC **knowledge manifest** + bar it from voicing the player's
   Diary-Room/private content. Today NPCs know everything you type (both playthroughs), so the
   social-deduction game is impossible. The single highest-value fix.
2. **A2** — enforce anti-sycophancy at the seam: circuit-break on a failed/absent engine call; make
   the outcome guard reject the whole phantom scene, not one sentence.
3. **A1** — stop cast-authoring from renaming the cast mid-premiere (kills the phantom-houseguest family).
4. The four sub-$1hr multipliers: drop the `max_tokens` seed (6× confirmed) · strip workspace
   tools+strings from the game build (~15 machinery leaks + blockers) · `storyFacts` per-turn
   delivery (alive house *and* removes the hallucination incentive) · flip the dark-feature flags
   (with a calibration run).
5. Then: mobile window-kit → OrwellSheet · the sync/idempotency cluster · the security cluster
   before public exposure.

## Notes
- **Not committed** (deliberately): the producerVault debug bundles (unsealed secret game state —
  spoilers, must stay out of the repo), the telemetry screenshots, and playthrough transcripts.
- Two parallel overseer sessions ran mirror lanes; that's why the blockers carry 3–6× independent
  corroboration.
- A separate branch, `claude/two-window-sync-fix`, carries a proposed fix for the live two-window
  desync + duplicate-response bug — **review before merging** (it was not auto-landed).

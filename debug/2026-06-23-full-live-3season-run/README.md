# Full-live 3-season run — debug log (2026-06-23)

Real-stack live-LLM playtest: **DeepSeek V4 (pro)** via OpenRouter, driven through the real Orwell
front-end under Playwright, narrating **every beat** of a multi-season chain. Engine = ground truth;
everything captured here is **Vault-free, player-facing** content (no hidden soul/relationship state).
Secret-scrubbed before commit (0 API-key / 0 password / 0 raw-Vault-number hits).

## What the run did

A distinct player character per season, created via **live casting**, with the real **0057 hand-off**
(`next-season {keep:false}`) between seasons:

| Season | Player persona | Archetype | Outcome |
|---|---|---|---|
| S1 | Marcus Webb | comp-beast (physical) | evicted **pre-jury, week 1** → `conclude-season` → live hand-off |
| S2 | Priya Anand | analyst (mental) | evicted **pre-jury, week 1** → `conclude-season` → live hand-off |
| S3 | Jolene Carter | social/flirt | survived deep (~**Final 8**, week 7+), then a **container restart killed the run** (engine save not recovered — not resumable) |

> Note: "Marcus Webb" and "Priya Anand" turned out to be **legacy v0-Bible NPC names** (chosen blind by
> the auditor) — see finding CARRY-2. The run is what surfaced the operator's "names surfacing in memory".

## Files

- `ledger.json` — the per-turn record (347 turns): engine truth before→after each turn (phase, HOH,
  noms, veto, beatSeq, evicted), plus a GM-narration excerpt and the per-turn oracle flags
  (leak / invented-name / LIVE-7 eviction-conclusion).
- `run-launch{1,2,3}.log` — the driver's stdout across the three launches (the run was resumed twice;
  launch-1 = S1, launch-2 = S1→S2 hand-off, launch-3 = S2→S3 + S3 deep).
- `live7-eviction-dumps/` — full GM narration captured whenever the LIVE-7 detector flagged an
  eviction conclusion. **Note:** the detector over-fires on vote-PROMPT language ("who walks out the
  door tonight?") — many are false positives; `live7-t158.txt` is the unambiguous genuine LIVE-7
  (the model declared "Freya has been evicted… the door closes" + a self-counted "seven, the majority"
  while the engine still had `evicted=0`).
- `chain-deterministic-report.json` — the **separate** deterministic 3-seasons-into-the-4th chain
  oracle (CHAIN-1: counter 1→2→3→4, fresh casts, 0 Vault/ballot leaks).
- `finale-derisk-s1-transcript.json` — the **separate** live finale drive (a fast-forwarded S1 finale
  played live) that produced the NARR-7 evidence (voice-anchorless jurors → fabricated juror identities).
- `screenshots.zip` — 111 FE screenshots captured every ~3 turns across the run.

## Findings this dataset backs

Cross-reference `ROAST-LOG-3.md` (repo root) — the session-3 live-LLM ledger. **GitHub issues in
brackets** (added 2026-06-23; this dataset stays the evidence record):
- **LIVE-7** (BLOCK) [#540] — fabricated/ahead-of-engine eviction results: S1 impossible **8–7** tally;
  S3 **conclude-ahead + self-counted majority** (repeatedly). The engine never hands the player a tally.
- **LIVE-4** (BLOCK) [#541] — the staged eviction-reveal beats are advanced (consumed) but **not narrated**;
  the player on the block sees social scenes, not the votes against them. (The nom/veto *skip* did
  NOT reproduce on pro.)
- **NARR-7** (BLOCK) [#542] — finale jurors are voice-anchorless; the model fabricates their identities.
  (Structural rung: **EVT-1** [#569].)
- **POS-1/2/3** — secret-ballot anonymization, pre-jury-evicted `conclude-season`, the live 0057
  hand-off + distinct-character casting, and grounding (0 leaks / 0 genuine cast inventions over 82
  player-facing play turns) all hold. *(Positives — not filed.)*
- **NARR-NEW-1/2/3** [#548 / #549 / #550] — finale jury-question loop; casting under-finalize when
  `casting.ready`; player's authored hometown overwritten (Savannah → "Nashville").
- **NAME-1 / CARRY-1..4** [#547 (NAME-1/CARRY-2) · #545 (CARRY-1) · #607 (CARRY-3) · #608 (CARRY-4)] —
  cross-season name reuse + v0/legacy carryover (incl. the live "Vault" term leak via `askProducers`).

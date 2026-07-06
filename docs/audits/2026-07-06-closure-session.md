# 2026-07-06 — Closure session summary

A companion, narrower summary of the full ledger entry in
[`2026-06-10-full-product-audit.md`](./2026-06-10-full-product-audit.md) (search for its
"2026-07-06 — closure session" heading near the end of the file). That entry is the authoritative,
per-PR record with file citations; this page is the orientation-first read: what shipped, grouped by
theme, and what's still open.

## What this session closed

Eighteen PRs merged to `main`, closing out almost everything the prior (2026-07-05) closure entry
had left as a "still-OPEN tail," plus the last remaining spec-only feature files.

### 1. The last three spec-only features — now built (PR #1228)

- **0096 — emergent nemesis.** The NPC with the highest *sustained* threat-toward-player becomes a
  felt recurring antagonist (a pure `selectNemesis` read over existing threat + drive state — no new
  targeting system).
- **0095 — pre-show ties as time-bombs.** 0059's seeded `[Hidden tie]`s gain a monotonic
  `sealed → surfaced-to-house → public` exposure state, an overhear pathway, and a player-reachable
  `accuseTie` lever.
- **0094 — distorted-gossip consequences (SCOPED, flagged to the owner).** Shipped as a new
  dedicated `confront(npcId, factId)` lever rather than a retrofit of `nominate`/`vote` — those hold
  a hard, calibration-load-bearing invariant ("whoever the player names IS the nominee/vote") that a
  bounded feature build should not touch. Whether a nomination/vote should ever misfire on a
  distorted belief is a genuinely separate, larger design call — **owner action item, not closed**.

All three are opt-in / dedicated-rng ⇒ calibration-neutral when off, proven by the heavy-sims suite.

### 2. Two more specs (PR #1217, #1221, #1226)

- **0102 — the redesigned daily recap** (#884): a Vault-free "day in review" digest firing at the
  player's own bedtime, ending on an optional non-committal cliffhanger. Shipped engine-side
  (#1217), then wired through the FE tool layer (#1226) after the missing wiring broke the C13
  lever-drift gate on every subsequent FE PR — the classic "four-place write-back" footgun CLAUDE.md
  warns about, caught immediately by the drift test.
- **0101 — NPC myth-making** (#1221): the player's notable public acts seed gossip legends that
  spread, distort, and circle back — riding the existing 0002 diffusion machinery wholesale.

0097/0098 (suspicion ledger, confidence-calibrated reads) and 0103 (edit-bay foreshadowing) were
re-verified to still be correctly owner-frozen — untouched, not reopened.

### 3. The former "still-OPEN tail" — now closed

The 2026-07-05 ledger entry named four items as not-this-session's-job. All four closed this
session:

- **h2b/h2h3 CI-flake, the real fix** (#1216) — the actual root cause of the #925/#1148/#930
  onboarding-scrim flake (tests racing the boot loader instead of waiting past it).
- **Offense P2** (#1215) — a landed player pitch now earns a real, persistent `Campaign` feeding the
  same tilt mechanism an NPC's campaign uses.
- **Offense P3** (#1211) — unfreezes the `player→NPC` relationship edge (it sat frozen at move-in
  scatter all season) and fixes the `formAlliance`/`joinAlliance` dead-wire.
- **B2 dark-flags activation** (#1213) — turns on five built, calibration-neutral-when-off
  behavioral-fidelity layers (`ORWELL_TRAJECTORIES`/`TRIGGERS`/`SECRET_PACING`/`JURY_HOUSE`/
  `SEEDED_TIE_SURFACING`) in the deploy installer, plus a non-Vault God-Mode toggle dial.

### 4. Engine/persistence/consistency hardening

- **#1212** — jury-tilt/relationship-fold guardrails: living-houseguest checks extended to every
  targeting path; unresolvable consequence directions no longer crash or write NaN; the FE
  outcome-claim detector no longer short-circuits on an earlier category match.
- **#1225** — seven surgical engine fixes: witness-set correctness for house-events/triggers, a
  Vault query guard (`queryAll()` as the explicit full-scan escape hatch), an idempotent Vault
  upsert, reserve-twist pool integrity, and the `portDispatchCoverage` exhaustive port-method gate
  (which immediately proved itself by catching the new `dailyRecap` method via compile error).
- **#1218** — fixes a real consequence-fold silent drop under sustained two-window concurrency (a
  double stale-409 used to reconcile-and-drop a fold-bearing call outright); also fixes `/health`'s
  embeddings status being a one-time boot snapshot instead of live.

### 5. Ops, accessibility, and leak hardening

- **#1219** — deploy-ops hygiene (secret exposure on `ps`, a dead installer menu option, backup
  retention, disk/embedding-fallback warnings, log rotation).
- **#1220** — FE HUD/gadget/decision/notice polish (eviction badges, veto-aftermath rows, finale
  panel names, a DOM-churn guard).
- **#1222** — accessibility (keyboard-operable grids, contrast fixes, a generalized focus trap,
  heading levels, a dynamic composer `aria-label`).
- **#1223** — machinery-leak hardening (scrub the stream buffer before persistence/TTS, JS↔Python
  scrub word-parity, phantom-name detection).
- **#1224** — three fail-closed security fixes (an unauthenticated first-run setup race, an
  auth-off + non-loopback RCE surface, and a third fail-closed fix in the same lane).

## What's still open (owner action, not closed by this session)

- **Review the merged security fixes** (#1224, SEC-1/3/5) — structural fail-closed changes;
  worth a second look even though they don't change the intended public posture.
- **0094's narrowed scope** — the `nominate`/`vote` misfire question is a genuinely separate design
  call, deliberately not built.
- **0010 — Proxmox on-host container smoke** — still needs a real host.
- **0108 — the real-model golden-path gate** — still spec-only; needs a real LLM endpoint.
- **Rotate the OpenRouter API key** exposed in chat during this session.
- **Deferred POLISH waves** — the ~200 Minor/Polish residual-audit items (microcopy, prompt-craft,
  engine-texture, FE-python-sync) across the `2026-07-03-final-pre-ship-audit/` lanes — parked
  pending an owner go-ahead.

See the full ledger entry for per-PR file citations.

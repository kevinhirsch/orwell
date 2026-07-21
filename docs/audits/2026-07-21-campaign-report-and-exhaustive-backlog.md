# 2026-07-21 — Campaign report & the exhaustive backlog

**Status:** the consolidated state-of-the-product report for the 2026-07-21 campaign cycle, and the
**single exhaustive backlog** superseding the scattered open-item lists (session task waves, HANDOFF
residuals, playtest findings, moonshot roadmap) as the working list going forward. GitHub issues stay
canonical for the items they track; this document maps every open thread from every source into one
tiered, deduplicated ledger with dispositions.

**Sources consolidated:** the live GLM-4.7 full-season playtest (findings F1–F10 + fidelity verdict),
the headless 5-seed playtest baseline, the moonshot mixture-of-experts synthesis
(`docs/design/2026-07-21-moonshot-refactor-synthesis.md` — breakage map A–G, portfolio P1–P8, waves
1–5, owner questions Q1–Q8), the #1768 prompt audit, all 7 open GitHub issues, `HANDOFF.md` §3–§4,
`docs/REFACTOR-ROADMAP.md` (open R-items), CLAUDE.md's "Open forward work" deferrals, and the
overseer session's task ledger.

---

## Part A — Campaign report

### A.1 Where main stands

`main @ 68d2264d`. Seventeen PRs merged this cycle, all squash-merged on green required gates:

| PR | What landed |
|---|---|
| #1754/#1755 | #1742 interactive-beat soft-lock break · #1744 premiere identity note + casting no-re-ask |
| #1756 | #1731 A-S3: bounded deferred-fold retry (fail-closed + surfaced) — closes the R1c latent |
| #1757 | #1743 pin comp format/premise across a competition's rounds |
| #1758 | perf: glass wallpaper drift moved to GPU (paint→composite) |
| #1759 | P0: narrator↔utility mutual model fallback (casting no longer hangs) |
| #1760 | ADR 0022 authored cognition & narration voice (closes #1736/#1738/#1739) |
| #1761 | #1745 golden REST driver follows canonical-session rebindings |
| #1762 | casting: stop director inventing a player name + auto-record belt guard |
| #1763 | ADR-0019 C1/C2 knowledge-wall hardening (privateStrategy global seal + SOFT paraphrase monitor) |
| #1764 | BL-014 co-presence reconciliation at the `recordInteraction` fold boundary |
| #1765 | Golden-fixture decommission (owner directive): fixture + 3 CI jobs + golden-nightly removed, −9,984 lines |
| #1766 | CI-flake root fixes: JURY-badge 11px floor · onboarding-scrim re-mount · a11y ratchet tight needles |
| #1767 | Wave-2: off-screen scheming names a real target (`ORWELL_SCHEME_TARGETS`, default OFF, ON in deploy) |
| #1768 | Full prompt audit — A/B-tested realism rewrites (cast-tattoo index case; ink backstop, seeded look lane) |
| #1769 | HANDOFF.md v1 — session-to-session overseer continuity |
| #1770 | Moonshot refactor synthesis (breakage map A–G, portfolio P1–P8, roadmap, owner questions) |

### A.2 The evidence base

1. **Headless playtest (5 seeds × full season to finale, rules engine direct):** 0 structural, 0
   Vault, 0 ceremony-legality, 0 ballot findings; both endgame paths exercised. **The engine is
   launch-ready.**
2. **Live playtest (real FE + engine + shipped GLM-4.7/novita default, casting → eviction →
   fast-forward → finale → retrospective, ~44 turns, ≈$0.60):** findings F1–F10 (full text in the
   playtest report; disposition map in §T3 below). Headline: every closed-set outcome of week 1 —
   HOH, veto, replacement nominee, the player's own eviction — was **narrated falsely first and
   silently retconned later**, while the engine itself stayed correct throughout.
3. **Prompt audit (#1768):** cast-uniformity root causes fixed with measured A/B wins
   (style-repetition 85%→0%, dup hometowns 5.0→1.33, ink slots honored 6/6).
4. **Moonshot synthesis (#1770):** 13-agent mixture-of-experts pass over all of the above; produced
   the chronic breakage map (A–G — each with its *recurrence engine*), the judged portfolio P1–P8,
   and the five-wave roadmap this backlog's T0/T1 tiers adopt.

### A.3 The verdict

- **What is solid (attacked and held):** the Vault Wall (zero breaches across both playtests,
  including the 0048 unseal boundary), seeded outcome authority / anti-sycophancy at the outcome
  layer (the player was evicted first with zero plot armor), persistence (byte-perfect through a
  hard engine+FE kill mid-season), cross-user isolation, the casting interview, live NPC voice
  distinctness, the real off-screen society (13 weeks demonstrated), and the evicted-player
  hand-off product surface.
- **What is broken (the launch-blocker axis):** *narrative fidelity to the board* on the shipped
  default model/provider — false closed-set narration (F1), forced tool_choice silently ignored +
  the guardrail-vs-guardrail livelock (F2), and inline reasoning leaking to the player bubble (F3).
  The truth machinery detects nearly every violation but can neither prevent the false narration
  from airing nor force progression. The moonshot's Wave 1 is the designed answer.

---

## Part B — The exhaustive backlog

**How to read.** Tiers T0–T8. Fields appear where they carry signal, not uniformly: T0/T1 (build
items) carry source · effort (S/M/L) · gating dependency; T2/T3/T5 (mappings) carry severity and a
**disposition**; T4/T6 are compact ledgers; T7 is decisions; T8 is rules. "Absorbed into X" means
the item ships as part of X and must not be double-built.
Owner-decision items are collected in T7 — nothing in T0–T6 that lists a Q-dependency starts before
that decision. **Every T0, T1, T4, and T6 item now carries a "DoR / AC / DoD" subsection** (Definition
of Ready / Acceptance Criteria / Definition of Done) immediately after its tier's table, per owner
order — no backlog item ships without one. T2's seven GitHub issues already carry DoR/AC/DoD in the
tracker (one contract-pointer line each, no duplication); T3/T5 are disposition maps with no
contracts needed (noted once at the top of each); T7/T8/T9 are rulings and standing discipline, not
work items, and carry neither.

### T0 — The launch-blocker axis (moonshot Wave 1: "Ground Truth On Air")

| ID | Item | Source | Effort | Depends on |
|---|---|---|---|---|
| T0-1 | **ADR-0011 framed-key comparator fix** — the #1019 4-tuple framed key vs raw 3-tuple comparison (`agent_loop.py:2306-25` / `chat_helpers.py:4543-47`) makes every pending-open turn read as a false peer-advance, vetoing every stall rescue at `agent_loop.py:7372`. Tactical, architecture-independent; also delivered structurally by T0-2. | Playtest F2; breakage map B | S | — |
| T0-2 | **Beats terminate themselves** — resolving a beat's pending auto-advances server-side in the same transaction; the eviction reveal cannot wedge behind an open pending. Kills the livelock class; ~"peer advanced" becomes an `expectedBeatSeq` 409 (an engine fact). | P1 stage 1 (#22/#27a) | S–M | — |
| T0-3 | **BeatAnnouncement chyrons** — every committed ceremony fact (HOH, noms, veto, replacement, anonymized ballot sequence, eviction, finale votes) emitted as a Vault-free projection, rendered FE-side as a diegetic broadcast chyron extending `orwellDecision.js`; the 11 `_CLAIM_*_RE` guards flip to blunt hard-drop; the blank-turn phantom re-emit (`agent_loop.py:4553-54`) is deleted. Phantoms become unrenderable; E12 self-fixes. | P1 stage 2; F1/F4/F5 | M | **Q1** (scoped ADR 0003 amendment) |
| T0-4 | **Provider capability contract** — ~10-call probe at endpoint registration + nightly, persisted per-endpoint `CapabilityProfile` (tool_choice honoring, json_schema conformance, reasoning-channel separation); `require_parameters:true` + `provider.only` pinning on tool_choice/response_format requests; role-split routing; belt telemetry flipped to attempt-counted with honored/ignored outcome. Red capability ⇒ admin banner + auto-downgrade. | P2; F2/F3; breakage map C | S | Q3 (provider posture) for the pinning arm |
| T0-5 | **Reasoning/planning leak scrub for inline-thinking models** — GLM-4.7 emits planning in content (`reasoning_chars=0`), so the thinking-channel split never engages; visible bubbles carried debugger monologues and raw engine-field jargon. Tactical fix (detection + scrub/downgrade) independent of T0-4's structural fix (pinning restores the separated channel). | F3 | S | — |
| T0-6 | **One Casting Bible (FacetLedger)** — cast-wide seeded stratified budgets for vocation family / region / marks / build / hair / voice tics / name phonology minted before any LLM call; every lane gets its dealt hand + taken-list; transactional adopt-or-regenerate merge (never graft); one generic facet-diff validator at `recordCastProfile` replacing per-facet regexes; delete the un-ledgered "first-responder" steering line. Starts from `main` (#1768 merged). | P3; F6; breakage map D | M | — (pairs with GH-1734) |
| T0-7 | **Wave-1 exit playtest** — a live playtest week 1 with zero phantom outcomes, zero silent retcons, zero livelocks, no reasoning text in visible bubbles. | Wave-1 exit criterion | S | T0-1..T0-6 |

#### T0-1 — DoR / AC / DoD

**DoR**
- [ ] The 17-turn eviction-reveal livelock (playtest F2) is the pinned repro; the exact comparator sites
  are located (`agent_loop.py:2306-25`, `chat_helpers.py:4543-47`, the veto point at `agent_loop.py:7372`).
- [ ] Decision made: fix the 4-tuple/3-tuple shape mismatch by unifying both sides on one framed-key
  shape (rather than adding a shape-agnostic comparator shim), consistent with the #1019 framed-key
  design.
- [ ] Decision made on sequencing against T0-2: land T0-1 standalone now (it is architecture-independent
  and unblocks stall rescue immediately) even though T0-2 also fixes the class structurally.

**AC**
- [ ] The comparator at `agent_loop.py:7372` compares like-shaped keys; a pending-open turn no longer
  reads as a false peer-advance.
- [ ] None of the five stall counters are wiped by a phantom peer-advance signal on a single-tab session
  (restoring ADR 0011's original "single-tab ⇒ `_peer_advanced` always False" invariant).
- [ ] Replaying the playtest's eviction-reveal scenario shows the wedge is unrepresentable — the stall
  rescue fires instead of vetoing itself.

**DoD**
- [ ] AC met; a regression test pins the fixed comparator against both tuple shapes so a future
  framed-key change cannot silently reintroduce the mismatch.
- [ ] Test lanes green: full FE pytest suite (`cd frontend && python3 -m pytest tests/`) — the
  ADR-0011 / stall-rescue test family.
- [ ] `docs/design/undercall-seam-structural.md` updated to note the comparator fix and that it
  restores the falsified single-tab invariant.

#### T0-2 — DoR / AC / DoD

**DoR**
- [ ] The transaction boundary for auto-advance is chosen (the same commit that resolves a beat's
  pending decision, inside the orchestrator's commit funnel — not a follow-up call).
- [ ] The full set of pendings this applies to is enumerated (ceremony pendings first per Wave-1
  scope; goodbye-message and other player-authored pendings confirmed in/out of scope).
- [ ] Repro pinned: playtest F2's eviction-reveal wedge, reproduced with T0-1 NOT yet applied, to
  prove T0-2 independently closes the class.

**AC**
- [ ] Resolving a beat's pending decision auto-advances server-side in the same transaction — no
  follow-up call, no window where the beat is resolved but not advanced.
- [ ] The eviction reveal cannot wedge behind an open goodbye pending (replaying the playtest scenario
  shows the wedge is unrepresentable; a suite test proves pending-resolve ⇒ advance in one commit).
- [ ] A late/duplicate client write against an already-advanced beat now surfaces as an
  `expectedBeatSeq` 409 (an engine fact) rather than a client-side "peer advanced" inference.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (typecheck → build → unit/property/arch → BDD) for
  the engine-side transaction change, plus the FE pytest suite for the stall-rescue interaction.
- [ ] Per the T9 resiliency ruling: the repaired L39b escalation stays armed as a watchdog and the
  progression belts it bounds are demoted-armed, not deleted; stall-nudge telemetry (`beltsFired` /
  `get_belt_totals`) keeps recording permanently.
- [ ] `docs/design/undercall-seam-structural.md`'s belt inventory updated to reflect the new
  auto-advance transaction and the belts' demoted (watchdog) status.

#### T0-3 — DoR / AC / DoD

**DoR**
- [ ] Q1 (the scoped ADR 0003 amendment — closed-set ceremony outcomes as engine chyrons, model
  demoted to color) is ruled: **APPROVED** (D1, 2026-07-21).
- [ ] The `BeatAnnouncement` schema is decided, covering every committed ceremony fact: HOH, noms,
  veto, replacement nominee, the anonymized ballot sequence, eviction, finale votes.
- [ ] The chyron rendering design is decided as an extension of the shipped decision-card family
  (`orwellDecision.js`), staged card-by-card, riding the g15 `orwell:gamechanged` seam and the
  existing event stream (so F5 two-window parity is inherited, not re-derived).
- [ ] Repro pinned: playtest F1 (phantom HOH/noms/veto/eviction narrated false-first), F4 (triple
  re-narration, silent retcons), F5 (E12 ballot misattribution ~5/13 wrong, illegal HOH ballot).

**AC**
- [ ] Every committed ceremony fact (HOH, noms, veto, replacement, anonymized ballot sequence,
  eviction, finale votes) is emitted as a Vault-free `BeatAnnouncement` projection and rendered
  FE-side as a diegetic broadcast chyron.
- [ ] The 11 `_CLAIM_*_RE` guards flip from fallible detectors to a blunt hard-drop rail (a claim
  token in model prose is dropped outright, never rendered, regardless of correctness — the chyron
  is the only source of truth for the fact).
- [ ] The blank-turn phantom re-emit (`agent_loop.py:4553-54`) is deleted.
- [ ] A scripted ceremony run shows zero closed-set outcome tokens originating in model prose.
- [ ] The E12 anonymized ballot sequence rendered to the player is byte-equal to engine data (fixes
  the ~5/13 misattribution and the illegal-HOH-ballot class from F5).
- [ ] F5 (ship-gate) two-window realtime mirror parity stays green with chyrons in the mix.

**DoD**
- [ ] AC met; the **ADR 0003 amendment doc is authored and merged**, scoped exactly to closed-set
  ceremony chyrons ("the chat gains a stage, not a dashboard") — this amendment is a DoD item in its
  own right, not optional paperwork.
- [ ] Test lanes green: `npm run test:ci`, full FE pytest suite (chyron render + hard-drop-guard
  tests), the F5 two-window-parity CI gate.
- [ ] Per the T9 resiliency ruling: the 11 claims-guards stay live as hard-drop rails even after
  chyrons ship (never removed as "redundant"); the pre-emission outcome guard stays; Fallback A
  ("the board speaks in its own voice" — copy-constrained prose over the same beat cards) and
  Fallback B ("one grounding spec, compiled twice" — a fail-closed claim-type policy compiled to
  both FE languages) stay documented in T9 as designated fallbacks and are built only if T0-3 flakes
  or is later reopened — not built speculatively now.

#### T0-4 — DoR / AC / DoD

**DoR**
- [ ] Q3 (provider posture) is ruled: **APPROVED** (D3, 2026-07-21) — pinning plus a direct z.ai
  endpoint; the implementer reconciles the doc drift between `settings.py`'s live GLM-4.7 default and
  the ADR-0016 README's recorded glm-5.2 retarget while probing the real endpoints.
- [ ] The ~10-call probe set is designed: forced-tool_choice honoring rate, `json_schema` conformance,
  reasoning-channel separation, `require_parameters` acceptance.
- [ ] The per-endpoint `CapabilityProfile` schema is decided, and the registration-time vs. nightly
  cadence wiring is decided (registration-time probe is in scope here; the standing nightly canary is
  T1-2, gated separately on Q2/D2).

**AC**
- [ ] A ~10-call capability probe runs at endpoint registration and persists a per-endpoint
  `CapabilityProfile`.
- [ ] Any request carrying `tool_choice`/`response_format` sets `require_parameters:true` plus
  `provider.only` pinning.
- [ ] Role-split routing sends the DECIDE pass to a schema-verified endpoint while VOICE keeps the
  prose model.
- [ ] A red capability profile triggers an admin banner and an automatic downgrade to the
  enumerated-JSON path (enforcement, not telemetry-only).
- [ ] Belt telemetry is attempt-counted with an honored/ignored outcome field, replacing the
  success-gated-only count that previously undercounted exactly when a provider misbehaved.
- [ ] Probe evidence shows reasoning-channel separation restored (`reasoning_chars > 0`) for the
  pinned narrator endpoint, or the endpoint auto-downgrades with the admin banner.

**DoD**
- [ ] AC met; test lanes green: full FE pytest suite (capability-probe + telemetry tests), `npm run
  test:ci` if engine-side routing is touched.
- [ ] The ADR-0016 doc drift (narrator-model row vs. `settings.py`'s live default) is reconciled in
  the same PR.
- [ ] Per the T9 resiliency ruling: the enumerated-JSON downgrade path and the ordered probed
  fallback chain stay as keep-anyway layers; attempt-counted honoring telemetry stays permanently
  even once pinning is stable.
- [ ] Note: the standing nightly probe canary is out of scope here — see T1-2.

#### T0-5 — DoR / AC / DoD

**DoR**
- [ ] Playtest F3 is the pinned repro (`reasoning_chars=0`, planning monologue and raw engine-field
  jargon surfacing in the visible bubble on GLM-4.7-via-OpenRouter).
- [ ] The detection heuristic is designed to distinguish planning monologue / raw engine jargon from
  legitimate in-character narration, and is model-agnostic (fires for any inline-thinking model, not
  hard-coded to GLM-4.7).
- [ ] The action on detection is decided: scrub the offending span, or downgrade the whole turn.

**AC**
- [ ] Content identified as planning monologue or raw engine-field jargon is scrubbed, or the
  response is downgraded, before it reaches the visible bubble.
- [ ] Replaying the F3 fixture (inline planning text in content, `reasoning_chars=0`) shows no
  reasoning/machinery text in the rendered chat bubble.
- [ ] The scrub fires for any inline-thinking-model response shape, not only the GLM-4.7 case that
  surfaced it.

**DoD**
- [ ] AC met; test lanes green: full FE pytest suite (a reasoning-scrub unit test built from the F3
  fixture).
- [ ] Per the T9 resiliency ruling, this scrub **is itself a permanent fallback layer** — it stays
  live and tested even after T0-4's pinning restores the separated reasoning channel; a later PR that
  removes or bypasses it without an explicit owner sign-off is a regression, not a cleanup.

#### T0-6 — DoR / AC / DoD

**DoR**
- [ ] The `FacetLedger` schema is decided: stratified-sampled, cast-wide budgets (with jitter + rare-
  outlier slots) for vocation family, region/hometown, marks/ink, heightBuild, skinTone, hair, voice
  tics, name phonology, minted before any LLM authoring call.
- [ ] D10's casting mandate (2026-07-21: casting must be deep AND fast, <10s finalize-to-house,
  15-wide parallel fan-out with no content bundling, all 15 deep profiles complete before the house
  door opens) is folded into this item's scope — **this work LEADS Wave 1**, T0-6 is delivered as
  step 0 of the casting-mandate work, not a separate follow-on.
- [ ] The un-ledgered "first-responder" steering line is located, slated for deletion.
- [ ] Merge semantics are decided: transactional adopt-or-regenerate, never a partial graft.
- [ ] Confirmed starting point is `main` (#1768 merged 2026-07-21) — not the audit branch.

**AC**
- [ ] A `FacetLedger` is minted cast-wide, seeded, before any authoring LLM call runs.
- [ ] Every authoring lane (deterministic floor, genesis, deep authoring, identity quotas) receives
  its NPC's dealt hand plus the cast-wide taken-list.
- [ ] The merge is transactional — adopt or regenerate, never a partial graft; Vault secrets key to
  the post-merge identity, never a pre-genesis skeleton.
- [ ] A generic facet-diff validator runs at `recordCastProfile`, replacing the per-facet regexes
  (INK_RE et al.) as the primary gate.
- [ ] A 30-cast A/B shows zero facet triple-dups, zero chimeras, 0 mis-keyed Vault secrets.
- [ ] The un-ledgered "first-responder" steering line is deleted.
- [ ] D10's own targets hold: all 15 deep profiles complete before the house door opens, <10s
  finalize-to-house, 15-wide fan-out with no content bundling, and the #1713 premiere-path block is
  bounded.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` including a `McpServer.callTool` boundary test for
  `recordCastProfile` (the write-back four-place-seam pattern), full FE pytest suite (genesis/
  authoring-lane tests, the 30-cast A/B harness).
- [ ] Per the T9 resiliency ruling: the per-facet regex guards (INK_RE et al.) are demoted to alarmed
  monitors, not deleted — they keep running as canaries proving the generic facet-diff validator is
  actually working; the #1768 ink backstop stays.
- [ ] Docs updated: `HANDOFF.md` §3's acceptance path is re-verified against a freshly generated
  cast (2–4 inked of 16, varied hometowns/vocations, committed dups structurally 0); GH-1734
  (`withIds` normalization) is coordinated or landed alongside since it shares the boundary-validation
  pattern.

#### T0-7 — DoR / AC / DoD

**DoR**
- [ ] T0-1 through T0-6 are merged to `main`.
- [ ] A live-model credential path is available per CLAUDE.md's "Live (real-LLM) manual testing"
  section (a real provider endpoint wired via `POST /api/model-endpoints`, `default_model` /
  `default_endpoint_id` set).
- [ ] The playtest methodology mirrors the 2026-07-21 campaign playtest (`.audit-telemetry/`) closely
  enough that results are directly comparable to findings F1–F10.

**AC**
- [ ] A full live week-1 playtest (casting → HOH → nominations → veto → veto ceremony → eviction)
  shows zero phantom closed-set outcomes (F1 class gone).
- [ ] Zero silent retcons occur (F4 class gone).
- [ ] Zero livelocks occur (F2 class gone).
- [ ] No reasoning or planning text reaches the visible chat bubble (F3 class gone).
- [ ] The E12 anonymized ballot sequence is attributed correctly.

**DoD**
- [ ] AC met and recorded as a dated playtest report in this doc's Part A campaign-report style
  (evidence base, verdict), so the Wave-1 exit is auditable the same way the original F1–F10 findings
  were.
- [ ] Any regression the playtest surfaces that is automatable gets a permanent regression test added
  to `npm run test:ci` or the FE pytest suite before T0-7 is marked done — a live-only pass with no
  captured regression test does not close this item.
- [ ] This backlog doc's Part A gets a new dated entry recording the Wave-1 exit result.

### T1 — Moonshot Waves 2–5 (sequenced after T0)

| ID | Item | Source | Effort | Depends on |
|---|---|---|---|---|
| T1-1 | **Act→Commit→Voice** — DECIDE constrained-JSON micro-call from engine-enumerated legal actions → FE executes with `expectedBeatSeq`+`idempotencyKey` → bounded retries → seeded default → VOICE narrates only the committed stateDelta. Flag-staged per beat-class, ceremonies first; **belts DEMOTED, not deleted, per flipped class** (owner resiliency ruling 2026-07-21, §T9): each superseded belt (~15 of 21 registry belts, #1154, L39b + its three bounding belts, the eviction drain) drops to an armed, alarmed fallback behind a per-class flag — it fires only if the new path fails, and every fire shows RED per #1599; deletion only after the class survives a full live season + clean canary window. | P1 stage 3 (Wave 2) | L | T0-2, T0-3, T0-4 |
| T1-2 | **Nightly probe canary** — non-blocking, key-gated, ~cents: capability probe + one scripted ceremony turn; phantom-claim rate alarmed. Explicitly *not* 0108 revived. | P2 tail (Wave 2) | S | **Q2** |
| T1-3 | **Show Bible** — seeded fictional canon (show name, host persona + tics, 6–10 past seasons) via a `recordShowCanon` write-back (four-place seam + boundary test); ~400-token whitelist into narrator context + cast genesis; real-show denylist in the shared scrub corpus. Fixes the only playtest class with zero structural defense. | P7; F9 (Wave 2) | S | — |
| T1-4 | **Honest Delivery Lite** — ack-is-the-row (clientMsgId → unique-constraint inbox), minimum-viable-turn gate (below-threshold / dangling-markdown tails re-render, never air), diegetic control-room correction card (never a silent reground). | P8; F7/F8/F10 (Wave 2) | S–M | coordinates with GH-1728/GH-1729 (same render-log family) |
| T1-5 | **Footage Pool** — quarantined fail-soft FE lane authoring 4–8 lines of real scene dialogue per committed off-screen event from redaction-at-source briefs (per-speaker KnowledgeService block only); Vault-stored beside its event, inherits its witness set, never reaches narrator context (distinct port + dep-cruiser edge + boundary tests); surfaces only via legal pathways (gossip quotes, 0102 recaps, 0048 retrospective). Also: push voiceFingerprint on the roster (npcVoice 0/24 starvation) . | P4; breakage map E (Wave 3) | M | T0-6; **Q4** |
| T1-6 | **Editorial Organ** — Felt-style salience sifter (≥1 surfaced thread per lull), L4D-style tension meter with a beat budget (a spent budget + a lull ⇒ the Director itself calls `advanceGame`, idempotent + beatSeq-guarded), cadence-capped camera-cut interstitials, and the Spy Screen (2–3-peek weekly dramatic-irony budget via the sanctioned `surfaceInformationTo`, selector boundary-tested to exclude beat-pre-resolving events). | P5; breakage map E (Wave 4) | L | T0 complete (directs a narrator that can no longer lie) |
| T1-7 | **Player Agency Band** — Pledges (stated intention, soul-distorted from true lean, trust-gated hedging; Journal accumulates claims, never truth), vote-intent rumors riding gossip, the flip cascade behind the gradient gate, pledge-vs-ballot betrayal-shock folds; then `convokeHouse` (house-meeting/call-out lever, presence-decided attendance, symmetric NPC-side call-out, notoriety cost). | P6; F1's "9–4 as pure noise" gap (Wave 5) | M–L | T0; T1-1 |
| T1-8 | **Blindside-autopsy decision point** — re-spec with an explicit redaction contract + adversarial test suite, or park permanently. | Killed-with-cause #5 (Wave 5 exit) | — | **Q5**; T1-5 |

#### T1-1 — DoR / AC / DoD

**DoR**
- [ ] The engine-enumerated legal-action schema per beat-class is decided (which beats are closed-set:
  HOH comp decisions, nominations, veto, veto ceremony, eviction ballot, casting finalize).
- [ ] DECIDE-pass provider routing is decided, depending on T0-4's role-split (schema-verified endpoint
  for DECIDE, prose model for VOICE).
- [ ] Per-beat-class flag names and rollout order are decided (ceremonies first, per Wave-2 sequencing).
- [ ] The retry/seeded-default bound is decided: 2 bounded retries on non-conforming DECIDE output,
  then the engine's own seeded default (never a freeze).
- [ ] The mapping from the ~15-of-21 registry belts (the #1154 inventory, L39b + its three bounding
  belts, the eviction drain, the ADR-0011 comparator) to their owning beat-class is drawn up, so each
  flip demotes the right belts.

**AC**
- [ ] For each flagged-on beat-class, the DECIDE micro-call returns constrained JSON selecting only
  from engine-enumerated legal actions — no prose, no free tool calls.
- [ ] The FE executes the chosen action via the engine tool with `expectedBeatSeq` + `idempotencyKey`.
- [ ] Non-conforming DECIDE output triggers exactly 2 bounded retries, then falls back to the engine's
  seeded default — the beat cannot freeze on either path.
- [ ] VOICE receives only the committed `stateDelta` as its factual source and holds zero levers on
  closed beats.
- [ ] Per flipped class, its mapped belt subset (per the #1154 inventory) is **DEMOTED to an armed,
  alarmed fallback — never deleted** — gated behind that class's flag, firing only when the primary
  DECIDE→COMMIT→VOICE path fails.
- [ ] Every belt fire (demoted or otherwise) renders RED to the player-adjacent operator surface per
  the #1599 no-silent-fail-soft ruling — an auto-corrected turn is never silently clean.
- [ ] With a beat-class's flag OFF, that class's turn processing is byte-identical to pre-T1-1
  behavior (the belt path runs exactly as before).

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (engine `stateDelta`/`expectedBeatSeq`/
  `idempotencyKey` plumbing for the flipped classes), full FE pytest suite (DECIDE-pass construction,
  belt-demotion routing, RED-on-fire rendering).
- [ ] Flag-off byte-identity explicitly verified: the UAT spine (`tests/uat/**`), `juryReach.property.
  test.ts`, and the gradient calibration shards stay byte-identical with every T1-1 flag OFF.
- [ ] A belt is **deleted only after its class survives a full live season plus a clean canary
  window** — this DoD covers demotion + RED-on-fire only; belt deletion is a separate, later DoD.
- [ ] `docs/design/undercall-seam-structural.md`'s belt inventory is updated per flipped class to
  DEMOTED (not removed) status, and stays the living reference for the eventual deletion PRs.

#### T1-2 — DoR / AC / DoD

**DoR**
- [ ] Q2 is ruled: **APPROVED** (D2, 2026-07-21) — a narrow, non-blocking nightly probe canary,
  explicitly not 0108 revived.
- [ ] The scripted-ceremony-turn content is decided (one turn, minimal cost, exercising the same path
  T0-3's chyrons + T0-4's probe cover).
- [ ] The alarm threshold and notification channel are decided.

**AC**
- [ ] The canary runs nightly, non-blocking (`continue-on-error`), mirroring `live-harness-nightly.
  yml`'s pattern, key-gated on the `OPENROUTER_API_KEY` repo secret with a clean skip when absent.
- [ ] It executes the ~10-call capability probe (T0-4's probe shape) plus one scripted ceremony turn.
- [ ] Cost stays in the cents range per run.
- [ ] It alarms on a nonzero phantom-claim rate.
- [ ] It does **not** reintroduce a committed golden fixture, a record/replay seam, or a blocking
  `ci-gate` dependency — this is explicitly not 0108 revived.
- [ ] Phantom-claim rate is 0 across a 7-night observation window.

**DoD**
- [ ] AC met; the workflow file is syntax-checked per repo convention (the same `bash -n` /
  actionlint-equivalent discipline the deploy-smoke job uses).
- [ ] CLAUDE.md's CI section gets a one-line mention of the canary alongside `live-harness-nightly.
  yml` (non-blocking, key-gated) so the "no re-record obligation" language from the 0108
  decommission isn't misread as "no live verification at all."

#### T1-3 — DoR / AC / DoD

**DoR**
- [ ] The canon schema is decided: show name, host persona + verbal tics (the chyron voice), 6–10
  quota-checked past seasons.
- [ ] The four write-back seam sites are identified per CLAUDE.md's FE-driven write-back pattern:
  `src/ports/GameSession.ts`, `src/adapters/engine/GameSessionAdapter.ts`,
  `src/surfaces/tools/registry.ts` (`PLAYER_TOOLS` + `INFRA_LEVERS`), `src/adapters/mcp/McpServer.ts`.
- [ ] The real-show denylist corpus (real host names, real season-numbering patterns) is assembled
  from the F9 repro.

**AC**
- [ ] `recordShowCanon` is wired through all four write-back places plus a boundary test dispatching
  through `McpServer.callTool` (the `castPrewarm.test.ts` / `worldSnapshotBoundary.test.ts` template).
- [ ] A ~400-token canon whitelist is injected into narrator context and cast genesis (1–3 superfan
  facets).
- [ ] The shared scrub corpus (both FE-language layers, mindful of the #1749 parity-drift class)
  gains a real-show denylist.
- [ ] The F9 repro (a real host named; "jury house" used for a first evictee) no longer reproduces.
- [ ] A denylist lint passes green.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (the write-back boundary test), full FE pytest
  suite (denylist lint + canon-injection test).
- [ ] CLAUDE.md's FE-driven-write-back list gains `recordShowCanon` alongside `recordCastProfile` /
  `preSeedCast` / `recordWorldSnapshot` / `recordImageBeat`.

#### T1-4 — DoR / AC / DoD

**DoR**
- [ ] Coordinated with #1728's D1 render-log design (ack-is-the-row needs the single append-only,
  server-`seq`-ordered row list as its foundation).
- [ ] The minimum-viable-turn threshold is decided (what counts as "below-threshold" or a
  "dangling-markdown tail").
- [ ] The control-room correction-card copy/UI is decided, consistent with T0-3's chyron/broadcast
  grammar.
- [ ] The `clientMsgId` → unique-constraint inbox schema is decided.

**AC**
- [ ] A client send is acknowledged only when the server row carrying its `clientMsgId` is observed
  on the same stream (ack-is-the-row); the outbox clears only on that observed row, never on local
  optimistic state.
- [ ] A below-threshold or dangling-markdown-tail reply is caught by the minimum-viable-turn gate and
  re-rendered rather than airing (F8 class gone).
- [ ] A genuine post-air correction renders as a diegetic control-room card ("The control room
  reviewed the tape…") rather than a silent reground.
- [ ] F7 (message rendered locally, never reached server) no longer reproduces.

**DoD**
- [ ] AC met; test lanes green: full FE pytest suite (outbox ack-is-the-row test, minimum-viable-turn
  gate test, correction-card render test), `test_g15_gamechanged.py` (the correction card must route
  through the single `orwell:gamechanged` dispatcher, never an ad-hoc event).
- [ ] Coordinated with #1728/#1729's render-log documentation so the ack-is-the-row description and
  the D1 single-row-list description don't drift apart.

#### T1-5 — DoR / AC / DoD

**DoR**
- [ ] Q4 is ruled: **APPROVED**, gated on T0-6 landing first (D4, 2026-07-21).
- [ ] The distinct-port design is decided (a new port type, not a reuse of `NarrativePort`, so
  dependency-cruiser can enforce a forbidden narrator-context edge).
- [ ] The redaction-at-source brief format is decided: per-speaker `KnowledgeService` block + voice
  fingerprint only, no sibling-NPC facts in context.
- [ ] The `recordFootage` write-back four-place seam + boundary test are planned.
- [ ] The fail-soft cheap-model fan-out (e.g. GLM-4.7-Flash, ~$0.003/turn for all 15 minds) and its
  cost budget are confirmed.

**AC**
- [ ] For each committed off-screen event, the fail-soft FE lane fans out and authors 4–8 lines of
  real dialogue per speaker from a redaction-at-source brief containing only that speaker's
  `KnowledgeService` block + voice fingerprint.
- [ ] Footage is written back via `recordFootage` (four-place seam + `McpServer.callTool` boundary
  test).
- [ ] Footage is Vault-stored beside its source event and inherits that event's witness set.
- [ ] Footage is non-canonical for outcomes and is **never** reachable from narrator context —
  enforced structurally by a distinct port plus a dependency-cruiser forbidden-edge rule, not by
  convention.
- [ ] Footage surfaces to the player only via existing legal pathways: gossip quoting a drifted line,
  0102 daily recaps, the 0048 post-season retrospective unseal.
- [ ] On a healthy run, a season's retrospective contains zero template-pool sentences.
- [ ] Under failure injection (the utility model killed mid-season), delivery continues via bounded
  template fallback with no stall.
- [ ] Roster `voiceFingerprint` is pushed and actually consumed (fixing the npcVoice-0/24 starvation).

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (the dependency-cruiser forbidden-edge test proving
  no narrator-context → footage-port import; the `recordFootage` boundary test), full FE pytest suite
  (redaction-at-source brief test, fail-soft/killed-model test).
- [ ] Per the T9 resiliency ruling: the template pools stay as the **permanent** fail-soft floor
  (never deleted), and "The House You Can Hear" (the salience-sifted ambient feed over existing
  template pools + widened gloss pools + roster voiceFingerprint push) stays documented as T1-5's
  designated fallback if D4 is ever revisited or the lane misbehaves.
- [ ] CLAUDE.md's FE-driven write-back list gains `recordFootage`; the Vault-adjacent quarantine is
  documented alongside `producerVault` as the second sanctioned exception, with the structural
  differences (automated vs. manual unseal) spelled out per D4's "structural-quarantine terms."

#### T1-6 — DoR / AC / DoD

**DoR**
- [ ] The salience-sifter ranking formula is decided: recency × relationship-delta × proximity ×
  novelty, over the Vault-safe `EventStore`.
- [ ] The tension-meter build→peak→relax curve and beat-budget parameters are decided, per in-game
  day.
- [ ] The Director's `advanceGame` call is confirmed gated on the **existing** engagement detector
  (reused, not reinvented) and is idempotent + `beatSeq`-guarded, single-writer per canonical
  session.
- [ ] The Spy Screen's selector rule is decided: it must exclude events that would pre-resolve a
  pending closed-set beat.
- [ ] The flag name and default (OFF) are decided.

**AC**
- [ ] The salience sifter surfaces ≥1 Vault-safe thread per lull, replacing the starved probability
  valves (riseProb/transmit) as the lull-filling delivery mechanism.
- [ ] The tension meter runs a build→peak→relax curve per in-game day with a beat budget.
- [ ] When the budget is spent and the detector reads a lull, the Director itself calls `advanceGame`
  (idempotent, `beatSeq`-guarded), narrated as an edit cut — and never over an engaged player turn,
  verified across a full UAT run.
- [ ] Cadence-capped camera-cut interstitials render sifted texture diegetically.
- [ ] The Spy Screen spends a 2–3-peek weekly dramatic-irony budget via the sanctioned
  `surfaceInformationTo` pathway (recorded, traceable, symmetric — NPCs can overhear the player too).
- [ ] The Spy Screen's selector has a boundary test excluding events that would pre-resolve a pending
  closed-set beat.
- [ ] Instrumented week-1 house→player information flow is > 0 by design.
- [ ] With the Director's flag OFF, the UAT spine is byte-identical to pre-T1-6 behavior.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (the `beatSeq`-guarded advance test, the Spy-Screen
  selector boundary test, the UAT-spine flag-off byte-identity check across `tests/uat/**`), full FE
  pytest suite (interstitial rendering, engagement-detector reuse).
- [ ] Per the T9 resiliency ruling, the existing engagement-detector gating logic stays (reused, not
  replaced) — rollback is the flag.
- [ ] Docs cross-referenced where the sifter changes gossip-diffusion cadence language (`docs/
  decisions/0002`).

#### T1-7 — DoR / AC / DoD

**DoR**
- [ ] The Pledge data model is decided: stated intention vs. hidden true lean vs. trust-gated hedging
  factor.
- [ ] Journal semantics are confirmed: Pledges accumulate as claims only, never as asserted truth —
  consistent with "the player forms their own reads" (features 0017/0020/0023).
- [ ] The flip-cascade threshold-dynamics design and its gradient-gate re-banding plan are drafted.
- [ ] `convokeHouse`'s schema is decided (`{agenda, subjectId?, factId?}`), presence-based attendance
  (0066), its dedicated-rng source, and the notoriety-cost formula against spam.
- [ ] Flag names and defaults (OFF) for both Pledges and `convokeHouse` are decided.

**AC**
- [ ] Asking for a vote records a first-class Pledge — the NPC's stated intention, soul-distorted
  from the true hidden lean, trust-gated hedging applied.
- [ ] The Journal accumulates Pledges as claims, never as ground truth; the player never sees the
  real lean.
- [ ] Vote-intent rumors ride the existing gossip-diffusion pathway.
- [ ] The flip cascade (threshold dynamics over the vote graph between veto ceremony and eviction)
  ships behind the gradient gate, off by default.
- [ ] A post-eviction pledge-vs-ballot delta automatically folds betrayal-shock.
- [ ] `convokeHouse` fires one event witnessed by the whole awake house (0066 presence decides
  attendance), rolls one house-wide temperature, folds per-soul seeded reactions, produces a
  high-riseProb aftermath rumor, and triggers campaign replans; NPCs can symmetrically call a house
  meeting themselves; repeated use costs notoriety.
- [ ] The gradient gate is re-banded and green; the pledge-lie rate lands within the tuned band.
- [ ] With both flags OFF, the UAT spine is byte-identical to pre-T1-7 behavior.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` (gradient-gate re-banding, `tests/uat/**` flag-off
  byte-identity, dedicated-rng determinism for `convokeHouse`), `tests/unit/expressiveNonCollapse.
  test.ts` + `frontend/tests/test_expressive_non_collapse.py` (Pledges are open-set claims that must
  never collapse into closed-set truth), full FE pytest suite (Journal-claims-not-truth test,
  `convokeHouse` presence/notoriety tests).
- [ ] `docs/decisions/0002` cross-referenced for Pledges' soul-distortion rule.

#### T1-8 — DoR / AC / DoD

**DoR**
- [ ] Q5 is ruled: **PARKED** (D5, 2026-07-21) — revisit only after T1-5 (Footage Pool) ships and an
  adversarial redaction test suite exists.
- [ ] T1-5 is shipped and stable.
- [ ] The adversarial redaction test suite is built/commissioned, falsifying or supporting the precise
  claim "conservative-drop redaction against the co-mention surface can safely exclude living
  co-schemers from a mid-season Vault exception."

**AC**
- [ ] The adversarial redaction suite runs against real Footage-Pool-backed season data and produces
  a pass/fail verdict on the redaction-safety claim above.
- [ ] The verdict plus its evidence is presented to the owner as a re-spec-or-park decision packet.
- [ ] The owner rules again, explicitly and on the record — a second, dated decision distinct from
  D5's park.

**DoD**
- [ ] Either (a) a re-spec ships to the same DoR/AC/DoD standard as every other T1 item once
  approved, or (b) the item is marked permanently parked in this backlog doc with the adversarial
  suite's evidence linked. No code ships under T1-8 without a fresh owner ruling on the suite's
  verdict.
- [ ] This backlog doc's T7 ruling table gets a follow-up decision row ("D5-followup") recording
  whichever way it resolves.

### T2 — Open GitHub issues (all 7; canonical in the tracker)

| Issue | Title (compressed) | Sev | Relationship to the portfolio |
|---|---|---|---|
| #1728 | [B2/D1] Regeneration double-folds the hidden layer — supersede-by-id + retract/defer the superseded fold | P1 | The D1 single render log is the same substrate T1-4 and R2 (#1413) build on; the fold-deferral half is engine-adjacent and independent. **Not** absorbed — build per its own spec, coordinate the render log with T1-4. |
| #1729 | [B1/D2] OOC vents & stream-glitch text recorded as "(overheard, clearly)" world events — recorder gate + resumable stream | P1 | The D2 resumable stream rides #1728's render log; the B1 recorder content-gate is standalone and should land early (it is a Vault-hygiene bug: machinery text sits in the Vault as gossip-diffusable material). |
| #1734 | [B4] Scene-extraction `withIds` format drifts — normalize + validate at the boundary | P3 | Pairs naturally with T0-6's generic facet-diff validator (same boundary-validation pattern); can land with the B3 batch or T0-6. |
| #1713 | Casting-finalize turn hangs FE→engine ~300s under CI load (champagne-premiere #1711 regression) | P2 | The three replay-gate jobs it redded are **gone** (#1765), so its CI symptom is moot — but the diagnosis stands: a ~300s hard block on `createCharacter`→premiere under contention is **potentially production-relevant** (a real player on a busy server would hit the FE→engine timeout). Keep open; re-scope to the behavioral fix (Step-2 of the issue) and drop the replay-diagnostic step. |
| #1644 | TEXT STANDARDIZATION umbrella — every text on standard kit ink tokens + a CI gate | Owner mandate | Standalone FE track; subsumes HANDOFF's "#738 Liquid-Glass real fix" residual (same class). Audit → gate → fix waves. |
| #1599 | GOVERNING RULING: no silent fail-soft — RED even when auto-corrected; allowlist mechanism | Owner ruling | Cross-cutting; feature 0112 (in progress) is its observability substrate. Note the tension to resolve at build time: the moonshot's P4/P8 lanes are *specified* fail-soft — those sites need owner-allowlist entries with reasons, per this ruling's own mechanism. |
| #1413 | refactor(R2): collapse duplicated live-vs-reload chat render paths (ADR 0015) | post-launch | Same family as #1728-D1/T1-4; sequence after the render log exists so it collapses *onto* it rather than beside it. |

**Contracts.** Each of the seven issues above already carries a full DoR/AC/DoD in the tracker (see
#1728/#1729/#1734 for the established shape); this doc does not duplicate them.

- #1728 — Contract: see issue #1728 (DoR/AC/DoD in tracker).
- #1729 — Contract: see issue #1729 (DoR/AC/DoD in tracker).
- #1734 — Contract: see issue #1734 (DoR/AC/DoD in tracker).
- #1713 — Contract: see issue #1713 (DoR/AC/DoD in tracker).
- #1644 — Contract: see issue #1644 (DoR/AC/DoD in tracker).
- #1599 — Contract: see issue #1599 (DoR/AC/DoD in tracker).
- #1413 — Contract: see issue #1413 (DoR/AC/DoD in tracker).

### T3 — Live-playtest findings F1–F10 → disposition map

*Disposition map — no DoR/AC/DoD contracts here; the "Disposition" column is the full contract for
each finding (it names the T0/T1 item(s) that absorb it, whose own DoR/AC/DoD subsections above are
where the actual acceptance bar lives).*

| Finding | Severity | Disposition |
|---|---|---|
| F1 phantom closed-set narration (HOH/noms/veto/eviction all false-first) | CRITICAL | **Absorbed:** T0-2 + T0-3 (structural); no standalone fix — belts cannot fix this class. |
| F2 forced tool_choice silently ignored + ADR-0011 suppression livelock | CRITICAL | **Absorbed:** T0-1 (comparator, tactical now) + T0-4 (probe/pin) + T1-1 (structural). |
| F3 reasoning/planning leak into visible bubbles | HIGH | **Absorbed:** T0-5 (tactical scrub) + T0-4 (pinning restores channel separation). |
| F4 triple re-narration, contradictory retellings, silent day-rewind retcons | HIGH | **Absorbed:** T0-3 (chyrons carry truth; claims hard-drop) + T1-4 (correction card replaces silent retcon); the duplicated-row half is #1728. |
| F5 E12 secret-ballot violation (attributed ballots, illegal HOH ballot, ~5/13 wrong) | HIGH | **Absorbed:** T0-3 — the anonymized ballot sequence becomes an engine projection, byte-equal to engine data. |
| F6 cast texture repetition + cross-character identity bleed (smokejumper) | MEDIUM | **Absorbed:** T0-6 (ledger kills clustering) + T1-5 (redaction-at-source briefs kill bleed); #1768 already fixed the generation-side uniformity (acceptance: HANDOFF §3 — next fresh cast). |
| F7 player message silently lost (rendered locally, never reached server) | MEDIUM | **Absorbed:** T1-4 ack-is-the-row; evidence also feeds session task #20 (FE freeze root-cause). |
| F8 empty/near-empty assistant bubbles ("The"; dangling "**" verdict) | MEDIUM | **Absorbed:** T1-4 minimum-viable-turn gate. |
| F9 canon slips (real host named; "jury house" for first evictee; invented mechanics) | MEDIUM | **Absorbed:** T1-3 show bible + denylist. |
| F10 machinery-adjacent vocabulary in re-ground copy ("the hoh-competition beat") | LOW | Small copy fix in the re-ground templates; fold into T0-3's copy pass. |

### T4 — HANDOFF residual ledger (carried forward, deduplicated)

| ID | Item | Disposition |
|---|---|---|
| RES-1 | #738 Liquid-Glass contrast — the REAL fix (lift frosted-glass token ink to AA on live surfaces; #1766 only registered tight XFAILs) | **Subsumed by #1644** (the ink-token standard + gate is the general fix); close #738 against #1644's fix wave. |
| RES-2 | C2 paraphrase-monitor first-name gap (unique-first-name staging missed by the SOFT nightly probe) | Open, low-pri; adopt the presence-detector's unique-first-name logic if the monitor's recall starts to matter. |
| RES-3 | `_stages_in_scene` verb coverage ("tilted their head and said" not recognized) | Open, low-pri; batch with the next knowledge-wall touch. |
| RES-4 | Test-convention nits: `coPresenceReconcile.test.ts` + `knowledgeScoping0019.test.ts` wire sandboxes manually instead of `tests/support/sandbox.ts`; 0131/0132 spec DoD wording nits | Open, by design; batch opportunistically. |
| RES-5 | `a11y-matrix` (advisory) can still red when `finish_game()` times out on a slow runner | Tolerated (advisory); root fix rides #1644's gate redesign. |

#### RES-1 — DoR / AC / DoD

**DoR**
- [ ] #1644's audit → gate → fix-wave plan reaches the ink-token/contrast portion of frosted-glass
  surfaces.
- [ ] The frosted-glass surfaces needing an AA contrast lift are catalogued — a superset of the
  #1766 XFAIL registry's tight-needle entries for this class.

**AC**
- [ ] Frosted-glass token ink meets WCAG AA contrast on every live surface previously XFAIL'd by
  #1766's tight-needle registrations.
- [ ] The `a11y-matrix` XFAIL registry entries for these surfaces are **removed**, not widened.
- [ ] #1644's CI gate covers these surfaces going forward, so a future regression is caught
  structurally rather than by manual audit.

**DoD**
- [ ] AC met; test lane green: the `fe-responsive` / a11y-matrix CI job (`frontend/scripts/
  responsive_matrix.py`) with the RES-1 surfaces' XFAILs removed.
- [ ] Issue #738 is closed, referencing the #1644 PR(s) that fixed it.
- [ ] #1644's own tracking doc/issue records RES-1 as one of its fix-wave items.

#### RES-2 — DoR / AC / DoD

**DoR**
- [ ] The presence-detector's unique-first-name logic (the module that already solves this for
  presence/eyeshot) is located as the reuse candidate.
- [ ] A concrete recall-regression case is on record — a paraphrase that slipped past the SOFT
  nightly probe due to a first-name-only reference — establishing this is worth doing now rather
  than staying deferred.

**AC**
- [ ] The C2 SOFT paraphrase monitor recognizes a unique-first-name reference to a privately-known
  fact with the same recall the presence detector already achieves.
- [ ] A regression test built from the recorded gap case passes.

**DoD**
- [ ] AC met; test lane green: full FE pytest suite (the ADR-0019 knowledge-wall test family
  alongside the existing C1/C2 monitor tests).
- [ ] Stays low-priority/opportunistic per its own disposition: this DoD applies once someone picks
  it up; until then this entry documents the trigger condition ("if the monitor's recall starts to
  matter"), not a committed timeline.

#### RES-3 — DoR / AC / DoD

**DoR**
- [ ] The missed-verb corpus (e.g. "tilted their head and said") is extended from real playtest
  transcripts, not invented.
- [ ] The next knowledge-wall PR touching `_stages_in_scene` (or a sibling ADR-0019 module) is
  identified as the batching vehicle.

**AC**
- [ ] The verb-coverage list recognizes the recorded missed forms, starting with "tilted their head
  and said," as scene-staging verbs.
- [ ] A regression test pins the previously-missed forms.

**DoD**
- [ ] AC met; test lane green: full FE pytest suite (the knowledge-wall / `_stages_in_scene` unit
  tests).
- [ ] Ships opportunistically, batched with whichever ADR-0019 PR next touches this module — no
  standalone PR required, but that PR must include this fix rather than defer it further.

#### RES-4 — DoR / AC / DoD

**DoR**
- [ ] `coPresenceReconcile.test.ts` and `knowledgeScoping0019.test.ts` are identified as the two
  test files wiring sandboxes manually instead of via `tests/support/sandbox.ts`.
- [ ] The 0131/0132 spec DoD wording issue is identified precisely (which wording deviates from the
  doc-wide convention).

**AC**
- [ ] `coPresenceReconcile.test.ts` and `knowledgeScoping0019.test.ts` construct their test
  environment via `tests/support/sandbox.ts` (the canonical factory) instead of manual wiring, with
  no change to what they assert.
- [ ] The 0131/0132 spec files' DoD wording is corrected to match the doc-wide convention.

**DoD**
- [ ] AC met; test lane green: `npm run test:ci` (both test files still pass, now via the canonical
  sandbox factory, with identical assertions/coverage).
- [ ] Ships opportunistically — batched into whichever PR next touches either test file or the
  0131/0132 specs, not a dedicated PR.

#### RES-5 — DoR / AC / DoD

**DoR**
- [ ] #1644's gate-redesign plan reaches the `a11y-matrix` job's timeout/retry handling.
- [ ] The specific `finish_game()` timeout path causing the flake is confirmed distinct from a real
  a11y regression.

**AC**
- [ ] A slow-runner `finish_game()` timeout no longer reds the advisory `a11y-matrix` job as a false
  failure (via a longer bound, a retry, or a redesigned completion signal per #1644's gate work).
- [ ] A genuine a11y regression still reds the job.

**DoD**
- [ ] AC met; test lane green: the `fe-responsive` / a11y-matrix CI job observed stable (no
  timeout-flake) across a normal run window.
- [ ] Closed against whichever #1644 PR redesigns the gate, not built standalone — until then this
  stays tolerated (advisory, non-blocking) per its current disposition.

### T5 — Overseer session tasks (open ones, reconciled)

*Disposition map — no DoR/AC/DoD contracts here; the "Disposition" column is the full contract for
each task (it names the T0/T1/T4 item(s) that absorb it, or states its own standing status).*

| Task | Disposition |
|---|---|
| #7 key rotation reminder | **Standing owner obligation** — see T7-D9. |
| #14 Wave2 presence/location parity (BL-007/013/033; BL-014 shipped #1764) | Open; unabsorbed remainder of the BL presence batch — schedule against T0/T1 priorities. |
| #16 Wave2 P0 narration-grounding chain (BL-001/002/003/006 + F6) | **Superseded by T0** — the moonshot Wave 1 *is* the narration-grounding chain, designed structural instead of belt-additive. Close the task when T0 lands. |
| #17 BL-004 correction-queue voicing + capacity | **Absorbed into T1-4** (the correction card + queue semantics); do not build the old shape. |
| #20 root-cause FE freezing/hang forcing refreshes (in progress) | Open; playtest F7/F8 + #1729-T1 stream-drop evidence feed it; likely resolves alongside #1728/#1729's render-log + resume work. |
| #24 ADR 0019 Layers 2 & 3 (per-NPC knowledge hardening) | Open, phased follow-on; T1-5's redaction-at-source briefs are Layer-2-adjacent — coordinate to avoid double-building. |
| #28 Wave2 off-screen society + Day-1 spine + cast-Vault + narration polish | Partially delivered (#1767 scheme targets; #1768 cast); the society-delivery remainder is **absorbed into T1-5/T1-6**; Day-1 spine rides 0111 (in progress). |
| #31 triage playtest findings → portfolio + tactical fixes | **Completed by this document** (§T3 is the triage). |

### T6 — Tuning & deferred (CLAUDE.md / ADR ledger; none block)

| ID | Item |
|---|---|
| TUN-1 | Calibration residual (optional): passive still *reaches* F2 about as often — the reach-side lever is `decisionConstants.juryManagementWeight` (audit #4). **Do NOT lower `gameRespect` further** (primary goal met: active wins 20% vs passive 7%). |
| TUN-2 | ADR 0006 / 0066 Phase-2 (PO review list): NPC next-day social fatigue, compounding multi-night fatigue meter, per-conversation clock advance. |
| TUN-3 | Token economy follow-ons: #2 model-aware reasoning sizing · #4 `Continue ▸` in chat mode (#1/#3 are DONE). |
| TUN-4 | 0010 real-Proxmox container smoke (owner-run; also the A4 single-PAT deploy verification) — proves the `pct`/`pvesh` bridge end to end. |
| TUN-5 | Postgres + pgvector tier (MVP-002 post-launch scale-out; SQLite shipped opt-in #330). |
| TUN-6 | ADR 0008/0012 live-LLM two-window re-run + mid-gen-join test pin — rides `live-harness-nightly.yml` (the F5 render-parity half is closed + CI-gated #1276). |
| TUN-7 | Frozen specs 0097/0098/0103 (owner-parked "not planned", preserved, reopenable) · in-progress specs 0111 (Day-1 experience) + 0112 (LLM-call observability — also #1599's substrate). |
| TUN-8 | REFACTOR-ROADMAP open items: R1 remainder (structured stale-beat body, auto-derived gamechanged set — R1c is DONE #1756) · R2 = #1413 · R3 chat.js decomposition · R6 failure-mode UX · R7 polish bundle. R2/R3/R6 all intersect the T1-4/#1728 render-log family — sequence them onto it. |
| TUN-9 | ADR 0016 Seedream-portrait follow-on (separate, not-yet-built lever). |
| TUN-10 | Enrichment-flag deploy-parity for dev/playtest rigs — set the deploy's flag envs (`ORWELL_CAMPAIGNS`, `ORWELL_TRAJECTORIES`, `ORWELL_STRATEGIC_CADENCE`, `ORWELL_SCHEME_TARGETS`, `ORWELL_CONFESSIONAL_DEPTH`, `ORWELL_NPC_DEAL_OFFERS`; `ORWELL_DEAL_DEPTH` stays off pending its live-loop reconciliation) in the dev runner/playtest driver so playtests exercise the un-impoverished society. **Never flip code defaults** (calibration neutrality). |

#### TUN-1 — DoR / AC / DoD

**DoR**
- [ ] The owner ruling is on record: **leave as-is** ("goats-reach-F2 = realism," 2026-07-21) — this
  item stays closed unless a future measurement run shows passive-reach materially distorting the
  jury-reach distribution beyond the currently-accepted band.
- [ ] If ever reopened: the lever (`decisionConstants.juryManagementWeight`) and its current value
  are on record from the 2026-06-21 re-measurement (`docs/audits/2026-06-21-session-observations.md`).

**AC**
- [ ] No code change ships against this item absent a fresh re-measurement showing the reach-side
  effect has become a real defect, not emergent realism.
- [ ] `JURY_WEIGHTS.gameRespect` is never lowered further than its current 0.7 floor (0.65 would
  over-correct an already-solved problem).
- [ ] IF reopened: `tests/property/juryReach.property.test.ts`'s `EARNED_WINS` guard stays green
  after any `juryManagementWeight` tuning, and the 30-seed active-vs-passive win-rate gap (currently
  20% vs. 7%) does not invert.

**DoD**
- [ ] Ruled **CLOSED** 2026-07-21 — no DoD applies unless reopened.
- [ ] If reopened: AC met, `npm run test:heavy` (the jury/gradient shards) green, and both
  `docs/audits/2026-06-21-session-observations.md` and this backlog doc updated with the new
  measurement.

#### TUN-2 — DoR / AC / DoD

**DoR**
- [ ] The owner ruling is on record: all three Phase-2 extensions **parked** 2026-07-21.
- [ ] If ever reopened, each of the three extensions needs its own design decision per
  `docs/features/0066-in-game-time-and-sleep.md` §9's "Open / to confirm" list: the fatigue-meter
  compounding curve, the next-day-fatigue carryover rule, and whether clock advance moves to
  per-conversation granularity. None are decided yet.

**AC**
- [ ] No code ships against any of the three extensions absent a fresh owner unpark ruling.
- [ ] IF unparked: whichever extension ships stays a hidden, bounded modifier beside the existing
  rest term in `resolveCompetition` (never shown to the player, per ADR 0006), and the sleep/time
  feature stays opt-in (0066's existing flag posture).

**DoD**
- [ ] Ruled **CLOSED / PARKED** 2026-07-21 — no DoD applies unless reopened.
- [ ] If reopened: AC met, `npm run test:ci` green, and `docs/features/0066-in-game-time-and-sleep.md`
  §9 updated to record which extension(s) shipped and why.

#### TUN-3 — DoR / AC / DoD

**DoR**
- [ ] #2 (model-aware reasoning sizing): a decision on what "model-aware" keys off — per-model
  reasoning-token defaults sourced from T0-4's `CapabilityProfile`, or a static per-model table.
- [ ] #4 (`Continue ▸` in chat mode): the UI affordance is designed — where it renders and what
  makes a turn eligible (a `finishReason` indicating truncation, per the now-DONE #3 ledger work).

**AC**
- [ ] #2 — reasoning-token sizing is chosen per the resolved model's known capability rather than
  one global constant, verified across at least two differently-sized models.
- [ ] #4 — a `Continue ▸` affordance appears in chat mode when the last assistant turn's
  `finishReason` indicates truncation (the DONE #3 ledger's `appliedMaxTokens`/`finishReason` field),
  and clicking it resumes generation as a continuation of the same row (superseding, not appending —
  coordinated with T1-4's ack-is-the-row / #1728's render log).

**DoD**
- [ ] AC met for whichever sub-item ships; test lanes green: full FE pytest suite
  (`orwell_token_ledger.py` / `token_policy.py` tests for #2, `chat.js` / render-log tests for #4).
- [ ] CLAUDE.md's ADR 0010 follow-on line updated from "#2/#4 still open" to reflect whichever
  lands.

#### TUN-4 — DoR / AC / DoD

**DoR**
- [ ] A real Proxmox host is available to the owner for the run — this is explicitly **owner-run**,
  not CI-automatable.
- [ ] The current `orwell.sh` / `orwell-install.sh` / `orwell-update.sh` install-vs-reconcile parity
  trace (the 2026-07-13 reconcile hardening) is the baseline being verified live, not re-designed.

**AC**
- [ ] `orwell.sh` creates the LXC and `orwell-install.sh` completes end-to-end on a real Proxmox host
  (apt + Node 22 + Python, systemd units, `CAP_NET_BIND_SERVICE` drop-ins, optional
  `CT_ROOT_PASSWORD` console login), exercising the real `pct`/`pvesh` bridge.
- [ ] A subsequent `orwell-update.sh` run reconciles correctly per the drift test's guarantees
  (opt-in env defaults, security keys, systemd units, ownership, fastembed prefetch).
- [ ] The A4 single-PAT deploy flow (one-time `GIT_TOKEN` persisted via the git credential helper)
  is verified live.

**DoD**
- [ ] AC met and recorded — this is owner-run, so the "test lane" is the run itself, not a CI job.
- [ ] The deploy-reconcile drift test (`install.sh`-parity trace) stays green as the structural
  precondition.
- [ ] CLAUDE.md's "Open forward work" 0010 line marked done with the run date; any live-only finding
  (a `pct`/`pvesh` quirk the parity trace didn't catch) is folded back into `orwell-doctor.sh`'s
  warns or the install/update scripts.

#### TUN-5 — DoR / AC / DoD

**DoR**
- [ ] A concrete scale trigger exists (the single-host SQLite ceiling actually reached, or a
  multi-host deploy requirement) — this item explicitly "only matters past a single-host deploy," so
  confirming the trigger is the first gate before any design work starts.
- [ ] The `SaveStore`/`UserSaveStore`/vector-index port contracts (already stable behind SQLite) are
  reviewed for anything Postgres-specific that would require a new port method.

**AC**
- [ ] A Postgres+pgvector adapter implements the existing `SaveStore`/`UserSaveStore`/vector-index
  ports with **no port-interface changes** — the same hexagonal boundary SQLite proved out.
- [ ] Selectable via an env var alongside `ORWELL_STORE=sqlite` (e.g. `ORWELL_STORE=postgres`),
  engine-only.
- [ ] The non-degradation invariant (mandate #4) and cross-user isolation hold under the new
  adapter, proven by the same test suite the SQLite adapter runs against.

**DoD**
- [ ] AC met; test lanes green: `npm run test:ci` extended with a Postgres-backed adapter test
  matrix (mirroring however `ORWELL_STORE=sqlite` is tested today), dependency-cruiser (`npm run
  test:arch`) confirms no new Vault-boundary edge.
- [ ] CLAUDE.md's datastore section gains the Postgres tier alongside SQLite; "Open forward work"
  TUN-5 marked done.

#### TUN-6 — DoR / AC / DoD

**DoR**
- [ ] `live-harness-nightly.yml`'s existing `_verify_two_window_live.py` leg is identified as the
  vehicle (already live today per CLAUDE.md).
- [ ] The specific mid-gen-join scenario (a second window joining while the first is mid-stream) is
  scripted as a repeatable case within that leg.

**AC**
- [ ] The nightly live-harness leg exercises a live-LLM two-window mid-gen-join scenario (not just
  steady-state mirroring) and asserts parity — both windows converge on the same rendered content,
  no orphaned/duplicate rows.
- [ ] A pinned regression test captures the mid-gen-join case specifically, distinct from the
  general F5 CI-gated parity check (which stays stubbed-LLM and blocking).

**DoD**
- [ ] AC met; test lane green: `live-harness-nightly.yml` (non-blocking, key-gated,
  `continue-on-error`) shows the mid-gen-join leg green across a normal observation window.
- [ ] The existing blocking F5 CI gate (`docs/audits/2026-06-27-ship-gate.md`) is unaffected and
  stays required.
- [ ] CLAUDE.md's ADR 0008/0012 residual line marked done, referencing the live-harness leg by name.

#### TUN-7 — DoR / AC / DoD

**DoR**
- [ ] Frozen specs 0097/0098/0103: no DoR — they are PO-GATED per the 2026-07-21 ruling; reopening
  requires a fresh owner ruling, not engineering initiative.
- [ ] In-progress specs 0111/0112: their own `.feature`/design docs (`docs/features/0111-*`,
  `docs/features/0112-*`) are the DoR source; 0112's scope is additionally reconciled against
  #1599's requirement that it serve as the observability substrate for RED-on-fire telemetry.

**AC**
- [ ] 0097/0098/0103: no behavior changes ship under these numbers without a dated owner unpark
  ruling recorded in this doc's T7 table. 0098's outcomes-untouchable principle (no player input
  modulates a seeded outcome distribution, not even variance) is asserted by name in any future
  reopening decision, never silently dropped.
- [ ] 0111: the Day-1 experience spec's own acceptance criteria (`docs/features/0111-*.feature`)
  pass.
- [ ] 0112: LLM-call observability's own acceptance criteria pass, **and** it demonstrably serves as
  #1599's substrate — a belt/fallback fire is observable/RED per the #1599 mechanism through 0112's
  instrumentation, not a separate ad-hoc log.

**DoD**
- [ ] Frozen specs: no DoD applies while parked; status stays as recorded in
  `docs/features/README.md`.
- [ ] 0111/0112: AC met; test lanes green: `npm run test:ci` + `npm run test:bdd` once each
  `.feature` file is added to `cucumber.cjs`'s implemented list, full FE pytest suite for any
  FE-side pieces.
- [ ] `docs/features/README.md`'s status index flips 0111/0112 from "in progress" to "built"; CLAUDE.
  md's "Current status" section updated to match.

#### TUN-8 — DoR / AC / DoD

**DoR**
- [ ] R1 remainder: the structured stale-beat body schema is decided (what a 409 `stale-beat`
  response should carry beyond today's shape), and the auto-derived-gamechanged-set design is
  decided (deriving the g15 dispatch trigger set from mutation metadata rather than a hand-maintained
  list).
- [ ] R2/#1413: the #1728 render log (D1) exists first — R2 "collapses duplicated live-vs-reload
  chat render paths… onto it."
- [ ] R3: the `chat.js` decomposition boundaries are drafted (which responsibilities split out).
- [ ] R6: the failure-mode UX inventory (which failure states currently lack UX) is catalogued.
- [ ] R7: the polish-bundle item list is catalogued.

**AC**
- [ ] R1 — a stale `expectedBeatSeq` 409 returns a structured body the FE can branch on without
  string-matching; the `orwell:gamechanged` trigger set is derived from mutation metadata rather than
  hand-maintained, still routing through the single g15 dispatcher.
- [ ] R2/#1413 — ships strictly after #1728's render log lands, collapsing *onto* it rather than
  beside it; `test_g15_gamechanged.py` and a render-parity test (live vs. reload) stay green.
- [ ] R3 — `chat.js` is decomposed along the drafted boundaries with no behavior change (a
  before/after functional-equivalence check).
- [ ] R6 — every catalogued failure mode gets a defined UX treatment, never silent.
- [ ] R7 — the bundled polish items ship with no regression to the surfaces they touch.

**DoD**
- [ ] AC met per sub-item shipped; test lanes green: `npm run test:ci`, full FE pytest suite (the
  g15 gate is non-negotiable for anything touching `orwell:gamechanged`); the F5 two-window-parity
  CI gate stays green for R2/R3 (they touch the render/mirror path directly).
- [ ] `docs/REFACTOR-ROADMAP.md` marks each shipped sub-item done; this backlog's TUN-8 row updated
  to reflect the remainder.

#### TUN-9 — DoR / AC / DoD

**DoR**
- [ ] The Seedream portrait provider's API contract is reviewed against the existing
  `ImageGenerationPort` (0051, outward by construction — the engine emits only Vault-free portrait
  prompts).
- [ ] A decision is made: Seedream becomes a new selectable portrait model alongside the current OOB
  default (`google/gemini-3.1-flash-image` per the 2026-07-13 ADR-0016 re-amendment), or replaces it.

**AC**
- [ ] Seedream is wired as a selectable portrait-generation lever through the existing
  `ImageGenerationPort`, with no new Vault-adjacent surface.
- [ ] Switching to Seedream produces portraits gated by the same game-build provider-gating rule
  (OpenRouter image models via `/chat/completions`) as the current default.
- [ ] The ADR-0016 doc and `frontend/scripts/oobe_reset.py`'s in-code default comment stay in sync —
  closing the same doc-drift class T0-4's DoR flags for the narrator model.

**DoD**
- [ ] AC met; test lane green: full FE pytest suite (portrait-generation provider-gating tests); no
  engine-side test lane needed unless `ImageGenerationPort`'s contract changes (then `npm run
  test:ci`).
- [ ] ADR 0016 amended with the Seedream lever's shipped status; CLAUDE.md's "not-yet-built" language
  for the Seedream follow-on updated to built.

#### TUN-10 — DoR / AC / DoD

**DoR**
- [ ] D6 is ruled: **CONFIRMED** — deploy-parity flags on dev/playtest rigs, env-level only
  (2026-07-21).
- [ ] The full flag set is enumerated per the synthesis §7.2 reconciliation: six flags
  (`ORWELL_CAMPAIGNS`, `ORWELL_TRAJECTORIES`, `ORWELL_STRATEGIC_CADENCE`, `ORWELL_SCHEME_TARGETS`,
  `ORWELL_CONFESSIONAL_DEPTH`, `ORWELL_NPC_DEAL_OFFERS`), plus `ORWELL_DEAL_DEPTH` held back pending
  its own live-loop reconciliation.
- [ ] The dev runner and the playtest driver scripts are identified as the env-setting sites — never
  `GameSessionAdapter.ts` defaults.

**AC**
- [ ] The dev runner and the playtest driver set `ORWELL_CAMPAIGNS`, `ORWELL_TRAJECTORIES`,
  `ORWELL_STRATEGIC_CADENCE`, `ORWELL_SCHEME_TARGETS`, `ORWELL_CONFESSIONAL_DEPTH`,
  `ORWELL_NPC_DEAL_OFFERS` at the env level, matching deploy's flag posture.
- [ ] `ORWELL_DEAL_DEPTH` stays OFF everywhere (including dev/playtest) until its own live-loop
  reconciliation lands, per its code comment.
- [ ] The in-code defaults in `GameSessionAdapter.ts` are untouched (still OFF) — confirmed by the
  calibration-neutral seeded gates (`tests/property/juryReach.property.test.ts`, gradient
  calibration, the UAT spine) staying byte-identical, since they never set these envs.

**DoD**
- [ ] AC met; test lanes green: `npm run test:heavy` (the jury/gradient shards prove calibration
  neutrality is untouched — byte-identical), a smoke run of the dev runner/playtest driver confirms
  the envs are actually set (a log line or health-check surfacing active flags).
- [ ] CLAUDE.md and this backlog doc's TUN-10 row marked done, noting the flag list and the explicit
  `ORWELL_DEAL_DEPTH` exception.

### T7 — Owner decisions — **RULED 2026-07-21 (evening session)**

| ID | Ruling |
|---|---|
| D1 | **APPROVED** — engine chyrons for official outcomes; AI demoted to color on those beats (scoped ADR 0003 amendment). |
| D2 | **APPROVED** — non-blocking nightly probe canary. |
| D3 | **APPROVED, pinning + a direct z.ai endpoint.** Probe/pin whatever the configured narrator default resolves to — `settings.py` ships GLM-4.7 OOB today, while the ADR-0016 README row also records a glm-5.2 retarget the ADR text calls removed; T0-4's implementer reconciles that doc drift while probing the real endpoints. |
| D4 | **Footage Pool: APPROVED**, gated on the casting ledger (T0-6) landing first. |
| D5 | **Blindside autopsy: PARKED** — revisit after the Footage Pool + an adversarial redaction suite. |
| D6 | **CONFIRMED** — deploy-parity flags on dev/playtest rigs, env-level only. |
| D7 | **OVERRULED dual-transport permanence: GO FULL WEBSOCKET.** Consolidate to WS as the one transport (ADR 0017/0018 revision; the parked one-channel proposal un-parks in WS form as a Wave-2+ item). The ADR 0017/0018 + decisions-README text revision is OWED and rides the Wave-2 implementation PR — until the consolidation lands, the SSE leg stays live and CI-blocking, so current-state docs remain accurate. |
| D8 | **GRANTED** — allowlist entries for the two by-design fail-soft lanes, RED-with-auto-corrected stays mandatory. |
| D9 | **DONE** — owner reports all exposed keys rotated; obligation closed. |
| D10 | **CONFIRMED re-scope + NEW MANDATE:** casting must be deep AND fast — **<10s finalize-to-house**, per-NPC parallel fan-out (15-wide, no content bundling), **all 15 deep profiles complete BEFORE the house door opens** (achieved via early kickoff during the casting interview), and the #1713 premiere-path block bounded. **This work LEADS Wave 1** (it INCLUDES T0-6, so D4's T0-6 dependency is satisfied by step 0); the rest follows after it merges. |

Further rulings same session: **TUN-1** leave (goats-reach-F2 = realism) · **TUN-2** all three Phase-2
time/sleep extensions parked · **0097/0098/0103** stay parked with built cores, now flagged
**PO-GATED** (0098 additionally held on the outcomes-untouchable principle, explicitly re-upheld —
the standing principle stands: no player input modulates a seeded outcome distribution, not even
variance). Round-2 moonshot (divergent ideation on mined intelligence) commissioned same session.

#### (Original decision cards, for the record)

| ID | Decision | Blocks |
|---|---|---|
| D1 (Q1) | Approve the scoped ADR 0003 amendment: closed-set ceremony outcomes as engine chyrons, model demoted to color ("the chat gains a stage"). | T0-3, and therefore most of T0's value |
| D2 (Q2) | Approve the narrow 840e5f92 reversal: a non-blocking nightly probe canary (not 0108 revived). | T1-2; Wave-2 acceptance |
| D3 (Q3) | Provider posture: accept `provider.only` pinning's failover tradeoff (ordered probed fallback chain) and/or a direct z.ai endpoint. | T0-4's pinning arm |
| D4 (Q4) | Sanction the Footage Pool as a second quarantined Vault-adjacent lane (automated, unlike producerVault) on structural-quarantine terms. | T1-5 (Wave 3) |
| D5 (Q5) | Blindside autopsy: is any bounded mid-season Vault exception ever rulable? | T1-8 (Wave-5 decision point) |
| D6 (Q6, reframed) | Confirm TUN-10's deploy-parity approach for dev/playtest rigs (env-level, not code defaults). | TUN-10 |
| D7 (Q8) | ADR 0017: willing to reopen post-Wave-2 for single-log consolidation, or is dual-transport permanence absolute? | the parked one-log proposal |
| D8 | #1599 allowlist grants: the moonshot P4/P8 fail-soft sites will need explicit owner-permitted entries (site + reason) under the governing ruling. | T1-4/T1-5 DoD |
| D9 | **🔑 ROTATE KEYS (standing, do NOT defer):** rotate/revoke the provider keys and the GitHub PAT used across this campaign **as soon as practical** — they passed through chat and belong rotated now, not at a milestone. The specific inventory lives in the session's secure notes (`SOUL.md` carry-forward), not in this committed doc; scrub the session scratchpad copy after rotation. | immediate |
| D10 | #1713 behavioral fix scope: the premiere-path 300s block needs an owner/engine decision (it is an owner-driven feature); confirm the re-scope in T2. | #1713 Step-2 |

*(Q7 — the golden-path treadmill — is moot: the apparatus was decommissioned by #1765 before the
synthesis landed. No decision needed.)*

### T9 — Resiliency: the fallback & defense-in-depth register (owner ruling 2026-07-21)

**The ruling.** The judged portfolio gets built — but every non-winning proposal stays in the back
pocket as a designated fallback, and compensating layers are **demoted, never deleted**, until their
replacement has survived a full live season plus a clean canary window. A demoted layer is an armed,
alarmed fallback: it fires only when the primary fails, and every fire shows RED per the #1599
no-silent-fail-soft ruling. Nothing that hardens the game is thrown away.

**Primary → fallback → keep-anyway map (the build items):**

| Primary | If it flakes / is denied | Keep-anyway layers (defense in depth) |
|---|---|---|
| T0-2 beats terminate themselves | The repaired L39b escalation (post-comparator-fix) stays armed as the watchdog; the progression belts remain demoted-armed | Stall-nudge telemetry stays permanently |
| T0-3 chyrons (needs D1) | Fallback A: "the board speaks in its own voice" — copy-constrained prose rendering of the same engine beat cards (no new UI, no ADR 0003 question). Fallback B: "one grounding spec, compiled twice" — fail-closed claim-type policy compiled to both languages (also fixes #1749 parity drift structurally) | The 11 claims-guards stay as hard-drop rails even after chyrons ship; the pre-emission outcome guard stays |
| T0-4 provider probe/pin (D3) | Enumerated-JSON downgrade path (in the P2 spec); ordered probed fallback chain; worst case the DECIDE pass routes to a schema-verified utility endpoint | Attempt-counted honoring telemetry stays permanently |
| T0-5 reasoning scrub | — (it IS a fallback layer) | **Permanent** — kept even after pinning restores the separated reasoning channel |
| T0-6 casting ledger | Per-facet regex guards (INK_RE et al.) demote to alarmed monitors — they stay as canaries that the generic facet-diff validator is working | The #1768 ink backstop stays |
| T1-1 Act→Commit→Voice | Per-beat-class flag rollback to the demoted belt path; the engine seeded default guarantees liveness on either path | The forced-tool_choice rung stays demoted-armed per class |
| T1-4 honest delivery | If the streaming G-class persists after it: escalate to "one log, one channel" (parked under D7) — that proposal is the designated escalation, not dead | The send outbox + existing recovery mechanisms demote, never delete |
| T1-5 footage pool (D4) | "The House You Can Hear" — the salience-sifted ambient feed over EXISTING template pools + widened gloss pools + roster voiceFingerprint push: real texture improvement with zero Vault authorship, shippable if D4 is denied or the lane misbehaves | Template pools stay as the fail-soft floor (they are the fallback by spec) |
| T1-6 editorial organ | Ships flag-gated; flag-off is byte-identical (UAT spine) — rollback is the flag | The engagement detector gating stays |

**All 27 proposals, accounted for by name** *(numbering across the artifacts drifts — names are
canonical; full sketches were delivered to the owner in-session 2026-07-21, and each champion's
mechanics are preserved in the synthesis §2, the merged keeper-details in §4)*:

| Proposal (persona) | Home |
|---|---|
| Air From the Board (designer) | ADOPTED — P1 stages ①② |
| Ceremonies are liturgy (designer) | ADOPTED — T0-2 |
| The House You Can Hear (designer) | MERGED into P5 sifter + **designated fallback for T1-5** |
| A turn is a durable object (designer) | ADOPTED — T1-4 |
| One Casting Bible (designer) | ADOPTED — T0-6 |
| The Chenbot Protocol (superfan) | MERGED into P1 ② — keeper: ceremony-frame pacing, "sameness is the feature" |
| convokeHouse (superfan) | ADOPTED — T1-7 |
| Whip count in the fog (superfan) | ADOPTED — T1-7 (pledges now, cascade behind the gradient gate) |
| The show bible (superfan) | ADOPTED — T1-3 |
| The blindside autopsy (superfan) | PARKED — D5, reopen after T1-5 + adversarial redaction suite |
| Shoot the footage when it happens (superfan) | ADOPTED — T1-5 (co-champion with Footage Pool, same build) |
| Act→Commit→Voice (engineer) | ADOPTED — T1-1 |
| The board speaks in its own voice (engineer) | MERGED into P1 ② + **designated fallback for T0-3**; keeper: Pitwall sentence repair |
| Provider capability contract (engineer) | ADOPTED — T0-4 |
| One log, one channel (engineer) | PARKED — D7; **designated escalation for T1-4** if the G-class persists |
| One grounding spec, compiled twice (engineer) | PARKED — **designated fallback B for T0-3**; also the structural fix for #1749 parity drift if ever needed |
| Commit-before-speak (contrarian) | MERGED into T1-1 (alt implementation shape); keeper: pause/host/resume mix-in |
| Outcomes leave the model's mouth (contrarian) | MERGED into P1 ② (duplicate) |
| The provider is on probation (contrarian) | MERGED into T0-4 + T1-2; keeper: attempt-counted telemetry |
| Author the Vault, don't madlib it (contrarian) | MERGED into T1-5 (duplicate); keeper: per-speaker scoping |
| One seeded identity ledger (contrarian) | MERGED into T0-6 (duplicate) |
| Beats terminate themselves (contrarian) | ADOPTED — T0-2 (the minimal-surgery implementation doc) |
| Cut To VT (narrative designer) | ADOPTED — P1 ② ceremony grammar (champion) |
| The Beat Card (narrative designer) | MERGED into P5 + **promoted keep-anyway layer for Wave 1**: compile the narrator's per-turn factual world into a tight beat card (narrower context ⇒ fewer invented facts) — grounding hardening independent of chyrons |
| The Tension Director (narrative designer) | ADOPTED — T1-6 |
| The Footage Pool (narrative designer) | ADOPTED — T1-5 (champion) |
| The Spy Screen (narrative designer) | ADOPTED — T1-6 |

**Keeper details that must not get lost in the merges** (from the synthesis §4): drop-on-timeout
color calls (never load-bearing) · pause/host/resume mix-in · Pitwall sentence repair ·
attempt-counted telemetry · per-speaker scoping · the belt-demolition inventory (now a
belt-DEMOTION inventory per this ruling).

### T8 — Standing discipline (not work items; the operating rules that keep the above true)

Unchanged from `HANDOFF.md` §5 / `SOUL.md`: worktree isolation for all code agents · one GitHub
mutating call at a time · `mergeable_state` semantics · sweep-armed merge-on-green ·
diagnose-before-re-trigger · secrets by path, never by value · full FE suite before FE pushes ·
verify bot claims against code personally.

---

## Sequencing summary (the short version)

0. **FIRST (owner order 2026-07-21): the casting mandate** — FacetLedger + 15-wide genesis + early kickoff + strict entry gate + the #1713 premiere-block fix, targeting <10s finalize-to-house with full depth pre-authored. In flight; the rest of Wave 1 dispatches after it merges.
1. **Then (no owner decision needed):** T0-1 comparator fix · T0-2 beats-terminate-themselves
   (server-side, no UI change — needs no ADR 0003 ruling) · T0-5 reasoning scrub · T0-4 probe
   (telemetry arm) · #1729-B1 recorder gate · TUN-10 rig parity. (T0-6 + #1734 are inside step 0, not here.)
2. **On D1 (Q1):** T0-3 chyrons — the remaining heart of Wave 1 — then the T0-7 exit playtest.
3. **Wave 2+:** T1-1 (belt demolition) → T1-2 (on D2) → T1-3/T1-4 (+#1728 render log) → T1-5 (on
   D4) → T1-6 → T1-7 → T1-8 (on D5).
4. **Continuously:** #1644 text standardization · #1599 fail-soft audit (with 0112) · T4/T6
   opportunistic batches.
5. **Always (the T9 doctrine):** demote → observe → delete. No superseded guard/belt/scrub is
   removed until its replacement survives a full live season + a clean canary window; demoted
   layers stay armed and alarm RED when they fire.


---

## Part C — The wave breakout (the full backlog, ordered for execution; reconciled 2026-07-21 late)

Every open item from every tier + both moonshot rounds + the session rulings, in ONE wave structure.
(Contracts: each named item's DoR/AC/DoD is in Part B above or its tracker issue.)

### Wave 0 — IN FLIGHT NOW
| Item | Vehicle |
|---|---|
| Casting mandate (FacetLedger, 15-wide, prewarm-during-interview, entry gate; owner-clarified: ≤10s = the user-facing wait at the house door, authoring covers under the interview) | agent → `claude/casting-ledger-fast` |
| #1713 premiere ~300s block bound | agent → `claude/1713-premiere-block-fix` |
| T0-1 comparator + T0-5 scrub + #1729-B1 RED events | **PR #1774** |
| T0-4 capability probe + attempt telemetry + TUN-10 rig parity | agent → `claude/t0-probe-rig-parity` |

### Wave 1 — GROUND TRUTH ON AIR (remainder; all decision-gates cleared)
T0-2 beats-terminate-themselves (dispatches when #1713's branch lands — same file) · T0-3 engine
chyrons (D1 ✅) · the Q2 flag flips (`ORWELL_GOSSIP_DRIFT`, `ORWELL_SECRET_BARTER`,
`ORWELL_SHOWRUNNER` observe-only) · T0-7 exit playtest (zero phantoms / retcons / livelocks /
reasoning leaks).

### Wave 2 — THE PIPELINE + RECORDING INTEGRITY
T1-1 Act→Commit→Voice (belts DEMOTE per class, RED-on-fire) · T1-2 nightly canary (D2 ✅) ·
T1-3 show bible · T1-4 honest delivery **+ #1728 render-log/fold-integrity + #1729-D2 resumable
stream** (same substrate; the P1 recording-integrity pair rides here — also closes session task #20
FE-freeze evidence) · **D7 full-WebSocket consolidation** (ADR 0017/0018 revision rides the
implementation) · Q7 pacing-budget spec (commissioned — resolves PO-1).

### Wave 2.5 — ROUND-2 QUICK WINS (Q8 hybrid: small+reversible → flagged build + live demo)
C1 Wipeout Reel (9.0) · B1 Telephone-Game Payoffs (needs the drift flag from Wave 1) · E2
Traitors' Fury + bearing · F1 Your Legend Precedes You (notoriety finally voiced). Each: flag,
off ⇒ byte-identical invariant, seeded, per the slate §6 binding constraints.

### Wave 3 — FOOTAGE + THE ROUND-2 SPEC BATCH (M/L: short spec first per Q8)
T1-5 footage pool (D4 ✅, after the ledger) · specs then builds: D1 Ballot Arithmetic (typed
voteClaims), A1 Fifteen Pairs of Eyes (bounded observer sets), C2 Odd-Couple B-Plots, E1 exit
package (Q1 ✅ player-only, player-knowledge-layer predicate), C3 seeded partial pan (Q4 ✅), A2,
C4 (deterministic grounding), D2, cross-season F2 + F4-without-step-2 (Q3 ✅, Q5 ❌ step-2) ·
Q6 payoff-balance options specced both ways (PO-gated).

### Wave 4 — THE EDITORIAL ORGAN
T1-6 sifter + tension director + interstitials + Spy Screen · remaining round-2 mid-band as ruled
via live demos (B2, B3 after B1, B4, C5, C6, E3, F3).

### Wave 5 — AGENCY + ENDGAME DEPTH
T1-7 pledges/flip-cascade/convokeHouse · T1-8 autopsy decision point (D5 parked) ·
presence/location parity remainder (session task #14: BL-007/013/033) · ADR 0019 Layers 2-3
(task #24, coordinate with footage redaction).

### CONTINUOUS (not wave-bound)
#1644 text standardization · #1599 fail-soft audit (with 0112) · #1413/R2+R3 render-path collapse
(onto the Wave-2 render log) · R6/R7 · RES-2..RES-5 opportunistic · 0111/0112 in-progress specs.

### PARKED / PO-GATED (no work without a new ruling)
0097/0098/0103 wiring · D5 blindside autopsy · Q6 payoff balance · D3 Genius Back-Room ·
TUN-2 time/sleep Phase-2 · TUN-4 Proxmox smoke (owner-run) · TUN-5 Postgres tier.

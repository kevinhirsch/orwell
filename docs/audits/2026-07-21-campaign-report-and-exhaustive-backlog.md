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
that decision.

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

### T3 — Live-playtest findings F1–F10 → disposition map

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

### T5 — Overseer session tasks (open ones, reconciled)

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

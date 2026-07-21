# Moonshot Refactor Synthesis — 2026-07-21 (mixture-of-experts)

**Inputs:** 6 forensic digests, 27 expert proposals across 5 personas, tri-lens judge verdicts (champions: #12, #23, #14, #26). **Primary evidence:** the 2026-07-21 full live playtest to finale (`.audit-telemetry/`, real FE + engine + GLM-4.7/novita). **Verdict inherited:** behavioral fidelity is rich; narrative fidelity to the board is the broken axis.

---

## 1) The Chronic Breakage Map

### A. Authority inversion — narration airs before truth is read
The player-visible stream is produced *before* engine truth is consulted; all grounding machinery is post-hoc reconciliation of an already-spoken lie. **Recurrence engine:** belt-on-belt accretion — 21 registry belts all patch one failure ("narrate the beat, skip the call"); each live playtest adds a belt (`docs/design/undercall-seam-structural.md` §1: "correctness-by-accretion"); L39b's 141-silent-advance decoupling required three new belts to bound the first. Guards detect but cannot prevent: the pre-emission guard is fail-open at ~36 sites, and its blank-turn fallback *re-emits* unverified phantoms (`agent_loop.py:4553-54`). **Evidence:** playtest F1 (phantom HOH/noms/veto; "You survived week one" over an engine 9–4 eviction), F4 (triple re-narration, silent day-rewinds), F5 (E12 ballot attribution ~5/13 wrong, illegal HOH ballot); sync-ledger rows showing "HELD a phantom" while the falsehood aired.

### B. Voluntary progression + the guardrail-vs-guardrail deadlock
Beat completion depends on the model *electing* to call `advanceGame`; the counter-pressure is pleading (31 "advanceGame" mentions in `momentPrompts.ts`, 20 "(Production note" strings, rung-3 "STOP. The game is FROZEN") — violating the project's own founding lesson that prompt wording is not enforcement. **Recurrence engine:** pleading-vs-structure, plus a falsified invariant: ADR 0011's "single-tab ⇒ `_peer_advanced` always False" was broken by two later changes to the framed key (#1019's 4-tuple vs the raw 3-tuple at `agent_loop.py:2306-25` / `chat_helpers.py:4543-47`), so every pending-open turn reads as a false peer-advance, wiping five stall counters and vetoing every rescue at `agent_loop.py:7372`. **Evidence:** F2 — 17-turn eviction-reveal livelock, unwedged only by the player begging; forced tool_choice logged 20×, landed 7×.

### C. Provider folklore — capability assumed, never measured
tool_choice honoring is assumed unless a DeepSeek substring matches (`agent_loop.py:1696-1703`); an ignored force triggers nothing (success-gated telemetry undercounts exactly when the provider misbehaves). **Recurrence engine:** no capability contract at the transport layer, and the only real-model CI gate was decommissioned (commit 840e5f92) — model-class regressions can now surface *only* in live playtests. **Evidence:** F2 (OpenRouter's documented silent-ignore routing behavior), F3 (`reasoning_chars=0` — the known GLM-via-OpenRouter reasoning-channel loss, cherry-studio #12473 — putting planning text and engine jargon in visible bubbles).

### D. Cast/persona drift — one class, sixteen backstops
Four partially-overlapping authoring lanes (deterministic floor, genesis, deep authoring, identity quotas); any facet not explicitly dealt falls to the model's reality-TV prior; the merge is non-transactional, grafting bios onto skeleton ages/genders/Vault secrets. **Recurrence engine:** per-facet regex whack-a-mole (#533, 0063, #544, #850, #1140, #1317, #1706, #1733, #1768's INK_RE…) — each patches one escaped facet, none closes the class. **Evidence:** F6 — 3/15 fire-service vocations (the un-ledgered "first-responder" steering line ×3), smokejumper identity bleed, chimera cards (Donna authored 58 / live 22), 66/71 Vault secrets keyed to a phantom pre-genesis cast; #1768's fixes verified NOT on main.

### E. The madlib compression funnel — rich society, seven sentences
The off-screen society is structurally real (13 weeks demonstrated) but textually templated: RICH_VERBS=7, RUMOR_GLOSS=7, LEGEND_GLOSS=5, confessional line-pools — verbatim cross-NPC repetition is mathematically guaranteed. Four sequential valves starve delivery: burst-then-silence cadence (SOCIAL-6), riseProb 0.15/transmit 0.25 (week-1 house→player flow was literally ZERO, SOCIAL-7), gloss compression, and narrator under-delivery (npcVoice called 0/24 — the richest voice data is pull-only and never pulled). **Recurrence engine:** template floors treated as adequate because anti-sycophancy was over-read as "no model text anywhere hidden"; five enrichment flags default OFF in code (`GameSessionAdapter.ts:460-500`) *[flag count + the design intent behind the OFF defaults reconciled in §7.2]*.

### F. The bilingual fail-open scrub stack
~9 sequential lexical layers in two languages, hand-"parity-locked" and drifting (#1749: patterns "in the Python side all along but MISSING here"); five commits in one week each independently rediscover "prompt wording is not the wall." **Recurrence engine:** post-hoc lexical matching on semantic content, with fail-open as the site-local default and corrections delivered as *silent* next-turn regrounds — the playtest's silent retcons are the design working as built. **Evidence:** F3 (engine jargon in NPC dialogue), F9 (real host named; "jury house" for a first evictee — the only playtest class with zero structural defense), F10.

### G. Streaming delivery fragility
Dual permanent transports double every invariant; ~6 hand-rolled recovery mechanisms, three competing completion signals. **Recurrence engine:** each fix ships its own one-shot/cap bug (#1718 WS orphaned pending, #1720 SSE one-shot timer, BL-004's single-slot drop of 17/24 corrections). **Evidence:** F7 (message rendered locally, never reached server — recurring after the entire #827→#1709 lineage), F8 ("The" as a whole reply; dangling "**").

---

## 2) The Winning Portfolio

### P1 — The Authority Inversion (champions #12 + #23 + #27a, merged; #22 is the implementation doc, #17/#8 the presentation layer) — **Cost: L (staged; first phase S)**
Three stages, strictly ordered:

1. **Beats terminate themselves (#27a).** Resolving a beat's pending decision auto-advances server-side *in the same transaction* — the eviction reveal cannot wedge behind an open goodbye pending because the pending resolving IS the exit. Fix the `agent_loop.py:7372` 4-tuple/3-tuple comparator during demolition. Days of work; kills the livelock class outright.
2. **Outcomes leave the model's mouth (#23).** Every committed ceremony fact (HOH, noms, veto, replacement, anonymized ballot sequence, eviction, finale votes) is emitted as a Vault-free `BeatAnnouncement` projection and rendered FE-side as a diegetic broadcast chyron — extending the shipped decision-card family (`orwellDecision.js`), staged card-by-card for suspense, riding the g15 seam and the same event stream (F5 parity inherited, verified). The 11 `_CLAIM_*_RE` guards flip from fallible detectors to a blunt hard-drop rail (safe: the chyron carries the truth; false-positive cost is zero). Delete the blank-turn phantom re-emit (`agent_loop.py:4553-54`). Phantoms become *unrenderable*; E12 fixes itself.
3. **Act→Commit→Voice (#12).** On closed-set beats (`requiredLever` non-null or pending open): a DECIDE micro-call returns constrained JSON picking from engine-enumerated legal actions — no prose, no tools; the FE executes the engine tool with `expectedBeatSeq`+`idempotencyKey`; non-conforming output ⇒ 2 bounded retries ⇒ engine seeded default (the game structurally cannot freeze). Engine COMMITS, bumps beatSeq. VOICE receives the committed stateDelta as its *only* factual source, zero levers on closed beats; color calls are drop-on-timeout, never load-bearing. Never mix schema + prose + tools in one pass (constraint tax, arXiv 2606.25605). Open social turns keep today's live stream untouched — the parts the playtest praised are open-set. Flag-staged per beat-class, ceremonies first, deleting belts as each class flips (~15 of 21 registry belts, #1154, L39b + its three bounding belts, the eviction drain, and the ADR-0011 comparator — "peer advanced" becomes "my write 409'd," an engine fact).

**Retires:** breakage classes A and B entirely. Honors mandate #3 more literally than the current build: the LLM finally, structurally, only narrates.

### P2 — Provider Capability Contract (#14 + #24) — **Cost: S**
A ~10-call probe at endpoint registration + nightly, persisting a per-endpoint `CapabilityProfile`: forced-tool_choice honoring rate, json_schema conformance, reasoning-channel separation, `require_parameters` acceptance. Wire `require_parameters:true` + `provider.only` pinning on any request carrying tool_choice/response_format; split by role (decide pass → schema-verified endpoint, e.g. pinned glm-4.7-flash at $0.06/M; voice pass keeps the prose model). Enforcement, not telemetry: red capability ⇒ admin banner + automatic downgrade to the enumerated-JSON path. Flip belt telemetry to attempt-counted with an honored/ignored outcome field. Re-arm a minimal real-model nightly canary (probe + one scripted ceremony turn, non-blocking, key-gated). **Retires:** class C; F3 fixed at transport by pinning alone; de-risks P1's decide pass.

### P3 — One Casting Bible (#26 + #11) — **Cost: M**
One cast-wide seeded `FacetLedger` minted BEFORE any LLM call: stratified-sampled budgets (with jitter + rare-outlier slots) for vocation family, region/hometown, marks/ink, heightBuild, skinTone, hair, voice tics, name phonology — the Nemotron-Personas pattern (structure sampled deterministically; LLM only elaborates). Every lane receives its NPC's dealt hand + the cast-wide taken-list; delete the un-ledgered "first-responder" steering line. Transactional adopt-or-regenerate merge — never graft; Vault secrets key to the post-merge identity. One *generic* facet-diff validator at `recordCastProfile` (closed facets only, per ADR 0005's spirit) replaces per-facet regexes. Start from the #1768 branch *[#1768 has since merged — start from `main`, §7.3]*. **Retires:** class D — and it's the hard precondition for P4.

### P4 — The Footage Pool (#20 + #25 + #6) — **Cost: M**
A quarantined, fail-soft FE background lane (the `orwell_zeitgeist.py` pattern; own token/process, no shared logger): per committed off-screen event, a cheap-model fan-out (GLM-4.7-Flash, ~$0.003/turn for all 15 minds) authors 4–8 lines of real scene dialogue from a redaction-at-source brief — each speaker's prompt containing ONLY their KnowledgeService block + voice fingerprint (no sibling facts in context ⇒ smokejumper-bleed dies at the source). Written back via a new `recordFootage` write-back (the documented four-place seam + a mandatory `McpServer.callTool` boundary test). Footage is Vault-stored beside its event, inherits its witness set, is constrained to the event's own facts and non-canonical for outcomes, and NEVER reaches the narrator context (distinct port; dependency-cruiser edge + boundary test) — it surfaces only when the event legally surfaces: gossip quotes a drifted line, recaps excerpt it, the 0048 retrospective replays scenes. Also: push voiceFingerprint/lexicon on the roster (fixing the npcVoice 0/24 starvation) and flip the five enrichment flags ON in code. **Retires:** class E's template layer; makes mandate #4 experiential.

### P5 — The Editorial Organ (#18 + #19 + #9-sifter + #21) — **Cost: L**
One deterministic director: (a) a Felt-style salience sifter over the EventStore ranks Vault-safe threads (recency × relationship-delta × proximity × novelty) and guarantees ≥1 surfaced thread per lull — replacing the starved probability valves; (b) an L4D-style tension meter runs build→peak→relax over each in-game day with a beat budget; a spent budget + a lull ⇒ the Director itself calls `advanceGame` (idempotent, beatSeq-guarded, gated on the existing engagement detector, single-writer per canonical session), narrated as an edit cut; (c) cadence-capped camera-cut interstitials render sifted texture diegetically; (d) the Spy Screen: a 2–3-peek weekly dramatic-irony budget spending *partial* overhears via the sanctioned `surfaceInformationTo` pathway (recorded, traceable, symmetric — NPCs overhear the player too), with a boundary-tested selector that excludes events pre-resolving pending closed-set beats. **Retires:** the perceivability half of class E; makes progression editorial rather than rescued. Build after P1 so it directs a narrator that can no longer lie.

### P6 — Player Agency Band (#3 then #2) — **Cost: M**
(1) **Pledges:** asking for a vote records a first-class Pledge — the NPC's *stated* intention, soul-distorted from their true hidden lean, trust-gated hedging; the Journal accumulates claims, never truth. (2) Vote-intent rumors ride gossip diffusion. (3) The flip cascade (threshold dynamics over the vote graph between veto ceremony and eviction) ships behind the gradient gate before default-on. Post-eviction pledge-vs-ballot deltas fold betrayal-shock automatically. Then **convokeHouse** (`{agenda, subjectId?, factId?}`): one event witnessed by the whole awake house (0066 presence decides attendance), one house-wide temperature roll, per-soul seeded reaction folds, high-riseProb aftermath rumor, campaign replans — with a symmetric NPC-side call-out, capped speaker count, and notoriety cost against spam. Dedicated-rng, flag-gated to keep the UAT spine byte-identical. **Retires:** the "9–4 as pure noise" experience gap; delivers the genre's signature set-pieces.

### P7 — The Show Bible (#4, absorbing #16's canon table) — **Cost: S**
One seeded, fail-soft authoring pass at season-create (zeitgeist pattern) writes a compact fictional canon — show name, host persona + verbal tics (the chyron voice), 6–10 quota-checked past seasons — stored via a `recordShowCanon` write-back, injected as a ~400-token whitelist into narrator context and cast genesis (1–3 superfan facets). The shared scrub corpus gains a real-show denylist (pattern-level: "Season N" + real-names corpus). **Retires:** class F's canon slice (F9) — currently the only playtest class with zero structural defense.

### P8 — Honest Delivery Lite (#10 subset) — **Cost: S**
Ack-is-the-row (clientMsgId → unique-constraint inbox → outbox clears only on observing the settled row on the same stream), a minimum-viable-turn gate (below-threshold or dangling-markdown tails re-render, never air), and the diegetic control-room correction card for the rare genuine post-air correction ("The control room reviewed the tape…") — never a silent reground. **Retires:** F7/F8 and the *silence* half of the retcon trust damage. Ships anytime.

---

## 3) Rules Worth Breaking / Rules That Held

### Worth breaking (surviving rule-breaks)

| Rule | What it protected | Replacement safeguard | Payoff |
|---|---|---|---|
| **ADR 0003** — "UI never replaces a game-progressing interaction" (closed-set arm only) | The chat-forward soul; no dashboard creep | Chyrons render *only* committed engine rows, in-stream, in-fiction (broadcast grammar), composing the OrwellWindow kit; decision cards are the in-product precedent nobody calls a breach; open-set play stays pure chat | Phantoms unrenderable; E12 self-fixing; the fiction gets *stronger* — "the chat gains a stage, not a dashboard" |
| **The belt doctrine** — FE error-corrects, never pre-empts/authors | Model authorship of the game's voice | Decide pass returns *data* from engine-enumerated legal actions; seeded default on non-conformance is anti-sycophancy made structural; voice pass keeps all prose | ~15 belts deleted; silent non-honoring structurally impossible |
| **ADR 0011** — beat-aware peer-advance suppression (ceremony arm) | Two-tab advance races | "Peer advanced" becomes an `expectedBeatSeq` 409 — an engine fact, not a falsified FE tuple comparison | The 17-turn livelock class unrepresentable |
| **"No model text in the Vault tier" / fail-soft floor absolutism** | Determinism, leak surface | Footage Pool: structural quarantine (distinct port, dep-cruiser edge, boundary tests, redaction-at-source briefs), non-canonical for outcomes, fail-soft to templates; gated on P3 | The archive quotes real footage instead of 7 madlibs |
| **"Hidden elements surface rarely" (spirit)** | Spoiler discipline | Spy Screen rides the sanctioned `surfaceInformationTo` seam untouched; selector boundary-tested to exclude beat-pre-resolving events; budgeted + temperature-rolled; symmetric | The player finally *feels* the proven off-screen society; scheming location becomes strategy |
| **840e5f92** (real-model gate decommission) — narrow reversal | The fixture treadmill's cost | A nightly probe canary: non-blocking, alarmed, ~cents, no fixture | Model-class regressions observable again at ~1% of golden-path cost |

### Rules that held (attacked and survived)
- **The Vault Wall** — held ALL playtest run; stays absolute (the autopsy proposal died against it — see §4).
- **Seeded outcome authority / anti-sycophancy** — zero plot armor observed; the inversion *extends* engine authority into progression and announcement.
- **Pure turn-driven time** — the PO's no-real-time ruling is correct and untouched.
- **Cross-user isolation** — untouched.
- **ADR 0005 open/closed split** — deepened, not broken: pledges are open-set claims; the ballot stays closed; `expressiveNonCollapse` gates remain the proof.
- **ADR 0017 dual transport** — challenged (#15) and held on timing and owner authority; revisit post-Wave-2.

---

## 4) Killed With Cause

- **#5 Blindside autopsy** — "conservative drop" redaction against the co-mention surface (every scene targeting the player co-stars living schemers) is semantically unproven; re-spec only after the Footage Pool exists and with an explicit PO ruling + adversarial redaction test suite.
- **#15 One log, one channel** — right destination, wrong quarter: ADR 0017 is owner-ruled permanent with the SSE leg CI-blocking, F5 closed two weeks ago, and it spends the riskiest surface on MED findings; extract P8, reopen post-Wave-2.
- **#16 Two-language grounding codegen** — real infrastructure built to police a prose jurisdiction Wave 1 abolishes for the closed set; canon table extracted into P7; fix #1749 parity by hand once.
- **#1/#7/#13/#17/#22/#24/#25/#27 as standalones** — endorsed, but merged into P1/P2/P4 as specified (keeper details preserved: drop-on-timeout color, mix-in pause/host/resume, Pitwall sentence repair, attempt-counted telemetry, per-speaker scoping, belt-demolition inventory).

---

## 5) The Roadmap

**Wave 1 — Ground Truth On Air (the launch-blocker axis: false narration + ignored tool_choice + reasoning leak).** Ship P1 stages 1–2 + P2, in parallel with P3.
- 1a: `#27a` in-transaction auto-advance + the 7372 comparator fix. *Accept:* replay the playtest's eviction-reveal scenario — the wedge is unrepresentable; a suite test proves pending-resolve ⇒ advance in one commit.
- 1b: Chyron cards for all committed ceremony beats; claim guards → hard-drop; blank-turn re-emit deleted. *Accept:* a scripted ceremony run shows zero closed-set outcome tokens originating in model prose; E12 ballot sequence byte-equal to engine data; F5 two-window parity green; golden fixture re-recorded in the same PR *[inapplicable — the fixture apparatus is decommissioned, §7.1]*.
- 1c: Probe/pin (P2): `require_parameters:true` + provider pinning; role-split routing; attempt-counted honoring telemetry. *Accept:* probe shows reasoning-channel separation restored (`reasoning_chars>0`) or the endpoint auto-downgrades with an admin banner; honoring rate is a stored per-endpoint fact.
- 1-parallel: P3 ledger + transactional merge. *Accept:* 30-cast A/B — zero facet triple-dups, zero chimeras, 0 mis-keyed Vault secrets; #1768 merged/superseded.
- **Wave-1 exit criterion:** a live playtest week 1 with zero phantom outcomes, zero silent retcons, zero livelocks, and no reasoning text in visible bubbles.

**Wave 2 — The Pipeline.** P1 stage 3 (decide/commit/voice) flag-staged per beat-class, ceremonies first; belts deleted per flipped class; nightly canary armed; P7 canon bible; P8 delivery-lite. *Accept:* per flipped class, the class's belts are deleted (not disabled) and the canary's phantom-claim rate is 0 across 7 nights; F9 denylist lint green.

**Wave 3 — Footage.** P4 lane + boundary tests; consumers wired (gossip quotes, 0102 recaps, 0048 retrospective). *Accept:* dep-cruiser proves no narrator-context path to the footage port; a season's retrospective contains zero template-pool sentences; fail-soft verified by killing the utility model mid-season *[these two criteria are split by run type in §7.4 — zero-template applies to the healthy path only]*.

**Wave 4 — The Editorial Organ.** P5 sifter + tension director + interstitials + Spy Screen. *Accept:* instrumented week-1 house→player information flow > 0 by design (≥1 thread/lull); no Director advance over an engaged player turn across a full UAT; Spy-Screen selector boundary test excludes beat-pre-resolving events; UAT spine byte-identical with the director flagged off.

**Wave 5 — Agency.** P6 pledges + rumor-riding; flip cascade behind the gradient gate; then convokeHouse. *Accept:* gradient gate re-banded and green; pledge-lie rate within tuned band; UAT byte-identical flags-off. Decision point: re-spec #5 (autopsy) with a redaction contract, or park permanently.

---

## 6) Open Questions for the Owner

1. **ADR 0003 amendment:** approve the scoped break — closed-set ceremony outcomes rendered as engine chyrons, model demoted to color — as "the chat gains a stage"? (Blocks Wave 1b.)
2. **840e5f92:** approve the narrow reversal — a non-blocking nightly probe canary, explicitly *not* 0108 revived? (Blocks Wave 2 acceptance.)
3. **Provider posture:** accept `provider.only` pinning's failover tradeoff (ordered, probed fallback chain), and/or a direct z.ai endpoint for the reasoning-channel fix?
4. **Footage Pool:** sanction a second quarantined Vault-adjacent lane (automated, unlike producerVault's manual unseal), on structural-quarantine terms? (Blocks Wave 3.)
5. **Blindside autopsy:** is any bounded mid-season Vault exception *ever* rulable, or is the design space closed? (Determines whether Wave-5's decision point exists.)
6. **Enrichment flags:** confirm flipping the five drama flags ON in code (not just deploy env) — dev/playtest rigs currently run the impoverished society. *[Reframed in §7.2: seven flags, and the actionable ask is deploy-parity envs on dev/playtest rigs — never code defaults, which exist for calibration neutrality.]*
7. **Golden-path treadmill:** Waves 1–2 churn the prompt/tool surface heavily — accept per-PR re-record cadence, or temporarily soften `golden-path` to non-blocking for the flagged migration window? *[Moot — §7.1: the apparatus was decommissioned before this synthesis landed; only the Q2 probe-canary decision remains.]*
8. **ADR 0017:** willing to reopen post-Wave-2 for the single-log consolidation, or is dual-transport permanence absolute?
---

## 7) Overseer reconciliation note (post-synthesis, same day)

The synthesis above is the mixture-of-experts output, published verbatim except for bracketed
*[…§7.n]* pointers marking each superseded line. Four points need reconciling against the tree as
of `main @ 6e1994f3` before anyone builds from this doc:

1. **The golden-path gate is GONE, not blocking.** #1765 (commit referenced above as `840e5f92`)
   removed the fixture and the `golden-path`/`visual-regression`/`theme-consistency` jobs and
   `golden-nightly` entirely. Wave-1b's acceptance line "golden fixture re-recorded in the same PR"
   is inapplicable, and **open question 7 is moot** — there is no re-record cadence to soften. The
   real question is only Q2: whether to arm the *new, minimal* nightly probe canary (P2's shape,
   explicitly not 0108 revived).
2. **The enrichment-flag count and the "flip ON in code" ask (Q6).** There are at least SEVEN
   dedicated env flags defaulting OFF in `GameSessionAdapter.ts` (campaigns, trajectories,
   strategic cadence, scheme targets, deal depth, confessional depth, NPC deal offers), not five —
   and each one's comment documents the reason for the code-level OFF: **calibration neutrality**
   (the seeded juryReach/gradient/UAT gates are byte-identical only because the harness never sets
   them). Flipping defaults ON in code would stale every seeded gate unless the harness explicitly
   pinned them off — inverting the provability the flags exist to give. The actionable form of Q6
   is narrower: **make dev/playtest rigs run with the deploy's flag set** (set the envs in the dev
   runner / playtest driver), which delivers the "un-impoverished society" without touching
   calibration neutrality. `ORWELL_DEAL_DEPTH` is additionally *deliberately* not yet in the deploy
   (its live-loop reconciliation lands first, per its own comment) — it is not merely "forgotten".
3. **#1768 is now merged** (`main @ 6e1994f3`), so the cast-drift evidence line "#1768's fixes
   verified NOT on main" is resolved: P3 starts from main, not from the audit branch. The
   acceptance check for the tattoo fix is the one in `HANDOFF.md` §3 (the next *freshly generated*
   cast: 2–4 inked of 16, varied hometowns/vocations, committed dups structurally 0) — it is a live
   acceptance path, not a criterion already written into this roadmap.
4. **Wave-3's acceptance conflates two run types.** "Zero template-pool sentences" and "kill the
   utility model mid-season" cannot hold in the same run — P4 is *specified* fail-soft, so killing
   the model legitimately returns bounded template output. Split the criterion: on a **healthy**
   run, the retrospective contains zero template-pool sentences; under **failure injection**
   (utility model killed mid-season), delivery continues with bounded template fallback and no
   stall — the dependency-boundary criterion (dep-cruiser proves no narrator-context path to the
   footage port) applies to both.

Everything else in the map was spot-verified during the campaign (the `agent_loop.py:2306-25` /
`chat_helpers.py:4543-47` framed-key comparator, the `:7372` veto, the `:4553-54` blank-turn
re-emit, the playtest F1–F10 evidence) and stands as written.

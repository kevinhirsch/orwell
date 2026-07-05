# PO Review Ledger

The single source of truth for **product-owner sign-off** on every feature. We comb through the
feature set one at a time; the PO marks each **Approved / Expand / Delete / Defer**, and the
decision is recorded here with the date and any notes.

This ledger tracks **PO sign-off** — it is distinct from the **build status** in
[`README.md`](./README.md) (which tracks *built vs. spec-only vs. deferred*). A feature can be
built but not yet PO-reviewed, or PO-approved but not yet built.

## Decision legend

| Mark | Meaning |
|---|---|
| ✅ **Approved** | PO reviewed the scenarios and signs off as-is. |
| ✏️ **Expand** | PO wants added/changed scenarios; new ones written BDD-first, then it becomes Approved. |
| 🗑️ **Delete** | PO wants the feature removed. |
| ⏸️ **Defer** | PO parks it intentionally (keep the spec, don't build now). |
| ⬜ **Pending** | Not yet reviewed. |

## Sign-off table

| # | Feature | Build status | PO Decision | Date | Notes |
|---|---|---|---|---|---|
| 0001 | Vault Wall isolation | ✅ Built | ✅ Approved | 2026-06-28 | — |
| 0002 | Event visibility & propagation | ✅ Built | ✅ Approved | 2026-06-28 | — |
| 0003 | Behavioral fidelity | ✅ Built | ✅ Approved | 2026-06-28 | — |
| 0004 | Replayability & naming | ✅ Built | ✅ Approved (expanded) | 2026-06-28 | DONE+GREEN: wired the parked "public appearance fields for portraits" scenario into the live BDD suite (567 scenarios pass) |
| 0005 | Competition eligibility | ✅ Built | ✅ Approved (expansion queued) | 2026-06-28 | Houseguest's Choice (veto draw) must pick strongest **strategic** choice, not merely strongest bond. Test written as PENDING-BUILD block in the .feature; build is opt-in + calibration-neutral (changes the veto field → seeded outcomes). See build queue below |
| 0006 | Outcomes by stats + temperature | ✅ Built | ✅ Approved (expanded) | 2026-06-28 | **ALL THREE PARTS BUILT & GREEN.** (1) intent asked ONCE up front (removed cosmetic per-round prompts); (2) upset-band tuned down — temperature 0.36→0.40, clear favorite ~64%→~59% avg, juryReach EARNED-WINS re-verified; (3) every NPC carries a derived comp intent (compete/throw/play-safe), opt-in `ORWELL_COMP_INTENT`, byte-identical off. Single-roll model kept (Path B declined). Gates: `stagedCompetition` + `compIntent` + `npcCompIntent`. Full unit suite (1957) + juryReach green |
| 0007 | Persistence non-degradation | ✅ Built | ✅ Approved | 2026-06-28 | Reviewed full BDD (.feature + step defs). Toothed non-degradation (deep-equality round-trip, soul grows >50 entries, character baseline frozen, Vault/Journal co-versioned). Crash-safety lives in 0031 |
| 0008 | Daily-event invariant | ✅ Built | ✅ Approved | 2026-06-28 | Reviewed full BDD (.feature + step defs). No empty days across a 16-week season (seeds 1/2/3); week = HOH reign (5–6 days, HOH-comp→eviction); ≤1 social day/week, minority of weeks, still carries a house event |
| 0009 | MCP tool boundary | ✅ Built | ✅ Approved | 2026-06-28 | Plumbing/enforcement feature — the locked door enforcing the Vault Wall (#2) + anti-sycophancy (#3) at the app's tool API. No new gameplay decision; upholds rules already approved in 0001. Trust-the-engineering approve |
| 0010 | One-liner deployment & update | ✅ Built | ✅ Approved | 2026-06-28 | Plumbing feature (install/update one-liners; saves survive updates; no secrets in repo). **PO confirms it has been run on a real server** — the long-standing "real-Proxmox-host smoke owed" deferral is satisfied per PO |
| 0011 | Weekly loop orchestration | ✅ Built | ✅ Approved (expanded + cleanup) | 2026-06-28 | Core gameplay spine — faithful, deterministic, rule-enforcing. Light-expand: cross-reference note that this tests the BASELINE nomination read; the live game refines it via 0044/0043/0085/0086/0107/0039. **Cleanup:** removed the redundant test-only `chooseNominationsWithMood` (duplicated `nominationStrategy`'s mood path), retargeted its 2 tests + dropped a dead `void` ref. Green. **PR: deferred — combine with next edited feature** |
| 0012 | Conversation & scene system | ✅ Built | ✅ Approved | 2026-06-28 | "The conversation is the game" (ADR 0003) with the anti-sycophancy guardrail proven byte-identical: free-text lobbying CANNOT move a binding decision; NPCs never voice a fact they have no pathway to; reads hint but never name off-screen events; all surfaces Vault-swept |
| 0013 | The Diary Room | ✅ Built | ✅ Approved (expanded + cleanup) | 2026-06-28 | Two walls solid (player-DR→no-NPC; NPC-confessional→Vault-only). **Clarified purpose:** the DR is an EXPRESSIVE channel (journal + duplicity enabler + retrospective payoff), no live mechanical effect by design (anti-sycophancy). **Cleanup:** removed the dead/unwired `playerStrategyRead` identity-stub + its 2 tests; unified the magic-number NPC sweeps into a documented `SEEDED_NPCS` (real guarantee is the structural `deriveNpcKnowledge` strip). A purposeful engine read → future feature FB-1. Green. **PR: deferred — combine with next** |
| 0014 | Jury & endgame | ✅ Built | ✅ Approved | 2026-06-28 | Faithful endgame — jury management has real teeth (blindside/disrespect lowers a juror's vote), relationships dominate while the finale sways close jurors, 18-Q&A ceremony, engine decides the vote (narration can't move it). Mechanics solid. **PO flags: the finale *feel/logistics in practice* to expand later → backlog FB-2 (see 0037)** |
| 0015 | Character creation (OOBE) | ✅ Built | ✅ Approved | 2026-06-28 | Nails "author WHO you are, not HOW the game treats you" — no stat max-out, bounded like NPCs, player can lose, private strategy walled, OOC. This is the engine primitive; the player-facing layer is the casting interview (0050). **PO raised: how the interview determines player stats → DEFERRED to the 0050 review (options A/B/C; player currently gets a FLAT archetype bias while NPCs get seeded jitter)** |
| 0016 | God Mode (admin port) | ✅ Built | ✅ Approved | 2026-06-28 | PO considered DELETING it (feels pointless — invisible to players, dated "dev cheat" framing). Investigated: **load-bearing, kept.** It's the operational surface behind the live admin panel — `setTimeOfDay` (the Settings clock toggle), `sandboxHealth` (status page), `manageSandbox` (reset/save/load), `configure`, `advanceToFinale` (debug), all live-wired in `frontend/src/orwell_engine.py`. Also the 2nd surface the Vault Wall is proven against (0001/0009) + tied to the admin-token security (E27/SEC5) that 0029/0053/0068/0074 depend on. Deleting would break the time-of-day switch, health page, sandbox ops. Optional scope-clarification expand declined |
| 0017 | Relationship model | ✅ Built | ✅ Approved | 2026-06-28 | The calculated heart (decision 0002) — graded directed signals (trust/affinity/threat), never stored ally/enemy flags; labels derived on the spot & disposition-colored (same history → "enemy" for paranoid, "ally" for trusting); asymmetric; betrayal-shock + neglect-decay; earns confidence. NOTE: the "Houseguest's Choice = strongest bond" scenario evolves with the queued 0005 strategic-pick expand |
| 0018 | Narrative & moment orchestration | ✅ Built | ✅ Approved | 2026-06-28 | The narrator framing (ADR 0003) + anti-sycophancy/Vault Wall at the prompt layer: model always framed as host/"voice of the house" (never a generic assistant); building the prompt is a PURE READ (can't advance the game — proven byte-identical on a live nomination); told the game decides + "never invent"; lever-manifest drift-gated; every moment's prompt swept sentinel-free; woven context is names + public facets only (no stats/souls/hidden) |
| 0019 | Agent-driven play loop | ✅ Built | ✅ Approved | 2026-06-28 | The "referee" turn-loop tying together 0011/0012/0018: agent reads state → narrates → surfaces ONLY legal options → validated execute → engine decides. Free-text never binds, illegal choices refused (state unchanged), agent can't fabricate a winner, every tool result Vault-free |
| 0020 | Player experience (status, decisions, portraits) | ✅ Built | ✅ Approved (as-is) | 2026-06-28 | Live scenarios solid (public-only status, legal-option decisions, validated path, Vault-free portraits). Has a "PENDING" block (no numbers/badges · public-only options · confirm-before-binding) — reviewed: the *behavior* exists (confirm-before-binding is built + FE-tested C20; numberless is a core mandate), just not wired into THIS feature's BDD. **PO chose NOT to expand (no UI work here); left as-is deliberately** |
| 0021 | Game session & save lifecycle | ✅ Built | ✅ Approved | 2026-06-28 | Multi-tenancy backbone — cross-user isolation STRUCTURAL (distinct object graphs, no cross-sandbox handle): nothing of user A's game (secret OR visible) ever reaches B; one game/user (new game resets only yours); 8 concurrent distinct; resume byte-identical; Vault Wall holds per-sandbox; admin can't browse across users. First-class guarantee beside the Vault Wall |
| 0022 | Player experience MVP-2 (rich game UI) | 🗑️ Removed | 🗑️ Deleted | 2026-06-28 | PO cut it. The one deferred spec — a full dashboard UI that ADR 0003 ("chat IS the UI") deliberately never took, and whose goals were already delivered chat-forward (0020 status panel, 0051 portraits, 0054 gadget rail). Deleted both files + fixed all live references (README index, root README, CLAUDE.md, 0020.md); historical audit logs left as point-in-time record |
| 0023 | Consequence & memory (the backbone) | ✅ Built | ✅ Approved | 2026-06-28 | "The point of the game" — act→hidden fold→persist→recall, invisible-but-consequential, deterministic, lossless (survives a process restart), drives later behavior. The reviewed scenario is fine (voter's OWN shift). PO flagged the secret-vote→jury-grudge issue (a DIFFERENT fold, 0037/0047): **ruled option B**, realized as the new **feature 0110 (vote deduction / process of elimination)** — spec written 2026-06-28 |
| 0024 | Soul storage & memory recall | ✅ Built | ⬜ Pending | — | — |
| 0025 | Reserve twists | ✅ Built | ⬜ Pending | — | — |
| 0026 | Relationship math | ✅ Built | ⬜ Pending | — | — |
| 0027 | NarrativePort LLM adapter | ✅ Built | ⬜ Pending | — | — |
| 0028 | Temperature & emotional constants | ✅ Built | ⬜ Pending | — | — |
| 0029 | App admin & user management | ✅ Built | ⬜ Pending | — | — |
| 0030 | Durable game persistence (survive restart) | ✅ Built | ⬜ Pending | — | — |
| 0031 | Game orchestrator & integrity watcher | ✅ Built | ⬜ Pending | — | — |
| 0032 | Front-end surface reduction ("game build") | ✅ Built | ⬜ Pending | — | — |
| 0033 | Dynamic player tagline | ✅ Built | ⬜ Pending | — | — |
| 0034 | Live weekly progression & decision seam | ✅ Built | ⬜ Pending | — | — |
| 0035 | Live off-screen life (the watcher) | ✅ Built | ⬜ Pending | — | — |
| 0036 | Live social surface (approaches + Diary Room) | ✅ Built | ⬜ Pending | — | — |
| 0037 | Live jury-vote choreography (the finale) | ✅ Built | ⬜ Pending | — | — |
| 0038 | Live off-screen society | ✅ Built | ⬜ Pending | — | — |
| 0039 | Promise & deal tracking | ✅ Built | ⬜ Pending | — | — |
| 0040 | NPC confessionals | ✅ Built | ⬜ Pending | — | — |
| 0041 | Character evolution & arc (the linchpin) | ✅ Built | ⬜ Pending | — | — |
| 0042 | Competition library | ✅ Built | ⬜ Pending | — | — |
| 0043 | Emergent bloc behavior | ✅ Built | ⬜ Pending | — | — |
| 0044 | Strategic nomination & vote refinements | ✅ Built | ⬜ Pending | — | — |
| 0045 | Endgame structure (Final 5 → Final 2) | ✅ Built | ⬜ Pending | — | — |
| 0046 | Player eviction & the juror's seat | ✅ Built | ⬜ Pending | — | — |
| 0047 | Eviction night live (reveal + goodbyes) | ✅ Built | ⬜ Pending | — | — |
| 0048 | Season retrospective & Vault unsealing | ✅ Built | ⬜ Pending | — | — |
| 0049 | House presence & lingering | ✅ Built | ⬜ Pending | — | — |
| 0050 | The casting interview | ✅ Built | ⬜ Pending | — | ⚠️ PENDING PO EXPAND (raised at 0015 review): pin/enrich **how the interview determines the player's stats**. Today = coarse (interview → 1 of 12 archetypes → that archetype's FLAT bias; NPCs get seeded jitter, player does not; no-archetype → neutral). Options: (A) document+test current, (B) give the player NPC-style jitter, (C) LLM proposes stat lean from self-description, engine validates/bounds (0063 pattern). Anti-sycophancy floor must hold (no max-out, bounded, engine owns magnitude, no numbers shown). PO leaned C, B as fallback |
| 0051 | In-character images (portraits/headshots) | ✅ Built | ⬜ Pending | — | — |
| 0052 | House themes (five seasons) | ✅ Built | ⬜ Pending | — | — |
| 0053 | Admin transcript retrieval | ✅ Built | ⬜ Pending | — | — |
| 0054 | Control-room gadget rail | ✅ Built | ⬜ Pending | — | — |
| 0055 | Social play moves the weights | ✅ Built | ⬜ Pending | — | — |
| 0056 | Season-to-season character continuity | ✅ Built | ⬜ Pending | — | — |
| 0057 | Seasons as levels | ✅ Built | ⬜ Pending | — | — |
| 0058 | Deep character profiles | ✅ Built | ⬜ Pending | — | — |
| 0059 | Hidden seeded relationships | ✅ Built | ⬜ Pending | — | — |
| 0060 | Story-thread scheduler | ✅ Built | ⬜ Pending | — | — |
| 0061 | Player self-eviction | ✅ Built | ⬜ Pending | — | — |
| 0062 | Move-in zeitgeist snapshot | ✅ Built | ⬜ Pending | — | — |
| 0063 | Casting diversity floor | ✅ Built | ⬜ Pending | — | — |
| 0064 | Live multi-device game sync | ✅ Built | ⬜ Pending | — | — |
| 0065 | Cast pre-warm (deep-author before portraits) | ✅ Built | ⬜ Pending | — | — |
| 0066 | In-game time of day & sleep economy | ✅ Built | ⬜ Pending | — | — |
| 0067 | Public internet exposure | 🚧 Built (host smoke owed) | ⬜ Pending | — | — |
| 0068 | Admin "Connect to internet" panel | 🚧 Built (host smoke owed) | ⬜ Pending | — | — |
| 0069 | Token economy & context budget | ✅ Built | ⬜ Pending | — | — |
| 0070 | Off-screen texture enrichment | ✅ Built | ⬜ Pending | — | — |
| 0071 | Defensive hardening (redaction, URL guards) | ✅ Built | ⬜ Pending | — | — |
| 0072 | Multi-platform gateway | ✅ Built | ⬜ Pending | — | — |
| 0073 | Structural anti-sycophancy wall (CI gate) | ✅ Built | ⬜ Pending | — | — |
| 0074 | Local & tunable HTTPS | ✅ Built | ⬜ Pending | — | — |
| 0075 | Trust-gated confidences | ✅ Built | ⬜ Pending | — | — |
| 0076 | Presence grounding & motivated movement | ✅ Built | ⬜ Pending | — | — |
| 0077 | House map, privacy & eyeshot | ✅ Built | ⬜ Pending | — | — |
| 0078 | Motivated society & intentional movement | ✅ Built | ⬜ Pending | — | — |
| 0079 | Runtime overseer & diagnostic log | ✅ Built | ⬜ Pending | — | — |
| 0080 | Active overseer (acts on its verdict) | 📝 Spec only | ⬜ Pending | — | — |
| 0081 | Narration-faithfulness gate | ✅ Built | ⬜ Pending | — | — |
| 0084 | Character voice & grounded mood | ✅ Built | ⬜ Pending | — | — |
| 0085 | NPC campaigns & the scramble | ✅ Built | ⬜ Pending | — | — |
| 0086 | Houseguest drives | ✅ Built | ⬜ Pending | — | — |
| 0087 | Relationship trajectories (warming/cooling) | ✅ Built | ⬜ Pending | — | — |
| 0088 | Living "current read of you" | ✅ Built | ⬜ Pending | — | — |
| 0089 | Reactive confessionals | ✅ Built | ⬜ Pending | — | — |
| 0090 | Per-archetype voice | ✅ Built | ⬜ Pending | — | — |
| 0091 | Trigger secrets → house events | ✅ Built | ⬜ Pending | — | — |
| 0092 | Secret-pacing drip | ✅ Built | ⬜ Pending | — | — |
| 0093 | Secrets as strategic levers | 🟢 Build-ready (PO resolved) | ⬜ Pending | — | Index notes PO-resolved 2026-06-27 (build w/ 0099) — confirm here |
| 0094 | Distorted gossip has consequences | 📝 Spec only | ⬜ Pending | — | — |
| 0095 | Pre-show ties → time-bombs | 📝 Spec only | ⬜ Pending | — | — |
| 0096 | Emergent nemesis | 📝 Spec only | ⬜ Pending | — | — |
| 0097 | Suspicion ledger | ❄️ Frozen/parked | ⬜ Pending | — | Index notes parked 2026-06-27 (over-tells player) — confirm Defer |
| 0098 | Confidence-calibrated reads | ❄️ Frozen/parked | ⬜ Pending | — | Index notes parked 2026-06-27 — confirm Defer |
| 0099 | Secrets as currency | 🟢 Build-ready (PO resolved) | ⬜ Pending | — | Index notes PO-resolved 2026-06-27 (build w/ 0093) — confirm here |
| 0100 | Jury grudge book | ✅ Built | ⬜ Pending | — | — |
| 0101 | NPC myth-making | 📝 Spec only | ⬜ Pending | — | — |
| 0102 | Weekly recap → daily bedtime recap | 🟢 Build-ready (PO resolved) | ⬜ Pending | — | Redesigned 2026-06-27; filename rename pending. (Collision resolved 2026-07-05: the premiere spec moved to **0111**.) |
| 0103 | Edit-bay foreshadowing | ❄️ Frozen/parked | ⬜ Pending | — | Index notes parked 2026-06-27 (spoiler-adjacent) — confirm Defer |
| 0104 | Season-over-season notoriety | ✅ Built | ⬜ Pending | — | — |
| 0105 | Drive-anchored suspicion | ✅ Built | ⬜ Pending | — | — |
| 0106 | Whole-house events are exclusive set-pieces | ✅ Built | ⬜ Pending | — | — |
| 0107 | Named alliances | ✅ Built | ⬜ Pending | — | (Collision resolved 2026-07-05: the observability draft moved to **0112**.) |
| 0108 | Real-model golden-path CI gate | 📝 Spec only | ⬜ Pending | — | — |
| 0109 | Negotiated deal duration | 🟢 Build-ready | ⬜ Pending | — | Amends 0039 |
| 0110 | Vote deduction (process of elimination) | ✅ Built | ✅ Approved (built) | 2026-06-28 | **NEW feature specced AND built this session** from the PO's process-of-elimination idea (0023 review, option B). The secret-ballot jury grudge folds on a DEDUCED belief (public count + eligible pool + the evictee's reads, `deduceEvictionVoters`), not the true vote list: deducible → grudge, undeducible → none (secrecy honored), wrong → misattribution (dramatic irony). Opt-in `ORWELL_VOTE_DEDUCTION` (byte-identical off; juryReach unmoved). Gates: `voteDeduction.test.ts` + BDD `0110` (11 scenarios, in `cucumber.cjs`). True tally still unsealed at 0048 |

## Build queue (PO ✏️ Expand decisions awaiting engine work)

Scenarios written/agreed during review that still need implementation to go green.

| # | What to build | Notes |
|---|---|---|
| 0005 | Strategic "Houseguest's Choice" veto pick (replace pure strongest-bond) | Add a strategic-ally selection in the relationship engine; wire `liveSeason` HC pick to it; un-comment the two pending scenarios + add step defs. Ship **opt-in, default-off** with a calibration-neutrality guard (the HC pick changes the veto field → seeded competition outcomes; default-off must stay byte-identical). After a calibration re-baseline, strategic can become default. |
| ~~0006a~~ | ✅ **DONE** — favorite-win band tuned down (temperature 0.36→0.40; clear favorite ~64%→~59% avg). juryReach EARNED-WINS re-verified green; full unit suite green. Gate: `stagedCompetition.test.ts`. |
| ~~0006b~~ | ✅ **DONE** — every NPC carries a derived comp intent (compete/throw/play-safe), opt-in `ORWELL_COMP_INTENT`, byte-identical when off. Single-roll model kept (no per-round adaptivity — Path B declined). Gate: `npcCompIntent.test.ts`. |
| ~~0110~~ | ✅ **DONE** — vote deduction built: `src/engine/voteDeduction.ts` (`deduceEvictionVoters`) + `liveSeason.ts` `commitStagedEviction` folds the grudge on the deduced belief behind `ctx.voteDeduction`; `GameSessionAdapter` flag `ORWELL_VOTE_DEDUCTION` (default off ⇒ byte-identical; juryReach re-confirmed green). Gates: `voteDeduction.test.ts` + BDD `0110`. |

## Future feature backlog (PO-parked ideas — develop later)

Ideas surfaced during the comb-through that the PO wants to build later as their own spec/feature.
Not yet scheduled; captured here so they aren't lost.

| ID | Idea | Origin | Notes |
|---|---|---|---|
| FB-1 | **Diary Room with purpose** | 0013 review (2026-06-28) | Give the player DR a real, **Vault-safe** role: the engine *reads* the player's stated strategy to do something that never drives NPCs — e.g. shape which producer prompts / story beats fire, or feed a richer 0048 retrospective, or acknowledge the player's reflections. Must not cross the anti-sycophancy line (never puppeteer an NPC, never change an outcome). Would re-introduce a purposeful consumer where the removed `playerStrategyRead` stub used to sit. Coordinate with the frozen 0097 (suspicion ledger) — same "don't over-tell the player" tension. |
| FB-2 | **Finale experience / logistics in practice** | 0014 review (2026-06-28) | The endgame *mechanics* (0014) are solid; expand how the finale actually FEELS to play — pacing of the statement → 18-Q&A → one-at-a-time vote reveal, the drama/tension of the crowning, the player-as-finalist and player-as-juror beats. Builds on the live choreography (0037, review pending) — revisit after 0037 is reviewed so the "feel" work targets the real live seam. |

## Numbering housekeeping (flagged during the comb-through)

These are bookkeeping collisions/gaps to untangle so the review queue stays clean. They are not
game bugs.

| Issue | Detail |
|---|---|
| ~~Duplicate `0102`~~ | ✅ **RESOLVED 2026-07-05** — `0102-weekly-recap-cliffhanger` keeps the number (tracked, built-ready); the premiere spec was renamed `0111-day-1-experience` (content unchanged) and now has its own README row. |
| ~~Duplicate `0107`~~ | ✅ **RESOLVED 2026-07-05** — `0107-named-alliances` keeps the number (tracked, built); the observability draft was renamed `0112-llm-call-observability` (content unchanged) and now has its own README row. |
| Unused numbers | `0082` and `0083` have no feature. |

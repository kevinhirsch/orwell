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
| 0012 | Conversation & scene system | ✅ Built | ⬜ Pending | — | — |
| 0013 | The Diary Room | ✅ Built | ⬜ Pending | — | — |
| 0014 | Jury & endgame | ✅ Built | ⬜ Pending | — | — |
| 0015 | Character creation (OOBE) | ✅ Built | ⬜ Pending | — | — |
| 0016 | God Mode (admin port) | ✅ Built | ⬜ Pending | — | — |
| 0017 | Relationship model | ✅ Built | ⬜ Pending | — | — |
| 0018 | Narrative & moment orchestration | ✅ Built | ⬜ Pending | — | — |
| 0019 | Agent-driven play loop | ✅ Built | ⬜ Pending | — | — |
| 0020 | Player experience (status, decisions, portraits) | ✅ Built | ⬜ Pending | — | — |
| 0021 | Game session & save lifecycle | ✅ Built | ⬜ Pending | — | — |
| 0022 | Player experience MVP-2 (rich game UI) | ⏸ Deferred | ⬜ Pending | — | — |
| 0023 | Consequence & memory (the backbone) | ✅ Built | ⬜ Pending | — | — |
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
| 0050 | The casting interview | ✅ Built | ⬜ Pending | — | — |
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
| 0102 | Weekly recap → daily bedtime recap | 🟢 Build-ready (PO resolved) | ⬜ Pending | — | Redesigned 2026-06-27; filename rename pending. NOTE: number collides w/ 0102-day-1-experience |
| 0103 | Edit-bay foreshadowing | ❄️ Frozen/parked | ⬜ Pending | — | Index notes parked 2026-06-27 (spoiler-adjacent) — confirm Defer |
| 0104 | Season-over-season notoriety | ✅ Built | ⬜ Pending | — | — |
| 0105 | Drive-anchored suspicion | ✅ Built | ⬜ Pending | — | — |
| 0106 | Whole-house events are exclusive set-pieces | ✅ Built | ⬜ Pending | — | — |
| 0107 | Named alliances | ✅ Built | ⬜ Pending | — | NOTE: number collides w/ 0107-llm-call-observability draft |
| 0108 | Real-model golden-path CI gate | 📝 Spec only | ⬜ Pending | — | — |
| 0109 | Negotiated deal duration | 🟢 Build-ready | ⬜ Pending | — | Amends 0039 |

## Build queue (PO ✏️ Expand decisions awaiting engine work)

Scenarios written/agreed during review that still need implementation to go green.

| # | What to build | Notes |
|---|---|---|
| 0005 | Strategic "Houseguest's Choice" veto pick (replace pure strongest-bond) | Add a strategic-ally selection in the relationship engine; wire `liveSeason` HC pick to it; un-comment the two pending scenarios + add step defs. Ship **opt-in, default-off** with a calibration-neutrality guard (the HC pick changes the veto field → seeded competition outcomes; default-off must stay byte-identical). After a calibration re-baseline, strategic can become default. |
| ~~0006a~~ | ✅ **DONE** — favorite-win band tuned down (temperature 0.36→0.40; clear favorite ~64%→~59% avg). juryReach EARNED-WINS re-verified green; full unit suite green. Gate: `stagedCompetition.test.ts`. |
| ~~0006b~~ | ✅ **DONE** — every NPC carries a derived comp intent (compete/throw/play-safe), opt-in `ORWELL_COMP_INTENT`, byte-identical when off. Single-roll model kept (no per-round adaptivity — Path B declined). Gate: `npcCompIntent.test.ts`. |

## Numbering housekeeping (flagged during the comb-through)

These are bookkeeping collisions/gaps to untangle so the review queue stays clean. They are not
game bugs.

| Issue | Detail |
|---|---|
| Duplicate `0102` | `0102-weekly-recap-cliffhanger` (tracked in the index) **and** `0102-day-1-experience` (the premiere spec) share the number. |
| Duplicate `0107` | `0107-named-alliances` (tracked, built) **and** a separate `0107-llm-call-observability` draft share the number. |
| Unused numbers | `0082` and `0083` have no feature. |
| Untracked premiere spec | `0102-day-1-experience` is not a row in the README index; needs its own number + ledger row. |

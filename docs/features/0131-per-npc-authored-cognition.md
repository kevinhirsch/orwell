# 0131 — Per-NPC authored cognition (scoped, engine-adjudicated; "fan out cognition, funnel narration")

> **Status:** ✅ **Specced** (2026-07-21); awaiting Theme-A (faithful narration seam) landed/in flight
> before build begins. Enhancement to Orwell's engine modeling: richer per-NPC intent/memory
> authored via cheap scoped calls, but kept inside the engine's closed-set authority (model proposes,
> engine disposes). Three sub-designs — S1 (salience-gated intent), S2 (subjective memory),
> S3 (paraphrase-residual call) — each with cost controls and integrity gates. See also #1739
> (full-fidelity R3 mode: every NPC every turn). **Source:** Sonder design discussion + BB-Nerd
> audit scoreboard ("Orwell's engine already models it; the seam fails to deliver").
> **Guiding principle:** "Fan out cognition (many cheap, scoped, data-only calls); funnel
> narration (one voice)." Preserves ADR 0003 (one fluent narrator), ADR 0005 (closed/open split),
> ADR 0019 (per-NPC knowledge scoping), and ADR 0021 (one-voice decision).

## 1. Summary

Orwell's engine already models what Sonder's per-character-agent architecture claims: per-NPC
intent (want/attempt), subjective relationships, and distorted memory. But the narration seam
delivers only the deterministic floor — no per-NPC enrichment. 0131 adds that enrichment the
Orwell way: **cheap scoped cognition calls author per-NPC intent/memory; the engine still owns
outcomes.** The model never authoring the closed set (resolve/state) means no sycophancy door, no
N-stochastic calls stalling the turn, and one Vault-enforcement seam (ADR 0021). Three sub-designs
deliver this:

- **S1: Per-NPC authored intent (salience-gated).** A scoped sub-call authors each NPC's
  *want/attempt* for the current beat; the engine's deterministic resolver still owns the outcome
  (model proposes, engine disposes). Cost control: fire only for 1–2 NPCs whose situation
  measurably changed this turn (salience-gated).

- **S2: Subjective divergent memory.** Per-NPC *distorted* memory of a witnessed scene, persisted
  as soul state (stored character evolution, not chat-remembered). NPCs in the same room see the
  same events but remember them differently — a foundation for drift and emergent narratives.

- **S3: Paraphrase-residual scoped call (rare, bounded).** When an NPC's knowledge state
  sharply diverges from the shared transcript (e.g., they know a secret the player doesn't), voice
  them via a per-NPC scoped call *only for that beat*. Cost: fire only when the divergence
  triggers; uses the residual from ADR 0019 (vague paraphrase — "counselor vibe" — is harder to
  gate structurally and is gated by scope instead).

## 2. What exists today (the gap this closes)

- **Engine models intent, seam doesn't voice it.** `SoulState` holds `currentGoals` (want) and
  `motivations` (drive). The engine computes per-NPC behavior from it. But narration gets only
  the deterministic floor — facts, relationships, public personas. An NPC's *why* never lands in
  prose.

- **Relationships computed, not personalized.** Relationship edges are derived from event history
  (0002), but each NPC narrating from the same context sees the same relationship facts. There's
  no "I remember them as betraying me in a way nobody else saw."

- **Memory is chat-linear.** Events are witnessed and the chat unfolds chronologically. There's
  no per-NPC distorted recollection — e.g., "I remember that veto ceremony differently; I was
  convinced they had it in their pocket the whole time."

- **The model doesn't author intent, so NPCs read reactive.** The player moves; the NPCs respond.
  Without authored intent, the house reads as following the player's lead, not as a social system
  of NPCs with their own unfolding wants.

## 3. Scope

### In:

- **S1: Per-NPC authored intent (salience-gated, present-set-bounded, lull-timed + cached).**
  - A **scoped sub-call** (cheap tier, e.g., Qwen-flash) completes *want/attempt* for one NPC per
    beat, but only when salience gates fire (their situation measurably changed — e.g., they were
    just nominated, or an ally shifted allegiance).
  - The **engine's resolver** still owns the outcome: the authored intent is a weighted input to
    deterministic resolution, not the resolution itself (model proposes, engine disposes; ADR 0005).
  - Cost control: **1–2 NPCs per turn** (salience-gated); cached as soul state so repeated calls to
    the same NPC within a lull (e.g., multiple scenes with the same NPC) don't re-fire.
  - Integrity gates:
    - *(a) Bounded input:* authored intent is a structured descriptor (kind, target, emphasis),
      never raw text; the engine magnitude is fixed (seeded, bounded). `recordInteraction`'s
      `consequence` descriptor (#355) is the reused pattern.
    - *(b) Knowledge-scoped:* each per-NPC call is gated on **engine** presence (`A2` / #1726),
      not narrated — only what the engine says they know reaches the call.
    - *(c) Soul-anchored:* the call *continues* the persisted character (no re-roll; stable
      public persona via 0041). Outcomes fold back into soul via existing `evolveFromBeat`.

- **S2: Subjective divergent memory (soul-persisted).**
  - Each NPC keeps a **distorted, divergent memory** of witnessed scenes (off-screen tick,
    end-of-day or per-lull soul refresh).
  - A per-NPC scoped extraction call (cheap) paraphrases what they *remember* of a scene,
    grounded in their character + soul state + relationships.
  - Persisted as soul fields (not chat — `SoulState.divergentMemories` or similar).
  - Used by the engine to inform relationship updates and by the narrator to ground per-NPC
    voice/belief in scenes they remember differently.
  - Cost control: **cached per scene**, not re-run per mention; failure-soft (deterministic floor
    if call fails).

- **S3: Paraphrase-residual scoped call (bounded, rare).**
  - ADR 0019's *accepted residual* — vague paraphrase (e.g., "counselor vibe") is hard to gate
    structurally because it's plausible-yet-vague.
  - When an NPC's knowledge state sharply diverges (they know a secret the player doesn't), voice
    them via a **per-NPC scoped completion** only when that divergence triggers and the NPC is
    present in the scene.
  - Cost control: **lull-timed + bounded to NPCs whose knowledge diverges**; fire only when the
    divergence is high enough to justify a scoped call.
  - Integrity gates: same as S1 — bounded input, knowledge-scoped, soul-anchored.

### Out:

- The **engine's closed-set authority** (resolve/state/outcomes) is not touched by cognition calls
  — per ADR 0005, ADR 0021. NPCs do not author outcomes.
- The **narration remains monolithic** (one funnel voice, not N per-NPC narrators; ADR 0021). Cognition
  calls emit data, not prose. The narrator still writes every NPC's words.
- **Per-NPC voice fingerprints** (ADR 0021) are distinct from S1/S2/S3; they live in the prompt
  constraints, not in cognition calls.

## 4. Design

- **S1 seam: off-screen tick + `npcVoice` scoped call, salience-gated.**
  - When the off-screen tick fires (per-turn, per lull, ADR 0006), compute salience for each NPC
    (has their situation measurably changed? were they mentioned? nominated? did an ally shift?).
  - For the top 1–2 by salience, fire a per-NPC scoped call that authors *want/attempt* for this
    beat.
  - Input: the NPC's character + soul + relationships + the `stateDelta` since their last sim
    (feature 0065; tight context, no full history).
  - Output: structured `{kind, target, emphasis}` (reuse `ConsequenceDescriptor` from #355).
  - Fold into the resolver's input: the authored intent weights the outcome, but never **is** it.
  - Cache the result: repeated scenes with the same NPC within the same lull use the cached intent,
    no re-call.

- **S2 seam: end-of-scene or lull soul refresh, per-NPC extraction.**
  - After a scene ends or at a lull boundary, for each NPC who witnessed the scene, fire a scoped
    extraction (cheap tier) that authors their distorted memory.
  - Input: the scene's facts, the NPC's character + soul + relationships.
  - Output: structured divergent-memory descriptor (what they *think* happened, with confidence
    modifiers).
  - Persist as soul fields (not chat) — `SoulState.divergentMemories[sceneId] = {believed, divergence}`.
  - Used by the engine to compute relationship updates (asymmetry — A remembers betrayal, B doesn't)
    and by the narrator to ground per-NPC voice ("what they believed happened").

- **S3 seam: knowledge-divergence trigger, rare per-NPC scoped call.**
  - Before narrating a scene where an NPC is present, check: does their knowledge state sharply
    diverge from the shared transcript?
  - If yes, fire a scoped call for just that NPC, for just that beat (e.g., they know a secret
    about an ally the player doesn't; they believe a rumor nobody else holds).
  - Cost gate: only for the NPC(s) where divergence > threshold; only when they're active/present.
  - Output: a paraphrase-residual descriptor (like ADR 0019's "counselor vibe"), bounded to that
    NPC's voice/knowledge.
  - Use by narrator: shape how that NPC voices the scene, grounded in what they (divergently) know.

## 5. Contracts (stack-agnostic)

```text
0131 Per-NPC cognition (S1/S2/S3):
  S1 (intent, salience-gated):
    off-screen tick → compute salience per NPC (situation changed? mentioned? nominated?)
    → fire scoped call for top 1–2 by salience → author {kind, target, emphasis}
    → fold into resolver (input to outcome, not the outcome itself)
    → cache per lull (repeated scenes = cached intent, no re-call)
    integrity: bounded input (seeded magnitude), knowledge-scoped (engine presence gated), soul-anchored

  S2 (divergent memory, soul-persisted):
    end-of-scene / lull → for each NPC witness, fire extraction call
    → author distorted memory {believed, divergence_confidence}
    → persist as SoulState field (not chat)
    → used by engine (relationship asymmetry) and narrator (grounded belief)

  S3 (paraphrase-residual call, rare, knowledge-divergence-gated):
    pre-narration: check NPC knowledge divergence vs. shared transcript
    → if divergence > threshold and NPC present, fire scoped call for that beat
    → author paraphrase-residual descriptor
    → narrator uses to shape per-NPC voice in that scene
    integrity: same as S1 (bounded, knowledge-scoped, soul-anchored)

  all sub-designs:
    - cognition-only (engine owns resolve/state); cost-controlled (salience/lull-gated, cached);
      cheap tier (Qwen-flash class); fail-soft (deterministic floor if call fails)
    - one funnel narrator (prose never from N per-NPC agents; ADR 0021)
    - knowledge-scoped (no ADR-0019 leaks × N; single seam, ADR 0021)
    - soul-anchored (persist character evolution; #0041)
    - testable via expressiveNonCollapse (closed-set unchanged, open-set enriched)
```

## 6. Definition of Done (when built)

- [ ] **S1 (intent, salience-gated):** salience gates fire correctly; scoped calls author intent
      for 1–2 NPCs per turn; intent weights the resolver without overriding it; cache works
      (repeated scenes = no re-call).
- [ ] **S2 (divergent memory):** end-of-scene extraction persists per-NPC memories; relationship
      asymmetry emerges (A remembers betrayal, B doesn't); narrator grounds voice in persisted
      belief.
- [ ] **S3 (paraphrase-residual):** knowledge-divergence trigger fires correctly; scoped call
      authored for that beat; narrator uses descriptor to shape voice.
- [ ] **Integrity gates green:** `expressiveNonCollapse` test confirms closed set unchanged; Vault
      canary extended to S1/S2/S3 beats; knowledge-scoped gate (ADR 0019) passes; soul-anchor
      holds (no re-rolled character).
- [ ] **Cost model validated:** salience-gate fires 1–2 NPCs per turn (cost-controlled vs. R3's
      every-NPC); cache reduces repeated calls; cheap-tier calls complete within budget.
- [ ] **Seed-deterministic; name-agnostic (roles only); restart mid-cognition-call resumes
      (0030); 0131 added to feature status docs; `npm test` green.**

## 7. Dependencies & traceability

**Depends on (must land or be in flight first):**
- **Faithful-seam cluster (Theme A/B):** #1726 (engine-presence gating for S1/S3 knowledge scope),
  #1735 (terminal constraints block for prompt structure).
- **Feature 0041 (character evolution):** soul-anchoring; S1 folds intent back into soul via
  `evolveFromBeat`.
- **Feature 0065 (closed-set sync spine + `beatSeq`):** S1 uses `stateDelta` (feature 0065) for
  tight per-NPC prompts.
- **ADR 0019 (per-NPC knowledge scoping):** S1 and S3 depend on engine-presence gating to keep
  knowledge-scoped calls from re-opening the leak.
- **ADR 0021 (one-voice architecture):** S1/S2/S3 emit data only, never prose; narration stays
  monolithic.

**Complements / related:**
- **ADR 0005 (closed/open split):** S1/S2/S3 apply it to cognition: engine owns closed set,
  calls author open-set inputs.
- **#1739 (full-fidelity R3 mode):** 0131 S1 is the salience-gated version; #1739 extends to
  every NPC every turn with cost engineering.
- **Feature 0055 (auto-record scene):** S1 intent can feed or inform the auto-record mechanism.

## 8. Implementer-ready (Definition of Ready) — when scheduled

**Touch points (exact):**
- `src/engine/liveSeason.ts` — compute salience per NPC (has situation changed? mentioned?
  nominated?); fire scoped calls for S1 (intent), S2 (divergent memory) at lull/beat boundaries.
- `src/engine/consequence.ts` or `emotionalArc.ts` — fold S1 authored intent into the resolver
  (input to outcome; ADR 0005).
- `src/ports/GameSession.ts` — a per-NPC **scoped call output shape** for intent / memory /
  paraphrase-residual (reuse `ConsequenceDescriptor` from #355 where possible); persist S2
  divergent memory in `SoulState` fields.
- `src/services/SoulProvider.ts` — extend to store/retrieve `divergentMemories[sceneId]` per NPC
  (S2).
- `src/engine/momentPrompts.ts` — when narrating a scene, check for S2 divergent memories and S3
  knowledge-divergence triggers; fold them into per-NPC voice cues (not new prompts, but cues
  shaping the existing narrator prompt).
- **Salience gate:** a simple heuristic (NPC mentioned this turn? nominated? ally shifted?) or
  derivable from engine state (witness set overlap, relationship edge changes).
- **Caching:** store S1 intent per NPC per lull; check cache before re-firing.
- **Extend the 0001 Vault canary** to S1/S2/S3 beats / projections; no hidden state crosses.
- **Tests:** `tests/unit/perNpcCognition.test.ts` (salience gates, scoped calls, intent folds
  into resolver, cache works, S2 divergent memory persists, S3 divergence triggers) +
  `expressiveNonCollapse.test.ts` (closed set unchanged) + FE `frontend/tests/test_…_cognition.py`
  (end-to-end scoped calls + narrative grounding).

**No open decisions** (TBD at build time only):
- Exact salience gate formula (heuristic vs. engine state lookup).
- Cheap-tier model for scoped calls (Qwen-flash confirmation).
- S2 memory extraction frequency (end-of-scene vs. lull).
- S3 knowledge-divergence threshold (high/low cutoff).

---

*Provenance: multi-audit backlog 2026-07-20 — Sonder design thread + BB-Nerd audit scoreboard.*

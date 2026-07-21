# 0021 — Narration voice architecture (one funnel voice vs. per-character voice authoring)

> **Status:** Principle **Accepted** (owner directive, 2026-07-21); governs the choice of one
> fluent narrator over N per-NPC voice agents, with bounded distinctiveness recovery inside
> the single funnel. **Source:** the Sonder design discussion; extracted from the architecture
> review. **Complements:** ADR 0003 (conversation is the game; one voice is fluent), ADR 0005
> (closed/open split; cognition fans out, narration funnels), ADR 0019 (per-NPC knowledge
> scoping at the narration seam), and feature #1736 (per-NPC authored cognition).

## Context

The Sonder design decomposes *prose* — Perception → per-character agents → narrator. Many models
touch the text. In contrast, Orwell decomposes *cognition* (data/intent) while keeping *narration*
monolithic: many cheap, scoped data calls (per-NPC intent, subjective memory) feed one completion
that writes every NPC's words. The question: why one narrator, and what cost does it carry?

## Decision

**Choose one funnel voice over N per-character narrators, because:**

1. **ADR 0003 — fluent prose, not committee seams.** One voice fluent in the whole cast and its
   relationships produces better, more readable prose than N separate per-NPC narrators stitched
   together. The model's own coherence and narrative control in a single completion is where good
   writing comes from. Committee prose (multiple models, stitched) reads with visible seams,
   shifts in register, and false character/consistency breaks. ADR 0003 governs this: "don't
   improve the game into a dashboard" — don't trade fluent prose for a control panel of per-NPC
   agents.

2. **Security — one Vault-enforcement seam.** The Vault Wall (mandate #2) is enforced at *one*
   seam: the point where facts leave the engine. One narrator = one point to lock down
   knowledge-scoped voice and avoid leaks (ADR 0019). N narrators = N leak surfaces. A seam per
   NPC is structurally harder to audit and enforce — the knowledge/location/pronoun seam failures
   are exactly this: one shared context, one model, but sixteen NPCs reaching into it.
   Splitting the narrator multiplies the attack surface.

3. **Cost and latency.** One completion is cheaper and lower-latency than N parallel calls, each
   with its own LLM overhead. Real-time play can't afford N models per beat.

## Rejected Alternative — Per-Character Writing Agents

**Why not N per-NPC narrators?** Each NPC gets its own small model / agent that completes its own
prose, which the FE stitches into the scene. This would theoretically allow each NPC to have a
stronger, sharper voice.

**Reasons rejected:**
- **Prose seams** — committee prose reads as broken; characters feel incoherent or inconsistent
  because N independent models are not co-writing a scene, they're producing lines in isolation
  that must fit together. Sonder pays this cost; we chose not to.
- **Leak surface multiplication** — each NPC agent would need to be knowledge-scoped (ADR 0019),
  but enforcing it N times is N× harder than enforcing it once. The casting-interview leak and
  the per-NPC "recalled something they weren't privy to" class are exactly this failure mode.
  One seam is defensible; N are not.
- **Latency and cost** — N parallel calls, each with LLM overhead, are more expensive than one
  completion. Real-time interactivity matters.

## Recovering Distinctiveness (the traded-away upside)

One voice is less likely to produce sharply differentiated character voices than N voices could.
To recover distinctiveness *without* N narrators, the spec proposes **bounded, content-neutral
mechanisms:**

1. **Per-NPC voice fingerprints in the terminal constraints block.** Bake each character's
   distinctive cadence, register, verbal tics, and do/don't-say rules into the structured
   constraints that ride the prompt (e.g., constraints for NPC A: "speaks in clipped questions,"
   "avoids emotional words," "always references the game first"). These shape *how* a line reads
   without changing *what* the NPC knows or wants (content-neutral).

2. **Cast `voiceSignature` cues.** The cast profile (`CHARACTER`) already carries authored voice
   descriptors (see #1733 — coherence-gated). Fold these into the constraints or the scene-setup
   preamble so the narrator has a explicit signal per NPC.

3. **Optional: style-only micro-pass (speculative).** A *surface-rewrite* of a line that has
   already been completed and validated for knowledge/content correctness — e.g., rewrite a line
   to use a specific NPC's verbal tics, but never change its knowledge, outcome, or meaning.
   **Boundary question:** does this cross back into "N voices with seams"? Probably yes, so likely
   rejected at design time. But the boundary is worth spec'ing: if you're rewriting prose *after*
   the narrator completes it, you risk introducing seams and losing the narrator's coherence.

## Testability

**Distinctiveness is measurable without reintroducing seams:**

- **Attribution test.** In a multi-NPC scene, unlabeled lines should be attributable to the right
  NPC above chance (e.g., >80% accuracy in a reader study or a trained classifier over a sample
  of lines). This proves the fingerprints / voice cues are *working* to differentiate.
- **No seams.** The flow and coherence of the scene must remain high — no register shifts,
  interruptions, or felt discontinuities where the model switches between constraints.
- **Vault/knowledge unchanged.** No per-NPC rewrite may change what an NPC knows, their intent,
  or their outcome. The content-neutral boundary is testable: if a rewrite changes the *meaning*
  of a line, it fails.

## Constraints and Non-negotiable Boundary

Whatever sharpens voice must stay **content-neutral**: it may shape *how* a line reads, never
*what* the NPC knows, wants, or achieves. The closed set (outcomes, state, knowledge) is
engine-owned; the open set (prose texture) is narration-owned. One completion still writes the
final prose; the Vault Wall stays a single seam.

---

*Provenance: multi-audit backlog 2026-07-21 — the one-voice decision and its traded-away upside
(distinctiveness) scoped, per owner request (Sonder design discussion + #1735).*

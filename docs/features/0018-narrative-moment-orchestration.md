# 0018 — Narrative & moment orchestration

> **Status:** Draft. **The narrator framing.** The engine owns the *moment* (the current game
> beat) and hands the narrative LLM a **managed, Vault-free per-moment system prompt**; the LLM
> narrates that moment and nothing more. Promotes the prototype seam (`src/engine/momentPrompts.ts`,
> the `getMomentPrompt` tool) into a spec now that **Orwell is the game** and every chat turn must
> sound like the house, not a generic assistant.
> **Executable spec:** [`0018-narrative-moment-orchestration.feature`](./0018-narrative-moment-orchestration.feature)

## 1. Summary

A **moment** is the game's current beat (move-in, HOH competition, nominations, veto, eviction, a
social lull, the Diary Room, the finale). The **engine owns the moment** — it derives it
deterministically from the phase/schedule (0011/0008) — and exposes, per moment, a **managed
system prompt** the front-end injects so the narrator always speaks **as the host / narrator /
the voice of every houseguest**. The narrator narrates the supplied moment and the supplied
Vault-free context; it **never** advances the game, decides outcomes, or speaks outside what it
was given.

This is the seam that fixes the observed "the model answers as a generic assistant" bug: the
base persona forbids breaking character, and the woven context is Vault-free by construction.

## 2. Scope

**In:** engine-owned moment derivation; the **managed per-moment prompt registry** (the single
place to edit injections); the base game-master persona; the Vault-free context block; the
`getMomentPrompt` contract; the narrator's "narrate only, never decide/advance" constraint.

**Out:** the weekly phase machine that *produces* phases (**0011**); the scheduler (**0008**);
the conversation/scene mechanics (**0012**); the agent turn loop that *calls* this (**0019**);
the Vault-Wall mechanics themselves (**0001** — reused).

## 3. Moments are engine-owned and deterministic

The current moment is a pure function of game state (phase + schedule), not the narrator's
choice. The narrator cannot move the game from "nominations" to "eviction"; only the engine
(0011) advances phase, and the moment follows. Same state ⇒ same moment (seed-reproducible).

## 4. The managed per-moment prompt (persona + framing — NOT the Vault Wall)

One registry maps **moment → system-prompt fragment**, composed at call time as:

```
BASE_GAME_MASTER_PERSONA  +  moment fragment  +  Vault-free GAME CONTEXT
```

- **Base persona:** "you are the host/narrator/voice of every houseguest… never say you are an
  AI or break character… you know ONLY the context given." This is what stops generic-assistant
  replies.
- **Moment fragment:** the tone/intent for this beat (build comp tension; play the nomination
  dread; the Diary Room is a warm OOC aside; …).
- **Context:** the player's own card + the house roster (names) + phase/week — **Vault-free by
  construction** (no stats, souls, archetypes, hidden attributes).

**Crucially (mandate #2):** prompts are **persona/framing only**. They are **not** the Vault
Wall — secrecy is structural (the context is Vault-free), so there is nothing secret in the
prompt to leak. The registry is editable and version-controlled; that is the single place to
"manage system-prompt injections for every moment."

## 5. The narrator constraint

The narrative LLM **narrates the given moment + context and nothing else**. It does not: decide
competition outcomes or votes (the engine does — 0006/0014); reveal anything not in its context
(0001); advance the phase/moment (0011); or drop character. It gives voice to what the engine
has already decided.

## 6. Contracts (stack-agnostic)

```
momentForPhase(phase) -> moment                              # deterministic, engine-owned
buildSystemPrompt(moment, visibleContext) -> systemPrompt    # base persona + fragment + Vault-free context
getMomentPrompt(moment?) -> { moment, systemPrompt }         # player-channel tool (0009), readsVault: false
# MOMENT_PROMPTS registry: the single managed source of per-moment fragments. Persona/framing ONLY.
```

**Invariants:** the moment is engine-derived (narrator can't change it); the system prompt is
**sentinel-free** under any Vault contents; the base persona forbids generic-assistant/out-of-
character output; the woven context contains no Vault data; same state ⇒ same moment.

## 7. Test strategy

- **Sentinel-clean prompt:** over seeded runs with a fully populated Vault, `getMomentPrompt`
  output (every moment) contains **no** sentinel (extends the 0001 canary to the prompt).
- **Engine-owned moment:** the moment tracks the engine phase; a narration call cannot change
  the phase/moment.
- **Persona present:** the base prompt asserts the in-character framing (never "I am an AI").
- **Vault-free context:** the context block carries names/phase/player-card only — no stats,
  souls, archetypes, or hidden attributes.
- **Determinism:** same seed/state ⇒ same moment + prompt.

## 8. Open decisions (flagged; drafted to the recommended default)

- **Moment selection when several could apply** (a social beat vs an imminent ceremony): the
  **engine scheduler decides** (default — consistent with 0008/0011). Confirm.
- **Runtime-editable prompts?** Default: **code-versioned** registry (reviewable, testable). A
  later option: let **God Mode** (0016) tune fragments at runtime (non-Vault config). Flagged.

## 9. Definition of Done

- [ ] All scenarios pass, name-agnostic, seed-reproducible.
- [ ] The moment is engine-owned and deterministic; the narrator cannot advance it.
- [ ] `getMomentPrompt` is **provably sentinel-free** under any Vault (canary + property tests).
- [ ] The base persona enforces in-character narration (no generic-assistant output).
- [ ] The injected context is Vault-free (names/phase/player-card only).

## 10. Dependencies

**0011** (phases that drive moments), **0008** (scheduler), **0009** (`getMomentPrompt` as a
player tool), **0001** (Vault Wall — reused; the prompt is framing, not secrecy), **0012**
(scene mechanics the narration voices), **0019** (the agent loop that injects this each turn).

## 11. Traceability

`src/engine/momentPrompts.ts` + the `getMomentPrompt` tool (the prototype this promotes);
`CLAUDE.md` ("the system is game master, narrator, and the voice of every NPC"; anti-sycophancy —
"the LLM only *narrates*"); `docs/bb-sim-spec.md` (narration behind a port); mandate #2 (the
Vault Wall is structural, never prompt wording).

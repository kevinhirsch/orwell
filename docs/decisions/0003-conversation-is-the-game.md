# 0003 — The conversation is the game (minimal-context, model-trusting design)

> **Status:** Accepted.
> **Source:** human feedback (this session): *"every game needs to feel drastically different…
> if you simply gave an LLM the rules of this game, it should be able to realistically play
> along for a while. The game is simply based in good conversation. The beta version was just
> the game bible and a few secrets documents fed to an LLM with a small set of instructions, and
> the way the LLM responded was correct. We have to be as light as possible with what we give the
> LLM so it can be creative still, but we need to maintain the guardrails and the long-term
> memory pieces that would make the spirit of this game survive replayability and context
> windows."*

## Context

The beta was, essentially: the Game Bible + a few secrets documents + a small set of
instructions, handed to an LLM. It played *Big Brother* convincingly. That is the proof of
concept and the **north star** — the fun was already there, in conversation. The rebuild exists
**not** to replace that loop with mechanics or UI, but to fix the four things that degrade it
over a real game:

1. **Leaks** — the model knew the secrets it was narrating around (the Vault Wall fixes this).
2. **Sycophancy** — the model could bend outcomes to please the player (the deterministic core
   + seeded randomness fix this; the model only *voices* results).
3. **Memory thinning** — a single context window can't hold a 13-week season; detail decayed
   (the stores + non-degradation fix this).
4. **Sameness** — one prompt produces one flavor of season; replays felt alike (seeded cast,
   hidden elements, twists, and temperature fix this).

Everything the engine does should trace to one of those four. Anything else is scope creep that
risks turning "talking to a houseguest" into "operating a dashboard."

## Decision

**The conversation is the game. The engine is a thin set of guardrails and a memory, not a
director.** Design to keep the model creative and the context light, while the stores hold the
truth.

### Principles (these bind future feature and UI work)

1. **Prefer removing context to adding it.** The model plays best with the *least* framing that
   still holds the guardrails. Before adding any instruction, prompt fragment, or rule, ask
   whether it earns its tokens against one of the four fixes above. A lighter prompt is a
   feature, not a gap. (Concretely: a game turn must not carry generic-assistant operating rules
   it will never use.)
2. **Hand the model facts to voice, never scripts to recite.** The engine supplies *structured,
   Vault-free truth* — who is HOH, who sought the player out and why (drive only), a
   houseguest's public vibe, the legal options for a binding choice — and the model improvises
   the prose. The engine never authors the dialogue, the pretext text, or the narration. Canned
   strings ("wants a word with you") are a smell; the cure is to give the model the *fact* and
   let it write the line.
3. **The cast is anchors, not personalities-in-a-can.** Per-NPC public facets (archetype,
   strategy style, background, appearance, presentation — the curated, Vault-free set) are a few
   words of *anchor* that keep a houseguest's voice consistent across weeks and context windows.
   They are seed-varied so every season's raw material differs. They are not scripts, scene
   trees, or canned lines.
4. **UI is for guardrails and memory, not for replacing talk.** Structured surfaces exist only
   where prose is unsafe or unrememberable: a **confirm step** on binding actions (so a hedge in
   conversation can't cast a vote), and the **memory wall** (roster, who's left, jury seats,
   portraits — the facts a real houseguest can see). Play happens in the chat. A binding decision
   may be *confirmed* through a control, but it is *reached* in conversation; the player can
   always still type their reasoning and have it voiced.
5. **Replayability is engine-seeded, not prompt-authored.** "Drastically different every game"
   comes from the seeded cast, hidden elements, reserve twists, and per-moment temperature —
   produced engine-side and made *visible* only by surfacing the varied public facets to the
   narrator. It is never achieved by hand-writing more scenarios into the prompt.
6. **Long-term memory is the store, recalled — never the chat, remembered.** Surviving a context
   window means the model can be handed a fresh, light context at any time and still be correct,
   because ground truth lives in the event store / relationship layer / soul and is *queried*.
   Re-entry beats, recaps, and "previously on" framing are **synthesized from the records**, never
   from prior chat text. A new context window should lose nothing that matters.

### Litmus test for any future change

> Does this keep the model creative and the context light while strengthening one of the four
> fixes (leaks / sycophancy / memory / sameness)? If it instead adds framing the model doesn't
> need, scripts what the model should improvise, or moves play out of conversation into UI — it
> is the wrong shape, even if it "works."

## Consequences

- **Prompt minimalism is a hard requirement, not a nicety.** Game turns get a tight game-master
  persona + Vault-free facts + the moment, and *nothing else* — not the inherited assistant
  rulebook. (Directly motivates substituting, not appending, the agent preamble on game turns.)
- **Engine work is justified by the four fixes.** The Vault Wall, deterministic outcomes,
  persistence/non-degradation, and seeded variance are *load-bearing*. Mechanics beyond them
  (more ceremonies, more systems) must show they serve conversation, not replace it.
- **Surfaces stay thin.** New UI is acceptable for the confirm-on-binding guardrail and the
  memory wall; it is suspect anywhere it would pull strategic play out of the chat.
- **This refines, it does not contradict, the four mandates.** Behavioral fidelity, the Vault
  Wall, anti-sycophancy, and non-degradation all stand — this record says *how* to honor them:
  by trusting the model with creativity and being miserly with everything except truth and
  guardrails.

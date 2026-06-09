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
4. **UI augments the conversation; it never replaces game-building talk.** *(Refined, same
   source: "I don't mind the game engine augmenting the chat experience in the UI in intelligent
   ways, I just absolutely can't have it replacing any sort of chat interaction that builds or
   progresses the game.")* The engine **may** enrich the chat surface intelligently — beat
   framing, ambient presence hints, the memory wall (roster, jury seats, portraits), a confirm
   step on binding actions. The hard line: any interaction that **builds or progresses the
   game** — social play, scheming, information-gathering, the reasoning that leads to a decision
   — happens *in conversation*. UI may reflect it, frame it, and structure the final
   *commitment* of a binding act (so a hedge can't cast a vote); it may never become the way the
   game is played.
5. **Replayability is engine-seeded, not prompt-authored.** "Drastically different every game"
   comes from the seeded cast, hidden elements, reserve twists, and per-moment temperature —
   produced engine-side and made *visible* only by surfacing the varied public facets to the
   narrator. It is never achieved by hand-writing more scenarios into the prompt.
6. **Long-term memory is the store, recalled — never the chat, remembered.** Surviving a context
   window means the model can be handed a fresh, light context at any time and still be correct,
   because ground truth lives in the event store / relationship layer / soul and is *queried*.
   Re-entry beats, recaps, and "previously on" framing are **synthesized from the records**, never
   from prior chat text. A new context window should lose nothing that matters.
7. **Lingering is play.** *(Added, same source: "the capacity for the game player to just linger
   and collect data in any room, to mill around with different people, to ask and find out who is
   in the room and/or adjacent rooms, to talk to different people and those people be 'playing
   the game' as they should be.")* The player can spend unhurried time anywhere in the house —
   see who is in the room and who is nearby, drift between groups, talk to anyone — and the house
   keeps playing the game *around* them: NPCs present pursue their own agendas and speak only
   from what they legitimately know. Observation is itself recorded play (witnessed events,
   overheard fragments via real co-presence pathways). **Nothing force-marches a lingering
   player:** progressing the week is always an explicit act, never a side effect of chatting;
   pacing pressure (the daily-event invariant, the watcher) is satisfied by the day's scheduled
   beat, never by steamrolling a player who is gathering information. This requires a light
   **presence model** (who is in which room; what is adjacent) the narrator can query — nuanced
   and difficult to maintain, and mandatory.
8. **People must make sense.** *(Added, same source.)* A houseguest is one coherent person: in
   exactly one place at a time, moving plausibly; speaking **only from what they legitimately
   know** (witnessed or were told — 0002); behaving from their actual relationship state and
   agenda; holding a stable public persona (the seed-stable facets) while only the hidden soul
   evolves. An NPC who teleports, contradicts their own history, cites an event they never
   witnessed, or flips personality between scenes breaks the game's reality and is a defect, not
   flavor.

### Testability (these principles must be enforceable, not aspirational)

Wherever possible, each principle carries a *structural* test — the same move that made the
Vault Wall testable ("the model cannot leak what it never receives") applies here:

- **Presence coherence** is pure-model: one location per houseguest per tick, movement only
  between adjacent rooms, occupancy deterministic by seed → unit/property tests.
- **Knowledge-constrained speech** is structural, per-NPC: the context assembled for voicing an
  NPC contains **only** that NPC's legitimate knowledge (their witnessed/told set), so the test
  asserts the *input*, not the prose — sentinel facts outside an NPC's knowledge must never
  appear in that NPC's narration context.
- **Persona stability** is byte-level: the public facets fed to the narrator are seed-stable and
  identical every turn (the voice anchor cannot drift even across context windows).
- **Lingering safety** is a property test: N consecutive social/milling turns ⇒ week, phase, and
  ceremony state unchanged; milling counts as activity for the watcher's idle gate.
- **Augment-not-replace** is a review-time rule plus a guard: no UI control may call a
  game-progressing engine action other than the validated decision seam (`submitDecision` behind
  an explicit confirm).
- Prose-level qualities (distinct voices, tone) may additionally get transcript-level evals, but
  no principle may rely *only* on an eval — there must be a structural test underneath where one
  is possible.

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
- **Surfaces stay thin but may be smart.** UI augmentation is welcome (beat framing, ambient
  presence, the memory wall, confirm-on-binding); it is forbidden the moment it *replaces* a
  chat interaction that builds or progresses the game.
- **A presence/room model becomes load-bearing.** Lingering play (principle 7) and co-presence-
  grounded witness/overhear pathways need a light spatial model — drafted as feature **0049**.
- **Per-NPC knowledge scoping becomes load-bearing.** "People must make sense" (principle 8) is
  enforced the Vault way: scope each NPC's narration context to their legitimate knowledge and
  test the input structurally.
- **This refines, it does not contradict, the four mandates.** Behavioral fidelity, the Vault
  Wall, anti-sycophancy, and non-degradation all stand — this record says *how* to honor them:
  by trusting the model with creativity and being miserly with everything except truth and
  guardrails.

# 0084 — Character voice & grounded mood (sixteen mouths, not one)

> **Status:** 📝 **SPEC / draft** (authored 2026-06-25). **Gate (planned):** engine (Vitest +
> dependency-cruiser + BDD `0084-character-voice-and-mood.feature`) and front-end (the voicing path
> consumes the new persona facet + mood through `getMomentPrompt`/`npcVoice`). **Depends on:** 0058
> (deep profiles / `CharacterFactory` is where the static voice is minted), 0041 + `emotionalArc`
> (the live soul the mood is read from), 0004/0063 (the public persona facets the voice sits beside),
> 0075 (the deflection/lie behaviour the voice colours). **Sibling of** 0085 (campaigns) — voice makes
> the texture real, campaigns make the strategy real. **Vault Wall (mandate #2):** the voice is a
> **public, observable** facet (how a person talks is not a secret); the mood is the **observable
> affect only** (how they carry themselves), never the hidden *cause* and never a number.

> **Owner direction (2026-06-25, this session):**
> *"The character voice — that seems very rich and deep. I love it. I want complex role-playing, as if
> I am playing real humans."*

## The problem this fixes

The substrate for realism is already deep — every NPC has hidden goals, an evolving soul, graded
asymmetric relationships, gossip, blocs. But the **last mile (voicing) flattens it**. Two concrete,
code-verified gaps:

1. **No per-character voice — they share one narrator's mouth.** A houseguest is voiced from persona
   *facts* (`archetype`, `background`, a one-word `demeanor`) but nothing models **how they talk** —
   diction, rhythm, verbal habits, how they deflect, how they sound on the block vs. at 2am. So
   sixteen people converge on the same articulate, even voice. This is the single biggest reason the
   game reads as "an AI playing everyone" instead of distinct humans.
2. **Mood is *invented*, not *grounded*.** The soul evolves (`emotionalState` ∈ 0..1, `volatility`)
   and bends the hidden competition modifier — but the NPC's **current emotional state never reaches
   the voicer**. `momentPrompts` literally tells the model to *"invent moods freely."* So a houseguest
   who was just betrayed or blindsided doesn't reliably sound rattled *this turn* — the model guesses,
   and usually defaults to pleasant. That is both a realism gap and a soft **anti-sycophancy** leak:
   affect bent to please rather than queried from truth.

Both gaps are **missing facts, not missing UI** — exactly the kind of thing ADR 0003 says to fix by
*handing the model facts to voice*, never scripts to recite.

## The two halves

### 1. The voice fingerprint — a byte-stable PUBLIC `CHARACTER` facet

A houseguest's **`voice`** is part of their static `CHARACTER` (`src/engine/characterFactory.ts`),
generated once at cast time, **byte-stable for the whole season** (non-degradation #4 — voice is
identity; the *mood* below carries the dynamism). It is **public/observable** — how someone talks is
not a Vault secret — so it rides the existing `NpcVoiceView.persona` projection and is voiced on every
turn, for active houseguests and jurors alike.

A few **structured dials** + one **prose signature line** (the dials keep it gradeable + distinct; the
prose gives the model something human to inhabit):

| Dial | Range (illustrative) | What it changes |
|---|---|---|
| `register` | formal … plainspoken … crude | word choice, politeness, profanity |
| `rhythm` | clipped … measured … rambling | sentence length & flow |
| `energy` | flat … warm … manic | exclamation, volume, pace |
| `directness` | evasive … diplomatic … blunt | do they answer the question? |
| `humor` | dry … none … goofy … cutting | the *kind* of funny (or not) |
| `stressTell` | (e.g. *over-explains* / *goes quiet* / *gets clipped* / *deflects with a joke*) | how the voice **shifts under pressure** |

Plus `signature`: one prose sentence capturing the texture ("talks with her hands, trails off
mid-thought, says 'honestly' a lot"), and `lexicon`: a *small* set of habitual words/fillers.

**Reconciling with the no-catchphrase rule.** `momentPrompts` bans "random comedy… catchphrases…
routines." That ban stands and is *not* in tension here: a voice is a **consistent texture**
(rhythm, register, how they deflect), **not a gimmick** repeated for laughs. The spec must make the
distinction explicit in the lever prose: voice each houseguest *through* their signature, never *as*
a bit; `lexicon` is a light seasoning (a habitual "honestly," not a punchline).

### 2. Grounded mood — a Vault-safe behavioural read of the live soul

A new **Vault-safe `mood`** is derived from the focal houseguest's live soul (`emotionalState` +
`volatility`) and handed to the voicer on `NpcVoiceView`:

- A short **affect word** ("on edge," "deflated," "riding high," "guarded," "buzzing," "flat") — the
  *observable* carriage, computed from the soul scalars (low `emotionalState` ⇒ distress words; high
  `volatility` ⇒ "volatile/raw" qualifier).
- **Never a number, never the cause.** The *reason* they're rattled (a hidden betrayal, a Vault
  scene) stays sealed; only the affect surfaces. The player reads the mood as behaviour and **infers**
  the cause themselves (paranoia/empathy is the human's to form — 0017/0020).
- It **changes as the soul evolves** — a betrayed houseguest's mood shifts within the same season,
  and the *voice* bends through its `stressTell` accordingly (a blunt houseguest who "goes quiet"
  reads as a real tell). This is the anti-sycophancy win: mood is **queried from the store**, not
  remembered-and-bent.

The lever guidance changes from *"invent moods freely"* to: **voice the GIVEN mood for the houseguest
the engine moods**; invent affect only for ambient/unfocused NPCs (flavor still free where there's no
ground truth to contradict).

## Engine seams

- `src/engine/characterFactory.ts` — `Character` gains `voice: VoiceProfile`; the factory mints it
  per NPC, seeded + archetype-correlated (a `comp-beast` skews blunt/clipped; a `social-butterfly`
  warm/rambling) but **independently varied** so two of an archetype still sound different. New
  `src/engine/voiceConstants.ts` (the 0026/0028 sibling-constants pattern) holds the dial vocabularies.
- `src/ports/GameSession.ts` — `NpcVoiceView.persona.voice` (public) + a top-level `mood?` (Vault-safe
  affect word). Both outward-safe by construction.
- `src/adapters/engine/GameSessionAdapter.ts` — `npcVoice()` reads `voice` straight off `CHARACTER`
  and **derives** `mood` from the soul via a small pure helper `moodWord(emotionalState, volatility)`
  (engine-only soul in, Vault-free word out).
- `src/engine/momentPrompts.ts` — the voicing lever renders `voice` (+ the no-catchphrase reconciler)
  and swaps the "invent moods" line for "voice the given mood." 
- Persistence: `voice` lives on `CHARACTER`, already snapshotted byte-stable (0007/0030) — a round-trip
  must leave it identical. `mood` is **derived, never stored** (it's a read of the soul).

## Testability (role-only; HARD rules)

- **Distinct by construction:** generating a full cast yields **distinct** voice fingerprints — a
  seeded property test asserts low collision across the dials (no two houseguests are voice-identical;
  the cast spans the register/rhythm/humor ranges).
- **Byte-stable (non-degradation):** a houseguest's `voice` is identical across a snapshot/restore and
  across many soul-evolving beats — voice is `CHARACTER`, never drifts (contrast: `mood` *must* move).
- **Mood tracks the soul, Vault-safe:** `moodWord` is monotone-ish in `emotionalState` (distress ⇒
  distress words) and reflects `volatility`; a sentinel sweep of the voice projection finds **no**
  Vault content and **no number**; the mood word changes after a betraying beat and never names the
  cause.
- **Public-projection safety:** the voice + mood ride only the outward `NpcVoiceView` — dependency-
  cruiser proves no Vault handle; a player/admin surface returns voice/mood but never the soul scalars.
- **Determinism:** same seed ⇒ same cast voices (reproducible).
- **Lever contract:** the moment prompt voices the given mood (no "invent moods" for the focal HG) and
  carries the catchphrase reconciler — pinned in the lever-manifest drift test.

## Open questions / defaults (resolve at build)

1. **Structured-vs-prose balance** — start with the 6 dials + `signature` + a small `lexicon`; tune
   once it's heard in a live read.
2. **Does voice ever evolve?** Default **static** (identity). A rare, bounded long-game drift (someone
   hardens over a brutal season) is a *possible* later nudge, but mood — not voice — should carry the
   turn-to-turn dynamism. Resolve before adding any voice mutation.
3. **Mood vocabulary + thresholds** — the affect-word set and the `emotionalState`/`volatility` cutoffs
   (a small Vault-free lookup; never a number to the player).
4. **Player voice?** Out of scope — the player authors their own speech (human-driven). Voice is
   NPC-only.
5. **Accent / regional flavor** — keep it *light* and text-respectful (cadence + word choice, never
   phonetic spelling or caricature); reconcile with 0063 (identity is one true facet, never reductive).

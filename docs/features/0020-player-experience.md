# 0020 — Player experience (status panel, inline decisions, portraits)

> **Status:** Draft. **MVP-1 of the player experience** for "Orwell is the game": the chat
> narration (0018/0019) **plus** a light always-visible **status panel**, **inline quick-button**
> binding decisions over the engine's legal set, and **generated photo-style portraits** for the
> houseguests. **MVP-2 — the rich game UI** (house view, houseguest cards, a browsable journal,
> competition visuals) — is the next phase (§8).
> **Executable spec:** [`0020-player-experience.feature`](./0020-player-experience.feature)

## 1. Summary

The game lives in the main Orwell chat. On top of the narration, the player gets three things:

1. a **light status panel** — always visible: **week & phase**, **HOH & nominees**, **veto
   status** (holder + used / not);
2. **inline quick-buttons** for binding decisions — when a decision is due, the chat surfaces the
   engine's **legal** options as buttons; tap to act (free-text social still flows in the chat);
3. **generated photo-style portraits** — each houseguest has a portrait for visual identity,
   produced by Orwell's existing image-generation pipeline.

Everything the player sees is **Vault-free by construction** (0001): the panel shows only public,
ceremony-level facts; portraits convey **public identity only**, never hidden attributes.

## 2. Scope

**In (MVP-1):** the status panel (the three Vault-free status groups); inline decision buttons
over the engine's legal option set; houseguest portrait generation + display; the chat-forward
layout that hosts them.

**Out:** the narration/agent mechanics (**0018/0019**); the engine rules/outcomes (**0005/0006/
0011**); the image-gen *provider* (reuse Orwell's pipeline); **MVP-2** rich UI (§8, its own spec);
"your own standing" as a HUD chip (§7 — deferred to narration on purpose).

## 3. The status panel (Vault-free, public facts only)

Always visible, sourced **only** from the engine's visible projection / public game state
(0009/0011) — never the Vault:

- **Week & phase** (HOH comp / nominations / veto / veto ceremony / eviction).
- **HOH & nominees** (public ceremonies — a houseguest plainly knows these).
- **Veto status** — who holds the Power of Veto and whether it's been used.

It shows **nothing hidden**: no secret votes, no off-screen targeting, no "who's coming for you."
That is the deliberate line — the panel is the objective, public state of the house; everything
inferential stays in the narration, sourced from what the player legitimately knows (0002).

## 4. Inline decision buttons (over the engine's legal set)

When the engine surfaces a **pending decision** (0019: `pendingDecision` → legal options from
0011/0005), the chat renders **exactly those options** as buttons. Tapping one executes the choice
through the **validated** path (`executeDecision`), and the engine re-validates. The player can
**never be offered, or pick, an illegal move**. Free-text social play continues in the chat
(the hybrid model, 0019); only the buttons make a binding choice.

## 5. Houseguest portraits (from the generated Character, public facets only)

Each generated houseguest (0004) gets a **photo-style portrait** rendered by Orwell's existing
image-generation pipeline, and the likeness is **driven by the houseguest's own generated data** —
the `CharacterFactory` output / **`character.md`** (the static `Character`) and related identity
fields — so a houseguest *looks like who they are*, not a random face. The player's own portrait
comes from their authored profile (0015).

**The Vault-Wall reconciliation (important).** `character.md` is static *facts*, but not all of it
is public: it also holds the core **P/M/S aptitudes** (which never surface, 0001) and sits
alongside hidden attributes/elements (Vault). So the engine assembles a **Vault-free portrait
descriptor** from only the **publicly-presentable** facets — appearance, age, presentation/style,
public persona, archetype-as-vibe — and **excludes** competition aptitudes, hidden attributes, and
all `Soul`/Vault secrets. The frontend image-gen consumes **that descriptor**, never the full
`Character`. A portrait therefore *cannot* leak a secret, by construction.

> **Implication for 0004:** `CharacterFactory` generates the **public appearance/identity** fields
> the descriptor needs (appearance, age, presentation/style) as part of `character.md` — today it
> emits archetype/style/aptitudes/background; the portrait wants the *visual* public facets too.

Portraits are **persisted** with the save (0007) so the cast looks consistent across sessions, and
are seed-stable where the pipeline allows. A deterministic placeholder backs offline/seeded tests.

## 6. Contracts (stack-agnostic)

```
gameStatus() -> { week, phase, hoh, nominees[], veto: { holder, used } }   # Vault-free (visible projection)
pendingDecision() -> { kind, options[] } | none                            # engine LEGAL set (0019/0011/0005)
executeDecision(kind, choice) -> result                                    # validated; rejects illegal (0005)
portraitDescriptorFor(houseguest) -> publicDescriptor                      # built from character.md PUBLIC facets (0004/0015);
                                                                           #   Vault-free — NO aptitudes, hidden elements, or Soul/Vault
portraitFor(houseguest) -> imageRef                                        # frontend image-gen renders the descriptor; persisted (0007)
```

**Invariants:** the status panel is **sentinel-free** under any Vault and equals the engine's
public state; it surfaces no hidden info; inline options equal the engine's legal set and execute
only via the validated path; the **portrait descriptor** is built from `character.md`'s public
facets and is sentinel-free (no aptitudes, hidden elements, or `Soul`/Vault); portraits persist
and are consistent per save.

## 7. Open decisions (flagged; drafted to your answers)

- **"Your own standing" is NOT a HUD chip** (you didn't pick it) — kept in the **narration**
  instead, so the panel stays objective/public and we never imply Vault-ish threat data. Confirm.
- **Portrait timing:** generate **eagerly at cast creation** (default — consistent, no first-view
  lag) vs lazily on first view. Flag.
- **Portrait provider:** reuse **Orwell's image-gen pipeline** (default) with a deterministic
  placeholder for seeded/offline tests. Flag.

## 8. MVP-2 — the rich game UI (next phase, drafted later)

Per your "MVP-2 = rich game UI": a dedicated **house view** (the cast as portrait cards with
public status), **houseguest cards** (what you legitimately know about each — knowledge, not
Vault), a **browsable journal** (your witnessed events + surfaced knowledge, 0002), and
**competition visuals**. This becomes its own feature once MVP-1 lands; it must hold the same
Vault-free guarantee (cards/journal show only the player's knowledge).

## 9. Definition of Done (MVP-1)

- [ ] All scenarios pass, name-agnostic, seed-reproducible.
- [ ] The status panel shows week/phase, HOH/nominees, veto status and is **provably Vault-free**
      (sentinel-clean) and equal to the engine's public state.
- [ ] Inline decision buttons equal the engine's legal set; tapping executes via the validated
      path; illegal options can't be presented (cross-checks 0019/0005).
- [ ] Each houseguest's portrait is built from a **Vault-free descriptor** over `character.md`'s
      **public** facets (no aptitudes / hidden elements / `Soul`); portraits persist with the save
      (0007) and never leak a secret.
- [ ] Free-text social play still flows without making a binding decision (0019).

## 10. Dependencies

**0018** (narration), **0019** (pending decision / validated execution / hybrid input), **0011**
(phases + the legal decision set), **0005** (legality), **0009** (Vault-free read tools), **0004**
(`CharacterFactory` — generates the public appearance/identity in `character.md` the portrait
descriptor reads) / **0015** (the authored player), **0007** (portraits persist), **0001**
(everything shown is Vault-free), plus **Orwell's image-generation pipeline**.

## 11. Traceability

This session's player-experience calibration (chat + light status panel for MVP-1, rich UI for
MVP-2; inline quick-buttons; photo-style portraits); `CLAUDE.md` (the chat-driven, immersive
single-player design; the Vault Wall on every player surface); `docs/features/0002-…` (knowledge
vs Vault — what the panel/journal may show).

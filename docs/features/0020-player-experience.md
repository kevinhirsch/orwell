# 0020 — Player experience (status panel, inline decisions, portraits)

> **Status:** Built (see the [README status index](./README.md#index)). **MVP-1 of the player experience** for "Orwell is the game": the chat
> narration (0018/0019) **plus** a light always-visible **status panel**, **inline quick-button**
> binding decisions over the engine's legal set, and **generated photo-style portraits** for the
> houseguests. **MVP-2 — the rich game UI** (house view, houseguest cards, a browsable journal,
> competition visuals) was tracked as **0022 — since removed** (PO review 2026-06-28: its goals were
> delivered the chat-forward way via 0020/0051/0054, so the standalone dashboard spec was cut under
> ADR 0003). One principle governs every MVP-1 surface: **show facts & behavior, never the
> player's feelings** — the player forms their own reads.
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

> **The guiding principle — the player forms their own reads.** Every MVP-1 surface below obeys
> this. The game surfaces **facts the player legitimately knows** (witnessed events + surfaced
> knowledge, 0002) and **observable houseguest behavior toward them**, then **lets the player draw
> their own conclusions**. It **never** tells the player how they feel ("you trust them"), never
> shows a trust/threat meter, and never exposes the engine's hidden relationship numbers. The
> player's own reads are **human-driven** (decision 0002) — paranoia and trust are theirs to form,
> from what they see and hear. (This is the correction from the MVP-2 card-read note, applied at
> the MVP-1 level: surfaces show *facts and behavior*, never *feelings*.)

## 2. Scope

**In (MVP-1):** the status panel (the three Vault-free status groups); inline decision buttons
over the engine's legal option set; houseguest portrait generation + display; the chat-forward
layout that hosts them.

**Out:** the narration/agent mechanics (**0018/0019**); the engine rules/outcomes (**0005/0006/
0011**); the image-gen *provider* (reuse Orwell's pipeline); **MVP-2** rich UI (**0022**, removed 2026-06-28);
any **read on the player's standing** — no HUD chip *and* no narrated readout; the player infers it
(§7 / the guiding principle).

## 3. The status panel (Vault-free, public facts only)

Always visible, sourced **only** from the engine's visible projection / public game state
(0009/0011) — never the Vault:

- **Week & phase** (HOH comp / nominations / veto / veto ceremony / eviction).
- **HOH & nominees** (public ceremonies — a houseguest plainly knows these).
- **Veto status** — who holds the Power of Veto and whether it's been used.

It shows **nothing hidden and nothing inferred**: no secret votes, no off-screen targeting, no
"who's coming for you," and — per the guiding principle — **no read on where the player stands**
(no safe/at-risk badge, no threat read). The panel is the **objective, public state of the house**,
full stop. The player's *standing* is theirs to **infer** from the facts here, the houseguests'
**observable behavior** toward them, and the narration — the game never hands it to them as a
readout (decision 0002; anti-sycophancy).

## 4. Inline decision buttons (over the engine's legal set)

When the engine surfaces a **pending decision** (0019: `pendingDecision` → legal options from
0011/0005), the chat renders **exactly those options** as buttons. Tapping one executes the choice
through the **validated** path (`executeDecision` — as built: `submitDecision`), and the engine re-validates. The player can
**never be offered, or pick, an illegal move**. Free-text social play continues in the chat
(the hybrid model, 0019); only the buttons make a binding choice.

- **Options carry public info only.** When the choices are houseguests (nominate / vote /
  replacement), each option shows **name + portrait + public status** — never any hidden read,
  threat, or "recommended" hint. The game presents the *legal field*; the **player decides whom**,
  on their own judgment (the guiding principle).
- **Binding moves confirm before they fire.** An irreversible choice (a nomination, a vote, using
  the veto) gets a short **confirm beat** — the weight of *BB*'s big decisions, and a guard against
  a mis-tap — then `executeDecision`. The engine still validates; the confirm is UX, not authority.

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

**Where they surface (look & feel).** The experience stays **chat-forward** — the narration is the
show. Portraits give the cast faces without stealing focus: a houseguest's portrait appears beside
the **status panel** entries (HOH / nominees / veto holder), on **decision option** buttons, and —
where it adds presence — next to a houseguest as they speak or act in the narration. Small,
consistent, identity-only; never a stats overlay. Pacing follows the moment (0018): tense beats
land one at a time; quiet beats breathe.

## 6. Contracts (stack-agnostic)

```
gameStatus() -> { week, phase, hoh, nominees[], veto: { holder, used } }   # Vault-free (visible projection)
pendingDecision() -> { kind, options[] } | none                            # engine LEGAL set (0019/0011/0005)
executeDecision(kind, choice) -> result                                    # validated; rejects illegal (0005) (as built: submitDecision)
portraitDescriptorFor(houseguest) -> publicDescriptor                      # built from character.md PUBLIC facets (0004/0015);
                                                                           #   Vault-free — NO aptitudes, hidden elements, or Soul/Vault
portraitFor(houseguest) -> imageRef                                        # frontend image-gen renders the descriptor; persisted (0007)
```

**Invariants:** the status panel is **sentinel-free** under any Vault and equals the engine's
public state; it surfaces no hidden info; inline options equal the engine's legal set and execute
only via the validated path; the **portrait descriptor** is built from `character.md`'s public
facets and is sentinel-free (no aptitudes, hidden elements, or `Soul`/Vault); portraits persist
and are consistent per save.

## 7. Decisions

- **"Your own standing" is the player's to infer — resolved.** Not a HUD chip and not a narrated
  readout of how they're doing. The panel stays objective/public; the player reads their standing
  from facts + houseguests' observable behavior + the narration's texture (the guiding principle,
  decision 0002). The game never says "you're safe" / "you're a target."
- **Portrait timing (flag):** generate **eagerly at cast creation** (default — consistent, no
  first-view lag) vs lazily on first view.
- **Portrait provider (flag):** reuse **Orwell's image-gen pipeline** (default) with a
  deterministic placeholder for seeded/offline tests.

## 8. MVP-2 — the rich game UI (removed)

The rich game UI — house view, houseguest cards, browsable journal, competition visuals — was
tracked as **feature 0022, since removed** (PO review 2026-06-28). Its goals were delivered the
chat-forward way (0020 status panel, 0051 portraits, 0054 gadget rail); the standalone dashboard
spec was cut under ADR 0003 ("the conversation is the game").
**When it resumes**, the houseguest-card "player read" must be reworked to the guiding principle
above (show *facts + observable behavior*; the player forms their own read — never a system-
asserted "you trust them"). It holds the same Vault-free guarantee throughout.

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
- [ ] **Facts & behavior, never feelings:** no surface (panel, decision options, portraits)
      asserts the player's own read or shows a relationship/threat number; the player's standing is
      conveyed only as facts known + observable behavior + narration (the guiding principle, 0002).
- [ ] **Decision options carry public info only** (name/portrait/public status — no hidden read or
      hint); binding moves get a **confirm beat** before `executeDecision`.

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

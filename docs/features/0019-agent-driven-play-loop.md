# 0019 — Agent-driven play loop

> **Status:** Built (see the [README status index](./README.md#index)). **How Orwell is actually played.** The LLM agent drives each turn by
> *calling engine tools* — read the visible state, narrate the moment (0018), surface the legal
> decision set when a binding choice is due, take the player's choice, and execute it through a
> **validated** engine tool; the engine resolves and advances. The agent **never** decides
> outcomes. This is the connective tissue that makes "Orwell is the game" playable, turn by turn,
> inside the main chat.
> **Executable spec:** [`0019-agent-driven-play-loop.feature`](./0019-agent-driven-play-loop.feature)

## 1. Summary

Each turn is an **agent loop over engine tools**:

```
getVisibleStateFor(player)  →  narrate the moment (0018)
   →  if a binding decision is pending: surface the engine's LEGAL option set (0011/0005)
   →  player responds:  free-text social play   OR   an explicit binding choice
   →  binding choice ⇒ executeDecision(...) [validated; as built: submitDecision]  →  engine resolves & advances (0006/0011/0014)
   →  repeat
```

The agent **orchestrates and voices**; the **engine decides**. Binding decisions
(nominate / veto / replacement / vote / competition intent) go **only** through validated tool
calls — never parsed from prose — and the engine rejects anything illegal (0005). Everything the
agent consumes is Vault-free (0001).

## 2. Scope

**In:** the turn loop; the **hybrid input model** (free-text social vs explicit binding choices);
the engine-supplied **legal option set** for a pending decision; **validated execution** of
binding choices; the "engine decides outcomes, agent only voices" guarantee.

**Out:** the phase machine + what each decision *is* (**0011**); legality rules (**0005**); the
conversation/scene recording + `socialRead` (**0012**); the narrator framing (**0018**); endgame
choreography (**0014**); the Vault Wall (**0001** — reused).

## 3. The hybrid input model (from 0012)

- **Free-text social play** is narrated and recorded as witnessed events (0012); it shapes
  relationships and knowledge but **never silently makes a binding decision**.
- **Binding decisions** are explicit, validated tool calls over the engine's legal option set —
  never inferred from prose. "I guess I'd vote out the nominee" in chat does **not** cast a vote;
  the player must make the binding choice through the validated path.

> **Every turn feeds the consequence loop (0023).** The agent must **record** what happens — each
> social scene, each binding decision — so the engine folds its **hidden impact** into the
> relationship/soul layer and **persists** it. An action the agent narrates but never records has
> **no consequence and no memory** — a silent leak of the game's point. The agent **calls the
> levers** (0018 manifest); it does not just describe.

## 4. The engine supplies the legal option set

When a decision is pending, the agent does not invent the choices — it **asks the engine** for
the legal set (eligible nominees, vetoable nominees, valid replacements, the eviction ballot per
0005/0011) and presents exactly those. The agent/UI therefore **cannot offer an illegal move**,
and the engine re-validates on execution as defense in depth.

## 5. The engine decides; the agent only voices (anti-sycophancy)

Outcomes — competition results, veto use, the eviction vote, the jury vote — are computed by the
engine (0006/0011/0014). The agent **cannot** produce a winner, a vote tally, or a survivor the
engine did not decide. It narrates the engine's result; it never bends it to please the player.

## 6. Contracts (stack-agnostic)

```
# Reads (Vault-free, 0009/0018)
getVisibleStateFor(player) -> VisibleState
getMomentPrompt(moment?)   -> { moment, systemPrompt }

# The decision seam
pendingDecision(state)         -> { kind, options[] } | none   # the engine's LEGAL set (0011/0005)
executeDecision(kind, choice)  -> result                       # validated; rejects illegal/ineligible (0005)
                                                               # (as built: submitDecision; the loop advances via advanceGame)

# Outcomes come from the engine, never the agent (0006/0011/0014); the agent voices them.
```

**Invariants:** a binding decision changes state **only** via `executeDecision` (as built:
`submitDecision`) over a legal
option (never via prose); illegal/ineligible choices are rejected; the presented options equal
the engine's legal set; the agent cannot fabricate an outcome the engine didn't decide; every
tool the agent touches is Vault-free.

## 7. Test strategy

- **Binding-only-via-validated-path:** prose that "sounds like" a vote/nomination does **not**
  change game state; only `executeDecision` does (cross-checks 0012).
- **Legality:** an illegal/ineligible choice (e.g. nominating the veto winner, or an outgoing
  HOH playing) is **rejected** (cross-checks 0005); the offered options equal the engine's legal
  set.
- **Engine-decides:** across seeds, the agent cannot yield a competition/vote outcome the engine
  didn't compute (no agent-set winners or tallies).
- **Hybrid:** free-text social play records witnessed events (0012) and shifts relationships
  (0017) without triggering any binding decision.
- **Vault-free:** every tool result the loop consumes is sentinel-clean (extends 0001).

## 8. Open decisions (flagged; drafted to the recommended default)

- **Pacing / auto-advance:** the engine **gates binding beats on an explicit player choice**;
  social beats flow freely (default). The agent does not auto-vote or auto-nominate for the
  player. Confirm.
- **Confirmation step:** the agent **confirms a binding choice before executing** it (default —
  irreversible moves get a beat), then calls `executeDecision`. Confirm.
- **NPC-decision narration:** NPC binding decisions are engine-computed (0011/0017) and the agent
  only voices the result (no agent discretion) — stated here, owned by 0011.

## 9. Definition of Done

- [ ] All scenarios pass, name-agnostic, seed-reproducible.
- [ ] Binding decisions change state **only** through the validated path; prose never does.
- [ ] Illegal/ineligible choices are rejected; presented options equal the engine's legal set.
- [ ] The agent cannot produce an outcome the engine didn't decide (anti-sycophancy holds).
- [ ] Free-text social play records events/relationships without making a binding decision.
- [ ] Every tool result in the loop is Vault-free (sentinel-clean).

## 10. Dependencies

**0009** (the agent's Vault-free tool set), **0011** (phases, `pendingDecision`, advancing),
**0005** (legality of options), **0012** (conversation recording + decision validation),
**0018** (the narration injected each turn), **0006/0014** (engine-decided outcomes the agent
voices), **0001** (Vault-free), **0017** (relationships shifted by social play).

## 11. Traceability

`CLAUDE.md` (the hybrid interaction model; "the deterministic core + seeded randomness decide
outcomes; the LLM only *narrates*"; bidirectional scenes); `docs/features/0012-…` (decision
validation); `docs/features/0011-…` (`pendingDecision`/`advancePhase`); the vendored agent
(`frontend/`, MCP tool-calling) that runs this loop.

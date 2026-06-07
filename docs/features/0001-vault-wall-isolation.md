# 0001 — Vault Wall isolation

> **Status:** Draft (authored by the feature-maker; awaiting an implementer).
> **Build priority:** #1 — the top of the order (`CLAUDE_CODE_INSTRUCTIONS.md` §9) and the
> #2 non-negotiable in the mandate (`CLAUDE.md`).
> **Executable spec:** [`0001-vault-wall-isolation.feature`](./0001-vault-wall-isolation.feature)

## 1. Summary

No Producer's Vault content — hidden attributes, NPC confessionals, hidden threads,
off-screen events the player did not witness, twists held in reserve — **nor any inference
uniquely derived from it** — may reach the player through **any** player-facing surface
(scene narration, NPC dialogue, system messages, logs, end-of-session summaries). The
**administrator (God Mode) is walled from the Vault as well**: admin inspects non-Vault
state only.

Enforcement is **structural, never prompt-based**: player-facing and admin-facing surfaces
are *incapable* of reading the Vault. The narrator **cannot leak what it never receives**.

## 2. Why this is first

It is the project's stated #1 implementation priority and its strongest correctness
guarantee. Building it first forces the foundational seams into existence — the engine-only
`VaultStore`, the single `EventStore` with per-event visibility, and the **visible
projection** that outward surfaces consume — which every later feature leans on. A leak here
is a **failure state**, not a partial success.

## 3. Scope

**In scope**
- The structural boundary that prevents any player- or admin-facing adapter/tool from
  reading `VaultStore`.
- The visible projection that outward surfaces consume instead.
- Content, summary, interrogation, competition-result, and capability guarantees in the
  `.feature` file.

**Out of scope (separate features, referenced only to fix the boundary)**
- **Event visibility & propagation (#2):** how hidden facts *become* known via in-game
  pathways. This feature assumes only a minimal `KnowledgeState` and per-event
  `witness set` + `hidden flag` exist; the propagation feature builds them out.
- **Diary Room sanctity / "public vs private speech":** the player's DR is *player*
  knowledge (not Vault), but must never inform NPC behavior. That is a **different wall**
  (DR → NPC) from the Vault Wall (Vault → player/admin). Only the *NPC-confessional* half
  (which **is** Vault content) is exercised here.
- Authoring/migrating real Vault contents (a dev-time concern; the running game surfaces
  Vault contents to no one).

## 4. Surfaces & contracts (stack-agnostic)

Language-neutral sketch — names match `CLAUDE.md`. The implementer maps these onto the
chosen stack.

```
# Engine-only (NEVER injected into any outward-facing adapter/tool)
VaultStore:
    readHidden(query)  -> HiddenRecord        # confessionals, hidden attrs, off-screen events, reserved twists

# The single interaction record; visibility is per-event metadata
EventStore:
    record(event{ initiator, witnessSet, hidden, content })
    query(filter)      -> [Event]

# What outward surfaces are allowed to consume
VisibleStateService:                           # the ONLY state source for outward channels
    getVisibleStateFor(entity) -> VisibleState # events where entity ∈ witnessSet, + entity's KnowledgeState; excludes hidden/unknown
KnowledgeService:
    knownTo(player)    -> KnowledgeState        # facts surfaced via legitimate pathway

# Outward channels — depend on VisibleStateService, never on VaultStore
PlayerSurface (drives NarrativePort):
    render(scene | dialogue | log | summary)   <- VisibleState only
AdminPort (God Mode):
    inspect(query)     -> NonVaultState         # no method returns Vault data
SummaryService:
    endOfSession()     -> "Updated save(s) available."   # nothing more
```

**The crux (the structural guarantee):** `VaultStore` is wired (DI/imports) only into
engine/simulation components. The player renderer, the admin port, and every MCP tool
exposed to the player or admin channel resolve their data **exclusively** through
`VisibleStateService` / `KnowledgeService`. There is **no dependency edge** from any
outward-facing module to `VaultStore`. Because the context handed to the narrative layer is
assembled solely from the visible projection, there is no Vault-derived material in scope
for the model to infer from — which is how the *"no uniquely-derivable inference"* clause is
satisfied by construction rather than by judgment.

## 5. Test strategy (how to operationalize, incl. the "inference" clause)

Four complementary checks; together they make the `.feature` enforceable:

1. **Sentinel / canary content test.** A fixture populates the Vault so every hidden datum
   embeds a unique sentinel marker not derivable from visible state. Across many seeded runs
   and every outward surface type, assert **no sentinel appears**. This operationalizes both
   "no Vault content" and "no uniquely-derivable inference" — the sentinel is the only place
   that information exists, so if it never appears, nothing was derived from it.
2. **Context-assembly test.** Assert the context object handed to the narrative layer
   contains **zero** sentinels. (Defends the inference clause at the source.)
3. **Architecture / dependency test.** Assert the dependency graph has **no path** from any
   player- or admin-facing module to `VaultStore` (e.g. an import-boundary / layering test
   in the chosen stack). This is the structural proof, independent of any single run.
4. **Capability test.** Enumerate the tools available in the player channel and in the
   admin/God-Mode channel; assert the set is a fixed allowlist that contains **no** Vault
   reader, and that attempting to obtain one fails.

Use **seeded** randomness so runs are reproducible, and make checks **property-style** (many
seeds × many surfaces × many Vault shapes), per `CLAUDE_CODE_INSTRUCTIONS.md` §9.4.

## 6. Acceptance criteria / Definition of Done

Mirrors `CLAUDE_CODE_INSTRUCTIONS.md` §11:

- [ ] Every scenario in `0001-vault-wall-isolation.feature` passes, name-agnostic.
- [ ] Vault isolation verified on **both** a player surface and the admin/God-Mode surface.
- [ ] The architecture/dependency test proves **no** outward module reads `VaultStore`.
- [ ] The narration context is proven Vault-free (sentinel test over many seeds & surfaces).
- [ ] End-of-session summary emits only "updated save(s) available."
- [ ] Domain logic exercised here is unit-tested with the **seeded** `RandomnessSource`.

## 7. Edge cases the spec deliberately pins

- **Summaries** may confirm only that updated saves exist — no change description, no Vault
  section names.
- **Direct interrogation** ("is X true / is X in the Vault?") must not confirm or deny
  specific Vault content.
- **Competition results** are delivered as outcomes — never stat scores, ratings, or
  rankings (legacy Vault-Wall rule).
- **NPC confessionals** are Vault content and never surface; the **player's DR** is not Vault
  content (handled by a separate wall — see §3).
- **Over-blocking guard:** a fact already surfaced via a legitimate pathway *may* appear,
  sourced from the player's `KnowledgeState`. The boundary is **provenance**, not content —
  otherwise the Wall becomes a blanket gag and the game can't deliver gossip.

## 8. Implementer handoff — decisions & open questions

- **Stack & test runner are unchosen** (open decision; `CLAUDE_CODE_INSTRUCTIONS.md` §15).
  This gates which BDD runner executes the `.feature`. Confirm before starting.
- **Sentinel mechanism:** recommend test-fixture canaries as the baseline guarantee; an
  optional runtime provenance/taint tag on Vault records is reasonable defense-in-depth — is
  that wanted, or keep enforcement purely structural + fixture-based?
- **Where the boundary is enforced** in the chosen stack: DI wiring, package/layer
  boundaries, or running the player/admin MCP server as a separate process with no Vault
  handle. Recommend the strongest the stack allows (separate composition root for outward
  channels).
- **Tool registry:** confirm player/admin MCP tools are a fixed allowlist and decide where
  that registry lives, so the capability test has a single source of truth.
- **Sequencing:** depends on a minimal `EventStore` (witness set + hidden flag) and a stub
  `KnowledgeState`. If feature #2 isn't started, implement just enough of both to satisfy
  these scenarios; #2 will deepen them.

## 9. Traceability

| This feature | Source |
|---|---|
| Vault Wall requirement; structural enforcement; God Mode walled; summaries | `bb-sim-spec.md` §5; `bb-sim-spec.md` §12 (Vault Wall scenarios) |
| Per-event visibility; off-screen events; confessionals are Vault-only | `bb-sim-spec.md` §6.2–6.3; `CLAUDE.md` event/visibility model |
| "Cannot leak what it never receives"; permission boundary; do-nots | `CLAUDE_CODE_INSTRUCTIONS.md` §1.5, §2, §13 |
| No stat/ranking in results | `docs/legacy/BB_GameBible.md` Vault Wall rules (§2) |
| Definition of done; name-agnostic testing | `CLAUDE_CODE_INSTRUCTIONS.md` §10, §11 |

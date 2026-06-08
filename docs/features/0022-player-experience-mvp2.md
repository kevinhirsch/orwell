# 0022 — Player experience MVP-2 (the rich game UI)

> **Status: DEFERRED** — parked while MVP-1 (0020) is refined.
>
> ⚠️ **Rework before un-parking: the houseguest-card "player read" (§4, §8) is wrong.** The
> player's **own** feelings/reads are **human-driven** (decision 0002 — "the player's own reads
> stay human-driven"); the game must **not** assert "you trust them." Instead a card should show
> **facts the player knows** + **observable houseguest behavior toward them**, and let the player
> form their *own* read. Drafted option A was the closest of the three but still not right.
> Revisit §4/§8 with this correction when MVP-2 resumes.
>
> **Status (original):** Draft. The **rich game UI** — the follow-on to [0020](./0020-player-experience.md)
> MVP-1 (chat + light status panel). Adds a **house view**, **houseguest cards**, a **browsable
> journal**, and **competition visuals**. Every surface holds the same hard line: it shows only
> what the player **legitimately knows** — never the Vault.
> **Executable spec:** [`0022-player-experience-mvp2.feature`](./0022-player-experience-mvp2.feature)

## 1. Summary

Once MVP-1 is playable, MVP-2 makes Orwell *feel* like the show:

1. **House view** — the cast as **portrait cards** (0020 portraits) with public status (active /
   HOH / nominated / veto-holder / evicted).
2. **Houseguest cards** — per houseguest, **what the player legitimately knows** about them
   (witnessed/learned facts, 0002) plus the player's **own read** (a character-framed perception,
   knowledge-vs-suspicion) — **never** the engine's hidden state.
3. **Journal** — a browsable record of the player's **witnessed events + surfaced knowledge**
   (0002), the player's own history of the game.
4. **Competition visuals** — competitions as visual moments, **outcome-only** (no stats/scores).

The crux: house view, cards, and journal are the surfaces most tempting to over-fill — so they are
sourced **exclusively** from the visible projection / `KnowledgeState`, never the Vault.

## 2. Scope

**In:** the house view (portrait cards + public status); houseguest cards (player-knowledge + the
player's own read); the journal (witnessed events + surfaced knowledge); competition visuals
(outcome-only); the Vault-free guarantee across all of them.

**Out:** MVP-1 (status panel, inline decisions, portraits — **0020**); the engine projections they
read (visible state **0001/0009**, knowledge **0002**, relationships **0017**, status **0011/0020**,
portraits **0004/0020**); the narration/agent loop (**0018/0019**).

## 3. House view

The cast rendered as **portrait cards**, each showing the houseguest's **public status** only:
active, HOH, on the block (nominee), veto-holder, evicted (and jury). These are public, ceremony-
level facts (0011/0020) — **no** hidden votes, secret targeting, or who's-scheming-whom.

## 4. Houseguest cards (player-knowledge only — see §8)

Opening a houseguest shows a card built **entirely from the player's own knowledge**:

- **Public:** name, portrait, public status, public-persona vibe.
- **Known:** facts the player has **witnessed or been told** about them (0002) — conversations,
  votes the player saw, things surfaced via a pathway. Beliefs carry **knowledge vs suspicion**
  (0002): the player can *suspect* without *knowing*.
- **The player's read:** a **qualitative, character-framed** perception of where the player stands
  with them (e.g. "you trust them," "you're wary," "they feel like a target on you") — the player's
  *own* inference, **never** the engine's hidden numbers, true stats, hidden attributes, or the
  NPC's soul. *(How rich this read is = the open decision, §8.)*

A houseguest card **never** shows: true P/M/S stats, hidden attributes, confessionals, off-screen
events the player didn't witness, or the NPC's actual relationship numbers.

## 5. Journal

A **browsable, chronological** record of the player's game: the **witnessed events** they were part
of plus **knowledge surfaced** to them (0002) — gossip they were told, things they overheard, the
ceremonies they saw. It is exactly the player's `KnowledgeState` + visible events made legible —
**nothing the player hasn't legitimately learned**. (The player's Diary-Room entries, 0013, are the
player's own and may appear here; NPC confessionals never do.)

## 6. Competition visuals

A competition rendered as a visual beat, delivering the **outcome only** — who won / the result —
**never** stat scores, ratings, or rankings (the legacy Vault-Wall rule, 0001/0006). The drama is
in the reveal, not the numbers.

## 7. Contracts (stack-agnostic)

```
houseView() -> [{ id, name, portrait, publicStatus }]            # public ceremony status only (0011/0020)
houseguestCard(id) -> {
    name, portrait, publicStatus,
    known: [ facts the player witnessed/was told, each knowledge|suspicion ],   # 0002 only
    playerRead: <qualitative, character-framed perception>                       # player's own; NEVER engine internals
}
journal() -> [ witnessed events + surfaced knowledge, chronological ]            # the player's KnowledgeState (0002)
competitionView(result) -> { type, winner, ... }                                 # OUTCOME ONLY — no stats/scores (0001/0006)
```

**Invariants:** every surface is **sentinel-clean** under a fully populated Vault; the house view
shows only public status; a houseguest card contains **no** true stats / hidden attributes / soul /
unwitnessed events; the journal equals the player's witnessed-events + surfaced-knowledge and
nothing more; competition visuals carry **no** scores/rankings.

## 8. Open decision (flagged; drafted to the recommended default)

**How rich is the houseguest card's "player read"?** All options stay Vault-free (player-knowledge
only); they differ in how much of the player's *own* inference to surface:

- **A (recommended, drafted):** a **qualitative, character-framed** read — "you trust them," "you're
  wary," "they feel like a threat to you" — derived from what the player has witnessed/learned and
  framed through the player's perspective (knowledge vs suspicion). Immersive, no numbers, never
  engine internals.
- **B:** **public status only** — name/portrait/status, no read at all. Safest/leanest; less of the
  paranoia texture that makes *BB* tick.
- **C:** a **graded** read (bars/【meters】 for trust/threat). More game-y, but risks implying false
  precision the player wouldn't actually have. *Not recommended* — it leans toward exposing a
  model the player should only *feel*.

Either way: **never** the engine's hidden relationship numbers or true stats (that's a Vault-axis
leak). Confirm A, or switch.

## 9. Definition of Done

- [ ] All scenarios pass, name-agnostic, seed-reproducible.
- [ ] House view shows portrait cards + **public** status only; sentinel-clean.
- [ ] Houseguest cards show **player-knowledge + the player's own read** and are provably free of
      true stats / hidden attributes / soul / unwitnessed events (sentinel-clean).
- [ ] The journal equals the player's witnessed events + surfaced knowledge — nothing more.
- [ ] Competition visuals are outcome-only (no stats/scores/rankings).
- [ ] Every MVP-2 surface verified Vault-free under a populated Vault.

## 10. Dependencies

**0020** (MVP-1 — the base experience + portraits), **0002** (knowledge vs suspicion — what cards
and the journal may show), **0017** (the player's read, as the player perceives it — never the
engine's numbers), **0001** (Vault-free across all surfaces), **0011/0020** (public status),
**0006** (outcome-only results), **0013** (the player's DR may appear in the journal; confessionals
never do), plus **Orwell's image-gen** (portraits / competition visuals).

## 11. Traceability

[0020 §8](./0020-player-experience.md) (MVP-2 sketch: house view, houseguest cards, journal,
competition visuals); `CLAUDE.md` event/visibility model (knowledge vs suspicion; the journal is
player knowledge); `docs/features/0002-…` (knowledge/suspicion); the Vault-Wall rule that results
carry no stat scores (0001/0006).

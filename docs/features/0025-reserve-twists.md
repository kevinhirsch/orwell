# 0025 — Reserve twists (Vault-sealed, engine-timed)

> **Status:** Draft. A **small curated pool of classic, non-structural twists** held **in reserve**.
> The engine decides **if and when** one fires, at a dramatic beat — and the twist (what *and* when)
> is **sealed in the Vault so neither the player NOR the admin knows in advance**. Variety and
> surprise without breaking the 16 → jury-9 → final-2 core.
> **Executable spec:** [`0025-reserve-twists.feature`](./0025-reserve-twists.feature)

## 1. Summary

Reality *Big Brother* runs on the occasional production twist. Orwell keeps **1–2** in **reserve**
per game (admin-enabled count, 0016) drawn from a **curated pool** of **non-structural** twists —
a secret power, a double eviction, a returning-juror battle-back, and the like. The engine, seeded,
decides **whether** a reserved twist is in play and **when** it fires (a dramatic beat). Until it
fires, the choice and its timing are **Vault-sealed** — a genuine surprise to the player, and
**also unknown to the admin** (mandate #2: the human has never read the Vault, *including* the
admin who switched twists on). When it fires it becomes a witnessed in-game event; only then is it
known.

## 2. Scope

**In:** the curated reserve **pool**; the engine's seeded **if/when** firing at a dramatic beat;
**Vault-sealing from both player and admin**; the **reveal-as-event**; the **format-preserving**
constraint (twists never break the core arc or the hard rules).

**Out:** the core weekly loop (**0011**); eligibility/legality (**0005** — invariant *under* twists,
already tested); the admin **enable knob** (**0016** — it sets the *count*, never the content); the
Vault-Wall mechanics themselves (**0001** — reused on both surfaces).

## 3. The pool (curated, non-structural)

A small, curated set of **classic, format-preserving** twists. Illustratively (the implementer
curates the exact pool):

- **Secret power** — a houseguest secretly holds a one-time power (e.g. a special veto, a vote
  nullifier, a power to save) they may play at a key moment.
- **Double eviction** — a compressed week where two houseguests leave.
- **Returning-juror battle-back** — an evicted juror earns their way back via a competition.

Every pool entry is **non-structural**: the season still lands at **jury-9 → final-2**, and the
hard rules (0005) still hold. Twists add variance *along the way*, never a new backbone.

## 4. Engine-timed & seeded

- **Whether:** at most the admin-enabled count (0016) is in play; often **none**. The engine seeds
  whether a reserve twist is loaded for this game.
- **When:** the engine fires it at a **dramatic beat** (a close vote, a power shift, a milestone),
  decided by the seeded `RandomnessSource` — so the same seed reproduces the same twist + timing,
  and the distribution is testable. Rare by construction.

## 5. Vault-sealed — from the player AND the admin

The chosen twist(s) + their trigger/timing are **Vault content** (engine-only). They never reach:

- **the player** — that is the surprise; and
- **the admin / God Mode** — the admin who set "reserve twists: 1" (0016 §5) does **not** learn
  *what* it is or *when* it fires. The engine **generates and seals** it; even God Mode can't peek
  (mandate #2 — spoilers ruin the game above all else).

So a reserve twist is the cleanest demonstration of the Vault Wall protecting **everyone**: the
producer's secret no human has read.

## 6. Reveal (firing)

When the engine fires a twist it becomes a **dramatic, witnessed in-game event** — the narrator
voices it (0018), it enters knowledge (0002), and the mechanic applies. Before firing it is silent
and sealed; after firing it is simply part of the game's history. There is no "a twist is coming"
tell on any surface.

## 7. Format-preserving (the hard guarantee)

A firing twist **never** breaks: the **Vault Wall** (0001 — its existence wasn't leaked, its
mechanic obeys the wall), **eligibility/legality** (0005 — e.g. the outgoing-HOH and veto-winner
rules still hold even in a double eviction), or the **core arc** (still 16 → jury-9 → final-2). The
0005 invariants are explicitly required to hold *under* a reserve twist.

## 8. Contracts (stack-agnostic)

```
# Vault content (engine-only) — sealed; surfaced to NO ONE until it fires:
ReserveTwist { kind, trigger, /* when */ }              # in the Vault (0001); count bounded by admin enable (0016)

# Engine, per beat (seeded):
maybeFireTwist(state, rng) -> TwistEvent | none         # fires at a dramatic beat; rare; deterministic by seed
# On fire: record a witnessed reveal event (0002) + apply the (format-preserving) mechanic.
```

**Invariants:** a sealed twist is **sentinel-clean on BOTH the player and the admin surfaces** until
it fires; enabling twists (0016) reveals neither content nor timing; firing is **seed-deterministic**
and **rare** (≤ the enabled count); a fired twist is a recorded event; eligibility (0005) and the
core arc hold under any twist.

## 9. Test strategy

- **Sealed from everyone:** with a reserve twist loaded, across seeded play **no** player surface
  **and no admin surface** reveals it until it fires (extends the 0001 canary to *both*, and
  cross-checks 0016 §5 — the admin who enabled it stays blind).
- **Fires rarely, deterministically:** over many seeds, at most the enabled count fires, at a
  dramatic beat; same seed ⇒ same twist + timing.
- **Reveal is an event:** a fired twist produces a witnessed event and applies its mechanic.
- **Format-preserving:** under a fired twist, the 0005 eligibility invariants still hold and the
  season still reaches jury-9 → final-2 (cross-checks 0005/0011).
- **No tell:** no surface hints a twist is pending before it fires.

## 10. Definition of Done

- [ ] A reserve twist (content + timing) is **Vault-sealed** and provably invisible to **both** the
      player and the admin until it fires (sentinel-clean on both; ties 0016 §5).
- [ ] Firing is **seed-deterministic**, **rare** (≤ the admin-enabled count), at a dramatic beat.
- [ ] A fired twist is a **recorded, witnessed event**; the narrator can voice it (0018).
- [ ] Eligibility (0005) and the core arc (16 → jury-9 → final-2) **hold under** any twist.
- [ ] No surface tells that a twist is pending.

## 11. Dependencies

**0001** (Vault Wall — the twist is sealed, on player *and* admin surfaces), **0016** (admin enables
the *count*, never the content/timing — 0025 is its consumer), **0005** (eligibility invariant under
twists), **0011** (the loop a twist perturbs), **0002** (the reveal becomes knowledge), **0018**
(the narrator voices the reveal), seeded `RandomnessSource`.

## 12. Traceability

`CLAUDE.md` ("Classic format, no core-structure twists — one or two production twists may be held
in reserve"; God Mode walled from the Vault even for the admin); `docs/features/0005` (1–2
Vault-held reserve twists; invariants hold under them); `docs/features/0016` §5 (enable without
learning content/timing); mandate #2 (the human/admin has never read the Vault).

# 0001 — Competition stats, the Character/Soul split, and veto "Houseguest's Choice"

> **Status:** Accepted — except sub-decision **3 (Character/Soul split)**, which is
> **Proposed** (drafted from a tentative steer; easy to revise).
> **Source:** human spec feedback (this session), refining `README.md`.

## Context

Two refinements to the canonical mechanics, plus an architecture question about where
"character" stats live. Captured here so the feature specs (0004, 0005, 0006) and the
canonical-mechanics summaries stay consistent.

## Decisions

### 1. Drop the Luck stat — **Accepted**

Competition stats are **Physical, Mental, Social** only. There is no Luck stat or modifier.

### 2. Add a soul-sourced **emotional modifier** — **Accepted**

Competition outcomes apply an **emotional modifier** alongside the per-moment temperature
roll. Emotional state is **not** a fourth competition stat — it is a **character/soul
attribute** that *modulates* outcomes (and behavior). A rattled houseguest competes
differently. Unpredictability that the Luck stat used to provide now comes from
**temperature + emotional state**, both driven through the seedable `RandomnessSource`.

### 3. Static `Character` vs dynamic `Soul` — **Proposed**

Split each houseguest's data into two facets behind `SoulProvider` / `CharacterFactory`:

- **`Character` (static):** stable baseline — archetype, **core Physical/Mental/Social
  aptitudes**, identity, backstory. Set at generation; rarely changes. (Could be a
  `CHARACTER.md` facet.)
- **`Soul` (dynamic, md + vector):** evolving state — current **emotional** state,
  relationships including the persistent `ALLIES` / `BEST_FRIEND` variables (present for
  everyone **once enough interaction data has accumulated**), accumulated memory, and shifting
  leanings. Changes throughout the game.

The competition **emotional modifier** (decision 2) and the veto **Houseguest's Choice**
selection (decision 4) both read the **dynamic `Soul`**.

> This split is **Proposed** because the human flagged genuine uncertainty about it. It is a
> doc-only decision today (no code depends on it yet), so it is cheap to change — confirm,
> adjust the boundary, or collapse it back into a single soul.

### 4. Veto "Houseguest's Choice" — **Accepted**

The veto field is still six (HOH + two nominees + three by chip draw), but — as on the real
show — one chip in the bag is **"Houseguest's Choice."** Whoever draws it **selects** the slot
instead of receiving a random name:

- An **NPC** holder chooses by **soul motivation** (e.g. an `ALLY` or `BEST_FRIEND`).
- The **player** has no influence over *which* chips are drawn, but **if the player draws
  Houseguest's Choice they pick** — the single bit of player agency in the draw.

## Rationale

- Luck was a thin, characterless randomness knob; temperature already supplies seeded
  variance, and an **emotional** modifier supplies variance that is *grounded in character*,
  serving behavioral fidelity (the #1 mandate) instead of pure noise.
- Putting emotional state and relationships in a **dynamic** store (vs. static baseline) keeps
  competition aptitudes stable while letting mood, alliances, and memory **deepen over the
  game** — aligned with the non-degradation mandate.
- Houseguest's Choice adds authentic *BB* texture and a real consequence for the soul's
  `ALLIES` / `BEST_FRIEND` graph, without handing the player control over the draw.

## Consequences (specs updated with this record)

- `docs/features/0004-replayability-and-naming.md` — `SoulProvider` split into
  `characterOf` (static) / `soulOf` (dynamic); `ALLIES` / `BEST_FRIEND` noted.
- `docs/features/0005-competition-eligibility.{feature,md}` — veto draw now includes the
  Houseguest's Choice chip and its holder's selection; a new scenario covers it.
- `docs/features/0006-outcomes-by-stats-and-temperature.{feature,md}` — Luck removed; the
  emotional modifier added; "variance" replaces "Luck" in the predictability scenario.
- `README.md` and `CLAUDE.md` — canonical-mechanics summaries updated.

## Open / to confirm

- Confirm or revise the **`Character` / `Soul` split** (decision 3).
- The **emotional-modifier weighting** is part of the still-open temperature/0006 tunable
  config (numbers, not shape).
- The threshold for "enough interaction data" before `ALLIES` / `BEST_FRIEND` populate.

## Traceability

`docs/bb-sim-spec.md` §7 (deep, evolving characters), §8 (temperature);
`docs/legacy/BB_GameBible.md` §4–§5 (veto of six; stats); human feedback (this session).

# 0086 — Houseguest drives (everyone always plays; intensity varies)

> **Status:** 📝 **SPEC — owner-ruled, build-ready** (authored 2026-06-25 from the post-0085 full-season
> diagnostic; design rulings #1–#4 decided in review — see "Owner rulings" below: a low lean DOES nudge
> the vote, drives surface only subtly, NPCs only, the loud cap stays 4).
> **Gate (planned):** engine (Vitest + property/calibration + dependency-cruiser + BDD
> `0086-houseguest-drives.feature`). **Depends on:** 0085 (campaigns — a drive's *top gear* IS a
> campaign; this generalizes formation), 0002/0026 (the relationship reads a drive is computed from),
> 0041 (the soul a drive colors, and that colors it back — mood/volatility), 0044 (the seeded
> decisions a drive leans). **Sibling of** 0085. **Vault Wall (mandate #2 — symmetric):** a drive is
> hidden engine state, computed from each houseguest's OWN reads (never an omniscient board); it
> reaches the player only through behavior + a pathway, never as a number.

> **Owner direction (2026-06-25, this session):**
> *"Most players would have some kind of campaign — maybe not a full-blown campaign, but some kind of
> motivation: self-preservation, or a target, or something. The DEGREE it's sought after would differ,
> but these motivations would all play out for each houseguest."*

## The problem (from the full-season diagnostic)

A real season played to completion exposed it: campaigns (0085) are **binary and rare** — a campaign
forms only when a threat read clears `0.55`, and the set is **capped at 4 concurrent**. So in a
15-person house, **~4 houseguests are "playing" at any moment and ~11 are inert** — no goal, no drive,
purely reactive. That's the opposite of real _BB_, where **everyone is always running their own game**
and only the *intensity* varies: the comp beast on self-preservation autopilot, the floater quietly
hedging, the mastermind three moves into a target. The diagnostic also tied two thin spots to this
same root — houseguests read as generically "on edge" with nothing specific to be on edge *about*,
and they never *suspect* anyone — because most of them have **no motivation to anchor that texture**.

## The core idea — motivation is continuous, not a 4-slot privilege

Every active houseguest **always carries a DRIVE**: a primary motivation + a current **intensity**.
The 0085 `Campaign` becomes the **top gear** of a drive — not a separate, rare thing.

```
Drive {
  owner:      EntityId
  motivation: "self-preserve" | "target" | "build" | "lay-low" | "win-power"
  target?:    EntityId          // for "target" (who) / "build" (with whom)
  intensity:  number            // 0..1 — how hard they're pursuing it THIS week (Vault-only)
}
```

- **`motivation`** is derived from the houseguest's OWN board read (perspective-bound, never omniscient):
  on the block or reading high danger ⇒ `self-preserve`; a strong threat edge ⇒ `target`; a strong bond
  + safety ⇒ `build`; low threat + low danger + an under-the-radar archetype ⇒ `lay-low`; holds/wants
  power ⇒ `win-power`.
- **`intensity`** scales with the board + who they are: their own danger this week (nominated, low
  safety), the strength of the threat/bond that anchors the motivation, and an **archetype aggression**
  factor (a villain/mastermind pursues harder than a floater at the same board state) + soul state
  (a rattled soul pushes harder). Bounded, seeded.

### How a drive *plays out* — three tiers of the same spectrum

The crux (review ruling #5): **low and high touch DIFFERENT ballots.** A quiet lean moves only the
*owner's own* vote (their will to act on their own grudge — one ballot); a campaign sways *other*
voters (lobbying). This is what keeps the lean from double-counting the threat the vote already
weights house-wide — a low drive can never bias the whole electorate, only its owner's single vote.

| Intensity | What it does | Mechanism |
|---|---|---|
| **low** (a lean) | the owner's OWN vote leans toward their target, plus who they cluster with and the *framing* of their voice ("watch your back") — no lobbying, no campaign object, never sways anyone else | a small bounded term on the **owner's own** ballot + presence/voice flavor |
| **mid** (working it) | begins lobbying — tells an ally, plants a seed; belief diffuses (`knownTo`) | promotes toward a campaign |
| **high** (a campaign) | the full 0085 `Campaign` — sustained lobbying that sways OTHER voters, the seeded tilt | **IS** an 0085 campaign |

A drive's vote effect is **exactly one** of these (the spectrum is a single point, not additive): a
promoted drive's effect is the **campaign tilt**, never the campaign tilt *plus* the owner's lean.

**Only `target` drives touch the vote** (ruling #7). `self-preserve` has no low-lean — a nominee can't
vote on their own eviction, so it acts *only* at the campaign tier (lobbying others to save them);
`lay-low` / `build` / `win-power` are **behavioral-only** (clustering, voice, alliance texture) and
never touch the seeded vote.

**Drives are STICKY** (ruling #6): motivation is not re-rolled fresh each tick — a houseguest
**commits** to their read (their target, their lay-low posture) and holds it until the board genuinely
shifts (the target is evicted or wins the veto; the owner lands on the block). Hysteresis keeps the
house's agendas coherent turn to turn instead of flip-flopping — the same commitment 0085's `replan`
already gives a campaign, extended down to the quiet tier.

So **`formCampaigns` is reframed**: it no longer *invents* a campaign from a bare threshold — it
**promotes the highest-intensity drives into campaigns**. The cap (4) becomes a cap on *loud, active
campaigns*, **not** on who has a motivation — everyone still has a drive; the cap only limits how many
reach the lobbying/tilt tier at once (scarcity keeps the *loud* layer legible while the *whole house*
is quietly motivated).

### Why this fixes more than the cap

A houseguest with a real drive has **something specific to be on edge about** (their danger) and
**someone specific to suspect** (their target / a rival's target they caught wind of) — so this is the
substrate the diagnostic's thin **mood** and empty **suspicion** layers were missing. (Those tuning
fixes ship alongside; the drive gives them an anchor.)

## Engine seams

- `src/engine/campaigns.ts` — add the `Drive` type + `deriveDrive(actor, board, prior, rng)` (pure,
  perspective-bound, **sticky** — it takes the prior drive and only re-aims on a real board change) and
  `driveConstants` (intensity weights, the promote threshold, archetype aggression, the low-lean
  weight, the hysteresis margin). `formCampaigns` is reframed to **promote drives ≥ the campaign
  threshold** (highest intensity first, capped), so the existing campaign machinery is unchanged
  downstream.
- `GameSessionAdapter.campaignTick` — compute + carry every active houseguest's (sticky) drive each
  tick (engine-only); promote the top ones to campaigns under the cap. The **low lean** enters
  `ctx().campaignTiltFor` as a small bounded term on the **OWNER'S OWN ballot only** (owner ∈ voters,
  the nominee = their `target`) — *not* the lobbied-voter tilt a campaign applies — so a quiet grudge
  moves one vote, never the electorate. A *promoted* drive applies the campaign tilt instead (never
  both). Only `target` drives contribute; `self-preserve`/`lay-low`/`build`/`win-power` add no own-ballot
  term. All behind `ORWELL_CAMPAIGNS` on the dedicated rng ⇒ calibration byte-identical when off.
- Drives are **never stored as a number on any projection** and never crossed to the player; they
  surface only through behavior (clustering, voice framing, lobbying) + the existing pathways.

## Testability (role-only; HARD rules)

- **Everyone always plays:** every active houseguest has a drive each tick — a property test asserts
  the drive set covers the whole living house, not a capped subset.
- **Intensity tracks the board:** a nominated / high-danger houseguest's intensity is HIGH and their
  motivation `self-preserve`; a safe, low-threat under-the-radar one is LOW / `lay-low`; an archetype
  factor makes a villain pursue harder than a floater at the same board state. Seeded + deterministic.
- **The cap is on the LOUD layer, not motivation:** more than `maxConcurrent` houseguests have drives,
  but only ≤ cap are promoted to active campaigns; the rest still carry a (testable) lean.
- **Promotion is monotonic:** raising a drive's intensity past the threshold promotes it to a campaign;
  below, it stays a lean (a small vote nudge, strictly less than a campaign's tilt).
- **The lean moves only the OWNER's ballot (ruling #5):** a low `target` drive raises ONLY the owner's
  own vote against their target — a third party's vote is unmoved by it (only a *campaign* sways
  others). A promoted drive applies the campaign tilt, NOT both. Asserted at the vote: owner's vote
  shifts, a bystander's does not.
- **Drives are STICKY (ruling #6):** across ticks with an unchanged board, a houseguest keeps the same
  target/posture (no flip-flop); it re-aims ONLY on a real board change (target evicted/veto-safe, or
  the owner nominated). A property test ticks a stable board and asserts the drive holds.
- **Only `target` drives touch the vote (ruling #7):** a `lay-low`/`build`/`win-power` drive adds no
  vote term (behavioral only); `self-preserve` adds none at the low tier (a nominee can't vote on
  themselves) — asserted: these motivations leave the seeded vote byte-identical.
- **Perspective-bound (the omniscience ban holds):** a drive is computed from the owner's OWN reads;
  a houseguest's lean/target never reflects a campaign or threat they have no pathway to.
- **Calibration byte-identical when off:** with `ORWELL_CAMPAIGNS` unset, no drive is computed and no
  lean is applied ⇒ `juryReach`/UAT byte-identical (the same guard 0085 holds).
- **Anti-sycophancy:** intensity + the lean are engine-computed from the board, never narrated
  convenience; no raw number reaches the player.

## Owner rulings (2026-06-25 — decided in review of this spec)

1. ✅ **A low-intensity lean DOES nudge the vote** — a *small* bounded term for a `target`-drive (a
   quiet grudge matters a little), **well under** a campaign's tilt, and **calibrated against the band**
   so it never flattens variance (it must read as texture, not a second flat knob). The mid/high tiers
   still carry the lobbying + the full campaign tilt; the low lean is the gentle floor.
2. ✅ **Drives surface to the player only SUBTLY / inferred** — through behavior + pathways (who
   clusters, who lobbies, a wary tone), **never** as data and never the narrator announcing a
   motivation. Paranoia stays the human's to form (0017/0020). No "she's sizing you up" hand-holding.
3. ✅ **NPCs only** — the player forms their own motivation as a human; the engine never models or
   nudges the player's drive (consistent with 0085 keeping player campaigns as pure player-knowledge).
4. ✅ **Keep the house legible** — the loud cap stays at **`maxConcurrent` 4** (≈3–5 active campaigns
   mid-game); the rest simmer. The cap limits the *loud* layer only — everyone still carries a drive.
5. ✅ **The low lean moves only the OWNER's own ballot** (decided in kink review) — a quiet `target`
   grudge tilts the owner's single vote, never the electorate (that's the campaign tier's job). This
   avoids double-counting the threat the vote already weights house-wide, and is the cleaner concept:
   *your own will to act* vs. *working others*. A drive's vote effect is exactly one tier, never additive.
6. ✅ **Drives are STICKY** — a houseguest commits to their read and holds it until the board genuinely
   shifts (target gone/veto-safe, or owner nominated). Hysteresis, not a per-tick re-roll — the house's
   agendas stay coherent turn to turn.
7. ✅ **Only `target` drives touch the vote** — `self-preserve` acts only at the campaign tier (a nominee
   can't vote on their own eviction); `lay-low`/`build`/`win-power` are behavioral-only.

## Open questions / defaults (resolve at build)

1. **The exact low-lean magnitude + the promote threshold** — the small vote-lean weight and the
   intensity cutoff that promotes a drive to a campaign. Tune against `juryReach`/the eviction
   distribution (felt, never deterministic; never flattens variance).
2. **Motivation re-derivation cadence** — every tick vs. on board changes (start: per tick, cheap +
   responsive; it's a read).
3. **Cross-feature: feeding mood + suspicion.** A drive's `target` is the natural seed for a
   houseguest's *suspicion* (they suspect their target is coming for them too) and for *what* they're
   on edge about. Recommend: **0086 exposes the drive; the companion mood/suspicion tuning consumes
   it** (keeps this feature to the drive layer).

# 0086 — Houseguest drives (everyone always plays; intensity varies)

> **Status:** 📝 **SPEC / draft** (authored 2026-06-25, from the post-0085 full-season diagnostic).
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

| Intensity | What it does | Mechanism |
|---|---|---|
| **low** (a lean) | colors who they cluster with, how they vote at the margin, and the *framing* of their voice ("watch your back") — no lobbying, no campaign object | a small, bounded vote lean + presence/voice flavor |
| **mid** (working it) | begins lobbying — tells an ally, plants a seed; belief diffuses (`knownTo`) | promotes toward a campaign |
| **high** (a campaign) | the full 0085 `Campaign` — sustained lobbying, the seeded vote tilt | **IS** an 0085 campaign |

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

- `src/engine/campaigns.ts` — add the `Drive` type + `deriveDrive(actor, board, rng)` (pure,
  perspective-bound) and `driveConstants` (intensity weights, the promote thresholds, archetype
  aggression). `formCampaigns` is reframed to **promote drives ≥ the campaign threshold** (highest
  intensity first, capped), so the existing campaign machinery is unchanged downstream.
- `GameSessionAdapter.campaignTick` — compute every active houseguest's drive each tick (engine-only),
  promote to campaigns under the cap, and expose a **low-intensity lean** to `ctx().campaignTiltFor`
  (a small bounded term for `target`-drives below the campaign tier, so a quiet grudge still nudges a
  vote a little — far less than a full campaign). All behind the existing `ORWELL_CAMPAIGNS` flag and on
  the dedicated rng ⇒ calibration byte-identical when off.
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
- **Perspective-bound (the omniscience ban holds):** a drive is computed from the owner's OWN reads;
  a houseguest's lean/target never reflects a campaign or threat they have no pathway to.
- **Calibration byte-identical when off:** with `ORWELL_CAMPAIGNS` unset, no drive is computed and no
  lean is applied ⇒ `juryReach`/UAT byte-identical (the same guard 0085 holds).
- **Anti-sycophancy:** intensity + the lean are engine-computed from the board, never narrated
  convenience; no raw number reaches the player.

## Open questions / defaults (resolve at build)

1. **Does a low-intensity lean tilt the vote at all, or only clustering/voice?** Default: a *small*
   bounded vote lean for a `target`-drive (so a quiet grudge matters a little), well under a campaign's
   tilt — but resolve against the calibration band (it must not flatten variance like a flat knob).
2. **The promote threshold + the loud cap** — how many drives reach the campaign tier (start: the
   existing `maxConcurrent` 4, with the threshold tuned so 3–5 loud campaigns run mid-game and the rest
   simmer).
3. **Motivation re-derivation cadence** — every tick vs. on board changes (start: per tick, cheap +
   responsive; it's a read).
4. **Cross-feature: feeding mood + suspicion.** A drive's `target` is the natural seed for a
   houseguest's *suspicion* (they suspect their target is coming for them too) and for *what* they're
   on edge about — wire in the companion mood/suspicion tuning, or keep 0086 to the drive layer and let
   those consume it. (Recommend: 0086 exposes the drive; the mood/suspicion tuning consumes it.)
5. **Player drive?** Out of scope — the player forms their own motivation (human-driven); 0086 is NPCs.

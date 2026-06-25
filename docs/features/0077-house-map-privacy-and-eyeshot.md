# 0077 — House map, privacy & eyeshot (who you can see, who you can hear, who you have to track)

> **Status:** 🟢 **BUILDING (phased).** **Phase 1 — the floor plan** (the recent-BB 13-room layout +
> movement adjacency; bathroom off the hallway, private wing behind the hallway chokepoint, sealed
> diary booth): **MERGED** (PR #772, calibration byte-identical). **Phase 2a — the SIGHTLINE graph
> (eyeshot < adjacency):** **BUILT 2026-06-24** — `HOUSE_SIGHTLINE` + `areVisible`/`isPrivateRoom`
> (`src/domain/house.ts`); `whereabouts().nearby` is now sightline-scoped, so a CLOSED door one room
> over no longer leaks its occupants (the open public core sees across itself + the hallway mouth;
> every bedroom/bathroom/lounge/HOH/storage/diary is opaque from outside). Gate:
> `tests/unit/sightline0077.test.ts` + `tests/unit/whereaboutsSightline.test.ts` (+ the updated
> presence/BDD/lever-manifest contracts). Read-side only ⇒ calibration byte-identical. **Phase 2b —
> tracked occupancy + conspicuousness + sub-zone earshot:** **BUILT 2026-06-25.** `whereabouts()` now
> returns the `{present, nearby (=visible/sightline), tracked}` split: the **tracked** layer is who the
> player BELIEVES is behind a closed door — acquired ONLY by watching them head in (the origin in the
> player's eyeshot), carrying a 0002 pathway + confidence + an age-derived `stale` flag (never read off
> the secret live position), decaying past a horizon and corrected on direct re-sighting (persisted —
> 0007). The **conspicuousness** read ("you saw A and B slip into the lounge a while ago and haven't
> seen them come out") is derived per-read (never stored), names who/where/how-long and never the
> content, and rides the view + moment prompt; the suspicion diffuses NPC-to-NPC as Vault-free position
> gossip (0038). **Sub-zones** (`ROOM_ZONES`: backyard poolside/patio/workout, lounge two corners) split
> EARSHOT — co-presence witnessing in a big room is zone-scoped (the far end of the yard is out of
> earshot) while eyeshot stays room-wide — plus an opt-in **closed-door muffle** on `rollOverhears`. Every
> new behavior is **opt-in / read-side** (the off-screen society + `juryReach`/gradient spine pass none
> of the new params ⇒ byte-identical; proven by `tests/unit/privacyEyeshot0077.test.ts`'s draw-count
> guard + the green calibration gates). **Gate:** engine (Vitest `sightline0077`/`privacyEyeshot0077` +
> dependency-cruiser + BDD `0077-house-map-privacy-and-eyeshot.feature`, wired into `cucumber.cjs`) and
> front-end (the L26 "Where you are" gadget renders the tracked + conspicuousness layers). **Depends on:** 0049 (house
> presence — the floor plan, `assignRooms`, `rollOverhears`, `whereabouts`), 0002 (events/pathways &
> knowledge vs. suspicion — tracked occupancy is *knowledge with a pathway*), 0038 (gossip diffusion
> — a tracked sighting spreads NPC-to-NPC), 0076 (motivated movement — exits feed the sightings this
> spec turns into knowledge). **Sibling of** 0076 (shares the presence machinery). **Vault Wall
> (mandate #2):** the *content* of a private scene stays sealed; only the *observable fact* of a
> meeting — who was seen going where, who has been alone a while — can become player knowledge,
> through a modeled pathway.

> **Owner direction (2026-06-22, this session):**
> 1. *"Floor plan should match more recent seasons of Big Brother. The bathroom does NOT connect the
>    bedrooms. A few other hangout rooms, especially for early seasons where privacy is hard to find."*
> 2. *"The backyard is big enough for multiple groups to chat outside of earshot."* → **sub-zones
>    split earshot, not eyeshot.**
> 3. *"I don't want to know who's behind a closed door just because I'm in the room next door. If I
>    enter a room, I shouldn't know who's in the bedroom unless others have tracked it before I
>    entered."* → **eyeshot is gated by sightline + tracking, never by raw adjacency.**

## The core idea — three graphs, not one

Today `house.ts` has a **single** adjacency relation doing triple duty: movement, overhearing, AND
the player's "nearby" eyeshot. That conflation is why standing next to a closed bedroom leaks its
occupants. This feature splits the one relation into three layered over the rooms:

1. **Movement graph (doors/passages)** — who can *walk* where. Stay-or-adjacent still binds
   (`occupancyViolations`); 0076's motivated exits land on it.
2. **Sightline graph (eyeshot)** — which rooms/zones can *see into* which. Open-plan rooms see
   across; **closed rooms are opaque from outside.** This is what `whereabouts().nearby` is allowed
   to reveal — and it is *narrower* than adjacency.
3. **Earshot graph** — which rooms/zones can *overhear* which. Roughly adjacency, but **muffled by
   closed doors** and **subdivided by sub-zones** in big rooms. Rare + partial, as today.

A fourth, non-spatial layer carries the privacy payoff:

4. **Tracked occupancy (knowledge, not ambience)** — *who is in a closed room* is **not** read off
   the live map for free. It becomes the player's (or an NPC's) knowledge only through a pathway: a
   witnessed **movement** (you saw them head into the room), a **telling**, or **gossip** — and it
   can go **stale** (you believe they're still in there after they've slipped out). This is the
   Vault/visibility model (0002) applied to position.

## The new floor plan (proposal — tunable at build)

Recent-BB-style: an open-plan public core where privacy is impossible, a private wing reached
through a hallway, and more hangouts so early-game privacy is genuinely scarce.

**Public core — open plan, mutual sightline, no privacy (the early-game crunch):**
`kitchen` · `living-room` · `dining-room` · `backyard` *(large, multi-zone)*

**Circulation — the chokepoint where movement is observed:** `hallway`

**Private wing — closed doors, opaque from outside, earshot muffled:**
`bedroom-a` · `bedroom-b` · `bedroom-c` · `bathroom` · `lounge` · `hoh-room` *(upstairs, the coveted
privacy)* · `storage-room` *(small, off the kitchen — the classic quick-meeting spot)* ·
`diary-room` *(sealed booth — unhearable by data, as today)*

### Movement adjacency (doors)
```
kitchen      ↔ living-room, dining-room, backyard, storage-room
living-room  ↔ kitchen, dining-room, backyard, hallway, hoh-room, diary-room
dining-room  ↔ kitchen, living-room
backyard     ↔ kitchen, living-room
hallway      ↔ living-room, bedroom-a, bedroom-b, bedroom-c, bathroom, lounge
bedroom-a    ↔ hallway
bedroom-b    ↔ hallway
bedroom-c    ↔ hallway
bathroom     ↔ hallway          (NOT the bedrooms — owner note #1)
lounge       ↔ hallway
hoh-room     ↔ living-room       (private, up its own stairs)
storage-room ↔ kitchen
diary-room   ↔ living-room       (sealed)
```

### Sightline (eyeshot) — narrower than adjacency
- **The great room sees itself:** `kitchen ⇄ living-room ⇄ dining-room ⇄ backyard` are mutually
  in sightline (open plan + glass to the yard). Standing in any one, you see everyone in all four.
- **The hallway is visible from the living room** (open mouth of the corridor) — so you can see
  *who is in the hallway* (movement!) — but **no sightline penetrates the closed doors off it:** the
  bedrooms, bathroom, lounge, HOH, storage, and diary reveal **nothing** to someone outside.
- Net: privacy is impossible in the core, available behind any closed door — and *learning* who's
  behind a door requires tracking, not proximity (owner note #3).

### Earshot — adjacency, muffled + zoned
- Open-core rooms overhear each other at the base `overhearProb` (rare, partial — unchanged).
- A **closed door** drops the overhear probability further (a `private` room is hard to hear into).
- **Sub-zones** subdivide earshot *within* a big room (below). Diary stays unhearable by data.

## Sub-zones — multiple groups in one big room (owner note #2)

A large room carries named **zones** (`backyard` → `poolside` / `patio` / `workout`; `lounge` →
two corners). The rule, reusing the eyeshot/earshot split:

- **Eyeshot is room-wide:** everyone in the backyard can *see* everyone else in the backyard —
  including that another group is huddled across the yard (a conspicuousness signal in itself).
- **Earshot is zone-scoped:** a scene in `poolside` is **not** in earshot of a scene in `workout` —
  two private conversations can run in one room. (Adjacent *zones* may carry a small residual
  overhear; far zones none.)

Occupancy assignment seats a houseguest into a room **and** a zone for zoned rooms; `whereabouts`
reports the zone as flavor ("the backyard, over by the pool"). Scoped to the 1–2 genuinely big
rooms so it never sprawls. *(Implementation note: a scene's earshot set becomes "same room AND same
/ adjacent zone, plus sightline-less adjacency as before" — a localized change to `rollOverhears`,
not a new system.)*

## Tracked occupancy — the privacy payoff (owner note #3, the heart of it)

`whereabouts()` changes from *"your room + every adjacent room's occupants"* to:

- **`present`** — your room (+ your zone's neighbors), as today.
- **`visible`** — occupants of **sightline-connected** rooms/zones only (the great room sees across;
  the hallway's occupants are visible from the living room). **Closed rooms never appear here.**
- **`tracked`** — what you *believe* about closed-room occupancy, sourced from **witnessed movement,
  tellings, or gossip**, each carrying a pathway + confidence + possibly **stale** (you saw them go
  in; they may have left). Never the live map — *acquired* knowledge.

So: walk into the living room and you see the kitchen/dining/backyard crowd and who's loitering in
the hall — but the bedrooms are blanks **unless you (or someone who told you) watched people go in.**
"Who's paired off behind a door" becomes information you earn by watching the hallway, not a free read.

### Conspicuousness — "two alone too long implies gameplay"
Once occupancy is *tracked*, a **private room held by exactly two high-tenure houseguests** emits a
Vault-free **read** — *"you saw A and B slip into bedroom-c a while ago and they haven't come out"* —
surfaced to the player and **diffused NPC-to-NPC as suspicion** (0038). The **content stays sealed**
(earshot is rare/partial/muffled); only the **meeting** is observable. Paranoia is the human's to
form (0017) — the engine never says "they're scheming," it says who was seen, where, how long.

## Engine seams

- `src/domain/house.ts` — the new `Room` set + the three relations (`HOUSE_ADJACENCY` for movement;
  new `SIGHTLINE` and the `private`/`zones` room attributes); `roomDisplayName` + `ROOM_ALIASES` +
  `resolveRoom` extended for the new rooms (forgiving names: "great room"/"common area"→living,
  "pool"/"yard"→backyard, the three bedrooms, "have-not"/"games room"→lounge). `WALKABLE_ROOMS`
  auto-feeds the narrator's room menu.
- `src/engine/presence.ts` — `assignRooms` seats a zone for zoned rooms; `rollOverhears` scopes the
  listener set by **earshot** (closed-door muffle + zone) instead of bare adjacency.
- `GameSessionAdapter` — `whereabouts()` returns `{ present, visible, tracked }` (sightline-scoped +
  the tracked-belief layer); a witnessed movement records a tracked-occupancy observation;
  conspicuousness is derived per read (never stored — ADR 0002, like blocs 0043).
- Migration: pre-0077 saves carry old rooms — map `bathroom`'s dropped bedroom edges, seat anyone in
  a removed/renamed room into the nearest valid room on the next tick; new rooms simply become
  available. No save is lost (0007).

## Testability (role-only; HARD rules)

- **Floor plan invariants:** the new graph is symmetric, irreflexive, connected; **bathroom is NOT
  adjacent to any bedroom**; the diary room adjoins only the living room and stays unhearable.
- **Sightline < adjacency:** from a public-core room you see the other core rooms + the hallway;
  from anywhere you see **no** closed room's occupants; `whereabouts().visible` never contains a
  private room's occupants on proximity alone.
- **Tracked, not ambient:** entering a room does **not** populate a private neighbor's occupants;
  only a witnessed movement / telling / gossip yields a `tracked` belief, with a pathway, and it can
  go stale (asserted: belief persists after the subject has moved).
- **Zones split earshot, not eyeshot:** two scenes in different zones of one big room are not in
  mutual earshot; both groups are mutually **visible**.
- **Conspicuousness is Vault-safe:** the read names who/where/how-long, never the scene's content;
  a sentinel sweep finds no sealed content; it requires a tracked sighting (no free metaphysical read).
- **Privacy scarcity:** in the public core, a 1:1 is never private (always visible to co-present
  houseguests) — early game has few private seats, by construction.
- **Determinism + calibration:** seeded; the society's base occupancy stays calibration-neutral
  (the 0076/L21-L24 stream isolation holds — zones/sightline are read-side, not new shared draws).

## Open questions / defaults (resolve at build)

1. **Room count** — three bedrooms + lounge + dining + hallway is the proposal; trim/extend to taste
   once it's walked in the UAT.
2. **Stale-belief horizon** — how long a tracked sighting stays "live" before it decays to "last
   seen" (start: a few ticks; tune from feel).
3. **Conspicuousness threshold** — tenure + pair-size that trips the "holed up together" read
   (start: exactly 2, both several ticks in a private room).
4. **Zone granularity** — backyard (3 zones) + lounge (2); resist zoning small rooms.

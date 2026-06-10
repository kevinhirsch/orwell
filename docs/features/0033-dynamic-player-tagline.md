# 0033 — Dynamic player tagline (snarky, state-aware hero line)

> **Status:** Built (see the [README status index](./README.md#index)). Replace the static homepage hero subtitle ("Yours for the voyage.") with an
> **engine-generated, Vault-free, snarky _Big Brother_ one-liner** that reflects the **current state of
> the player's game** (week, phase, public standing) — a welcome line in the hero placement that ribs
> the player in the house's voice and **changes as the game advances**. Engine owns the generation
> (LLM via `NarrativePort`, 0027); the front-end just renders it. **Vault-free by construction** and
> **anti-sycophantic** (it reflects engine truth, never flatters). **Fails open** to the static line.
> **Executable spec:** [`0033-dynamic-player-tagline.feature`](./0033-dynamic-player-tagline.feature)

## 1. Summary

Today the homepage hero subtitle (`frontend/static/js/models.js:571`, element `#welcome-sub`) is the
inherited workspace string **"Yours for the voyage."** — generic and off-theme for the game. Replace it
with a **dynamic, snarky one-liner** in the _Big Brother_ host/house voice that corresponds to the
player's **current game state**: a needling welcome that knows whether you're HOH, on the block,
floating in the middle, or freshly in the door. The engine **generates** it (it owns the LLM behind
`NarrativePort`, 0027, and the only Vault-free public projection); the front-end **renders** it as the
hero line. One line, hero placement, no spoilers.

## 2. Why the engine generates it (not the front-end)

- **Vault Wall (0001).** The snark must be built from the **public projection only** (week, phase, the
  player's *public* standing) — never hidden votes, targeting, souls, or off-screen scheming. The engine
  is the side that already assembles Vault-free context and runs the sentinel canaries; generating the
  tagline there keeps it **structurally** leak-proof (the line is sentinel-clean), instead of trusting a
  front-end prompt not to ask for secrets.
- **Anti-sycophancy (mandate #3).** The line reflects **engine truth**. If the player is in a weak spot,
  it ribs them about it; it never flatters or softens to please. Ground truth is queried, not invented.
- **One narrator.** The house's voice already lives in the engine (0018 moment framing, 0027 narrator).
  The tagline is one more Vault-free thing the engine voices; the front-end stays a renderer.

## 3. Scope

**In:** a Vault-free engine tool/field `playerTagline` that returns a single snarky line for the
caller's current moment; generation via `NarrativePort` (0027) from the **public** state; **per-moment
caching** (regenerate when week/phase/standing changes, not on every page load); a **pre-game** default
(snarky BB welcome before a game exists); **fail-open** to a static line; the front-end swap at
`#welcome-sub`.

**Out:** any Vault/hidden data in the line (forbidden); the rest of the homepage; the narrator adapter
itself (0027 — reused); long copy (this is **one** line only); per-NPC taglines (player-only here).

## 4. Design

### 4.1 Engine — `playerTagline()` (Vault-free player-channel tool)
- Returns `{ text: string }` — a **single line**, bounded length (e.g. ≤ ~120 chars), newlines stripped.
- **Context in:** the same Vault-free public projection the status panel uses (0020 `gameStatus`):
  `{ week, phase, standing }` where `standing` ∈ public facets only (e.g. `hoh | nominee | veto-holder
  | houseguest | pre-game`). **No** hidden votes/targeting/souls/off-screen content.
  **"Standing" here means PUBLIC ceremony facts only** — the broadcast roles the whole house
  witnessed (HOH / nominee / veto-holder). This does **not** conflict with 0020's "never tell the
  player where they stand": that rule is about the **hidden relationship/threat read** (the
  player's to infer), which the tagline never touches.
- **Generation:** `NarrativePort.narrate` (0027) with a **snarky-host** instruction ("one biting
  _Big Brother_ welcome line for the player at this moment; no spoilers; ≤ one sentence"). A
  **deterministic fake** narrator backs tests (seeded, reproducible).
- **Caching:** memoize per `(user, week, phase, standing)` so it's generated once per moment, not per
  load; invalidated when the moment changes (the game advanced) — ties naturally to the 0031 advance.
- **Fail-open:** on narrator error/timeout (0027 already bounds these), return a **static themed
  fallback** (e.g. "The house is watching.") — never empty, never blocking.
- **Vault-free + sentinel-clean:** registry entry `readsVault: false`; extend the 0001 canary so a
  fully-populated Vault never bleeds into the tagline; dependency-cruiser stays green.

### 4.2 Front-end — render it as the hero line
- Replace the static assignment at `models.js:571` (`#welcome-sub` ← "Yours for the voyage.") with the
  engine tagline. Fetch it Vault-free (fold into the existing `GET /api/orwell/state` response, or a
  tiny `GET /api/orwell/tagline`), set `#welcome-sub.textContent`.
- **Fail-open in the UI too:** if the engine is down or the field is absent, keep the static
  "Yours for the voyage." — the homepage must never block on the tagline (same posture as onboarding).
- Refresh the line when the game state changes (e.g. on the SSE/session-sync tick that already drives
  the game), so a returning player sees a line that matches where the game now stands.

## 5. Contracts (stack-agnostic)

```
Engine (player channel, readsVault: false):
    playerTagline(): { text: string }     // one line, bounded, Vault-free, snarky, anti-sycophantic
       context  = Vault-free { week, phase, standing }   // public facets only (0020)
       generate = NarrativePort.narrate (0027); deterministic fake in tests
       cache     by (user, week, phase, standing); fail-open to a static themed line
Front-end:
    GET /api/orwell/state (add `tagline`) OR GET /api/orwell/tagline -> { text }
    render at #welcome-sub; fall back to the static line if absent
```

## 6. Definition of Done

- [ ] **State-aware:** the line reflects the player's current moment — a nominee's line references being
      on the block; an HOH's line reads differently; a pre-game line welcomes a newcomer.
- [ ] **One line, hero placement:** a single bounded line (no newlines), rendered at `#welcome-sub` in
      place of "Yours for the voyage."
- [ ] **Vault-free:** sentinel-clean under a fully-populated Vault (extend the 0001 canary); no hidden
      votes/targeting/souls/off-screen content; `readsVault: false`; `npm run test:arch` green.
- [ ] **Anti-sycophantic:** when the player's public standing is weak, the line does **not** flatter —
      it reflects the engine's truth (asserted with a seeded fake narrator over a weak-standing state).
- [ ] **Changes as the game advances:** a different week/phase/standing yields a different line; cached
      within a moment (not regenerated every page load).
- [ ] **Fails open:** narrator/engine unavailable ⇒ a static themed line, never blank, never blocking
      (engine side and UI side).
- [ ] Name-agnostic tests (roles only — player/HOH/nominee); engine `npm test` green; front-end
      `pytest` green.

## 7. Dependencies & traceability

Reuses **0027** (`NarrativePort` — the generator) and **0020** (`gameStatus` public projection — the
Vault-free context), under **0001** (sentinel-clean) and **0018** (the house voice). Caching ties to the
**0031** advance (regenerate when the moment changes). Part of the **0032** game build (the homepage is
the game's front door). Front-end-render lands in `frontend/static/js/models.js` (the `#welcome-sub`
assignment). Engine generation is a Claude Code item; the front-end swap is an OpenHands item.

# 0036 — Live social surface: NPC-initiated approaches + the Diary Room

> **Status:** Draft — **functional gap.** Two built social capabilities are **not reachable in the live
> game** because no player tool exposes them: (1) **NPC-initiated approaches** — `npcInitiatedApproaches()`
> (0012) exists but is never called live, so conversations are **one-directional** (player→NPC only),
> violating the **bidirectional-scenes** mandate; and (2) the **Diary Room** — 0013's logic
> (`recordDiaryRoom`, `NO_NPC_PATHWAY`) exists but is **not a player tool**, so the player can't use their
> core OOC channel. This feature exposes both as Vault-free live tools.
> **Executable spec:** [`0036-live-social-surface-approaches-and-diary-room.feature`](./0036-live-social-surface-approaches-and-diary-room.feature)

## 1. Summary

The audit found the live social surface is half-built: the player can `recordInteraction` (player→NPC,
witnessed, folded into relationships — 0023), but:
- **NPCs never approach the player.** `src/engine/conversation.ts` `npcInitiatedApproaches()` is pure and
  tested but **never invoked on the live path** and **not in the tool registry** — so the engine can't
  tell the agent "houseguest X wants to talk to you." The mandate is explicit: *NPCs hold goals that make
  them approach the player, **and** the player can initiate — neither side initiates everything.*
- **The Diary Room is inaccessible.** `KnowledgeService.recordDiaryRoom()` + the `NO_NPC_PATHWAY` wall
  (0013) are built and correct, but **no `PLAYER_TOOLS` entry** exposes them — the player has no DR in the
  live game.

Both are **tool-exposure + live-wiring** gaps, not missing logic.

## 2. Scope

**In:** two Vault-free player-channel tools, wired into `GameSessionAdapter`/`EngineCommands`, added to
`PLAYER_TOOLS` + the McpServer allowlist + the lever manifest (ties **B21**):
1. **`socialInitiatives()`** (NPC approaches) — returns the houseguests who, by their soul motivation,
   want to approach the player **now**, with a Vault-free framing of *why* (their public-facing pretext),
   **no hidden numbers**. Sourced from `npcInitiatedApproaches()`; bidirectional with `recordInteraction`.
2. **`diaryRoom(entry)`** — records a player Diary-Room entry as **OOC player knowledge** tagged
   `NO_NPC_PATHWAY` (via `recordDiaryRoom`). It **never** reaches any NPC (`deriveNpcKnowledge` already
   excludes it); it **may** inform the engine's read of player strategy, **never** NPC behavior. Optionally
   surface the **producer-prompted** DR (`producerPrompt`) at dramatic beats.

**Out:** the conversation/DR **logic** (built — 0012/0013; reused); scene navigation / in-house locations
(separate, lower priority); off-screen life (0035); NPC **confessionals** (Vault-only, must stay hidden).

## 3. Design & boundary

- **`socialInitiatives`** reads the live relationship/soul state (the same model 0023 folds into) to rank
  who approaches and surfaces a **public-facing** reason only — never trust/threat numbers or hidden
  motives. `readsVault: false`; **sentinel-clean** (extend the 0001 canary). The agent uses it to open a
  scene "houseguest X pulls you aside"; the player may still initiate via `recordInteraction`.
- **`diaryRoom`** writes through `recordDiaryRoom` (pathway = diary-room, `NO_NPC_PATHWAY`). **The wall is
  the crux:** assert on the **live tool** that **no NPC ever learns DR content** (extend 0013's exclusion
  test to the live path) and that the **public/private gap** holds (NPCs act on public speech, never the
  DR). Player confessionals are player knowledge; **NPC** confessionals remain **Vault-only** and never
  surface here.
- Both tools are added to the **base prompt's lever manifest** (B21) so the agent knows to pull them.

## 4. Contracts (stack-agnostic)

```
socialInitiatives(): { houseguest: name, pretext: string }[]   // readsVault:false, sentinel-clean
    source = npcInitiatedApproaches(live relationship/soul state); public framing only, no numbers
diaryRoom(entry: string): { recorded: true }                   // readsVault:false, sentinel-clean
    = knowledge.recordDiaryRoom(player, entry, NO_NPC_PATHWAY)  // OOC; never reaches any NPC
```

## 5. Definition of Done

- [ ] **Bidirectional scenes:** in the live game, `socialInitiatives` returns NPCs who want to approach the
      player (driven by their soul motivation), with a Vault-free pretext — so scenes start from **either**
      side, not only player→NPC.
- [ ] **Diary Room usable + walled:** the player can record a DR entry on the live path; a test proves
      **no NPC** ever learns DR content (`deriveNpcKnowledge` excludes it) and NPCs act only on **public**
      speech — extend 0013's wall test to the **live tool**.
- [ ] **Vault-free:** both tools are `readsVault: false` and **sentinel-clean** under a populated Vault
      (extend the 0001 canary); `npm run test:arch` green.
- [ ] **Manifest:** both appear in the base prompt's lever manifest (coordinated with **B21**).
- [ ] Name-agnostic tests (roles only — player/NPC); `npm test` green. *(A small front-end follow-up
      surfaces "X wants to talk" and a DR entry point — queued separately; the agent can drive both via the
      tools without UI.)*

## 6. Dependencies & traceability

Exposes **0012** (`npcInitiatedApproaches` — bidirectional scenes) and **0013** (`recordDiaryRoom`,
`NO_NPC_PATHWAY`) into the live game, reading the live relationship state (**0023**), under **0002**
(knowledge pathways), **0001** (Vault Wall), and **0021** (isolation). Pairs with **B21** (the manifest
must name the new levers). Front-end consumption (approach prompts + a DR affordance) is a small
follow-up on the **0032** game build.

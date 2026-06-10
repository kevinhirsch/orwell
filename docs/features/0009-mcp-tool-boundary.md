# 0009 — MCP tool boundary (the engine's outward tool API)

> **Status:** Built (see the [README status index](./README.md#index)). **Milestone:** M5 (integration) — not one of the eight invariants, but the
> **MVP seam** between the TypeScript engine and the Orwell front-end/agent (`frontend/`).
> **Executable spec:** [`0009-mcp-tool-boundary.feature`](./0009-mcp-tool-boundary.feature)

## 1. Summary

A **permissioned MCP server** exposes the game to the narrative LLM / agent / front-end through
a **fixed allowlist of tools**. Read/narrate tools return only the **visible projection**;
action tools accept a request and return only a **Vault-free result**. The MCP adapter is
outward-facing and **structurally incapable of reading the Vault or the vector index** — it
extends the feature-0001 boundary. It builds directly on what already exists in `src/`:
`surfaces/tools/registry.ts` (the allowlist), `services/VisibleStateService.ts` (the only
state source), `surfaces/player/PlayerSurface.ts`, `surfaces/admin/AdminPort.ts`, and
`composition/outwardRoot.ts`.

## 2. Why this matters

This is the **integration linchpin** for the MVP. Orwell's **agent** (Python MCP client,
`frontend/`) connects to this server as a tool backend; the LLM narrates *Big Brother* by
calling these tools. The Vault Wall holds because everything the agent receives is
visible-projection data — **the model cannot leak what it never receives**.

## 3. Topology (this also defines the deploy target)

Two tiers, one sandbox per game:

```
 Orwell (Python: UI + LLM + agent)  ──MCP──►  Orwell engine (TS: MCP server)
   frontend/                                      src/  (engine root wires the Vault;
   MCP client / tool caller                             the MCP server does NOT)
```

- Transport: **MCP over stdio** for a co-located agent, or **HTTP/SSE** for a networked
  client. Either way the server mounts only `toolsFor(channel)`.
- Each running game is its **own session/sandbox** (own state namespace).
- **Deployment:** a single container running both tiers (Node engine + Python front-end)
  wired over local MCP is the target for the one-liner Proxmox deploy/update scripts. Keep
  the two processes independently startable so the container is easy to run and update.

## 4. Tool surface (the allowlist)

**Player channel — read/narrate** (pure outward; sourced from the visible projection — already
in `registry.ts` / `PlayerSurface`):

| Tool | Returns |
|---|---|
| `getVisibleStateFor(entity)` | visible events the entity witnessed + their `KnowledgeState` |
| `renderScene(mode)` | narration from a **Vault-free** `NarrationContext` (via `NarrativePort`) |
| `askProducers(question)` | an answer that never confirms/denies Vault content |
| `endOfSessionSummary()` | only "updated save(s) available" |

**Player channel — actions** (request in, **Vault-free result out**; the engine side may touch
the core/Vault, only a sanitized result crosses the membrane — *new*):

| Tool | Effect / returns |
|---|---|
| `recordInteraction(initiator, witnessSet, content)` | records a (player-witnessed) event; **initiator/witnesses must be LIVING houseguests** and per-call folds are capped (B39); returns its id/ack |
| `resolveCompetition(type, participants, intents)` *(as built: `runCompetition`)* | the **engine-decided** outcome only — no stats, rankings, or Vault reasoning |
| `surfaceInformationTo(entity, fact, pathway)` | moves a hidden fact into knowledge via an **anchored** pathway (B39/A4); an unanchored one is downgraded to a suspicion; returns `{ ok, surfaced }` |

**Admin / God-Mode channel** (separate registry; non-Vault only):
`inspectNonVaultState(query)`, `overrideMechanic(...)`.

Every descriptor carries `readsVault: false` at the boundary.

## 5. The membrane rule

There are **two kinds of tool**, and the boundary is the membrane between them:

- **Read/narrate tools** are implemented entirely from the visible projection and live on the
  **outward** side (no Vault, ever).
- **Action tools** are *requests*: the **engine** performs them (the engine root may read the
  Vault/core to simulate), and only a **Vault-free result** is returned. So `resolveCompetition`
  (as built: `runCompetition`) can weigh hidden stats internally yet return just the outcome — "the engine reads the Vault to
  decide; no outward tool returns Vault data."

To keep the outward MCP adapter Vault-free, action tools reach the engine **only through
Vault-free command ports** (interfaces whose argument and return types contain no Vault types).
The engine root implements them; the MCP server depends on the *interface*, never on the engine
root or `VaultStore`.

## 6. Structural guarantees (extends 0001)

- **Fixed allowlist per channel** (`PLAYER_TOOLS` / `ADMIN_TOOLS`); the `readsVault: false`
  **literal type** already makes registering a Vault-reading tool a **compile error**.
- **No Vault dependency:** the MCP-server module (e.g. `src/adapters/mcp/…`) imports neither
  `VaultStore`/`VectorIndex` nor `engineRoot` — verified by **dependency-cruiser** (extend the
  existing `no-vault-on-outward` rule's `OUTWARD` glob to cover it).
- **Sentinel-clean:** with a fully populated Vault of unique sentinels, **no tool output**
  (read or action) contains a sentinel — extend the existing vault-sentinel property test to
  call every tool.
- **Channel isolation:** a player session serves only `PLAYER_TOOLS`; an admin session only
  `ADMIN_TOOLS`; neither can obtain the other's tools or any Vault reader.

## 7. Contracts (stack-agnostic, grounded in `src/`)

```
# already built
toolsFor(channel) -> readonly ToolDescriptor[]          # registry allowlist (readsVault: false literal)
VisibleStateService.getVisibleStateFor(entity) -> VisibleState
buildOutwardChannels(deps) -> { player, admin, summary } # outward root; no Vault handle

# new for this feature
EngineCommands (Vault-free port the engine implements; the MCP server depends on THIS, not the engine root):
    recordInteraction(req) -> { eventId }
    resolveCompetition(req) -> Result                    # outcome only (as built: runCompetition)
    surfaceInformationTo(req) -> { ok }
McpServer (outward adapter):
    serve(channel, transport)                            # mounts toolsFor(channel) over stdio|http
```

## 8. Required refactor — RESOLVED (stale flag removed)

The sync-`narrate` flag that lived here is **stale**: the async `NarrativePort` landed with
feature 0027 (`LlmNarrativePort`, streaming); the Vault-free `NarrationContext` was unchanged.
No implementer action remains.

## 9. Test strategy

- **Per-tool contract test:** each tool's result matches its shape and is Vault-free.
- **Sentinel property** over *all* tool outputs across seeds (extends `vault-sentinel.property`).
- **Architecture test:** no MCP-server module depends on the Vault / vector index / engine root
  (extends `vault-boundary.test`).
- **Capability test:** the served tool set equals the channel allowlist — no more, no Vault tool.
- **Integration smoke:** an external MCP client drives a minimal loop (visible state → record an
  interaction → resolve a competition → surface a fact → summary) and never receives Vault data.

## 10. Definition of Done

- [ ] The MCP server mounts exactly the channel allowlist; player and admin channels isolated.
- [ ] Every tool proven **Vault-free** (sentinel + architecture + capability tests green).
- [ ] Action tools reach the engine only via Vault-free command ports; outward adapter has no
      Vault/engine-root dependency.
- [ ] `renderScene` works with an async `NarrativePort`; `NarrationContext` still Vault-free.
- [ ] An external MCP client can drive a minimal game loop end-to-end.

## 11. Dependencies

#1 (Vault Wall — the registry, `VisibleStateService`, the boundary it extends); the domain core
(`resolveCompetition`), `KnowledgeService` (`surfaceInformationTo`), `EventStore`
(`recordInteraction`). **Feeds** the Orwell agent integration (`frontend/INTEGRATION.md`), the
MVP, and the Proxmox deploy/update scripts (topology).

## 12. Traceability

`docs/bb-sim-spec.md` §4 (MCP server as the permissioned tool interface);
`CLAUDE_CODE_INSTRUCTIONS.md` §2 (adapters: MCP tools), §12 M5; `CLAUDE.md` adapters + the
permission boundary; existing `src/surfaces/tools/registry.ts`, `src/services/VisibleStateService.ts`.

# 0020 — Split-authority logging (engine owns the closed-set beat, FE owns the open-set transcript log)

> **Status:** Principle **Accepted** (owner directive, 2026-07-21); formalizes the architectural
> split between closed-set state authority and open-set narration/render ownership.
> **Source:** the reconciliation-forensics "accurate-from-the-start" analysis (#35) + design
> discussion; extracted from #1725 (engine reports accurately) and #1728 (FE authoritative
> render log). **Refines / complements:** ADR 0003 (conversation is the game; narration never
> owns state), ADR 0005 (closed/open split), ADR 0008/0012 (multi-window canonical-session
> binding), ADR 0015 (collapse duplicated live-vs-reload render paths), and feature 0065
> (closed-set sync spine + `beatSeq`).

## Context

The false-instinct architecture fix: when FE dedup/ordering debris emerges (empty rows, duplicate
regenerations, ordering races), the obvious simplification is "give the engine one authoritative
message log." Two problems block this:

1. **Vault Wall (mandate #2).** The engine hands *facts to voice*; it must never *own narration*
   (ADR 0003). Narration happens in the FE via `getMomentPrompt`; the live narrator is
   `EchoNarrativePort` (engine-side stub). An engine-owned chat log would breach the wall — it
   would import the FE's narrative/prose layer into the engine's closed-set domain.

2. **Duplicate domain.** The engine already records *interactions* (witness sets, events,
   consequences) in the `EventStore` — the authoritative closed-set record. A separate
   "authoritative message log" would be a second, redundant transcript with all the seaming hazard.

3. **Narration is FE-owned by construction.** The FE holds the **canonical-session mirror stream**
   (`GET /api/chat/events/{id}`, ADR 0008/0012) — the server-ordered, id-keyed, supersede-by-id
   render log. This is exactly ADR 0015's "collapse the duplicated live-vs-reload render paths" —
   one FE source, never duplicated across sessions.

## Decision

**Split authority by openness (ADR 0005); no single blanket "authoritative log for everything."**

### Decision 1 — The authoritative transcript/render log lives at the FE tier, never the engine

The canonical, server-`seq`-ordered, id-keyed render log (rows that appear in the player's chat
stream) is **FE-owned by construction**:

- `renderLog` is the FE's in-memory cache (`frontend/static/js/chat.js`);
- `/api/chat/events/{sessionId}` is the server-persisted, canonical-session mirror stream
  (ADR 0008/0012);
- dedup, ordering, and supersede-by-id happen at the FE render layer, never at the engine.

The engine has **no chat-row concept** — it voices facts, never prose. `EchoNarrativePort` is a
stub; real narration happens in the FE when `getMomentPrompt` is called (the model completes over
game state facts, not the engine's "log").

### Decision 2 — Closed set (board/beat) and open set (transcript) never cross

**Closed set (board/beat authority — engine owns):**
- The engine's monotonic `beatSeq` (feature 0065) is the server-ordered, linearizable authority
  on game state mutations.
- It doesn't need a new log — it needs to *report accurately* (off-screen-tick gap, #1725).
- `expectedBeatSeq` (CAS) and `idempotencyKey` (at-most-once) ensure atomicity.
- No prose; only state sequence.

**Open set (transcript/narration — FE owns):**
- The FE id-keyed render log (`/api/chat/events`) governs order, dedup, and supersede-by-id.
- It carries prose, streaming tokens, thinking, user messages — everything the player sees.
- No `beatSeq`, no board truth; only narrative flow.

**They never cross:**
- `beatSeq` carries no prose; the render log carries no board state.
- A single blanket log for both would breach the closed/open split and re-entangle narration
  with deterministic state (breaking the `expressiveNonCollapse` guarantee, ADR 0005).

## Consequences

- The **render log stays at the FE**, sourced from `/api/chat/events` (the canonical mirror
  stream) — the source of truth for what the player saw and in what order.
- The **engine's `beatSeq`** is the source of truth for *game state*, never for *prose*.
- The two domains have **structural separation**: no engine module imports a chat-row type; the
  FE render log carries no `beatSeq`/board concept.
- Dedup, ordering, and supersede-by-id are FE concerns, handled by id-keying and wall-clock
  order at the render layer.
- The FE can safely regenerate its render log from `/api/chat/events` on page reload without
  re-running narration (ADR 0015) because the render log is persisted, not recomputed.

## Testability

**Structural where possible:**

- **No engine chat-row concept.** Lint / dependency-cruiser gate (mirrors the Vault-Wall gate in
  spirit): no module in `src/` or `src/adapters/engine/` or `src/ports/` imports or references
  a chat-row/message-log type (room for `Vault` or `Vector`, but not `ChatRow` or `RenderLog`).
- **FE render log sourced from `/api/chat/events`.** A reload must restore the render log
  **exactly** (id-ordered) from the server stream — test a seeded game, stream N beats, reload,
  assert the render log is byte-identical.
- **`beatSeq` never in prose.** A generated moment/beat must never include or reference the
  `beatSeq` value in its prose (a strict diegetic boundary).
- **ID-keying idempotency.** Multiple calls to `recordInteraction` with the same `id` must
  supersede (the FE render log updates the same row, never duplicates).

## Interaction with ADRs 0003/0005/0008/0012/0015 and feature 0065

- **ADR 0003 (conversation is the game):** the conversation is the *player's window* into the
  game; the game state lives in the closed set; narration is the FE's interpretation of facts.
  0020 formalizes this boundary.
- **ADR 0005 (split authority by openness):** 0020 applies 0005 to the logging layer: closed-set
  authority (board/beat) stays at the engine; open-set narrative log stays at the FE.
- **ADR 0008/0012 (multi-window canonical-session binding):** the canonical-session mirror stream
  (`/api/chat/events/{sessionId}`) is the persisted FE render log for two-window mirror parity;
  0020 formalizes it as the *only* authoritative FE render source.
- **ADR 0015 (collapse duplicated live-vs-reload render paths):** 0020 enforces this: one FE
  render log, sourced from `/api/chat/events`, used for both live streaming and page reload.
- **Feature 0065 (closed-set sync spine + `beatSeq`):** `beatSeq` is the closed-set mutation
  counter, never narration. It carries no prose; the render log carries no `beatSeq`.
  Together they form the permissioned, split-authority spine (0020 + 0065).

---

*Provenance: multi-audit backlog 2026-07-20/21 — formalization of the two logging decisions
passed on during the FE reconciliation analysis, per owner request (#1725/#1728).*

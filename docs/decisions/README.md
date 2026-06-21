# Decision records

Architecture and design decisions for `orwell`, in lightweight ADR form. Each record captures
the **context**, the **decision**, and the **rationale**, so the "why" survives. Records are
numbered and append-only; a later record may supersede an earlier one (note it in both).

| # | Decision | Status |
|---|---|---|
| 0001 | [Competition stats, the Character/Soul split, and veto "Houseguest's Choice"](./0001-competition-stats-souls-and-veto-choice.md) | Accepted |
| 0002 | [Relationship model (organic, calculated — replaces binary ALLIES/BEST_FRIEND)](./0002-relationship-model.md) | Accepted (math Proposed) |
| 0003 | [The conversation is the game (minimal-context, model-trusting design)](./0003-conversation-is-the-game.md) | Accepted |
| 0004 | [Embedding provider — fastembed local ONNX for runtime soul recall](./0004-embedding-provider.md) | Accepted — **adapter not yet built** (runtime currently uses the deterministic fake; amended 2026-06-10, E86) |
| 0005 | [Split authority by openness (the engine records the open set, never normalizes it)](./0005-split-authority-by-openness.md) | Accepted — **BUILT** (generative-consequence path + expressive-non-collapse gate, PR #355); refines 0002 + 0003 |
| 0006 | [In-game time, sleep, and the nightly presence economy](./0006-in-game-time-sleep-and-the-presence-economy.md) | Proposed (2026-06-20); refines the 2026-06-10 pacing ruling; builds on 0049 + 0041 |
| 0007 | [Public internet exposure of the player tier (hiorwell.com) over HTTPS](./0007-public-internet-exposure.md) | Proposed (2026-06-20); hardening floor accepted, exposure-layer pick pending owner; → feature 0067 |
| 0008 | [Cross-tab/-device chat conversation consistency (an authoritative ordered message log)](./0008-chat-conversation-consistency.md) | Proposed (2026-06-21); root-caused in audit S3-RACE — FE chat replication diverges under concurrent writes (engine solid; reload reconciles); fix = per-session `seq` + render/reconcile-by-id; awaiting implementation authorization |
| 0009 | [Location & movement — one source of truth, recorded movement, narration grounding](./0009-location-movement-source-of-truth.md) | Proposed (2026-06-21); investigation-driven (chat↔gadget location desync). Data SoT is fine; fix = record NPC movement (not just the player), enforce location narration (a barrier like the comp-round clamp), one per-turn occupancy snapshot for chat+gadget; builds on 0049/0006, bounded by 0005 |

**Status legend:** `Proposed` (drafted, awaiting confirmation) · `Accepted` · `Superseded`.

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

**Status legend:** `Proposed` (drafted, awaiting confirmation) · `Accepted` · `Superseded`.

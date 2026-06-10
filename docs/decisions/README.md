# Decision records

Architecture and design decisions for `orwell`, in lightweight ADR form. Each record captures
the **context**, the **decision**, and the **rationale**, so the "why" survives. Records are
numbered and append-only; a later record may supersede an earlier one (note it in both).

| # | Decision | Status |
|---|---|---|
| 0001 | [Competition stats, the Character/Soul split, and veto "Houseguest's Choice"](./0001-competition-stats-souls-and-veto-choice.md) | Accepted |
| 0002 | [Relationship model (organic, calculated — replaces binary ALLIES/BEST_FRIEND)](./0002-relationship-model.md) | Accepted (math Proposed) |
| 0003 | [The conversation is the game (minimal-context, model-trusting design)](./0003-conversation-is-the-game.md) | Accepted |
| 0004 | [Embedding provider — fastembed local ONNX for runtime soul recall](./0004-embedding-provider.md) | Accepted |

**Status legend:** `Proposed` (drafted, awaiting confirmation) · `Accepted` · `Superseded`.

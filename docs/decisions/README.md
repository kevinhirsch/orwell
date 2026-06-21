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
| 0007 | [Public internet exposure of the player tier (hiorwell.com) over HTTPS](./0007-public-internet-exposure.md) | Accepted (2026-06-20); hardening floor **built** (feature 0067); exposure layer = **Cloudflare Tunnel + Access** |
| 0008 | [Cross-tab/-device chat conversation consistency (an authoritative ordered message log)](./0008-chat-conversation-consistency.md) | **Accepted — BUILT** (2026-06-21); root-caused in audit S3-RACE; FE-only fix = per-session `seq` + render/reconcile-by-id + `{id,seq}` dedup + completion broadcast; gates `frontend/tests/test_adr0008_{chat_seq,reconcile_contract}.py` |
| 0009 | [Location & movement — one source of truth, recorded movement, narration grounding](./0009-location-movement-source-of-truth.md) | Proposed — **direction ratified 2026-06-21** (model narrates the open texture, engine records it; **hard-fold** enforcement under a **no-visible-historic-conflicts** constraint — impossible claims caught pre-emission, never corrected after). Investigation-driven (chat↔gadget location desync); data SoT is fine; fix = record NPC movement (not just the player) + a location barrier + one per-turn occupancy snapshot; builds on 0049/0006, bounded by 0005. Mechanism to be built BDD/TDD-first |
| 0010 | [Concurrent engine-drive — beat-aware guardrails (no client turn-lock)](./0010-concurrent-engine-drive-beat-aware-guardrails.md) | **Accepted — BUILT** (2026-06-21; pending pre-launch `/diff` review); root-caused in audit S3-LOOP (the two-concurrent-session "20-step loop"). The agent loop's stall-nudge was beat-BLIND — it mis-read a *peer's* serialized advance as the model under-calling, spinning the loop. FE-only fix = a framing beat-key baseline + `_peer_advanced_since_framing` suppression (single-tab byte-identical), the A-S5 structured-409 reconcile, and a per-round render bound (silent context-read beats + a rail cap). Respects 0064's Messenger ruling (no turn-lock). Gate `frontend/tests/test_adr0010_concurrent_loop.py` |

**Status legend:** `Proposed` (drafted, awaiting confirmation) · `Accepted` · `Superseded`.

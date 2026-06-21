# 2026-06-21 — Live-LLM verification results (DeepSeek V4 Pro via OpenRouter)

Run against a real model wired into the FE (`deepseek/deepseek-v4-pro`, OpenRouter), engine + FE
booted locally, key supplied via env only (never tracked). Two questions the automated gates
**cannot** answer (every gate stubs the LLM) were settled empirically.

## 1. Reasoning "off" — genuine disable, and responses change (token economy, ADR 0010)

Direct calls to `deepseek/deepseek-v4-pro`, identical prompt, varying only the `reasoning` field:

| Request | `reasoning_tokens` | completion | latency |
|---|---|---|---|
| `reasoning:{"enabled":false}` (the new "off") | **0** | 15 | **0.8s** |
| `reasoning:{"effort":"medium"}` (narration) | 76 | 88 | 2.0s |
| field **omitted** (the OLD "off") | **60** | 72 | 1.7s |

**Proven:**
- The genuine-off (`{"enabled":false}`) drops reasoning to **0 tokens** and the response changes
  (≈2.5× faster, no reasoning burn) — so `utility-extraction` now actually saves the wasted reasoning.
- **Omitting the field ≠ off**: it still reasoned **60 tokens** (the provider default is ON). The
  prior `token_policy` behavior ("off" → omit the field) would have changed **nothing**. This is why
  the live test was mandatory, and it validates `llm_core._apply_reasoning_budget` sending
  `reasoning:{"enabled":false}` on the explicit-off branch.

Also confirmed live via the I/O trace: narration calls carry `reasoning_tokens` ≈ 1700–2000 (effort
medium, ON as designed); the trace now records `finishReason` (G1) and the full reasoning text
losslessly (105 KB across 4 records persisted in full — the old 512 KB per-record drop is gone).

## 2. Two-window "Messenger mirror" — still broken; §3.1 split-brain is the live blocker

`mirror_filmstrip.mjs`, two windows, A sends one turn:

```
CP0 baseline: engineMatch=true transcriptIdentical=true (both empty)
CP1: A streams the turn (reply=104ch, reasoning=112ch, 31 SSE events); A settles.
     B settled: TIMEOUT — B never mirrors A.
     transcript identical: FALSE — A=2 msgs, B=12 msgs.
     classification: PERSISTENT (data-layer) — diverges even after B reload.
```

B holds **12** messages (its **own** casting flow) vs A's **2** — the two windows are on **different
games**, not one shared game. This is the §1.4 / §3.1 **split-brain**: a fresh window does not
converge on the canonical game session, so it starts its own run. The §3.2 dead-`message-added`
broadcast fix (shipped) is necessary but **cannot** mirror windows that are on different games.

**Implication for the fix order:** the critical path is **canonical-session convergence** — §3.1
(server keys the run/publish/subscribe + persistence on the canonical game session) **plus** the
`sessions.js` resolution-ladder canonical step (§3.3/§1.4, so a fresh mid-game window force-selects
the bound game). The §3.3 renderer unification (byte-identical render) is the *second* layer, only
meaningful once both windows are provably on one game. Re-run `mirror_filmstrip.mjs` +
`mirror_smoke50.mjs` against the live model after §3.1 to confirm lockstep.

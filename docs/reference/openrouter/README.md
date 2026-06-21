# OpenRouter / DeepSeek API reference catalog

**Provenance.** Distilled from the OpenRouter API reference docs supplied by the product owner on
**2026-06-21**, captured here as a vendored, version-stable reference so the FE LLM-boundary code
(`frontend/src/llm_core.py`, `frontend/src/agent_loop.py`, `frontend/src/token_policy.py`) has a
fixed conformance target. These are **distillations** — load-bearing facts, parameter tables, wire
formats, and error codes — not verbatim copies of the marketing prose. The canonical source URL is
at the top of each file; consult it for the authoritative current text.

The live narration model is **`deepseek/deepseek-v4-pro`** via OpenRouter
`POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible chat/completions shape).

| File | Source | What it covers |
|---|---|---|
| [`parameters.md`](./parameters.md) | `…/api/reference/parameters` | Every request sampling/control parameter — temperature, max_tokens, **reasoning** map, **reasoning_effort** enum, response_format/JSON, tools/tool_choice, stop, seed, usage accounting, … |
| [`errors-and-debugging.md`](./errors-and-debugging.md) | `…/api/reference/errors` | Error response shape, HTTP status codes, `Retry-After`, moderation/guardrail/provider errors, **mid-stream SSE errors** + the typed `error_type` table, **`debug.echo_upstream_body`**, `X-Generation-Id`. |
| [`streaming.md`](./streaming.md) | `…/api/reference/streaming` | SSE wire format (`data:` / `[DONE]`), the `: OPENROUTER PROCESSING` keep-alive comment, usage in the final chunk, stream cancellation, pre- vs mid-stream errors. |
| [`embeddings.md`](./embeddings.md) | `…/api/reference/embeddings` | `POST /embeddings`, batch + image input, `/embeddings/models`. **Orwell uses local fastembed ONNX (ADR 0004) — OpenRouter embeddings are intentionally N/A.** |
| [`provider-routing.md`](./provider-routing.md) | `…/guides/routing/provider-selection` | The `provider` object — `order`/`sort`/`only`/`ignore`/`allow_fallbacks`/`require_parameters`/`data_collection`/`zdr`/`max_price`/`quantizations`, the price-based load-balancer, `:nitro`/`:floor`, endpoint targeting. Ties to slice-C provider pinning. |
| [`deepseek-v4-pro-reasoning.md`](./deepseek-v4-pro-reasoning.md) | DeepSeek V4 Pro model card + reasoning guide | The `reasoning` parameter, the **`reasoning_details`** array, the **cross-turn preservation** requirement, streaming reasoning tokens, the `/responses` + `/messages` alternate shapes. |

## Conformance audits driven by this catalog

- [`../../audits/2026-06-21-openrouter-conformance-audit.md`](../../audits/2026-06-21-openrouter-conformance-audit.md) — the four reference docs vs. the FE LLM boundary (params / errors / streaming / embeddings).
- [`../../audits/2026-06-21-deepseek-v4-reasoning-continuation-audit.md`](../../audits/2026-06-21-deepseek-v4-reasoning-continuation-audit.md) — the DeepSeek V4 Pro `reasoning_details` cross-turn-preservation question (vs. the agent loop's deliberate strip-old-reasoning behavior).

## The two facts that most change our code

1. **`reasoning` is a map that controls *whether reasoning is enabled*, not only its effort.** For a
   reasoning model, **omitting** the field leaves the provider DEFAULT (often ON) — so "off" by
   omission is **not** a cost floor. To genuinely disable, send `reasoning: {"enabled": false}`
   (or `reasoning_effort: "none"`). This is why `token_policy` "off" now resolves to an active
   disable in `llm_core._apply_reasoning_budget` (ADR 0010).
2. **`debug: {echo_upstream_body: true}`** (streaming only) returns the exact body OpenRouter
   forwarded upstream as the first chunk — the canonical way to *verify* a request transformation
   (e.g. that reasoning is actually off) without guessing.

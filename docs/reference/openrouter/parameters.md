# OpenRouter — API Parameters

> Source: <https://openrouter.ai/docs/api/reference/parameters> — distilled 2026-06-21.
> Sampling/control parameters for `POST /api/v1/chat/completions`. OpenRouter forwards
> provider-specific params through; absent params fall back to the defaults below.

## Sampling

| Key | Type | Default | Notes |
|---|---|---|---|
| `temperature` | float 0.0–2.0 | 1.0 | Variety. 0 ⇒ deterministic-ish for a given input. |
| `top_p` | float 0.0–1.0 | 1.0 | Nucleus sampling. |
| `top_k` | int ≥0 | 0 (off) | Limit token set per step. |
| `frequency_penalty` | float -2.0–2.0 | 0.0 | Scales with occurrence count. |
| `presence_penalty` | float -2.0–2.0 | 0.0 | Does not scale with count. |
| `repetition_penalty` | float 0.0–2.0 | 1.0 | Scales by original token probability. |
| `min_p` | float 0.0–1.0 | 0.0 | Min probability relative to the top token. |
| `top_a` | float 0.0–1.0 | 0.0 | Dynamic Top-P-like filter. |
| `seed` | int | — | Deterministic sampling where the provider supports it (not guaranteed). |

## Length

| Key | Type | Notes |
|---|---|---|
| `max_tokens` | int ≥1 | Upper bound on generated tokens. Max = context − prompt. |
| `max_completion_tokens` | int ≥1 | Same intent; the OpenAI reasoning-model spelling. |

## Output shape & tools

| Key | Type | Notes |
|---|---|---|
| `response_format` | map | `{"type":"json_object"}` ⇒ JSON mode (still instruct the model to emit JSON). |
| `structured_outputs` | bool | Whether the model can return `response_format` `json_schema`. |
| `stop` | array | Stop on any token in the array. |
| `tools` | array | OpenAI tool-calling request shape. |
| `tool_choice` | string\|object | `none` / `auto` / `required` / `{"type":"function","function":{"name":…}}`. |
| `parallel_tool_calls` | bool | Default **true**. Sequential when false. |
| `logit_bias` | map | tokenID → bias (-100…100). |
| `logprobs` / `top_logprobs` | bool / int(0–20) | Log-probabilities of output tokens. |

## Reasoning (the cost-dominant lever on a thinking model)

| Key | Type | Notes |
|---|---|---|
| `reasoning` | **map** | Controls reasoning behavior: **whether reasoning is enabled**, the effort, max reasoning tokens, and whether reasoning is excluded from the response. |
| `reasoning_effort` | enum | `xhigh, high, medium, low, minimal, none` (OpenAI-style). |
| `include_reasoning` | bool | **Deprecated** alias for `reasoning.exclude`. |

**The `reasoning` map fields (the load-bearing detail):**
- `enabled: false` → genuinely **disable** reasoning. (Omitting `reasoning` entirely leaves the
  provider default, which for a reasoning model is often ON — so omission is NOT "off".)
- `effort: "low"|"medium"|"high"` → OpenAI-style budget.
- `max_tokens: <int>` → Anthropic-style explicit reasoning-token cap.
- `exclude: true` → the model still reasons, but reasoning tokens are withheld from the response.

> **Orwell mapping (`token_policy` + `llm_core._apply_reasoning_budget`):** a call class's effort
> `"low"|"medium"|"high"` → `reasoning: {"effort": …}`; effort `"off"` → `reasoning: {"enabled": false}`
> (a genuine disable, verified via `debug.echo_upstream_body`). No call class ⇒ field omitted
> (byte-identical to a non-managed call). OpenAI o-series reasoning is intrinsic and is left untouched.

## Misc

| Key | Type | Notes |
|---|---|---|
| `web_search_options` | map | Native web-connected answers (provider-dependent). |
| `verbosity` | enum | `low, medium, high, xhigh, max` (OpenAI Responses; Anthropic maps to `output_config.effort`). |
| `usage` | map | `{"include": true}` ⇒ OpenRouter returns per-request cost + cached/reasoning token detail (used by the token meter). |

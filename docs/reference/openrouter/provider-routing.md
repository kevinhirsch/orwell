# OpenRouter — Provider Routing

> Source: <https://openrouter.ai/docs/guides/routing/provider-selection> — distilled 2026-06-21.
> Customize routing with the `provider` object in the chat/completions request body.

## The `provider` object

| Field | Type | Default | Description |
|---|---|---|---|
| `order` | string[] | — | Provider slugs to try in order (e.g. `["anthropic","openai"]`). **Setting it disables load balancing.** |
| `allow_fallbacks` | bool | `true` | Allow backup providers when the primary is unavailable. |
| `require_parameters` | bool | `false` | Only route to providers that support ALL params in the request (else they'd ignore unknown ones). |
| `data_collection` | "allow"\|"deny" | "allow" | `deny` ⇒ only providers that don't store/train on user data. |
| `zdr` | bool | — | Restrict to Zero-Data-Retention endpoints (OR'd with account/guardrail ZDR). |
| `enforce_distillable_text` | bool | — | Only models whose author allows text distillation. |
| `only` | string[] | — | Allow-list of provider slugs. |
| `ignore` | string[] | — | Skip-list of provider slugs. |
| `quantizations` | string[] | — | Filter by quant level (`int4,int8,fp4,fp6,fp8,fp16,bf16,fp32,unknown`). |
| `sort` | string\|object | — | `"price"` / `"throughput"` / `"latency"`; or `{by, partition:"model"\|"none"}`. **Setting it disables load balancing.** |
| `preferred_min_throughput` | number\|{p50,p75,p90,p99} | — | Deprioritize (not exclude) endpoints below this tok/s. |
| `preferred_max_latency` | number\|{p50,p75,p90,p99} | — | Deprioritize endpoints above this latency (seconds). |
| `max_price` | object | — | e.g. `{"prompt":1,"completion":2}` ($/M tokens); also `request`, `image`. **Excludes** if unavailable. |

## Default strategy (price-based load balancing)

1. Prefer providers with no significant outage in the last 30s.
2. Among stable ones, pick weighted by **inverse square of price** (a $1 provider is 9× more likely
   than a $3 provider).
3. Remaining providers become fallbacks.

Setting `order` **or** `sort` turns load balancing OFF and tries providers in the given order.
When the request has `tools`/`tool_choice`, routing is restricted to tool-supporting providers;
a `max_tokens` restricts to providers that support a response of that length.

## Shortcuts

- `<model>:nitro` ≡ `provider.sort = "throughput"`.
- `<model>:floor` ≡ `provider.sort = "price"`.

## Targeting endpoints

A base slug (`"deepinfra"`) matches all of that provider's endpoints (regions/variants); a full slug
(`"deepinfra/turbo"`, `"google-vertex/us-east5"`) targets one. `sort.partition:"none"` sorts
endpoints globally across multiple `models` (fallbacks) instead of grouping by model first.

## Provider-specific beta headers (Anthropic)

`x-anthropic-beta: interleaved-thinking-2025-05-14` (interleave thinking with output) and
`structured-outputs-2025-11-13` (strict tool use). Comma-separate to combine. Not relevant to the
DeepSeek live path, cataloged for completeness.

## Relevance to Orwell

ADR 0010 / feature 0069 **slice C** already uses this surface: a high-input-token live request opts
into a provider **pin** (`order` + `allow_fallbacks:false`) so a large, cache-warm prompt doesn't
cold-miss on a fallback (`token_spend_pin_*` settings). Default (threshold 0) keeps fallbacks ON ⇒
byte-identical default routing. `require_parameters:true` would be the clean way to guarantee a
provider honors `reasoning`/`response_format` if we ever see a provider silently dropping them.

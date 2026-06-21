# DeepSeek V4 Pro — reasoning on OpenRouter

> Source: DeepSeek V4 Pro model card + OpenRouter reasoning guide — distilled 2026-06-21.
> Model slug: **`deepseek/deepseek-v4-pro`**. This is Orwell's live narration model.

## Endpoint

`POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible chat/completions). Optional
ranking headers: `HTTP-Referer` (site URL), `X-Title` (site name). Streaming via `stream: true`.

OpenRouter also exposes the same model through `POST /responses` (OpenAI Responses API) and
`POST /messages` (Anthropic Messages, "extended thinking") — **Orwell uses chat/completions only.**

## Reasoning

- Enable/shape reasoning with the **`reasoning`** map (see `parameters.md`): `enabled`, `effort`,
  `max_tokens`, `exclude`.
- The response exposes a **`reasoning_details`** array — the model's internal step-by-step reasoning
  *before* the final answer.
- **Cross-turn preservation (the load-bearing requirement):** *"When continuing a conversation,
  preserve the complete `reasoning_details` when passing messages back to the model so it can
  continue reasoning from where it left off."* i.e. the structured `reasoning_details` should be
  echoed back on the assistant message on the next turn — NOT dropped, and NOT re-rendered as
  `<think>` text in `content`.

> **Orwell caveat (see the continuation audit).** The agent loop currently handles DeepSeek's native
> **`reasoning_content`** string (not the unified `reasoning_details` array) and DELIBERATELY STRIPS
> it from older assistant turns (`agent_loop.py` ~1225–1252) because re-feeding prior reasoning as
> `<think>` text drove repetition/looping in the multi-STEP tool-calling loop. Whether to adopt
> `reasoning_details` preservation (which is sent as a structured field, not re-rendered text, and so
> may avoid the looping the strip was working around) is an open question gated on a **live test**
> against `deepseek/deepseek-v4-pro`. Tracked in
> `../../audits/2026-06-21-deepseek-v4-reasoning-continuation-audit.md`.

## Streaming reasoning tokens

- Reasoning deltas stream alongside content; providers name the field variously
  (`reasoning_content` / `reasoning` / `thinking`) — read all three.
- **`usage.reasoning_tokens`** (a.k.a. `reasoningTokens`) arrives in the **final chunk** — the
  dominant cost signal on a thinking model. Capture it for the token meter.
- Keep reasoning OUT of the public message body; render it in the FE "Thinking" accordion only.

## Turning reasoning off for this model

Because V4 Pro is a reasoning model, **omitting `reasoning` does not disable it** — the provider
default applies. To genuinely disable (e.g. for the `utility-extraction` call class), send
`reasoning: {"enabled": false}`. Verify with `debug: {echo_upstream_body: true}` (streaming) and by
confirming `usage.reasoning_tokens == 0` on the response.

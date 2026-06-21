# OpenRouter — Errors & Debugging

> Source: <https://openrouter.ai/docs/api/reference/errors> — distilled 2026-06-21.

## Error response shape

```jsonc
{ "error": { "code": <number>, "message": <string>, "metadata"?: <object> } }
```

The HTTP status equals `error.code` **when the request never reached the model** (invalid request,
out of credits). Otherwise the HTTP status is **200** and any error that occurs while the model is
producing output is delivered **in the body / as an SSE event** (see mid-stream below).

## HTTP status codes

| Code | Meaning |
|---|---|
| 400 | Bad Request (invalid/missing params, CORS) |
| 401 | Invalid credentials (expired OAuth, disabled/invalid key) |
| 402 | Insufficient credits — add credits and retry |
| 403 | Forbidden (permissions, guardrail block, moderation flag) |
| 408 | Request timeout |
| 429 | Rate limited |
| 502 | Chosen model down / invalid response from it |
| 503 | No provider meets routing requirements |

### `Retry-After` header

On **429** and **503**, OpenRouter may send a standard `Retry-After: <seconds>` header. Honor it
before retrying (the OpenAI/Anthropic/Vercel/OpenRouter SDKs already do; raw `fetch`/`requests`
must do so explicitly).

## Typed error categories (`error.metadata`)

- **Moderation:** `{ reasons[], flagged_input, provider_name, model_slug }`.
- **Guardrail (403):** message describes the block; with `X-OpenRouter-Metadata: enabled` the 403
  also carries an `openrouter_metadata.pipeline[]` of the guardrail stages that ran.
- **Provider:** `{ provider_name, raw }` (the raw upstream error).
- **No content generated:** typically cold start / scale-up; retry, or try another provider/model.
  You may still be billed for prompt processing.

## Mid-stream errors (streaming, `stream: true`) — **live-path critical**

Once the first token is written the HTTP 200 + headers are committed, so a later provider failure
**cannot** fail over — it arrives **in-band** as an SSE chunk with a top-level `error` object **and**
a terminating choice:

```jsonc
{
  "id": "...", "object": "chat.completion.chunk", "created": 0,
  "model": "...", "provider": "...",
  "error": { "code": <int>, "message": <string>,
             "metadata": { "error_type": "<typed>", "provider_code"?: "<str>" } },
  "choices": [ { "index": 0, "delta": { "content": "" },
                 "finish_reason": "error", "native_finish_reason"?: "<str>" } ]
}
```

Key points: the `error` is **top-level** alongside the normal fields; switch on
`error.metadata.error_type` (NOT the HTTP code, which stays 200); the stream **terminates** after
this event; on 500-class errors the message is genericized and `provider_code` omitted.

### Non-streaming partial content

When some content was generated then the provider failed, the error is embedded in the final
response next to the partial content:

```jsonc
{ "choices": [ { "message": { "role": "assistant", "content": "partial..." },
                 "finish_reason": "error",
                 "error": { "code": 502, "message": "...",
                            "metadata": { "error_type": "provider_unavailable" } } } ] }
```

### `error_type` codes (switch on these)

| Group | Codes |
|---|---|
| Length | `context_length_exceeded`, `max_tokens_exceeded`, `token_limit_exceeded`, `string_too_long` |
| Auth | `authentication` (401), `permission_denied` (403), `payment_required` (402) |
| Rate/avail | `rate_limit_exceeded` (429), `provider_overloaded` (503), `provider_unavailable` (502) |
| Validation | `invalid_request`, `invalid_prompt`, `not_found`, `precondition_failed`, `payload_too_large`, `unprocessable` |
| Content | `content_policy_violation`, `refusal` |
| Image | `invalid_image`, `image_too_large`, `image_too_small`, `unsupported_image_format`, `image_not_found`, `image_download_failed` |
| Generic | `server` (500, masked), `timeout` (504), `unmapped` (500) |

> The Responses API (`/responses`) collapses many of these to `server_error`, and transforms the
> length errors into a **success** with `finish_reason: "length"`. The Anthropic Messages skin
> (`/messages`) maps to Anthropic-native `error.type` strings. Orwell uses chat/completions, so the
> chat-completions shapes above are the ones that matter.

## `X-Generation-Id`

The generation ID is returned in the **`X-Generation-Id`** response header on every endpoint — useful
to correlate/debug a request.

## `debug: {echo_upstream_body: true}` — the verification tool

**Streaming only.** Echoes the **exact transformed body** OpenRouter sent upstream, as the **first
chunk** (empty `choices`, a `debug.echo_upstream_body` field). Use it to verify how params were
transformed (e.g. that `reasoning` is actually disabled, how `max_tokens`/`temperature` landed).
**Not for production** — may surface sensitive request data; OpenRouter best-effort redacts.
On provider fallback, a debug chunk is sent for **each** attempted provider.

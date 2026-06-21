# OpenRouter — Streaming

> Source: <https://openrouter.ai/docs/api/reference/streaming> — distilled 2026-06-21.

Set `stream: true` to receive Server-Sent Events. The model streams the response in chunks.

## Wire format

- Each event is a line prefixed `data: ` whose payload is a `chat.completion.chunk` JSON object.
- Content deltas are at `choices[0].delta.content`.
- The stream ends with a literal `data: [DONE]` sentinel.
- **Usage stats arrive in the final chunk** (`chunk.usage`) — for a reasoning model this is where
  `reasoning_tokens` / `reasoningTokens`, `cost`, and cached-token detail land.

## Keep-alive comments — **must be ignored, not parsed**

To prevent connection timeouts OpenRouter periodically sends SSE **comment** lines:

```
: OPENROUTER PROCESSING
```

These are valid per the SSE spec and must be **skipped** (they are not `data:` lines). A naive
parser that `JSON.parse`/`json.loads` every line will throw on these — guard for the `data: ` prefix
and ignore the rest. (Recommended robust clients: `eventsource-parser`, the OpenAI SDK, the Vercel
AI SDK.)

## Stream cancellation

Aborting the connection cancels the stream; for **supported providers this stops model processing
and billing immediately**. **DeepSeek is in the supported list.** (For non-streaming or unsupported
providers, the model keeps going and you are billed for the full response.)

## Error timing (cross-ref: errors-and-debugging.md)

- **Pre-stream** (before any token): a normal HTTP 4xx/5xx JSON error; OpenRouter may transparently
  fail over to a backup provider.
- **Mid-stream** (after the first token): HTTP is already 200; the error arrives **in-band** as an
  SSE chunk with a top-level `error` and `choices[0].finish_reason: "error"`, then the stream ends.
  No failover is possible at this point.

## `X-Generation-Id`

Returned as a response header on the streaming response — correlate/debug with it.

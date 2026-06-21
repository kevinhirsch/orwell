# OpenRouter — Embeddings

> Source: <https://openrouter.ai/docs/api/reference/embeddings> — distilled 2026-06-21.

## Status in Orwell: **intentionally N/A**

Orwell generates embeddings with a **local fastembed ONNX** provider (ADR `docs/decisions/0004`),
warmed at boot and served through a worker-thread bridge, with a deterministic fake as the fallback
and test adapter. **No runtime path calls OpenRouter `/embeddings`.** This file is cataloged for
completeness only — if a hosted-embedding tier is ever wanted, the shape is below.

## Shape (for reference only)

`POST https://openrouter.ai/api/v1/embeddings`

```jsonc
{ "model": "openai/text-embedding-3-small", "input": "single string" }
// or batch:
{ "model": "...", "input": ["a", "b", "c"] }
// or multimodal (image / text+image), some models:
{ "model": "...", "input": [ { "content": [ {"type":"image_url","image_url":{"url":"..."}} ] } ],
  "encoding_format": "float" }
```

Response: `data[i].embedding` (a float vector). List models: `GET /api/v1/embeddings/models`.

Notes from the doc: no streaming; deterministic output for identical input; per-model token/context
limits; cache embeddings (they don't change); use cosine similarity; `provider` routing (e.g.
`{"data_collection":"deny"}`) also applies to embeddings.

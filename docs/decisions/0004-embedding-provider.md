# 0004 — Embedding provider (runtime semantic soul recall)

> **Status:** Accepted (ruling 2026-06-10, with the v1-transcript meta-feedback audit).
> **Resolves:** the last genuinely-open item in `CLAUDE.md` / `README.md` "Open decisions"
> (`docs/bb-sim-spec.md` §16.3) — which model backs `EmbeddingProvider` at runtime.
> **Source:** human ruling during the 2026-06-10 audit session
> (`docs/audits/2026-06-10-v1-transcript-meta-feedback-audit.md` §6.4).

## Context

Souls are markdown + an **engine-only** vector index (`SoulProvider`, `VectorIndex`,
`EmbeddingProvider` — all behind the Vault Wall; feature 0024). Semantic recall is what lets
"the veto betrayal" pull *that* memory rather than the most recent one (0041 live recall).
All seeded tests run against a **deterministic fake** embedding provider, so nothing in the
test gates depends on this choice; it affects only live recall quality. The deploy story is
local-first (a self-hosted LXC; Ollama or an API key are the *optional* LLM providers), so
the embedding default should not introduce a mandatory API key or network dependency.

## Decision

- **Runtime default: fastembed, local ONNX** — the engine-side adapter uses the **fastembed
  JS port** (npm `fastembed`, ONNX Runtime under the hood) with its default small BGE model,
  **version-pinned** (model + library) so recall stays stable across updates within a save.
- **The deterministic fake remains the test adapter** — every seeded/CI lane keeps using it;
  no test may depend on real embeddings.
- The adapter lives behind `EmbeddingProvider` like any other; swapping to Ollama embeddings
  or a hosted API later is an adapter change, not a design change.

## Why

- **Local-first, zero-key.** Matches the deploy's privacy/self-hosted posture; soul recall —
  a background, engine-only feature — must not be the thing that demands an API key.
- **Already in the family.** The vendored front-end uses (Python) fastembed for its
  memory/RAG; one embedding story across the product, two language-native ports of it.
- **Deterministic enough.** A pinned model version gives reproducible vectors per save,
  which suits non-degradation (0007): recall quality can improve only by *deliberate,
  versioned* migration, never silent drift.
- **Engine-only by construction.** Embeddings sit behind the wall (`VectorIndex` /
  `EmbeddingProvider` are engine-only ports; the dependency-cruiser gate already covers
  them) — provider choice cannot leak anything outward.

## Consequences

- The engine gains an optional native dependency (ONNX runtime) loaded lazily by the
  fastembed adapter; environments without it fall back to the deterministic provider
  (recall degrades gracefully, the game never breaks).
- The model file is fetched/cached at install time by the deploy scripts (offline-friendly
  thereafter), pinned alongside the engine version.
- Revisit only if live play shows recall quality is a felt problem — that would be a new
  decision record superseding this one.

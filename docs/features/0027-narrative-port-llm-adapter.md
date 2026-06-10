# 0027 — NarrativePort LLM adapter (the real narrator)

> **Status:** Built (see the [README status index](./README.md#index)). The real async LLM behind **`NarrativePort`** — provider-agnostic, streaming,
> resilient — replacing the `EchoNarrativePort` stub. It receives **only the Vault-free
> `NarrationContext`** (the visible projection + the moment prompt) and returns narration; it
> **never decides outcomes** (the engine does). In the folded deployment the **Orwell front-end's
> LLM realizes this port over MCP**; the spec fixes the contract + the in-engine adapter either side
> can use.
> **Executable spec:** [`0027-narrative-port-llm-adapter.feature`](./0027-narrative-port-llm-adapter.feature)

## 1. Summary

Narration is the one place an LLM touches the game, and it sits behind `NarrativePort` so the core
stays pure and the Vault Wall holds by construction. 0027 replaces the echo stub with a **real
adapter**:

- **Async + streaming** — narration arrives token-by-token for a live UI.
- **Provider-agnostic** — Ollama / Anthropic / OpenAI-compatible, behind one port; model + endpoint
  from **env/config**, never secrets in code.
- **Resilient** — timeouts, bounded retries, graceful failure (a narration error never corrupts game
  state — the engine already decided the outcome).
- **Vault-free by construction** — it is handed **only** the `NarrationContext` (assembled from the
  visible projection + the managed moment prompt, 0018), so it *cannot* receive Vault data.

## 2. Scope

**In:** the async/streaming `NarrativePort` contract; a real provider-agnostic adapter (config from
env, no secrets); resilience (timeout/retry/fallback); the Vault-free input guarantee; a
**deterministic fake** for tests; how the fold realizes the port via the front-end.

**Out:** the **moment prompt** content (**0018**); **what** the narrator narrates / the agent loop
(**0019**); the engine's **outcome** decisions (**0006/0011/0014** — narration never alters them);
the front-end's existing LLM plumbing internals (`llm_core.py` — reused, not re-specified).

## 3. The contract (async, streaming)

```
NarrativePort:
    narrate(context: NarrationContext) -> string                 # full narration
    narrateStream(context: NarrationContext) -> AsyncIterable<string>   # token stream for the UI
# NarrationContext (already Vault-free): { forEntity, mode, visibleEvents, knowledge, systemPrompt? }
```

The context is the **only** input. It is built by `PlayerSurface.assembleNarrationContext` (proven
Vault-free, 0001) + the moment system prompt (0018). The adapter adds the persona framing and calls
the model; nothing Vault-side is in scope for it to leak.

## 4. The real adapter

- **Provider-agnostic:** detect/route Ollama (`/api/chat`), Anthropic (`/v1/messages`), and
  OpenAI-compatible (`/chat/completions`) from the configured endpoint. Model + endpoint + key come
  from **env/config** (the same source the deploy/`.env` uses); **no secret is committed**.
- **Streaming:** `narrateStream` yields deltas; the full string is the concatenation.
- **Resilient:** a per-call timeout, **bounded retries** with backoff, and a safe fallback (a plain
  system line) on hard failure — the **game state is untouched** because the engine already resolved
  the beat; narration is presentation.

## 5. Outcomes stay the engine's (anti-sycophancy)

The adapter **only voices** the engine-provided context. It cannot change a winner, a vote, or a
fact — those are decided by the core (0006/0011/0014) and handed in as already-settled context. A
hallucinated "result" in the prose has **no** effect on game state; the next read comes from the
stores, not the prose. This is enforced structurally: the port returns *text*, never state.

## 6. The fold (how it's realized in deployment)

Since the game is folded into the main chat, the **front-end's LLM connection is the deployed
`NarrativePort` realization**: it injects the engine's moment prompt (0018) over MCP and streams the
model's narration. The **in-engine adapter** (this feature) is the same contract for engine-side
narration (system messages, a headless/CLI mode, tests). Either realization obeys the same two
guarantees: **Vault-free input** and **engine-decides outcomes**.

## 7. Test strategy

- **Vault-free input:** across seeded runs with a populated Vault, the context handed to the adapter
  is **sentinel-clean** (extends the 0001 context-assembly test); a leak here would be a leak in the
  projection, caught upstream.
- **Streaming = full:** `narrateStream` concatenated equals `narrate` for the deterministic fake.
- **Resilience:** a timeout / provider error yields the safe fallback and **leaves game state
  unchanged** (re-reading the stores gives the same result).
- **No outcome influence:** narration text never changes a subsequent engine read (the engine's
  result is identical whether narration succeeded, failed, or hallucinated).
- **Deterministic fake** backs all of the above offline; the real provider is wired at runtime.

## 8. Open decisions (flagged)

- **Default provider/model** at runtime (env-driven; the deploy `.env` already carries it). Flag.
- **Retry/timeout numbers** — tunable config. Flag.
- **Streaming transport to the player** — reuse the front-end's existing SSE chat stream (default)
  vs an engine-level stream. Default: reuse the front-end's (the fold). Flag.

## 9. Definition of Done

- [ ] `NarrativePort` has async `narrate` + `narrateStream`; the real adapter is provider-agnostic,
      config-from-env (no secrets), with timeout/retry/fallback.
- [ ] The adapter receives **only** the Vault-free `NarrationContext` (sentinel-clean; extends 0001).
- [ ] A narration failure leaves **game state unchanged**; narration **never** alters an outcome.
- [ ] A **deterministic fake** covers tests; `narrateStream` concatenates to `narrate`.
- [ ] The fold's front-end realization honors the same two guarantees.

## 10. Dependencies

**0018** (the moment prompt the context carries), **0001** (the Vault-free `NarrationContext`),
**0009** (the MCP seam the front-end narrates over), **0006/0011/0014** (the engine outcomes
narration only voices), **0019** (the agent loop that drives narration), `NarrativePort` /
`PlayerSurface.assembleNarrationContext`, and the front-end `llm_core` (the deployed realization).

## 11. Traceability

`CLAUDE.md` ("`NarrativePort` (the LLM)"; "the LLM only *narrates*"; remaining work: "the async LLM
`NarrativePort`"); `docs/features/0001` (`NarrationContext` Vault-free), `0009` (MCP seam), `0018`
(moment prompt); the vendored Orwell `llm_core` (the existing provider connection this reuses).

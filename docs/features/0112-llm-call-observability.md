# 0112 — LLM-call observability (Vault-free trace tagging + opt-in external forwarding)

> **Renumbered from 0107** (doc-drift audit, 2026-07-05): `0107` collided with the already-built,
> load-bearing `0107-named-alliances`; this still-unbuilt spec moved to the next free slot. No
> content change.
>
> Companion: `0112-llm-call-observability.feature`. Builds on **0069** (the token economy / `orwell_token_ledger`),
> **0065** (the `beatSeq`/`phase` sync spine — the correlation key), and **0079** (the internal runtime
> diagnostic log). This is the *external, queryable* counterpart to 0079's *internal* log.

## Why

Every automated gate **stubs the narrator** (`DeterministicNarrator`/`EchoNarrativePort`), so LLM-behavioral
regressions ship green and only surface in a live playtest — sometimes weeks later. The 2026-06-26 playtest
proved the cost: **#1007** (cast-authoring mass floor-fallback — `authored 0/15`, every call truncated at
`finish_reason=length` with an empty body) passed the full suite and was only caught by a hand-driven live
game. Its signature — `finish_reason=length` + `reply_chars=0` + a fixed `output_tokens` cap on a whole call
class — is a textbook dashboard alert. The same is true of the **under-call class** (F8/F14): the debug bundle
showed a **0% tool-call rate** across every sampled live turn, which is just an aggregate of a field we already
log per call (`tool_call_seen`).

We already capture the per-call facts (`orwell_token_ledger` + the `src.llm_core` stream summary). What is
missing is (a) **correlation metadata** that ties each model call to the engine beat it served, and (b) a
**durable, queryable sink** so these facts become always-on charts and alerts instead of a log to grep after
the fact. This feature is **always-on production live-verify telemetry** — it closes exactly the gap the
stubbed gates leave open.

A second, higher-value payoff falls out of the correlation metadata: **model-vs-engine divergence detection.**
If every call carries the engine's `beatSeq`/`phase`, then an F16-class bug ("the narration claims an
eviction-result while the engine is at `phase:veto-competition`") becomes a **queryable alert in the sink**,
not something only a live eviction drive can find.

## Scope

**In:**
1. A **Vault-free trace record** emitted for every LLM call, carrying the existing ledger facts **plus** the
   0065 correlation keys (`beatSeq`, `phase`, `moment`, `call_class`, canonical `session`, `user`).
2. **OpenRouter request tagging** — the same Vault-free correlation keys attached as request `metadata` so
   **OpenRouter Broadcast** (account-side, zero shipper code) forwards correlatable traces to any of its 18+
   destinations. Additive: absent ⇒ byte-identical request.
3. An **opt-in, fail-soft `TraceSink` port** (FE-tier) with a **no-op default** and an **OTLP/Langfuse**
   adapter, so the operator can ship the same records directly (provider-agnostic, self-hostable) without
   relying on OpenRouter's feature.
4. **Operator controls** (settings, read per-request): `observability_enabled` (default **false**),
   `observability_endpoint`, `observability_privacy_mode` (default **`metrics-only`** — strip
   prompt/completion content), `observability_sampling` (0.0–1.0, deterministic by session).
5. A **structural Vault-free gate**: the emitted record **and** the request metadata are asserted to contain
   no Vault/soul keys (the same class of test as `secrets.test.ts` / the redaction gates).
6. **Optional deploy support**: a self-hosted **Langfuse** `docker-compose` profile under `deploy/`
   (opt-in, off by default), so a private/LAN deploy (ADR 0014) keeps all trace data on-box.

**Out:**
- OpenRouter account-side **Broadcast configuration** itself (the operator enables it in the OpenRouter UI and
  picks destinations — outside Orwell's code; we only **document** the handshake and what metadata we emit).
- Any **engine** change. The engine stays pure and I/O-free; observability is FE-tier, exactly like the token
  ledger and the other FE-driven side tasks. The engine merely **already issues** `beatSeq`/`phase` (0065);
  the FE reads and forwards them.
- A bespoke dashboard UI. Use the sink (Langfuse/PostHog/etc.). The reduced game build adds **no** player-facing
  surface.
- **Content** forwarding by default — see the Vault note.

## The Vault Wall (non-negotiable)

- **Correlation metadata is Vault-free by construction.** `beatSeq`, `phase`, `moment`, `call_class`,
  `session`, `user`, token counts, cost, `finish_reason`, `tool_call_seen`, latency — all closed-set or
  projection facts. The record builder **never** reads the `VaultStore`/`SoulProvider`; the trace path is
  **outward by construction** and the existing dependency-cruiser boundary already forbids the edge. A
  structural test asserts the serialized record/metadata match **no** Vault key (`soul`, `trust`, `threat`,
  `affinity`, `hidden`, `target`, `relationship`, `grudge`, `scheme`, `confession`).
- **Prompt/completion content is gated.** The narrator only ever receives **Vault-free projections** (the
  whole point of the Wall), so request content is already secret-free — but it is still the player's private
  game text. Default `privacy_mode=metrics-only` forwards **no content**, only metrics + the correlation keys.
  Content forwarding is an explicit operator opt-in, and even then a **self-hosted** sink is the recommended
  destination (the deploy ships one).
- **Reasoning tokens are fine to forward** (reasoning never sees the Vault) — and are diagnostically valuable
  (the #1007 cap-vs-reasoning interaction is invisible without them).

## Contracts

- **`TraceSink` (new FE port).** `emit(record: TraceRecord) -> None` — **async, fail-soft, best-effort**. The
  default adapter is a **no-op**. An error/timeout in any adapter is swallowed and **never** fails or delays the
  turn (same discipline as the FE-driven write-backs). Sampling is applied before `emit`.
- **`TraceRecord`** (Vault-free): `{ ts, user, session, call_class, model, beatSeq, phase, moment,
  input_tokens, cached_tokens, output_tokens, reasoning_tokens, applied_max_tokens, cost, finish_reason,
  tool_call_seen, latency_ms, status, [prompt, completion] (only when privacy_mode=full) }`.
  Note `applied_max_tokens` (the real wire cap) is included — its absence/mis-log is exactly the DB3/#1007
  failure mode this feature exists to surface.
- **Request metadata.** When tagging is enabled, the OpenRouter (OpenAI-compatible) payload gains
  `metadata: { orwell_session, beatSeq, phase, call_class }`. Absent ⇒ **byte-identical** to today (the same
  back-compat discipline as 0065's `expectedBeatSeq`).
- **Settings** (admin-editable, read per-request — no restart): `observability_enabled` (false),
  `observability_endpoint` (""), `observability_privacy_mode` (`metrics-only` | `full`),
  `observability_sampling` (1.0).

## Test strategy (Definition of Done)

1. **Vault-free record** — a unit/structural test asserts the serialized `TraceRecord` and the request
   `metadata` contain **no** Vault key, across every `call_class`. (Templated on `secrets.test.ts` / the
   redaction gates.)
2. **Byte-identical when absent** — with `observability_enabled=false`, the OpenRouter payload is byte-identical
   to the pre-feature payload (no `metadata` key), and the `TraceSink` is the no-op.
3. **Fail-soft** — a sink that raises/times out completes the turn normally; the turn's reply is unaffected and
   no exception propagates. (Inject a throwing adapter.)
4. **Correlation** — the emitted record's `beatSeq`/`phase` equal the values the engine issued for that turn
   (ties to 0065; a live or harness turn asserts equality).
5. **Privacy mode** — `metrics-only` emits no `prompt`/`completion`; `full` includes them. Sampling at 0.0
   emits nothing; 1.0 emits every call; a fixed session id samples deterministically.
6. **Boundary** — dependency-cruiser confirms the trace path imports **no** `VaultStore`/`VectorIndex`/
   `SoulProvider` (outward-only).
7. **Divergence smoke** — a record carrying an eviction-result completion while `phase != eviction` is
   detectable from the record alone (the metadata makes the F16 query expressible) — proven by a unit assertion
   over a crafted record, not a live model.

## Implementer handoff

- **Where:** FE-tier, `frontend/src/` beside `orwell_token_ledger.py`. The `src.llm_core` call site that
  already logs the stream summary is the single emit point — build the `TraceRecord` there from the same data
  it already has, attach the request `metadata` in the payload builder, and `await sink.emit(...)` best-effort.
  The correlation keys come from the per-turn context the FE already holds (the 0065 last-seen `beatSeq` +
  the current `phase`/`moment`/`call_class`).
- **Adapters:** `NoopTraceSink` (default) and `OtlpTraceSink` (Langfuse/OTLP). Resolve via settings, like the
  utility-LLM/`_resolve_llm_fn` pattern — **no endpoint ⇒ the no-op stands** (byte-identical).
- **Deploy:** an **opt-in** `deploy/observability/` Langfuse `docker-compose` + a note in
  `frontend/INTEGRATION.md` documenting (a) the OpenRouter Broadcast handshake + the exact `metadata` keys we
  emit, and (b) the direct-ship path. Off by default; a private/LAN deploy can self-host so nothing leaves.
- **Do NOT** route content through a third-party sink by default; **do NOT** add any Vault read to the trace
  path; **do NOT** let an emit failure touch the turn. The metadata is additive and the sink is fail-soft —
  both must be byte-identical/no-op when unconfigured.

## Would it have caught the bugs that motivated it?

Honest scope (this is the design rationale, not a promise the sink replaces live-verify):
- **Yes, early:** #1007 (`finish_reason=length` + empty body on a whole call class), the F8/F14 under-call
  signal (`tool_call_seen` rate ≈ 0), cost/latency/truncation anomalies, DB3 (`applied_max_tokens` mis-log).
- **Yes, with the `beatSeq`/`phase` metadata:** F16-class model-vs-engine divergence becomes a queryable alert.
- **No:** engine-state wedges (the F14 stuck pending), FE render/consistency bugs (the vanishing-message
  cluster), and the FE↔engine ops bugs (the 502 storm, disk%) — none touch the OpenRouter call. This feature is
  a **complement** to the live-verify discipline (SOUL lesson 19), not a replacement.

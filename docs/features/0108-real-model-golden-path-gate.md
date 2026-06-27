# 0108 — Real-model golden-path gate (record-once / replay-in-CI)

> Companion: `0108-real-model-golden-path-gate.feature`. Builds on **0107** (LLM-call observability —
> the adjacent *always-on* trace tap; this feature is its *deterministic-replay* sibling), **0065**
> (the `beatSeq`/`phase` sync spine — the keys that prove the game advanced and that the narration
> never ran ahead of the engine), **0055** (`_auto_record_scene` and the under-call belts the gate
> exercises), and **0051** (the in-character image / casting-headshot resume seam the post-photo
> resume invariant covers). Governed by **ADR 0003** (the conversation *is* the game — so the only
> faithful test of the player journey is to drive the real conversation).

## Why

**Every automated gate stubs the LLM.** The engine gate, the BDD lane, the FE pytest suite, the
heavy sims, the boot/browser smokes — all run against `DeterministicNarrator` / `EchoNarrativePort`
or a fake utility LLM. That is correct for what they test (the engine is deterministic and must be
tested deterministically), but it means the **entire class of player-facing bugs that live in the
model↔engine seam ships green** and only surfaces when a human drives a real model for ~30 minutes.

The session record is unambiguous about the cost. SOUL lessons 17 & 19, and the 2026-06-26/27
playtests, catalogue the *same recurring class*:

- **Tool under-calls.** The narration LLM reliably under-calls the engine tools — it won't
  `advanceGame` (the game freezes at a beat), won't `recordInteraction` (social play folds zero
  impact), won't fire the producers' opener without a player prompt (#967), won't resume after the
  casting headshot without a manual "continue" (#969). The FE carries in-loop belts for exactly
  these (`agent_loop.py`, `chat_helpers.py`, `_auto_record_scene`), but **the belts themselves are
  only exercised by a real model** — the stub never under-calls, so a regression in a belt ships
  green (lesson 19: "#1007 merged with the full FE suite green and STILL mass-fell-back to the
  floor the instant a real reasoning model ran it").
- **Narration desyncs.** A premature vote tally / eviction result leaking before the engine commits
  (the F16 class), or the desync / pre-emission outcome guard going inert. The stub narrates the
  scripted line; it never *invents an outcome the engine hasn't reached*, so the guard is never put
  under load.
- **Cast-authoring richness / truncation.** #1007 — a reasoning model truncated at
  `finish_reason=length` with an empty body, so cast authoring mass-fell-back to the deterministic
  floor (`authored 0/15`). Invisible to every gate.

We keep **re-discovering the same bugs by hand**, paying the ~25-minute live-env setup tax (lesson
17) each time, and a delegate's evidence dies with its worktree unless laboriously dumped (lesson
20). The fix is to make the real-model golden path a **repeatable, automated gate**: capture *one*
real run as a deterministic fixture, then replay it against the **real engine + real FE** on every
PR — no API key, fully deterministic — and **re-record nightly** against a live model so prompt
drift is caught early.

This is the structural complement to 0107. 0107 makes the live signal *queryable when a human (or
the nightly) drives a real model*; 0108 makes a *captured* real run **re-playable deterministically
in PR-time CI**, so the seam regresses loudly instead of silently.

## Scope

**In:**

1. **A recording mode** (`ORWELL_GOLDEN_RECORD=1`) that captures **one** real run of deepseek-v4-pro
   (via OpenRouter) along the golden path and writes a committed **transcript fixture** keying every
   FE→model request to its model response.
2. **A replay narrator** (`ORWELL_GOLDEN_REPLAY=<fixture>`) that, in CI, feeds the recorded responses
   back deterministically by keyed lookup while driving the **real engine + real FE** end-to-end —
   **no API key, no network to the provider, fully deterministic**. A cache miss is a **hard
   failure** (it means the prompt drifted off the fixture).
3. **A golden-path driver** that walks casting → premiere → Week 1 HOH → nominations → veto →
   eviction → week-roll through the **real FE app** (the same boot pattern as `deploy/smoke.sh`),
   asserting the invariants below.
4. **A PR-time replay CI job** (`golden-path`), deterministic, key-free, fast, wired into the
   existing `.github/workflows/ci.yml` graph and the `ci-gate` aggregator.
5. **A nightly real-model smoke** (scheduled, gated on a repo secret holding the OpenRouter key,
   **allowed to flake / non-blocking**) that **re-records** the fixture and diffs the invariants
   against a live model, surfacing prompt drift before it reaches a PR.

**Out:**

- **Any engine change.** The golden path is driven through the FE; the engine is exercised, never
  modified. (The recorder/replay wrap the *FE's* model chokepoint, not the engine.)
- **Replacing live-verify.** This gate catches the *captured* seam regressing; it does **not**
  replace the SOUL-lesson-19 discipline of driving a real model before merging a *new* LLM-behavioral
  fix (a fix that changes the prompt invalidates the fixture by design — see Non-goals). The nightly
  re-record is the bridge, not a substitute.
- **A bespoke UI.** The gate is a script + a fixture file. No player-facing surface; the reduced
  game build adds nothing.
- **Multi-model coverage.** One model (the deploy default, deepseek-v4-pro) on the golden path. Other
  models / branches (jury, finale, the off-screen society) are future fixtures, not this spec.

## The record seam (traced in the FE)

The FE resolves and calls the model through **two public chokepoints** in `frontend/src/llm_core.py`
(confirmed by reading the source and `llm_trace.py`, which already taps exactly these):

| Chokepoint | Used by | Protocol |
|---|---|---|
| `stream_llm_with_fallback(candidates, messages, **kwargs)` (`llm_core.py:2266`) | the chat / agent-loop narration stream (`agent_loop.py`) | yields SSE chunks: `data: {"delta": …, "thinking": bool}`, `data: {"type":"tool_calls", …}`, `data: {"type":"usage"/"finish"/"fallback", …}`, `data: [DONE]`, `event: error` |
| `llm_call_async(...)` (`llm_core.py:~1346`) | the non-streaming utility / extraction calls — cast authoring (`orwell_cast_authoring.py`), prewarm, zeitgeist, `_auto_record_scene` extraction | a single request/response |

Both are resolved through `_resolve_llm_fn` (`orwell_cast_authoring.py:627`) for the utility/faithfulness
family, and the chat path resolves its endpoint from `frontend/data/settings.json`
(`default_endpoint_id` + `default_model`, read per-request). The **actual network call** for the
streaming path is `_stream_llm_with_fallback_impl` (`llm_core.py:2298`); the public
`stream_llm_with_fallback` is already a thin tracing wrapper around it (it constructs a
`StreamAccumulator`, observes each chunk, forwards the bytes unchanged, and on `finally` calls
`llm_trace.record_llm_call(...)`).

**This is the exact record point** — the recorder/replay piggybacks on the same wrapper site:

- **Record mode** (`ORWELL_GOLDEN_RECORD=1`): the wrapper tees. It forwards the live SSE bytes to the
  caller unchanged (real run) **and** accumulates them (reuse `StreamAccumulator`) into an ordered
  list of raw chunks; on stream end it appends `{ key, request_digest, chunks: [...], meta }` to the
  fixture. The utility path (`llm_call_async`) records `{ key, request_digest, response }` the same way.
- **Replay mode** (`ORWELL_GOLDEN_REPLAY=<fixture>`): the wrapper **short-circuits** — it does **not**
  call `_stream_llm_with_fallback_impl` at all. It computes the request key, looks it up in the
  fixture, and **re-emits the recorded SSE chunks** in order (an `async` generator that mirrors the
  recorded `delta`/`tool_calls`/`usage`/`finish`/`[DONE]` protocol byte-for-byte). A **miss raises a
  hard error** surfaced as a CI failure. The utility path returns the recorded response object.

Wrapping at this single seam means **the entire FE above it is real** — the agent loop, the
under-call belts, `_auto_record_scene`, the desync / pre-emission outcome guard, the channel-split
streaming, the scrub — and the **engine is real and live**. Only the bytes that would have crossed
to OpenRouter are recorded/replayed. This is the smallest possible substitution that still exercises
the whole model↔engine seam.

### Fixture key

The fixture must be **stable across runs** yet **sensitive to prompt drift** (a drifted prompt =
a miss = a loud failure, which is the point). The key is a **stable hash of the canonicalized
request**: the ordered `messages` (role + content), the `tools` schema (names + the JSON schema,
sorted), the sampling params that affect output shape (`model`, `temperature`, `max_tokens`, the
reasoning budget, `response_format`), and the `call_class`. Volatile fields are **excluded** from
the key (timestamps, request ids, the `session`/`user` ids, OpenRouter routing/`provider` opts).
Determinism on the FE side is pinned by the existing seam: drive the engine with a **fixed seed**
and the same `x-orwell-user`, and the FE already de-dupes candidates and sorts system messages
(`llm_core.py:1623`) so the canonical request is reproducible.

When two requests hash identically within one run (e.g. an idempotent retry), the fixture stores an
**ordered list per key** and replay consumes them in call order, falling back to the last entry —
this keeps a benign retry from forcing a re-record while still catching real drift.

## Fixture format

A single committed JSONL file under `frontend/tests/golden/` (e.g.
`golden_path_deepseek_v4_pro.jsonl`), one record per line:

```jsonc
{
  "key": "<stable request hash>",
  "call_class": "narration" | "background-authoring" | "auto-record" | ...,
  "model": "deepseek/deepseek-v4-pro",
  "seq": 0,                       // call order within the run (tie-break for same-key)
  "request_digest": { "messages_sha": "...", "tools_sha": "...", "params": {...} },
  "kind": "stream" | "call",
  "chunks": [ "data: {\"delta\":\"…\"}\n\n", ... ],   // stream: raw SSE chunks in order
  "response": { ... },             // call: the utility response object
  "meta": { "finish_reason": "stop", "output_tokens": 812, "tool_call_seen": true }
}
```

**Constraints:**

- **Vault-free by construction.** The fixture is only the FE's request (Vault-free projections — the
  whole point of the Wall) plus the model's reply (player-facing narration + tool-call deltas +
  reasoning). It **never** contains `VaultStore`/`SoulProvider` state. A structural test (templated on
  `secrets.test.ts` / 0107's gate / the redaction gates) asserts the serialized fixture matches **no**
  Vault key (`soul`, `trust`, `threat`, `affinity`, `hidden`, `grudge`, `scheme`, `confession`,
  raw `npc:<id>`).
- **Secrets-scrubbed.** Reuse `llm_trace`'s scrub: no `Authorization` / `sk-…` / bearer shapes. The
  recorder is never handed the request *headers*.
- **Roles only.** Per the testing rules, the fixture **content** is treated as **format only** — the
  invariant assertions key on roles/structure (a vote was tallied, a nominee was named), never on the
  specific generated names. (The names are whatever the seeded `CharacterFactory` produced; they are
  not canonical and not asserted.)
- **Size-bounded.** One golden path is ~a few dozen model calls. Reasoning is retained (it is
  diagnostically load-bearing — lesson 18 — and small relative to nothing else in the repo). If size
  becomes a problem the fixture may be gzip-committed; do **not** clip individual records (the #1007
  signature is an *empty body with a reasoning burst* — clipping would hide it).

## The invariants the gate asserts

Each is one Gherkin scenario in the companion `.feature`. All assert **structure / roles / engine
truth**, never specific generated content.

1. **Casting finalizes and the season starts.** Driving the casting interview to the player's
   readiness signal ends with the engine at `ready`/started — the `createCharacter` finalize fallback
   (audit 2026-06-20) is exercised, the premiere begins.
2. **The producers' opener fires without a player prompt (#967).** After casting finalizes, the first
   GM turn is the producers' opener — emitted with **no** player message driving it.
3. **The post-photo resume fires without a manual "continue" (#969).** After the casting headshot
   beat (0051), narration **resumes on its own** — no player "continue" required.
4. **Cast authoring lands ≥13/15 deep profiles.** The background cast-authoring write-back
   (`recordCastProfile`, 0058) authored ≥13 of 15 NPCs as deep profiles (not the deterministic
   floor) — the #1007 mass-fallback signature is absent (no whole-class `finish_reason=length` +
   empty body).
5. **The game advances through every beat (no stuck phase).** The engine `phase`/`beatSeq` (0065)
   monotonically progresses HOH → nominations → veto → veto-ceremony → eviction → next HOH — no phase
   repeats unboundedly (the `advanceGame` under-call belts hold; the stall-nudge → forced-advance
   escalation is exercised if needed).
6. **The eviction reveal is batched and never runs ahead of the engine.** The staged eviction reveal
   plays in ~4–8 batched rounds (`STAGED_TARGET_ROUNDS`), and **no player-facing turn narrates a
   tally / result the engine hasn't committed** — the pre-emission outcome guard / desync guard holds
   (no `beatSeq` 409 self-trip; no premature result text vs the engine's `phase`). This is the F16
   class made a gate.
7. **The player-facing text is clean.** Across **every** replayed player-facing turn, the rendered
   body contains **no Vault data**, **no** raw `npc:<id>`, **no** operator aside, and **no** reasoning
   token — reasoning is confined to the "Thinking" accordion by construction (the channel split in
   `chat.js`; the game-build scrub in `markdown.js`). One assertion over the whole transcript.
8. **The week rolls.** After eviction the next HOH week begins immediately (the standard cadence), the
   jury/board state is consistent, and `beatSeq` continued to advance — the loop closed.

Scenarios 5–8 also assert the **deterministic-replay contract**: every model call resolved from the
fixture (zero cache misses), and the run used **no** API key / made **no** call to OpenRouter.

## CI wiring

### PR-time replay job (`golden-path`) — deterministic, key-free, blocking

A new job in `.github/workflows/ci.yml`, gated on a new `golden` path-filter output (true when
`frontend/**`, `src/**`, the fixture, or this workflow change — a golden-path regression can come from
either side of the seam), following the FE-job pattern (Python 3.12, `pip install -r
frontend/requirements.txt`). It:

1. Builds the engine (`npm run build`) and boots it with `ORWELL_ENGINE_TOKEN` (the `deploy/smoke.sh`
   boot helper is the template).
2. Boots the FE pointed at the engine (`ORWELL_ENGINE_MCP_URL`, `AUTH_ENABLED=false`,
   `ORWELL_GOLDEN_REPLAY=frontend/tests/golden/golden_path_deepseek_v4_pro.jsonl`, a fixed engine
   seed) — **no model endpoint configured**, because replay never calls the provider.
3. Runs the golden-path driver, which walks the path and asserts invariants 1–8. A cache miss, a stuck
   phase, a desync, or a Vault/`npc:` leak fails the job.

Add `golden-path` to the **`ci-gate`** `needs:` list and its `RESULTS` env so it is part of the one
required check, and to the `changes` job outputs + the path-filter ERE. It is deterministic and fast
(no model latency — chunks are re-emitted from memory) and **must not flake** (only the nightly may).

### Nightly real-model smoke (`golden-path-nightly`) — scheduled, key-gated, non-blocking

A `schedule:`-triggered workflow (or a `schedule`-gated job) that:

1. Runs only when the repo secret `OPENROUTER_API_KEY` (or `ORWELL_OPENROUTER_KEY`) is present —
   `if: ${{ secrets.OPENROUTER_API_KEY != '' }}` — so a fork / a missing secret is a clean skip, not a
   failure.
2. Stands up engine + FE wired to a **real** deepseek-v4-pro endpoint (the lesson-17 recipe: `POST
   /api/model-endpoints`, pin the model, stamp the owner, write `default_endpoint_id`/`default_model`
   into `frontend/data/settings.json`, drive with `x-orwell-user`) with `ORWELL_GOLDEN_RECORD=1`.
3. **Re-records** the fixture against the live model and **runs the same invariant assertions** on the
   live run (so a live regression — a new under-call, a truncation, a desync — is caught nightly even
   if the committed fixture still passes replay).
4. **`continue-on-error: true`** — it is allowed to flake (provider 5xx, rate limits, non-determinism)
   and **never blocks**. It surfaces drift as: the job uploads the freshly-recorded fixture as a build
   artifact and **diffs the invariant results vs the committed fixture's replay**; a divergence is
   reported (an issue comment / a job annotation), prompting a human to regenerate.

### Fixture refresh / "regenerate fixture" path

Because a prompt change **legitimately** invalidates the fixture (a drifted request → a replay miss),
there must be a clear, single-command regenerate path:

- `cd frontend && ORWELL_GOLDEN_RECORD=1 python3 scripts/golden_path_record.py` (drives the live model
  once with the lesson-17 env, writes `frontend/tests/golden/golden_path_deepseek_v4_pro.jsonl`),
  documented in `frontend/INTEGRATION.md` and referenced in the replay job's failure message
  ("golden-path replay miss — a prompt changed; regenerate the fixture: …").
- The nightly's uploaded artifact **is** a ready-to-commit refreshed fixture, so the regenerate is
  usually "download the nightly artifact, eyeball the invariant diff, commit."

## Non-goals / risks

- **Prompt drift invalidating the fixture.** *By design* — a changed prompt is a real signal. Mitigation:
  (a) the nightly re-record keeps drift visible day-to-day; (b) the single-command regenerate path is
  documented and surfaced in the failure message; (c) a PR that *intends* a prompt change regenerates
  the fixture in the same PR (and a human must still live-verify the *new* behavior per lesson 19 — the
  gate proves the captured path replays, not that a brand-new prompt is correct).
- **Fixture size.** Bounded (~one path, a few dozen calls); gzip if needed; never clip a record.
- **Keeping it Vault-free.** Enforced structurally (the no-Vault-key assertion over the serialized
  fixture, the secrets scrub) — the fixture only ever holds Vault-free projections + the reply.
- **Flaky-blocker risk.** The **replay** job must be deterministic and stable — it re-emits bytes from
  memory, no network, no model latency, fixed seed. Only the **nightly** may flake, and it is
  `continue-on-error`. If the replay ever flakes, that is itself a bug (a non-determinism in the FE/engine
  seam) to fix, not to mute.
- **A green replay is not a green model.** The replay proves the *captured* path still drives the real
  engine cleanly. A genuinely new model behavior only shows up in the nightly (or a hand live-verify).
  This is a **complement** to live-verify (SOUL lesson 19), exactly as 0107 is.

## Test strategy (Definition of Done)

1. **Replay determinism** — replaying the committed fixture twice produces byte-identical driver output
   and zero cache misses; no API key present; no outbound call to OpenRouter (assert via a network guard
   / no endpoint configured).
2. **Hard-fail on miss** — a deliberately mutated request (or a deleted fixture entry) makes the replay
   raise and the job fail (proves drift is loud, not silent).
3. **Each invariant 1–8** is its own asserting scenario over the replayed run (the `.feature`).
4. **Vault-free fixture** — a structural test asserts the serialized fixture contains no Vault key and
   no `npc:<id>`/operator-aside/reasoning leak in any *player-facing body* field.
5. **Byte-identical when off** — with neither `ORWELL_GOLDEN_RECORD` nor `ORWELL_GOLDEN_REPLAY` set, the
   `stream_llm_with_fallback`/`llm_call_async` chokepoints are byte-identical to today (the wrap is a
   near-zero passthrough, same discipline as `llm_trace`).
6. **CI wiring** — `golden-path` is in the `ci-gate` `needs:`/`RESULTS`; the `changes` path filter gates
   it; the nightly is `schedule:`-triggered, secret-gated, and `continue-on-error`.
7. **Run the WHOLE FE suite** (`cd frontend && python3 -m pytest tests/`) before pushing — the record/
   replay wrap touches the shared chokepoints and several gates are source-pinned convention checks.

## Implementer handoff

- **Where:** FE-tier, `frontend/src/` beside `llm_trace.py` (a new `golden_path.py` for the
  record/replay wrap + key/fixture I/O) and `frontend/scripts/golden_path_record.py` (the live-record
  driver) + `frontend/scripts/golden_path_replay.py` (the CI driver, or a pytest under
  `frontend/tests/`). The fixture lives in `frontend/tests/golden/`.
- **The single seam:** wrap **inside** `stream_llm_with_fallback` (`llm_core.py:2266`) and
  `llm_call_async` (`llm_core.py:~1346`) — both already have the tracing-wrapper shape; add the
  record-tee / replay-short-circuit there, gated on the two env vars, **leaving the disabled path
  byte-identical**. Reuse `StreamAccumulator` for the record side and re-emit the recorded chunks for
  the replay side. Do **not** touch `_stream_llm_with_fallback_impl` (the real network call) — replay
  simply never reaches it.
- **The driver:** model it on the prior live-verify harness (the session scratchpad's
  `playthrough.mjs` / `drive2.mjs` family drove the FE chat endpoint turn-by-turn and dumped
  `*-states.jsonl`) and on `deploy/smoke.sh`'s engine+FE boot. Drive the **real FE chat endpoint**
  (the same `chat_stream` POST casting kickoff uses — lesson 17 trap notes the `[data-ob-setup-start]`
  kickoff for a browser driver; the script driver POSTs the chat path directly), fixed seed, fixed
  `x-orwell-user`.
- **Reuse, don't reinvent:** the scrub + Vault-key assertion list from `llm_trace.py` / 0107; the
  boot helper from `deploy/smoke.sh`; the lesson-17 live-env recipe (and its four traps) verbatim for
  the nightly record.
- **Do NOT** add any engine change; **do NOT** let the replay reach the provider; **do NOT** clip a
  record; **do NOT** make the replay job flaky (it must be deterministic); **do NOT** let the disabled
  path differ by a byte from today.

## Would it have caught the bugs that motivated it?

- **Yes (as a regression gate, once captured):** #967 (opener under-call), #969 (post-photo resume),
  #1007 (cast-authoring mass-fallback — invariant 4), F8/F14 advance under-calls (invariant 5), F16
  premature-result desync (invariant 6), and any reasoning/`npc:`/Vault leak into the body (invariant
  7) — each becomes a deterministic PR-time failure the instant the captured path regresses.
- **Yes (next-day):** the **nightly** catches a *new* prompt drift / model regression that the
  committed fixture's replay can't see.
- **No:** a brand-new LLM-behavioral fix is still **not** verified by this gate alone — a prompt change
  invalidates the fixture by design, and the new behavior must be live-verified (SOUL lesson 19) and the
  fixture regenerated. This gate stops us **re-discovering the same bug by hand**; it does not replace
  the first hand-verification of a new one.

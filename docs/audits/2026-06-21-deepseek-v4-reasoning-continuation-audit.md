# Audit — DeepSeek V4 Pro reasoning-continuation conformance (OpenRouter `reasoning_details`)

- **Date:** 2026-06-21
- **Type:** READ-ONLY conformance audit (no code changed).
- **Scope:** the FE narration agent loop's handling of reasoning tokens across multi-step tool
  rounds and multi-turn continuations, against OpenRouter's documented guidance to **preserve
  the complete `reasoning_details` array when passing messages back** to `deepseek/deepseek-v4-pro`.
- **Model under test:** `deepseek/deepseek-v4-pro` via OpenRouter `POST /api/v1/chat/completions`.
- **Files audited:** `frontend/src/agent_loop.py`, `frontend/src/llm_core.py`,
  `frontend/static/js/chat.js`.

> Roles only; no game-entity names used.

---

## TL;DR verdict per item

| # | Item | Verdict |
|---|------|---------|
| 1 | Inventory the reasoning lifecycle / round-trip | **SUPPORTED** (fully mapped below) |
| 2 | Does the FE preserve `reasoning_details` across turns? | **MISSING** — `reasoning_details` is never captured anywhere in `frontend/` (grep = 0 hits) |
| 3 | Is the strip-old-`reasoning_content` a correctness gap? | **PARTIAL** — defensible *given today's mechanism*, but it is a workaround for a problem the proper `reasoning_details` channel is designed to avoid |
| 4 | Tie to "wasted reasoning / text generates then disappears" | **PARTIAL** — the redundant-re-reasoning half is plausible and evidence-backed; the "visible-then-gone" half is a *separate*, already-handled scrub path, not caused by the strip |
| 5 | Streaming plumbing conforms (multi-field deltas, `reasoning_tokens`, accordion split) | **SUPPORTED** |

**Headline recommendation:** adopt **option (c), a hybrid** — capture OpenRouter's structured
`reasoning_details` from each response and pass it back **verbatim in the `reasoning_details`
field** of the prior assistant message (NOT re-rendered as `<think>` text in `content`), and keep
the existing strip of the *text* `reasoning_content` from older turns. This conforms to the
guidance while structurally sidestepping the `<think>`-re-injection loop the current code was built
to avoid. **Gated on a live A/B against `deepseek/deepseek-v4-pro`** (owner has a live key) before
any change — see §5.

---

## 1. The reasoning lifecycle round-trip (SUPPORTED)

### 1a. Streaming read — reasoning deltas (all provider field names)
`frontend/src/llm_core.py:1858`:
```python
reasoning = delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thinking") or ""
if reasoning:
    yield _stream_delta_event(reasoning, thinking=True)   # llm_core.py:1859-1860
```
Reasoning tokens are read from **all three** provider field shapes and emitted downstream as a
delta event flagged `thinking=True`. Public `content` is read separately at `llm_core.py:1861`.

### 1b. Agent-loop accumulation — `round_reasoning`
`frontend/src/agent_loop.py:3069` declares the per-round buffer; it is fed at
`agent_loop.py:3256-3258`:
```python
if data.get("thinking"):
    round_reasoning += data["delta"]
    yield chunk  # reasoning is filtered downstream; pass through
```
So within one round, all `thinking=True` deltas accumulate into `round_reasoning` (a plain string),
while public deltas accumulate into `round_response`.

### 1c. Attach to the assistant message — `reasoning_content`
`frontend/src/agent_loop.py:_append_tool_results` (lines 1212-1285). Two shapes:
- native-tool-call branch: `agent_loop.py:1251-1252` →
  `assistant_msg["reasoning_content"] = round_reasoning`
- fenced/prose branch: `agent_loop.py:1280-1281` → `msg["reasoning_content"] = round_reasoning`

### 1d. The strip of older turns
`frontend/src/agent_loop.py:1237-1240`:
```python
# Strip reasoning_content from earlier assistant turns; only the newest keeps it.
for _m in messages:
    if _m.get("role") == "assistant":
        _m.pop("reasoning_content", None)
```
This runs **every round, before the new assistant turn is appended** — so across the loop only the
single most-recent assistant message carries `reasoning_content`.

### 1e. Send back on the next iteration
The mutated `messages` list is the same object the loop re-submits on the next `round_num`
iteration (`for round_num in range(1, max_rounds + 1)` at `agent_loop.py:3066`); `_append_tool_results`
is called at the bottom of each round (`agent_loop.py:4432-4434`) and the loop then re-streams with
the updated history. So the round-trip is:

```
stream deltas (llm_core 1858) → round_reasoning (agent_loop 3257)
  → strip ALL prior assistant reasoning_content (agent_loop 1238-1240)
  → attach round_reasoning to the NEW assistant msg (agent_loop 1252 / 1281)
  → messages re-submitted next round (loop @ agent_loop 3066) → repeat
```

**Field name in flight:** the entire round-trip uses the bare string field **`reasoning_content`**
(DeepSeek's native API shape). OpenRouter's structured **`reasoning_details`** array is never
referenced.

---

## 2. Is `reasoning_details` preserved across turns? — MISSING (confirmed)

`grep -rn "reasoning_details" frontend/` returns **zero matches**. The structured array is:
- **never read** from the streaming deltas (`llm_core.py:1858` reads only the three string fields);
- **never read** from the non-streaming message (`_openai_message_text`, `llm_core.py:403-409`,
  reads `content`/`reasoning_content`/`reasoning`/`thinking` — not `reasoning_details`);
- **never accumulated** by the native tool-call assembler (`_tc_acc`, `llm_core.py:1704`,
  `1945-1968` captures only `id`/`name`/`arguments`/`extra_content`);
- **never attached** to an assistant message (`_append_tool_results` sets only `reasoning_content`);
- **never sent back** in any payload.

So OpenRouter's "preserve the complete `reasoning_details` when passing messages back" is **not
implemented in any form**. What the FE does today is a *lossy substitute*: it preserves the
**text** of only the **newest** turn's reasoning as `reasoning_content`, and discards everything
else (older turns entirely; the structured per-block array always).

**Verdict: MISSING.**

---

## 3. Is the strip CORRECT or a CONFORMANCE GAP? — PARTIAL

### The documented rationale (read in full)
`agent_loop.py:1222-1235` explains: `reasoning_content` is echoed back because *"DeepSeek's API
rejects follow-up requests in thinking mode that don't include the prior reasoning"* — but
Nemotron's chat template (and DeepSeek's own, per the owner's supplied note) **re-injects every
prior `reasoning_content` as a `<think>` block**, and because the agent loop trims only once
(before the loop), reasoning *"piles up unbounded — bloating context and feeding the model its own
prior reasoning, which reinforces repetition/looping."* Hence: keep `reasoning_content` on the
**most recent** assistant turn only.

### Are the two scenarios the same or different?
They are **different in cardinality but identical in mechanism**, and that distinction is the crux:

- **OpenRouter's guidance** targets a *chat continuation* where preserving reasoning lets the model
  *continue a thought*. It says to preserve **`reasoning_details`** — the **structured array**,
  passed back **in the `reasoning_details` field**, which the provider treats as opaque reasoning
  context. It does **not** say "re-render prior reasoning as `<think>` text inside `content`".
- **Orwell's loop** is a multi-**step** tool-calling agent loop *within one player turn* (many
  rounds per turn). The looping the comment describes comes specifically from prior reasoning being
  **re-materialized as `<think>` text in the visible content channel** and fed back, round after
  round.

The key insight: the strip is a workaround for a **`reasoning_content`-as-text re-injection**
problem. The proper **`reasoning_details`** mechanism is designed to carry reasoning back as
**structured, opaque context that the provider does not re-emit as `<think>` content** — i.e. the
very failure mode (the model reading its own prior `<think>` prose and looping) is what the
structured channel is meant to avoid. So:

- The strip is a **reasonable, defensive workaround for the mechanism the code uses today**
  (string `reasoning_content`), and removing it naively (going back to full text preservation)
  would risk re-introducing the documented looping. **It is not obviously wrong.**
- But it is **also a conformance gap**: the code never adopted the `reasoning_details` channel that
  OpenRouter recommends precisely so reasoning can be preserved across turns *without* the
  loop-inducing text re-injection. The current design preserves the *wrong field, lossily*.

**Verdict: PARTIAL** — defensible given today's mechanism; a gap relative to the recommended
`reasoning_details` mechanism. The correct fix is not "stop stripping" but "stop using the
loop-prone text channel and adopt the structured one."

> Caveat worth stating plainly: whether `deepseek/deepseek-v4-pro` actually *requires* prior
> reasoning on follow-ups, whether OpenRouter re-emits passed-back `reasoning_details` as `<think>`
> content (it should not), and whether the structured channel avoids the loop in *this* agent loop,
> are all **empirical** and must be confirmed live (§5). The comment's claim that DeepSeek "rejects
> follow-ups without prior reasoning" is provider-version-specific and may not hold on the current
> OpenRouter shape.

---

## 4. Tie to "wasted reasoning / text generates then disappears" — PARTIAL

Two distinct sub-claims; assess separately.

### 4a. Redundant re-reasoning (wasted tokens) — PLAUSIBLE, evidence-backed
Because older turns' reasoning is **stripped** and `reasoning_details` is **never** carried, the
model on each later round/turn has **no record of its own prior reasoning** (beyond the immediately
preceding turn's `reasoning_content` text). OpenRouter's guidance — *"so it can continue reasoning
from where it left off"* — implies the **intended** behavior is that preserved reasoning lets the
model resume rather than re-derive. Without it, the model can **re-reason from scratch** each
round, which directly inflates `reasoning_tokens` (the dominant cost driver, per the ADR-0010
comments at `llm_core.py:1817-1819`). The reasoning-token meter is wired
(`agent_loop.py:3218`, `llm_core.py:1826-1827/1404`), so this is **measurable** — see §5. This is a
**plausible, concrete mechanism** for the "wasted reasoning" symptom. Stated as a hypothesis, not a
proven cause.

### 4b. "Text generates then disappears" (visible-then-gone) — SEPARATE PATH, not the strip
This symptom is **not** caused by `reasoning_content` stripping. The "disappearing text" surfaces
have independent, intentional handlers:
- **Channel split (by design):** reasoning deltas (`thinking=True`) are routed to the live
  **Thinking accordion** and **never** the public bubble — `chat.js:1478-1480`
  (`if (json.thinking) roundReasoningText += json.delta; else roundReplyText += json.delta;`). The
  body renders only `roundReplyText` (`chat.js:1297`, `2162`, `2861`). So reasoning *appears* in the
  accordion and is *absent* from the body by construction — expected, not a bug.
- **Live-game leak scrub:** in a live game, once tool-call/operator-aside markup appears mid-stream,
  visible emission halts and the raw text is scrubbed before the player sees it
  (`agent_loop.py:3259-3279`). Visible text the player briefly saw can be replaced by cleaned
  narration — again intentional, and unrelated to reasoning preservation.
- **Empty-response fallback:** when a thinking model routes *all* tokens to reasoning and leaves
  `content=""`, `_empty_response_fallback` (`agent_loop.py:2491-2512`) persists the reasoning text
  rather than emitting a blank bubble. If this fires, the player can see reasoning-derived text
  appear where a normal reply was expected.

So: the "wasted reasoning" half is plausibly tied to non-preservation (4a). The "visible-then-gone"
half is most likely the **reasoning/scrub channel routing** (4b), which is orthogonal to the strip
and would not be fixed by adopting `reasoning_details`. **Do not conflate the two.**

**Verdict: PARTIAL** — non-preservation plausibly explains wasted reasoning tokens; the
disappearing-text symptom is a separate, already-owned path. Both need the live reproduction in §5
to attribute confidently.

---

## 5. Recommendation — hybrid (c), live-gated

### Recommended change (option c — hybrid)
1. **Capture** OpenRouter's `reasoning_details` array from each response:
   - streaming: accumulate it alongside `round_reasoning` (it arrives as deltas on the message /
     delta object — needs a new accumulator near `llm_core.py:1858`, and must be threaded out of the
     stream as its own event the way `tool_calls`/`usage` are);
   - non-streaming: read `data["choices"][0]["message"]["reasoning_details"]` near
     `llm_core.py:1414`.
2. **Store** it on the assistant message in `_append_tool_results` as the **`reasoning_details`**
   field (structured array, verbatim) — both branches (`agent_loop.py:1252` / `1281`).
3. **Send it back verbatim** in the `reasoning_details` field of prior assistant turns (do **not**
   strip these, and do **not** re-render them as `<think>` text in `content`). Confirm the message
   sanitizers preserve the field (`llm_core.py:808` `allowed` set in the Anthropic-conversion path
   would currently drop an unknown key — verify/whitelist before relying on it).
4. **Keep** the existing strip of the **text** `reasoning_content` from older turns (so no
   `<think>`-as-content re-injection survives) — i.e. structured channel in, text channel out.

This conforms to "preserve the complete `reasoning_details`" while structurally avoiding the
documented looping, which was caused by the *text* channel, not the structured one.

### Why not (a) pure-adopt or (b) keep-as-is
- **(a) Pure adopt + drop the strip blindly** risks regressing the documented looping if OpenRouter
  (or DeepSeek behind it) ever materializes passed-back reasoning as `<think>` content. Don't remove
  the text-strip safety net until the live test proves the structured channel doesn't re-inject.
- **(b) Keep as-is** leaves the conformance gap and the plausible wasted-reasoning cost on the table.

### MANDATORY live-test gate (before changing anything)
The owner has a live `deepseek/deepseek-v4-pro` key and insists on live verification. None of the
automated gates exercise a real model (all stub the LLM — `DeterministicNarrator`/`Echo…`), so this
**cannot** be validated by the existing suite. Run an A/B over a multi-round tool-calling turn (and
a multi-turn continuation) on the live model and confirm:
1. **Does the live model actually emit `reasoning_details`** on the chat/completions shape, and in
   what structure (so the accumulator/passthrough match)?
2. **Does passing `reasoning_details` back reduce `reasoning_tokens` on later rounds/turns?** Use the
   already-wired meter (`agent_loop.py:3218`, `llm_core.py:1826`) to A/B (preserve vs. not). This
   directly tests the §4a "wasted reasoning" hypothesis.
3. **Does preserving `reasoning_details` re-introduce repetition/looping** in this agent loop, or
   does the structured channel avoid it (the whole premise of the strip)? Watch for repeated
   tool calls / repeated narration across rounds.
4. **Does the provider re-emit** passed-back `reasoning_details` as `<think>` text in a later round's
   `content`? If yes, the text-strip safety net (step 4 above) must stay; if no, the strip could
   eventually be relaxed.
5. **Does DeepSeek actually reject** thinking-mode follow-ups that omit prior reasoning (the
   comment's load-bearing premise at `agent_loop.py:1225-1227`)? If it no longer does, part of the
   strip's justification is moot.

Do not merge any change until 1–4 are answered against the live model.

---

## Streaming-plumbing conformance checklist (SUPPORTED)

| Check | Evidence | Status |
|---|---|---|
| Reasoning deltas read from all provider field names (`reasoning_content` / `reasoning` / `thinking`) | `llm_core.py:1858` (streaming); `_openai_message_text` `llm_core.py:403-409` (non-streaming) | ✅ |
| `usage.reasoning_tokens` captured from the trailing chunk | streaming `llm_core.py:1826-1827`; non-streaming `llm_core.py:1404`; accumulated in the loop `agent_loop.py:3218`; final metric `agent_loop.py:4538` | ✅ |
| Reasoning rendered in the Thinking accordion, separate from the public bubble | `chat.js:1478-1480` (split), body renders `roundReplyText` only `chat.js:1297/2162/2861`, accordion renders `roundReasoningText` `chat.js:1668-1670` | ✅ |
| Reasoning never leaks into `content` | content read separately `llm_core.py:1861`; FE split by construction `chat.js:1479`; `_stripThink` belt-and-braces `chat.js:5248-5254` | ✅ |
| Reasoning request param enabled provider-aware for OpenRouter/DeepSeek | `_apply_reasoning_budget` `llm_core.py:585-622` (OpenRouter unified `reasoning` map, explicit-off `{"enabled": false}`) | ✅ |

The **inbound** reasoning plumbing (read, meter, route, scrub) is conformant and robust. The **gap
is purely on the outbound continuation path**: the structured `reasoning_details` array is never
captured or passed back, so OpenRouter's cross-turn-preservation guidance is unmet.

---

## Cited file:line index

- `agent_loop.py:1222-1235` — strip rationale comment (DeepSeek/Nemotron `<think>` re-injection → looping)
- `agent_loop.py:1237-1240` — the strip (`pop("reasoning_content")` from all prior assistant turns)
- `agent_loop.py:1251-1252`, `1280-1281` — attach `round_reasoning` as `reasoning_content`
- `agent_loop.py:3066` — the per-turn agent round loop
- `agent_loop.py:3069` — `round_reasoning` per-round buffer
- `agent_loop.py:3218` — accumulate `reasoning_tokens` into the meter
- `agent_loop.py:3256-3258` — accumulate `thinking` deltas into `round_reasoning`
- `agent_loop.py:4432-4434` — `_append_tool_results` call (re-submits `messages`)
- `agent_loop.py:2491-2512` — empty-response (all-reasoning) fallback
- `llm_core.py:403-409` — `_openai_message_text` (non-streaming reasoning fields; no `reasoning_details`)
- `llm_core.py:585-622` — `_apply_reasoning_budget` (OpenRouter unified `reasoning` enablement)
- `llm_core.py:1404` — non-streaming `reasoning_tokens` capture
- `llm_core.py:1704`, `1945-1968` — native tool-call accumulator (no `reasoning_details`)
- `llm_core.py:1826-1827` — streaming `reasoning_tokens` capture
- `llm_core.py:1858-1860` — streaming reasoning delta read (all three string fields)
- `chat.js:1478-1480` — public/reasoning buffer split
- `chat.js:1297 / 2162 / 2861` — body renders reply-only buffer
- `chat.js:5248-5254` — `_stripThink` belt-and-braces
- **`reasoning_details` — 0 occurrences across `frontend/`** (the gap)

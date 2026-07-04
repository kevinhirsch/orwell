# 0016 — LLM model selection: GLM-4.7 narrator (reasoning-low), GLM-4.7-Flash utility, Seedream portraits

> **Status:** **Accepted** (PO direction, 2026-06-29 — the model-selection research thread).
> **Source:** a six-lane research sweep (mainstream-hosted + open-weight candidates, community/practitioner
> sentiment, tool-calling & creative-writing benchmarks, current pricing, and self-host feasibility on the
> operator's **2× RTX 2080 Ti**, 44 GB Turing box) reconciled against the project's own audit log + GitHub
> issues — the narrator tool-under-call cluster (#1105/#1033/#549/#1127…), the reasoning-leak cluster
> (#873/#1047/#1143), the cast-authoring strict-JSON failures (#1002/#1007), and the portrait/pronoun
> mismatch (#1140).
> **Amends:** ADR [`0010`](./0010-token-economy-architecture.md) — the owner-ratified
> `reasoning_budget.narration` effort moves **`medium` → `low`** (rationale below). Every other 0010 ruling
> stands; the per-class reasoning architecture is unchanged and is exactly the seam this rides.
> **Builds on / bounded by:** the **Vault Wall** (mandate #2) and **anti-sycophancy** (mandate #3) — both
> unchanged; ADR 0003 (the conversation is the game), ADR 0005 (split authority by openness). This is a
> **provider/config** decision: no new Vault reader, no authority over outcomes, the engine/closed set is
> untouched — not one byte of gameplay logic changes.

## Context

The OOB narrator was `deepseek/deepseek-v4-pro`. It is cheap and, by independent benchmark, a strong
tool-caller (τ²-bench telecom ~96%) — yet the project's own telemetry shows it **fails this harness on the
two axes that matter most**:

1. **Tool-calling, structurally.** DeepSeek V4 runs in thinking mode by default and **rejects
   `tool_choice="required"`** (HTTP 400 *"Thinking mode does not support this tool_choice"*); in real agent
   runs it then chooses **not** to call the tool ~40 % of the time, replying with free text, and ~11 % of the
   time emits a tool call as unparseable plain text in `content` (deepseek-ai/DeepSeek-V3 #1376, #1244). This
   is the structural root of the harness's measured **~0 % spontaneous tool-call rate** and the reason ~12 FE
   guardrails exist to compensate.
2. **Creative regression.** DeepSeek V4 added a positivity bias that *softens conflict* and loses
   character-voice attribution past ~12 K tokens — directly degrading the betrayal/scheming drama and the
   ~16 distinct voices that **are** behavioral fidelity (mandate #1).

Constraints that shape the choice: **cost-sensitive — the Claude API is ruled out**; the operator self-hosts
on a **2× RTX 2080 Ti (44 GB, Turing)** box, where every *frontier* open-weight tool-caller is far too large
but a ~30B-A3B MoE runs fast. Separately, the utility lane failed (#1002/#1007: DeepSeek emitted prose, not
JSON → 0/15 cast profiles authored), and portraits mismatch the narrated gender/pronouns (#1140).

## Decision

### A. Narrator — `z-ai/glm-4.7` (OpenRouter), reasoning **`low`**

GLM-4.7 is the cheapest model that **fixes the structural tool-call bug** while *upgrading* the writing: it
is the #1 open-weight creative writer, uncensored (won't soften betrayal), has the best open JSON/tool-schema
discipline, and — unlike DeepSeek — its tool-calling **rides on interleaved thinking** (it reasons *before
each tool call / action*). It therefore honors `tool_choice` and has no "thinking blocks forced calls"
defect.

Because GLM-4.7's tool *decisions* ARE its interleaved thinking, the narrator runs reasoning **`low`**, not
`off`: a small budget is precisely what lets it decide *which* engine tool to call; `off` would strip that
mechanism and regress "call the tool when we need to." `low` keeps it at modest cost/latency (GLM-4.6's old
thinking-loop stalls are fixed in 4.7). → `DEFAULT_SETTINGS.reasoning_budget["narration"] = "low"` (the
`token_policy.py` model-agnostic *code* default stays `medium`; the shipped GLM-4.7 *preset* is `low`).

Reasoning hygiene is preserved structurally (mandate #2): GLM-via-OpenRouter returns reasoning on the
separate channel the FE already splits on (`json.thinking`). **Pin the provider** and assert reasoning is
actually suppressed/sized — reasoning control is flaky on some OpenRouter sub-providers (e.g. Cerebras).

The narrator's reasoning effort is now editable **in the Default Chat Model settings card**
(`set-narratorReasoning`), kept in lockstep with the Token Economy "Narration" select — both write
`reasoning_budget.narration`.

### B. Utility — `z-ai/glm-4.7-flash`

The background JSON lane (cast authoring / prewarm / zeitgeist / summarization / naming) moves to
GLM-4.7-Flash: cheap ($0.06 / $0.40 per 1M; **free on Z.ai-direct**), fast (30B-A3B), non-reasoning, honors
`response_format`. It is its **own** `utility_model` key — it does **not** inherit the narrator swap.
Background classes already run reasoning `off`. (Self-hosting this same class on the operator's box —
Qwen3-30B-A3B-Instruct @ Q6 via `llama-server`, `enable_thinking=False` at template-apply — is a documented
zero-cost option, but the hosted Flash is the OOB default.)

### C. Portrait — Seedream v5 Lite Sequential via fal.ai · *follow-up build*

The #1140 fix is **reference-image conditioning**: generate one canonical headshot per houseguest, persist
it, and regenerate *against* it so face + gender stay stable instead of re-rolling from text. Seedream v5
Lite "Sequential" is the chosen model. It is **not on OpenRouter** (OpenRouter's newest Seedream is 4.5, and
OpenRouter has **frozen** the `/chat/completions` image path the current Gemini portraits use — new image
models live behind a separate `/api/v1/images` endpoint). So this requires a **new fal.ai provider client**
(`fal-ai/bytedance/seedream/v5/lite/edit`; references via `image_urls`; ~$0.035/img). Tracked as a separate
feature build; the OOB `image_model` stays `google/gemini-2.5-flash-image` until it lands.

### D. `tool_choice` force-call at critical beats · *follow-up build*

GLM-4.7 honoring `tool_choice` unlocks a capability DeepSeek V4 blocked: at the closed-set beats where a
missed engine call is catastrophic (HOH result, nominations, veto, eviction), the FE can send
`tool_choice="required"` (or a named function) to **force** the call instead of relying on the model's whim +
reactive guardrails. This is **additive** — the model's good spontaneous interleaved calling is primary, the
forced call is the guarantee on top, and the existing FE error-correction (`_auto_record_scene`, the
stall-nudge, the forced `advanceGame`) is the third net. The `tool_choice` param is *currently deliberately
never sent* (2026-06-21 OpenRouter conformance audit); this build adds it, scoped to the critical beats.

## Rationale

- **Why not just keep cheaper DeepSeek:** the `tool_choice` defect is identical on V4-Flash and V4-Pro, so
  "cheaper DeepSeek" keeps the bug. GLM-4.7 fixes it for ~2× the *output* price (still ~10× under Claude
  Sonnet), and GLM-4.7-Flash is near-free.
- **Why `low`, not `off` (the load-bearing call):** GLM ≠ DeepSeek. DeepSeek's thinking *blocked* tools (a
  bug); GLM's thinking *drives* tools (interleaved — a feature). Disabling it recreates the under-call
  problem we're escaping. This reverses the earlier "thinking-off" lean, which had wrongly carried the
  DeepSeek lesson across.
- **Why not Kimi / Gemini-Flash (the other cheap options):** Kimi leaks reasoning *and raw tool-call tokens*
  into the visible channel on **sparse** toolsets — a bullseye on this harness's Vault Wall; Gemini Flash
  cannot disable thinking and leaks reasoning into the body, and scores ~15 % on multi-turn tool calls. Both
  fail this harness's hard gates regardless of price.

## Consequences / follow-ups

- **Built with this ADR:** the narrator reasoning posture (`low`), the utility default
  (`z-ai/glm-4.7-flash`), the narrator-area reasoning control, and the source-pin tests
  (`frontend/tests/test_adr0010_settings_ui.py`, `test_default_model_resolution.py`,
  `test_adr0010_admin_token_economy.py`). The narrator default-string swap (`deepseek/deepseek-v4-pro` →
  `z-ai/glm-4.7`) lands alongside (parallel work).
- **Follow-up PRs:** (C) the fal.ai Seedream v5 Lite provider + the per-houseguest reference-persistence
  pipeline; (D) the `tool_choice` force-call at critical beats.
- **Owed live verification** (features 0107/0108, real-model golden path): GLM reasoning never reaches the
  public bubble; `tool_choice` + thinking interop on the pinned provider; and an A/B of narration quality +
  tool-call rate vs the DeepSeek incumbent (with DeepSeek V3.2 as a same-ecosystem craft control).

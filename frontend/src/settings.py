# src/settings.py
"""Centralized settings and features management.

Single source of truth for reading/writing data/settings.json and data/features.json.
All modules should import from here instead of accessing files directly.
"""

import os
import json
import time
import logging
from typing import Any

from src.constants import SETTINGS_FILE, FEATURES_FILE, known_theme_names_ordered

logger = logging.getLogger(__name__)

# Tiny TTL cache for settings/features. get_setting() is called on hot paths
# (every chat, every preprocess); without this it re-parses the JSON each call.
# Picks up edits within _CACHE_TTL seconds, which is fine for human-edited config.
_CACHE_TTL = 2.0
_settings_cache: tuple[float, dict] | None = None
_features_cache: tuple[float, dict] | None = None

def _invalidate_caches():
    global _settings_cache, _features_cache
    _settings_cache = None
    _features_cache = None

# ── Default values ──

DEFAULT_SETTINGS = {
    # ADR 0006 - the in-game time-of-day clock + nightly sleep economy (the engine's ORWELL_TIME_OF_DAY).
    # ON by default; the settings switch flips it on the LIVE engine (admin setTimeOfDay) with no restart.
    "time_of_day_enabled": True,
    # #1154 / ADR 0016 §D - FORCE the engine call (tool_choice) at the closed-set, ENGINE-OWNED beats
    # where a missed call is catastrophic: runCompetition (read the comp winner) at a competition phase
    # and advanceGame at a stalled ceremony/eviction advance-phase (incl. the goodbye-message/eviction
    # drain). NEVER forces submitDecision (that carries the PLAYER's explicit pick) and is suppressed by
    # any open player pending. ON by default; this is the runtime KILL-SWITCH so forcing can be disabled
    # without a redeploy (read per-turn, no restart). OFF ⇒ the agent loop never sends tool_choice,
    # falling back to the spontaneous call + the reactive belts (stall-nudge, forced advanceGame,
    # _auto_record_scene) exactly as before this feature.
    "force_tool_choice_at_beats": True,
    # #764 - the animated background SOURCE behind the (pre-auth) login glass panel.
    # Cosmetic-only enum; the login page reads it via the PUBLIC GET
    # /api/auth/login-background. One of: gradient (default) | photo | particles | bundled.
    "login_background": "gradient",
    # Optional photo URL used only when login_background == "photo" (http(s) or a
    # same-origin "/" path; anything else is ignored). Set by the admin URL field OR
    # by the admin photo UPLOAD (which stores the file and points this at it). Cosmetic.
    "login_background_photo_url": "",
    # Gradient cosmetic settings — a named palette PRESET + drift speed + intensity.
    # preset: sunset | aurora (default) | ocean | gold | lavender.
    "login_gradient_preset": "aurora",
    "login_gradient_speed": 26,        # seconds per drift cycle (8..60)
    "login_gradient_intensity": 1.0,   # 0.4..1.4
    # Particle cosmetic settings — density + speed + dot color.
    "login_particles_density": 64,     # 12..160
    "login_particles_speed": 0.25,     # 0.05..1.2
    "login_particles_color": "",       # blank ⇒ default neutral white (client floor)
    "image_gen_enabled": True,
    # OOB default image model. OpenRouter is the default provider and serves Google's Gemini
    # flash-image models via /chat/completions; gemini-3.1-flash-image is the out-of-box pick —
    # newest-generation Gemini photorealism at ~current-default cost (~1.2x gemini-2.5-flash-image,
    # ~4x cheaper than gemini-3-pro-image), and it does reference-image identity-carry on the same key.
    # (Overridable in Settings → Image generation; the "Auto-detect" option resolves to the same
    # family — see IMAGE_AUTODETECT_CANDIDATES in src/ai_interaction.py.)
    "image_model": "google/gemini-3.1-flash-image",
    "image_quality": "medium",
    "vision_model": "",
    "vision_enabled": True,
    # Ordered fallback chain for the Vision model (image analysis, OCR, tagging).
    "vision_model_fallbacks": [],
    # Public base URL used to build clickable deep-links in outgoing alerts
    # (e.g., urgency alert email). Example: "https://chat.example.com"
    "app_public_url": "",
    "tts_enabled": True,
    "tts_provider": "disabled",
    "tts_model": "tts-1",
    "tts_voice": "alloy",
    "tts_speed": "1",
    "stt_enabled": False,
    "stt_provider": "disabled",
    "stt_model": "base",
    "stt_language": "",
    "search_provider": "searxng",
    # Default fallback chain — when the primary provider fails or
    # rate-limits, we try DuckDuckGo next. Free, no API key required, so
    # safe to ship on by default for every user.
    "search_fallback_chain": ["duckduckgo"],
    "search_url": "",
    "search_result_count": 5,
    # SafeSearch level applied to every provider that exposes one.
    # "strict"   — block adult / explicit results (default; matches what users
    #              expect from a research tool and avoids unrelated NSFW URLs
    #              bleeding in via provider "related" / spam recommendations)
    # "moderate" — provider-default behavior (filter explicit but allow
    #              suggestive content)
    # "off"      — disable filtering entirely (advanced users only)
    #
    # Providers that honor this setting (translated to each provider's native
    # param in src/search/providers.py:_safesearch_for):
    #     SearXNG       safesearch=0/1/2 (JSON API, HTML scrape, news fallback)
    #     Brave Search  safesearch=off/moderate/strict
    #     DuckDuckGo    safesearch=off/moderate/on (library + HTML kp param)
    #     Google PSE    safe=active (omitted for "off"; PSE has no middle tier)
    #     Serper.dev    safe=active (omitted for "off"; proxies Google's `safe`)
    # Providers NOT touched: Tavily (no SafeSearch knob; filters at index time)
    # and any custom backend reached via search_url — they keep whatever the
    # backend itself decides, so operators stay in control of self-hosted /
    # niche search instances.
    "search_safesearch": "strict",
    "brave_api_key": "",
    "google_pse_key": "",
    "google_pse_cx": "",
    "tavily_api_key": "",
    "serper_api_key": "",
    "research_endpoint_id": "",
    "research_model": "",
    "research_search_provider": "",
    "research_max_tokens": 16384,
    "research_extraction_timeout_seconds": 90,
    # Lightweight planning/query LLM calls happen before any search starts.
    # Keep them separately tunable so slow local backends are not capped by
    # the old 30s/60s per-call defaults.
    "research_planning_timeout_seconds": 90,
    "research_query_timeout_seconds": 90,
    "research_extraction_concurrency": 3,
    # Hard wall-clock cap on a single deep-research run. The previous 600s
    # (10 min) default cut off slow local / edge LLMs mid-synthesis; 1800s
    # (30 min) is comfortable for most local setups while still bounding
    # runaway jobs. Set to 0 to disable the cap entirely (unlimited) — only
    # for very long deep-research runs, since a stalled job then runs an
    # unbounded model/API bill. Other values are bounded to [60, 86400].
    # Tune via Settings or by editing data/settings.json.
    "research_run_timeout_seconds": 1800,
    "agent_max_tool_calls": 0,
    "agent_max_rounds": 20,  # per-message agent step cap (clamped 1..200)
    "agent_input_token_budget": 6000,
    # Ceiling on the *auto-derived* input budget that #1230 introduced. Has
    # no effect when `agent_input_token_budget` is explicitly changed off its
    # default (the user's value is honoured regardless). Default matches
    # `src.context_budget.DEFAULT_HARD_MAX` (48k — a cost-bounded fraction of a
    # long-context window that still fits the whole narrative conversation, so
    # NPCs stay consistent turn to turn); lower this for cost-paranoid setups,
    # raise it on premium APIs with very large windows that you want to actually
    # use (e.g. 900_000 to fill a 1M-context model). See `compute_input_token_budget`
    # in src/context_budget.py.
    "agent_input_token_hard_max": 48_000,
    "agent_stream_timeout_seconds": 300,
    # ADR 0010 / feature 0069 (token economy) — the admin-editable per-class
    # reasoning budget. Maps a call class to a reasoning effort. Defaults to the
    # owner-ratified OPTIMIZED efforts (ADR 0010 Owner rulings #1), AMENDED by ADR 0016: casting =
    # medium (quality-sensitive, player-facing), narration = **low** (the GLM narrator — see the
    # inline note below), background-authoring = low (background flavor), and **utility-extraction =
    # off** — pure JSON
    # extraction/classification whose prompts forbid thinking; the 2026-06-21 I/O
    # trace showed its reasoning tokens wasted.
    # Valid classes are exactly token_policy.CALL_CLASSES; valid efforts are
    # token_policy.valid_efforts() ("off", "low", "medium", "high"). NOTE: "off" is
    # now a GENUINE disable, not an omission — token_policy resolves it and
    # llm_core._apply_reasoning_budget actively sends `reasoning:{"enabled":false}`
    # to OpenRouter (verified upstream via debug.echo_upstream_body), so a reasoning
    # model can no longer fall back to its (higher) default. "off" IS a real cost
    # floor now; "low" is the lowest non-zero effort. A class absent from the map
    # uses the token_policy code default. Read via
    # get_setting("reasoning_budget", {}) → token_policy.resolve_token_policy();
    # edit per class at runtime via the Token Economy settings card or POST /api/settings.
    "reasoning_budget": {
        # ADR 0016: "low" (was "medium") for the GLM narrator (GLM-4.7 at the ruling; GLM-5.2 since
        # the 2026-07-07 two-tier amendment — same family, same posture). GLM's tool-calling rides on
        # INTERLEAVED THINKING — it reasons before each tool call/action — so a small reasoning budget
        # is what lets it DECIDE which engine tool to call ("off" would strip that mechanism and regress
        # "call the tool when we need to"; "low" keeps it at modest cost/latency). Runtime-editable from
        # the Default Chat Model settings card (and the Token Economy card) — both write this key.
        "narration": "low",
        "utility-extraction": "off",
        "casting": "medium",
        # #1007: OFF, not "low". Cast authoring is structured JSON extraction, not a reasoning
        # task — the strict-JSON prompt forbids thinking. On a reasoning model (deepseek-v4-pro)
        # an enabled reasoning channel burned ~1300 tokens BEFORE any visible JSON, blowing the
        # output cap (finish_reason=length, empty body) → "no JSON found" → the whole cast fell
        # to the deterministic floor (LIVE-CONFIRMED 0/15). token_policy + llm_core._apply_reasoning_budget
        # turn "off" into an active reasoning:{"enabled":false} on the wire, so the model emits the
        # JSON directly. Direct probe: reasoning-off returns valid JSON in ~278 tokens.
        "background-authoring": "off",
    },
    # ADR 0010 / feature 0069 follow-on #1 — the admin-editable per-class `max_tokens` OUTPUT cap.
    # The sibling of reasoning_budget: maps a call class to its output-token ceiling. Defaults mirror
    # token_policy._DEFAULT_MAX_TOKENS. Valid classes are token_policy.CALL_CLASSES; a value must be an
    # in-band positive int (token_policy.max_tokens_bounds(), 256..200000) — anything out-of-band /
    # non-int / non-positive is rejected by the resolver and the class default stands, so a fat-fingered
    # 0 or 10_000_000 can never become the live cap. A class absent from the map uses the code default.
    # Read via get_setting("max_tokens_budget", {}) → token_policy.resolve_token_policy(); edit per class
    # at runtime via the Token Economy settings card or POST /api/settings. Player never sees these.
    #
    # A9 (ship-blocker, 2026-07-03 audit, 6x corroborated): narration/casting are DELIBERATELY ABSENT
    # here. token_policy.resolve_token_policy treats any in-band value under this key as an EXPLICIT
    # ADMIN OVERRIDE that always wins over the class default — so seeding "narration": 4096 /
    # "casting": 2048 silently re-activated the exact #835/#620 NARR-5 truncation vector token_policy's
    # own _DEFAULT_MAX_TOKENS comment documents: on a reasoning model (the GLM narrator, ADR 0016)
    # reasoning tokens count against `max_tokens`, so a flat 4096/2048 ceiling produced empty response
    # bodies or mid-sentence truncation. The class default for narration/casting is `None` ("use the
    # model-aware cap computed at the call site from the concrete model") — leaving them OUT of this
    # dict is what lets that default actually take effect; adding a literal int back here would
    # reintroduce the bug. An admin who wants a real ceiling can still set one at runtime via the Token
    # Economy settings card / POST /api/settings — that stays a genuine, in-band, intentional override.
    "max_tokens_budget": {
        "utility-extraction": 1500,
        # #1007: 1200 → 3000 to MATCH the token_policy class default (_DEFAULT_MAX_TOKENS). This
        # seed is an in-band override that WINS over that default, so the #1002/#1007 raise to 3000
        # was DEAD until this seed moved too — at 1200 a full authored JSON profile could not fit
        # alongside even a little reasoning. 3000 = the comfortable floor for the whole JSON object.
        # (background-authoring is non-reasoning structured extraction, not a reasoning-headroom
        # concern, so a literal cap here is safe — unlike narration/casting above.)
        "background-authoring": 3000,
    },
    # ADR 0010 / feature 0069 — the soft per-game spend-alert threshold in USD.
    # 0.0 = alert off. Compared against the running per-session cost total via
    # orwell_token_ledger.check_soft_alert (strictly-over semantics).
    "token_spend_alert_usd": 0.0,
    # ADR 0010 / feature 0069 slice C — the high-token provider-PIN threshold (input tokens).
    # 0 = off (default; fallbacks always on => byte-identical routing). When > 0, a live-game
    # request whose recent input exceeds it asks OpenRouter to pin the (cache-warm) provider with
    # no fallback, so a large prompt never cold-cache-misses on a fallback; small calls keep
    # fallbacks on for availability. Per-session stickiness (the `user` field) is always on.
    "token_pin_threshold_tokens": 0,
    # ADR 0010 / feature 0069 slice D — opt-in non-degradation context tiering. False (default) keeps
    # the lean budget (auto-derived, capped at agent_input_token_hard_max) => byte-identical. True lets
    # a long game GROW its input budget toward the model window (~0.85x) BEFORE older turns are trimmed
    # away, so history is kept (mandate #4) instead of lost to lossy compaction. Costs more on long
    # games (watch the token-economy meter); only helps on large-context models.
    "context_tiering_enabled": False,
    # ADR 0010 / feature 0069 slice C — an OpenRouter `provider` routing object sent on live-game
    # calls (https://openrouter.ai/docs/guides/routing/provider-selection). A free-form dict of the
    # documented fields — e.g. {"sort": "throughput"}, {"order": ["deepinfra/turbo"],
    # "allow_fallbacks": false}, {"only": ["deepinfra"]}, {"max_price": {"prompt": 1, "completion": 2}},
    # {"zdr": true}, {"data_collection": "deny"}, {"quantizations": ["fp8"]}. Default {} = OpenRouter's
    # normal price-based load balancing. Edit at runtime via POST /api/settings (admin). It is the BASE
    # routing config; the high-token pin (token_pin_threshold_tokens) overlays allow_fallbacks=false on
    # large prompts. Only applied for OpenRouter-routed game turns; a non-dict value is ignored.
    "openrouter_provider": {},
    # Extra directory roots that read_file / write_file may access, in
    # addition to the built-in project data/ and system temp dirs. Each
    # entry is an absolute path. Sensitive subpaths (.ssh, .gnupg, shell
    # rc files, SSH key files) are always blocked regardless of roots.
    "tool_path_extra_roots": [],
    "task_endpoint_id": "",
    "task_model": "",
    "default_endpoint_id": "",
    # OOB default chat/narration model. OpenRouter is the default provider (added at first-run
    # setup); z-ai/glm-5.2 is the out-of-box selected model (chat box + narrator + onboarding all
    # read this resolved default) — the 2026-07-07 two-tier owner decision (ADR 0016 amendment,
    # confirmed as the OOB pair 2026-07-09; the M0-1 golden fixture + golden-nightly record on the
    # same pair). `default_endpoint_id` stays empty so resolution binds it to the
    # first enabled endpoint (the OpenRouter one the setup wizard creates); the setup wizard also
    # writes the endpoint id explicitly once it exists.
    "default_model": "z-ai/glm-5.2",
    # Ordered fallback chain for the default chat model. Each entry is
    # {"endpoint_id": "...", "model": "..."}. If the primary model fails
    # before producing output (endpoint offline / errors), the chat
    # dispatch retries the next entry in order.
    "default_model_fallbacks": [],
    "utility_endpoint_id": "",
    # OOB utility model (ADR 0016 as amended 2026-07-07/09 — the two-tier pair): Qwen 3.6 Flash on
    # OpenRouter — the cheap, fast flash tier for background JSON work (cast authoring/prewarm/
    # zeitgeist, summarization, naming); verified tool-calling clean on the M0-1 golden record runs
    # (locally served in prod; deepseek/deepseek-v4-flash is the cloud alternate). NOTE it reasons by
    # default (~266 reasoning tokens on a trivial call) — the per-class reasoning budgets below
    # ("off" for the JSON classes) are the cost lever. It is its OWN key (utility_model), so it does
    # NOT inherit the narrator swap. `utility_endpoint_id` stays "" so it binds to the first enabled
    # endpoint (the OpenRouter one the setup wizard creates).
    "utility_model": "qwen/qwen3.6-flash",
    # Ordered fallback chain for the Utility model (summarization, naming,
    # tidy actions, etc.).
    "utility_model_fallbacks": [],
    # Feature 0081 — the DEDICATED faithfulness-judge model (the narration-faithfulness gate's LLM).
    # Unset ⇒ resolve_endpoint("faithfulness") falls back to the Utility model, then the Default chat
    # model. Operator config (global; the AI Settings tab is admin-only); persisted via /api/auth/settings.
    "faithfulness_endpoint_id": "",
    "faithfulness_model": "",
    "faithfulness_model_fallbacks": [],
    # Feature 0079/0080 + 0081 — the overseer operator dials (off | shadow | active), persisted via the
    # admin /api/auth/settings route so the Settings UI controls them. The "off" default here exists ONLY
    # so the settings allowlist accepts the key; the resolvers (overseer.overseer_mode /
    # faithfulness.faithfulness_mode) gate the read on is_setting_overridden, so an UNSAVED dial still
    # falls through to the ORWELL_OVERSEER* / ORWELL_FAITHFULNESS_MODE env fallback.
    "overseer_mode": "off",
    # Verbose overseer/corrector DEBUG telemetry (OPT-IN, default OFF). Spellings: "off"/"0" (no
    # telemetry, byte-identical behavior + no extra work), "log"/"1" (Tier 1 — cheap, log-only:
    # record what NATURALLY happened — which corrector guardrails fired + the model's own tool
    # calls; NO extra LLM calls), "force"/"2" (Tier 2 — EXPENSIVE: ALSO force-evaluate the
    # corrector checks on turns they'd normally skip and log a "would-have-intervened" verdict;
    # may run a read-only extraction call but NEVER fires the intervention). Resolved by
    # src.orwell_overseer_debug.overseer_debug_tier(); the "off" default here exists ONLY so the
    # settings allowlist accepts the key — the resolver gates on is_setting_overridden so an
    # UNSAVED dial still falls through to the ORWELL_OVERSEER_DEBUG env fallback.
    "overseer_debug": "off",
    "faithfulness_mode": "off",
    "teacher_model": "",
    "teacher_enabled": False,
    # Skills: minimum self-reported confidence for an auto-written (LLM-authored)
    # DRAFT skill to be injected into the agent prompt. Published skills always
    # qualify. Keeps low-confidence auto-skills out of context until they're
    # vetted/published. 0 disables the gate.
    "skill_autosave_min_confidence": 0.85,
    # Max relevant skills injected into the prompt for one request. The skills
    # library can grow beyond this; cleanup/retirement is an explicit review flow.
    "skill_max_injected": 3,
    # Reminders
    "reminder_channel": "browser",   # "browser" | "email" | "ntfy" | "webhook"
    "reminder_llm_synthesis": False,
    "reminder_ntfy_topic": "Reminders",
    "reminder_email_to": "",
    # Generic outbound webhook channel: pick any saved Integration as the
    # target and supply a JSON payload template. Use {{title}} and {{message}}
    # as placeholders — they are JSON-escaped before substitution, so the
    # rendered string is always valid JSON. Works with Discord, Slack, Teams,
    # ntfy (JSON mode), or any service that accepts a POST with a JSON body.
    "reminder_webhook_integration_id": "",
    "reminder_webhook_payload_template": "",
    # Email triage scanner rules. Running/paused state and schedule live in
    # Tasks via the built-in `check_email_urgency` task.
    "urgent_email_prompt": (
        "Flag as urgent: explicit deadlines, time-sensitive requests, "
        "work-blocking issues, messages from people I report to, or anything "
        "where a delayed reply costs money/trust. Someone waiting outside, "
        "at the door, locked out, or unable to get in is urgent now. "
        "Newsletters, marketing, automated digests, and FYI-only updates are "
        "NOT urgent."
    ),
    # Diagnostics — the full LLM I/O trace + log retention (admin /status page).
    # llm_trace_enabled: capture every model call (full prompt + response +
    #   reasoning) to the live viewer + data/llm-io.jsonl. On by default.
    # log_retention_days: trim ALL managed logfiles older than this to save disk
    #   (auto + the manual "Trim now" button). 0 = keep everything (no auto-trim).
    "llm_trace_enabled": True,
    "log_retention_days": 7,
    # Keyboard shortcuts (action: key combination)
    "keybinds": {
        "search": "ctrl+k",
        "toggle_sidebar": "ctrl+b",
        "new_session": "ctrl+alt+n",
        "star_session": "ctrl+alt+s",
        "delete_session": "ctrl+alt+d",
        "admin_panel": "ctrl+shift+u",
        "cancel": "escape",
    },
}

DEFAULT_FEATURES = {
    # Orwell game build: these inherited workspace capabilities are off by default
    # (their UI entry points are also hidden — see static/css/game-trim.css). Under the
    # game build (the default) the whole drop-set is forced off regardless of these — see
    # GAME_DROP_SET / is_feature_enabled below; these values only apply with the game build
    # disabled (full-workspace/debug mode) and drive the admin Features panel.
    "web_search": True,     # in-game agent capability (ruling 2026-06-10; C32) — also on in debug build
    "web_fetch": True,
    "deep_research": False,  # "Deep Research" — removed from the game UI
    "memory": False,         # "Brain" (memory) — removed from the game UI
    "document_editor": True,
    "rag": True,
    "sensitive_filter": True,
    "gallery": False,        # "Gallery" — removed from the game UI
    # Voice (TTS/STT): kept in the tree but OFF by default — opt-in immersion, no code
    # change to enable (feature 0032 §4.5). Not part of the drop-set, so the game build
    # does not force it off; it simply respects this flag.
    "voice": False,
}


# ── Game build (feature 0032) ──
# The player-facing app is the Big Brother game and nothing else. One switch
# (ORWELL_GAME_BUILD, default ON for this product) forces the inherited workspace
# verticals OFF and the game keep-set ON. Per-vertical flags still apply when the game
# build is off (full-workspace/debug mode). is_feature_enabled() is the single seam every
# route mount and context-assembly check goes through, so a dropped vertical is gone
# server-side (its router is never mounted → 404), not merely hidden.

# Capabilities the game needs — always enabled, never gated by the game build.
GAME_KEEP_SET = frozenset({
    "chat", "history", "onboarding", "llm", "agent", "engine_mcp",
    "status_panel", "portraits", "image_gen", "accounts", "settings",
    "theme", "search",  # conversation/session search — NOT web_search
    # Web search is a CORE in-game capability (ruling 2026-06-10, amends 0032): the agent
    # quietly looks up real-world references the player makes and answers in the houseguest's
    # voice. Search informs real-world flavor ONLY — never a game fact or outcome (C32).
    "web_search",
})

# Inherited workspace verticals the game build removes (forced off; routers not mounted).
GAME_DROP_SET = frozenset({
    "email", "calendar", "contacts", "documents", "document_editor", "gallery",
    "cookbook", "hwfit", "compare", "deep_research", "research", "rag", "memory",
    "skills", "notes", "tasks", "shell", "web_fetch", "youtube",
    "webhooks", "signature", "companion", "codex", "copilot",
    # W3 (2026-06-10 audit): the Bitwarden/Vaultwarden integration — an admin-gated,
    # password-handling, subprocess-spawning surface the game build has no use for.
    # (This is the password-manager vertical, NOT the game engine's Vault store.)
    "vault",
})

# The kept opt-in exception (default off): see DEFAULT_FEATURES["voice"].
GAME_VOICE = "voice"

# ── W1/W5 (2026-06-10 audit): the ui_control safe subset under the game build ──
# ui_control stays in the keep-set (it's the "📺 Camera direction" beat), but its
# action space collapses to visual direction only. Everything else — mode flips,
# model swaps, incognito/power toggles, panel opening, email drafts — is refused
# structurally in do_ui_control (the single dispatch chokepoint), so neither the
# model nor a prompt-injected houseguest line can flip the player out of the game.
GAME_UI_CONTROL_SAFE_ACTIONS = frozenset({
    "highlight", "clear_highlight",  # point the cameras at something on screen
    "set_theme", "create_theme",     # house look & feel (ruling #13 / feature 0052)
})

# W5: the game-only ui_control manifest. Injected as a builtin tool-description
# override under the game build (see get_setting), so the agent prompt's tool
# section never teaches the model to open email/gallery/cookbook/documents panels
# or flip modes/models on game turns — levers that are refused anyway (W1).
# Format matters: the "- ```name``` — ..." one-liner shape is what the prompt
# assembler classifies as a tool section.
#
# SET-4 (2026-07-03 audit): the preset list is read from `known_theme_names_ordered()`
# (src/constants.py, parsed live from static/js/theme.js) instead of being hand-copied
# here — this previously omitted `glass` + the 5 house themes (feature 0052's flagship
# identity themes, ruling #13), so the narrator's own sanctioned in-fiction lever could
# never select the game's OWN look. Reading from the single source of truth means this
# can't drift again.
GAME_UI_CONTROL_SECTION = (
    "- ```ui_control``` — Camera direction only: visually direct the player's screen. "
    "Commands: `highlight <css-selector> [label]` (call out something on screen), "
    "`clear_highlight`, `set_theme <preset>` (presets: "
    + ", ".join(known_theme_names_ordered())
    + "), `create_theme <name> <bg> <fg> <panel> <border> <accent>` (custom hex "
    "theme; auto-applies). No other UI action exists here — do not try to switch modes, "
    "models, toggles, or open panels."
)

_GAME_BUILD_FALSEY = {"0", "false", "no", "off", ""}


def game_build_enabled() -> bool:
    """The game build is ON by default for this product. ORWELL_GAME_BUILD=0 (or the
    deprecated BBAI_GAME_BUILD fallback) turns it off to expose the full workspace for
    debugging. Read from the environment so operators flip it without touching files."""
    raw = os.getenv("ORWELL_GAME_BUILD")
    if raw is None:
        raw = os.getenv("BBAI_GAME_BUILD")
    if raw is None:
        return True
    return raw.strip().lower() not in _GAME_BUILD_FALSEY


def is_feature_enabled(name: str, *, features: dict | None = None) -> bool:
    """Single source of truth for 'should this capability be active?' — game-build aware.

    Keep-set is always on; under the game build the drop-set is always off (so its routes
    never mount and its context never injects); otherwise the saved/default per-vertical
    flag decides. Voice is the kept opt-in exception (off by default, enable its flag).

    `features` lets callers/tests pass an explicit flag map instead of reading disk.
    """
    if name in GAME_KEEP_SET:
        return True
    if game_build_enabled() and name in GAME_DROP_SET:
        return False
    feats = load_features() if features is None else features
    # With the game build off, an inherited vertical is reachable unless explicitly
    # disabled; everything else falls back to its declared default.
    default = True if name in GAME_DROP_SET else DEFAULT_FEATURES.get(name, False)
    return bool(feats.get(name, default))


def front_end_context_sources(*, incognito: bool = False, features: dict | None = None) -> dict:
    """Which front-end context sources may be injected into a chat turn's preface.

    Under the game build every inherited source (memory / RAG / skills / web) is off, so the
    engine's per-moment game-master prompt (0018) is the only injected framing — there is no
    parallel front-end memory rivaling the engine's soul/Vault (0023/0024). Incognito also
    suppresses them. Pure and dependency-light so chat assembly and tests share one rule.

    NOTE (C32): the web_search FEATURE is now part of the game keep-set — the agent calls the
    web_search TOOL deliberately, in-fiction. That is distinct from this AUTOMATIC web-context
    injection into the chat preface, which must stay OFF under the game build (raw search
    context in the system prompt would rival the engine's framing and break fiction).
    """
    def _on(name: str) -> bool:
        return (not incognito) and is_feature_enabled(name, features=features)
    return {
        "memory": _on("memory"),
        "rag": _on("rag"),
        "skills": _on("skills"),
        "web": (not game_build_enabled()) and _on("web_search"),
    }


def mount_optional(app, feature: str, router, **kwargs) -> bool:
    """include_router only when `feature` is enabled (game-build aware); returns whether it
    mounted. Gating the *registration* (not just the UI) is what makes a dropped vertical
    return 404 server-side — including for an authenticated admin, since the path simply
    does not exist. Duck-typed (app/router passed in) so this module imports no web stack."""
    if is_feature_enabled(feature):
        app.include_router(router, **kwargs)
        return True
    return False


# ── Stop shipping the dropped verticals' JS ──
# Tier 3 physically deleted these modules and removed their <script> tags + ES imports from
# the page, so the game build no longer loads any inherited workspace JS. This strip stays as
# a defense-in-depth guard: should a dropped-vertical <script> tag ever be reintroduced into
# index.html, it is filtered out under the game build rather than 404-ing a deleted file.
# Voice JS (kept, opt-in) follows the voice flag (off by default), like the voice routes.
GAME_DROP_SCRIPTS = (
    "memory.js", "skills.js", "rag.js", "search.js", "document.js", "gallery.js",
    "cookbook.js", "cookbookSchedule.js", "compare/index.js",
    # C27: the workspace tour narrates inherited features the game build doesn't have.
    # Import-free standalone tags, so dropping them removes the load entirely.
    "tourHints.js", "tourAutoplay.js",
)
GAME_VOICE_SCRIPTS = ("tts-ai.js", "voiceRecorder.js")


def dropped_script_srcs(*, features: dict | None = None) -> tuple:
    """JS entry-point filenames that must NOT be shipped given the current build (Tier 2):
    the inherited verticals under the game build, plus voice unless its flag is on."""
    drop = list(GAME_DROP_SCRIPTS) if game_build_enabled() else []
    if not is_feature_enabled("voice", features=features):
        drop += list(GAME_VOICE_SCRIPTS)
    return tuple(drop)


def strip_dropped_scripts(html: str, *, features: dict | None = None) -> str:
    """Remove <script> tags whose src is a dropped-vertical entry point, so the game build
    does not ship them. Line-oriented (each tag is on its own line) and a no-op for HTML
    that references none of them. Applied where index.html is served."""
    drops = dropped_script_srcs(features=features)
    if not drops:
        return html
    kept = []
    game_build = game_build_enabled()
    for line in html.splitlines(keepends=True):
        s = line.lstrip()
        if s.startswith("<script") and any((f"/{d}\"" in line or f"/{d}?" in line) for d in drops):
            continue  # a dropped vertical's script — not shipped under the game build
        # C27/P3: a Big Brother game renders no math or diagrams — drop the render-blocking
        # third-party CDN deps (KaTeX css+js, Mermaid) under the game build. markdown.js
        # guards both globals (`if (window.katex)` / `if (!window.mermaid) return`), so
        # absent libraries degrade to plain text, never an error.
        if game_build and "cdn.jsdelivr.net" in line and ("katex" in line or "mermaid" in line):
            continue
        kept.append(line)
    return "".join(kept)


# ── Settings (data/settings.json) ──

def load_settings() -> dict:
    """Load settings merged with defaults. Always returns a complete dict."""
    global _settings_cache
    now = time.monotonic()
    if _settings_cache and (now - _settings_cache[0]) < _CACHE_TTL:
        return _settings_cache[1]
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if not isinstance(saved, dict):
            raise ValueError("settings must be an object")
        merged = {**DEFAULT_SETTINGS, **saved}
    except (FileNotFoundError, PermissionError, json.JSONDecodeError, ValueError):
        merged = dict(DEFAULT_SETTINGS)
    _settings_cache = (now, merged)
    return merged


def save_settings(settings: dict):
    """Persist settings to disk (atomic; see core.atomic_io)."""
    from core.atomic_io import atomic_write_json
    atomic_write_json(SETTINGS_FILE, settings, indent=2)
    _invalidate_caches()


def get_setting(key: str, default: Any = None) -> Any:
    """Read a single setting value.

    W5 (game build): the built-in tool-description overrides gain a structural,
    non-optional entry for ``ui_control`` — the game-only manifest — so the agent
    prompt's tool section advertises exactly the safe subset do_ui_control enforces
    (W1). Injected on the READ path only (never persisted), and it wins over any
    user-saved override while the game build is on; full-workspace mode is untouched.
    """
    val = load_settings().get(key, default)
    if key == "builtin_tool_overrides" and game_build_enabled():
        ov = dict(val) if isinstance(val, dict) else {}
        ov["ui_control"] = GAME_UI_CONTROL_SECTION
        return ov
    return val


# #764 — the COSMETIC-ONLY login background config. The login page is PRE-AUTH,
# so this is the ONLY login-related value exposed without auth: a source enum,
# per-source cosmetic settings, and an optional photo URL — never anything
# sensitive (no secrets, no user data, no other settings).
LOGIN_BACKGROUND_SOURCES = ("gradient", "photo", "particles", "bundled")
LOGIN_GRADIENT_PRESETS = ("sunset", "aurora", "ocean", "gold", "lavender")


def _clampf(v, lo, hi, dflt):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return dflt
    return max(lo, min(hi, v))


def login_background_config() -> dict:
    """Return the cosmetic login-background config.

    Shape: {source, photo_url, gradient:{preset,speed,intensity},
            particles:{density,speed,color}}.

    Validated/clamped so a hand-edited settings.json can never feed the pre-auth
    page anything but known enums + sane numbers/URL. Default source is 'gradient'.
    """
    s = load_settings()
    source = str(s.get("login_background", "gradient")).strip().lower()
    if source not in LOGIN_BACKGROUND_SOURCES:
        source = "gradient"

    photo_url = str(s.get("login_background_photo_url", "") or "").strip()
    # Only http(s) or a same-origin "/" path; anything else is dropped.
    if photo_url and not (
        photo_url.startswith("http://")
        or photo_url.startswith("https://")
        or photo_url.startswith("/")
    ):
        photo_url = ""

    preset = str(s.get("login_gradient_preset", "aurora")).strip().lower()
    if preset not in LOGIN_GRADIENT_PRESETS:
        preset = "aurora"

    color = str(s.get("login_particles_color", "") or "").strip()
    # cosmetic-safe color only (hex / rgb(a) / simple named); else blank → client floor.
    import re as _re
    if color and not _re.match(r"^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|[a-zA-Z]+)$", color):
        color = ""

    return {
        "source": source,
        "photo_url": photo_url,
        "gradient": {
            "preset": preset,
            "speed": _clampf(s.get("login_gradient_speed", 26), 8, 60, 26),
            "intensity": _clampf(s.get("login_gradient_intensity", 1.0), 0.4, 1.4, 1.0),
        },
        "particles": {
            "density": int(_clampf(s.get("login_particles_density", 64), 12, 160, 64)),
            "speed": _clampf(s.get("login_particles_speed", 0.25), 0.05, 1.2, 0.25),
            "color": color,
        },
    }


def is_setting_overridden(key: str) -> bool:
    """True if ``key`` is explicitly present in the saved settings file.

    ``load_settings`` merges DEFAULT_SETTINGS with the saved file, so a value
    equal to its default is indistinguishable from "never set" via get_setting.
    Callers that need to treat an explicit user choice differently from the
    default (e.g. adaptive budgets) use this to read the raw saved file.
    """
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        return isinstance(saved, dict) and key in saved
    except (FileNotFoundError, json.JSONDecodeError):
        return False


# Per-user settings (user prefs override the global admin default). Used for
# keys that a user is allowed to choose individually — currently the vision
# model + image-generation model. The owner argument is the authed username
# resolved by FastAPI deps; an empty/None owner falls through to the global.
_PER_USER_KEYS = {
    "vision_model", "vision_enabled", "vision_model_fallbacks",
    "image_model", "image_gen_enabled", "image_quality",
    # Default chat endpoint / model — without per-user resolution every new
    # account inherited whatever the most-recent admin picked, which then
    # got injected into the chat composer on first open.
    "default_endpoint_id", "default_model", "default_model_fallbacks",
    "utility_endpoint_id", "utility_model", "utility_model_fallbacks",
    "research_endpoint_id", "research_model",
    # Keyboard shortcuts are a genuine PER-PROFILE preference, not global config
    # (C30 / settings ruling): a non-admin can change their own keybinds, and the
    # global `keybinds` default still applies until they do. Saved via /api/prefs.
    "keybinds",
}


def get_user_setting(key: str, owner: str = "", default: Any = None) -> Any:
    """Resolve `key` from the caller's per-user prefs first, falling back to
    the global setting. Only the small whitelist in `_PER_USER_KEYS` is
    eligible — for any other key this is equivalent to `get_setting(key)`.

    Falls back gracefully if the prefs module can't be imported (cycle/early
    boot) — admin-global settings keep working.
    """
    if owner and key in _PER_USER_KEYS:
        try:
            from routes.prefs_routes import _load_for_user
            prefs = _load_for_user(owner) or {}
            if key in prefs and prefs[key] not in (None, ""):
                return prefs[key]
        except Exception:
            pass
    return get_setting(key, default)


# ── Features (data/features.json) ──

def load_features() -> dict:
    """Load feature flags merged with defaults."""
    global _features_cache
    now = time.monotonic()
    if _features_cache and (now - _features_cache[0]) < _CACHE_TTL:
        return _features_cache[1]
    try:
        with open(FEATURES_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if not isinstance(saved, dict):
            raise ValueError("features must be an object")
        merged = {**DEFAULT_FEATURES, **saved}
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        merged = dict(DEFAULT_FEATURES)
    _features_cache = (now, merged)
    return merged


def save_features(features: dict):
    """Persist feature flags to disk (atomic)."""
    from core.atomic_io import atomic_write_json
    atomic_write_json(FEATURES_FILE, features, indent=2)
    _invalidate_caches()

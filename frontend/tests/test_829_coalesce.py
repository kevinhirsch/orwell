"""#829 — turn-coalescing: the multiple agent-loop ROUNDS of ONE player turn render as
ONE growing message bubble (append into the same bubble), NOT N separate per-round bubbles
that mount / hide / jump.

SOURCE-PIN gate (the live end-to-end proof is `scripts/_verify_coalesce_live.py`, which this
change ARMS by planting the `#829` sentinel in the served chat.js — that driver self-skips
until the sentinel is present). Here we pin the client-side contract structurally:

  1. the `#829` feature sentinel is present in the served chat.js (arms the live driver);
  2. the coalescing GROUPING exists — a per-round commit that freezes each round's reply as a
     segment inside the ONE turn bubble (`_commitRoundSegment`), a turn-scoped `_turnCoalesced`
     flag, and the frozen-segment class (`round-seg`) the next round appends BELOW;
  3. the SSE `agent_step` round boundary no longer MINTS a fresh per-round bubble — it reuses
     the same `roundHolder` (no `newWrap` / no `roundHolder = <new element>`);
  4. the stream-end finalize is coalescing-aware (commits the LAST round's segment instead of
     re-rendering the whole body, which would clobber the earlier frozen segments);
  5. REASONING IS NEVER SPLICED INTO THE COALESCED PUBLIC BODY — the committed reply is built
     from the reply-only buffer `roundReplyText`; the reasoning buffer `roundReasoningText` is
     never concatenated into the reply, and reasoning stays in its own `.thinking-section`
     accordion (the F8 channel split, preserved per round).

Pure static reads — no server, no browser, no LLM.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
CHAT = (JS_DIR / "chat.js").read_text(encoding="utf-8")

# The exact self-skip sentinels the live driver probes for (case-insensitive).
DRIVER = (FE / "scripts" / "_verify_coalesce_live.py").read_text(encoding="utf-8")


def _commit_body() -> str:
    """The source of the `_commitRoundSegment` helper (its body), sliced from its definition
    up to the next hoisted declaration that follows it in the stream setup."""
    start = CHAT.index("const _commitRoundSegment = () =>")
    # The helper is immediately followed by `let _nextIsError = false;` in the stream setup.
    end = CHAT.index("let _nextIsError", start)
    return CHAT[start:end]


# ── 1. the #829 sentinel arms the live driver ─────────────────────────────────────────────

def test_829_sentinel_present_in_served_chat_js():
    assert "#829" in CHAT, (
        "the `#829` feature sentinel must be present in the served chat.js — it is what "
        "arms scripts/_verify_coalesce_live.py (which self-skips while it is absent)."
    )


def test_sentinel_matches_a_driver_probe_token():
    # The driver treats any of these (lowercased) as "feature present".
    tokens = ("#829", "coalescerounds", "onebubbleperturn", "growing bubble")
    low = CHAT.lower()
    assert any(t in low for t in tokens), (
        f"chat.js must carry one of the driver's feature sentinels {tokens}."
    )
    # Sanity: the driver really does gate on these tokens.
    assert "_FEATURE_SENTINELS" in DRIVER and "#829" in DRIVER


# ── 2. the coalescing grouping exists ─────────────────────────────────────────────────────

def test_per_round_commit_helper_exists():
    assert "const _commitRoundSegment = () =>" in CHAT, (
        "coalescing needs a per-round commit that freezes each round's segment inside the "
        "ONE turn bubble."
    )


def test_turn_coalesced_flag_exists():
    assert "let _turnCoalesced = false;" in CHAT, (
        "a turn-scoped `_turnCoalesced` flag must gate the coalescing-aware finalize."
    )


def test_frozen_segment_class_is_used():
    # The committed round is re-classed `round-seg` so `_ensureStreamLayout` mints a FRESH
    # `.stream-content` for the next round below it (the bubble grows).
    assert "'round-seg'" in CHAT or '"round-seg"' in CHAT, (
        "each committed round segment must be frozen with the `round-seg` class."
    )


# ── 3. the agent_step round boundary REUSES one bubble (no per-round mount) ────────────────

def test_agent_step_commits_and_flags_coalesced():
    # Slice the agent_step HANDLER (not the delta-gate mention) and bound it to the NEXT handler
    # boundary (`} else if (json.type ===`) rather than a brittle fixed offset — so the commit +
    # flag assertions are scoped to THIS handler only.
    idx = CHAT.index("else if (json.type === 'agent_step')")
    end = CHAT.index("} else if (json.type ===", idx + 40)
    block = CHAT[idx:end]
    assert "_commitRoundSegment();" in block, "agent_step must commit the round segment."
    assert "_turnCoalesced = true;" in block, "agent_step must mark the turn coalesced."


def test_agent_step_no_longer_mints_a_per_round_bubble():
    # The pre-#829 path created `newWrap = document.createElement('div')` (a fresh
    # `.msg-ai .msg-continuation` bubble) and repointed `roundHolder`/`currentHolder` to it.
    # Coalescing removes that entirely — the turn is ONE bubble.
    assert "newWrap" not in CHAT, (
        "the per-round `newWrap` bubble mint must be gone — rounds coalesce into one bubble."
    )
    # `roundHolder` is only ever the initial alias of `holder` (and the teacher_takeover reset);
    # it is NEVER reassigned to a freshly-created per-round element.
    assert not re.search(r"roundHolder\s*=\s*document\.createElement", CHAT)
    assert not re.search(r"roundHolder\s*=\s*newWrap", CHAT)


# ── 4. the stream-end finalize is coalescing-aware ────────────────────────────────────────

def test_finalize_commits_last_segment_when_coalesced():
    # The finalize must branch on `_turnCoalesced` and commit the final segment instead of
    # re-rendering the whole body (which would clobber the earlier frozen segments).
    assert "if (_turnCoalesced) {" in CHAT, (
        "the stream-end finalize must special-case a coalesced turn."
    )
    # The commit helper is invoked from BOTH the agent_step boundary and the finalize.
    assert CHAT.count("_commitRoundSegment()") >= 2


# ── 5. reasoning is NEVER spliced into the coalesced public body ───────────────────────────

def test_commit_renders_reply_only_never_the_reasoning_buffer():
    body = _commit_body()
    # The committed reply is sourced from the reply-only buffer …
    assert "roundReplyText" in body, (
        "the committed round reply must come from the reply-only buffer roundReplyText (F8)."
    )
    # … and the reasoning buffer is NEVER pulled into the reply body (the channel split).
    assert "roundReasoningText" not in body, (
        "the coalesced public reply must NOT be built from roundReasoningText — reasoning "
        "stays in its own `.thinking-section` accordion, never spliced into the body."
    )


def test_commit_preserves_the_reasoning_accordion_segment():
    body = _commit_body()
    # Reasoning lives inside the round's `.thinking-section`; the commit renders the reply into
    # a dedicated reply container (`.live-reply-content` / `.round-reply`) so the accordion is
    # preserved, never overwritten by the reply body.
    assert ".thinking-section" in body
    assert "live-reply-content" in body


def test_reply_render_uses_process_with_thinking_scrub():
    # The reply body is rendered through the SAME processWithThinking chain the reload / tool
    # paths use — which, in the game build, also scrubs operator-aside / reasoning-preamble
    # leaks out of the public reply. (Reasoning-out-of-body by construction.)
    body = _commit_body()
    assert "processWithThinking" in body


def test_round_emptiness_check_is_scoped_to_the_reasoning_BODY():
    # A round that OPENED a `.thinking-section` accordion but produced only header chrome
    # ("Thinking…"/"View thinking process") + the timer — no real reasoning body — must still
    # DROP, not freeze as a near-empty "Thinking" segment. So the emptiness check reads the
    # reasoning BODY (`.thinking-content-inner`/`.live-think-inner`), never the whole section.
    body = _commit_body()
    assert ".thinking-content-inner" in body or ".live-think-inner" in body, (
        "the emptiness check must read the reasoning BODY, not the whole `.thinking-section`."
    )
    assert "seg.querySelector('.thinking-section').textContent" not in body, (
        "measuring the whole `.thinking-section` counts header chrome — always non-empty."
    )


# ── 6. OOC/producer classification is PER-SEGMENT in a coalesced turn (Greptile P1) ────────

def test_ooc_classification_targets_the_segment_not_the_shared_holder():
    body = _commit_body()
    # Each round's OOC/producer treatment is carried by ITS OWN frozen segment (classified via
    # applyOocClass(seg, …)) — NOT the shared roundHolder. Classifying the shared holder is the
    # bug: a LATER non-OOC round's applyOocClass(roundHolder, non-OOC) strips the class and an
    # EARLIER OOC segment settles as ordinary narration.
    assert "applyOocClass(seg," in body, (
        "the committed round must classify its OWN segment, not the shared holder."
    )
    assert "applyOocClass(roundHolder" not in body, (
        "the coalesced commit must NOT classify the shared holder (the class-stripping bug)."
    )
    # The shared holder's OOC classes are CLEARED each commit — the live `_renderStream` toggled
    # them on the holder while the round streamed; they must not persist to strip a sibling segment.
    assert "roundHolder.classList.remove('msg-ooc', 'msg-ooc-producer')" in body


def test_segment_scoped_ooc_producer_css_exists():
    # The wrap-scoped `.msg-ooc-producer .body` / `.role::after` rules can't reach a segment, so
    # the per-segment producer treatment needs its own CSS on `.stream-content`/`.round-seg`.
    css = (FE / "static" / "style.css").read_text(encoding="utf-8")
    assert ".round-seg.msg-ooc-producer" in css, (
        "a coalesced OOC round is classified on its segment — that segment needs producer CSS."
    )


# ── 7. sources/findings survive an EMPTY final round (Greptile source-drop) ────────────────

def test_sources_survive_an_empty_final_round():
    # The coalesced finalize attaches web_sources/research_sources + findings to the ONE turn
    # bubble body UNCONDITIONALLY and AFTER the final-segment commit — so a tail round that
    # rendered no prose (its segment dropped) cannot take the turn's sources/findings with it.
    idx = CHAT.index("if (_turnCoalesced) {")
    block = CHAT[idx:]
    block = block[: block.index("} else {")]  # the coalesced branch only
    commit_idx = block.index("_commitRoundSegment();")
    src_idx = block.index("_buildSourcesBox(_sourcesData")
    assert commit_idx < src_idx, "sources must attach AFTER the final-segment commit."
    # they ride the turn bubble body (`_cf`), not the (possibly dropped) final segment
    assert "_cf.insertBefore(" in block
    assert "chatRenderer.buildFindingsBox(_findingsData)" in block

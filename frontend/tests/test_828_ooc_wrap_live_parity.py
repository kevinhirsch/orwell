"""#828 — Producer/OOC bubbles must render with production styling on FIRST PAINT, not only
after a refresh.

Root cause: the reload/settled render path (`chatRenderer.addMessage`, the "Standard
single-bubble message" branch) has always classified a whole-`((...))`-wrapped assistant
reply by adding `.msg-ooc` / `.msg-ooc-producer` to the message WRAP (`detectOocAside`,
orwellOocAside.js — the single source of truth for "is this an OOC aside?"; see
`docs/decisions/0015`'s "single render engine" principle and CLAUDE.md "The live stream
splits by channel"). The LIVE stream path in `chat.js` never touched the wrap's class list at
all — it only fed text through `markdown.js processWithThinking`, which has its OWN, separate
game-build-only fallback: an INNER `<div class="ooc-producer-aside">` wrapped around the body
content (NARR-9). That gives the live bubble a different, lesser visual treatment (no
`.role::after { content: 'production' }` badge, no wrap-level background) than reload's full
`.msg-ooc.msg-ooc-producer` bubble styling — "renders as a normal bubble live, only picks up
production styling after a refresh" is really "renders with a DIFFERENT, live-only fallback
style until reload replaces it with the real one".

The fix adds `chatRenderer.applyOocClass(wrap, text, role)` — a small function wrapping the
SAME `detectOocAside` reload already uses — and wires it into every place `chat.js` renders
live assistant text into a `.msg` wrap:
  * `_renderStream` — the sender's primary incremental live-render loop (every delta).
  * the `tool_start` round-finalize (a round that gets cut short by a tool call).
  * the end-of-turn FINAL settle (the sender's own bubble, before any reload).
  * `_renderLiveStream` — the ADR 0015 SHARED incremental renderer the OBSERVER window
    (`resumeStream`) also streams through, so a second window mirrors the SAME wrap-level
    styling live too, not just the sender's window.

Each call site also feeds `applyOocClass`'s marker-STRIPPED text into `processWithThinking`
(instead of the raw `((...))`-wrapped text) once classified, so the wrap-level styling and
`processWithThinking`'s OWN inner `.ooc-producer-aside` fallback never double up.

This file is SOURCE-PINNED (this is a DOM/render-timing defect — a real browser drive-through
belongs in the browser gate, but the wiring itself is a static, verifiable contract): it
inspects the actual `chatRenderer.js` / `chat.js` source so an accidental revert (e.g. someone
"simplifies" `_renderStream` back to `renderer.update(dt)` without the classification call)
fails this test the same way #828 was introduced — quietly, with everything else still green.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── chatRenderer.js: the shared classification function exists and is exported ──────────── #

def test_apply_ooc_class_is_defined_and_exported():
    js = _read("static", "js", "chatRenderer.js")
    assert "export function applyOocClass(wrap, rawText, role)" in js
    # exported on the default `chatRenderer` object too (chat.js imports the default export
    # and calls it as `chatRenderer.applyOocClass`, not a named import)
    default_obj = js[js.index("const chatRenderer = {"):]
    assert "applyOocClass," in default_obj or "applyOocClass\n" in default_obj


def test_apply_ooc_class_uses_the_single_source_of_truth_detector():
    js = _read("static", "js", "chatRenderer.js")
    fn = js[js.index("export function applyOocClass"):]
    fn = fn[:fn.index("\n}\n")]
    # same detector reload always used, same role/game-build gate, same two classes
    assert "detectOocAside(" in fn
    assert "isGameBuild()" in fn
    assert "role === 'user'" in fn and "role === 'assistant'" in fn
    assert "'msg-ooc'" in fn
    assert "'msg-ooc-producer'" in fn
    # producer class is assistant-only (mirrors addMessage: only the MODEL's aside is a
    # "production" bubble; the player's own OOC aside is msg-ooc without msg-ooc-producer)
    producer_idx = fn.index("msg-ooc-producer")
    assert "role === 'assistant'" in fn[producer_idx:producer_idx + 60]


# ── chat.js: every LIVE render site classifies the wrap, not just the reload path ────────── #

def test_render_stream_classifies_the_wrap_before_rendering():
    """`_renderStream` is the sender's primary incremental live-render loop (chat.js), called
    on every SSE delta while the assistant's reply streams in. It must classify the WRAP
    (`roundHolder`) via the shared helper BEFORE feeding text to the incremental renderer —
    that is what makes the OOC styling apply on first paint instead of only after reload."""
    js = _read("static", "js", "chat.js")
    # `_renderStream` is first declared as a no-op placeholder (`let _renderStream = () => {};`,
    # reassigned later once the real streaming closures are in scope) — anchor past that so we
    # inspect the REAL implementation, not the empty placeholder.
    anchor = js.index("// Direct render helper for streaming text")
    start = js.index("_renderStream = () => {", anchor)
    # bounded to this arrow function's body (ends at the closing `};` before the next let)
    end = js.index("\n      };", start)
    body = js[start:end]
    assert "chatRenderer.applyOocClass(roundHolder" in body
    # the classification must run BEFORE the incremental renderer consumes the text, so the
    # wrap class is set on the SAME paint as the (marker-stripped) content
    ooc_idx = body.index("chatRenderer.applyOocClass(roundHolder")
    renderer_update_idx = body.index("renderer.update(")
    assert ooc_idx < renderer_update_idx, (
        "applyOocClass must run before the incremental renderer paints, or the first paint "
        "still renders unclassified (the exact #828 defect)"
    )
    # the (possibly marker-stripped) result feeds the renderer — not the raw, still-wrapped dt
    assert "renderer.update(displayText)" in body


def test_round_finalize_on_tool_interrupt_also_classifies():
    """A round that gets cut short by a tool call (`tool_start`) finalizes its bubble with a
    direct innerHTML write, bypassing `_renderStream`'s incremental path — it must classify
    the wrap too, or an OOC round immediately followed by a tool call would settle unstyled."""
    js = _read("static", "js", "chat.js")
    idx = js.index("// --- Finalize current text bubble (only once per round) ---")
    window = js[idx:idx + 2000]
    assert "chatRenderer.applyOocClass(roundHolder" in window


def test_final_settle_reclassifies_on_the_full_settled_text():
    """The sender's own end-of-turn settle (before any reload) re-derives the bubble HTML from
    the full final text — it must re-run classification on that FINAL text (not just trust an
    earlier mid-stream verdict), so the true end state always matches reload's."""
    js = _read("static", "js", "chat.js")
    idx = js.index("Finalize the last round's bubble")
    window = js[idx:idx + 1200]
    assert "chatRenderer.applyOocClass(roundHolder" in window
    assert "const finalDisplayText = _finalOoc.text;" in window


def test_observer_mirror_also_classifies_live_not_just_the_sender():
    """ADR 0015: the observer window mirrors the live stream through the SAME incremental
    renderer as the sender (`_renderLiveStream`, shared by `resumeStream`). It must also
    classify its own wrap live — otherwise a SECOND window on the same game would still show
    the sender's OOC bubble unstyled until that window reloads, a narrower repeat of #828."""
    js = _read("static", "js", "chat.js")
    start = js.index("function _renderLiveStream(contentDiv, replyText, reasoningText, render, state, wrap)")
    end = js.index("\n  }", start)
    body = js[start:end]
    assert "chatRenderer.applyOocClass(wrap" in body
    # the wrap parameter must actually be threaded through from the one real call site
    # (resumeStream's renderDelta) — a 5-arg call here would silently pass `wrap` as
    # `undefined` and applyOocClass would no-op (it guards on `!wrap`).
    call_idx = js.index("_renderLiveStream(contentDiv, replyText, reasoningText, _liveRender, _liveState, holder)")
    assert call_idx > end, "the classifying wrap param must be threaded from the real call site"


# ── Double-styling guard: classifying live must not ALSO trigger the old inner-div fallback ─ #

def test_live_sites_feed_marker_stripped_text_downstream():
    """`applyOocClass` returns `{ooc, text}` — `text` has the `((`/`))` markers stripped when
    `ooc` is true. Every call site must feed THAT (not the raw, still-wrapped text) onward to
    `processWithThinking`, or `processWithThinking`'s own NARR-9 inner-div fallback would ALSO
    fire and double up the styling (a wrap-level `.msg-ooc-producer` bubble with a redundant
    `.ooc-producer-aside` div nested inside it) — visibly different from reload, which only
    ever produces the wrap-level treatment."""
    js = _read("static", "js", "chat.js")
    # _renderStream's normal (non-live-reply) tail path
    assert "renderer.update(displayText)" in js
    # _renderStream's live-reply-content path
    assert "r.update(replyTrimmed)" in js
    replay_idx = js.index("const replyTrimmed = displayText.trim();")
    assert replay_idx > 0
    # tool_start round finalize — `dt` is reassigned to the marker-stripped verdict text before
    # the (otherwise-unchanged, source-pinned elsewhere) processWithThinking(squashOutsideCode(dt))
    # call renders it
    idx = js.index("// --- Finalize current text bubble (only once per round) ---")
    window = js[idx:idx + 2000]
    assert "dt = chatRenderer.applyOocClass(roundHolder, dt.trim(), 'assistant').text;" in window
    assert "processWithThinking(markdownModule.squashOutsideCode(dt))" in window
    # observer mirror
    assert "const replySrc = _liveOoc.text;" in js

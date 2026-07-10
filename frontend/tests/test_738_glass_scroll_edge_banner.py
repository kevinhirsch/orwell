"""#738 item #9 — Chat transcript scroll-edge mask + recede-on-scroll banner.

Source-pinned gate (the pytest lane has no DOM runtime; live computed appearance is
verified by the render-verify loop under Playwright — these are the same source-pinned
convention checks the sibling glass-chrome tests use, e.g. test_738_glass_menus_accent.py
/ test_glass_perf.py).

ITEM 9 — the transcript (#chat-history) fades content to transparent at whichever edge has
content running off it ("content scrolls under the chrome"), and the title banner
(.chat-top-bar) recedes as the reader scrolls down into the conversation. Both are gated to
the glass theme (body.theme-frosted) and are REDUCED-MOTION SAFE — the static mask stays as
a legibility affordance, but the intensify + recede TRANSITIONS are neutralized under Reduce
Motion. chat.js toggles the state classes from a passive, rAF-coalesced scroll handler and a
childList-only observer; it must NOT force a synchronous layout in the hot path and must NOT
touch the streaming buffers / live-stream render path.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
CHAT_JS = (FE / "static" / "js" / "chat.js").read_text(encoding="utf-8")


def _css_blocks(text: str, selector_literal: str):
    """All declaration blocks (selectors, body) whose selector LIST contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


# ── CSS: the transcript scroll-edge mask ────────────────────────────────────────────────
def test_chat_history_carries_edge_fade_mask_on_glass():
    """#chat-history under body.theme-frosted paints a top/bottom linear-gradient mask
    driven by the --chat-edge-top / --chat-edge-bottom lengths (0 ⇒ no fade at that edge)."""
    blocks = _css_blocks(CSS, "#chat-history")
    base = [
        body for (sel, body) in blocks
        if "theme-frosted" in sel and "mask-image" in body and ".edge-" not in sel
    ]
    assert base, "no body.theme-frosted #chat-history rule carries a mask-image (#738 item 9)"
    body = base[0]
    # both the standard + -webkit- mask must be present (Safari/WebKit), and both edge vars.
    assert "mask-image: linear-gradient(to bottom" in body
    assert "-webkit-mask-image: linear-gradient(to bottom" in body
    assert "var(--chat-edge-top)" in body and "var(--chat-edge-bottom)" in body


def test_edge_state_classes_grow_the_fade():
    """The .edge-top / .edge-bottom state classes (toggled by chat.js) raise the matching
    edge var to the fade height — so the fade appears only when content runs off that edge."""
    top = _css_blocks(CSS, "#chat-history.edge-top")
    bottom = _css_blocks(CSS, "#chat-history.edge-bottom")
    assert any("--chat-edge-top" in b for (_s, b) in top), (
        ".edge-top must set --chat-edge-top to the fade height"
    )
    assert any("--chat-edge-bottom" in b for (_s, b) in bottom), (
        ".edge-bottom must set --chat-edge-bottom to the fade height"
    )


def test_edge_vars_registered_for_smooth_interpolation():
    """The two edge lengths are @property-registered as <length> so the intensify TRANSITION
    interpolates (an unregistered custom prop would jump) — reduced-motion drops the transition."""
    assert re.search(r"@property\s+--chat-edge-top\b", CSS), "@property --chat-edge-top missing"
    assert re.search(r"@property\s+--chat-edge-bottom\b", CSS), "@property --chat-edge-bottom missing"
    for m in re.finditer(r"@property\s+--chat-edge-(?:top|bottom)\s*\{([^}]*)\}", CSS):
        assert '"<length>"' in m.group(1) or "<length>" in m.group(1)


# ── CSS: the recede-on-scroll banner ────────────────────────────────────────────────────
def test_banner_recedes_when_scrolled():
    """.chat-top-bar recedes (opacity + translate) once #chat-container carries .chat-scrolled."""
    recede = _css_blocks(CSS, ".chat-scrolled .chat-top-bar")
    assert recede, "no .chat-scrolled .chat-top-bar recede rule (#738 item 9)"
    joined = " ".join(b for (_s, b) in recede)
    assert "opacity" in joined and "transform" in joined, (
        "the receded banner must both fade and lift (opacity + transform)"
    )


# ── CSS: reduced-motion safety ──────────────────────────────────────────────────────────
def test_reduced_motion_neutralizes_the_transitions_and_recede():
    """Under prefers-reduced-motion: reduce the animated intensify + banner motion are
    neutralized (transition:none) and the banner stops receding (opacity:1; transform:none) —
    the static edge mask (a legibility affordance, not motion) is kept."""
    m = re.search(r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{", CSS)
    assert m, "no prefers-reduced-motion block found"
    # find the balanced body of that @media block
    start = m.end() - 1
    depth = 0
    end = start
    for i in range(start, len(CSS)):
        if CSS[i] == "{":
            depth += 1
        elif CSS[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    # Search ALL reduced-motion @media blocks for our neutralizers (there are several in the file).
    blocks = re.findall(
        r"@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(.*?)\n\}", CSS, re.S
    )
    text = "\n".join(blocks)
    assert "#chat-history" in text and "#chat-container.chat-scrolled .chat-top-bar" in text, (
        "the reduced-motion block must neutralize the #chat-history transition and the banner recede"
    )
    # the receded banner is reset to full/untranslated under reduce
    seg = text[text.index("#chat-container.chat-scrolled .chat-top-bar"):]
    seg = seg[: seg.index("}") + 1]
    assert "opacity: 1" in seg and ("transform: none" in seg), (
        "under Reduce Motion the banner must stop receding (opacity:1; transform:none)"
    )


# ── JS: the scroll handler is present, coalesced, layout-safe, and additive ──────────────
def test_chatjs_wires_scroll_edges_from_init():
    assert "_initChatScrollEdges" in CHAT_JS, "chat.js must define _initChatScrollEdges"
    # called from init()
    init_i = CHAT_JS.index("export function init(apiBase)")
    init_seg = CHAT_JS[init_i: init_i + 1200]
    assert "_initChatScrollEdges()" in init_seg, "_initChatScrollEdges() must be called from init()"


def test_scroll_handler_is_passive_and_raf_coalesced():
    """The scroll listener is passive + rAF-coalesced (one class write per frame), and the
    hot handler forces NO synchronous layout (no getBoundingClientRect)."""
    assert "addEventListener('scroll', _scheduleChatScrollEdges, { passive: true })" in CHAT_JS
    # coalescing guard
    i = CHAT_JS.index("function _scheduleChatScrollEdges")
    sched = CHAT_JS[i: i + 400]
    assert "if (_scrollEdgeRaf) return" in sched and "requestAnimationFrame" in sched
    # the apply function must not force layout
    a = CHAT_JS.index("function _applyChatScrollEdges")
    apply = CHAT_JS[a: CHAT_JS.index("function _scheduleChatScrollEdges")]
    assert ".getBoundingClientRect(" not in apply, (
        "the scroll-edge apply pass must NOT force a synchronous layout (getBoundingClientRect)"
    )
    # it toggles the three state classes
    assert "'edge-top'" in apply and "'edge-bottom'" in apply and "'chat-scrolled'" in apply


def test_observer_is_childlist_only_not_subtree():
    """The content-growth observer watches childList ONLY (not subtree/characterData) so
    streaming token appends into an existing bubble never storm it."""
    assert "mo.observe(box, { childList: true })" in CHAT_JS, (
        "the scroll-edge observer must watch childList only (not subtree/characterData)"
    )
    # guard against an accidental subtree/characterData widening on THIS observer call
    call = CHAT_JS[CHAT_JS.index("mo.observe(box,"):]
    call = call[: call.index(")") + 1]
    assert "subtree" not in call and "characterData" not in call


def test_scroll_edges_do_not_touch_streaming_buffers():
    """The added CODE is glass polish only — it must not reference the streaming/reasoning
    buffers or the live-stream render path (the reasoning-scrub contract). Scoped to the
    executable functions, not the doc-comment (which names them to document the contract)."""
    a = CHAT_JS.index("var _scrollEdgeRaf = 0;")
    seg = CHAT_JS[a: CHAT_JS.index("export function init(apiBase)")]
    for forbidden in ("roundReplyText", "roundReasoningText", "_renderLiveStream"):
        assert forbidden not in seg, (
            f"the #738 item 9 block must not touch {forbidden} (streaming/render contract)"
        )

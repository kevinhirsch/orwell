"""Liquid-glass chat-transcript legibility follow-up (owner-relayed):

Three chat-region defects under the glass theme (body.theme-frosted), each source-pinned
CSS/JS-as-text like the other FE chrome tests (the pytest lane has no DOM runtime; the live
computed contrast is verified by the render-verify loop under Playwright — see the agent
scratchpad screenshots + measured contrast in the PR).

BUG 1 — the "Thinking" accordion BODY text was white-on-white (illegible).
  The header row was already flipped to the neutral dark ink (#759/#761), but the reasoning
  BODY (.thinking-content / .thinking-content-inner) kept the CSS default `color: var(--fg)`,
  which on the glass theme is the LIGHT cyan ink → light-on-light on the fixed light glass.
  FIX: under body.theme-frosted the content body resolves to the neutral dark chrome ink
  (#16191f) with a LIGHT legibility halo (NOT a dark drop-shadow smudge).

BUG 2 — the timestamp on the BLUE "You" (sent) bubble was gray-on-blue + a dark drop-shadow.
  FIX: under body.theme-frosted the .msg-user timestamp is high-opacity WHITE (legible on the
  system-blue fill) and DROPS the dark (black) drop-shadow. The received (frost) bubble's
  timestamp is untouched.

SCOPE ADDITION — NIX the per-message action icons on SENT (.msg-user) bubbles.
  Under the glass theme the lone gray "Copy" glyph was illegible on the blue fill; the
  played-record model already strips the record-altering actions. FIX: the game build renders
  NO action buttons for the sent footer (JS gate in createUserMsgFooter) + a CSS belt hiding
  .msg-user .msg-actions. RECEIVED / GM messages keep their actions.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
RENDERER_JS = (FE / "static" / "js" / "chatRenderer.js").read_text(encoding="utf-8")

CHROME_INK = "#16191f"  # the shared neutral dark ink for the light glass chrome


def _css_blocks(text: str, selector_literal: str):
    """All declaration blocks (selectors, body) whose selector LIST contains the literal."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
        if selector_literal in m.group(1):
            out.append((m.group(1).strip(), m.group(2)))
    return out


def _is_dark_text_shadow(val: str) -> bool:
    """A black-ish drop-shadow: rgba(0,0,0,...) or rgb(0,0,0) or #000-family or 'black'.
    The blue-halo we add — rgba(0,40,90,...) — is NOT a dark *black* smudge (it's a soft
    same-hue rim) so it does not count, and the white halo on the reasoning body does not
    either."""
    v = val.lower()
    if "rgba(0,0,0" in v or "rgb(0,0,0" in v:
        return True
    if re.search(r"#000(\b|0|f)", v):
        return True
    if re.search(r"\bblack\b", v):
        return True
    return False


# ── BUG 1 — the reasoning BODY is the neutral dark ink + a LIGHT halo on the glass ─────

def test_thinking_content_body_neutral_dark_ink_under_frosted():
    """.thinking-content / .thinking-content-inner must resolve to the neutral dark chrome
    ink under body.theme-frosted — NOT the light var(--fg) (which is white-on-white)."""
    frosted = [
        (s, b)
        for sel in (".thinking-content", ".thinking-content-inner")
        for s, b in _css_blocks(CSS, sel)
        if "body.theme-frosted" in s
    ]
    assert frosted, "no body.theme-frosted .thinking-content* rule (the reasoning-body fix)"
    # at least one block must set the explicit dark ink
    inked = [
        (s, b) for s, b in frosted
        if re.search(r"(?<!-)\bcolor\s*:\s*[^;]*" + re.escape(CHROME_INK), b)
    ]
    assert inked, (
        f".thinking-content body must carry the neutral chrome ink {CHROME_INK} under "
        "body.theme-frosted (was the light var(--fg) → illegible white-on-white)"
    )
    for _, body in inked:
        cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);?", body)
        val = cm.group(1).strip().rstrip(";")
        assert "var(--fg)" not in val, (
            ".thinking-content body must not key its ink off the light --fg "
            "(white-on-white on the light glass)"
        )


def test_thinking_content_body_has_light_not_dark_halo():
    """The reasoning body's text-shadow on the glass must be a LIGHT legibility halo
    (white-ish), never a dark/black drop-shadow (which under dark ink is a dirty smudge)."""
    frosted = [
        (s, b)
        for sel in (".thinking-content", ".thinking-content-inner")
        for s, b in _css_blocks(CSS, sel)
        if "body.theme-frosted" in s
    ]
    shadowed = [
        (s, b) for s, b in frosted if re.search(r"text-shadow\s*:", b)
    ]
    assert shadowed, ".thinking-content body sets no text-shadow under frosted"
    saw_light_halo = False
    for _, body in shadowed:
        ts = re.search(r"text-shadow\s*:\s*([^;]+);?", body)
        val = ts.group(1).strip().rstrip(";")
        if val in ("none",):
            # inline code chip legitimately drops the shadow — fine, just not the plain text
            continue
        assert not _is_dark_text_shadow(val), (
            f".thinking-content body text-shadow {val!r} is a dark/black smudge — "
            "must be a LIGHT (white-ish) legibility halo under dark ink"
        )
        if "255,255,255" in val or "255, 255, 255" in val:
            saw_light_halo = True
    assert saw_light_halo, (
        "the reasoning body's plain text must carry a LIGHT (rgba(255,255,255,...)) halo "
        "on the glass"
    )


# ── BUG 2 — the SENT (blue) bubble timestamp is WHITE, no dark drop-shadow ──────────────

def test_sent_bubble_timestamp_white_on_blue_under_frosted():
    """The .msg-user timestamp must be high-opacity WHITE under body.theme-frosted (legible
    on the system-blue fill), NOT a gray/muted token."""
    frosted = [
        (s, b)
        for sel in (".msg-user .role-timestamp", ".msg-user .timestamp", ".msg-user .msg-time")
        for s, b in _css_blocks(CSS, sel)
        if "body.theme-frosted" in s
    ]
    assert frosted, "no body.theme-frosted .msg-user timestamp rule (the sent-bubble fix)"
    inked = [(s, b) for s, b in frosted if re.search(r"(?<!-)\bcolor\s*:", b)]
    assert inked, ".msg-user timestamp frosted rule sets no color"
    for _, body in inked:
        cm = re.search(r"(?<!-)\bcolor\s*:\s*([^;]+);?", body)
        val = cm.group(1).strip().rstrip(";").lower()
        is_white = (
            "#fff" in val or "#ffffff" in val
            or re.search(r"rgba?\(\s*255\s*,\s*255\s*,\s*255", val) is not None
            or val == "white"
        )
        assert is_white, (
            f".msg-user timestamp must be WHITE on the blue fill, got {val!r} "
            "(gray-on-blue was the illegibility)"
        )
        assert "var(--color-muted-alt)" not in val and "var(--fg)" not in val, (
            ".msg-user timestamp must not key off a muted/--fg token (gray on blue)"
        )


def test_sent_bubble_timestamp_drops_dark_drop_shadow():
    """The .msg-user timestamp must DROP the dark (black) drop-shadow under frosted — that
    dark shadow on the blue+gray pairing was the illegibility."""
    frosted = [
        (s, b)
        for sel in (".msg-user .role-timestamp", ".msg-user .timestamp", ".msg-user .msg-time")
        for s, b in _css_blocks(CSS, sel)
        if "body.theme-frosted" in s
    ]
    shadowed = [(s, b) for s, b in frosted if re.search(r"text-shadow\s*:", b)]
    assert shadowed, (
        ".msg-user timestamp must explicitly set text-shadow under frosted (to override the "
        "inherited bubble dark drop-shadow)"
    )
    for _, body in shadowed:
        ts = re.search(r"text-shadow\s*:\s*([^;]+);?", body)
        val = ts.group(1).strip().rstrip(";")
        assert not _is_dark_text_shadow(val), (
            f".msg-user timestamp text-shadow {val!r} is still a dark/black drop-shadow — "
            "must be dropped (none) or a soft same-hue rim, never black"
        )


# ── SCOPE ADDITION — NO per-message action icons on the SENT bubble ────────────────────

def test_sent_bubble_actions_hidden_css_belt():
    """A CSS belt must hide .msg-user .msg-actions in the game build (the lowest-risk
    mechanism), scoped to the SENT bubble only."""
    blocks = _css_blocks(CSS, ".msg-user .msg-actions")
    hide = [
        (s, b) for s, b in blocks
        if "data-game-build" in s and re.search(r"display\s*:\s*none", b)
    ]
    assert hide, (
        "no `body[data-game-build] .msg-user .msg-actions { display: none }` belt — "
        "the sent-bubble action icons must be nixed in the game build"
    )
    # MUST be scoped to .msg-user — the received/GM actions must NOT be hidden.
    for s, _ in hide:
        assert ".msg-ai" not in s, (
            "the action-hide belt must be scoped to .msg-user only — received/GM actions stay"
        )


def test_sent_bubble_footer_renders_no_actions_in_game_build():
    """The JS gate: createUserMsgFooter must render an EMPTY action pool in the game build
    (no edit/delete/resend/copy on the sent bubble), while the RECEIVED footer
    (createMsgFooter) keeps its actions."""
    m = re.search(r"function createUserMsgFooter\([^)]*\)\s*\{(.*?)\n\}", RENDERER_JS, re.S)
    assert m, "createUserMsgFooter not found"
    body = m.group(1)
    pool = re.search(r"const userPool\s*=\s*([^;]+);", body)
    assert pool, "createUserMsgFooter no longer assigns userPool"
    expr = pool.group(1)
    assert "data-game-build" in expr, (
        "the sent-footer action pool must be gated on the game build"
    )
    # the game-build branch must be the empty pool (no Copy/edit/delete/resend kept).
    assert re.search(r"data-game-build['\"]\)\s*\?\s*\[\s*\]", expr), (
        "in the game build createUserMsgFooter must use an EMPTY action pool ([]) — "
        f"got {expr!r}"
    )

    # the RECEIVED footer (createMsgFooter) must STILL build actions (regression guard).
    rm = re.search(r"function createMsgFooter\([^)]*\)\s*\{(.*?)\n\}", RENDERER_JS, re.S)
    assert rm, "createMsgFooter not found"
    rbody = rm.group(1)
    assert "_GAME_KEEP" in rbody and "actionPool" in rbody, (
        "createMsgFooter (received/GM) must still build its action pool — only the SENT "
        "footer loses its actions"
    )

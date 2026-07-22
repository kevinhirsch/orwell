"""R-A11Y-1: keyboard-operable + ARIA-stated reasoning accordion toggle.

Source-pinned convention checks (no DOM runtime needed). Verifies:
  - createThinkingSection / createCollapsible have role="button", tabindex="0",
    aria-expanded="false", aria-controls="${id}"
  - _setThinkingExpanded updates aria-expanded on the header
  - Keydown handler for Enter/Space on .thinking-header[data-thinking-id]
  - a11y.js ROW_SELECTOR covers .thinking-header[data-thinking-id]
  - style.css has .thinking-header:focus-visible
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _has(js, pattern):
    return pattern in js


# ── createThinkingSection ARIA attributes ────────────────────────────────────


def test_createThinkingSection_has_role_button():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'role="button"'), "createThinkingSection must have role button"


def test_createThinkingSection_has_tabindex():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'tabindex="0"'), "createThinkingSection must have tabindex 0"


def test_createThinkingSection_has_aria_expanded():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'aria-expanded="false"'), "createThinkingSection must have aria-expanded false"


def test_createThinkingSection_has_aria_controls():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'aria-controls="'), "createThinkingSection must have aria-controls with dynamic id"


# ── createCollapsible ARIA attributes ────────────────────────────────────────


def test_createCollapsible_has_role_button():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'role="button"'), "createCollapsible must have role button"


def test_createCollapsible_has_aria_controls():
    js = _read("static", "js", "markdown.js")
    assert _has(js, 'aria-controls="'), "createCollapsible must have aria-controls with dynamic id"


# ── Keydown handler ──────────────────────────────────────────────────────────

def test_thinking_keydown_handler():
    js = _read("static", "js", "markdown.js")
    assert "addEventListener('keydown'" in js, "keydown event listener not found"
    assert "e.key !== 'Enter'" in js, "keydown handler must check for Enter key"
    assert "e.key !== ' '" in js or "e.key !== 'Spacebar'" in js, "keydown handler must check for Space key"
    assert "closest('.thinking-header[data-thinking-id]')" in js, "keydown handler must target thinking-header"


def test_handler_registered_after_click():
    js = _read("static", "js", "markdown.js")
    click_pos = js.find("addEventListener('click'")
    keydown_pos = js.find("addEventListener('keydown'")
    assert click_pos >= 0, "click handler not found"
    assert keydown_pos >= 0, "keydown handler not found"
    assert keydown_pos > click_pos, "keydown handler must be registered after the click handler"


# ── _setThinkingExpanded updates aria-expanded ───────────────────────────────

def test_setThinkingExpanded_updates_aria_expanded():
    js = _read("static", "js", "markdown.js")
    assert "header.setAttribute('aria-expanded'" in js, "_setThinkingExpanded must set aria-expanded on header"
    assert "expanded ? 'true' : 'false'" in js, "aria-expanded must use expanded param for true/false"


# ── a11y.js covers thinking header ───────────────────────────────────────────

def test_a11y_js_covers_thinking_header():
    a11y = _read("static", "js", "a11y.js")
    assert ".thinking-header[data-thinking-id]" in a11y, "a11y.js ROW_SELECTOR must include thinking-header"


# ── CSS :focus-visible style ─────────────────────────────────────────────────

def test_thinking_header_focus_visible_style():
    css = _read("static", "style.css")
    assert ".thinking-header:focus-visible" in css, "style.css must have thinking-header:focus-visible"
    assert "outline: 2px solid" in css, "thinking-header:focus-visible must specify outline"

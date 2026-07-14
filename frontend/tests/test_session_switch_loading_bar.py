"""#11 snappy UX — the session-switch loading affordance.

The highest-frequency wait in the app is switching between chats: selectSession()
awaits GET /api/history, and DURING that await the chat pane still shows the
PREVIOUS chat's content at full opacity. On a slow load that reads as a frozen UI.

The fix (pinned here) is a thin indeterminate top progress bar on #chat-container
shown for the duration of that fetch — a real "we're not hanging" cue — that is:
  1. shown BEFORE the /api/history await (so it's up during the whole wait),
  2. only shown when actually switching AWAY from another chat (prevSessionId !== id),
  3. NON-destructive — it never touches #chat-history's message DOM, so the
     "never eat a message" pending-send rescue in selectSession stays intact,
  4. cleared in selectSession's `finally` on EVERY exit path (happy / early-return
     / error), guarded by navToken so a superseded stale switch can't tear down
     the newer switch's bar,
  5. backed by CSS that carries a prefers-reduced-motion fallback (no sliding
     animation — a steady tint — per WCAG 2.3.3 / 2.2.2).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
SESSIONS = (FE / "static" / "js" / "sessions.js").read_text(encoding="utf-8")
STYLE = (FE / "static" / "style.css").read_text(encoding="utf-8")


def test_helper_toggles_class_and_aria_busy():
    """The helper flips the .chat-switching class AND aria-busy on #chat-container."""
    m = re.search(r"function _setChatSwitchingBar\(on\)\s*\{(.*?)\n\}", SESSIONS, re.S)
    assert m, "_setChatSwitchingBar helper must exist"
    body = m.group(1)
    assert "getElementById('chat-container')" in body
    assert "classList.toggle('chat-switching'" in body
    assert "aria-busy" in body


def test_bar_is_shown_before_the_history_fetch_and_only_on_a_real_switch():
    """The show call sits just before the /api/history await, gated on prevSessionId !== id."""
    idx_show = SESSIONS.find("if (prevSessionId !== id) _setChatSwitchingBar(true);")
    assert idx_show != -1, "must show the bar only when switching away from another chat"
    idx_fetch = SESSIONS.find("fetch(`${API_BASE}/api/history/${id}`)")
    assert idx_fetch != -1
    assert idx_show < idx_fetch, "the bar must be shown BEFORE awaiting /api/history"


def test_bar_is_cleared_in_finally_guarded_by_navtoken():
    """Cleanup lives in the finally and is navToken-guarded so a stale switch can't stomp."""
    assert "if (navToken === _sessionNavToken) _setChatSwitchingBar(false);" in SESSIONS
    # the clear must be inside the finally block (after the catch), not the try body
    idx_finally = SESSIONS.find("} finally {", SESSIONS.find("Error in selectSession"))
    idx_clear = SESSIONS.find("_setChatSwitchingBar(false)")
    assert idx_finally != -1 and idx_clear != -1
    assert idx_clear > idx_finally, "the clear must run in the finally, guaranteeing every exit path"


def test_bar_never_touches_the_message_dom():
    """Non-destructive: the helper must not clear/rewrite #chat-history (the rescue depends on it)."""
    m = re.search(r"function _setChatSwitchingBar\(on\)\s*\{(.*?)\n\}", SESSIONS, re.S)
    body = m.group(1)
    assert "innerHTML" not in body
    assert "chat-history" not in body


def test_css_defines_the_bar_with_a_reduced_motion_fallback():
    assert ".chat-container.chat-switching::after" in STYLE
    assert "@keyframes chatSwitchSlide" in STYLE
    # the reduced-motion block must disable the animation for the bar
    m = re.search(
        r"@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*chat-switching::after[^}]*animation:\s*none",
        STYLE,
        re.S,
    )
    assert m, "reduced-motion must turn off the sliding animation for the switching bar"

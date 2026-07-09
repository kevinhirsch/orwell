"""#831 — empty composer → "+" attach button; drop the redundant paperclip. SOURCE-PINS.

Owner request: in the game build, when the chat box is EMPTY the send button must not act as
"send" — it is a "+" attach-files affordance that opens the file picker; the moment any text or
attachment is present it becomes the real Send button. Once that "+" carries attach, the standalone
composer paperclip is redundant and is dropped, so the composer shows exactly ONE attach control.

These pins guard the send-button state machine + the paperclip drop in `static/app.js` so a future
edit can't silently regress the affordance. No network/engine; roles only (no player names).

Run: cd frontend && .venv/bin/python -m pytest tests/test_831_composer_attach_affordance.py
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


APP_JS = _read("static", "app.js")


def _icon_fn():
    """The body of `_updateSendBtnIcon()` up to the send-btn click wiring."""
    fn = APP_JS[APP_JS.index("function _updateSendBtnIcon()"):]
    return fn[: fn.index("\n  }\n\n  if (sendBtn)")]


def _click_handler():
    """The send-btn click handler body."""
    h = APP_JS[APP_JS.index("sendBtn.addEventListener('click'"):]
    return h[: h.index("Enter to send")] if "Enter to send" in h else h[:4000]


# ── 1. empty composer paints the "+" ATTACH affordance in the game build ───────

def test_empty_game_build_composer_is_attach_mode_not_send():
    fn = _icon_fn()
    # The game-build empty branch arms the 'attach' mode (the "+"), never a bare send/newchat.
    seg = fn[fn.index("hasAttribute('data-game-build')"):]
    seg = seg[: seg.index("} else {")]
    assert "newMode = 'attach'" in seg, \
        "an empty composer in the game build must arm the '+' attach affordance (mode 'attach')"
    assert "newMode = 'newchat'" not in seg, \
        "the mode must be 'attach' (never 'newchat') so the A6 no-detach guarantee holds"
    assert "_newChatIcon" in seg, "the attach affordance shows the '+' glyph"


def test_attach_mode_click_opens_the_file_picker():
    h = _click_handler()
    assert "dataset.mode === 'attach'" in h, \
        "the send-btn click handler must branch on the 'attach' mode"
    seg = h[h.index("dataset.mode === 'attach'"):]
    seg = seg[: seg.index("return;") + 7]
    assert "file-input" in seg and "click()" in seg, \
        "clicking the '+' attach affordance must open the hidden #file-input picker"


# ── 2. the redundant standalone paperclip is dropped in the game build ─────────

def test_standalone_paperclip_is_not_shown_in_game_build():
    # The old #760 line unhid the paperclip in the game build; #831 removes that show so the
    # send-button "+" is the single attach control. The wiring stays (harmless fallback).
    seg = APP_JS[APP_JS.index("_composerAttach = el('composer-attach-btn')"):]
    seg = seg[:400]
    assert "_composerAttach.style.display = ''" not in seg, \
        "the standalone composer paperclip must NOT be un-hidden in the game build (#831 drops it)"
    # attach is still reachable through the same #file-input flow (defense-in-depth).
    assert "file-input" in seg and "click()" in seg, \
        "the paperclip's file-input wiring stays as a harmless no-op fallback"


def test_tray_attach_duplicate_still_dropped_in_game_build():
    # The game build still removes the overflow-tray "Attach files" duplicate, so the composer
    # never shows two attach entry points.
    gate = APP_JS[APP_JS.index("function applyGameBuildMenuGating"):]
    gate = gate[: gate.index("_g13CascadeMenuTriggers();") + 40]
    assert "overflow-attach-btn" in gate and "remove()" in gate and "data-game-build" in gate

"""Settings window must stay resizeable on the WIDTH axis (regression guard, source-pinned).

Sibling of test_977_cast_window_resizable.py — the SAME bug class, on the Settings window.

The regression (cause, file:line):
  `#settings-modal` (the OrwellWindow kit window) declares `container-type: inline-size`
  (static/style.css) so its cqw @container queries key off the space it occupies. But
  `container-type: inline-size` applies INLINE-SIZE CONTAINMENT: the element's width is
  computed WITHOUT regard to its contents.

  The OrwellWindow kit's resize CAP (#902/#896, static/js/windowResize.js) measures the
  window at `width: max-content` (naturalContentWidth) to learn how wide the content
  genuinely wants. A size-contained window with NO `contain-intrinsic-size` placeholder
  reports ~0 there, so the cap collapses to the kit minimum (320px) and the Settings
  window can no longer be dragged wider on the width axis (verified live: naturalContent
  Width read 2px, widthCap collapsed to 320, a right-edge drag moved the width 0px).

The fix (settings-scoped, no kit change):
  declare `contain-intrinsic-size` on `#settings-modal` — the standard companion to size
  containment — so the kit's `naturalContentWidth` reads a real, generous content want
  (covering the .settings-modal-content `clamp(560px, 58cqw, 880px)` range + window chrome)
  and the window resizes freely on BOTH axes, WITHOUT pinning the live floor (the kit's
  inline width still governs the rendered size; the ≤768px sheet tier still skips resize).

These gates fail if the containment context or its intrinsic-size companion is removed, or
if settings.js opts the window out of kit resize.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLE_CSS = os.path.join(FE, "static", "style.css")
SETTINGS_JS = os.path.join(FE, "static", "js", "settings.js")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _settings_modal_base_rule(src):
    """The body of the BASE top-level `#settings-modal { ... }` rule (the window-sizing block).

    `#settings-modal\\s*\\{` matches only the bare id rule — NOT `#settings-modal.ow-window {`
    (a `.` sits between) and NOT the `#settings-modal,` selector-group member (a `,` follows).
    """
    m = re.search(r"#settings-modal\s*\{(.*?)\}", src, re.DOTALL)
    assert m, "#settings-modal base rule not found in style.css"
    return m.group(1)


def test_settings_window_still_declares_inline_size_container():
    """The cqw sizing context the settings layout resolves against (must stay)."""
    body = _settings_modal_base_rule(_read(STYLE_CSS))
    assert re.search(r"container-type:\s*inline-size", body), (
        "#settings-modal lost `container-type: inline-size` — its cqw @container layout "
        "would stop resolving against the space it occupies."
    )


def test_settings_window_declares_contain_intrinsic_size():
    """The fix: a size-contained window MUST provide an intrinsic-size placeholder so the
    kit's resize-cap (naturalContentWidth) reads a real content want and the window can be
    dragged wider than its minimum."""
    body = _settings_modal_base_rule(_read(STYLE_CSS))
    assert re.search(r"contain-intrinsic-size:", body), (
        "#settings-modal is `container-type: inline-size` (size-contained) but declares no "
        "`contain-intrinsic-size` — the kit resize-cap (#896 naturalContentWidth) measures "
        "~0 and pins the Settings window at its minimum: it cannot be resized on the width "
        "axis. This is the same class of bug as the #977 cast-window regression."
    )


def test_contain_intrinsic_size_width_covers_settings_content_range():
    """The intrinsic-size width must clear the settings content's full range so the cap
    doesn't stop the window short of what its own content wants. The .settings-modal-content
    clamps to a max of 880px; the window adds its own chrome, so require >= 880px."""
    body = _settings_modal_base_rule(_read(STYLE_CSS))
    m = re.search(r"contain-intrinsic-size:\s*[^;]*?(\d+)px", body)
    assert m, "contain-intrinsic-size has no px width to cap against"
    width = int(m.group(1))
    assert width >= 880, (
        f"contain-intrinsic-size width is {width}px but .settings-modal-content clamps up to "
        f"880px — the resize cap would freeze the window before reaching its content's range."
    )


def test_settings_window_does_not_opt_out_of_kit_resize():
    """settings.js must keep `resizable: true` (an explicit opt-out would also kill resize)."""
    src = _read(SETTINGS_JS)
    assert "resizable: false" not in src and "resizable:false" not in src, (
        "settings.js opts the window out of kit resize (`resizable: false`) — it must stay "
        "resizeable on both axes."
    )
    assert re.search(r"resizable:\s*true", src), (
        "settings.js no longer passes `resizable: true` to OrwellWindowKit.create — the "
        "Settings window would fall to a non-resizeable default."
    )

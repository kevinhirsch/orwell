"""#1638 — consumer #13: the message context / info popups on the shared OrwellPopover kit.

Three message-footer popups used to hand-roll their own body-appended frame, fixed-position
placement, and dismissal:

  • the model-info popover (click the role label)        — was `.ctx-popup`
  • the message-stats popover (click the metrics text)    — was `.ctx-popup`
  • the context-window popover (click the context ring)   — was `.ctx-detail-popup`

They now open through `OrwellPopoverKit.open({ ... })` as informational DIALOGs (role='dialog'
+ a REQUIRED ariaLabel), NOT action menus — none carries menuitems. (Being a dialog does not
mean "no controls": the context-window dialog legitimately holds a single Compact-context
button. The distinction that matters is dialog vs. menu, not interactive vs. inert.) The kit
owns anchoring (the flip/shift engine) and the dismiss seat (bindMenuDismiss + the escMenuStack
Escape arbiter), so each popup's bespoke positioning + per-popup bindMenuDismiss are DELETED and
both `.ctx-popup` / `.ctx-detail-popup` frame CSS blocks fold onto the kit's `.ow-popover`
surface — only the inner-content rules survive.

The model-name TEXT fields rendered into innerHTML are HTML-escaped through the canonical
`uiModule.esc()` helper (a model name is provider/user-supplied config → an XSS sink otherwise).

DEFERRED (anti-fragmentation allowlist): the memory-used pill's `.memory-used-detail` popover
STAYS on bindMenuDismiss. Its rows are interactive (open the memory manager) and its frame CSS
block is outside this lane's edit scope — folding it would double-paint the frame with no way to
retire the conflicting rules, so the cosmetic gain is not worth a fragile migration (issue
#1638, optional-if-fighting lane).

Source-pinned — the pytest lane has no DOM runtime; the live mount/dismiss is exercised by the
browser suite + browser_smoke.py.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
SRC = (FE / "static" / "js" / "chatRenderer.js").read_text(encoding="utf-8")
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")


def _handler_region(anchor, handle):
    """The source of ONE popup handler — from its toggle guard through its kit open() call —
    so each of the three popups is inspected INDEPENDENTLY (no aggregate counts / proximity)."""
    guard = f"if ({anchor}.{handle} && {anchor}.{handle}.isOpen())"
    open_call = f"{anchor}.{handle} = window.OrwellPopoverKit.open({{"
    assert guard in SRC, f"missing toggle guard for {anchor}.{handle}"
    assert open_call in SRC, f"missing OrwellPopoverKit open for {anchor}.{handle}"
    start = SRC.index(guard)
    open_idx = SRC.index(open_call, start)
    end = SRC.index("});", open_idx) + len("});")
    return SRC[start:end]


def _assert_dialog_via_kit(region, anchor, handle, arialabel):
    # opens through the shared kit as a role='dialog' with the REQUIRED ariaLabel …
    assert "window.OrwellPopoverKit.open({" in region
    assert "role: 'dialog'," in region, "the info popover must be a dialog"
    assert f"ariaLabel: '{arialabel}'," in region, f"missing/incorrect ariaLabel ({arialabel})"
    assert f"anchor: {anchor}," in region, f"the popover must anchor on {anchor}"
    # … it is NOT re-homed onto the action-menu layer …
    assert "OrwellMenuKit" not in region, "an info popover must not open as an action menu"
    # … a second click toggles it closed via the stored kit instance …
    assert f"{anchor}.{handle}.close('toggle')" in region, "missing toggle-close"
    assert f"{anchor}.{handle} = null" in region, "the toggle must clear the stored handle"
    # … and NO bespoke dismissal / positioning survives in this handler.
    assert "bindMenuDismiss" not in region, "the kit owns dismissal — drop bindMenuDismiss"
    assert "querySelectorAll('.ctx-popup')" not in region
    assert "querySelectorAll('.ctx-detail-popup')" not in region
    assert "document.body.appendChild" not in region, "the kit mounts the surface, not the handler"


# ── 1. each of the three popups, inspected independently ────────────────────────────────
def test_model_info_popover_is_an_independent_kit_dialog():
    region = _handler_region("roleEl", "_owInfoPop")
    _assert_dialog_via_kit(region, "roleEl", "_owInfoPop", "Model details")


def test_message_stats_popover_is_an_independent_kit_dialog():
    region = _handler_region("metricsContainer", "_owStatsPop")
    _assert_dialog_via_kit(region, "metricsContainer", "_owStatsPop", "Message stats")


def test_context_window_popover_is_an_independent_kit_dialog():
    region = _handler_region("ctxRing", "_owCtxPop")
    _assert_dialog_via_kit(region, "ctxRing", "_owCtxPop", "Context window")
    # it is a dialog that DOES carry one control — the compact button still resolves inside the
    # kit-mounted content, and its click closes the kit instance (falling back to remove()).
    assert "popup.querySelector('.ctx-compact-btn')" in region
    assert "ctxRing._owCtxPop.close('compact')" in region


# ── 2. the model-name text fields are HTML-escaped (XSS) ─────────────────────────────────
def test_model_name_text_fields_are_html_escaped():
    # model-info: both the short label and the split model id go through uiModule.esc().
    info = _handler_region("roleEl", "_owInfoPop")
    assert "uiModule.esc(short)" in info
    assert "uiModule.esc(modelName.split('/').pop())" in info
    # message-stats + context-window: the model id is escaped before it reaches innerHTML.
    stats = _handler_region("metricsContainer", "_owStatsPop")
    assert "uiModule.esc(model.split('/').pop())" in stats
    ctx = _handler_region("ctxRing", "_owCtxPop")
    assert "uiModule.esc(model.split('/').pop())" in ctx
    # no RAW (unescaped) model-id interpolation into any of the three popups' markup.
    for region in (info, stats, ctx):
        assert "${model.split('/').pop()}" not in region, "raw model id must be escaped"


# ── 3. the popup CONTENT is preserved verbatim ──────────────────────────────────────────
def test_content_is_preserved():
    # model-info: the ctx-label field rows + provider/context/pricing lines still render.
    assert '<span class="ctx-label">Model</span>' in SRC
    assert '<span class="ctx-label">Provider</span>' in SRC
    assert '<span class="ctx-label">Context</span>' in SRC
    # message-stats: the "Message Stats" panel + its rows.
    assert ">Message Stats</div>" in SRC
    for row in ("Input", "Output", "Total", "Speed", "Cost"):
        assert f'<span class="ctx-label">{row}</span>' in SRC, f"stats row lost: {row}"
    # context-window: the bar chart + the Compact-context button survive.
    assert ">Context Window</div>" in SRC
    assert "ctx-bar-fill" in SRC
    assert 'class="ctx-compact-btn"' in SRC


# ── 4. the frame CSS folds to .ow-popover; inner-content rules survive (whitespace-safe) ─
def _css_packed(css):
    """Strip block comments, then ALL whitespace — a selector written `.ctx-popup{`, split
    across lines, or reflowed normalizes identically, so the absence check can't be dodged."""
    no_comments = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return re.sub(r"\s+", "", no_comments)


def test_frame_css_blocks_retired_inner_content_kept():
    packed = _css_packed(CSS)
    # the two frame rules are gone (their chrome is now the shared .ow-popover surface) —
    # whitespace-insensitive so `.ctx-popup {`, `.ctx-popup{`, and a multiline selector all fail.
    assert ".ctx-popup{" not in packed, ".ctx-popup frame block must fold onto .ow-popover"
    assert ".ctx-detail-popup{" not in packed, ".ctx-detail-popup frame block must fold onto .ow-popover"
    # every inner-content rule is kept (top-level classes, not frame-scoped).
    for rule in (".ctx-label{", ".ctx-bar-wrap{", ".ctx-bar-fill{", ".ctx-compact-btn{"):
        assert rule in packed, f"inner-content rule wrongly removed: {rule}"


# ── 5. the memory-used-detail popover stays on bindMenuDismiss (allowlisted) ─────────────
def test_memory_used_detail_stays_on_bind_menu_dismiss():
    # the deferred popover keeps its bespoke path — its class + its dismiss call both remain.
    assert "detail.className = 'memory-used-detail'" in SRC, \
        "the memory-used-detail popover is intentionally left on its bindMenuDismiss path"
    assert "bindMenuDismiss(detail" in SRC
    # and its frame CSS block is untouched (outside this lane's edit scope).
    assert ".memory-used-detail{" in _css_packed(CSS), \
        "the memory-used-detail frame CSS must be left in place (deferred, not migrated)"

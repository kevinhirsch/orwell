"""#1638 — consumer #13: the message context / info popups on the shared OrwellPopover kit.

Three informational message-footer popups used to hand-roll their own body-appended
frame, fixed-position placement, and dismissal:

  • the model-info popover (click the role label)        — was `.ctx-popup`
  • the message-stats popover (click the metrics text)    — was `.ctx-popup`
  • the context-window popover (click the context ring)   — was `.ctx-detail-popup`

They now open through `OrwellPopoverKit.open({ ... })` with role='dialog' (they are
NON-INTERACTIVE info surfaces, not menus) + a REQUIRED ariaLabel. The kit owns anchoring
(the flip/shift engine) and the dismiss seat (bindMenuDismiss + the escMenuStack Escape
arbiter), so the bespoke positioning + per-popup bindMenuDismiss are DELETED and both
`.ctx-popup` / `.ctx-detail-popup` frame CSS blocks fold onto the kit's `.ow-popover`
surface. Only the inner-content rules survive.

DEFERRED (anti-fragmentation allowlist): the memory-used pill's `.memory-used-detail`
popover STAYS on bindMenuDismiss. Its rows are interactive (open the memory manager) and
its `.memory-used-detail` frame CSS block is outside this lane's edit scope — folding it to
`.ow-popover` would double-paint the frame with no way to retire the conflicting rules, so
the cosmetic gain is not worth a fragile migration (issue #1638, optional-if-fighting).

Source-pinned — the pytest lane has no DOM runtime; the live mount/dismiss is exercised by
the browser suite + browser_smoke.py.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
SRC = (FE / "static" / "js" / "chatRenderer.js").read_text(encoding="utf-8")
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")


# ── 1. all three info popups open through the kit as role='dialog' + ariaLabel ──────────
def test_three_info_popups_open_via_popover_kit():
    assert SRC.count("OrwellPopoverKit.open({") == 3, (
        "the model-info, message-stats and context-window popups must each open through "
        "the shared OrwellPopoverKit (three opens)"
    )
    # each carries a REQUIRED ariaLabel (role='dialog' THROWS without one) …
    for label in ("ariaLabel: 'Model details'", "ariaLabel: 'Message stats'",
                  "ariaLabel: 'Context window'"):
        assert label in SRC, f"missing kit ariaLabel for an info popup: {label}"
    # … and each is opened as role='dialog' (informational), NEVER role='menu'.
    assert SRC.count("role: 'dialog'") >= 3, "the info popovers must be role='dialog', not menus"


def test_info_popups_are_dialogs_not_menus():
    # the info popovers must NOT be re-homed onto the action-menu layer — they carry no
    # menuitems. (OrwellMenuKit legitimately still serves the message overflow menu.)
    for arialabel in ("Model details", "Message stats", "Context window"):
        # each ariaLabel belongs to an OrwellPopoverKit.open block, not a MenuKit block.
        idx = SRC.index(f"ariaLabel: '{arialabel}'")
        window = SRC[max(0, idx - 400):idx]
        assert "OrwellPopoverKit.open({" in window, (
            f"the '{arialabel}' popover must be opened via OrwellPopoverKit, not OrwellMenuKit"
        )


# ── 2. the bespoke frame / positioning / dismissal is DELETED (the kit owns it) ─────────
def test_bespoke_frame_and_dismissal_deleted_for_migrated_popups():
    # the migrated popups no longer stamp their retired frame classes …
    assert "className = 'ctx-popup'" not in SRC
    assert "className = 'ctx-detail-popup'" not in SRC
    # … the "close any open .ctx-popup / .ctx-detail-popup first" body sweeps are gone
    #   (the kit's outside-click seat closes a sibling popover on the new open) …
    assert "querySelectorAll('.ctx-popup')" not in SRC
    assert "querySelectorAll('.ctx-detail-popup')" not in SRC
    # … and none of the three migrated popups append themselves or hand-roll placement.
    assert "document.body.appendChild(popup)" not in SRC
    assert "document.body.appendChild(content)" not in SRC


def test_migrated_popups_no_longer_bind_menu_dismiss():
    # exactly ONE bindMenuDismiss call survives — the deferred memory-used-detail popover.
    assert SRC.count("bindMenuDismiss(") == 1, (
        "the model-info / message-stats / context-window popups must drop bindMenuDismiss "
        "(the kit owns dismissal); only the memory-used-detail popover keeps it"
    )
    # the toggle handle is a stored kit instance, not a re-created element each click.
    for handle in ("roleEl._owInfoPop", "metricsContainer._owStatsPop", "ctxRing._owCtxPop"):
        assert f"{handle}.isOpen()" in SRC, f"missing toggle guard for {handle}"


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
    # context-window: the bar chart + the (interactive) Compact-context button survive.
    assert ">Context Window</div>" in SRC
    assert "ctx-bar-fill" in SRC
    assert 'class="ctx-compact-btn"' in SRC
    assert "popup.querySelector('.ctx-compact-btn')" in SRC, \
        "the compact button handler must still resolve inside the kit-mounted content"


# ── 4. the frame CSS folds to .ow-popover; inner-content rules survive ──────────────────
def test_frame_css_blocks_retired_inner_content_kept():
    # the two frame rules are gone (their chrome is now the shared .ow-popover surface) …
    assert ".ctx-popup {" not in CSS, ".ctx-popup frame block must fold onto .ow-popover"
    assert ".ctx-detail-popup {" not in CSS, ".ctx-detail-popup frame block must fold onto .ow-popover"
    # … but every inner-content rule is kept (they are top-level classes, not frame-scoped).
    for rule in (".ctx-label {", ".ctx-bar-wrap {", ".ctx-bar-fill {", ".ctx-compact-btn {"):
        assert rule in CSS, f"inner-content rule wrongly removed: {rule}"


# ── 5. the memory-used-detail popover stays on bindMenuDismiss (allowlisted) ─────────────
def test_memory_used_detail_stays_on_bind_menu_dismiss():
    # the deferred popover keeps its bespoke path — its class + its dismiss call both remain.
    assert "detail.className = 'memory-used-detail'" in SRC, \
        "the memory-used-detail popover is intentionally left on its bindMenuDismiss path"
    assert "bindMenuDismiss(detail" in SRC
    # and its frame CSS block is untouched (outside this lane's edit scope).
    assert ".memory-used-detail {" in CSS, \
        "the memory-used-detail frame CSS must be left in place (deferred, not migrated)"

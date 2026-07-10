"""#660 (DWE / HIG F-CHROME-1) — styledConfirm + styledPrompt compose the kit (SOURCE-PINS).

The 2026-06-23 window-kit coverage audit (§1 class-B, §5 step 4) named ui.js's
`styledConfirm` / `styledPrompt` the last GAME-BUILD-REACHABLE bespoke `.modal`
micro-dialogs. This gate freezes their migration onto the OrwellWindow kit's
`modal:true` tier (`OrwellWindowKit.create({ modal:true, minimizable:false,
resizable:false, closable:true, persistLayout:false })`): they no longer hand-roll
a `.modal` / `.modal-content` root, and behavior (the Promise value shapes, button
labels, default→cancel, focus/scrim/Escape close) is preserved.

Wiring pins, NOT behavior coverage — the live behavior (a confirm/prompt opens,
traps focus, closes on Escape/scrim, resolves) rides the kit exercised in
frontend/scripts/browser_smoke.py. Companion: test_f3_window_ratchet.py stays green
(no NEW bare `.modal` root regrows); test_f_window_kit.py pins the kit itself.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _fn_body(src, name):
    """Slice a top-level `export function <name>(` body up to the next top-level def."""
    start = src.index("export function " + name + "(")
    rest = src[start + 1:]
    # next top-level marker after this function
    ends = [m for m in (rest.find("\nexport function "), rest.find("\nconst _ESC_MAP"))
            if m != -1]
    end = start + 1 + min(ends)
    return src[start:end]


UI = _read("static", "js", "ui.js")
CONFIRM = _fn_body(UI, "styledConfirm")
PROMPT = _fn_body(UI, "styledPrompt")


def test_confirm_composes_the_kit_modal():
    assert "OrwellWindowKit" in CONFIRM              # routes through the kit seam
    assert "Kit.create(" in CONFIRM
    for flag in ("modal: true", "minimizable: false", "resizable: false",
                 "closable: true", "persistLayout: false"):
        assert flag in CONFIRM, flag                 # the audit §5 step-4 recipe


def test_prompt_composes_the_kit_modal():
    assert "OrwellWindowKit" in PROMPT
    assert "Kit.create(" in PROMPT
    for flag in ("modal: true", "minimizable: false", "resizable: false",
                 "closable: true", "persistLayout: false"):
        assert flag in PROMPT, flag


def test_no_bespoke_modal_root_construction_remains():
    # The class-B holdout was a hand-built `.modal` overlay wrapping a `.modal-content`
    # box. Neither may survive in either dialog builder.
    for body, name in ((CONFIRM, "styledConfirm"), (PROMPT, "styledPrompt")):
        assert "modal-content" not in body, name         # no bespoke content root
        assert "className = 'modal'" not in body, name    # no bare `.modal` overlay
        assert 'class="modal-content"' not in body, name
        assert "'modal'" not in body, name                # no bare modal class token
        # no `.modal-*` chrome parts either (the kit owns titlebar/body/footer)
        assert "modal-header" not in body and "modal-footer" not in body, name
        assert "modal-body" not in body, name


def test_escape_is_delegated_to_the_kit_arbiter():
    # The bespoke per-dialog Escape keydown trap is gone — Escape now flows through
    # ui.js's single arbiter → OrwellWindowKit.dismissTop() (the kit modal closes).
    for body, name in ((CONFIRM, "styledConfirm"), (PROMPT, "styledPrompt")):
        assert "'Escape'" not in body and '"Escape"' not in body, name
        assert "document.addEventListener('keydown'" not in body, name  # no global trap


def test_scrim_close_affordance_is_preserved():
    # The legacy dialogs dismissed on a backdrop click; the kit scrim is non-dismissing
    # by default, so the helper re-wires click-to-cancel onto the kit's [data-ow-scrim].
    assert "_wireScrimClose" in UI
    assert "data-ow-scrim" in UI
    assert "_wireScrimClose('styled-confirm-overlay'" in CONFIRM
    assert "_wireScrimClose('styled-prompt-overlay'" in PROMPT


def test_overlay_id_contract_preserved_for_sidebar_layout():
    # sidebar-layout.js guards clicks inside #styled-confirm-overlay / #styled-prompt-overlay
    # so a sidebar-triggered dialog isn't yanked mid-flight — keep the ids on the kit roots.
    assert "id: 'styled-confirm-overlay'" in CONFIRM
    assert "id: 'styled-prompt-overlay'" in PROMPT
    sidebar = _read("static", "js", "sidebar-layout.js")
    assert "#styled-prompt-overlay" in sidebar and "#styled-confirm-overlay" in sidebar


def test_return_value_shapes_preserved():
    # confirm: Promise<boolean> — settle(true) on OK, settle(false) otherwise.
    assert "settle(true)" in CONFIRM and "settle(false)" in CONFIRM
    assert "onClose: () => settle(false)" in CONFIRM
    # prompt: Promise<string|null> — trimmed input on OK, null otherwise.
    assert ".trim()" in PROMPT
    assert "settle(null)" in PROMPT
    assert "onClose: () => settle(null)" in PROMPT

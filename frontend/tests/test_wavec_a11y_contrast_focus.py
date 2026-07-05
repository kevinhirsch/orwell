"""Wave-C accessibility pass — measured WCAG contrast failures + keyboard/focus/AT gaps.

Source-pinned convention checks (no DOM runtime needed), mirroring the style of
test_s6_4_on_accent_contrast.py (WCAG math) and test_j4_decision_card_a11y.py
(source-pinned wiring). Roles only — no character names.

Fixes covered (see the audit's ux-content-a11y / ux-visual-motion / ux-interaction lanes):
  - VM-16 / CA-11: the risk badge ("Irreversible — binding") failed contrast (measured
    ~2.25:1) on the frosted/light theme's card. Now a solid `--ow-danger` fill + dark ink.
  - VM-17: the disabled "Confirm — this is binding" label failed contrast (measured
    ~1.74:1) under the frosted theme's opacity-based disabled state. Now an opaque
    muted fill + opaque muted-dark ink, independent of what's composited behind it.
  - CA-14: the decision card's aria-label didn't actually fold in the risk-badge text,
    despite the code's own comment claiming it did.
  - CA-10: the `/setup` welcome-screen trigger was a non-interactive `<span>` —
    unreachable by keyboard/AT. Now a real `<button>`.
  - CA-2 / CA-26: the "not sent" status tag was CSS generated content only
    (`::after { content: 'not sent' }`) — invisible to assistive tech (WCAG 4.1.3).
    Now a real text node + a toast announcement with an explicit remedy.
  - INT-5 / INT-6: the headshot studio's disabled action buttons gave no reason why
    (WCAG 3.3.2) and were distinguished from the enabled state by opacity alone.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FE, *rel), encoding="utf-8") as f:
        return f.read()


# ── WCAG relative luminance + contrast (sRGB) — mirrors test_s6_4_on_accent_contrast.py ──

def _lum(hexstr):
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a, b):
    l1, l2 = sorted((_lum(a), _lum(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


AA_NORMAL = 4.5
AA_UI = 3.0


# ── VM-16 / CA-11: the risk badge must clear AA on the frosted card ─────────────

def test_risk_badge_frosted_override_exists():
    css = _read("static", "style.css")
    m = re.search(r"body\.theme-frosted \.odec-risk-badge\s*\{([^}]*)\}", css)
    assert m, "no body.theme-frosted .odec-risk-badge override found — the badge is unstyled on the frosted/light card"
    body = m.group(1)
    assert "var(--ow-danger" in body, "the frosted badge should reuse the app's existing --ow-danger token, not an ad-hoc color"
    assert "#16191f" in body, "the frosted badge should use the card's own established dark-ink convention"


def test_risk_badge_frosted_colors_clear_aa_small_text():
    # The measured failure: text rgb(255,68,68) on fill rgb(222,206,209) ~= 2.25:1.
    assert _ratio("#ff4444", "#deced1") < AA_NORMAL, "sanity: the OLD badge colors should be the failing baseline (~2.25:1)"
    # The fix: dark ink (#16191f) on the solid --ow-danger fill (#ff453a fallback).
    ratio = _ratio("#16191f", "#ff453a")
    assert ratio >= AA_NORMAL, (
        f"fixed risk-badge ink/fill is {ratio:.2f}:1, must be >= {AA_NORMAL}:1 (badge text is small/bold, "
        "not large text, so it needs the full text floor, not just the 3:1 UI floor)"
    )


# ── VM-17: the disabled Confirm/option/window-button state must clear the UI floor ──

def test_disabled_button_frosted_override_is_opaque_not_opacity_based():
    css = _read("static", "style.css")
    m = re.search(
        r"body\.theme-frosted \.send-btn:disabled,\s*"
        r"body\.theme-frosted \.odec-confirm:disabled,\s*"
        r"body\.theme-frosted \.odec-opt:disabled,\s*"
        r"body\.theme-frosted \.ow-window \.ow-body button:disabled\s*\{([^}]*)\}",
        css,
    )
    assert m, "the shared frosted disabled-button rule has moved or been removed"
    body = m.group(1)
    # The old bug: `opacity: .4` blended fg+bg toward the backdrop equally, collapsing contrast.
    assert "opacity: 1 !important" in body, "disabled buttons must be fully opaque (not opacity-faded) so contrast can't collapse against an arbitrary backdrop"
    assert "background: #d6d6d9" in body, "disabled buttons must paint a fixed, opaque muted background"
    assert "color: #57575c" in body, "disabled buttons must paint a fixed, opaque muted-dark label color"


def test_disabled_button_frosted_colors_clear_ui_floor():
    # The measured failure: label rgb(239,243,244) on fill rgb(156,190,222) ~= 1.74:1.
    assert _ratio("#eff3f4", "#9cbede") < AA_UI, "sanity: the OLD disabled colors should be the failing baseline (~1.74:1)"
    ratio = _ratio("#57575c", "#d6d6d9")
    assert ratio >= AA_NORMAL, (
        f"fixed disabled-button ink/fill is {ratio:.2f}:1, must clear at least {AA_UI}:1 "
        "(the disabled-state UI-component floor VM-17 asks for) — it in fact clears the full text floor too"
    )


# ── CA-14: the aria-label must actually fold in the risk-badge text ─────────────

def test_decision_card_aria_label_includes_badge_text_when_risk():
    js = _read("static", "js", "orwellDecision.js")
    assert re.search(
        r'card\.setAttribute\("aria-label",\s*titleFor\(kind,\s*pending\.binding\)\s*\+\s*\(risk\s*\?\s*"[^"]*Irreversible[^"]*"\s*:\s*""\)\)',
        js,
    ), (
        "the card's aria-label must concatenate the risk-badge text (\"— Irreversible, binding\") "
        "when the kind is high-stakes, so a landmark-navigation screen-reader user hears the stakes "
        "signal from the landmark's own name, not only by reading the card body linearly"
    )
    # `risk` must be computed BEFORE the aria-label line uses it.
    risk_idx = js.index("const risk = isHighStakes(kind);")
    label_idx = js.index('card.setAttribute("aria-label", titleFor(kind, pending.binding) + (risk')
    assert risk_idx < label_idx, "`risk` must be computed before the aria-label references it"


# ── CA-10: the /setup welcome trigger must be a real, keyboard-operable control ──

def test_setup_trigger_is_a_real_button_not_a_span():
    html = _read("static", "index.html")
    js = _read("static", "js", "models.js")
    for label, src in (("index.html", html), ("models.js", js)):
        assert '<span class="setup-trigger-link"' not in src, (
            f"{label}: the /setup trigger must not be a non-interactive <span> "
            "(unreachable by keyboard/AT — WCAG 2.1.1 / 4.1.2)"
        )
        assert '<button type="button" class="setup-trigger-link tap-exempt"' in src, (
            f"{label}: the /setup trigger must be a real <button> so it is in the natural "
            "Tab order and Enter/Space-activatable without any extra keydown wiring — and carry "
            "`tap-exempt` since it is an inline word inside a sentence (the WCAG 2.5.5/2.5.8 "
            "'target is in a sentence' exception; forcing it to a 44px block would break the "
            "reading flow of the surrounding text)"
        )


def test_setup_trigger_click_delegate_still_matches_any_tag():
    # slashCommands.js must keep using .closest('.setup-trigger-link') (class-based, tag-agnostic)
    # so swapping <span> for <button> didn't require touching the click wiring.
    js = _read("static", "js", "slashCommands.js")
    assert "e.target.closest('.setup-trigger-link')" in js


# ── CA-2 / CA-26: "not sent" must be real text (not CSS ::after content), + announced ──

def test_not_sent_tag_is_a_real_text_node_not_css_content():
    css = _read("static", "style.css")
    assert "content: 'not sent';" not in css, (
        "the 'not sent' status must not be carried SOLELY by a CSS ::after `content` DECLARATION "
        "(WCAG 4.1.3 — inconsistent/non-guaranteed exposure to the accessibility tree)"
    )
    assert re.search(r"\.msg-user\.msg-unsent \.role \.unsent-tag\s*\{", css), (
        "style.css must style a REAL `.unsent-tag` element instead of a ::after pseudo-element"
    )
    js = _read("static", "js", "chat.js")
    assert '_tag.className = \'unsent-tag\'' in js and "_tag.textContent = 'not sent'" in js, (
        "chat.js must create a real DOM text node ('not sent') rather than relying on CSS content"
    )


def test_not_sent_fires_a_screen_reader_announcement_with_a_remedy():
    js = _read("static", "js", "chat.js")
    m = re.search(r"const _abortSendKeepMessage = \(assistantNote\) => \{(.*?)\n    \};", js, re.S)
    assert m, "_abortSendKeepMessage not found in chat.js"
    block = m.group(1)
    assert "uiModule.showToast(" in block, (
        "the unsent-message path must announce via the existing role=status/aria-live toast "
        "so a screen-reader user gets a one-time, non-disruptive status message"
    )
    assert "resend" in block.lower(), (
        "the announcement must give an explicit remedy (edit/resend), not just restate the failure"
    )


# ── INT-5 / INT-6: headshot-studio disabled buttons — reason + non-opacity cue ──

def test_headshot_disabled_buttons_have_a_hint_and_aria_describedby():
    js = _read("static", "js", "orwellHeadshot.js")
    assert 'id="hs-hint"' in js, "a hint element (hs-hint) must exist explaining why the actions are disabled"
    assert js.count('aria-describedby="hs-hint"') >= 2, (
        "both disabled action buttons (studio / exact) must be aria-describedby-linked to the hint"
    )
    assert "Choose a photo above to enable these" in js


def test_headshot_disabled_state_is_not_opacity_only():
    js = _read("static", "js", "orwellHeadshot.js")
    m = re.search(r"\.ow-headshot-studio \.hs-btn\[disabled\]\s*\{([^}]*)\}", js)
    assert m, "the disabled hs-btn rule has moved or been removed"
    body = m.group(1)
    assert "opacity: 1" in body, "disabled must not rely on a bare opacity dim (INT-6 — the old `opacity: .5` was the SOLE cue)"
    assert "background: transparent" in body, "the disabled state must drop the fill entirely (a shape/fill cue, not just dimming)"

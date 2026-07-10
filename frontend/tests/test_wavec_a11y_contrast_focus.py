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
    # The selector list also carries the F-STATE-1 `[aria-disabled="true"]` counterparts interleaved
    # with the `:disabled` variants; match from the first selector through the ow-body button
    # selector (either form) to the rule body.
    m = re.search(
        r"body\.theme-frosted \.send-btn:disabled,.*?"
        r"body\.theme-frosted \.ow-window \.ow-body button(?::disabled|\[aria-disabled=\"true\"\])\s*\{([^}]*)\}",
        css,
        re.S,
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


# ═══════════════════════════════════════════════════════════════════════════
# 2026-07-03 final pre-ship audit — AXE lane (accessibility sweep)
# ═══════════════════════════════════════════════════════════════════════════

# ── AXE-7: --color-muted must clear AA text contrast in BOTH themes ────────

def test_axe7_color_muted_dark_theme_value_clears_aa():
    css = _read("static", "style.css")
    m = re.search(r":root\s*\{.*?--color-muted:\s*(#[0-9a-fA-F]{6});", css, re.S)
    assert m, "--color-muted default (dark-theme) declaration not found in :root"
    value = m.group(1)
    assert value.lower() != "#888888" and value.lower() != "#888", (
        "--color-muted must no longer be the failing #888 default (measured 3.96:1 vs --bg, "
        "3.54:1 vs light --panel — both AA fails)"
    )
    assert _ratio(value, "#282c34") >= AA_NORMAL, f"{value} vs dark --bg must clear {AA_NORMAL}:1"
    assert _ratio(value, "#111111") >= AA_NORMAL, f"{value} vs dark --panel must clear {AA_NORMAL}:1"


def test_axe7_color_muted_light_theme_override_exists_and_clears_aa():
    css = _read("static", "style.css")
    m = re.search(r":root\.light\s*\{.*?--color-muted:\s*(#[0-9a-fA-F]{6});", css, re.S)
    assert m, (
        "the AXE-7 finding was that :root.light never overrode --color-muted at all, so the "
        "failing dark-theme default leaked into light mode too — an override must now exist"
    )
    value = m.group(1)
    assert _ratio(value, "#ffffff") >= AA_NORMAL, f"{value} vs light --panel (#fff) must clear {AA_NORMAL}:1"
    assert _ratio(value, "#f5f5f5") >= AA_NORMAL, f"{value} vs light --bg (#f5f5f5) must clear {AA_NORMAL}:1"


def test_axe7_old_muted_value_is_the_documented_failing_baseline():
    # Sanity check the audit's own math still holds for the retired value.
    assert _ratio("#888888", "#282c34") < AA_NORMAL
    assert _ratio("#888888", "#ffffff") < AA_NORMAL
    assert _ratio("#888888", "#f5f5f5") < AA_NORMAL


# ── AXE-11: the model-picker's empty-search text must use a token, not opacity ──

def test_axe11_models_empty_search_uses_color_token_not_opacity():
    js = _read("static", "js", "models.js")
    assert "opacity:0.4;" not in js.replace(" ", ""), (
        "no inline opacity:0.4 dim should remain in models.js (the AXE-11 empty-search-result "
        "text measured ~2.3-2.8:1 against --fg at that opacity in both themes)"
    )
    m = re.search(r"empty\.style\.cssText\s*=\s*'([^']*)'", js)
    assert m, "the empty-search-result div's cssText assignment was not found"
    assert "var(--color-muted)" in m.group(1), (
        "the empty-search-result text must use the contrast-checked --color-muted token (AXE-7's fix)"
    )


# ── AXE-1: the model-row grid and the theme-swatch grid must be keyboard-operable ──

def test_axe1_model_rows_have_roving_tabindex_and_option_role():
    js = _read("static", "js", "models.js")
    assert "row.setAttribute('role', 'option')" in js
    assert "row.addEventListener('keydown', _onModelRowKeydown)" in js, (
        "each non-offline model row must wire a keydown handler (Enter/Space to activate, "
        "Arrow/Home/End to move the roving tab stop) — WCAG 2.1.1"
    )
    assert "function _ensureRovingTabindex(container)" in js, (
        "a roving-tabindex manager must exist so exactly one row is Tab-reachable at a time"
    )
    assert "_ensureRovingTabindex(box)" in js, (
        "the roving-tabindex manager must actually be invoked after (re)rendering the grid, "
        "including after search results / show-more reveals — otherwise nothing is Tab-reachable"
    )


def test_axe1_models_show_more_is_a_real_button():
    js = _read("static", "js", "models.js")
    assert "document.createElement('button')" in js and "models-show-all-btn" in js, (
        "the 'Show N more models' reveal must be a real <button> — a click-only <div> here would "
        "leave the overflowed rows unreachable by keyboard even after the grid itself is fixed"
    )
    # Guard against a regression back to a plain, non-interactive div for this control.
    m = re.search(r"showMoreBtn\.className = 'models-show-all-btn'", js)
    assert m
    create_idx = js.rindex("document.createElement(", 0, js.index("showMoreBtn.className"))
    assert "'button'" in js[create_idx:create_idx + 40]


def test_axe1_theme_swatches_have_roving_tabindex_and_option_role():
    js = _read("static", "js", "theme.js")
    assert 'role="option" tabindex="-1"' in js, (
        "each theme-swatch tile (preset and custom) must expose role=option and start at "
        "tabindex=-1 (roving-tabindex managed) — WCAG 2.1.1"
    )
    assert "function _ensureSwatchTabindex(gridEl)" in js
    assert "function _onSwatchKeydown(e)" in js
    assert "sw.addEventListener('keydown', _onSwatchKeydown)" in js, (
        "the keydown handler must actually be wired per-swatch alongside the existing click handler"
    )
    assert "_ensureSwatchTabindex(g)" in js, (
        "the roving-tabindex manager must be invoked per grid (#themeGrid and #themeUserGrid) "
        "after the swatches are (re)built"
    )


# ── AXE-6: browser-offline must show distinct copy from a real engine outage ──

def test_axe6_offline_copy_is_distinct_from_outage_copy():
    js = _read("static", "js", "orwellEngineStatus.js")
    for token in ("_OFFLINE_TITLE", "_OFFLINE_BODY", "_isOffline"):
        assert token in js, f"{token} not found — the offline-vs-outage distinction was not added"
    title_m = re.search(r'const _OFFLINE_TITLE = "([^"]+)";', js)
    body_m = re.search(r'const _OFFLINE_BODY = "([^"]+)";', js)
    outage_title_m = re.search(r'const _OUTAGE_TITLE = "([^"]+)";', js)
    assert title_m and body_m and outage_title_m
    assert title_m.group(1) != outage_title_m.group(1), (
        "the offline banner must not reuse the hard-outage title (that was exactly the AXE-6 bug — "
        "misdiagnosing a dropped WiFi connection as 'Big Brother is off the air')"
    )
    # Copy should point the blame at the player's own connection, not production's.
    assert "your" in body_m.group(1).lower() or "your" in title_m.group(1).lower()


def test_axe6_refresh_checks_online_status_before_and_in_the_catch():
    js = _read("static", "js", "orwellEngineStatus.js")
    assert "async function refresh() {\n    if (_isOffline())" in js, (
        "refresh() must check navigator.onLine BEFORE attempting the health fetch, so a known-"
        "offline browser shows the correct banner immediately instead of waiting on a fetch that "
        "will just throw"
    )
    catch_m = re.search(r"\} catch \(_\) \{(.*?)\n    \}", js, re.S)
    assert catch_m and "_isOffline()" in catch_m.group(1), (
        "the catch branch must also re-check navigator.onLine (connectivity can drop mid-request), "
        "not only the top of refresh()"
    )


def test_axe6_online_offline_window_listeners_wired():
    js = _read("static", "js", "orwellEngineStatus.js")
    assert 'window.addEventListener("offline",' in js
    assert 'window.addEventListener("online", refresh)' in js


# ── AXE-8: the legacy .modal family must trap Tab within the topmost modal ──

def test_axe8_modal_family_has_a_tab_focus_trap():
    js = _read("static", "js", "ui.js")
    assert "function _focusableIn(container)" in js or "_focusableIn = (container)" in js, (
        "a focusable-elements helper must exist for the Tab trap"
    )
    tab_handler = re.search(
        r"document\.addEventListener\('keydown', \(e\) => \{\s*"
        r"if \(e\.key !== 'Tab'.*?\}\);",
        js,
        re.S,
    )
    assert tab_handler, "no document-level Tab keydown handler found in the shared .modal observer"
    body = tab_handler.group(0)
    assert "pickTopModal()" in body, (
        "the Tab trap must scope itself to the CURRENT topmost visible modal (pickTopModal), "
        "matching the same z-order authority the Escape arbiter already uses"
    )
    assert ".contains(document.activeElement)" in body, (
        "the trap must only engage while focus is actually inside the modal, never hijacking Tab "
        "for unrelated page content"
    )
    assert "last.focus()" in body and "first.focus()" in body, (
        "Shift+Tab from the first focusable element must wrap to the last, and Tab from the last "
        "must wrap to the first — the actual cycling behavior, not just detection"
    )


def test_axe8_tab_trap_precedes_escape_handler():
    # Ordering isn't semantically required (different keys), but keeping the Tab trap registered
    # near pickTopModal (not buried after unrelated code) is what keeps this generalizable/legible.
    js = _read("static", "js", "ui.js")
    tab_idx = js.index("if (e.key !== 'Tab' || e.defaultPrevented) return;")
    escape_idx = js.index("if (e.key !== 'Escape' || e.defaultPrevented) return;")
    assert tab_idx < escape_idx


# ── AXE-9: the Theme window's nested h2 subsections must not outrank its own h4 title ──

def test_axe9_theme_window_subsections_have_a_deeper_aria_level():
    html = _read("static", "index.html")
    start = html.index('<div id="theme-host"')
    end = html.index('<div id="mobile-backdrop">', start)
    section = html[start:end]
    # The dialog's own title stays h4 (untouched — no visual/CSS change).
    assert re.search(r"<h4>.*?Theme</h4>", section, re.S), "the dialog's own h4 title should be unchanged"
    h2s = re.findall(r"<h2([^>]*)>", section)
    assert len(h2s) >= 6, f"expected the six known Theme-window subsection h2's, found {len(h2s)}"
    for attrs in h2s:
        assert 'role="heading"' in attrs and 'aria-level="5"' in attrs, (
            "every h2 nested inside the Theme window (whose own title is an h4) must be "
            "re-leveled via role=heading/aria-level so the accessible heading OUTLINE stays "
            "monotonic (a screen-reader 'by heading' navigator must not rank a subsection above "
            "the dialog that contains it) — WCAG 1.3.1/2.4.6 best practice"
        )


def test_axe9_admin_card_h2_css_styling_is_untouched():
    # The fix must be ARIA-only (role/aria-level), not a tag rename — renaming would have
    # silently dropped the shared `.admin-card h2` visual styling used by every OTHER admin
    # card in the app (Documents/Library, Settings, etc.), which is keyed to the h2 tag.
    css = _read("static", "style.css")
    assert re.search(r"\.admin-card h2\s*\{", css), (
        "the shared .admin-card h2 selector must still exist — the Theme window's headings "
        "must still literally be <h2> elements (just re-leveled via ARIA), not renamed"
    )


# ── AXE-10: the composer's aria-label must track the per-build placeholder ──

def test_axe10_composer_aria_label_tracks_default_placeholder():
    js = _read("static", "app.js")
    assert "textarea.setAttribute('aria-label', _label)" in js, (
        "the composer's accessible name must be set from data-default-placeholder (the same "
        "per-build value — 'Say or do something…' in the game build — that already drives the "
        "visible placeholder), not left frozen at the generic baked-in 'Message input'"
    )
    # Must run unconditionally (before the _isMobile branch), not only inside the desktop-only
    # responsive-collapse path — otherwise mobile screen-reader users never get the fix.
    label_idx = js.index("textarea.setAttribute('aria-label', _label);")
    mobile_check_idx = js.index("if (_isMobile) return;")
    assert label_idx < mobile_check_idx, (
        "the aria-label assignment must happen before the mobile early-return, so touch/AT users "
        "get the correct accessible name too"
    )


def test_axe10_aria_label_never_blanked_by_responsive_collapse():
    js = _read("static", "app.js")
    fn_m = re.search(r"function checkPickerOverflow\(\) \{(.*?)\n    \}", js, re.S)
    assert fn_m, "checkPickerOverflow not found"
    assert "setAttribute('aria-label'" not in fn_m.group(1), (
        "the width-based responsive collapse may blank the VISIBLE placeholder for space, but "
        "must never touch aria-label — an accessible name must not disappear for a sighted-only "
        "space constraint"
    )

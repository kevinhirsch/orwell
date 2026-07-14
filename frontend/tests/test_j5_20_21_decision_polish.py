"""J5 UX audit polish set — decision-card stakes signal + focus order.

Source-pinned convention checks (no DOM runtime needed; mirrors the J4/J4s5/J5 decision-card
suites). Two findings over static/js/orwellDecision.js:

  J5-20: high-stakes / irreversible decision kinds (eviction-vote, final-eviction, juror-vote,
         nominations) must carry a RISK visual signal that low-stakes kinds (comp-intent/comp-round)
         do NOT — token-driven (works across house themes), and NOT color-only (a text/aria/icon
         companion so colorblind + SR users get the same weight signal).

  J5-21: the dismiss × must no longer be the FIRST focusable after the card — the decision options
         and Confirm come first in the tab sequence (WCAG 2.4.3). The 44×44 tap target, the
         descriptive aria-label, and Escape-to-dismiss must all be preserved.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── J5-20: high-stakes kind set/helper exists with the right membership ──

def test_j5_20_high_stakes_kind_set_exists():
    js = _read("static", "js", "orwellDecision.js")
    # A single named set/helper that decides "which kinds are weighty" must exist.
    assert re.search(r"const\s+HIGH_STAKES_KINDS\s*=\s*new Set\(", js), \
        "orwellDecision.js must define a HIGH_STAKES_KINDS set (one place for 'which kinds are weighty')"
    assert re.search(r"const\s+isHighStakes\s*=", js), \
        "orwellDecision.js must define an isHighStakes() helper over the set"


def test_j5_20_high_stakes_membership():
    js = _read("static", "js", "orwellDecision.js")
    m = re.search(r"const\s+HIGH_STAKES_KINDS\s*=\s*new Set\(\[(.*?)\]\)", js, re.S)
    assert m, "HIGH_STAKES_KINDS set literal not found"
    members = re.findall(r'"([^"]+)"', m.group(1))
    for kind in ("eviction-vote", "final-eviction", "juror-vote", "nominations"):
        assert kind in members, \
            f"HIGH_STAKES_KINDS must include the irreversible kind {kind!r}, got {members}"
    # Low-stakes comp kinds must NOT be flagged — they only set how the player plays a comp.
    assert "comp-intent" not in members, \
        "comp-intent is low-stakes and must NOT be in HIGH_STAKES_KINDS"
    assert "comp-round" not in members, \
        "comp-round is low-stakes and must NOT be in HIGH_STAKES_KINDS"


# ── J5-20: the card applies a risk class/marker for high-stakes kinds ──

def test_j5_20_card_applies_risk_class():
    js = _read("static", "js", "orwellDecision.js")
    # render() must gate the risk skin on isHighStakes(kind) and add the marker class.
    assert "isHighStakes(kind)" in js, \
        "render() must derive the risk flag from isHighStakes(kind)"
    assert re.search(r'classList\.add\("odec-risk"\)', js), \
        "render() must add the 'odec-risk' marker class for high-stakes kinds"
    # The risk skin must be defined as a card modifier rule in the injected styles.
    # (The injected CSS is scoped to the .odec root CLASS — render() adds it beside the
    # element id — so the kit demo's static cards style identically to the live card.)
    assert re.search(r"\.odec\.odec-risk\s*\{", js), \
        "ensureStyles() must define the .odec-risk card modifier rule"


def test_j5_20_risk_signal_is_token_driven():
    js = _read("static", "js", "orwellDecision.js")
    risk_rule = re.search(r"\.odec\.odec-risk\s*\{([^}]+)\}", js)
    assert risk_rule, ".odec-risk rule not found"
    body = risk_rule.group(1)
    # The tint must come from the project tokens (--color-error / --red), never a hard-coded hex
    # alone — so it adapts across the house themes.
    assert "var(--color-error" in body or "var(--red" in body, \
        ".odec-risk tint must be token-driven (var(--color-error) / var(--red)) for theme parity"


# ── J5-20: the risk signal is NOT color-only (text/aria/icon companion) ──

def test_j5_20_risk_signal_not_color_only():
    js = _read("static", "js", "orwellDecision.js")
    # A risk BADGE element must accompany the tint — text + icon, not color alone.
    assert "odec-risk-badge" in js, \
        "high-stakes cards must render a text/icon risk badge (not color-only) — WCAG 1.4.1"
    # The badge must carry irreversibility/binding wording so colorblind + SR users get the signal.
    assert re.search(r"Irreversible", js), \
        "the risk badge must say 'Irreversible' (the non-color companion to the red tint)"
    # The badge must only render for the risk flag (gated alongside the class add).
    badge_emit = re.search(r"risk\s*\?\s*`<span class=\"odec-risk-badge\"", js)
    assert badge_emit, "the risk badge must be conditionally emitted on the risk flag"


def test_j5_20_low_stakes_card_has_no_risk_skin():
    js = _read("static", "js", "orwellDecision.js")
    # Defensive: the class add must be guarded (the literal must not be added unconditionally).
    assert re.search(r"if \(risk\) card\.classList\.add\(\"odec-risk\"\)", js), \
        "the odec-risk class must be added ONLY when risk is true (low-stakes cards stay plain)"


# ── J5-21: the dismiss × is no longer the first focusable after the card ──

def test_j5_21_dismiss_x_appended_after_options_and_confirm():
    js = _read("static", "js", "orwellDecision.js")
    # DOM order = tab order. The × append must come AFTER the row (options + confirm) is appended.
    row_append = js.find("card.appendChild(row)")
    x_append = js.find("card.appendChild(x)")
    assert row_append != -1, "card.appendChild(row) not found"
    assert x_append != -1, "the dismiss × must be appended to the card (card.appendChild(x))"
    assert x_append > row_append, \
        "the dismiss × must be appended AFTER the options/Confirm row so it is the LAST tab stop (WCAG 2.4.3)"


def test_j5_21_dismiss_x_not_appended_to_head():
    js = _read("static", "js", "orwellDecision.js")
    # The old pattern put the × first in DOM via head.appendChild(x) — that must be gone.
    assert "head.appendChild(x)" not in js, \
        "the dismiss × must NOT be appended to the head (that made it the first tab stop)"


def test_j5_21_dismiss_x_positioned_in_corner_by_css():
    js = _read("static", "js", "orwellDecision.js")
    # Moving the × later in DOM must keep it visually in the top-right corner via CSS, not layout.
    x_rule = re.search(r"\.odec-x\s*\{([^}]+)\}", js)
    assert x_rule, ".odec-x rule not found"
    body = x_rule.group(1)
    assert "position: absolute" in body and "right:" in body, \
        ".odec-x must be position:absolute with a right offset to stay in the corner after the DOM move"
    # The card must be a positioning context for the absolute ×. (The base card rule is
    # scoped to the .odec root class — the first `.odec {` block in the injected styles.)
    card_rule = re.search(r"\.odec\s*\{([^}]+)\}", js)
    assert card_rule and "position: relative" in card_rule.group(1), \
        "the card must be position:relative to anchor the absolutely-positioned ×"


def test_j5_21_dismiss_x_preserves_tap_target_and_label():
    js = _read("static", "js", "orwellDecision.js")
    # The 44×44 tap floor must survive the move.
    x_rule = re.search(r"\.odec-x\s*\{([^}]+)\}", js)
    assert x_rule, ".odec-x rule not found"
    body = x_rule.group(1)
    assert "min-width: 44px" in body and "min-height: 44px" in body, \
        ".odec-x must keep its 44×44 tap target after the DOM reorder"
    # The descriptive aria-label must survive.
    assert re.search(r'x\.setAttribute\("aria-label",\s*"[^"]*(?:conversation|decide)', js), \
        ".odec-x must keep its descriptive aria-label (decide in conversation)"


def test_j5_21_escape_dismiss_preserved():
    js = _read("static", "js", "orwellDecision.js")
    # The card-scoped Escape handler must still dismiss (not submit).
    esc_handler = re.search(r'card\.addEventListener\("keydown".*?\}\);', js, re.S)
    assert esc_handler, "card-scoped keydown handler not found"
    body = esc_handler.group(0)
    assert 'e.key !== "Escape"' in body, "the keydown handler must gate on the Escape key"
    assert "removeCard()" in body, "Escape must dismiss the card (removeCard())"


def test_j5_21_focus_on_mount_unaffected():
    js = _read("static", "js", "orwellDecision.js")
    # The focus-on-mount contract (card tabindex=-1 + .focus()) must remain.
    assert 'card.setAttribute("tabindex", "-1")' in js, \
        "the card must keep tabindex=-1 for programmatic focus-on-mount"
    assert "card.focus()" in js, "the card must keep its focus-on-mount call"

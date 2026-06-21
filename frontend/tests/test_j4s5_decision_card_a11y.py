"""J4 UX audit gated set #5 — decision card a11y fixes (round 2).

Source-pinned convention checks (no DOM runtime needed). Verifies:
  J4-08: confirm label revert on error recovery uses confirmLabelFor() — self-evict
         gets its irreversibility signal back, not the generic "Confirm — this is binding".
  J4-09: error container is pre-declared with role="alert" + aria-live="assertive"
         during render, not dynamically injected in the catch block.
  J4-10: .odec-err uses var(--color-error, ...) not var(--red, ...) directly;
         light theme overrides --color-error to a value that passes 4.5:1 on white.
  J4-11: .odec-x dismiss button has min-width:44px + min-height:44px (project floor).
  J4-12: card has aria-describedby wired to the note span's stable id.
  J4-13: "Just color" jargon replaced with "No stakes here" in non-binding comp note.
  J4-14: progress bar uses aria-describedby + hidden span, not draft aria-description.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── J4-08: confirm label revert ─────────────────────────────────────────────

def test_j4s5_confirm_label_function_exists():
    js = _read("static", "js", "orwellDecision.js")
    assert "confirmLabelFor" in js, \
        "orwellDecision.js must define confirmLabelFor() helper"


def test_j4s5_confirm_label_handles_self_evict():
    js = _read("static", "js", "orwellDecision.js")
    # confirmLabelFor must have a self-evict branch returning the irreversibility label
    assert "self-evict" in js and "leave the game (final)" in js, \
        "confirmLabelFor must return the irreversibility label for self-evict"
    fn = re.search(
        r"function confirmLabelFor\(.*?\}",
        js, re.S)
    assert fn, "confirmLabelFor function not found"
    body = fn.group(0)
    assert "self-evict" in body, "confirmLabelFor must handle self-evict case"
    assert "leave the game (final)" in body, \
        "confirmLabelFor must return 'Confirm — leave the game (final)' for self-evict"


def test_j4s5_catch_block_uses_confirm_label_function():
    js = _read("static", "js", "orwellDecision.js")
    # The catch block must call confirmLabelFor rather than the bare ternary
    assert "confirmLabelFor(kind, pending.binding)" in js, \
        "catch block must call confirmLabelFor(kind, pending.binding) to restore label"
    # The old bare ternary that missed self-evict must be gone
    assert 'kind === "comp-round" ? "Lock in this round"' not in js, \
        "old bare ternary in catch block must be replaced by confirmLabelFor()"


# ── J4-09: pre-declared role="alert" error container ────────────────────────

def test_j4s5_error_container_role_alert():
    js = _read("static", "js", "orwellDecision.js")
    # The error element must have role="alert" set during render
    assert 'setAttribute("role", "alert")' in js, \
        "orwellDecision.js must pre-declare error container with role='alert'"
    # aria-live="assertive" for belt-and-suspenders cross-AT compat
    assert 'setAttribute("aria-live", "assertive")' in js, \
        "error container must have aria-live='assertive'"
    assert 'setAttribute("aria-atomic", "true")' in js, \
        "error container must have aria-atomic='true'"


def test_j4s5_error_not_injected_dynamically():
    js = _read("static", "js", "orwellDecision.js")
    # The old pattern (card.querySelector + conditional createElement in catch) must be gone
    assert 'card.querySelector(".odec-err")' not in js, \
        "error element must not be querySelectorAll'd in the catch block — pre-declare it"


# ── J4-10: .odec-err contrast token ─────────────────────────────────────────

def test_j4s5_odec_err_uses_color_error_token():
    js = _read("static", "js", "orwellDecision.js")
    # .odec-err must use --color-error (not --red directly) so light-theme override applies
    err_rule = re.search(r"odec-err\s*\{([^}]+)\}", js)
    assert err_rule, ".odec-err rule not found"
    rule_body = err_rule.group(1)
    assert "var(--color-error" in rule_body, \
        ".odec-err must use var(--color-error, ...) so light-theme override applies"
    assert "var(--red" not in rule_body.split("var(--color-error")[0], \
        ".odec-err must use --color-error as the primary token, not --red"


def test_j4s5_light_theme_color_error_override():
    css = _read("static", "style.css")
    # Light theme must override --color-error to a value that passes 4.5:1 on white
    light_block = re.search(r":root\.light\s*\{([^}]+)\}", css, re.S)
    assert light_block, ":root.light block not found in style.css"
    block = light_block.group(1)
    assert "--color-error" in block, \
        ":root.light must override --color-error for sufficient contrast on white background"
    # The override must not be the default #ff4444 (which fails 4.5:1 on #fff at 3.41:1)
    override = re.search(r"--color-error:\s*([^;]+);", block)
    assert override, "--color-error override value not parseable"
    val = override.group(1).strip()
    assert val != "#ff4444", \
        "--color-error in light theme must not be #ff4444 (fails 4.5:1 on white)"


# ── J4-11: dismiss tap target ────────────────────────────────────────────────

def test_j4s5_dismiss_button_min_size():
    js = _read("static", "js", "orwellDecision.js")
    # .odec-x must have min-width and min-height for 44×44 tap target
    x_rule = re.search(r"\.odec-x\s*\{([^}]+)\}", js)
    assert x_rule, ".odec-x rule not found in orwellDecision.js"
    rule_body = x_rule.group(1)
    assert "min-width: 44px" in rule_body, \
        ".odec-x must have min-width: 44px (project coarse-pointer floor)"
    assert "min-height: 44px" in rule_body, \
        ".odec-x must have min-height: 44px (project coarse-pointer floor)"
    assert "inline-flex" in rule_body, \
        ".odec-x must use display:inline-flex to center the × within the tap area"


# ── J4-12: aria-describedby wiring ──────────────────────────────────────────

def test_j4s5_card_aria_describedby():
    js = _read("static", "js", "orwellDecision.js")
    assert 'setAttribute("aria-describedby", CARD_ID + "-note")' in js, \
        "decision card must have aria-describedby pointing to the note span"


def test_j4s5_note_span_stable_id():
    js = _read("static", "js", "orwellDecision.js")
    assert 'note.id = CARD_ID + "-note"' in js, \
        "note span must get a stable id matching the card's aria-describedby"


# ── J4-13: "Just color" jargon removed ──────────────────────────────────────

def test_j4s5_no_just_color_jargon():
    js = _read("static", "js", "orwellDecision.js")
    assert "Just color" not in js, \
        "'Just color' production jargon must be replaced with player-facing copy"
    assert "No stakes here" in js, \
        "non-binding comp-round note must use 'No stakes here' instead of 'Just color'"


# ── J4-14: progress bar aria-describedby ────────────────────────────────────

def test_j4s5_progress_bar_no_aria_description():
    js = _read("static", "js", "orwellSeasonProgress.js")
    # aria-description is a draft ARIA 1.3 attribute; must use aria-describedby instead
    assert 'setAttribute("aria-description"' not in js, \
        "orwellSeasonProgress.js must not use aria-description (draft ARIA 1.3); use aria-describedby"


def test_j4s5_progress_bar_aria_describedby():
    js = _read("static", "js", "orwellSeasonProgress.js")
    assert 'setAttribute("aria-describedby"' in js, \
        "progress bar must use aria-describedby + hidden span (WCAG 1.2-safe)"
    # The hidden description span must carry the description text
    assert "Advances as houseguests are evicted" in js, \
        "progress bar description text must still be present in a hidden span"

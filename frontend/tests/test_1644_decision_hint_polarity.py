"""#1644 (Finding 1 — BLOCKER) — the decision-card disabled-Confirm hint ink polarity.

THE BLOCKER: the pending/decision card's disabled hint ("Select N houseguests to enable Confirm",
`.odec-hint`) rendered white `#fff` on the LIGHT kit glass ≈ 1.32:1 — illegible. The `#fff` was a
deliberate #1375-a fix for the FALLBACK bare-mount path (the hint sits over a dark-compositing blur
edge there), but the same CSS-in-JS rule ALSO hit the COMMON kit-hosted path — `.odec` mounted
inside the OrwellNotice kit card (`.on-card.on-decision`), which style.css paints LIGHT glass with a
DARK inner ink — so white-on-light there was the blocker.

THE FIX (Option A): the frosted hint rule now inks `color: inherit` (+ `text-shadow: inherit`), so
the hint FOLLOWS its host surface exactly like its sibling text nodes (`.odec-title` / `.odec-note`
/ `.odec-prompt`) and the chat bubble body (`body.theme-frosted .msg-ai .body { color: inherit }`):
DARK #16191f on the light kit glass (the common path the a11y matrix renders), LIGHT over the
bare-mount dark edge. No host is special-cased to white anymore.

This is a SOURCE-PIN (no browser/engine): the CSS-in-JS `<style>` rule injected by
orwellDecision.js is invisible to the CSS/JS scanners in test_1644_text_ink_polarity.py (which read
static/style.css + JS `.style.color=` / `style="…"` templates, never a `<style>`.textContent), which
is exactly how this blocker slipped past that gate. This test pins the injected rule directly.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECISION_JS = os.path.join(FE, "static", "js", "orwellDecision.js")
STYLE_CSS = os.path.join(FE, "static", "style.css")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _decision_style_block():
    """The CSS-in-JS injected by orwellDecision.js: the template literal assigned to
    `st.textContent`. We extract it so the assertions can never accidentally match a comment or an
    unrelated JS string elsewhere in the file."""
    src = _read(DECISION_JS)
    m = re.search(r"st\.textContent\s*=\s*`(.*?)`\s*;", src, re.S)
    assert m, "could not locate the orwellDecision.js `st.textContent = ` <style> template literal"
    return m.group(1)


def _frosted_hint_rule_body():
    """The body of `body.theme-frosted .odec .odec-hint { … }` (the ONE frosted hint rule)."""
    css = _decision_style_block()
    m = re.search(r"body\.theme-frosted\s+\.odec\s+\.odec-hint\s*\{([^}]*)\}", css)
    assert m, (
        "#1644: the frosted decision-hint rule `body.theme-frosted .odec .odec-hint { … }` is gone "
        "from orwellDecision.js — the polarity fix must live here (that's where the rule already was)."
    )
    return m.group(1)


def _color_decl(rule_body):
    m = re.search(r"(?:^|;)\s*color\s*:\s*([^;{}]+)", rule_body)
    return (m.group(1).strip().lower() if m else None)


# ── the fix ─────────────────────────────────────────────────────────────────────────────────────
def test_frosted_hint_does_not_bare_white_ink_the_common_path():
    """The frosted hint rule (shared across ALL mount hosts, incl. the common LIGHT kit glass) must
    NOT hard-code a bare white ink — that is the #1644 blocker (white-on-light ≈ 1.32:1)."""
    color = _color_decl(_frosted_hint_rule_body())
    assert color is not None, "the frosted `.odec-hint` rule sets no `color` at all"
    assert color not in ("#fff", "#ffffff", "white"), (
        "#1644 BLOCKER: `body.theme-frosted .odec .odec-hint` inks a bare white (`%s`). On the COMMON "
        "kit-hosted path (.on-card.on-decision, LIGHT glass) that is white-on-light ≈ 1.32:1 — "
        "illegible. The hint must FOLLOW its surface (`color: inherit`), not be pinned white." % color
    )


def test_frosted_hint_follows_its_surface():
    """Option A: the hint inks `color: inherit` so it takes its host surface's DARK ink on the light
    kit glass and LIGHT ink over the bare-mount dark edge — the right polarity on every host."""
    body = _frosted_hint_rule_body()
    color = _color_decl(body)
    assert color == "inherit", (
        "#1644: the frosted `.odec-hint` must ink `color: inherit` (follow the host surface), got %r. "
        "Every host pins .odec's polarity for us (the kit card dark, the sheet its cross-fade, the "
        "bare fallback the light ambient --fg), so `inherit` is correct on all three." % color
    )
    # the legibility halo must ALSO follow the surface (a LIGHT halo under the dark kit ink) — never
    # the retired dark #1375-a halo, which would smear under dark ink on the light glass.
    assert re.search(r"(?:^|;)\s*text-shadow\s*:\s*inherit\b", body), (
        "#1644: the frosted `.odec-hint` must set `text-shadow: inherit` so its legibility halo "
        "follows the host surface too (mirrors body.theme-frosted .msg-ai .body). Found body:\n" + body
    )
    assert "rgba(0,0,0" not in body.lower(), (
        "#1644: the retired #1375-a DARK halo (`text-shadow: … rgba(0,0,0,…)`) must not remain on the "
        "hint — under the inherited DARK kit ink it reads as a smudge on the light glass. Body:\n" + body
    )


# ── the resolution chain: the common kit host inks DARK, so `inherit` lands dark on light glass ──
def test_kit_host_inks_dark_on_the_light_glass():
    """Pin the OTHER half of the resolution: the common host `.on-card` is inked DARK (#16191f)
    under the frosted theme in style.css, so the hint's `color: inherit` resolves to a dark,
    AA-legible ink on the light kit glass. (Read-only cross-check; style.css is not edited here.)"""
    css = _read(STYLE_CSS)
    # any frosted rule whose selector GROUP includes `.on-card` and whose body inks the chrome dark
    # #16191f — the standard dark-ink-on-light-glass fold the whole notice kit rides.
    found = False
    for m in re.finditer(r"([^{}]*)\{([^{}]*)\}", css):
        selector, body = m.group(1), m.group(2)
        if (".on-card" in selector and "theme-frosted" in selector
                and re.search(r"(?:^|;)\s*color\s*:\s*#16191f\b", body)):
            found = True
            break
    assert found, (
        "#1644: expected style.css to ink `.on-card` DARK (#16191f) under body.theme-frosted so the "
        "decision hint's `color: inherit` resolves to a dark, AA-legible ink on the light kit glass. "
        "If the kit-host ink token moved, update this cross-check (and re-verify the hint polarity)."
    )

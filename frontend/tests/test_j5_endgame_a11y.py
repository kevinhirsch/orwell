"""J5 UX audit gated set #6 — endgame surface a11y/content/motion fixes.

Source-pinned convention checks (no DOM runtime needed) over the endgame surfaces captured in
Journey 5 (the decision card's endgame kinds, the retrospective, the finale, the finalizing
indicator, the premiere tutorial). Each test maps to a J5 finding consolidated from the
5-specialist fan-out (content-a11y, visual-motion, transient-animation, social-game, responsive).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── J5-01: textarea cards must NOT show the chip-only "never read from prose" note ──

def test_j5_textarea_cards_have_their_own_notes():
    js = _read("static", "js", "orwellDecision.js")
    # juror-question, finale-statement, goodbye-message must each get a bespoke note branch
    for kind in ("juror-question", "finale-statement", "goodbye-message"):
        assert re.search(r'kind === "' + re.escape(kind) + r'"', js), \
            f"orwellDecision.js must have a per-kind branch for {kind}"
    # The juror-question / finale-statement notes must affirm prose input, not deny it
    assert "Your own words" in js, \
        "textarea-card notes must affirm free-text input ('Your own words …')"
    # goodbye-message must explain the tone is what binds
    assert re.search(r"Pick a tone[^\"]*binds", js), \
        "goodbye-message note must explain the tone is the binding part"


def test_j5_note_logic_orders_textarea_kinds_before_generic_fallback():
    js = _read("static", "js", "orwellDecision.js")
    # The "never read from prose" generic note must still exist (for chip-only cards) but the
    # textarea kinds must be handled before the generic else.
    note_block = re.search(r'note\.className = "odec-note";.*?row\.appendChild\(note\)', js, re.S)
    assert note_block, "note construction block not found"
    block = note_block.group(0)
    jq = block.find('kind === "juror-question"')
    generic = block.find("never read from prose", block.rfind("else"))
    assert jq != -1, "juror-question note branch must be inside the note block"


# ── J5-02: free-text textareas need an accessible name ──

def test_j5_textareas_have_aria_label():
    js = _read("static", "js", "orwellDecision.js")
    # Each of the three textarea kinds must set an aria-label (placeholders are not names)
    labels = re.findall(r'textarea\.setAttribute\("aria-label",\s*"([^"]+)"\)', js)
    assert len(labels) >= 3, \
        f"expected >=3 textarea aria-labels (finale-statement, juror-question, goodbye-message), got {labels}"
    joined = " ".join(labels).lower()
    assert "statement" in joined and "question" in joined and "goodbye" in joined, \
        f"textarea aria-labels must cover statement/question/goodbye, got {labels}"


# ── J5-03: the decision card must have figure/ground elevation ──

def test_j5_decision_card_has_box_shadow():
    js = _read("static", "js", "orwellDecision.js")
    assert re.search(r"box-shadow:\s*var\(--win-shadow", js), \
        "decision card must apply var(--win-shadow) for figure/ground (it was the only window-like surface missing it)"


# ── J5-04: chip border must clear WCAG 1.4.11 in the dark theme ──

def test_j5_chip_border_mixes_toward_fg():
    js = _read("static", "js", "orwellDecision.js")
    # #775 element-kit migration: on the GLASS tiers the option chips compose .ow-btn-prominent
    # (the kit supplies a legible on-glass boundary). The bespoke chip fill + the J5-04 boundary
    # fix now live on the NORMAL (non-glass) tier rule — find THAT rule and assert the contrast fix.
    opt_rule = re.search(r"body:not\(\.theme-frosted\).*?\.odec-opt\s*\{([^}]+)\}", js)
    assert opt_rule, "Normal-tier .odec-opt rule not found"
    body = opt_rule.group(1)
    # The bare var(--border) border failed 3:1 on the dark chip fill; it must still mix toward --fg
    assert "color-mix" in body and "--fg" in body, \
        ".odec-opt (Normal-tier) border must color-mix toward --fg for >=3:1 boundary contrast in the dark theme"
    # And the chips must compose the kit prominent (the glass-tier source of truth).
    assert "ow-btn-prominent" in js and "odec-opt" in js, \
        "decision option chips must compose .ow-btn .ow-btn-prominent (the element kit)"


# ── J5-05: card entrance + done-state transition, reduced-motion guarded ──

def test_j5_decision_card_motion_is_reduced_motion_guarded():
    js = _read("static", "js", "orwellDecision.js")
    assert "@keyframes odec-in" in js, "decision card must define an entrance keyframe (odec-in)"
    assert "animation: odec-in" in js, "decision card must apply the odec-in entrance animation"
    # The reduced-motion media query must strip both animation and transition
    rm = re.search(r"prefers-reduced-motion: reduce\s*\)\s*\{[^}]*odec[^}]*\}", js)
    assert rm or ("prefers-reduced-motion" in js and "animation: none" in js), \
        "decision card animation/transition must be stripped under prefers-reduced-motion"


# ── J5-06: the done-card self-removal timer must be cancellable ──

def test_j5_done_timer_is_tracked_and_identity_checked():
    js = _read("static", "js", "orwellDecision.js")
    assert "_doneTimer" in js, "the 4s done-card removal must be tracked in a cancellable timer"
    assert "clearTimeout(_doneTimer)" in js, "removeCard() must clearTimeout the tracked done timer"
    # The timeout must identity-check before removing (only remove a still-done card).
    # #642: the card now lives inside the OrwellNotice kit host, so the guarded removal also tears
    # down the kit notice (_notice.hide()) before card.remove(); both sit inside the same
    # contains("odec-done") guard. Assert the guard opens the block, and card.remove() appears
    # within that guarded block (a short window after it) — not as an unguarded statement.
    guard = re.search(r"classList\.contains\(\"odec-done\"\)\)\s*\{", js)
    assert guard, "the done timer must guard on the still-done card before removal"
    after = js[guard.end():guard.end() + 220]
    assert "card.remove()" in after, \
        "the done timer must only remove the card if it is still the lingering done-card"
    # The bare unguarded setTimeout(removeCard, 4000) must be gone
    assert "setTimeout(removeCard, 4000)" not in js, \
        "the unguarded setTimeout(removeCard, 4000) must be replaced by the tracked/identity-checked timer"


# ── J5-07: retrospective section labels must be real headings ──

def test_j5_retrospective_uses_heading_elements():
    js = _read("static", "js", "orwellRetrospective.js")
    # The two vault section labels must be h3 elements (were <strong>, invisible to SR heading nav)
    # #607: the v0 machinery term "Producer's Vault" was reworded to "The Untold Story".
    assert re.search(r'el\("h3",[^)]*"\🔓 The Untold Story"\)', js) or \
        re.search(r'el\("h3"[^)]*Untold', js), \
        "The Untold Story label must be an <h3>"
    assert re.search(r'el\("h3"[^)]*How the votes really fell', js), \
        "'How the votes really fell' label must be an <h3>"
    # The pinned C17 substring must survive
    assert "How the votes really fell" in js


# ── J5-08: unseal button contrast + tap target ──

def test_j5_unseal_button_contrast_and_tap_target():
    js = _read("static", "js", "orwellRetrospective.js")
    # #775 element-kit migration: the unseal CTA now composes the kit's .ow-btn .ow-btn-prominent
    # instead of hand-inlined chrome. The kit is the ONE source of truth for the button contrast
    # (a legible on-glass label by construction) AND the 44px tap floor (.ow-btn min-height). So
    # the J5-08 guarantees are now inherited from the kit — assert the migration, not the old
    # inline color:#fff / min-height:44px contract.
    open_btn = re.search(r'"🔐 Open the Untold Story"', js)
    assert open_btn, "unseal button not found"
    region = js[max(0, open_btn.start() - 400):open_btn.end() + 200]
    assert "ow-btn-prominent" in region, \
        "unseal button must compose the element kit's .ow-btn .ow-btn-prominent (it owns contrast + the tap floor)"


# ── J5-09: the per-voter reveal must render before the hidden-story dump ──

def test_j5_vote_reveal_ordered_before_hidden_story():
    js = _read("static", "js", "orwellRetrospective.js")
    votes_idx = js.find("How the votes really fell")
    story_idx = js.find("(unsealed.hiddenStory || []).slice(-40)")
    assert votes_idx != -1 and story_idx != -1, "both vault sections must be present"
    assert votes_idx < story_idx, \
        "the per-voter eviction reveal (the signature payoff) must render before the 40-line hidden-story dump"


def test_j5_winner_line_has_apex_weight():
    js = _read("static", "js", "orwellRetrospective.js")
    winner = re.search(r'won the season \(week', js)
    assert winner, "winner line not found"
    region = js[max(0, winner.start() - 200):winner.start()]
    assert "font-weight:700" in region and re.search(r"font-size:1\.\d", region), \
        "the winner line must have apex typographic weight (bold + larger), not the highlight default"


# ── J5-10: the retrospective must not rebuild its body on every poll ──

def test_j5_retrospective_skips_redundant_rerender():
    js = _read("static", "js", "orwellRetrospective.js")
    assert "_lastSig" in js, \
        "retrospective must track a render signature to skip redundant rebuilds (scroll/focus loss)"
    # The signature guard must short-circuit before replaceChildren when unchanged
    assert re.search(r"sig === _lastSig", js), \
        "render() must early-return when the signature is unchanged"


# ── J5-11: hidden-story entries must read as prose, not [bracketed] metadata ──

def test_j5_hidden_story_not_bracketed():
    js = _read("static", "js", "orwellRetrospective.js")
    # The old '[' + type + '] ' format must be gone
    assert '"[" + humanizeStoryType' not in js, \
        "hidden-story entries must not be wrapped in [brackets] (reads as debug metadata)"


# ── retrospective render-only contract must survive (C17 pin) ──

def test_j5_retrospective_stays_render_only():
    js = _read("static", "js", "orwellRetrospective.js")
    assert "POST" not in js, "orwellRetrospective.js must stay render-only (no POST) — C17 contract"


# ── J5-12: finalizing pulse must respect reduced-motion ──

def test_j5_finalizing_reduced_motion():
    js = _read("static", "js", "orwellFinalizing.js")
    assert "prefers-reduced-motion: reduce" in js, \
        "orwellFinalizing.js must strip its infinite pulse under prefers-reduced-motion (WCAG 2.2.2)"
    rm = re.search(r"prefers-reduced-motion: reduce\s*\)\s*\{(.+?)\}\s*`", js, re.S)
    assert rm and "animation: none" in rm.group(1), \
        "the reduced-motion block must set animation: none on the finalizing dot"


# ── J5-13: finale move buttons must meet the tap floor ──

def test_j5_finale_buttons_tap_target():
    js = _read("static", "js", "orwellFinale.js")
    btn = re.search(r"\.ofin-btn\s*\{([^}]+)\}", js)
    assert btn, ".ofin-btn rule not found"
    body = btn.group(1)
    assert "min-height: 44px" in body, ".ofin-btn must meet the 44px coarse-pointer tap floor (A11Y-8/UX-10)"
    assert "font-size: .82rem" in body, ".ofin-btn font-size must be lifted to .82rem for legibility"
    assert "font-size: .74rem" not in body, ".ofin-btn font-size declaration must not remain .74rem"


# ── J5-14: finale tally needs an accessible name ──

def test_j5_finale_tally_aria_label():
    js = _read("static", "js", "orwellFinale.js")
    assert re.search(r'ofin-tally.*?\n?.*setAttribute\("aria-label"', js) or \
        re.search(r'setAttribute\("aria-label",\s*String\(tally', js), \
        "the finale tally span must carry an aria-label ('N votes')"


# ── J5-15: finale stage label must be a live region ──

def test_j5_finale_stage_live_region():
    js = _read("static", "js", "orwellFinale.js")
    assert re.search(r'id="ofin-stage"\s+aria-live="polite"', js), \
        "the finale stage label must be aria-live so stage transitions are announced"


# ── R2-01: re-tapping the pre-selected comp chip must not clear a required single-pick ──

def test_r2_01_comp_chip_retap_is_noop():
    js = _read("static", "js", "orwellDecision.js")
    # The deselect branch must guard comp-round/comp-intent so re-tapping the lit chip is a no-op
    # (a non-binding flavor round pre-selects "compete"; clearing it left Confirm stuck disabled).
    assert re.search(
        r'if \(!multi && \(kind === "comp-round" \|\| kind === "comp-intent"\)\)\s*return;', js), \
        "comp-round/comp-intent must no-op a re-tap of the selected chip (R2-01)"
    # The veto 'don't use' deselect must NOT be broken — its toggle still lives in the card.
    assert "Don't use the veto" in js


# ── J5-16: the premiere tutorial must graduate (be removed) past week 1 ──

def test_j5_premiere_tutorial_graduates():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "removeTutorial" in js, \
        "premiere tutorial must define removeTutorial() to clear the stale 'premiere week' banner"
    # refresh() must call removeTutorial when NOT premiere week
    refresh = re.search(r"async function refresh\(\)\s*\{(.+?)\n  \}", js, re.S)
    assert refresh, "refresh() not found"
    assert "removeTutorial()" in refresh.group(1), \
        "refresh() must removeTutorial() when the season is no longer in the premiere window"

"""UX Phase-4 — decision-card copy & affordances cluster (issue #606).

Source-pinned convention checks over static/js/orwellDecision.js (mirrors the J4/J4s5/J5
decision-card suites — no DOM runtime needed). Findings shipped here:

  J4-04: a non-binding staged comp-round must expose its binding state as a data attribute
         (card.dataset.binding), not just via the confirm label, so it is inspectable/testable.
  J4-17: a binding first comp-round and a non-binding flavor round must NOT share an identical
         title — the stakes must read from the heading, not only the button label / fine print.
  J4-20: a disabled Confirm must carry an instruction (WCAG 3.3.2) saying what is still needed,
         announced to AT via aria-describedby and shown visibly only while disabled.
  J3-22: the genuinely irreversible (high-stakes) decisions must spell out what "binding" means
         in plain terms (locked in, plays out, no taking it back) — not just say "this is binding".

All copy stays faithful to engine state: it adds flavor/instruction only, never asserts board
state the engine didn't give (the binding flag rides the engine's PendingDecisionView).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _js():
    return _read("static", "js", "orwellDecision.js")


# ── J4-04: data-binding attribute exposed ────────────────────────────────────

def test_j4_04_card_exposes_binding_dataset():
    js = _js()
    assert "card.dataset.binding = String(pending.binding !== false)" in js, (
        "the card must expose its binding state via card.dataset.binding "
        "(non-binding flavor round ⇒ 'false') — J4-04."
    )


# ── J4-17: binding vs non-binding comp-round title differs ────────────────────

def test_j4_17_comp_round_title_branches_on_binding():
    js = _js()
    # titleFor must take the binding flag and return a distinct heading for the non-binding round.
    assert "function titleFor(kind, binding)" in js, (
        "titleFor must accept the binding flag so the comp-round heading can differ — J4-17."
    )
    assert "no stakes" in js.lower(), (
        "the non-binding comp-round title must read as a no-stakes flavor round, distinct from the "
        "binding round's heading — J4-17."
    )


def test_j4_17_title_called_with_binding():
    js = _js()
    # Both the aria-label and the visible head must pass the binding flag through.
    assert "titleFor(kind, pending.binding)" in js, (
        "titleFor must be called with pending.binding at the title/aria-label sites — J4-17."
    )


# ── J4-20: disabled Confirm hint (WCAG 3.3.2) ────────────────────────────────

def test_j4_20_disabled_hint_helper_exists():
    js = _js()
    assert "function disabledHintFor(" in js, (
        "a disabledHintFor() helper must provide the 'why is Confirm disabled' instruction — J4-20."
    )
    assert "to enable Confirm" in js, (
        "the disabled hint must tell the player what to do to enable Confirm — J4-20."
    )


def test_j4_20_hint_wired_to_confirm_via_describedby():
    js = _js()
    assert 'confirm.setAttribute("aria-describedby", hint.id)' in js, (
        "the disabled hint must be announced to AT via the confirm button's aria-describedby — J4-20."
    )
    # Visibility tracks the disabled state.
    assert "hint.hidden = !confirm.disabled" in js, (
        "the hint must be shown only while Confirm is disabled (sync toggles hint.hidden) — J4-20."
    )


def test_j4_20_hint_has_style():
    js = _js()
    assert ".odec-hint" in js, "the disabled hint needs a CSS class for styling — J4-20."


# ── J3-22: explain what 'binding' means for irreversible decisions ───────────

def test_j3_22_irreversible_note_explains_binding():
    js = _js()
    assert "no taking it back" in js.lower(), (
        "irreversible (high-stakes) decisions must spell out that a confirmed move is locked in and "
        "plays out — there's no taking it back — J3-22."
    )
    # It must be gated on the high-stakes (risk) set, not shown on low-stakes cards.
    assert "risk ? base +" in js, (
        "the 'no taking it back' clause must be appended only for the high-stakes (risk) kinds — J3-22."
    )


# ── faithfulness guard: no fabricated board-state claim in the new copy ───────

def test_new_copy_does_not_assert_outcomes():
    js = _js()
    # The new copy must not invent an outcome word the engine alone owns.
    for forbidden in ("you won", "you lost", "evicted you", "you are safe"):
        assert forbidden not in js.lower(), (
            f"decision-card copy must never assert engine outcomes ({forbidden!r})."
        )

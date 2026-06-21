"""J4 UX audit gated set #4 — decision-card a11y fixes.

Source-pinned convention checks (no DOM runtime needed). Verifies:
  J4-01: post-stream focus logic in chat.js checks for a decision card before
         focusing the composer (prevents focus theft from a binding decision).
  J4-02: decision card uses role="form" (named form landmark) not role="group".
  J4-03: dismiss button aria-label is descriptive, not just "Dismiss".
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── J4-01: post-stream focus must not steal focus from a pending decision card ──

def test_j4_post_stream_focus_checks_for_decision_card():
    js = _read("static", "js", "chat.js")
    # The post-stream cleanup must check for orwell-decision-card before calling
    # messageInput.focus(), so keyboard/SR users aren't dropped back at the composer
    # when a binding decision is pending.
    assert "orwell-decision-card" in js, \
        "chat.js post-stream focus must reference orwell-decision-card"
    # The focus guard must appear near the messageInput.focus() call
    focus_block = re.search(
        r"messageInput\.disabled\s*=\s*false.*?messageInput\.focus\(\)",
        js, re.S)
    assert focus_block, "messageInput.focus() block not found in chat.js"
    block_text = focus_block.group(0)
    assert "orwell-decision-card" in block_text, \
        "decision-card check must be inside the same block as messageInput.focus()"


def test_j4_post_stream_focuses_card_when_present():
    js = _read("static", "js", "chat.js")
    # The code must call _pendingCard.focus() (or equivalent) when the card is found,
    # not fall through to messageInput.focus().
    assert "_pendingCard" in js or "pendingCard" in js, \
        "chat.js must capture the pending decision card element"
    assert "_pendingCard.focus" in js or "pendingCard.focus" in js, \
        "chat.js must call .focus() on the pending card when present"


# ── J4-02: decision card role must be "form", not "group" ──────────────────────

def test_j4_decision_card_role_is_form():
    js = _read("static", "js", "orwellDecision.js")
    # role="form" makes the card a named form landmark reachable via AT navigation
    assert 'setAttribute("role", "form")' in js, \
        'orwellDecision.js must use role="form" on the decision card'
    # role="group" must NOT be used for the main card (still valid inside sub-groups)
    # — specifically, the card.setAttribute call must use "form"
    card_role = re.search(
        r'card\.setAttribute\("role",\s*"([^"]+)"\)', js)
    assert card_role and card_role.group(1) == "form", \
        f'card role must be "form", got {card_role.group(1) if card_role else None!r}'


# ── J4-03: dismiss aria-label must be descriptive ──────────────────────────────

def test_j4_dismiss_aria_label_is_descriptive():
    js = _read("static", "js", "orwellDecision.js")
    # The dismiss × button aria-label must not be the bare "Dismiss" that the J4
    # audit found — it should explain that the player can decide in conversation.
    label_match = re.search(
        r'x\.setAttribute\("aria-label",\s*"([^"]+)"\)', js)
    assert label_match, "dismiss aria-label not found in orwellDecision.js"
    label = label_match.group(1)
    assert label != "Dismiss", \
        f'dismiss aria-label must be descriptive (not just "Dismiss"), got {label!r}'
    assert "conversation" in label.lower() or "decide" in label.lower(), \
        f'dismiss aria-label should mention conversation/decide, got {label!r}'


def test_j4_dismiss_aria_label_matches_title_intent():
    js = _read("static", "js", "orwellDecision.js")
    # The title and aria-label must convey the same intent.
    title_m = re.search(r'x\.title\s*=\s*"([^"]+)"', js)
    label_m = re.search(r'x\.setAttribute\("aria-label",\s*"([^"]+)"\)', js)
    assert title_m and label_m, "dismiss title or aria-label not found"
    # Both should mention "Dismiss" and the conversation fallback
    title = title_m.group(1).lower()
    label = label_m.group(1).lower()
    assert "dismiss" in title and "dismiss" in label
    # title mentions "conversation"; label should too or at least "decide"
    title_has_conv = "conversation" in title
    label_has_conv = "conversation" in label or "decide" in label
    assert title_has_conv and label_has_conv, \
        f"title ({title_m.group(1)!r}) and label ({label_m.group(1)!r}) must both describe the conversation fallback"

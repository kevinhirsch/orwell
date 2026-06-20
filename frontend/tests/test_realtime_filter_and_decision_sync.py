"""Realtime streamed-text filtering + decision-card sync (FE/BE-sync audit, 2026-06-20).

Two fixes that EXTEND PR #408 ("persist clean-channel reasoning + unify the resume renderer").
#408 unified the reasoning *channel* (`thinking:true`) across the live, resume, and history
renderers + persistence. These cover the gaps #408 left:

  1. REALTIME CONTENT-CHANNEL SCRUB (the "flash of unfiltered content"): the model also leaks
     planning as NORMAL reply text (operator openers "Let me…", raw `npc:<id>` ids) — scrubbed
     by `processWithThinking` (L6b) in the game build. Every streaming render path must use that
     SAME renderer per-delta, or the leak renders visible while streaming and is only cleaned at
     the final render — a realtime flash. The live reply-after-thinking path (`resumeStream`'s
     sibling in the primary stream) was rendering raw `mdToHtml`; it now uses `processWithThinking`
     like the no-thinking path and the final render.

  2. DECISION-CARD DISMISS vs `gamechanged` (a cross-device sync race): the rearm reset the
     dismissal flag on ANY pending, so a game change re-mounted the very card the player just
     dismissed. It now keys the dismissal to the pending's signature — a NEW decision re-arms,
     the SAME one stays dismissed.

These are source-level assertions (the JS has no test runner here; mirrors #408's test style).
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── 1: every live streaming render path routes through the scrubbing renderer ─────── #

def test_live_reply_after_thinking_uses_processWithThinking():
    chat = _read("static", "js", "chat.js")
    # the live reply-after-thinking renderer is unified onto processWithThinking (the
    # game-build content-channel scrub runs PER DELTA) — no more raw mdToHtml flash there.
    assert "render: (t) => markdownModule.processWithThinking(markdownModule.squashOutsideCode(t))" in chat
    # the OLD raw path (mdToHtml in a live stream renderer's render fn) is gone from chat.js
    assert "render: (t) => markdownModule.mdToHtml(markdownModule.squashOutsideCode(t))" not in chat


def test_processWithThinking_scrubs_content_channel_leak_in_game_build():
    # processWithThinking runs scrubReasoningPreamble (L6b) in the game-build branch, so any
    # render path wired to it scrubs the leading operator-aside / raw-npc-id leak.
    md = _read("static", "js", "markdown.js")
    assert "reply = (scrubReasoningPreamble(reply) || '').trim();" in md
    # the scrub is the leading-operator / raw-npc-id heuristic
    assert "_RAW_NPC_ID_RE" in md and "_REASONING_LINE_RE" in md


# ── F8: realtime reasoning body-flash hardening (client-side) ──────────────────────── #

def test_body_render_strips_unclosed_think_tail():
    # chat.js _renderStream drops any UNCLOSED <think> tail before any body render path, so
    # round-2+ reasoning (opened but not yet closed) can't be mis-read as the reply.
    chat = _read("static", "js", "chat.js")
    assert "F8 (realtime flash fix)" in chat
    assert "hasUnclosedThinkTag(dt)" in chat


def test_reasoning_scrub_openers_extended_and_npc_lines_dropped():
    md = _read("static", "js", "markdown.js")
    # the operator-aside opener set now catches the observed leaks
    for opener in ["the player", "i now", "now,? (?:let me|i'?ll)", "i have the game"]:
        assert opener in md, f"missing scrub opener: {opener}"
    # raw engine ids are dropped from ANY reply line (not just a leading run)
    assert "export function dropRawEngineIdLines" in md
    assert "reply = (dropRawEngineIdLines(reply) || '').trim();" in md


# ── 2: the decision card respects an explicit dismissal of the same pending ────────── #

def test_decision_card_keys_dismissal_to_the_pending_signature():
    dec = _read("static", "js", "orwellDecision.js")
    # a signature is computed and remembered on dismiss
    assert "_dismissedSig" in dec
    assert "const _sig =" in dec
    # both dismiss paths (× click and Escape) record the dismissed signature
    assert dec.count("_dismissedSig = _sig(pending);") == 2
    # the rearm respects the dismissal of THE SAME pending (a new one still re-arms)
    assert "if (_userDismissed && _sig(pending) === _dismissedSig) return;" in dec

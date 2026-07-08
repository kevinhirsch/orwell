"""M2-5 (audit B4/B7) — narrator identity + production-slate beat styling.

Owner pick (2026-07-08): the transcript author is **"Production"** — the show's production
voice. "Orwell" stays product chrome (wordmark, tab, admin). The name is ONE constant
(`GAME_NARRATOR` in `orwellToolBeats.js` — the single registry file) so the parked P-1
rebrand is a one-line change. Beats render as production slates in the game build: no
lowercase "done" debug tail (failures stay literal — operator truth), slate type on the
label, one aligned rail.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_the_narrator_is_one_constant_in_the_registry():
    beats = _read("static/js/orwellToolBeats.js")
    assert "export const GAME_NARRATOR = 'Production';" in beats
    assert "window.ORWELL_GAME_NARRATOR = GAME_NARRATOR" in beats


def test_no_game_build_author_site_hardcodes_a_name():
    """Every game-build sender label reads the constant — a rebrand must not need a hunt."""
    for rel in ("static/js/chat.js", "static/js/chatRenderer.js"):
        js = _read(rel)
        assert not re.search(r"isGameBuild\(\) \? ['\"]Orwell['\"]", js), \
            f"{rel}: a game-build author site still hardcodes 'Orwell'"
        assert "GAME_NARRATOR" in js


def test_product_chrome_keeps_orwell():
    """The rename is scoped to the FICTION: slash/compacted meta-bubbles (product voice)
    keep 'Orwell' — the product name is not erased, just kept out of the narration."""
    renderer = _read("static/js/chatRenderer.js")
    assert "(isSlash || isCompacted) ? 'Orwell'" in renderer


def test_game_build_slates_drop_the_done_tail():
    chat = _read("static/js/chat.js")
    assert "(ok && isGameBuild()) ? ''" in chat, "success slates must carry no debug tail"
    assert "'failed'" in chat, "failures stay literal (operator truth)"


def test_slate_styling_is_game_build_scoped():
    css = _read("static/css/game-trim.css")
    assert "body[data-game-build] .agent-thread-node" in css
    assert "body[data-game-build] .agent-thread-tool" in css
    # outcome slates keep richer type via the PERSISTENT marker (the reveal class is
    # transient — cleared after the entrance animation)
    assert "ow-slate-outcome" in css
    chat = _read("static/js/chat.js")
    assert "ow-ceremony-reveal ow-slate-outcome" in chat

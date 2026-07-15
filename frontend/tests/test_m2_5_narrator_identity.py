"""M2-5 (audit B4/B7) — narrator identity + production-slate beat styling.

Owner pick (2026-07-08): the transcript author is the show's **production voice** — never the
model name. "Orwell" stays product chrome (wordmark, tab, admin).

#1626 increment 2 RELAXED the original "Production is phase-invariant" rule to
**producer-name-invariance**: the byline DEFAULTS to "Production" (`GAME_NARRATOR`, the single
registry constant + the parked P-1 rebrand's one line) and, once the engine resolves the season's
seeded Vault-free producer name, the byline reflects THAT producer — dynamic, but STABLE PER SEASON
(the same producer every phase/turn, not per-phase). Every game-build author site reads the dynamic
`gameNarrator()` getter (window.ORWELL_GAME_NARRATOR, fail-open to "Production"), the stream hands the
name to the client via the `orwell_narrator` event, and the monogram seeds off the same name.

Beats still render as production slates in the game build: no lowercase "done" debug tail (failures
stay literal — operator truth), slate type on the label, one aligned rail.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def test_the_default_narrator_is_one_constant_in_the_registry():
    """The DEFAULT byline is still one registry constant (the pre-resolution value + the P-1
    rebrand's one line), and it seeds the window global that the dynamic getter reads."""
    beats = _read("static/js/orwellToolBeats.js")
    assert "export const GAME_NARRATOR = 'Production';" in beats
    assert "window.ORWELL_GAME_NARRATOR = GAME_NARRATOR" in beats


def test_the_byline_is_the_dynamic_producer_name_defaulting_to_production():
    """#1626: the byline is the season's producer name (dynamic), STABLE PER SEASON, defaulting to
    'Production' when unresolved. The registry exposes a getter/setter over window.ORWELL_GAME_NARRATOR,
    both fail-open to the "Production" default."""
    beats = _read("static/js/orwellToolBeats.js")
    # a getter reads the resolved window value, else the GAME_NARRATOR default
    assert "export function gameNarrator()" in beats
    assert "window.ORWELL_GAME_NARRATOR" in beats and "GAME_NARRATOR" in beats  # falls back to default
    # a setter resolves the producer name onto the window global (fail-open to the default)
    assert "export function setGameNarrator(name)" in beats


def test_no_game_build_author_site_hardcodes_a_name():
    """Every game-build sender label reads the DYNAMIC getter (not a frozen const, not a literal) —
    so the byline tracks the season's producer and a rebrand still needs no per-site hunt."""
    for rel in ("static/js/chat.js", "static/js/chatRenderer.js"):
        js = _read(rel)
        assert not re.search(r"isGameBuild\(\) \? ['\"]Orwell['\"]", js), \
            f"{rel}: a game-build author site still hardcodes 'Orwell'"
        assert "gameNarrator()" in js, f"{rel}: a game-build author site must read the dynamic byline"
        # the frozen const must NOT be the byline at an author site (it is only the registry default)
        assert "isGameBuild() ? GAME_NARRATOR" not in js, \
            f"{rel}: byline still pinned to the frozen const instead of gameNarrator()"


def test_the_producer_name_is_plumbed_from_engine_to_client():
    """The producer byline reaches the client end to end: the engine's Vault-free `producerName`
    (moment prompt) is stashed FE-side, then emitted on the chat stream as an `orwell_narrator`
    event the client consumes to set the byline. Fail-open at every hop."""
    helpers = _read("routes/chat_helpers.py")
    # stashed from the moment prompt (both live-game and casting framing), exposed via a getter
    assert "producerName" in helpers
    assert "def last_framed_producer_name(" in helpers
    loop = _read("src/agent_loop.py")
    # emitted on the stream (game/casting turns only), read from the stash
    assert "last_framed_producer_name" in loop
    assert '"type": "orwell_narrator"' in loop
    # the client sets its byline from that event (main + mirror parsers) and persists it per-tab
    chat = _read("static/js/chat.js")
    assert "json.type === 'orwell_narrator'" in chat
    assert "setGameNarrator(json.name)" in chat
    assert "orwell.gameNarrator" in chat  # sessionStorage key — reload keeps it (stable per season)


def test_product_chrome_keeps_orwell():
    """The rename is scoped to the FICTION: slash/compacted meta-bubbles (product voice)
    keep 'Orwell' — the product name is not erased, just kept out of the narration."""
    renderer = _read("static/js/chatRenderer.js")
    assert "(isSlash || isCompacted) ? 'Orwell'" in renderer


def test_game_build_slates_drop_the_done_tail():
    chat = _read("static/js/chat.js")
    assert "(ok && isGameBuild()) ? ''" in chat, "success slates must carry no debug tail"
    assert "'failed'" in chat, "failures stay literal (operator truth)"
    # PR #1235 review: the RELOAD path mirrors the live suppression + the outcome marker
    renderer = _read("static/js/chatRenderer.js")
    assert "(ok && isGameBuild()) ? ''" in renderer, "reload must mirror the live done-tail rule"
    assert "ow-slate-outcome" in renderer


def test_slate_styling_is_game_build_scoped():
    css = _read("static/css/game-trim.css")
    assert "body[data-game-build] .agent-thread-node" in css
    assert "body[data-game-build] .agent-thread-tool" in css
    # outcome slates keep richer type via the PERSISTENT marker (the reveal class is
    # transient — cleared after the entrance animation)
    assert "ow-slate-outcome" in css
    chat = _read("static/js/chat.js")
    assert "ow-ceremony-reveal ow-slate-outcome" in chat

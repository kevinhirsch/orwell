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
    # the client sets its byline from that event (main + mirror parsers) and persists it season-scoped
    chat = _read("static/js/chat.js")
    assert chat.count("json.type === 'orwell_narrator'") >= 2   # main + mirror/resume parsers
    assert "setGameNarrator(json.name)" in chat
    assert "orwell.gameNarrator" in chat  # sessionStorage key — reload keeps it for the same season


def test_the_producer_byline_is_season_scoped_server_side():
    """CONSENSUS must-fix (CodeRabbit Major / Greptile P1): because a blank producer fetch is
    deliberately not-clobbering (stable per season), the cache is CLEARED at the season-reset
    boundary — otherwise the SAME user's NEW season emits the PRIOR season's producer. The clear
    lives in the not-started framing branch and pops the SAME `user or "default"` key the stash uses."""
    helpers = _read("routes/chat_helpers.py")
    assert '_LAST_FRAMED_PRODUCER_NAME.pop(user or "default", None)' in helpers, \
        "season-reset must clear the cached producer so a new season re-resolves its own"


def test_stash_producer_name_is_fail_open_but_not_silent():
    """`_stash_producer_name` must be fail-open (a non-mapping/blank prompt never raises and never
    clobbers a good name) WITHOUT a silent `except Exception: pass` (owner ruling #1599 / Ruff
    S110/BLE001) — it narrows and logs at debug."""
    from routes import chat_helpers as ch
    # the source must not carry a blind swallow; it narrows + logs instead
    src = _read("routes/chat_helpers.py")
    fn = src[src.index("def _stash_producer_name("):src.index("def last_framed_producer_name(")]
    assert "except Exception:\n        pass" not in fn, "no silent fail-soft (owner ruling #1599)"
    assert "logger.debug(" in fn, "the skipped path must log the reason"
    # behavior: strips, is fail-open on a non-mapping/blank prompt, and never clobbers a good name
    key = "__m2_5_test_user__"
    ch._LAST_FRAMED_PRODUCER_NAME.pop(key, None)
    try:
        ch._stash_producer_name(key, {"producerName": "  The Producer  "})
        assert ch.last_framed_producer_name(key) == "The Producer"   # stripped
        ch._stash_producer_name(key, None)                            # non-mapping ⇒ no raise, no clobber
        ch._stash_producer_name(key, ["not", "a", "dict"])            # non-mapping ⇒ no raise, no clobber
        ch._stash_producer_name(key, {"producerName": "   "})         # blank ⇒ keep the prior value
        ch._stash_producer_name(key, {})                             # missing ⇒ keep the prior value
        assert ch.last_framed_producer_name(key) == "The Producer"
    finally:
        ch._LAST_FRAMED_PRODUCER_NAME.pop(key, None)


def test_client_refreshes_the_already_mounted_live_byline():
    """#1626 review item 3: both stream handlers create the assistant holder BEFORE reading the SSE,
    so the live bubble must be re-labeled when the producer resolves mid-stream (not only at
    finalize/reload). The refresh routes through the canonical role-label path, preserving an
    explicit character label."""
    chat = _read("static/js/chat.js")
    assert "function _refreshLiveByline(" in chat
    # it re-applies via the canonical labeler, carrying the holder's explicit character label through
    assert "_setRoleModelLabel(roleEl, liveHolder._requestedModel, liveHolder._actualModel" in chat
    assert "characterName: liveHolder._characterName" in chat
    # both the primary and the mirror/resume handlers refresh the live holder
    assert chat.count("_refreshLiveByline(holder)") >= 2


def test_client_persisted_byline_is_season_scoped():
    """#1626 review item 1 (client): the persisted narrator is scoped to the stream's SESSION, and
    restored only when the stored record matches the ACTIVE session — so a new season/session in the
    same tab falls back to the default instead of restoring the prior producer."""
    chat = _read("static/js/chat.js")
    # persisted as a {sid, name} record keyed to the stream session, not a tab-global bare string
    assert "function _persistNarratorForSession(" in chat
    assert "JSON.stringify({ sid: sid || null, name: String(name) })" in chat
    assert "_persistNarratorForSession(streamSessionId, json.name)" in chat  # primary
    assert "_persistNarratorForSession(sessionId, json.name)" in chat        # mirror/resume
    # restore validates the record against the active session before applying it
    assert "_rec.sid === _curSid" in chat and "getCurrentSessionId" in chat


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

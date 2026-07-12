"""Transient-animation audit — poll-panel innerHTML churn (keyed reconcile).

Three docked/ambient polling panels used to rebuild their whole content subtree with an
unconditional ``innerHTML = …`` on every poll / ``orwell:gamechanged`` cadence, destroying DOM
node identity. The consequences were user-visible:

  * ``orwellFinale.js``  — each newly-read jury vote mounted via a wholesale ``revWrap.innerHTML``
    rebuild, so the reveal (the season's loudest beat) landed as a SILENT text swap and every prior
    row + both portrait faces re-decoded each cadence.
  * ``orwellCastPin.js`` — the scroll grid was torn down + reparsed every ``FAST_POLL_MS`` (4s) while
    portraits generated, resetting ``scrollTop`` to 0 (yanking a scrolling player to the top) and
    re-decoding every lazy ``<img>``.
  * ``orwellRoomStrip.js`` — ``_diffPresence`` holds a departing occupant one cycle at ``leaving`` and
    the CSS intends ``transition: opacity .6s``, but a fresh node each poll had nothing to
    interpolate from, so the leaving-fade never fired.

The fix (each): a KEYED reconcile that keeps existing element nodes (add/remove/reorder by a stable
key), toggles state classes on the PERSISTENT node so CSS transitions fire, reuses portrait nodes,
and gives new reveals/arrivals a reduced-motion-gated entrance. These are source-pinned convention
checks (the render behaviour is proven in the PR via browser_smoke.py), matching the sibling panel
gates (test_transient_ceremony_reveal.py, test_m3_1_room_strip.py).

Name-agnostic; touches no houseguest names.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name):
    with open(os.path.join(FRONTEND, "static", "js", name), encoding="utf-8") as f:
        return f.read()


CASTPIN = _read("orwellCastPin.js")
FINALE = _read("orwellFinale.js")
ROOM = _read("orwellRoomStrip.js")


# ── orwellCastPin.js — keyed per-tile reconcile (scroll + <img> identity survive the poll) ──

def test_castpin_reconciles_per_tile_instead_of_wholesale_innerhtml():
    assert "function reconcileFaces(" in CASTPIN
    # render() calls the reconcile, NOT a fresh `faces.innerHTML = ordered.map(...)` rebuild.
    assert "reconcileFaces(faces" in CASTPIN
    assert "faces.innerHTML = ordered.map" not in CASTPIN, (
        "the wholesale innerHTML rebuild (which reset scrollTop and re-decoded every <img>) is gone"
    )


def test_castpin_tiles_are_keyed_and_reused():
    # a stable per-houseguest key + a visual signature so an unchanged tile (and its decoded <img>)
    # is reused untouched, and only a genuinely-changed tile is rebuilt.
    assert "data-ocp-key" in CASTPIN and "data-ocp-sig" in CASTPIN
    assert "replaceChild" in CASTPIN, "a changed tile replaces its predecessor in place (node reuse)"


# ── orwellFinale.js — reveal rows append-only + reduced-motion-gated entrance ──

def test_finale_reveals_are_append_only_not_a_wholesale_rebuild():
    # a VISUAL reveal count (separate from the aria _lastRevealCount) drives an append-only path:
    # only genuinely-new votes are added, prior rows + their faces are reused.
    assert "_shownRevealCount" in FINALE
    assert "reveals.length > _shownRevealCount" in FINALE, (
        "new reveals are APPENDED (reused prior rows keep their decoded faces)"
    )


def test_finale_new_reveal_gets_a_reduced_motion_gated_entrance():
    assert "function _animateIn(" in FINALE
    assert "ofin-reveal-in" in FINALE
    assert "@keyframes ofin-reveal-in" in FINALE
    # the entrance is cleared off animationend with a setTimeout belt (mirrors flashRow).
    assert re.search(r'addEventListener\(["\']animationend["\']', FINALE)
    assert re.search(
        r"prefers-reduced-motion.*?ofin-reveal-in\s*\{\s*animation:\s*none", FINALE, re.S
    ), "reduced-motion must strip the reveal entrance to an instant appearance"


def test_finale_finalist_cards_are_keyed_and_reused():
    # finalist cards reconcile by id (only the live tally text moves each reveal) so the portrait
    # face is not re-decoded every poll.
    assert "data-fin-key" in FINALE and "data-fin-sig" in FINALE
    assert 'querySelector(".ofin-tally")' in FINALE, (
        "the tally updates the PERSISTENT node's text rather than rebuilding the card"
    )
    # Greptile P1 (#1493): a signature change (e.g. a portrait landing after first render) must
    # REPLACE the stale finalist node in place — else insertBefore mounts the fresh card BESIDE the
    # old one (key still wanted, so cleanup keeps it) → duplicate finalist cards. Mirror castpin.
    assert "replaceChild" in FINALE, (
        "a changed finalist card replaces its stale predecessor in place (no duplicate card)"
    )
    # Greptile P1 (#1493): append-only reveal rows read _portraitById at BUILD time; the roster cache
    # fills async, so a row mounted before its portrait landed must be refreshed once it lands (later
    # same-length polls skip the append block). A per-row face signature drives an in-place rebuild.
    assert "data-rev-facesig" in FINALE, (
        "append-only reveal rows carry a face signature so a landing portrait refreshes the row "
        "(else reveal-row faces stay monogram fallbacks forever)"
    )


# ── orwellRoomStrip.js — persistent chips so the leaving-fade fires; gated arrival fade ──

def test_room_strip_keeps_a_persistent_row_and_reconciles_chips():
    assert 'body.querySelector(".ors-row")' in ROOM, "a persistent row is reused across polls"
    assert "data-ors-key" in ROOM and "data-ors-sig" in ROOM


def test_room_strip_toggles_leaving_on_the_persistent_node():
    # the WHOLE point: toggling the class on a surviving node lets `transition: opacity .6s` fire.
    assert re.search(r'classList\.toggle\(\s*["\']ors-chip-leaving["\']', ROOM)


def test_room_strip_arrival_fade_is_reduced_motion_gated():
    assert "ors-chip-enter" in ROOM
    assert "@keyframes ors-chip-in" in ROOM
    assert re.search(
        r"prefers-reduced-motion.*?ors-chip-enter\s*\{\s*animation:\s*none", ROOM, re.S
    ), "reduced-motion must strip the arrival fade to an instant appearance"

"""E60 / E89 — richer approach treatment + the FE approach-timing belt (orwellSocial.js).

E60: the engine ships a coarse categorical MOTIVE (bond | probe) — never the number, never a
canned pretext line. The approach chip must VARY its framing by that enum (distinct copy + a
motive class), so a "bond" overture reads differently from a "probe".

E89: no approach may render before the house has actually started playing — the first ceremony
(the week-1 HOH result) must have resolved. The engine has its own E89 gate (empty until then);
this asserts the FE's OWN belt, so even if the engine FAILS OPEN and hands the UI approaches at
the premiere, the chip strip stays empty.

Static source contract (name-agnostic; no running engine) — a refactor that drops the belt or
collapses the motive framing fails CI without a browser. The dynamic "belt holds on fail-open"
behaviour is also exercised by the headless browser keep-set (browser_smoke.py).
"""

import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _read(name: str) -> str:
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


SRC = _read("orwellSocial.js")


# ── E60: motive-varied chip framing ───────────────────────────────────────────

def test_motive_framing_varies_by_bond_and_probe():
    # A single mapping keyed by the engine's motive enum — bond and probe both present and DISTINCT.
    assert "MOTIVE_FRAMING" in SRC
    assert "bond" in SRC and "probe" in SRC
    # The two motives carry different copy (not one canned line for both).
    bond_copy = "wants to talk game with you"
    probe_copy = "has been sizing up your game"
    assert bond_copy in SRC and probe_copy in SRC
    assert bond_copy != probe_copy


def test_chip_carries_the_motive_as_a_class_and_dataset():
    # The chip must read the framing class + tag the motive so the two are visually distinguishable.
    assert "framing.cls" in SRC
    assert "osoc-motive-bond" in SRC and "osoc-motive-probe" in SRC
    assert "dataset.motive" in SRC


def test_no_bare_canned_pretext_is_the_only_source_of_copy():
    # The neutral "wants a word with you" survives ONLY as a fallback, never as the primary framing
    # for a known motive (the E60 smell is shipping that canned line as the actual approach).
    assert "MOTIVE_FALLBACK" in SRC
    # The fallback is reached via the framing map, not hard-wired per motive.
    assert "it.motive && MOTIVE_FRAMING[it.motive]" in SRC


# ── E89: the FE approach-timing belt ──────────────────────────────────────────

def test_belt_helper_gates_on_the_first_ceremony():
    assert "firstCeremonyResolved" in SRC
    # The belt is derived from /state alone (week/phase), and the opening HOH COMPETITION is
    # explicitly still pre-ceremony so the premiere shows nothing.
    assert "_ceremonyResolved" in SRC
    assert "hoh" in SRC.lower()
    assert 'phase.indexOf("hoh")' in SRC


def test_render_suppresses_all_chips_before_the_first_ceremony():
    # renderApproaches must short-circuit to an EMPTY list when the belt is closed — this is the
    # line that holds even if the engine fails open and the initiatives route returns approaches.
    assert "_ceremonyResolved" in SRC
    assert "? (Array.isArray(list) ? list : [])" in SRC
    assert ": [];" in SRC


def test_refresh_does_not_fetch_or_render_approaches_before_the_belt_opens():
    # Before the belt opens the poll renders an empty set and never even asks for initiatives.
    assert "if (!_ceremonyResolved) { renderApproaches([]); return; }" in SRC


def test_belt_resets_when_there_is_no_game():
    # On "no game" the belt closes again (so a new pre-ceremony game can't inherit an open belt).
    assert "_ceremonyResolved = false;" in SRC

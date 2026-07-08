"""M2-3 (audit B2) — the premiere cast strip + the pre-HOH board reframe.

The status panel (`orwellStatusPanel.js`) gains, during the premiere only:
  1. a sixteen-tile cast STRIP built on the shared `OrwellMonogram.face()` kit, each tile lit
     (met) or unlit (not-yet-met) per the engine's Vault-free `premiere` projection — the
     met-progress gate made visible (0/15 -> 15/15);
  2. a pre-HOH board REFRAME — before the first HOH exists (week 1, no HOH crowned), the three
     dead "HOH -/ Noms -/ Veto -" rows read "First HOH tonight" instead of the em-dashes.

Constraints proven here: the tiles render ONLY roster / met / public-status data (Vault-free — no
hidden key or number crosses), clicking a tile FOCUSES the chat (ADR 0003: augment, never replace),
and the strip retires with the premiere block (docks off after the first HOH).

The FE pytest lane has no DOM runtime, so the DOM-touching render is source-pinned, and the two PURE
helpers (`isPreHoh`, `premiereUnmetIds`) are executed in node against fixtures (the real, unmodified
source) so the behavior — not just the wording — is asserted. Live DOM is covered by browser_smoke.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = os.path.join("static", "js", "orwellStatusPanel.js")


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _fn_body(src: str, name: str) -> str:
    """Slice a top-level `function name(...) { ... }` by brace-matching from its signature."""
    start = src.index("function " + name + "(")
    i = src.index("{", start)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[start : j + 1]
    raise AssertionError("unterminated function " + name)


# ── the strip is built on the shared monogram kit, from public roster cards only ── #

def test_strip_markup_and_kit_wiring_exist():
    src = _read(PANEL)
    # the strip container lives inside the premiere block (so it retires with it) …
    assert 'id="os-prem-strip"' in src
    assert "function renderPremiereStrip(" in src
    # … and is called from the premiere renderer.
    assert "renderPremiereStrip(el, state)" in src
    body = _fn_body(src, "renderPremiereStrip")
    # tiles are the shared OrwellMonogram.face() kit (the DoD component), not a bespoke face.
    assert "window.OrwellMonogram.face(" in body
    # sixteen tiles = the player + every house card (the full roster).
    assert "state.player" in body or "state && state.player" in body
    assert "state.house" in body or "state && state.house" in body


def test_strip_tile_data_is_vault_free():
    """The tile render reads ONLY the public roster card (id/name/status/portrait/isPlayer) and the
    premiere projection (remaining/complete/houseguest) — never a hidden stat, soul, or number."""
    src = _read(PANEL)
    body = _fn_body(src, "renderPremiereStrip")
    accessed = set(re.findall(r"\.(\w+)", body))
    # NB: `.hidden` here is the DOM property (strip.hidden = ...), not a Vault field — excluded.
    leaky = {"trust", "affinity", "threat", "stats", "physical", "mental", "social",
             "soul", "emotional", "confidence", "vault", "secret"}
    assert not (accessed & leaky), f"strip render reads hidden fields: {accessed & leaky}"
    # portrait is forced to the monogram (public id-seed) — no fetch, no data access in the render.
    assert "portrait: null" in body
    assert "fetch(" not in body


def test_premiere_unmet_helper_is_vault_free():
    src = _read(PANEL)
    body = _fn_body(src, "premiereUnmetIds")
    accessed = set(re.findall(r"\.(\w+)", body))
    leaky = {"trust", "affinity", "threat", "stats", "physical", "mental", "social",
             "soul", "emotional", "confidence"}
    assert not (accessed & leaky), f"unmet derivation reads hidden fields: {accessed & leaky}"


# ── clicking a tile FOCUSES the chat, never replaces it (ADR 0003) ── #

def test_tile_click_focuses_chat_never_replaces():
    src = _read(PANEL)
    body = _fn_body(src, "renderPremiereStrip")
    assert 'addEventListener("click", focusChat)' in body
    focus = _fn_body(src, "focusChat")
    # focus the composer + scroll it into view — an AUGMENT. No navigation / no chat replacement.
    assert 'getElementById("message")' in focus
    assert ".focus()" in focus
    assert "scrollIntoView" in focus
    for banned in ("location", "innerHTML =", "location.href", "navigate"):
        assert banned not in focus, f"tile click must not {banned!r} (ADR 0003: never replace chat)"


# ── the pre-HOH board reframe copy + gate ── #

def test_prehoh_reframe_copy_and_markup():
    src = _read(PANEL)
    assert "First HOH tonight" in src
    assert 'id="os-prehoh"' in src
    assert 'id="os-board"' in src
    # the three em-dash rows still exist (they update underneath) — just hidden pre-HOH.
    for row in ("os-hoh", "os-noms", "os-veto"):
        assert row in src
    # render() toggles the board vs. the reframe line off isPreHoh.
    assert "isPreHoh(st)" in src


# ── node-executed BEHAVIOR of the two pure helpers (against the real source) ── #

def _node_eval(src_fns: str, call: str):
    harness = src_fns + "\nconsole.log(JSON.stringify(" + call + "));\n"
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        out = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_prehoh_gate_behaviour():
    src = _read(PANEL)
    fn = _fn_body(src, "isPreHoh")
    # Week 1, no HOH yet, not finished -> the reframe is on.
    assert _node_eval(fn, 'isPreHoh({"week": 1})') is True
    assert _node_eval(fn, 'isPreHoh({"week": 1, "hoh": null})') is True
    # An HOH exists -> board, not the reframe.
    assert _node_eval(fn, 'isPreHoh({"week": 1, "hoh": {"id": "hg-3", "name": "n"}})') is False
    # Past week 1 (a later week always has a crowned HOH) -> board.
    assert _node_eval(fn, 'isPreHoh({"week": 2})') is False
    # Season over -> never the reframe.
    assert _node_eval(fn, 'isPreHoh({"week": 1, "finished": true})') is False


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_met_progress_gate_behaviour():
    """The strip's lit/unlit state is the met-progress gate: a houseguest in the premiere's
    `remaining` set is NOT yet met (unlit); everyone else is met (lit). Player is always met."""
    src = _read(PANEL)
    fn = _fn_body(src, "premiereUnmetIds")
    # 0/N met: three still to meet -> all three ids are unmet.
    prem_start = {"remaining": [
        {"houseguest": {"id": "hg-1", "name": "a"}},
        {"houseguest": {"id": "hg-2", "name": "b"}},
        {"houseguest": {"id": "hg-3", "name": "c"}},
    ]}
    unmet = _node_eval(fn, "premiereUnmetIds(" + json.dumps(prem_start) + ")")
    assert set(unmet) == {"hg-1", "hg-2", "hg-3"}
    # progress: one met -> only the two remaining are unmet.
    prem_mid = {"remaining": [
        {"houseguest": {"id": "hg-2", "name": "b"}},
        {"houseguest": {"id": "hg-3", "name": "c"}},
    ]}
    assert set(_node_eval(fn, "premiereUnmetIds(" + json.dumps(prem_mid) + ")")) == {"hg-2", "hg-3"}
    # 15/15 met -> nothing left, every tile lights up.
    assert _node_eval(fn, 'premiereUnmetIds({"remaining": []})') == []
    # a name-only ref (no id) still keys off the name (defensive fallback).
    assert _node_eval(fn, 'premiereUnmetIds({"remaining": [{"houseguest": {"name": "z"}}]})') == ["z"]
    # absent / malformed projection -> empty (fail-soft, never throws).
    assert _node_eval(fn, "premiereUnmetIds(null)") == []
    assert _node_eval(fn, 'premiereUnmetIds({"complete": true})') == []


# ── the strip retires with the premiere block (docks off after the first HOH) ── #

def test_strip_hides_when_premiere_absent_or_complete():
    src = _read(PANEL)
    body = _fn_body(src, "renderPremiereStrip")
    # absent OR complete OR no kit -> hide the strip and tear its tiles down via the shared helper.
    assert "prem.complete" in body
    assert "clearPremiereStrip(el)" in body
    # the shared teardown both hides the strip AND removes every tile (button + its click listener).
    clear = _fn_body(src, "clearPremiereStrip")
    assert "strip.hidden = true" in clear
    assert "_stripTiles.delete(k)" in clear
    # the parent #os-premiere block is itself hidden by renderPremiere on complete (the outer retire) …
    prem = _fn_body(src, "renderPremiere")
    assert "wrap.hidden = true" in prem
    # … and renderPremiere ALSO tears the strip down on its early hide paths (no stale tiles linger).
    assert "clearPremiereStrip(el)" in prem


def test_empty_strip_stays_hidden_against_the_flex_default():
    """The `.os-prem-strip` rule sets display:flex, which would override the UA [hidden]{display:none};
    an explicit `[hidden]{display:none!important}` keeps an empty strip (no premiere / no cards) from
    rendering as a blank flex row."""
    src = _read(PANEL)
    assert ".os-prem-strip[hidden]" in src
    assert re.search(r"\.os-prem-strip\[hidden\]\s*\{\s*display:\s*none\s*!important", src)


def test_strip_is_capped_at_sixteen_tiles_and_deduped():
    """The strip is player + up to 15 houseguests; an oversized/duplicated public roster must not
    exceed sixteen tiles or repeat an id."""
    src = _read(PANEL)
    body = _fn_body(src, "renderPremiereStrip")
    assert "cards.length >= 16" in body          # the hard cap
    assert "cardKeys" in body                     # the id-dedupe guard


def test_met_lighting_honors_the_name_fallback():
    """premiereUnmetIds keys by id-or-name; the tile lighting must check BOTH so a name-only
    `remaining` ref doesn't wrongly light an id-carrying roster card as met."""
    src = _read(PANEL)
    body = _fn_body(src, "renderPremiereStrip")
    assert "unmet.has(String(card.name))" in body


def test_strip_is_the_unlit_class_gate():
    src = _read(PANEL)
    # the not-yet-met class the CSS dims — the visible "lights up" gate.
    assert "os-tile-unmet" in src
    assert ".os-tile-unmet" in src  # the CSS rule exists

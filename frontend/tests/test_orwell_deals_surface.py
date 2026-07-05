"""Deals surface (feature 0039) — the player's tracked promises as sidebar chrome.

Play-through gap (2026-06-18): the engine projects the player's OWN deals Vault-free on
/api/orwell/state (GameStateView.deals), but NOTHING consumed it — the player could make a deal
in chat and had nowhere to glance at what they were on the hook for. orwellDeals.js is that glance:
read-only, content-driven, game-build gated, Vault-free, mounted in the control-room gadget rail.

Source-pins (the live behavior runs against the real engine in the play-through harness).

B12 (audit 2026-07-03, RANKED_MASTER "Deals gadget 'A houseguest' fallback"): the gadget was
flagged as always rendering the generic "A houseguest" placeholder instead of the real name.
Root-caused: the ENGINE projection is correct — `GameSessionAdapter.dealView` resolves each
party's name via `nameOf()`, so a real `DealView` off `/api/orwell/state` always carries
`parties: [{id, name}, ...]` with the true display name (proven by the engine-side unit test
`tests/unit/dealsLive.test.ts`, and reproduced live: a fresh `makeDeal` call returns a populated
`name` for every party). The placeholder screenshot the audit captured came from ITS OWN capture
script driving `_orwellDealsDrive` with a payload shaped `{with:{name}, kind, status, note}` —
not the real `DealView` shape (`{parties:[{id,name}], kind, terms, status}`) — so `otherParty`'s
`deal.parties` read correctly saw nothing and fell back. No production code path ever builds a
deal object in that shape. `otherParty` was never exercised end-to-end against a REAL-shaped
payload by any test, though, so this file closes that gap: given a correctly-shaped `DealView`
(the one the engine actually emits), the real name renders — not the placeholder."""

import json
import os
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


JS = lambda: _read("static", "js", "orwellDeals.js")


def _extract_other_party():
    """Pull the REAL `otherParty(deal, nameById)` function body straight out of the shipped source
    (no DOM needed — it's pure array/string logic) so the behavioral check below runs the actual
    shipped code, not a reimplementation."""
    js = JS()
    start = js.index("function otherParty(deal, nameById) {")
    end = js.index("\n  }\n", start) + len("\n  }")
    return js[start:end]


def _run_other_party(deal_json, name_by_id_json="undefined"):
    if shutil.which("node") is None:
        pytest.skip("node not available")
    harness = (
        f"{_extract_other_party()}\n"
        f"console.log(JSON.stringify(otherParty({deal_json}, {name_by_id_json})));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_other_party_renders_the_real_name_for_a_real_deal_view():
    """The exact shape the engine emits (`src/ports/GameSession.ts` DealView.parties: NamedRef[],
    built by `GameSessionAdapter.dealView`) — the player's own row plus one houseguest, both with
    a resolved `name`. This must render the houseguest's real name, never the "A houseguest"
    placeholder (roles only — a generic placeholder name, never a hard-coded cast persona)."""
    real_deal = {
        "id": "deal:1",
        "parties": [
            {"id": "player", "name": "The Player"},
            {"id": "npc:1", "name": "Houseguest One"},
        ],
        "kind": "safety",
        "terms": "I won't put you up",
        "status": "open",
    }
    assert _run_other_party(json.dumps(real_deal)) == "Houseguest One"


def test_other_party_resolves_via_roster_when_the_party_name_is_missing():
    """Audit CA-9/IA-11/INT-4/FLOW-8 defensive floor: if a deal party's own `name` wasn't
    populated at write time, the gadget must resolve the party id against the roster carried on
    the SAME /state payload (state.player + state.house) before falling back to the generic
    placeholder — so the tracker never degrades to indistinguishable "A houseguest" rows."""
    deal_missing_name = {
        "id": "deal:3",
        "parties": [{"id": "player"}, {"id": "npc:2"}],
        "kind": "final-two",
        "status": "open",
    }
    name_by_id = {"npc:2": "Houseguest Two"}
    assert _run_other_party(json.dumps(deal_missing_name), json.dumps(name_by_id)) == "Houseguest Two"


def test_other_party_still_falls_back_for_a_genuinely_malformed_deal():
    """The placeholder is a real, intentional fallback for malformed/incomplete input (never a
    Vault-knowledge withhold — deals are always struck directly with a known houseguest) — pin
    that it still fires when `parties` is absent AND the roster can't resolve it, so the fallback
    path itself stays covered."""
    assert _run_other_party(json.dumps({"id": "deal:2", "kind": "vote", "status": "open"})) == "A houseguest"


def test_panel_is_mounted_in_the_index():
    html = _read("static", "index.html")
    assert "orwellDeals.js" in html


def test_panel_is_render_only_and_game_build_gated():
    js = JS()
    # render-only: the panel never progresses the game (deals are MADE in chat via makeDeal)
    assert "POST" not in js
    assert "makeDeal" not in js  # it reflects the ledger; it does not write to it
    # game-build gated, like every other game panel
    assert 'dataset.gameBuild !== "1"' in js


def test_panel_reads_only_the_vault_free_state_projection():
    js = JS()
    assert '"/api/orwell/state"' in js  # the actual fetch target
    assert "st.deals" in js  # the GameStateView.deals projection (player-party only)
    # the ONLY engine route it FETCHES is /state — no Vault, no admin, no off-screen deal feed
    for other in ("/api/orwell/retrospective", "/api/orwell/initiatives",
                  "/admin", "/api/orwell/decision"):
        assert other not in js, other


def test_panel_renders_no_hidden_numbers_or_npc_npc_deals():
    js = JS()
    # the Vault Wall holds at the surface: the panel reads ONLY the four DealView fields and never
    # any hidden read. None of the relationship-edge signal names appear anywhere in the module.
    for forbidden in ("trust", "threat", "affinity", "reliability", "alignment"):
        assert forbidden not in js.lower(), forbidden
    # it renders the OTHER party only by NAME, and skips the player's own row (no raw id leak)
    assert "otherParty" in js
    assert 'p.id !== "player"' in js
    assert ".name" in js


def test_panel_is_content_driven_and_fail_open():
    js = JS()
    # content-driven: an empty ledger collapses the box (no "empty window")
    assert "if (!list.length)" in js
    assert 'el.style.display = "none"' in js
    # fail-open: a state hiccup keeps a shown panel, reports, never throws into the page
    assert "OrwellReport" in js
    assert "_shown" in js


def test_panel_surfaces_every_deal_kind_and_status():
    js = JS()
    # the four engine deal kinds (MakeDealReq.kind) all carry a player-facing label
    for kind in ('"safety"', '"vote"', '"final-two"', '"target-other"'):
        assert kind in js, kind
    # the three statuses (open|kept|broken) — the whole drama of a promise — each render distinctly
    for status in ("open", "kept", "broken"):
        assert status in js, status


def test_panel_mounts_into_the_gadget_rail():
    js = JS()
    # #640: composes the OrwellGadget kit, which mounts it into the control-room rail (with the
    # sidebar → body fallback the kit owns in one place — never document.body first).
    assert "OrwellGadgetKit.create(" in js
    assert "orwell:gamechanged" in js  # refreshes on a new season

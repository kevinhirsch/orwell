"""Deals surface (feature 0039) — the player's tracked promises as sidebar chrome.

Play-through gap (2026-06-18): the engine projects the player's OWN deals Vault-free on
/api/orwell/state (GameStateView.deals), but NOTHING consumed it — the player could make a deal
in chat and had nowhere to glance at what they were on the hook for. orwellDeals.js is that glance:
read-only, content-driven, game-build gated, Vault-free, mounted in the control-room gadget rail.

Source-pins (the live behavior runs against the real engine in the play-through harness)."""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


JS = lambda: _read("static", "js", "orwellDeals.js")


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
    # 0054: prefer the control-room gadget rail, fall back to the sidebar (never document.body first)
    assert "gadget-rail-body" in js
    assert "sidebar" in js
    assert "orwell:gamechanged" in js  # refreshes on a new season

"""Lane H / H4 — collapsed-rail icons always match the expanded rows.

User ruling, verbatim:
  "The icons in the collapsed sidebar don't match the expanded sidebar and
   always must."

The mechanism (SINGLE icon source — so they can never drift again):

1. A static rail button hardcodes NO glyph. It declares the expanded sidebar
   row it stands for via data-rail-source in index.html, and
   js/sidebar-layout.js syncRailIcons() CLONES that row's svg into the
   button. One icon per nav entry, reused in both states.
2. Expanded rows INJECTED at runtime (Diary Room / Cast / the status HUD —
   orwell*.js game chrome this lane may not edit) get their rail mirrors
   created by the same module: icon cloned the same way, visibility
   mirroring the row's game gating, clicks forwarded to the row (or, for the
   status section, the existing open-sidebar-and-scroll rail behavior).
3. A MutationObserver over #sidebar re-clones on any change (the rail lives
   outside #sidebar, so the sync never re-triggers itself).

Only buttons with no expanded counterpart at all may own their glyph:
the delete ✕ (a text glyph) and the open-document indicator.

The runtime half (collapse the sidebar for real, compare per-entry svg
drawing signatures between the rail and the expanded rows) lives in
frontend/scripts/browser_smoke.py (the H4 block).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(FRONTEND, "static", "index.html")
LAYOUT_JS = os.path.join(FRONTEND, "static", "js", "sidebar-layout.js")
STYLE = os.path.join(FRONTEND, "static", "style.css")
SMOKE = os.path.join(FRONTEND, "scripts", "browser_smoke.py")

# The buttons allowed to own their glyph — entries with NO expanded
# counterpart. Anything else in the rail must derive from a source row.
NO_COUNTERPART = {"rail-delete-session", "rail-documents"}

# The pairings a player actually sees (game build keep-set + the section
# indicators) — pinned explicitly so a re-pairing is a conscious act.
PINNED_SOURCES = {
    "rail-search-btn": "sidebar-search-btn",
    "rail-new-session": "sidebar-new-chat-btn",
    "rail-chats": "chats-section-title",
    "rail-email": "email-section-title",
    "rail-theme": "tool-theme-btn",       # the glyph that had drifted
    "rail-settings": "user-bar-settings",
}


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _rail_region():
    html = _read(INDEX)
    start = html.index('id="icon-rail"')
    end = html.index('<nav class="sidebar"', start)
    return html[start:end]


def _rail_buttons():
    """[(id, full button tag + inner markup)] for every .icon-rail-btn."""
    region = _rail_region()
    out = []
    for m in re.finditer(r'<button class="icon-rail-btn[^"]*"[^>]*>.*?</button>', region, re.S):
        tag = m.group(0)
        bid = re.search(r'id="([^"]+)"', tag).group(1)
        out.append((bid, tag))
    return out


# ── 1. the single icon source ──────────────────────────────────────────────

def test_every_rail_button_declares_its_expanded_source():
    missing = [bid for bid, tag in _rail_buttons()
               if bid not in NO_COUNTERPART and "data-rail-source=" not in tag]
    assert not missing, (
        f"Rail buttons without a data-rail-source pairing: {missing} — every "
        "rail entry with an expanded counterpart must derive its icon from "
        "that row (H4: the two states must always match)."
    )


def test_paired_rail_buttons_hardcode_no_svg():
    dupes = [bid for bid, tag in _rail_buttons()
             if "data-rail-source=" in tag and "<svg" in tag]
    assert not dupes, (
        f"Hardcoded <svg> inside paired rail buttons: {dupes} — a second copy "
        "of an expanded row's icon is exactly the drift H4 kills. The clone "
        "in sidebar-layout.js syncRailIcons() is the only renderer."
    )


def test_every_declared_static_source_row_exists():
    html = _read(INDEX)
    region = _rail_region()
    for src in re.findall(r'data-rail-source="([^"]+)"', region):
        assert f'id="{src}"' in html, (
            f"data-rail-source points at #{src}, which does not exist in "
            "index.html — a dangling pairing leaves that rail button blank."
        )


def test_the_user_visible_pairings_are_pinned():
    for rail_id, source in PINNED_SOURCES.items():
        btn = next(tag for bid, tag in _rail_buttons() if bid == rail_id)
        assert f'data-rail-source="{source}"' in btn, (
            f"#{rail_id} must source its icon from #{source} (the row the "
            f"user sees for that entry); found: {btn[:120]}"
        )


# ── 2. the clone mechanism ─────────────────────────────────────────────────

def test_sync_clones_the_row_icon_never_redraws():
    js = _read(LAYOUT_JS)
    assert "function syncRailIcons" in js or "syncRailIcons =" in js
    assert "cloneNode(true)" in js, (
        "syncRailIcons must CLONE the expanded row's svg — re-drawing a "
        "lookalike is a second source and will drift."
    )
    assert "data-rail-source" in js or "dataset.railSource" in js
    assert "_railIconsSync" in js, "the test/debug seam (window._railIconsSync) must exist"


def test_resync_watches_the_sidebar_live():
    js = _read(LAYOUT_JS)
    h4 = js[js.index("RAIL_MIRRORS"):]
    assert "MutationObserver" in h4, (
        "Icon sync must re-run via a MutationObserver — the game chrome rows "
        "(Diary Room / Cast / status HUD) are injected and re-gated long "
        "after init, and a row's icon may change at runtime."
    )
    assert re.search(r"attributeFilter:\s*\[\s*'style',\s*'class'\s*\]", h4), (
        "the observer must watch style/class flips (the rows gate via inline "
        "display) as well as childList."
    )


def test_injected_game_chrome_gets_rail_mirrors():
    js = _read(LAYOUT_JS)
    for rail_id, source in (
        ("rail-diary-room", "sidebar-diary-room-btn"),
        ("rail-cast", "sidebar-cast-btn"),
        ("rail-game-status", "orwell-status"),
    ):
        assert rail_id in js and source in js, (
            f"RAIL_MIRRORS must create #{rail_id} from #{source} — the "
            "JS-injected entries need rail icons too (H4)."
        )


def test_fallback_glyph_only_where_no_expanded_icon_exists():
    js = _read(LAYOUT_JS)
    h4 = js[js.index("RAIL_MIRRORS"):]
    assert h4.count("fallback:") == 1, (
        "Exactly ONE mirror (the status HUD, whose expanded header has no "
        "svg) may carry a fallback glyph. A fallback on a row that HAS an "
        "icon would shadow the single source."
    )


# ── 3. presentation ────────────────────────────────────────────────────────

def test_rail_normalizes_cloned_icon_size_in_css():
    css = _read(STYLE)
    m = re.search(r"\.icon-rail-btn > svg\s*\{([^}]*)\}", css)
    assert m and "16px" in m.group(1), (
        ".icon-rail-btn > svg must normalize cloned icons to the rail's 16px "
        "drawing size — source rows draw at 13-15px for the wide layout."
    )


# ── 4. the runtime gate ────────────────────────────────────────────────────

def test_browser_smoke_carries_the_h4_runtime_gate():
    smoke = _read(SMOKE)
    assert "H4: every rail icon EQUALS its expanded row's icon" in smoke
    assert "H4: injected game chrome (Diary Room / Cast / status HUD) gets gated rail mirrors" in smoke
    # Anchored after the last pre-existing check block (F3), per the lane brief.
    # (H5 renamed the F3 label when The House folded into the sidebar — same
    # repoint H5×H6 applied to H6's anchor.)
    f3 = smoke.index("F3: the finale sheet stays full-width")
    h4 = smoke.index("H4 (sidebar icons)")
    assert h4 > f3, "the H4 smoke block sits after the F3 block (the prior last check)"

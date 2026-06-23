"""L8 + L10 — two front-end chrome fixes (source-pinned, JS/HTML-as-text like the other UI tests).

L8 — the settings model picker showed TWO disagreeing model-count badges at once (e.g.
     "1/341 models enabled" in the panel header AND a stale "341/341 models enabled" on the
     endpoint row). The row carries several `.admin-badge` spans (Image / endpoint-kind /
     status), so updating `row.querySelector('.admin-badge')` could rewrite the wrong badge and
     leave the count stale. The fix marks the count badge with a dedicated class and targets it.

L10 — the top-right pane label read "The house"; it must read "The House" (capital H), and no
     `>The house<` label may remain in the game chrome.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── L8: one model-count, one source of truth ──────────────────────────────────────────

def test_count_badge_has_a_dedicated_marker_class():
    js = _read("static", "js", "admin.js")
    # The status/count badge is uniquely identifiable so the updater never grabs the
    # Image or endpoint-kind `.admin-badge` instead.
    assert "adm-ep-model-count" in js
    assert 'class="admin-badge adm-ep-model-count">${visibleCount}/${totalCount} models enabled' in js


def test_model_state_save_updates_the_count_badge_specifically():
    js = _read("static", "js", "admin.js")
    start = js.index("async function _saveEpModelState")
    block = js[start:start + 1200]
    # Targets the marked count badge, NOT the first/any `.admin-badge` (which could be the
    # Image or kind badge — the cause of the two-disagreeing-counters bug).
    assert "row.querySelector('.adm-ep-model-count')" in block
    assert "row.querySelector('.admin-badge')" not in block
    # The header count and the row badge derive from the SAME enabled value.
    assert "const enabled = total - hidden.length;" in block
    assert "`${enabled}/${total} enabled`" in block
    assert "`${enabled}/${total} models enabled`" in block


# ── L10: "The House" (capital H) in the pane label, nowhere "The house" as a label ────

def test_status_panel_roster_header_is_capitalized():
    js = _read("static", "js", "orwellStatusPanel.js")
    # The static roster header reads "The House" (capital H) as a semantic heading (A11Y-9 added
    # role="heading"/aria-level); assert the meaningful parts, not one brittle attribute-order string.
    assert 'id="os-roster-h"' in js
    assert 'class="os-roster-h"' in js
    assert '>The House</div>' in js
    # the dynamic update of the same header matches the static markup
    assert '"The House · "' in js
    assert "The house" not in js


def test_gadget_rail_title_is_capitalized():
    html = _read("static", "index.html")
    assert '<span class="gadget-rail-title">The House</span>' in html
    assert 'title="The House"' in html
    # no lowercase pane label anywhere in the chrome markup
    assert ">The house<" not in html
    assert 'title="The house"' not in html

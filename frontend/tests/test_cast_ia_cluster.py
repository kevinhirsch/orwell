"""UX Phase-4 polish — Cast IA cluster (source-pinned).

CI can't drive the live stack here, so we pin the WIRING for each shipped fix by reading
the static assets — the same pattern as test_wcag_polish_cluster.py. See the #606 backlog
(UX-AUDIT-LOG.md) and docs/audits/2026-06-21-open-items-verification.md.

Shipped here:
  J3-19 — the right-rail "who's who" roster is visually subordinated to the chat column.
  J2-06 — the headshot-library delete (×) overlay meets the coarse-pointer tap-target floor.

Triaged but NOT shipped (deferred — design-level / cross-boundary):
  J2-05 — a premiere-week persistent cast affordance on mobile (owner design ruling).
  J2-09 — the broader "single home for who's who" unification (cluster B milestone); the
          in-scope label-duplication part is already resolved on main (see the pin below).
  J3-20 — met/unmet roster state needs the premiere-only `met` flag plumbed through the
          persistent /state projection (engine + route + JS) — a design-scoped data-model
          decision, out of the cast-panel-files scope.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ── J3-19 / #955: the status panel no longer carries a "who's who" text name-list at all ──
# J3-19 originally SUBORDINATED the right-rail roster name-rows (.os-hg) so they didn't compete
# with the chat narration. #955 resolves the same concern more decisively: the redundant text
# name-list was REMOVED entirely (it duplicated the cast photo gallery, now the single roster
# surface), so there is no second content column left to subordinate.

def test_955_status_panel_has_no_text_name_list():
    js = _read("static/js/orwellStatusPanel.js")
    # the per-houseguest name rows + their list container are gone…
    assert "os-hg" not in js, "the per-houseguest name rows (.os-hg) must be removed (#955)."
    assert 'id="os-roster"' not in js, "the text name-list container must be removed (#955)."
    # …but the at-a-glance house TALLY header stays ("The House · N/N").
    assert 'id="os-roster-h"' in js and '"The House · "' in js, (
        "the house tally header (The House · N/N) must remain — only the name LIST is removed."
    )


def test_j3_19_player_own_row_keeps_full_weight():
    # The player's own anchor row (.os-you) — the ceremony "You" line + role badge + rest cue —
    # must keep its own full-weight rule.
    js = _read("static/js/orwellStatusPanel.js")
    assert "#orwell-status .os-you { margin:" in js, (
        ".os-you must keep its own (full-weight) rule."
    )


# ── J2-06: the headshot-library delete (×) meets the coarse-pointer tap floor ──

def test_j2_06_headshot_delete_has_coarse_pointer_tap_floor():
    js = _read("static/js/orwellHeadshot.js")
    # A touch-only floor (matching the J5-01 pattern) lifts the hover-overlay × to 44x44 on
    # coarse pointers (where hover can't reveal it), while desktop stays compact.
    assert "@media (hover: none) and (pointer: coarse)" in js, (
        "the headshot-library delete must carry a coarse-pointer media query (J2-06)."
    )
    m = re.search(
        r"@media \(hover: none\) and \(pointer: coarse\) \{\s*"
        r"\.ow-headshot-studio \.hs-libdel \{[^}]*\}",
        js, re.DOTALL,
    )
    assert m, "the coarse-pointer rule must target .ow-headshot-studio .hs-libdel."
    rule = m.group(0)
    assert "width: 44px" in rule and "height: 44px" in rule, (
        "on a coarse pointer the delete × must be a 44x44 hit area (J2-06 tap-target floor)."
    )
    assert "opacity: 1" in rule, (
        "on touch (no hover) the delete × must stay visible — there is no hover to reveal it."
    )


def test_j2_06_keeps_reduced_motion_guard():
    # The added touch floor must not displace the existing reduced-motion guard on the overlay.
    js = _read("static/js/orwellHeadshot.js")
    assert "@media (prefers-reduced-motion: reduce) { .ow-headshot-studio .hs-libdel" in js, (
        "the .hs-libdel reduced-motion guard must remain."
    )


# ── J2-09 (in-scope part): the cast registry rows carry DISTINCT titles ────────

def test_j2_09_cast_registry_rows_have_distinct_titles():
    # J2-09 flagged "two registry rows both titled 'The Cast'". The in-scope label-duplication
    # part is resolved: the pinned-cast gadget and the full cast window now carry distinct
    # titles. (The broader who's-who unification is the deferred cluster-B milestone.)
    js = _read("static/js/orwellGadgetRail.js")
    m = re.search(r"var REGISTRY = \[(.*?)\];", js, re.DOTALL)
    assert m, "the gadget REGISTRY must exist."
    block = m.group(1)
    titles = re.findall(r'title:\s*"([^"]+)"', block)
    assert len(titles) == len(set(titles)), (
        "every gadget-rail registry row must carry a unique title (J2-09 — no two 'The Cast' "
        "rows): " + repr(titles)
    )

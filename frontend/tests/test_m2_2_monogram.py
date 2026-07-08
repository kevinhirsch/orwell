"""M2-2 (audit B3) — the designed monogram portrait system + role badges.

Source gates for the ONE shared component (`orwellMonogram.js`) and its three consumers
(cast window, rail chips/cast pin, decision cards). The live zero-provider render assert
is in `scripts/browser_smoke.py` (the cast-window block); these pins hold the structure:
one template module, everyone consumes it, the fixed badge set, the caption rule, and the
Vault-free seed inputs (public id/name only).
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


KIT = "static/js/orwellMonogram.js"


def test_kit_exists_with_the_shared_surface():
    js = _read(KIT)
    for export in ("face", "svg", "badgeSvg", "rolesFrom", "hueFor", "patternFor", "initialsFor"):
        assert re.search(rf"\b{export}\b", js), f"kit must expose {export}"
    assert "window.OrwellMonogram" in js


def test_badge_set_is_exactly_the_dor_four():
    """HOH crown / nominee target / veto V / winner star — and NO evicted badge:
    eviction stays the L16 grayscale rule, which the kit owns."""
    js = _read(KIT)
    badges = re.search(r"const BADGES = \{(.+?)\n  \};", js, re.S)
    assert badges, "BADGES block"
    keys = set(re.findall(r"^\s{4}(\w+):", badges.group(1), re.M))
    assert keys == {"hoh", "nominee", "veto", "winner"}
    assert "grayscale" in js  # the kit carries the L16 rule for its faces


def test_template_is_seeded_from_public_identity_only():
    """Deterministic per id (hash → hue + pattern), no fetches, no hidden inputs —
    the Vault-freedom of the component is structural: it can only render what it's handed."""
    js = _read(KIT)
    assert "fetch(" not in js, "the kit must be render-only (no data access)"
    assert "hash(" in js and "hueFor" in js and "patternFor" in js
    # the avalanche finalizer: sequential ids must not cluster hues
    assert "0x85ebca6b" in js and "0xc2b2ae35" in js


def test_kit_loads_before_its_consumers():
    html = _read("static/index.html")
    kit = html.index("orwellMonogram.js")
    assert kit < html.index("orwellCast.js")
    assert kit < html.index("orwellCastPin.js")
    assert kit < html.index("orwellDecision.js")


def test_cast_window_consumes_the_kit():
    js = _read("static/js/orwellCast.js")
    assert "OrwellMonogram.svg(" in js
    assert "OrwellMonogram.rolesFrom(" in js
    assert "syncBadge" in js  # badges composite on portraits AND monograms


def test_cast_pin_consumes_the_kit():
    js = _read("static/js/orwellCastPin.js")
    assert "OrwellMonogram.svg(" in js
    assert "OrwellMonogram.rolesFrom(" in js


def test_decision_chips_consume_the_kit():
    js = _read("static/js/orwellDecision.js")
    # M3-4: decision chips upgraded from the monogram-only .svg() to the kit's .face() —
    # a real persisted portrait when the roster cache has one, the SAME designed monogram as
    # the sanctioned fallback otherwise (still the ONE shared kit, never a bespoke render path).
    assert "OrwellMonogram.face(" in js
    assert "odec-face" in js
    # the accessible-name belt: the face's initials/portrait must not pollute the option name
    assert 'setAttribute("aria-label", label)' in js


def test_default_status_renders_no_caption():
    """M2-2 DoD: the 'In the house' caption renders only when status ≠ default —
    fourteen identical captions were noise, not information."""
    js = _read("static/js/orwellCast.js")
    m = re.search(r"function statusLabel\(s\) \{(.+?)\n  \}", js, re.S)
    assert m, "statusLabel"
    body = m.group(1)
    assert '"In the house"' not in body, "the default state must return an empty label"
    assert 'return ""' in body
    assert js.count("statusEl.hidden = !") >= 2, "empty captions must not render a row"


def test_mock_stays_in_the_pr_record():
    """The DoR's owner-approval artifact — the static template sheet — ships in-repo so
    the approved design is inspectable (and re-renderable) later."""
    assert os.path.exists(os.path.join(FE, "..", "docs", "mocks", "m2-2-monogram-template.html"))

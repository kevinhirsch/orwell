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
    """Deterministic per id (hash → hue + pattern), no hidden inputs — the Vault-freedom of the
    component is structural: svg()/face() can only render what they're handed (no data access
    inside the pure render path). The shared portrait cache (issue #1324) DOES fetch, but in its
    own out-of-band function — see test_portrait_cache_* below — never inside svg()/face()."""
    js = _read(KIT)
    for fn in ("function svg(", "function face("):
        start = js.index(fn)
        i = js.index("{", start)
        depth = 0
        j = i
        while True:
            if js[j] == "{":
                depth += 1
            elif js[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = js[start : j + 1]
        assert "fetch(" not in body, f"{fn} must stay render-only (no data access)"
    assert "hash(" in js and "hueFor" in js and "patternFor" in js
    # the avalanche finalizer: sequential ids must not cluster hues
    assert "0x85ebca6b" in js and "0xc2b2ae35" in js


# ── SHARED PORTRAIT CACHE (issue #1324) ────────────────────────────────────────────────────── #
#
# Two `face()` consumers were permanently starved of real portraits: ceremony slates
# (orwellToolBeats.js) never passed `portrait` at all, and the premiere cast strip
# (orwellStatusPanel.js) hard-coded `portrait: null, forceMono: true`. orwellDecision.js and
# orwellFinale.js each already solved this locally with their OWN private id->portrait cache;
# this centralizes the SAME pattern in the shared kit so those two starved consumers (and any
# future one) get real portraits for free instead of re-deriving a copy.

def test_kit_exposes_a_shared_portrait_cache():
    js = _read(KIT)
    assert "function portraitFor(" in js
    assert "function refreshPortraitCache(" in js
    assert "portraitFor," in js and "refreshPortraitCache," in js  # exported on window.OrwellMonogram
    assert "window.OrwellMonogram = {" in js


def test_portrait_cache_reads_only_the_public_roster_route():
    """Vault-free: the cache fetches ONLY the public roster projection (id/name/status/portrait —
    the same public card every cast surface already renders), never a hidden/soul/vault field."""
    js = _read(KIT)
    start = js.index("function refreshPortraitCache(")
    i = js.index("{", start)
    depth = 0
    j = i
    while True:
        if js[j] == "{":
            depth += 1
        elif js[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    body = js[start : j + 1]
    assert '"/api/orwell/roster"' in body
    for banned in ("vault", "soul", "trust", "affinity", "threat", "secret"):
        assert banned not in body.lower(), f"portrait cache reads a hidden field ({banned!r})"


def test_portrait_cache_refreshes_off_the_one_gamechanged_dispatcher_only():
    """g15: the cache must refresh off the existing `orwell:gamechanged` dispatcher — never a
    new ad-hoc poll (setInterval) or a second CustomEvent dispatch of its own."""
    js = _read(KIT)
    assert 'window.addEventListener("orwell:gamechanged"' in js
    assert "refreshPortraitCache(true)" in js
    assert "new CustomEvent(" not in js, "the kit must never dispatch its own gamechanged event"
    assert "setInterval(" not in js, "the cache must ride the existing dispatcher, not a new poll"


def test_portrait_cache_is_fail_open():
    """An unfetched/failed roster read must never throw — every consumer just keeps rendering
    the monogram fallback (the sanctioned default) until the cache self-heals."""
    js = _read(KIT)
    start = js.index("async function refreshPortraitCache(")
    end = js.index("\n  }", start)
    body = js[start:end]
    assert "try {" in body and "catch (_)" in body


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


def test_portrait_ref_heals_to_the_monogram_on_error():
    """#11: a still-generating / 404 portrait ref must heal to the designed monogram —
    never the browser broken-image glyph — on this ONE shared face (ceremony slates,
    decision cards, premiere strip, docked rail all route through face())."""
    js = _read(KIT)
    m = re.search(r"function face\(card, opts\)\s*\{(.+?)\n  \}", js, re.S)
    assert m, "face() must exist"
    body = m.group(1)
    assert "img.onerror" in body, "the portrait <img> must carry an onerror heal"
    # the heal rebuilds the monogram inner AND re-composites the role badge
    heal = re.search(r"img\.onerror\s*=\s*function\s*\(\)\s*\{(.+?)\};", body, re.S)
    assert heal, "onerror must be a handler that rebuilds the face"
    hbody = heal.group(1)
    assert "svg(card, opts)" in hbody, "heal must render the monogram svg"
    assert "badgeSvg(opts.role)" in hbody, "heal must re-composite the role badge"
    # the aria-hidden svg would drop the img's accessible name — the heal must move the label
    # onto the .ow-mono-face wrapper so the face keeps its name on the broken-portrait path.
    assert 'setAttribute("aria-label"' in hbody, "heal must preserve the accessible label on the wrapper"
    # role MUST be group, not img: role="img" flattens descendants, dropping the composited role
    # badge out of the accessibility tree. group keeps both the name and the badge in the tree.
    assert 'setAttribute("role", "group")' in hbody, "wrapper must use role=group (img flattens the badge)"
    assert 'setAttribute("role", "img")' not in hbody, "role=img would flatten the badge chip"

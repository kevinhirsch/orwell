"""M3-4 (road-to-market, Wave M3) — faces on decisions.

nominee/vote/houseguests-choice decision options (and the veto "Save X" chip) upgrade from the
M2-2 monogram-only chip to a portrait-OR-monogram face (`OrwellMonogram.face()`, the SAME kit
every cast surface already consumes) — a real persisted portrait when the roster cache has one,
the designed monogram as the sanctioned fallback otherwise. The finale jury reveal rows
(`orwellFinale.js`) gain the same treatment.

Presentation only: the pick-count/binding semantics and the POST payload (C20's contract) stay
byte-identical — proven below by running the REAL shipped `buildPayload` function (no
reimplementation, straight out of `orwellDecision.js`) against a fixture covering every pending
kind. Faces are seeded from the public roster card ONLY (id/name/status/portrait — the
`/api/orwell/roster` projection every cast surface already renders), never any relationship/
soul/consequence data — Vault-free by construction.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def DECISION_JS():
    return _read("static", "js", "orwellDecision.js")


def FINALE_JS():
    return _read("static", "js", "orwellFinale.js")


def MONOGRAM_JS():
    return _read("static", "js", "orwellMonogram.js")


# ── the C20 byte-parity fixture: the REAL buildPayload + SINGLE_PICK_FIELD, unreimplemented ─────

def _extract_single_pick_field():
    js = DECISION_JS()
    start = js.index("const SINGLE_PICK_FIELD = {")
    end = js.index("\n  };\n", start) + len("\n  };")
    return js[start:end]


def _extract_build_payload():
    js = DECISION_JS()
    start = js.index("function buildPayload(kind, sel, freeText, useVeto) {")
    end = js.index("\n  }\n", start) + len("\n  }")
    return js[start:end]


def _run_build_payload(kind, sel, free_text=None, use_veto=None):
    if shutil.which("node") is None:
        pytest.skip("node not available")
    harness = (
        f"{_extract_single_pick_field()}\n"
        f"{_extract_build_payload()}\n"
        f"console.log(JSON.stringify(buildPayload("
        f"{json.dumps(kind)}, {json.dumps(sel)}, {json.dumps(free_text)}, {json.dumps(use_veto)}"
        f")));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    out = res.stdout.strip().splitlines()[-1]
    return json.loads(out) if out != "undefined" else None


# kind, sel, freeText, useVeto -> the expected wire payload (submitDecision's contract). Covers
# every kind buildPayload branches on with a representative legal selection — pinned byte-for-
# byte so a decision-card change (like this one — faces are presentation only) can never
# silently reshape what reaches the engine.
FIXTURE = [
    ("nominations", ["npc:1", "npc:2"], None, None,
     {"kind": "nominations", "choice": ["npc:1", "npc:2"]}),
    ("finale-statement", [], "I played my own game.", None,
     {"kind": "finale-statement", "statement": "I played my own game."}),
    ("juror-question", [], "What was your biggest move?", None,
     {"kind": "juror-question", "statement": "What was your biggest move?"}),
    ("goodbye-message", ["warm"], "Take care.", None,
     {"kind": "goodbye-message", "vote": "warm", "statement": "Take care."}),
    ("exit-interview", ["defiant"], "I'm not done.", None,
     {"kind": "exit-interview", "vote": "defiant", "statement": "I'm not done."}),
    ("finale-answer", ["own-game"], None, None,
     {"kind": "finale-answer", "appeal": "own-game"}),
    ("comp-intent", ["compete"], None, None,
     {"kind": "comp-intent", "intent": "compete"}),
    ("comp-round", ["throw"], None, None,
     {"kind": "comp-round", "intent": "throw"}),
    ("self-evict", [], None, None,
     {"kind": "self-evict", "confirmed": True}),
    ("veto-decision", [], None, False,
     {"kind": "veto-decision", "use": False}),
    ("veto-decision", ["npc:3"], None, True,
     {"kind": "veto-decision", "use": True, "save": "npc:3"}),
    ("houseguests-choice", ["npc:4"], None, None,
     {"kind": "houseguests-choice", "vote": "npc:4"}),
    ("eviction-vote", ["npc:5"], None, None,
     {"kind": "eviction-vote", "vote": "npc:5"}),
    ("replacement", ["npc:6"], None, None,
     {"kind": "replacement", "replacement": "npc:6"}),
    ("tie-break", ["npc:1"], None, None,
     {"kind": "tie-break", "vote": "npc:1"}),
    ("final-eviction", ["npc:2"], None, None,
     {"kind": "final-eviction", "vote": "npc:2"}),
    ("juror-vote", ["npc:3"], None, None,
     {"kind": "juror-vote", "vote": "npc:3"}),
]


@pytest.mark.parametrize("kind,sel,free_text,use_veto,expected", FIXTURE)
def test_build_payload_byte_parity(kind, sel, free_text, use_veto, expected):
    """The wire payload for every pending kind, run through the REAL shipped buildPayload —
    unchanged by the M3-4 face-rendering work. addChip's new `person`/face-lookup machinery
    never reaches buildPayload, which still closes over kind/sel/freeText/useVeto alone."""
    assert _run_build_payload(kind, sel, free_text, use_veto) == expected


def test_build_payload_never_reads_a_face_or_portrait_field():
    """Structural belt: buildPayload's source must never reference portrait/face/person data —
    the wire contract is built from kind/sel/freeText/useVeto alone, so a presentation-only
    change (adding faces) can never leak into or alter it."""
    body = _extract_build_payload()
    for forbidden in ("portrait", "person", "_portraitById", "OrwellMonogram"):
        assert forbidden not in body, forbidden


# ── faces render from the public roster card only (Vault-free) ──────────────────────────────────

def test_decision_faces_are_seeded_from_the_roster_cache_only():
    js = DECISION_JS()
    # the ONLY route the portrait cache reads — the public roster projection (id/name/status/
    # portrait), the same one every cast surface already renders.
    assert '"/api/orwell/roster"' in js
    m = re.search(r"const f = window\.OrwellMonogram\.face\(\s*\{([^}]+)\}", js)
    assert m, "OrwellMonogram.face( call-site not found in orwellDecision.js"
    fields = m.group(1)
    assert "id: person.id" in fields
    assert "name: person.name" in fields
    assert "status:" in fields and "portrait:" in fields
    # never any relationship/soul/vault-adjacent signal near the face build
    for forbidden in ("trust", "threat", "affinity", "reliability", "consequence", "vault"):
        assert forbidden not in fields.lower()


def test_finale_faces_are_seeded_from_the_roster_cache_only():
    js = FINALE_JS()
    assert '"/api/orwell/roster"' in js
    m = re.search(r"const el = window\.OrwellMonogram\.face\(\s*\{([^}]+)\}", js)
    assert m, "OrwellMonogram.face( call-site not found in orwellFinale.js"
    fields = m.group(1)
    assert "id: ref.id" in fields
    assert "name: nameOf(ref)" in fields
    assert "status:" in fields and "portrait:" in fields
    for forbidden in ("trust", "threat", "affinity", "reliability", "consequence", "vault"):
        assert forbidden not in fields.lower()


def test_roster_cache_reads_are_fail_open_and_never_block_the_card():
    """A failed/unavailable roster read must leave the cache exactly as it was (empty on first
    load, stale on a later one) — never throw into render(), never delay the card."""
    for js in (DECISION_JS(), FINALE_JS()):
        assert "_refreshRosterCache" in js
        assert "catch (_) { /* fail open" in js


# ── monogram fallback (never portrait-only) ──────────────────────────────────────────────────────

def test_decision_and_finale_upgrade_to_face_not_svg_only():
    """Both surfaces call the kit's .face() (portrait-or-monogram), not .svg() (monogram-only) —
    a houseguest with no persisted portrait still renders correctly (the monogram IS the
    fallback, not a broken/missing face)."""
    for js in (DECISION_JS(), FINALE_JS()):
        assert "OrwellMonogram.face(" in js
        assert "OrwellMonogram.svg(" not in js


def test_kit_face_falls_back_to_the_monogram_when_no_portrait():
    """The shared kit's own contract: `face()` renders the persisted portrait ONLY when the
    roster card carries one (and forceMono isn't set); otherwise the designed monogram — the
    ONE fallback path every consumer (cast window, rail chips, decision cards, finale) relies
    on. Source-pinned on the kit itself, not reimplemented per-consumer."""
    js = MONOGRAM_JS()
    m = re.search(r"function face\(card, opts\) \{(.+?)\n  \}", js, re.S)
    assert m, "face() not found in orwellMonogram.js"
    body = m.group(1)
    assert "card.portrait" in body and "opts.forceMono" in body
    assert "svg(card, opts)" in body  # the monogram-render fallback branch


# ── accessible name + tap semantics survive the presentation swap ───────────────────────────────

def test_decision_face_keeps_the_accessible_name_pinned_to_the_label():
    js = DECISION_JS()
    assert 'setAttribute("aria-label", label)' in js
    assert 'f.setAttribute("aria-hidden", "true")' in js
    # the whole chip stays the tap target — the face itself is inert
    assert "pointer-events: none" in js


def test_finale_faces_are_decorative_and_never_replace_the_text_name():
    js = FINALE_JS()
    assert 'el.setAttribute("aria-hidden", "true")' in js
    # nameOf() text nodes still render for every finalist/reveal — faces are additive, not a
    # replacement for the accessible/visible name.
    assert 'b.textContent = nameOf(f)' in js
    assert 'jB.textContent = nameOf(r.juror)' in js
    assert 'vB.textContent = nameOf(r.votedFor)' in js


def test_kit_loads_before_the_decision_and_finale_modules():
    html = _read("static", "index.html")
    kit = html.index("orwellMonogram.js")
    assert kit < html.index("orwellDecision.js")
    assert kit < html.index("orwellFinale.js")

"""L26 + L14 — the "Where you are" gadget redesign.

L26 reshapes the presence gadget (`orwellPresence.js`):
  • HEADER = the room you're in + who's with you, FIRST names ("Kitchen — Keith, John, Joe"),
    or "Kitchen — alone" when no one is present.
  • BODY   = the VISIBLE nearby rooms (the engine returns only the player's room + adjacent
    rooms, so this is fog-of-war by construction) — each room that HAS people, with its
    houseguests' first names ("Living Room: Mary, Sam"); empty/out-of-view rooms omitted; a
    quiet "No one nearby." when nothing adjacent has anyone.

L14 (subsumed): FIRST names only everywhere, disambiguating any first name shared by 2+ DISTINCT
people anywhere in the current view as "First L." — computed across the whole view (present + all
nearby) so the same person reads consistently.

The dedup logic lives in one small self-contained helper, `_displayNames`, which these tests
extract and exercise under node against SYNTHETIC names (roles only — never fixture identities).
The route/wrapper passthrough + fail-open are covered by test_c28_presence / test_b64_whereabouts.
"""

import json
import os
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def _extract_display_names(js):
    """Slice the standalone `_displayNames` function source out of orwellPresence.js."""
    start = js.index("function _displayNames(")
    end = js.index("// Flatten every visible person", start)
    return js[start:end].strip()


# ── source pins: the redesigned shape is actually wired in ─────────────────────


def test_helper_is_self_contained():
    src = _extract_display_names(_read("static/js/orwellPresence.js"))
    assert src.startswith("function _displayNames(")
    # pure: only String/Array/Map/regex primitives — safe to eval headless in node
    for forbidden in ("fetch(", "document", "localStorage", "await ", "window"):
        assert forbidden not in src, f"_displayNames must not depend on {forbidden!r}"


def test_gadget_renders_header_body_and_refreshes_on_gamechanged():
    js = _read("static/js/orwellPresence.js")
    # HEADER = room + present (or "alone"); BODY = nearby rooms or the scoped-empty line.
    assert '" — " + here' in js
    assert '"alone"' in js
    # FLOW-9/VM-18/CA-18: the empty-body line names its scope (adjacent rooms) so it never reads as
    # a contradiction beneath a populated room roster.
    assert "The nearby rooms are quiet." in js
    # nearby rooms are filtered to those that HAVE people (empty/out-of-view omitted)
    assert "n.present && n.present.length" in js
    # refreshes on the shared game-changed signal AND polls
    assert 'addEventListener("orwell:gamechanged"' in js
    assert "setTimeout(tick" in js
    # game-build gated + fail-open
    assert "dataset.gameBuild" in js
    assert "render(null)" in js


# ── behavioral: real source, synthetic names, run under node ───────────────────


def _run_helper(people, targets):
    """Format each of `targets` through the real `_displayNames` built over `people`."""
    src = _extract_display_names(_read("static/js/orwellPresence.js"))
    harness = (
        src
        + "\nconst PEOPLE = " + json.dumps(people) + ";"
        + "\nconst TARGETS = " + json.dumps(targets) + ";"
        + "\nconst fmt = _displayNames(PEOPLE);"
        + "\nconsole.log(JSON.stringify(TARGETS.map(t => fmt.format(t))));\n"
    )
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
def test_unique_first_names_render_as_bare_first_names():
    people = [
        {"id": "npc:1", "name": "Alpha Klein"},
        {"id": "npc:2", "name": "Bravo Mott"},
    ]
    assert _run_helper(people, people) == ["Alpha", "Bravo"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_shared_first_name_disambiguates_with_last_initial():
    # Two DISTINCT people share a first name anywhere in the view → both get "First L."
    people = [
        {"id": "npc:1", "name": "Alpha Klein"},
        {"id": "npc:2", "name": "Alpha Mott"},
        {"id": "npc:3", "name": "Bravo Stone"},
    ]
    assert _run_helper(people, people) == ["Alpha K", "Alpha M", "Bravo"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_same_person_listed_twice_is_one_person_not_a_collision():
    # The SAME id appearing in two rooms must NOT trip disambiguation (one person, not two).
    person = {"id": "npc:1", "name": "Alpha Klein"}
    people = [person, person, {"id": "npc:2", "name": "Bravo Stone"}]
    assert _run_helper(people, [person]) == ["Alpha"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_dedup_is_computed_across_the_whole_view():
    # The two collisions sit in DIFFERENT lists (e.g. one present, one nearby); since the helper
    # is built over the FLATTENED view, both still disambiguate consistently.
    present = [{"id": "npc:1", "name": "Alpha Klein"}]
    nearby = [{"id": "npc:2", "name": "Alpha Mott"}]
    everyone = present + nearby
    assert _run_helper(everyone, everyone) == ["Alpha K", "Alpha M"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_no_last_name_falls_back_to_bare_first_name():
    # A colliding first name with no surname to split on stays a bare first name (never errors).
    people = [
        {"id": "npc:1", "name": "Alpha"},
        {"id": "npc:2", "name": "Alpha Mott"},
    ]
    assert _run_helper(people, people) == ["Alpha", "Alpha M"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_missing_id_falls_back_to_full_name_identity():
    # Without ids, two same-FULL-named entries are one identity; two differing surnames are two.
    same = [{"name": "Alpha Klein"}, {"name": "Alpha Klein"}]
    assert _run_helper(same, [same[0]]) == ["Alpha"]  # one distinct person → bare first name
    diff = [{"name": "Alpha Klein"}, {"name": "Alpha Mott"}]
    assert _run_helper(diff, diff) == ["Alpha K", "Alpha M"]

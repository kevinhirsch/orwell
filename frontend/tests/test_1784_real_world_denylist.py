"""#1784 (F9) — Real-World Denylist: Host Surnames, Networks, Season Continuity"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── source pins: the denylist constants are in both languages ────────

def test_python_constants_exist():
    py = _read("src", "agent_loop.py")
    assert "_REAL_HOST_SURNAMES" in py
    assert "_REAL_NETWORKS" in py
    assert "_SEASON_CONTINUITY_RE" in py


def test_js_constants_exist():
    md = _read("static", "js", "markdown.js")
    assert "_REAL_HOST_SURNAMES" in md
    assert "_REAL_NETWORKS" in md
    assert "_REAL_WORLD_DENY_RE" in md


def test_scrub_game_leak_has_keep_sentence():
    py = _read("src", "agent_loop.py")
    assert "def _keep_sentence(p: str) -> bool:" in py
    assert "_REAL_HOST_SURNAMES" in py


def test_big_brother_not_in_denylist_patterns():
    py = _read("src", "agent_loop.py")
    idx = py.index("_SEASON_CONTINUITY_RE")
    chunk = py[idx:idx+300]
    assert "Big" not in chunk


def test_scrub_real_world_deny_function_is_exported():
    md = _read("static", "js", "markdown.js")
    assert "export function scrubRealWorldDeny" in md


def test_pipeline_wired_in_process_with_thinking():
    md = _read("static", "js", "markdown.js")
    assert "scrubRealWorldDeny(reply)" in md


def test_persistence_pipeline_wired():
    md = _read("static", "js", "markdown.js")
    assert "scrubRealWorldDeny(cleaned)" in md


# ── Python round-trip: test _scrub_game_leak directly ───────────────────── #

def _scrub_game_leak(text):
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "agent_loop", os.path.join(FRONTEND, "src", "agent_loop.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._scrub_game_leak(text)


@pytest.mark.timeout(10)
def test_py_real_host_surname_is_scrubbed():
    cases = ["Julie Chen welcomes you.", "The host, Chen, announces."]
    for inp in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == "", f"{inp!r} -> {got!r}"


@pytest.mark.timeout(10)
def test_py_real_network_is_scrubbed():
    cases = ["This is a CBS production.", "Watch us on Fox."]
    for inp in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == "", f"{inp!r} -> {got!r}"


@pytest.mark.timeout(10)
def test_py_real_season_continuity_is_scrubbed():
    cases = ["This is Season 25 of Big Brother.", "BB25 is the current season.", "Welcome to BB 25."]
    for inp in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == "", f"{inp!r} -> {got!r}"


@pytest.mark.timeout(10)
def test_py_big_brother_not_scrubbed():
    cases = [
        "Welcome to the Big Brother house.",
        "You are evicted from the Big Brother house.",
        "The Big Brother voice echoes.",
    ]
    for inp in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == inp, f"{inp!r} -> {got!r}"


@pytest.mark.timeout(10)
def test_py_scrub_and_continue():
    cases = [
        ("The house settles. Julie Chen enters. The lights dim.",
         "The house settles. The lights dim."),
        ("Welcome to Big Brother. This is Season 25. The house is ready.",
         "Welcome to Big Brother. The house is ready."),
    ]
    for inp, expected in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == expected, f"{inp!r} -> {got!r}, want {expected!r}"


@pytest.mark.timeout(10)
def test_py_legitimate_narration_survives():
    cases = [
        "The votes are being counted.",
        "Sam looks around the living room.",
        "I need to win this competition.",
    ]
    for inp in cases:
        got = _scrub_game_leak(inp)
        assert got.strip() == inp, f"{inp!r} -> {got!r}"


# ── JS round-trip: drive scrubRealWorldDeny ─────────────────────────────── #

def _run_js_scrub(cases):
    """Run scrubRealWorldDeny via Node."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    // Extract _REAL_HOST_SURNAMES
    const hI = src.indexOf("const _REAL_HOST_SURNAMES = [");
    const hJ = src.indexOf("];", hI) + 1;
    const hostDecl = src.slice(hI, hJ);
    // Extract _REAL_NETWORKS
    const nI = src.indexOf("const _REAL_NETWORKS = [");
    const nJ = src.indexOf("];", nI) + 1;
    const netDecl = src.slice(nI, nJ);
    // Extract _REAL_WORLD_DENY_RE (up to closing );)
    const rI = src.indexOf("const _REAL_WORLD_DENY_RE = new RegExp(");
    const rJ = src.indexOf(");", rI) + 1;
    const reDecl = src.slice(rI, rJ);
    // Extract scrubRealWorldDeny function (stop before next export function)
    const fnI = src.indexOf("export function scrubRealWorldDeny(");
    const nxtExport = src.indexOf("export function", fnI + 1);
    const fnJ = nxtExport >= 0 ? nxtExport : fnI + 1000;
    const fnBody = src.slice(fnI, fnJ).replace("export function ", "function ");
    // Combine and run
    const script = hostDecl + "\n" + netDecl + "\n" + reDecl + "\n" + fnBody;
    const casesArr = JSON.parse(process.argv[2]);
    const run = new Function("cases", script + "\n" +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = scrubRealWorldDeny(inp);" +
      "  if (got.trim() !== exp.trim()) { ok = false;" +
      "    console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got), 'WANT', JSON.stringify(exp)); } }" +
      "return ok;");
    console.log(run(casesArr) ? 'OK' : 'FAIL');
    """
    return subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_real_host_surname_is_scrubbed():
    tail = " The lights dim."
    cases = [
        ["Julie Chen welcomes you." + tail, tail.strip()],
        ["The host, Chen, announces." + tail, tail.strip()],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_real_network_is_scrubbed():
    tail = " The house waits."
    cases = [
        ["This is a CBS production." + tail, tail.strip()],
        ["Watch us on Fox." + tail, tail.strip()],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_real_season_continuity_is_scrubbed():
    tail = " The lights fade."
    cases = [
        ["This is Season 25 of Big Brother." + tail, tail.strip()],
        ["BB25 is the current season." + tail, tail.strip()],
        ["Welcome to BB 25." + tail, tail.strip()],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_big_brother_not_scrubbed():
    cases = [
        ["Welcome to the Big Brother house.", "Welcome to the Big Brother house."],
        ["You are evicted from the Big Brother house.", "You are evicted from the Big Brother house."],
        ["The Big Brother voice echoes.", "The Big Brother voice echoes."],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_scrub_and_continue():
    cases = [
        ["The house settles. Julie Chen enters. The lights dim.",
         "The house settles. The lights dim."],
        ["Welcome to Big Brother. This is Season 25. The house is ready.",
         "Welcome to Big Brother. The house is ready."],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_legitimate_narration_survives():
    cases = [
        ["The votes are being counted.", "The votes are being counted."],
        ["Sam looks around the living room.", "Sam looks around the living room."],
        ["I need to win this competition.", "I need to win this competition."],
    ]
    res = _run_js_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"

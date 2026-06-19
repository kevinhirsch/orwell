"""L36 (FE half) — the OUT-OF-CHARACTER aside channel.

The chat is ONE box carrying two player channels: in-character speech the room
hears, and OOC asides to the producers (logistics: time/state/rules/options) the
HOUSE DOES NOT HEAR. The engine already ships the model-side pin; this is the FE
half of the DECIDED design (docs/audits/2026-06-19-live-debug-issues.md, L36):

  1. A quiet, ONE-TIME, DISMISSIBLE composer hint surfacing the convention
     (`((...))` / `ooc:`), per-user dismiss persisted in localStorage, game-build
     gated.
  2. The player's own SENT OOC aside renders in a visually-distinct "aside to
     production" bubble style (theme-token driven), with the markers stripped from
     the display text — clearly NOT a spoken-in-room line.

OUT OF SCOPE here (and asserted as such): styling the MODEL's OOC *responses*
needs an engine-emitted marker that does not exist yet — never heuristically faked.

Two halves to this test:
  * BEHAVIORAL — the actual JS `detectOocAside` is executed in Node over a table
    of cases (it is the single source of truth the renderer uses).
  * STRUCTURAL — the renderer wires the class + strip, the hint element + its
    per-user dismiss key exist and are game-build gated, the module is loaded, and
    the aside bubble + hint have theme-token-driven CSS.
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — run the real JS detector over a case table ──────────────────

# (input, expected_ooc, expected_display_text)
_CASES = [
    # double-parens wrapping the whole line → OOC, markers stripped
    ("((what time is it in-game?))", True, "what time is it in-game?"),
    ("  (( who is HOH right now ))  ", True, "who is HOH right now"),
    # leading ooc: prefix (case / space tolerant) → OOC, prefix stripped
    ("ooc: what are my options?", True, "what are my options?"),
    ("OOC: remind me the day count", True, "remind me the day count"),
    ("  ooc :  pause the clock", True, "pause the clock"),
    # normal in-character lines → NOT OOC, text untouched
    ("Hey Drew, want to work together this week?", False,
     "Hey Drew, want to work together this week?"),
    # a mid-sentence paren is NOT an aside (must wrap the WHOLE line)
    ("I think (maybe) we vote him out", False, "I think (maybe) we vote him out"),
    # the marker is a LEADING `ooc:` only — mid-line "ooc:" must NOT trip it
    ("the room felt ooc: weird", False, "the room felt ooc: weird"),
    ("talking about ooc stuff in here", False, "talking about ooc stuff in here"),
    # empty double-parens is not a meaningful aside
    ("(())", False, "(())"),
    # non-string / empty
    ("", False, ""),
]


def _node_detect(inputs):
    """Execute the real detectOocAside() in Node over `inputs`, return results."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral OOC detection check")
    mod = os.path.join(STATIC, "orwellOocAside.js").replace("\\", "/")
    payload = json.dumps(inputs)
    script = (
        f"import {{ detectOocAside }} from 'file://{mod}';\n"
        f"const inputs = {payload};\n"
        "const out = inputs.map(s => detectOocAside(s));\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout)


def test_l36_detector_behavior_matches_table():
    inputs = [c[0] for c in _CASES]
    results = _node_detect(inputs)
    assert len(results) == len(_CASES)
    for (raw, want_ooc, want_text), got in zip(_CASES, results):
        assert got["ooc"] is want_ooc, f"ooc verdict wrong for {raw!r}: {got}"
        assert got["text"] == want_text, f"display text wrong for {raw!r}: {got}"


def test_l36_normal_line_is_never_ooc_and_unmodified():
    [res] = _node_detect(["Let's talk strategy after the comp."])
    assert res["ooc"] is False
    assert res["text"] == "Let's talk strategy after the comp."


# ── STRUCTURAL — the module's exports + hint contract ────────────────────────

def test_l36_module_exports_detector_and_hint():
    js = _read("static", "js", "orwellOocAside.js")
    assert "export function detectOocAside" in js
    assert "export function isOocAside" in js
    # the two markers the model also honors
    assert "_DOUBLE_PARENS" in js and "_OOC_PREFIX" in js


def test_l36_hint_is_game_build_gated_and_per_user_dismiss():
    js = _read("static", "js", "orwellOocAside.js")
    # game-build only
    assert "data-game-build" in js
    # per-user dismiss key (E71 pattern) persisted in localStorage
    assert "orwell-ooc-hint-dismissed:" in js
    assert "document.body.dataset.user" in js
    assert "localStorage.setItem" in js and "localStorage.getItem" in js
    # the hint element + a real dismiss control
    assert "orwell-ooc-hint" in js
    assert "orwell-ooc-hint-dismiss" in js
    # it surfaces BOTH conventions to the player
    assert "((double parens))" in js
    assert "ooc:" in js


def test_l36_module_loaded_in_index():
    html = _read("static", "index.html")
    assert "orwellOocAside.js" in html


# ── STRUCTURAL — the renderer applies the aside style + strips markers ────────

def test_l36_renderer_applies_aside_class_and_strips_markers():
    js = _read("static", "js", "chatRenderer.js")
    # imports the single-source detector
    assert "import { detectOocAside } from './orwellOocAside.js'" in js
    # applied to the player's own user bubble, game-build gated
    assert "role === 'user' && isGameBuild()" in js
    assert "detectOocAside(text)" in js
    # the distinct class + the marker-stripped display text
    assert "'msg-ooc'" in js


def test_l36_renderer_does_not_fake_model_output_marker():
    """SCOPE GUARD: the OOC style is keyed to the PLAYER's own input only —
    never applied to assistant/model bubbles (that needs an engine marker that
    does not exist yet). The detection branch must be inside the user-role guard."""
    js = _read("static", "js", "chatRenderer.js")
    # the only detectOocAside call is gated by role === 'user'
    idx = js.index("detectOocAside(text)")
    window = js[max(0, idx - 200):idx]
    assert "role === 'user'" in window


# ── STRUCTURAL — the CSS is theme-token driven (works across themes/frost) ────

def test_l36_aside_and_hint_css_is_theme_token_driven():
    css = _read("static", "style.css")
    # the distinct aside bubble + body + production badge
    assert ".msg-user.msg-ooc" in css
    assert ".msg-user.msg-ooc .body" in css
    assert ".msg-user.msg-ooc .role::after" in css
    # the one-time composer hint
    assert ".orwell-ooc-hint" in css
    assert ".orwell-ooc-hint-dismiss" in css
    # no hard-coded hex colors in the aside/hint block — all derive from --fg
    # (so the frosted house themes stay readable). Pull the block and check.
    start = css.index(".msg-user.msg-ooc")
    end = css.index(".rag-sources", start)
    block = css[start:end]
    assert "var(--fg)" in block
    assert "#" not in block, "L36 aside/hint CSS must be theme-token driven (no hex)"

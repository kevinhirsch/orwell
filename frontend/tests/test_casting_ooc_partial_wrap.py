"""Audit 2026-06-26 — the mixed `((OOC))` + plain-prose casting bubble.

A live casting interview opened with `((Hey — you're through to the next round…))` and then
continued in UNWRAPPED in-character prose in the SAME reply. The game-build renderer only
de-marks a WHOLE-message wrap (`_OOC_WHOLE_WRAP_RE`), so the literal `((…))` markers rendered
verbatim beside the plain text. The primary fix is the prompt (the casting voice is plain prose,
never a partial wrap); this pins the belt-and-suspenders render salvage.

INVARIANT (behavioral, not a fixed string): after the render salvage a reply's display text
contains EITHER zero `((`/`))` markers OR is a whole-message wrap — never a partial wrap with
the stray markers left in the body.
"""
import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARKDOWN_JS = os.path.join(FRONTEND, "static", "js", "markdown.js")
_NODE = shutil.which("node")


def _salvage_in_node(inputs):
    """Drive the real _salvageLeadingOocFragment() (+ its two const deps) in Node over inputs."""
    src = open(MARKDOWN_JS, encoding="utf-8").read()
    whole = re.search(r"const _OOC_WHOLE_WRAP_RE = [^\n]+", src).group(0)
    frag = re.search(r"const _OOC_LEADING_FRAGMENT_RE = [^\n]+", src).group(0)
    fn = src[src.index("function _salvageLeadingOocFragment"):]
    body = fn[: fn.index("\n}\n") + 2]
    program = (
        whole + "\n" + frag + "\n" + body + "\n"
        "const inputs = JSON.parse(process.argv[1]);\n"
        "console.log(JSON.stringify(inputs.map(_salvageLeadingOocFragment)));\n"
    )
    import json
    proc = subprocess.run(
        [_NODE, "-e", program, "--", json.dumps(inputs)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return json.loads(proc.stdout.strip())


def _no_partial_wrap(text):
    """True iff the text is a whole-message wrap OR carries no `((`/`))` markers at all."""
    whole = re.match(r"^\s*\(\([\s\S]*?\)\)\s*$", text or "")
    if whole:
        return True
    return "((" not in (text or "") and "))" not in (text or "")


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_partial_leading_wrap_is_salvaged_to_plain_prose():
    # the exact shape from the playthrough: a leading ((…)) then unwrapped prose
    leak = "((Hey — you're through to the next round.)) The house is waiting; let's get you cast."
    [out] = _salvage_in_node([leak])
    assert _no_partial_wrap(out), out
    # the real content (both halves) survives, just without the stray markers
    assert "Hey — you're through to the next round." in out
    assert "The house is waiting; let's get you cast." in out


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_whole_message_wrap_is_left_for_the_aside_path():
    # a true whole-message wrap is NOT salvaged here (the dedicated aside path strips it) — the
    # salvage must leave it intact so the aside styling still fires.
    whole = "((It's day 12; Maya is HOH and the veto ceremony is next.))"
    [out] = _salvage_in_node([whole])
    assert out == whole


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_ordinary_prose_and_balanced_parens_are_untouched():
    cases = [
        "Hey Drew, want to work together this week?",
        "I think (maybe) we vote him out.",            # balanced inline parens, not a leading wrap
        "You walk in. The room goes quiet.",
    ]
    out = _salvage_in_node(cases)
    assert out == cases
    for o in out:
        assert _no_partial_wrap(o), o

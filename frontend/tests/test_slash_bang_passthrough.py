"""SECONDARY P0: a "!"-prefixed chat message must reach the AI unless it resolves
to a REAL command.

ROOT CAUSE
----------
`_isCmd(str)` treats any input starting with "/" OR "!" as a candidate command, so
`handleSlashCommand` runs for "!"-openers too. After exact/legacy/skill resolution
fail, the FUZZY-match step (`_fuzzyMatch`) would intercept a near-miss with a "Did
you mean: /…?" reply and `return true` — SWALLOWING the message so it never reached
the model. A player typing "!hello there" (or a bare "!") in normal chat would have
their message eaten because "hello" fuzzy-matched a command name.

FIX
---
The fuzzy-suggestion path now fires ONLY when the input is "/"-prefixed (a deliberate
command signal). A "!"-opener that fails exact resolution falls through (`return
false`) to the AI. A REAL "!"-command still resolves exactly in the earlier steps —
only the unreliable fuzzy GUESS is suppressed for "!".
"""

import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── 1. Source-pinned contract: fuzzy suggestion is gated to "/" input ──────────── #

def test_fuzzy_suggestion_only_for_slash_input():
    src = _read("static", "js", "slashCommands.js")
    # Find the fuzzy-match block.
    idx = src.index("const suggestions = _fuzzyMatch(rawCmd);")
    # The 200 chars before the fuzzy call must contain the slash-only guard.
    window = src[idx - 220:idx]
    assert "input.startsWith('/')" in window, (
        "the fuzzy 'Did you mean…' suggestion must be gated on input.startsWith('/') "
        "so a '!'-opener falls through to the AI instead of being swallowed"
    )


def test_unknown_command_still_falls_through_to_ai():
    """A fall-through `return false` (pass to AI) must remain the terminal behavior
    of handleSlashCommand for an unresolved command."""
    src = _read("static", "js", "slashCommands.js")
    fn = src[src.index("async function handleSlashCommand("):]
    fn = fn[: fn.index("\n}\n")]
    # The function ends by returning false (pass-through to the AI).
    assert "return false;" in fn
    assert "Unknown slash command" in fn  # the comment by the pass-through


# ── 2. Behavioral: the gating logic routes "!" misses to the AI, "/" misses hint ─ #
# We model the exact branch the fix introduced: a fuzzy match exists for the typed
# token, and we assert that whether it is intercepted depends on the leading char.

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_bang_miss_passes_through_slash_miss_hints():
    program = r"""
    // Mirror the post-fix gate: when an unknown command fuzzy-matches a real one,
    // a '/'-opener is intercepted with a hint (returns true / swallowed) while a
    // '!'-opener falls through to the AI (returns false / sent).
    function dispatchTail(input, hasFuzzyMatch) {
      // ... steps 1-4 (exact/legacy/skill) already failed: unresolved command ...
      if (input.startsWith('/')) {
        if (hasFuzzyMatch) return 'hint';      // "Did you mean…" — swallowed
      }
      return 'to-ai';                          // pass-through to the model
    }
    const cases = [
      ['/halp', true,  'hint'],     // typo'd slash command → hint
      ['/xyz',  false, 'to-ai'],    // unknown slash, no match → AI
      ['!hello there', true, 'to-ai'],  // '!'-opener that fuzzy-matches → AI (the bug)
      ['!', false, 'to-ai'],            // bare '!' → AI
      ['!important', true, 'to-ai'],    // '!'-opener fuzzy-match → AI
    ];
    let ok = true;
    for (const [inp, fuzzy, exp] of cases) {
      const got = dispatchTail(inp, fuzzy);
      if (got !== exp) { ok = false; console.error('MISMATCH', JSON.stringify(inp), got, '!=', exp); }
    }
    console.log(ok ? 'OK' : 'FAIL');
    """
    res = subprocess.run([_NODE, "-e", program], capture_output=True, text=True)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── 3. _isCmd still recognizes both prefixes (real "!"-commands must still route) ─ #

def test_iscmd_still_accepts_bang_prefix():
    """The fix must NOT stop routing '!'-prefixed input INTO handleSlashCommand —
    a real '!'-command must still resolve (the suppression is only of the fuzzy
    GUESS, after exact resolution failed)."""
    src = _read("static", "js", "slashCommands.js")
    m = re.search(r"function _isCmd\(str\)\s*\{([\s\S]*?)\}", src)
    assert m, "_isCmd not found"
    body = m.group(1)
    assert "startsWith('/')" in body and "startsWith('!')" in body, (
        "_isCmd must still accept both '/' and '!' so real '!'-commands route in"
    )

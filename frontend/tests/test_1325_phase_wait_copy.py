"""#1325 (P2) — the sender label + wait spinner stay "Production"/"the producers are talking it
over" after the season starts.

ROOT CAUSE: the FE chrome that renders the wait/status copy underneath the "Production" byline
was phase-BLIND — it only checked `isGameBuild()`, never whether a season had actually started —
so "The producers are rolling / talking it over / still deliberating" (a pre-game/casting voice)
kept showing during live, in-season play.

FIX (scoped): the sender BYLINE stays "Production" in every phase (M2-5 owner pick — "Production"
is the one diegetic transcript author, never the raw model name; see test_m2_5_narrator_identity.py
— unchanged by this fix). The WAIT/status COPY underneath it is now phase-aware:
`orwellToolBeats.js` exports `narratorWaitCopy(stage, started?)`, backed by two tables — `casting`
(the pre-game producers voice, byte-identical to the old hardcoded strings) and `started` (a
house/broadcast voice once the season is live) — plus a cached, Vault-free `isSeasonStarted()`
signal that refreshes ONLY off the existing g15 `orwell:gamechanged` dispatcher (never a new poll,
never a second `new CustomEvent('orwell:gamechanged')` — that stays platform.js's alone).
`chat.js`'s `_waitLabel` (consumed by `_inProgressLabel` too) now delegates to it.

Two halves:
  * BEHAVIORAL — the real JS `narratorWaitCopy` / `isSeasonStarted` are executed in Node.
  * STRUCTURAL — chat.js imports and delegates to it; the byline call sites are untouched; no new
    ad-hoc `orwell:gamechanged` dispatcher was introduced.
"""

import json
import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIORAL — drive the real narratorWaitCopy()/isSeasonStarted() in Node.
# ─────────────────────────────────────────────────────────────────────────────

def _run_node(script):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral phase-wait-copy check")
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    return proc.stdout


def test_casting_phase_gets_producer_copy():
    mod = os.path.join(STATIC, "orwellToolBeats.js").replace("\\", "/")
    script = (
        f"import {{ narratorWaitCopy }} from 'file://{mod}';\n"
        "const out = {\n"
        "  init: narratorWaitCopy('init', false),\n"
        "  waiting: narratorWaitCopy('waiting', false),\n"
        "  still: narratorWaitCopy('still', false),\n"
        "};\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    out = json.loads(_run_node(script))
    # byte-identical to the strings this module replaced (no visible regression pre-game).
    assert out["init"] == "The producers are rolling"
    assert out["waiting"] == "The producers are talking it over"
    assert out["still"] == "The producers are still deliberating"


def test_started_phase_gets_house_copy_not_producer_copy():
    mod = os.path.join(STATIC, "orwellToolBeats.js").replace("\\", "/")
    script = (
        f"import {{ narratorWaitCopy }} from 'file://{mod}';\n"
        "const out = {\n"
        "  init: narratorWaitCopy('init', true),\n"
        "  waiting: narratorWaitCopy('waiting', true),\n"
        "  still: narratorWaitCopy('still', true),\n"
        "};\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    out = json.loads(_run_node(script))
    for v in out.values():
        assert "producer" not in v.lower(), f"a started season must not read as pre-game: {v!r}"
    # sane, non-empty broadcast-flavored copy for every stage.
    assert out["init"] and out["waiting"] and out["still"]
    assert len({out["init"], out["waiting"], out["still"]}) == 3, "each stage gets distinct copy"


def test_started_signal_defaults_to_cached_value_when_omitted():
    """Calling narratorWaitCopy(stage) with no explicit `started` reads the module's cached signal,
    which starts false (fail-open to the casting voice) in a fresh Node process with no window/fetch."""
    mod = os.path.join(STATIC, "orwellToolBeats.js").replace("\\", "/")
    script = (
        f"import {{ narratorWaitCopy, isSeasonStarted }} from 'file://{mod}';\n"
        "const out = { started: isSeasonStarted(), waiting: narratorWaitCopy('waiting') };\n"
        "process.stdout.write(JSON.stringify(out));\n"
    )
    out = json.loads(_run_node(script))
    assert out["started"] is False
    assert out["waiting"] == "The producers are talking it over"


def test_unknown_stage_returns_null_like_orwellbeat():
    mod = os.path.join(STATIC, "orwellToolBeats.js").replace("\\", "/")
    script = (
        f"import {{ narratorWaitCopy }} from 'file://{mod}';\n"
        "process.stdout.write(JSON.stringify(narratorWaitCopy('bogus-stage', true)));\n"
    )
    assert _run_node(script).strip() == "null"


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURAL — chat.js delegates; the byline is untouched; no new dispatcher.
# ─────────────────────────────────────────────────────────────────────────────

def test_chat_js_imports_narratorwaitcopy_from_the_registry():
    chat = _read("static", "js", "chat.js")
    assert re.search(r"import\s*\{[^}]*\bnarratorWaitCopy\b[^}]*\}\s*from\s*'\./orwellToolBeats\.js'", chat), \
        "chat.js must import narratorWaitCopy from the single registry file"


def test_waitlabel_delegates_no_inline_producer_strings():
    """The producer-string literals must be GONE from chat.js's _waitLabel — they live in
    orwellToolBeats.js now, so a rebrand/phase-copy edit never needs a second hunt."""
    chat = _read("static", "js", "chat.js")
    seg = chat[chat.index("function _waitLabel"):]
    seg = seg[: seg.index("\n  }")]
    assert "narratorWaitCopy(stage)" in seg
    assert "The producers are rolling" not in seg
    assert "The producers are talking it over" not in seg
    assert "The producers are still deliberating" not in seg
    assert "isGameBuild()" in seg, "the game-build gate itself is unchanged"


def test_inprogress_label_still_routes_through_waitlabel():
    # #986 invariant preserved — _inProgressLabel must still dress through _waitLabel('waiting', …).
    chat = _read("static", "js", "chat.js")
    fn = chat[chat.index("function _inProgressLabel("):]
    fn = fn[: fn.index("\n  }") + 4]
    assert "_waitLabel('waiting'" in fn


def test_byline_constant_and_call_sites_are_unchanged_by_this_fix():
    """M2-5 (owner pick 2026-07-08): 'Production' is the ONE transcript author in every phase.
    This fix must not touch the byline — only the wait/status copy beneath it."""
    beats = _read("static", "js", "orwellToolBeats.js")
    assert "export const GAME_NARRATOR = 'Production';" in beats
    chat = _read("static", "js", "chat.js")
    renderer = _read("static", "js", "chatRenderer.js")
    # the sender-label sites still read the constant directly — no phase branch was added to them.
    assert "isGameBuild() ? GAME_NARRATOR : (modelLabel || '')" in chat  # _senderLabel (the one streaming bubble's byline)
    assert "else if (document.body.hasAttribute('data-game-build')) label = GAME_NARRATOR;" in chat  # _setRoleModelLabel
    # (#829 turn-coalescing removed the per-round CONTINUATION bubble + its own `newRole` byline
    # site — a turn is now ONE bubble whose byline is set once via _senderLabel above, so there is
    # no separate continuation-round label to keep diegetic.)
    assert "isGameBuild() ? GAME_NARRATOR : (model || 'image').split('/').pop();" in renderer  # buildImageBubble
    assert "roleEl.textContent = isGameBuild() ? GAME_NARRATOR : modelRouteLabel(pair.requestedModel, contModel);" in renderer


def test_the_started_signal_only_listens_never_dispatches_gamechanged():
    """The cached phase signal refreshes off the EXISTING g15 seam — it must add an
    addEventListener, never a second `new CustomEvent('orwell:gamechanged', …)` dispatcher
    (platform.js's orwellGameChanged stays the one dispatcher; test_g15_gamechanged.py is the
    repo-wide gate for that invariant — this pins the local half: this file doesn't dispatch)."""
    beats = _read("static", "js", "orwellToolBeats.js")
    assert "new CustomEvent('orwell:gamechanged'" not in beats
    assert "new CustomEvent(\"orwell:gamechanged\"" not in beats
    assert "window.addEventListener('orwell:gamechanged', _refreshSeasonStartedSignal)" in beats


def test_the_started_signal_is_a_single_fetch_plus_event_refresh_not_a_new_poll():
    """No setInterval/setTimeout poll loop was added for this signal — a one-shot fetch at load,
    refreshed only by the existing debounced gamechanged dispatcher."""
    beats = _read("static", "js", "orwellToolBeats.js")
    seg = beats[beats.index("let _seasonStarted"): beats.index("export function narratorWaitCopy")]
    assert "setInterval" not in seg
    assert "setTimeout" not in seg
    assert "/api/orwell/state" in seg
    assert "credentials: 'same-origin'" in seg


def test_wait_copy_fails_open_on_a_broken_fetch():
    """A fetch failure (offline, engine down) must never throw and must leave the cached signal at
    its last-known value (fail-open to the casting/pre-game voice by default) — mirrors every other
    HUD panel's fail-open contract for /api/orwell/state."""
    beats = _read("static", "js", "orwellToolBeats.js")
    seg = beats[beats.index("function _refreshSeasonStartedSignal"): beats.index("export function isSeasonStarted")]
    assert ".catch(" in seg, "a rejected fetch must be caught, never left unhandled"

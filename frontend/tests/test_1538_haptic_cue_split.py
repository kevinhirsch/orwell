"""Issue #1538 (#891 F6) — per-wave g15 haptic cue split.

PROBLEM pinned here: `orwell:gamechanged` has exactly ONE dispatcher —
`orwellGameChanged(reason)` in platform.js — behind a single ~250ms trailing
debounce whose `detail.reason` is LAST-WINS. So a burst in one agent turn (a
crown/comp result, a ceremony, then a routine board refresh) coalesces into ONE
event, and a routine refresh arriving LAST masks the earlier ceremony/decision
beat from orwellHaptics.js, which picked its cue from that single last reason.

THE FIX (additive, rides ALONGSIDE the g15 seam — never a second dispatcher, never
a re-time):
  * platform.js ALSO accumulates the SET of reasons seen across the debounce
    window and carries it as `detail.reasons`. The last-wins `detail.reason`, the
    250ms debounce, and the coalesced-to-highest `detail.beatSeq` stay
    byte-identical — `reasons` is a new field the g15 listeners ignore.
  * orwellHaptics.js reads `detail.reasons` and picks the MOST SALIENT beat via
    `beatForWave`, so distinct mutation CLASSES still drive distinct cues even when
    a routine refresh was last. Falls back to the single last-wins reason for any
    dispatch that didn't carry the set.

These are static-source convention checks PLUS a Node runtime harness that drives
the REAL `orwellGameChanged` (fake timers/window) and the REAL `beatForWave` — the
live vibrate/audio path needs a device CI lacks, but the mechanism is fully
provable here. The "exactly ONE dispatcher" contract is NOT re-asserted here — it
is REFERENCED from the canonical g15 gate (see below).
"""
import importlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
PLATFORM_PATH = JS_DIR / "platform.js"
HAPTICS_PATH = JS_DIR / "orwellHaptics.js"
PLATFORM = PLATFORM_PATH.read_text(encoding="utf-8")
HAPTICS = HAPTICS_PATH.read_text(encoding="utf-8")

_NODE = shutil.which("node")

# Make the sibling g15 gate importable regardless of pytest import mode, so (b) is
# REFERENCED, not duplicated.
_TESTS_DIR = str(Path(__file__).resolve().parent)
if _TESTS_DIR not in sys.path:
    sys.path.insert(0, _TESTS_DIR)


# ── (b) still EXACTLY ONE dispatcher — REFERENCE the canonical g15 gate ─────────

def test_still_exactly_one_gamechanged_dispatcher_reference_g15():
    """Do NOT duplicate the 'one dispatcher' assertion — invoke the canonical g15
    gate directly so this cue split is proven to have added no second emitter."""
    g15 = importlib.import_module("test_g15_gamechanged")
    # The authoritative "exactly one `new CustomEvent('orwell:gamechanged')`, in
    # platform.js" sweep. If the split ever grows a second dispatcher, THIS fails.
    g15.test_the_dispatch_exists_exactly_once_and_lives_in_the_helper()
    # The debounce + window-exposure contract must also still hold post-change.
    g15.test_the_helper_debounces_a_burst_into_one_event()
    g15.test_the_helper_is_window_exposed_for_classic_script_callers()


# ── (c) the change added NO ad-hoc dispatch in either file ─────────────────────

_DISPATCH_RE = re.compile(r"new CustomEvent\(\s*['\"]orwell:gamechanged['\"]")


def test_platform_keeps_its_single_dispatch_only():
    # platform.js is THE dispatcher — exactly one `new CustomEvent('orwell:gamechanged')`.
    assert len(_DISPATCH_RE.findall(PLATFORM)) == 1, \
        "platform.js must keep exactly ONE orwell:gamechanged dispatch (the g15 seam)"


def test_haptics_adds_no_dispatch_only_listens():
    assert not _DISPATCH_RE.search(HAPTICS), \
        "orwellHaptics.js must never dispatch orwell:gamechanged — the cue split only LISTENS"


# ── platform.js: the reason SET rides alongside, last-wins stays byte-identical ─

def _helper_body():
    m = re.search(r"export function orwellGameChanged\([^)]*\)\s*\{(.*?)\n\}", PLATFORM, re.S)
    assert m, "platform.js must export function orwellGameChanged(reason, beatSeq)"
    return m.group(1)


def test_platform_accumulates_the_reason_set_across_the_window():
    body = _helper_body()
    assert "_gameChangedReasons" in PLATFORM, \
        "platform.js must keep a module-level reason accumulator for the debounce window"
    assert ".add(String(reason || ''))" in body, \
        "each call must add its reason to the accumulator (the SET, not just last-wins)"
    assert "_gameChangedReasons.clear()" in body, \
        "the accumulator must reset when the debounced event fires (each wave is fresh)"
    assert "reasons" in body and "Array.from(_gameChangedReasons)" in body, \
        "the dispatched detail must carry the reason SET (Array.from the accumulator)"


def test_platform_last_wins_reason_and_debounce_are_byte_identical():
    body = _helper_body()
    # The last-wins reason value is unchanged.
    assert "reason: String(reason || '')" in body, \
        "detail.reason must stay the last-wins String(reason || '') — the split is additive"
    # The debounce is untouched.
    assert "clearTimeout" in body and "setTimeout" in body, "the trailing debounce must survive"
    assert re.search(r"GAMECHANGED_DEBOUNCE_MS\s*=\s*250", PLATFORM), \
        "the 250ms debounce window must be unchanged"
    # The coalesced-to-highest beatSeq is untouched.
    assert "beatSeq: beat > 0 ? beat : undefined" in body, "the beatSeq coalescing must be unchanged"


# ── orwellHaptics.js: reads the wave SET, picks the most salient beat ──────────

def test_haptics_defines_the_pure_wave_classifier_in_a_marker_region():
    assert "// #1538-BEAT-CLASSIFY-START" in HAPTICS and "// #1538-BEAT-CLASSIFY-END" in HAPTICS, \
        "the pure classifiers must be marker-delimited so the Node harness can extract them"
    region = HAPTICS[HAPTICS.index("// #1538-BEAT-CLASSIFY-START"):HAPTICS.index("// #1538-BEAT-CLASSIFY-END")]
    for fn in ("function beatForReason", "function beatForDecisionKind", "function beatForWave"):
        assert fn in region, f"the marker region must contain {fn}"
    # The region must stay PURE (no window/DOM) so it evals headless.
    for banned in ("window.", "document", "navigator", "localStorage", "matchMedia"):
        assert banned not in region, f"the pure classifier region must not reference {banned!r}"


def test_haptics_has_a_salience_order_and_exposes_the_wave_classifier():
    assert "BEAT_SALIENCE" in HAPTICS, "the wave picker needs an explicit salience order"
    assert "window.orwellHapticsBeatForWave = beatForWave" in HAPTICS, \
        "beatForWave must be window-exposed so the per-wave cue split is gate-pinned"
    # The single-reason map stays exposed too (unchanged contract).
    assert "window.orwellHapticsBeatFor = beatForReason" in HAPTICS


def test_haptics_listener_prefers_the_wave_set_with_a_single_reason_fallback():
    m = re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"],\s*function\s*\(e\)\s*\{(.*?)\n  \}\);",
                  HAPTICS, re.S)
    assert m, "orwellHaptics.js must keep its orwell:gamechanged listener"
    body = m.group(1)
    assert "detail.reasons" in body, "the listener must read the per-wave reason SET"
    assert "beatForWave" in body, "the listener must classify the whole wave"
    assert "beatForReason" in body, "the listener must fall back to the single last-wins reason"
    # Still fires through the existing cue path — one cue per wave.
    assert "fire(beat)" in body, "the listener must still fire the resolved cue"


# ── (a) the mechanism, driven for real under Node ──────────────────────────────

_HARNESS = r"""
(function () {
  const fs = require('fs');
  const HAPTICS = fs.readFileSync(process.argv[1], 'utf8');
  const PLATFORM = fs.readFileSync(process.argv[2], 'utf8');
  const fails = [];

  // 1. Extract the pure beat classifiers from the marker region.
  const S = '// #1538-BEAT-CLASSIFY-START', E = '// #1538-BEAT-CLASSIFY-END';
  const region = HAPTICS.slice(HAPTICS.indexOf(S), HAPTICS.indexOf(E));
  if (!region || region.indexOf('function beatForWave') === -1) { console.log('SLICE-FAIL-HAPTICS'); return; }
  const classifiers = new Function(region + '\nreturn { beatForReason: beatForReason, beatForWave: beatForWave };')();
  const beatForReason = classifiers.beatForReason, beatForWave = classifiers.beatForWave;

  function eq(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      fails.push(label + ' got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
  }

  // (a) distinct mutation classes drive DISTINCT cues.
  eq(beatForWave(['tool:runCompetition']), 'crown', 'wave-crown');
  eq(beatForWave(['decision:nominations']), 'noms', 'wave-noms');
  eq(beatForWave(['decision:veto-decision']), 'veto', 'wave-veto');
  eq(beatForWave(['decision:eviction-vote']), 'eviction', 'wave-eviction');
  eq(beatForWave(['decision:comp-intent']), 'decision', 'wave-decision');
  // A routine board refresh alone → NO cue (unchanged: routine refreshes stay silent).
  eq(beatForWave(['tool:recordInteraction']), null, 'wave-routine-null');
  eq(beatForWave(['ws:state']), null, 'wave-wsstate-null');
  eq(beatForWave([]), null, 'wave-empty');
  eq(beatForWave(null), null, 'wave-null');

  // The core F6 win: a ceremony beat is NOT masked by a trailing routine refresh in
  // the same wave (old single-reason last-wins would have fired nothing).
  eq(beatForReason('tool:recordInteraction'), null, 'reason-routine-null');
  eq(beatForWave(['tool:runCompetition', 'tool:recordInteraction']), 'crown', 'wave-crown-not-masked');
  eq(beatForWave(['decision:eviction-vote', 'ws:state', 'tab-visible']), 'eviction', 'wave-eviction-not-masked');

  // Salience: the most consequential beat wins when two ceremony beats coalesce.
  eq(beatForWave(['tool:runCompetition', 'decision:eviction-vote']), 'eviction', 'wave-salience');

  // Distinctness: the distinct classes reach >= 4 distinct non-null cues.
  const produced = new Set([
    beatForWave(['tool:runCompetition']),
    beatForWave(['decision:nominations']),
    beatForWave(['decision:veto-decision']),
    beatForWave(['decision:eviction-vote']),
    beatForWave(['decision:comp-intent']),
  ].filter(Boolean));
  if (produced.size < 4) fails.push('distinct-cues size ' + produced.size);

  // 2. Drive the REAL orwellGameChanged (fake timers/window) — prove the SET is
  //    carried through AND the last-wins reason stays byte-identical.
  const ps = PLATFORM.indexOf('const GAMECHANGED_DEBOUNCE_MS');
  const pa = PLATFORM.indexOf('}, GAMECHANGED_DEBOUNCE_MS);', ps);
  const pe = PLATFORM.indexOf('}', pa + '}, GAMECHANGED_DEBOUNCE_MS);'.length) + 1;
  let preg = PLATFORM.slice(ps, pe).replace(/export function/g, 'function');
  if (!preg || preg.indexOf('function orwellGameChanged') === -1) { console.log('SLICE-FAIL-PLATFORM'); return; }

  let dispatched = [];
  let pending = null;
  const fakeWindow = { dispatchEvent: function (ev) { dispatched.push(ev); } };
  function FakeCustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  function fakeSetTimeout(fn) { pending = { fn: fn }; return pending; }
  function fakeClearTimeout(t) { if (pending === t) pending = null; }
  const orwellGameChanged = new Function('window', 'CustomEvent', 'setTimeout', 'clearTimeout',
    preg + '\nreturn orwellGameChanged;')(fakeWindow, FakeCustomEvent, fakeSetTimeout, fakeClearTimeout);

  // A burst in ONE debounce window: a crown, then a routine refresh arriving LAST.
  orwellGameChanged('tool:runCompetition', 5);
  orwellGameChanged('tool:recordInteraction', 6);
  if (!pending) { fails.push('no debounce timer scheduled'); }
  else { pending.fn(); }   // flush the trailing debounce (one wave -> one event)

  if (dispatched.length !== 1) fails.push('expected 1 dispatch, got ' + dispatched.length);
  else {
    const d = dispatched[0].detail;
    eq(d.reason, 'tool:recordInteraction', 'detail.reason last-wins byte-identical');
    eq(d.beatSeq, 6, 'detail.beatSeq coalesced-to-highest');
    if (!Array.isArray(d.reasons)) fails.push('detail.reasons not carried');
    else {
      if (d.reasons.indexOf('tool:runCompetition') === -1 || d.reasons.indexOf('tool:recordInteraction') === -1)
        fails.push('detail.reasons missing a member: ' + JSON.stringify(d.reasons));
      // The masked-cue recovery, end to end: last-wins reason -> null, the wave -> crown.
      eq(beatForReason(d.reason), null, 'masked-by-last-wins');
      eq(beatForWave(d.reasons), 'crown', 'recovered-by-wave');
    }
  }

  // A fresh, separate wave starts clean (the accumulator was cleared on dispatch).
  dispatched = [];
  orwellGameChanged('decision:nominations', 7);
  if (pending) pending.fn();
  if (dispatched.length === 1) {
    const d2 = dispatched[0].detail;
    eq(d2.reasons, ['decision:nominations'], 'accumulator cleared between waves');
    eq(beatForWave(d2.reasons), 'noms', 'second-wave-noms');
  } else {
    fails.push('second wave dispatch count ' + dispatched.length);
  }

  console.log(fails.length === 0 ? 'ALL-OK' : ('FAILS: ' + fails.join(' | ')));
})();
"""


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_wave_cue_split_mechanism_runs_for_real():
    res = subprocess.run(
        [_NODE, "-e", _HARNESS, "--", str(HAPTICS_PATH), str(PLATFORM_PATH)],
        capture_output=True, text=True,
    )
    assert "ALL-OK" in res.stdout, (
        "the per-wave haptic cue split mechanism failed under Node.\n"
        f"stdout={res.stdout!r}\nstderr={res.stderr!r}"
    )

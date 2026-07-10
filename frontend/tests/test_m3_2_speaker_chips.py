"""M3-2 · Speaker-attributed dialogue (the microformat) — render-contract gate.

The narrator may attribute a spoken line to a houseguest with a SANCTIONED, line-leading
speaker tag ``@[Full Name]``; the game-build renderer (markdown.js) turns it into that
person's face chip (an OrwellMonogram) in the bubble gutter beside the line. This is an
INVERSION of the existing raw-id scrub: a well-formed tag becomes a chip, while a bare /
malformed ``npc:<id>`` still scrubs exactly as before (the L6b/#1047 gates own that half).

The render contract, proven by driving the PURE markdown.js helpers through Node (no DOM):
  · tagged    — a line-leading ``@[Name]`` becomes one chip + a flex speaker line, dialogue kept.
  · untagged  — ordinary prose is byte-identical (no chip, no change).
  · malformed — an unclosed ``@[Name`` fails OPEN (swallowed until it completes; never a
                chip, never raw markup); a bare ``npc:3`` is NEVER promoted to a chip.
  · split-chunk — a tag arriving across stream deltas shows nothing until the closing ``]``.
Plus source-level asserts that the wiring is in place (extract before the id-scrubs, restore
after mdToHtml, the mdToHtml fail-open degrade, exports), and that the game-build scrub still
redacts raw ids (the existing gate stays green — asserted structurally here, exercised by the
L6b/#1047 suites).
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")
MD = os.path.join(FRONTEND, "static", "js", "markdown.js")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── source-level wiring (no Node needed) ───────────────────────────────────────────── #

def test_helpers_defined_and_exported():
    md = _read("static", "js", "markdown.js")
    assert "export function extractSpeakerTags(" in md
    assert "export function restoreSpeakerChips(" in md
    export_block = md[md.index("const markdownModule = {"):]
    export_block = export_block[:export_block.index("};")]
    assert "extractSpeakerTags," in export_block
    assert "restoreSpeakerChips," in export_block


def test_extract_runs_before_the_id_scrubs_and_restore_after_mdtohtml():
    md = _read("static", "js", "markdown.js")
    pwt = md[md.index("export function processWithThinking"):]
    gated = pwt[pwt.index("if (gameBuildSuppressesThinking())"):]
    gated = gated[:gated.index("let html = ''")]
    # extraction happens, and BEFORE scrubReasoningPreamble / redactRawIds (which key on npc:<id>)
    assert "extractSpeakerTags(" in gated
    assert gated.index("extractSpeakerTags(") < gated.index("scrubReasoningPreamble(")
    assert gated.index("extractSpeakerTags(") < gated.index("redactRawIds(")
    # restoration happens on the rendered reply HTML (wrapping mdToHtml)
    assert "restoreSpeakerChips(mdToHtml(reply)" in gated


def test_mdtohtml_has_the_fail_open_degrade():
    md = _read("static", "js", "markdown.js")
    # a leftover name-only tag collapses to the bare name; the id-bearing form sheds its `@`
    assert r"s.replace(/@\[([^\]\n]{1,80})\](?!\()/g, '$1')" in md
    assert r"s.replace(/@(\[[^\]\n]{1,80}\]\(npc:\d+\))/g, '$1')" in md


def test_raw_id_scrub_is_untouched_by_this_feature():
    # The inversion is ADDITIVE — the existing raw-id redaction must still exist verbatim so a
    # bare/malformed npc:<id> keeps scrubbing (the L6b/#1047 suites exercise the behavior).
    md = _read("static", "js", "markdown.js")
    assert "const _RAW_NPC_ID_GLOBAL_RE = /\\bnpc:\\d+\\b" in md
    assert "export function redactRawIds(" in md


# ── Node round-trip of the pure helpers (the render contract) ───────────────────────── #

def _run_battery(cases):
    """Drive the pure markdown.js speaker-chip helpers in Node over a battery of fixtures.
    Grabs the constants + helper functions straight out of markdown.js (no DOM, no imports),
    plus the two mdToHtml fail-open degrade regexes lifted from source, and returns their
    JSON-encoded results for assertion."""
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker); const j = src.indexOf(end, i);
      return src.slice(i, j + end.length);
    }
    function grabFn(marker) {
      let fn = src.slice(src.indexOf(marker));
      fn = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
      return fn;
    }
    // A minimal escapeHtml (markdown.js aliases uiModule.esc); headless there is no window /
    // document, so the monogram kit is absent and the chip falls back to an initials tile.
    const escapeHtml = "function escapeHtml(s){return String(s==null?'':s)"
      + ".replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')"
      + ".replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}";
    // The two mdToHtml fail-open degrade regexes, lifted from source so the test can't drift.
    const degrade = [...src.matchAll(/s\.replace\((\/@[^\n]*?\/g), '\$1'\)/g)].map(m => m[1]);
    const body = [
      escapeHtml,
      grab('const _SPEAKER_TAG_RE = ', ';'),
      grab('const _SPEAKER_TRAILING_PARTIAL_RE = ', ';'),
      grabFn('function _speakerInitials'),
      grabFn('function _resolveSpeakerSeed'),
      grabFn('function ensureSpeakerCss'),
      grabFn('function _speakerChipHtml'),
      grab('const _SPEAKER_SCAN_VOID_TAGS = ', ';'),
      grabFn('function _scanTopLevelBlocks'),
      grabFn('function _extendSpeakerContinuations'),
      grabFn('export function extractSpeakerTags'),
      grabFn('export function restoreSpeakerChips'),
      'const _DEGRADE = [' + degrade.join(',') + '];',
      'function degradeTags(s){ for (const re of _DEGRADE) s = s.replace(re, "$1"); return s; }',
    ].join('\n');
    const api = (new Function(body + '\nreturn {extractSpeakerTags, restoreSpeakerChips, degradeTags, DEGRADE_N:_DEGRADE.length};'))();
    const cases = JSON.parse(process.argv[2]);
    const out = {};
    for (const [name, input] of Object.entries(cases)) {
      const ex = api.extractSpeakerTags(input);
      // Simulate the paragraph mdToHtml would emit for a line-leading placeholder, then restore.
      const wrapped = ex.text.split('\n').filter(Boolean)
        .map(l => '<p>' + l + '</p>').join('');
      const restored = api.restoreSpeakerChips(wrapped, ex.chips);
      const restoredTwice = api.restoreSpeakerChips(restored, ex.chips);
      out[name] = { text: ex.text, chips: ex.chips, restored, restoredTwice,
                    degraded: api.degradeTags(input), degradeN: api.DEGRADE_N };
    }
    process.stdout.write(JSON.stringify(out));
    """
    res = subprocess.run([_NODE, "-e", program, "--", MD, json.dumps(cases)],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, f"node failed: {res.stderr}"
    return json.loads(res.stdout)


def _run_html_battery(cases):
    """Drive restoreSpeakerChips directly over hand-built {html, chips} fixtures (bypassing the
    per-line paragraph simulation in `_run_battery`) — needed for fixtures that inject a
    non-<p> top-level block (a list/blockquote) between paragraphs, which `_run_battery`'s
    one-<p>-per-line wrap can't produce. Also returns a second, independent call so callers can
    assert idempotency (running the transform twice on its own output ⇒ same DOM)."""
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker); const j = src.indexOf(end, i);
      return src.slice(i, j + end.length);
    }
    function grabFn(marker) {
      let fn = src.slice(src.indexOf(marker));
      fn = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
      return fn;
    }
    const escapeHtml = "function escapeHtml(s){return String(s==null?'':s)"
      + ".replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')"
      + ".replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}";
    const body = [
      escapeHtml,
      grabFn('function _speakerInitials'),
      grabFn('function _resolveSpeakerSeed'),
      grabFn('function ensureSpeakerCss'),
      grabFn('function _speakerChipHtml'),
      grab('const _SPEAKER_SCAN_VOID_TAGS = ', ';'),
      grabFn('function _scanTopLevelBlocks'),
      grabFn('function _extendSpeakerContinuations'),
      grabFn('export function restoreSpeakerChips'),
    ].join('\n');
    const api = (new Function(body + '\nreturn {restoreSpeakerChips};'))();
    const cases = JSON.parse(process.argv[2]);
    const out = {};
    for (const [name, c] of Object.entries(cases)) {
      const restored = api.restoreSpeakerChips(c.html, c.chips);
      const restoredTwice = api.restoreSpeakerChips(restored, c.chips);
      out[name] = { restored, restoredTwice };
    }
    process.stdout.write(JSON.stringify(out));
    """
    res = subprocess.run([_NODE, "-e", program, "--", MD, json.dumps(cases)],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, f"node failed: {res.stderr}"
    return json.loads(res.stdout)


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_render_contract_tagged_untagged_malformed_split():
    r = _run_battery({
        # TAGGED — one line-leading sanctioned tag → one chip + a flex speaker line
        "tagged": '@[Faith Willis] "I trust no one this week," she says.',
        # UNTAGGED — ordinary prose is byte-identical, no chip
        "untagged": "The living room hums with the tension of the first eviction.",
        # MALFORMED (unclosed) — swallowed, fail open, no chip, no raw markup
        "unclosed": "@[Faith Wil",
        # MALFORMED (mid-line) — not line-leading, so NOT promoted to a chip
        "midline": "You catch @[Faith Willis] watching you from the couch.",
        # RAW ID — a bare engine id must NEVER become a chip (it scrubs elsewhere)
        "rawid": "npc:3 slips into the kitchen.",
        # ID-BEARING sanctioned form (tolerated) — chip carries the real id for hue-match
        "idform": '@[Deja Monroe](npc:8) "We ride together," she whispers.',
    })

    # tagged: exactly one chip, keyed by the public name only (Vault-free), dialogue preserved,
    # rendered as a flex speaker line with a chip in the gutter.
    t = r["tagged"]
    assert len(t["chips"]) == 1
    assert t["chips"][0]["name"] == "Faith Willis"
    assert t["chips"][0]["id"] is None  # name-only form carries no id
    assert "___OWSPK_0___" in t["text"]
    assert "npc:" not in t["restored"]  # no machinery id leaks into the rendered chip
    assert 'class="ow-speaker-line"' in t["restored"]
    assert 'class="ow-speaker-chip"' in t["restored"]
    assert 'data-hg-name="Faith Willis"' in t["restored"]
    assert "I trust no one this week" in t["restored"]

    # untagged: no chip, text unchanged, render carries no speaker markup
    u = r["untagged"]
    assert u["chips"] == []
    assert u["text"] == "The living room hums with the tension of the first eviction."
    assert "ow-speaker-chip" not in u["restored"]

    # unclosed: the partial tag is swallowed (fail open) — no chip, no literal "@[" left
    uc = r["unclosed"]
    assert uc["chips"] == []
    assert "@[" not in uc["restored"]
    assert "ow-speaker-chip" not in uc["restored"]

    # mid-line: not line-leading → NOT a chip; the fail-open degrade collapses it to the name
    m = r["midline"]
    assert m["chips"] == []
    assert "ow-speaker-chip" not in m["restored"]
    assert m["degraded"] == "You catch Faith Willis watching you from the couch."
    assert "@[" not in m["degraded"]

    # raw id: never a chip (the raw-id scrub, not this feature, handles it)
    ri = r["rawid"]
    assert ri["chips"] == []
    assert "ow-speaker-chip" not in ri["restored"]

    # id-bearing form: chip carries the real engine id (exact cross-surface hue match)
    idf = r["idform"]
    assert len(idf["chips"]) == 1
    assert idf["chips"][0]["name"] == "Deja Monroe"
    assert idf["chips"][0]["id"] == "npc:8"
    assert 'data-hg-id="npc:8"' in idf["restored"]
    assert "We ride together" in idf["restored"]

    # both mdToHtml degrade regexes were found in source (fail-open is wired)
    assert t["degradeN"] == 2


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_render_contract_split_chunk_streaming():
    # A tag split across stream deltas: the buffer is re-rendered on each delta. Until the
    # closing `]` arrives, the partial shows NOTHING (fail open) — never a flash of raw markup —
    # then the completed tag promotes to a chip on the next render.
    r = _run_battery({
        "chunk1": "The camera finds her. @[Fai",             # mid-stream: tag incomplete
        "chunk2": '@[Faith Willis] "Hey," she says softly.',  # completed on the next delta
    })
    c1 = r["chunk1"]
    assert c1["chips"] == []
    assert "@[" not in c1["restored"]
    assert "ow-speaker-chip" not in c1["restored"]
    # the prose BEFORE the partial tag survives
    assert "The camera finds her." in c1["restored"]

    c2 = r["chunk2"]
    assert len(c2["chips"]) == 1
    assert c2["chips"][0]["name"] == "Faith Willis"
    assert 'class="ow-speaker-chip"' in c2["restored"]
    assert "Hey" in c2["restored"]


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_multiple_speaker_lines_each_get_their_own_chip():
    r = _run_battery({
        "two": "@[Faith Willis] I'm not going anywhere.\n@[Deja Monroe] We'll see about that.",
    })
    two = r["two"]
    assert len(two["chips"]) == 2
    assert [c["name"] for c in two["chips"]] == ["Faith Willis", "Deja Monroe"]
    # two distinct speaker lines, two chips
    assert two["restored"].count('class="ow-speaker-line"') == 2
    assert two["restored"].count('class="ow-speaker-chip"') == 2
    assert 'data-hg-name="Faith Willis"' in two["restored"]
    assert 'data-hg-name="Deja Monroe"' in two["restored"]


# ── #1323 — multi-paragraph speech indent (only the FIRST line was gutter-aligned) ───────── #
#
# Root cause: the narrator tags only the FIRST line of a speech (by design — momentPrompts.ts's
# SPEAKER TAGS rule is "ONE tag per line" as a per-line constraint, not "re-tag every line").
# restoreSpeakerChips used to wrap ONLY the one <p> starting with the placeholder in
# `.ow-speaker-line` (flex: chip + text); every continuation <p> rendered flush-left, breaking
# the "this person is talking" illusion. The fix extends the SAME left padding
# (`calc(1.7em + .5rem)`, the chip width + gutter gap) to the run of untagged sibling <p>s via a
# new `.ow-speaker-cont` class, stopping at the next speaker tag / a non-<p> block / end of
# message — see `_extendSpeakerContinuations` in markdown.js for the exact rule + rationale.

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_multi_paragraph_speech_all_paragraphs_share_the_aligned_indent():
    r = _run_battery({
        "speech": (
            '@[Faith Willis] "I trust no one this week," she says.\n\n'
            'She leans back against the counter, arms crossed.\n\n'
            '"Everyone\'s playing an angle. I just play mine."'
        ),
    })
    s = r["speech"]
    assert len(s["chips"]) == 1
    restored = s["restored"]
    # exactly one gutter chip (only the opening line is tagged) …
    assert restored.count('class="ow-speaker-chip"') == 1
    assert restored.count('class="ow-speaker-line"') == 1
    # … but BOTH continuation paragraphs now carry the SAME alignment treatment as the tagged
    # line, so the whole speech reads as one person talking.
    assert restored.count('class="ow-speaker-cont"') == 2
    assert 'class="ow-speaker-cont">She leans back against the counter, arms crossed.</p>' in restored
    assert 'class="ow-speaker-cont">"Everyone\'s playing an angle. I just play mine."</p>' in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_single_paragraph_speech_is_unchanged_by_the_continuation_pass():
    r = _run_battery({"one": '@[Faith Willis] "Hello there."'})
    restored = r["one"]["restored"]
    assert restored.count('class="ow-speaker-line"') == 1
    assert "ow-speaker-cont" not in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_multi_speaker_interleaved_narration_each_run_scoped_no_indent_on_handoff():
    # A plain paragraph that hands directly off into the NEXT speaker's tag reads as narration
    # BETWEEN speeches, not a continuation of the speaker before it — excluded from the run
    # (design choice, documented in _extendSpeakerContinuations).
    r = _run_battery({
        "scene": (
            '@[Faith Willis] "I do not trust him."\n\n'
            'Across the room, Marcus rolls his eyes.\n\n'
            '@[Marcus Chen] "She is being paranoid."'
        ),
    })
    restored = r["scene"]["restored"]
    assert len(r["scene"]["chips"]) == 2
    # two speaker lines, no continuation anywhere (the middle paragraph is the hand-off)
    assert restored.count('class="ow-speaker-line"') == 2
    assert "ow-speaker-cont" not in restored
    # the hand-off narration renders as a bare, unindented paragraph
    assert '<p>Across the room, Marcus rolls his eyes.</p>' in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_multi_speaker_each_with_its_own_multi_paragraph_run():
    # Two different speakers, each with a real multi-paragraph speech of their own — each run
    # must stay scoped to its own speaker and not bleed into the other's.
    r = _run_battery({
        "two_runs": (
            '@[Faith Willis] Opening line one.\n'
            'Faith continues here.\n\n'
            '@[Marcus Chen] Opening line two.\n'
            'Marcus continues here.\n'
            'And once more.'
        ),
    })
    restored = r["two_runs"]["restored"]
    assert restored.count('class="ow-speaker-line"') == 2
    # Faith gets exactly one continuation paragraph (stops because Marcus's tag follows)…
    # …Marcus gets two (nothing follows, so both trail to end of message).
    assert restored.count('class="ow-speaker-cont"') == 2
    faith_idx = restored.index('Faith Willis')
    marcus_idx = restored.index('Marcus Chen')
    assert faith_idx < marcus_idx
    # "Faith continues here." must NOT carry the continuation class (it's the hand-off
    # paragraph immediately preceding Marcus's tag).
    assert '<p>Faith continues here.</p>' in restored
    assert 'class="ow-speaker-cont">Marcus continues here.</p>' in restored
    assert 'class="ow-speaker-cont">And once more.</p>' in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_non_paragraph_block_breaks_the_continuation_run_and_degrades_gracefully():
    # A list right after the tagged line: the indent treatment does not reach into it, and
    # anything AFTER the list is also NOT swept up as a continuation of the speaker before it
    # (the run is over — a non-<p> block ends it, per design).
    ex_html = (
        '<p>___OWSPK_0___ Listen up, everyone.</p>'
        '<ul><li>one</li><li>two</li></ul>'
        '<p>Some narration after the list.</p>'
    )
    r = _run_html_battery({
        "listcase": {"html": ex_html, "chips": [{"id": None, "name": "Faith Willis"}]},
    })
    restored = r["listcase"]["restored"]
    assert 'class="ow-speaker-line"' in restored
    assert '<ul><li>one</li><li>two</li></ul>' in restored  # list itself untouched
    assert '<p>Some narration after the list.</p>' in restored  # trailing text unindented
    assert "ow-speaker-cont" not in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_blockquote_inside_a_speech_does_not_absorb_its_inner_paragraphs():
    # A blockquote's OWN inner <p>s must stay opaque to the top-level scan (never mistaken for
    # top-level speech-continuation siblings), and the blockquote itself breaks the run.
    ex_html = (
        '<p>___OWSPK_0___ Check this out.</p>'
        '<blockquote><p>a quoted excerpt</p><p>second quoted line</p></blockquote>'
        '<p>after the quote</p>'
    )
    r = _run_html_battery({
        "bqcase": {"html": ex_html, "chips": [{"id": None, "name": "Faith Willis"}]},
    })
    restored = r["bqcase"]["restored"]
    assert 'class="ow-speaker-line"' in restored
    assert '<blockquote><p>a quoted excerpt</p><p>second quoted line</p></blockquote>' in restored
    assert '<p>after the quote</p>' in restored
    assert "ow-speaker-cont" not in restored


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_restore_speaker_chips_is_idempotent():
    # Running the transform twice (the second pass over its own output) must be a no-op — no
    # more OWSPK placeholders to find, and no already-classed <p> gets re-classified or
    # double-wrapped.
    cases = {
        "multi": (
            '@[Faith Willis] "I trust no one this week," she says.\n\n'
            'She leans back against the counter, arms crossed.\n\n'
            '"Everyone\'s playing an angle. I just play mine."'
        ),
        "interleaved": (
            '@[Faith Willis] "I do not trust him."\n\n'
            'Across the room, Marcus rolls his eyes.\n\n'
            '@[Marcus Chen] "She is being paranoid."'
        ),
        "single": '@[Faith Willis] "Hello there."',
    }
    r = _run_battery(cases)
    for name, res in r.items():
        assert res["restored"] == res["restoredTwice"], f"not idempotent: {name}"

    # Also idempotent when the SAME already-processed HTML (containing a list/blockquote) is
    # re-run through restoreSpeakerChips directly.
    html_cases = {
        "listcase": {
            "html": (
                '<p>___OWSPK_0___ Listen up, everyone.</p>'
                '<ul><li>one</li><li>two</li></ul>'
                '<p>Some narration after the list.</p>'
            ),
            "chips": [{"id": None, "name": "Faith Willis"}],
        },
    }
    hr = _run_html_battery(html_cases)
    for name, res in hr.items():
        assert res["restored"] == res["restoredTwice"], f"not idempotent: {name}"

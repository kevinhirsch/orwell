"""#1413 (R2) · ADR-0015 — collapse the duplicated live-vs-reload chat SETTLE render into one seam.

S1 — the NORMALIZER (no DOM change). `toRenderModel(input)` maps a settled assistant turn onto ONE
normalized "settled message" model, from EITHER:
  - the reload path (`source: 'history'`): the persisted `{role, content, modelName, metadata}` that
    `chatRenderer.addMessage` receives; or
  - the live-finalize path (`source: 'live'`): the stream state chat.js holds at settle.
Both adapters normalize to the SAME canonical `{role, content, modelName, metadata}` and DERIVE the
structural fields (rounds / reasoning / sources / …) from it, so the model is EQUAL by construction
whenever the canonical matches — "live == reload by construction" (ADR-0015). This is the contract S3
(routing the chat.js sender finalize through the seam) relies on.

S2 — the SEAM. `renderAssistantMessage(model)` is the model-typed front door BOTH the reload path and
(S3, deferred) the live-finalize path funnel through: it hands the model's canonical fields to the ONE
canonical builder, `addMessage`, so a live finalize and a history reload of the same turn paint
identical DOM.

The normalizer is PURE (no DOM/markdown/ui) so it is Node-sliceable — the equality check below drives
the REAL `toRenderModel` out of chatRenderer.js in Node against representative turn shapes (single,
multi-round, reasoning, sources, stopped). It FAILS if the two adapters ever drift.

Run: cd frontend && python3 -m pytest tests/test_1413_render_model.py -q
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")

_START = "// #1413-RENDER-MODEL-START"
_END = "// #1413-RENDER-MODEL-END"


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── 1. source-pinned contract ────────────────────────────────────────────────

def test_render_model_region_is_marker_delimited():
    src = _read("static", "js", "chatRenderer.js")
    a, b = src.find(_START), src.find(_END)
    assert a != -1 and b != -1 and a < b, "the pure #1413 render-model region must be marker-delimited"
    region = src[a:b]
    assert "export function toRenderModel(input)" in region, "toRenderModel must live in the region"


def test_normalizer_region_is_pure_no_dom_no_side_effects():
    """The normalizer must stay PURE — no DOM, no markdown/ui module calls, no rendering. That is what
    lets both the live and the reload paths reuse it, and keeps the render seam free of the
    session/subscribe side-effects that collapsed windows (#1085/#1086)."""
    src = _read("static", "js", "chatRenderer.js")
    region = src[src.find(_START):src.find(_END)]
    for banned in ("document", "window.", "innerHTML", "createElement",
                   "markdownModule", "uiModule", "querySelector", "appendChild"):
        assert banned not in region, f"the pure normalizer region must not reference {banned!r}"


def test_both_functions_are_exported_and_on_the_module_object():
    src = _read("static", "js", "chatRenderer.js")
    assert "export function toRenderModel(input)" in src
    assert "export function renderAssistantMessage(model)" in src
    # exposed on the default chatRenderer object (how chat.js consumes the reload builder).
    obj = src[src.index("const chatRenderer = {"):src.index("export default chatRenderer;")]
    assert "toRenderModel," in obj and "renderAssistantMessage," in obj, \
        "both seam functions must be on the chatRenderer module object"


def test_render_seam_funnels_to_the_one_canonical_builder():
    """renderAssistantMessage must delegate to addMessage (the ONE canonical builder) — NOT re-implement
    a second render engine. That is the whole point: reload and (S3) live converge on identical DOM."""
    src = _read("static", "js", "chatRenderer.js")
    fn = src[src.index("export function renderAssistantMessage(model)"):]
    fn = fn[:fn.index("\n}\n") + 2]
    assert "return addMessage(" in fn, "renderAssistantMessage must funnel the model to addMessage"
    # pure DOM — no session/network side-effects in the seam (the #1085/#1086 render-purity rule).
    for banned in ("selectSession", "resumeStream", "subscribe", "getCurrentSessionId", "fetch("):
        assert banned not in fn, f"the render seam must not perform {banned!r} (pure DOM only)"


def test_live_adapter_is_defined_but_not_yet_wired_into_chatjs():
    """S3 (routing the sender finalize through the seam) is DEFERRED — the live adapter is proven equal
    here but chat.js must NOT yet call it, so this PR cannot perturb the F5 mirror-parity path."""
    chat = _read("static", "js", "chat.js")
    assert "toRenderModel(" not in chat and "renderAssistantMessage(" not in chat, \
        "S3 is deferred: chat.js must not yet consume the render seam (keeps F5 untouched)"


# ── 2. the equality guarantee — driven in Node against the REAL toRenderModel ─

_HARNESS = r"""
(function () {
const fs = require('fs');
const SRC = fs.readFileSync(process.argv[1], 'utf8');
const START = '// #1413-RENDER-MODEL-START';
const END = '// #1413-RENDER-MODEL-END';
const region = SRC.slice(SRC.indexOf(START), SRC.indexOf(END));
if (!region || region.indexOf('function toRenderModel') === -1) { console.log('SLICE-FAIL'); return; }
const body = region.replace(/export function/g, 'function');
const toRenderModel = new Function(body + '\nreturn toRenderModel;')();

function deepEqual(a, b, path) {
  path = path || '$';
  if (a === b) return null;
  if (a == null || b == null || typeof a !== typeof b) return path + ' (' + JSON.stringify(a) + ' !== ' + JSON.stringify(b) + ')';
  if (typeof a !== 'object') return path + ' (' + JSON.stringify(a) + ' !== ' + JSON.stringify(b) + ')';
  if (Array.isArray(a) !== Array.isArray(b)) return path + ' (array vs non-array)';
  if (Array.isArray(a)) {
    if (a.length !== b.length) return path + ' (len ' + a.length + ' !== ' + b.length + ')';
    for (let i = 0; i < a.length; i++) { const r = deepEqual(a[i], b[i], path + '[' + i + ']'); if (r) return r; }
    return null;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return path + ' (keys ' + ka + ' !== ' + kb + ')';
  for (const k of ka) { const r = deepEqual(a[k], b[k], path + '.' + k); if (r) return r; }
  return null;
}

// Each case: a HISTORY input (persisted shape) and a LIVE input (stream-finalize shape) for the SAME
// turn. Roles only — no names.
const cases = {
  'single-plain': {
    history: { source: 'history', role: 'assistant', content: 'Welcome to the house. Who do you trust?',
      modelName: 'narrator', metadata: { timestamp: 111, _db_id: 'd1', _seq: 7, client_msg_id: 'c1' } },
    live: { source: 'live', rounds: [{ replyText: 'Welcome to the house. Who do you trust?', tools: [] }],
      actualModel: 'narrator', timestamp: 111, dbId: 'd1', seq: 7, clientMsgId: 'c1' },
  },
  'single-reasoning': {
    history: { source: 'history', role: 'assistant', content: 'The lights dim.', modelName: 'narrator',
      metadata: { thinking: 'plan the scene', thinking_time: 1400, timestamp: 2, _db_id: 'd', _seq: 1, client_msg_id: 'c' } },
    live: { source: 'live', rounds: [{ replyText: 'The lights dim.', reasoningText: 'plan the scene', tools: [] }],
      thinkingTimeMs: 1400, actualModel: 'narrator', timestamp: 2, dbId: 'd', seq: 1, clientMsgId: 'c' },
  },
  'single-web-sources': {
    history: { source: 'history', role: 'assistant', content: 'Here is what I found.', modelName: 'narrator',
      metadata: { web_sources: [{ title: 't', url: 'https://u' }], timestamp: 3, _db_id: 'd', _seq: 2, client_msg_id: 'c' } },
    live: { source: 'live', rounds: [{ replyText: 'Here is what I found.', tools: [] }],
      sources: { kind: 'web', items: [{ title: 't', url: 'https://u' }] },
      actualModel: 'narrator', timestamp: 3, dbId: 'd', seq: 2, clientMsgId: 'c' },
  },
  'multi-round-tool': {
    history: { source: 'history', role: 'assistant', content: 'first\n\nsecond', modelName: 'narrator',
      metadata: { round_texts: ['first', 'second'], tool_events: [{ round: 1, tool: 'confront', exit_code: 0, output: '{}' }],
        timestamp: 9, _db_id: 'd', _seq: 3, client_msg_id: 'c' } },
    live: { source: 'live', content: 'first\n\nsecond',
      rounds: [{ replyText: 'first', tools: [{ tool: 'confront', exit_code: 0, output: '{}' }] }, { replyText: 'second', tools: [] }],
      actualModel: 'narrator', timestamp: 9, dbId: 'd', seq: 3, clientMsgId: 'c' },
  },
  'stopped': {
    history: { source: 'history', role: 'assistant', content: 'partial', modelName: 'narrator',
      metadata: { stopped: true, timestamp: 5, _db_id: 'd', _seq: 4, client_msg_id: 'c' } },
    live: { source: 'live', rounds: [{ replyText: 'partial', tools: [] }], stopped: true,
      actualModel: 'narrator', timestamp: 5, dbId: 'd', seq: 4, clientMsgId: 'c' },
  },
};

let fails = 0;
for (const name of Object.keys(cases)) {
  const c = cases[name];
  const diff = deepEqual(toRenderModel(c.history), toRenderModel(c.live), '$');
  if (diff) { fails++; console.error('DIFF ' + name + ' -> ' + diff); }
}
// The multi-round model must actually carry the reconstructed rounds (guard against a degenerate pass).
const mm = toRenderModel(cases['multi-round-tool'].history);
if (!(mm.rounds.length === 2 && mm.rounds[0].text === 'first' && mm.rounds[0].tools.length === 1
      && mm.rounds[0].isLastTextRound === false && mm.rounds[1].isLastTextRound === true)) {
  fails++; console.error('STRUCT multi-round rounds not reconstructed: ' + JSON.stringify(mm.rounds));
}
console.log(fails === 0 ? 'ALL-EQUAL' : ('FAILS ' + fails));
})();
"""


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_history_and_live_adapters_produce_equal_models():
    renderer_path = os.path.join(FRONTEND, "static", "js", "chatRenderer.js")
    res = subprocess.run([_NODE, "-e", _HARNESS, "--", renderer_path],
                         capture_output=True, text=True)
    assert "ALL-EQUAL" in res.stdout, (
        f"the history and live adapters drifted (live != reload by construction).\n"
        f"stdout={res.stdout!r}\nstderr={res.stderr!r}"
    )

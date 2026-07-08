"""M1-1 (audit A1) — the resume own-echo duplicate: source pins.

The intermittent double-render: a tab's OWN streamed turn settles, the deferred peer-resume
flush (ADR 0012 GAP 1) then re-attaches to the just-finished run, and `resumeStream` replays
the same reply into a fresh bubble beside the settled one. The fix is a CONVERGENCE KEY,
never content-equality: the replayed `message_saved` carries the server-minted DB id, and a
bubble already holding that `data-db-id` aborts the resume before anything paints. Paint is
batched per network chunk so a settled run's one-burst replay (whose message_saved rides the
same chunk as its deltas) can never flash a transient duplicate frame.
"""
from __future__ import annotations

import os
import re

JS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _chat() -> str:
    with open(os.path.join(JS, "chat.js"), encoding="utf-8") as fh:
        return fh.read()


def test_resume_aborts_on_existing_db_id_bubble():
    src = _chat()
    m = re.search(
        r"json\.type === 'message_saved'.{0,900}?"
        r"box\.querySelector\('\.msg\[data-db-id=\"' \+ String\(json\.id\).{0,200}?"
        r"holder\.remove\(\);\s*\n\s*return true;", src, re.S)
    assert m, ("resumeStream must abort by the server DB id (the convergence key) when a "
               "bubble with that id already exists — the own-echo duplicate class")


def test_dup_abort_runs_before_timestamp_or_id_stamping():
    src = _chat()
    resume = src.find("export async function resumeStream")
    assert resume != -1
    saved = src.find("json.type === 'message_saved'", resume)
    assert saved != -1
    block = src[saved:saved + 1800]
    abort = block.find("holder.remove();")
    stamp = block.find("_applyServerTimestamp(holder")
    assert -1 < abort < stamp, "the dup-abort must precede any stamping onto the placeholder"


def test_resume_paint_is_batched_per_chunk():
    src = _chat()
    assert re.search(r"if \(json\.thinking\) reasoningText \+= json\.delta;\s*\n\s*"
                     r"else replyText \+= json\.delta;.{0,600}?paintDirty = true;", src, re.S), \
        "delta handling marks dirty instead of painting per delta"
    assert re.search(r"if \(paintDirty\) \{ paintDirty = false; renderDelta\(\); \}", src), \
        "the chunk loop flushes one paint after its parts are processed (post-dup-check)"

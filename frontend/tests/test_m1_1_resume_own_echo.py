"""M1-1 (audit A1) — the resume own-echo duplicate: source pins.

The intermittent double-render: a tab's OWN streamed turn settles, the deferred peer-resume
flush (ADR 0012 GAP 1) then re-attaches to the just-finished run, and `resumeStream` replays
the same reply into a fresh bubble beside the settled one. The fix is a CONVERGENCE KEY,
never content-equality: the replayed `message_saved` carries the server-minted DB id, and a
bubble already holding that `data-db-id` aborts the resume before anything paints. Paint is
batched per network chunk so a settled run's one-burst replay (whose message_saved rides the
same chunk as its deltas) can never flash a transient duplicate frame.

Ship-gate F5 refinement: the abort is now SCOPED to the own-echo case. A matching bubble that
came from a from-history reconcile (`data-fromHistory="1"`) is a LATE-ATTACHING OBSERVER'S
static render — aborting there would strand the mirror window on the non-incremental reconcile.
For that case the resume REMOVES the static bubble and renders the turn LIVE through the shared
incremental renderer instead (createStreamRenderer). The own-echo abort (a bubble THIS tab
live-rendered itself, NOT from history) is preserved unchanged.
"""
from __future__ import annotations

import os
import re

JS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _chat() -> str:
    with open(os.path.join(JS, "chat.js"), encoding="utf-8") as fh:
        return fh.read()


def test_resume_aborts_on_existing_db_id_bubble():
    """OWN-ECHO abort: a replayed message_saved whose DB id already marks a bubble THIS tab
    live-rendered (the `else` branch — NOT a from-history reconcile) drops the placeholder and
    keeps the settled bubble. The convergence key, never content-equality."""
    src = _chat()
    m = re.search(
        r"json\.type === 'message_saved'.{0,600}?"
        r"const _dup = json\.id && box\.querySelector\('\.msg\[data-db-id=\"' \+ String\(json\.id\).{0,1600}?"
        r"\} else \{.{0,600}?holder\.remove\(\);\s*\n\s*return true;", src, re.S)
    assert m, ("resumeStream must abort by the server DB id (the convergence key) when a bubble "
               "with that id already exists AND is not a from-history reconcile — the own-echo "
               "duplicate class")


def test_dup_abort_runs_before_timestamp_or_id_stamping():
    src = _chat()
    resume = src.find("export async function resumeStream")
    assert resume != -1
    saved = src.find("json.type === 'message_saved'", resume)
    assert saved != -1
    block = src[saved:saved + 3000]
    abort = block.find("holder.remove();")
    stamp = block.find("_applyServerTimestamp(holder")
    assert -1 < abort < stamp, "the dup handling must precede any stamping onto the placeholder"


def test_resume_paint_is_batched_per_chunk():
    src = _chat()
    assert re.search(r"if \(json\.thinking\) reasoningText \+= json\.delta;\s*\n\s*"
                     r"else replyText \+= json\.delta;.{0,600}?paintDirty = true;", src, re.S), \
        "delta handling marks dirty instead of painting per delta"
    assert re.search(r"if \(paintDirty\) \{ paintDirty = false; renderDelta\(\); \}", src), \
        "the chunk loop flushes one paint after its parts are processed (post-dup-check)"


def test_resume_replays_incrementally_for_late_observer():
    """Ship-gate F5: a LATE-ATTACHING OBSERVER whose from-history reconcile already painted a
    STATIC bubble for the run must NOT abort — it removes that static bubble (matched by the same
    DB id, gated on `data-fromHistory`) and renders the turn LIVE through the shared incremental
    renderer, so window B mirrors A's stream instead of stranding on the non-incremental reconcile."""
    src = _chat()
    m = re.search(
        r"if \(_dup\.dataset && _dup\.dataset\.fromHistory === '1'\) \{.{0,600}?"
        r"_dup\.remove\(\);.{0,600}?renderDelta\(\);", src, re.S)
    assert m, ("resumeStream must REMOVE a from-history reconcile bubble and paint through the "
               "incremental renderer (the F5 late-observer live-mirror path), not abort")
    # the [DONE] terminal of a one-burst replay must flush the buffered paint before breaking,
    # so the incremental container mounts even when reply + [DONE] ride the same chunk.
    assert re.search(r"payload === '\[DONE\]'.{0,400}?if \(paintDirty\) \{ paintDirty = false; renderDelta\(\); \}",
                     src, re.S), "the [DONE] break must flush a pending paint first (F5 one-burst replay)"


def test_from_history_render_is_tagged_for_the_dup_distinguisher():
    """The observer-replace above distinguishes a from-history reconcile from an own-echo live
    bubble via `data-fromHistory`. chatRenderer must stamp that flag when it renders a bubble from
    history (`metadata._fromHistory`), or the distinguisher silently fails and B strands on static."""
    with open(os.path.join(JS, "chatRenderer.js"), encoding="utf-8") as fh:
        renderer = fh.read()
    assert renderer.count("if (metadata?._fromHistory) wrap.dataset.fromHistory = '1';") >= 2, \
        "both addMessage db-id sites must tag a from-history render with data-fromHistory"

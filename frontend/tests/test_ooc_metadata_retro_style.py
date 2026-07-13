"""OOC retro-styling — the METADATA half of the classification seam (source pins).

Owner-reported: messages sent out-of-character WITHOUT the `((...))`/`ooc:` markers were never
retroactively styled as OOC. Audit verdict (2026-07-13): there is NO after-the-fact classification
seam anywhere — the ONLY client-side input was the literal marker scan (`detectOocAside`,
orwellOocAside.js: `((...))` whole-wrap or a leading `ooc:`), and NO server/model path writes an
OOC mark onto a persisted message row today. So a marker-less OOC turn could never style, live OR
reloaded.

Per the design ruling the fix does NOT invent a client-side OOC heuristic (classification stays a
server/model call): it adds the RENDER seam that honors a server metadata mark (`ooc: true` on the
message row) whenever one lands, in BOTH render paths so live and reload can never drift (the #828
discipline — see test_828_ooc_wrap_live_parity.py for the marker half):

  · chatRenderer.applyOocClassFromMetadata — the single shared metadata classifier (game-build +
    role gated, additive-only: it never strips a marker-applied class).
  · addMessage (the reload/settled render) reads it off the row's metadata.
  · the reconcile ADOPT pass (chatReconcile.softReloadHistory) retro-applies it to the
    ALREADY-RENDERED bubble the moment the row's metadata is observed — live, no refresh, no
    rebuild (the classic ADR-0015 live-vs-reload divergence class).

The behavioral half (live-settled vs reload byte-consistency, driven in headless chromium) lives in
test_f4_order_stability_browser.py. Roles only; no names (CLAUDE.md).

Run: cd frontend && .venv/bin/python -m pytest tests/test_ooc_metadata_retro_style.py
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def test_metadata_classifier_exists_and_is_gated():
    js = _read("static/js/chatRenderer.js")
    assert "export function applyOocClassFromMetadata(wrap, metadata, role)" in js, \
        "the shared metadata half of the OOC classification seam must exist"
    fn = js[js.index("export function applyOocClassFromMetadata"):]
    fn = fn[:fn.index("\n}") + 2]
    assert "isGameBuild()" in fn, "OOC styling is game-build-scoped (full build unchanged)"
    assert "role === 'user' || role === 'assistant'" in fn, "role-gated like the marker half"
    assert "metadata.ooc !== true" in fn, \
        "ONLY an explicit server metadata mark applies — never a client-side heuristic"
    assert "classList.add('msg-ooc')" in fn, "the same class vocabulary as the marker half"
    assert "classList.add('msg-ooc-producer')" in fn, "an assistant OOC row is a producer aside"
    assert "classList.remove" not in fn and "toggle(" not in fn, \
        "additive-only: absent/false metadata must never STRIP a marker-applied class"
    # exported on the default object so chatReconcile reaches it as chatRenderer.applyOocClassFromMetadata
    default_obj = js[js.index("const chatRenderer = {"):]
    assert "applyOocClassFromMetadata," in default_obj


def test_reload_render_honors_the_metadata_mark():
    js = _read("static/js/chatRenderer.js")
    fn = js[js.index("const _ooc = detectOocAside(text);"):]
    fn = fn[:fn.index("wrap.dataset.raw = text;")]
    assert "applyOocClassFromMetadata(wrap, metadata, role)" in fn, \
        "addMessage (the reload/settled render) must style a marker-LESS row the server marked OOC"
    # the marker path keeps priority (it also strips the markers from the display text)
    assert fn.index("if (_ooc.ooc) {") < fn.index("applyOocClassFromMetadata(wrap, metadata, role)")


def test_adopt_pass_retro_applies_live():
    recon = _read("static/js/chatReconcile.js")
    fn = recon[recon.index("// 1) ADOPT PASS — no DOM churn."):]
    fn = fn[:fn.index("// BUG 1 — REORDER PASS")]
    assert "applyOocClassFromMetadata(el, msg.metadata, msg.role)" in fn, (
        "the adopt pass must retro-apply the OOC class to the ALREADY-RENDERED bubble when the "
        "row's metadata marks it OOC — live-settled must match the reload render (ADR 0015 class)"
    )


def test_no_client_side_ooc_heuristic_was_invented():
    """The classification-seam verdict, pinned: `detectOocAside` stays the literal marker scan
    (markers only — a design call reserved to the server/model side), and no client code WRITES an
    `ooc` metadata mark (the client only renders a server verdict)."""
    aside = _read("static/js/orwellOocAside.js")
    fn = aside[aside.index("export function detectOocAside(raw)"):]
    fn = fn[:fn.index("\n}") + 2]
    assert "_DOUBLE_PARENS" in fn and "_OOC_PREFIX" in fn
    assert "return { ooc: false, text: s };" in fn, "no marker ⇒ not OOC (never a heuristic guess)"
    for rel in ("static/js/chat.js", "static/js/chatRenderer.js", "static/js/chatReconcile.js",
                "static/js/chatOutbox.js", "static/js/sessionSync.js"):
        js = _read(rel)
        assert "metadata.ooc = " not in js and "metadata.ooc=" not in js, \
            f"{rel}: the client must never WRITE the ooc metadata mark (classification is server-side)"

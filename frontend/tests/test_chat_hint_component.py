"""The shared chat-bar hint/tooltip component (orwellChatHint.js).

ONE reusable hint surface that sits above the chat input bar, spans the same width,
and shares its visual style (the .orwell-chat-hint CSS class). It replaces the bespoke
per-feature composer hints (the old L36 OOC tip was the first and only one).

The contract under test:
  * the component ships with NO active tips (the TIPS registry is empty by default —
    nothing renders unless a future caller registers + shows one);
  * it exposes the small show/hide/register API on window.OrwellChatHint;
  * it is wired into index.html and its CSS class exists, theme-token driven.

Behavioral half (run the real JS in Node): an empty registry means show('anything')
is a no-op, and register()+ (after a stubbed bar) the API is callable.
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── STRUCTURAL ───────────────────────────────────────────────────────────────

def test_chat_hint_module_exists_and_exports_api():
    js = _read("static", "js", "orwellChatHint.js")
    # the small show/hide API
    for fn in ("register", "show", "hide", "dismiss", "isShown"):
        assert f"function {fn}" in js, f"missing API fn: {fn}"
    # installed on window for non-module callers
    assert "window.OrwellChatHint" in js
    # per-user dismiss key (E71 pattern) — derived through the shared fail-closed helper
    # (R5/#1416: window.orwellUserKey returns null when there is no data-user, so the dismiss
    # write is skipped rather than collapsing into a shared empty-user namespace).
    assert "orwell-chat-hint-dismissed:" in js
    assert "window.orwellUserKey(" in js


def test_chat_hint_ships_with_zero_active_tips():
    """The system exists and is ready, but NOTHING is enabled by default — the
    registry literal is empty, so trivially flipping one entry on enables a tip."""
    js = _read("static", "js", "orwellChatHint.js")
    # the registry is declared empty
    assert "const TIPS = {}" in js


def test_chat_hint_loaded_in_index():
    html = _read("static", "index.html")
    assert "orwellChatHint.js" in html


def test_chat_hint_css_class_exists_and_is_theme_token_driven():
    css = _read("static", "style.css")
    assert ".orwell-chat-hint" in css
    assert ".orwell-chat-hint-dismiss" in css
    # #642: the hint composes the OrwellNotice kit — the card SHELL (margin/border/radius/bg) is now
    # the kit's .on-card.on-guide (the kit owns the above-composer anchor + width). Only the inner
    # rules (the body's flex row, the text, the code chip, the dismiss button) remain here, still
    # theme-token driven (no hard-coded hex in the hint-specific rules).
    start = css.index(".orwell-chat-hint")
    block = css[start:start + 1400]
    assert "var(--fg)" in block


# ── BEHAVIORAL — the empty registry truly renders nothing ────────────────────

def test_chat_hint_empty_registry_show_is_noop():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral chat-hint check")
    mod = os.path.join(STATIC, "orwellChatHint.js").replace("\\", "/")
    kit = os.path.join(STATIC, "orwellNotice.js").replace("\\", "/")
    # Minimal DOM stub: a body with the game-build attr and a .chat-input-bar so a tip COULD
    # mount. #642: the hint composes the OrwellNotice kit, so the stub provides a fuller element
    # factory (the kit builds a card + a zone) and loads the kit (a classic IIFE — eval'd) so
    # window.OrwellNoticeKit exists. Then prove an unregistered key still does nothing, and that
    # register()+show() of a fresh key DOES mount (the one-entry enable path works).
    script = (
        "globalThis.window = globalThis;\n"
        "globalThis.matchMedia = () => ({ matches: false });\n"
        "let mounted = 0;\n"
        "function mkEl() {\n"
        "  const children = [];\n"
        "  const el = { tagName:'DIV', id:'', className:'', style:{}, dataset:{}, children,\n"
        "    classList:{ add(){}, remove(){}, toggle(){} },\n"
        "    setAttribute(){}, getAttribute(){return null;}, removeAttribute(){},\n"
        "    appendChild(c){ children.push(c); c.parentNode = el; if (el.id === 'orwell-notice-zone') mounted++; return c; },\n"
        "    insertBefore(c){ children.unshift(c); c.parentNode = el; return c; },\n"
        "    removeEventListener(){}, addEventListener(){}, querySelector(){return null;},\n"
        "    querySelectorAll(){return [];}, remove(){}, isConnected:true, get innerHTML(){return '';}, set innerHTML(_v){} };\n"
        "  return el;\n"
        "}\n"
        "const head = mkEl();\n"
        "const bar = mkEl(); const barParent = mkEl(); bar.parentNode = barParent;\n"
        "const byId = {};\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        "globalThis.document = {\n"
        "  head,\n"
        "  body: { dataset: {}, hasAttribute: () => true, style:{ setProperty(){}, removeProperty(){} }, "
        "appendChild(c){ return c; }, children: [] },\n"
        "  getElementById: (id) => byId[id] || null,\n"
        "  querySelector: (s) => (s === '.chat-input-bar' ? bar : null),\n"
        "  createElement: () => mkEl(),\n"
        "  addEventListener(){}, readyState:'complete',\n"
        "};\n"
        "globalThis.addEventListener = () => {};\n"
        "globalThis.CustomEvent = function(){};\n"
        "globalThis.dispatchEvent = () => {};\n"
        # load the kit (classic IIFE) so window.OrwellNoticeKit exists
        "import fs from 'node:fs';\n"
        f"const kitSrc = fs.readFileSync('{kit}', 'utf8');\n"
        "(0, eval)(kitSrc);\n"
        f"const m = await import('file://{mod}');\n"
        "const api = m.default;\n"
        "const a = api.show('does-not-exist');\n"      # unknown key → no mount
        "api.register('demo', { html: 'hi' });\n"
        "const b = api.show('demo');\n"                # registered → mounts via the kit
        "process.stdout.write(JSON.stringify({ a, b, mounted }));\n"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    import json
    out = json.loads(proc.stdout)
    assert out["a"] is False, "an unregistered/empty-registry key must not render"
    assert out["b"] is True, "register()+show() must mount the tip (the enable path)"
    assert out["mounted"] >= 1, "exactly the registered tip mounts (into the kit zone)"

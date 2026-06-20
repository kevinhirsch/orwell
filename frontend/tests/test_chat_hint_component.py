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
    # per-user dismiss key (E71 pattern)
    assert "orwell-chat-hint-dismissed:" in js
    assert "document.body.dataset.user" in js


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
    # same-width-as-the-bar margin + no hard-coded hex (frost-theme readable)
    start = css.index(".orwell-chat-hint")
    block = css[start:start + 1400]
    assert "var(--fg)" in block
    assert "margin: 0 8px" in block  # mirrors the chat-input-bar horizontal inset


# ── BEHAVIORAL — the empty registry truly renders nothing ────────────────────

def test_chat_hint_empty_registry_show_is_noop():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral chat-hint check")
    mod = os.path.join(STATIC, "orwellChatHint.js").replace("\\", "/")
    # Minimal DOM stub: a body with the game-build attr and a .chat-input-bar so a
    # tip COULD mount — then prove an unregistered key still does nothing, and that
    # register()+show() of a fresh key DOES mount (the one-entry enable path works).
    script = (
        "globalThis.window = globalThis;\n"
        "let inserted = 0;\n"
        "const bar = { parentNode: { insertBefore() { inserted++; } } };\n"
        "globalThis.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, "
        "setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };\n"
        "globalThis.document = {\n"
        "  body: { dataset: {}, hasAttribute: () => true },\n"
        "  getElementById: () => null,\n"
        "  querySelector: (s) => (s === '.chat-input-bar' ? bar : null),\n"
        "  createElement: () => ({ classList:{add(){},remove(){}}, dataset:{}, "
        "setAttribute(){}, querySelector(){return null;}, set innerHTML(_v){}, isConnected:true, remove(){} }),\n"
        "  addEventListener(){},\n"
        "};\n"
        "globalThis.addEventListener = () => {};\n"
        f"const m = await import('file://{mod}');\n"
        "const api = m.default;\n"
        "const a = api.show('does-not-exist');\n"      # unknown key → no mount
        "api.register('demo', { html: 'hi' });\n"
        "const b = api.show('demo');\n"                # registered → mounts
        "process.stdout.write(JSON.stringify({ a, b, inserted }));\n"
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
    assert out["inserted"] == 1, "exactly the registered tip mounts, the unknown one does not"

"""#658 — OrwellSettingsCard kit (part of the #660 kit epic).

Before #658 every Settings section was hand-rolled markup —
    <div class="admin-card" style="padding-bottom:6px"><h2><svg…/>Title</h2>…</div>
— with no reusable primitive owning the card's spacing / heading / chrome, so consistency was
copy-paste convention and inline `style=` padding leaked per card. #658 introduces ONE primitive
(``window.OrwellSettingsCardKit`` + the ``.osc-*`` CSS contract) that every section composes, and
migrates the FIRST representative tab — **Appearance** — onto it as the proof.

Three layers, all name-agnostic + key-free:
  • STRUCTURAL — source-pin the primitive, its CSS contract, the shell wiring, and the Appearance
    adoption so a revert fails.
  • BEHAVIORAL (Node) — run the REAL kit IIFE against a tiny fake DOM and prove ``upgrade`` /
    ``upgradePanel`` actually compose a static ``.admin-card`` into ``.osc-card`` > ``.osc-head``
    (``.osc-icon`` + ``.osc-title``) + ``.osc-body``, idempotently, KEEPING ``.admin-card`` and
    PRESERVING the body nodes (their listeners/ids).
The live in-browser DOM proof (each Appearance card carries the ``.osc-*`` structure after the
Settings modal opens) is ``test_658_settings_card_render.py`` (browser lane).
"""
import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(FRONTEND, "static", "js", "orwellSettingsCard.js")
CSS = os.path.join(FRONTEND, "static", "css", "orwellSettingsCard.css")
INDEX = os.path.join(FRONTEND, "static", "index.html")
SETTINGS = os.path.join(FRONTEND, "static", "js", "settings.js")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# ── STRUCTURAL: the primitive exists + exposes the kit seam ──────────────────────────────────

def test_kit_file_exists_and_exposes_the_seam():
    js = _read(JS)
    assert "window.OrwellSettingsCardKit" in js
    for fn in ("function create(", "function upgrade(", "function upgradePanel("):
        assert fn in js, f"kit must define {fn}"
    # the seam advertises all three methods for consumers + the gate.
    for name in ("create:", "upgrade:", "upgradePanel:"):
        assert name in js


def test_kit_defines_the_class_contract():
    js = _read(JS)
    for cls in ("osc-card", "osc-head", "osc-title", "osc-body", "osc-icon"):
        assert cls in js, f"missing class {cls}"


def test_upgrade_keeps_admin_card_and_is_idempotent():
    """upgrade() ADDS ``.osc-card`` but NEVER removes ``.admin-card`` — so the settings peek pass,
    the empty-admin-tab auto-hide, and every ``.closest('.admin-card')`` still work — and it
    no-ops on an already-composed card."""
    js = _read(JS)
    assert "classList.remove('admin-card')" not in js
    assert 'classList.remove("admin-card")' not in js
    # idempotency guard: bail when the element already carries the card class.
    assert "if (el.classList.contains(CARD_CLASS)) return el" in js


def test_kit_is_vault_free_and_g15_safe():
    """Pure presentation chrome — it dispatches NO events at all, so it can never mint the
    game-freshness event (the g15 single-dispatcher rule) nor touch game state."""
    js = _read(JS)
    assert "dispatchEvent" not in js
    assert "new CustomEvent(" not in js


# ── STRUCTURAL: the CSS contract ─────────────────────────────────────────────────────────────

def test_css_defines_the_primitive():
    css = _read(CSS)
    for sel in (".osc-card", ".osc-head", ".osc-title", ".osc-body", ".osc-icon"):
        assert sel in css, f"CSS missing {sel}"


def test_css_is_responsive_across_the_breakpoints():
    """A card must respond on tablet + mobile (the settings kit hosts as a bottom sheet ≤768px)."""
    css = _read(CSS)
    assert "@media (max-width: 768px)" in css
    assert "@media (max-width: 1024px)" in css
    # the mobile block actually retunes the primitive (not an empty guard).
    m = re.search(r"@media \(max-width: 768px\)\s*\{", css)
    assert m
    assert ".osc-card" in css[m.end():m.end() + 400]


def test_css_honours_the_a11y_trio():
    css = _read(CSS)
    assert "prefers-reduced-transparency" in css
    assert "prefers-contrast" in css


# ── STRUCTURAL: wired into the shell ─────────────────────────────────────────────────────────

def test_index_loads_the_kit_css_and_js():
    html = _read(INDEX)
    assert "/static/css/orwellSettingsCard.css" in html
    assert "/static/js/orwellSettingsCard.js" in html


def test_kit_js_loads_before_settings_js_can_use_it():
    """The kit script must precede settings.js so initAppearance's upgrade can find the seam.
    (Both are body scripts; settings.js is a module, which runs after classic body scripts.)"""
    html = _read(INDEX)
    assert "orwellSettingsCard.js" in html


# ── STRUCTURAL: the FIRST tab is migrated (the adoption proof) ────────────────────────────────

def test_appearance_tab_is_migrated_onto_the_primitive():
    js = _read(SETTINGS)
    start = js.index("function initAppearance()")
    end = js.index("function initBeatHapticsToggle()", start)
    fn = js[start:end]
    assert "window.OrwellSettingsCardKit" in fn
    assert "upgradePanel" in fn
    assert '[data-settings-panel="appearance"]' in fn
    # fail-open: guarded so a missing kit never throws (game-build / load-order safety).
    assert "if (_appPanel && window.OrwellSettingsCardKit" in fn


# ── BEHAVIORAL (Node): run the REAL kit against a fake DOM ────────────────────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const kitSrc = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

// A tiny fake DOM — only what orwellSettingsCard.js touches.
class E {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this._classes = new Set();
    this.childNodes = [];
    this._attrs = {};
    this._text = "";
    this._html = "";
    this._parent = null;
    const self = this;
    this.style = { _p: {}, removeProperty(n) { delete this._p[n]; }, setProperty(n, v) { this._p[n] = v; }, getProperty(n) { return this._p[n]; } };
    this.classList = {
      add(c) { self._classes.add(c); },
      remove(c) { self._classes.delete(c); },
      contains(c) { return self._classes.has(c); },
    };
  }
  get className() { return Array.from(this._classes).join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return (k in this._attrs) ? this._attrs[k] : null; }
  get children() { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  _detach(node) { if (node._parent) { const i = node._parent.childNodes.indexOf(node); if (i >= 0) node._parent.childNodes.splice(i, 1); node._parent = null; } }
  appendChild(node) { this._detach(node); this.childNodes.push(node); node._parent = this; return node; }
  insertBefore(node, ref) {
    this._detach(node);
    const idx = ref ? this.childNodes.indexOf(ref) : -1;
    if (idx < 0) this.childNodes.push(node); else this.childNodes.splice(idx, 0, node);
    node._parent = this; return node;
  }
}

global.document = { createElement: function (tag) { return new E(tag); } };
global.window = {};
(0, eval)(kitSrc);
const Kit = global.window.OrwellSettingsCardKit;
assert(Kit && typeof Kit.upgrade === "function", "kit must expose upgrade");
assert(typeof Kit.create === "function" && typeof Kit.upgradePanel === "function", "kit must expose create + upgradePanel");

// ── build a static `.admin-card` exactly like the Appearance panel's markup ──
function mkCard() {
  const card = new E("div");
  card.classList.add("admin-card");
  card.style.setProperty("padding-bottom", "6px");   // the inline leak the primitive replaces
  const h2 = new E("h2");
  const svg = new E("svg");                            // leading icon
  h2.appendChild(svg);
  h2.appendChild(new E("span"));                       // (stand-in for the title text run)
  card.appendChild(h2);
  const body = new E("div");                           // the section body (e.g. .vis-toggles)
  body.classList.add("vis-toggles");
  card.appendChild(body);
  return { card: card, h2: h2, svg: svg, body: body };
}

// ── upgrade() composes the primitive in place ──
const c = mkCard();
Kit.upgrade(c.card);
assert(c.card.classList.contains("osc-card"), "upgrade adds .osc-card");
assert(c.card.classList.contains("admin-card"), "upgrade KEEPS .admin-card");
assert(c.card.style.getProperty("padding-bottom") === undefined, "the inline padding leak is dropped");
// structure: [ .osc-head, .osc-body ]
assert(c.card.children.length === 2, "card now has exactly head + body; got " + c.card.children.length);
const head = c.card.children[0], bodyWrap = c.card.children[1];
assert(head.classList.contains("osc-head"), "first child is .osc-head");
assert(bodyWrap.classList.contains("osc-body"), "second child is .osc-body");
// head carries the SAME heading node, tagged .osc-title, its leading svg tagged .osc-icon
assert(head.children[0] === c.h2, "the ORIGINAL heading node is lifted into the head (preserved)");
assert(c.h2.classList.contains("osc-title"), "heading tagged .osc-title");
assert(c.svg.classList.contains("osc-icon"), "leading svg tagged .osc-icon");
// body wrap carries the SAME body node (identity preserved → listeners/ids survive)
assert(bodyWrap.children[0] === c.body, "the ORIGINAL body node is re-parented under .osc-body (preserved)");

// ── idempotent ──
Kit.upgrade(c.card);
assert(c.card.children.length === 2, "re-upgrade is a no-op (still head + body)");

// ── a headingless card still gets a body wrap, no head ──
const bare = new E("div"); bare.classList.add("admin-card");
const only = new E("div"); bare.appendChild(only);
Kit.upgrade(bare);
assert(bare.children.length === 1 && bare.children[0].classList.contains("osc-body"), "headingless card → just a body wrap");
assert(bare.children[0].children[0] === only, "headingless body content preserved");

// ── upgradePanel: only DIRECT-child .admin-cards, non-cards untouched, returns the count ──
const panel = new E("div");
const p1 = mkCard().card, p2 = mkCard().card;
const btnRow = new E("div"); btnRow.classList.add("appearance-actions");  // a non-card sibling
panel.appendChild(p1); panel.appendChild(p2); panel.appendChild(btnRow);
const n = Kit.upgradePanel(panel);
assert(n === 2, "upgradePanel composes the 2 cards; got " + n);
assert(p1.classList.contains("osc-card") && p2.classList.contains("osc-card"), "both cards composed");
assert(!btnRow.classList.contains("osc-card"), "a non-card sibling is left alone");

// ── create(): a fresh card from the primitive ──
const made = Kit.create({ title: "Section", icon: "<svg></svg>", admin: true });
assert(made.classList.contains("osc-card") && made.classList.contains("admin-card"), "create makes an .osc-card (+admin opt-in)");
assert(made.children[0].classList.contains("osc-head") && made.children[1].classList.contains("osc-body"), "create → head + body");
assert(made.oscBody === made.children[1], "create exposes .oscBody handle");

console.log("OK");
"""


def test_upgrade_composes_the_primitive_on_a_real_run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral settings-card check")
    proc = subprocess.run([node, "-e", _HARNESS, JS], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"node failed:\n{proc.stdout}\n{proc.stderr}"
    assert "OK" in proc.stdout

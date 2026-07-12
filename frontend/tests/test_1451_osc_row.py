"""#1451 — the `.osc-row` form-row primitive (follow-on to #658, the OrwellSettingsCard kit).

#658 shipped the card/section primitive (`.osc-card` > `.osc-head`/`.osc-title`/`.osc-body`) and
migrated every settings tab onto it. The one named acceptance criterion still open was a **form-row
primitive** `.osc-row` (a label/description on one side, a control/toggle on the other) so settings
rows are composed FROM the kit instead of hand-rolled `<div class="settings-row">…</div>` per tab.

The design mirrors the card exactly, and is provably **pixel-neutral**:
  • `.osc-row` mirrors the legacy `.settings-row` (style.css) BYTE-FOR-BYTE (display:flex /
    align-items:center / gap:8px), so a migrated row carrying BOTH classes computes identically.
  • migration KEEPS `.settings-row` and only ADDS `.osc-row` in place (upgradeRow/scanRows) — a
    class-only change; no node / id / listener / ARIA touched — exactly like upgrade() KEEPS
    `.admin-card` beside `.osc-card`.

Layers (all name-agnostic + key-free), matching test_658_settings_card_kit.py:
  • STRUCTURAL — source-pin the primitive (JS seam + CSS contract), the pixel-neutral mirror, and
    the settings-shell wiring so a revert fails.
  • BEHAVIORAL (Node) — run the REAL kit IIFE against a tiny fake DOM and prove row() builds a
    `.settings-row .osc-row`, and upgradeRow()/scanRows() compose existing `.settings-row` markup
    onto the primitive idempotently, KEEPING `.settings-row`.
"""
import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(FRONTEND, "static", "js", "orwellSettingsCard.js")
CSS = os.path.join(FRONTEND, "static", "css", "orwellSettingsCard.css")
STYLE = os.path.join(FRONTEND, "static", "style.css")
SETTINGS = os.path.join(FRONTEND, "static", "js", "settings.js")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _css_block(css, selector):
    """Return the declaration body of the first `selector {...}` rule (no nesting inside)."""
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"CSS rule {selector} not found"
    return m.group(1)


def _decls(body):
    """Normalise a declaration body into a set of `prop:value` (whitespace-insensitive)."""
    out = set()
    for part in body.split(";"):
        part = part.strip()
        if not part or ":" not in part:
            continue
        prop, val = part.split(":", 1)
        out.add(prop.strip() + ":" + re.sub(r"\s+", " ", val.strip()))
    return out


# ── STRUCTURAL: the primitive exists + exposes the kit seam ──────────────────────────────────

def test_kit_exposes_the_row_seam():
    js = _read(JS)
    for fn in ("function row(", "function upgradeRow(", "function scanRows("):
        assert fn in js, f"kit must define {fn}"
    for name in ("row:", "upgradeRow:", "scanRows:", "ROW_CLASS:"):
        assert name in js, f"seam must advertise {name}"


def test_kit_defines_the_row_class_contract():
    js = _read(JS)
    assert "'osc-row'" in js or '"osc-row"' in js
    # the legacy class is kept, not replaced (like `.admin-card` beside `.osc-card`).
    assert "'settings-row'" in js or '"settings-row"' in js


def test_upgrade_row_keeps_the_legacy_class_and_is_idempotent():
    """upgradeRow() ADDS `.osc-row` but NEVER removes `.settings-row` (its style.css layout is what
    keeps the migration pixel-neutral + preserves every legacy `.settings-row` modifier/selector),
    and no-ops when the row already carries the primitive class."""
    js = _read(JS)
    assert "classList.remove('settings-row')" not in js
    assert 'classList.remove("settings-row")' not in js
    assert "if (!el.classList.contains(ROW_CLASS)) el.classList.add(ROW_CLASS)" in js


def test_kit_stays_g15_safe_and_vault_free():
    """The row additions dispatch NO events — the kit can never mint the game-freshness event (the
    g15 single-dispatcher rule) nor touch game state."""
    js = _read(JS)
    assert "dispatchEvent" not in js
    assert "new CustomEvent(" not in js


# ── STRUCTURAL: the CSS contract + the pixel-neutral mirror ──────────────────────────────────

def test_css_defines_the_row_primitive():
    css = _read(CSS)
    for sel in (".osc-row", ".osc-row--end", ".osc-row--between"):
        assert sel in css, f"CSS missing {sel}"


def test_osc_row_mirrors_settings_row_byte_for_byte():
    """Pixel-neutrality proof: `.osc-row` must declare EXACTLY the same layout as the legacy
    `.settings-row` (style.css). Both classes co-exist on a migrated row (equal specificity), so
    identical declarations ⇒ identical computed style regardless of cascade order. If someone
    retunes one and not the other, the migration stops being pixel-neutral and this fails."""
    osc = _decls(_css_block(_read(CSS), ".osc-row"))
    legacy = _decls(_css_block(_read(STYLE), ".settings-row"))
    assert osc == legacy, f"`.osc-row` diverged from `.settings-row`: osc={osc} legacy={legacy}"
    # and the two modifiers mirror too.
    assert _decls(_css_block(_read(CSS), ".osc-row--end")) == \
        _decls(_css_block(_read(STYLE), ".settings-row--end"))
    assert _decls(_css_block(_read(CSS), ".osc-row--between")) == \
        _decls(_css_block(_read(STYLE), ".settings-row--between"))


# ── STRUCTURAL: wired into the settings shell (the migration) ────────────────────────────────

def test_swap_to_panel_composes_the_rows_onto_the_primitive():
    """Every tab activation funnels through `_swapToPanel`; that ONE seam now composes both the
    shown panel's CARDS (#658) and its ROWS (#1451) from the kit — so account / the admin panels /
    the JS-built verticals all migrate without churning each tab's row markup."""
    js = _read(SETTINGS)
    assert "function _upgradeSettingsRows(" in js, "the row-migration helper must exist"
    start = js.index("function _swapToPanel(")
    end = js.index("function activateTab(", start)
    swap = js[start:end]
    assert "_upgradeSettingsRows(" in swap, "_swapToPanel must compose the shown panel's rows"


def test_row_migration_helper_keeps_legacy_class_and_is_g15_safe():
    js = _read(SETTINGS)
    start = js.index("function _upgradeSettingsRows(")
    end = js.index("function _swapToPanel(", start)
    fn = js[start:end]
    assert "window.OrwellSettingsCardKit" in fn
    assert "scanRows" in fn, "the helper composes via the kit's scanRows seam"
    # never removes the legacy class (the kit keeps it; the helper must not undo that).
    assert "remove('settings-row')" not in fn and 'remove("settings-row")' not in fn
    # g15: pure presentation — dispatches nothing.
    assert "dispatchEvent" not in fn and "new CustomEvent(" not in fn
    # fail-open: a missing kit is a no-op, never a throw; and adds no inline style.
    assert "typeof Kit.scanRows !== 'function'" in fn or "!Kit" in fn
    assert 'style="' not in fn, "the row migration is class-only — no inline style (A3 ratchet)"


# ── BEHAVIORAL (Node): run the REAL kit against a fake DOM ────────────────────────────────────

_HARNESS = r"""
const fs = require("node:fs");
const kitSrc = fs.readFileSync(process.argv[1], "utf8");
function assert(c, m) { if (!c) { throw new Error("ASSERT: " + m); } }

// A tiny fake DOM — only what orwellSettingsCard.js touches, plus a minimal single-class
// querySelectorAll('.foo') for scanRows().
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
    this.id = "";
    const self = this;
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
  appendChild(node) { this.childNodes.push(node); node._parent = this; return node; }
  querySelectorAll(sel) {
    const cls = String(sel).replace(/^\./, "");
    const out = [];
    (function walk(node) {
      for (const ch of node.children) { if (ch._classes.has(cls)) out.push(ch); walk(ch); }
    })(this);
    return out;
  }
}

global.document = { createElement: function (tag) { return new E(tag); } };
global.window = {};
(0, eval)(kitSrc);
const Kit = global.window.OrwellSettingsCardKit;
assert(Kit && typeof Kit.row === "function", "kit must expose row");
assert(typeof Kit.upgradeRow === "function" && typeof Kit.scanRows === "function", "kit must expose upgradeRow + scanRows");

// ── row(): a fresh row from the primitive KEEPS the legacy class ──
const r1 = Kit.row({ label: "Provider" });
assert(r1.classList.contains("settings-row"), "row() KEEPS .settings-row (legacy styling)");
assert(r1.classList.contains("osc-row"), "row() adds .osc-row");
assert(r1.children.length === 1 && r1.children[0].tagName === "LABEL", "row() mints a .settings-label");
assert(r1.children[0].classList.contains("settings-label"), "the label carries .settings-label");
assert(r1.children[0].textContent === "Provider", "the label text is set");

// ── row(): controlEl is appended after the label ──
const ctrl = new E("select");
const r2 = Kit.row({ label: "Model", controlEl: ctrl });
assert(r2.children.length === 2 && r2.children[1] === ctrl, "row() appends the control node");

// ── row(): align + className modifiers ──
const r3 = Kit.row({ align: "end", className: "settings-gap-top-sm" });
assert(r3.classList.contains("osc-row--end"), "align:end → .osc-row--end");
assert(r3.classList.contains("settings-gap-top-sm"), "className extras are added");
const r4 = Kit.row({ align: "between" });
assert(r4.classList.contains("osc-row--between"), "align:between → .osc-row--between");

// ── row(): html builds the whole inner row (mirrors create()'s bodyHtml) ──
const r5 = Kit.row({ html: "<label class=\"settings-label\">X</label><input>" });
assert(r5.innerHTML.indexOf("settings-label") >= 0, "row({html}) sets the inner markup");

// ── upgradeRow(): compose an EXISTING hand-rolled `.settings-row` in place, idempotent ──
const legacy = new E("div"); legacy.classList.add("settings-row"); legacy.classList.add("settings-row--end");
Kit.upgradeRow(legacy);
assert(legacy.classList.contains("osc-row"), "upgradeRow adds .osc-row");
assert(legacy.classList.contains("settings-row"), "upgradeRow KEEPS .settings-row");
assert(legacy.classList.contains("settings-row--end"), "upgradeRow KEEPS legacy modifiers");
Kit.upgradeRow(legacy);
assert(legacy.className.split(" ").filter(c => c === "osc-row").length === 1, "upgradeRow is idempotent");

// ── scanRows(): compose every `.settings-row` under a root (incl. nested), returns the count ──
const panel = new E("div");
const a = new E("div"); a.classList.add("settings-row");
const b = new E("div"); b.classList.add("settings-row");
const nestWrap = new E("div"); const c = new E("div"); c.classList.add("settings-row");
nestWrap.appendChild(c);
const notARow = new E("div"); notARow.classList.add("appearance-actions");
panel.appendChild(a); panel.appendChild(b); panel.appendChild(nestWrap); panel.appendChild(notARow);
const n = Kit.scanRows(panel);
assert(n === 3, "scanRows composes all 3 rows (incl. nested); got " + n);
assert(a.classList.contains("osc-row") && b.classList.contains("osc-row") && c.classList.contains("osc-row"), "every row composed");
assert(!notARow.classList.contains("osc-row"), "a non-row sibling is left alone");

console.log("OK");
"""


def test_row_primitive_composes_on_a_real_run():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral osc-row check")
    proc = subprocess.run([node, "-e", _HARNESS, JS], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"node failed:\n{proc.stdout}\n{proc.stderr}"
    assert "OK" in proc.stdout

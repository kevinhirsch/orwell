"""#1638 — THE ANTI-FRAGMENTATION RATCHET for bespoke menus / dropdowns / popovers.

The #1638 campaign migrated every bespoke floating menu/dropdown/popover onto the shared
OrwellMenuKit / OrwellPopoverKit (last consumer: the model picker, #1677), and the dead-CSS
sweep retired the orphaned legacy rules (`.overflow-menu`, `.model-picker-menu`, the
`.sort-dropdown`/`.adm-provider-menu`/`.ctx-popup` frames …). This gate FREEZES that end state
so the fragmentation cannot grow back: no module may hand-roll a NEW bespoke menu-family
SURFACE — an element given a `*-menu` / `*-dropdown` / `*-popover` / `*-popup` class via
`element.className = …` or `classList.add(…)` — instead of composing the kit (whose surfaces
carry the `ow-*` family).

A failure here is the campaign's finding regrowing. Build the surface through the kit instead:
  • action menus / kebab / overflow / sort  → `window.OrwellMenuKit.open(...)` / `.attach(...)`
  • pickers / info popovers                  → `window.OrwellPopoverKit.open(...)`
The kit body-appends its OWN `.ow-popover` / `.ow-menu` chrome and owns anchoring, flip/shift
positioning, and dismissal — so a kit consumer never mints a bespoke `*-menu`/`*-dropdown`/
`*-popover` root (it uses `ow-*`, which this gate excludes by construction).

── scope + method ──────────────────────────────────────────────────────────────────────────────
A static SOURCE scan over `static/js/**/*.js` for the CREATION signature (`className = '…'` /
`classList.add('…')`), mirroring the F-3 window ratchet (test_f3_window_ratchet.py) and the
universal orphan-chrome ratchet (test_1454_orphan_chrome_ratchet.py). innerHTML `class="…"`
templates are deliberately OUT of scope: the convention that matters is that a hand-rolled menu
ELEMENT is built via createElement + a class, and scanning innerHTML would demand a large
inherited-workspace allowlist for game-build-DROPPED menus (task/note/skill/doclib/email
dropdowns) with no game-surface payoff. The runtime companion (every live menu surface is
kit-managed) is proven by browser_smoke.py.

The `ow-*` kit family is excluded by construction (it IS the kit). Everything else must be an
explicitly ALLOW-LISTED survivor (below). A NEW bespoke menu class fails.
"""
import os
import re
import glob

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")


# The bespoke floating-menu family: a class TOKEN whose ROOT ends in one of these suffixes is a
# menu / dropdown / popover / popup SURFACE. The trailing `$` keeps it to the surface ROOT — a menu
# PART or TRIGGER (`*-menu-item`, `*-menu-btn`, `*-menu-sep`, `*-menu-label`, `*-dropdown-item`) is
# not a surface family and is correctly NOT flagged (its own kit/legacy chrome owns it). A bare
# generic token (`dropdown`, `menu`, `popover`) is likewise not the bespoke family — the live
# `.dropdown` chrome survives — so a PREFIX is required (`-` before the suffix).
_FAMILY_SUFFIX = re.compile(r"-(?:menu|dropdown|popover|popup)$")


# ── the survivor allowlist (shrink-only) ───────────────────────────────────────────────────────
# Exact class tokens that legitimately end in a menu-family suffix but are NOT a bespoke floating
# action-menu the kit should own. Each is documented with a reason; a stale entry is caught by
# test_created_menu_classes_are_exactly_the_allowlist_today. A NEW token anywhere still fails.
ALLOWED_MENU_CLASSES = {
    # cp-popover — the color-picker CONTENT node, body-appended INSIDE the kit's `.ow-popover`
    # surface (colorPicker.js composes OrwellPopoverKit; test_1638_pickers.py pins the migration).
    # It is inner content riding the kit, not a hand-rolled floating menu; its frame folded onto
    # `.ow-popover`, and it stays off the SVG-refraction SELECTORS set.
    "cp-popover",
    # slash-autocomplete-popup — the slash-command typeahead/autocomplete popup
    # (slashAutocomplete.js). An autocomplete surface is a distinct interaction pattern from an
    # action menu (keyboard-driven completion over a query, not a click menu); inherited composer
    # chrome, not an OrwellMenuKit/OrwellPopoverKit consumer.
    "slash-autocomplete-popup",
}


# ── extraction: the class TOKENS a source CREATES via className / classList.add ─────────────────
# `className = '…' | "…" | `…`` (assignment; a COMPARISON `=== '…'` never matches — the alternation
# needs a quote immediately after the single `=`, which `===`/`==`/`!=` do not provide).
_CLASSNAME_ASSIGN = re.compile(r"""className\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)""")
_CLASSLIST_ADD = re.compile(r"""classList\.add\(([^)]*)\)""")
_QUOTED = re.compile(r"""['"`]([^'"`]+)['"`]""")


def _is_bespoke_menu_token(tok):
    """A class token that is a bespoke (non-kit) menu-family SURFACE root."""
    return bool(_FAMILY_SUFFIX.search(tok)) and not tok.startswith("ow-")


def _created_menu_classes(src):
    """Every bespoke menu-family class token `src` creates via `element.className = '…'` or
    `classList.add('…')`. Returns a set of tokens (kit `ow-*` + menu parts/triggers excluded)."""
    tokens = set()
    for m in _CLASSNAME_ASSIGN.finditer(src):
        literal = m.group(1) or m.group(2) or m.group(3) or ""
        for tok in literal.split():
            if _is_bespoke_menu_token(tok):
                tokens.add(tok)
    for m in _CLASSLIST_ADD.finditer(src):
        for tok in _QUOTED.findall(m.group(1)):
            if _is_bespoke_menu_token(tok):
                tokens.add(tok)
    return tokens


def _js_files():
    return sorted(glob.glob(os.path.join(JS_DIR, "**", "*.js"), recursive=True))


def _read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def _all_created_menu_classes():
    """{relpath -> {token, …}} for every static/js module that creates a bespoke menu-family class."""
    out = {}
    for f in _js_files():
        toks = _created_menu_classes(_read(f))
        if toks:
            out[os.path.relpath(f, JS_DIR)] = toks
    return out


def _created_union():
    created = _all_created_menu_classes()
    return set().union(*created.values()) if created else set()


# ── THE GATE ────────────────────────────────────────────────────────────────────────────────────


def test_no_new_bespoke_menu_class():
    """The ratchet: no module may hand-roll a NEW bespoke `*-menu`/`*-dropdown`/`*-popover`/
    `*-popup` surface via className/classList — compose the kit instead."""
    rogue = {
        name: sorted(toks - ALLOWED_MENU_CLASSES)
        for name, toks in _all_created_menu_classes().items()
        if toks - ALLOWED_MENU_CLASSES
    }
    assert not rogue, (
        "NEW bespoke menu/dropdown/popover surface(s) hand-rolled via className/classList instead "
        f"of composing the kit: {rogue}. Build action menus through window.OrwellMenuKit.open(...) / "
        ".attach(...) and pickers / info popovers through window.OrwellPopoverKit.open(...) — the kit "
        "body-appends its own `.ow-popover`/`.ow-menu` chrome and owns anchoring + dismissal, so it "
        "never mints a bespoke `*-menu` root (#1638). If this is a genuine non-menu survivor (a "
        "typeahead/autocomplete popup, or a content node riding the kit's `.ow-popover`), add its "
        "exact class token to ALLOWED_MENU_CLASSES with a reason (shrink-only)."
    )


def test_created_menu_classes_are_exactly_the_allowlist_today():
    """Green-on-main invariant, stated positively so BOTH a new bespoke menu AND a stale allowlist
    entry are a loud failure: the set of created menu-family classes == the allowlist."""
    created = _created_union()
    assert created == ALLOWED_MENU_CLASSES, (
        "the set of created menu-family classes drifted from the allowlist — "
        f"unexpected (new bespoke menu?): {sorted(created - ALLOWED_MENU_CLASSES)}; "
        f"stale allowlist (survivor removed?): {sorted(ALLOWED_MENU_CLASSES - created)}"
    )


# ── the gate is real, not vacuous: RED on an injected bespoke menu ───────────────────────────────

# A synthetic brand-new bespoke menu a future PR might hand-roll instead of composing the kit.
_SYNTHETIC_ROGUE = """
  // a bespoke dropdown a future PR might hand-roll instead of OrwellMenuKit.open(...)
  function mountRogueMenu() {
    const m = document.createElement('div');
    m.className = 'roguetool-dropdown open';
    m.innerHTML = '<div>hand-rolled</div>';
    document.body.appendChild(m);
  }
"""


def test_gate_is_red_on_an_injected_bespoke_menu():
    """Prove the SAME classifier + rogue-set logic the live gate uses flags a hand-rolled menu.
    If this ever passes vacuously, the ratchet is worthless — this is the permanent in-suite proof."""
    toks = _created_menu_classes(_SYNTHETIC_ROGUE)
    assert "roguetool-dropdown" in toks, "the classifier did not recognise a hand-rolled dropdown"
    assert toks - ALLOWED_MENU_CLASSES, "the gate would NOT fail on a new bespoke menu — it is vacuous"


def test_classifier_semantics():
    """Pin the classifier's discriminations directly (mirrors F-3's signature self-test)."""
    # bespoke menu-family SURFACE roots ARE flagged, in any class position / creation form →
    for s in (
        "x.className = 'foo-menu';",
        "x.className = 'foo-dropdown';",
        "x.className = 'foo-popover';",
        "x.className = 'foo-popup';",
        "x.className = 'a foo-dropdown b';",     # not the leading class
        "x.classList.add('foo-menu');",
        "x.classList.add('a', 'foo-popover');",  # not the first arg
        "x.className = `foo-menu ${state}`;",    # template literal
    ):
        assert _created_menu_classes(s), f"missed a bespoke menu surface: {s!r}"
    # the kit's ow-* family is NOT a bespoke menu (it IS the kit) →
    for s in (
        "x.className = 'ow-popover';",
        "x.className = 'ow-menu';",
        "x.className = 'ow-menu-item ow-menu-item-danger';",
        "x.classList.add('ow-popover');",
    ):
        assert not _created_menu_classes(s), f"false-flagged a kit class: {s!r}"
    # menu PARTS / TRIGGERS (a row / separator / label / button, not a surface root) are NOT flagged →
    for s in (
        "x.className = 'hamburger session-menu-btn';",   # a kebab TRIGGER button
        "x.className = 'foo-menu-item';",                 # a menu row
        "x.className = 'foo-dropdown-item active';",      # a dropdown row
        "x.className = 'foo-menu-sep';",                  # a separator
        "x.className = 'foo-menu-label';",                # an inner label
    ):
        assert not _created_menu_classes(s), f"false-flagged a menu part/trigger: {s!r}"
    # a BARE generic token is not the bespoke family (the live `.dropdown` chrome survives) →
    for s in ("x.className = 'dropdown';", "x.className = 'menu';", "x.className = 'popover open';"):
        assert not _created_menu_classes(s), f"false-flagged a bare generic token: {s!r}"
    # a COMPARISON is not a CREATION →
    for s in (
        "if (el.className === 'foo-menu') return;",
        "if (el.className == 'foo-dropdown') {}",
        "if (el.className != 'foo-popover') {}",
    ):
        assert not _created_menu_classes(s), f"false-flagged a comparison as a creation: {s!r}"


def test_allowlist_is_small_and_documented():
    """The allowlist stays a small, curated set of survivors (task DoD: 'a small ALLOWLIST … with a
    comment per entry'). A ballooning allowlist means the ratchet is being routed around."""
    assert len(ALLOWED_MENU_CLASSES) <= 6, (
        f"the survivor allowlist has grown to {sorted(ALLOWED_MENU_CLASSES)} — a new bespoke menu "
        "should compose the kit, not be allow-listed. Keep this set small and each entry justified."
    )

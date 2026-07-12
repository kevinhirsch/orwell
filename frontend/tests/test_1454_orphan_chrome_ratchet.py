"""#1454 (follow-up to #737) — THE UNIVERSAL ORPHAN-CHROME RATCHET.

#737 shipped the player-tier surface registry (`surface_registry.json`) + two gates:
  • the SOURCE drift-guard (test_737_surface_registry.py) — but it only keeps the set
    of `window.Orwell*Kit = {` composition seams in lock-step with the manifest; and
  • the RUNTIME census (browser_smoke.py, "#737 runtime") — but it only sees a surface
    that (a) actually MOUNTS during the smoke and (b) already follows the kit convention
    (a boolean `data-<ns>-*` marker + `<ns>-*` primary class + anatomy).

Both therefore share ONE blind spot, which test_737 itself flags (it does NOT implement a
universal scan): a brand-new **orphan surface family** — bespoke floating chrome hand-rolled
from scratch, composing NO registered kit, exposing NO `window.Orwell*Kit` seam, stamping NO
`data-<ns>-*` marker — slips past unregistered and unnoticed (and, if it never mounts in the
smoke run, is invisible to the runtime census too).

THIS is the missing universal scan: a SINGLE static source gate that fails on ANY un-registered
bespoke chrome. It mirrors the #737 infra's own lean (a source regex over `static/js` against
the manifest, exactly like test_737 + the F-3 window ratchet) rather than the runtime DOM census,
because the guarantee we want — "a new orphan chrome family cannot be INTRODUCED without either
composing a registered kit or being explicitly registered" — is a source-time property that must
hold whether or not the orphan happens to mount in a given smoke run.

── how it works ──────────────────────────────────────────────────────────────────────────────
A "surface family" is reusable FLOATING CHROME (a window / card / panel / sheet / notice that
floats over content). In this codebase every such family is authored by giving an element
`position: fixed` — via a `.cssText` string, an injected `<style>` rule, or an inline template
`style=` — and only the registered kits (orwellWindow / orwellNotice / orwellSheet …) do that.

So the scan enumerates every `static/js` module that AUTHORS a floating surface and requires each
to be exactly one of:
  1. a REGISTERED kit/component source file (its `file` in surface_registry.json) — it IS a kit;
  2. an explicitly ALLOW-LISTED non-surface floater (below) — a `position: fixed` element that is
     NOT a reusable surface family (a clipboard copy-helper, a drag/snap guide, a decorative
     background, a HUD strip, a single FAB control, a legacy one-off toast, an inherited-workspace
     tour tooltip). These are recognised two ways: the decisive, structural ones are EXCLUDED by
     signature (see `_NON_SURFACE`) so they need no allowlist at all; the few surface-shaped
     residuals are named in `ALLOWED_NON_SURFACE_FLOATERS` with a reason (shrink-only).
Anything else FAILS: a new module that floats bespoke chrome and neither composes a kit nor is
registered must either compose `OrwellWindowKit`/`OrwellNoticeKit`/`OrwellSheetKit`/… (in which
case it wouldn't hand-roll `position: fixed`) or be registered.

Scope = `static/js/**/*.js`, matching its two sibling #737 gates (test_737 + browser_smoke) and
the F-3 ratchet. Surface FAMILIES are JS-authored kits — the registry's own scope; the handful of
`position: fixed` nodes in the HTML shell (the boot loader, the wallpaper, the login-page canvas)
are one-off page scaffolding, not reusable chrome families, and are out of scope by that same
design (they define no `-card`/`-panel`/`-window` family and compose nothing).
"""
import os
import re
import glob
import json

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")
TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(TESTS_DIR, "surface_registry.json")

# The floating-surface signature: a CSS `position: fixed` (colon form) — how every real surface
# family here is authored (cssText strings, injected <style> rules, inline template style=).
# The JS `el.style.position = 'fixed'` ASSIGNMENT form (no colon) is deliberately NOT this — it
# only ever REPOSITIONS an already-built element (e.g. tileManager re-homing an existing modal),
# it never AUTHORS chrome.
_POSITION_FIXED = re.compile(r"position\s*:\s*fixed", re.I)

# Signatures that make a `position: fixed` element decisively NOT a reusable surface family. Any
# one of these in the same rule/construction ⇒ excluded with no allowlist needed:
#   • pointer-events:none — a non-interactive overlay (drag/snap guides, HUD strips, decorative bg);
#   • z-index:-… — painted BEHIND content (wallpapers, background canvases);
#   • parked off-screen (-9999px, or a 1×1 box) — clipboard/copy helpers, never seen.
_NON_SURFACE = re.compile(
    r"pointer-events\s*:\s*none"
    r"|z-index\s*:\s*-"
    r"|-9999px"
    r"|1px\s*;\s*height\s*:\s*1px",
    re.I,
)

# ── the shrink-only allowlist: surface-SHAPED `position: fixed` that is NOT a family ───────────
# These float and look surface-ish to the signature but are single-purpose primitives, not a
# reusable chrome family the registry should index. Each is a documented, shrink-only exception
# (mirroring the F-3 ratchet's GRANDFATHERED_* sets). A NEW author elsewhere still fails; a stale
# entry here is caught by test_allowlisted_floaters_are_still_live.
ALLOWED_NON_SURFACE_FLOATERS = {
    # The scroll-to-bottom FAB (`#osb`, a 38px round button anchored above the composer). A single
    # control, not a windowed surface — it composes no chrome/head/body. (orwellScrollBottom.js)
    "orwellScrollBottom.js",
    # A legacy fallback error toast (`#_attach-toast`) for a failed attach. A one-off transient
    # notice — a candidate to migrate onto OrwellNoticeKit's toast, but not a surface family today.
    "fileHandler.js",
    # The inherited-workspace onboarding "tour" tooltip (`#tour-tooltip`). Inherited (non-player-
    # tier) chrome, game-build-dropped (tourHints/tourAutoplay are not served); not a game surface.
    "slashCommands.js",
}


def _js_files():
    return sorted(glob.glob(os.path.join(JS_DIR, "**", "*.js"), recursive=True))


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _live_sources():
    """{relpath -> source} for every static/js module."""
    return {os.path.relpath(f, JS_DIR): _read(f) for f in _js_files()}


def _registered_kit_files():
    """Every surface-family SOURCE file the manifest registers (its `file` / `css_source`),
    restricted to `.js` — the set of modules that legitimately AUTHOR floating chrome (they ARE
    the kits). Derived from surface_registry.json so a newly-registered kit is auto-allowed."""
    with open(MANIFEST, encoding="utf-8") as fh:
        reg = json.load(fh)
    out = set()
    for fam in reg.get("families", []):
        for key in ("file", "css_source"):
            v = fam.get(key) or ""
            if v.endswith(".js"):
                out.add(os.path.basename(v))
    return out


def _is_comment(src, idx):
    """True if the match at `idx` is inside a `//` line comment or a `/* … */` block comment —
    so a PROSE mention of `position:fixed` (e.g. orwellSlots.js's "// a top system-banner …
    position:fixed …") is never mistaken for authoring chrome."""
    line_start = src.rfind("\n", 0, idx) + 1
    prefix = src[line_start:idx].replace("://", "")   # keep `https://` out of the `//` test
    if "//" in prefix:
        return True
    return src.rfind("/*", 0, idx) > src.rfind("*/", 0, idx)


def _neutralize_interp(src):
    """Blank out `${…}` template interpolations (length-preserving, so match indices are stable).
    Their braces are NOT CSS rule delimiters — leaving them in would let the `}` inside `${edge}`
    truncate a rule's construction unit before its exclusion marker (modalSnap's snap-guide sets
    `position:fixed;${edge};…;pointer-events:none` on one line; the `}` of `${edge}` would hide the
    `pointer-events:none` and false-flag a legit drag guide)."""
    return re.sub(r"\$\{[^{}]*\}", lambda m: "_" * len(m.group(0)), src)


def _unit(src, idx, radius=400):
    """The construction unit around a `position: fixed` match, used for the non-surface signature
    check. Scoped to the enclosing CSS rule / cssText string: clipped at the nearest `}` on each
    side so an ADJACENT rule's exclusion marker can't mask (or be masked by) this one. The 400-char
    radius comfortably spans a multi-fragment concatenated `.cssText` (windowDrag's guide sets
    position:fixed ~220 chars before its pointer-events:none). Callers pass interpolation-neutralized
    source (see `_neutralize_interp`) so a `${…}` brace is never mistaken for a rule close."""
    lo, hi = max(0, idx - radius), min(len(src), idx + radius)
    rel = idx - lo
    seg = src[lo:hi]
    prev_close = seg.rfind("}", 0, rel)
    if prev_close != -1:
        seg, rel = seg[prev_close + 1:], rel - (prev_close + 1)
    next_close = seg.find("}", rel)
    if next_close != -1:
        seg = seg[: next_close + 1]
    return seg


def _surface_authoring_files(sources):
    """{relpath -> [snippet, …]} for every module in `sources` that AUTHORS a floating surface:
    a non-comment `position: fixed` construction that carries no non-surface signature."""
    out = {}
    for name, raw in sources.items():
        src = _neutralize_interp(raw)
        for m in _POSITION_FIXED.finditer(src):
            i = m.start()
            if _is_comment(src, i):
                continue
            if _NON_SURFACE.search(_unit(src, i)):
                continue
            out.setdefault(name, []).append(_unit(src, i).strip()[:140])
    return out


# ── THE GATE ──────────────────────────────────────────────────────────────────────────────────


def test_no_unregistered_bespoke_surface_chrome():
    """The universal ratchet: EVERY module that authors floating surface chrome must be a
    registered kit or an allow-listed non-surface floater. A new orphan family fails here."""
    authors = _surface_authoring_files(_live_sources())
    kits = _registered_kit_files()
    rogue = {n: s for n, s in authors.items()
             if n not in kits and n not in ALLOWED_NON_SURFACE_FLOATERS}
    assert not rogue, (
        "NEW un-registered bespoke surface chrome (hand-rolled `position: fixed` floating "
        f"surface) in {sorted(rogue)} — a surface family must COMPOSE a registered kit "
        "(OrwellWindowKit / OrwellNoticeKit / OrwellSheetKit / …, so it never hand-rolls "
        "position:fixed) or be REGISTERED in surface_registry.json (#737). If it is a genuine "
        "non-surface floater (a copy-helper / drag guide / decorative bg / single control), give "
        "its root pointer-events:none / z-index:-1 / off-screen, or add it to "
        f"ALLOWED_NON_SURFACE_FLOATERS with a reason. Offending snippets: {rogue}"
    )


# ── the gate is real, not vacuous: RED on an injected orphan ────────────────────────────────────

# A synthetic brand-new orphan surface family: a hand-rolled floating panel with head/body chrome,
# interactive, painted OVER content — composing no kit, registered nowhere. This is exactly the
# regression the gate exists to refuse.
_SYNTHETIC_ORPHAN = """
  // orphan chrome family a future PR might hand-roll instead of composing a kit
  function mountRoguePanel() {
    const p = document.createElement('div');
    p.className = 'rogue-panel';
    p.style.cssText = 'position:fixed;top:24px;right:24px;width:320px;'
      + 'background:var(--panel);border:1px solid var(--border);border-radius:10px;z-index:5000;';
    p.innerHTML = '<div class="rogue-head">Bespoke</div><div class="rogue-body">chrome</div>';
    document.body.appendChild(p);
  }
"""


def test_gate_is_red_on_an_injected_orphan_family():
    """Inject a synthetic orphan surface into the source map and prove the SAME classifier +
    rogue-set logic the live gate uses flags it. If this ever passes vacuously, the ratchet is
    worthless — this is the permanent in-suite proof that it is not."""
    sources = _live_sources()
    sources["orwellRogueChrome.js"] = _SYNTHETIC_ORPHAN
    authors = _surface_authoring_files(sources)
    assert "orwellRogueChrome.js" in authors, (
        "the classifier did not recognise a hand-rolled floating panel as surface chrome"
    )
    rogue = set(authors) - _registered_kit_files() - ALLOWED_NON_SURFACE_FLOATERS
    assert "orwellRogueChrome.js" in rogue, (
        "the gate would NOT fail on a new orphan family — it is vacuous"
    )


def test_classifier_semantics():
    """Pin the classifier's discriminations directly (mirrors F-3's signature self-test)."""
    surf = ("p.style.cssText='position:fixed;top:20px;right:20px;width:320px;"
            "background:var(--panel);z-index:5000';")
    # a floating, interactive panel with chrome IS a surface family →
    assert "x.js" in _surface_authoring_files({"x.js": surf})
    # the SAME panel made non-interactive (a guide/overlay) is correctly NOT a family →
    guide = surf.replace("z-index:5000", "z-index:5000;pointer-events:none")
    assert "x.js" not in _surface_authoring_files({"x.js": guide})
    # off-screen copy helper / decorative background are excluded by signature →
    assert "x.js" not in _surface_authoring_files({"x.js": "t.style.cssText='position:fixed;left:-9999px';"})
    assert "x.js" not in _surface_authoring_files({"x.js": "t.style.cssText='position:fixed;width:1px;height:1px;opacity:0';"})
    assert "x.js" not in _surface_authoring_files({"x.js": "c.style.cssText='position:fixed;inset:0;z-index:-1;'"})
    # a PROSE mention of position:fixed is not authoring (the orwellSlots.js case) →
    assert "x.js" not in _surface_authoring_files({"x.js": "  // a top banner is position:fixed here\n"})
    assert "x.js" not in _surface_authoring_files({"x.js": "  /* position:fixed reserves height */\n"})
    # an ADJACENT excluded rule must not mask a genuine surface rule (rule-scoped unit) →
    two_rules = ("s.textContent = '#guide{position:fixed;inset:0;pointer-events:none}'"
                 " + '#panel{position:fixed;top:10px;width:300px;background:var(--panel);z-index:9}';")
    assert "x.js" in _surface_authoring_files({"x.js": two_rules})


# ── the allowlist / kit set stay honest ─────────────────────────────────────────────────────────


def test_allowlisted_floaters_are_still_live():
    """Every ALLOWED_NON_SURFACE_FLOATERS entry must still author a surface-shaped `position:
    fixed` — else it is a stale allowlist entry masking nothing (shrink-only; remove it)."""
    authors = _surface_authoring_files(_live_sources())
    for name in ALLOWED_NON_SURFACE_FLOATERS:
        assert name in authors, (
            f"{name} is allow-listed as a non-surface floater but no longer authors a "
            "surface-shaped position:fixed — remove the stale allowlist entry (shrink-only)."
        )


def test_registered_kit_files_come_from_the_manifest():
    """The kit set is DERIVED from surface_registry.json, so registering a new kit auto-allows its
    source file (and de-registering one re-arms the gate against it)."""
    kits = _registered_kit_files()
    for f in ("orwellWindow.js", "orwellNotice.js", "orwellSheet.js"):
        assert f in kits, f"the registry no longer maps {f} as a surface-family source file"
    # the live surface authors are exactly the kits + the allowlist (no rogue today) — this is the
    # green-on-main invariant, stated positively so an accidental new author is a loud failure.
    authors = set(_surface_authoring_files(_live_sources()))
    assert authors <= (kits | ALLOWED_NON_SURFACE_FLOATERS), (
        f"unexpected surface author(s): {sorted(authors - kits - ALLOWED_NON_SURFACE_FLOATERS)}"
    )

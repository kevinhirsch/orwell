"""#1644 / W1 — the BLOCKING closed-world text-ink polarity gate.

Owner mandate (#1644): *"All text everywhere standardized… I worry about moments where text in
random spots is unreadable and we haven't migrated its style to something standard."* This is THE
structural guarantee that **no unreadable text can ship**.

It generalizes the two source-pinned spot-checks that proved the pattern
(`test_1601_chat_light_glass.py`, `test_appov_frosted_polarity_sweep.py` — #1601/#1639) from
their own two/one selectors to a **closed-world sweep over every committed text-color source**,
per `docs/audits/2026-07-15-text-standardization-audit.md` §3.2.

THE FAILURE CLASS: text inked from a non-standard source that resolves to the WRONG POLARITY for
the surface it lands on. The canonical example (#1639): `--fg` (dark-theme `#9cdef2`, a cool light
cyan built for a dark background) inking the sidebar wordmark on the LIGHT frosted glass → ~1.3:1,
light-on-light, unreadable — and there was no gate.

DESIGN — CLOSED-WORLD (registry-completeness), NOT a known-selector spot-check
------------------------------------------------------------------------------
Exhaustive over committed source. It ENUMERATES every text-color source — every `color:` /
`-webkit-text-fill-color:` in `static/style.css` (rule-block + @media aware, TOP-LEVEL-comma +
`:is()`-expanding selector parsing), every inline `style="color:…"` / `style='color:…'` in
`index.html` / `login.html` (whole-text, single/double-quote, multiline), and the JS
`.style.color=` / `setProperty('color',…)` / template `style="color:…"` inks in `static/js/**`
(property-first aware). It CLASSIFIES each by the SURFACE POLARITY it lands on and FAILS CLOSED on
any `body.theme-frosted` / `body.glass-full` LIGHT-surface text source (default render) that inks a
COOL / wrong-polarity token and is NOT in the verified `COOL_REGISTRY` / `JS_COOL_REGISTRY`
baseline — forcing a registry entry + a polarity decision in the SAME PR. The JS path is as
fail-closed as the CSS path (Greptile P1, #1647).

Hardening (CodeRabbit "Major" batch, #1647):
  #1 the contrast constants are DERIVED from the live CSS tokens (`--ow-control-ink`,
     `--ow-glass-opacity`) and the WCAG worst case uses the ACTUAL MINIMUM gradient fill opacity
     (bottom stop = opacity − 0.08 ≈ 0.52), not the flat 0.60.
  #2 selector-list splitting is TOP-LEVEL-comma only (paren-depth 0, so `:is(a,b)` is not split),
     `:is()`/`:where()` are EXPANDED to their branches, class/id tokens match as COMPLETE tokens
     (no `.send-btn` ⊂ `.send-btn-x` prefix bypass), and `body:is(.theme-frosted,…)` is frosted.
  #3 `_primary_dark` rejects invisible/diluted "dark" ink — near-zero rgba alpha, a low-% color-mix,
     and bare `transparent` on visible body text (kept only on `::before/::after` glyphs, disabled
     controls, and `-webkit-text-fill-color` gradient text).
  #4 `_residual_hit` enforces FILE PROVENANCE, and the anti-rot check enforces the EXACT expected
     occurrence count — copying an allowed anchor to a new site can no longer reuse the exception.
  #5 the disabled-ink ratchet uses the shared `_disabled_ink()` predicate (not just the `#57575c`
     literal), so the disabled `color-mix` is covered too.
  #6 the inline + JS gates are genuinely closed-world — EVERY discovered value must classify as an
     accepted family / surface-registry entry / tracked residual, else FAIL.

RATCHET (this gate LANDS GREEN): the current post-#1639 correct state is the passing baseline
(`COOL_REGISTRY` + `JS_COOL_REGISTRY` + the accepted-by-rule classes). The genuinely-risky
residuals the audit flags for waves W3–W6 are tracked in an EXPLICIT, COMMENTED `KNOWN_RESIDUAL`
allowlist (each with file:line + fixing wave + exact count), and an anti-rot test asserts each is
still present at its expected count so a fixed residual's stale entry must be removed. A
genuinely-new wrong-polarity ink is never swallowed.

Value-form aware: nested `var(--accent, var(--red))` fallbacks, `color-mix(in srgb, var(--fg) N%,
…)`, `var(--ow-control-ink, var(--fg,#fff))` (primary wins), inline `[style*="color:…"]`, and JS
`.style.color=` / template literals.

Mutation-proof (each temporarily mutated in-tree, gate FAILS, revert restores green):
  * re-inking the sidebar brand rule `#16191f → var(--fg)` (the #1639 regression);
  * a brand-new unregistered `body.theme-frosted` surface inking `var(--fg)`;
  * a `:is()` bypass `body.theme-frosted :is(.send-btn,.plain){color:#fff}` (the second branch is a
    non-fill light surface);
  * an invisible/diluted "dark" ink (`rgba(22,25,31,0.01)` / `color-mix(#16191f 1%, white)`);
  * a JS `el.style.color='var(--fg)'` and a template `style="color:var(--accent)"`.

Deterministic, source-pinned, no browser/model/network — runs in the fast parallel `fe-unit` lane
and is BLOCKING (`ci-gate.needs`). It covers surfaces the golden play-through never renders.
"""
import collections
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── WCAG thresholds ────────────────────────────────────────────────────────────────
AA_NORMAL = 4.5
AA_LARGE = 3.0


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ═══════════════════════════════════════════════════════════════════════════════════
# 1. SOURCE PARSING — comment-blank (KEEP newlines so line numbers stay true), a
#    brace-depth + @media-aware rule iterator, and the property-position color scanner.
# ═══════════════════════════════════════════════════════════════════════════════════
def _blank_comments_keeplines(s):
    """Blank /* … */ to spaces but PRESERVE newlines, so reported line numbers match the real
    file (unlike #1639's newline-collapsing strip, fine for cascade math but wrong for file:line)."""
    out, i, n = [], 0, len(s)
    while i < n:
        if s[i:i + 2] == "/*":
            j = s.find("*/", i + 2)
            j = n if j == -1 else j
            out.append("".join(c if c == "\n" else " " for c in s[i:j + 2]))
            i = j + 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


CSS = _read("static/style.css")
CSS_NC = _blank_comments_keeplines(CSS)

# The DEFAULT render = top-level rules PLUS `@media (prefers-reduced-transparency: no-preference)`.
# Every OTHER at-rule context (reduce / prefers-contrast a11y solid-panel fallbacks, breakpoints,
# @supports/@keyframes) is a CONDITIONAL override and is EXCLUDED from the light-glass risk class.
_DEFAULT_MEDIA = "prefers-reduced-transparency: no-preference"


def _iter_rules(css):
    """Yield (selector, body, at_stack, body_char_pos) for each style rule, brace-depth aware."""
    at_stack, depth_is_at = [], []
    prelude_start, i, n = 0, 0, len(css)
    while i < n:
        c = css[i]
        if c == "{":
            prelude = css[prelude_start:i].strip()
            if prelude.startswith("@"):
                at_stack.append(prelude)
                depth_is_at.append(True)
                prelude_start = i + 1
                i += 1
            else:
                j = css.find("}", i)
                if j == -1:
                    break
                yield prelude, css[i + 1:j], tuple(at_stack), i + 1
                prelude_start = j + 1
                i = j + 1
        elif c == "}":
            if depth_is_at:
                depth_is_at.pop()
                if at_stack:
                    at_stack.pop()
            prelude_start = i + 1
            i += 1
        elif c == ";":
            prelude_start = i + 1
            i += 1
        else:
            i += 1


def _is_default_render(at_stack):
    return all(_DEFAULT_MEDIA in prelude for prelude in at_stack)


def _lineno(css, pos):
    return css.count("\n", 0, pos) + 1


# ── selector-list parsing (finding #2): TOP-LEVEL commas only + :is()/:where() expansion ──
def _split_top_commas(s):
    """Split on commas at paren-depth 0 only, so `:is(.a, .b)` / `:not(.a, .b)` stay intact."""
    parts, depth, buf = [], 0, []
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    return [" ".join(p.split()) for p in parts if p.strip()]


def _expand_pseudo_lists(sel):
    """Expand the FIRST `:is(...)` / `:where(...)` / `:matches(...)` into one concrete selector per
    branch (recursively), with balanced-paren extraction so a nested `:not(...)` is respected. So
    `body.theme-frosted :is(.send-btn, .plain)` → `body.theme-frosted .send-btn` +
    `body.theme-frosted .plain` — each branch is a real landing surface for the rule's ink."""
    m = re.search(r":(?:is|where|matches)\(", sel, re.I)
    if not m:
        return [sel]
    start = m.end() - 1  # index of '('
    depth, j = 0, start
    while j < len(sel):
        if sel[j] == "(":
            depth += 1
        elif sel[j] == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    inner, prefix, suffix = sel[start + 1:j], sel[:m.start()], sel[j + 1:]
    out = []
    for branch in _split_top_commas(inner):
        out.extend(_expand_pseudo_lists(" ".join((prefix + branch + suffix).split())))
    return out


# property-position `color:` / `-webkit-text-fill-color:` at a declaration start (so a `color:`
# embedded in a `[style*="color:…"]` SELECTOR is not mis-read as a declaration).
_DECL = re.compile(r"(?:^|;)\s*(-webkit-text-fill-color|color)\s*:\s*([^;{}]*)", re.I)


def _css_color_decls():
    """Every text-color declaration as records: {line, sel, prop, val, default, print}. Selector
    lists are split on TOP-LEVEL commas and `:is()`/`:where()` expanded to their branches."""
    recs = []
    for sel, body, at_stack, pos in _iter_rules(CSS_NC):
        line = _lineno(CSS_NC, pos)
        is_default = _is_default_render(at_stack)
        is_print = any("print" in p for p in at_stack)
        decls = [(m.group(1).lower(), m.group(2).replace("!important", "").strip())
                 for m in _DECL.finditer(body)]
        decls = [(p, v) for p, v in decls if v]
        if not decls:
            continue
        for part in _split_top_commas(sel):
            for sub in _expand_pseudo_lists(part):
                for prop, val in decls:
                    recs.append({"line": line, "sel": sub, "prop": prop, "val": val,
                                 "default": is_default, "print": is_print})
    return recs


CSS_DECLS = _css_color_decls()

# frosted / glass-full LIGHT-glass scope. `body:not(.theme-frosted)` is EXCLUDED (the NON-frosted
# theme). `body:is(.theme-frosted,…)` is handled by `:is()` expansion before this runs.
_FROSTED_SCOPE = re.compile(r"body\.(?:theme-frosted|glass-full)\b")


def _is_frosted(sel):
    return bool(_FROSTED_SCOPE.search(sel))


# ═══════════════════════════════════════════════════════════════════════════════════
# 2. THE STANDARD INKS + light-glass material — DERIVED from the live CSS tokens (finding #1).
# ═══════════════════════════════════════════════════════════════════════════════════
def _css_token(name, default):
    m = re.search(re.escape(name) + r"\s*:\s*([^;{}]+)", CSS_NC)
    return m.group(1).strip() if m else default


CHROME_INK = _css_token("--ow-control-ink", "#16191f").lower()   # canonical dark ink for light glass
DARK_WINDOW_INK = "#eef1f4"                                      # light ink for the opaque #orwell-headshot window
DARK_WINDOW_FILL = (29, 32, 38)                                 # #orwell-headshot opaque fill
LIGHT_GLASS = (255, 255, 255)                                   # the near-white glass material
_GLASS_OPACITY = float(re.match(r"[\d.]+", _css_token("--ow-glass-opacity", "0.60")).group())
# the gradient bottom stop = opacity − OFFSET is the MINIMUM fill opacity (darker over black than
# the flat 0.60) — the TRUE worst case for a dark ink on the translucent glass (finding #1).
_bm = re.search(r"rgba\(255,\s*255,\s*255,\s*calc\(var\(--ow-glass-opacity\)\s*-\s*([\d.]+)\)\)", CSS_NC)
GLASS_ALPHA_MIN = round(_GLASS_OPACITY - (float(_bm.group(1)) if _bm else 0.08), 3)  # ≈ 0.52


# ═══════════════════════════════════════════════════════════════════════════════════
# 3. VALUE-FORM classifiers — aware of the inventory's REAL forms.
# ═══════════════════════════════════════════════════════════════════════════════════
def _norm(v):
    return " ".join(v.replace("!important", "").split()).strip().lower()


# a COOL / theme-moving ink that stays LIGHT on the frosted light glass (the risk class). Matches
# nested fallbacks (`var(--accent, var(--red))` contains `var(--accent`), color-mix inner tokens,
# and the two UNDEFINED tokens (`--danger`/`--amber`) that fall back to a brick / cool fg.
_COOL = re.compile(
    r"var\(\s*--(?:fg|bg|accent|color-accent|link|color-link|red|color-danger|color-error|"
    r"color-recording|select-fg|select-option-fg|text|muted|fg-muted|fg-dim|hamburger|"
    r"danger|amber|brand-color)\b"
)

_MIN_INK_ALPHA = 0.30   # below this an rgba dark ink is effectively invisible (finding #3)
_MIN_MIX_PCT = 50       # a color-mix with < this % dark primary is diluted toward the other color


def _cool_token(v):
    return bool(_COOL.search(_norm(v)))


def _rgba_alpha(v):
    m = re.match(r"rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)", v)
    return float(m.group(1)) if (m and m.group(1)) else 1.0


def _primary_dark(v):
    """The value's PRIMARY (resolved) token is a LEGIBLE dark chrome ink — a cool fallback that
    never fires is dark, not cool. Rejects invisible/diluted forms (finding #3): a near-zero rgba
    alpha, and a color-mix whose literal dark % is below the dilution floor."""
    v = _norm(v)
    if v in ("#16191f", "#000", "#000000", "#111", "#111111"):
        return True
    if v.startswith(("var(--ow-control-ink", "var(--ow-ink-chrome")):  # incl. W2's future token
        return True
    if v.startswith(("color-mix(in srgb, #16191f", "color-mix(in srgb, var(--ow-control-ink")):
        m = re.search(r"(?:#16191f|var\(--ow-control-ink[^,)]*\))\s+(\d+(?:\.\d+)?)%", v)
        if m:
            return float(m.group(1)) >= _MIN_MIX_PCT
        return True   # calc()/var()-driven % (the verified .ow-sheet cross-fade) — accept
    if re.match(r"^rgba?\(\s*22\s*,\s*25\s*,\s*31\b", v):   # #16191f at reduced alpha (muted dark ink)
        return _rgba_alpha(v) >= _MIN_INK_ALPHA
    if re.match(r"^rgba?\(\s*0\s*,\s*0\s*,\s*0\b", v):      # dark control glyph
        return _rgba_alpha(v) >= _MIN_INK_ALPHA
    return False


def _light_ink(v):
    return _norm(v) in ("#fff", "#ffffff", "white", DARK_WINDOW_INK, "#e8eef2")


def _hl_syntax(v):
    return _norm(v).startswith("var(--hl-")


# a color-mix that blends currentColor/inherit toward `transparent` is a muted SHADE of the inherited
# surface ink, so it follows the surface polarity by construction — exactly like bare `inherit`. This
# is the #1644 adaptive-bubble meta pattern (`color-mix(currentColor 62%, transparent)` on the .msg-ai
# timestamps/action glyphs, which follow the bubble's per-wallpaper adaptive ink).
# Greptile P1 (#1690): the mix must actually PAINT the surface ink — it must CONTAIN currentColor/
# inherit (`transparent, transparent` is invisible), and must NOT reduce it to nothing (`currentColor
# 0%` or `transparent 100%` render invisible). Those degenerate/invisible forms are rejected, so an
# accidental 0% no longer passes the gate as "surface-following".
_CURRENTCOLOR_MIX = re.compile(
    r"^color-mix\(\s*in\s+srgb\s*,\s*"
    r"(?=.*(?:currentcolor|inherit))"                  # must carry the surface ink at all
    r"(?!.*(?:^|[,\s])transparent\s+100%)"             # …not fully transparent
    r"(?!.*(?:currentcolor|inherit)\s+0%)"             # …and not a 0% (invisible) surface ink
    r"(?:currentcolor|inherit)(?:\s+[\d.]+%)?\s*,\s*transparent\s*\)$")


def _follows_surface(v):
    n = _norm(v)
    if n in ("inherit", "currentcolor"):             # transparent handled separately (finding #3)
        return True
    return bool(_CURRENTCOLOR_MIX.match(n))           # muted shade of the inherited surface ink


def _is_transparent(v):
    return _norm(v) == "transparent"


_BARE_HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def _bare_hex(v):
    return bool(_BARE_HEX.match(_norm(v)))


def _disabled_ink(v):
    return _norm(v) == "#57575c" or "var(--fg, #fff) 40%" in _norm(v)  # #57575c / the disabled color-mix


def _kit_on_fill_ink(v):
    return _norm(v).startswith(
        ("var(--ow-on-accent", "var(--ow-on-danger", "var(--on-accent", "var(--on-danger")
    )


# the app's standardized SEMANTIC danger/error tokens — a sanctioned status HUE (HIG Destructive
# role), NOT the theme accent, so the no-accent-on-text mandate does not forbid it. Polarity-aware
# (`:root` #ff453a / `.light` #ff3b30) and designed to clear the 3:1 UI/large-bold floor on BOTH
# the light glass and the dark app (style.css ~L140 note), so it reads as a red status label on
# either surface — never a light-on-light straggler. This is the INLINE mirror of W4's JS-side
# JS_COOL_REGISTRY registration for the SAME `var(--color-danger)` token.
_DANGER_TOKEN = re.compile(r"^var\(\s*--color-(?:danger|error)\s*\)$")
# the AA-SAFE SOLID danger ink: --color-danger-strong = color-mix(--color-danger 76%, #000), a DARK
# red designed to clear the 4.5:1 NORMAL-text floor (raw --color-danger is only ~3.9:1 as body text —
# style.css ~L152 note). Legible as normal-size body/control text on any surface.
_DANGER_STRONG_TOKEN = re.compile(r"^var\(\s*--color-(?:danger|error)-strong\s*\)$")
# large-bold heading tags: the app renders <h1>–<h3> heavy enough that the RAW danger hue clears its
# 3:1 large floor (rendered audit flagged only the normal-size vault BUTTON, not the <h2> heads).
_LARGE_TAGS = ("h1", "h2", "h3")


def _standard_danger(v):
    return bool(_DANGER_TOKEN.match(_norm(v)))


def _standard_danger_strong(v):
    return bool(_DANGER_STRONG_TOKEN.match(_norm(v)))


# ── surface predicates over the SELECTOR — COMPLETE-token match (finding #2) ─────────
def _has_token(sel, tok):
    """`tok` (a class `.x` / id `#x` / compound token) present as a COMPLETE selector token — the
    next char is not `[\\w-]`, so `.send-btn` does NOT match `.send-btn-wrapper`."""
    return re.search(re.escape(tok) + r"(?![\w-])", sel) is not None


# on-fill selectors (a colored/accent/danger FILL — white/on-accent ink is correct there, §5).
# FULL class tokens covering every current #fff/white/on-fill-ink text site.
_ON_FILL_TOKENS = (
    ".send-btn", ".odec-confirm", ".admin-btn-delete", ".gallery-card-play",
    ".attach-ocr-btn", ".shortcut-warn", ".gallery-editor-draft-delete", ".settings-nav-item.active",
    ".admin-tab.active", ".msg-user", ".theme-seg", ".recording-content", "#stop-recording",
    ".stop-recording-btn", ".ow-btn-destructive", ".ow-close", ".gallery-card-delete",
)


def _is_fill(sel):
    return any(_has_token(sel, tok) for tok in _ON_FILL_TOKENS)


def _is_disabled_sel(sel):
    return bool(re.search(r":disabled|\[disabled\]|\[aria-disabled|\.is-disabled", sel))


def _is_dark_window(sel):
    return _has_token(sel, "#orwell-headshot")


def _is_pseudo_glyph(sel):
    return "::before" in sel or "::after" in sel


# ═══════════════════════════════════════════════════════════════════════════════════
# 4. THE COOL_REGISTRY — the verified-safe (#1639-swept) baseline of frosted/glass-full
#    DEFAULT-render selectors that legitimately ink a COOL token. EXACT (whitespace-
#    normalized, :is()-expanded) sub-selectors: a NEW selector fails closed.
# ═══════════════════════════════════════════════════════════════════════════════════
COOL_REGISTRY = {
    # titlebar chrome — inside the `.ow-titlebar → #16191f` / `.ow-window .ow-body` container remap.
    'body.theme-frosted .ow-title': ("light-glass-remapped", "titlebar; container --fg:#16191f remap"),
    'body.theme-frosted .ow-titlebar-accessory': ("light-glass-remapped", "titlebar; container --fg:#16191f remap"),

    # native <select> option lists — browser-native dropdown rendering; #1639 verified.
    'body.theme-frosted select.ow-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted .admin-card select:not(.ow-select) option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.admin-tools-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.theme-fd-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.memory-sort-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.memory-edit-cat-select option': ("native-option", "native option list; #1639-verified"),

    # the GLOBAL no-accent-on-text remap RULES themselves — repaint accent/red links to chrome --fg.
    'body.theme-frosted a': ("accent-remap-rule", "global no-accent-on-text remap → chrome --fg"),
    'body.theme-frosted .red-text': ("accent-remap-rule", "global no-accent-on-text remap → chrome --fg"),
    'body.theme-frosted #research-toggle-btn.active': ("accent-remap-rule", "active toggle; remap → chrome --fg"),
    'body.theme-frosted #research-toggle-btn.research-running': ("accent-remap-rule", "active toggle; remap → chrome --fg"),
    'body.theme-frosted .section-header-btn.active': ("accent-remap-rule", "active header btn; remap → chrome --fg"),
    'body.theme-frosted .setup-trigger-link:hover': ("accent-remap-rule", "setup link hover; remap → chrome --fg"),
    'body.theme-frosted .setup-clickable-provider:hover': ("accent-remap-rule", "setup link hover; remap → chrome --fg"),
    'body.theme-frosted .setup-clickable-code:hover': ("accent-remap-rule", "setup link hover; remap → chrome --fg"),
    'body.theme-frosted [style*="color: var(--accent)"]': ("accent-remap-rule", "inline accent remap → chrome --fg"),
    'body.theme-frosted [style*="color:var(--accent)"]': ("accent-remap-rule", "inline accent remap → chrome --fg"),
    'body.theme-frosted [style*="color: var(--red)"]': ("accent-remap-rule", "inline red remap → chrome --fg"),
    'body.theme-frosted [style*="color:var(--red)"]': ("accent-remap-rule", "inline red remap → chrome --fg"),

    # theme-background source inputs — settings light glass inside the container remap; #1639 verified.
    'body.theme-frosted #theme-bg-source': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-url': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-file': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-file::file-selector-button': ("light-glass-remapped", "theme-bg input; #1639-verified"),

    # adaptive-over-wallpaper text — floats over the wallpaper, drives ink via var(--fg) + a
    # var(--bg)-derived halo (dark on light palettes); light #e8eef2 fallback is correct.
    'body.theme-frosted .agent-thread-node:not(.ow-slate-outcome) .agent-thread-tool':
        ("adaptive-wallpaper", "agent-thread tool ink; adaptive over wallpaper + halo"),
    'body.theme-frosted .gadget-rail-head': ("adaptive-wallpaper", "gadget-rail head; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-head *': ("adaptive-wallpaper", "gadget-rail head; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-title': ("adaptive-wallpaper", "gadget-rail title; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-rearrange[aria-pressed="true"]': ("adaptive-wallpaper", "gadget-rail control; adaptive"),

    # #1638 compact/icon kit primitives — FLAT desktop-chrome buttons that float over the dark
    # wallpaper (like .gadget-rail-head): var(--fg) inks LIGHT there, and the W3 --fg remap re-inks
    # them DARK inside a light-glass container (.ow-window .ow-body / .on-card / .og-card). One
    # adaptive primitive, legible in BOTH contexts — the sanctioned adaptive-wallpaper pattern.
    'body.theme-frosted .ow-btn-icon': ("adaptive-wallpaper", "compact chrome icon button; adaptive over wallpaper (#1638)"),
    'body.theme-frosted .ow-btn-compact': ("adaptive-wallpaper", "compact chrome text button; adaptive over wallpaper (#1638)"),

    # #1690: the .msg-ai footer meta controls float over the chat wallpaper. Their DEFAULT ink is a
    # muted color-mix(currentColor…) (follows-surface); on HOVER they brighten to the FULL adaptive
    # ink var(--fg) — dark over a light frosted wallpaper (W3 --fg remap), light over a dark one. The
    # prior `color: inherit` pulled the muted footer value and never brightened (CodeRabbit #1690).
    'body.theme-frosted .msg-ai .msg-action-btn:hover': ("adaptive-wallpaper", "footer action btn hover; full adaptive ink (#1690)"),
    'body.theme-frosted .msg-ai .footer-copy-btn:hover': ("adaptive-wallpaper", "footer copy btn hover; full adaptive ink (#1690)"),
    'body.theme-frosted .msg-ai .regen-btn:hover': ("adaptive-wallpaper", "footer regen btn hover; full adaptive ink (#1690)"),
    'body.theme-frosted .msg-ai .fork-btn:hover': ("adaptive-wallpaper", "footer fork btn hover; full adaptive ink (#1690)"),
}


# The verified JS baseline (Greptile P1 ratchet): every current risky JS-set / template ink, keyed
# by (rel_path, normalized value) → occurrence count. These live where they are mitigated today —
# status messages inside the settings/admin `.ow-window .ow-body` (--fg remapped dark) and inline
# accent/red caught by the frosted `[style*="color:var(--accent|--red)"]` remaps. Ratchet: a NEW
# (file,value) family, or MORE occurrences than registered, fails closed. The former two settings.js
# undefined-token bugs are FIXED (#1644 W4): the danger one now inks the standard `var(--color-danger)`
# and is registered here; the warning one inks the defined `var(--color-warning)` (not a cool token, so
# not tracked). The retired brick may NEVER be here.
JS_COOL_REGISTRY = {
    ('static/js/admin.js', 'var(--accent)'): 1,
    ('static/js/admin.js', 'var(--fg)'): 1,
    ('static/js/admin.js', 'var(--red)'): 9,
    ('static/js/chat.js', '#6b7280'): 1,
    ('static/js/chat.js', '#ccc'): 1,
    ('static/js/chat.js', 'var(--color-error)'): 8,
    ('static/js/chatRenderer.js', 'var(--fg)'): 4,
    ('static/js/chatRenderer.js', 'var(--red)'): 2,
    ('static/js/group.js', 'var(--color-error)'): 1,
    ('static/js/group.js', 'var(--fg)'): 1,
    ('static/js/models.js', 'var(--accent,var(--red))'): 1,
    ('static/js/presets.js', 'var(--color-error)'): 1,
    ('static/js/sessions.js', 'color-mix(in srgb, var(--fg) 50%, transparent)'): 2,
    ('static/js/sessions.js', 'var(--accent)'): 1,
    ('static/js/sessions.js', 'var(--accent, var(--red))'): 4,
    # #1638 KM-W10: the "+ New Folder" var(--accent-primary) ink retired with the bespoke
    # folder submenu (now an OrwellMenuKit submenu — the kit paints the row).
    ('static/js/settings.js', '#0b0'): 1,
    ('static/js/settings.js', '#fff'): 8,
    ('static/js/settings.js', 'color-mix(in srgb, var(--fg) 45%, transparent)'): 1,
    ('static/js/settings.js', 'var(--accent, var(--red))'): 11,
    ('static/js/settings.js', 'var(--accent,#50fa7b)'): 1,
    ('static/js/settings.js', 'var(--accent,var(--red))'): 2,
    ('static/js/settings.js', 'var(--color-danger)'): 1,   # #1644 W4: standard danger token, was `var(--danger,#c0392b)`
    ('static/js/settings.js', 'var(--fg)'): 23,
    ('static/js/settings.js', 'var(--fg-muted)'): 1,
    ('static/js/settings.js', 'var(--red)'): 57,
    ('static/js/settings.js', 'var(--red, #e55)'): 2,
    ('static/js/slashCommands.js', '#fff'): 1,
    ('static/js/slashCommands.js', 'var(--fg)'): 1,
    ('static/js/slashCommands.js', 'var(--red)'): 3,
    ('static/js/tts-ai.js', '#6b7280'): 2,
    ('static/js/tts-ai.js', '#ccc'): 2,
}


# ═══════════════════════════════════════════════════════════════════════════════════
# 5. KNOWN_RESIDUAL — the genuinely-risky spots the audit still flags, awaiting waves W3–W6.
#    EXPLICIT + COMMENTED, each: {file, line (doc), find (a stable content anchor), count
#    (exact occurrences of `find` in `file` — finding #4), wave, why, optional sel pin}.
#    Tracked-not-hidden: the closed-world checks REQUIRE a residual to be listed here (else they
#    fail closed on it), the match is FILE-PROVENANCE-keyed, and the anti-rot test asserts each
#    still occurs EXACTLY `count` times (a wave that fixes / a copy that adds one fails here).
# ═══════════════════════════════════════════════════════════════════════════════════
KNOWN_RESIDUAL = [
    # ── W4 — FIXED (#1644 W4): the two undefined-token settings.js inks were repointed onto standard
    #    tokens — `var(--danger, #c0392b)` → `var(--color-danger)` (Apple system red, in JS_COOL_REGISTRY
    #    now) and `var(--amber, var(--fg))` → `var(--color-warning)` (defined amber, not a cool token).
    #    Their KNOWN_RESIDUAL entries were removed here so the anti-rot check stays honest. ──

    # ── W5 — FIXED (#1644 W5): the ~17 index.html inline sites were migrated off cool tokens /
    #    bespoke reds onto standard tokens, so their KNOWN_RESIDUAL entries were removed here to keep
    #    the anti-rot check honest:
    #      • the dashed-add button (index.html:1539) `color:var(--fg)`, the empty-state hint mixes
    #        (`color-mix(--fg 45%)` x10 + `--fg 55%` x1), and the two inline accent links
    #        (`var(--accent,var(--red))`) all sit in W3-remapped/adaptive containers whose frosted
    #        `!important` rules already force correct polarity — repointed to `color:inherit` so each
    #        follows its surface ink (dark on the light glass, light on the dark app) and classifies
    #        via `_follows_surface`;
    #      • the two Danger-Zone `#e55` heads + the debug-vault-button `#f0a6a6` → the standard
    #        `var(--color-danger)` (Apple system red, polarity-aware), classified by `_standard_danger`. ──

    # ── W6 — FIXED (#1638 kit migration W6): three of the five bespoke style.css status/accent/chrome
    #    hexes were repointed onto standard tokens, so their KNOWN_RESIDUAL entries were removed here to
    #    keep the anti-rot check honest:
    #      • `.compare-parallel-toggle` amber `#e0a050` → `var(--color-warning)` and its `.active` blue
    #        `#5b8def` → `var(--color-accent)` (color + border + tint mix, polarity-aware);
    #      • `.cookbook-gpu-btn.gpu-free` green `#4ade80` → `var(--color-success)`.
    #    Two of the five stayed bespoke and are tracked residuals below:
    #      • `#orwell-status .og-chev` was REVERTED to `#000` — `var(--ow-control-ink)` (rgb(22,25,31))
    #        failed the a11y-matrix contrast gate on the textured status pill;
    #      • `.notes-pane-archive` title gold stayed `#b48a4a` (not `var(--color-warning)` #f0ad4e) — the
    #        badge's fill/border/data-URI SVG-icon stroke all use #b48a4a and a data-URI can't take a CSS
    #        var, so the label rejoined #b48a4a for ONE coherent accent rather than a two-tone badge. ──
    {"file": "static/style.css", "line": 23991, "find": "color: #000", "sel": "#orwell-status .og-chev", "count": 1,
     "wave": "W6", "why": "a11y-matrix contrast requires pure-black max-contrast ink over the textured "
                          "status-pill backdrop; --ow-control-ink (rgb(22,25,31)) drops to 3.61:1 < 4.5. "
                          "Intentional bespoke exception."},
    {"file": "static/style.css", "line": 18265, "find": "color: #b48a4a", "sel": ".notes-pane-archive", "count": 1,
     "wave": "W6", "why": "archive badge uses ONE accent source: the label, fill, border and data-URI SVG "
                          "icon stroke all use the muted archive gold #b48a4a. --color-warning (#f0ad4e) is "
                          "a brighter amber that would visibly shift the badge and can't reach the SVG stroke."},
]

# ── ACCEPTED exceptions (contrast holds / semantically correct — audit §5) ──────────
_ACCEPTED_INLINE = ("var(--brand-color,var(--red,#e06c75))",)   # low-opacity monospace brand watermark
_ACCEPTED_DIFF_GREEN = "#3fb950"                                # diff-add family (§5)


def _residual_hit(context, file, sel=None):
    """A residual entry whose `find` appears in `context`, gated by FILE PROVENANCE (`file` ends
    with the entry's file — finding #4) and, if the entry pins a `sel`, the selector token present.
    Copying an anchor to a DIFFERENT file no longer reuses the exception."""
    for e in KNOWN_RESIDUAL:
        if not file.endswith(e["file"]):
            continue
        if e["find"] in context and (("sel" not in e) or (sel is not None and e["sel"] in sel)):
            return e
    return None


# ═══════════════════════════════════════════════════════════════════════════════════
# 6. WCAG math (verbatim from #1601/#1639) + the light-glass worst-case fill.
# ═══════════════════════════════════════════════════════════════════════════════════
def _hx(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lum(rgb):
    r, g, b = (c / 255 for c in rgb)

    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a_rgb, b_rgb):
    l1, l2 = sorted((_lum(a_rgb), _lum(b_rgb)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _over(fg_rgb, bg_rgb, alpha):
    return tuple(round(alpha * fg_rgb[i] + (1 - alpha) * bg_rgb[i]) for i in range(3))


# the MINIMUM-opacity light glass composited over pure black — the true worst case (finding #1).
GLASS_OVER_BLACK = _over(LIGHT_GLASS, (0, 0, 0), GLASS_ALPHA_MIN)


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 1 — THE CLOSED-WORLD GUARANTEE (CSS): every frosted/glass-full DEFAULT-render text
#          source is classified; a cool/wrong-polarity ink not verified-safe fails closed.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_frosted_light_surface_closed_world_completeness():
    unclassified, wrong_polarity = [], []
    for d in CSS_DECLS:
        if not (d["default"] and _is_frosted(d["sel"])):
            continue
        sel, val = d["sel"], d["val"]
        if _primary_dark(val):
            continue                                   # resolves to the dark chrome ink → correct on light glass
        if _hl_syntax(val):
            continue                                   # code syntax token
        if _follows_surface(val):
            continue                                   # inherit / currentColor → follows the pinned surface
        if _is_transparent(val):
            if _is_pseudo_glyph(sel) or _is_disabled_sel(sel) or d["prop"] == "-webkit-text-fill-color":
                continue                               # icon glyph / disabled / gradient-clip text — not body ink
            wrong_polarity.append((d["line"], sel, val, "transparent (invisible) ink on visible body text"))
            continue
        if _light_ink(val):
            if _is_fill(sel) or _is_dark_window(sel):
                continue
            wrong_polarity.append((d["line"], sel, val, "light ink on a light-glass NON-fill surface"))
            continue
        if _disabled_ink(val):
            if _is_disabled_sel(sel):
                continue
            wrong_polarity.append((d["line"], sel, val, "disabled ink on a non-disabled selector"))
            continue
        if _kit_on_fill_ink(val):
            if _is_fill(sel):
                continue                               # luminance-aware on-accent / on-danger ink on its fill
            wrong_polarity.append((d["line"], sel, val, "kit on-fill ink on a non-fill light surface"))
            continue
        if _cool_token(val):
            key = " ".join(sel.split())
            if key in COOL_REGISTRY:
                continue                               # verified-safe baseline
            if _residual_hit(val, "static/style.css", sel):
                continue                               # tracked residual (W3–W6)
            unclassified.append((d["line"], sel, val))
            continue
        if _bare_hex(val):
            continue                                   # handled by the app-wide bespoke ratchet (TEST 5)
        unclassified.append((d["line"], sel, val))     # total function: anything else → fail closed

    assert not unclassified, (
        "#1644 CLOSED-WORLD: %d frosted/glass-full light-surface text source(s) ink a COOL / "
        "unclassified token but are NOT in COOL_REGISTRY and NOT a tracked KNOWN_RESIDUAL. Repaint "
        "to the dark chrome ink (#16191f / var(--ow-control-ink)) OR add an explicit COOL_REGISTRY "
        "entry with the reason:\n" % len(unclassified)
        + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}" for ln, sel, val in unclassified)
    )
    assert not wrong_polarity, (
        "#1644 POLARITY: %d frosted/glass-full text source(s) resolve to the WRONG polarity for "
        "their surface:\n" % len(wrong_polarity)
        + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}  — {why}" for ln, sel, val, why in wrong_polarity)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 2 — the COOL_REGISTRY is not rotten: every registered selector is still a live frosted
#          default-render cool-token declaration.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_cool_registry_entries_are_live_and_cool():
    live = {" ".join(d["sel"].split()) for d in CSS_DECLS
            if d["default"] and _is_frosted(d["sel"]) and _cool_token(d["val"]) and not _primary_dark(d["val"])}
    stale = sorted(k for k in COOL_REGISTRY if k not in live)
    assert not stale, (
        "#1644: %d COOL_REGISTRY entr(y/ies) no longer match a live frosted cool-token declaration "
        "— remove the stale baseline entr(y/ies):\n" % len(stale) + "\n".join(f"  {k}" for k in stale)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 3 — source-family-keyed polarity ratchets: on-fill white ONLY on fill selectors;
#          disabled ink (via the shared predicate — finding #5) ONLY on disabled selectors;
#          #000/#333 ONLY in @media print.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_on_fill_white_only_on_fill_selectors():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _norm(d["val"]) in ("#fff", "#ffffff", "white")
           and not (_is_fill(d["sel"]) or _is_dark_window(d["sel"]) or _is_disabled_sel(d["sel"]))]
    assert not bad, (
        "#1644: on-fill white (#fff/white) must ink only an accent/danger FILL (or the dark window). "
        "Offenders:\n" + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


def test_disabled_ink_only_on_disabled_selectors():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _disabled_ink(d["val"]) and not _is_disabled_sel(d["sel"])]
    assert not bad, (
        "#1644: the disabled ink (#57575c / the disabled color-mix) is a WCAG-1.4.3-exempt inactive-"
        "control ink and must ink only :disabled / [disabled] / [aria-disabled] selectors. Offenders:\n"
        + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


def test_plain_black_only_in_print():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _norm(d["val"]) in ("#000", "#000000", "#333", "#333333")
           and not d["print"] and not _residual_hit("color: " + _norm(d["val"]), "static/style.css", d["sel"])]
    assert not bad, (
        "#1644: bare #000/#333 body ink is reserved for @media print. A new one on a screen surface "
        "needs a KNOWN_RESIDUAL entry. Offenders:\n"
        + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 4 — WCAG recomputation for the standard inks on their standard surfaces, using the
#          derived tokens + the ACTUAL MINIMUM glass opacity (finding #1).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_standard_inks_clear_aa_on_their_surfaces():
    assert re.fullmatch(r"#[0-9a-f]{6}", CHROME_INK), f"--ow-control-ink didn't parse: {CHROME_INK!r}"
    assert 0.4 <= GLASS_ALPHA_MIN <= 0.6, f"glass min opacity out of range: {GLASS_ALPHA_MIN}"
    # dark chrome ink on the MIN-opacity light glass over the darkest backdrop (true worst case).
    r_dark = _ratio(_hx(CHROME_INK), GLASS_OVER_BLACK)
    assert r_dark >= AA_NORMAL, (
        f"#1644: the dark chrome ink {CHROME_INK} on the .{int(GLASS_ALPHA_MIN*100)} MIN-opacity light "
        f"glass over pure black is {r_dark:.2f}:1, must clear AA {AA_NORMAL}:1"
    )
    r_light = _ratio(_hx(DARK_WINDOW_INK), DARK_WINDOW_FILL)
    assert r_light >= AA_NORMAL, (
        f"#1644: the light window ink {DARK_WINDOW_INK} on the opaque dark window fill "
        f"{DARK_WINDOW_FILL} is {r_light:.2f}:1, must clear AA {AA_NORMAL}:1"
    )
    assert r_dark >= AA_LARGE and r_light >= AA_LARGE


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 5 — the app-wide BESPOKE-HEX ratchet: every BARE-hex text color must be accepted by a
#          surface rule or be a tracked KNOWN_RESIDUAL(W6). A NEW bespoke hex fails closed.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_bespoke_hex_ratchet():
    strays = []
    for d in CSS_DECLS:
        v = _norm(d["val"])
        if not _bare_hex(v):
            continue
        if v in ("#16191f", "#000", "#000000", "#111", "#111111") and _primary_dark(v):
            if v in ("#000", "#000000") and not d["print"]:
                pass                                   # a screen #000 still needs a residual (below)
            else:
                continue
        if v in ("#fff", "#ffffff", "white") and (_is_fill(d["sel"]) or _is_dark_window(d["sel"])):
            continue
        if v == "#57575c" and _is_disabled_sel(d["sel"]):
            continue
        if v in ("#000", "#000000", "#333", "#333333") and d["print"]:
            continue
        if v == _ACCEPTED_DIFF_GREEN:
            continue
        if v in (_norm(DARK_WINDOW_INK), "#e8eef2") and _is_dark_window(d["sel"]):
            continue
        if _residual_hit("color: " + v, "static/style.css", d["sel"]) or _residual_hit(v, "static/style.css", d["sel"]):
            continue
        if v == "#16191f":
            continue                                   # chrome ink standard (non-print)
        strays.append((d["line"], d["sel"], d["val"]))
    assert not strays, (
        "#1644 BESPOKE-HEX ratchet: %d bare-hex text color(s) are neither accepted by a surface rule "
        "nor a tracked KNOWN_RESIDUAL. Tokenize to a kit ink, or add a KNOWN_RESIDUAL(W6) entry:\n"
        % len(strays) + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}" for ln, sel, val in strays)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# 7. INLINE (index.html / login.html) — whole-text, single/double-quote, multiline (finding #6).
# ═══════════════════════════════════════════════════════════════════════════════════
_STYLE_ATTR = re.compile(r"""style\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.S)
_INLINE_COLOR = re.compile(r"(?<![-\w])color\s*:\s*([^;]*)", re.I)
_INLINE_BG = re.compile(r"(?<![-\w])background(?:-color)?\s*:\s*([^;]*)", re.I)


def _tag_for(text, style_start):
    """The element TAG bearing the inline style at `style_start` — the nearest `<tag` opening before
    it (a style attr lives inside its element's start tag, so the last `<tag` before it is the host).
    Lets the danger check be size-aware: raw danger hue is fine on a large-bold heading, not on a
    normal-size control/body label (finding: the rendered vault BUTTON @ ~3.4:1)."""
    lt = text.rfind("<", 0, style_start)
    if lt == -1:
        return ""
    m = re.match(r"<\s*([a-zA-Z][\w-]*)", text[lt:])
    return m.group(1).lower() if m else ""


def _html_inline_color_sites(rel):
    """(file, line, style_string, color_value, tag) for every inline style with a property-position
    color, whole-text (so a multiline or single-quoted style attr is not missed)."""
    text = _read(rel)
    sites = []
    for m in _STYLE_ATTR.finditer(text):
        style = m.group(1) if m.group(1) is not None else m.group(2)
        cm = _INLINE_COLOR.search(style)
        if cm and cm.group(1).strip():
            sites.append((rel, text.count("\n", 0, m.start()) + 1, style, cm.group(1).strip(),
                          _tag_for(text, m.start())))
    return sites


INLINE_SITES = _html_inline_color_sites("static/index.html") + _html_inline_color_sites("static/login.html")


def _accepted_decorative(style):
    s = style.replace(" ", "")
    return any(a.replace(" ", "") in s for a in _ACCEPTED_INLINE)


def _bg_covaries(style):
    """The paired background is a theme token (bg/panel/input-bg/fg) — color+background move
    together, so the pair is theme-consistent, not stranded on a fixed-polarity glass surface."""
    bm = _INLINE_BG.search(style)
    return bool(bm and re.search(r"var\(\s*--(?:bg|panel|input-bg|fg)\b", _norm(bm.group(1))))


def _bg_is_solid_fill(style):
    """The paired background is a solid/accent COLOR fill (not none/transparent, not a theme
    bg/panel surface) — so light on-fill ink there is correct."""
    bm = _INLINE_BG.search(style)
    if not bm:
        return False
    bg = _norm(bm.group(1))
    if bg in ("none", "transparent", ""):
        return False
    if re.search(r"var\(\s*--(?:bg|panel)\b", bg):
        return False
    return "var(" in bg or bool(_BARE_HEX.match(bg)) or bg in ("black", "red")


def _bg_is_danger_fill(style):
    """The paired background is a CONTRASTING danger-surface fill on which the raw danger *ink* is a
    legible, intended treatment. Two footguns are explicitly excluded (CodeRabbit Major on #1690):
      • the BASE `var(--color-danger)` / `--color-error` token — raw danger ink on the SAME base
        danger hue is a 1:1 (invisible) pair, the worst case, so only the darker `-strong` PLATE
        qualifies (a `-strong` fullmatch, not a prefix search);
      • a neutral/light literal fill (e.g. `#fff`) — raw-danger-on-white is the exact ~3.9:1
        normal-body failure class this gate exists to catch (so `_bg_is_solid_fill`, which accepts
        any non-theme fill, is too permissive for the danger branch).
    Only the `-strong` danger plate + explicit dark-red literals pass. Enforces the "danger-strong
    surface OR `-strong` ink" rule the widened gate is meant to hold."""
    bm = _INLINE_BG.search(style)
    if not bm:
        return False
    bg = _norm(bm.group(1))
    if re.fullmatch(r"var\(\s*--color-(?:danger|error)-strong\s*\)", bg):
        return True
    return bg in ("crimson", "darkred", "firebrick", "maroon")


def test_danger_fill_gate_rejects_same_token_and_light_fills():
    """Regression (Greptile P1 + CodeRabbit Major on #1690): the size-aware danger branch must NOT
    accept raw danger *ink* on a same-hue or light fill. `color:var(--color-danger);
    background:var(--color-danger)` is a 1:1 (invisible) pair; raw-danger-on-#fff is ~3.9:1. Only the
    darker `-strong` plate (or an explicit dark-red literal) is a legible danger surface for raw
    danger ink; otherwise a normal-size control must ink `-strong` or move to white-on-fill."""
    # the 1:1 same-token pair — raw danger ink on the raw danger fill — must be REJECTED.
    assert not _bg_is_danger_fill("color:var(--color-danger);background:var(--color-danger)")
    assert not _bg_is_danger_fill("color:var(--color-error);background:var(--color-error)")
    # base danger/error tokens as a fill are NOT a legible surface for raw danger ink.
    assert not _bg_is_danger_fill("background:var(--color-danger)")
    assert not _bg_is_danger_fill("background: var(--color-error)")
    # a light / neutral literal fill must be REJECTED (raw-danger-on-white ~3.9:1).
    for lit in ("#fff", "#ffffff", "white", "#eee", "var(--panel)", "var(--bg)"):
        assert not _bg_is_danger_fill(f"background:{lit}"), f"{lit} must not count as a danger fill"
    # ONLY the darker -strong plate (or an explicit dark-red literal) qualifies.
    assert _bg_is_danger_fill("background:var(--color-danger-strong)")
    assert _bg_is_danger_fill("background: var(--color-error-strong)")
    assert _bg_is_danger_fill("background:darkred")


def test_currentcolor_mix_rejects_invisible_forms():
    """Regression (Greptile P1 on #1690): a currentColor/inherit→transparent mix follows the surface
    ONLY when it actually paints the ink. Degenerate/invisible forms (0% ink, transparent 100%, or a
    no-currentColor `transparent, transparent`) must NOT classify as surface-following, so an
    accidental 0% is caught by the closed-world gate instead of silently passing."""
    # the live, visible muted-meta shades follow the surface.
    for good in ("color-mix(in srgb, currentColor 62%, transparent)",
                 "color-mix(in srgb, currentColor 45%, transparent)",
                 "color-mix(in srgb, currentColor 22%, transparent)",
                 "color-mix(in srgb, inherit 40%, transparent)"):
        assert _follows_surface(good), f"visible muted shade must follow the surface: {good}"
    # invisible / degenerate forms must NOT be treated as surface-following.
    for bad in ("color-mix(in srgb, currentColor 0%, transparent)",
                "color-mix(in srgb, transparent 100%, currentColor)",
                "color-mix(in srgb, transparent, transparent)"):
        assert not _follows_surface(bad), f"invisible mix must NOT follow the surface: {bad}"


def test_index_html_inline_closed_world():
    """Genuinely closed-world (finding #6): EVERY inline color value must classify as an accepted
    family (inherit / decorative / theme-consistent / dark-ink / on-fill) or a tracked residual."""
    risky = []
    for file, line, style, color, tag in INLINE_SITES:
        if _follows_surface(color):
            continue                                   # inherit / currentColor → follows the surface
        if _accepted_decorative(style):
            continue                                   # accepted decorative watermark (§5)
        if _bg_covaries(style):
            continue                                   # theme-consistent pair (co-varying background)
        if _primary_dark(color):
            continue                                   # a dark literal is correct polarity on light glass
        if _standard_danger_strong(color):
            continue                                   # the AA-safe SOLID danger ink (dark red) — legible as normal body text on any surface
        if _standard_danger(color):
            # #1644 WIDENING (size-aware danger): the RAW danger HUE (var(--color-danger/--color-error))
            # clears the 3:1 large-bold / UI-hue floor but is only ~3.9:1 as NORMAL body text (rendered
            # audit: the vault BUTTON @ ~3.4:1). Accept it only on a large-bold HEADING or a colored
            # danger FILL; a normal-size control / body label must ink -strong (dark red) or move the
            # red onto a fill (white-on-danger-strong).
            if tag in _LARGE_TAGS or _bg_is_danger_fill(style):
                continue
            risky.append((file, line, color, style[:70]))
            continue
        if _light_ink(color) and _bg_is_solid_fill(style):
            continue                                   # white / light ink on a colored fill
        if _residual_hit(style, file):
            continue                                   # tracked residual (W6+ inline, if any)
        risky.append((file, line, color, style[:70]))
    assert not risky, (
        "#1644 INLINE closed-world: %d inline `style=\"color:…\"` site(s) ink a value that does not "
        "classify as an accepted family / theme-consistent pair / tracked residual. Migrate to a "
        "class/token, or add a KNOWN_RESIDUAL(W5) entry:\n" % len(risky)
        + "\n".join(f"  {f}:{ln}  color:{c}  [{s}]" for f, ln, c, s in risky)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# 8. JS-set + template inks — the SAME closed-world guarantee mirrored onto the JS path
#    (Greptile P1 + finding #6). Property-first template detection; assignment + setProperty
#    string literals (both ternary branches); co-varying template pairs are theme-consistent.
# ═══════════════════════════════════════════════════════════════════════════════════
_RETIRED_BRICK = re.compile(r"#c0392b|#e74c3c", re.I)                 # #1605 legacy flat-UI reds
_JS_ASSIGN = re.compile(
    r"\.style\.(?:color|webkitTextFillColor)\s*=|setProperty\(\s*['\"]color['\"]\s*,", re.I)
_JS_STRLIT = re.compile(r"'([^']*)'|\"([^\"]*)\"")
_TPL_COLOR = re.compile(r"(?<![-\w])color\s*:\s*([^;\"'`}]+)", re.I)  # property-first aware
_TPL_BG = re.compile(r"(?<![-\w])background(?:-color)?\s*:\s*([^;\"'`}]+)", re.I)
_COVARY_BG = re.compile(r"var\(\s*--(?:bg|panel|input-bg|fg)\b")


def _js_files():
    root = os.path.join(FE, "static", "js")
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            if f.endswith(".js"):
                yield os.path.join(dp, f)


def _js_color_sites():
    """(rel, line, value, covary) for every JS color SET. Three forms: `.style.color='X'` /
    `setProperty('color','X')` (BOTH ternary branches captured), and a template `style="…color:X…"`
    (color as the FIRST or a later declaration). Dynamic `${…}` values are skipped."""
    out = []
    for path in _js_files():
        rel = os.path.relpath(path, FE)
        for i, line in enumerate(_read(rel).split("\n"), 1):
            for m in _JS_ASSIGN.finditer(line):
                for sm in _JS_STRLIT.finditer(line[m.end():m.end() + 160]):
                    v = (sm.group(1) or sm.group(2) or "").strip()
                    if v and "${" not in v:
                        out.append((rel, i, v, False))
            if "style=" in line.lower():               # template style="…color:…"
                bgm = _TPL_BG.search(line)
                covary = bool(bgm and _COVARY_BG.search(bgm.group(1)))
                for cm in _TPL_COLOR.finditer(line):
                    v = cm.group(1).strip()
                    if v and "${" not in v:
                        out.append((rel, i, v, covary))
    return out


JS_COLOR_SITES = _js_color_sites()


def _js_risky_ink(v):
    """A JS-set value that could resolve to the WRONG polarity on a light surface — a cool token,
    the retired brick, or a bespoke bare hex. Primary-dark values are safe by construction."""
    if _primary_dark(v):
        return False
    return _cool_token(v) or bool(_RETIRED_BRICK.search(v)) or _bare_hex(v)


def test_js_cool_ink_closed_world():
    """The JS mirror of the CSS completeness test: no cool / wrong-polarity JS-set or template ink
    slips in un-registered. Fails closed on a new (file,value) family, a new occurrence of a
    registered one, or a brick that isn't a tracked residual."""
    unregistered, brick = [], []
    seen = collections.Counter()
    for rel, line, v, covary in JS_COLOR_SITES:
        if not _js_risky_ink(v):
            continue
        if covary:
            continue                                   # theme-consistent template pair (bg co-varies)
        if _RETIRED_BRICK.search(v) and not _residual_hit(v, rel):
            brick.append((rel, line, v))
            continue
        if _residual_hit(v, rel):
            continue                                   # tracked residual (the two settings.js W4 bugs)
        key = (rel, _norm(v))
        if key not in JS_COOL_REGISTRY:
            unregistered.append((rel, line, v))
        else:
            seen[key] += 1
    over = [(k, seen[k], JS_COOL_REGISTRY[k]) for k in seen if seen[k] > JS_COOL_REGISTRY[k]]
    assert not brick, (
        "#1644 JS brick: %d JS color set(s) paint the retired alizarin brick (#c0392b/#e74c3c, "
        "banned #1605) and are not a tracked KNOWN_RESIDUAL. It may NEVER be registered — fix it "
        "(W4) or add a KNOWN_RESIDUAL(W4) entry:\n" % len(brick)
        + "\n".join(f"  {rel}:{ln}  `{v}`" for rel, ln, v in brick)
    )
    assert not unregistered, (
        "#1644 JS closed-world: %d cool / wrong-polarity JS-set/template ink(s) are not in "
        "JS_COOL_REGISTRY and not a tracked KNOWN_RESIDUAL — a new cool JS ink cannot ship un-checked. "
        "Confirm it lands on a --fg-remapped/dark surface and register (file,value)→count, or repaint:\n"
        % len(unregistered)
        + "\n".join(f"  {rel}:{ln}  color={v!r}" for rel, ln, v in unregistered)
    )
    assert not over, (
        "#1644 JS closed-world: %d registered cool JS ink(s) now appear MORE times than the verified "
        "baseline — a new occurrence slipped in. Confirm each new site is on a safe surface and bump "
        "the JS_COOL_REGISTRY count:\n" % len(over)
        + "\n".join(f"  {rel} `{v}`: {actual} found > {reg} registered" for (rel, v), actual, reg in over)
    )


def test_js_cool_registry_entries_are_live():
    """Anti-rot for the JS registry: every JS_COOL_REGISTRY key still matches ≥1 live JS color set,
    and the retired brick is never a registry key."""
    live = collections.Counter((rel, _norm(v)) for rel, _ln, v, _c in JS_COLOR_SITES if _js_risky_ink(v))
    stale = sorted(k for k in JS_COOL_REGISTRY if live[k] == 0)
    assert not stale, (
        "#1644: %d JS_COOL_REGISTRY entr(y/ies) no longer match a live JS color set — remove the "
        "stale baseline entr(y/ies):\n" % len(stale) + "\n".join(f"  {rel} `{v}`" for rel, v in stale)
    )
    bricks = [k for k in JS_COOL_REGISTRY if _RETIRED_BRICK.search(k[1])]
    assert not bricks, "the retired brick must never be a JS_COOL_REGISTRY key: " + repr(bricks)


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 9 — anti-rot: every KNOWN_RESIDUAL entry occurs EXACTLY its expected `count` times in its
#          own file (finding #4). A wave that fixes one, OR a copy that adds one, fails here —
#          forcing the stale entry's deletion / a conscious count bump.
# ═══════════════════════════════════════════════════════════════════════════════════
def _residual_coverage():
    """How many LIVE scanner sites each KNOWN_RESIDUAL entry covers — counted against the real
    text-color SITES (not raw file substrings, so a shared hex in `border-color`/`box-shadow`/print
    is not miscounted), and FILE- + SEL-provenance-keyed. Entry i → count."""
    cov = collections.Counter()
    for i, e in enumerate(KNOWN_RESIDUAL):
        if e["file"] == "static/style.css":            # W6 bespoke-hex text-color decls
            for d in CSS_DECLS:
                if _bare_hex(d["val"]) and e["find"] in ("color: " + _norm(d["val"])) \
                        and (("sel" not in e) or e["sel"] in d["sel"]):
                    cov[i] += 1
        elif e["file"].startswith("static/js/"):       # W4 JS-set / template inks
            for rel, _ln, v, _c in JS_COLOR_SITES:
                if rel.endswith(e["file"]) and e["find"] in v:
                    cov[i] += 1
        else:                                          # W5 inline HTML style strings
            for file, _ln, style, _color, _tag in INLINE_SITES:
                if file.endswith(e["file"]) and e["find"] in style:
                    cov[i] += 1
    return cov


def test_known_residual_entries_still_present_at_expected_count():
    cov = _residual_coverage()
    drift = [(e, cov[i]) for i, e in enumerate(KNOWN_RESIDUAL) if cov[i] != e["count"]]
    assert not drift, (
        "#1644 anti-rot: %d KNOWN_RESIDUAL entr(y/ies) no longer cover their expected number of live "
        "sites — a wave fixed the spot (delete the stale entry) or a copy added one (bump/split the "
        "entry so a new occurrence can't silently reuse the exception):\n" % len(drift)
        + "\n".join(f"  {e['file']}:{e['line']} ({e['wave']})  `{e['find']}`  expected {e['count']}, covers {a}"
                    for e, a in drift)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 10 — coverage sanity: the enumerators are not silently empty (a blocking gate that scans
#           nothing is toothless).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_enumeration_coverage_floors():
    total = len(CSS_DECLS)
    frosted_default = [d for d in CSS_DECLS if d["default"] and _is_frosted(d["sel"])]
    cool_default = [d for d in frosted_default if _cool_token(d["val"]) and not _primary_dark(d["val"])]
    assert total >= 700, f"style.css color-decl scan collapsed: only {total} declarations found"
    assert len(frosted_default) >= 120, f"frosted default-render scan collapsed: only {len(frosted_default)}"
    assert len(cool_default) >= 25, f"frosted cool-token scan collapsed: only {len(cool_default)}"
    assert len(INLINE_SITES) >= 15, f"inline-color scan collapsed: only {len(INLINE_SITES)} sites"
    assert len(JS_COLOR_SITES) >= 120, f"JS color-set scan collapsed: only {len(JS_COLOR_SITES)} sites"
    js_cool = [s for s in JS_COLOR_SITES if _js_risky_ink(s[2])]
    assert len(js_cool) >= 100, f"JS cool-ink scan collapsed: only {len(js_cool)}"
    # every registered key is genuinely present (guards a typo'd registry key).
    live = {" ".join(d["sel"].split()) for d in cool_default}
    missing = sorted(k for k in COOL_REGISTRY if k not in live)
    assert not missing, "COOL_REGISTRY keys not found among live frosted cool decls: " + "; ".join(missing)
    js_live = collections.Counter((rel, _norm(v)) for rel, _ln, v, _c in JS_COLOR_SITES if _js_risky_ink(v))
    js_missing = sorted(k for k in JS_COOL_REGISTRY if js_live[k] == 0)
    assert not js_missing, "JS_COOL_REGISTRY keys not found among live JS color sets: " + repr(js_missing)


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 11 — #1644 WIDENING (surface-aware muted): the frosted --fg remap CONTAINER blocks must ALSO
#           floor the theme-MOVING muted META tokens, so `var(--color-muted*)` labels inside the
#           light-glass chrome resolve dark, not light-muted-on-light. (Catches the §1/§3 spots: the
#           settings inactive-nav labels + chat-meta timestamps at the SOURCE.)
# ═══════════════════════════════════════════════════════════════════════════════════
_MUTED_META_TOKENS = ("--color-muted", "--color-muted-alt", "--color-subheader")


def _custom_prop(body, name):
    """The value of a `--name:` custom-property declaration in a rule body (whole-token, so
    `--color-muted` does not match `--color-muted-alt`)."""
    m = re.search(re.escape(name) + r"(?![\w-])\s*:\s*([^;{}]+)", body)
    return _norm(m.group(1)) if m else None


def _is_dark_muted(v):
    """A floored dark muted ink for the light glass — the #2f323a --fg-muted value, a var pointing at
    it, or any primary-dark chrome ink."""
    if v is None:
        return False
    return v == "#2f323a" or v.startswith("var(--fg-muted") or _primary_dark(v)


def test_frosted_remap_containers_floor_muted_tokens():
    """A frosted --fg remap CONTAINER block (one that redefines --fg to the chrome dark ink on the
    light-glass settings/sidebar chrome) must ALSO floor --color-muted / --color-muted-alt /
    --color-subheader to a dark muted. The --fg remap (#1646 W3) fixes `var(--fg)` descendants, but
    the muted META tokens are theme-MOVING (LIGHT #9aa0a8 / #6b7280 in the dark theme) and are NOT
    swept by it — so a muted-token label (the settings inactive-nav labels, chat-meta timestamps,
    sub-headers) inside that container stayed light-muted-on-light-glass (~2.4:1, rendered audit
    §1/§3). Pinning the token remap makes any `var(--color-muted*)` descendant resolve dark by
    construction, exactly as the --fg remap already does for `var(--fg)`."""
    checked, bad = 0, []
    for sel, body, at_stack, _pos in _iter_rules(CSS_NC):
        if not _is_default_render(at_stack) or "theme-frosted" not in sel:
            continue
        # only the WHOLE-CONTAINER --fg remap blocks anchored on the settings/sidebar chrome — not the
        # per-element #16191f color patches, and not the adaptive-wallpaper heads.
        if not (".ow-window .ow-body" in sel or re.search(r"#sidebar(?![\w-])", sel)):
            continue
        if not re.search(r"--fg(?![\w-])\s*:\s*#16191f", body):
            continue
        checked += 1
        for tok in _MUTED_META_TOKENS:
            val = _custom_prop(body, tok)
            if not _is_dark_muted(val):
                bad.append((" ".join(sel.split())[:70], tok, val))
    assert checked >= 2, (
        "#1644 WIDENING: expected ≥2 frosted --fg-remap container blocks (the `.ow-window .ow-body` "
        "blanket + the `#sidebar` W3 block) to floor the muted tokens on; found %d — the anchors "
        "moved, re-point this gate." % checked
    )
    assert not bad, (
        "#1644 WIDENING (surface-aware muted): %d frosted --fg-remap container block/token pair(s) do "
        "not floor the theme-moving muted META token to a dark muted (#2f323a / var(--fg-muted)) — a "
        "`var(--color-muted*)` label inside this light-glass chrome would render light-muted-on-light. "
        "Add `<token>: #2f323a;` to the block:\n" % len(bad)
        + "\n".join(f"  block `{s}…`  {tok} = {val!r}" for s, tok, val in bad)
    )

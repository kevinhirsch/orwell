"""#1644 / W1 — the BLOCKING closed-world text-ink polarity gate.

Owner mandate (#1644): *"All text everywhere standardized… I worry about moments where
text in random spots is unreadable and we haven't migrated its style to something
standard."* This is THE structural guarantee that **no unreadable text can ship**.

It generalizes the two source-pinned spot-checks that proved the pattern
(`test_1601_chat_light_glass.py`, `test_appov_frosted_polarity_sweep.py` — #1601/#1639) from
their own two/one selectors to a **closed-world sweep over every committed text-color source**,
per the audit `docs/audits/2026-07-15-text-standardization-audit.md` §3.2.

THE FAILURE CLASS: text inked from a non-standard source that resolves to the WRONG POLARITY
for the surface it lands on. The canonical example (#1639): `--fg` (dark-theme `#9cdef2`, a cool
light cyan built for a dark background) inking the sidebar wordmark on the LIGHT frosted glass →
~1.3:1, light-on-light, unreadable — and there was no gate.

DESIGN — CLOSED-WORLD (registry-completeness), NOT a known-selector spot-check
------------------------------------------------------------------------------
A gate that only iterated a hand-list of light-surface selectors would let a NEW frosted light
surface added next month ink `var(--fg)` / `color-mix(--fg N%)` / an inline fallback and PASS
(the gate never looked at it). So instead this gate is exhaustive over the source:

  * ENUMERATE every text-color source from committed source — every `color:` /
    `-webkit-text-fill-color:` in `static/style.css` (rule-block + @media aware), every inline
    `style="color:…"` in `index.html` / `login.html`, and the JS `.style.color=` / `setProperty`
    / template `style="color:…"` string-literal inks in `static/js/**`.
  * CLASSIFY each declaration by the SURFACE POLARITY it lands on (light-glass chrome /
    opaque-dark-window / accent-or-danger fill / adaptive-wallpaper / disabled / print / code /
    theme-consistent) — a TOTAL function.
  * FAIL CLOSED: any `body.theme-frosted` / `body.glass-full` LIGHT-surface text source (default
    render) that carries a COOL / wrong-polarity ink and is NOT in the verified `COOL_REGISTRY`
    baseline → the build FAILS, forcing a registry entry + a polarity decision in the SAME PR. A
    new light surface inking from `var(--fg)` / `color-mix(--fg …)` / an inline fallback cannot
    ship un-checked.
  * ENFORCE polarity + source-family-keyed: light-surface text must resolve to the dark-ink
    standard (`#16191f` / `--ow-control-ink` family); on-fill white only on accent/danger fills;
    `#000/#333` only in `@media print`; disabled inks only on disabled selectors; `--hl-*` only
    for code. WCAG is recomputed for the standard inks and asserted ≥ AA (4.5 normal / 3.0
    large-UI), mirroring #1639's `GLASS_OVER_BLACK` worst case.

RATCHET (this gate LANDS GREEN and only bites NEW breakage): the CURRENT post-#1639 correct
state is encoded as the passing baseline (`COOL_REGISTRY` + the accepted-by-rule classes). The
genuinely-risky residuals the audit still flags — the ones waves W3–W6 will fix — are tracked in
an EXPLICIT, COMMENTED `KNOWN_RESIDUAL` allowlist (each with file:line + the fixing wave), so
they are visible-not-hidden and a future wave MUST remove them (an anti-rot test asserts each is
still present, so a fixed residual whose stale entry lingers fails the gate). A genuinely-NEW
wrong-polarity ink is NEVER swallowed — it is not in `KNOWN_RESIDUAL`, so it fails closed.

Deterministic, source-pinned, no browser/model/network — runs in the fast parallel `fe-unit`
lane and is BLOCKING (`ci-gate.needs`). It covers surfaces the golden play-through never renders
— exactly the "no unreadable text can ship" signal #1644 asks for.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── WCAG thresholds ────────────────────────────────────────────────────────────────
AA_NORMAL = 4.5
AA_LARGE = 3.0

# ── the standard inks + the fixed light-glass material (from the audit §1 / #1639) ──
CHROME_INK = "#16191f"          # the canonical dark ink for light-glass chrome (--ow-control-ink)
DARK_WINDOW_INK = "#eef1f4"     # light ink for the deliberately-opaque #orwell-headshot dark window
LIGHT_GLASS = (255, 255, 255)   # the .60 near-white glass material every frosted chrome composites onto
GLASS_ALPHA = 0.60              # --ow-glass-opacity default (sidebar / bubble floor)
DARK_WINDOW_FILL = (29, 32, 38) # #orwell-headshot opaque fill (rgb 29,32,38)


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ═══════════════════════════════════════════════════════════════════════════════════
# 1. SOURCE PARSING — comment-blank (KEEP newlines so line numbers stay true), a
#    brace-depth + @media-aware rule iterator, and the property-position color scanner.
# ═══════════════════════════════════════════════════════════════════════════════════
def _blank_comments_keeplines(s):
    """Blank /* … */ to spaces but PRESERVE newlines, so reported line numbers match the
    real file (unlike #1639's newline-collapsing strip, which is fine for cascade math but
    wrong for the file:line the registry / KNOWN_RESIDUAL entries cite)."""
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

# The DEFAULT render = top-level rules PLUS `@media (prefers-reduced-transparency: no-preference)`
# (the default transparency state, where the light-glass fixes live). Every OTHER at-rule context
# — `prefers-reduced-transparency: reduce` / `prefers-contrast: more` a11y fallbacks (the glass
# goes SOLID, so `var(--fg)` light ink is CORRECT there), width breakpoints, @supports/@keyframes
# — is a CONDITIONAL override and is EXCLUDED from the light-glass risk class (mirrors #1639).
_DEFAULT_MEDIA = "prefers-reduced-transparency: no-preference"


def _iter_rules(css):
    """Yield (selector, body, at_stack, body_char_pos) for each style rule, brace-depth aware,
    tracking the enclosing at-rule prelude stack. A style-rule body holds no nested `{}` (this
    CSS uses no native nesting), so its end is the next `}`; at-rule blocks push/pop the stack."""
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
        elif c == ";":  # bare at-statement (@import/@charset) terminator — reset the prelude
            prelude_start = i + 1
            i += 1
        else:
            i += 1


def _is_default_render(at_stack):
    """True for the default cascade: top-level, or nested ONLY inside the default-transparency
    media. Any other conditional context (reduce / contrast / breakpoint) is excluded."""
    return all(_DEFAULT_MEDIA in prelude for prelude in at_stack)


def _lineno(css, pos):
    return css.count("\n", 0, pos) + 1


# property-position `color:` (word-boundary — excludes background-color/border-color/…) and
# `-webkit-text-fill-color:`, anchored at a declaration start (`;` or block start), so a
# `color:` embedded in a `[style*="color:…"]` SELECTOR is NOT mis-read as a declaration.
_DECL = re.compile(r"(?:^|;)\s*(-webkit-text-fill-color|color)\s*:\s*([^;{}]*)", re.I)


def _css_color_decls():
    """Every text-color declaration in style.css as records:
    {line, sub_selector (comma-split, whitespace-normalized), value, default_render, print}."""
    recs = []
    for sel, body, at_stack, pos in _iter_rules(CSS_NC):
        line = _lineno(CSS_NC, pos)
        is_default = _is_default_render(at_stack)
        is_print = any("print" in p for p in at_stack)
        for sub in sel.split(","):
            sub = " ".join(sub.split())
            if not sub:
                continue
            for mm in _DECL.finditer(body):
                val = mm.group(2).replace("!important", "").strip()
                if val:
                    recs.append({
                        "line": line, "sel": sub, "val": val,
                        "default": is_default, "print": is_print,
                    })
    return recs


CSS_DECLS = _css_color_decls()

# frosted / glass-full LIGHT-glass scope (the fixed-light-material themes). `body:not(.theme-frosted)`
# is EXCLUDED (it is the NON-frosted theme, where --fg moves with the theme — theme-consistent).
_FROSTED_SCOPE = re.compile(r"body\.(?:theme-frosted|glass-full)\b")


def _is_frosted(sel):
    return bool(_FROSTED_SCOPE.search(sel))


# ═══════════════════════════════════════════════════════════════════════════════════
# 2. VALUE-FORM classifiers — aware of the inventory's REAL forms: nested
#    `var(--accent, var(--red))` fallbacks, `color-mix(in srgb, var(--fg) N%, …)`,
#    `var(--ow-control-ink, var(--fg,#fff))` (primary wins), bare hex, rgba.
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


def _cool_token(v):
    return bool(_COOL.search(_norm(v)))


def _primary_dark(v):
    """The value's PRIMARY (resolved) token is the dark chrome ink — so a cool fallback that never
    fires (e.g. `var(--ow-control-ink, var(--fg,#fff))`, `color-mix(in srgb, #16191f …)`) is dark,
    not cool. Checked BEFORE _cool_token so primary wins."""
    v = _norm(v)
    if v in ("#16191f", "#000", "#000000", "#111", "#111111"):
        return True
    if v.startswith(("var(--ow-control-ink", "var(--ow-ink-chrome")):  # incl. W2's future token
        return True
    if v.startswith("color-mix(in srgb, #16191f") or v.startswith("color-mix(in srgb, var(--ow-control-ink"):
        return True
    if re.match(r"^rgba?\(\s*22\s*,\s*25\s*,\s*31\b", v):   # #16191f at reduced alpha (muted dark ink)
        return True
    if re.match(r"^rgba?\(\s*0\s*,\s*0\s*,\s*0\b", v):      # dark control glyph
        return True
    return False


def _light_ink(v):
    return _norm(v) in ("#fff", "#ffffff", "white", DARK_WINDOW_INK, "#e8eef2")


def _hl_syntax(v):
    return _norm(v).startswith("var(--hl-")


def _follows_surface(v):
    return _norm(v) in ("inherit", "currentcolor", "transparent")


_BARE_HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def _bare_hex(v):
    return bool(_BARE_HEX.match(_norm(v)))


def _disabled_ink(v):
    return _norm(v) in ("#57575c",) or "var(--fg, #fff) 40%" in _norm(v)  # #57575c / the disabled color-mix


def _kit_on_fill_ink(v):
    """A kit luminance-aware ON-FILL ink token — the correct ink FOR an accent/danger fill
    (`var(--ow-on-accent)` / `var(--ow-on-danger)` / `var(--on-accent)` / `var(--on-danger)`)."""
    return _norm(v).startswith(
        ("var(--ow-on-accent", "var(--ow-on-danger", "var(--on-accent", "var(--on-danger")
    )


# ── surface predicates over the SELECTOR (source-family-keyed enforcement) ──────────
# on-fill selectors (a colored/accent/danger FILL — white/#fff is the correct on-accent/on-danger
# ink there, §5). Distinctive class tokens covering every current #fff/white text site (fff scan).
_ON_FILL_TOKENS = (
    ".send-btn", ".odec-confirm", ".confirm-btn-danger", ".admin-btn-delete", ".gallery-card-play",
    ".attach-ocr-btn", ".shortcut-warn", ".gallery-editor-draft-delete", ".settings-nav-item.active",
    ".admin-tab.active", ".msg-user", ".theme-seg", ".recording-content", "-recording", ".stop-recording",
    ".ow-btn-destructive", ".ow-close", ".ow-close:hover", ".gallery-card-delete",
)


def _is_fill(sel):
    return any(tok in sel for tok in _ON_FILL_TOKENS)


def _is_disabled_sel(sel):
    return bool(re.search(r":disabled|\[disabled\]|\[aria-disabled|\.is-disabled", sel))


def _is_dark_window(sel):
    return "#orwell-headshot" in sel


# ═══════════════════════════════════════════════════════════════════════════════════
# 3. THE COOL_REGISTRY — the verified-safe (#1639-swept) baseline of frosted/glass-full
#    DEFAULT-render selectors that legitimately ink a COOL token. EXACT (whitespace-
#    normalized) sub-selectors: a NEW selector (even a sibling) is NOT in the set and
#    fails closed. This IS the closed-world guarantee's allowlist — every entry is
#    verified-correct today; the map's JOB is completeness, not breadth.
# ═══════════════════════════════════════════════════════════════════════════════════
COOL_REGISTRY = {
    # — titlebar chrome: inside the `.ow-titlebar → #16191f` / `.ow-window .ow-body` container
    #   remap (style.css L24065-24075), so `var(--fg)` resolves to the dark chrome ink. —
    'body.theme-frosted .ow-title': ("light-glass-remapped", "titlebar; container --fg:#16191f remap"),
    'body.theme-frosted .ow-titlebar-accessory': ("light-glass-remapped", "titlebar; container --fg:#16191f remap"),

    # — native <select> option lists: browser-native dropdown rendering (--select-option-fg);
    #   #1639 verified-correct-and-left-alone. —
    'body.theme-frosted select.ow-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted .admin-card select:not(.ow-select) option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.admin-tools-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.theme-fd-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.memory-sort-select option': ("native-option", "native option list; #1639-verified"),
    'body.theme-frosted select.memory-edit-cat-select option': ("native-option", "native option list; #1639-verified"),

    # — the GLOBAL no-accent-on-text remap RULES themselves: they repaint accent/red links to the
    #   body `var(--fg)` (the chrome dark ink inside the container set). #1639 hardened the fragile
    #   .msg-ai landing to `inherit` (APP-OV-4); these remain the mitigation for chrome-scoped links. —
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

    # — theme-background source inputs: on the settings light glass inside the container remap;
    #   #1639 verified-correct-and-left-alone. —
    'body.theme-frosted #theme-bg-source': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-url': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-file': ("light-glass-remapped", "theme-bg input; #1639-verified"),
    'body.theme-frosted #theme-bg-image-file::file-selector-button': ("light-glass-remapped", "theme-bg input; #1639-verified"),

    # — adaptive-over-wallpaper text: NOT chrome — floats over the wallpaper and drives ink via
    #   `var(--fg)` + a `var(--bg)`-derived legibility halo (dark on light palettes), the same
    #   adaptive pattern as .msg-ai / the sidebar labels. Light `#e8eef2` fallback is correct. —
    'body.theme-frosted .agent-thread-node:not(.ow-slate-outcome) .agent-thread-tool':
        ("adaptive-wallpaper", "agent-thread tool ink; adaptive over wallpaper + halo"),
    'body.theme-frosted .gadget-rail-head': ("adaptive-wallpaper", "gadget-rail head; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-head *': ("adaptive-wallpaper", "gadget-rail head; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-title': ("adaptive-wallpaper", "gadget-rail title; adaptive over wallpaper"),
    'body.theme-frosted .gadget-rail-rearrange[aria-pressed="true"]': ("adaptive-wallpaper", "gadget-rail control; adaptive"),
}


# ═══════════════════════════════════════════════════════════════════════════════════
# 4. KNOWN_RESIDUAL — the genuinely-risky spots the audit still flags, awaiting waves
#    W3–W6. EXPLICIT + COMMENTED, each with file:line + the fixing wave. Tracked-not-
#    hidden: the closed-world checks REQUIRE a residual to be listed here (else they
#    fail closed on it), and an anti-rot test asserts each is STILL PRESENT in source
#    (a wave that fixes one MUST delete its stale entry). A genuinely-new failure is
#    never swallowed — it is not in this list. Each entry: {file, line (doc), find
#    (a stable content anchor), wave, why}.
# ═══════════════════════════════════════════════════════════════════════════════════
KNOWN_RESIDUAL = [
    # ── W4 — JS status inks: two UNDEFINED-token color fallbacks in settings.js ──
    {"file": "static/js/settings.js", "line": 1084, "find": "'var(--danger, #c0392b)'",
     "wave": "W4", "why": "`--danger` is undefined → paints the retired alizarin brick #c0392b (banned #1605); "
                          "route through a surface-aware status helper"},
    {"file": "static/js/settings.js", "line": 997, "find": "'var(--amber, var(--fg))'",
     "wave": "W4", "why": "`--amber` is undefined → falls to var(--fg) (light on frosted-light); fix the token"},

    # ── W5 — index.html inline: risky cool-on-`background:none` / bespoke-red inline sites ──
    {"file": "static/index.html", "line": 1539, "find": "1px dashed var(--border);color:var(--fg)",
     "wave": "W5", "why": "dashed-add button: var(--fg) on background:none opacity .6 → light-cyan-on-light-glass on frosted"},
    {"file": "static/index.html", "line": 1280, "find": "color:var(--accent,var(--red))",
     "wave": "W5", "why": "inline accent link on background:none (the #1639 accent-on-light-glass class)"},
    {"file": "static/index.html", "line": 2335, "find": "color:var(--accent, var(--red))",
     "wave": "W5", "why": "inline accent link on background:none (the #1639 accent-on-light-glass class)"},
    {"file": "static/index.html", "line": 1726, "find": "color:color-mix(in srgb, var(--fg) 45%, transparent)",
     "wave": "W5", "why": "empty-state hints (×10 at --fg 45%) on background:none → muted light-on-light on frosted"},
    {"file": "static/index.html", "line": 2350, "find": "color:color-mix(in srgb, var(--fg) 55%, transparent)",
     "wave": "W5", "why": "empty-state hint (--fg 55%) on background:none → muted light-on-light on frosted"},
    {"file": "static/index.html", "line": 2255, "find": "color:#e55",
     "wave": "W5", "why": "bespoke error red #e55 (Danger Zone h2, index.html:2255 & 2660; ~3.4:1 on light surfaces)"},
    {"file": "static/index.html", "line": 2573, "find": "color:#f0a6a6",
     "wave": "W5", "why": "bespoke error red #f0a6a6 (~3.4:1 on light surfaces); tokenize to the danger standard"},

    # ── W6 — style.css bespoke status/accent hexes (dark-or-status hexes; tokenize) ──
    {"file": "static/style.css", "line": 7807, "find": "#e0a050", "sel": ".compare-parallel-toggle",
     "wave": "W6", "why": "bespoke compare-toggle amber; tokenize to a status token"},
    {"file": "static/style.css", "line": 7811, "find": "#5b8def", "sel": ".compare-parallel-toggle.active",
     "wave": "W6", "why": "bespoke compare-toggle blue; tokenize to a status/accent token"},
    {"file": "static/style.css", "line": 18257, "find": "#b48a4a", "sel": ".notes-pane-archive",
     "wave": "W6", "why": "bespoke notes-archive gold; tokenize"},
    {"file": "static/style.css", "line": 14973, "find": "#4ade80", "sel": ".cookbook-gpu-btn.gpu-free",
     "wave": "W6", "why": "bespoke gpu-free green; tokenize to --color-success"},
    {"file": "static/style.css", "line": 23966, "find": "#000", "sel": "#orwell-status .og-chev",
     "wave": "W6", "why": "bespoke #000 chevron glyph (dark-on-light OK, but bare #000 outside print); tokenize to --ow-control-ink"},
]

# ── ACCEPTED exceptions (contrast holds / semantically correct — audit §5) ──────────
# The low-opacity monospace brand watermark: diegetic, deliberately faint, not body ink.
_ACCEPTED_INLINE = ("var(--brand-color,var(--red,#e06c75))",)
# Bespoke hex text colors accepted by their SURFACE rule (not residual):
#   #16191f chrome ink · #fff/white on on-fill selectors · #57575c disabled · #000/#333 @media
#   print · #3fb950 diff-add (diff family, §5) · #eef1f4/#e8eef2 light-ink-on-dark-window.
_ACCEPTED_DIFF_GREEN = "#3fb950"


def _residual_hit(context, sel=None):
    """A residual entry matching this context (its `find` anchor appears in `context`, and if the
    entry pins a `sel`, that selector token is present too). Returns the entry or None."""
    for e in KNOWN_RESIDUAL:
        if e["find"] in context and (("sel" not in e) or (sel is not None and e["sel"] in sel)):
            return e
    return None


# ═══════════════════════════════════════════════════════════════════════════════════
# 5. WCAG math (verbatim from #1601/#1639) + the light-glass worst-case fill.
# ═══════════════════════════════════════════════════════════════════════════════════
def _hx(h):
    h = h.lstrip("#")
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


# the .60 light glass composited over pure black — the worst case for a dark ink floating on the
# translucent glass with no backing chip (#1639's GLASS_OVER_BLACK).
GLASS_OVER_BLACK = _over(LIGHT_GLASS, (0, 0, 0), GLASS_ALPHA)


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 1 — THE CLOSED-WORLD GUARANTEE: every frosted/glass-full DEFAULT-render text
#          source is classified; a cool/wrong-polarity ink that is not verified-safe
#          (COOL_REGISTRY) or a tracked residual FAILS CLOSED. This is the fail-closed
#          registry-completeness core, and it bites BOTH mutation classes (an existing
#          light-surface rule re-inked to var(--fg), and a brand-new unregistered
#          light-surface color: decl).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_frosted_light_surface_closed_world_completeness():
    unclassified = []
    wrong_polarity = []
    for d in CSS_DECLS:
        if not (d["default"] and _is_frosted(d["sel"])):
            continue
        sel, val = d["sel"], d["val"]
        # accepted-by-rule, in polarity order:
        if _primary_dark(val):
            continue                                   # resolves to the dark chrome ink → correct on light glass
        if _hl_syntax(val):
            continue                                   # code syntax token
        if _follows_surface(val):
            continue                                   # inherit / currentColor / transparent → follows the pinned surface
        if _light_ink(val):
            # light ink is correct ONLY on a fill or the opaque dark window; on light glass it is
            # the exact light-on-light bug class.
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
                continue                               # verified-safe baseline (container remap / native / adaptive)
            if _residual_hit(val, sel):
                continue                               # tracked residual (W3–W6)
            unclassified.append((d["line"], sel, val))
            continue
        if _bare_hex(val):
            # a bare hex on a frosted surface is handled by the app-wide bespoke ratchet (TEST 5);
            # a DARK bare hex is correct polarity on light glass, a light one was caught above.
            continue
        # anything else under frosted we could not classify → fail closed (total function).
        unclassified.append((d["line"], sel, val))

    assert not unclassified, (
        "#1644 CLOSED-WORLD: %d frosted/glass-full light-surface text source(s) ink a COOL / "
        "unclassified token but are NOT in COOL_REGISTRY and NOT a tracked KNOWN_RESIDUAL — a new "
        "light surface cannot ship an un-checked ink. Repaint to the dark chrome ink (#16191f / "
        "var(--ow-control-ink)) OR, if genuinely verified-safe (a container --fg remap / native "
        "option / adaptive-over-wallpaper), add an explicit COOL_REGISTRY entry with the reason:\n"
        % len(unclassified)
        + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}" for ln, sel, val in unclassified)
    )
    assert not wrong_polarity, (
        "#1644 POLARITY: %d frosted/glass-full text source(s) resolve to the WRONG polarity for "
        "their surface:\n" % len(wrong_polarity)
        + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}  — {why}" for ln, sel, val, why in wrong_polarity)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 2 — the COOL_REGISTRY is not rotten: every registered selector still exists in
#          the CSS as a frosted default-render cool-token declaration (so a fixed /
#          renamed selector forces the stale entry's removal, and the registry cannot
#          bless a selector that no longer inks a cool token).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_cool_registry_entries_are_live_and_cool():
    live = {" ".join(d["sel"].split()) for d in CSS_DECLS
            if d["default"] and _is_frosted(d["sel"]) and _cool_token(d["val"]) and not _primary_dark(d["val"])}
    stale = sorted(k for k in COOL_REGISTRY if k not in live)
    assert not stale, (
        "#1644: %d COOL_REGISTRY entr(y/ies) no longer match a live frosted cool-token declaration "
        "(fixed or renamed) — remove the stale baseline entr(y/ies) so the allowlist stays honest:\n"
        % len(stale) + "\n".join(f"  {k}" for k in stale)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 3 — source-family-keyed polarity ratchets (independent of the frosted scope):
#          on-fill white ONLY on fill selectors; disabled ink ONLY on disabled
#          selectors; #000/#333 ONLY in @media print. Each keyed by (value, surface).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_on_fill_white_only_on_fill_selectors():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _norm(d["val"]) in ("#fff", "#ffffff", "white")
           and not (_is_fill(d["sel"]) or _is_dark_window(d["sel"]) or _is_disabled_sel(d["sel"]))]
    assert not bad, (
        "#1644: on-fill white (#fff/white) must ink only an accent/danger FILL (or the dark window) "
        "— it is light-on-light anywhere else. Offenders:\n"
        + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


def test_disabled_ink_only_on_disabled_selectors():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _norm(d["val"]) == "#57575c" and not _is_disabled_sel(d["sel"])]
    assert not bad, (
        "#1644: the disabled ink #57575c is a WCAG-1.4.3-exempt inactive-control ink and must ink "
        "only :disabled / [disabled] / [aria-disabled] selectors. Offenders:\n"
        + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


def test_plain_black_only_in_print():
    bad = [(d["line"], d["sel"]) for d in CSS_DECLS
           if _norm(d["val"]) in ("#000", "#000000", "#333", "#333333")
           and not d["print"] and not _residual_hit(d["val"], d["sel"])]
    assert not bad, (
        "#1644: bare #000/#333 body ink is reserved for @media print (white paper). A new one on a "
        "screen surface needs a KNOWN_RESIDUAL entry (tokenize to --ow-control-ink). Offenders:\n"
        + "\n".join(f"  style.css:{ln}  `{sel}`" for ln, sel in bad)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 4 — WCAG recomputation for the standard inks on their standard surfaces (would
#          catch a drift in #16191f / #eef1f4 or the glass material).
# ═══════════════════════════════════════════════════════════════════════════════════
def test_standard_inks_clear_aa_on_their_surfaces():
    # dark chrome ink on the .60 light glass over the darkest backdrop (worst case) — the #1639 floor.
    r_dark = _ratio(_hx(CHROME_INK), GLASS_OVER_BLACK)
    assert r_dark >= AA_NORMAL, (
        f"#1644: the dark chrome ink {CHROME_INK} on the .60 light glass over pure black is "
        f"{r_dark:.2f}:1, must clear AA {AA_NORMAL}:1"
    )
    # light window ink on the opaque #orwell-headshot dark fill.
    r_light = _ratio(_hx(DARK_WINDOW_INK), DARK_WINDOW_FILL)
    assert r_light >= AA_NORMAL, (
        f"#1644: the light window ink {DARK_WINDOW_INK} on the opaque dark window fill "
        f"{DARK_WINDOW_FILL} is {r_light:.2f}:1, must clear AA {AA_NORMAL}:1"
    )
    # large-UI floor sanity (the wordmark is large-weight but must not rely on it): still ≥ AA large.
    assert r_dark >= AA_LARGE and r_light >= AA_LARGE


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 5 — the app-wide BESPOKE-HEX ratchet: every BARE-hex text color must be accepted
#          by a surface rule (chrome ink / on-fill / disabled / print / diff-green /
#          dark-window light ink) or be a tracked KNOWN_RESIDUAL(W6). A NEW bespoke hex
#          fails closed — this is the "brand-new unregistered color: decl fails" axis.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_bespoke_hex_ratchet():
    strays = []
    for d in CSS_DECLS:
        v = _norm(d["val"])
        if not _bare_hex(v):
            continue
        if v == _norm(CHROME_INK):
            continue                                   # the chrome dark-ink standard
        if v in ("#fff", "#ffffff", "white") and (_is_fill(d["sel"]) or _is_dark_window(d["sel"])):
            continue                                   # on-accent / on-danger
        if v == "#57575c" and _is_disabled_sel(d["sel"]):
            continue                                   # disabled (WCAG-exempt)
        if v in ("#000", "#000000", "#333", "#333333") and d["print"]:
            continue                                   # print on white paper
        if v == _ACCEPTED_DIFF_GREEN:
            continue                                   # diff-add family (§5)
        if v in (_norm(DARK_WINDOW_INK), "#e8eef2") and _is_dark_window(d["sel"]):
            continue                                   # light ink on the dark window
        if _residual_hit(d["val"], d["sel"]):
            continue                                   # tracked residual (W6)
        strays.append((d["line"], d["sel"], d["val"]))
    assert not strays, (
        "#1644 BESPOKE-HEX ratchet: %d bare-hex text color(s) are neither accepted by a surface "
        "rule nor a tracked KNOWN_RESIDUAL. Tokenize to a kit ink, or add a KNOWN_RESIDUAL(W6) "
        "entry with the fixing wave:\n" % len(strays)
        + "\n".join(f"  style.css:{ln}  `{sel}`  color:{val}" for ln, sel, val in strays)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# 6. INLINE (index.html / login.html) enumeration + closed-world check.
# ═══════════════════════════════════════════════════════════════════════════════════
_STYLE_ATTR = re.compile(r'style="([^"]*)"')
_INLINE_COLOR = re.compile(r"(?:^|;)\s*color\s*:\s*([^;\"]*)", re.I)
_INLINE_BG = re.compile(r"(?:^|;)\s*background(?:-color)?\s*:\s*([^;\"]*)", re.I)


def _html_inline_color_sites(rel):
    """Every inline `style="…color:…"` site as (line, style_string, color_value)."""
    sites = []
    for i, line in enumerate(_read(rel).split("\n"), 1):
        for m in _STYLE_ATTR.finditer(line):
            style = m.group(1)
            cm = _INLINE_COLOR.search(style)
            if cm and cm.group(1).strip():
                sites.append((i, style, cm.group(1).strip()))
    return sites


INLINE_SITES = _html_inline_color_sites("static/index.html") + _html_inline_color_sites("static/login.html")


def _bg_covaries(style):
    """The paired background is itself a theme token (bg/panel/input-bg/fg) — so color+background
    move together and the pair is theme-consistent (an inverted CTA or a themed field), not
    stranded on a fixed-polarity glass surface."""
    bm = _INLINE_BG.search(style)
    if not bm:
        return False
    bg = _norm(bm.group(1))
    return bool(re.search(r"var\(\s*--(?:bg|panel|input-bg|fg)\b", bg))


def test_index_html_inline_closed_world():
    risky = []
    for line, style, color in INLINE_SITES:
        if _follows_surface(color):
            continue                                   # inherit / currentColor → follows the surface
        if any(a in style.replace(" ", "") for a in (x.replace(" ", "") for x in _ACCEPTED_INLINE)):
            continue                                   # accepted decorative watermark (§5)
        cool_or_hex = _cool_token(color) or _bare_hex(color)
        if not cool_or_hex:
            continue                                   # a standard token / non-risky value
        if _primary_dark(color):
            continue                                   # a dark literal is correct polarity on light glass
        if _bg_covaries(style):
            continue                                   # theme-consistent pair (co-varying background)
        if _residual_hit(style):
            continue                                   # tracked residual (W5)
        risky.append((line, color, style[:70]))
    assert not risky, (
        "#1644 INLINE closed-world: %d inline `style=\"color:…\"` site(s) ink a cool token / bespoke "
        "hex on a non-co-varying (fixed-polarity) surface and are not tracked. Migrate to a class/"
        "token, or add a KNOWN_RESIDUAL(W5) entry:\n" % len(risky)
        + "\n".join(f"  index/login.html:{ln}  color:{c}  [{s}]" for ln, c, s in risky)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# 7. JS-set inks — the retired brick + undefined-token color fallbacks. Deterministic
#    string-literal scan of `.style.color=` / `.style.webkitTextFillColor=` /
#    `setProperty('color',…)` / template `style="color:…"`. Bans the #1605-retired
#    alizarin brick and the two undefined-token (`--danger`/`--amber`) color fallbacks
#    unless tracked (W4). A NEW brick / undefined-token color set fails closed.
# ═══════════════════════════════════════════════════════════════════════════════════
_RETIRED_BRICK = re.compile(r"#c0392b|#e74c3c", re.I)                 # #1605 legacy flat-UI reds
_UNDEF_TOKEN_COLOR = re.compile(r"var\(\s*--(?:danger|amber)\b", re.I)  # undefined tokens used as color
_JS_COLOR_SET = re.compile(
    r"(?:\.style\.(?:color|webkitTextFillColor)\s*=|setProperty\(\s*['\"]color['\"]\s*,|"
    r"style=(?:\\?['\"])[^'\"]*?[^-]color\s*:)\s*",
    re.I,
)


def _js_files():
    root = os.path.join(FE, "static", "js")
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            if f.endswith(".js"):
                yield os.path.join(dp, f)


def _js_color_literal_lines():
    """(rel_path, line, text) for every JS line that SETS a color (property, not var-def)."""
    out = []
    for path in _js_files():
        rel = os.path.relpath(path, FE)
        with open(path, encoding="utf-8") as fh:
            for i, line in enumerate(fh.read().split("\n"), 1):
                if _JS_COLOR_SET.search(line) or (".style.color" in line and "=" in line):
                    out.append((rel, i, line))
    return out


JS_COLOR_LINES = _js_color_literal_lines()


def test_js_retired_brick_and_undefined_token_colors_are_tracked():
    strays = []
    for rel, line, text in JS_COLOR_LINES:
        # only consider the assigned color value region (right of the first '=' / ':') to avoid a
        # brick hex sitting in an unrelated part of the line.
        for m in _JS_COLOR_SET.finditer(text):
            tail = text[m.end():m.end() + 80]
            hit = _RETIRED_BRICK.search(tail) or _UNDEF_TOKEN_COLOR.search(tail)
            if hit and not _residual_hit(text):
                strays.append((rel, line, tail.strip()[:60]))
                break
    assert not strays, (
        "#1644 JS inks: %d color assignment(s) use the retired alizarin brick (#c0392b/#e74c3c, "
        "banned #1605) or an UNDEFINED token color (var(--danger/--amber) → brick / cool fg) and "
        "are not tracked. Route through a surface-aware status helper (W4) or add a "
        "KNOWN_RESIDUAL(W4) entry:\n" % len(strays)
        + "\n".join(f"  {rel}:{ln}  …{t}…" for rel, ln, t in strays)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 8 — anti-rot: every KNOWN_RESIDUAL entry is STILL present in source. When a wave
#          (W3–W6) fixes a residual, its stale allowlist entry MUST be deleted in the
#          same PR — a lingering fixed entry fails here.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_known_residual_entries_still_present():
    gone = []
    cache = {}
    for e in KNOWN_RESIDUAL:
        src = cache.setdefault(e["file"], _read(e["file"]))
        ok = e["find"] in src
        if ok and "sel" in e:
            ok = e["sel"] in src
        if not ok:
            gone.append(e)
    assert not gone, (
        "#1644 anti-rot: %d KNOWN_RESIDUAL entr(y/ies) no longer appear in source — a wave fixed "
        "the spot; DELETE the stale allowlist entr(y/ies) so the ratchet keeps ratcheting:\n"
        % len(gone) + "\n".join(f"  {e['file']}:{e['line']} ({e['wave']})  `{e['find']}`" for e in gone)
    )


# ═══════════════════════════════════════════════════════════════════════════════════
# TEST 9 — coverage sanity: the enumerators are not silently empty (a blocking gate that
#          scans nothing is toothless). Floors are well below current counts so ordinary
#          growth never trips them; a scanner regression that zeroes a source does.
# ═══════════════════════════════════════════════════════════════════════════════════
def test_enumeration_coverage_floors():
    total = len(CSS_DECLS)
    frosted_default = [d for d in CSS_DECLS if d["default"] and _is_frosted(d["sel"])]
    cool_default = [d for d in frosted_default if _cool_token(d["val"]) and not _primary_dark(d["val"])]
    assert total >= 700, f"style.css color-decl scan collapsed: only {total} declarations found"
    assert len(frosted_default) >= 120, (
        f"frosted default-render scan collapsed: only {len(frosted_default)} declarations"
    )
    assert len(cool_default) >= 25, (
        f"frosted cool-token scan collapsed: only {len(cool_default)} — the closed-world core is toothless"
    )
    assert len(INLINE_SITES) >= 15, f"inline-color scan collapsed: only {len(INLINE_SITES)} sites"
    assert len(JS_COLOR_LINES) >= 80, f"JS color-set scan collapsed: only {len(JS_COLOR_LINES)} lines"
    # every registered cool selector is genuinely present (guards a typo'd registry key).
    live = {" ".join(d["sel"].split()) for d in cool_default}
    missing = sorted(k for k in COOL_REGISTRY if k not in live)
    assert not missing, "COOL_REGISTRY keys not found among live frosted cool decls: " + "; ".join(missing)

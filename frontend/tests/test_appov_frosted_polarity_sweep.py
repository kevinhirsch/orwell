"""APP-OV-4 / APP-OV-5 — frosted light-surface text-polarity sweep (2026-07-15).

Root cause: the frosted theme paints chrome/bubbles as a LIGHT near-white glass material
REGARDLESS of the theme tokens, but several rules still coloured text with var(--fg) /
var(--bg) / var(--color-accent), which on the DEFAULT DARK theme resolve to LIGHT COOL inks
(--fg #9cdef2 cyan, --color-accent #00aaff) meant for a dark background. Light-cool ink on
light glass measured ~1.3-2.9:1 — unreadable. Most such rules were already remapped to the
chrome dark ink #16191f; this sweep fixed the two remaining sites:

  APP-OV-5  the sidebar "Orwell" wordmark (.sidebar-brand-title) + the "New Chat" label
            (#sidebar-new-chat-btn .grow) rode var(--fg) light cyan on the LIGHT sidebar glass.
  APP-OV-4  links + inline accent/red cues inside the received bubble (.msg-ai a / inline
            [style*="color:var(--accent)"]) were repainted to var(--fg) by the global
            no-accent-on-text remap — but .msg-ai does NOT redefine --fg (it drives its ink
            via color: directly so adaptiveGlass can flip polarity), so var(--fg) there was the
            theme's LIGHT cyan → light-on-light (the "Take your cast photo" cast-photo inline).

Source-pinned + recomputed WCAG, mirroring test_1601_chat_light_glass.py: parse the EFFECTIVE
cascaded declarations for the exact selectors and derive the contrast inputs from the parsed
values, so this fails loudly if the ink drifts back to a cool token instead of passing on a
stale constant or a comment.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AA_NORMAL = 4.5
AA_LARGE = 3.0
CHROME_INK = "#16191f"
# the ONE light-glass fill every frosted chrome/bubble surface composites onto (kube .60 white).
LIGHT_GLASS = (255, 255, 255)
GLASS_ALPHA = 0.60  # --ow-glass-opacity default (the sidebar / bubble floor)


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


CSS = _read("static/style.css")
CSS_NC = _strip_css_comments(CSS)


# ── declaration parsing (comment-free, exact-selector, cascade last-wins, @media-aware) ──
# The DEFAULT render = top-level rules PLUS `@media (prefers-reduced-transparency: no-preference)`
# (the default transparency state, where the sweep's light-glass fixes live). Every OTHER at-rule
# context — the `prefers-reduced-transparency: reduce` / `prefers-contrast: more` a11y fallbacks,
# width breakpoints, @supports/@keyframes — is a CONDITIONAL override and is EXCLUDED, so a nested
# rule can never fold into this cascade as if it were unconditional. (The old flat
# `[^{}]+\{[^{}]*\}` scan was blind to nesting and read those overrides as top-level.)
_DEFAULT_MEDIA = "prefers-reduced-transparency: no-preference"


def _iter_rules(css):
    """Yield (selector, body, at_stack) for each style rule, brace-depth aware, tracking the
    stack of enclosing at-rule preludes. at_stack is a tuple of prelude strings; the empty tuple
    marks a top-level rule. A style-rule body holds no nested `{}` (this file's CSS uses no CSS
    nesting), so its end is the next `}`; at-rule blocks push/pop the stack around their contents."""
    at_stack = []
    depth_is_at = []
    prelude_start = 0
    i, n = 0, len(css)
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
                yield prelude, css[i + 1:j], tuple(at_stack)
                prelude_start = j + 1
                i = j + 1
        elif c == "}":
            if depth_is_at:
                depth_is_at.pop()
                if at_stack:
                    at_stack.pop()
            prelude_start = i + 1
            i += 1
        elif c == ";":  # terminates a bare at-statement (@import/@charset) — reset the prelude
            prelude_start = i + 1
            i += 1
        else:
            i += 1


def _is_default_render(at_stack):
    """True for the default cascade: top-level, or nested ONLY inside the default-transparency
    media. Any other conditional at-rule context (reduce / prefers-contrast / breakpoints) is
    excluded so it is not read as unconditional."""
    return all(_DEFAULT_MEDIA in prelude for prelude in at_stack)


def _effective_decls(css, selector, split_groups=True):
    """Effective DEFAULT-render cascade for `selector`. With split_groups (default), a grouped
    list `A, B {…}` contributes to both A and B — needed to reach the sweep's own grouped fix
    rules. With split_groups=False, only a rule whose WHOLE selector string equals `selector`
    matches (mirrors test_1601). Rules in a non-default at-rule context are skipped (@media-aware),
    and !important never loses to a later normal. Returns {prop: value} with `!important` off."""
    out = {}  # prop -> (value, is_important)
    for sel, body, at_stack in _iter_rules(css):
        if not _is_default_render(at_stack):
            continue
        sel = sel.strip()
        if split_groups:
            if selector not in [s.strip() for s in sel.split(",")]:
                continue
        elif sel != selector:
            continue
        for decl in body.split(";"):
            prop, sep, val = decl.partition(":")
            if not sep:
                continue
            prop = prop.strip()
            important = "!important" in val
            val = val.replace("!important", "").strip()
            prev = out.get(prop)
            if prev is None or important or not prev[1]:
                out[prop] = (val, important)
    return {k: v[0] for k, v in out.items()}


# ── WCAG math ─────────────────────────────────────────────────────────────────────
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


# The light-glass fill composited over the DARKEST possible backdrop (pure black) — the
# worst case for a dark ink floating on the translucent .60 glass with no backing chip.
GLASS_OVER_BLACK = _over(LIGHT_GLASS, (0, 0, 0), GLASS_ALPHA)


# ── APP-OV-5: the sidebar brand title + New Chat label are dark ink on the light glass ──
def _no_cool_token(val):
    v = val.lower()
    for tok in ("var(--fg", "var(--bg", "var(--accent", "var(--color-accent", "var(--red",
                "#9cdef2", "#eef1f4", "#e8eef2", "#00aaff"):
        assert tok not in v, f"cool/theme ink token {tok!r} survives in {val!r} (light-on-light risk)"


def test_sidebar_brand_title_is_dark_ink():
    d = _effective_decls(CSS_NC, "body.theme-frosted #sidebar .sidebar-brand-title")
    color = d.get("color", "")
    assert color.lower() == CHROME_INK, (
        f"APP-OV-5: the sidebar 'Orwell' wordmark must carry the chrome dark ink {CHROME_INK} "
        f"on the light sidebar glass, not a cool var(--fg); got color={color!r}"
    )
    _no_cool_token(color)
    # the old var(--bg)-derived DARK text-shadow must be gone (a dark halo does nothing on the
    # light surface, and reads as a smudge under dark ink).
    ts = d.get("text-shadow", "")
    assert "var(--bg" not in ts.lower(), (
        f"APP-OV-5: the sidebar brand title text-shadow must not derive from var(--bg) "
        f"(a dark halo on the light glass); got text-shadow={ts!r}"
    )


def test_new_chat_label_is_dark_ink():
    d = _effective_decls(CSS_NC, "body.theme-frosted #sidebar #sidebar-new-chat-btn .grow")
    color = d.get("color", "")
    assert color.lower() == CHROME_INK, (
        f"APP-OV-5: the 'New Chat' label must carry the chrome dark ink {CHROME_INK} on the "
        f"light sidebar glass; got color={color!r}"
    )
    _no_cool_token(color)
    # mirror the brand-title check: the old var(--bg)-derived DARK halo must be gone (invisible on
    # the light glass, and a smudge under dark ink) — the label rides the LIGHT legibility halo.
    ts = d.get("text-shadow", "")
    assert "var(--bg" not in ts.lower(), (
        f"APP-OV-5: the 'New Chat' label text-shadow must not derive from var(--bg) "
        f"(a dark halo on the light glass); got text-shadow={ts!r}"
    )


def test_sidebar_dark_ink_clears_aa_on_the_light_glass():
    """The dark ink on the .60 white sidebar glass — even composited over a PURE-BLACK backdrop
    (the translucent glass with no backing chip, worst case) — must clear AA for these labels."""
    ink = _hx(CHROME_INK)
    r = _ratio(ink, GLASS_OVER_BLACK)
    assert r >= AA_NORMAL, (
        f"APP-OV-5: dark ink {CHROME_INK} on the sidebar's .60 light glass over the darkest "
        f"backdrop is {r:.2f}:1, must clear AA {AA_NORMAL}:1 (it is a large-weight wordmark, but "
        f"the label must not rely on that). Over a lighter backdrop it only improves."
    )


# ── APP-OV-4: links / inline cues inside the received bubble follow the bubble ink ──
def test_msg_ai_links_follow_bubble_ink_not_cool_fg():
    d = _effective_decls(CSS_NC, "body.theme-frosted .msg-ai a")
    color = d.get("color", "")
    assert color.lower() == "inherit", (
        "APP-OV-4: links inside the received bubble must INHERIT the bubble's adaptive ink "
        "(so they track polarity: dark on the light glass, light over a dark wallpaper), not "
        f"the global var(--fg) remap that is light-cyan on the light bubble; got color={color!r}"
    )
    # the dotted underline must follow the (inherited, adaptive) ink too — not a fixed cool
    # --hl-function syntax-blue stroke — so the whole chat link is one monochrome run.
    du = _effective_decls(CSS_NC, "body.theme-frosted .msg-ai a.chat-link")
    underline = (du.get("text-decoration-color") or du.get("border-bottom-color") or "").lower()
    assert underline, "missing the chat-link underline colour rule (.msg-ai a.chat-link)"
    assert "currentcolor" in underline or underline == "inherit", (
        "APP-OV-4: the chat-link underline must derive from currentColor/inherit so it tracks the "
        f"bubble's adaptive ink, not a fixed cool stroke; got {underline!r}"
    )
    assert "--hl-function" not in underline and "var(--accent" not in underline, (
        f"APP-OV-4: the chat-link underline must not keep a fixed cool accent stroke; got {underline!r}"
    )


def test_msg_ai_inline_accent_cue_follows_bubble_ink():
    """The `((…))`-style inline casting cue renders as an inline element pinning
    style="color:var(--accent)"; under frosted inside .msg-ai it must inherit the bubble ink,
    not the global var(--fg) remap (light cyan on the light-glass bubble)."""
    for sel in (
        'body.theme-frosted .msg-ai [style*="color:var(--accent)"]',
        'body.theme-frosted .msg-ai [style*="color: var(--accent)"]',
    ):
        d = _effective_decls(CSS_NC, sel)
        color = d.get("color", "")
        assert color.lower() == "inherit", (
            f"APP-OV-4: the inline accent cue ({sel}) must inherit the bubble ink, "
            f"got color={color!r}"
        )


def test_msg_ai_bubble_ink_is_the_dark_chrome_ink_by_default():
    """Sanity anchor for the two tests above: the bubble's own default ink (which the links
    now inherit) is the dark chrome ink, and it clears AA on the #1601 light-glass fill — so
    'inherit' resolves to a legible dark ink at first paint, not a cool token."""
    # exact-string match (split_groups=False) so the reduced-transparency grouped block
    # (`.msg-ai, .msg-user {…}` → solid dark panel + light var(--fg), correct THERE) is excluded.
    d = _effective_decls(CSS_NC, "body.theme-frosted .msg-ai", split_groups=False)
    color = d.get("color", "")
    assert color.lower() == CHROME_INK, (
        f"the .msg-ai default ink drifted from {CHROME_INK} — APP-OV-4's inherit chain would "
        f"then carry the wrong ink; got color={color!r}"
    )
    # #1601 pins the bubble fill at rgb(245,246,248); the inherited dark ink clears AA there.
    ink = _hx(CHROME_INK)
    assert _ratio(ink, (245, 246, 248)) >= AA_NORMAL

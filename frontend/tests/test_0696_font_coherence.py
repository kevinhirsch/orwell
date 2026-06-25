"""Typography-coherence ratchet — issue #696 + the font half of #730 (token single-source).

The bug this stops recurring: the font "token system" was REFERENCED but never DEFINED.
Surfaces used `var(--font-family, 'Fira Code', monospace)` / `var(--mono, monospace)` /
`var(--code-font, monospace)` while NONE of `--font-family` / `--mono` / `--code-font`
(nor the kit-facing `--ow-ui-font` / `--ow-mono-font`) had a `:root` definition — so every
one fell through to its inline fallback and dozens of surfaces invented their own stack
(20+ distinct monospace stacks, several naming faces that aren't loaded). #709 defines the
tokens ONCE and routes every declaration through them.

Apple HIG (Liquid Glass / Typography #696): one coherent system text face (SF / the
system stack; Inter as the bundled cross-platform substitute), monospace reserved for
genuine code / technical / numeric contexts. See docs/design/liquid-glass/.

Source-pinned (the FE pytest lane has no DOM runtime): the canonical tokens must be defined,
and no surface may name a font FACE directly — every `font-family` resolves through a
`var(--…)` token or `inherit`. A tiny allowlist covers the token defs themselves, the
`@font-face` rules, and intentional emoji fallbacks.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The 10 JS files that hardcoded their own inline / ensureCss font (#709).
JS_FILES = [
    "chat.js", "group.js", "orwellCast.js", "orwellFinale.js", "orwellFinalizing.js",
    "orwellGadget.js", "orwellOnboarding.js", "orwellSeasonProgress.js", "spinner.js", "ui.js",
]

# The chat-bubble region of style.css is owned by a separate agent (#744) and tokenized in a
# follow-up; #709 leaves it alone. Keep this window in sync if the bubble rules move.
BUBBLE_REGION = (2200, 2600)

# Faces named directly that are NOT loaded by an @font-face and must not appear in any stack.
NOT_LOADED_FACES = ["Berkeley Mono", "JetBrains Mono"]

# Generic CSS families + the canonical tokens are not "faces" — they're allowed bare.
_GENERIC = {
    "monospace", "sans-serif", "serif", "system-ui", "ui-monospace", "ui-sans-serif",
    "ui-serif", "cursive", "fantasy", "inherit", "initial", "unset", "emoji",
}


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
CSS_LINES = CSS.splitlines()


# ── 1. The canonical tokens are DEFINED once, in :root ────────────────────────────────

def test_canonical_tokens_defined_in_root():
    root = CSS[CSS.index(":root"):]
    # The two real tokens + the three legacy aliases + the two kit-facing aliases all
    # have a DEFINITION (`--name:`), not just a reference.
    for tok in ("--ow-ui-font", "--ow-mono-font", "--font-family", "--mono", "--code-font"):
        assert re.search(r"\n\s*" + re.escape(tok) + r"\s*:", root), f"{tok} not defined in :root"


def test_token_definitions_anchor_to_two_canonical_families():
    # The alias graph: --mono / --code-font → --ow-mono-font ; --font-family → --ow-ui-font.
    assert re.search(r"--mono\s*:\s*var\(--ow-mono-font\)", CSS)
    assert re.search(r"--code-font\s*:\s*var\(--ow-mono-font\)", CSS)
    assert re.search(r"--font-family\s*:\s*var\(--ow-ui-font\)", CSS)
    # The canonical UI font is the SF system stack; the mono token is a real mono stack.
    assert re.search(r"--ow-ui-font\s*:\s*[^;]*-apple-system", CSS)
    assert re.search(r"--ow-mono-font\s*:\s*[^;]*monospace", CSS)


# ── 2. No surface names a font FACE directly — everything routes through a token ───────

def _strip_var(s):
    """Remove every var(...) group, including nested var(--a, var(--b)), leaving the
    non-token remainder. Iterates innermost-first so nesting is fully consumed."""
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"var\([^()]*\)", " ", s)
    return s


def _bare_faces(value):
    """Return the set of quoted/named faces in a font-family value that are NOT generic
    and NOT a var() token reference. A bare generic keyword or a var(...) is fine."""
    v = value.strip().rstrip("};").strip()
    v = v.replace("!important", " ")
    v_no_var = _strip_var(v)
    faces = set()
    for part in v_no_var.split(","):
        p = part.strip().strip("'\"").strip().strip(")(").strip()
        if not p:
            continue
        if p.lower() in _GENERIC:
            continue
        # Intentional emoji fallback faces (color emoji fonts) are allowed.
        if "Emoji" in p or "Twemoji" in p:
            continue
        faces.add(p)
    return faces


def test_style_css_no_direct_font_faces():
    offenders = []
    for i, line in enumerate(CSS_LINES, start=1):
        if BUBBLE_REGION[0] <= i <= BUBBLE_REGION[1]:
            continue  # owned by #744
        if "@font-face" in line:
            continue
        m = re.search(r"font-family\s*:\s*([^;{}]+)", line)
        if not m:
            continue
        faces = _bare_faces(m.group(1))
        if faces:
            offenders.append((i, line.strip(), sorted(faces)))
    assert not offenders, "style.css names font faces directly (route through a token):\n" + \
        "\n".join(f"  L{ln}: {faces} :: {txt}" for ln, txt, faces in offenders)


def test_js_files_no_direct_font_faces():
    offenders = []
    for fn in JS_FILES:
        src = _read("static", "js", fn)
        for i, line in enumerate(src.splitlines(), start=1):
            for m in re.finditer(r"font-family\s*:\s*([^;'\"]+)", line):
                faces = _bare_faces(m.group(1))
                if faces:
                    offenders.append((fn, i, sorted(faces), line.strip()[:120]))
    assert not offenders, "JS inline/ensureCss names font faces directly:\n" + \
        "\n".join(f"  {fn}:L{ln}: {faces} :: {txt}" for fn, ln, faces, txt in offenders)


# ── 3. Not-loaded faces are gone ──────────────────────────────────────────────────────

def test_not_loaded_faces_absent_everywhere():
    sources = {"static/style.css": CSS}
    for fn in JS_FILES:
        sources[f"static/js/{fn}"] = _read("static", "js", fn)
    for face in NOT_LOADED_FACES:
        for name, src in sources.items():
            assert face not in src, f"{face!r} (not loaded) still appears in {name}"


def test_inter_is_loaded_if_referenced():
    # Inter IS bundled (static/fonts/Inter-*.woff2) and named in --ow-ui-font; #709 wired the
    # missing @font-face so it actually loads. If Inter is named in any stack it must be backed
    # by an @font-face (otherwise it is a not-loaded face like the two above).
    if "Inter" in re.sub(r"/\*.*?\*/", "", CSS, flags=re.S).replace("Inter-", ""):
        assert re.search(r"@font-face\s*\{[^}]*font-family:\s*'Inter'", CSS), \
            "Inter is referenced but has no @font-face — it would not actually load"


# ── 4. @font-face is deduped — one set per family/weight ──────────────────────────────

def test_one_font_face_set_per_fira_code_weight():
    weights = re.findall(
        r"@font-face\s*\{[^}]*font-family:\s*'Fira Code';\s*font-weight:\s*(\d+)", CSS)
    assert weights, "no Fira Code @font-face found"
    assert len(weights) == len(set(weights)), \
        f"duplicate Fira Code @font-face weights: {sorted(weights)}"


def test_one_font_face_set_per_inter_weight():
    weights = re.findall(
        r"@font-face\s*\{[^}]*font-family:\s*'Inter';\s*font-weight:\s*(\d+)", CSS)
    if weights:  # Inter @font-face is optional but, if present, must not be duplicated.
        assert len(weights) == len(set(weights)), \
            f"duplicate Inter @font-face weights: {sorted(weights)}"


# ── 5. Coherence: ONE canonical mono fallback + ONE sans fallback ─────────────────────

def test_single_canonical_fallback_shapes():
    # After #709 the only var() fallback shapes outside the bubble region should be the
    # canonical ones — no resurrection of 20 bespoke stacks. Collect distinct fallbacks.
    fallbacks = set()
    # var(--name, FALLBACK) where FALLBACK may itself contain one level of nested var().
    pat = re.compile(r"font-family\s*:\s*var\(\s*--[\w-]+\s*,\s*((?:[^();]|var\([^)]*\))+)\)")
    for i, line in enumerate(CSS_LINES, start=1):
        if BUBBLE_REGION[0] <= i <= BUBBLE_REGION[1] or "@font-face" in line:
            continue
        for m in pat.finditer(line):
            fb = m.group(1).strip().replace("!important", "").strip()
            if fb:
                fallbacks.add(fb)
    # Allowed: one mono fallback, one sans fallback, and the alias chain to the kit UI token.
    allowed = {"monospace", "sans-serif", "inherit", "var(--ow-ui-font)"}
    rogue = fallbacks - allowed
    assert not rogue, f"non-canonical font fallback shapes reintroduced: {sorted(rogue)}"

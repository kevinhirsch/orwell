"""OWN-9 — the Cast window must never render a grid of bare grey tiles.

The owner-reported live finding (2026-07-14): mid-game, with portraits present in
/api/orwell/roster, the cast window rendered GREY — no photos at tile size — while the
same portrait URLs kept rendering on surfaces whose <img> nodes had loaded earlier
(room strip / meet-the-house rail).

Measured root cause (reproduced headless by stubbing the portrait route to hang /
fail slowly): `setPortrait` mounted the photo `<img>` ALONE in the `.oc-portrait`
holder. While the portrait request was in flight — or hung ("a loading state that
never resolves"), or failing before `onerror` landed — the img painted nothing and
every tile was the bare holder background: a grid of grey squares (plus alt text /
the broken-image glyph in the failure window). The designed monogram existed only in
the no-URL branch, so a roster whose portraits were slow, regenerating (epoch-rotated
`?v=` refs), or served by a wedged engine had NO fallback face at all.

The OWN-9 shape (orwellCast.js only), pinned here:

  * the designed monogram is the holder's BASE LAYER in every state — it mounts
    before the img, in both the no-URL and the URL branch;
  * the img mounts INVISIBLE (`oc-img-pending`) and reveals only once genuinely
    decoded (`onload` + the synchronous cache-hot check), at which point the
    monogram loading-base retires (`ph.remove()`) — a loaded card keeps exactly one
    face, so the browser-smoke "provider-on cards carry no placeholder glyph" gate
    still holds;
  * the reveal is idempotent (a `revealed` flag — load can follow the synchronous
    cache-hot path);
  * `onerror` still forgets the url (`setPortrait(entry, null, false)`) so a
    transient miss heals on the next poll;
  * the injected CSS layers the photo OVER the monogram (absolute, inset 0) and
    keeps a pending img invisible (opacity 0);
  * the kit-less legacy initial consumes the `--oc-mono-hue` tint again (the M2-2
    refactor orphaned the var — no rule read it, leaving that path a grey
    letter-tile).

Pins are CODE identifiers (suite convention — see test_g22's helpers), never comment
prose. Roles only (player / NPC / houseguest) — no names.
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _js():
    with open(os.path.join(FRONTEND, "static", "js", "orwellCast.js"), encoding="utf-8") as f:
        return f.read()


def _block(text, start, end):
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j]


def _set_portrait():
    return _block(_js(), "function setPortrait(", "function syncBadge(")


def _style():
    return _block(_js(), "<style>", "</style>")


# ── 1. the monogram is the base layer in EVERY state ─────────────────────────


def test_monogram_base_mounts_before_the_url_branch():
    """The designed monogram must be appended to the holder BEFORE the `if (!url)`
    split — i.e. it exists whether or not a portrait URL is present. The old shape
    (monogram only in the no-URL branch) is exactly the OWN-9 grey window."""
    sp = _set_portrait()
    mono_append = sp.index("entry.holder.appendChild(ph)")
    url_split = sp.index("if (!url)")
    assert mono_append < url_split, (
        "the monogram base must mount before the url branch — a pending/hung/broken "
        "portrait otherwise leaves a bare grey holder (OWN-9)"
    )
    # and the url branch must NOT clear the holder again after the base mounted
    after_split = sp[url_split:]
    assert "textContent = \"\"" not in after_split, \
        "the url branch must not wipe the monogram base it just mounted"


def test_img_mounts_invisible_and_reveals_only_on_decode():
    sp = _set_portrait()
    assert 'img.className = "oc-img-pending"' in sp, \
        "the img must mount invisible so alt text / the broken glyph never paints"
    assert "img.onload = reveal" in sp, "the reveal rides the decode, not the mount"
    assert "img.complete && img.naturalWidth > 0" in sp, \
        "a cache-hot image (complete synchronously after the src write) must reveal too"
    assert 'classList.remove("oc-img-pending")' in sp


def test_reveal_is_idempotent_and_retires_the_monogram_base():
    sp = _set_portrait()
    assert "let revealed = false" in sp and "if (revealed) return" in sp, \
        "load can follow the synchronous cache-hot reveal — it must run once"
    assert "ph.isConnected" in sp and "ph.remove()" in sp, (
        "a decoded photo must retire the monogram base (idempotently — a url "
        "re-transition may already have wiped the holder) so a loaded card keeps "
        "exactly one face (the browser-smoke 'no placeholder glyph' gate)"
    )
    # the retire fires from INSIDE the reveal, never unconditionally on mount
    reveal_body = _block(sp, "const reveal = ()", "img.onload")
    assert "retire()" in reveal_body or "retire," in reveal_body


def test_just_landed_crossfade_keeps_the_monogram_beneath_the_fade():
    """The arrival fade must read as monogram→photo (the base stays under the .35s
    fade), and the retire must not depend on animationend alone — reduced-motion's
    `animation: none` never fires it, which would strand the base forever."""
    sp = _set_portrait()
    reveal_body = _block(sp, "const reveal = ()", "img.onload")
    assert 'addEventListener("animationend", retire' in reveal_body
    assert re.search(r"setTimeout\(retire,\s*\d+\)", reveal_body), \
        "the timer fallback (reduced-motion never emits animationend) must exist"


def test_onerror_still_forgets_the_url_so_the_next_poll_heals():
    sp = _set_portrait()
    assert "img.onerror = () => setPortrait(entry, null, false)" in sp


def test_g22_arrival_fade_rides_the_reveal():
    """The just-landed fade must play when the face becomes VISIBLE (post-decode),
    not on mount — and stays reduced-motion guarded in the CSS."""
    sp = _set_portrait()
    reveal_body = _block(sp, "const reveal = ()", "img.onload")
    assert 'classList.add("oc-justin")' in reveal_body
    guarded = _block(_js(), "prefers-reduced-motion: reduce", "</style>")
    assert "oc-justin" in guarded and "animation: none" in guarded


# ── 2. the injected CSS carries the layering ─────────────────────────────────


def test_css_layers_the_photo_over_the_monogram():
    css = _style()
    img_rule = _block(css, "#orwell-cast .oc-portrait img {", "}")
    assert "position: absolute" in img_rule and "inset: 0" in img_rule, \
        "the photo must overlay the monogram base, not flow beside it"
    assert "object-fit: cover" in img_rule and "width: 100%" in img_rule, \
        "full-bleed cover survives"


def test_css_keeps_a_pending_img_invisible():
    css = _style()
    assert re.search(
        r"\.oc-portrait img\.oc-img-pending\s*\{\s*opacity:\s*0", css), \
        "a pending img must paint nothing (the monogram shows through)"


def test_legacy_no_kit_fallback_consumes_the_hue_tint():
    """The kit-less initial must not be a grey letter-tile: the --oc-mono-hue var
    the JS sets needs a consuming CSS rule again (orphaned by the M2-2 refactor)."""
    js = _js()
    sp = _set_portrait()
    assert 'classList.add("oc-mono-fallback")' in sp
    assert "--oc-mono-hue" in sp  # the JS still seeds the deterministic name hue
    css = _style()
    fallback_rule = _block(css, ".oc-ph.oc-mono-fallback", "}")
    assert "var(--oc-mono-hue" in fallback_rule, \
        "the fallback tile must consume the hue tint it is seeded with"


# ── 3. kept behavior (cheap adjacency — their own suites pin the rest) ───────


def test_kept_lazy_loading_src_transition_and_resp20_flag():
    sp = _set_portrait()
    assert 'img.loading = "lazy"' in sp
    assert "img.src = url" in sp
    # RESP-20: portrait-less holders still carry the narrow-tier cap flag; a url drops it
    assert 'classList.add("oc-portrait-ph")' in sp
    assert 'classList.remove("oc-portrait-ph")' in sp
    upd = _block(_js(), "function updateCard(", "function render(data)")
    assert "url !== entry.portrait" in upd, \
        "an unchanged portrait url is never re-assigned (no refetch, no flicker)"

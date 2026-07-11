// liquidGlass.js — real SVG-refraction "liquid glass" as a PROGRESSIVE-ENHANCEMENT
// layer over the shipped CSS blur-glass baseline (body.theme-frosted .ow-window etc.).
//
// Technique (adapted from https://kube.io/blog/liquid-glass-css-svg/): an SVG
// <filter> with <feImage href="<displacement-map dataURL>"> feeding a
// <feDisplacementMap in="SourceGraphic" in2="…" xChannelSelector="R"
// yChannelSelector="G" scale=N>. The displacement map is a generated RGBA image
// whose R channel encodes x-displacement and G channel encodes y-displacement
// (128 = neutral). It ramps near the rounded-rect EDGES with a SQUIRCLE edge
// profile so the backdrop bends/lenses at the perimeter and stays neutral
// (undistorted, crisp) in the center. Applied via
//   backdrop-filter: url(#id) blur(...) saturate(...)
// so the refraction composites over whatever is behind the surface.
//
// ── HARD CONSTRAINT: Chromium-only ───────────────────────────────────────────
// SVG-filter backdrop-filter is supported ONLY by Chrome/Chromium. Everywhere
// else this module is a NO-OP and the shipped CSS blur-glass (style.css
// body.theme-frosted rules) stands unchanged — the documented graceful fallback.
// We feature-detect BOTH `CSS.supports('backdrop-filter','url(#x)')` AND a
// Chromium engine check (Firefox/Safari report partial support but do NOT honor
// an SVG-filter reference in backdrop-filter), and bail on anything else.
//
// ── PERF POSTURE (this is GPU-heavy) ─────────────────────────────────────────
//   • One displacement map is GENERATED PER UNIQUE SIZE (Wx Hx R bucket, rounded
//     to a coarse grid) and SHARED by every same-size surface — not one per
//     element. Filters are cached by that bucket key, so N windows of the same
//     size cost ONE map + ONE filter.
//   • Element count is CAPPED (MAX_LIVE_SURFACES). The big draggable windows, the
//     composer and the sidebar take priority; the small gadget cards (.og-card)
//     are refracted only if there is headroom under the cap (they share size
//     buckets, so a rail of identical cards is cheap).
//   • Size changes are watched with ONE shared, debounced ResizeObserver — never
//     a poll. A debounce (RESIZE_DEBOUNCE_MS) coalesces a resize-drag burst into
//     a single re-map.
//   • prefers-reduced-motion: we never ANIMATE the scale (the effect is static
//     refraction, no motion), and on reduced-motion we additionally DROP the
//     scale to a calmer value so the lensing is gentle. Fully fail-soft: any
//     error anywhere leaves the CSS blur-glass in place.
//   • Active ONLY under body.glass-full (the Full Glass tier: theme-frosted +
//     glass-full). The Frosted tier (theme-frosted alone) gets the CSS glass
//     material but NOT the Chromium SVG refraction, which gates on glass-full.
//     A tier/theme change is
//     observed via a MutationObserver on <body class> (no new event needed — this
//     respects the g15 "one orwell:gamechanged dispatcher" rule; we add no
//     CustomEvent of our own).

(function () {
  "use strict";

  // ── Tunable constants (top-of-file, per the brief) ──────────────────────────
  // SCALE      — px of MAX edge displacement (feDisplacementMap `scale`). Higher
  //              = stronger lensing at the rim. The article's sweet spot is modest;
  //              we keep it low so center text never smears.
  // RADIUS     — corner radius (px) the squircle profile is built around; tracks the
  //              Apple-tuned --ow-glass-radius (22px) so the lens band hugs the real
  //              very-rounded corner (slightly under, to sit inside the visible radius).
  // EDGE       — width (px) of the refraction band inward from each edge. Beyond
  //              this the map is neutral (128,128) → crisp, undistorted center.
  // SQUIRCLE_N — squircle exponent for the edge falloff surface profile (the
  //              article's convex squircle y = ⁴√(1−(1−x)⁴) ⇒ n=4). Higher = a
  //              softer flat→curve transition (avoids a hard interior seam).
  // SATURATE/BLUR — paired with the displacement in the backdrop-filter so the
  //              glass keeps the baseline's frosted character under the refraction.
  // ── RETUNED to the kube.io "Liquid Glass" MUSIC-PLAYER preset ────────────────
  // The owner's instruction: rip the music-player technique and match its
  // PARAMETERS panel exactly so Full Glass reads as CLEAR, strongly-REFRACTIVE
  // glass (the lensing does the work) — NOT fog. The literal music-player SVG
  // filter chain in the saved article (filter id="parallax-image-hero-filter"):
  //   feGaussianBlur stdDeviation="0.2"  → blurred_source        (BLUR LEVEL 1.0 — near-zero)
  //   feImage displacement-map (150×150) → displacement_map
  //   feDisplacementMap scale="133.97"   → displaced              (REFRACTION 1.00 — strong)
  //   feColorMatrix saturate values="6"  → displaced_saturated    (SATURATION 6)
  //   feImage specular-map               → specular_layer
  //   feComposite operator="in" + feComponentTransfer feFuncA slope="0.2"
  //   feBlend normal ×2                  → lit                    (SPECULAR OPACITY 0.40)
  // Our map is generated at the element's OWN pixel resolution (1:1, userSpaceOnUse),
  // not stretched from a 150px reference, so the kube `scale=133.97` does NOT port
  // verbatim — it is calibrated against a 150px map. The value below is tuned BY
  // RENDER to give the music player's strong-but-not-smeared lensing in OUR px units:
  // the rim clearly bends the backdrop, the center stays crisp.
  var SCALE = 58;            // px max displacement at the rim — REFRACTION 1.00 (strong lensing)
  var SCALE_REDUCED = 30;    // calmer lensing under prefers-reduced-motion
  var RADIUS = 18;           // corner radius the lens hugs (≥ kit --win-radius)
  var EDGE = 26;             // refraction band width inward from each edge (px) — a touch wider
                             // so the stronger displacement has room to ramp (no hard interior seam)
  var SQUIRCLE_N = 4;        // squircle exponent (4 ⇒ the article's convex profile)
  // EDGE-BLEED CLAMP (the "ring" fix). The squircle profile is MAXIMAL right at the very
  // perimeter (t=0 ⇒ push=1.0), so feDisplacementMap at the outermost row/col samples the
  // backdrop up to `scale` px BEYOND the surface — at the rounded corners that pulls content
  // from OUTSIDE the visible shape into the rim, rendering a faint refraction halo/ring past
  // the corners. The kube article's own constraint: displacement is symmetric around the
  // bezel and must fall to NEUTRAL (128,128) AT the outer edge so it never samples beyond the
  // surface. So we WINDOW the magnitude to ZERO at the very edge and ramp it up over the
  // outermost EDGE_NEUTRAL fraction of the band — the peak just moves a few px inward, the
  // in-bounds lensing strength is preserved, and the perimeter pixels are byte-neutral (no
  // out-of-bounds sample → no bleed ring). EDGE_NEUTRAL is a small fraction (the ramp is a
  // thin ~3-4px lead-in at EDGE=26), so it removes the halo without softening the lens band.
  var EDGE_NEUTRAL = 0.16;   // fraction of the bezel band that ramps 0→peak from the very edge inward
  // IN-FILTER blur — BLUR LEVEL 1.0 (the music player's stdDeviation="0.2"). This is
  // the FOG FIX: the prior 16px gaussian smeared the backdrop into milk. Near-zero
  // gaussian keeps the glass CLEAR so the wallpaper reads THROUGH it, lensed at the
  // rim. We use ~2px (not 0.2) because our map is at full element resolution and a
  // hair of blur hides the per-pixel displacement-map stairstepping; the look is
  // still crisp/transparent, not frosted.
  var FILTER_BLUR = 2;       // px — stdDeviation of the in-filter <feGaussianBlur> (music-player low)
  var CSS_BLUR_FALLBACK = 0; // px — NO extra CSS blur; the clear glass must not re-fog
  // SATURATION — kube's chain runs `feColorMatrix saturate="6"` on the displaced layer
  // (their "glass dispersion" pop). At 6× it OVER-saturates whatever shows through and
  // throws a HUE CAST (warm sky → yellow on the sidebar, warm foreground → red on the
  // composer), which violates the colorless-material mandate ("glass has no hue of its
  // own; it takes color from content"). A gentle lift (~1.4×) keeps the Apple vibrancy
  // without casting a colour — the glass stays neutral and merely carries the content's
  // own colour through. (Owner: "odd yellow hue over the sidebar / red on the chatbar".)
  var FILTER_SATURATE = 1.4;  // feColorMatrix saturate on the displaced layer (neutralized from kube's 6)
  var BACKDROP_SAT = 100;    // % CSS backdrop saturate — neutral (the saturate now lives IN-filter,
                             // exactly like the music player; CSS adds none on top)
  // The music player has NO tint/lift wash — its character is refraction + saturation +
  // a faded specular rim, over a CLEAR backdrop. A slope<1 tint wash would darken/fog the
  // glass (the opposite of the goal), so the tint pass is DISABLED (slope=1, intercept=0 ⇒
  // the feComponentTransfer pass is skipped entirely). The light glass FILL is supplied by
  // CSS (body.glass-full light translucent fill), not by an in-filter darkening transfer.
  var TINT_SLOPE = 1;        // 1 ⇒ no per-channel softening (clear, music-player)
  var TINT_INTERCEPT = 0;    // 0 ⇒ no lift; the pass is skipped (byte-clear backdrop)
  // SPECULAR RIM HIGHLIGHT (the kube.io feBlend layer — the "lit edge" that makes the
  // glass read as lit, the most "creative" part per the article). It's a rim light:
  // a SECOND generated image (white, alpha = specular intensity) loaded as its own
  // <feImage> and feBlend mode="screen"'d OVER the refracted+blurred+tinted backdrop,
  // so a bright thin highlight rides the edge where the surface normal faces a fixed
  // light. Intensity = max(0, outwardNormal · lightDir)^POWER, confined to the rim by
  // the squircle edge band. Set SPEC_ENABLE=false to drop the whole layer (byte-identical
  // to before). All artistic — tune ANGLE/POWER/GAIN against the Apple refs.
  var SPEC_ENABLE = true;
  var SPEC_ANGLE_DEG = -60;  // light direction (the article's diagram default; upper-leftish rim)
  // Apple's specular RESPONDS TO GEOMETRY as a THIN bright edge on the lit side — NOT a
  // wide glossy band. On a large flat surface (the composer bar) a wide/bright rim pools
  // into a harsh horizontal streak; keep it a hairline that hugs the very edge and stays
  // subtle, so it reads as a reflective edge, not a wash.
  var SPEC_POWER = 6.0;      // exponent — higher = tighter/sharper highlight arc (collapse the
                             // bright part to the lit corner/edge instead of smearing the top)
  var SPEC_GAIN = 1.0;       // multiply the raw specular before clamping (brightness of the rim)
  var SPEC_ALPHA_MAX = 0.40; // SPECULAR OPACITY = 0.40 (the music-player PARAMETERS value). A crisp
                             // bright hairline reads "lit"; a dim wide one reads "glossy".
  var SPEC_BAND = 0.10;      // fraction of EDGE band the rim occupies — ~2px hairline, not a 6-10px
                             // band (Apple's lit edge in the refs is 1-2px)
  // The music-player chain ALSO lays a SECOND, faded copy of the whole specular map back
  // over the result (feComponentTransfer feFuncA type="linear" slope="0.2" → feBlend),
  // a soft full-surface specular sheen UNDER the crisp rim. Ported as an extra screen
  // pass of the specular at this alpha slope. 0 ⇒ skip (just the crisp rim).
  var SPEC_FADE = 0.2;       // feFuncA slope on the soft specular sheen pass (kube slope="0.2")

  // ── SWITCH-THUMB glass (ripped from the kube.io #switch section) ─────────────
  // kube.io (https://kube.io/blog/liquid-glass-css-svg/) "Switch": the thumb uses
  //   backdrop-filter:url(#thumb-filter); background-color:rgba(255,255,255,1);
  //   box-shadow:0 4px 22px rgba(0,0,0,0.1)
  // and the article notes Apple's Switch is the ONE component that is NOT convex:
  //   "This uses a LIP BEZEL, which makes the surface convex on the outside and
  //    CONCAVE in the middle. This makes the center slider zoomed out, while the
  //    edges refract the inside." (kube #switch; cf. Apple HIG slider/segmented
  //    "knob becomes glass on interaction" — lg_hig_slider_poster.png).
  // We port a CONCAVE radial profile for a round knob: the displacement points
  // OUTWARD from the center (vs our convex builder's INWARD push), so the backdrop
  // appears pushed away from the middle — the "zoomed-out center, refracted edge"
  // lip-bezel read. It is a SEPARATE, STATIC filter (id THUMB_FILTER_ID) generated
  // once at THUMB_MAP_RES and applied to the knob pseudo-elements by CSS (the knob
  // is a ::before/::after, not a JS-selectable node). Gated on body.glass-full by
  // the CSS; the non-glass / non-Chromium fallback keeps the clean white knob.
  var THUMB_FILTER_ID = "owlg-thumb";
  var THUMB_MAP_RES = 64;    // px resolution the round concave map is generated at (stretched to the knob)
  var THUMB_SCALE = 14;      // px max radial displacement at the knob rim (the knob is tiny; keep modest)
  var THUMB_LIP = 0.34;      // fraction of the radius that is the convex OUTER lip (rim); inside it is concave
  var THUMB_BLUR = 0.6;      // px in-filter gaussian (a hair, to hide map stairstep on the small knob)

  // Perf caps. Mobile gets a HARD-LOWER cap (small GPUs; the refraction is the most
  // expensive thing on the page). collectTargets() reads activeMaxSurfaces() so the
  // cap follows the viewport live (a rotate/resize re-evaluates on the next pass).
  // Prioritize big/visible-first; the rest fall back to the CSS frosted approximation.
  // Bubbles are NOT refracted (content layer, HIG), so the live set is just chrome +
  // open menus — comfortably under this cap on a normal desktop view.
  var MAX_LIVE_SURFACES = 20;        // desktop hard cap on simultaneously-refracted elements
  var MAX_LIVE_SURFACES_MOBILE = 8;  // small-screen hard cap (GPU-cheap; CSS glass for the rest)
  var MOBILE_W = 768;                // ≤ this viewport width ⇒ the mobile cap applies
  var SIZE_BUCKET = 8;               // (legacy) coarse size grid — NO LONGER USED by the rounded-rect
                                     // path: the map is now generated at the element's EXACT px W×H and
                                     // applied 1:1 (the non-square fix), so the cache keys on exact size.
                                     // Same-size gadget cards still collide on one map; off-grid unique
                                     // elements get their own exact-fit filter (correct — stretching a
                                     // bucketed map to a non-square box was the bug). Kept for reference.
  var RESIZE_DEBOUNCE_MS = 140;      // coalesce a resize-drag burst into one re-map
  var MAP_RES_CAP = 1024;            // cap a map's canvas dimension (perf + the SVG res ceiling)

  // #777-2 — CLEAN-DEGRADE circuit breaker. Building a displacement/specular map is a
  // canvas + getImageData op; on a GPU-/memory-constrained device it can throw (canvas
  // OOM, context loss). Each successful build resets the counter; MAX_BUILD_FAILURES
  // CONSECUTIVE failures latch the whole refraction layer OFF (clearAll) so the CSS
  // blur-glass baseline stands — no broken glass, no per-pass retry storm, no console
  // spew. The tier is already dropped Full→Frosted on low-end by theme.js, so this only
  // catches a device that reaches Full and then fails to render it.
  var MAX_BUILD_FAILURES = 3;
  var _buildFailures = 0;
  var _refractionDisabled = false;   // latched after repeated filter-build failures

  // The surfaces that get refraction, in PRIORITY order (the cap fills from the top).
  // Same selectors CSS-glassed in style.css (body.theme-frosted …) so the aesthetic
  // is coherent across every glass surface. #orwell-headshot is a GATING dialog —
  // kept OPAQUE in CSS and EXCLUDED here (never refracted). The big draggable windows,
  // composer, sidebar, modals and the Control-Center dock take priority; the smaller
  // notice + gadget cards come last (they share size buckets, so a rail of identical
  // cards is cheap) and are dropped first when the cap bites on a small screen.
  // Apple HIG (docs/design/liquid-glass/LIQUID_GLASS_REFERENCE.md): "Liquid Glass forms a
  // distinct FUNCTIONAL layer for controls and navigation elements — like tab bars and
  // sidebars — that floats ABOVE the content layer" and "Don't use Liquid Glass in the
  // CONTENT layer." So the refraction belongs ONLY on the functional/chrome layer:
  // sidebar/rail, composer, top bar, model picker, window chrome, the dock, menus/popovers,
  // gadget chrome, and the functional notice cards — NAVIGATION + CONTROLS. The CHAT MESSAGE
  // BUBBLES are the CONTENT layer and are deliberately EXCLUDED (a refractive pane on the
  // content is what made them read as fog — and it's the HIG anti-pattern). Bubbles get the
  // restrained content treatment in CSS instead (the wallpaper shows in the gaps between
  // bubbles; the glass chrome floats above). Ordered big/visible-first; the CSS frosted blur
  // is the graceful perf fallback for the overflow past the cap, mobile, and non-Chromium.
  var SELECTORS = [
    ".ow-window",
    "#minimized-dock.ow-has-rows", // the iOS Control-Center dock module
    "#sidebar",
    ".icon-rail",                  // the collapsed floating sidebar rail (frosted theme)
    ".chat-input-bar",
    ".modal-content",
    ".admin-card",                 // settings / theme / memory / integrations panels
    ".chat-top-bar",
    ".model-picker-menu",
    ".toast",
    ".og-card",                    // the control-room gadget cards
    // Transient menus & popovers: small + short-lived, so they refract when open and
    // share size buckets (one map per size). watchMounts() schedules a pass when they mount.
    ".dropdown",
    ".overflow-menu",
    ".cp-popover",
    ".on-card",                    // the notice kit (functional affordance)
    // ── GLASS BUTTONS (kube.io demos the refraction on PILL BUTTONS — the authentic
    // look). The high-emphasis glass variants get the SAME feImage→feDisplacementMap
    // refraction + specular rim as the chrome, applied via backdrop-filter (refracts the
    // backdrop BEHIND the button, NEVER the label/glyph — see applyTo). They are LAST in
    // priority so the big chrome panels always win the cap, and they SHARE the per-size
    // filter cache (identical buttons → ONE filter, so a row of same-size buttons is
    // cheap). The .ow-btn-group is the ONE glass-sampling surface for its members
    // (NSGlassEffectContainerView analogue, style.css) — its members carry no backdrop
    // of their own and are EXCLUDED below. EXCLUSIONS (isRefractableButton): .ow-btn-plain
    // (borderless, no glass material), the opaque .ow-btn-destructive-solid plate, and
    // grouped members (they ride the group's single sample) never refract.
    ".ow-btn-prominent",
    ".ow-btn-secondary",
    ".ow-btn-icon",
    ".ow-btn-group",               // the segmented group = ONE shared backdrop sample
    ".ow-btn",                     // any remaining glass .ow-btn (plain/solid/grouped excluded)
  ];
  // Glass-button variants that must NEVER refract: borderless plain (no glass material),
  // the opaque solid-destructive plate, and grouped members (they ride the group's single
  // backdrop sample — refracting a member would be glass-on-glass + a wrong-size filter).
  var BTN_NO_REFRACT = ".ow-btn-plain, .ow-btn-destructive-solid, .ow-btn-group > .ow-btn";
  function isRefractableButton(el) {
    try {
      if (!el.matches || !el.matches(".ow-btn, .ow-btn-group")) return true; // not a button → no extra gate
      return !el.matches(BTN_NO_REFRACT);
    } catch (_) {
      return true;
    }
  }
  var EXCLUDE_IDS = { "orwell-headshot": 1 };

  function activeMaxSurfaces() {
    try {
      return (window.innerWidth || 1280) <= MOBILE_W ? MAX_LIVE_SURFACES_MOBILE : MAX_LIVE_SURFACES;
    } catch (_) {
      return MAX_LIVE_SURFACES;
    }
  }

  // ── Feature detection: Chromium + SVG-filter backdrop-filter ────────────────
  function supported() {
    try {
      if (!window.CSS || typeof window.CSS.supports !== "function") return false;
      // SVG-filter reference in backdrop-filter — the precise capability.
      var ok =
        CSS.supports("backdrop-filter", "url(#x)") ||
        CSS.supports("-webkit-backdrop-filter", "url(#x)");
      if (!ok) return false;
      // Chromium-only: Firefox/Safari may report support for the property but do
      // NOT honor an SVG-filter reference in backdrop-filter. The decisive test is
      // a CHROMIUM engine; the decisive EXCLUSION is the engines that lie about
      // support — Firefox ("Firefox/") and Safari ("Safari" without "Chrome").
      // Chromium forks (Edge/Brave/Opera) all carry "Chrome" in the UA and DO
      // honor the filter, so they're intentionally included.
      var ua = navigator.userAgent || "";
      var isGecko = /Firefox\//.test(ua);
      var isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS/.test(ua);
      if (isGecko || isSafari) return false;
      return /Chrome|Chromium|CriOS/.test(ua);
    } catch (_) {
      return false;
    }
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  // Apple HIG accessibility: prefers-reduced-transparency means SOLID surfaces —
  // no translucency/blur/refraction. When set, the module is a NO-OP and the CSS
  // (which forces a solid panel fill under the same query) is the whole render.
  // Applying our inline backdrop-filter here would defeat that solid fallback.
  function reducedTransparency() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  // ── Displacement-map generation ─────────────────────────────────────────────
  // Build an RGBA map for a WxH rounded rect with corner `radius`. R encodes x-
  // displacement, G encodes y-displacement (128 = neutral). The displacement
  // points INWARD (the lens pulls the backdrop toward the center) and ramps from
  // 0 at the inner boundary of the edge band to its max at the very edge, shaped
  // by the squircle profile so the flat→curve transition is soft.
  //
  // For a pixel at signed distance `d` from the nearest edge (0 at edge, growing
  // inward), within the EDGE band we compute t = d / EDGE in [0,1] and a profile
  // p(t) via the squircle: closeness c = 1 - t, profile = (1 - c^N)^(1/N) gives a
  // convex falloff; the displacement magnitude is SCALE * (1 - profile-ish). We
  // direct it along the inward normal (toward center) per axis.
  function squircleProfile(t) {
    // t in [0,1]: 0 at the very edge, 1 at the inner band boundary.
    // Convex squircle falloff: strong near the edge, easing to 0 inward.
    var tc = Math.min(1, Math.max(0, t));
    var c = 1 - tc; // closeness to the edge
    // (1 - (1-c)^N)^(1/N) is the article's convex squircle; we want the
    // MAGNITUDE to be high at the edge (c→1) and 0 inward (c→0).
    var n = SQUIRCLE_N;
    var prof = Math.pow(1 - Math.pow(1 - c, n), 1 / n); // 0→1 as c 0→1
    // EDGE-BLEED CLAMP: window the magnitude to 0 at the VERY edge (t=0) and ramp it up
    // over the outermost EDGE_NEUTRAL fraction of the band, so the perimeter pixels are
    // neutral (128,128) and feDisplacementMap never samples beyond the surface (no halo
    // ring past the rounded corners). Smoothstep the lead-in so the rim has no hard seam;
    // beyond the lead-in (t >= EDGE_NEUTRAL) the squircle profile is untouched, preserving
    // the in-bounds lensing strength. EDGE_NEUTRAL=0 ⇒ byte-identical to the old behavior.
    if (EDGE_NEUTRAL > 0 && tc < EDGE_NEUTRAL) {
      var u = tc / EDGE_NEUTRAL;          // 0 at edge → 1 at lead-in inner
      prof *= u * u * (3 - 2 * u);        // smoothstep ramp 0→1 (neutral at the very edge)
    }
    return prof; // magnitude weight at this depth
  }

  // ── FIXED-PX-BAND, MIDDLE-STRETCHED displacement map (the kube fix) ────────────
  // The article's key constraint: the displacement magnitude is SYMMETRIC around
  // the bezel and ORTHOGONAL to the border — computed once on a radial "half-slice"
  // and reused around the perimeter ("Circles let us form rounded rectangles by
  // STRETCHING THE MIDDLE"). So for a rounded RECTANGLE the bezel ramp must be a
  // FIXED PIXEL WIDTH on all four sides, and only the flat NEUTRAL (128,128) center
  // is stretched. The previous build coupled the band to BOTH axes
  // (`band = min(EDGE, min(cw,ch)/2)`) and the filter then STRETCHED the bucketed
  // map to the element via objectBoundingBox — which warped the ramps on non-square
  // elements (the short top banner became all-ramp with no neutral center; the tall
  // sidebar smeared the backdrop). The fix here:
  //   • The map is generated at the element's EXACT pixel W×H (see filterFor) and the
  //     filter region is userSpaceOnUse at that exact size, so it maps 1:1 — NO
  //     aspect-warping stretch. (filterFor keeps the rim at the true edge.)
  //   • The bezel ramp is a FIXED-PX width per axis (bandX/bandY, each = EDGE),
  //     INDEPENDENT of the other axis, so all four sides ramp over the same physical
  //     px on a wide, tall, or square element alike.
  //   • Each band is CLAMPED so it can never exceed just-under half that axis — a
  //     flat neutral center ALWAYS remains (the ramps never meet). A very short or
  //     narrow element keeps a crisp undistorted middle with only thin rim lensing.
  // Corners blend the two axes' inward pushes; the squircle profile shapes each
  // axis's falloff (Apple's convex squircle, SQUIRCLE_N=4).
  function buildMapDataUrl(w, h, radius, scale) {
    var cw = Math.min(MAP_RES_CAP, Math.max(8, Math.round(w)));
    var ch = Math.min(MAP_RES_CAP, Math.max(8, Math.round(h)));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(cw, ch);
    var data = img.data;
    // FIXED-PX bands per axis, clamped so a neutral center always survives. The
    // 0.5px back-off (and the 1px floor) guarantee bandX < cw/2, bandY < ch/2:
    // the left+right ramps never meet, the top+bottom ramps never meet → there is
    // always at least one neutral column AND one neutral row in the middle. On a
    // short banner the vertical ramps stay a thin EDGE-wide rim; the wide middle
    // stays crisp. (For the MAP_RES_CAP-shrunk axis the band scales with it so the
    // ramp stays a fixed FRACTION of the element, still leaving a neutral center.)
    var sx = cw / Math.max(1, Math.round(w)); // canvas px per element px on X (≤1 only if capped)
    var sy = ch / Math.max(1, Math.round(h));
    var bandX = Math.max(1, Math.min(EDGE * sx, cw / 2 - 0.5));
    var bandY = Math.max(1, Math.min(EDGE * sy, ch / 2 - 0.5));

    // Specular rim map (white, alpha = highlight intensity), built in the SAME loop.
    var specCanvas = null, specData = null, lx = 0, ly = 0;
    if (SPEC_ENABLE) {
      specCanvas = document.createElement("canvas");
      specCanvas.width = cw; specCanvas.height = ch;
      var simg = specCanvas.getContext("2d").createImageData(cw, ch);
      specData = simg.data;
      var ang = (SPEC_ANGLE_DEG * Math.PI) / 180;
      lx = Math.cos(ang); ly = Math.sin(ang); // fixed light direction (unit)
    }

    for (var y = 0; y < ch; y++) {
      // Per-row vertical depth/push, fixed-px from the nearer of top/bottom.
      var distY = Math.min(y, ch - 1 - y);          // px from nearer horizontal edge
      var tY = distY < bandY ? distY / bandY : 1;    // 0 at edge → 1 at band inner
      var pushY = distY < bandY ? squircleProfile(tY) : 0; // 0..1 magnitude
      var dirY = y < ch / 2 ? 1 : -1;                // inward (toward center)
      for (var x = 0; x < cw; x++) {
        // Per-column horizontal depth/push, fixed-px from the nearer of left/right.
        var distX = Math.min(x, cw - 1 - x);
        var tX = distX < bandX ? distX / bandX : 1;
        var pushX = distX < bandX ? squircleProfile(tX) : 0;
        var dirX = x < cw / 2 ? 1 : -1;

        var dr = 0; // x displacement (signed, -1..1 before *scale)
        var dg = 0; // y displacement

        if (pushX > 0 || pushY > 0) {
          // Inward normal: each axis contributes its own fixed-px ramp magnitude;
          // corners blend both (a true rounded-rect inward push), edges are
          // single-axis. Normalize the direction, keep the magnitude = the stronger
          // (edge-closest) of the two axis ramps so a corner isn't double-bright.
          var nx = dirX * pushX;
          var ny = dirY * pushY;
          var len = Math.sqrt(nx * nx + ny * ny) || 1;
          var mag = Math.max(pushX, pushY); // squircle magnitude weight at this depth
          dr = (nx / len) * mag;
          dg = (ny / len) * mag;

          // Specular rim: OUTWARD unit normal is -(inward), confined to the OUTER
          // SPEC_BAND fraction of the edge band so it reads as a thin lit line. The
          // rim depth uses the SAME nearest-edge fraction (min tX/tY for the axis in
          // play) so the highlight hugs the very edge on every side, square or not.
          if (specData) {
            var tEdge = Math.min(pushX > 0 ? tX : 1, pushY > 0 ? tY : 1);
            if (tEdge < SPEC_BAND) {
              var ux = -(nx / len), uy = -(ny / len);
              var ndotl = ux * lx + uy * ly;
              if (ndotl > 0) {
                var rim = 1 - tEdge / SPEC_BAND;            // 1 at edge → 0 at band inner
                // Match the displacement EDGE-BLEED CLAMP: fade the lit hairline to 0 at the
                // very perimeter so it rides JUST inside the edge (clip-safe, and consistent
                // with the now-neutral outer displacement rim — no bright pixel on the
                // un-clipped corner). Same smoothstep lead-in as squircleProfile.
                if (EDGE_NEUTRAL > 0 && tEdge < SPEC_BAND * EDGE_NEUTRAL) {
                  var ue = tEdge / (SPEC_BAND * EDGE_NEUTRAL);
                  rim *= ue * ue * (3 - 2 * ue);
                }
                var s = Math.pow(ndotl, SPEC_POWER) * rim * SPEC_GAIN;
                var a = Math.max(0, Math.min(SPEC_ALPHA_MAX, s));
                var si = (y * cw + x) * 4;
                specData[si] = 255; specData[si + 1] = 255; specData[si + 2] = 255;
                specData[si + 3] = Math.round(a * 255);
              }
            }
          }
        }

        var i = (y * cw + x) * 4;
        // 128 = neutral; ±127 full range. dr/dg in [-1,1].
        data[i] = Math.max(0, Math.min(255, Math.round(128 + dr * 127)));     // R = x-displacement
        data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + dg * 127))); // G = y-displacement
        data[i + 2] = 128; // B unused
        data[i + 3] = 255; // A opaque
      }
    }
    ctx.putImageData(img, 0, 0);
    var out = { url: canvas.toDataURL("image/png"), w: cw, h: ch, specUrl: null };
    if (specCanvas && specData) {
      specCanvas.getContext("2d").putImageData(new ImageData(specData, cw, ch), 0, 0);
      out.specUrl = specCanvas.toDataURL("image/png");
    }
    return out;
  }

  // ── SVG filter host (ONE shared inline <svg> with a <filter> per size bucket) ─
  var SVG_NS = "http://www.w3.org/2000/svg";
  var XLINK_NS = "http://www.w3.org/1999/xlink";
  var hostSvg = null;
  var filterCache = {}; // bucketKey -> { id }
  var filterCount = 0;

  function ensureHost() {
    if (hostSvg && hostSvg.isConnected) return hostSvg;
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("id", "orwell-liquid-glass-host");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    // colorInterpolationFilters=sRGB (the article): keep the displacement-map
    // channels linear-free so 128 is true neutral.
    svg.setAttribute("color-interpolation-filters", "sRGB");
    svg.style.cssText =
      "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    (document.body || document.documentElement).appendChild(svg);
    hostSvg = svg;
    return svg;
  }

  // The map is now generated at the element's EXACT px size and the filter region is
  // userSpaceOnUse at that SAME size (1:1, no stretch — the non-square fix). So the
  // cache key is the exact rounded W×H: many same-size gadget cards still collide on
  // ONE map/filter (a rail of identical cards stays cheap), while a unique large
  // element (sidebar/banner/composer/window) gets its own exact-fit filter — which is
  // correct, since stretching a bucketed map to a non-square box is exactly the bug.
  function bucketKey(w, h, scale) {
    return Math.round(w) + "x" + Math.round(h) + "x" + RADIUS + "x" + scale;
  }

  // ── Concave round-knob displacement map (the kube.io switch "lip bezel") ──────
  // A CIRCULAR map for the toggle thumb. Unlike the convex rounded-rect builder
  // (displacement points INWARD), this is the switch's LIP BEZEL: a thin convex
  // OUTER lip (rim, fraction THUMB_LIP of the radius) that refracts the inside,
  // wrapping a CONCAVE interior whose displacement points OUTWARD from the center
  // (so the middle reads "zoomed out"). R/G encode x/y displacement (128 neutral),
  // direction = radial. Returns a PNG dataURL stretched to the knob via 100%×100%.
  function buildThumbMapDataUrl() {
    var n = THUMB_MAP_RES;
    var canvas = document.createElement("canvas");
    canvas.width = n; canvas.height = n;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(n, n);
    var data = img.data;
    var cx = (n - 1) / 2, cy = (n - 1) / 2;
    var R = n / 2; // knob radius in map px
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var vx = x - cx, vy = y - cy;
        var dist = Math.sqrt(vx * vx + vy * vy);
        var t = Math.min(1, dist / R); // 0 center → 1 rim
        var dr = 0, dg = 0;
        if (t > 0.001 && t <= 1) {
          var ux = vx / (dist || 1), uy = vy / (dist || 1); // outward radial unit
          var mag; // signed radial magnitude in [-1,1]: + = outward (concave), - = inward (convex lip)
          if (t >= 1 - THUMB_LIP) {
            // OUTER LIP — convex: pull the backdrop INWARD (negative radial), peaking
            // at the very rim and easing to 0 at the lip's inner boundary.
            var lt = (t - (1 - THUMB_LIP)) / THUMB_LIP; // 0 at lip inner → 1 at rim
            mag = -Math.pow(lt, 1.6);
          } else {
            // INNER FIELD — concave: push OUTWARD (positive radial), gentle ramp from
            // 0 at the center to its max at the lip boundary (the "zoomed-out" middle).
            var ct = t / (1 - THUMB_LIP); // 0 center → 1 at lip boundary
            mag = Math.pow(ct, 1.4);
          }
          dr = ux * mag;
          dg = uy * mag;
        }
        var i = (y * n + x) * 4;
        data[i] = Math.max(0, Math.min(255, Math.round(128 + dr * 127)));     // R = x-displacement
        data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + dg * 127))); // G = y-displacement
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }

  var thumbBuilt = false;
  function ensureThumbFilter() {
    if (thumbBuilt && document.getElementById(THUMB_FILTER_ID)) return;
    var svg = ensureHost();
    // Drop any stale copy (e.g. host was re-created) before rebuilding.
    var prev = document.getElementById(THUMB_FILTER_ID);
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    var url = buildThumbMapDataUrl();
    var filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", THUMB_FILTER_ID);
    // objectBoundingBox so the round map stretches to the knob's exact box (any size).
    filter.setAttribute("filterUnits", "objectBoundingBox");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", "1");
    filter.setAttribute("height", "1");
    filter.setAttribute("color-interpolation-filters", "sRGB");

    var feImage = document.createElementNS(SVG_NS, "feImage");
    feImage.setAttribute("x", "0");
    feImage.setAttribute("y", "0");
    feImage.setAttribute("width", "100%");
    feImage.setAttribute("height", "100%");
    feImage.setAttribute("preserveAspectRatio", "none");
    feImage.setAttribute("result", "thumb_map");
    feImage.setAttributeNS(XLINK_NS, "xlink:href", url);
    feImage.setAttribute("href", url);
    filter.appendChild(feImage);

    var feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
    feDisp.setAttribute("in", "SourceGraphic");
    feDisp.setAttribute("in2", "thumb_map");
    feDisp.setAttribute("scale", String(reducedMotion() ? Math.round(THUMB_SCALE * 0.6) : THUMB_SCALE));
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    feDisp.setAttribute("result", "thumb_refracted");
    filter.appendChild(feDisp);

    if (THUMB_BLUR > 0) {
      var feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
      feBlur.setAttribute("in", "thumb_refracted");
      feBlur.setAttribute("stdDeviation", String(THUMB_BLUR));
      filter.appendChild(feBlur);
    }

    svg.appendChild(filter);
    thumbBuilt = true;
  }

  // Get (or build) a filter for a given content-box size; returns its DOM id.
  function filterFor(w, h, scale) {
    var key = bucketKey(w, h, scale);
    if (filterCache[key]) return filterCache[key].id;
    var svg = ensureHost();
    // #777-2 CLEAN DEGRADE: the map build is the canvas/getImageData op that can throw
    // on a GPU-/memory-constrained device. Guard it: a clean build resets the failure
    // streak; MAX_BUILD_FAILURES consecutive failures latch the whole refraction layer
    // OFF (clearAll) so the CSS blur-glass baseline stands — no broken glass, no retry
    // storm. Returning null tells applyTo to leave this surface on its CSS glass.
    var map;
    try {
      map = buildMapDataUrl(w, h, RADIUS, scale);
      _buildFailures = 0;
    } catch (_) {
      if (++_buildFailures >= MAX_BUILD_FAILURES) { _refractionDisabled = true; clearAll(); }
      return null;
    }
    var id = "owlg-" + (filterCount++);
    var filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    // ── NON-SQUARE / EDGE-ALIGNMENT FIX (1:1 exact-size map, no aspect stretch) ──
    // A previous edit set the region to objectBoundingBox(0,0,1,1) + feImage 100%×100%
    // (preserveAspectRatio="none") to fix a composer right-edge seam. That STRETCHES
    // the (then bucketed) displacement map to the element box — which WARPS the bezel
    // ramps on non-square elements: the short top banner became all-ramp (no neutral
    // center) and the tall sidebar smeared the backdrop instead of clean rim lensing.
    //
    // Fix: the map is now generated at the element's EXACT px W×H (buildMapDataUrl /
    // bucketKey) with FIXED-PX bezel bands + a stretched neutral middle, and the filter
    // region + feImage are sized in userSpaceOnUse to those SAME exact px dimensions and
    // pinned at x=0,y=0. So the map maps 1:1 onto the element with NO aspect-warping
    // stretch: the rim band is a fixed px width on all four sides, the neutral center is
    // crisp, and the rim still hugs the TRUE edge (map dims == element dims, re-mapped on
    // resize via applyTo) — keeping the composer right-edge alignment win without the
    // inward seam. primitiveUnits stays the default (userSpaceOnUse) ⇒ feDisplacementMap
    // `scale` remains in px (unchanged). map.w/map.h already honor MAP_RES_CAP.
    var fw = map.w, fh = map.h;
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(fw));
    filter.setAttribute("height", String(fh));
    filter.setAttribute("color-interpolation-filters", "sRGB");

    var feImage = document.createElementNS(SVG_NS, "feImage");
    feImage.setAttribute("x", "0");
    feImage.setAttribute("y", "0");
    feImage.setAttribute("width", String(fw));
    feImage.setAttribute("height", String(fh));
    feImage.setAttribute("result", "displacement_map");
    feImage.setAttribute("preserveAspectRatio", "none");
    feImage.setAttributeNS(XLINK_NS, "xlink:href", map.url);
    feImage.setAttribute("href", map.url); // modern + legacy

    var feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
    feDisp.setAttribute("in", "SourceGraphic");
    feDisp.setAttribute("in2", "displacement_map");
    feDisp.setAttribute("scale", String(scale));
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    feDisp.setAttribute("result", "refracted");

    filter.appendChild(feImage);
    filter.appendChild(feDisp);

    // IN-FILTER blur (CodePen refinement #2): compose the frost INTO the same pass
    // as the displacement so a single backdrop-filter url(#id) yields blur+lens.
    var lastResult = "refracted";
    if (FILTER_BLUR > 0) {
      var feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
      feBlur.setAttribute("in", lastResult);
      feBlur.setAttribute("stdDeviation", String(FILTER_BLUR));
      feBlur.setAttribute("result", "blurred");
      filter.appendChild(feBlur);
      lastResult = "blurred";
    }

    // IN-FILTER SATURATE (ported LITERALLY from the music-player chain:
    // `feColorMatrix type="saturate" values="6"` on the displaced layer). This is the
    // glass-dispersion "pop" — the lensed backdrop gets saturated so the refraction
    // reads as real glass, not a smudge. Runs IN the chain (like kube), not as a CSS
    // backdrop-filter saturate. Skipped when FILTER_SATURATE === 1.
    if (FILTER_SATURATE !== 1) {
      var feSat = document.createElementNS(SVG_NS, "feColorMatrix");
      feSat.setAttribute("in", lastResult);
      feSat.setAttribute("type", "saturate");
      feSat.setAttribute("values", String(FILTER_SATURATE));
      feSat.setAttribute("result", "saturated");
      filter.appendChild(feSat);
      lastResult = "saturated";
    }

    // Optional per-channel linear transfer (kept for compatibility; DISABLED in the
    // music-player preset — slope=1/intercept=0 ⇒ skipped, the glass stays clear).
    if (TINT_SLOPE !== 1 || TINT_INTERCEPT !== 0) {
      var feCT = document.createElementNS(SVG_NS, "feComponentTransfer");
      feCT.setAttribute("in", lastResult);
      ["feFuncR", "feFuncG", "feFuncB"].forEach(function (fn) {
        var f = document.createElementNS(SVG_NS, fn);
        f.setAttribute("type", "linear");
        f.setAttribute("slope", String(TINT_SLOPE));
        f.setAttribute("intercept", String(TINT_INTERCEPT));
        feCT.appendChild(f);
      });
      feCT.setAttribute("result", "tinted");
      filter.appendChild(feCT);
      lastResult = "tinted";
    }

    // SPECULAR (the kube.io specular-map + feBlend layers). kube generates a dedicated
    // specular-map and lays it over the saturated/displaced result in TWO passes:
    //   1) the crisp specular (composited `in` with the saturated layer) — our white
    //      rim map screened over the result is the equivalent "lit edge".
    //   2) a SECOND, alpha-FADED copy of the whole specular (feFuncA slope="0.2"),
    //      blended back as a soft full-surface sheen UNDER the crisp rim.
    // We reproduce both from our single generated rim/spec map. mode="screen" lightens
    // only where the spec has alpha (transparent center = identity = clear glass).
    if (SPEC_ENABLE && map.specUrl) {
      var feSpec = document.createElementNS(SVG_NS, "feImage");
      feSpec.setAttribute("x", "0");
      feSpec.setAttribute("y", "0");
      // Exact-px (matches the displacement feImage, userSpaceOnUse) so the specular
      // rim maps 1:1 to the element and hugs the true edge on every side — see the
      // NON-SQUARE / EDGE-ALIGNMENT FIX note. The specular pass stays ON for EVERY
      // refracted surface (SPEC_ENABLE): "without specular highlight, it's not glass."
      feSpec.setAttribute("width", String(fw));
      feSpec.setAttribute("height", String(fh));
      feSpec.setAttribute("preserveAspectRatio", "none");
      feSpec.setAttribute("result", "specular_layer");
      feSpec.setAttributeNS(XLINK_NS, "xlink:href", map.specUrl);
      feSpec.setAttribute("href", map.specUrl);
      filter.appendChild(feSpec);

      // Pass 1: the crisp specular rim screened over the result (the "lit edge").
      var feBlend = document.createElementNS(SVG_NS, "feBlend");
      feBlend.setAttribute("in", lastResult);
      feBlend.setAttribute("in2", "specular_layer");
      feBlend.setAttribute("mode", "screen");
      feBlend.setAttribute("result", "lit");
      filter.appendChild(feBlend);
      lastResult = "lit";

      // Pass 2: the kube feFuncA-faded soft sheen — fade the specular's alpha by the
      // slope, then screen it back for a gentle full-surface glass sheen under the rim.
      if (SPEC_FADE > 0) {
        var feFade = document.createElementNS(SVG_NS, "feComponentTransfer");
        feFade.setAttribute("in", "specular_layer");
        var fa = document.createElementNS(SVG_NS, "feFuncA");
        fa.setAttribute("type", "linear");
        fa.setAttribute("slope", String(SPEC_FADE));
        feFade.appendChild(fa);
        feFade.setAttribute("result", "specular_faded");
        filter.appendChild(feFade);

        var feBlend2 = document.createElementNS(SVG_NS, "feBlend");
        feBlend2.setAttribute("in", lastResult);
        feBlend2.setAttribute("in2", "specular_faded");
        feBlend2.setAttribute("mode", "screen");
        feBlend2.setAttribute("result", "lit2");
        filter.appendChild(feBlend2);
        lastResult = "lit2";
      }
    }

    svg.appendChild(filter);
    filterCache[key] = { id: id };
    return id;
  }

  // ── Applying / clearing refraction on a surface ─────────────────────────────
  var liveEls = new Set(); // elements currently carrying a live filter
  var ro = null; // shared ResizeObserver
  var resizeTimer = 0;
  var pendingResize = new Set();

  function activeScale() {
    return reducedMotion() ? SCALE_REDUCED : SCALE;
  }

  function applyTo(el) {
    try {
      if (!el || !el.isConnected) return;
      if (el.id && EXCLUDE_IDS[el.id]) return;
      if (!isRefractableButton(el)) { clearFrom(el); return; } // never refract plain/solid/grouped-member buttons
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return; // too small to bother
      var id = filterFor(r.width, r.height, activeScale());
      if (!id) { clearFrom(el); return; } // #777-2: build failed / layer latched off → leave the CSS glass
      // The SVG filter already does blur + tint in-chain; the thin CSS blur is a
      // belt-and-suspenders softener, and saturate keeps the baseline's lively glass.
      var val =
        "url(#" + id + ") blur(" + CSS_BLUR_FALLBACK + "px) saturate(" + BACKDROP_SAT + "%)";
      // Layer OVER the CSS baseline. CRITICAL: the frosted CSS sets
      // `backdrop-filter: blur(..) !important` on these same surfaces (style.css
      // body.theme-frosted .ow-window etc.), and a plain inline style LOSES to a
      // CSS !important — so the SVG refraction must be set with `important`
      // priority to actually win the cascade (an inline !important outranks a
      // stylesheet !important). Without this the url(#filter) is silently
      // overridden by the blur and the whole liquid-glass layer never renders.
      // Non-Chromium never reaches here (supported() gate), so its CSS blur-glass
      // fallback is untouched.
      el.style.setProperty("backdrop-filter", val, "important");
      el.style.setProperty("-webkit-backdrop-filter", val, "important");
      el.setAttribute("data-liquid-glass", "1");
      liveEls.add(el);
      if (ro) {
        try { ro.observe(el); } catch (_) {}
      }
    } catch (_) {
      clearFrom(el); // fail-soft: drop our override, leave the CSS glass
    }
  }

  function clearFrom(el) {
    try {
      if (!el) return;
      el.style.removeProperty("backdrop-filter");
      el.style.removeProperty("-webkit-backdrop-filter");
      el.removeAttribute("data-liquid-glass");
      liveEls.delete(el);
      if (ro) {
        try { ro.unobserve(el); } catch (_) {}
      }
    } catch (_) {}
  }

  function clearAll() {
    Array.prototype.slice.call(liveEls).forEach(clearFrom);
    // Belt-and-suspenders: sweep any stray marker the live set missed (e.g. a node
    // re-added by an observer mid-teardown) so the fallback is provably clean.
    try {
      var stray = document.querySelectorAll("[data-liquid-glass]");
      for (var i = 0; i < stray.length; i++) clearFrom(stray[i]);
    } catch (_) {}
  }

  // Collect candidate surfaces in priority order, de-duped, excluding the gating
  // dialog and anything not eligible, capped at MAX_LIVE_SURFACES.
  function collectTargets() {
    var seen = new Set();
    var out = [];
    var cap = activeMaxSurfaces();
    for (var s = 0; s < SELECTORS.length; s++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(SELECTORS[s]);
      } catch (_) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (seen.has(el)) continue;
        if (el.id && EXCLUDE_IDS[el.id]) continue;
        if (!isRefractableButton(el)) continue; // plain/solid/grouped-member buttons never refract
        if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue; // hidden
        seen.add(el);
        out.push(el);
        if (out.length >= cap) return out;
      }
    }
    return out;
  }

  // Refraction is the FULL GLASS tier only. The body carries `theme-frosted` for
  // BOTH glass tiers (CSS material) and `glass-full` ONLY for Full Glass — which is
  // what gates the Chromium SVG refraction. So this checks `glass-full`, not
  // `theme-frosted`: the Frosted tier keeps the CSS blur-glass with no refraction.
  function isFrosted() {
    return !!(document.body && document.body.classList.contains("glass-full"));
  }

  // The public re-apply pass: only under the frosted theme + Chromium support.
  // Clears any surface no longer eligible, applies to the current target set.
  var applyScheduled = false;
  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
      applyScheduled = false;
      applyPass();
    });
  }

  var _forceDisabled = false; // verification harness latch (_disable) — never set in prod
  function applyPass() {
    // Apple HIG: reduced-transparency ⇒ solid surfaces. Drop every override so the
    // CSS solid fallback stands; do NOT refract. #777-2: _refractionDisabled is the
    // clean-degrade latch — once the filter build has failed repeatedly on a
    // constrained device, the whole layer stays off and the CSS blur-glass stands.
    if (_forceDisabled || _refractionDisabled || !isFrosted() || reducedTransparency()) {
      clearAll();
      return;
    }
    var targets = collectTargets();
    var targetSet = new Set(targets);
    // Drop surfaces that fell out of the set (closed window, theme of card hidden).
    Array.prototype.slice.call(liveEls).forEach(function (el) {
      if (!targetSet.has(el) || !el.isConnected) clearFrom(el);
    });
    targets.forEach(applyTo);
    // Keep the single pointer-reactive rim in sync with tier/focus changes (a theme
    // flip to non-glass / reduced-transparency clears it; a flip back re-picks it).
    try { refreshSpecTarget(); } catch (_) {}
  }

  // ── ResizeObserver (debounced) — re-map a surface whose size changed ─────────
  function onResizeEntries(entries) {
    for (var i = 0; i < entries.length; i++) pendingResize.add(entries[i].target);
    if (resizeTimer) return;
    resizeTimer = setTimeout(function () {
      resizeTimer = 0;
      if (!isFrosted()) { pendingResize.clear(); return; }
      var els = Array.prototype.slice.call(pendingResize);
      pendingResize.clear();
      els.forEach(function (el) {
        if (liveEls.has(el)) applyTo(el); // re-pick a filter for the new size
      });
    }, RESIZE_DEBOUNCE_MS);
  }

  // ── Theme-change watch (no new event — observe body class; respects g15) ─────
  function watchTheme() {
    try {
      var mo = new MutationObserver(function () { scheduleApply(); });
      mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } catch (_) {}
  }

  // ── Window-open hook: re-apply when a kit window mounts/opens ────────────────
  // The kit doesn't emit an open event, so we observe body child additions for a
  // new .ow-window / .og-card and schedule a pass (debounced via rAF). Cheap: the
  // observer only fires on subtree structure changes, and scheduleApply coalesces.
  function watchMounts() {
    try {
      var mo = new MutationObserver(function (muts) {
        // PERF: two cheap early bail-outs before the per-node selector scan.
        //  (1) A pass is already queued for the next frame — it will re-collect EVERY
        //      current surface (any just-mounted one included), so there's no need to
        //      scan this mutation batch too. During streaming narration (a churn of
        //      added nodes each microtask) this collapses a querySelector storm into
        //      the single already-scheduled pass.
        //  (2) Not the Full-Glass tier ⇒ applyPass would clearAll and return anyway, so
        //      scanning for new refraction targets is pure waste. Off/Frosted therefore
        //      do NEAR-ZERO work per DOM mutation; the tier flip back to glass-full is
        //      handled by watchTheme() (body-class observer → a full re-collect pass).
        if (applyScheduled || !isFrosted()) return;
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            var sel = ".ow-window, .chat-input-bar, .og-card, .on-card, .modal-content, #minimized-dock, .minimized-dock-chip, .dropdown, .overflow-menu, .cp-popover, .ow-btn, .ow-btn-group";
            if (
              n.matches &&
              (n.matches(sel) || (n.querySelector && n.querySelector(sel)))
            ) {
              scheduleApply();
              return;
            }
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  // ── POINTER-REACTIVE SPECULAR (Genius #21) ──────────────────────────────────
  // A thin pointer-tracking rim-light on the ONE currently-focused surface. As the
  // pointer moves over that surface, a subtle moving specular highlight shifts to
  // track it — "a hint of life", Apple-restrained, NEVER multiple at once.
  //
  // Mechanics (kept dead-simple + cheap):
  //   • We track exactly ONE active surface (the FOCUSED one): the composer when it
  //     holds focus (focus-within on .chat-input-bar), else the focused window
  //     (.ow-window.ow-focused). Focus changes swap the active surface; the previous
  //     one is cleared so there is provably never more than one live at a time.
  //   • pointermove over the active surface writes two CSS custom properties on it —
  //     --ow-spec-x / --ow-spec-y, the 0..1 pointer position within the surface — and
  //     sets data-ow-spec="1". The CSS (the dedicated pointer-specular region in
  //     style.css, body.glass-full only) consumes them in a radial-gradient ::after
  //     specular sheen whose CENTER tracks the pointer. The hue is OKLCH-normalized to
  //     neutral so no accent creeps onto the colorless glass.
  //   • rAF-throttled: pointermove only stashes the latest coords; one rAF flushes them
  //     to the CSS vars. No layout thrash, no per-event style write storm.
  //   • prefers-reduced-motion ⇒ NO pointer tracking. We set data-ow-spec="static" so
  //     the CSS renders a fixed (top-edge) rim-light instead of a moving one — the
  //     surface still reads as lit glass, it just doesn't chase the pointer.
  //   • Full-Glass tier only (isFrosted() == body.glass-full) and Chromium only
  //     (this whole module no-ops otherwise) and never under reduced-transparency.
  var specActive = null;         // the single surface currently carrying the pointer rim
  var specRaf = 0;               // pending rAF id (0 = none)
  var specPending = null;        // latest {el,x,y} awaiting flush
  var specBound = false;         // listeners attached once

  function specEligible() {
    // The pointer-reactive rim is Full-Glass + Chromium + transparency-on only. (Caller
    // already guards Chromium via supported(); these are the live-toggleable gates.)
    return isFrosted() && !reducedTransparency() && !_forceDisabled;
  }

  // The single FOCUSED surface that should carry the rim, or null. Composer focus wins
  // over a focused window (it's the active input); STRICTLY one is returned.
  function focusedSurface() {
    try {
      var bar = document.querySelector(".chat-input-bar");
      if (bar && bar.isConnected && bar.matches(":focus-within")) return bar;
      var win = document.querySelector(".ow-window.ow-focused");
      if (win && win.isConnected) return win;
      return null;
    } catch (_) {
      return null;
    }
  }

  function clearSpec(el) {
    if (!el) return;
    try {
      el.removeAttribute("data-ow-spec");
      el.style.removeProperty("--ow-spec-x");
      el.style.removeProperty("--ow-spec-y");
    } catch (_) {}
  }

  // Promote `el` (or null) to the SOLE pointer-rim surface, clearing any previous one.
  function setSpecActive(el) {
    if (el === specActive) return;
    if (specActive) clearSpec(specActive);
    specActive = el || null;
    if (!specActive) return;
    // Reduced-motion ⇒ a STATIC rim (no pointer chase). Otherwise mark it live and seed
    // the highlight at the top-center until the pointer moves over it.
    if (reducedMotion()) {
      specActive.setAttribute("data-ow-spec", "static");
    } else {
      specActive.setAttribute("data-ow-spec", "1");
      try {
        specActive.style.setProperty("--ow-spec-x", "0.5");
        specActive.style.setProperty("--ow-spec-y", "0");
      } catch (_) {}
    }
  }

  // Re-evaluate which single surface is focused and own the rim accordingly.
  function refreshSpecTarget() {
    if (!specEligible()) { setSpecActive(null); return; }
    setSpecActive(focusedSurface());
  }

  function flushSpec() {
    specRaf = 0;
    var p = specPending;
    specPending = null;
    if (!p || p.el !== specActive || !specActive) return;
    if (reducedMotion()) return; // static rim ignores the pointer
    // PERF (layout-thrash fix): the getBoundingClientRect — a forced synchronous
    // layout — is read HERE, in the once-per-frame rAF flush, NOT in the pointermove
    // handler. A pointermove storm during streaming DOM churn therefore costs ONE
    // layout read per frame instead of one per event, and the rect is FRESH each
    // frame (drag-correct: a window dragged under the pointer measures now, not stale).
    // specPending carries RAW clientX/clientY; normalize against the current rect.
    var r;
    try { r = specActive.getBoundingClientRect(); } catch (_) { return; }
    if (r.width <= 0 || r.height <= 0) return;
    var x = (p.x - r.left) / r.width;
    var y = (p.y - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return; // pointer left the surface between events
    try {
      specActive.style.setProperty("--ow-spec-x", Math.min(1, Math.max(0, x)).toFixed(4));
      specActive.style.setProperty("--ow-spec-y", Math.min(1, Math.max(0, y)).toFixed(4));
    } catch (_) {}
  }

  function onSpecPointerMove(e) {
    if (!specActive || reducedMotion() || !specEligible()) return;
    // Stash only the RAW pointer coords and schedule a flush — deliberately NO
    // getBoundingClientRect here (that forced layout is deferred to flushSpec, which
    // runs at most once per frame). This is the batch-reads-then-writes pattern: the
    // hot per-event path does zero layout work; the single rAF flush does the one read
    // + the CSS-var write. (One at a time — specActive is the sole tracked surface.)
    specPending = { el: specActive, x: e.clientX, y: e.clientY };
    if (!specRaf) {
      specRaf = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(flushSpec);
    }
  }

  function bindSpec() {
    if (specBound) return;
    specBound = true;
    try {
      // Focus changes re-pick the single active surface (focusin/out bubble).
      document.addEventListener("focusin", refreshSpecTarget, true);
      document.addEventListener("focusout", function () {
        // defer so focus has settled on the new target before we re-pick
        (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); })(refreshSpecTarget);
      }, true);
      // A window raise (.ow-focused swap) happens on pointerdown, so a deferred re-pick
      // on pointerdown keeps the focused-window rim in sync without a new observer.
      document.addEventListener("pointerdown", function () {
        (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); })(refreshSpecTarget);
      }, true);
      document.addEventListener("pointermove", onSpecPointerMove, { passive: true });
      // a11y prefs flip live → re-evaluate static vs. tracking (drop + re-pick so the
      // new data-ow-spec mode is applied to whatever is focused now).
      try {
        ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)"].forEach(function (q) {
          var mq = window.matchMedia(q);
          var on = function () { setSpecActive(null); refreshSpecTarget(); };
          if (mq.addEventListener) mq.addEventListener("change", on);
          else if (mq.addListener) mq.addListener(on);
        });
      } catch (_) {}
    } catch (_) {}
    refreshSpecTarget();
  }

  // ── Boot ────────────────────────────────────────────────────────────────────
  function init() {
    if (!supported()) {
      // NO-OP on non-Chromium: the CSS blur-glass baseline stands. Expose a marker
      // for tests/debug; do NOT touch any surface.
      try { window.OrwellLiquidGlass = { supported: false, refresh: function () {} }; } catch (_) {}
      return;
    }
    try {
      ensureHost();
      // Build the static switch-thumb filter once (the toggle knobs reference it by
      // id from CSS, gated on body.glass-full). Chromium-only path (supported() above).
      try { ensureThumbFilter(); } catch (_) {}
      if (window.ResizeObserver) ro = new ResizeObserver(onResizeEntries);
      watchTheme();
      watchMounts();
      window.addEventListener("resize", scheduleApply);
      // Re-run a pass when the a11y preferences flip live (reduced-transparency
      // toggles solid↔glass; reduced-motion changes the scale).
      try {
        ["(prefers-reduced-transparency: reduce)", "(prefers-reduced-motion: reduce)", "(prefers-contrast: more)"].forEach(
          function (q) {
            var mq = window.matchMedia(q);
            var on = function () { scheduleApply(); };
            if (mq.addEventListener) mq.addEventListener("change", on);
            else if (mq.addListener) mq.addListener(on);
          }
        );
      } catch (_) {}
      applyPass();
      // Pointer-reactive specular (Genius #21): bind the single-surface pointer rim.
      try { bindSpec(); } catch (_) {}
      window.OrwellLiquidGlass = {
        supported: true,
        refresh: scheduleApply,
        clear: clearAll,
        // exposed for the visual-verification harness: force the fallback look
        // (drop our overrides) so the CSS blur-glass can be screenshotted alone.
        _disable: function () { _forceDisabled = true; clearAll(); setSpecActive(null); },
        _enable: function () { _forceDisabled = false; scheduleApply(); },
        _scale: function () { return activeScale(); },
        // the single surface currently carrying the pointer rim (verification harness).
        _specSurface: function () { return specActive; },
      };
    } catch (_) {
      // Any boot failure → leave the CSS glass entirely intact.
      clearAll();
      try { window.OrwellLiquidGlass = { supported: false, refresh: function () {} }; } catch (_) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

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
//   • Active ONLY under body.theme-frosted (the glass theme). A theme change is
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
  var SCALE = 16;            // px max displacement at the rim
  var SCALE_REDUCED = 8;     // calmer lensing under prefers-reduced-motion
  var RADIUS = 18;           // corner radius the lens hugs (≥ kit --win-radius)
  var EDGE = 22;             // refraction band width inward from each edge (px)
  var SQUIRCLE_N = 4;        // squircle exponent (4 ⇒ the article's convex profile)
  // IN-FILTER blur (folded in from the thecubiq CodePen refinement): the gaussian
  // blur composes INSIDE the one backdrop-filter url(#id) so blur + displacement
  // are a single pass. A tiny CSS blur fallback rides alongside in case the SVG
  // chain is partially honored. Kept modest so the lens reads SHARPER than the
  // 24px CSS baseline (the refraction is the point — not more frost).
  var FILTER_BLUR = 16;      // px — stdDeviation of the in-filter <feGaussianBlur> (8 let sharp
                             // text behind a menu over the dark chat bleed through; Apple's
                             // Regular material dissolves the backdrop into soft washes)
  var CSS_BLUR_FALLBACK = 2; // px — thin CSS blur layered with the SVG url()
  var BACKDROP_SAT = 180;    // % saturate, matching the baseline's lively glass
  // In-filter tint/lift (feComponentTransfer linear slope+intercept): a subtle
  // brighten so the glass reads lit, composed in the same pass. slope<1 + a small
  // intercept = gentle wash; set TINT_SLOPE=1/intercept=0 to disable.
  var TINT_SLOPE = 0.9;      // linear slope per channel (<1 softens) — thecubiq value
  var TINT_INTERCEPT = 0.05; // linear intercept per channel (small lift) — thecubiq value
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
  var SPEC_ALPHA_MAX = 0.50; // peak rim opacity — brighter is fine once the band is a true hairline
                             // (a crisp bright line reads "lit"; a dim wide one reads "glossy")
  var SPEC_BAND = 0.10;      // fraction of EDGE band the rim occupies — ~2px hairline, not a 6-10px
                             // band (Apple's lit edge in the refs is 1-2px)

  // Perf caps. Mobile gets a HARD-LOWER cap (small GPUs; the refraction is the most
  // expensive thing on the page). collectTargets() reads activeMaxSurfaces() so the
  // cap follows the viewport live (a rotate/resize re-evaluates on the next pass).
  var MAX_LIVE_SURFACES = 16;        // desktop hard cap on simultaneously-refracted elements
  var MAX_LIVE_SURFACES_MOBILE = 8;  // small-screen hard cap (GPU-cheap)
  var MOBILE_W = 768;                // ≤ this viewport width ⇒ the mobile cap applies
  var SIZE_BUCKET = 8;               // round W/H to this grid so near-equal sizes share a map
  var RESIZE_DEBOUNCE_MS = 140;      // coalesce a resize-drag burst into one re-map
  var MAP_RES_CAP = 1024;            // cap a map's canvas dimension (perf + the SVG res ceiling)

  // The surfaces that get refraction, in PRIORITY order (the cap fills from the top).
  // Same selectors CSS-glassed in style.css (body.theme-frosted …) so the aesthetic
  // is coherent across every glass surface. #orwell-headshot is a GATING dialog —
  // kept OPAQUE in CSS and EXCLUDED here (never refracted). The big draggable windows,
  // composer, sidebar, modals and the Control-Center dock take priority; the smaller
  // notice + gadget cards come last (they share size buckets, so a rail of identical
  // cards is cheap) and are dropped first when the cap bites on a small screen.
  var SELECTORS = [
    ".ow-window",
    "#minimized-dock.ow-has-rows", // the iOS Control-Center dock module
    ".chat-input-bar",
    "#sidebar",
    ".icon-rail",                  // the collapsed floating sidebar rail (frosted theme)
    ".modal-content",
    ".og-card",                    // the control-room gadget cards (prioritized — "gadgets first")
    // Transient menus & popovers: small + short-lived, so they refract when open and
    // share size buckets (one map per size). Usually only 1–2 are open at once, so they
    // sit comfortably under the cap. watchMounts() also schedules a pass when they mount.
    ".dropdown",
    ".overflow-menu",
    ".cp-popover",
    ".on-card",                    // the notice kit
  ];
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
    var c = 1 - Math.min(1, Math.max(0, t)); // closeness to the edge
    // (1 - (1-c)^N)^(1/N) is the article's convex squircle; we want the
    // MAGNITUDE to be high at the edge (c→1) and 0 inward (c→0).
    var n = SQUIRCLE_N;
    var prof = Math.pow(1 - Math.pow(1 - c, n), 1 / n); // 0→1 as c 0→1
    return prof; // magnitude weight at this depth
  }

  function buildMapDataUrl(w, h, radius, scale) {
    var cw = Math.min(MAP_RES_CAP, Math.max(8, Math.round(w)));
    var ch = Math.min(MAP_RES_CAP, Math.max(8, Math.round(h)));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    var img = ctx.createImageData(cw, ch);
    var data = img.data;
    var r = Math.min(radius, Math.min(cw, ch) / 2);
    var band = Math.min(EDGE, Math.min(cw, ch) / 2);

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
      for (var x = 0; x < cw; x++) {
        // Signed distance to the rounded-rect boundary (negative inside). We use
        // the standard rounded-rect SDF: distance from the inner core box plus the
        // corner radius treatment, so corners ramp like the straight edges.
        var qx = Math.abs(x - cw / 2) - (cw / 2 - r);
        var qy = Math.abs(y - ch / 2) - (ch / 2 - r);
        var ax = Math.max(qx, 0);
        var ay = Math.max(qy, 0);
        var outside = Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
        // `outside` < 0 inside the shape; depth inward from the edge = -outside.
        var depth = -outside; // 0 at the boundary, grows toward center

        var dr = 0; // x displacement (signed, -1..1 before *scale)
        var dg = 0; // y displacement

        if (depth >= 0 && depth < band) {
          var t = depth / band; // 0 at edge → 1 at inner band boundary
          var mag = squircleProfile(t); // 0..1 magnitude weight (high at edge)
          // Inward normal direction: derive from which boundary side is nearest.
          // Component toward center per axis, weighted by how "edge-like" that
          // axis is (so corners blend both). Use the rounded-rect gradient.
          var nx = 0;
          var ny = 0;
          // Distance to left/right and top/bottom edges (in canvas px).
          var distX = Math.min(x, cw - 1 - x);
          var distY = Math.min(y, ch - 1 - y);
          // The nearer edge dominates that axis's inward push.
          var pushX = distX < band ? (1 - distX / band) : 0;
          var pushY = distY < band ? (1 - distY / band) : 0;
          // Direction toward center: positive x-disp on the LEFT edge (push right),
          // negative on the RIGHT edge (push left); same logic for y.
          nx = (x < cw / 2 ? 1 : -1) * pushX;
          ny = (y < ch / 2 ? 1 : -1) * pushY;
          // Normalize the combined push and scale by the squircle magnitude.
          var len = Math.sqrt(nx * nx + ny * ny) || 1;
          dr = (nx / len) * mag;
          dg = (ny / len) * mag;

          // Specular rim: the OUTWARD unit normal is -(inward). The highlight is
          // strong where it faces the fixed light (dot>0), tightened by POWER, and
          // confined to the OUTER fraction (SPEC_BAND) of the edge band so it reads
          // as a thin lit line on the rim, not a wide wash.
          if (specData) {
            var ux = -(nx / len), uy = -(ny / len);
            var ndotl = ux * lx + uy * ly;
            if (ndotl > 0 && t < SPEC_BAND) {
              var rim = 1 - t / SPEC_BAND;                 // 1 at edge → 0 at band inner
              var s = Math.pow(ndotl, SPEC_POWER) * rim * SPEC_GAIN;
              var a = Math.max(0, Math.min(SPEC_ALPHA_MAX, s));
              var si = (y * cw + x) * 4;
              specData[si] = 255; specData[si + 1] = 255; specData[si + 2] = 255;
              specData[si + 3] = Math.round(a * 255);
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

  function bucketKey(w, h, scale) {
    var bw = Math.round(w / SIZE_BUCKET) * SIZE_BUCKET;
    var bh = Math.round(h / SIZE_BUCKET) * SIZE_BUCKET;
    return bw + "x" + bh + "x" + RADIUS + "x" + scale;
  }

  // Get (or build) a filter for a given content-box size; returns its DOM id.
  function filterFor(w, h, scale) {
    var key = bucketKey(w, h, scale);
    if (filterCache[key]) return filterCache[key].id;
    var svg = ensureHost();
    var map = buildMapDataUrl(w, h, RADIUS, scale);
    var id = "owlg-" + (filterCount++);
    var filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    // userSpaceOnUse over the map's own box so the displacement aligns 1:1 with px.
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(map.w));
    filter.setAttribute("height", String(map.h));
    filter.setAttribute("color-interpolation-filters", "sRGB");

    var feImage = document.createElementNS(SVG_NS, "feImage");
    feImage.setAttribute("x", "0");
    feImage.setAttribute("y", "0");
    feImage.setAttribute("width", String(map.w));
    feImage.setAttribute("height", String(map.h));
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

    // IN-FILTER tint/lift (CodePen refinement #1): a gentle per-channel linear
    // transfer for the lit-glass wash, composed in the same pass.
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

    // SPECULAR RIM (the kube.io feBlend layer): load the white rim map as a SECOND
    // feImage and screen it over the lit backdrop so a bright highlight rides the
    // edge. mode="screen" lightens only where the rim has alpha (transparent center =
    // identity), giving the "lit glass" edge. Skipped when SPEC_ENABLE is off / no map.
    if (SPEC_ENABLE && map.specUrl) {
      var feSpec = document.createElementNS(SVG_NS, "feImage");
      feSpec.setAttribute("x", "0");
      feSpec.setAttribute("y", "0");
      feSpec.setAttribute("width", String(map.w));
      feSpec.setAttribute("height", String(map.h));
      feSpec.setAttribute("preserveAspectRatio", "none");
      feSpec.setAttribute("result", "specular_layer");
      feSpec.setAttributeNS(XLINK_NS, "xlink:href", map.specUrl);
      feSpec.setAttribute("href", map.specUrl);
      filter.appendChild(feSpec);

      var feBlend = document.createElementNS(SVG_NS, "feBlend");
      feBlend.setAttribute("in", lastResult);
      feBlend.setAttribute("in2", "specular_layer");
      feBlend.setAttribute("mode", "screen");
      feBlend.setAttribute("result", "lit");
      filter.appendChild(feBlend);
      lastResult = "lit";
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
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return; // too small to bother
      var id = filterFor(r.width, r.height, activeScale());
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
        if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue; // hidden
        seen.add(el);
        out.push(el);
        if (out.length >= cap) return out;
      }
    }
    return out;
  }

  function isFrosted() {
    return !!(document.body && document.body.classList.contains("theme-frosted"));
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
    // CSS solid fallback stands; do NOT refract.
    if (_forceDisabled || !isFrosted() || reducedTransparency()) {
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
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType !== 1) continue;
            var sel = ".ow-window, .chat-input-bar, .og-card, .on-card, .modal-content, #minimized-dock, .minimized-dock-chip, .dropdown, .overflow-menu, .cp-popover";
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
      window.OrwellLiquidGlass = {
        supported: true,
        refresh: scheduleApply,
        clear: clearAll,
        // exposed for the visual-verification harness: force the fallback look
        // (drop our overrides) so the CSS blur-glass can be screenshotted alone.
        _disable: function () { _forceDisabled = true; clearAll(); },
        _enable: function () { _forceDisabled = false; scheduleApply(); },
        _scale: function () { return activeScale(); },
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

// adaptiveGlass.js — DYNAMIC legibility for Liquid Glass over ANY background.
//
// Apple's Regular variant "blurs AND adjusts the luminosity of background content to
// maintain legibility" — the material is more muted over BRIGHT content and stays
// translucent/lit over DARK content, so foreground text/controls stay readable on any
// backdrop (a photo, a light theme, a gradient, the dark chat). A single static veil
// can't do that: tuned translucent for dark, it fails over a bright photo; tuned opaque
// for bright, it reads as a heavy slab over dark.
//
// So this module is the "smart" layer: for each glass surface it SAMPLES the backdrop
// luminance directly behind that surface and scales the surface's neutral veil opacity
// to it — gentle over dark, stronger over bright — keeping the theme's --fg text legible
// regardless of what's behind. It is theme-correct by construction: the veil is the
// theme's own --panel (dark panel on dark themes, light panel on light themes), which is
// already the right contrast for the theme's --fg, so it floors contrast in EITHER
// polarity. It runs on EVERY engine (not Chromium-gated) and composes with the SVG
// refraction (that sets backdrop-filter; this sets background-color — no conflict).

(function () {
  "use strict";

  // Surfaces that carry the glass material (mirror style.css's frosted set + liquidGlass).
  // Adaptive legibility runs under BOTH glass tiers (keyed on theme-frosted), so this
  // list must cover EVERY newly-glassed surface — chrome, chat bubbles, transient
  // indicators — or those surfaces lose adaptive ink/veil. #orwell-headshot is excluded
  // (gating dialog, kept opaque in CSS).
  var SURFACES = [
    // — Chrome / large panels (no flip → mute) —
    ".ow-window", "#sidebar", ".icon-rail", ".modal-content", ".admin-card",
    ".chat-top-bar", ".model-picker-menu", ".og-card", ".on-card", ".toast",
    ".orwell-chat-hint", ".attach-card", ".dropdown", ".overflow-menu", ".cp-popover",
    // — Chat bubbles (large → mute, no flip) —
    ".msg-ai", ".msg-user", ".msg-ooc",
    // — Small bars / transient pills (flip ink) —
    ".chat-input-bar", "#minimized-dock.ow-has-rows", ".thinking-section", ".tool-indicator",
  ].join(", ");
  var EXCLUDE_IDS = { "orwell-headshot": 1 };

  // Apple's adaptation is SIZE-DEPENDENT (WWDC25 219 + HIG Color):
  //   • SMALL bars/tiles (toolbars, tab bars — our composer bar, gadget tiles, the dock):
  //     the glass stays CLEAR and the SYMBOLS FLIP light↔dark to mirror the backdrop
  //     ("symbols and glyphs … flip from light to dark and vice versa … to maximize
  //     contrast"). No darkening of the glass.
  //   • LARGE surfaces (sidebars, windows, modals, menus): they "don't flip from light to
  //     dark — their surface area is too big and transitions would be distracting." Instead
  //     the Regular glass continuously "blurs AND adjusts the luminosity of background
  //     content to maintain legibility" — so we keep LIGHT --fg symbols and let a stronger
  //     adaptive veil mute a bright backdrop just enough to keep them legible.
  // The only darkening Apple sanctions is the Clear variant's literal 35% dimmer over bright
  // media (not used here — our surfaces carry text, so Regular is correct).
  var VEIL_MIN = 14;             // % --panel at a dark backdrop (translucent/lit) — both sizes
  var VEIL_MAX_SMALL = 22;       // small bars stay genuinely CLEAR (the symbol flip does the legibility work)
  var VEIL_MAX_LARGE = 48;       // large surfaces don't flip → glass mutes, but stays translucent (no opaque slab)
  // Linear-Y at which each veil reaches its cap. Small bars cross over WITH the ink flip
  // (steeper); large surfaces ramp gently so a bright backdrop still shows through the glass
  // ("adjusted luminosity," not a wall — Apple Regular over light content).
  var VEIL_FULL_AT_SMALL = 0.35;
  var VEIL_FULL_AT_LARGE = 0.62;
  // Small bars/tiles that FLIP (everything else in SURFACES is treated as large / no-flip).
  // The composer bar, gadget tiles, the dock, and the small transient pills (the
  // typing/thinking indicator, the tool-indicator chip) are small bars → flip the ink.
  // Large surfaces (windows, sidebar, modals, admin-card, toasts, chat bubbles, menus)
  // are NOT here → they mute via the adaptive veil and keep light --fg.
  var FLIP_SET = ".chat-input-bar, .og-card, #minimized-dock.ow-has-rows, .thinking-section, .tool-indicator";
  // LINEAR-Y flip point: backdrop above this ⇒ DARK ink. The WCAG black-vs-white crossover is
  // L≈0.18; the small bar's own veil darkens the effective background a touch, so the flip
  // sits just above it at 0.22 (≈ perceptual mid-grey sRGB≈0.5). 0.36 fired far too late —
  // surfaces over a perceptually half-bright backdrop kept light ink and washed out.
  var INK_THRESHOLD = 0.22;
  var INK_DARK = "#11151c";   // dark symbol/label colour over bright backdrops
  var DEBOUNCE_MS = 120;
  var SAMPLE_GRID = 5;        // NxN samples across the surface's backdrop region

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // Proper relative luminance: sRGB → linear, then Rec.709 weights (matches Apple/WCAG).
  function _lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function relLum(r, g, b) { return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b); }
  function prefersContrast() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-contrast: more)").matches); } catch (_) { return false; }
  }

  // ── unified backdrop canvas (image OR gradient OR solid — composited) ─────────
  // The "background" can be ANYTHING: a solid theme colour, faint CSS pattern
  // gradients, a full-viewport wallpaper image, or any combination. A url()-only
  // path missed gradients entirely (they carry no url), so we paint ONE downscaled
  // viewport canvas from the page's actual backdrop layers — base colour, then each
  // background-image gradient, then any wallpaper image (back-to-front) — and sample
  // regions of it per surface. That makes the adaptation correct over a photo, a
  // light theme, a gradient theme, the dark chat, or a layered mix of them.
  var BACKDROP_MAXW = 96;   // downscaled viewport-canvas width (cheap to getImageData)
  var _bd = { cv: null, ctx: null, w: 0, h: 0, sig: "", base: null, tainted: false };
  var _imgCache = {};       // url -> { img } | 'pending' | 'failed'

  function clamp255(x) { return Math.max(0, Math.min(255, Math.round(parseFloat(x)))); }
  function parseAlpha(x) { x = String(x).trim(); return x.indexOf("%") >= 0 ? parseFloat(x) / 100 : parseFloat(x); }
  function rgbaStr(c) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (c[3] == null ? 1 : c[3]) + ")"; }

  // Parse a CSS colour (computed values resolve var()/color-mix() → rgb/rgba). Returns [r,g,b,a] or null.
  function parseColor(s) {
    if (!s) return null; s = String(s).trim();
    if (s === "transparent") return [0, 0, 0, 0];
    var m = s.match(/^rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(/[,\/\s]+/).filter(function (x) { return x !== ""; });
      if (p.length >= 3) return [clamp255(p[0]), clamp255(p[1]), clamp255(p[2]), p[3] !== undefined ? parseAlpha(p[3]) : 1];
    }
    var h = s.match(/^#([0-9a-fA-F]{3,8})$/);
    if (h) {
      var x = h[1];
      if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
      if (x.length >= 6) {
        var a = x.length >= 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1;
        return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16), a];
      }
    }
    return null;
  }

  // Split on a top-level separator only (commas inside rgb()/gradient() are kept).
  function splitTopLevel(s, sep) {
    var out = [], depth = 0, cur = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === "(") depth++; else if (c === ")") depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ""; } else cur += c;
    }
    if (cur.trim() !== "") out.push(cur);
    return out;
  }

  function parseAngle(h) {
    h = h.trim().toLowerCase();
    if (h.indexOf("deg") >= 0) return parseFloat(h);
    if (h.indexOf("turn") >= 0) return parseFloat(h) * 360;
    if (h.indexOf("grad") >= 0) return parseFloat(h) * 0.9;
    if (h.indexOf("rad") >= 0) return parseFloat(h) * 180 / Math.PI;
    var map = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270,
      "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135,
      "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
    return map[h] != null ? map[h] : 180;
  }

  // Colour stops from the gradient body parts; fill missing positions by interpolation.
  function parseStops(parts) {
    var stops = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      // colour first, then an OPTIONAL position (% only — px positions are ignored).
      var cm = t.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+)(?:\s+([-\d.]+)%)?/);
      if (!cm) continue;
      var col = parseColor(cm[1]); if (!col) continue;
      var pos = cm[2] !== undefined ? parseFloat(cm[2]) / 100 : null;
      stops.push({ col: col, pos: pos });
    }
    if (!stops.length) return stops;
    if (stops[0].pos == null) stops[0].pos = 0;
    if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
    for (var j = 1; j < stops.length - 1; j++) {
      if (stops[j].pos != null) continue;
      var prev = j - 1, next = j + 1;
      while (next < stops.length && stops[next].pos == null) next++;
      var p0 = stops[prev].pos, p1 = stops[next].pos != null ? stops[next].pos : 1;
      stops[j].pos = p0 + (p1 - p0) * ((j - prev) / (next - prev));
    }
    return stops;
  }

  function avgColor(stops) {
    var r = 0, g = 0, b = 0, a = 0;
    for (var i = 0; i < stops.length; i++) { r += stops[i].col[0]; g += stops[i].col[1]; b += stops[i].col[2]; a += (stops[i].col[3] == null ? 1 : stops[i].col[3]); }
    var n = stops.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), a / n];
  }

  function paintGradient(ctx, w, h, css) {
    var lp = css.indexOf("(");
    var open = css.slice(0, lp).trim().toLowerCase();
    var inner = css.slice(lp + 1, css.lastIndexOf(")"));
    var parts = splitTopLevel(inner, ",");
    if (!parts.length) return;
    var radial = open.indexOf("radial") >= 0, conic = open.indexOf("conic") >= 0;
    var head = parts[0].trim();
    var headIsConfig = /^(to\s|[-\d.]+deg|[-\d.]+turn|[-\d.]+g?rad|circle|ellipse|at\s|closest|farthest|from\s)/i.test(head);
    var stops = parseStops(headIsConfig ? parts.slice(1) : parts);
    if (!stops.length) return;
    if (conic) { ctx.fillStyle = rgbaStr(avgColor(stops)); ctx.fillRect(0, 0, w, h); return; }
    var g;
    if (radial) {
      g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
    } else {
      var a = (headIsConfig ? parseAngle(head) : 180) * Math.PI / 180;
      var dx = Math.sin(a), dy = -Math.cos(a);
      var len = Math.abs(w * dx) + Math.abs(h * dy);
      g = ctx.createLinearGradient(w / 2 - dx * len / 2, h / 2 - dy * len / 2, w / 2 + dx * len / 2, h / 2 + dy * len / 2);
    }
    for (var i = 0; i < stops.length; i++) { try { g.addColorStop(clamp(stops[i].pos, 0, 1), rgbaStr(stops[i].col)); } catch (_) {} }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  function drawCover(ctx, img, w, h) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function ensureImg(url) {
    var rec = _imgCache[url];
    if (rec && rec !== "pending" && rec !== "failed") return rec;
    if (rec === "pending" || rec === "failed") return null;
    _imgCache[url] = "pending";
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () { _imgCache[url] = { img: img }; schedule(); };
    img.onerror = function () { _imgCache[url] = "failed"; };
    img.src = url;
    return null;
  }

  // The backdrop element chain, back-to-front (html → body → known wallpaper containers).
  function backdropChain() {
    var chain = [];
    if (document.documentElement) chain.push(document.documentElement);
    if (document.body) chain.push(document.body);
    var ids = ["__wp", "wallpaper", "app-bg", "background", "desktop"];
    for (var i = 0; i < ids.length; i++) { var e = document.getElementById(ids[i]); if (e) chain.push(e); }
    return chain;
  }

  // Build (or reuse) the unified downscaled backdrop canvas. Returns the cache record.
  function buildBackdrop() {
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    var w = BACKDROP_MAXW, h = Math.max(1, Math.round(BACKDROP_MAXW * vh / vw));
    var chain = backdropChain();
    // First scan: a signature + the layer plan, so we don't repaint on every scroll.
    var sig = w + "x" + h, plan = [], base = null;
    for (var i = 0; i < chain.length; i++) {
      var cs; try { cs = getComputedStyle(chain[i]); } catch (_) { continue; }
      var col = parseColor(cs.backgroundColor);
      if (col && col[3] > 0.05) { base = col; sig += "|c" + col.join(","); plan.push({ fill: col }); }
      var bi = cs.backgroundImage || "";
      if (bi && bi !== "none") {
        var imgs = splitTopLevel(bi, ",");
        for (var j = imgs.length - 1; j >= 0; j--) {   // CSS paints first-listed on top → reverse
          var layer = imgs[j].trim();
          var u = layer.match(/^url\((['"]?)(.*?)\1\)$/);
          if (u) { plan.push({ url: u[2] }); sig += "|u" + u[2]; }
          else if (/gradient\(/i.test(layer)) { plan.push({ grad: layer }); sig += "|g" + layer.length; }
        }
      }
    }
    if (_bd.sig === sig && _bd.cv) return _bd;
    var cv = _bd.cv || document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = base ? rgbaStr(base) : "#282c34"; ctx.fillRect(0, 0, w, h);
    var pending = false;
    for (var p = 0; p < plan.length; p++) {
      var it = plan[p];
      if (it.fill) { ctx.fillStyle = rgbaStr(it.fill); ctx.fillRect(0, 0, w, h); }
      else if (it.grad) { try { paintGradient(ctx, w, h, it.grad); } catch (_) {} }
      else if (it.url) {
        var rec = ensureImg(it.url);
        if (!rec) { pending = true; continue; }
        try { drawCover(ctx, rec.img, w, h); } catch (_) {}
      }
    }
    var tainted = false;
    try { ctx.getImageData(0, 0, 1, 1); } catch (_) { tainted = true; }
    // sig keeps a |p marker while an image is still loading so the next pass rebuilds.
    _bd = { cv: cv, ctx: ctx, w: w, h: h, sig: pending ? sig + "|p" : sig, base: base, tainted: tainted };
    return _bd;
  }

  // Average luminance of the backdrop behind `rect` (viewport px). Returns 0..1 or null.
  function backdropLuminance(rect) {
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    var bd = buildBackdrop();
    if (bd && bd.cv && !bd.tainted) {
      var sx = bd.w / vw, sy = bd.h / vh, total = 0, n = 0;
      for (var gy = 0; gy < SAMPLE_GRID; gy++) {
        for (var gx = 0; gx < SAMPLE_GRID; gx++) {
          var vx = rect.left + (rect.width * (gx + 0.5)) / SAMPLE_GRID;
          var vy = rect.top + (rect.height * (gy + 0.5)) / SAMPLE_GRID;
          var ix = clamp(Math.round(vx * sx), 0, bd.w - 1), iy = clamp(Math.round(vy * sy), 0, bd.h - 1);
          try {
            var d = bd.ctx.getImageData(ix, iy, 1, 1).data;
            total += relLum(d[0], d[1], d[2]); n++;
          } catch (_) {}
        }
      }
      if (n) return total / n;
    }
    // Tainted (cross-origin wallpaper w/o CORS): use the resolved base colour if we have it.
    if (bd && bd.base) return relLum(bd.base[0], bd.base[1], bd.base[2]);
    // Deepest fallback: the computed background-color of the element behind the centre.
    try {
      var cx = clamp(rect.left + rect.width / 2, 0, vw - 1);
      var cy = clamp(rect.top + rect.height / 2, 0, vh - 1);
      var els = document.elementsFromPoint(cx, cy);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest && el.closest(SURFACES)) continue; // skip the glass itself / glass chrome
        var c2 = parseColor(getComputedStyle(el).backgroundColor || "");
        if (c2 && (c2[3] == null || c2[3] > 0.4)) return relLum(c2[0], c2[1], c2[2]);
      }
    } catch (_) {}
    return null;
  }

  // ── apply ───────────────────────────────────────────────────────────────────
  function isFrosted() { return !!(document.body && document.body.classList.contains("theme-frosted")); }

  function applyTo(el) {
    try {
      if (el.id && EXCLUDE_IDS[el.id]) return;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return;
      var L = backdropLuminance({ left: r.left, top: r.top, width: r.width, height: r.height });
      if (L == null) {
        el.style.removeProperty("background-color");
        el.style.removeProperty("color"); el.style.removeProperty("text-shadow");
        el.removeAttribute("data-adaptive-veil"); el.removeAttribute("data-adaptive-ink");
        return;
      }
      var small = false;
      try { small = el.matches(FLIP_SET); } catch (_) {}
      // SMALL bars stay CLEAR (low veil); LARGE surfaces don't flip, so their glass adapts
      // (a stronger veil over bright) to keep the light --fg symbols legible.
      var vmax = small ? VEIL_MAX_SMALL : VEIL_MAX_LARGE;
      // Reach the cap by the per-size full-mute point. Small bars cross over WITH the ink
      // flip (steeper); large surfaces ramp gently so a bright backdrop still shows through
      // (Apple "adjusted luminosity," never an opaque slab).
      var f = clamp(L / (small ? VEIL_FULL_AT_SMALL : VEIL_FULL_AT_LARGE), 0, 1);
      var pct = Math.round(clamp(VEIL_MIN + (vmax - VEIL_MIN) * f, VEIL_MIN, vmax));
      el.style.setProperty("background-color",
        "color-mix(in srgb, var(--panel, var(--bg)) " + pct + "%, transparent)", "important");
      el.setAttribute("data-adaptive-veil", String(pct));

      if (small && L >= INK_THRESHOLD) {
        // SMALL + BRIGHT: flip symbols DARK (the glass stays clear). Faint light halo = margin.
        el.style.setProperty("color", INK_DARK, "important");
        el.style.setProperty("text-shadow", "0 0 2px rgba(255,255,255,0.55)", "important");
        el.setAttribute("data-adaptive-ink", "dark");
      } else {
        // SMALL+dark, or any LARGE surface: keep light --fg (large elements never flip).
        el.style.removeProperty("color");
        // Stronger dark halo: light ink lingers on near-threshold mid-tones (the transition
        // band), so floor its legibility there until the flip takes over.
        el.style.setProperty("text-shadow", "0 1px 3px rgba(0,0,0,0.55)", "important");
        el.setAttribute("data-adaptive-ink", "light");
      }
    } catch (_) {}
  }

  function pass() {
    // Accessibility wins over the optics (WWDC25): under Increase Contrast the system goes
    // predominantly black/white + a contrasting border — the subtle adaptive flip is dropped.
    // Drop our overrides and let the CSS high-contrast treatment stand.
    if (!isFrosted() || prefersContrast()) {
      // drop our overrides so the static CSS veil stands
      var tagged = document.querySelectorAll("[data-adaptive-veil]");
      for (var i = 0; i < tagged.length; i++) {
        tagged[i].style.removeProperty("background-color");
        tagged[i].style.removeProperty("color");
        tagged[i].style.removeProperty("text-shadow");
        tagged[i].removeAttribute("data-adaptive-veil");
        tagged[i].removeAttribute("data-adaptive-ink");
      }
      return;
    }
    buildBackdrop(); // build the unified backdrop canvas once per pass; surfaces sample it
    var nodes = document.querySelectorAll(SURFACES);
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
      applyTo(el);
    }
  }

  var _t = 0;
  function schedule() {
    if (_t) return;
    _t = setTimeout(function () { _t = 0; pass(); }, DEBOUNCE_MS);
  }

  function init() {
    try {
      schedule();
      window.addEventListener("resize", schedule);
      window.addEventListener("scroll", schedule, { passive: true, capture: true });
      // re-sample when the theme or the backdrop changes (no new event — observe body).
      var mo = new MutationObserver(schedule);
      mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: false });
      ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].forEach(function (q) {
        try { var mq = window.matchMedia(q); (mq.addEventListener ? mq.addEventListener : mq.addListener).call(mq, "change", schedule); } catch (_) {}
      });
      window.OrwellAdaptiveGlass = { refresh: schedule, _pass: pass };
    } catch (_) {
      try { window.OrwellAdaptiveGlass = { refresh: function () {} }; } catch (__) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else { init(); }
})();

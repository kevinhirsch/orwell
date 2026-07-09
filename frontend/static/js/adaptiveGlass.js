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

  // The ONLY surfaces that adapt under the glass theme: the RECEIVED chat bubbles. Apple's
  // Messages received bubble flips polarity with the wallpaper — a LIGHT frost + DARK ink
  // over a bright wall, a DARK frost + LIGHT ink over a dark one. Chrome does NOT adapt (it
  // is a FIXED light glass; the old per-surface dark veil is retired and must not return),
  // and the SENT (blue) bubble never adapts (always blue + white). So this is just .msg-ai.
  var BUBBLE_ADAPTIVE = ".msg-ai";
  // ── #763 — the WELCOME HERO over the bare wallpaper ───────────────────────────
  // The hero (the big "Orwell" wordmark, the subtitle, the inline "type /setup" link)
  // sits DIRECTLY over the wallpaper (#__wp) — NOT over the light glass chrome. So a
  // single fixed ink (the old light var(--fg)) is light-on-light over a LIGHT wallpaper
  // (~1.13:1, invisible). Like Apple's monochrome labels over content and like the
  // .msg-ai bubbles above, the hero must FLIP polarity with the wallpaper. Unlike a
  // bubble there is NO frost plate, so the ink sits on the wallpaper DIRECTLY: we pick
  // polarity at the linear-Y flip point, then verify APCA(ink ↔ wallpaper) clears the
  // floor, and ESCALATE the ink toward pure black / pure white (not a scrim — a free
  // wordmark over a photo wants a halo, not a plate) plus a contrasting halo backstop.
  // Ink-only + halo; no veil/background is ever painted (it's not a glass surface).
  var HERO_ADAPTIVE = "#welcome-screen .welcome-name, #welcome-screen .welcome-sub";
  var HERO_INK_DARK = [22, 25, 31];        // #16191f — the dark ink (matches the CSS default + chrome)
  var HERO_INK_LIGHT = [238, 241, 244];    // #eef1f4 — the light ink over a dark wallpaper
  var HERO_HALO_LIGHT = "0 1px 2px rgba(255,255,255,0.60), 0 0 3px rgba(255,255,255,0.50)"; // under DARK ink
  var HERO_HALO_DARK = "0 1px 2px rgba(0,0,0,0.62), 0 0 3px rgba(0,0,0,0.52)";              // under LIGHT ink
  // the LIGHT frost a received bubble takes over a BRIGHT backdrop (Apple's light received
  // bubble) — a near-white translucent material that reads with the dark INK_DARK label.
  // The DARK frost (over a dark/mid wall) is the CSS default (rgba(56,60,68,a)); its alpha
  // is the CSS var --ai-scrim-alpha so we can ESCALATE it per-bubble (see #744 below).
  var BUBBLE_LIGHT_RGB = [245, 246, 248];   // near-white frost tint over a BRIGHT wall
  var BUBBLE_DARK_RGB = [56, 60, 68];       // neutral dark frost tint (matches style.css default)

  // ── #744 — APCA legibility floor for the RECEIVED transcript ──────────────────
  // The chat transcript IS the game (read for hours) and is the most-cited legibility gap.
  // Polarity-flip ALONE (a dark-ink/light-ink choice at a single Y threshold) is not enough:
  // over a BUSY or SATURATED MID-TONE wallpaper neither pure-dark nor pure-white ink clears a
  // real contrast floor through a thin frost. So after we pick ink polarity we measure the
  // ACTUAL perceptual contrast with APCA (the algorithm WCAG 3 / the bronze guidance use), and
  // if it fails we ESCALATE this ONE bubble's scrim toward opaque until it clears. This is a
  // LOCAL per-bubble escalation (the CSS var --ai-scrim-alpha on that element) — NOT a global
  // theme-tinted body state (#739, blocked on #730); we stay strictly local and Vault-free.
  //
  // FLOOR = Lc 60. APCA "bronze" puts Lc 60 as the floor for fluent body text (the next rung,
  // Lc 75/90, is for fine/small text). The transcript is body prose read for a long sitting, so
  // 60 is the defensible minimum — high enough to never be the cited gap, low enough that a clear
  // wallpaper still reads as glass rather than a solid plate. (APCA Lc is unsigned-magnitude here;
  // we take |Lc| because polarity is already chosen.)
  var APCA_FLOOR = 60;
  // Per-bubble scrim escalation band: start at the CSS default and climb toward near-opaque.
  var SCRIM_BASE = 0.46;     // mirrors the style.css --ai-scrim-alpha default (worst-case floor)
  var SCRIM_MAX = 0.92;      // near-opaque cap — still a frost, never a flat solid slab
  var SCRIM_STEP = 0.06;     // climb granularity when APCA fails for this bubble's backdrop

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

  // ── APCA (Accessible Perceptual Contrast Algorithm, the WCAG 3 / SAPC-APCA model) ──
  // A faithful, dependency-free port of the APCA-W3 0.1.9 core (the public-domain reference by
  // Andrew Somers / Myndex). We use it for the #744 transcript legibility floor: unlike WCAG 2's
  // luminance-ratio (which over/under-states contrast on mid-tones and for light-on-dark), APCA
  // models perceived lightness contrast and is polarity-aware — the right tool for "does this ink
  // clear a floor over THIS backdrop." Returns Lc (lightness contrast); sign encodes polarity, so
  // callers take Math.abs() when polarity is already chosen.
  function _apcaY(r, g, b) {
    // sRGB → screen luminance (APCA uses simple ^2.4 on 0..1, NOT the WCAG piecewise curve).
    var Rs = Math.pow(r / 255, 2.4), Gs = Math.pow(g / 255, 2.4), Bs = Math.pow(b / 255, 2.4);
    return 0.2126729 * Rs + 0.7151522 * Gs + 0.0721750 * Bs;
  }
  function apcaContrast(txt, bg) {
    // txt/bg = [r,g,b]. Constants are the APCA-W3 0.1.9 published values.
    var Ytxt = _apcaY(txt[0], txt[1], txt[2]);
    var Ybg = _apcaY(bg[0], bg[1], bg[2]);
    var BLK_THRS = 0.022, BLK_CLMP = 1.414;
    var SCALE_BoW = 1.14, SCALE_WoB = 1.14;
    var LO_CLIP = 0.1, DELTA_MIN = 0.0005;
    // soft-clamp blacks
    Ytxt = Ytxt > BLK_THRS ? Ytxt : Ytxt + Math.pow(BLK_THRS - Ytxt, BLK_CLMP);
    Ybg = Ybg > BLK_THRS ? Ybg : Ybg + Math.pow(BLK_THRS - Ybg, BLK_CLMP);
    if (Math.abs(Ybg - Ytxt) < DELTA_MIN) return 0;
    var out;
    if (Ybg > Ytxt) {            // normal polarity: dark text on lighter bg
      out = (Math.pow(Ybg, 0.56) - Math.pow(Ytxt, 0.57)) * SCALE_BoW;
      out = out < LO_CLIP ? 0 : out - 0.027;
    } else {                     // reverse polarity: light text on darker bg
      out = (Math.pow(Ybg, 0.65) - Math.pow(Ytxt, 0.62)) * SCALE_WoB;
      out = out > -LO_CLIP ? 0 : out + 0.027;
    }
    return out * 100;            // Lc
  }
  // Composite an opaque scrim (tint at alpha) over an opaque backdrop → the effective bubble
  // surface the ink actually sits on (standard src-over alpha blend; backdrop alpha = 1).
  function compositeOver(tint, alpha, backdrop) {
    var a = clamp(alpha, 0, 1);
    return [
      Math.round(tint[0] * a + backdrop[0] * (1 - a)),
      Math.round(tint[1] * a + backdrop[1] * (1 - a)),
      Math.round(tint[2] * a + backdrop[2] * (1 - a)),
    ];
  }
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

  // Average RGB of the backdrop behind `rect` (viewport px). Returns [r,g,b] or null. Used by
  // the #744 APCA floor — we need the backdrop COLOUR (not just its luminance) so we can composite
  // the scrim over it and measure the real ink↔surface contrast.
  function backdropAvgColor(rect) {
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    var bd = buildBackdrop();
    if (bd && bd.cv && !bd.tainted) {
      var sx = bd.w / vw, sy = bd.h / vh, rs = 0, gs = 0, bs = 0, n = 0;
      for (var gy = 0; gy < SAMPLE_GRID; gy++) {
        for (var gx = 0; gx < SAMPLE_GRID; gx++) {
          var vx = rect.left + (rect.width * (gx + 0.5)) / SAMPLE_GRID;
          var vy = rect.top + (rect.height * (gy + 0.5)) / SAMPLE_GRID;
          var ix = clamp(Math.round(vx * sx), 0, bd.w - 1), iy = clamp(Math.round(vy * sy), 0, bd.h - 1);
          try { var d = bd.ctx.getImageData(ix, iy, 1, 1).data; rs += d[0]; gs += d[1]; bs += d[2]; n++; } catch (_) {}
        }
      }
      if (n) return [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)];
    }
    if (bd && bd.base) return [bd.base[0], bd.base[1], bd.base[2]];
    return null;
  }

  // #744 — for a received bubble over a sampled backdrop, pick the polarity (per the existing
  // linear-Y flip), then ESCALATE this bubble's scrim alpha until the APCA(ink↔composited-surface)
  // contrast clears APCA_FLOOR (or we hit SCRIM_MAX). Returns { ink, frostRgb, scrimAlpha, lc }.
  // The surface the ink truly sits on = the frost tint composited over the wallpaper at scrimAlpha
  // (the bubble blurs the wall but the scrim is opaque-over the blurred result), so that is what we
  // measure. Polarity-flip alone is the floor; the scrim escalation is the guarantee.
  // Escalate ONE polarity's scrim: composite the frost over the sampled backdrop and climb the
  // LOCAL per-bubble scrim alpha (from the CSS default toward the near-opaque cap) until
  // APCA(ink↔surface) clears the floor — or we hit the cap. Returns the best {alpha, lc} this
  // polarity can reach over THIS backdrop.
  function _escalateScrim(ink, frost, bgRgb) {
    var a = SCRIM_BASE, lc = 0, surface;
    for (;;) {
      surface = compositeOver(frost, a, bgRgb);
      lc = Math.abs(apcaContrast(ink, surface));
      if (lc >= APCA_FLOOR || a >= SCRIM_MAX) break;
      a = Math.min(SCRIM_MAX, a + SCRIM_STEP);
    }
    return { alpha: a, lc: lc };
  }

  function resolveBubbleScrim(L, bgRgb) {
    // PREFERRED polarity from the linear-Y flip (Apple Messages received-bubble behaviour):
    // a BRIGHT backdrop → DARK ink + light frost; a DARK backdrop → WHITE ink + dark frost.
    var darkPref = L >= INK_THRESHOLD;
    var darkInk = parseColor(INK_DARK).slice(0, 3), lightInk = [255, 255, 255];
    var prefInk = darkPref ? darkInk : lightInk;
    var prefFrost = darkPref ? BUBBLE_LIGHT_RGB : BUBBLE_DARK_RGB;
    var pref = _escalateScrim(prefInk, prefFrost, bgRgb);
    var dark = darkPref, ink = prefInk, frost = prefFrost, a = pref.alpha, lc = pref.lc;
    // The legibility FLOOR is the non-negotiable; the polarity FLIP is the aesthetic preference.
    // At the extremes (a clearly bright or clearly dark wall) the preferred polarity always wins
    // on contrast, so this is a no-op there. Only when a STARVED mid-tone right at the flip
    // boundary can't reach the floor with the preferred polarity even at the scrim cap do we fall
    // back to whichever polarity contrasts MORE — so a received bubble is legible over ANY
    // wallpaper, not just the threshold-preferred half.
    if (pref.lc < APCA_FLOOR) {
      var altInk = darkPref ? lightInk : darkInk;
      var altFrost = darkPref ? BUBBLE_DARK_RGB : BUBBLE_LIGHT_RGB;
      var alt = _escalateScrim(altInk, altFrost, bgRgb);
      if (alt.lc > pref.lc) {
        dark = !darkPref; ink = altInk; frost = altFrost; a = alt.alpha; lc = alt.lc;
      }
    }
    return { ink: ink, frostRgb: frost, scrimAlpha: a, lc: lc, dark: dark };
  }

  // #763 — for the welcome hero over a sampled wallpaper, pick ink polarity (the same
  // linear-Y flip the small bars use), then verify APCA(ink ↔ wallpaper) clears the floor
  // and ESCALATE the ink toward pure black / pure white until it does (or it's already
  // maxed). The hero has no frost plate, so the ink sits on the wallpaper DIRECTLY — that
  // is the pair we measure. Returns { ink, halo, dark, lc }. A contrasting halo is the
  // backstop floor for a free wordmark over a busy/edge backdrop (mirrors the bubble halo).
  function resolveHeroInk(L, bgRgb) {
    var dark = L >= INK_THRESHOLD;          // bright wallpaper → DARK ink; dark wallpaper → LIGHT ink
    var ink = dark ? HERO_INK_DARK.slice() : HERO_INK_LIGHT.slice();
    var target = dark ? [0, 0, 0] : [255, 255, 255];  // escalate toward this if the floor isn't met
    var lc = Math.abs(apcaContrast(ink, bgRgb));
    // climb the ink toward pure black/white in a few steps if a mid-tone wallpaper starves it.
    for (var step = 0; step < 6 && lc < APCA_FLOOR; step++) {
      ink = [
        Math.round(ink[0] + (target[0] - ink[0]) * 0.5),
        Math.round(ink[1] + (target[1] - ink[1]) * 0.5),
        Math.round(ink[2] + (target[2] - ink[2]) * 0.5),
      ];
      lc = Math.abs(apcaContrast(ink, bgRgb));
    }
    return { ink: ink, halo: dark ? HERO_HALO_LIGHT : HERO_HALO_DARK, dark: dark, lc: lc };
  }

  // ── apply ───────────────────────────────────────────────────────────────────
  function isFrosted() { return !!(document.body && document.body.classList.contains("theme-frosted")); }

  function applyTo(el) {
    try {
      if (el.id && EXCLUDE_IDS[el.id]) return;
      var r = el.getBoundingClientRect();
      // The hero text (esp. the one-line subtitle) is a THIN strip — a flat 24px floor
      // skipped .welcome-sub entirely (it stayed at the dark CSS default, unreadable over
      // a dark/busy wallpaper). Hero elements are text, so a thin sample is fine; relax the
      // height floor for them (keep the width floor so a collapsed/empty node is still skipped).
      var heroEl = false; try { heroEl = el.matches(HERO_ADAPTIVE); } catch (_) {}
      var minH = heroEl ? 10 : 24;
      if (r.width < 24 || r.height < minH) return;
      var L = backdropLuminance({ left: r.left, top: r.top, width: r.width, height: r.height });
      if (L == null) {
        el.style.removeProperty("background-color");
        el.style.removeProperty("color"); el.style.removeProperty("text-shadow");
        el.style.removeProperty("-webkit-text-fill-color");
        el.removeAttribute("data-adaptive-veil"); el.removeAttribute("data-adaptive-ink");
        return;
      }
      // CHAT BUBBLE polarity (Apple Messages received bubble). Over a BRIGHT wallpaper the
      // bubble becomes a LIGHT frost + DARK ink; over a DARK one it keeps the CSS dark frost
      // + light ink (we just clear our overrides). Chrome never reaches here (pass() sends
      // only bubbles under the glass theme), so the old per-surface dark veil can't crawl back.
      var isBubble = false; try { isBubble = el.matches(BUBBLE_ADAPTIVE); } catch (_) {}
      if (isBubble) {
        // #744 — guarantee the transcript clears the APCA floor over ANY wallpaper. Sample the
        // backdrop COLOUR (not just L), pick polarity, then escalate THIS bubble's scrim alpha
        // until APCA(ink↔composited-surface) ≥ APCA_FLOOR. Frost-only, local, Vault-free.
        var bg = backdropAvgColor({ left: r.left, top: r.top, width: r.width, height: r.height });
        if (!bg) { // no readable backdrop colour → fall back to the CSS default (already floored at SCRIM_BASE)
          el.style.removeProperty("background-color"); el.style.removeProperty("color");
          el.style.removeProperty("text-shadow"); el.style.removeProperty("--ai-scrim-alpha");
          el.removeAttribute("data-adaptive-veil"); el.removeAttribute("data-adaptive-ink");
          el.removeAttribute("data-apca-lc");
          return;
        }
        var s = resolveBubbleScrim(L, bg);
        // Drive the scrim alpha through the CSS var so the floored fill (style.css) and the JS
        // escalation share ONE source of truth; set the frost tint + ink to match the polarity.
        el.style.setProperty("--ai-scrim-alpha", s.scrimAlpha.toFixed(3));
        el.style.setProperty("background-color",
          "rgba(" + s.frostRgb[0] + "," + s.frostRgb[1] + "," + s.frostRgb[2] + ",var(--ai-scrim-alpha))", "important");
        if (s.dark) {
          el.style.setProperty("color", INK_DARK, "important");
          el.style.setProperty("text-shadow", "none", "important");
          el.setAttribute("data-adaptive-ink", "dark");
        } else {
          // white ink over the dark frost — keep the legibility halo from the CSS default.
          el.style.removeProperty("color");
          el.style.setProperty("text-shadow", "0 1px 2px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.40)", "important");
          el.setAttribute("data-adaptive-ink", "light");
        }
        el.setAttribute("data-adaptive-veil", "bubble");
        el.setAttribute("data-apca-lc", Math.round(s.lc));   // probe hook for the smoke test
        return;
      }
      // #763 — the WELCOME HERO (wordmark + subtitle) over the bare wallpaper. Ink-only
      // polarity flip with the APCA floor measured DIRECTLY against the wallpaper (no
      // frost plate). We never paint a background here — only the ink + a contrasting
      // halo. The CSS default is dark-ink+light-halo; we restate or flip it per backdrop.
      var isHero = false; try { isHero = el.matches(HERO_ADAPTIVE); } catch (_) {}
      if (isHero) {
        var hbg = backdropAvgColor({ left: r.left, top: r.top, width: r.width, height: r.height });
        if (!hbg) {  // no readable wallpaper colour → let the CSS default stand
          el.style.removeProperty("color");
          el.style.removeProperty("-webkit-text-fill-color");
          el.style.removeProperty("text-shadow");
          el.removeAttribute("data-adaptive-ink"); el.removeAttribute("data-apca-lc");
          return;
        }
        var h = resolveHeroInk(L, hbg);
        var hcss = "rgb(" + h.ink[0] + "," + h.ink[1] + "," + h.ink[2] + ")";
        el.style.setProperty("color", hcss, "important");
        // .welcome-name uses -webkit-text-fill-color (it was a clipped gradient) — drive it too.
        el.style.setProperty("-webkit-text-fill-color", hcss, "important");
        el.style.setProperty("text-shadow", h.halo, "important");
        el.setAttribute("data-adaptive-ink", h.dark ? "dark" : "light");
        el.setAttribute("data-apca-lc", Math.round(h.lc));
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

  function isGlassFull() { return !!(document.body && document.body.classList.contains("glass-full")); }

  function pass() {
    // Accessibility wins over the optics (WWDC25): under Increase Contrast the system goes
    // predominantly black/white + a contrasting border — the subtle adaptive flip is dropped.
    // Drop our overrides and let the CSS high-contrast treatment stand.
    //
    // UNIFORMITY (owner: "every light surface needs the SAME properties — the kube music
    // player recreated everywhere"; "there should be no old dark glass at all"): under the
    // GLASS THEME — BOTH tiers (Full Glass = theme-frosted+glass-full, Frosted = theme-frosted
    // alone) — the surface is now a FIXED light glass (the kube 0.60 light fill from style.css,
    // identical on every surface; Full adds SVG refraction + specular, Frosted a CSS blur). The
    // adaptive layer used to paint a per-surface, backdrop-varying DARK veil — that was the "old
    // dark glass" the owner is retiring: it would make each surface look DIFFERENT and darken the
    // fixed light fill. So adaptiveGlass STANDS DOWN whenever theme-frosted is active (it never
    // paints a veil/ink under the glass theme). The module + its functions (SURFACES, FLIP_SET,
    // INK_THRESHOLD, the backdrop sampler, etc.) are kept intact for the source-pinned tests; only
    // the runtime is gated. There is no longer any glass tier that wants the adaptive veil.
    // (isGlassFull is retained as a named helper for the source-pinned tests; the standdown is
    // now keyed on theme-frosted, which covers BOTH tiers, so glass-full is a subset of it.)
    // Accessibility wins: under Increase Contrast the system goes black/white + a border;
    // drop ALL our overrides and let the CSS high-contrast treatment stand.
    if (prefersContrast()) { _dropTagged(null); return; }

    // GLASS THEME (BOTH tiers — theme-frosted): the CHROME is a FIXED light glass (the kube
    // 0.60 fill; Full adds SVG refraction, Frosted a CSS blur). The old per-surface, backdrop-
    // varying DARK veil is RETIRED and must NOT crawl back — so chrome STANDS DOWN. The ONLY
    // adaptive surfaces are the RECEIVED chat bubbles (.msg-ai), which flip polarity like
    // Apple's Messages (light frost+dark ink over a bright wall, dark frost+light ink over a
    // dark one). So: clear every NON-bubble override, then run the adaptive pass on bubbles.
    // (isGlassFull is retained as a named helper for the source-pinned tests; the standdown is
    // keyed on theme-frosted, which covers BOTH tiers, so glass-full is a subset of it.)
    if (isFrosted() || isGlassFull()) {
      // The adaptive surfaces under the glass theme: the RECEIVED chat bubbles (#744) AND
      // the welcome HERO over the bare wallpaper (#763). Both flip ink polarity with the
      // backdrop; everything else (the fixed light glass chrome) stands down.
      var ADAPTIVE_SEL = BUBBLE_ADAPTIVE + ", " + HERO_ADAPTIVE;
      _dropTagged(ADAPTIVE_SEL);      // chrome (+ anything non-adaptive) drops; bubbles + hero kept
      buildBackdrop();                // unified backdrop canvas; bubbles + hero sample it
      var nodes = document.querySelectorAll(ADAPTIVE_SEL);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
        applyTo(el);
      }
      return;
    }

    // No glass theme → full standdown (the static CSS stands).
    _dropTagged(null);
  }

  // Remove our inline overrides from previously-tagged elements. keepSel (a selector) is
  // spared so a bubble's live adaptive ink isn't cleared on the same pass that re-applies it.
  function _dropTagged(keepSel) {
    var tagged = document.querySelectorAll("[data-adaptive-veil],[data-adaptive-ink]");
    for (var i = 0; i < tagged.length; i++) {
      var el = tagged[i];
      if (keepSel) { try { if (el.matches(keepSel)) continue; } catch (_) {} }
      el.style.removeProperty("background-color");
      el.style.removeProperty("color");
      el.style.removeProperty("-webkit-text-fill-color");   // #763 — drop the hero ink override too
      el.style.removeProperty("text-shadow");
      el.style.removeProperty("--ai-scrim-alpha");   // #744 — drop the per-bubble scrim escalation too
      el.removeAttribute("data-adaptive-veil");
      el.removeAttribute("data-adaptive-ink");
      el.removeAttribute("data-apca-lc");
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
      // re-sample when CHAT MESSAGES are added/stream in — the body observer is subtree:false,
      // so a freshly-rendered received bubble (.msg-ai) would keep its default light-on-dark ink
      // over a BRIGHT wallpaper until an unrelated scroll/resize fired. Observe #chat-history so
      // the adaptive polarity flip lands as the bubble appears. Debounced (schedule), so streaming
      // text doesn't thrash. (chat-history is static in index.html, so it exists at init.)
      var _chat = document.getElementById("chat-history");
      if (_chat) {
        var cmo = new MutationObserver(schedule);
        cmo.observe(_chat, { childList: true, subtree: true });
      }
      ["(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].forEach(function (q) {
        try { var mq = window.matchMedia(q); (mq.addEventListener ? mq.addEventListener : mq.addListener).call(mq, "change", schedule); } catch (_) {}
      });
      // #744 — expose the APCA helpers + the floor so the browser-smoke probe can MEASURE the
      // resolved fg/bg pair clears the floor (and the source-pinned test can assert their presence).
      window.OrwellAdaptiveGlass = {
        refresh: schedule, _pass: pass,
        apcaContrast: apcaContrast, compositeOver: compositeOver,
        resolveBubbleScrim: resolveBubbleScrim, APCA_FLOOR: APCA_FLOOR,
      };
    } catch (_) {
      try { window.OrwellAdaptiveGlass = { refresh: function () {} }; } catch (__) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else { init(); }
})();

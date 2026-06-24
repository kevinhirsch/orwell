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
  var SURFACES = ".ow-window, .chat-input-bar, #sidebar, .modal-content, .og-card, .on-card, #minimized-dock.ow-has-rows, .dropdown, .overflow-menu, .cp-popover";
  var EXCLUDE_IDS = { "orwell-headshot": 1 };

  // Apple's mechanism over bright media is NOT "darken the glass" — the glass stays
  // CLEAR/translucent and the SYMBOLS go dark ("symbols and text become darker when the
  // underlying content is light, and lighter when it's dark"). So we keep the veil GENTLE
  // (the glass stays clear) and do the legibility work with an adaptive INK colour on the
  // surface's text/symbols. The small veil only provides a touch of separation.
  var VEIL_MIN = 14;   // % --panel at a dark backdrop (translucent/lit)
  var VEIL_MAX = 34;   // % --panel at a bright backdrop (still clearly translucent — NOT a slab)
  var INK_THRESHOLD = 0.58; // backdrop luminance above which symbols flip to DARK ink
  var INK_DARK = "#11151c";   // dark symbol/label colour over bright backdrops
  var DEBOUNCE_MS = 120;
  var SAMPLE_GRID = 5; // NxN samples across the surface's backdrop region

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function relLum(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }

  // ── backdrop image discovery + sampling ─────────────────────────────────────
  // The "background" can be anything. We resolve the topmost viewport-covering source:
  //   1) an explicit wallpaper/test element or any element with a background-image, or
  //   2) an <img> that covers the viewport,
  // sample its pixels (cover-mapped) for a surface's region, else fall back to the
  // computed background-color luminance of the element behind the surface.
  var _imgCache = {}; // url -> { canvas, ctx, w, h } | 'pending' | 'failed'

  function bgImageUrl(el) {
    try {
      var bi = getComputedStyle(el).backgroundImage || "";
      var m = bi.match(/url\((['"]?)(.*?)\1\)/);
      return m ? m[2] : null;
    } catch (_) { return null; }
  }

  function findBackdropImageUrl() {
    // Prefer a known full-viewport wallpaper, else scan likely containers.
    var ids = ["__wp", "wallpaper", "app-bg", "background"];
    for (var i = 0; i < ids.length; i++) {
      var e = document.getElementById(ids[i]);
      if (e) { var u = bgImageUrl(e); if (u) return u; }
    }
    var cands = [document.body, document.documentElement];
    for (var c = 0; c < cands.length; c++) { var u2 = bgImageUrl(cands[c]); if (u2) return u2; }
    return null;
  }

  function ensureCanvas(url) {
    var rec = _imgCache[url];
    if (rec && rec !== "pending" && rec !== "failed") return rec;
    if (rec === "pending" || rec === "failed") return null;
    _imgCache[url] = "pending";
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        var cv = document.createElement("canvas");
        var scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight)); // downscale: cheap
        cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
        cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        // touch one pixel to confirm it isn't tainted (cross-origin) → throws if so.
        ctx.getImageData(0, 0, 1, 1);
        _imgCache[url] = { canvas: cv, ctx: ctx, w: cv.width, h: cv.height };
        schedule();
      } catch (_) { _imgCache[url] = "failed"; }
    };
    img.onerror = function () { _imgCache[url] = "failed"; };
    img.src = url;
    return null;
  }

  // Average luminance of the backdrop behind `rect` (viewport px). Returns 0..1 or null.
  function backdropLuminance(rect, imgUrl) {
    var vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    if (imgUrl) {
      var rec = ensureCanvas(imgUrl);
      if (rec) {
        // cover mapping: scale so the (downscaled) image covers the viewport.
        var s = Math.max(vw / rec.w, vh / rec.h);
        var dispW = rec.w * s, dispH = rec.h * s;
        var ox = (vw - dispW) / 2, oy = (vh - dispH) / 2;
        var total = 0, n = 0;
        for (var gy = 0; gy < SAMPLE_GRID; gy++) {
          for (var gx = 0; gx < SAMPLE_GRID; gx++) {
            var vx = rect.left + (rect.width * (gx + 0.5)) / SAMPLE_GRID;
            var vy = rect.top + (rect.height * (gy + 0.5)) / SAMPLE_GRID;
            var ix = Math.round((vx - ox) / s), iy = Math.round((vy - oy) / s);
            if (ix < 0 || iy < 0 || ix >= rec.w || iy >= rec.h) continue;
            try {
              var d = rec.ctx.getImageData(ix, iy, 1, 1).data;
              total += relLum(d[0], d[1], d[2]); n++;
            } catch (_) {}
          }
        }
        if (n) return total / n;
      }
    }
    // Fallback: the computed background-color luminance of the element behind the centre.
    try {
      var cx = clamp(rect.left + rect.width / 2, 0, vw - 1);
      var cy = clamp(rect.top + rect.height / 2, 0, vh - 1);
      var els = document.elementsFromPoint(cx, cy);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest && el.closest(SURFACES)) continue; // skip the glass itself / glass chrome
        var bg = getComputedStyle(el).backgroundColor || "";
        var mm = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (mm && (mm[4] === undefined || parseFloat(mm[4]) > 0.4)) {
          return relLum(+mm[1], +mm[2], +mm[3]);
        }
      }
    } catch (_) {}
    return null;
  }

  // ── apply ───────────────────────────────────────────────────────────────────
  function isFrosted() { return !!(document.body && document.body.classList.contains("theme-frosted")); }

  function applyTo(el, imgUrl) {
    try {
      if (el.id && EXCLUDE_IDS[el.id]) return;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return;
      var L = backdropLuminance({ left: r.left, top: r.top, width: r.width, height: r.height }, imgUrl);
      if (L == null) {
        el.style.removeProperty("background-color");
        el.style.removeProperty("color"); el.style.removeProperty("text-shadow");
        el.removeAttribute("data-adaptive-veil"); el.removeAttribute("data-adaptive-ink");
        return;
      }
      // GENTLE veil only (glass stays clear). Brighter backdrop → a touch more separation.
      var pct = Math.round(clamp(VEIL_MIN + (VEIL_MAX - VEIL_MIN) * L, VEIL_MIN, VEIL_MAX));
      el.style.setProperty("background-color",
        "color-mix(in srgb, var(--panel, var(--bg)) " + pct + "%, transparent)", "important");
      el.setAttribute("data-adaptive-veil", String(pct));
      // ADAPTIVE INK (the real Apple lever): over a BRIGHT backdrop the symbols/labels go
      // DARK; over a DARK backdrop they stay light (--fg). A faint opposite-tone halo gives
      // the final legibility margin without darkening the glass. Set on the surface so its
      // text/symbols inherit; the tinted CTA / coloured controls keep their own !important.
      if (L >= INK_THRESHOLD) {
        el.style.setProperty("color", INK_DARK, "important");
        el.style.setProperty("text-shadow", "0 0 2px rgba(255,255,255,0.55)", "important");
        el.setAttribute("data-adaptive-ink", "dark");
      } else {
        el.style.removeProperty("color");
        el.style.setProperty("text-shadow", "0 1px 2px rgba(0,0,0,0.32)", "important");
        el.setAttribute("data-adaptive-ink", "light");
      }
    } catch (_) {}
  }

  function pass() {
    if (!isFrosted()) {
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
    var imgUrl = findBackdropImageUrl();
    var nodes = document.querySelectorAll(SURFACES);
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
      applyTo(el, imgUrl);
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

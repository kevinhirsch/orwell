// orwellElements.js — DEMO DRIVER for the kit reference page (issue #773).
//
// NOT shipped in the app: it is loaded ONLY by static/element_kit_demo.html to
// instantiate LIVE examples of every COMPOSITE kit (OrwellWindow / OrwellNotice /
// OrwellGadget / OrwellDecision composition) beside the atomic-element section, so
// the showcase shows "what everything accessible in a kit looks like."
//
// The kit modules pin their instances to fixed slots (the HUD band, the top banner,
// the rail). For a single sectioned still we RELOCATE each instance's element into
// its section container (the .ek-wins / .ek-notices hosts) — a demo-only move; the
// kit chrome/classes are untouched, so the swatch is faithful to the real surface.
(function () {
  "use strict";

  // ── TIER + BACKDROP SWITCHERS (demo chrome) ─────────────────────────────────
  // Drives the fixed Frosted / Glass / Flat toolbar (#ek-tier) AND the Busy / Smooth
  // backdrop toggle (#ek-bg — KIT-G-03, 2026-07-14 audit) in element_kit_demo.html.
  // Lives HERE, not inline in the demo page: the app serves /static under a CSP that
  // refuses inline scripts (script-src 'self'). Deep-linkable via location.hash
  // (#tier=frosted|glass|flat&bg=busy|smooth); FROSTED is the default tier (the app
  // default) and BUSY the default backdrop (glass must be judged over a realistic
  // backdrop — the smooth pastel wash measured A/B glass-vs-frosted diffs ≤14/255).
  // Self-contained — deliberately does NOT load theme.js; flat's dark tokens are demo
  // scaffolding CSS (.ek-flat) — a DELIBERATE COPY of the `dark` preset in js/theme.js
  // THEMES (keep in sync; see the tripwire comment in element_kit_demo.html). The
  // tier→body-class map below likewise mirrors theme.js applyGlassTier's contract, minus
  // the glassTierCeiling clamp — this page must show all three tiers on demand.
  function initTierSwitcher() {
    var VALID_TIER = { frosted: 1, glass: 1, flat: 1 };
    var VALID_BG = { busy: 1, smooth: 1 };
    function tierFromHash() {
      var m = /tier=(\w+)/.exec(location.hash || "");
      return (m && VALID_TIER[m[1]]) ? m[1] : "frosted";   // FROSTED is the app default
    }
    function bgFromHash() {
      var m = /bg=(\w+)/.exec(location.hash || "");
      return (m && VALID_BG[m[1]]) ? m[1] : "busy";        // KIT-G-03: BUSY is the default
    }
    function apply() {
      var tier = tierFromHash(), bg = bgFromHash();
      var b = document.body, h = document.documentElement;
      b.classList.remove("theme-frosted", "glass-full", "ek-flat");
      h.classList.remove("ek-flat");
      if (tier === "glass") { b.classList.add("theme-frosted", "glass-full"); }
      else if (tier === "frosted") { b.classList.add("theme-frosted"); }
      else { b.classList.add("ek-flat"); h.classList.add("ek-flat"); }
      // KIT-G-03: the busy backdrop rides one body class; flat's dark backdrop rules
      // still win there (the CSS carries the :not(.ek-flat) guard).
      b.classList.toggle("ek-bg-busy", bg === "busy");
      document.querySelectorAll("#ek-tier button").forEach(function (btn) {
        var on = btn.dataset.tier === tier;
        btn.classList.toggle("ek-tier-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      document.querySelectorAll("#ek-bg button").forEach(function (btn) {
        var on = btn.dataset.bg === bg;
        btn.classList.toggle("ek-tier-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      // re-target the Chromium SVG refraction layer for the new tier/backdrop (no-op elsewhere)
      try { window.OrwellLiquidGlass && window.OrwellLiquidGlass.refresh && window.OrwellLiquidGlass.refresh(); } catch (_) {}
    }
    function setHash(tier, bg) {
      var next = "tier=" + tier + "&bg=" + bg;
      var already = (location.hash || "").replace(/^#/, "") === next;
      location.hash = next;                        // deep-linkable; hashchange applies
      if (already) apply();                        // same-hash re-click fires no hashchange
    }
    document.querySelectorAll("#ek-tier button").forEach(function (btn) {
      btn.addEventListener("click", function () { setHash(btn.dataset.tier, bgFromHash()); });
    });
    document.querySelectorAll("#ek-bg button").forEach(function (btn) {
      btn.addEventListener("click", function () { setHash(tierFromHash(), btn.dataset.bg); });
    });
    window.addEventListener("hashchange", apply);
    ensureBusyNoise();
    apply();
  }

  // ── KIT-G-03: the seeded canvas noise/blotch tile for the BUSY backdrop ──────
  // The CSS gradient layers give the backdrop hue/luma STRUCTURE at control scale;
  // this tile adds the photo-like texture on top — soft random color blotches + a
  // per-pixel grain pass — injected as the CSS custom property --ek-noise-tile
  // (consumed by the body.ek-bg-busy #__wp rule). Seeded (mulberry32-style) so every
  // load/screenshot sees the SAME texture; fail-open — no canvas ⇒ the gradient
  // layers alone still carry the busy look.
  function ensureBusyNoise() {
    try {
      var SIZE = 288;
      var c = document.createElement("canvas");
      c.width = c.height = SIZE;
      var ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      var s = 0x9e3779b9 >>> 0;                    // fixed seed — deterministic texture
      function rnd() {
        s = (s + 0x6d2b79f5) >>> 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
      // soft color blotches — cloud/foliage-scale hue detail
      for (var i = 0; i < 90; i++) {
        var r = 8 + rnd() * 46;
        ctx.fillStyle = "hsla(" + Math.floor(rnd() * 360) + "," +
          Math.floor(35 + rnd() * 45) + "%," + Math.floor(35 + rnd() * 45) + "%," +
          (0.10 + rnd() * 0.22).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(rnd() * SIZE, rnd() * SIZE, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // per-pixel grain — the photo-noise floor
      var img = ctx.getImageData(0, 0, SIZE, SIZE), d = img.data;
      for (var p = 0; p < d.length; p += 4) {
        var n = (rnd() - 0.5) * 56;
        d[p] += n; d[p + 1] += n; d[p + 2] += n;
        d[p + 3] = Math.max(d[p + 3], 46);         // a faint grain film everywhere
      }
      ctx.putImageData(img, 0, 0);
      document.documentElement.style.setProperty(
        "--ek-noise-tile", 'url("' + c.toDataURL("image/png") + '")');
    } catch (_) { /* fail-open: gradients alone still read busy */ }
  }
  if (document.getElementById("ek-tier")) initTierSwitcher();

  // The kit globals load as async modules — wait for them, then build once.
  function whenReady(cb) {
    var tries = 0;
    (function poll() {
      var ok = window.OrwellWindowKit && window.OrwellNoticeKit && window.OrwellGadgetKit;
      if (ok) { try { cb(); } catch (e) { console.error("[kit-demo]", e); } return; }
      if (tries++ > 100) { console.warn("[kit-demo] kit globals never arrived"); return; }
      setTimeout(poll, 50);
    })();
  }

  // Move a kit element into a demo section host, stripping any sibling scrim/backdrop
  // the kit mounted on document.body (modal windows add one) so the still stays clean.
  function relocate(el, hostId) {
    var host = document.getElementById(hostId);
    if (host && el) host.appendChild(el);
  }
  function dropScrims() {
    document.querySelectorAll("[data-ow-scrim]").forEach(function (s) { s.remove(); });
    // un-inert anything a modal marked while opening (demo only)
    document.querySelectorAll("[inert]").forEach(function (n) {
      if (!n.closest(".ek-page")) return;
      n.removeAttribute("inert");
    });
  }

  function buildWindows() {
    // 1) a STANDARD HUD window
    var std = window.OrwellWindowKit.create({
      id: "ek-win-standard",
      title: "House Status",
      minimizable: true, closable: true, resizable: true,
      content: '<p style="margin:0 0 8px">A standard floating HUD window. The titlebar' +
               ' carries the dark-ink title and the macOS traffic-light controls; the' +
               ' body rides the one glass plane.</p>' +
               '<p style="margin:0;opacity:.8">Draggable · minimizable · resizable.</p>',
    });
    std.open();
    relocate(std.el, "ek-windows");

    // 2) a MODAL (centered, scrim'd dialog) window
    var modal = window.OrwellWindowKit.create({
      id: "ek-win-modal",
      title: "Confirm Eviction",
      modal: true, minimizable: false,
      content: '<p style="margin:0 0 10px">A <code>modal:true</code> window — a proper' +
               ' dialog (aria-modal, focus-trap, inert background, backdrop scrim).</p>' +
               '<div style="display:flex;gap:8px"><button class="ow-btn ow-btn-secondary">Cancel</button>' +
               '<button class="ow-btn ow-btn-destructive">Evict</button></div>',
    });
    modal.open();
    relocate(modal.el, "ek-windows");

    // 3) a DOCKED window (full-content "docked kit mode" in the control room)
    var docked = window.OrwellWindowKit.create({
      id: "ek-win-docked",
      title: "Control Room",
      dockable: true, defaultDocked: true,
      content: '<p style="margin:0;opacity:.85">A <code>dockable</code> window shown' +
               ' docked — it tucks into the control-room rail (the ⇱ control floats it' +
               ' back out).</p>',
    });
    docked.open();
    relocate(docked.el, "ek-windows");

    dropScrims();

    // KIT-F-07 (2026-07-14 audit): FORCE all three windows focused for the reference
    // still. In the app the kit's focus stack keeps exactly ONE window .ow-focused
    // (colored traffic lights) and the rest render the neutral grey lights BY DESIGN —
    // which left 2 of 3 demo windows permanently grey. The reference shows the colored
    // cluster on every example; the grey unfocused state has its own labeled swatch.
    [std, modal, docked].forEach(function (w) {
      try { w.el.classList.add("ow-focused"); } catch (_) {}
    });
  }

  function buildNotices() {
    var sevs = [
      { sev: "info", title: "Heads up", body: "An informational system notice." },
      { sev: "warn", title: "Connection degraded", body: "Reconnecting to the engine…" },
      { sev: "error", title: "Engine unreachable", body: "The game engine is offline." },
    ];
    sevs.forEach(function (s, i) {
      var n = window.OrwellNoticeKit.create({
        id: "ek-notice-" + s.sev,
        kind: "system-notice",
        severity: s.sev,
        title: s.title,
        dismissible: true,
        persistDismiss: false,
      });
      n.show();
      n.setBody(s.body);
      relocate(n.el, "ek-notices");
    });

    // The TOP SYSTEM BANNER (placement:"top-banner") — a global outage bar at the very
    // top of the viewport. Left in place (NOT relocated) so the still shows the real bar.
    var banner = window.OrwellNoticeKit.create({
      id: "ek-notice-banner",            // the kit's reserved single-banner id
      kind: "system-notice",
      severity: "warn",
      placement: "top-banner",
      title: "Reconnecting to the game engine…",
      dismissible: true,
      persistDismiss: false,
    });
    banner.show();

    // The CHAT-HINT (OrwellChatHint) composition — kind "guide" with the .orwell-chat-hint
    // hook class (exactly what OrwellChatHint.show() builds), relocated into its section.
    var hint = window.OrwellNoticeKit.create({
      id: "ek-chat-hint",
      kind: "guide",
      title: "",
      dismissible: false,
      persistDismiss: false,
    });
    var body = hint.ensure();
    if (hint.el) hint.el.classList.add("orwell-chat-hint");
    var head = hint.el && hint.el.querySelector(".on-head");
    if (head) head.style.display = "none";
    body.innerHTML =
      '<span class="orwell-chat-hint-text">Tip: wrap a line in ((double parens)) to speak' +
      ' out-of-character to the producers.</span>' +
      '<button type="button" class="orwell-chat-hint-dismiss">Got it</button>';
    relocate(hint.el, "ek-chathint");
  }

  // Build one gadget via the kit, fill its body with representative content, relocate it.
  function makeGadget(opts, bodyHtml, actions) {
    var g = window.OrwellGadgetKit.create(opts);
    // mount() falls back to #sidebar/body when there is no rail; _build + relocate instead.
    var el = g._build ? g._build() : g.el;
    (actions || []).forEach(function (a) {
      if (g.addAction) { try { g.addAction(a); } catch (_) {} }
    });
    if (g.body) g.body.innerHTML = bodyHtml;
    relocate(el, "ek-gadget");
    return g;
  }

  // KIT-F-04 (2026-07-14 audit): the House Status swatch's row CSS. The real panel
  // (orwellStatusPanel.js ensurePanel) injects its layout CSS scoped to the literal
  // `#orwell-status` — the old demo mount (`ek-g-status`) never matched it, so the rows
  // rendered run-together ("HOHYou", "NomsTwo houseguests"). The swatch now mounts under
  // the REAL id (nothing else on this page uses it), and because the demo deliberately
  // does NOT load orwellStatusPanel.js (it boots a live /api poller that would hide or
  // overwrite the static swatch), the subset of rules this swatch composes is injected
  // here as a DELIBERATE COPY — under the SAME style-element id the real panel guards
  // on, declarations byte-matched to the panel source (keep in sync;
  // test_0773_element_kit.py pins every copied rule against orwellStatusPanel.js).
  function ensureStatusPanelCssCopy() {
    if (document.getElementById("orwell-status-css")) return;
    var st = document.createElement("style");
    st.id = "orwell-status-css";
    st.textContent = `
        #orwell-status .os-ttl { display: flex; align-items: baseline; gap: .4rem; flex: 1; min-width: 0; flex-wrap: wrap; }
        #orwell-status .os-phase { opacity: .65; font-weight: 400; text-transform: capitalize; }
        #orwell-status .os-row { display: flex; gap: .4rem; }
        #orwell-status .os-row .os-k { color: color-mix(in srgb, var(--fg, #9cdef2) 78%, var(--panel, #111)); min-width: 4.2em; }
        #orwell-status .os-row .os-v { flex: 1; }
        #orwell-status .os-noms { color: var(--red, #e06c75); }
        body.theme-frosted #orwell-status .os-noms { color: #16191f; }
        #orwell-status .os-you { margin: .35rem 0 .1rem; font-weight: 600; }
        #orwell-status .os-you .os-badge {
          display: inline-block; margin-left: .4rem; padding: 0 .4em; border-radius: .5em;
          font-size: .72em; font-weight: 700; letter-spacing: .02em;
          background: var(--accent, var(--red, #e06c75)); color: var(--on-accent, #fff);
        }
        #orwell-status .os-roster-h { opacity: .55; font-size: max(.8em, 11px); margin: .4rem 0 .15rem; }`;
    document.head.appendChild(st);
  }

  function buildGadgets() {
    // ALL the real player-tier gadget KINDS (owner: "all of them there"). Each is the
    // same OrwellGadget .og-card kit, instantiated with the real gadget's title/icon +
    // representative static body (the live ones are driven by engine state — here we
    // show the SHAPE so the kit surface is verifiable without the engine):

    // 1) HOUSE STATUS — the rich status HUD ("The House"); orwellStatusPanel.js. The
    //    real one carries week/phase in the title slot + the ceremony rows + the roster.
    //    KIT-F-04: mounted under the REAL panel id so the panel-scoped row CSS applies;
    //    persistCollapsed:false so the demo swatch NEVER reads or writes the app's own
    //    per-user collapse key for this id (same localStorage origin).
    ensureStatusPanelCssCopy();
    var status = makeGadget(
      { id: "orwell-status", title: "House Status", ariaLabel: "Game status",
        collapsible: true, persistCollapsed: false },
      '<div class="os-ceremony">' +
      '  <div class="os-you">You <span class="os-badge">HOH</span></div>' +
      '  <div class="os-row"><span class="os-k">HOH</span><span class="os-v">You</span></div>' +
      '  <div class="os-row"><span class="os-k">Noms</span><span class="os-v os-noms">Two houseguests</span></div>' +
      '  <div class="os-row"><span class="os-k">Veto</span><span class="os-v">In play</span></div>' +
      '</div>' +
      '<div class="os-roster-h" role="heading" aria-level="3">The House</div>' +
      '<div class="os-roster" style="opacity:.85">11 houseguests remain</div>'
    );
    // the real status panel writes week/phase into the .og-title slot — mirror that.
    try {
      var ts = status.el && status.el.querySelector(".og-title");
      if (ts) {
        ts.classList.add("os-ttl");  // the real panel adds the title-slot layout class
        ts.innerHTML = '<span>Week 4</span> <span class="os-phase">· Veto Ceremony</span>';
      }
    } catch (_) {}

    // 2) YOUR DEALS — orwellDeals.js (🤝)
    makeGadget(
      { id: "ek-g-deals", title: "Your Deals", icon: "🤝", ariaLabel: "Your deals", collapsible: true },
      '<div style="opacity:.9">Final 2 — <strong>active</strong></div>' +
      '<div style="opacity:.7;font-size:.92em;margin-top:2px">Made Week 2 · holding</div>'
    );

    // 3) WHERE YOU ARE — orwellPresence.js (🧭)
    makeGadget(
      { id: "ek-g-presence", title: "Where You Are", icon: "🧭", ariaLabel: "Where you are" },
      '<div><strong>The Kitchen</strong></div>' +
      '<div style="opacity:.78;font-size:.92em;margin-top:2px">Also here: 3 houseguests</div>'
    );

    // 4) NIGHTFALL — orwellNightStatus.js (🌙) — the time-of-day / presence economy gadget
    makeGadget(
      { id: "ek-g-night", title: "Nightfall", icon: "🌙", ariaLabel: "Nightfall" },
      '<div><strong>Late night</strong></div>' +
      '<div style="opacity:.78;font-size:.92em;margin-top:2px">The house is winding down — 4 still awake</div>'
    );

    // 5) CAST — orwellCastPin.js (👥), with the real Open / Un-pin actions
    makeGadget(
      { id: "ek-g-cast", title: "Cast", icon: "👥", role: "group", ariaLabel: "Cast", collapsible: true },
      '<div style="opacity:.85">11 active · 4 jury</div>',
      [
        { label: "Open", title: "Open the full cast window", dataset: { act: "open" }, onClick: function () {} },
        { label: "Un-pin", title: "Un-pin back to a floating window", dataset: { act: "unpin" }, onClick: function () {} },
      ]
    );

    // 6) ALLIANCES — a plain OrwellGadget .og-card (the bare kit shape).
    makeGadget(
      { id: "ek-g-alliances", title: "Alliances", collapsible: true },
      '<p style="margin:0;opacity:.7" class="og-empty">No confirmed alliances yet.</p>',
      [{ label: "Open", onClick: function () {} }]
    );
  }

  // The Decision section composes the kit's .odec/.odec-* classes STATICALLY in the demo
  // markup — the structural CSS lives in orwellDecision.js's ensureStyles() (scoped to the
  // .odec root class), so inject it here. Fail-open: absent kit ⇒ the section renders
  // unstyled rather than breaking the rest of the reference page.
  function buildDecision() {
    try {
      if (window.OrwellDecisionStyles && window.OrwellDecisionStyles.ensureStyles) {
        window.OrwellDecisionStyles.ensureStyles();
      }
    } catch (e) { console.warn("[kit-demo] decision styles failed", e); }
  }

  // Wire the live `.ow-pw-field` example with the kit's canonical toggle helper (#1638, G3).
  function buildPwReveal() {
    try {
      var el = document.getElementById("ek-pw-live");
      if (el && window.OrwellPwReveal && window.OrwellPwReveal.attach) {
        window.OrwellPwReveal.attach(el);
      }
    } catch (e) { console.warn("[kit-demo] pw-reveal wire failed", e); }
  }

  whenReady(function () {
    buildWindows();
    buildNotices();
    buildGadgets();
    buildDecision();
    buildPwReveal();
  });
})();

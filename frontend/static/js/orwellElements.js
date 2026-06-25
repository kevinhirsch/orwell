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

  function buildGadgets() {
    // ALL the real player-tier gadget KINDS (owner: "all of them there"). Each is the
    // same OrwellGadget .og-card kit, instantiated with the real gadget's title/icon +
    // representative static body (the live ones are driven by engine state — here we
    // show the SHAPE so the kit surface is verifiable without the engine):

    // 1) HOUSE STATUS — the rich status HUD ("The House"); orwellStatusPanel.js. The
    //    real one carries week/phase in the title slot + the ceremony rows + the roster.
    var status = makeGadget(
      { id: "ek-g-status", title: "House Status", ariaLabel: "Game status", collapsible: true },
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
      if (ts) ts.innerHTML = '<span>Week 4</span> <span class="os-phase" style="opacity:.7">· Veto Ceremony</span>';
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

  whenReady(function () {
    buildWindows();
    buildNotices();
    buildGadgets();
  });
})();

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

  function buildGadget() {
    var g = window.OrwellGadgetKit.create({
      id: "ek-gadget-demo",
      title: "Alliances",
      collapsible: true,
    });
    // mount() falls back to #sidebar/body when there is no rail; build + relocate instead.
    var el = g._build ? g._build() : g.el;
    var body = g.body;
    if (body) {
      body.innerHTML = '<p style="margin:0 0 6px">A rail gadget card — <code>.og-card</code>' +
        ' with <code>.og-head</code> + <code>.og-body</code>.</p>' +
        '<p style="margin:0;opacity:.7" class="og-empty">No confirmed alliances yet.</p>';
    }
    if (g.addAction) {
      try { g.addAction({ label: "Open", onClick: function () {} }); } catch (_) {}
    }
    relocate(el, "ek-gadget");
  }

  whenReady(function () {
    buildWindows();
    buildNotices();
    buildGadget();
  });
})();

// OrwellNotice — THE in-chat notification/affordance kit (#642). The THIRD DWE kit,
// sibling to the OrwellWindow kit (Lane F, floating window band) and the OrwellGadget
// kit (#640, control-room rail). This one owns the ABOVE-COMPOSER AFFORDANCE ZONE — the
// strip of in-chat affordances that are NOT chat messages (the game guide, narrator-
// proposed decisions, system notices, the Continue prompt). Each was hand-rolled with its
// own anchor/dismiss/animation/persistence; they collided on the same real estate above
// the composer and fought for the slot. The kit OWNS, in one place:
//
//   • CHROME + ANCHOR: ONE consistent stacked container (#orwell-notice-zone) anchored
//     directly above the composer (.chat-input-bar), with the .on-* CSS family. Affordances
//     are CHILDREN of that container — never each minting its own insertBefore(bar) — so
//     several present at once STACK deterministically (priority order) instead of fighting.
//   • KIND/SEVERITY: guide / decision / system-notice / continue — consistent styling +
//     semantics per kind. A `severity` (info / warn / error) tints the strip. Decisions are
//     HARD-STOP affordances: dismissible by the player, but NEVER auto-dismissed.
//   • DISMISS + A11Y: ONE dismiss affordance (the .on-dismiss × at the 44px touch floor),
//     aria-live per kind (assertive for system-notice/decision, polite for guide/continue),
//     reduced-motion-safe mount (rise+fade) / unmount (fade) — all motion stripped under
//     prefers-reduced-motion.
//   • PERSISTENCE + TWO-WINDOW MIRROR (#638): a notice's shown/dismissed state lives in the
//     SAME 0064 layout store under a synthetic id ("notice:<id>"), reusing the per-field LWW
//     merge + the `layout-changed` fan-out — so a dismissal survives a reload, follows the
//     player across devices, and mirrors realtime between two windows (exactly as the window
//     kit owns geometry sync and the gadget kit owns collapse). localStorage stays the
//     per-device offline/seed fallback. `persistDismiss:false` opts a transient notice out
//     (a connection banner should reappear if the problem recurs — it is not "dismissed
//     forever").
//
// BRIGHT LINE: this kit is for AFFORDANCES/NOTIFICATIONS, never narration/messages. Chat
// messages (incl. the in-stream `.msg-system` connection-error bubble and the in-stream
// Continue buttons) stay in the chat stream via the renderer; the reasoning/reply channel
// split is untouched. New ABOVE-COMPOSER affordances MUST compose this kit (the convention
// gate test_on_notice_kit.py pins it — the notice edition of the F-3 window ratchet).
//
// Vault-free by construction: the kit only paints chrome + tracks a shown/dismissed bool —
// it never touches game state. g15: it NEVER dispatches `orwell:gamechanged` (the single
// dispatcher stays in platform.js); it only emits the layout-sync event (an allowed seam).

(function () {
  "use strict";

  // The single stacked container's id + the .on-* family.
  var ZONE_ID = "orwell-notice-zone";
  // The top system-banner host (a SEPARATE anchor for global outage signals — full-width,
  // position:fixed at the top of the viewport, NOT in the above-composer stack). Both
  // placements compose the SAME base (chrome/dismiss/a11y/animation/sync); only the anchor +
  // a few placement rules differ (#642 owner add-on).
  var BANNER_ID = "orwell-notice-banner";

  // Kind → ordering weight (lower mounts ABOVE, higher mounts at the BOTTOM, nearest the
  // composer). The decision card is the most action-demanding affordance, so it sits CLOSEST
  // to the composer (highest weight); the guide is the most ambient, so it floats to the top.
  // Several affordances present at once therefore stack in a DETERMINISTIC order, never
  // fighting for one slot. (Same kind ⇒ insertion order within the band.)
  var KIND_ORDER = { guide: 10, "system-notice": 20, continue: 30, decision: 40 };

  // aria-live per kind: the decision + a broken-engine system notice are consequential and
  // get an assertive announcement; the ambient guide + the Continue nudge are polite.
  var KIND_LIVE = {
    guide: "polite",
    "system-notice": "assertive",
    continue: "polite",
    decision: "assertive",
  };

  var REDUCED = function () {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── the one CSS family ──────────────────────────────────────────────────────
  // Theme-token driven (the house themes 0052 + the frost layer paint it for free), with
  // literal fallbacks for before style.css loads — mirroring orwellWindow.js's ensureCss()
  // and orwellGadget.js's. Built by STRING CONCATENATION (never a backtick template) so a
  // stray backtick in a comment can't blow up the template literal (a prior PR's footgun).
  function ensureCss() {
    if (document.getElementById("on-notice-css")) return;
    var st = document.createElement("style");
    st.id = "on-notice-css";
    st.textContent =
      // The stacked container: a vertical column of notices anchored above the composer.
      // gap separates stacked affordances; it carries no chrome of its own (the cards do).
      "#" + ZONE_ID + " {" +
      "  display: flex; flex-direction: column; gap: var(--space-2, .45rem);" +
      "  margin: 0 auto var(--space-2, .45rem); width: 100%; max-width: 760px;" +
      "  pointer-events: none; }" +   // the column is inert; each card re-enables pointer events
      "#" + ZONE_ID + ":empty { display: none; margin: 0; }" +
      // A single notice card — the shared above-composer chrome. The visual language matches
      // the existing hand-rolled cards (panel bg, accent border, 12px radius, .85rem mono-ish
      // body) so a migrated affordance renders close to identically.
      ".on-card {" +
      "  position: relative; pointer-events: auto;" +
      "  border-radius: 12px; padding: .7rem .85rem;" +
      "  background: var(--panel, #111); color: var(--fg, #9cdef2);" +
      "  border: 1px solid var(--border, #355a66);" +
      // Shared type system (#709): sans family, body PRESET; the title row uses the title preset.
      "  font-family: var(--ow-ui-font); font-size: var(--ow-fs-body, .875rem); line-height: 1.5;" +
      "  box-shadow: var(--win-shadow, 0 8px 32px rgba(0,0,0,.45)); }" +
      // The header row: icon + title + the dismiss affordance.
      ".on-card .on-head { display: flex; align-items: baseline; gap: .5rem; }" +
      ".on-card .on-icon { flex: 0 0 auto; opacity: .9; }" +
      ".on-card .on-title { flex: 1 1 auto; min-width: 0; font-size: var(--ow-fs-title, .875rem); font-weight: var(--ow-fw-semibold, 600); letter-spacing: -.01em; }" +
      ".on-card .on-body { margin-top: .35rem; }" +
      ".on-card .on-body:empty { display: none; }" +
      // The ONE dismiss affordance — the 44px touch floor (WCAG 2.5.5), positioned in the
      // top-right corner but kept LAST in DOM/tab order (the content comes first). It reuses
      // the look of the window kit's .ow-dismiss but is namespaced to the notice family.
      ".on-card .on-dismiss {" +
      "  position: absolute; top: .15rem; right: .2rem;" +
      "  min-width: 44px; min-height: 44px; padding: 0;" +
      "  display: inline-flex; align-items: center; justify-content: center;" +
      "  border: none; background: none; color: inherit; cursor: pointer;" +
      "  opacity: .65; border-radius: 8px; font: inherit; font-size: 1rem; }" +
      ".on-card .on-dismiss:hover, .on-card .on-dismiss:focus-visible {" +
      "  opacity: 1; background: rgba(255,255,255,.08); }" +
      // Make room for the corner × so a long title never slides under it.
      ".on-card .on-head { padding-right: 1.6rem; }" +
      // ── kind / severity skins ─────────────────────────────────────────────────
      // guide: the ambient, dashed, low-key orientation card (the premiere-tutorial look).
      ".on-card.on-guide {" +
      "  background: color-mix(in srgb, var(--fg, #9cdef2) 5%, transparent);" +
      "  border-style: dashed; border-color: color-mix(in srgb, var(--fg, #9cdef2) 30%, transparent);" +
      "  box-shadow: none; }" +
      // decision: the binding-decision card lifts off the stream (the accent border the
      // decision card already used). The risk skin for high-stakes kinds is layered by the
      // decision consumer via its own .odec-risk rules; the kit provides the base lift.
      ".on-card.on-decision { border-color: var(--accent, var(--red, #e06c75)); }" +
      // system-notice: an OOC operator signal. The severity tints carry the meaning; the icon
      // + title carry it for colorblind / SR users (color is never the only signal).
      ".on-card.on-system-notice { border-color: color-mix(in srgb, var(--fg, #9cdef2) 28%, transparent); }" +
      ".on-card.on-sev-warn {" +
      "  border-color: var(--color-warning, #f0ad4e);" +
      "  background: linear-gradient(0deg, color-mix(in srgb, var(--color-warning, #f0ad4e) 8%, transparent), color-mix(in srgb, var(--color-warning, #f0ad4e) 8%, transparent)), var(--panel, #111); }" +
      ".on-card.on-sev-error {" +
      "  border-color: var(--color-error, var(--red, #e06c75));" +
      "  background: linear-gradient(0deg, color-mix(in srgb, var(--color-error, var(--red, #e06c75)) 10%, transparent), color-mix(in srgb, var(--color-error, var(--red, #e06c75)) 10%, transparent)), var(--panel, #111); }" +
      // continue: a quiet nudge to keep going.
      ".on-card.on-continue { border-color: color-mix(in srgb, var(--accent, #e06c75) 50%, var(--border, #355a66)); }" +
      // ── motion (reduced-motion stripped) ──────────────────────────────────────
      // mount: a gentle rise+fade; unmount: a fade. Both DRIVEN keyframes so the family
      // names the two motions. prefers-reduced-motion strips ALL of it.
      "@keyframes on-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }" +
      "@keyframes on-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(4px); } }" +
      ".on-card.on-anim-in { animation: on-in .22s cubic-bezier(0.22,0.61,0.36,1) both; }" +
      ".on-card.on-anim-out { animation: on-out .2s ease both; }" +
      // ── top system-banner placement (#642 owner add-on) ───────────────────────
      // A global outage signal: full-width, fixed at the very top of the viewport, above
      // everything. Same .on-card chrome/dismiss/a11y/animation, different anchor. The host is
      // a thin fixed bar; the card inside spans it. The body padding-top compensation (so the
      // banner never occludes the chat top) is set by the JS via --on-banner-inset.
      "#" + BANNER_ID + " {" +
      "  position: fixed; top: 0; left: 0; right: 0; z-index: 11000;" +
      "  display: flex; flex-direction: column; pointer-events: none; }" +
      "#" + BANNER_ID + ":empty { display: none; }" +
      // A banner-placed card stretches edge-to-edge, squares its corners, and centres its row.
      "#" + BANNER_ID + " .on-card {" +
      "  border-radius: 0; border-left: none; border-right: none; border-top: none;" +
      "  box-shadow: 0 2px 10px rgba(0,0,0,.4); text-align: center;" +
      "  padding: .5rem 2.2rem .5rem .8rem; }" +   // room for the corner × on the right
      "#" + BANNER_ID + " .on-card .on-head { padding-right: 0; justify-content: center; align-items: center; }" +
      // The banner's slide-down entrance (reduced-motion stripped with the rest).
      "@keyframes on-banner-in { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: none; } }" +
      ".on-card.on-anim-banner-in { animation: on-banner-in .22s ease-out both; }" +
      "@media (prefers-reduced-motion: reduce) {" +
      "  .on-card.on-anim-in, .on-card.on-anim-out, .on-card.on-anim-banner-in { animation: none; } }" +
      // ── LIQUID GLASS (body.theme-frosted) ──────────────────────────────────────
      // Under the glass theme the notice card reads as the SAME ONE LIGHT GLASS as the
      // windows/sidebar — the kube music-player light fill. style.css now paints that light
      // glass for `body.theme-frosted .on-card` on BOTH tiers (Full = SVG refraction, Frosted
      // = CSS blur). Owner ruling: "there should be no old dark glass at all"; "the old dark
      // glass shouldn't be the frosted fallback". So the inline DARK-veil glass that used to
      // live here (and made the FROSTED fallback dark) is RETIRED — it must NOT re-introduce a
      // dark fill on top of the style.css light glass.
      //
      // The ONLY thing the static light-glass rule does NOT beat are the kit's OWN, more-
      // specific SOLID-bg skins (.on-sev-warn / .on-sev-error layer a solid var(--panel) wash;
      // .on-guide layers a faint solid wash + box-shadow:none). So we NEUTRALIZE just those
      // skins' solid backgrounds under theme-frosted (let the style.css light glass show
      // through); the severity/kind MEANING stays in the BORDER only (no accent-hued TEXT, no
      // solid fill). Applies to BOTH tiers (no :not(.glass-full) scope — the fill is uniform).
      // Wrapped in prefers-reduced-transparency:no-preference so these runtime-injected rules
      // (appended AFTER the linked stylesheet) NEVER override style.css's a11y OPAQUE fallback
      // under prefers-reduced-transparency:reduce.
      "@media (prefers-reduced-transparency: no-preference) {" +
      "body.theme-frosted .on-card.on-guide," +
      "body.theme-frosted .on-card.on-sev-warn," +
      "body.theme-frosted .on-card.on-sev-error {" +
      // Replace the skins' SOLID --panel fill with the ONE LIGHT GLASS (the kube fill, the same
      // tokens style.css paints on .on-card) so the skinned cards match the rest of the kit — NO
      // dark veil. The severity/kind MEANING stays in the BORDER (set by the skins above).
      "  background-color: var(--ow-glass-light-color) !important;" +
      "  background-image: var(--ow-glass-light-fill) !important; }" +
      // #725 SMUDGE FIX: post-#725 the notice card carries DARK ink on the LIGHT glass (style.css
      // dark-ink chrome list). The dark --ow-glass-text-shadow under dark ink reads as a dirty drop-
      // shadow SMUDGE; the correct legibility halo on dark-on-light is a LIGHT halo (matches the
      // style.css .on-card rule). This runtime rule is appended AFTER the stylesheet, so it must
      // itself carry the light halo or it re-introduces the smudge. (The dark shadow stays only on
      // genuinely light-on-dark text — chat bubbles, dock chips — which the notice card is NOT.)
      "body.theme-frosted .on-card { text-shadow: 0 1px 1px rgba(255,255,255,0.5); } }";
    document.head.appendChild(st);
  }

  // ── per-notice shown/dismissed state, synced (#638) ─────────────────────────
  // Mirrors the gadget kit's collapse-sync + the premiere-popup dismiss precedent: the SYNCED
  // value (the 0064 layout store, LWW, mirrored via `layout-changed`) is the source of truth;
  // localStorage is the per-device offline/seed fallback. The synthetic window id is
  // "notice:<id>" (windows use the bare id, gadgets "gadget:<id>", popups "popup:<id>").
  function syncId(id) { return "notice:" + id; }
  function dismissKey(id) {
    return "orwell-notice-dismissed:" + id + ":" + ((document.body && document.body.dataset.user) || "");
  }
  function loadDismissed(id) {
    try { return localStorage.getItem(dismissKey(id)) === "1"; } catch (_) { return false; }
  }
  function saveDismissed(id, applyingRemote) {
    try { localStorage.setItem(dismissKey(id), "1"); } catch (_) {}
    // Emit through the SAME capture event the window + gadget kits use — no parallel sync.
    // Suppressed while APPLYING a remote change (no echo loop). orwellLayoutSync debounces a
    // PATCH /api/orwell/layout; absent module ⇒ localStorage-only, fail-open.
    if (applyingRemote) return;
    try {
      window.dispatchEvent(new CustomEvent("orwell:window-layout",
        { detail: { id: syncId(id), state: { dismissed: true } } }));
    } catch (_) {}
  }

  // A live registry of mounted kit notices by id, so a synced dismiss arriving from the seed
  // (initial GET /layout) or a peer window (`layout-changed`) can reach the notice.
  var _byId = {};
  function _onSyncedLayout(e) {
    var d = e && e.detail;
    if (!d || !d.windowId || !d.state) return;
    if (String(d.windowId).indexOf("notice:") !== 0) return;
    var id = String(d.windowId).slice("notice:".length);
    if (d.state.dismissed === true) {
      // Remember it even if the notice isn't mounted right now, so a later show() honors it.
      try { localStorage.setItem(dismissKey(id), "1"); } catch (_) {}
      var n = _byId[id];
      if (n) n._applyRemoteDismiss();
    }
  }
  window.addEventListener("orwell:layout-seed", _onSyncedLayout);     // initial GET /layout
  window.addEventListener("orwell:layout-changed", _onSyncedLayout);  // a peer window / device

  // The single stacked container, created lazily above the composer. Fallback chain
  // (.chat-input-bar → #chat-bar → body) so a degraded/headless DOM still works.
  function ensureZone() {
    var zone = document.getElementById(ZONE_ID);
    if (zone) return zone;
    ensureCss();
    zone = document.createElement("div");
    zone.id = ZONE_ID;
    // The zone itself is a passive container; each card owns its own role/aria-live.
    var bar = document.querySelector(".chat-input-bar") || document.getElementById("chat-bar");
    if (bar && bar.parentNode) bar.parentNode.insertBefore(zone, bar);
    else document.body.appendChild(zone);
    return zone;
  }

  // The top system-banner host (a fixed full-width bar at the top of the viewport). Created
  // lazily on body. A SEPARATE anchor from the above-composer zone — same base chrome.
  function ensureBannerHost() {
    var host = document.getElementById(BANNER_ID);
    if (host) return host;
    ensureCss();
    host = document.createElement("div");
    host.id = BANNER_ID;
    document.body.appendChild(host);
    return host;
  }

  // Body-inset compensation: a top banner is position:fixed, so without compensation it occludes
  // the top of the chat (worst exactly when connectivity is degraded). Reserve its height as body
  // padding-top while shown, release it when gone. A CSS var carries the value (a reduced-motion-
  // safe transition can hook it later). Mirrors the old orwellEngineStatus --oes-inset behaviour.
  function setBannerInset(host) {
    try {
      var h = (host && host.offsetHeight) || 0;
      document.body.style.setProperty("--on-banner-inset", h + "px");
      document.body.style.paddingTop = h + "px";
      _emitBannerInset(h);
    } catch (_) {}
  }
  function clearBannerInset() {
    try {
      document.body.style.removeProperty("--on-banner-inset");
      document.body.style.paddingTop = "";
      _emitBannerInset(0);
    } catch (_) {}
  }
  // #758: a top banner is position:fixed, so the body padding-top above only re-flows the
  // IN-FLOW content (the chat column + the relative-flow desktop sidebar/rail). The FIXED-chrome
  // layer (kit windows + the slot engine, the mobile rail/sidebar drawers, the top corner
  // controls) must ALSO reserve the banner's height and COMPRESS below it — they read
  // --on-banner-inset, but a CSS-var change fires no event, so broadcast a tiny window signal on
  // every set/clear. The window kit's slot/clamp math + the gadget rail listen for it and re-place
  // (resize already covers the height-change path; this covers banner show/hide and copy changes).
  function _emitBannerInset(h) {
    try {
      window.dispatchEvent(new CustomEvent("orwell:banner-inset", { detail: { inset: h } }));
    } catch (_) {}
  }

  // Insert `card` into the zone at the DETERMINISTIC position for its kind weight (lower
  // weight = higher up; equal weight = insertion order). One stacking authority — no
  // affordance picks its own neighbour.
  function insertByOrder(zone, card, weight) {
    card.dataset.onOrder = String(weight);
    var children = zone.children;
    for (var i = 0; i < children.length; i++) {
      var w = parseInt(children[i].dataset.onOrder || "0", 10);
      if (weight < w) { zone.insertBefore(card, children[i]); return; }
    }
    zone.appendChild(card);
  }

  function OrwellNotice(opts) {
    if (!(this instanceof OrwellNotice)) return new OrwellNotice(opts);
    this.o = Object.assign({
      // id        — stable per-notice id (the element id + the "notice:<id>" sync id).
      // kind       — guide | decision | system-notice | continue (drives skin/order/aria-live).
      // title      — the heading text.
      // icon       — a decorative glyph before the title (aria-hidden).
      // severity   — info | warn | error (an extra tint on system-notice; default info).
      // role       — the card's ARIA role (default per kind: 'note' for guide/continue,
      //              'form' for decision, 'alert' for system-notice).
      // dismissible (default true) — render the × dismiss affordance.
      // persistDismiss (default true) — persist + sync the dismissal (notice:<id>, #638). A
      //              transient notice (a connection banner) sets false so it reappears if the
      //              problem recurs and never writes a "dismissed forever" bit.
      // onDismiss(reason) — fired after a dismiss ('user' | 'remote' | 'api').
      // placement — "above-composer" (default, the stacked zone above the composer) or
      //              "top-banner" (a full-width fixed bar at the top of the viewport, for a
      //              GLOBAL outage signal — same base chrome/dismiss/a11y/anim/sync, different
      //              anchor; reserves body padding-top so it never occludes the chat). #642.
      kind: "guide",
      severity: "info",
      dismissible: true,
      persistDismiss: true,
      placement: "above-composer",
      onDismiss: null,
    }, opts || {});
    // id is required; title is optional (a hint is just a text line, a banner sets it via update()).
    if (!this.o.id) throw new Error("OrwellNotice needs an id");
    if (this.o.title == null) this.o.title = "";
    this.el = null;
    this.head = null;
    this.body = null;
    this._applyingRemote = false;
  }

  OrwellNotice.prototype._roleFor = function () {
    if (this.o.role) return this.o.role;
    if (this.o.kind === "decision") return "form";
    if (this.o.kind === "system-notice") return "alert";
    return "note";
  };

  OrwellNotice.prototype._build = function () {
    ensureCss();
    var kind = this.o.kind;
    var el = document.createElement("section");
    el.id = this.o.id;
    el.className = "on-card on-" + kind +
      (this.o.kind === "system-notice" && this.o.severity ? " on-sev-" + this.o.severity : "");
    el.setAttribute("data-on-notice", "");
    el.setAttribute("data-on-kind", kind);
    el.setAttribute("role", this._roleFor());
    if (this.o.title) el.setAttribute("aria-label", this.o.title);
    // aria-live per kind — a consequential notice announces assertively; an ambient one politely.
    var live = KIND_LIVE[kind] || "polite";
    el.setAttribute("aria-live", live);

    var head = document.createElement("div");
    head.className = "on-head";
    if (this.o.icon) {
      var ic = document.createElement("span");
      ic.className = "on-icon"; ic.setAttribute("aria-hidden", "true");
      ic.textContent = this.o.icon;
      head.appendChild(ic);
    }
    // A titled notice gets a heading; a title-less one (a hint) just keeps an empty head row
    // (its content lives in the body). update() can fill the title later (the banner pattern).
    var title = document.createElement("span");
    title.className = "on-title";
    title.setAttribute("role", "heading");
    title.setAttribute("aria-level", "3");
    title.textContent = this.o.title;
    head.appendChild(title);

    var body = document.createElement("div");
    body.className = "on-body";

    el.appendChild(head);
    el.appendChild(body);

    // The ONE dismiss affordance, appended LAST (so it is the final tab stop — content first,
    // WCAG 2.4.3). CSS positions it back into the corner. Decisions are HARD-STOP: still
    // dismissible (the player may decide in conversation instead), but NEVER auto-dismissed.
    if (this.o.dismissible) {
      var x = document.createElement("button");
      x.type = "button"; x.className = "on-dismiss";
      x.textContent = "×";
      x.title = "Dismiss";
      x.setAttribute("aria-label", "Dismiss — " + this.o.title);
      var self = this;
      x.addEventListener("click", function () { self.dismiss("user"); });
      el.appendChild(x);
      this.dismissBtn = x;
    }

    this.el = el; this.head = head; this.body = body;
    return el;
  };

  OrwellNotice.prototype._isBanner = function () { return this.o.placement === "top-banner"; };

  // Mount the notice into its anchor (the stacked above-composer zone, or the top banner host).
  // Honors a persisted/synced dismissal: a notice the player dismissed before (and that persists)
  // won't re-mount. Idempotent.
  OrwellNotice.prototype.show = function () {
    if (this.o.persistDismiss && loadDismissed(this.o.id)) return null;
    if (this.el && this.el.isConnected) return this.el;
    var el = this.el || this._build();
    var self = this;
    if (this._isBanner()) {
      var host = ensureBannerHost();
      host.appendChild(el);
      _byId[this.o.id] = this;
      if (!REDUCED()) {
        el.classList.add("on-anim-banner-in");
        el.addEventListener("animationend", function handler() {
          el.classList.remove("on-anim-banner-in");
          el.removeEventListener("animationend", handler);
        }, { once: true });
      }
      setBannerInset(host);   // reserve its height so it never occludes the chat top
      return el;
    }
    var zone = ensureZone();
    insertByOrder(zone, el, KIND_ORDER[this.o.kind] != null ? KIND_ORDER[this.o.kind] : 50);
    _byId[this.o.id] = this;
    if (!REDUCED()) {
      el.classList.add("on-anim-in");
      el.addEventListener("animationend", function handler() {
        el.classList.remove("on-anim-in");
        el.removeEventListener("animationend", handler);
      }, { once: true });
    }
    return el;
  };

  // Ensure built + mounted; return the .on-body for the consumer to fill with its own content.
  OrwellNotice.prototype.ensure = function () {
    this.show();
    return this.body;
  };

  // Set the body content (string ⇒ innerHTML for trusted author markup; Node ⇒ append).
  OrwellNotice.prototype.setBody = function (content) {
    if (!this.body) this._build();
    if (content instanceof Node) { this.body.innerHTML = ""; this.body.appendChild(content); }
    else this.body.innerHTML = content == null ? "" : String(content);
    return this;
  };

  OrwellNotice.prototype.isShown = function () {
    return !!(this.el && this.el.isConnected);
  };

  // Re-skin a live notice in place (title / severity / body) without a remount — used by a
  // long-lived banner that transitions between states (down → reconnecting → holding). Keeps
  // the same element (no flicker), updates the severity tint + aria-label, and re-measures the
  // body inset for a banner (its height may change with the copy). #642.
  OrwellNotice.prototype.update = function (patch) {
    patch = patch || {};
    if (!this.el) this._build();
    if (patch.severity != null && this.o.kind === "system-notice") {
      this.el.classList.remove("on-sev-info", "on-sev-warn", "on-sev-error");
      this.o.severity = patch.severity;
      this.el.classList.add("on-sev-" + patch.severity);
    }
    if (patch.title != null) {
      this.o.title = patch.title;
      var t = this.el.querySelector(".on-title");
      if (t) t.textContent = patch.title;
      this.el.setAttribute("aria-label", patch.title);
      if (this.dismissBtn) this.dismissBtn.setAttribute("aria-label", "Dismiss — " + patch.title);
    }
    if (patch.icon != null) {
      var ic = this.el.querySelector(".on-icon");
      if (ic) ic.textContent = patch.icon;
    }
    if (patch.body != null) this.setBody(patch.body);
    if (this._isBanner() && this.el.isConnected) {
      var host = document.getElementById(BANNER_ID);
      if (host) setBannerInset(host);
    }
    return this;
  };

  // Remove the notice from the zone WITHOUT persisting a dismissal (a content gate closing it,
  // e.g. the premiere week ending). reduced-motion-safe fade-out.
  OrwellNotice.prototype.hide = function () {
    var el = this.el;
    if (!el || !el.isConnected) { if (this.el === el) this.el = null; return; }
    var self = this;
    var banner = this._isBanner();
    var done = function () {
      if (el.isConnected) el.remove();
      delete _byId[self.o.id];
      // Release the reserved top-banner space once the banner is gone (no other banner card up).
      if (banner) {
        var host = document.getElementById(BANNER_ID);
        if (!host || !host.children.length) clearBannerInset();
      }
    };
    if (REDUCED()) { done(); return; }
    el.classList.add("on-anim-out");
    el.addEventListener("animationend", done, { once: true });
    setTimeout(done, 260);  // belt: fire even if animationend is missed
  };

  // Dismiss: hide AND (when persisting) record + sync the dismissal so it survives a reload,
  // crosses devices, and mirrors between two windows (#638). reason ∈ {'user','remote','api'}.
  OrwellNotice.prototype.dismiss = function (reason) {
    if (this.o.persistDismiss) saveDismissed(this.o.id, this._applyingRemote);
    this.hide();
    if (typeof this.o.onDismiss === "function") {
      try { this.o.onDismiss(reason || "user"); } catch (_) {}
    }
  };

  // Apply a dismiss arriving from another device / window (or the seed). Sets _applyingRemote
  // so the resulting state change doesn't re-emit (no echo loop) — but DOES land in localStorage.
  OrwellNotice.prototype._applyRemoteDismiss = function () {
    this._applyingRemote = true;
    try { this.dismiss("remote"); } finally { this._applyingRemote = false; }
  };

  // The seam every consumer + the convention gate use (mirrors window.OrwellWindowKit /
  // window.OrwellGadgetKit).
  window.OrwellNoticeKit = {
    create: function (opts) { return new OrwellNotice(opts); },
    esc: esc,
    // expose the zone ensurer for consumers that need the anchor directly (rare).
    ensureZone: ensureZone,
  };
  window.OrwellNotice = OrwellNotice;
})();

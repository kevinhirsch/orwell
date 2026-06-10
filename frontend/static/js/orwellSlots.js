// Orwell anchor slots — floating panels position by SLOT, never by coordinate
// (E91/S11; the Stream-S mechanism, part 2). One registry owns where game
// panels sit: each slot stacks its panels by MEASURED height (top slots stack
// down, bottom slots stack up), with safe-area insets, so no panel can encode
// assumptions about another's size — the D2 collision rule becomes structural.
//
// Drag (where a panel allows it) persists an OFFSET-FROM-SLOT, clamped to the
// viewport at restore (S11: a position saved at 2560px can't strand the panel
// off-screen at 1366px) and keyed per user+game (E71). On narrow viewports the
// slot engine stands down — the panels' shared sheet rules own the layout.
//
// E97 rides here too: one animation contract for every registered panel —
// fade+scale on open, the reverse on close — honoring prefers-reduced-motion.
(function () {
  "use strict";

  const NARROW = window.matchMedia ? window.matchMedia("(max-width: 768px)") : { matches: false, addEventListener() {} };
  const REDUCED = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const GAP = 10;
  const TOP_BASE = 52;     // below the app header
  const BOTTOM_BASE = 12;  // above the composer's inset

  // slot → [{ el, key, draggable }]
  const slots = { "top-right": [], "top-left": [], "bottom-center": [], "bottom-right": [] };
  let _user = "";
  try { _user = (document.body && document.body.dataset.user) || ""; } catch (_) {}

  function offsetKey(key) { return "orwell-slot-offset:" + key + ":" + _user; }

  function loadOffset(key) {
    try {
      const o = JSON.parse(localStorage.getItem(offsetKey(key)) || "null");
      if (o && Number.isFinite(o.dx) && Number.isFinite(o.dy)) return o;
    } catch (_) {}
    return null;
  }
  function saveOffset(key, dx, dy) {
    try { localStorage.setItem(offsetKey(key), JSON.stringify({ dx, dy })); } catch (_) {}
  }

  function visible(el) {
    return el.isConnected && el.style.display !== "none" && el.offsetParent !== null
      || (el.isConnected && getComputedStyle(el).position === "fixed" && getComputedStyle(el).display !== "none");
  }

  // Stack one slot: measured heights, gap, safe-area; then apply each panel's
  // persisted drag offset CLAMPED so the panel stays fully on-screen.
  function restackSlot(name) {
    if (NARROW.matches) return; // sheets own narrow layouts
    const list = slots[name];
    const safeT = TOP_BASE, safeB = BOTTOM_BASE;
    let cursor = name.startsWith("top") ? safeT : safeB;
    for (const entry of list) {
      const el = entry.el;
      if (!visible(el)) continue;
      const h = el.offsetHeight || 0;
      const w = el.offsetWidth || 0;
      let top = null, bottom = null;
      if (name.startsWith("top")) { top = cursor; cursor += h + GAP; }
      else { bottom = cursor; cursor += h + GAP; }

      // base position (the slot's anchor)
      el.style.position = "fixed";
      el.style.top = top !== null ? top + "px" : "auto";
      el.style.bottom = bottom !== null ? bottom + "px" : "auto";
      if (name.endsWith("right")) { el.style.right = "14px"; el.style.left = "auto"; }
      else if (name.endsWith("left")) { el.style.left = "14px"; el.style.right = "auto"; }
      else { el.style.left = "50%"; el.style.right = "auto"; el.style.transform = "translateX(-50%)"; }

      // the persisted drag offset, clamped to the viewport (S11/E91)
      const off = entry.key ? loadOffset(entry.key) : null;
      if (off && (off.dx || off.dy)) {
        const r = el.getBoundingClientRect();
        const left = Math.max(4, Math.min(window.innerWidth - r.width - 4, r.left + off.dx));
        const topPx = Math.max(4, Math.min(window.innerHeight - Math.min(r.height, 200) - 4, r.top + off.dy));
        el.style.left = left + "px";
        el.style.top = topPx + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.transform = "none";
      }
    }
  }

  function restackAll() { for (const name of Object.keys(slots)) restackSlot(name); }

  // E97: the shared open/close animation — visibility flips animate; reduced
  // motion disables (the class is inert under the media query in tokens css).
  function animateIn(el) {
    if (REDUCED.matches) return;
    el.classList.remove("orwell-anim-in");
    void el.offsetWidth; // restart
    el.classList.add("orwell-anim-in");
  }

  function register(el, slotName, opts) {
    const o = opts || {};
    if (!slots[slotName]) slotName = "top-right";
    slots[slotName].push({ el, key: o.key || null, draggable: !!o.draggable });
    el.classList.add("orwell-slotted");
    // Re-stack whenever this panel shows/hides or resizes.
    try {
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.attributeName === "style") {
            if (el.style.display !== "none") animateIn(el);
            restackAll();
            return;
          }
        }
      }).observe(el, { attributes: true, attributeFilter: ["style"] });
    } catch (_) {}
    try { new ResizeObserver(() => restackSlot(slotName)).observe(el); } catch (_) {}
    restackSlot(slotName);
    return {
      /** Record a drag-end as an offset from the slot base (never while hidden). */
      saveDragOffset(rect) {
        if (!o.key || !visible(el)) return;
        // Re-derive the base by restacking with no offset, then diff.
        try { localStorage.removeItem(offsetKey(o.key)); } catch (_) {}
        restackSlot(slotName);
        const base = el.getBoundingClientRect();
        saveOffset(o.key, rect.left - base.left, rect.top - base.top);
        restackSlot(slotName);
      },
      restack() { restackSlot(slotName); },
    };
  }

  window.addEventListener("resize", restackAll);
  NARROW.addEventListener("change", () => {
    if (NARROW.matches) {
      // hand the layout back to the sheet rules
      for (const list of Object.values(slots)) for (const { el } of list) {
        el.style.top = ""; el.style.bottom = ""; el.style.left = ""; el.style.right = ""; el.style.transform = "";
      }
    } else restackAll();
  });

  window.OrwellSlots = { register, restackAll };
})();

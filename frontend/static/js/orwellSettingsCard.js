// OrwellSettingsCard — THE settings-card kit (#658, part of the #660 kit epic).
//
// ONE reusable primitive for a Settings section: a card with consistent chrome + a header
// (icon + title) + a body — so every Settings section composes ONE source of truth for
// spacing / heading / chrome instead of copy-pasting, per section,
//     <div class="admin-card" style="padding-bottom:6px"><h2><svg…/>Title</h2>…</div>
// (the drift #658 targets: bespoke card markup, hand-authored heading chrome, and repeated
// inline `style=` padding leaks). Sibling to OrwellWindow / OrwellGadget / OrwellNotice; the
// seam every consumer + the convention gate use is `window.OrwellSettingsCardKit`.
//
// Two adoption modes:
//   create(opts)    — build a FRESH card element from the primitive (programmatic sections).
//   upgrade(el)     — migrate an EXISTING static `.admin-card` onto the primitive IN PLACE:
//                     KEEP `.admin-card` (so existing `.closest('.admin-card')` / the settings
//                     peek-opacity pass / the empty-admin-tab auto-hide still work), ADD
//                     `.osc-card`, lift the leading heading into `.osc-head` / `.osc-title`
//                     (its leading <svg>/<img> → `.osc-icon`), and wrap the remaining children
//                     into `.osc-body`. Content nodes — with their ids / data-attrs / event
//                     listeners — are PRESERVED; only re-parented.
//   upgradePanel(p) — upgrade every DIRECT-child `.admin-card` of a panel; returns the count.
//
// Fail-open + idempotent: no kit ⇒ callers keep the raw `.admin-card`; re-upgrading a card
// (already `.osc-card`) is a no-op. Vault-free: pure presentation chrome — no game state — so it
// never mints `orwell:gamechanged` (the g15 single-dispatcher rule stays honored).
(function () {
  'use strict';

  var CARD_CLASS = 'osc-card';
  var HEAD_CLASS = 'osc-head';
  var TITLE_CLASS = 'osc-title';
  var ICON_CLASS = 'osc-icon';
  var BODY_CLASS = 'osc-body';

  function _isEl(x) { return !!x && x.nodeType === 1; }

  function _isHeading(node) {
    return _isEl(node) && /^H[2-5]$/.test(node.tagName);
  }

  // Tag the leading <svg>/<img> inside a heading as the card icon so the CSS can size + space
  // it consistently (idempotent — a re-tag is harmless).
  function _tagIcon(heading) {
    var first = heading.firstElementChild;
    if (first) {
      var t = (first.tagName || '').toUpperCase();
      if (t === 'SVG' || t === 'IMG') first.classList.add(ICON_CLASS);
    }
  }

  // create({ id?, title, titleHtml?, icon?, admin?, dense?, danger?, bodyHtml?, bodyEl? }) -> card
  //   Builds the canonical structure directly:
  //     <section class="osc-card"[ id]>
  //       <header class="osc-head">[<span class="osc-icon">…svg…</span>]<h2 class="osc-title">…</h2></header>
  //       <div class="osc-body">…</div>
  //     </section>
  //   `icon` is trusted, static inline-SVG markup (the same hand-authored icons the panels use).
  //   `admin:true` also stamps `.admin-card` so the peek/empty-tab logic keeps seeing the section.
  //   The returned element exposes `.oscBody` (the body node) for appending content.
  function create(opts) {
    opts = opts || {};
    var card = document.createElement('section');
    card.className = CARD_CLASS;
    if (opts.admin) card.classList.add('admin-card');
    if (opts.dense) card.classList.add('osc-dense');
    if (opts.danger) card.classList.add('osc-danger');
    if (opts.id) card.id = opts.id;

    var head = document.createElement('header');
    head.className = HEAD_CLASS;
    if (opts.icon) {
      var iconWrap = document.createElement('span');
      iconWrap.className = ICON_CLASS;
      iconWrap.setAttribute('aria-hidden', 'true');
      iconWrap.innerHTML = opts.icon;
      head.appendChild(iconWrap);
    }
    var h = document.createElement('h2');
    h.className = TITLE_CLASS;
    if (typeof opts.titleHtml === 'string') h.innerHTML = opts.titleHtml;
    else h.textContent = opts.title || '';
    head.appendChild(h);
    card.appendChild(head);

    var body = document.createElement('div');
    body.className = BODY_CLASS;
    if (_isEl(opts.bodyEl)) body.appendChild(opts.bodyEl);
    else if (typeof opts.bodyHtml === 'string') body.innerHTML = opts.bodyHtml;
    card.appendChild(body);

    card.oscBody = body;
    return card;
  }

  // upgrade(el, opts?) -> el — migrate one existing card element onto the primitive in place.
  function upgrade(el, opts) {
    if (!_isEl(el)) return el;
    if (el.classList.contains(CARD_CLASS)) return el; // idempotent — already composed
    opts = opts || {};

    el.classList.add(CARD_CLASS);
    if (opts.dense) el.classList.add('osc-dense');
    if (opts.danger || el.classList.contains('admin-danger-card')) el.classList.add('osc-danger');

    // The primitive OWNS the card's spacing now — drop the per-card inline padding leaks it
    // replaces (the copy-pasted `padding-bottom:6px` / `padding:…`). Any other inline style
    // (e.g. a card-level `display:flex`) is left untouched.
    try {
      el.style.removeProperty('padding');
      el.style.removeProperty('padding-bottom');
      el.style.removeProperty('padding-top');
    } catch (_) {}

    // The section title is the FIRST direct-child heading only — a heading nested deeper in the
    // body stays body content.
    var heading = null;
    for (var i = 0; i < el.children.length; i++) {
      if (_isHeading(el.children[i])) { heading = el.children[i]; break; }
    }

    // Move everything that is NOT the title heading into `.osc-body`, preserving order + nodes
    // (nodes keep their listeners / ids / data-attrs — this is a re-parent, not a clone).
    var body = document.createElement('div');
    body.className = BODY_CLASS;
    var kids = Array.prototype.slice.call(el.childNodes);
    for (var k = 0; k < kids.length; k++) {
      if (kids[k] === heading) continue;
      body.appendChild(kids[k]);
    }

    if (heading) {
      heading.classList.add(TITLE_CLASS);
      _tagIcon(heading);
      var head = document.createElement('header');
      head.className = HEAD_CLASS;
      el.insertBefore(head, el.firstChild); // header first
      head.appendChild(heading);
    }
    el.appendChild(body); // body after the header

    return el;
  }

  // upgradePanel(panel, opts?) -> number — upgrade every DIRECT-child `.admin-card` of a panel
  // (a nested `.admin-card`, e.g. an inline editor's inner card, is deliberately left alone).
  // Returns how many cards now compose the primitive.
  function upgradePanel(panel, opts) {
    if (!_isEl(panel)) return 0;
    var n = 0;
    var kids = Array.prototype.slice.call(panel.children);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (!_isEl(c)) continue;
      if (c.classList.contains(CARD_CLASS)) { n++; continue; } // already composed
      if (c.classList.contains('admin-card')) { upgrade(c, opts); n++; }
    }
    return n;
  }

  try {
    window.OrwellSettingsCardKit = {
      create: create,
      upgrade: upgrade,
      upgradePanel: upgradePanel,
      CARD_CLASS: CARD_CLASS,
      HEAD_CLASS: HEAD_CLASS,
      TITLE_CLASS: TITLE_CLASS,
      ICON_CLASS: ICON_CLASS,
      BODY_CLASS: BODY_CLASS,
    };
  } catch (_) {}
})();

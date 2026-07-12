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
  // The form-row primitive (#1451). `.osc-row` is the kit's own class; `.settings-row` is the
  // legacy row class the tabs hand-rolled today (styled in style.css). A migrated row carries
  // BOTH — `.osc-row` mirrors `.settings-row` byte-for-byte, so keeping the legacy class is
  // pixel-neutral AND preserves every legacy descendant/adjacent selector + modifier that keys off
  // `.settings-row` (exactly as upgrade() KEEPS `.admin-card` beside `.osc-card`).
  var ROW_CLASS = 'osc-row';
  var ROW_LEGACY_CLASS = 'settings-row';

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

  // ── The form-row primitive (#1451) ──────────────────────────────────────────────────────────
  // A settings row is a label/description on one side + a control/toggle on the other. Before this
  // the tabs hand-rolled `<div class="settings-row">…</div>` per section. `row()` builds one from
  // the kit; `upgradeRow()`/`scanRows()` compose an EXISTING hand-rolled `.settings-row` in place
  // (idempotent), mirroring the card's create()/upgrade()/upgradePanel() shape exactly.

  // row({ label?, labelHtml?, controlEl?, html?, align?: 'end'|'between', className?, id? }) -> row
  //   Builds `<div class="settings-row osc-row"[…modifiers]>` — the legacy class is KEPT so a fresh
  //   kit row inherits every `.settings-row` descendant style + is pixel-identical to a hand-rolled
  //   one. `html` (trusted markup for the WHOLE inner row, e.g. `<label…>…</label><input…>`) mirrors
  //   create()'s `bodyHtml`; otherwise a `.settings-label` is minted from label/labelHtml and an
  //   optional `controlEl` node is appended. The returned element exposes `.oscRow` (self).
  function row(opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = ROW_LEGACY_CLASS + ' ' + ROW_CLASS;
    if (opts.align === 'end') el.classList.add(ROW_CLASS + '--end');
    else if (opts.align === 'between') el.classList.add(ROW_CLASS + '--between');
    if (opts.id) el.id = opts.id;
    if (typeof opts.className === 'string') {
      var extra = opts.className.split(/\s+/);
      for (var e = 0; e < extra.length; e++) if (extra[e]) el.classList.add(extra[e]);
    }
    if (typeof opts.html === 'string') {
      el.innerHTML = opts.html;
    } else {
      if (typeof opts.labelHtml === 'string' || typeof opts.label === 'string') {
        var lab = document.createElement('label');
        lab.className = 'settings-label';
        if (typeof opts.labelHtml === 'string') lab.innerHTML = opts.labelHtml;
        else lab.textContent = opts.label || '';
        el.appendChild(lab);
      }
      if (_isEl(opts.controlEl)) el.appendChild(opts.controlEl);
    }
    el.oscRow = el;
    return el;
  }

  // upgradeRow(el) -> el — compose an existing `.settings-row` (or any row element) onto the
  // primitive IN PLACE: ADD `.osc-row` (KEEP `.settings-row` + its modifiers), idempotent. Nodes,
  // ids, listeners, and ARIA are untouched — this only tags a class. Pixel-neutral by construction.
  function upgradeRow(el) {
    if (!_isEl(el)) return el;
    if (!el.classList.contains(ROW_CLASS)) el.classList.add(ROW_CLASS);
    return el;
  }

  // scanRows(root) -> number — compose every legacy `.settings-row` under `root` onto the primitive
  // (skipping ones already composed). Returns how many rows now carry `.osc-row`. The row-level
  // sibling of upgradePanel(): the settings shell calls this on each shown tab so the whole pane is
  // composed from the kit without churning each tab's row markup.
  function scanRows(root) {
    if (!_isEl(root) || typeof root.querySelectorAll !== 'function') return 0;
    var rows = root.querySelectorAll('.' + ROW_LEGACY_CLASS);
    for (var i = 0; i < rows.length; i++) upgradeRow(rows[i]);
    return rows.length;
  }

  try {
    window.OrwellSettingsCardKit = {
      create: create,
      upgrade: upgrade,
      upgradePanel: upgradePanel,
      row: row,
      upgradeRow: upgradeRow,
      scanRows: scanRows,
      CARD_CLASS: CARD_CLASS,
      HEAD_CLASS: HEAD_CLASS,
      TITLE_CLASS: TITLE_CLASS,
      ICON_CLASS: ICON_CLASS,
      BODY_CLASS: BODY_CLASS,
      ROW_CLASS: ROW_CLASS,
    };
  } catch (_) {}
})();

// orwellChatHint.js — the ONE reusable chat-bar hint/tooltip component.
//
// A single, consistent hint surface that sits directly above the chat input bar,
// spans the SAME width as the bar, and shares its visual language. It replaces the bespoke,
// per-feature composer hints (the old L36 OOC tip was the first and only one) with one shared
// surface + a tiny show/hide API.
//
// #642: the hint is an ABOVE-COMPOSER affordance, so it composes the OrwellNotice kit (kind
// "guide") for its chrome/anchor — it mounts into the ONE stacked notice zone the kit owns
// (above .chat-input-bar) rather than minting its own insertBefore(bar). It keeps its OWN
// per-user dismiss persistence (the E71 `orwell-chat-hint-dismissed:<key>:<user>` key) via the
// kit's persistDismiss:false escape hatch — the hint key is the consumer-scoped unit, not the
// element id, so the kit doesn't own that bit.
//
// SHIPPED WITH ZERO ACTIVE TIPS. The system exists and is wired, but the tip REGISTRY
// below is intentionally empty, so nothing renders by default. Enabling a tip later is a
// one-entry change — add a record to TIPS (see the shape + the commented example).
//
//   OrwellChatHint.register(key, { html, dismissText?, gameBuildOnly?, persistDismiss? })
//     Add/replace a tip definition at runtime (same shape as a TIPS entry).
//   OrwellChatHint.show(key)   — mount the tip above the chat bar (idempotent; honors a
//                                 prior per-user dismissal when persistDismiss is set).
//   OrwellChatHint.hide(key)   — remove the tip from the DOM (does NOT mark it dismissed).
//   OrwellChatHint.dismiss(key)— hide it AND persist the per-user dismissal (if enabled).
//   OrwellChatHint.isShown(key)— whether the tip is currently mounted.
//
// Only ONE hint shows at a time (a new show() replaces whatever is mounted) — the bar has
// room for a single line of guidance, never a stack. Dismiss state is per-user (the E71
// key pattern), so one account's dismissal never bleeds into another's.

// ── the tip registry — INTENTIONALLY EMPTY (no active tips ship) ─────────────
//
// Each entry is keyed by a stable string and has the shape:
//   {
//     html: string,            // inner HTML of the tip text (trusted, author-controlled)
//     dismissText?: string,    // label for the dismiss button (default "Got it"; null ⇒ no button)
//     gameBuildOnly?: boolean, // only mount under the game build (data-game-build); default true
//     persistDismiss?: boolean,// remember the dismissal per user across reloads; default true
//   }
//
// Example (commented — uncomment + adapt to re-enable a composer hint later):
//   'ooc-aside': {
//     html: 'Tip: wrap a message in <code>((double parens))</code> or start it with ' +
//           '<code>ooc:</code> to speak to the producers out of character — the house won’t hear it.',
//   },
const TIPS = {};

// ── per-user dismiss persistence (E71 key pattern) ───────────────────────────
// Per-user key, fail-closed (R5/#1416): null when there is no data-user identity, so the dismiss
// state is not written to a shared "" namespace rather than bleeding across accounts.
function _dismissKey(key) {
  return (window.orwellUserKey && window.orwellUserKey('orwell-chat-hint-dismissed:' + key)) || null;
}
function _hasDismissed(key) {
  const k = _dismissKey(key);
  if (!k) return false;
  try { return localStorage.getItem(k) === '1'; } catch (_) { return false; }
}
function _markDismissed(key) {
  const k = _dismissKey(key);
  if (!k) return;
  try { localStorage.setItem(k, '1'); } catch (_) {}
}

function _isGameBuild() {
  return !!(typeof document !== 'undefined' && document.body &&
    document.body.hasAttribute('data-game-build'));
}

const ELEM_ID = 'orwell-chat-hint';
let _shownKey = null;
let _notice = null;   // #642: the OrwellNotice kit instance for the (single) live hint.

// ── LIQUID GLASS (body.theme-frosted) ────────────────────────────────────────
// The hint card composes the OrwellNotice kit (kind "guide"); orwellNotice.js + style.css
// already paint .on-card / .on-guide as the ONE LIGHT GLASS (the kube music-player light fill),
// so the hint shell gets that light glass for free on BOTH tiers (Full adds SVG refraction;
// Frosted a CSS blur). We inject this tiny module-local rule as a belt-and-suspenders: it
// re-asserts the SAME LIGHT GLASS on the hint's OWN .orwell-chat-hint hook class (added in
// show()) so the hint reads identically even if a future .orwell-chat-hint rule ever set a
// solid bg, or the cascade ordered against the kit rule. Owner ruling: "there should be no old
// dark glass at all"; "the old dark glass shouldn't be the frosted fallback" — so the inline
// DARK-veil glass that used to live here (and made the FROSTED fallback dark) is RETIRED; this
// is now the light glass for BOTH tiers (no :not(.glass-full) scope). Wrapped in prefers-
// reduced-transparency:no-preference so this runtime-injected !important rule NEVER overrides
// style.css's a11y OPAQUE fallback under prefers-reduced-transparency:reduce. Idempotent.
function _ensureGlassCss() {
  if (typeof document === 'undefined' || document.getElementById('orwell-chat-hint-glass-css')) return;
  const st = document.createElement('style');
  st.id = 'orwell-chat-hint-glass-css';
  st.textContent =
    '@media (prefers-reduced-transparency: no-preference) {' +
    /* The ONE LIGHT GLASS for BOTH tiers (Full adds SVG refraction on top via liquidGlass.js). */
    'body.theme-frosted .on-card.orwell-chat-hint {' +
    '  background-color: var(--ow-glass-light-color) !important;' +
    '  background-image: var(--ow-glass-light-fill) !important;' +
    '  -webkit-backdrop-filter: blur(3px) saturate(180%) !important;' +
    '  backdrop-filter: blur(3px) saturate(180%) !important;' +
    '  border-radius: var(--ow-glass-radius) !important;' +
    '  box-shadow:' +
    '    inset 0 1px 0 rgba(255,255,255,0.65),' +
    '    inset 0 0 0 0.5px rgba(255,255,255,0.30),' +
    '    0 12px 36px rgba(0,0,0,0.10) !important; }' +
    'body.theme-frosted .on-card.orwell-chat-hint .on-body { text-shadow: 0 1px 1px rgba(255,255,255,0.45); } }';
  document.head.appendChild(st);
}

function _remove() {
  if (_notice) { _notice.hide(); _notice = null; }
  const el = document.getElementById(ELEM_ID);
  if (el && el.isConnected) el.remove();
  _shownKey = null;
}

// Mount (or replace) the tip for `key` above the chat input bar via the OrwellNotice kit.
function show(key) {
  const def = TIPS[key];
  if (!def) return false;                         // unknown / unregistered key
  if (def.gameBuildOnly !== false && !_isGameBuild()) return false;
  if (def.persistDismiss !== false && _hasDismissed(key)) return false;
  if (!window.OrwellNoticeKit) return false;      // the kit owns the above-composer anchor
  const bar = document.querySelector('.chat-input-bar');
  if (!bar || !bar.parentNode) return false;
  if (_shownKey === key && document.getElementById(ELEM_ID)) return true; // already up

  _remove();                                      // only one hint at a time
  _ensureGlassCss();                              // glass material under body.theme-frosted

  const dismissText = def.dismissText === undefined ? 'Got it' : def.dismissText;
  // Compose the kit (kind "guide"). persistDismiss:false — the hint owns its own per-KEY dismiss
  // persistence (the dismissal is keyed to the tip key, not the element id). dismissible:false:
  // the kit's corner × is suppressed; the hint renders its own inline "Got it" button (the
  // long-standing affordance) so existing copy/selectors stay.
  _notice = window.OrwellNoticeKit.create({
    id: ELEM_ID,
    kind: 'guide',
    title: '',                 // hints have no heading — just the text line + a button
    dismissible: false,
    persistDismiss: false,
  });
  const body = _notice.ensure();
  const el = _notice.el;
  if (!el) return false;
  el.classList.add('orwell-chat-hint');   // keep the legacy hook class for style.css inner rules
  el.dataset.hintKey = key;
  // The head is empty (no title) — keep it from reserving space.
  const head = el.querySelector('.on-head');
  if (head) head.style.display = 'none';
  body.innerHTML =
    '<span class="orwell-chat-hint-text">' + (def.html || '') + '</span>' +
    (dismissText
      // #775 element-kit migration: the "Got it" dismiss composes .ow-btn .ow-btn-plain (the kit
      // owns the frosted chrome — ONE source of truth). The legacy .orwell-chat-hint-dismiss class
      // is kept as the JS hook + Normal-tier fallback (its low-specificity style.css rule loses to
      // the kit on the glass tiers); the dead-CSS retirement is the #774a sweep.
      ? '<button type="button" class="ow-btn ow-btn-plain orwell-chat-hint-dismiss" aria-label="Dismiss tip">' +
          dismissText + '</button>'
      : '');
  _shownKey = key;

  const btn = body.querySelector('.orwell-chat-hint-dismiss');
  if (btn) btn.addEventListener('click', () => dismiss(key));
  return true;
}

// Remove the tip from the DOM without persisting a dismissal.
function hide(key) {
  if (key && _shownKey && key !== _shownKey) return;
  _remove();
}

// Hide AND persist the per-user dismissal (when the tip opts into persistence).
function dismiss(key) {
  const def = TIPS[key];
  if (!def || def.persistDismiss !== false) _markDismissed(key);
  if (_shownKey === key) _remove();
}

function isShown(key) {
  return key ? _shownKey === key : _shownKey !== null;
}

// Register / replace a tip definition at runtime (the one-entry enable path).
function register(key, def) {
  if (!key || !def) return;
  TIPS[key] = def;
}

const API = { register, show, hide, dismiss, isShown,
  // expose the registry (read-only intent) for tests/debug — it is empty by default.
  _tips: TIPS };

if (typeof window !== 'undefined') {
  window.OrwellChatHint = API;
  // A new season is a clean slate for any transient hint that was up.
  window.addEventListener('orwell:gamechanged', () => { _remove(); });
}

export default API;
export { register, show, hide, dismiss, isShown };

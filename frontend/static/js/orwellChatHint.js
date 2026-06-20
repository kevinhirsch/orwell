// orwellChatHint.js — the ONE reusable chat-bar hint/tooltip component.
//
// A single, consistent hint surface that sits directly above the chat input bar,
// spans the SAME width as the bar, and shares its visual language (the .orwell-chat-hint
// CSS class in style.css). It replaces the bespoke, per-feature composer hints (the old
// L36 OOC tip was the first and only one) with one shared class + a tiny show/hide API.
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
function _dismissKey(key) {
  return 'orwell-chat-hint-dismissed:' + key + ':' +
    ((document.body && document.body.dataset.user) || '');
}
function _hasDismissed(key) {
  try { return localStorage.getItem(_dismissKey(key)) === '1'; } catch (_) { return false; }
}
function _markDismissed(key) {
  try { localStorage.setItem(_dismissKey(key), '1'); } catch (_) {}
}

function _isGameBuild() {
  return !!(typeof document !== 'undefined' && document.body &&
    document.body.hasAttribute('data-game-build'));
}

const ELEM_ID = 'orwell-chat-hint';
let _shownKey = null;

function _remove() {
  const el = document.getElementById(ELEM_ID);
  if (el && el.isConnected) el.remove();
  _shownKey = null;
}

// Mount (or replace) the tip for `key` above the chat input bar.
function show(key) {
  const def = TIPS[key];
  if (!def) return false;                         // unknown / unregistered key
  if (def.gameBuildOnly !== false && !_isGameBuild()) return false;
  if (def.persistDismiss !== false && _hasDismissed(key)) return false;
  const bar = document.querySelector('.chat-input-bar');
  if (!bar || !bar.parentNode) return false;
  if (_shownKey === key && document.getElementById(ELEM_ID)) return true; // already up

  _remove();                                      // only one hint at a time

  const hint = document.createElement('div');
  hint.id = ELEM_ID;
  hint.className = 'orwell-chat-hint';
  hint.dataset.hintKey = key;
  hint.setAttribute('role', 'note');
  const dismissText = def.dismissText === undefined ? 'Got it' : def.dismissText;
  hint.innerHTML =
    '<span class="orwell-chat-hint-text">' + (def.html || '') + '</span>' +
    (dismissText
      ? '<button type="button" class="orwell-chat-hint-dismiss" aria-label="Dismiss tip">' +
          dismissText + '</button>'
      : '');

  // Sit it just above the input bar so it reads as composer guidance — and spans
  // the bar's width (the .orwell-chat-hint margins mirror the bar's own inset).
  bar.parentNode.insertBefore(hint, bar);
  _shownKey = key;

  const btn = hint.querySelector('.orwell-chat-hint-dismiss');
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
  const el = document.getElementById(ELEM_ID);
  if (el && el.dataset.hintKey === key) {
    el.classList.add('orwell-chat-hint-out');
    setTimeout(() => { if (el.isConnected) el.remove(); }, 220);
    if (_shownKey === key) _shownKey = null;
  }
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

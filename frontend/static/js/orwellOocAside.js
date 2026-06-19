// orwellOocAside.js — L36 (FE half): the OUT-OF-CHARACTER aside channel.
//
// The chat is ONE box carrying two player channels (CLAUDE.md three-channel model):
//   · in-character — the room hears it; the houseguest in front of you reacts.
//   · OUT-OF-CHARACTER — a quiet aside to the game/producers (logistics: the time,
//     the state, the rules, "what are my options") that the HOUSE DOES NOT HEAR.
//
// The engine already ships the model-side pin (the GM auto-treats meta/logistics
// queries as OOC, and the player can FORCE OOC with the RP convention `((...))`
// or a leading `ooc:`). This module is the front-end half of the DECIDED design:
//
//   1. detectOocAside(text) — the single source of truth for "is this player line
//      an OOC aside?" + the normalized display text (markers stripped). Used by the
//      bubble renderer (chatRenderer.addMessage) to style the player's own OOC
//      message distinctly — clearly an aside to production, NOT a spoken-in-room line.
//   2. A quiet, ONE-TIME, DISMISSIBLE hint near the composer surfacing the
//      convention. Per-user dismiss state (localStorage, the E71 per-user-key
//      pattern). Game-build only (the data-game-build body attr).
//
// SCOPE (audit L36 + follow-on): this module is the player-INPUT detector + hint.
// The MODEL's OOC *answers* are now also rendered as a producer/HUD aside — keyed
// to a REAL engine marker (the GM wraps its whole OOC reply in `((...))` per the
// momentPrompts prompt contract), recognised by the SAME `detectOocAside` here and
// styled by chatRenderer (the assistant branch). Never a heuristic guess on free
// narration — only a fully-`((...))`-wrapped reply is treated as an aside.
//
// Provenance: docs/audits/2026-06-19-live-debug-issues.md item L36 (DECIDED).

// ── detection ──────────────────────────────────────────────────────────────
//
// Two unambiguous overrides the model also honors:
//   · `(( ... ))`  — RP double-parens wrapping the WHOLE message (trim-tolerant).
//   · `ooc:` prefix — a leading `ooc:` (case-insensitive, leading-space tolerant).
//
// Returns { ooc, text }: `ooc` true when the line is an OOC aside; `text` is the
// display text with the markers stripped/normalized but kept readable.

const _DOUBLE_PARENS = /^\s*\(\(([\s\S]*?)\)\)\s*$/;
const _OOC_PREFIX = /^\s*ooc\s*:\s*/i;

export function detectOocAside(raw) {
  const s = typeof raw === 'string' ? raw : '';
  // `(( whole message ))` — only when the parens wrap the entire trimmed line.
  const m = s.match(_DOUBLE_PARENS);
  if (m) {
    const inner = (m[1] || '').trim();
    // An empty `(())` is not a meaningful aside — treat as a normal line.
    if (inner) return { ooc: true, text: inner };
  }
  // leading `ooc:` — strip the marker, keep the rest verbatim.
  if (_OOC_PREFIX.test(s)) {
    return { ooc: true, text: s.replace(_OOC_PREFIX, '').trim() };
  }
  return { ooc: false, text: s };
}

// Convenience boolean for callers that only need the verdict.
export function isOocAside(raw) {
  return detectOocAside(raw).ooc;
}

// ── the one-time composer hint ───────────────────────────────────────────────

function _isGameBuild() {
  return !!(typeof document !== 'undefined' && document.body &&
    document.body.hasAttribute('data-game-build'));
}

// E71 per-user key pattern — one account's dismissal never bleeds into another's.
function _dismissKey() {
  return 'orwell-ooc-hint-dismissed:' +
    ((document.body && document.body.dataset.user) || '');
}

function _hasDismissed() {
  try { return localStorage.getItem(_dismissKey()) === '1'; } catch (_) { return false; }
}
function _markDismissed() {
  try { localStorage.setItem(_dismissKey(), '1'); } catch (_) {}
}

let _mounted = false;

function _mountHint() {
  if (_mounted) return;
  if (!_isGameBuild()) return;          // game-build only
  if (_hasDismissed()) return;          // once dismissed, never again
  const bar = document.querySelector('.chat-input-bar');
  if (!bar || !bar.parentNode) return;
  if (document.getElementById('orwell-ooc-hint')) { _mounted = true; return; }

  const hint = document.createElement('div');
  hint.id = 'orwell-ooc-hint';
  hint.className = 'orwell-ooc-hint';
  hint.setAttribute('role', 'note');
  hint.innerHTML =
    '<span class="orwell-ooc-hint-text">' +
      'Tip: wrap a message in <code>((double parens))</code> or start it with ' +
      '<code>ooc:</code> to speak to the producers out of character — ' +
      'the house won’t hear it.' +
    '</span>' +
    '<button type="button" class="orwell-ooc-hint-dismiss" aria-label="Dismiss tip">Got it</button>';

  // Sit it just above the input bar so it reads as composer guidance.
  bar.parentNode.insertBefore(hint, bar);
  _mounted = true;

  const dismiss = () => {
    _markDismissed();
    hint.classList.add('orwell-ooc-hint-out');
    setTimeout(() => { if (hint.isConnected) hint.remove(); }, 220);
  };
  hint.querySelector('.orwell-ooc-hint-dismiss').addEventListener('click', dismiss);

  // It also retires itself the first time the player actually sends an OOC aside —
  // they have clearly discovered the convention, so the tip is now noise.
  const box = document.getElementById('message');
  const form = document.getElementById('chat-form') || (box && box.form);
  if (form && box) {
    form.addEventListener('submit', () => {
      if (isOocAside(box.value)) dismiss();
    });
  }
}

const _ready = (fn) =>
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn();

if (typeof window !== 'undefined') {
  _ready(_mountHint);
  // A new season is a clean slate — but the dismissal is a durable preference,
  // so we only (re)attempt the mount; _hasDismissed still gates it.
  window.addEventListener('orwell:gamechanged', () => { _mounted = false; _mountHint(); });
  // Test/debug seam for the headless browser gate.
  window._orwellOocDetect = detectOocAside;
}

export default { detectOocAside, isOocAside };

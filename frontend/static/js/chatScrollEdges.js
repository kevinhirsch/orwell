// static/js/chatScrollEdges.js

/**
 * #1414 (R3 PR1): chat transcript scroll-edge mask + recede-on-scroll banner (#738 item 9).
 *
 * The first leaf extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3).
 * Moved VERBATIM from chat.js — behavior-preserving, no logic change. A near-zero-coupling
 * leaf: it reads only DOM scroll metrics and toggles CSS state classes; it holds no
 * cross-cluster mutable state (so it does NOT touch the chatState singleton) and it
 * dispatches nothing (no orwell:gamechanged). chat.js imports `_initChatScrollEdges` and
 * calls it from init() exactly as before.
 *
 * Dual-load idempotent (#1399 generalized): `_initChatScrollEdges` guards on a DOM-node
 * flag (box._scrollEdgesWired), so even if the wiring were invoked twice the scroll
 * listener + observer attach at most once. Imported BY chat.js only (never app.js / an
 * html shell), so there is a single module record in practice.
 */

// ── #738 item #9 · Chat transcript scroll-edge mask + recede-on-scroll banner ──
// Toggle the CSS state classes that drive the transcript's top/bottom fade mask
// (.edge-top / .edge-bottom on #chat-history) and the receding title banner
// (.chat-scrolled on #chat-container). The handler is passive + rAF-coalesced; it
// reads only the scroller's already-computed scroll metrics (no getBoundingClientRect,
// no forced layout) and writes classes at most once per frame. A childList-ONLY
// observer keeps the BOTTOM edge honest when new messages arrive while the reader is
// scrolled up (no scroll event fires then) — childList only, so streaming token
// appends (characterData inside an existing bubble) never storm it. Reduced-motion is
// handled entirely in CSS. Additive: this does NOT touch the streaming buffers
// (roundReplyText / roundReasoningText) or the live-stream render path.
var _scrollEdgeRaf = 0;
function _applyChatScrollEdges() {
  _scrollEdgeRaf = 0;
  var box = document.getElementById('chat-history');
  if (!box) return;
  var container = document.getElementById('chat-container');
  var top = box.scrollTop;
  var maxScroll = box.scrollHeight - box.clientHeight;
  var scrollable = maxScroll > 4;
  box.classList.toggle('edge-top', scrollable && top > 2);
  box.classList.toggle('edge-bottom', scrollable && (maxScroll - top) > 2);
  if (container) container.classList.toggle('chat-scrolled', top > 24);
}
function _scheduleChatScrollEdges() {
  if (_scrollEdgeRaf) return;
  _scrollEdgeRaf = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(_applyChatScrollEdges);
}
export function _initChatScrollEdges() {
  var box = document.getElementById('chat-history');
  if (!box || box._scrollEdgesWired) return;
  box._scrollEdgesWired = true;
  box.addEventListener('scroll', _scheduleChatScrollEdges, { passive: true });
  try {
    var mo = new MutationObserver(_scheduleChatScrollEdges);
    mo.observe(box, { childList: true });
  } catch (_) {}
  _scheduleChatScrollEdges();
}

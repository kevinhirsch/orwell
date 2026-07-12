// static/js/chatAttachments.js

/**
 * #1414 (R3 PR3): chat attachment opening (image → new tab; pdf/text/code → Documents
 * viewer; anything else → raw file).
 *
 * The next leaf extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3),
 * building on PR0 (chatState.js) + PR1 (chatScrollEdges.js) + PR2 (chatSubmitButton.js).
 * Moved VERBATIM from chat.js — behavior-preserving, no logic change:
 *   - openAttachment(att, isImage) — open one chat attachment in the right place.
 *   - _attachLang(name) — filename → CodeMirror language id (internal to openAttachment).
 *   - _attachDocCache — upload id → doc id, so re-clicking an attachment re-opens the same
 *     imported doc instead of duplicating it (internal, module-scoped).
 *
 * Coupling: this cluster holds NO cross-cluster streaming/outbox/reconcile state, so it does
 * NOT touch the chatState singleton. It reads two chat.js-side dependencies:
 *   - `documentModule` — a null stub in the game build (feature 0032 trimmed the workspace
 *     verticals), so the pdf/text branches fall through to the raw-file fallback; mirrored
 *     here as the same `null` const to stay byte-identical.
 *   - `API_BASE` — a chat.js-local mutable `let` set once in init() to window.location.origin.
 *     An ES imported binding is read-only, so chat.js injects a resolver closure
 *     (`_setAttachmentsApiBase(() => API_BASE)`) and this module reads the live value through
 *     it — no stale snapshot, identical to reading chat.js's own `API_BASE`.
 * It also reads the current session id (sessionModule) and dynamically imports ui.js for the
 * error toast, exactly as before.
 *
 * chat.js imports `openAttachment` and re-exports it on the `chatModule` public API (it is
 * called cross-file by chatRenderer.js via `window.chatModule.openAttachment`), so the export
 * object stays byte-identical.
 *
 * Dual-load idempotent (#1399 generalized): the only module-level mutable state is the
 * per-upload doc cache (a plain Map) and the injected resolver — a second evaluation would
 * start a fresh empty cache, which is harmless (the cache is a de-dup optimization, not
 * correctness). Imported BY chat.js only (never app.js / an html shell), so there is a single
 * module record in practice.
 */

import sessionModule from './sessions.js';

// Game build (feature 0032): workspace verticals removed — the Documents viewer is a null
// stub, matching chat.js. The pdf/text branches below therefore throw on `documentModule.*`
// and fall through to the raw-file fallback (window.open) — the existing game-build behavior.
const documentModule = null;

// API_BASE lives as a mutable `let` in chat.js (set once in init to window.location.origin).
// chat.js injects `() => API_BASE` so this module always reads the current value.
let _apiBaseResolver = () => '';
export function _setAttachmentsApiBase(fn) { _apiBaseResolver = fn; }

// Open a chat attachment in the right place: images → Gallery editor; PDFs &
// text/code/markdown → Documents viewer; anything else → raw file. A given
// upload's imported document is reused (cached by upload id) so clicking it
// again re-opens the same doc instead of making duplicates.
const _attachDocCache = new Map();  // upload id -> doc id
function _attachLang(name) {
  const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : '';
  const map = { md:'markdown', markdown:'markdown', js:'javascript', ts:'typescript',
    jsx:'javascript', tsx:'typescript', py:'python', rb:'ruby', go:'go', rs:'rust',
    java:'java', c:'c', cpp:'cpp', h:'c', hpp:'cpp', cs:'csharp', php:'php', html:'html',
    htm:'html', css:'css', scss:'scss', json:'json', yaml:'yaml', yml:'yaml', sh:'bash',
    bash:'bash', sql:'sql', csv:'csv', xml:'xml' };
  return map[ext] || '';
}
export async function openAttachment(att, isImage) {
  if (!att || !att.id) return;
  const API_BASE = _apiBaseResolver();
  const id = att.id, name = att.name || '', mime = att.mime || '';
  const url = `${API_BASE}/api/upload/${id}`;

  // Game build (feature 0032): the Gallery image editor is removed — open
  // attached images in a new tab instead.
  if (isImage) {
    window.open(url, '_blank');
    return;
  }

  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
  const TEXT_EXT = /\.(txt|md|markdown|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|html?|css|scss|sass|less|json|ya?ml|toml|ini|conf|env|sh|bash|sql|csv|tsv|xml|log|vue|svelte)$/i;
  const isTextDoc = TEXT_EXT.test(name) || /^text\//.test(mime);
  if (!isPdf && !isTextDoc) { window.open(url, '_blank'); return; }  // binary/unknown → raw

  // Reuse the doc we already imported for this upload, if it still loads.
  const cached = _attachDocCache.get(id);
  if (cached) {
    try {
      documentModule.openPanel && documentModule.openPanel();
      await documentModule.loadDocument(cached);
      return;
    } catch (_) { _attachDocCache.delete(id); }
  }

  // Need a session to attach the doc to (bare-session fallback, same as compose).
  let sid = '';
  try { sid = sessionModule.getCurrentSessionId() || ''; } catch (_) {}
  if (!sid) {
    try {
      const _fd = new FormData();
      _fd.append('name', name || 'Attachment');
      _fd.append('skip_validation', 'true');
      const r = await fetch(`${API_BASE}/api/session`, { method: 'POST', body: _fd, credentials: 'same-origin' });
      if (r.ok) { const d = await r.json(); if (d && d.id) { sid = d.id; if (sessionModule.loadSessions) await sessionModule.loadSessions(); } }
    } catch (_) {}
  }

  try {
    let doc;
    if (isPdf) {
      // import-pdf wants a fresh file upload — re-fetch the stored blob and post it.
      const blob = await (await fetch(url)).blob();
      const fd = new FormData();
      fd.append('file', blob, name || 'document.pdf');
      if (sid) fd.append('session_id', sid);
      const res = await fetch(`${API_BASE}/api/documents/import-pdf`, { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) throw new Error('import-pdf ' + res.status);
      doc = await res.json();
    } else {
      const text = await (await fetch(url)).text();
      const res = await fetch(`${API_BASE}/api/document`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid || null, title: name.replace(/\.[^.]+$/, '') || 'Document', content: text, language: _attachLang(name) }),
      });
      if (!res.ok) throw new Error('document ' + res.status);
      doc = await res.json();
    }
    if (doc && doc.id) {
      _attachDocCache.set(id, doc.id);
      documentModule.openPanel && documentModule.openPanel();
      if (documentModule.injectFreshDoc) documentModule.injectFreshDoc(doc);
      else await documentModule.loadDocument(doc.id);
    }
  } catch (e) {
    console.error('open attachment as document failed', e);
    import('./ui.js').then(m => m.showError && m.showError('Could not open attachment')).catch(() => {});
    window.open(url, '_blank');  // fallback so the file is still reachable
  }
}

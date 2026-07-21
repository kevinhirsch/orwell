// static/js/chatMessageActions.js

/**
 * #1414 (R3 PR5): the message-actions cluster — per-message edit / resend / regenerate /
 * variant-navigation / fork / delete / rewrite / continue.
 *
 * The next extraction from the chat.js god-object (docs/REFACTOR-ROADMAP.md, R3), building on
 * PR0 (chatState.js) + PR1 (chatScrollEdges.js) + PR2 (chatSubmitButton.js) + PR3
 * (chatAttachments.js) + PR4 (chatWsSplice.js). Moved VERBATIM from chat.js —
 * behavior-preserving, no logic change:
 *   - editUserMessage(el) — inline-edit a user bubble, truncate history, resubmit headless.
 *   - resendUserMessage(el) — truncate to that user bubble and resubmit (re-carrying file-ids).
 *   - regenerateFrom(el) — re-run the preceding user turn, stashing the old reply as a variant.
 *   - _attachVariantNav / _renderVariantNav / _switchVariant / _variantTagText / _VARIANT_ICONS
 *       — the ‹ 1 / N › variant navigator for regen/rewrite alternatives (internal to this cluster,
 *       except _attachVariantNav which chat.js's stream finalize still calls).
 *   - forkFrom(el) — branch a new session from the turn up to this reply.
 *   - deleteMessage(el) — remove a user+AI pair (and the tool bubbles between/after them).
 *   - editAIMessage(el) — inline-edit an AI bubble, persist the edit.
 *   - rewriteWith(el, instruction) — lightweight /api/rewrite of the last reply (shorter/simpler/…).
 *   - continueFrom(el) — "Continue from where you left off." headless send.
 *
 * The 8 exported action functions (regenerateFrom, forkFrom, editUserMessage, editAIMessage,
 * resendUserMessage, deleteMessage, rewriteWith, continueFrom) are called cross-file by
 * chatRenderer.js via `window.chatModule.<fn>` (the per-message footer buttons), so chat.js
 * imports them and RE-EXPORTS them on the `chatModule` public API below — the export object stays
 * byte-identical. `_attachVariantNav` is imported by chat.js because its stream-finalize path calls
 * it (`_attachVariantNav(footerTarget)`); the rest of the variant-nav helpers are internal here.
 *
 * Coupling: re-entrancy. editUserMessage / resendUserMessage / regenerateFrom / continueFrom each
 * RE-ENTER the send by calling `handleChatSubmit` — which STAYS in chat.js (it is the turn
 * orchestrator and hosts the stream loop). An ES imported binding is read-only and importing chat.js
 * here would be a circular edge, so chat.js injects the deps at module-eval through
 * `_setMessageActionsDeps({...})` — the same pattern as PR2/PR3/PR4's
 * `_setSubmitDeps`/`_setAttachmentsApiBase`/`_setWsSpliceDeps`:
 *   - `handleChatSubmit` — the headless send (`handleChatSubmit(null, text)` — no composer
 *     puppeteering). Injected; NEVER imported (chat.js owns it + the stream loop).
 *   - `apiBase` — a `() => API_BASE` resolver. API_BASE is a chat.js-local mutable `let` set once
 *     in init() to window.location.origin; read live through the resolver so there is no stale
 *     snapshot (identical to chatAttachments' `_setAttachmentsApiBase`).
 *   - `setPendingRegenAttachments` — the regen/resend file-id hand-off. `_pendingRegenAttachments`
 *     stays a chat.js `let` because handleChatSubmit READS and CLEARS it on the very next send; the
 *     moved writers hand off through this setter (the reads inside regenerateFrom use the local
 *     `_regenIds`, byte-equivalent to reading the shared var right after the assignment).
 * `chatState._hideUserBubble` (the "suppress the next user bubble" cue) is read/written through the
 * shared chatState singleton (PR0), exactly as before. `_pendingVariants` / `_pendingVariantLabel`
 * (the regen→finalize variant hand-off) are written by regenerateFrom and consumed by
 * _attachVariantNav — both live here now, so they stay module-local.
 *
 * Everything else the cluster touches is importable from its own module (sessions / ui / markdown /
 * spinner) or a global (window.hljs), imported directly below.
 *
 * Dual-load idempotent (#1399 generalized): the only module-level mutable state is the transient
 * variant hand-off (`_pendingVariants`/`_pendingVariantLabel`, null between a regen and its finalize)
 * and the three injected-dep slots; a second evaluation would start fresh nulls, which is harmless
 * (the same stance as the sibling modules). Imported BY chat.js only (never app.js / an html shell),
 * so there is a single module record in practice.
 */

import sessionModule from './sessions.js';
import uiModule from './ui.js';
import markdownModule from './markdown.js';
import spinnerModule from './spinner.js';
import { chatState } from './chatState.js';

// ── chat.js-internal deps injected at module-eval (see the header) ────────────────
// handleChatSubmit (the headless send + stream loop) + API_BASE (a chat.js `let`) +
// setPendingRegenAttachments (the regen/resend file-id hand-off, whose backing `let`
// handleChatSubmit reads/clears) all stay in chat.js; chat.js injects them through
// `_setMessageActionsDeps`. Safe no-op defaults keep a bare test import inert.
let _handleChatSubmit = () => {};
let _apiBaseResolver = () => '';
let _setPendingRegenAttachments = () => {};
export function _setMessageActionsDeps(deps) {
  if (!deps) return;
  if (deps.handleChatSubmit) _handleChatSubmit = deps.handleChatSubmit;
  if (deps.apiBase) _apiBaseResolver = deps.apiBase;
  if (deps.setPendingRegenAttachments) _setPendingRegenAttachments = deps.setPendingRegenAttachments;
}

export async function editUserMessage(userMsgElement) {
  const API_BASE = _apiBaseResolver();
  const box = document.getElementById('chat-history');
  const allMsgs = Array.from(box.querySelectorAll('.msg'));
  const msgIndex = allMsgs.indexOf(userMsgElement);
  if (msgIndex < 0) return;

  const bodyEl = userMsgElement.querySelector('.body');
  const currentText = bodyEl ? bodyEl.textContent.trim().replace(/\s*\[\d+ attachment\(s\)\]$/, '') : '';

  // Replace body with an editable textarea
  const editor = document.createElement('textarea');
  editor.className = 'edit-textarea';
  editor.value = currentText;
  editor.rows = Math.max(2, currentText.split('\n').length);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:6px; margin-top:4px;';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-save-btn';
  saveBtn.textContent = 'Send';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  const originalHTML = bodyEl.innerHTML;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(editor);
  bodyEl.appendChild(btnRow);
  editor.focus();

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    bodyEl.innerHTML = originalHTML;
  });

  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newText = editor.value.trim();
    if (!newText) return;

    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) return;

    const keepCount = msgIndex;
    try {
      await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_count: keepCount })
      });

      // Remove DOM elements from msgIndex onward
      for (let i = allMsgs.length - 1; i >= msgIndex; i--) {
        allMsgs[i].remove();
      }

      // Submit the edited text (headless — no composer puppeteering)
      _handleChatSubmit(null, newText);
    } catch (err) {
      console.error('Edit failed:', err);
      if (uiModule) uiModule.showError('Edit failed: ' + err.message);
      bodyEl.innerHTML = originalHTML;
    }
  });

  // Also submit on Enter (without shift)
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      saveBtn.click();
    }
  });
}

/**
 * Resend a user message — truncates history to that point and resubmits.
 */
export async function resendUserMessage(userMsgElement) {
  const API_BASE = _apiBaseResolver();
  const box = document.getElementById('chat-history');
  const allMsgs = Array.from(box.querySelectorAll('.msg'));
  const msgIndex = allMsgs.indexOf(userMsgElement);
  if (msgIndex < 0) return;

  // Prefer dataset.raw (stripped original user text) over .body.textContent
  // — the latter slurps the rendered "View image description" collapsible
  // content too, which would then be sent back as the user's question and
  // the AI would reply to that gibberish instead of the actual prompt.
  const bodyEl = userMsgElement.querySelector('.body');
  let text = (userMsgElement.dataset.raw || (bodyEl ? bodyEl.textContent : '') || '').trim();
  text = text.replace(/\s*\[\d+ attachment\(s\)\]$/, '');

  // Collect file_ids attached to this user message so the resend re-carries
  // the photos / docs (and the chat handler picks up the user-edited OCR
  // text cached server-side under those file ids).
  const _attachEls = userMsgElement.querySelectorAll('[data-file-id]');
  let _ids = Array.from(_attachEls).map(el => el.dataset.fileId).filter(Boolean);
  if (!_ids.length) {
    const _imgs = userMsgElement.querySelectorAll('.attach-image-preview img, .attach-card img');
    for (const _im of _imgs) {
      const _m = (_im.getAttribute('src') || '').match(/\/api\/upload\/([A-Za-z0-9_\-]+)/);
      if (_m && _m[1] && !_ids.includes(_m[1])) _ids.push(_m[1]);
    }
  }

  // Rescue: legacy bubbles may have stored the filename as the message
  // content (artifact of earlier broken resends). Don't re-send that as
  // the user prompt if we still have the file attached. Loosen the regex
  // to cover real-world camera/screenshot names with spaces, parens,
  // multi-dots: "Screen Shot 2026-05-28 at 4.05.32 PM.png", "IMG (1).JPG".
  if (text && _ids.length && /^[^\n\r]{1,200}\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(text)) {
    text = '';
  }
  // Empty text + no attachments → tell the user instead of silently bailing.
  // The common case is a regen during a pre-upload race where the bubble
  // never had an `[data-file-id]` to scrape.
  if (!text && !_ids.length) {
    if (uiModule?.showError) uiModule.showError('Nothing to resend — message has no text and no attachments yet (try again after the upload finishes).');
    return;
  }

  const sessionId = sessionModule.getCurrentSessionId();
  if (!sessionId) return;

  // Truncate backend to keep everything before this user message
  const keepCount = msgIndex;
  try {
    await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_count: keepCount })
    });

    // Drop the AI replies after the user message but KEEP the user bubble
    // itself (so its photo stays visible). Then suppress the new user
    // bubble that send would otherwise add — same pattern as regenerate.
    let sibling = userMsgElement.nextSibling;
    while (sibling) {
      const next = sibling.nextSibling;
      sibling.remove();
      sibling = next;
    }
    chatState._hideUserBubble = true;
    _setPendingRegenAttachments(_ids);

    // Resubmit (headless — no composer puppeteering)
    _handleChatSubmit(null, text);
  } catch (err) {
    console.error('Resend failed:', err);
    if (uiModule) uiModule.showError('Resend failed: ' + err.message);
  }
}

export async function regenerateFrom(aiMsgElement) {
  const API_BASE = _apiBaseResolver();
  const box = document.getElementById('chat-history');
  const allMsgs = Array.from(box.querySelectorAll('.msg'));
  const aiIndex = allMsgs.indexOf(aiMsgElement);
  if (aiIndex < 0) return;

  // Find the preceding user message
  let userIndex = -1;
  let userText = '';
  let userMsgEl = null;
  for (let i = aiIndex - 1; i >= 0; i--) {
    if (allMsgs[i].classList.contains('msg-user')) {
      userIndex = i;
      userMsgEl = allMsgs[i];
      // Prefer dataset.raw (set by addMessage with the stripped, original
      // user text) over the rendered body's textContent — the latter
      // pulls in the "View image description" collapsible content too,
      // duplicating the OCR text on regen.
      const bodyEl = userMsgEl.querySelector('.body');
      userText = (userMsgEl.dataset.raw || (bodyEl ? bodyEl.textContent : '') || '').trim();
      userText = userText.replace(/\s*\[\d+ attachment\(s\)\]$/, '');
      break;
    }
  }

  if (userIndex < 0) {
    if (uiModule) uiModule.showError('Could not find the user message to regenerate');
    return;
  }

  // Collect any file_ids attached to the original user message so the
  // regenerated send re-uses them. Without this the AI is regenerated on
  // text alone — photos (and the user-edited OCR text cached server-side
  // under that file_id) would be silently dropped.
  const _attachEls = userMsgEl ? userMsgEl.querySelectorAll('[data-file-id]') : [];
  let _regenIds = Array.from(_attachEls).map(el => el.dataset.fileId).filter(Boolean);
  // Fallback for bubbles rendered before the data-file-id stamp landed:
  // sniff the file id straight out of any `.attach-image-preview img`
  // src URLs (matches /api/upload/<id>). Otherwise an older bubble would
  // regen with zero attachments and the photo would be lost from the
  // resulting message even though the file still exists on disk.
  if (!_regenIds.length && userMsgEl) {
    const _imgs = userMsgEl.querySelectorAll('.attach-image-preview img, .attach-card img');
    for (const _im of _imgs) {
      const _m = (_im.getAttribute('src') || '').match(/\/api\/upload\/([A-Za-z0-9_\-]+)/);
      if (_m && _m[1] && !_regenIds.includes(_m[1])) _regenIds.push(_m[1]);
    }
  }
  _setPendingRegenAttachments(_regenIds);

  // Rescue: earlier-version regens (before the dataset.raw fix) stored the
  // photo's filename as the user-message content. On a follow-up regen,
  // that filename would be sent back as the literal user prompt, so the
  // AI thinks the question is "blue_night_preview.jpg" and replies "that's
  // an image file". If userText is just a bare image filename and we have
  // attachments, drop it so the OCR text (or the image bytes for vision
  // models) is what the model actually sees.
  if (userText && _regenIds.length &&
      /^[^\n\r]{1,200}\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(userText.trim())) {
    userText = '';
  }

  // A photo-only message has empty user text — regen must still proceed,
  // because the attachments themselves are the message. Bail only if there
  // is no text AND no attachments to send.
  if (!userText && !_regenIds.length) {
    if (uiModule) uiModule.showError('Nothing to regenerate — the user message has no text and no attachments');
    return;
  }

  const sessionId = sessionModule.getCurrentSessionId();
  if (!sessionId) return;

  // Save current response as a variant
  const oldRaw = aiMsgElement.dataset.raw || aiMsgElement.querySelector('.body')?.textContent || '';
  const oldHtml = aiMsgElement.querySelector('.body')?.innerHTML || '';
  let variants = [];
  try { variants = JSON.parse(aiMsgElement.dataset.variants || '[]'); } catch(_) {}
  if (variants.length === 0) {
    // First regen — save the original as variant 0
    variants.push({ raw: oldRaw, html: oldHtml, label: 'original' });
  }

  const keepCount = userIndex;
  // #1728 (D1) — prefer the id-keyed supersede: the AI bubble's DB row id (stamped once the row
  // is persisted — see chat.js `dataset.dbId`) lets the server resolve the true `keep_count` from
  // its own `seq` order instead of trusting this function's DOM-index count, which can drift from
  // the real DB row count (hidden/system rows persist without a rendered bubble) and leave the
  // stale reply un-truncated — two near-identical persisted rows after "Try again" (T3). Falls
  // back to the DOM-index count only when the row hasn't been stamped with an id yet (rare: a
  // regenerate clicked before the bubble's own persistence round-trip completed).
  const _aiDbId = aiMsgElement.dataset.dbId || null;

  try {
    await fetch(`${API_BASE}/api/session/${sessionId}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_aiDbId
        ? { truncate_from_id: _aiDbId, keep_count: keepCount }
        : { keep_count: keepCount })
    });

    for (let i = allMsgs.length - 1; i > aiIndex; i--) {
      allMsgs[i].remove();
    }

    // Remove the AI message from DOM — it will be replaced by the new streaming response
    // But first, stash the variants data so we can transfer it to the new element
    _pendingVariants = variants;
    _pendingVariantLabel = 'regen';
    aiMsgElement.remove();

    chatState._hideUserBubble = true;
    _handleChatSubmit(null, userText); // headless regen — no composer puppeteering

  } catch (err) {
    console.error('Regenerate failed:', err);
    if (uiModule) uiModule.showError('Regenerate failed: ' + err.message);
  }
}

// Pending variants from a regeneration — transferred to new streaming element
let _pendingVariants = null;
let _pendingVariantLabel = null;

/**
 * Called after streaming completes to attach variant navigation if this was a regen.
 */
export function _attachVariantNav(msgElement) {
  const API_BASE = _apiBaseResolver();
  if (!_pendingVariants) return;
  const variants = _pendingVariants;
  _pendingVariants = null;

  // Add the new response as the latest variant
  const newRaw = msgElement.dataset.raw || msgElement.querySelector('.body')?.textContent || '';
  const newHtml = msgElement.querySelector('.body')?.innerHTML || '';
  const varLabel = _pendingVariantLabel || 'regen';
  _pendingVariantLabel = null;
  variants.push({ raw: newRaw, html: newHtml, label: varLabel });

  msgElement.dataset.variants = JSON.stringify(variants);
  msgElement.dataset.variantIndex = String(variants.length - 1);

  _renderVariantNav(msgElement, variants, variants.length - 1);

  // Persist variants to server
  const sid = sessionModule.getCurrentSessionId();
  if (sid) {
    fetch(`${API_BASE}/api/session/${sid}/update-last-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { variants: variants, variantIndex: variants.length - 1 } })
    }).catch(e => console.warn('update-last-meta (variants) failed:', e));
  }
}

const _VARIANT_ICONS = { regen: '↻', shorter: '✂', simpler: '?', original: '○' };
function _variantTagText(label) {
  return _VARIANT_ICONS[label] || _VARIANT_ICONS['original'];
}

function _renderVariantNav(msgElement, variants, currentIdx) {
  // Remove existing nav if any
  const old = msgElement.querySelector('.variant-nav');
  if (old) old.remove();

  if (variants.length < 2) return;

  const nav = document.createElement('span');
  nav.className = 'variant-nav';
  nav.addEventListener('click', (e) => e.stopPropagation());

  // Label showing what this variant is
  // Divider
  const divider = document.createElement('span');
  divider.className = 'variant-divider';
  divider.textContent = '|';
  nav.appendChild(divider);

  // Label
  const curVariant = variants[currentIdx];
  const tagLabel = document.createElement('span');
  tagLabel.className = 'variant-tag' + (curVariant?.label === 'shorter' ? ' variant-tag-scissors' : '');
  tagLabel.textContent = _variantTagText(curVariant?.label);
  nav.appendChild(tagLabel);

  // < button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'variant-btn';
  prevBtn.textContent = '<';
  prevBtn.disabled = currentIdx === 0;
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx - 1); });
  nav.appendChild(prevBtn);

  // Clickable number for current index (click left number = go left, right = go right)
  const numLeft = document.createElement('button');
  numLeft.className = 'variant-num';
  numLeft.textContent = String(currentIdx + 1);
  numLeft.disabled = currentIdx === 0;
  numLeft.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx - 1); });
  nav.appendChild(numLeft);

  const slash = document.createElement('span');
  slash.className = 'variant-slash';
  slash.textContent = '/';
  nav.appendChild(slash);

  const numRight = document.createElement('button');
  numRight.className = 'variant-num';
  numRight.textContent = String(variants.length);
  numRight.disabled = currentIdx === variants.length - 1;
  numRight.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx + 1); });
  nav.appendChild(numRight);

  // > button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'variant-btn';
  nextBtn.textContent = '>';
  nextBtn.disabled = currentIdx === variants.length - 1;
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); _switchVariant(msgElement, variants, currentIdx + 1); });
  nav.appendChild(nextBtn);

  // Insert into the .role header
  const roleEl = msgElement.querySelector('.role');
  if (roleEl) {
    roleEl.appendChild(nav);
  } else {
    msgElement.appendChild(nav);
  }
}

function _switchVariant(msgElement, variants, newIdx) {
  const API_BASE = _apiBaseResolver();
  if (newIdx < 0 || newIdx >= variants.length) return;
  const v = variants[newIdx];
  const body = msgElement.querySelector('.body');
  if (body) body.innerHTML = v.html;
  msgElement.dataset.raw = v.raw;
  msgElement.dataset.variantIndex = String(newIdx);
  if (window.hljs) {
    msgElement.querySelectorAll('pre code').forEach(block => window.hljs.highlightElement(block));
  }
  _renderVariantNav(msgElement, variants, newIdx);

  // Persist selected variant to server
  const sid = sessionModule.getCurrentSessionId();
  if (sid) {
    fetch(`${API_BASE}/api/session/${sid}/update-last-meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { variantIndex: newIdx } })
    }).catch(e => console.warn('update-last-meta (variantIndex) failed:', e));
  }
}

export async function forkFrom(aiMsgElement) {
  const API_BASE = _apiBaseResolver();
  const box = document.getElementById('chat-history');
  const allMsgs = Array.from(box.querySelectorAll('.msg'));
  const aiIndex = allMsgs.indexOf(aiMsgElement);
  if (aiIndex < 0) return;

  const sessionId = sessionModule.getCurrentSessionId();
  if (!sessionId) return;

  const keepCount = aiIndex + 1;

  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep_count: keepCount }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    await sessionModule.loadSessions();
    await sessionModule.selectSession(data.id);
    if (uiModule) uiModule.showToast(`Forked → ${data.name}`);
  } catch (err) {
    console.error('Fork failed:', err);
    if (uiModule) uiModule.showError('Fork failed: ' + err.message);
  }
}

/**
 * Delete an AI message and its preceding user message from the conversation.
 */
export async function deleteMessage(msgElement) {
  const API_BASE = _apiBaseResolver();
  const box = document.getElementById('chat-history');
  const allMsgs = Array.from(box.querySelectorAll('.msg'));
  const clickedIndex = allMsgs.indexOf(msgElement);
  if (clickedIndex < 0) return;

  // No early-out on a missing session: an output shown before any model was
  // selected (issue #1428) has no session/persisted rows, but its "x" must
  // still remove it. We only need the session id for the server-side delete
  // below; without one we fall back to removing the DOM.
  const sessionId = sessionModule.getCurrentSessionId();

  const clickedIsUser = msgElement.classList.contains('msg-user');

  // Find the user+AI pair
  let userIndex = -1;
  let aiIndex = -1;
  if (clickedIsUser) {
    userIndex = clickedIndex;
    // Find the following AI message
    for (let i = clickedIndex + 1; i < allMsgs.length; i++) {
      if (allMsgs[i].classList.contains('msg-ai') && !allMsgs[i].classList.contains('msg-continuation')) {
        aiIndex = i;
        break;
      }
      if (allMsgs[i].classList.contains('msg-user')) break; // next user msg, no AI response
    }
  } else {
    // If clicked on a continuation, walk back to the main AI message
    let mainAiIndex = clickedIndex;
    if (allMsgs[mainAiIndex].classList.contains('msg-continuation')) {
      for (let i = mainAiIndex - 1; i >= 0; i--) {
        if (allMsgs[i].classList.contains('msg-ai') && !allMsgs[i].classList.contains('msg-continuation')) {
          mainAiIndex = i;
          break;
        }
      }
    }
    aiIndex = mainAiIndex;
    // Find the preceding user message
    for (let i = aiIndex - 1; i >= 0; i--) {
      if (allMsgs[i].classList.contains('msg-user')) {
        userIndex = i;
        break;
      }
    }
  }

  // Collect DB message IDs and DOM elements to remove
  const msgIds = [];
  const domToRemove = [];

  // Add the user message if found
  if (userIndex >= 0) {
    domToRemove.push(allMsgs[userIndex]);
    const uid = allMsgs[userIndex].dataset.dbId;
    if (uid) msgIds.push(uid);
  }

  // Add the AI message if found
  if (aiIndex >= 0) {
    domToRemove.push(allMsgs[aiIndex]);
    const aid = allMsgs[aiIndex].dataset.dbId;
    if (aid) msgIds.push(aid);

    const aiEl = allMsgs[aiIndex];
    // Also remove agent-thread elements BETWEEN user and AI
    if (userIndex >= 0) {
      let between = allMsgs[userIndex].nextElementSibling;
      while (between && between !== aiEl) {
        domToRemove.push(between);
        between = between.nextElementSibling;
      }
    }
    // Walk forward from the AI element to remove continuations and tool bubbles
    let sibling = aiEl.nextElementSibling;
    while (sibling) {
      if (sibling.classList.contains('msg-user') ||
          (sibling.classList.contains('msg-ai') && !sibling.classList.contains('msg-continuation'))) {
        break;
      }
      domToRemove.push(sibling);
      sibling = sibling.nextElementSibling;
    }
  }

  if (!msgIds.length || !sessionId) {
    // No persisted rows to delete (no DB IDs, or no session at all — e.g. an
    // error output shown before a model was selected, #1428). Just remove the
    // DOM so the "x" works regardless.
    domToRemove.forEach(el => el.remove());
    if (uiModule) uiModule.showToast('Message deleted');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/delete-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_ids: msgIds })
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    domToRemove.forEach(el => el.remove());
    if (uiModule) uiModule.showToast('Message deleted');
  } catch (err) {
    console.error('Delete failed:', err);
    if (uiModule) uiModule.showError('Delete failed: ' + err.message);
  }
}

/**
 * Edit an AI message inline. Makes the body contentEditable, saves to DB on confirm.
 */
export async function editAIMessage(msgElement) {
  const API_BASE = _apiBaseResolver();
  const body = msgElement.querySelector('.body');
  if (!body) return;

  const isEditing = body.contentEditable === 'true' || body.contentEditable === 'plaintext-only';
  if (isEditing) return; // already editing

  const originalRaw = msgElement.dataset.raw || body.textContent || '';

  // Create editable textarea overlay
  const textarea = document.createElement('textarea');
  textarea.className = 'msg-edit-textarea';
  textarea.value = originalRaw;
  textarea.style.width = '100%';
  textarea.style.minHeight = Math.max(100, body.offsetHeight) + 'px';
  body.style.display = 'none';
  body.parentNode.insertBefore(textarea, body.nextSibling);
  textarea.focus();

  // Add save/cancel bar
  const bar = document.createElement('div');
  bar.className = 'msg-edit-bar';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'msg-edit-save';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'msg-edit-cancel';
  cancelBtn.textContent = 'Cancel';
  bar.appendChild(saveBtn);
  bar.appendChild(cancelBtn);
  textarea.parentNode.insertBefore(bar, textarea.nextSibling);

  function cleanup() {
    textarea.remove();
    bar.remove();
    body.style.display = '';
  }

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cleanup();
  });

  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newContent = textarea.value;
    if (newContent === originalRaw) { cleanup(); return; }

    const msgId = msgElement.dataset.dbId;
    if (!msgId) { if (uiModule) uiModule.showError('Cannot edit: message ID not found'); cleanup(); return; }

    const sessionId = sessionModule.getCurrentSessionId();
    if (!sessionId) { cleanup(); return; }

    try {
      const res = await fetch(`${API_BASE}/api/session/${sessionId}/edit-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_id: msgId, content: newContent }),
      });
      if (!res.ok) throw new Error('Server error ' + res.status);

      // Re-render body with markdown
      body.innerHTML = markdownModule.processWithThinking(markdownModule.squashOutsideCode(newContent));
      msgElement.dataset.raw = newContent;

      // Add edited indicator if not already present
      if (!msgElement.querySelector('.edited-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'edited-indicator';
        indicator.textContent = '[Message edited]';
        body.parentNode.insertBefore(indicator, body.nextSibling);
      }

      cleanup();
      if (uiModule) uiModule.showToast('Message edited');
    } catch (err) {
      console.error('Edit failed:', err);
      if (uiModule) uiModule.showError('Edit failed: ' + err.message);
    }
  });
}

/**
 * Rewrite the AI's last response with a specific instruction.
 * Uses the lightweight /api/rewrite endpoint — no tools, no agent loop.
 * Just rewrites the text of the last AI bubble.
 */
export async function rewriteWith(aiMsgElement, instruction) {
  const API_BASE = _apiBaseResolver();
  const sessionId = sessionModule.getCurrentSessionId();
  if (!sessionId) return;

  // Get the original text from the AI bubble
  const oldRaw = aiMsgElement.dataset.raw || aiMsgElement.querySelector('.body')?.textContent || '';
  const oldHtml = aiMsgElement.querySelector('.body')?.innerHTML || '';

  if (!oldRaw.trim()) {
    if (uiModule) uiModule.showError('No text to rewrite');
    return;
  }

  // Save current response as a variant
  let variants = [];
  try { variants = JSON.parse(aiMsgElement.dataset.variants || '[]'); } catch(_) {}
  if (variants.length === 0) {
    variants.push({ raw: oldRaw, html: oldHtml, label: 'original' });
  }

  // Determine label from instruction
  let varLabel = 'rewrite';
  if (instruction.includes('shorter')) varLabel = 'shorter';
  else if (instruction.includes('simpler')) varLabel = 'simpler';

  // Clear the bubble and show a whirlpool spinner while we wait for the
  // rewrite (replaces the old "Rewriting..." text).
  const bodyEl = aiMsgElement.querySelector('.body');
  let _rwSpin = null;
  if (bodyEl) {
    bodyEl.innerHTML = '';
    _rwSpin = spinnerModule.createWhirlpool(18);
    _rwSpin.element.style.margin = '4px 0';
    bodyEl.appendChild(_rwSpin.element);
  }
  // Stop + detach the spinner (called once real content starts rendering, and
  // on the failure path so it never spins forever).
  const _killRwSpin = () => { if (_rwSpin) { try { _rwSpin.destroy(); } catch (_) {} _rwSpin = null; } };

  try {
    const res = await fetch(`${API_BASE}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        original_text: oldRaw,
        instruction: instruction,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let newText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          // The endpoint streams `event: error\ndata: {error,status}` on
          // failure — surface it instead of silently hanging on "Rewriting…".
          if (data.error) {
            throw new Error(data.error || ('HTTP ' + (data.status || 500)));
          }
          // Reasoning tokens (vLLM --reasoning-parser: Qwen3 / DeepSeek-R1)
          // arrive as separate {delta, thinking:true} chunks. They are NOT
          // the rewrite — fold them away so they don't pollute the result.
          if (data.thinking) continue;
          if (data.delta) {
            newText += data.delta;
            _killRwSpin();
            if (bodyEl) {
              bodyEl.innerHTML = markdownModule.processWithThinking(
                markdownModule.squashOutsideCode(newText)
              );
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message) throw e;  // re-throw real errors
          /* ignore JSON parse noise */
        }
      }
    }

    // Strip any thinking markup from the answer. A reasoning model may emit
    // an inline <think>…</think> block, a bare </think> (no opener), or — when
    // its reasoning came via reasoning_content — a stray leading <think> that
    // never closes (so it would otherwise hide the whole answer). Peel all of
    // those off so what's left is just the rewritten text.
    const _stripThink = (t) => {
      t = markdownModule.normalizeThinkingMarkup(t || '');
      t = t.replace(/<(?:think(?:ing)?|thought)(?:\s+[^>]*)?>[\s\S]*?<\/(?:think(?:ing)?|thought)>/gi, '');   // complete blocks
      if (/<\/(?:think(?:ing)?|thought)>/i.test(t)) t = t.replace(/^[\s\S]*?<\/(?:think(?:ing)?|thought)>/i, '');  // reasoning w/o opener
      return t.replace(/<\/?(?:think(?:ing)?|thought)(?:\s+[^>]*)?>/gi, '').trim();        // any orphan tag
    };
    newText = _stripThink(newText);

    // Nothing left after stripping (or an empty stream) → real failure, not a
    // blank bubble.
    if (!newText.trim()) {
      throw new Error('model returned no rewritten text');
    }

    // Update the element's raw text
    if (newText) {
      aiMsgElement.dataset.raw = newText;
      // Final render with proper markdown
      if (bodyEl) {
        bodyEl.innerHTML = markdownModule.processWithThinking(
          markdownModule.squashOutsideCode(newText)
        );
      }

      // Save the new response as a variant
      variants.push({ raw: newText, html: bodyEl ? bodyEl.innerHTML : '', label: varLabel });
      aiMsgElement.dataset.variants = JSON.stringify(variants);
      aiMsgElement.dataset.variantIndex = String(variants.length - 1);

      // Persist variant metadata to server
      try {
        await fetch(`${API_BASE}/api/session/${sessionId}/update-last-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: { variants: variants, variantIndex: variants.length - 1 } }),
        });
      } catch (_) {}

      // Re-render variant navigation
      _renderVariantNav(aiMsgElement, variants, variants.length - 1);
    }

    if (uiModule) uiModule.scrollHistory();

  } catch (err) {
    console.error('Rewrite failed:', err);
    _killRwSpin();
    // Restore original content on failure
    if (bodyEl) bodyEl.innerHTML = oldHtml;
    if (uiModule) uiModule.showError('Rewrite failed: ' + err.message);
  }
}

/**
 * Continue the AI's response from where it left off.
 */
export async function continueFrom(aiMsgElement) {
  const sessionId = sessionModule.getCurrentSessionId();
  if (!sessionId) return;

  _handleChatSubmit(null, 'Continue from where you left off.'); // headless — no composer puppeteering
}

// Model Picker — chatbox model selector dropdown
// Extracted from sessions.js

import { providerLogo } from './providers.js';
import uiModule from './ui.js';
import { sortModelObjects } from './modelSort.js';
import { isNarrow } from './platform.js';

const API_BASE = window.location.origin;

// ── Recent + Favorites persistence ──
// Recent is auto-tracked (last 5 picks, most-recent-first) and lives in its
// own key. Favorites is the SAME key the sidebar Models section uses, so a
// favorite toggled here shows up there and vice-versa.
const RECENT_KEY = 'orwell-model-recent';
const FAVORITES_KEY = 'orwell-model-favorites';
const RECENT_MAX = 5;
// Catalogs at or below this size are small enough that hiding everything
// behind search would be a regression — keep listing them in browse mode.
const BROWSE_ALL_LIMIT = 12;

function _loadList(key) {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function _saveList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* quota / private mode */ }
}
function _loadRecent() { return _loadList(RECENT_KEY); }
function _pushRecent(mid) {
  if (!mid) return;
  const next = _loadRecent().filter(x => x !== mid);
  next.unshift(mid);
  _saveList(RECENT_KEY, next.slice(0, RECENT_MAX));
}
function _loadFavorites() { return _loadList(FAVORITES_KEY); }
function _toggleFavorite(mid) {
  const favs = _loadFavorites();
  const i = favs.indexOf(mid);
  if (i >= 0) favs.splice(i, 1);
  else favs.push(mid);
  _saveList(FAVORITES_KEY, favs);
  // Keep the sidebar Models section (same key) in sync if it's mounted.
  try {
    if (window.modelsModule && typeof window.modelsModule.refreshModels === 'function') {
      window.modelsModule.refreshModels();
    }
  } catch { /* sidebar not present */ }
  return i < 0; // true when now favorited
}

// ── Shared keyboard nav for model pickers ──
function _handlePickerKeydown(e, listEl, itemSelector, closeFn) {
  if (e.key === 'Escape') { closeFn(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const active = listEl.querySelector(itemSelector + '.kb-active') || listEl.querySelector(itemSelector);
    if (active) active.click();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...listEl.querySelectorAll(itemSelector)].filter(el => el.style.display !== 'none');
    if (!items.length) return;
    const cur = items.findIndex(el => el.classList.contains('kb-active'));
    items.forEach(el => el.classList.remove('kb-active'));
    let next;
    if (e.key === 'ArrowDown') next = cur < items.length - 1 ? cur + 1 : 0;
    else next = cur > 0 ? cur - 1 : items.length - 1;
    items[next].classList.add('kb-active');
    items[next].scrollIntoView({ block: 'nearest' });
  }
}

// ── Image-model detector (chat-picker filter) ──
// Mirror of settings.js `_isImageModel(mid)` — kept LOCAL on purpose so this
// file doesn't import settings.js (a concurrent surface). SOURCE OF TRUTH:
// frontend/static/js/settings.js `_isImageModel`. Keep this family list + the
// generic-token rule in sync with it. The chat composer's model dropdown must
// never offer a text→image model (it can only 400 on a chat completion); the
// image flow resolves its own model independently (settings.js `_isImageModel`
// / image_model), so filtering here never breaks image generation.
function _isImageModelId(mid) {
  const lower = String(mid || '').toLowerCase();
  const families = [
    'gpt-image', 'dall-e', 'dalle',
    'flux', 'stable-diffusion', 'sdxl', 'sd3', 'sd-', 'playground-v',
    'imagen', 'ideogram', 'recraft', 'kolors', 'kandinsky', 'pixart',
    'firefly', 'titan-image', 'aura-flow', 'hidream', 'seedream',
    'qwen-image', 'wan2', 'janus', 'omnigen', 'cogview', 'chroma',
    'lumina', 'nano-banana', 'photon', 'phoenix', 'luma-photon',
  ];
  if (families.some((kw) => lower.includes(kw))) return true;
  // Generic "image"/"text-to-image" tokens catch newer entrants, but never
  // when paired with a vision/understanding marker (those are chat models).
  if (/image|text-to-image|t2i/.test(lower)) {
    return !/(vision|-vl\b|understand|caption|ocr|embed|rerank)/.test(lower);
  }
  return false;
}

// First non-image, non-offline model across the cached endpoints — the
// arbitrary auto-pick floor. Returns {url, mid, endpointId} or null.
// NEVER selects an image model (ties to the per-model filter above) so the
// composer can't auto-resolve to e.g. gemini-2.5-flash-image.
function _firstChatPick(items) {
  for (const item of (items || [])) {
    if (item.offline) continue;
    const models = (item.models || []).concat(item.models_extra || []);
    for (const mid of models) {
      if (_isImageModelId(mid)) continue;
      return { url: item.url, mid, endpointId: item.endpoint_id };
    }
  }
  return null;
}

// Resolve the auto-pick when nothing is selected. Prefers the CONFIGURED
// default (the server-resolved `/api/default-chat`, cached on
// `window.__orwellDefaultChat` — out-of-box that's deepseek-v4-pro on the
// OpenRouter endpoint) over an arbitrary first-listed model (the "fugu" bug:
// the picker used to grab items[0].models[0]). Falls back to the first chat
// model only when no default is configured / resolvable in the catalog. An
// EXPLICIT user selection is handled earlier by callers — this only fires when
// modelId is empty, so honoring the configured default never overrides a choice.
function _resolveDefaultPick(items) {
  const dc = (typeof window !== 'undefined' && window.__orwellDefaultChat) || null;
  if (dc && dc.model && !_isImageModelId(dc.model)) {
    // Only honor the configured default if the catalog actually offers it
    // (a stale default for a removed endpoint must not pin a dead model).
    const exists = (items || []).some(item => {
      if (item.offline) return false;
      const models = (item.models || []).concat(item.models_extra || []);
      return models.includes(dc.model);
    });
    if (exists) {
      // Prefer the default's own endpoint when it still serves the model.
      const own = (items || []).find(item =>
        !item.offline && String(item.endpoint_id || '') === String(dc.endpoint_id || '')
        && (item.models || []).concat(item.models_extra || []).includes(dc.model));
      if (own) return { url: own.url, mid: dc.model, endpointId: own.endpoint_id };
      const any = (items || []).find(item =>
        !item.offline && (item.models || []).concat(item.models_extra || []).includes(dc.model));
      if (any) return { url: any.url, mid: dc.model, endpointId: any.endpoint_id };
    }
  }
  return _firstChatPick(items);
}

// Best-effort: warm `window.__orwellDefaultChat` so the synchronous auto-pick
// in updateModelPicker() can honor the configured default. Idempotent; fail-soft.
let _defaultChatWarmed = false;
function _warmDefaultChat() {
  if (_defaultChatWarmed) return;
  _defaultChatWarmed = true;
  try {
    fetch(`${API_BASE}/api/default-chat`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(dc => {
        if (dc && dc.model) {
          try { window.__orwellDefaultChat = dc; } catch (_) {}
          // Re-resolve the picker now that the configured default is known —
          // if it auto-picked "fugu" before this landed, correct it.
          try { updateModelPicker(); } catch (_) {}
        }
      })
      .catch(() => {});
  } catch (_) { /* offline / no endpoints — auto-pick floor still applies */ }
}

// Dependencies injected via initModelPicker()
let _deps = null;
let _autoSelectingDefault = false;
// Last model the picker AUTO-selected (no user choice). Lets a late-arriving
// configured default (warmed via /api/default-chat) correct an early arbitrary
// auto-pick, while NEVER touching a model the user explicitly chose.
let _autoPickedMid = null;

function _modelExists(modelId, url) {
  if (!modelId || !window.modelsModule || !window.modelsModule.getCachedItems) return false;
  const items = window.modelsModule.getCachedItems() || [];
  if (!items.length) return true;
  const targetUrl = (url || '').replace(/\/+$/, '');
  return items.some(item => {
    if (item.offline) return false;
    const itemUrl = (item.url || '').replace(/\/+$/, '');
    const models = (item.models || []).concat(item.models_extra || []);
    return models.includes(modelId) && (!targetUrl || itemUrl === targetUrl);
  });
}

/**
 * Initialize the model picker dropdown.
 * @param {Object} deps
 * @param {function} deps.getCurrentSessionId - returns current session ID
 * @param {function} deps.getSessions - returns sessions array
 * @param {function} deps.getPendingChat - returns _pendingChat object
 * @param {function} deps.setPendingChat - sets _pendingChat object
 * @param {function} deps.createDirectChat - creates a new direct chat session
 */
export function initModelPicker(deps) {
  _deps = deps;
  // Warm the configured default (deepseek-v4-pro / OpenRouter out-of-box) so the
  // synchronous auto-pick in updateModelPicker() can honor it from the start
  // rather than landing on an arbitrary first-listed model ("fugu").
  _warmDefaultChat();
  _initModelPickerDropdown();
}

function _initModelPickerDropdown() {
  const wrap = document.getElementById('model-picker-wrap');
  const btn = document.getElementById('model-picker-btn');
  const menu = document.getElementById('model-picker-menu');
  const listEl = document.getElementById('model-picker-list');
  if (!wrap || !btn || !menu || !listEl) return;

  function _close() {
    if (menu.classList.contains('hidden')) return;
    // Restore scroll button
    const _scrollBtn = document.getElementById('scroll-bottom-btn');
    if (_scrollBtn) _scrollBtn.style.display = '';
    menu.classList.add('closing');
    menu.addEventListener('animationend', function _onDone() {
      menu.removeEventListener('animationend', _onDone);
      menu.classList.remove('closing');
      menu.classList.add('hidden');
    }, { once: true });
    // Fallback if animationend doesn't fire
    setTimeout(() => {
      if (!menu.classList.contains('hidden')) {
        menu.classList.remove('closing');
        menu.classList.add('hidden');
      }
    }, 200);
  }

  // Local endpoint health — only probed for LOCAL endpoints, since
  // cloud APIs are essentially always up. Cached briefly on the
  // server side too (8s TTL). Picker opens trigger a refresh.
  let _localProbe = {};            // {endpoint_id: {alive, latency_ms, error}}
  let _localProbeFetchedAt = 0;
  const _LOCAL_PROBE_TTL_MS = 5000;

  async function _refreshLocalProbe() {
    const now = Date.now();
    if (now - _localProbeFetchedAt < _LOCAL_PROBE_TTL_MS) return;
    _localProbeFetchedAt = now;
    try {
      const r = await fetch('/api/model-endpoints/probe-local', { credentials: 'same-origin' });
      if (r.ok) _localProbe = (await r.json()) || {};
    } catch (_) { /* leave stale data; picker still works */ }
  }

  function _getAllModels() {
    const items = (window.modelsModule && window.modelsModule.getCachedItems) ? window.modelsModule.getCachedItems() : [];
    const result = [];
    const seen = new Set();
    items.forEach(item => {
      // Image-generation endpoints belong to the image flow (settings
      // `image_model` / the image step), NOT the chat composer's "Select
      // model" dropdown. Excluding image-ONLY endpoints here keeps them out of
      // EVERY chat-picker path (browse, provider groups, AND search — they all
      // read this one list), so no image model can leak via search. Chat (and
      // chat+image dual-capable) endpoints are untouched. The image flow
      // resolves its model independently (settings.js `_isImageModel`), so this
      // never breaks image generation.
      if ((item.model_type || 'llm') === 'image') return;
      // Previously: offline endpoints were skipped entirely, so a server
      // that briefly went down disappeared from the picker — confusing
      // when the user can still see it (offline-tagged) in Settings.
      // Now: include offline-endpoint models too but flag them
      // `stale: true` so the row renderer dims them + shows the offline
      // pill. The user can still click and try anyway (matches the
      // existing "local server appears offline" path on line 301).
      const epOffline = !!item.offline;
      const allModels = (item.models || []).concat(item.models_extra || []);
      const allDisplay = (item.models_display || []).concat(item.models_extra_display || []);
      // Mark local endpoints whose live probe failed.
      const probeResult = item.endpoint_id ? _localProbe[item.endpoint_id] : null;
      const isLocalDead = !!(probeResult && probeResult.alive === false);
      allModels.forEach((mid, i) => {
        // Per-MODEL image filter. The endpoint-level `model_type==='image'`
        // drop above only catches image-ONLY endpoints; a MIXED endpoint (e.g.
        // an OpenRouter key that serves both chat models AND
        // `google/gemini-2.5-flash-image`, `flux-*`, `dall-e-*`) is model_type
        // 'llm', so its image models would otherwise leak into the chat picker.
        // Filtering here covers EVERY picker path (browse, provider groups,
        // search) since they all read this one list. Belt-and-suspenders with
        // the endpoint-level drop. (Image generation is unaffected — it resolves
        // its model via settings.js `_isImageModel` / image_model.)
        if (_isImageModelId(mid)) return;
        // Deduplicate by model ID — prefer ONLINE endpoint entries over
        // offline duplicates so the user gets a working endpoint first
        // when the same model is exposed by both.
        if (seen.has(mid)) return;
        seen.add(mid);
        result.push({
          mid,
          display: (allDisplay[i] || mid).split('/').pop(),
          url: item.url,
          endpointId: item.endpoint_id,
          epName: item.endpoint_name || '',
          providerText: [
            item.endpoint_name || '',
            item.category || '',
            item.host || '',
            item.url || '',
          ].filter(Boolean).join(' '),
          stale: isLocalDead || epOffline,
          staleReason: epOffline
            ? (item.ping_error || 'endpoint offline')
            : (isLocalDead ? (probeResult.error || 'not responding') : ''),
          offline: epOffline,
        });
      });
    });
    return sortModelObjects(result);
  }

  // ── Provider display names and grouping ──
  const _PROVIDER_NAMES = {
    '01-ai': 'Yi', 'abacusai': 'Abacus AI', 'adept': 'Adept',
    'ai21': 'AI21 Labs', 'ai21labs': 'AI21 Labs', 'aion-labs': 'Aion Labs',
    'aisingapore': 'AI Singapore', 'allenai': 'Allen AI', 'amazon': 'Amazon',
    'anthracite-org': 'Anthracite', 'anthropic': 'Anthropic', 'arcee-ai': 'Arcee AI',
    'baai': 'BAAI', 'baidu': 'Baidu', 'bigcode': 'BigCode',
    'black-forest-labs': 'Black Forest Labs', 'bytedance': 'ByteDance',
    'bytedance-seed': 'ByteDance', 'cognitivecomputations': 'Cognitive Computations',
    'cohere': 'Cohere', 'databricks': 'Databricks', 'deepcogito': 'DeepCogito',
    'deepseek': 'DeepSeek', 'deepseek-ai': 'DeepSeek', 'essentialai': 'Essential AI',
    'google': 'Google', 'gryphe': 'Gryphe', 'ibm': 'IBM',
    'ibm-granite': 'IBM Granite', 'inception': 'Inception',
    'inclusionai': 'Inclusion AI', 'inflection': 'Inflection',
    'kwaipilot': 'KwaiPilot', 'liquid': 'Liquid AI', 'mancer': 'Mancer',
    'meta': 'Llama', 'meta-llama': 'Llama', 'microsoft': 'Microsoft',
    'minimax': 'MiniMax', 'minimaxai': 'MiniMax', 'mistralai': 'Mistral',
    'moonshotai': 'Moonshot', 'morph': 'Morph', 'nex-agi': 'Nex AGI',
    'nousresearch': 'Nous Research', 'nv-mistralai': 'NVIDIA x Mistral',
    'nvidia': 'NVIDIA', 'openai': 'OpenAI', 'openrouter': 'OpenRouter',
    'perceptron': 'Perceptron', 'perplexity': 'Perplexity', 'poolside': 'Poolside',
    'prime-intellect': 'Prime Intellect', 'qwen': 'Qwen', 'rekaai': 'Reka',
    'relace': 'Relace', 'sao10k': 'Sao10k', 'sarvamai': 'Sarvam AI',
    'snowflake': 'Snowflake', 'stepfun': 'StepFun', 'stepfun-ai': 'StepFun',
    'stockmark': 'Stockmark', 'switchpoint': 'SwitchPoint', 'tencent': 'Tencent',
    'thedrummer': 'TheDrummer', 'undi95': 'Undi95', 'upstage': 'Upstage',
    'writer': 'Writer', 'x-ai': 'xAI', 'xiaomi': 'Xiaomi',
    'z-ai': 'Zhipu', 'zyphra': 'Zyphra',
    '~anthropic': 'Anthropic', '~google': 'Google',
    '~moonshotai': 'Moonshot', '~openai': 'OpenAI',
  };
  const _PROVIDER_ALIAS = {
    'meta-llama': 'meta', 'deepseek': 'deepseek-ai', 'minimaxai': 'minimax',
    'stepfun-ai': 'stepfun', 'ai21labs': 'ai21', 'ibm-granite': 'ibm',
    'bytedance-seed': 'bytedance', '~anthropic': 'anthropic',
    '~google': 'google', '~moonshotai': 'moonshotai', '~openai': 'openai',
  };
  function _providerDisplayName(slug) {
    return _PROVIDER_NAMES[slug] || slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
  }
  function _providerSlug(mid) {
    const slash = mid.indexOf('/');
    let slug = slash > 0 ? mid.substring(0, slash) : 'other';
    return _PROVIDER_ALIAS[slug] || slug;
  }
  const _collapsedProviders = new Set(_loadList('orwell-model-collapsed'));
  let _justExpandedProvider = null;

  // The picker has no search field — it always renders the full (chat-only,
  // already image-filtered) browse list. The `filter` arg is retained as a
  // no-op so existing _populate() call sites stay valid.
  function _populate(_filter) {
    listEl.innerHTML = '';
    const all = _getAllModels();
    const hasAnyModel = all.length > 0;
    listEl.classList.toggle('is-empty', !hasAnyModel);
    menu.classList.toggle('no-models', !hasAnyModel);

    if (!hasAnyModel) return; // collapsed empty list — nothing to render

    // Unique lookup so Recent/Favorites (stored as bare model IDs) can be
    // resolved back to full model objects; drops anything no longer offered.
    const byId = new Map();
    all.forEach(m => { if (!byId.has(m.mid)) byId.set(m.mid, m); });

    const favs = _loadFavorites();

    function _addSection(label) {
      const el = document.createElement('div');
      el.className = 'mp-section-label';
      el.textContent = label;
      listEl.appendChild(el);
    }
    function _addRow(m) {
      const row = document.createElement('div');
      row.className = 'model-switch-item';
      if (m.stale) {
        row.classList.add('model-switch-stale');
        row.style.opacity = '0.45';
        row.title = `Local server appears offline: ${m.staleReason}. Click to try anyway, or relaunch in Cookbook.`;
      }
      const _mlogo = providerLogo(m.mid);
      if (_mlogo) {
        const logoSpan = document.createElement('span');
        logoSpan.className = 'provider-logo';
        logoSpan.style.opacity = '0.6';
        logoSpan.innerHTML = _mlogo;
        row.appendChild(logoSpan);
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'mp-model-name';
      nameSpan.textContent = m.display;
      // Long model names are clipped with ellipsis — expose the full name on
      // hover so the suffix/variant tag is still discoverable (#1982).
      nameSpan.title = m.display;
      row.appendChild(nameSpan);
      if (m.stale) {
        const badge = document.createElement('span');
        badge.className = 'model-switch-stale-badge';
        badge.textContent = 'offline';
        badge.style.cssText = 'font-size:10px;opacity:0.7;padding:1px 6px;border:1px solid var(--border);border-radius:8px;margin-left:6px;';
        row.appendChild(badge);
      }
      const epSpan = document.createElement('span');
      epSpan.className = 'model-switch-ep';
      // Don't show endpoint name if it matches the model name (local self-hosted)
      const _epDisplay = m.epName && !m.display.toLowerCase().includes(m.epName.toLowerCase().split('/').pop()) ? m.epName : '';
      epSpan.textContent = _epDisplay;
      row.appendChild(epSpan);

      // Inline favorite dot — toggles favorite, never picks the model.
      const favDot = document.createElement('button');
      favDot.type = 'button';
      favDot.className = 'mp-fav-dot' + (favs.includes(m.mid) ? ' active' : '');
      favDot.textContent = '●';
      const _setFavState = (on) => {
        favDot.classList.toggle('active', on);
        favDot.title = on ? 'Remove from favorites' : 'Add to favorites';
        favDot.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
        favDot.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      _setFavState(favs.includes(m.mid));
      favDot.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowFav = _toggleFavorite(m.mid);
        _setFavState(nowFav);
        favDot.classList.remove('pulse');
        void favDot.offsetWidth;
        favDot.classList.add('pulse');
        // Keep our in-memory copy aligned so a follow-up re-render is correct.
        const idx = favs.indexOf(m.mid);
        if (nowFav && idx < 0) favs.push(m.mid);
        else if (!nowFav && idx >= 0) favs.splice(idx, 1);
        if (uiModule && uiModule.showToast) uiModule.showToast(nowFav ? 'Favorited' : 'Unfavorited');
        // The Favorites section membership changed — rebuild the browse list
        // (cheap: Recent + Favorites), preserving scroll position.
        const st = listEl.scrollTop;
        _populate('');
        listEl.scrollTop = st;
      });
      row.appendChild(favDot);

      row.addEventListener('click', () => _pick(m));
      listEl.appendChild(row);
    }

    // ── Browse: sections in order: Favorites → Recent (big catalogs only) → All / Providers ──
    //   1. Never list the same model twice in the dropdown. Favorites
    //      win over Recent (if you favorited it, that's where it
    //      belongs — Recent shouldn't show it again as duplicate).
    //   2. Small catalogs (≤ BROWSE_ALL_LIMIT total) skip the Recent
    //      section entirely — when there's only ~10 models, the whole
    //      list fits below as "All models" and a separate Recent
    //      section just duplicates rows.
    const shown = new Set();
    const favModels = favs.map(id => byId.get(id)).filter(Boolean);
    if (favModels.length) {
      _addSection('Favorites');
      favModels.forEach(m => { shown.add(m.mid); _addRow(m); });
    }
    // Recent: only render when the catalog is big enough that surfacing
    // a recency shortlist is actually useful, AND only models that
    // aren't already in Favorites (dedupe).
    if (all.length > BROWSE_ALL_LIMIT) {
      const recentModels = _loadRecent()
        .map(id => byId.get(id))
        .filter(Boolean)
        .filter(m => !shown.has(m.mid))
        .slice(0, RECENT_MAX);
      if (recentModels.length) {
        _addSection('Recent');
        recentModels.forEach(m => {
          shown.add(m.mid);
          _addRow(m);
        });
      }
    }

    // Small catalogs: still list everything so users aren't forced to search.
    if (all.length <= BROWSE_ALL_LIMIT) {
      const rest = all.filter(m => !shown.has(m.mid));
      if (rest.length) {
        if (shown.size) _addSection('All models');
        rest.forEach(_addRow);
      }
    } else {
      // Large catalog: show provider groups with collapsible sections.
      const rest = all.filter(m => !shown.has(m.mid));
      const groups = new Map();
      rest.forEach(m => {
        const slug = _providerSlug(m.mid);
        if (!groups.has(slug)) groups.set(slug, []);
        groups.get(slug).push(m);
      });
      const sorted = [...groups.keys()].sort((a, b) =>
        _providerDisplayName(a).localeCompare(_providerDisplayName(b)));

      sorted.forEach(provider => {
        const models = groups.get(provider);
        const isCollapsed = _collapsedProviders.has(provider);
        const header = document.createElement('div');
        header.className = 'mp-provider-header';
        header.innerHTML =
          `<svg class="mp-provider-chevron${isCollapsed ? ' collapsed' : ''}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`
          + `<span class="mp-provider-name">${_providerDisplayName(provider)}</span>`
          + `<span class="mp-provider-count">${models.length}</span>`;
        header.addEventListener('click', (e) => {
          e.stopPropagation();
          if (_collapsedProviders.has(provider)) {
            _collapsedProviders.delete(provider);
            _justExpandedProvider = provider;
          } else {
            _collapsedProviders.add(provider);
            _justExpandedProvider = null;
          }
          _saveList('orwell-model-collapsed', [..._collapsedProviders]);
          const st = listEl.scrollTop;
          _populate('');
          listEl.scrollTop = st;
        });
        listEl.appendChild(header);
        if (!isCollapsed) {
          const group = document.createElement('div');
          group.className = 'mp-provider-group' + (_justExpandedProvider === provider ? ' mp-just-expanded' : '');
          models.forEach(m => {
            _addRow(m);
            // Move the just-appended row into the group container
            group.appendChild(listEl.lastElementChild);
          });
          listEl.appendChild(group);
          if (_justExpandedProvider === provider) _justExpandedProvider = null;
        }
      });
    }
  }

  async function _pick(m) {
    const currentSessionId = _deps.getCurrentSessionId();
    const _pendingChat = _deps.getPendingChat();
    // An explicit user pick — clear the auto-pick marker so the late-default
    // correction never overrides this choice.
    _autoPickedMid = null;

    // Remember this pick so it surfaces under "Recent" next time the picker
    // opens — the whole point of quick-switch.
    if (m && m.mid) _pushRecent(m.mid);

    // Broadcast immediately so listeners (e.g. the tour) can advance without
    // waiting for the async session-create/PATCH that follows.
    try { document.dispatchEvent(new CustomEvent('orwell:model-picked', { detail: m })); } catch {}

    // Blur the active element before closing to dismiss the keyboard on mobile
    if (document.activeElement) document.activeElement.blur();
    _close();
    // Refocus main textarea — skip on mobile to avoid keyboard bounce
    if (!isNarrow()) {
      const _ta = document.getElementById('message');
      if (_ta) setTimeout(() => _ta.focus(), 50);
    }
    if (!currentSessionId && _pendingChat) {
      // Already have a deferred session — just update the model
      _deps.setPendingChat({ url: m.url, modelId: m.mid, endpointId: m.endpointId });
      // Header stays as session name — model switch only updates picker
      updateModelPicker();
      uiModule.showToast(`Using ${m.display}`);
      return;
    } else if (!currentSessionId) {
      // No session yet — create one with this model
      await _deps.createDirectChat(m.url, m.mid, m.endpointId);
    } else {
      // Existing session with no model — PATCH it
      const fd = new FormData();
      fd.append('model', m.mid);
      fd.append('endpoint_url', m.url);
      if (m.endpointId) fd.append('endpoint_id', m.endpointId);
      try {
        const res = await fetch(`${API_BASE}/api/session/${currentSessionId}`, { method: 'PATCH', body: fd });
        if (!res.ok) {
          uiModule.showError('Failed to set model');
          return;
        }
        const sessions = _deps.getSessions();
        const s = sessions.find(x => x.id === currentSessionId);
        if (s) { s.model = m.mid; s.endpoint_url = m.url; }
        // Header stays as session name — model info shown in picker only
      } catch (e) {
        uiModule.showError('Failed to set model: ' + e);
        return;
      }
    }
    // Update picker visibility — model is now set
    updateModelPicker();
    uiModule.showToast(`Using ${m.display}`);
  }

  document.addEventListener('orwell:auto-select-model', async (e) => {
    const detail = (e && e.detail) || {};
    const currentSessionId = _deps.getCurrentSessionId();
    const sessions = _deps.getSessions();
    const current = sessions.find(x => x.id === currentSessionId);
    const pending = _deps.getPendingChat();
    if ((current && current.model) || (pending && pending.modelId)) return;

    if (window.modelsModule && window.modelsModule.refreshModels) {
      try { await window.modelsModule.refreshModels(true); } catch (_) {}
    }
    const items = window.modelsModule && window.modelsModule.getCachedItems ? window.modelsModule.getCachedItems() : [];
    const targetEndpointId = detail.endpointId ? String(detail.endpointId) : '';
    const targetModel = detail.modelId || '';
    let match = null;
    for (const item of items) {
      if (item.offline) continue;
      if (targetEndpointId && String(item.endpoint_id || '') !== targetEndpointId) continue;
      const models = (item.models || []).concat(item.models_extra || []);
      const displays = (item.models_display || []).concat(item.models_extra_display || []);
      const idx = targetModel ? models.indexOf(targetModel) : (models.length ? 0 : -1);
      if (idx >= 0) {
        match = {
          mid: models[idx],
          display: (displays[idx] || models[idx]).split('/').pop(),
          url: item.url || detail.url || '',
          endpointId: item.endpoint_id || detail.endpointId || '',
          epName: item.endpoint_name || detail.endpointName || '',
          providerText: [item.endpoint_name || detail.endpointName || '', item.url || detail.url || ''].filter(Boolean).join(' '),
        };
        break;
      }
    }
    if (!match && detail.modelId && detail.url) {
      match = {
        mid: detail.modelId,
        display: String(detail.modelId).split('/').pop(),
        url: detail.url,
        endpointId: detail.endpointId || '',
        epName: detail.endpointName || '',
        providerText: [detail.endpointName || '', detail.url || ''].filter(Boolean).join(' '),
      };
    }
    if (match) await _pick(match);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden') || menu.classList.contains('closing')) {
      // Force-clear any in-progress close animation
      menu.classList.remove('closing', 'hidden');
      _populate('');
      if (window.modelsModule && window.modelsModule.refreshModels) {
        window.modelsModule.refreshModels().then(() => {
          if (!menu.classList.contains('hidden')) _populate('');
          updateModelPicker();
        }).catch(() => {});
      }
      // Kick off a local-endpoint probe — when it returns, re-render
      // the list so stale local servers get dimmed. Cloud entries
      // aren't probed; they stay visible.
      _refreshLocalProbe().then(() => {
        if (!menu.classList.contains('hidden')) _populate('');
      });
      // Focus the menu so its keydown handler (↑/↓/Enter/Esc) receives keys —
      // skip on mobile to avoid a keyboard/scroll bounce.
      if (!isNarrow()) menu.focus();
      // Hide scroll button so it doesn't overlap
      const _scrollBtn = document.getElementById('scroll-bottom-btn');
      if (_scrollBtn) _scrollBtn.style.display = 'none';
    } else {
      _close();
    }
  });

  // Keyboard nav (↑/↓ to move, Enter to pick, Esc to close) lives on the menu
  // now that the search input — its former host — is gone.
  menu.addEventListener('keydown', (e) => {
    _handlePickerKeydown(e, listEl, '.model-switch-item', _close);
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) {
      _close();
    }
  });
}

/**
 * Update the model picker label to show the current model.
 * Always visible — shows current model name or "Select model" if none.
 * Called after selectSession, createDirectChat, and model switch.
 */
export function updateModelPicker() {
  if (!_deps) return;
  const label = document.getElementById('model-picker-label');
  if (!label) return;
  // Hide model picker when group chat is active
  const wrap = document.getElementById('model-picker-wrap');
  if (window.groupModule && window.groupModule.isActive()) {
    if (wrap) { wrap.style.display = 'none'; }
    return;
  }
  // Reset inline visibility (may have been hidden by typing in previous session)
  if (wrap) {
    wrap.style.display = '';
    wrap.style.opacity = '';
    wrap.style.pointerEvents = '';
  }
  const currentSessionId = _deps.getCurrentSessionId();
  const sessions = _deps.getSessions();
  const _pendingChat = _deps.getPendingChat();
  const s = sessions.find(x => x.id === currentSessionId);
  let modelId = null;
  if (s && s.model) {
    modelId = s.model;
    if (!_modelExists(modelId, s.endpoint_url || '')) {
      modelId = null;
    }
  } else if (_pendingChat && _pendingChat.modelId) {
    modelId = _pendingChat.modelId;
    if (!_modelExists(modelId, _pendingChat.url || '')) {
      _deps.setPendingChat(null);
      modelId = null;
    }
  }
  // Late-default correction: if the current pending model was an arbitrary
  // AUTO-pick (not a user choice) and the configured default has since resolved
  // to a DIFFERENT model, re-point the pending chat at the configured default
  // (the "fugu→deepseek-v4-pro" correction when /api/default-chat lands after a
  // first render). Only touches auto-picks on a pending (unsaved) chat — an
  // explicit selection clears `_autoPickedMid`, so a user's choice is never
  // overridden.
  if (modelId && !currentSessionId && _pendingChat && _autoPickedMid
      && modelId === _autoPickedMid
      && window.modelsModule && window.modelsModule.getCachedItems) {
    const dc = (typeof window !== 'undefined' && window.__orwellDefaultChat) || null;
    if (dc && dc.model && dc.model !== modelId && !_isImageModelId(dc.model)) {
      const items = window.modelsModule.getCachedItems();
      const pick = _resolveDefaultPick(items);
      if (pick && pick.mid === dc.model && pick.mid !== modelId) {
        modelId = pick.mid;
        _autoPickedMid = pick.mid;
        _deps.setPendingChat({ url: pick.url, modelId, endpointId: pick.endpointId });
      }
    }
  }
  // SECURITY: deliberately NOT auto-injecting `orwell-model-favorites[0]`
  // here. localStorage favorites are per-browser, not per-user, so on a
  // shared browser the previous account's first favorited model would
  // silently pre-populate the chatbox of the next user that signed in. If
  // we have no session model and no pending-chat pick, fall through to
  // the "Select model" placeholder below.

  // Check if selected model is still available — fall back ONLY for pending chats with no user selection
  // Never override an existing session's model — the user explicitly chose it
  if (modelId && !currentSessionId && _pendingChat && window.modelsModule && window.modelsModule.getCachedItems) {
    const items = window.modelsModule.getCachedItems();
    const allAvailable = [];
    items.forEach(item => {
      if (item.offline) return;
      (item.models || []).concat(item.models_extra || []).forEach(m => allAvailable.push(m));
    });
    if (allAvailable.length > 0 && !allAvailable.includes(modelId)) {
      // Model no longer available — fall back to the configured default
      // (deepseek-v4-pro / OpenRouter out-of-box) or the first CHAT model,
      // never an arbitrary first-listed (possibly image) model.
      const pick = _resolveDefaultPick(items);
      if (pick) {
        modelId = pick.mid;
        _autoPickedMid = pick.mid;
        _deps.setPendingChat({ url: pick.url, modelId, endpointId: pick.endpointId });
      }
    }
  }
  if (!modelId && !_autoSelectingDefault && window.modelsModule && window.modelsModule.getCachedItems) {
    const items = window.modelsModule.getCachedItems();
    // Honor the CONFIGURED default (deepseek-v4-pro / OpenRouter out-of-box,
    // resolved server-side by /api/default-chat) before falling back to the
    // first chat model. This is the "fugu" fix: the picker used to auto-pick
    // items[0].models[0] — an arbitrary first-sorted model — ignoring the
    // configured default. NEVER an image model. An explicit user selection is
    // handled above (modelId already set), so this only fires when nothing is
    // chosen — the configured default never overrides an explicit pick.
    const pick = _resolveDefaultPick(items);
    if (pick) {
      modelId = pick.mid;
      _autoPickedMid = pick.mid;
      if (!currentSessionId) {
        _deps.setPendingChat({ url: pick.url, modelId, endpointId: pick.endpointId });
      } else {
        if (s) { s.model = modelId; s.endpoint_url = pick.url; }
        _autoSelectingDefault = true;
        const fd = new FormData();
        fd.append('model', modelId);
        fd.append('endpoint_url', pick.url || '');
        if (pick.endpointId) fd.append('endpoint_id', pick.endpointId);
        fetch(`${API_BASE}/api/session/${currentSessionId}`, { method: 'PATCH', body: fd })
          .catch(() => {})
          .finally(() => { _autoSelectingDefault = false; });
      }
    } else {
      // No configured default cached yet — warm it so the next render can
      // honor it instead of leaving the picker stuck on an arbitrary pick.
      _warmDefaultChat();
    }
  }

  const displayName = modelId ? modelId.split('/').pop() : 'Select model';
  // The header indicator clips long names with ellipsis; show the full model
  // identifier on hover (#1982). No tooltip on the "Select model" placeholder.
  label.title = modelId || '';
  const logo = modelId ? providerLogo(modelId) : null;
  if (logo) {
    label.innerHTML = '<span class="model-picker-logo">' + logo + '</span> ' + displayName;
  } else {
    label.textContent = displayName;
  }
}

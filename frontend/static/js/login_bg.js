// login_bg.js — the admin-configurable animated background behind the login
// glass panel (issue #764).
//
// The login page is PRE-AUTH, so this module reads ONLY a cosmetic config — a
// source enum + per-source cosmetic settings (gradient preset/speed/intensity,
// particle density/speed/color, photo URL). Never anything sensitive. The value
// comes from the PUBLIC cosmetic GET /api/auth/login-background (and the module
// paints the gradient default until it resolves, so the panel never sits over a
// blank void).
//
// Background sources (#764):
//   gradient  — a soft-focus animated MESH gradient (DEFAULT), Apple Sequoia /
//               iOS "aurora" wallpaper idiom, with named palette presets.
//   photo     — a static bundled image OR an admin-provided/uploaded URL.
//   particles — a lightweight self-contained particle canvas (no external lib).
//   bundled   — reuse the app's bg-pattern-* / perlin-flow system (theme.js).
//
// prefers-reduced-motion freezes EVERYTHING to a static mesh (no animation, no
// canvas rAF) — Apple Liquid Glass accessibility rule.

const REDUCED_MOTION = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (_) { return false; }
})();

const VALID_SOURCES = new Set(['gradient', 'photo', 'particles', 'bundled']);
const GRADIENT_PRESETS = new Set(['sunset', 'aurora', 'ocean', 'gold', 'lavender']);

function _clamp(n, lo, hi, dflt) {
  n = Number(n);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function _normalize(cfg) {
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  let source = String(cfg.source || 'gradient').toLowerCase();
  if (!VALID_SOURCES.has(source)) source = 'gradient';

  // gradient cosmetic settings
  const g = cfg.gradient && typeof cfg.gradient === 'object' ? cfg.gradient : {};
  let preset = String(g.preset || 'aurora').toLowerCase();
  if (!GRADIENT_PRESETS.has(preset)) preset = 'aurora';
  const gradient = {
    preset,
    speed: _clamp(g.speed, 8, 60, 26),       // seconds per drift cycle
    intensity: _clamp(g.intensity, 0.4, 1.4, 1),
  };

  // particle cosmetic settings
  const pp = cfg.particles && typeof cfg.particles === 'object' ? cfg.particles : {};
  let dotColor = typeof pp.color === 'string' ? pp.color.trim() : '';
  // only a hex / rgb(a) / named color is cosmetic-safe; anything weird → default.
  if (dotColor && !/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i.test(dotColor)) dotColor = '';
  const particles = {
    density: _clamp(pp.density, 12, 160, 64),
    speed: _clamp(pp.speed, 0.05, 1.2, 0.25),
    color: dotColor || 'rgba(255,255,255,0.55)',
  };

  // photo_url is cosmetic-only; only honor http(s) or a same-origin "/" path.
  let photoUrl = typeof cfg.photo_url === 'string' ? cfg.photo_url.trim() : '';
  if (photoUrl && !/^(https?:\/\/|\/)/i.test(photoUrl)) photoUrl = '';

  return { source, gradient, particles, photoUrl };
}

// ── The animated mesh gradient (default + the reduced-motion fallback) ──
function _mountGradient(host, { animate, gradient }) {
  const el = document.createElement('div');
  el.className = 'login-bg login-bg-gradient' + (animate ? ' is-animated' : '');
  el.setAttribute('aria-hidden', 'true');
  if (gradient) {
    el.setAttribute('data-lbg-preset', gradient.preset);
    el.style.setProperty('--lbg-speed', gradient.speed + 's');
    el.style.setProperty('--lbg-intensity', String(gradient.intensity));
  }
  host.appendChild(el);
  return el;
}

// ── Photo ──
function _mountPhoto(host, photoUrl, gradient) {
  // Always paint the gradient first as a graceful base (covers a slow/broken
  // image load — the panel never sits over a blank void).
  _mountGradient(host, { animate: false, gradient });
  const url = photoUrl || '/static/img/login-bg.jpg'; // bundled fallback path
  const el = document.createElement('div');
  el.className = 'login-bg login-bg-photo';
  el.setAttribute('aria-hidden', 'true');
  // Probe the image; only swap it in if it actually loads (else the gradient stays).
  const probe = new Image();
  probe.onload = () => {
    el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    host.appendChild(el);
  };
  probe.onerror = () => { /* keep the gradient base */ };
  probe.src = url;
  return el;
}

// ── Particles (self-contained canvas; frozen under reduced motion) ──
function _mountParticles(host, { animate, particles, gradient }) {
  // Gradient base behind the particles so the glass always has color to refract.
  _mountGradient(host, { animate: false, gradient });
  const canvas = document.createElement('canvas');
  canvas.className = 'login-bg login-bg-particles';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const N = Math.round(particles.density);
  const SPEED = particles.speed;
  const COLOR = particles.color;
  let raf = 0, w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pts = [];
  function reset() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    pts.length = 0;
    for (let i = 0; i < N; i++) {
      pts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED, vy: (Math.random() - 0.5) * SPEED,
        r: 1 + Math.random() * 2,
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120) {
          const a = (1 - Math.sqrt(d2) / 120) * 0.18;
          ctx.strokeStyle = `rgba(255,255,255,${a})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
    ctx.fillStyle = COLOR;
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function step() {
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    draw();
    raf = requestAnimationFrame(step);
  }
  reset(); seed();
  if (animate) { step(); } else { draw(); }
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { reset(); seed(); if (!animate) draw(); }, 150);
  });
  return canvas;
}

// ── Bundled (reuse theme.js's bg-pattern system / perlin-flow) ──
async function _mountBundled(host, { gradient }) {
  // Gradient base so the glass has color even before/if the pattern fails.
  _mountGradient(host, { animate: false, gradient });
  try {
    const tm = await import('/static/js/theme.js');
    // perlin-flow is the app's signature animated wallpaper. theme.js honors
    // prefers-reduced-motion itself (renders a still frame), so we call through.
    if (tm.applyBgPattern) tm.applyBgPattern('perlin-flow');
  } catch (e) {
    console.error('[login-bg] bundled pattern failed:', e);
  }
}

export async function initLoginBackground(rawCfg) {
  const cfg = _normalize(rawCfg);
  let host = document.getElementById('login-bg-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'login-bg-host';
    host.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(host, document.body.firstChild);
  }
  document.body.setAttribute('data-login-bg', cfg.source);

  const animate = !REDUCED_MOTION;
  switch (cfg.source) {
    case 'photo':     _mountPhoto(host, cfg.photoUrl, cfg.gradient); break;
    case 'particles': _mountParticles(host, { animate, particles: cfg.particles, gradient: cfg.gradient }); break;
    case 'bundled':   await _mountBundled(host, { gradient: cfg.gradient }); break;
    case 'gradient':
    default:          _mountGradient(host, { animate, gradient: cfg.gradient }); break;
  }
  return cfg.source;
}

// Auto-init: prefer the server-inlined config; fall back to the public GET.
(async () => {
  let cfg = (typeof window !== 'undefined' && window.__loginBg) || null;
  if (!cfg) {
    try {
      const r = await fetch('/api/auth/login-background', { credentials: 'same-origin' });
      if (r.ok) cfg = await r.json();
    } catch (_) { /* fall through to the gradient default */ }
  }
  try { await initLoginBackground(cfg); }
  catch (e) { console.error('[login-bg] init failed:', e); }
})();

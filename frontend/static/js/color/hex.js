// static/js/color/hex.js
//
// Parse a CSS hex color into {r, g, b}. Pure — no DOM — so it can be reused
// across modules and unit-tested under node.

// Accepts "#rgb", "#rrggbb" (with or without the leading '#'). Returns null
// for anything that isn't a valid 3- or 6-digit hex color.
export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ── WCAG relative luminance + contrast ───────────────────────────────────────
// Standard sRGB relative-luminance formula (WCAG 2.x, §relativeluminancedef).
// `rgb` is {r,g,b} in 0..255. Returns 0..1.
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG contrast ratio between two relative luminances (order-independent).
// Returns a value in [1, 21].
export function contrastRatioFromLum(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Contrast ratio between two hex colors. Returns 1 if either fails to parse
// (fail-safe: an unparseable input never claims to pass AA).
export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 1;
  return contrastRatioFromLum(relativeLuminance(a), relativeLuminance(b));
}

// The "near-white" / "near-dark" foreground candidates for text sitting ON an
// accent-colored surface. Dark is a desaturated near-black (matches the app's
// dark palette) rather than pure #000 so it reads as intentional ink, not a
// hole. Exported so the CSS :root default + tests stay in lockstep.
export const ON_ACCENT_LIGHT = '#ffffff';
export const ON_ACCENT_DARK = '#10151b';

// Luminance-aware text color for a given accent background: whichever of the
// light/dark candidates yields the HIGHER WCAG contrast ratio against the
// accent. This is the fix for white-on-brand-red (≈3.2:1) failing AA — for a
// mid-tone accent the dark ink wins and clears 4.5:1. Falls back to light on an
// unparseable accent (safe default for the historically-dark themes).
export function onAccentColor(accentHex) {
  const acc = hexToRgb(accentHex);
  if (!acc) return ON_ACCENT_LIGHT;
  const lum = relativeLuminance(acc);
  const cLight = contrastRatioFromLum(lum, relativeLuminance(hexToRgb(ON_ACCENT_LIGHT)));
  const cDark = contrastRatioFromLum(lum, relativeLuminance(hexToRgb(ON_ACCENT_DARK)));
  return cDark > cLight ? ON_ACCENT_DARK : ON_ACCENT_LIGHT;
}

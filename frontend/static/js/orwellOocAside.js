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
//   detectOocAside(text) — the single source of truth for "is this player line an
//   OOC aside?" + the normalized display text (markers stripped). Used by the bubble
//   renderer (chatRenderer.addMessage) to style the player's own OOC message distinctly
//   — clearly an aside to production, NOT a spoken-in-room line.
//
// SCOPE (audit L36 + follow-on): this module is the player-INPUT detector. The MODEL's
// OOC *answers* are also rendered as a producer/HUD aside — keyed to a REAL engine
// marker (the GM wraps its whole OOC reply in `((...))` per the momentPrompts prompt
// contract), recognised by the SAME `detectOocAside` here and styled by chatRenderer
// (the assistant branch). Never a heuristic guess on free narration — only a fully-
// `((...))`-wrapped reply is treated as an aside.
//
// NOTE: the old one-time composer TIP that surfaced the convention is GONE — the
// chat-bar hint surface now lives in the shared orwellChatHint.js component (which
// ships with NO active tips). The `((...))` / `ooc:` INPUT detection below is the
// load-bearing half and stays exactly as it was.
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

if (typeof window !== 'undefined') {
  // Test/debug seam for the headless browser gate.
  window._orwellOocDetect = detectOocAside;
}

export default { detectOocAside, isOocAside };

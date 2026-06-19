// orwellToolBeats — the SINGLE source of truth for the C14/C19 immersion treatment:
// every engine/agent tool the GM can pull renders as a quiet, diegetic production
// "beat" (a label + status), never its raw camelCase name or its raw JSON payload.
//
// Both render paths import this:
//   • live stream    → chat.js   (relabel + clear cmd/output as tools run)
//   • history reload → chatRenderer.js (same treatment when a session is re-opened)
// Keeping it here prevents the two paths from drifting — a tool added to the live
// path but not the reload path was leaking raw names + engine JSON on every reload.
export const ORWELL_TOOL_BEATS = {
  'createCharacter': '🎬 Casting',
  'getGameState': '📋 Production notes',
  'gameStatus': '📋 Production notes',
  'getVisibleStateFor': '📋 Production notes',
  'getMomentPrompt': '📋 Production notes',
  'runCompetition': '🏆 Competition',
  'advanceGame': '📺 Production',
  'submitDecision': '🗳 Your move',
  'recordInteraction': '🎬 Scene log',
  'surfaceInformationTo': '🤫 Word travels',
  'socialRead': '👀 Reading the room',
  // Owner ruling 2026-06-18: NPC approach-INTENT never surfaces to the player — not even as a
  // beat label that says someone "wants a word". The GM reads the house's social pull privately and
  // voices any approach organically in chat, so this reads as a neutral "reading the house" beat.
  'socialInitiatives': '🏠 Reading the house',
  'diaryRoom': '📔 Diary Room',
  'makeDeal': '🤝 Handshake',
  'askProducers': '🎙 Producers',
  'renderScene': '📺 Production',
  'endOfSessionSummary': '📼 Tape check',
  'finaleView': '👑 Finale',
  // D5/W6: EVERY keep-set tool the agent can pull renders diegetically —
  // raw camelCase names in the transcript are the C14/C19 immersion bleed.
  'updateCasting': '\u{1F3AC} Casting notes',
  'whereabouts': '\u{1F9ED} Around the house',
  'moveTo': '\u{1F6B6} Moving through the house',
  'seasonRecap': '\u{1F4DC} The season so far',
  'seasonRetrospective': '\u{1F513} The producers’ vault',
  'npcVoice': '\u{1F3AD} In their head',
  'inspectNonVaultState': '\u{1F50E} Control room',
  'overrideMechanic': '\u{1F39B} Control room',
  'configureGame': '\u{1F39B} Control room',
  'manageSandbox': '\u{1F39B} Control room',
  'sandboxHealth': '\u{1F39B} Control room',
  'web_search': '\u{1F4E1} Checking the feeds',
  'ask_user': '\u{1F399} A question for you',
  'update_plan': '\u{1F4CB} Production notes',
  'ui_control': '\u{1F4FA} Camera direction',
  'generate_image': '\u{1F4F8} Photo booth',
  'search_chats': '\u{1F4DC} The archive',
  'list_models': '\u{1F4E1} Checking the feeds',
  'manage_settings': '\u{1F39B} Control room',
  'manage_endpoints': '\u{1F39B} Control room',
  'manage_tokens': '\u{1F39B} Control room',
  'manage_mcp': '\u{1F39B} Control room',
};

export function orwellBeat(tool) {
  return (tool && ORWELL_TOOL_BEATS[tool]) || null;
}

// L42 — the PUBLIC outcome of a solidified beat (so the chat shows WHAT happened, not a stack of
// identical "PRODUCTION done" rows). Derived ONLY from the tool RESULT's player-witnessed, Vault-free
// fields: the resolved beat's `event.content` (a short diegetic sentence the engine already exposes —
// "Maya nominates Cole and Jess", "Troy is evicted"), the crowned `winner`, and, for an eviction, the
// anonymized ballot count from the staged `eviction.votesRevealed` (E12: ballots, never voters). No
// hidden state is ever read here — these are the same facts the player sees on the ceremonies.
const _BEAT_ICON = {
  'hoh-competition': '🏆', 'veto-competition': '💎', 'veto-draw': '🎟️', 'nominations': '🔨',
  'veto-ceremony': '💎', 'eviction': '🗳️', 'eviction-result': '🗳️', 'eviction-reveal': '🗳️',
  'eviction-goodbye': '💌', 'final-eviction': '🗳️', 'finale': '👑', 'finale-reveal': '👑',
  'finale-result': '👑', 'twist-reveal': '🌀',
};

export function orwellBeatOutcome(tool, output) {
  if (!output) return null;
  let r;
  try { r = typeof output === 'string' ? JSON.parse(output) : output; }
  catch (_) { return null; }
  if (!r || typeof r !== 'object') return null;
  // A crowned winner trumps everything.
  if (r.finished && r.winner && r.winner.name) return `👑 ${r.winner.name} wins the season`;
  const ev = r.event;
  if (!ev || !ev.content) return null;
  const icon = _BEAT_ICON[ev.beat] || '•';
  let content = String(ev.content);
  // Append the anonymized ballot tally for a resolved eviction, when the staged ballots are present.
  if (/eviction|final-eviction/.test(ev.beat || '') && r.eviction && Array.isArray(r.eviction.votesRevealed) && r.eviction.votesRevealed.length) {
    const counts = {};
    for (const v of r.eviction.votesRevealed) {
      const n = v && v.votedFor && v.votedFor.name;
      if (n) counts[n] = (counts[n] || 0) + 1;
    }
    const nums = Object.values(counts).sort((a, b) => b - a);
    if (nums.length) content += ` (${nums.join('-')})`;
  }
  return `${icon} ${content}`;
}

export function isGameBuild() {
  return !!(typeof document !== 'undefined' && document.body && document.body.hasAttribute('data-game-build'));
}

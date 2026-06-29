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
  // 0061: the player signalled they may want to walk out — a quiet producer-aside beat.
  'requestSelfEviction': '🚪 A word with production',
  'recordInteraction': '🎬 Scene log',
  'surfaceInformationTo': '🤫 Word travels',
  'socialRead': '👀 Reading the room',
  // Owner ruling 2026-06-18: NPC approach-INTENT never surfaces to the player — not even as a
  // beat label that says someone "wants a word". The GM reads the house's social pull privately and
  // voices any approach organically in chat, so this reads as a neutral "reading the house" beat.
  'socialInitiatives': '🏠 Reading the house',
  'diaryRoom': '📔 Diary Room',
  'makeDeal': '🤝 Handshake',
  // 0107: the player names a pact / accepts an NPC's pitch into a named alliance.
  'formAlliance': '👥 Naming an alliance',
  'joinAlliance': '👥 Joining an alliance',
  // 0093/0099: out a learned secret to the house / trade it to a houseguest for a favor.
  'exposeSecret': '🗣 Outing a secret',
  'tradeSecret': '🔁 Trading a secret',
  // 0075: the player presses an ally to open up; the engine decides the disclosure.
  'confide': '🤫 Confiding',
  'askProducers': '🎙 Producers',
  'renderScene': '📺 Production',
  'endOfSessionSummary': '📼 Tape check',
  'finaleView': '👑 Finale',
  // D5/W6: EVERY keep-set tool the agent can pull renders diegetically —
  // raw camelCase names in the transcript are the C14/C19 immersion bleed.
  'updateCasting': '\u{1F3AC} Casting notes',
  'whereabouts': '\u{1F9ED} Around the house',
  'moveTo': '\u{1F6B6} Moving through the house',
  'premiereIntros': '\u{1F44B} Meeting the house',
  'markHouseguestMet': '\u{1F91D} First impressions',
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

// ADR 0011 — PURE CONTEXT-READ beats. The model fires these to GROUND itself (read the board, the
// room, a houseguest's read); they change NOTHING the player witnessed, carry no public outcome, and
// on a long / concurrent-re-ground turn they stack as a wall of identical "📋 Production notes" rows —
// the operator's "too much LLM rendered in the FE" garbage. In the game build BOTH render paths skip
// them entirely; the meaningful beats (comps, ceremonies, scene logs, deals, moves) still show.
// (Engine READS only — never a mutation — so dropping the chip loses no player-facing fact.)
export const ORWELL_SILENT_BEATS = new Set([
  'getGameState', 'gameStatus', 'getVisibleStateFor', 'getMomentPrompt',
  'whereabouts', 'socialRead', 'socialInitiatives', 'npcVoice', 'seasonRecap',
  'inspectNonVaultState', 'sandboxHealth', 'list_models', 'search_chats',
]);

export function orwellBeatIsSilent(tool) {
  return ORWELL_SILENT_BEATS.has(tool);
}

// ADR 0011 — the per-turn beat-rail BACKSTOP. Even after silent beats are dropped and the loop's
// beat-aware staleness fix lands, a pathological turn must never stack an unbounded column of chips.
// Both render paths keep the most recent N solidified beats and drop older overflow. Generous on
// purpose — a normal turn (a handful of beats) never hits it; this is a safety net, not a budget.
export const ORWELL_MAX_VISIBLE_BEATS = 10;

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

// static/js/chatState.js

/**
 * #1414 (R3 PR0): the shared mutable-state singleton for the chat subsystem.
 *
 * chat.js is being decomposed (docs/REFACTOR-ROADMAP.md, R3) into focused modules
 * (submit, outbox, reconcile, stream-loop, …). Those fragments must MUTATE the same
 * module-level flags/queues that today live as bare `let`s inside chat.js — but an
 * ES-module imported binding is READ-ONLY: you cannot `import { isStreaming }` from a
 * sibling module and then reassign it. So every piece of chat.js's cross-cluster
 * mutable state moves onto this ONE exported object; consumers read/write its FIELDS
 * (`chatState.isStreaming = …`) and never re-bind the import. Every single-flight guard
 * (`isStreaming`, `_sendInFlight`, `_flushingOutbox`, `_outboxRestoreDone`) therefore
 * resolves to the SAME instance across the submit, outbox, and reconcile paths — which
 * is the whole point of the enabler.
 *
 * PR0 is behavior-preserving: no functions have moved yet. chat.js still owns all the
 * logic and simply references `chatState.X` where it used to reference `X`. The arrays,
 * Maps, and Sets below are created ONCE and only ever mutated in place (push/splice/
 * length=0/add/delete/clear) — never reassigned — so a reference captured elsewhere
 * (e.g. `chatModule._sendOutbox`) stays live.
 *
 * Dual-load idempotent (#1399 generalized): chat.js must evaluate exactly once per page,
 * but if this module were ever pulled in twice we reuse the first instance rather than
 * clobbering live queues/flags. Window-guarded so non-browser (test import) contexts are
 * unaffected and each gets a fresh object.
 */

function _makeChatState() {
  return {
    // ── streaming / send single-flight ──────────────────────────────────────
    isStreaming: false,       // a turn is actively streaming
    currentAbort: null,       // AbortController for the live reader loop
    _sendInFlight: false,     // covers the window from click → streaming start
    _streamSessionId: null,   // session id for the currently active reader loop

    // ── display / continue cues ─────────────────────────────────────────────
    _displayOverride: null,   // override visible user bubble text (hides injected prompts)
    _hideUserBubble: false,   // skip the user bubble entirely (e.g. continue after stop)
    _pendingContinue: null,   // stopped AI element to merge with the next response

    // ── auto-recovery ───────────────────────────────────────────────────────
    _autoNudges: 0,               // handshakes fired for the CURRENT user turn
    _autoContinuePending: false,  // next submit is an auto-continue (don't reset the counter)

    // ── send outbox (#985 P2-A / #891 / #830) ───────────────────────────────
    _sendOutbox: [],              // queued sends (FIFO), reload-durable
    _outboxAwaitingConfirm: [],   // dispatched, not yet server-confirmed
    _outboxFailed: [],            // terminally-failed items (durable)
    _flushingOutbox: false,       // single-flight: one flush send dispatched at a time
    _outboxRestoreDone: false,    // boot restore runs once per page

    // ── cross-device reconcile (ADR 0008/0012) ──────────────────────────────
    _pendingReconcile: new Set(),
    _pendingPeerResume: new Set(),
    _forceRebuild: new Set(),

    // ── background / resume / research streams ───────────────────────────────
    _backgroundStreams: new Map(),    // sessionId -> { status, accumulated, sourcesHtml, … }
    _resumingStreams: new Set(),      // sessionId -> a resumeStream() reader is live (re-attach lock)
    _researchingStreamIds: new Set(), // sessions with a research op in flight
  };
}

export const chatState =
  (typeof window !== 'undefined' && window.__orwellChatState)
    ? window.__orwellChatState
    : _makeChatState();

if (typeof window !== 'undefined' && !window.__orwellChatState) {
  window.__orwellChatState = chatState;
}

export default chatState;

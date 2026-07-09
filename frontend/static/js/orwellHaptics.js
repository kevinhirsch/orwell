// ============================================
// Orwell haptics + audio beat channel (issue #745)
// ============================================
// A sub-second AUDIO cue + navigator.vibrate() pulse on the game's CEREMONY /
// DECISION beats — crown / noms-locked / veto / eviction / decision-confirm.
// This is supplementary feedback in the spirit of Apple's "motion optional +
// supplement with haptics/audio" guidance: the beat is ALREADY visible (the
// status HUD, the decision card, the ceremony narration). This adds a tactile +
// auditory accent so a consequential moment registers on a phone in your pocket.
//
// ─── Vault Wall ───────────────────────────────────────────────────────────────
// The trigger reads ONLY the public beat REASON/PHASE — the debounced
// `orwell:gamechanged` reason string ("tool:runCompetition", "decision:<kind>")
// and the `orwell:pending` PendingDecisionView KIND. It never reads, derives, or
// reacts to any secret/Vault state (who is targeted, the outcome, the votes).
// Distinct cues distinguish only the BEAT TYPE, which is already public.
//
// ─── Gating ───────────────────────────────────────────────────────────────────
//  • A user setting `orwell-haptics` (localStorage). DEFAULT ON — it is a light,
//    fail-soft accent on an already-visible beat; the settings toggle (in
//    Appearance ▸ Chat Area) lets anyone turn it off. ("on" / "off"; absent ⇒ on.)
//  • prefers-reduced-motion: when the user asks for reduced motion we go SILENT
//    (no vibrate, no tone) — matching the accessibility contract that motion is
//    optional and supplements, never forces, feedback.
//
// ─── Fail-soft ────────────────────────────────────────────────────────────────
// No AudioContext (older browser, autoplay-blocked, suspended) ⇒ the tone is a
// silent no-op. No navigator.vibrate (desktop, iOS Safari) ⇒ the pulse is a
// silent no-op. Nothing here ever throws; every entry point is try/catch-wrapped.
//
// Self-registering: imported once by platform.js (the dispatcher hub, always
// loaded) so it attaches its window listeners with no index.html change.
(function () {
  "use strict";

  if (typeof window === "undefined") return;
  // Idempotent: a double import (module + a stray classic include) must not
  // double-bind the listeners and fire every cue twice.
  if (window.__orwellHapticsInstalled) return;
  window.__orwellHapticsInstalled = true;

  var SETTING_KEY = "orwell-haptics";
  var AUDIO_KEY = "orwell-haptics-audio";

  // ── Setting + reduced-motion / reduced-transparency gate ───────────────────
  function enabled() {
    try {
      // Default ON: only an explicit "off" disables.
      if (localStorage.getItem(SETTING_KEY) === "off") return false;
    } catch (_) { /* private mode / no storage ⇒ treat as default-on */ }
    return true;
  }

  // Audio sub-toggle: the vibration pulse and the chime silence INDEPENDENTLY, so a
  // player can keep the tactile buzz in a quiet room without the tone (or vice-versa).
  // Default ON — only an explicit "off" mutes the tone; vibration still fires.
  function audioEnabled() {
    try {
      if (localStorage.getItem(AUDIO_KEY) === "off") return false;
    } catch (_) { /* no storage ⇒ default-on */ }
    return true;
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  }

  // A player who asked for REDUCED TRANSPARENCY has signalled they want a calmer, less
  // "material" experience; honour that as also opting out of the tactile/auditory accent
  // (part of the Liquid Glass a11y trio — #738 #29). Silent, never forced.
  function reducedTransparency() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-transparency: reduce)").matches);
    } catch (_) { return false; }
  }

  function active() {
    return enabled() && !reducedMotion() && !reducedTransparency();
  }

  // ── Cue table — beat type → { vibe: [ms…], tone: [{f,ms,gap?}…] } ──────────
  // Each cue is sub-second. `vibe` is a navigator.vibrate pattern (pulse/gap ms);
  // `tone` is a short sequence of sine blips. Distinct shapes per beat so the
  // ear/hand can tell them apart without looking — but they encode only the
  // public BEAT TYPE, never any secret outcome.
  var CUES = {
    // The HOH/veto crown lands — a rising two-note flourish + a firm double buzz.
    crown:     { vibe: [40, 40, 90],         tone: [{ f: 587, ms: 90 }, { f: 880, ms: 150 }] },
    // Nominations locked — two even, sober taps.
    noms:      { vibe: [60, 60, 60],         tone: [{ f: 392, ms: 110 }, { f: 392, ms: 110 }] },
    // Veto wielded — a quick bright triple, like a reprieve.
    veto:      { vibe: [30, 30, 30, 30, 60], tone: [{ f: 659, ms: 70 }, { f: 784, ms: 70 }, { f: 988, ms: 130 }] },
    // Eviction — a single long, low, heavy pulse.
    eviction:  { vibe: [200],                tone: [{ f: 277, ms: 230 }] },
    // A bound decision confirmed — one short, neutral acknowledgement tap.
    decision:  { vibe: [25],                 tone: [{ f: 523, ms: 70 }] },
  };

  // ── Audio (fail-soft, lazily created, shared) ──────────────────────────────
  var _ctx = null;
  function ctx() {
    if (_ctx) return _ctx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _ctx = new AC();
    } catch (_) { _ctx = null; }
    return _ctx;
  }

  function playTone(seq) {
    var c = ctx();
    if (!c) return;                         // no audio ⇒ silent no-op
    try {
      // A context can be suspended until a user gesture; resume best-effort but
      // never await — if it stays suspended the blips are simply inaudible.
      if (c.state === "suspended" && c.resume) { c.resume().catch(function () {}); }
      var t = c.currentTime;
      for (var i = 0; i < seq.length; i++) {
        var note = seq[i];
        var dur = (note.ms || 80) / 1000;
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = "sine";
        osc.frequency.value = note.f || 440;
        // Tiny attack/release envelope so the blip doesn't click; peak kept low.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(c.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur + ((note.gap || 30) / 1000);
      }
    } catch (_) { /* fail-soft — never break a beat over a missing audio path */ }
  }

  function pulse(pattern) {
    try {
      if (navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate(pattern);          // no-op / ignored where unsupported
      }
    } catch (_) { /* fail-soft */ }
  }

  function fire(beat) {
    if (!active()) return;                   // setting off OR reduced-motion ⇒ nothing
    var cue = CUES[beat];
    if (!cue) return;
    pulse(cue.vibe);
    if (audioEnabled()) playTone(cue.tone); // the chime is independently mutable
  }
  // Exposed for tests / manual triggering; harmless to call.
  window.orwellHapticsFire = fire;

  // ── Beat classification — PUBLIC reason/kind ONLY ──────────────────────────
  // gamechanged reasons: "tool:runCompetition", "decision:<kind>", "turn-settled"…
  function beatForReason(reason) {
    reason = String(reason || "");
    if (reason === "tool:runCompetition") return "crown";
    if (reason.indexOf("decision:") === 0) {
      var kind = reason.slice("decision:".length);
      return beatForDecisionKind(kind);
    }
    return null;
  }

  // PendingDecisionView.kind (or the suffix of a "decision:<kind>" reason) →
  // beat. The veto comp result rides the crown beat (runCompetition); the veto
  // CEREMONY (use/save) and the replacement nom are the "veto" beat.
  function beatForDecisionKind(kind) {
    kind = String(kind || "");
    if (kind === "nominations") return "noms";
    if (kind === "veto-decision" || kind === "replacement") return "veto";
    if (kind === "eviction-vote" || kind === "final-eviction" ||
        kind === "tie-break" || kind === "self-evict") return "eviction";
    if (!kind) return null;
    // Any other bound decision (comp-intent, goodbye, finale beats…) → the
    // neutral confirm acknowledgement.
    return "decision";
  }
  // Exposed for tests so the public-reason → beat map is gate-pinned.
  window.orwellHapticsBeatFor = beatForReason;

  // ── Wiring ─────────────────────────────────────────────────────────────────
  // The CONFIRM beat: a bound decision fires `orwell:gamechanged` with
  // "decision:<kind>", and a comp result fires "tool:runCompetition". This is the
  // primary, deliberate trigger — it lands exactly when the player commits / a
  // crown is decided.
  window.addEventListener("orwell:gamechanged", function (e) {
    try {
      var reason = e && e.detail && e.detail.reason;
      var beat = beatForReason(reason);
      if (beat) fire(beat);
    } catch (_) { /* fail-soft */ }
  });

  // Best-effort: prime/resume the shared AudioContext on the player's first real
  // gesture so the very first cue isn't swallowed by the autoplay policy. Listens
  // once; never blocks. (A cue that lands before any gesture stays a silent no-op,
  // which is the correct fail-soft behaviour.)
  function _prime() {
    try { var c = ctx(); if (c && c.state === "suspended" && c.resume) c.resume().catch(function () {}); } catch (_) {}
    window.removeEventListener("pointerdown", _prime, true);
    window.removeEventListener("keydown", _prime, true);
  }
  window.addEventListener("pointerdown", _prime, true);
  window.addEventListener("keydown", _prime, true);
})();

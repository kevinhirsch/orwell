// Orwell session-detach guard (ship-blocker A6) — "the New Chat hazard".
//
// The logo click, the "New Chat" sidebar row, the icon-rail "+", and the composer's dual-purpose
// Send-as-New-Chat mode are workspace-chrome affordances that make sense for a generic chat app
// (throwaway sessions, cheap to recreate) but are CATASTROPHIC here: a season is stateful,
// long-running, single-instance play — there is no "just re-open it." Left ungated, all four
// silently step the player away from their live, in-progress season with NO confirmation and NO
// obvious way back. This is the sibling of the A2 fabricated-eviction bug: both cost the player
// their game state without their knowledge.
//
// The fix lives HERE as one shared chokepoint (`window._orwellConfirmLeaveGame`) that every
// entry point calls before it detaches: game-build only, Vault-free (reads only the public
// `/api/orwell/state` projection), and fails OPEN in every direction that matters —
//   • outside the game build: always resolves true (the generic chat app's New Chat is untouched);
//   • no live game (pre-game, or the season already reached its post-season hand-off): true,
//     nothing to lose, no dialog;
//   • the confirm UI itself unavailable: true (never trap the player behind a dialog that can't
//     render);
//   • the state fetch fails (engine hiccup): true (never block navigation on a transient network
//     blip — better a rare missed confirmation than a stuck app).
// Concurrent callers (this codebase double-wires a couple of these buttons to the same handler —
// see sidebar-layout.js's + app.js's independent "New Chat" row forwarders) collapse onto the SAME
// in-flight confirm — one dialog, one answer — instead of stacking two modals.
(function () {
  "use strict";

  function gameBuild() {
    return !!(document.body && document.body.hasAttribute("data-game-build"));
  }

  async function jget(url) {
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      return r.ok ? await r.json() : null;
    } catch (_) { return null; }
  }

  // "Live" = a season has started and hasn't reached its terminal hand-off. An evicted-but-
  // not-yet-concluded player (LW10) still has jury/finale stake riding on the game, so that
  // still counts as live — only a fully-finished season (moment === "post-season", or the
  // engine's own `finished` flag) has nothing left to lose by navigating away.
  function isLive(st) {
    return !!(st && st.started === true && !st.finished && st.moment !== "post-season");
  }

  let _pending = null; // in-flight confirm — collapses redundant double-fires onto ONE dialog.

  // Returns a Promise<boolean> — true = safe to proceed (no live game, or the player confirmed
  // leaving it); false = the player chose to stay, the caller must not detach.
  async function confirmLeaveGame() {
    if (!gameBuild()) return true;
    if (_pending) return _pending;
    _pending = (async () => {
      const st = await jget("/api/orwell/state");
      if (!isLive(st)) return true;
      if (!window.styledConfirm) return true; // no dialog available — never trap the player
      return window.styledConfirm(
        "Leave your current season?\n\nStarting a new chat here will step you away from your " +
        "live, in-progress season — the house, your relationships, everything you've built so " +
        "far. This isn't a fresh conversation you can just reopen later.",
        { confirmText: "Leave my season", cancelText: "Stay in my season", danger: true }
      );
    })();
    try {
      return await _pending;
    } catch (_) {
      return true; // fail open on any unexpected error in the check itself
    } finally {
      _pending = null;
    }
  }

  window._orwellConfirmLeaveGame = confirmLeaveGame;
})();

/*
 * orwellUserKey — the SINGLE per-user client-storage key derivation (requirement 0021 isolation;
 * refactor R5 / issue #1416, hardened in #1416b).
 *
 * Requirement 0021 is per-user client-LAYER isolation: every per-user localStorage key must be
 * namespaced by the physical-world user, so two accounts sharing ONE browser never read or write
 * each other's transient UI state (window/HUD layout, gadget order, dismissed notices, drafts…).
 *
 * Historically each site derived its key inline as
 *     base + ':' + ((document.body && document.body.dataset.user) || '')
 * The `|| ''` fallback was the defect: whenever document.body.dataset.user was absent or empty
 * every key COLLAPSED into one shared empty-user ("") namespace — layout/persistence bleeding
 * across users. That is not a Vault leak, but it is a real cross-user isolation defect.
 *
 * This helper resolves the namespace by WHY the identity is present or absent — THREE branches:
 *
 *   1. data-user is a non-empty string  → `name:user`  (a real authed user's OWN namespace).
 *   2. no data-user, but an EXPLICIT no-auth signal (window.__ORWELL_NO_AUTH__ === true)
 *      → `name:local`. This is the single-user / no-auth posture (AUTH_ENABLED=false, e.g.
 *      localhost): there is exactly ONE effective user, so a stable "local" namespace is correct
 *      and lets no-auth persistence work — never the shared empty ("") one.
 *   3. no data-user and NO no-auth signal → `null` (FAIL CLOSED — the caller SKIPS the write).
 *      This is the reviewer's (#1416b) case: a MULTI-user deploy whose server (buggily) omits
 *      data-user must NOT let two real users share the ":local" bucket. It is also the pre-auth
 *      boot window — before /api/auth/status confirms — which is meant to skip until identity or
 *      the no-auth posture resolves.
 *
 * The no-auth signal is DELIBERATELY separate from data-user: data-user is left untouched (the
 * fenced #891 send-outbox in chat.js reads document.body.dataset.user DIRECTLY, and stamping it
 * broke the outbox before — #1416/#891). The boot script (static/index.html) sets
 * window.__ORWELL_NO_AUTH__ = true when /api/auth/status reports auth_enabled === false; nothing
 * else reads it.
 *
 * Storage-agnostic: it only builds the key string; the caller owns the store. It is deliberately
 * NOT used for per-TAB sessionStorage (the chat send-outbox, the composer draft) — those read
 * document.body.dataset.user DIRECTLY and stay per-tab by ADR 0008/0012 design, so the boot script
 * leaves data-user EMPTY in no-auth mode and their behavior is unchanged.
 */
(function () {
  "use strict";

  // The stable single-user / no-auth namespace (used only under an EXPLICIT no-auth signal).
  var LOCAL_USER = "local";

  function orwellUserKey(name) {
    var u;
    try {
      u = document.body && document.body.dataset && document.body.dataset.user;
    } catch (_) {
      u = null;
    }
    // 1. A real per-user identity ⇒ that user's OWN namespace.
    if (typeof u === "string" && u !== "") return String(name) + ":" + u;
    // No identity — split by WHY it is absent (see the header):
    //   • explicit no-auth ⇒ the stable single-user ":local" namespace;
    //   • else (multi-user w/ missing data-user, or the pre-auth boot window) ⇒ FAIL CLOSED.
    var noAuth = false;
    try { noAuth = typeof window !== "undefined" && window.__ORWELL_NO_AUTH__ === true; } catch (_) { noAuth = false; }
    if (noAuth) return String(name) + ":" + LOCAL_USER;
    // 3. Multi-user with no resolved identity ⇒ null: the caller SKIPS the write. Two real users
    //    must NEVER share the ":local" bucket, and "" must never be used.
    return null;
  }

  if (typeof window !== "undefined") window.orwellUserKey = orwellUserKey;
})();

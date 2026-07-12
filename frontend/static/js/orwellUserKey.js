/*
 * orwellUserKey — the SINGLE per-user client-storage key derivation (requirement 0021 isolation;
 * refactor R5 / issue #1416).
 *
 * Requirement 0021 is per-user client-LAYER isolation: every per-user localStorage key must be
 * namespaced by the physical-world user, so two accounts sharing ONE browser never read or write
 * each other's transient UI state (window/HUD layout, gadget order, dismissed notices, drafts…).
 *
 * Historically each site derived its key inline as
 *     base + ':' + ((document.body && document.body.dataset.user) || '')
 * The `|| ''` fallback was the defect: whenever document.body.dataset.user was absent or empty
 * (e.g. before the boot script's /api/auth/status confirm lands, or if the server ever omitted the
 * identity), every key COLLAPSED into one shared empty-user ("") namespace — layout/persistence
 * bleeding across users. That is not a Vault leak, but it is a real cross-user isolation defect.
 *
 * This helper keys under the real data-user when present, and under a STABLE "local" namespace when
 * it is absent/empty — NEVER the shared empty ("") one. The empty/absent case is the single-user /
 * no-auth posture (AUTH_ENABLED=false, e.g. localhost): there is exactly ONE effective user, so a
 * stable "local" namespace is correct and lets no-auth persistence work. Isolation still holds: an
 * authed multi-user page ALWAYS carries a real data-user, so the helper never falls back to "local"
 * there — each user keys under their own name, two real users never collide, and "" is never used.
 *
 * Storage-agnostic: it only builds the key string (`name + ':' + user`); the caller owns the store.
 * It is deliberately NOT used for per-TAB sessionStorage (the chat send-outbox, the composer draft)
 * — those read document.body.dataset.user DIRECTLY and stay per-tab by ADR 0008/0012 design, so the
 * boot script leaves data-user EMPTY in no-auth mode and their behavior is unchanged.
 */
(function () {
  "use strict";

  // The stable single-user / no-auth namespace (used only when there is no data-user identity).
  var LOCAL_USER = "local";

  function orwellUserKey(name) {
    var u;
    try {
      u = document.body && document.body.dataset && document.body.dataset.user;
    } catch (_) {
      u = null;
    }
    // No real identity ⇒ the stable "local" namespace, NEVER the shared empty ("") one.
    if (typeof u !== "string" || u === "") u = LOCAL_USER;
    return String(name) + ":" + u;
  }

  if (typeof window !== "undefined") window.orwellUserKey = orwellUserKey;
})();

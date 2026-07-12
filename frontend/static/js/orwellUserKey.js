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
 * This helper is FAIL-CLOSED: it returns a per-user key ONLY when dataset.user is a non-empty
 * string, and otherwise returns null so callers SKIP persistence (write NOTHING) rather than share
 * the empty-user namespace. A null key MUST NOT be handed to localStorage.getItem/setItem/
 * removeItem — those string-coerce null into a real "null" key — so every call site guards on the
 * null return before touching the store.
 *
 * Storage-agnostic: it only builds the key string (`name + ':' + user`); the caller owns the store.
 * It is deliberately NOT used for per-TAB sessionStorage (the chat send-outbox, the composer draft)
 * — those are per-tab by ADR 0008/0012 design, not a shared cross-user namespace.
 */
(function () {
  "use strict";

  function orwellUserKey(name) {
    try {
      var u = document.body && document.body.dataset && document.body.dataset.user;
      // Fail-closed: only a non-empty string identity yields a key.
      if (typeof u !== "string" || u === "") return null;
      return String(name) + ":" + u;
    } catch (_) {
      return null;
    }
  }

  if (typeof window !== "undefined") window.orwellUserKey = orwellUserKey;
})();

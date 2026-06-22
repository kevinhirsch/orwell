# 0071 — Defensive hardening: log redaction & URL/path guards

**Status:** spec (BDD-first). **Priority:** Wave 2 of the Hermes→Orwell integration
(`docs/HERMES-INTEGRATION-PLAN.md` B1). Independent of 0070/0072; useful prerequisite for 0072.
**Provenance:** adapts `agent/redact.py` (broader secret masking) and the gateway SSRF / path-traversal URL
guards (the V-009 hardening) from hermes-agent (MIT © 2025 Nous Research — **attribution retained**, code adapted).

## Why

Two small, mandate-neutral hardening drop-ins worth taking before any outward-facing surface (0072) lands:

1. **Broader secret redaction in logs.** orwell already redacts some secrets, but hermes' `redact.py` covers a
   wider set of shapes — vendor-prefixed API keys (`sk-…`, `ghp_…`, provider tokens), `Authorization`/`x-api-key`
   style headers (all schemes), and query-param secrets in URLs. Adopting its pattern reduces the chance an LLM
   provider key or PAT lands in a log line or an error trace.
2. **SSRF / path-traversal URL guards.** Centralized URL-safety checks (fail-closed on private/loopback/link-local
   ranges and IPv6 scope-ID tricks; reject drive-letter / `..` path traversal). orwell has limited outward fetch
   today, but the multi-platform gateway (0072) and any future public exposure (ADR 0007) want a shared,
   tested guard rather than ad-hoc checks.

## The shape

- A `frontend/src/secret_redaction.py` helper (adapted from `redact.py`): `redact(text) -> text` masking the
  vendor-prefix + header + query-param secret shapes; wired into the FE logging path so every log record passes
  through it. Pure function, no I/O, table-driven so new shapes are one line.
- A `frontend/src/url_safety.py` helper (adapted from the gateway guards): `assert_safe_url(url)` /
  `is_safe_url(url)` that **fail closed** on loopback/private/link-local/IPv6-scope addresses, and a
  `safe_join(base, *parts)` that rejects traversal. Used by any outward fetch path.

Both are **mandate-neutral** — no Vault surface, no game logic, no model behavior. They are defense-in-depth.

## Invariants (BDD/unit)

- **Secrets are masked.** Known secret shapes (vendor-prefixed keys, auth headers, URL query secrets) never
  appear verbatim in a redacted string; non-secret text is untouched.
- **Redaction is on the log path.** A log record containing a secret shape is emitted redacted.
- **URL guard fails closed.** Loopback, private, link-local, and IPv6-scope-ID URLs are rejected; a public URL
  is allowed. (Unknown/ambiguous ⇒ rejected, not allowed.)
- **Path join rejects traversal.** A `..`/absolute/drive-letter segment is refused; a normal relative segment joins.
- **No mandate surface touched.** The helpers import no Vault type and do not alter any game projection or
  narration; `test:arch` and the FE full suite stay green.

## Implementer handoff / open questions

- Reconcile with orwell's **existing** redaction (`prompt_security.py` / `settings_scrub.py`) — extend, don't
  duplicate; keep a single redaction chokepoint.
- Add the Nous Research MIT entry to `frontend/ACKNOWLEDGMENTS.md` + `frontend/licenses/` if this lands before 0070.

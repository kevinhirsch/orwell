# SECURITY-DEEP — Orwell exhaustive pre-ship audit v2

Territory: auth/authz + exposure surface — `frontend/src/tool_security.py` fail-open, admin/player
engine-token separation (E27), the multi-platform gateway webhook auth, `ORWELL_ENGINE_TOKEN`
handling, redaction/URL/path guards (0071), the producerVault quarantine, prompt-injection surface,
cross-user isolation (I10), CORS/CSRF/clickjacking headers, session/cookie security, rate-limiting/DoS,
secret handling, `AUTH_ENABLED=false` posture, file upload validation, SSRF.

Dedup note: does NOT re-report the prior-pass "producerVault direct-HTTP unseal" (Minor) verbatim —
SEC-4 below corroborates it but escalates severity with a specific, previously-unexamined trigger
(`AUTH_ENABLED=false`) that turns it into a zero-auth full spoiler dump.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| SEC-1 | Blocker | <1hr | High | First-run admin-setup race: no loopback/token gate on `/api/auth/setup` | `frontend/app.py:192-244`, `frontend/routes/auth_routes.py:93-105` |
| SEC-2 | Blocker | <1day | High | Gateway webhook trusts payload-supplied platform identity with zero auth by default — full game-session impersonation | `frontend/routes/gateway_routes.py:80-158`, `frontend/gateway/pairing.py:144-146` |
| SEC-3 | Blocker | <1hr | High | `tool_security` fail-open (`owner_is_admin_or_single_user`) + `AUTH_ENABLED=false` on a reachable deployment = unauthenticated bash/python/manage_tokens | `frontend/src/tool_security.py:164-179`, `frontend/app.py:179,192-422` |
| SEC-4 | Blocker | <1hr | High | producerVault / debug-bundle Vault dump requires only `require_admin`, which itself no-ops under `AUTH_ENABLED=false` — corroborates + escalates prior "direct-HTTP unseal" finding | `frontend/routes/admin_health_routes.py:1055-1079,1120-1133`, `frontend/core/middleware.py:30-56` |
| SEC-5 | Major | <1day | High | Engine admin/player token separation (E27) silently collapses to single-token mode when `ORWELL_ENGINE_ADMIN_TOKEN` is unset | `src/adapters/mcp/HttpMcpServer.ts:193-204` |
| SEC-6 | Major | <1day | High | `assert_public_profile_safe` — the one fail-closed public-deploy gate — has no visibility into engine-side security config (admin-token separation, `ORWELL_ENGINE_MULTIUSER`) or gateway webhook secrets | `frontend/core/middleware.py:197-263` |
| SEC-7 | Major | <1hr | High | Health-metrics failure ring records the raw, unvalidated tool name (up to ~256KB) and serves it on an UNAUTHENTICATED `/health` | `src/adapters/mcp/HttpMcpServer.ts:246,271-275`, `src/adapters/mcp/healthMetrics.ts:9-12,51-64` |
| SEC-8 | Major | <1day | High | No per-request rate limit on `/api/chat`; default `max_messages_per_day=0` = unlimited for every non-admin account | `frontend/routes/chat_helpers.py:2789-2814`, `frontend/core/auth.py:23-34`, `frontend/gateway/turn_limits.py:75-99` |
| SEC-9 | Moderate | <1day | Med | No rate limit on the gateway `/pair` command path — lets an unauthenticated caller weaponize the operator's bot as a spam relay and repeatedly invalidate a victim's pending pairing code | `frontend/routes/gateway_routes.py:121-130` |
| SEC-10 | Moderate | <1day | Med | Non-native ("fence"/XML) tool-call fallback injects tool output (incl. `web_search` results) as a plain unguarded `user` message — inconsistent with the `untrusted_context_message` sandbox used for documents/skills | `frontend/src/agent_loop.py:1288-1296`, `frontend/src/prompt_security.py:60-83` |
| SEC-11 | Minor | <1hr | Med | Provider-returned image URL is fetched with no SSRF/host revalidation | `frontend/src/orwell_portraits.py:915-919` |
| SEC-12 | Minor | <1hr | Med | Secret-redaction vendor-prefix allowlist misses unprefixed secret shapes (Telegram bot token, engine tokens, fal.ai keys) if ever logged raw | `frontend/src/secret_redaction.py:30-44` |
| SEC-13 | Minor | <1hr | Low | `require_privilege` fails OPEN for any privilege key not yet in `DEFAULT_PRIVILEGES` | `frontend/src/auth_helpers.py:152-177` |
| SEC-14 | Minor | <1hr | Low | `sessions.json` has no per-user session cap and is fully rewritten on every login — unbounded growth / write amplification | `frontend/core/auth.py:158-166,556-567` |
| SEC-15 | Minor | <1day | Med | Two divergent SSRF guard modules (`url_safety.py` vs `url_security.py`) with different threat models — risk of the wrong one being reused for a new outbound-fetch feature | `frontend/src/url_safety.py`, `frontend/src/url_security.py` |
| SEC-16 | Minor | <1day | Low | SSRF guards validate DNS at check-time only — classic DNS-rebinding TOCTOU window before the real fetch re-resolves | `frontend/src/url_safety.py:85-101,161-172`, `frontend/src/url_security.py:81-94` |
| SEC-17 | Minor | <1hr | Low | `SECURE_COOKIES` is not implied/forced when `ORWELL_TLS_MODE=local` (ADR 0014) — only the `ORWELL_PUBLIC` gate checks it | `frontend/core/middleware.py:197-263,318-324`, `frontend/routes/auth_routes.py:142-155` |
| SEC-18 | Polish | <1hr | Low | CORS `allow_headers` exposes internal-only header names (`X-Orwell-Internal-Token`, `X-Orwell-Owner`) to any browser origin in the allow-list | `frontend/app.py:103-119` |
| SEC-19 | Minor | <1hr | Low | `owner_is_admin_or_single_user` fail-open pattern is reused verbatim in the (dropped-in-game-build) email-contacts path — same footgun shape, different surface | `frontend/routes/email_helpers.py:1273-1277`, `frontend/routes/workspace_routes.py:6,23` |
| SEC-20 | Minor | <1day | Med | `/api/auth/signup` has no captcha/human-check and no admin-approval queue — with `signup_enabled=true` on a public deploy, scripted account creation is throttled only 3/300s per IP (bypassable via rotating IPs), each account getting the unlimited-by-default chat cap (SEC-8) | `frontend/routes/auth_routes.py:107-123` |
| SEC-21 | Polish | <1hr | Low | `deploy/orwell-install.sh` mints `ORWELL_ENGINE_TOKEN`/`ORWELL_ENGINE_ADMIN_TOKEN`/`ORWELL_ENGINE_MULTIUSER` correctly, but nothing at RUNTIME (doctor script, `/api/orwell/health`, or `assert_public_profile_safe`) warns an operator who deployed by hand (no installer) that the admin token equals the player token | `deploy/orwell-install.sh:242-268`, `deploy/orwell-doctor.sh:145-179` |
| SEC-22 | Minor | <1hr | Low | `is_public_blocked_tool` blocks by exact tool name / `mcp__` prefix only — a future tool alias or a case-variant name would slip the blocklist (allowlist-by-construction would be safer) | `frontend/src/tool_security.py:149-161` |
| SEC-23 | Polish | <1hr | Low | The engine's `X-Orwell-User` header trust model has no upper bound on request RATE per asserted user beyond the per-user serialization queue — a caller who *does* hold the shared token can still flood a single victim user's queue (accepted tradeoff per doc, but undocumented as a rate-limit gap) | `src/adapters/mcp/HttpMcpServer.ts:133-154` |
| SEC-24 | Minor | <1hr | Low | `_gateway_secret()`/`TELEGRAM_WEBHOOK_SECRET` dormant-by-default posture is undocumented in the one place an operator would look first — `docs/audits/2026-06-27-ship-gate.md` golden path G1-G9 — so the gateway can ship "working" without ever being told to set the secret | `frontend/routes/gateway_routes.py:8-23`, `docs/audits/2026-06-27-ship-gate.md` |
| SEC-25 | Minor | <1day | Med | TOTP backup codes are stored in `auth.json` as **plaintext** (not hashed), unlike passwords (bcrypt) | `frontend/core/auth.py:494-496,513-521` |
| SEC-26 | Polish | <1hr | Low | `X-Forwarded-*` / `CF-*` trust for rate-limit IP resolution is gated on `ORWELL_PUBLIC` OR `TRUST_PROXY_HEADERS`, but the *auth-bypass* loopback check (`_is_trusted_loopback`) is unconditional — the two proxy-trust decisions live in two different files with different default postures, easy to drift out of sync | `frontend/src/rate_limiter.py:55-65`, `frontend/app.py:282-301` |
| SEC-27 | Minor | <1hr | Low | `admin_reset_password` / `delete_user` / `rename_user` revoke *browser* sessions but never revoke that user's live **API bearer tokens** on password reset (only `delete_user` revokes tokens) | `frontend/core/auth.py:432-452` |
| SEC-28 | Polish | <1hr | Low | The debug bundle's opt-in Vault section (`?vault=1`) is logged (`logger.info("[ops] admin UNSEALED...")`) but the log line doesn't capture the REQUESTING IP/session, weakening after-the-fact audit of who pulled a spoiler dump | `frontend/routes/admin_health_routes.py:1077` |

---

## FULL FINDINGS

### SEC-1 — [Severity: Blocker] [Effort: <1hr] [Value: High]
First-run admin-setup race: `/api/auth/setup` has no loopback/token gate
- **Where:** `frontend/app.py:192-244` (`AUTH_EXEMPT_EXACT` includes `/api/auth/setup` unconditionally); `frontend/routes/auth_routes.py:93-105` (`first_run_setup`).
- **Problem:** `POST /api/auth/setup` creates the FIRST admin account and is exempt from `AuthMiddleware` for ANY caller (not restricted to loopback, unlike `require_user`'s own "unconfigured mode" loopback-only fallback in `auth_helpers.py:143-149`). The only guard is a 3-requests/300s-per-IP rate limiter and `is_configured` — no setup token, no invite code, nothing tying the first admin to the operator who ran the install. On ADR 0007's whole premise (ship to the public internet), there is a real window between the systemd unit starting the app (port reachable / TLS cert issued — cert-transparency-log scanners specifically hunt for this event) and the operator manually visiting the URL to claim the account. Any opportunistic scanner that reaches the URL first and POSTs `{"username":"x","password":"12345678"}` becomes the SOLE PERMANENT ADMIN of the deployment — full control over LLM settings, user management, `producerVault` (SEC-4), the debug bundle, and every game sandbox. This is a well-known class of self-hosted-app onboarding race (the same shape that has bitten Home Assistant and others). Hurts: the operator (total account/deployment takeover) and, transitively, every player's Vault (I1) once the attacker-admin unseals it.
- **Fix:** Restrict `/api/auth/setup` to loopback-only (mirror `require_user`'s unconfigured-mode behavior) OR require a one-time setup token that the installer prints to the local console/log and the operator must paste into the setup form — never accept it from an arbitrary remote caller while `is_configured==False`.

### SEC-2 — [Severity: Blocker] [Effort: <1day] [Value: High]
Gateway webhook trusts payload-supplied platform identity with zero auth by default
- **Where:** `frontend/routes/gateway_routes.py:80-158` (`platform_webhook`); `frontend/gateway/pairing.py:144-146` (`get_paired_user`); `frontend/gateway/platforms/telegram.py:99-119` (`parse_inbound` derives identity purely from the JSON body's `chat.id`).
- **Problem:** `POST /gateway/webhook/{platform_id}` is exempted from `AuthMiddleware` entirely (`/gateway/webhook/` prefix, `app.py:224`). The ONLY identity check is `ORWELL_GATEWAY_WEBHOOK_SECRET` (gateway-wide) and `TELEGRAM_WEBHOOK_SECRET` (per-platform) — both **unset/dormant by default** per the module's own docstring. With neither set, ANY internet client can POST a hand-crafted Telegram-Update-shaped JSON body directly to this URL with an arbitrary `chat.id`. If that `chat.id` happens to be paired to a real Orwell player (Telegram chat/user IDs are not secret — discoverable via forwarded messages, shared groups, or simple enumeration for older accounts), the attacker fully drives that victim's live game turn-by-turn: reads their game state, submits decisions, talks as them to the LLM, and burns the operator's LLM budget — all attributed to the victim with zero authentication. This directly breaks I10 (cross-user isolation: "no call for user A may return user B's game") and turns the multi-platform gateway (0072) into the easiest privilege-escalation-free account-takeover path in the whole app. The `/pair` command inside the same handler is reachable the same way (see SEC-9).
- **Fix:** Make `ORWELL_GATEWAY_WEBHOOK_SECRET` (or the per-platform secret) a HARD REQUIREMENT to register a platform adapter in a non-dev posture — refuse to route any platform whose secret is unset when `ORWELL_PUBLIC` is set (tie into `assert_public_profile_safe`, see SEC-6), and surface a loud admin-facing warning ("Telegram is unauthenticated — anyone who knows a chat ID can impersonate your players") on `/gateway/status` when dormant.

### SEC-3 — [Severity: Blocker] [Effort: <1hr] [Value: High]
`tool_security` fail-open (`owner_is_admin_or_single_user`) stacks with `AUTH_ENABLED=false` into unauthenticated shell access
- **Where:** `frontend/src/tool_security.py:164-179` (`owner_is_admin_or_single_user`: `if not auth.is_configured: return True`); `frontend/src/tool_execution.py:507-509,1219-1235` (gate for `_ADMIN_TOOLS`/`NON_ADMIN_BLOCKED_TOOLS`, which include `bash`, `python`, `manage_tokens`, `manage_webhooks`); `frontend/app.py:179,192-422` (the ENTIRE `AuthMiddleware` — including the `is_configured` 401/redirect check — is skipped when `AUTH_ENABLED=false`, not just relaxed).
- **Problem:** This is the charter's flagged "known fail-open" verified: when `is_configured` is False (no account ever created — the intended single-user/no-login posture), `owner_is_admin_or_single_user` returns `True` unconditionally, which makes EVERY tool available, including `bash`/`python` (arbitrary code execution) and `manage_tokens`/`manage_webhooks` (credential/integration management). By itself this is reasonable for a genuinely single-operator, loopback-only install. The escalation: when `AUTH_ENABLED=false` is set (documented as the "local dev" / "single-user" mode throughout `CLAUDE.md` and used in the audit's own live-agent recipe), `app.py` does not even construct `AuthMiddleware` — so there is no session check, no loopback check, no CORS-adjacent origin check for API calls, on ANY route. Combined, a deployment that is (a) run with `AUTH_ENABLED=false` for simplicity (an entirely plausible self-host choice — "it's my own game, why log in") and (b) reachable beyond loopback for ANY reason (a forgotten port-forward, a LAN that isn't as trusted as assumed, a Tailscale/VPN misconfiguration, or simply testing with a tunnel before flipping `ORWELL_PUBLIC` on) grants **any network caller full remote code execution** via the chat agent's `bash`/`python` tools, no credentials required. `assert_public_profile_safe` only fires when `ORWELL_PUBLIC` is explicitly set — it does not catch "AUTH_ENABLED=false and reachable but operator never set ORWELL_PUBLIC."
- **Fix:** Make `AUTH_ENABLED=false` bind-restrict the app to loopback at the socket level regardless of `ORWELL_BIND_HOST` (refuse to start otherwise), OR require `LOCALHOST_BYPASS`-style trusted-loopback verification (`_is_trusted_loopback`, which already exists and correctly excludes proxy/tunnel-forwarded requests) as a HARD gate on tool execution whenever `is_configured` is False — not just on the HTTP routes.

### SEC-4 — [Severity: Blocker] [Effort: <1hr] [Value: High] (corroborates + escalates a prior finding)
producerVault / debug-bundle Vault dump is reachable with zero auth under `AUTH_ENABLED=false`
- **Where:** `frontend/routes/admin_health_routes.py:1055-1079` (`POST /api/orwell/ops/producer-vault`) and `:1120-1133` (`GET /api/orwell/debug-bundle?vault=1`); `frontend/core/middleware.py:30-56` (`require_admin`: `if os.getenv("AUTH_ENABLED","true").lower()=="false": return` — unconditional bypass, no loopback check at all, unlike the tool-execution path's loopback-aware siblings).
- **Problem:** The prior audit pass flagged "producerVault direct-HTTP unseal" as Minor/Polish — presumably referring to the fact that the FE button is a thin wrapper over a directly-curlable HTTP route. That framing understates the real severity: `require_admin` (the ONLY gate on this route, per its own docstring "gated three ways: require_admin here, the engine's separate admin token, and the explicit FE unseal") short-circuits to a no-op the instant `AUTH_ENABLED=false`, with **no loopback check whatsoever** (contrast `require_user`, which at least falls back to a loopback-only allowance). So on any `AUTH_ENABLED=false` deployment reachable over the network — the same posture flagged in SEC-3 — `GET /api/orwell/debug-bundle?vault=1` returns, to an anonymous caller, "off-screen scheming, NPC confessionals, hidden ties, sealed twists, true eviction votes" for every live game on the box. This is the single most severe possible violation of Mandate #2 / I1 (the Vault Wall) available in the codebase, and it needs zero credentials — not even the engine's own bearer token, since the FE-to-engine call happens server-side using whatever `ORWELL_ENGINE_ADMIN_TOKEN`/`ORWELL_ENGINE_TOKEN` the FE process already holds.
- **Fix:** `require_admin` (and `require_entitlement`) must NEVER no-op purely on `AUTH_ENABLED=false` for Vault-crossing routes — gate the producerVault/debug-bundle-with-vault routes on an explicit, separate opt-in env var (e.g. `ORWELL_ALLOW_VAULT_DEBUG=1`) in addition to admin auth, and require loopback regardless of `AUTH_ENABLED`.

### SEC-5 — [Severity: Major] [Effort: <1day] [Value: High]
Engine admin/player token separation (E27) collapses to single-token mode whenever `ORWELL_ENGINE_ADMIN_TOKEN` is unset
- **Where:** `src/adapters/mcp/HttpMcpServer.ts:193-204`:
  ```
  if (channel === "admin" && options.adminToken) {
    if (!secretsMatch(presented, options.adminToken)) return send(401, ...);
  } else if (options.token || options.adminToken) {
    const playerOk = (options.token !== undefined && secretsMatch(presented, options.token)) ||
                      (options.adminToken !== undefined && secretsMatch(presented, options.adminToken));
    if (!playerOk) return send(401, ...);
  }
  ```
- **Problem:** The comment above this block (and CLAUDE.md's E27 description) frames the admin token as closing a real hole: "with only the shared `token`, one bearer granted any-user impersonation AND God Mode." But the fallback that makes this "back-compat" is exactly that hole, dormant by default: if an operator sets `ORWELL_ENGINE_TOKEN` but never sets the separate `ORWELL_ENGINE_ADMIN_TOKEN` (anyone standing the engine up by hand rather than through `deploy/orwell-install.sh`, which DOES mint both — see SEC-21), the FIRST branch's condition (`channel === "admin" && options.adminToken`) is false, so admin/God-Mode requests fall into the `else if` and are accepted with the PLAYER token. Anyone who has (or leaks, or brute-forces via a bug) the player-level `ORWELL_ENGINE_TOKEN` gets `producerVault` (full live Vault dump — see SEC-4) and every God Mode override lever, with no separate secret required at all. The player token is inherently more exposed (it transits every ordinary game request) than the admin token, so this fallback specifically weakens the boundary the feature exists to create.
- **Fix:** When `adminToken` is undefined, either (a) refuse to start the admin channel at all (fail closed — force the operator to set a distinct admin token), or (b) at minimum log a loud, repeated warning ("admin channel is using the PLAYER token — set ORWELL_ENGINE_ADMIN_TOKEN") and surface it on `/health`.

### SEC-6 — [Severity: Major] [Effort: <1day] [Value: High]
`assert_public_profile_safe` — the one fail-closed public-deploy gate — is blind to engine-side and gateway security config
- **Where:** `frontend/core/middleware.py:197-263` (the full `assert_public_profile_safe` checklist: `AUTH_ENABLED`, `LOCALHOST_BYPASS`, `SECURE_COOKIES`, `ALLOWED_HOSTS`, `ALLOWED_ORIGINS`, `ORWELL_BIND_HOST`).
- **Problem:** This is explicitly documented as THE fail-closed safety net for `ORWELL_PUBLIC=true` — "refuse to start... rather than letting the app boot and silently serve the game in the clear." It is thorough for the FE's own auth posture, but it never checks: (1) whether `ORWELL_ENGINE_ADMIN_TOKEN` differs from `ORWELL_ENGINE_TOKEN` (SEC-5's exact failure mode — the FE can read both from its own environment and compare them), (2) whether `ORWELL_GATEWAY_WEBHOOK_SECRET`/`TELEGRAM_WEBHOOK_SECRET` are set when a gateway platform is registered (SEC-2's exact failure mode — again FE-observable, since `platform_registry` lives in the FE process), or (3) `ORWELL_ENGINE_MULTIUSER` on the engine side (not FE-observable directly, but worth a documented companion requirement). A public deployment can pass every check in this function while both the Vault-quarantine boundary (SEC-4/5) and the gateway impersonation boundary (SEC-2) sit wide open — the operator gets a false sense of "I ran the safety check, I'm covered."
- **Fix:** Add both checks (they're cheap, pure, and testable exactly like the existing ones): compare `ORWELL_ENGINE_TOKEN` vs `ORWELL_ENGINE_ADMIN_TOKEN` for equality/unset, and check `TELEGRAM_BOT_TOKEN`-configured-without-`TELEGRAM_WEBHOOK_SECRET` (and gateway-secret-unset). Document `ORWELL_ENGINE_MULTIUSER` as a required companion in the same install doc section this function's error message points to.

### SEC-7 — [Severity: Major] [Effort: <1hr] [Value: High]
Health-metrics failure ring records the raw, unvalidated tool name and serves it unauthenticated
- **Where:** `src/adapters/mcp/HttpMcpServer.ts:246` (only checks `typeof name === "string" && name.length > 0` — no allowlist check before dispatch); `:271-275` (`metrics.recordFailure(name, errorClassOf(e), ...)` on the `catch` from `server.callTool`, which throws a generic `Error` for an unknown tool name — see `McpServer.ts:243-255`); `src/adapters/mcp/healthMetrics.ts:9-12` (doc comment: "the tool NAME only — a member of the static channel allowlist, never args") vs. `:51-64` (`recordFailure(tool: string, ...)` takes and stores whatever string it's handed, capped only in RING COUNT (50 entries), never in per-entry LENGTH); `HttpMcpServer.ts:186` (`GET /health` — explicitly unauthenticated, "carries no game data").
- **Problem:** The Vault-safety doc comment on `HealthMetrics` ("never args... the tool NAME only — a member of the static channel allowlist") is aspirational, not enforced: `name` is whatever string arrived in the request JSON body (up to the 256KB body cap, `MAX_BODY_BYTES`), and it reaches `recordFailure` on ANY call to an unknown/malformed tool name, BEFORE any allowlist check succeeds. Any caller who can reach `/player/call` (which requires only the low-value player token, or nothing at all if unset — see SEC-3) can inject an arbitrary ~256KB string into a process-wide, shared-across-all-users ring that is then served, verbatim, on an UNAUTHENTICATED `GET /health` to literally anyone on the network. This breaks the "never args" invariant the health-metrics module exists to guarantee, bloats the admin Health & Logs card with attacker-chosen content (a candidate stored-content vector into that FE surface if `recentFailures[].tool` is ever rendered without escaping — not verified here, flag for FE lane), and turns an intended-tiny liveness probe into an amplification target (50 × up to 256KB ≈ 12.5MB of attacker-shaped `/health` payload).
- **Fix:** Validate `name` against the channel's `toolsFor()` + `DEBUG_VAULT_TOOL_NAMES` (or a small fixed max length, e.g. 64 chars, matching `MAX_USER_ID_CHARS`'s pattern) BEFORE calling `recordFailure`; for an unrecognized name, record a fixed sentinel like `"<unknown-tool>"` instead of the raw string.

### SEC-8 — [Severity: Major] [Effort: <1day] [Value: High]
No per-request rate limit on `/api/chat`; default daily cap is unlimited
- **Where:** `frontend/routes/chat_helpers.py:2789-2814` (`_enforce_chat_privileges` — the ONLY throttle on the browser chat path, and only for authenticated, non-admin users); `frontend/core/auth.py:23-34` (`DEFAULT_PRIVILEGES["max_messages_per_day"] = 0`, and `ADMIN_PRIVILEGES` derives the same 0 for ints); `frontend/gateway/turn_limits.py:75-99` (`daily_cap_exceeded`: `if cap <= 0: return False` — "never capped" is the DEFAULT for every account, admin or not); the module list in `src/rate_limiter.py` usage grep shows `RateLimiter` is wired ONLY for `/api/auth/login|signup|setup` and one FE-report endpoint — never for `/api/chat`.
- **Problem:** Every message send that reaches the LLM (the single most expensive, real-money-metered operation in the whole app — "a real LLM key" per the charter) has NO per-minute/per-request throttle at all, and the one quota that exists (`max_messages_per_day`) defaults to unlimited for every account type including freshly self-signed-up ones (SEC-20). A compromised/malicious browser session, a buggy client-side retry loop, or (worse) a stuck streaming reconnect loop can hammer `/api/chat` indefinitely, burning the operator's API budget with no backstop until they notice the bill. This is a DoS/cost-abuse surface distinct from — and additive to — the gateway's own (bounded) throttle in SEC-2/SEC-9.
- **Fix:** Add a `RateLimiter`-style per-user (not just per-IP) sliding window on `/api/chat`/`/api/chat_stream` (e.g. N requests/minute) alongside the existing daily-cap privilege, and change the OPERATOR-facing default for non-admin accounts to a sane non-zero cap rather than "0 = unlimited."

### SEC-9 — [Severity: Moderate] [Effort: <1day] [Value: Med]
No rate limit on the gateway `/pair` command path — bot-as-spam-relay + pairing-code griefing
- **Where:** `frontend/routes/gateway_routes.py:121-130`.
- **Problem:** Inside `platform_webhook`, the `/pair` command branch (`if text.lower().startswith("/pair")`) runs `generate_code(platform_identity)` and `await adapter.send(platform_identity, reply)` BEFORE the `turn_limits.is_rate_limited(platform_identity)` check that gates every other message type (that check sits further down, reached only for non-`/pair` text). Since the webhook is unauthenticated by default (SEC-2), an attacker who knows or guesses a victim's `platform_identity` (e.g. a Telegram `chat_id`) can spam `POST /gateway/webhook/telegram {"message":{"chat":{"id":"<victim>"},"text":"/pair"}}` with no throttle: each call (a) makes the operator's real Telegram bot send an actual message into the victim's chat (harassment / spam relay abuse of the operator's bot reputation) and (b) overwrites the victim's currently-pending pairing code (`generate_code` "replaces any previous pending code"), griefing a legitimate in-progress pairing attempt.
- **Fix:** Move the `turn_limits.is_rate_limited(platform_identity)` check ABOVE the `/pair` branch so it covers every inbound message type, not just non-pair turns.

### SEC-10 — [Severity: Moderate] [Effort: <1day] [Value: Med]
Non-native tool-call fallback path injects tool output as an unguarded `user` message
- **Where:** `frontend/src/agent_loop.py:1288-1296`:
  ```python
  else:
      tool_output_text = "\n\n".join(tool_results)
      ...
      messages.append({"role": "user", "content": f"[Tool execution results]\n\n{tool_output_text}"})
  ```
  vs. `frontend/src/prompt_security.py:60-83` (`untrusted_context_message`, applied to documents/skills content — see `agent_loop.py:853,1040`).
- **Problem:** For models invoked through the fence/XML tool-call emulation path (used when the provider's native function-calling isn't in play — the same population of "the model under-calls its levers" per C1 in the vision brief), tool output — including `web_search` results, which are LIVE, ATTACKER-INFLUENCEABLE web content since `web_search` is a game-keep-set tool the player can trigger by asking the narrator to "look something up" — is concatenated into a plain `user`-role message with no sandboxing markers. Contrast the explicit `UNTRUSTED_CONTEXT_HEADER`/guard-marker treatment given to documents and skills text. A player who controls what gets searched (or who sets up a page containing adversarial "instructions" and gets the in-fiction narrator to look it up) gets a weaker-hardened injection surface than the codebase's own stated policy for other external content. Native tool-calling providers are unaffected (their results go into a proper `role: tool` message, which most providers already treat as structurally separate from user/system instructions).
- **Fix:** Route the fence/XML fallback's tool-result text through `untrusted_context_message` (or an equivalent guard) exactly as the document/skills paths already do, so the hardening story is consistent regardless of whether the active model supports native function-calling.

### SEC-11 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Provider-returned image URL fetched with no SSRF/host revalidation
- **Where:** `frontend/src/orwell_portraits.py:915-919`:
  ```python
  if img.get("url"):
      # Some providers return a URL instead of inline bytes — fetch them.
      ir = await client.get(img["url"])
  ```
- **Problem:** When the configured image-generation provider's API response contains a `url` field instead of inline base64 bytes, the FE fetches it directly with no call into `url_safety.check_outbound_url`/`is_safe_url` (both already used elsewhere in the codebase for exactly this class of outbound-fetch). The URL originates from the provider's HTTP response, not directly from the player, so the practical trigger requires either a compromised/malicious provider endpoint or a MITM'd proxy in front of a self-hosted "OpenAI-compatible" server — a narrower blast radius than the other findings here, but it is precisely the kind of "server fetches a URL it didn't fully control" pattern the SSRF guards exist to close everywhere else, and it's an easy one-line fix.
- **Fix:** Wrap this fetch with `assert_safe_url(img["url"])` (or `check_outbound_url` with `block_private=False`, matching the embedding-endpoint posture) before the `client.get` call.

### SEC-12 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Secret-redaction vendor-prefix allowlist misses unprefixed secret shapes
- **Where:** `frontend/src/secret_redaction.py:30-44` (`_VENDOR_PREFIXES` covers only `sk-`, `ghp_`, `gsk_`, `xai-`, `AIza`, `glpat-`).
- **Problem:** `redact()`'s vendor-key regex is a closed allowlist of PREFIXED key shapes. It does not — and by construction cannot — catch unprefixed secrets: Telegram bot tokens (`123456:ABC-DEF...`), the engine's own `ORWELL_ENGINE_TOKEN`/`ORWELL_ENGINE_ADMIN_TOKEN`/`ORWELL_INTERNAL_TOKEN` (all plain hex strings), or fal.ai-style `id:secret` keys. The `_AUTH_HEADER_RE` and `_URL_PARAM_RE` patterns provide a second line of defense for header- or query-shaped occurrences, but a log line that embeds one of these tokens directly (e.g. `logger.debug(f"using token {token}")`) would sail through `redact()` untouched. (No such call site was found in this pass — see coverage note below — so this is a latent gap, not a confirmed active leak.)
- **Fix:** Add a fallback rule that redacts any value bound to an env-var/config-key NAME matching `token|secret|key|password` regardless of shape (mirroring `admin_health_routes.py:_redact_config`'s key-name-based approach, which IS robust) as a second pass inside `redact()`, not just a key-name-aware caller.

### SEC-13 — [Severity: Minor] [Effort: <1hr] [Value: Low]
`require_privilege` fails open for any privilege key not yet in `DEFAULT_PRIVILEGES`
- **Where:** `frontend/src/auth_helpers.py:152-177`: `if not privs.get(key, True): raise ...` — the code comment itself says "unknown privileges fail open."
- **Problem:** This is an intentional, documented choice today, but it's a footgun for future development: any NEW `require_privilege(request, "some_new_gate")` call added before the matching key is added to `core/auth.py`'s `DEFAULT_PRIVILEGES` silently grants that privilege to everyone (since `get_privileges` only merges keys that exist in `DEFAULT_PRIVILEGES`, a genuinely-new key is simply absent from the returned dict, and `.get(key, True)` defaults to permitted). A gate that's supposed to be restrictive-by-default ships permissive-by-default until someone remembers the second file.
- **Fix:** Either default missing keys to `False` (deny) and add an explicit migration step when introducing a privilege, or add a lint/test that fails when `require_privilege` references a key absent from `DEFAULT_PRIVILEGES`.

### SEC-14 — [Severity: Minor] [Effort: <1hr] [Value: Low]
`sessions.json` unbounded growth / full-file rewrite per login
- **Where:** `frontend/core/auth.py:158-166` (`_save_sessions` — `_atomic_write_json` rewrites the ENTIRE sessions dict every call); `:556-567` (`create_session_trusted` — every successful login mints a new token and calls `_save_sessions()`, with no per-user concurrent-session cap).
- **Problem:** There's no limit on how many concurrent session tokens a single account may hold, and every login (or 2FA-completion, or admin-driven `set_privileges`, etc. — anything touching sessions) rewrites the whole file. A user who scripts repeated logins (their own valid credentials — the login rate limiter is 15/min per IP but session creation itself is uncapped per-account) accumulates tokens indefinitely until natural TTL expiry (default 24h) prunes them on the NEXT process restart's `_load_sessions()` — the in-memory dict itself is never proactively pruned mid-run except on validate/get-username calls for that SPECIFIC token. This is a mild availability/IO-amplification concern, not an auth bypass.
- **Fix:** Cap concurrent sessions per user (evict oldest on overflow, à la most session stores), and run a periodic sweep of expired sessions independent of individual token lookups.

### SEC-15 — [Severity: Minor] [Effort: <1day] [Value: Med]
Two divergent SSRF guard modules with different threat models
- **Where:** `frontend/src/url_safety.py` (adapted from hermes-agent; `check_outbound_url` permits private/loopback by default for the embedding use case, `is_safe_url`/`assert_safe_url` fail-closed) vs. `frontend/src/url_security.py` (a second, independently-written guard: `is_public_http_url`/`validate_public_http_url`, always fail-closed, with its own `_BLOCKED_NETWORKS` list that doesn't fully match `url_safety.py`'s `_classify`/`_is_dangerous_ip` — e.g. `url_security.py` explicitly blocks `100.64.0.0/10` (CGNAT) and `.internal`/`.lan`/`.intranet` hostname suffixes; `url_safety.py` does not).
- **Problem:** Two near-duplicate SSRF guards, used by different call sites (`grep` shows `url_safety` used by `embedding_routes.py`; `url_security` used by `note_routes.py`, `webhook_routes.py`, `gallery_routes.py`, `contacts_routes.py`, `services/memory/skill_importer.py`), with genuinely different coverage (CGNAT range, internal-hostname-suffix blocking). A future feature (e.g. the image-URL fetch in SEC-11) has a 50/50 chance of reaching for the weaker one, or reaching for neither (as SEC-11 shows). This is a maintainability/security-debt finding, not a standalone exploit.
- **Fix:** Consolidate into one guard module with the union of both threat models (public-fetch fail-closed as the default, an explicit `allow_private=True` opt-out for the embedding-endpoint use case), and update all call sites.

### SEC-16 — [Severity: Minor] [Effort: <1day] [Value: Low]
DNS-rebinding TOCTOU window in the SSRF guards
- **Where:** `frontend/src/url_safety.py:85-101` (`check_outbound_url` resolves via `socket.getaddrinfo` once, at validation time) and `:161-172` (`is_safe_url`, same pattern); `frontend/src/url_security.py:81-94` — its own docstring already flags this: "DNS checks reduce obvious private-network targets but do not eliminate every DNS rebinding race."
- **Problem:** Every guard here validates a hostname's IP at CHECK time, then hands the ORIGINAL HOSTNAME (not the validated IP) to `httpx`/`requests` for the actual fetch, which performs its OWN independent DNS resolution. An attacker controlling DNS for the target hostname (their own domain, pointed initially at a public IP to pass validation, with a very low TTL) can rebind the name to `127.0.0.1`/a cloud metadata address between the check and the fetch. This is the textbook SSRF-via-DNS-rebinding bypass for exactly this "validate-then-fetch-by-name" pattern.
- **Fix:** Resolve once, validate the resolved IP, and connect to that IP directly (pinning the `Host` header / SNI to the original hostname) rather than re-resolving at fetch time — or use an httpx transport with a custom resolver that reuses the validated address.

### SEC-17 — [Severity: Minor] [Effort: <1hr] [Value: Low]
`SECURE_COOKIES` not implied by `ORWELL_TLS_MODE=local`
- **Where:** `frontend/core/middleware.py:197-263` (only `ORWELL_PUBLIC` triggers the `SECURE_COOKIES` check) vs. `:318-324` (`tls_mode_from_env` / the ADR 0014 local-HTTPS feature) and `frontend/routes/auth_routes.py:142-155` (the cookie's `secure=` flag reads `SECURE_COOKIES` directly, defaulting `false`).
- **Problem:** ADR 0014 (local & tunable HTTPS) lets an operator terminate real TLS on their LAN (`orwell.lan`/`orwell.local` via the bundled Caddy) without ever setting `ORWELL_PUBLIC`. In that configuration the session cookie is still issued WITHOUT the `Secure` flag by default, so if the same host is also reachable over plain HTTP on the LAN (common during the transition, or if a client mistypes `http://` instead of `https://`), the session cookie is sent in the clear on that fallback request — the exact class of leak `SECURE_COOKIES` exists to prevent, just outside the one code path (`ORWELL_PUBLIC`) that currently checks it.
- **Fix:** When `ORWELL_TLS_MODE=local` is active, either force `SECURE_COOKIES=true` automatically or add the same fail-closed pattern `assert_public_profile_safe` uses for the public path.

### SEC-18 — [Severity: Polish] [Effort: <1hr] [Value: Low]
CORS `allow_headers` exposes internal-only header names
- **Where:** `frontend/app.py:103-119` — `allow_headers` includes `X-Orwell-Internal-Token` and `X-Orwell-Owner`, both of which are meant ONLY for the in-process loopback tool bypass (`core/middleware.py:INTERNAL_TOOL_HEADER`) and are never legitimately sent by a browser client.
- **Problem:** Listing internal implementation header names in the public CORS allow-list is unnecessary information disclosure about internal plumbing (a client inspecting the CORS preflight response learns these header names exist and are meaningful) and slightly widens the header surface an XSS-via-fetch payload from an allowed origin could attempt to forge (harmless here since the value itself, a random per-process secret, can't be guessed — but the practice is a smell).
- **Fix:** Drop `X-Orwell-Internal-Token`/`X-Orwell-Owner` from the CORS `allow_headers` list — they are never legitimately set by a browser fetch, only by the server's own loopback calls, which don't go through CORS at all.

### SEC-19 — [Severity: Minor] [Effort: <1hr] [Value: Low]
`owner_is_admin_or_single_user` fail-open reused in the (game-build-dropped) email-contacts path
- **Where:** `frontend/routes/email_helpers.py:1273-1277`; `frontend/routes/workspace_routes.py:6,23`.
- **Problem:** Same shape as SEC-3's root cause (treat "unconfigured" as "admin"), reused on the contacts/email-reply-context path. Not reachable in the shipped game build (`email`/`contacts` are in `GAME_DROP_SET`), so lower urgency than SEC-3, but confirms this is a systemic idiom rather than a one-off — anyone fixing SEC-3's root cause should grep for and fix every call site, not just the one exercised by tool execution.
- **Fix:** Fix `owner_is_admin_or_single_user` once at its definition (require loopback in addition to `not is_configured`), which fixes every call site simultaneously.

### SEC-20 — [Severity: Minor] [Effort: <1day] [Value: Med]
`/api/auth/signup` has no captcha/human-check or admin-approval gate
- **Where:** `frontend/routes/auth_routes.py:107-123`.
- **Problem:** With `signup_enabled=true` (an admin opt-in, off by default — acknowledged), any caller can self-register, throttled only 3 requests/300s PER IP — trivially bypassed by rotating source IPs/proxies for a scripted mass-signup. Each new account inherits `DEFAULT_PRIVILEGES`, including the unlimited `max_messages_per_day` (SEC-8), so a batch of scripted signups directly converts into unmetered LLM spend. This compounds SEC-8/SEC-9 rather than standing alone, but is the missing first domino.
- **Fix:** If public signup ships at all, pair it with a non-zero default `max_messages_per_day` for non-admin accounts and/or a lightweight bot check (even a simple proof-of-work or email-verification step) before the account is usable.

### SEC-21 — [Severity: Polish] [Effort: <1hr] [Value: Low]
No runtime warning when a hand-deployed engine has admin token == player token
- **Where:** `deploy/orwell-install.sh:242-268` (mints both tokens correctly by default); `deploy/orwell-doctor.sh:145-179` (reads whichever token is set, treating them somewhat interchangeably for its own probe, but never asserts they differ).
- **Problem:** The OFFICIAL installer avoids SEC-5 entirely by generating distinct tokens. Anyone who deploys by hand (a common self-host pattern — copy `.env.example`, fill in values, `docker run`/`systemctl start`) has no code path telling them the two tokens should differ, and the doctor script — the one tool explicitly built to catch exactly this kind of misconfiguration — doesn't check it either.
- **Fix:** Add a check to `orwell-doctor.sh` (and ideally to engine boot itself, as a warning log) that flags `ORWELL_ENGINE_ADMIN_TOKEN == ORWELL_ENGINE_TOKEN` or the admin token being unset while the player token is set.

### SEC-22 — [Severity: Minor] [Effort: <1hr] [Value: Low]
Tool-blocking is a denylist keyed on exact name / `mcp__` prefix
- **Where:** `frontend/src/tool_security.py:149-161` (`is_public_blocked_tool`).
- **Problem:** `NON_ADMIN_BLOCKED_TOOLS` is a fixed set of exact strings; `is_public_blocked_tool` also blocks anything prefixed `mcp__`. This is fail-closed for malformed input (good — see the docstring) but is still a denylist for the KNOWN-tool case: a future tool added with a name that should be admin-only but is misspelled relative to the set (or intentionally aliased) silently ships unblocked. The `plan_mode_disabled_tools()` sibling in the same file already demonstrates the safer pattern (allowlist-derived denylist with a static backstop) — this function doesn't use it.
- **Fix:** Either derive `NON_ADMIN_BLOCKED_TOOLS` the same allowlist-inverted way `plan_mode_disabled_tools()` does, or add a test that asserts every tool name in `_ADMIN_TOOLS`/`FUNCTION_TOOL_SCHEMAS` sensitive-by-category (filesystem, shell, secrets, integrations) is present in `NON_ADMIN_BLOCKED_TOOLS`.

### SEC-23 — [Severity: Polish] [Effort: <1hr] [Value: Low]
Per-user engine queue has no rate limit, only ordering
- **Where:** `src/adapters/mcp/HttpMcpServer.ts:133-154` (`enqueue`/`queues` — "two in-flight calls for the SAME user run in order... Different users still run fully concurrently").
- **Problem:** This mechanism is documented as a correctness fix (serialize a user's own calls to prevent a sandbox-swap race), not a rate limit — but it's also the closest thing to a per-user throttle the engine's HTTP edge has. A caller who holds the (possibly-shared, per SEC-5) engine token can flood a SPECIFIC victim user's queue with garbage calls, and while they'll all execute in order rather than racing, nothing bounds how many can be queued — a targeted low-and-slow DoS against one user's turn latency.
- **Fix:** Not urgent given the token is meant to be trusted-FE-only, but worth a documented bound (e.g. cap queued jobs per user, reject with 429 past a threshold) now that the token boundary has the gaps in SEC-3/SEC-5.

### SEC-24 — [Severity: Minor] [Effort: <1hr] [Value: Low]
Gateway secret's dormant-by-default posture isn't called out in the ship-gate doc
- **Where:** `frontend/routes/gateway_routes.py:8-23` (the module's own detailed docstring IS honest about the dormant default); `docs/audits/2026-06-27-ship-gate.md` (the golden-path gate that's supposed to be "what blocks ship").
- **Problem:** The ship-gate is the authoritative "what blocks ship" reference per CLAUDE.md, and its G1–G9 golden path is casting→eviction — it doesn't appear to enumerate "gateway platforms configured without a webhook secret" as a checked item (confirmed no `gateway`/`webhook`/`TELEGRAM` mention found in a grep of that doc's known content referenced elsewhere in this repo). A feature this security-sensitive (SEC-2 is a Blocker) shipping without a corresponding named gate item means it can pass every other pre-ship check while remaining wide open.
- **Fix:** Add an explicit gate item: "any registered gateway platform (Telegram, etc.) MUST have its webhook secret configured before `ORWELL_PUBLIC=true`" — enforced by SEC-6's fix, verified in the ship-gate doc.

### SEC-25 — [Severity: Minor] [Effort: <1day] [Value: Med]
TOTP backup codes stored as plaintext
- **Where:** `frontend/core/auth.py:494-496` (`totp_confirm_enable`: `backup = [secrets.token_hex(4) for _ in range(8)]; self._config["users"][username]["totp_backup_codes"] = backup` — written straight to `auth.json`); `:513-521` (`totp_verify`: `if code in backup:` — a direct plaintext comparison against the stored list).
- **Problem:** Every other credential in this file is hashed before storage — passwords via bcrypt (`_hash_password`), pairing codes via HMAC-SHA256 (`pairing.py:_hash_code`) — but the eight 2FA backup codes are written to `auth.json` in plaintext. Anyone who can read that file (a backup snapshot, a misconfigured permissions bug, a path-traversal read elsewhere in the app) gets live, usable second-factor bypass codes for every 2FA-enabled account, not just a hash they'd need to crack.
- **Fix:** Hash backup codes the same way pairing codes are hashed (HMAC or bcrypt) and compare via `hmac.compare_digest`/`bcrypt.checkpw` instead of storing/comparing plaintext.

### SEC-26 — [Severity: Polish] [Effort: <1hr] [Value: Low]
Two independently-gated proxy-trust decisions can drift
- **Where:** `frontend/src/rate_limiter.py:55-65` (`_trust_proxy_headers`: trusts `X-Forwarded-For`/`CF-Connecting-IP`/etc. when `ORWELL_PUBLIC` OR `TRUST_PROXY_HEADERS` is set); `frontend/app.py:282-301` (`_is_trusted_loopback`: excludes any request carrying those SAME headers, UNCONDITIONALLY, regardless of `ORWELL_PUBLIC`/`TRUST_PROXY_HEADERS`).
- **Problem:** Not a live bug today (the auth-bypass path is intentionally MORE conservative, which is the safe direction), but the two mechanisms encode overlapping proxy-trust logic in different files with different trigger conditions. A future edit to one (e.g. adding a new forwarded-for-style header to the rate limiter) has no reason to also update the other, and the asymmetry itself is easy to misread during review as "this is already handled elsewhere."
- **Fix:** Factor `_PROXY_FWD_HEADERS` (app.py) and the header list `client_ip()` reads (rate_limiter.py) into one shared list/module so the two trust decisions can't silently diverge.

### SEC-27 — [Severity: Minor] [Effort: <1hr] [Value: Low]
Password reset doesn't revoke the user's live API bearer tokens
- **Where:** `frontend/core/auth.py:432-452` (`admin_reset_password` calls `self.revoke_user_sessions(username)` — browser sessions only) vs. `:250-298` (`delete_user`, which DOES additionally revoke `ApiToken` rows for the user).
- **Problem:** If an admin resets a user's password because their account is believed compromised, that user's existing API bearer tokens (`ody_...`, used for external integrations) remain valid indefinitely — the reset closes the browser-session door but leaves the API-token door open, which is exactly backwards from what "I think this account is compromised, reset it" usually intends to achieve.
- **Fix:** Have `admin_reset_password` (and self-service `change_password`, which has the same gap) also revoke the user's active `ApiToken` rows, matching `delete_user`'s behavior — or make it an explicit, clearly-labeled checkbox in the admin UI ("also revoke API tokens").

### SEC-28 — [Severity: Polish] [Effort: <1hr] [Value: Low]
producerVault unseal audit log omits requester identity
- **Where:** `frontend/routes/admin_health_routes.py:1077` — `logger.info("[ops] admin UNSEALED the producer's vault (debug override of mandate #2)")`.
- **Problem:** Given how sensitive this action is (SEC-4), the log line that's supposed to be the accountability trail for "who pulled a full spoiler dump" doesn't include the requesting admin's username, session, or source IP — only that SOME admin did it, sometime. On a multi-admin deployment this makes after-the-fact "who spoiled my season" investigation impossible.
- **Fix:** Include `user` (already resolved earlier in the function via `effective_user(request)`) and `client_ip(request)` in the log line.

---

## Coverage / where I looked

Read/grepped: `frontend/src/tool_security.py`, `frontend/src/auth_helpers.py`, `frontend/core/auth.py`,
`frontend/core/middleware.py`, `frontend/app.py` (auth middleware, CORS, TrustedHost, security headers,
public-profile guard), `frontend/routes/auth_routes.py`, `frontend/routes/gateway_routes.py` +
`frontend/gateway/{pairing,handler,turn_limits}.py` + `frontend/gateway/platforms/telegram.py`,
`frontend/routes/admin_health_routes.py` (producerVault, debug-bundle, `_redact_config`),
`frontend/routes/vault_routes.py` (the unrelated Bitwarden integration, checked and ruled out),
`frontend/src/{url_safety,url_security}.py`, `frontend/src/secret_redaction.py`,
`frontend/src/secret_storage.py` + `core/database.py`'s `EncryptedText` (ruled out — API keys ARE
encrypted at rest), `frontend/src/rate_limiter.py` + every call site, `frontend/src/upload_limits.py`
+ `frontend/routes/orwell_routes.py`'s headshot-intake route + `frontend/src/orwell_portraits.py`'s
image normalize/fetch paths, `frontend/src/prompt_security.py` + its call sites in
`frontend/src/agent_loop.py`, `frontend/src/settings.py` (game-build keep/drop sets),
`frontend/routes/chat_helpers.py` (`_enforce_chat_privileges`), `frontend/src/tool_execution.py`
(admin-tool gating), engine-side `src/adapters/mcp/HttpMcpServer.ts` (token auth, requireUser,
knownUser, body caps, per-user queueing, health metrics wiring), `src/adapters/mcp/McpServer.ts`
(`allows`/`callTool`/`DEBUG_VAULT_TOOL_NAMES` dispatch), `src/adapters/mcp/healthMetrics.ts`,
`src/surfaces/tools/registry.ts` (`DEBUG_VAULT_TOOLS`), `src/main.ts` (engine env wiring),
`deploy/orwell-install.sh` + `deploy/orwell-doctor.sh` (token minting/checking).

**Not covered / handed to other lanes:** the FE JS rendering of `recentFailures[].tool` and other
admin-dashboard fields for possible stored-content/XSS (flagged as a follow-on in SEC-7 but not
verified — front-end/UI lanes' territory); the TS domain core's Vault-Wall dependency-cruiser test
itself (already a hard CI gate per CLAUDE.md, not re-audited here); `frontend/routes/webhook_routes.py`
(the INHERITED-workspace webhooks vertical, dropped in the game build via `GAME_DROP_SET`, so not part
of the shipped attack surface — spot-checked its existence, not deep-read); email/contacts/documents
routes beyond the one `owner_is_admin_or_single_user` call site (SEC-19) — all dropped in game build.

**Ran out of real issues?** No — stopped at ~28 high-confidence findings per the effort budget, not
because the territory was exhausted. Likely-fruitful unexplored ground for a follow-up pass: the
`api_token_routes.py` scope-enforcement model (are `chat`-scoped tokens actually restricted from
owner-scoped session/document endpoints at every route, or only some?); `admin_transcript_routes.py`
(admin transcript export — another Vault-adjacent surface analogous to producerVault, not checked for
the same `AUTH_ENABLED=false` bypass pattern); `mcp_manager.py`/`mcp_oauth.py` (third-party MCP server
integration — a potential SSRF/credential-forwarding surface, dropped in game build but present in the
full workspace); the `orwell_overseer_debug.py` module (named like a debug surface, not opened this
pass).

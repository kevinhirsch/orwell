# Orwell operations, security & test-integrity audit — 2026-06-09 (round 3)

> 📋 **Audit record** · 2026-06-09 · Operations · security · test-integrity (round 3) · **Status:** Historical record

The third audit pass, covering the ground the first two (product/engine/wiring; front-end
experience) did not: **deploy & operations**, **front-end application security**, and the
**test suite / CI as a quality gate**. Synthesized from three parallel deep audits against
`main` at `922700d` (after the B34–B36 hotfixes and the 0041 SoulStore linchpin merged).

A fourth pass — **reconciling the prior audits against the post-audit merges** (which findings
are now actually fixed) — was started and deliberately parked; the confirmed fragments are
folded into §D below.

## The through-line

The first two audits found the gameplay and experience gaps. This pass finds that **the
front-end ↔ engine boundary is where the real operational risk concentrates**, and that **the
green test gate gives false confidence on three of the four mandates.** Two findings stand out
because three independent auditors converged on them:

- **The B34 security hardening is wired only halfway.** The engine enforces
  `ORWELL_ENGINE_TOKEN`, but the front-end has no code path to *send* it — so turning auth on
  (as the docs instruct) bricks the game, and the only working config runs the engine
  unauthenticated behind nothing but the loopback bind. (Deploy D1 + Security #3 + Test F5,
  same seam.)
- **Non-degradation is violated in production right now, and the gate can't see it.** The live
  durable snapshot persists `knowledge: []` — the player's accumulated knowledge layer is
  dropped on every save — while the non-degradation gate passes against a *different* state
  builder that does track knowledge. This is the product audit's C2, now confirmed as a live
  regression by the test auditor. (Test F1.)

The good news, equally important: **the front-end's own security posture is sound** — the
authenticated-user → sandbox-key trust path cannot be spoofed, dropped dangerous verticals are
genuinely unmounted server-side, and auth/sessions/multi-tenant isolation are well-built. No
critical or major auth-bypass exists. The risks here are operational and test-integrity, not
app-security.

---

## A. Deploy & operations

**A1 · CRITICAL · NEW — The `ORWELL_ENGINE_TOKEN` hardening is a footgun: enabling it bricks
the UI; leaving it off (the only working config) runs the engine unauthenticated.** The engine
401s any request without the token (`HttpMcpServer.ts:92`, read from env at `main.ts:39`), but
the front-end client sends only the user header — no token code path exists anywhere in
`frontend/` (`orwell_engine.py:24-27, 172-181`; a full grep for `ENGINE_TOKEN`/Bearer-to-engine
is empty), and the install scripts never set or generate it (`orwell-install.sh:65-93`). Yet
`docs/INSTALL.md:103-104` tells the operator to set it ("the front-end must then send it"). So
the default deploy has engine auth **off** (saved only by the loopback bind), and the documented
way to turn it on returns 401 on every call and stops the game. The hardening can only break the
deploy, never protect it.
*Fix:* (1) front-end reads `ORWELL_ENGINE_TOKEN` (+ `BBAI_` fallback) and attaches
`Authorization: Bearer` in both `_call` and `_admin_call`; (2) installer auto-generates a token
into `.env` so auth is on by default; (3) smoke tests a token round-trip.
*Acceptance:* with the token set, the FE completes a full turn and a tokenless `curl` to
`/player/call` 401s; with it unset, behavior is unchanged.

**A2 · MAJOR · NEW — Multi-user mode is defeated by the FE always sending a header.** The engine
rejects only a *missing* `x-orwell-user` (`HttpMcpServer.ts:97-98`), but the FE defaults it to
`"default"` (`orwell_engine.py:27`), so with `ORWELL_ENGINE_MULTIUSER=1` set, unauthenticated
sessions silently collapse into one shared sandbox instead of being refused — 0021 cross-user
isolation is not enforced at deploy. *Fix:* the FE sends no user header when there's no
authenticated owner (so the engine 400s), or the engine treats literal `"default"` as
unauthenticated under multi-user. *(Note: the FE→engine path for **authenticated** users is
sound — see Security B1. This is specifically the anonymous/multiuser edge.)*

**A3 · MAJOR · NEW — The installer writes an LLM key the front-end never reads; "configured"
is a false signal.** Install prompts for and writes `ANTHROPIC_API_KEY`/`OLLAMA_HOST` into
`.env` (`orwell-install.sh:84-90`), but the live engine narrator is `EchoNarrativePort`
(`outwardRoot.ts:36`) — all real narration is the FE's job, and the FE reads `OPENAI_API_KEY`/
`LLM_HOST`/`settings.json` (`constants.py:34-36`), not `ANTHROPIC_API_KEY`. A freshly installed
box with a supplied key is **not** playable; the LLM must be configured in the UI. *Fix:* map
the installer prompt to the names the FE consumes, or change the copy to say "configure the LLM
in Settings after install." *Acceptance:* either a supplied key yields narration with zero UI
config, or the docs/prompt say so plainly.

**A4 · MAJOR · NEW — Updates are non-atomic, unpinned, and have no rollback.**
`orwell-update.sh:66-72` does `git reset --hard origin/main` **then** `npm ci && build` under
`set -e`; a build failure leaves the tree on new `main` with the old `dist/`, and a later manual
restart runs a half-updated tree. Always `main`, `--depth 1` — not reproducible, a bad upstream
commit is pulled blindly, no `--rollback`. *Fix:* build before committing to the swap (restart
only on build success; leave the prior checkout on failure); add `REF`/`TAG` pinning; keep the
prior `dist`/SHA for rollback. *Acceptance:* a forced build failure leaves services on the
previous build with a clear message; an operator can pin a ref and roll back.

**A5 · MAJOR · NEW — Both services run as root with an internet-facing FastAPI app and no
systemd hardening.** Neither unit sets `User=` (`deploy/systemd/*.service`); the FE binds
`0.0.0.0:${ORWELL_PORT}` as root with no `NoNewPrivileges`/`ProtectSystem`/`PrivateTmp`. Any FE
RCE or traversal is instant root, with the `.env` keys, all saves, and the Vault layer
root-readable to the same process. *Fix:* an `orwell` system user, `chown` app+data, `User=`
in both units, and the standard hardening directives with `ReadWritePaths` scoped to the data
dirs. *Acceptance:* `systemctl show -p User` is non-root and the game still plays.

**A6 · MAJOR · OVERLAPS-E11 (confirmed at deploy) — Boot doesn't preload saved users; the
"house lives between turns" guarantee is off after every restart.** The watcher iterates
`registry.usernames()` (`gameWatcher.ts:52`), which returns only in-memory sandboxes built
lazily on request (`registry.ts:108, 155-157`); at process start the map is empty and nothing
loads disk saves. Every `orwell-update.sh` restart freezes all saved users' off-screen society
until each next call — contradicting the 0035 promise updates routinely restart through. *Fix:*
at `runtime.start()`, enumerate `saveStore` users and warm their sandboxes. *Acceptance:* after
a restart with N saved users and a live watcher, off-screen events accrue with no prior request.

**A7 · MAJOR · NEW — The smoke test proves ports answer, not that the system works.**
`deploy/smoke.sh` builds and starts only the **engine**, curls its own port, and stops at
`createCharacter`/`getMomentPrompt` — it never boots the FE, never hits `ORWELL_PORT`, never
drives `advanceGame`/`submitDecision`, and never runs with a token set. A green smoke is fully
compatible with a broken FE, broken FE↔engine wiring (A1/A3), or a non-advancing game. *Fix:*
add a stage that boots the FE, hits a real route, and drives one create→advance→decision turn
through it, including one pass with the token on. *Acceptance:* smoke fails if the FE can't
reach the engine or a turn can't complete.

**A8 · MAJOR · NEW — No backups, readiness signal, or DR runbook.** "Backups" is prose ("copy
the directory", `INSTALL.md:90-94`) — no script, no scheduled `vzdump`, no restore verification
— and it **misstates the layout** (the FE SQLite is at `frontend/data/app.db`; engine saves are
JSON sandboxes under `data/` — two dirs, one undocumented). `/health` is liveness only. *Fix:*
ship `orwell-backup.sh`/`orwell-restore.sh` covering both data dirs, document the layout
correctly, add a readiness check (engine reachable + FE up + LLM configured). *Acceptance:* a
documented backup→wipe→restore round-trips a game; readiness returns non-OK when the LLM is
unconfigured.

**A9 · MINOR · NEW — Saves and secrets share one dir; reset relies on a name-based exclusion.**
`ORWELL_DATA_DIR=/opt/orwell/data` also holds `.env`; factory-reset scrubs everything except a
file literally named `.env` (`orwell-factory-reset.sh:172-174`). Works today, but a generated
token (A1) or a renamed keep-file would be wiped; the script's own comment about `ORWELL_DATA_DIR`
is stale. *Fix:* put saves in a dedicated `data/saves/` subdir distinct from `data/.env`; scrub
the subdir wholesale.

**A10 · MINOR · NEW — Misc deploy hygiene.** `EnvironmentFile` is mandatory (a manual unit
install before `.env` exists fails confusingly; mark it optional or document ordering); the FE
`Wants=` (not `Requires=`) the engine, so it starts degraded silently. `curl|bash` from
unpinned `main` runs as root with no checksum/signature (inherent to the model — support
`REF=` + document verification). No journald size cap or `SyslogIdentifier` on a small LXC, and
no assertion that an API key never lands in logs.

**Verified-good (deploy):** the loopback bind *is* correctly wired through install (the `.env`
doesn't widen it); update never deletes `data/` and smoke asserts it; factory-reset has solid
path-safety guards and correctly resolves the engine save dir (fixing the prior "reset left the
game intact" bug); all scripts pass `bash -n`; `.env` is mode 600; legacy `bbai-*`/`BBAI_*`
fallbacks are consistent.

**Operator verdict:** *not confidently production-ready.* Run only with engine auth off (A1),
likely needing manual LLM config (A3), as root (A5); updates are unpinned/non-atomic/no-rollback
(A4) and freeze the house (A6); no real backups/restore (A8). Must-fix before a confident prod
run: A1 → A4 → A5 → A6 → A7 → A8.

---

## B. Front-end application security — posture is sound

The decisive questions came back clean. **No critical or major auth-bypass or data-exposure
finding.** Everything below is minor/hygiene, calibrated to a self-hosted, mostly-single-user
deploy.

**B1 · the sandbox-key trust path is SOUND (no vuln).** The engine `X-Orwell-User` key is
derived **server-side from the authenticated session**, never from client input: the client
never sends it (`orwell_engine.py:24-27`), every route resolves `user` from
`request.state.current_user` (`orwell_routes.py:28-31`, `chat_helpers.py:555-561`), which the
auth middleware stamps only from a validated session cookie/bearer (`app.py:282-365`), and
usernames are unique/reserved-protected (`auth.py:66, 207-228`). A browser client cannot inject
an arbitrary user; it is overwritten server-side on every call. A user cannot read or drive
another's game through the front-end.

**B2 · dropped dangerous verticals are TRULY unmounted (mostly).** The game build gates
*router registration* via `mount_optional` (`settings.py:278-286`), so shell (`/api/shell/exec`,
subprocess), web_search, rag, documents, gallery, email, calendar, etc. return **404 even for
an admin** under the default game build (`app.py:516-745`; verified by `test_game_build.py`).
The shell-executing builtins are reachable only through dropped, admin-gated task routes.
*Gap (Minor):* two inherited verticals — `vault_routes` (Bitwarden/`bw` CLI, `app.py:737`) and
`mcp_routes` (register external MCP servers incl. `stdio` = arbitrary host binary,
`app.py:693`) — are mounted **unconditionally**. Both are `require_admin`, so not an escalation
path, but they're extra surface in a build whose stated intent is "the game and nothing else."
*Fix:* route both through `mount_optional` under their own keep flags; assert 404 under
`ORWELL_GAME_BUILD=1`.

**B3 · MINOR · the engine port has no auth wired** — same fact as A1 from the security angle:
protected only by the loopback bind; anyone who can reach `127.0.0.1:8765` can drive any
sandbox via `X-Orwell-User`. Nil impact on a single host; real if the engine is ever bound
off-loopback or another untrusted process runs locally. *Fix:* as A1.

**B4 · MINOR · auth rate-limiting keys on `request.client.host`** (`auth_routes.py:79-81`,
`rate_limiter.py`) — behind the anticipated Cloudflare tunnel/reverse proxy that's the proxy IP,
so all users share one bucket (brute-force protection collapses to a global 15/min; one client
can lock out everyone). *Fix:* trusted `X-Forwarded-For` keying and/or per-username lockout.

**B5 · MINOR · `SECURE_COOKIES` defaults false and the installer doesn't set it**
(`auth_routes.py:141`). Cookie is `httponly`+`samesite=lax` (strong; lax blocks the CSRF POST
vector), but without `Secure` it can ride plain HTTP. *Fix:* default `SECURE_COOKIES=true` in
the deploy env or auto-set on `X-Forwarded-Proto: https`.

**B6 · MINOR (hygiene) · the named-entitlement layer is dead code.** `require_entitlement`/
`has_entitlement` exist and `/api/auth/status` advertises entitlements to the UI, but **no
route calls `require_entitlement`** — every gated route uses bare `require_admin`. Functionally
equivalent today (admin carries all entitlements), but a future "grant a non-admin
`manage_llm_settings`" config will silently not work. *Fix:* route LLM-settings/user-management
through `require_entitlement`.

**B7 · INFO · `frontend/requirements.txt` is fully unpinned** (only `pydantic>=2.0`) —
reproducibility/supply-chain risk, not an active vuln. Pin with a lockfile/hashes. (Mirrors the
engine side: deploy A10.)

**Verified-good (security):** bcrypt cost-12 hashing; TOTP with one-time backup codes that
**fail closed**; 7-day server-side sessions revoked on delete/rename/password-change, `httponly`
+`lax` cookie; **every** admin route re-checked server-side (UI hiding never trusted); the
God-Mode/engine-admin bridge gated to admins only (`tool_execution.py:1214`); chat
sessions/history/images strictly owner-scoped; path traversal confined via `commonpath`+
`realpath`; no reachable `eval`/`exec`/`os.system`/`pickle`/`yaml.load(unsafe)`; LLM secrets
deep-scrubbed for non-admins and never returned raw; strong CSP with per-request nonce + HSTS +
frame-deny; localhost-default CORS without wildcard; first-user-is-admin race-locked; 45s
request-timeout DoS guard.

**Posture verdict:** (a) **single-user localhost — safe**; (b) **a few invited users — safe with
minor hardening** (set `SECURE_COOKIES`, keep the engine on loopback); (c) **internet-exposed —
acceptable behind HTTPS + trusted proxy after** fixing B4/B5, wiring the engine token (A1/B3),
dropping the two stray verticals (B2), pinning deps (B7), and requiring admin 2FA. The core
authN/authZ and multi-tenant model hold throughout.

---

## C. Test suite & CI as a quality gate

Real coverage is high (**97.6% lines / 87.9% branch**), determinism is airtight, and
skip-hygiene/name-agnosticism are clean. But the gate gives **false confidence on three of the
four mandates** because the headline invariant tests run against bespoke fixtures disconnected
from the live loop. **Blunt verdict — with every gate green, all of the following could ship
broken and no test would fail:**

**C1 · CRITICAL · NEW (confirms product-audit C2) — Non-degradation is violated in production
and the gate hides it.** The live durable snapshot hardcodes `knowledge: []`
(`sessionSnapshot.ts:79`) and `SessionSnapshot` has no knowledge field (`:38-41`), so the
player's accumulated knowledge is dropped on every save and not restored. The non-degradation
gate (property test + BDD 0007) runs a **different** builder (`gameProgression.ts`) whose
`counts()`/`isSuperset` *do* track knowledge (`saveState.ts:75, 91`), and the live durable test
(`durablePersistence.test.ts`) never asserts knowledge survives. *Fix:* add `knowledge` to
`SessionSnapshot`, populate it in `toGameState`/the adapter, and add a live-path test (surface a
fact → save+restart via `FileSaveStore` → assert the factId and `counts().knowledge` survive).
*Acceptance:* the new live restart test fails before the snapshot fix, passes after.

**C2 · CRITICAL · NEW (confirms product-audit D3, now for the GATED BDD) — The #1 mandate's gate
measures a rigged simulator's own inputs.** Both the richness property test and the **gated** BDD
0003 compute `richnessMetrics(simulateSeason(...))`; `simulateSeason` (`simulation.ts`) is
imported by **nothing in production** (the game runs `liveSeason.ts`). In it, `reveals` is
hardcoded 0/1 (`:100`) so `maxRevealsPerMoment ≤ 1` is structurally impossible to violate, a
backstop force-sets a reveal if none occurred (`:116-118`) so `surfacingRate > 0` is a tautology,
and `offscreenShare ≥ MIN` asserts the fixture's own probability constant (`:73`). The live loop
could produce flat, reveal-free seasons and the behavioral-fidelity gate stays green. *Fix:*
compute `richnessMetrics` from a real `Orchestrator`/`liveSeason` run's EventStore over a full
season; remove the `reveals=1` backstop; quarantine `simulation.ts`. *Acceptance:* mutating the
live reveal gate to "never reveal" fails the test; the backstop's removal doesn't make it
vacuously pass.

**C3 · MAJOR · NEW — Anti-sycophancy fairness is tested only at the pure unit, never on the live
loop.** `outcomes.property.test.ts` calls `resolveCompetition` directly with no soul modifier;
`liveSeason.test.ts` only checks a winner exists + seed-determinism. The live loop wires the soul
emotional modifier (0006/0028/0041) into resolution; a sign error or player bonus there would
systematically protect the player and no live statistical test would see it. The unit band is
also a loose 65–80% vs the documented ~72%. *Fix:* a live-path statistical test (favorite-win
band + `winRate(player) == winRate(npc)` at identical stats/soul over N seeds). *Acceptance:*
injecting a +0.1 player modifier into the live path fails it.

**C4 · MAJOR · NEW (confirms product-audit E7) — dependency-cruiser OUTWARD omits the narrative
adapter.** `.dependency-cruiser.cjs` OUTWARD covers `surfaces|services|outwardRoot|adapters/mcp`
but not `adapters/narrative/` — the literal pipe to the model. Wiring `VaultStore`/`SoulStore`
into `LlmNarrativePort` to "enrich" narration would pass the structural gate. *Fix:* add
`^src/adapters/narrative/` to OUTWARD. *Acceptance:* a temporary `import type { VaultStore }` in
`LlmNarrativePort.ts` fails `test:arch`. (The post-0041 engine-only set is otherwise correct —
soul/embedding/sessionSnapshot are forbidden.)

**C5 · MAJOR · NEW — No FE test of the authenticated-user → sandbox isolation.** The trust path
is sound today (Security B1), but nothing guards it: no test asserts the route passes
`current_user` (not request body, not `"default"`) into the engine call, or that two authed users
get distinct sandboxes. A regression to forward a client-supplied user would pass every gate.
*Fix:* an FE test that breaks if the route forwards a client-supplied user. *Acceptance:*
changing the route to trust a client `user` fails the test.

**C6 · MAJOR · NEW (confirms product-audit E8) — The sentinel canary never runs against
live-generated hidden content.** The sentinel property test injects sentinel-tagged Vault data
manually into `buildEngineCore` and checks outward surfaces — real but narrow; the UAT drives the
live loop but its leak check is a fixed numeric regex (`VAULT_LEAK_PATTERNS`), so a hidden
*content string* the live loop generates (a confessional line) leaking verbatim into
`getMomentPrompt` would be invisible to both. *Fix:* tag live-generated hidden content with a
unique sentinel and assert it never appears on any player-channel response across seeds.
*Acceptance:* echoing a seeded live confessional sentinel on a player surface fails.

**C7 · MAJOR · NEW — Feature 0038 is spec'd but silently un-gated.**
`0038-live-offscreen-society.feature` has 6 scenarios and **zero step definitions** (cucumber
`--dry-run`: 26 undefined steps), absent from `cucumber.cjs` — including "no player surface
reveals a hidden scene or opinion number" and "no off-screen activity carries one user's content
into another's game." An executable-looking spec implies coverage that doesn't exist; the
gossip→player half (B27b) is genuinely unbuilt. *Fix:* either gate 0038 with real steps (build
B27b) or move its `.feature` to `drafts/`. (Other un-gated `.feature`s — 0010/0029/0032/0033 —
are covered by deploy/pytest lanes; acceptable, but 0035/0036/0038 imply BDD coverage that's only
partial.)

**C8 · MINOR · NEW — CI never runs coverage.** `.github/workflows/ci.yml` runs the full
test/smoke/pytest gate but no `test:cov` and no thresholds, so coverage can silently regress.
*Fix:* a coverage job with per-directory branch thresholds (`src/engine`, `src/composition`,
`src/adapters/engine` ≥ 90%). *Acceptance:* dropping a covered branch below threshold fails CI.

**C9 · MINOR · NEW — The 97.6% headline masks the orchestrator rollback path.**
`orchestrator.ts:184-200` — the fail-closed integrity checkpoint's rollback branch, the thing
that protects against persisting a degraded/leaky state — is partially uncovered, as is
`GameSessionAdapter` finale-answer rejection (81% branch). *Fix:* force an integrity failure →
assert rollback + no persist; cover the finale-answer reject path.

**Verified-good (tests):** determinism is clean (SeededRandom + FakeClock everywhere, no
wall-clock/`Math.random`/real-timer sleeps; UAT reproducible across 17 seed/strategy combos); no
`.skip`/`.only`/`.todo`/no-assert/tautology tests; name-agnostic throughout (role-words, no
sample-save content); the Vault **structural** boundary is real and correctly includes the
post-0041 soul/embedding types; engine-side cross-user isolation is genuinely guarded; CI exists
and runs the full functional gate.

---

## D. Reconciliation fragments (the parked 4th pass)

Confirmed before parking — fold into the queue's status before closing items:

- **E3 (orchestrator bypassed) — STILL OPEN.** `HttpMcpServer` routes via the resolver straight
  into `sb.mcp.player` with no orchestrator reference; player turns skip the integrity
  checkpoint. (This is why C9's rollback path is also hard to reach in practice.)
- **B3 (finale relay) — STILL OPEN.** `tool_schemas.py:1319` submitDecision enum is still only
  the four weekly kinds; finale kinds rejected; the finale remains unplayable through the FE.
- **0041 emotional-arc — genuinely LIVE.** `emotionalArc.evolve` has real production callers
  (`GameSessionAdapter` inflect/evolveFromBeat) — the linchpin shipped working. (Whether it
  resolved C1-ceremony-folds / D1-hidden-elements / D2-live-modifier is exactly what the full
  reconciliation pass will settle; the test auditor's C3 suggests the live emotional modifier is
  wired but **unverified for fairness**.)
- A full ledger (every finding → fixed/partial/open + test-guarded?) is still owed; resume the
  reconciliation agent when ready to prune the queue.

---

## Cross-cutting priorities (round 3)

1. **Wire the engine token end-to-end** (A1 / B3 / C5-adjacent) — the single highest-value fix:
   it closes the deploy footgun, the unauthenticated-engine risk, and lets the FE→engine path be
   secured and tested together.
2. **Fix the live knowledge-drop and test it on the live path** (C1 / product-audit C2) — a real
   non-degradation regression shipping today, invisible to the gate.
3. **Re-point the mandate gates at the production loop** (C2 richness, C3 anti-sycophancy, C6
   sentinel) — so the #1, #3, and #2 mandates are actually measured on the game the player plays.
4. **Make deploy production-grade** (A4 atomic/rollback update, A5 drop root + harden, A6 preload
   at boot, A7 real smoke, A8 backup/restore).
5. **Close the structural test gaps** (C4 narrative adapter in the boundary, C7 gate-or-quarantine
   0038, C8 coverage in CI).

The app-security posture (§B) needs only minor hardening before a multi-user or internet deploy
and no critical work — a notably healthier result than the operations and test-integrity lanes.

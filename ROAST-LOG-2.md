# Orwell — Pre-Launch Roast Ledger #2 (Wave 3 · second-auditor session)

> **Filename is deliberately `ROAST-LOG-2.md`** to avoid a cross-branch write collision with the
> first auditor's `ROAST-LOG.md` (PR #519, 64 findings, branch `claude/inspiring-archimedes-aq6hsl`;
> its two `[BLOCK]`s are LIVE-4 staged-comp cascade skips noms+veto ceremonies, LIVE-7 eviction
> fabricated ahead of the engine — both confirmed there, not re-roasted here).
> **Companion to** that file (Waves 1–2 + the live `-pro`/`-flash` run) and to `AUDIT-LOG.md`.
> This file is a **parallel second auditor** on branch `claude/focused-turing-7d710o`. Every entry
> here is **NEW** — re-confirmed in current source (file:line) and cross-checked absent from both
> prior ledgers. Single writer = the lead; read-only specialists fan out and return findings.

## Environment constraint (recorded, 2026-06-22)
**The live-LLM lane could not run in this sandbox.** Outbound egress to `openrouter.ai` is refused
at the environment network-egress layer (`HTTP 403`, `x-deny-reason: host_not_allowed`,
"Host not in allowlist") — confirmed sandboxed, with the API key, and with the Bash sandbox
disabled (all identical). Playwright browser CDNs are likewise blocked, but a Chromium build is
**pre-installed** at `/opt/pw-browsers/chromium-1194`, so deterministic browser telemetry (local
`fake_model_server.mjs` + `EchoNarrativePort`) is feasible; live narration-fidelity is not.
**To unblock live play:** add `openrouter.ai` to the environment's egress allowlist and restart the
session so the policy propagates. The prior PR #519 session already ran a real `-pro`/`-flash`
season (findings LIVE-1..10 there) — so the live lane is not unexplored, only un-rerunnable here.

## Severity legend
`[BLOCK]` launch-blocking · `[POLISH]` high-priority polish · `[LATENT]` latent/potential · `[NIT]`
small/cosmetic · `[DOC]` doc drift. Status: `PROPOSED` (specialist) · `CONFIRMED` (lead-verified in
source) · `VIEWED` (telemetry) · `ROOT-CAUSED`.

---

## Lane A — Engine social mechanics (`src/engine`, `src/domain`)

### SOC-NEW-1 · `[POLISH]` · CONFIRMED · A warm goodbye partially CANCELS the jury betrayal penalty — manner signals are summed, not prioritized
- **Evidence:** `liveSeason.ts:1103` `recordEvictionManner(...)` sets `{betrayed:true}` via `mannerToward` (`:770-775`, when evictee trust>0.5); then the goodbye stage `liveSeason.ts:1079-1080` spread-merges `goodbyeMannerFor(tone)` → a warm/respectful tone adds `{respected:true}` (`:1000-1003`) ON TOP. `jury.ts:60-63` sums each flag: `MANNER_LEAN.respected(0.4) + betrayed(-0.6) = -0.2` (`juryConstants.ts:38-43`) instead of -0.6.
- **Mechanism:** `goodbyeTone` reads the **affinity** edge (`:992-996`); `mannerToward` keys on **trust/threat** (`:770-775`). Every finalist sends every juror a goodbye (`selectGoodbyeSenders` = all remaining, `:1011-1013`), so a high-affinity, high-trust ally who got cut reads `{betrayed, respected}` and the betrayal lean is more than halved. Same additive bug for `blindsided(-0.5)+respected(0.4)=-0.1`. The "a goodbye is the last word" comment (`:1078`) implies *precedence*; the math does *summation*.
- **Why it matters:** inverts the player's jury-management incentive at the emotional peak — a costless warm-tone goodbye launders ~40% of a betrayal's finale cost. Mandate: jury management is a real mechanic; anti-sycophancy.
- **Confidence:** high (literal additive sum of co-set flags). **Falsifier:** unit test — evictee trusts R (0.7), R votes them out + sends warm goodbye → assert juror lean toward R = `betrayed` (-0.6), not -0.2. Currently returns -0.2.

### SOC-NEW-2 · `[LATENT]` · CONFIRMED · Bloc defection triggers on UNREQUITED outside attraction (one-way outside bond vs mutual inside bond)
- **Evidence:** `blocs.ts:124` `weakestInside = min(mutualBond(rel,m,x))` (both directions, `:69-70`); `:126` `bestOutside = max(bondOf(rel,m,x))` (one-directional m→outsider, `:63-66`); peel-off when `bestOutside > weakestInside + BLOC.defectionMargin(0.1)`.
- **Mechanism:** a member defects when their *one-way* affection for an outsider beats their *weakest mutual* inside tie — so they leave a tight bloc chasing an unrequited crush; the inside bar is stricter (mutual) than the outside temptation, biasing toward defection. Feeds `blocTerm` in live `voteChoice` (`liveSeason.ts:739`), noms (`season.ts:109`), replacement ranking (`:1376`) — a spurious defection silently re-targets the bloc.
- **Differential:** distinct from SOC-1 (blocs never *surfaced*); this is the detection math. No comment defends the asymmetry ⇒ reads as oversight. **Falsifier:** tight 3-mutual bloc + one low-loyalty member with high one-way bond to a cold outsider → currently peels off; with `mutualBond` outside it would not.

### SOC-NEW-3 · `[LATENT]` · CONFIRMED · Player structurally excluded from the gossip graph until their OWN outbound affinity > 0.35 — dramatic irony runs backwards
- **Evidence:** `orchestrator.ts:563-569` builds diffusion edges only if `relationships.edge(everyone[i],everyone[j]).affinity > GOSSIP.affinityEdge(0.35)` (`gossip.ts:49`); player is `everyone[0]` (`:561`), so only the *player→NPC* direction is ever tested for player edges. Baseline affinity 0.25 (`relationshipConstants.ts:108`); one bonding fold +0.15.
- **Mechanism:** until the player builds ≥0.35 outbound affinity, they have **zero** edges in the rumor graph and can never terminate a diffusion chain — regardless of how warmly NPCs feel about them or how much NPCs gossip about them. In the critical early weeks the rumor mill moves NPC votes (`GOSSIP_HEARD` folds) while the player is deaf by construction; the strategically-detached player is the most blind — the asymmetry backwards.
- **Differential:** upstream of SOC-4 (which is the content-free `socialRead`); here the *belief never lands*. **Falsifier:** seed heavy NPC gossip + player makes no high-affinity bonds → assert no `fact:` belief ever enters player `knownTo`. Bidirectional edge test (`max(edge(a,b),edge(b,a))`) fixes it.

### SOC-NEW-4 · `[LATENT]` · CONFIRMED · An unanswered finale appeal is scored as the OPTIMAL appeal (player-favoring)
- **Evidence:** `liveSeason.ts:1148` `appealMade = f.appeals[finalist]?.[juror] ?? bestAppeal(...)` (argmax-optimal, `jury.ts:124-132`).
- **Mechanism:** if a player-finalist's `finale-answer` pending is never resolved for a juror, the tally scores that pair as the best possible appeal, not neutral/null — not answering == answering perfectly. Comment calls it a "NEVER-HIT safety guard," but FE escape hatches (decision auto-resolve, ADR-0011 forced advance, resume/skip) could plausibly advance past an unanswered pending. **Falsifier:** drive finale to vote with a player-finalist missing a juror appeal entry → juror `perfFor(player)` returns `bestAppeal`, not 0.5/0.

### SOC-NEW-5 · `[NIT/LATENT]` · CONFIRMED · `mannerToward` `respected` bucket is over-broad — inflates positive jury lean for unremarkable cuts
- **Evidence:** `liveSeason.ts:770-775` — `betrayed` if trust>0.5; else `blindsided` if threat<0.4; **else `respected`**. No branch for low-trust+high-threat (the classic respected-rival); an ignored floater (low trust, low threat) also falls into `respected` (+0.4 lean).
- **Mechanism:** cutting people nobody feared nets positive jury equity, and (compounding SOC-NEW-1) a warm goodbye keeps it `respected`. **Falsifier:** evictee trust 0.3/threat 0.5 toward R → currently `respected`(+0.4); faithful read = neutral.

---

## Lane B — Distributed consistency (FE transport / SSE / cross-device)

### SYNC-FOCUS-1 · `[POLISH·high]` · CONFIRMED · A backgrounded tab misses every cross-device `game-updated` push (non-durable) AND never reconciles on re-focus → HUD stale 20–120s
- **Evidence:** `orwellStatusPanel.js:418` `if(!document.hidden) await refresh()` (poll skipped while hidden); `:19` POLL_MS=20000; `:383` backoff 120000 — same hidden-gate, no `visibilitychange` reconcile in `orwellFinale.js:268`, `orwellDeals.js:191`, `orwellCast.js:490`, `orwellSeasonProgress.js:287`, `orwellPresence.js:204`, `orwellNightStatus.js:125`, `orwellNewSeason.js:275`, `orwellCastPin.js:166`. `session_events.py:45` `_RING_REPLAY_EVENTS=("run-started","message-added")` — **`game-updated` excluded from the durable ring.** `sessionSync.js:32-34,58,105` reconcile only on a *live* SSE delivery; `connected` re-hello only resets retry. `chat.js:4300-4302` the sole `visibilitychange` handler bails unless `isStreaming`. No `Last-Event-ID` honored (grep 0).
- **Mechanism:** a 2nd device's mutation → `_publish_game_updated` (`orwell_routes.py:113-125`) → `publish(sid,"game-updated")` skips the ring (not in replay set) → live fan-out only. A backgrounded tab (mobile suspend / screen lock drops EventSource) receives nothing; on reconnect the replay carries only run-started/message-added. On re-focus nothing fires a reconcile for an idle (non-streaming) tab → HUD waits its own ≤20s (≤120s post-backoff) tick. Intended: cross-device convergence ~3s via 0064 push with polling as the floor. Violated: push is at-most-once-while-connected (no durability), and the poll floor is *suspended* while hidden and *not re-armed on focus*.
- **Differential:** not S3-RACE (chat-log render); not SYNC-STALE (that = write-backs fire no SSE at all; here SSE fires but is non-durable + no catch-up); the decision card self-recovers (`orwellDecision.js:573` polls every 15s with NO hidden-gate) — the defect is the read-only HUD panels. Mobile is a first-class CI-gated surface.
- **Confidence:** high mechanism, med severity. **Falsifier:** two SSE clients on one session; drop B; `publish(game-updated)`; reconnect B → replay lacks the event (ring excludes it). Fix: add `game-updated` to the ring; one app-level `visibilitychange→orwellGameChanged('refocus')` (G15-safe).

### SYNC-RING-1 · `[LATENT]` · CONFIRMED · The §3.4b durable reconnect ring is destroyed on a single-viewer disconnect — defeats its own purpose for the common single-device case
- **Evidence:** `session_events.py:100-108` — last subscriber leaving runs `_SUBS.pop(...)` AND `_RING.pop(session_id, None)`. Native EventSource reconnect re-subscribes to an empty ring (`:92`); no `Last-Event-ID`.
- **Mechanism:** for the dominant one-tab topology, any transient SSE drop empties `_SUBS[sid]` → `_RING.pop`. An event published in the disconnect→reconnect gap is dropped from fan-out (no subscribers) AND from the now-gone ring → reconnect replay is empty. The ring (built `:29-37` so a late window can catch up) becomes at-most-once exactly when there's one viewer who just blipped. Contrast `agent_runs._EVICT_GRACE_S` (`agent_runs.py:42`) which keeps a run buffer 180s after the last subscriber — the session-events ring has no grace.
- **Differential:** not the ≥2-subscriber cross-device case the ring was built for; the single-viewer self-reconnect path. **Falsifier:** subscribe one client; let `subscribe()` exit; `publish(run-started)`; resubscribe → replay lacks it. Fix: keep the ring on disconnect with a short grace timer (mirror `_schedule_evict`).

### CUT (steelmanned, ruled out)
JSON-RPC batch concurrent dispatch (`jsonRpc.ts:163` `Promise.all`) — ruled out: the engine mutation path is fully synchronous (no `await` through `advanceGame`/`submitDecision`/`persist`/`commit`/`bumpBeatSeq`), so JS run-to-completion serializes batch entries in array order over the shared adapter. Becomes a defect only if an async narrator is ever wired into the commit path — worth a guard comment, not a finding today.

---

---

## Lane C — Narration fidelity (static structural; live model unreachable here)

### NARR-7 · `[BLOCK-candidate]` · CONFIRMED · Jurors are structurally voice-anchorless at the finale — every persona facet vanishes the moment a houseguest is evicted
- **Evidence:** three projection paths strip a non-active HG to a bare name: roster weave `momentPrompts.ts:725` (`if status!=="active"... return \`- ${name} (${status})\``); `GameSessionAdapter.npcVoice:809` (`if seatOf(id)!=="active" return null // only the living are voiced`); `finaleView:3871-3879` returns juror/finalist as `{id,name}` only. Yet `jury-finale` (`momentPrompts.ts:571-583`) requires staging "each juror questioning both finalists" — up to 9 distinct voices.
- **Mechanism:** the season-long voice anchor (`npcVoice.persona` + roster `vibe`) is gated on `seat==="active"`. At the finale every juror is non-active by definition ⇒ the only structural grounding returns `null`/name; the model must reconstruct 9 personas from chat memory — the "store recalled, never chat remembered" failure (ADR 0003, mandate #4). A **re-entry/fresh-session finale** has an empty chat ⇒ jurors have *nothing*, flattening both tiers.
- **Differential:** not SOC-1 (bloc structure); not B61 (holds while active); not Vault (public facets). **Falsifier:** a `-pro` finale where each juror keeps seeded demeanor with no chat history present. **Related:** `evicted`/`self-evicted`/player-juror recaps also lose all evictee persona.

### NARR-8 · `[POLISH·high]` · CONFIRMED · Pre-emission outcome guard covers eviction/winner/HOH/tally but NOT nominations or veto-winner — the two most frequent ceremony claims are unguarded
- **Evidence:** `_beat_signature` captures `noms` (`chat_helpers.py:753-756`), `vetoHolder` (`:777`), `vetoUsed` (`:778`); but `_narration_claims_outcome` has only four branches — evicted/winner/tally/new-HOH (`:839-864`) — and `_sentence_has_closed_set_claim` unions only those four (`:946-951`). No branch compares narrated noms vs `before.noms!=after.noms`, none for veto winner vs `vetoHolder`. The signature carries data the guard never reads.
- **Mechanism:** both the same-turn `screen_streamed_outcome` (`:954`) and next-turn `record_post_turn_desync_check` (`:891`) route through `_narration_claims_outcome`; with no nom/veto branch, "X and Y are nominated" / "Griffin pulls out the veto" streams before the engine commits — the LIVE-7 phantom class, but for the two ceremonies the prompt itself flags closed-set (`momentPrompts.ts:518-535`).
- **Differential:** structural twin of LIVE-7 (eviction, guarded) / LIVE-4 (skip); the nom/veto phantom shares the mechanism but sits in the blind spot. **Related:** `vetoUsed` ("she does NOT use the veto") same gap.

### NARR-9 · `[POLISH]` · CONFIRMED · OOC `((…))` producer asides render as LITERAL double-parens in the LIVE stream — only reclassified on reload
- **Evidence:** base prompt wraps OOC/HUD answers in `((double parens))` (`momentPrompts.ts:149-154`). `detectOocAside` (strips markers, styles `.msg-ooc-producer`) is imported/called ONLY in `chatRenderer.js` (reload path, `:14,2187`). Live `chat.js` renders body via `processWithThinking(squashOutsideCode(roundReplyText))` (`:1337/1350/2225`) with NO OOC detection (grep `detectOoc|msg-ooc` in chat.js ⇒ empty); neither `processWithThinking` nor `mdToHtml` strips `((…))`. Python stream passes `((` verbatim.
- **Mechanism:** the A-render duplicate-engine smell drifted on the OOC seam — reclassification lives in one render engine only. During the live turn the player reads literal `((It's day 12; Maya is HOH…))` inside a "Big Brother" GM bubble; reload silently fixes it. Flickers exactly on meta/logistics/admin/self-evict answers routed through this channel.
- **Differential:** not FEPY-1 (stream error) nor NARR-2 (reasoning split) — a correctly-formed OOC answer with markers exposed. **VIEWABLE** in the deterministic browser (render-layer). **Related:** partial-wrap (`_DOUBLE_PARENS` needs whole-message wrap, `orwellOocAside.js:40`) ⇒ half-literal-paren bubble even on reload.

### NARR-10 · `[LATENT]` · CONFIRMED · Mid-body operator asides & raw `npc:<id>` survive the scrub — `scrubReasoningPreamble` only drops a CONTIGUOUS LEADING run
- **Evidence:** `markdown.js:174-182` walks from the top, `break`s at the first line that isn't blank/`_REASONING_LINE_RE`/`_RAW_NPC_ID_RE`; `processWithThinking` applies it once to the leading reply (`:534`). An aside or `npc:3` appearing AFTER narration starts is never reached; `mdToHtml` does no `npc:\d+` redaction. Only the model not emitting one prevents a mid-body leak.
- **Mechanism:** L6b is a *preamble* stripper by design; no whole-body pass. Engine `humanize`s ids in projections (rare emission), but the model can echo an id from a tool result mid-sentence → survives verbatim. **Differential:** distinct from NARR-1 (gateway) / FEPY-2 (reasoning channel); this is the content channel, mid-body. LIVE-9's leading "Let me check…" is the catchable cousin.

### NARR-11 · `[LATENT]` · CONFIRMED · `social`/`diary-room` (player-present) moments inject the OFF-SCREEN zeitgeist framing into a player-facing prompt
- **Evidence:** `GameSessionAdapter.ts:4025` sets `channel="offscreen"` whenever `moment==="social"||"diary-room"`; the offscreen branch `zeitgeist.ts:314-318` appends "This colors OFF-SCREEN life too… someone makes a dated joke mid-scheme." But social/diary-room are player-present beats, not NPC-to-NPC sim.
- **Mechanism:** the player's witnessed/OOC beat is tagged with the hidden-society framing ⇒ nudges the narrator to write "mid-scheme" off-screen texture into a scene the player is in, blurring the witnessed/off-screen line. **Differential:** not a Vault leak (public flavor); a framing-precision issue. **Falsifier:** channel should be `"player"` for these moments.

**Lane-C CLEAN (re-confirmed):** engine prompt assembly is Vault-free by construction (no stats/souls/hidden/orientation enter a prompt); casting intake neutralized before echo (C8); ceremony status + whereabouts hard-grounded; transport error handling degrades cleanly (A-S5 fields carried); finalist names exact-to-engine in `renderStoryFacts`.

---

## Lane F — Engine truth & build gates (RUN here — all GREEN)
- **`npm run test:unit:fast` → PASS (exit 0)** (typecheck + build + unit/property + dependency-cruiser Vault-wall).
- **`cd frontend && pytest tests/` → PASS (exit 0)** (the full FE gate incl. g15/reasoning-scrub/render-contract convention checks).
- **`npm run test:heavy` → PASS (exit 0)** (full-game UAT 12+5 seed + decisions, jury-reach `EARNED_WINS` calibration, gradient band). The static social/sync/narration findings above are **un-gated behaviors**, not test failures — the gates assert completion/leak-freedom/calibration bands, not the manner-merge / gossip-edge / finale-persona gaps. No regression on this branch HEAD.

## Lane G — Deploy / ops / security & boundary (static)

### SEC-1 · `[BLOCK]` (guard-completeness; LATENT-in-practice via Lax cookies) · CONFIRMED · Public-profile boot guard validates `ALLOWED_HOSTS` but NOT `ALLOWED_ORIGINS`, while CORS runs `allow_credentials=True` → a wildcard origin reflects credentials
- **Evidence:** `frontend/app.py:102-106` `CORSMiddleware(allow_origins=ALLOWED_ORIGINS.split(","), allow_credentials=True)` — credentials unconditional. `core/middleware.py:199-216` `assert_public_profile_safe` unsafe-set = `{AUTH_ENABLED, LOCALHOST_BYPASS, SECURE_COOKIES, ALLOWED_HOSTS}` — **`ALLOWED_ORIGINS` never inspected**. `admin_public_deployment_routes.py:173-204` takes free-form `allowedOrigins`, validates via the guard (which ignores it), persists verbatim; `orwell-ops-public-deployment.sh:184-192` writes it to `data/.env`. Starlette 1.2.1 with `"*"` + credentials reflects the request `Origin` + `Access-Control-Allow-Credentials: true`. No test covers it (grep `allow_credentials`/`Access-Control` in tests ⇒ 0).
- **Mechanism:** an operator/wizard entering `*` (or a stray `*`/non-https value) boots a public authenticated instance whose CORS reflects ANY origin with credentials → a malicious page issues credentialed cross-origin fetch and reads responses. The 0067 guard's whole job is fail-closed on an unsafe public posture; it passes the single most dangerous CORS combo.
- **Differential:** distinct from EXPOSE-1 (engine bind-host; this is the FE CORS var + middleware). Softened by `SameSite=Lax` cookies (suppresses the cookie cross-site) BUT the app also accepts `Authorization: Bearer ody_` and CORS allow-lists `Authorization` (`app.py:110`), so non-cookie flows stay reflectable. **Falsifier:** `assert_public_profile_safe({ORWELL_PUBLIC:1,...safe...,ALLOWED_ORIGINS:"*"})` does NOT raise today. **Fix:** add `ALLOWED_ORIGINS` to the unsafe-set (reject `*`/empty/non-https); sanitize the wizard input.

### SEC-2 · `[BLOCK]` (mandate: cross-user isolation) · CONFIRMED · Gateway webhook is fully spoofable — `platform_identity` from the request BODY is treated as the credential, no platform signature/secret-token check
- **Evidence:** `gateway_routes.py:42-90` `/gateway/webhook/{platform_id}` is auth-exempt (`app.py:219`); derives `(platform_identity,text)` from the body (`:66`) and routes to `handle_platform_turn`. `telegram.py:81-101` `chat_id = str(msg["chat"]["id"])` straight from the body — **no `X-Telegram-Bot-Api-Secret-Token` check** (grep `secret|signature|verify` in gateway/ ⇒ docstrings only). `handler.py:64-76` `get_paired_user(platform_identity)` → mutates that user's engine sandbox + `adapter.send`s to the real victim's chat.
- **Mechanism:** the "credential" is a guessable numeric `chat_id` the attacker supplies in their own POST. Anyone reaching the public webhook can inject turns into a victim's game (engine mutation, consequence folds, advances) AND make the bot message the real victim — a cross-user write + impersonation vector on a public endpoint. **Mandate veto applies** (no call for user A may mutate user B's game).
- **Differential:** the FE→engine seam derives the user server-side (clean); `/pair/verify` is authed+rate-limited (clean). The break is the webhook *turn* trusting client identity with no transport auth. Currently blunted by NARR-1 (dead gateway narrator ⇒ no LLM narration) but the engine-mutating calls still fire and the full path opens the moment NARR-1 is fixed. **Falsifier:** POST a hand-crafted `{"message":{"chat":{"id":<victim>},"text":...}}` with no secret header → turn applied to the victim's sandbox + `sendMessage` to the victim. **Fix:** require + verify the platform secret-token/signature before `parse_inbound`.

### SEC-3 · `[POLISH]` · CONFIRMED · Gateway turn path bypasses the daily message cap AND has no rate limiter — an unauthenticated cost/DoS surface
- **Evidence:** `gateway_routes.py:84-90` webhook turn has no rate-limit guard (the only gateway limiter is on `/pair/verify`, `:122`); `handler.py:76,82-146` `_call_player_turn` never calls `enforce_daily_cap` (web-only, `chat_helpers.py:1818,1859`). **Mechanism:** combined with SEC-2, unlimited turns into any paired user's game with no per-turn rate limit or daily-cap accounting — burns token budget (once NARR-1 fixed) and hammers the engine. **Fix:** per-identity rate limit + route gateway turns through the daily cap.

### SEC-4 · `[NIT/LATENT]` · CONFIRMED · `Permissions-Policy` grants `microphone=(self)` app-wide with no mic feature in the game build
- **Evidence:** `core/middleware.py:106` `Permissions-Policy: camera=(), microphone=(self), geolocation=()`; no `getUserMedia` in the game keep-set. **Mechanism:** a same-origin XSS / compromised inherited module could `getUserMedia({audio})` where `microphone=()` would deny it; narrow (CSP keeps `'unsafe-inline'` styles only). **Fix:** `microphone=()` gated on `ORWELL_GAME_BUILD`.

## Lane H — Transient / animation lifecycle (static; VIEWED confirmation deferred to a model-wired session)

### TX-1 · `[LATENT]` · CONFIRMED · OrwellWindow `close()` 190ms fade race — a re-`open()` during the fade short-circuits on `isConnected`, leaving `.ow-anim-close` latched AND the pending `finish` tears down the re-opened window
- **Evidence:** `orwellWindow.js:854-864` non-reduced `close()` adds `.ow-anim-close` + `setTimeout(finish,190)`; `this.el` nulled only when `finish→_teardown` runs (`:866-874`); keyframe `ow-close .18s forwards` (`:161`). A re-`open()` in that 190ms hits `if(this.el&&this.el.isConnected){this.restore();return}` (`:667-668`) — `restore()` is a no-op for a non-docked window ⇒ (a) `.ow-anim-close` stays (stuck invisible at the forwards end-state) AND (b) the original timer still fires `_teardown()`, removing the just-reopened window.
- **Mechanism/Differential:** reduced-motion is safe (synchronous `finish` branch, `:860`). Currently unreached — poll panels re-show via `style.display`, `toggleDock` uses synchronous `_teardown` (no animation) — hence LATENT, a pre-armed trap for any future close→reopen on a fast signal (gamechanged/SSE). **Fix dir:** store + clear the close timer in `open()`; strip `.ow-anim-close` before re-show, or null `this.el` synchronously at close-start.

### TX-2 · `[LATENT]` · CONFIRMED · A background-completed stream can leave `isStreaming` true; the never-cleared `_textPauseTimer` then mounts an orphan "Thinking" spinner into the now-FOREGROUND session
- **Evidence:** `chat.js:1285-1292` `_textPauseTimer=setTimeout(…,400)` mounts the spinner guarded by `isStreaming`; the stream-end `finally` (`:3307+`) never calls `_cancelThinkingTimer()` (grep ⇒ 0), relying on the guard. But `updateSubmitButton('idle')` (flips `isStreaming` false) is gated behind `if(!_isBgFinally)` (`:3388-3390`); on a session-switch-mid-stream `isStreaming` stays true ⇒ a `_textPauseTimer` armed in the last ~400ms fires, finds `isStreaming` true, and appends `.agent-thinking-dots` into the foreground `#chat-history` for a stream that ended in the background.
- **Differential:** distinct from TRANS-1 (`_elapsedTicker`); this is the text-pause timer. Window = backgrounded-stream completion before the next foreground stream resets `isStreaming`. **Fix dir:** unconditional `_cancelThinkingTimer()`+`_removeThinkingSpinner()` in the finally, or reset the stream's own-session `isStreaming` at finally-top regardless of background.

### TX-3 · `[NIT]` · CONFIRMED · New-season `nudge()` WAAPI box-shadow pulse ignores reduced-motion — the code comment claims "reduced-motion safe" but `Element.animate()` runs regardless
- **Evidence:** `orwellNewSeason.js:256-260` `_win.el.animate([...],{duration:1400})`; comment `:252` falsely asserts no-op under reduce; no `matchMedia` guard (grep). One-shot (so 2.3.3 honor-reduce gap + a false comment, not a 2.2.2 >5s loop). **Fix dir:** gate behind `matchMedia('(prefers-reduced-motion: reduce)').matches`.

### TX-4 · `[NIT]` · CONFIRMED · Toast success-checkmark animates under reduced-motion (descendant selector not in the reduce block)
- **Evidence:** `.toast .toast-checkmark` `animation: toastCheckPop 360ms forwards` + `polyline toastCheckDraw` (`style.css:4263-4279`); reduce block (`:22182-22191`) sets `.toast{animation:none}` but `animation` doesn't inherit, and there's no `*{animation:none}`. Steelman: the `opacity:0→1 forwards` still completes ⇒ NOT stuck-hidden (dangerous mode absent) — it merely pops when it should be static. **Fix dir:** add the descendant selectors to the reduce block with the opacity end-state forced.

### TX-5 · `[NIT]` · CONFIRMED · Gadget-rail `grail-focus-flash` doesn't re-fire on rapid repeat focus; the first timer cuts the second flash short
- **Evidence:** `orwellGadgetRail.js:114-128` add class + `setTimeout(remove,900)`; CSS `grail-focus-flash .9s` (`:430`). Re-adding a present class doesn't restart a CSS animation; the first click's timer removes the class mid-second-flash. No per-element timer handle / reflow restart. **Fix dir:** per-element timer cancel + force-restart (`void offsetWidth` or `getAnimations().cancel()`).

### TX-6 · `[NIT]` · CONFIRMED · Action-toast leaves `pointer-events:auto` on the `×`/action paths (only auto-hide resets it) → intercepts top-right clicks during its ~0.45s exit slide
- **Evidence:** `ui.js:395` sets `pointerEvents='auto'` (for the Undo btn); auto-hide resets at `:419` (with a comment that this was previously missed) but the `×` handler (`:386-392`) and action handler (`:357-362`) don't ⇒ during the `.exiting` slide (`transform .45s`) the toast still eats clicks in the top-right. Bounded (next `showToast` clears it; off-screen end-state is safe). **Fix dir:** reset `pointerEvents=''` in both handlers.

**Lane-H CLEAN (verified):** presence/night (full rebuild, no anim, `finally` reschedules); retrospective `_lastSig` idempotent skip-render; decision-card `_doneTimer` guarded + 15s backstop + reduced-motion gated; finalizing indicator paired begin/end in the `finally`; sessionSync reconcile debounce idempotent + EventSource reconnect capped; spinner `stop()` clears interval+raf; headshot teardown (R5/R6); gadget-rail `syncStrip` signature-guarded. *(TX-1/TX-2 graded LATENT — pre-armed traps not exercised by current consumers; the four NITs are reduced-motion/repeat-event edges.)*

---

**Lane-G CLEAN (steelman):** the MCP HTTP edge is solid — constant-time secret compare, separate admin token strictly enforced, multiuser header rejection, anti-spray `knownUser` + tight `SANDBOX_CREATING_TOOLS` allowlist on `/call` AND `/rpc`, body cap + timeout + per-user serialization, sanitized `/health` (no message/arg leak), precise typed-error→status (409 carries only `{code,beatSeq,board}`). `FileSaveStore.userDir` hex-encodes the user id (path-traversal structurally impossible) + 64-char cap. TLS scripts pass the DNS token by env (not argv) + shred + allow-list names; the engine port is never named in a generated site. Auth cookies `HttpOnly`+`SameSite=Lax`+`Secure`-under-flag; `_is_trusted_loopback` excludes proxy/tunnel-forwarded so `LOCALHOST_BYPASS` can't be inherited over cloudflared. 0071 redaction installed before first log emit.

---

## Lane E — Deterministic browser telemetry (VIEWED; Chromium 141 + fake model, no egress)
Stack: real engine :8765 + real FE :7000 + local `fake_model_server.mjs`; season seed 51000 (15 NPCs, premiere). Artifacts: `.audit-telemetry/shots/{home-desktop,home-mobile,parity-A,parity-B}.png` + `report.json` (gitignored).

### RESP-NEW-1 · `[POLISH·high]` · VIEWED · The "The House" status panel does NOT reflow on mobile — it renders ~290px off-screen-right, its close `×` and drag handle unreachable, no horizontal scroll
- **Evidence (VIEWED):** in-page `getBoundingClientRect` scan at iPhone-13 (vw=390, `document.scrollWidth==vw`, no horiz scroll): the status window's children sit at **right≈678** — `Week 1 / Premiere / ▾`, `HOH —`, `Noms —`, `Veto —` (each width 262 ⇒ left≈416), the drag handle `⠿` at right 637, the close `×` at right **687**. The desktop shot (`home-desktop.png`) shows this exact panel correctly docked on the RIGHT rail ("The House": Week/HOH/Noms/Veto + 16/16 cast + room occupancy); the mobile shot (`home-mobile.png`) shows it is **not in the viewport at all** — only the in-chat welcome strip is visible.
- **Mechanism:** the right-rail status panel keeps ~desktop placement on a 390px viewport instead of reflowing into a mobile representation (drawer / docked row / full-width). Because the body doesn't scroll horizontally, the panel's content and its only close affordance (`×` at x687, ~300px past the right edge) are **clipped and unreachable** — a WCAG 1.4.10 (reflow) + 2.5.5 (target size, and here target *reachability*) failure on a first-class CI-gated surface.
- **Differential:** distinct from the prior RESP-1 (minimized-dock-row `×` size), RESP-2 (cast-panel buttons), RESP-3 (copy-btn hover), RESP-4 (gate blind spot) — this is the **entire status panel mounting off-screen on mobile**, not a sub-control size. Not a legitimate reflow (content is lost/unreachable, not rearranged). Steelman considered: "it's meant to be drawer-hidden on mobile" — but it is rendered visible (not `display:none`) at off-screen coords, taking layout, so it's mis-placed, not intentionally stowed.
- **Confidence:** high (rect scan + paired desktop/mobile shots). **Falsifier:** the panel's bounding-rect right (678) ≤ viewport (390) on mobile, or a horizontal-scroll/drawer path reaches it — neither is present. **Latent siblings VIEWED in the same scan:** `Close guide` (premiere tutorial) 102×36 on mobile (h<44, corroborates prior UX-3/RESP); `export-dl-btn` 36×44 (w<44); composer "Message input" 24px tall at empty state (grows on input — likely benign).

### PARITY-AT-REST · PASS (VIEWED)
Two same-identity desktop windows on one season: engine truth identical (`phase=premiere, week=1, beatSeq=1, hoh=null`) and HUD identical across both windows — no render garbage / state bleed at rest. (A concurrent-write LOOP + the SYNC-FOCUS-1 backgrounded-tab repro need an engine-mutation driver the fake model can't emit; deferred to the live lane.) **0 console/page errors** on desktop and mobile load.

---

## Lane D — UX content & accessibility (static)
*Lead severity note: the specialist rated A11Y-1/2/3 `[BLOCK]`; for a single-player launch I recalibrate the SR-experience items to `[POLISH·high]` (real WCAG failures, not progression-blockers) — keeping the agent's evidence verbatim. All cross-checked NEW vs both prior ledgers.*

### A11Y-1 · `[POLISH·high]` (agent `[BLOCK]`) · CONFIRMED · Presence & night gadgets re-announce the FULL string to screen readers every 25s poll
- **Evidence:** `orwellPresence.js:148-149` sets `role="status"`+`aria-live="polite"` on the section ROOT; `render()` (`:183-198`) writes `textContent`/`innerHTML` into children every 25s poll unconditionally. Identical in `orwellNightStatus.js:71-72,103-119`. The correct counter-pattern is documented + implemented one file over (`orwellStatusPanel.js:99-101` `#os-announce` delta-only child).
- **Mechanism:** any mutation inside a live-region root fires a polite announcement; writing children every poll re-announces "Kitchen — Keith, John, Joe" 2–3×/min even on no-change. During lingering play (the core ADR-0003 mode) an SR user is interrupted constantly and may disable the SR, missing game-relevant announcements. **Falsifier:** `render()` diffs and skips no-op writes (it doesn't). Fix: adopt the `#os-announce` delta pattern; drop `aria-live` from the root.

### A11Y-2 · `[POLISH·high]` (agent `[BLOCK]`) · CONFIRMED · New-season transition errors are NEVER announced to SR
- **Evidence:** `orwellNewSeason.js:97` `.ons-msg` is a plain `<div>` (no role/aria-live); `setMsg(err,true)` (`:127,149-150`) sets `textContent` → zero SR announcement. Buttons re-enable on failure with no audible signal.
- **Mechanism:** season transition is irreversible (keep vs recast the character); a silent failure leaves the SR user unaware → repeated POSTs to a broken endpoint. **Fix:** `role="status"` + escalate to `aria-live="assertive"` on error.

### A11Y-3 · `[POLISH·high]` (agent `[BLOCK]`) · CONFIRMED · Finale `#ofin-stage` carries its OWN `aria-live` next to the correct hidden announcer → re-announces stage every 5s
- **Evidence:** `orwellFinale.js:109` visible `#ofin-stage` has `aria-live="polite"`; a correct hidden `#ofin-announce` already exists (`:114`). Both announce; the visible div fires on every 5s `render()`.
- **Mechanism:** during extended jury questioning the SR is interrupted every 5s with the unchanged stage name, drowning out the actual chat-streamed questions/answers/vote reveals at the game's climax. **Fix:** remove `aria-live` from `#ofin-stage`; route deltas through `#ofin-announce`.

### A11Y-4 · `[POLISH]` · CONFIRMED · Diary-Room error uses polite `role="status"` for an actionable failure → may never surface
- **Evidence:** `orwellDiaryRoom.js:72` pill `role="status"`; error written to it (`:147`) is polite ⇒ deferred behind the always-active chat stream. A failed confessional (no in-game pathway, a real game-state write) silently doesn't record. **Fix:** assertive on error only.

### A11Y-5 · `[POLISH]` · CONFIRMED · Status-panel collapse toggle: static `title="Collapse"` never updates; accessible name lacks state + section context
- **Evidence:** `orwellStatusPanel.js:150` `role="button" title="Collapse"` set once in innerHTML; `aria-expanded` toggles but `title`/name never do ⇒ SR hears "Collapse" even when collapsed (inverted affordance, WCAG 4.1.2). **Fix:** sync `aria-label` to "Expand/Collapse game status" on toggle.

### A11Y-6 · `[POLISH·high]` · CONFIRMED · Kit-window controls (minimize/close) 24×24px — below the project's own 44px coarse floor, systemic across EVERY floating panel
- **Evidence:** `orwellWindow.js:132-133` `.ow-controls button,.ow-dismiss {min-width:24px;min-height:24px;padding:0}`, `gap:2px` (`:128`). Affects Finale/Cast/Retrospective/all dockable windows. The project floor is known (`orwellFinale.js:91-93` comment lifts `.ofin-btn` ~27→36). **Differential:** distinct from prior RESP-1 (dock-row × 16px) — this is the titlebar controls. **Fix:** 44px with negative-margin footprint preservation.

### A11Y-7 · `[POLISH·high]` · CONFIRMED · Decision option chips `.odec-opt` 36px on the one BINDING-decision surface
- **Evidence:** `orwellDecision.js:120` `min-height:36px`; nomination/veto chips, `gap:.4rem` (8px). **Differential:** distinct from prior UX-10 (the Confirm *button*); these are the *selection* chips. A fat-finger between chips on mobile selects the wrong houseguest (recoverable via `aria-pressed` but reads as a glitch). **Fix:** 44px.

### A11Y-8/9/10/11 · `[POLISH/NIT]` · CONFIRMED
- **A11Y-8** new-season/finale buttons 36px (`orwellNewSeason.js:88`, `orwellFinale.js:93`) — below floor on consequential actions.
- **A11Y-9** section headers "The House" (`orwellStatusPanel.js:162`) + "🤝 Your deals" (`orwellDeals.js:106`) are plain `<div>` ⇒ invisible to heading navigation (WCAG 1.3.1); landmarks work, heading outline doesn't.
- **A11Y-10** finale prefill buttons put emoji/`→` in `textContent` with no `aria-label` ⇒ "ballot box with ballot Vote for…"/"rightwards arrow [appeal]" (distinct from prior UX-8 = window title).
- **A11Y-11** engine-status banner dismiss `aria-label="Dismiss"` context-free across all banner variants.

### CONT-1/2/3 · `[NIT]` · CONFIRMED · Voice breaks
- **CONT-1** `orwellOnboarding.js:185` "Continue anyway" — OOC system-speak on the first in-fiction holding card a fresh player sees. **CONT-2** `orwellNewSeason.js:149` "Couldn't start the next season" uses meta "season" vocabulary (contrast the in-fiction "The Vault would not open"). **CONT-3** `orwellRetrospective.js:196` hardcodes `color:#fff` instead of `var(--on-accent,#fff)` ⇒ latent contrast fail on custom light `--accent`.

**Lane-D CLEAN (steelman, re-confirmed):** the `#os-announce`/`announceDeltas` delta pattern (`orwellStatusPanel.js:232-250`) is the correct reference impl; decision chips use `aria-pressed` correctly; DR success copy + engine-status banner ("Production is building the house…", "Reconnecting to Big Brother…") are model in-fiction technical-state copy; phase-enum→show-language translation never leaks engine vocab (`:209-215`); emoji `aria-hidden` on night status (`:104`); Escape handling across holding card / DR / window kit. **Note for future copy sweeps:** "feeds are down"/"camera glitched"/"the Vault would not open" are load-bearing *intentional* fiction — do not "standardize" them as customer-service text.

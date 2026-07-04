# ORWELL — ACCESSIBILITY SWEEP + ERROR/EMPTY/LOADING CATALOG — EXHAUSTIVE PRE-SHIP AUDIT (v2)

Agent tag: **AXE**. Territory: (1) a full a11y sweep (keyboard, focus, ARIA, headings, alt text,
forms, WCAG 2.1 AA contrast, target size, reflow, the glass a11y trio) across the whole app, going
broader/deeper than the prior `ux-content-a11y.md` (CA) pass; (2) a systematic catalog of every
error/empty/loading/transitional state, rated for persona/actionability/recoverability/leakage.

**Dedupe discipline.** Per the charter, NOT re-reported: CSS-only send-fail status tag (CA-2),
`/setup` non-interactive span (CA-10), the measured/visual risk-badge contrast call (CA-11), the
reasoning-accordion scrub (A4 in `RANKED_MASTER_V2.md`), or any of v1's ~41 or CA-1..29's findings.
Where a new finding sits near an existing one, the differential is stated explicitly.

**Method.** Grep-then-narrow over `frontend/static/{index.html,style.css,js/*.js}` and
`frontend/{app.py,routes/*.py,src/*.py}`, cross-checked against telemetry stills/filmstrips at
`scratchpad/audit2/telemetry/` (`INDEX.md` is the map). Several findings below are **computed**
(literal WCAG contrast-ratio math from the actual CSS hex values, shown in-line) or **live-observed**
(reproduced in a captured screenshot), not just source-inferred, and are flagged as such.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| AXE-1 | Blocker | <1day | High | Two custom selection grids (model picker, theme swatches) are fully keyboard-inoperable | `models.js:98-162`, `theme.js:1330-1441` |
| AXE-2 | Blocker | <1hr | High | FastAPI's default `{"detail":...}` error shape isn't recognized by the FE's regex parser — raw JSON leaks to the player for 429/403/401 | `chat_helpers.py:2811,2835`, `chat.js:1301-1316` |
| AXE-3 | Major | <1hr | High | Raw Python exception class+message surfaces in the player-visible engine-status banner | `orwell_engine.py:271,873`, `orwellEngineStatus.js:104` |
| AXE-4 | Major | <1day | High | Raw `error.message`/`err.message` leaks into player-facing toasts — confirmed live (session list) + reachable in-game (Re-narrate) | `sessions.js:1548,1831`, `chat.js:5262` (+11 latent sibling sites) |
| AXE-5 | Major | <1day | High | A reload during a mid-stream turn can silently revert the whole session to the pristine empty/premiere state — zero error, zero recovery | live-observed, `telemetry/stills/post-reload-mid-stream-recovery__desktop__light.png` |
| AXE-6 | Major | <1hr | Med | The browser going offline reuses the IDENTICAL "engine unavailable" banner/copy as a real server outage — misdiagnoses whose fault it is | `orwellEngineStatus.js`, live-observed `offline-send-attempt__desktop__light.png` |
| AXE-7 | Major | <1hr | Med | `--color-muted:#888` fails WCAG AA text contrast in BOTH themes (measured) across ~16+ timestamp/meta selectors | `style.css:139`, 16 use-sites |
| AXE-8 | Minor | <1day | Med | The legacy `.modal` family (Brain/memory, Cookbook, custom-preset) has no Tab focus trap, unlike `orwellWindow.js`/`settings-modal` | `ui.js:1219-1260`, `index.html:423,1501` |
| AXE-9 | Minor | <1hr | Low | Heading hierarchy inversion: the Theme window's `h4` dialog title contains `h2` subsections (a numerically higher-level heading nested inside a lower one) | `index.html:633,649` |
| AXE-10 | Minor | <1hr | Low | The composer's `aria-label` is frozen at the generic "Message input" while its visible placeholder is dynamically swapped to in-fiction copy | `index.html:1241`, `app.js:2297-2301` |
| AXE-11 | Minor | <1hr | Low | Model-picker's empty-search-result text is set to inline `opacity:0.4` — measured contrast failure, corroborates AXE-7 with a second concrete instance | `models.js:559` |

## STEELMAN — what's genuinely well-built (so it isn't miscredited as new ground / accidentally "fixed")

Confirmed while sweeping, to avoid false positives:
- **The gadget rail's drag-reorder AND resize-handle both ship real keyboard equivalents**
  (`orwellGadgetRail.js:572-577` ArrowUp/ArrowDown nudge in edit mode; `:771-782` ArrowLeft/Right
  resize) — this makes AXE-1's total absence of any keyboard path on the model-picker/theme-swatch
  grids a genuine gap, not "the team never does this," which raises confidence it's a real miss
  rather than a deliberate simplification.
- **Streaming narration correctly uses `aria-busy` to gate the live region**
  (`chat.js:1356,3595` toggle `aria-busy` true→false around a stream) — the WCAG-correct pattern to
  stop a `aria-live="polite"` log from spamming a screen reader on every token and instead announce
  once, on completion.
- **Decision cards move focus to themselves on mount** (`orwellDecision.js:766` `card.focus()`) —
  the correct technique for a screen-reader/keyboard user to discover a new "hard stop" without
  requiring a live-region announcement.
- **Toast severity drives ARIA role correctly** (`orwellNotice.js:513-525,780-783`, "#951"): an
  error/warn toast gets `role="alert"`/assertive, a plain/success toast gets `role="status"`/polite
  — exactly right, and dynamically re-evaluated per update, not fixed at creation.
- **`prefers-reduced-motion` coverage is extremely broad** — 150+ matches across `style.css` and
  ~20 JS modules, each with an explicit, commented rationale (eye-blink favicon, mesh-gradient
  backgrounds, window fly-in/out, gadget-rail chevron, headshot skeleton shimmer, etc.). The
  captured `reduced-motion-theme-switch` filmstrip (16 frames) shows a flat, non-animating sequence
  consistent with this working as intended, though the capture doesn't conclusively prove a theme
  switch was actually triggered mid-sequence (noted under Coverage below, not claimed as a finding).

## PART 1 — ERROR / EMPTY / LOADING STATE CATALOG (systematic ratings)

Rated on: **Exists** (is there any distinct state at all, vs. blank/frozen/silent) · **In-persona**
(does it stay in the Big Brother voice) · **Actionable** (does the player know what to do next) ·
**Recoverable** (can the player get back to play without reloading/losing data) · **Leaks**
(does it expose raw machinery — code, exceptions, JSON, dev vocabulary).

| Surface / trigger | Exists | In-persona | Actionable | Recoverable | Leaks | Note |
|---|---|---|---|---|---|---|
| Engine unreachable (hard down) | Yes | Partial | Yes ("Go in anyway") | Yes (auto-clears) | **Yes** — banner text "game service"/"app" (CA-5, known) | `engine-down-degraded` still |
| Engine reachable but a tool call errored (`lastError`) | Yes | No | Partial | Yes | **Yes, new** — raw `tool: error` string, see AXE-3 | `orwellEngineStatus.js` degraded branch |
| Transient engine blip (reconnecting) | Yes | Yes ("live feeds blinked") | N/A (self-heals) | Yes | No | good — see `showReconnecting()` |
| Browser goes offline (no network) | Yes, but **wrong** | No | Misleading | Yes | Partial | see AXE-6 — reuses server-down copy |
| Send fails outright (composer) | Yes | Mostly | Partial | Yes (text restored) | No (CSS-only tag is CA-2, known) | — |
| Stream connects but drops with zero tokens | Yes | Mostly | Yes (Retry button) | Yes | No | `_renderStreamDropRetry` — well-built, cited as steelman-adjacent |
| **Reload during an in-flight stream** | **No — silent revert** | N/A | **No** | **No** | No | **AXE-5, new — the worst cell in this table: no state exists at all** |
| Daily message cap hit (429) | Yes, but broken | No | No (unparsed JSON) | Yes (next day) | **Yes, new** | AXE-2 |
| Per-user model not allowed (403) | Yes, but broken | No | No (unparsed JSON) | Yes (pick another model) | **Yes, new** | AXE-2, same code path |
| Session-cookie/auth expiry mid-game (401) | Yes, but broken | No | No | Unclear (no redirect-to-login observed in source) | **Yes, new** | same code path as AXE-2; no distinct 401 branch exists anywhere in `chat.js` |
| Session list fails to load | Yes | No | No | Yes (retry poll) | **Yes, new, confirmed live** | AXE-4 — literal "Failed to fetch" toast |
| Model-not-configured (holding card, first run) | Yes | Partial | Yes | Yes | Vocabulary only (CA-3/4/7, known) | — |
| Message edit/resend/regenerate fails | Yes | No | No (unparsed exception) | Yes | **Yes, new** | AXE-4; edit/resend hidden in game build (steelman: `_GAME_KEEP`), Re-narrate (regen) is NOT |
| Portrait/headshot generation fails | Partial | Unclear | Weak | Yes | Low (already flagged INTEGRATION2-9/-11/-18, not re-reported) | — |
| Empty roster / "0 of 15 met" | Yes (known, DEEP-28/v1) | — | — | — | — | not re-reported |
| Empty Deals gadget (no deals made) | Yes — **hides entirely**, deliberate | N/A | N/A | N/A | No | `orwellDeals.js:123` "content-driven: no deals, no box" — a good, deliberate design choice, cited so it isn't miscounted as a gap |
| Diary Room — no prior entries | Not found as a distinct view | — | — | — | — | DR appears to be a composer-mode toggle, not a browsable history; **coverage gap**, see below |
| Retro/Finale gadgets pre-unlock | Content-driven hide (consistent with Deals pattern) | N/A | N/A | N/A | N/A | consistent with the app's stated philosophy; not a defect |
| Search sessions — zero results | Not traced to source in this pass | — | — | — | — | **coverage gap**, see below |
| Admin `/admin/status` while engine down | Yes (screenshot exists) | N/A (admin channel, technical detail expected) | Yes | Yes | Expected/by-design | admin is walled from Vault, not from technical detail — not a violation |
| App boot (`#app-loader`) | Yes, `aria-label="Loading the house"` | Yes | N/A | N/A | No | good — CA steelman already noted this |
| Model picker — zero endpoints configured | Yes | Partial (CA-7's "administrator" framing, known) | Yes (in admin case) | Yes | No new leak | — |
| Model picker — search with no matches | Yes | Yes | Yes | Yes | **Contrast fail, new** | AXE-11 |
| Stale-beat 409 (`expectedBeatSeq` mismatch) | Not traced to a distinct player-facing state in this pass | — | — | — | — | **coverage gap** — CLAUDE.md documents the mechanism (`StaleBeatError`→409) but no FE string/toast for it was found via grep in `chat.js`/`orwellDecision.js`; likely folds into the generic reconcile path (out of this pass's budget to confirm at the network layer) |

**Headline pattern across this table:** every row marked "Leaks: Yes, new" funnels through exactly
ONE of two code paths — the brittle `chat.js:1301-1316` JSON-body parser (AXE-2) or the
`showError(x + err.message)` family (AXE-4) — so fixing those two chokepoints resolves the whole
column at once rather than needing a per-row patch.

## PART 2 — FULL FINDINGS

[AXE-1] [Severity: Blocker] [Effort: <1day] [Value: High]
Two custom selection grids — the model picker's row list and the Theme window's swatch grid — are fully keyboard-inoperable
- Where: `frontend/static/js/models.js:98-162` (`_buildModelRow` — creates `document.createElement('div')` with `class="models-row"`, only `touchstart`/`touchmove`/`click` listeners, no `tabindex`, no `keydown`); `frontend/static/js/theme.js:1330-1341` (`_swatch` template — a `<div class="theme-swatch">`) and `:1427-1441` (only a `click` listener added per swatch, no keyboard path). Confirmed by exhaustive grep: zero `keydown` handlers exist anywhere in `models.js`, and the only interaction wiring for `.theme-swatch` across `theme.js` is `click`.
- Problem: Both controls' TRIGGER is a real `<button>` (`#model-picker-btn`, the Theme rail icon), so a keyboard user CAN open the menu — but once open, none of the individual options (each model, each theme swatch) are in the tab order and none respond to Enter/Space, arrow keys, or type-ahead. A keyboard-only or switch-access user can open the picker, even filter the model list by typing in the search box (a real `<input>`), and then has **no way whatsoever to select an option** — the picker is a dead end. This directly breaks the mandatory OOBE flow (CLAUDE.md: picking a narrator/utility model is the first required step before a season can start) for anyone who can't use a mouse/touch, and recurs for every subsequent model switch and every theme change during play.
- Differential: distinct from CA-10 (the `/setup` trigger span, a single non-interactive element) — this is a *list of options inside an already-open menu* being unreachable, a different failure class (missing roving-tabindex/listbox pattern vs. a missing button role on one trigger). Corroborated as a systemic pattern by finding it independently in TWO unrelated files/features using the same anti-pattern (plain `<div>` + `click`-only).
- Confidence: H (exhaustive grep confirmed the total absence of `tabindex`/`keydown` wiring in both files; the picker's own container `tabindex="-1"` at `index.html:1245` confirms the menu is only programmatically, not sequentially, focusable).
- Fix: Either (a) make each row/swatch a real `<button>` in natural tab order, or (b) implement a standard listbox/roving-tabindex pattern on the container (`role="listbox"`/`role="option"`, one row at `tabindex="0"` at a time, Arrow Up/Down to move it, Enter/Space to activate, matching the EXACT pattern already correctly implemented for gadget-rail reorder at `orwellGadgetRail.js:572-577` — reuse that convention rather than inventing a new one).

[AXE-2] [Severity: Blocker] [Effort: <1hr] [Value: High]
FastAPI's default `{"detail": "..."}` error shape isn't recognized by the FE's error-body parser — raw JSON leaks straight into the chat for three real, expected error paths
- Where: Backend — `frontend/routes/chat_helpers.py:2811` (`raise HTTPException(403, f"Your account is not allowed to use model '{sess.model}'.")`) and `:2835` (`raise HTTPException(429, f"Daily message limit reached ({cap}). Try again in 24 hours.")`), both inside `_enforce_chat_privileges`, called before BOTH `/api/chat` and `/api/chat_stream` (per its own docstring). Frontend — `frontend/static/js/chat.js:1309-1316`: `let errText = \`Error ${res.status}\`; ... const m = errBody.match(/"message"\s*:\s*"([^"]+)"/); if (m) errText = m[1]... else if (errBody.length < 200) errText = errBody;`.
- Problem: A plain `HTTPException` raised without a custom exception class serializes under FastAPI's DEFAULT envelope, `{"detail": "..."}` — NOT `{"message": "..."}`. (Confirmed: only 4 custom exception classes in `app.py:544-557` — `SessionNotFoundError`/`InvalidFileUploadError`/`LLMServiceError`/`WebSearchError` — get a handler that reshapes to `{"message": ...}`; a bare `HTTPException(429, ...)` is not one of them.) The regex therefore NEVER matches these two real, mainstream paths, so the fallback fires: the body is under 200 characters, so `errText` becomes the **raw JSON literal** — the player's error bubble reads `{"detail":"Daily message limit reached (50). Try again in 24 hours."}`, braces and quotes included, styled as a system notice in the chat. The daily message cap is exactly the kind of state an active, engaged player (the game's target audience) is expected to eventually hit. The identical code path also has NO branch at all for a 401 (session/auth-cookie expiry mid-game) — it would hit the same generic parser with no redirect-to-login and no distinct copy.
- Differential: distinct from CA-1/CA-5 (which are about deliberately-authored fallback copy using wrong vocabulary) — this is an actual parsing bug producing literal unintended JSON syntax in the player's face, for paths that are NOT edge cases.
- Confidence: H (both the exact `HTTPException` call sites and the regex/fallback logic are read directly; FastAPI's default `HTTPException` → `{"detail": ...}` shape is the framework's documented, unconfigurable default absent an explicit exception handler).
- Fix: Either (a) reshape these two (and ideally every) `HTTPException` into the same `{"message": ...}` envelope the four custom classes already use — cheapest, one shared exception handler for `HTTPException`/`StarletteHTTPException` — or (b) make the FE parser check both keys (`data.message || data.detail`) after `JSON.parse`, dropping the fragile regex entirely. Either fix should also add a distinct 401 branch (surface an in-persona "your session needs refreshing" prompt + a real redirect-to-login, not the generic parser).

[AXE-3] [Severity: Major] [Effort: <1hr] [Value: High]
Raw Python exception class name + message surfaces in the player-visible engine-status banner
- Where: `frontend/src/orwell_engine.py:271` — `_record_error(name, "unreachable", f"{type(e).__name__}: {e}")`; `:873` — `detail = {"ok": False, "engineUrl": ENGINE_URL, "error": f"{type(e).__name__}: {e}"}`. Consumed verbatim by `frontend/static/js/orwellEngineStatus.js:104` — `show("degraded", "Big Brother engine reported a problem.", (le.tool ? le.tool + ": " : "") + le.error)` — rendered as the banner's body text.
- Problem: `f"{type(e).__name__}: {e}"` is a literal Python exception repr — e.g. `ConnectError: [Errno 111] Connection refused` or `TimeoutException: ...`. Combined with `le.tool` (a literal internal MCP tool name, e.g. `recordInteraction`), the "degraded" banner can read `recordInteraction: ConnectError: [Errno 111] Connection refused` directly to the player, in a top-of-viewport banner that is NOT gated behind any admin/debug flag. This is a more severe instance of the leak class CA-5 already flagged (vocabulary like "engine"/"game service") — that finding was about word choice in AUTHORED copy; this is raw stack-trace-adjacent exception text with zero authoring at all.
- Confidence: H (both the Python f-string construction and the JS consumption/render call are read directly, not inferred).
- Fix: Never interpolate `type(e).__name__`/`str(e)` or a raw tool identifier into anything reachable by `engine_health_detail()`'s player-facing `error`/`lastError.error` fields. Map known exception types to a small, finite set of in-house phrases (connection refused → "the feed cut out"; timeout → "the feed is slow to respond"); keep the raw exception text in the server LOG only, never the HTTP response body consumed by the player-facing route.

[AXE-4] [Severity: Major] [Effort: <1day] [Value: High]
Raw `error.message`/`err.message` leaks into player-facing toasts — confirmed LIVE via telemetry, and reachable in-game through the "Re-narrate" action
- Where: 13 call sites follow the identical anti-pattern `uiModule.showError('<Action> failed: ' + err.message)`. Two are CONFIRMED reachable in the actual game build: `frontend/static/js/sessions.js:1548` (`'Failed to load sessions: ' + error.message`) and `:1831` (`'Failed to load session: ' + error.message`) — these are sidebar session-list operations, not gated by any game-build filter. A third, `frontend/static/js/chat.js:5262` (`'Regenerate failed: ' + err.message`), backs the "Re-narrate" button, which `chatRenderer.js:1344` (`_GAME_KEEP = new Set(['copy', 'regen'])`) explicitly KEEPS visible on GM/narration messages in the game build (unlike edit/fork/delete/rewrite/explain, which are correctly hidden — see Steelman). The remaining ~10 sites (`chat.js:5063,5151,5427,5813,5898,6059`; `chatRenderer.js:1006,2470`; `voiceRecorder.js:210,245`) share the identical vulnerable pattern but are currently masked from players by the game-build action-bar filters (`_GAME_KEEP`/`userPool=[]`), so they're a latent risk (would fire immediately if that gating is ever toggled off, or from the admin/full-workspace view) rather than a live gap today.
- Problem: `error.message` for a network-level failure is a raw browser/runtime string (`"Failed to fetch"` in Chromium, `"NetworkError when attempting to fetch resource"` in Firefox, or a `TypeError` message) — **live-confirmed** in `telemetry/stills/offline-recovered__desktop__light.png`, which shows a toast reading verbatim **"Failed to load sessions: Failed to fetch"** immediately after the browser regained connectivity. Reasonably, "Re-narrate" (regenerate a GM beat) failing would show "Regenerate failed: <raw exception>" — note it even reverts to the RETIRED workspace term "Regenerate" in the error text despite the button itself being correctly relabeled "Re-narrate" for players, undoing that relabeling exactly at the moment something goes wrong.
- Confidence: H for the two `sessions.js` sites (screenshot-confirmed) and the `chat.js:5262` reachability (game-build filter read directly); M for the blast radius of the other 10 (currently masked, but sharing the identical code, so a single shared fix is still the right call).
- Fix: Wrap all 13 sites in a small helper that maps common `error.message` values (`Failed to fetch`, `NetworkError...`, `AbortError`, a raw `Error <status>`) to a short, finite set of in-house phrases before they ever reach `showError()`, falling back to a generic "Something interrupted that — try again" for anything unrecognized; never pass `error.message` through unexamined. Also fix the `Regenerate failed`/`Rewrite failed` copy to say "Re-narrate" in the game build, matching the button's own relabeling.

[AXE-5] [Severity: Major] [Effort: <1day] [Value: High]
A reload during a mid-stream turn can silently revert the whole session to the pristine empty/premiere state — no error, no warning, no recovery path
- Where: live-observed, `telemetry/stills/mid-stream-before-reload__desktop__light.png` (shows "Week 1 · 1 msg" with the player's sent message "Tell me something interesting about the house." visible, mid-turn) vs. `telemetry/stills/post-reload-mid-stream-recovery__desktop__light.png` (same session, seconds later, after a reload: the top bar reads plain "Week 1" with NO message count, the sent message is completely gone, and the pristine "Welcome to the house — premiere week" card and empty hero are back exactly as a brand-new session would render).
- Problem: Regardless of the exact trigger (the capture sequence had restarted the engine process moments earlier — see `telemetry/INDEX.md` transcript ~02:40:33-51 — so this may be an artifact of a non-durable restart in the CAPTURE environment rather than a guaranteed production bug), the OBSERVABLE FE behavior is the worst possible outcome for this transitional state: total silent data loss with **zero** distinguishing UI. There is no "we couldn't confirm your last message went through," no stale-content banner, no partial-recovery attempt, nothing — the session simply looks brand new. Per CLAUDE.md's own consequence-loop mandate ("never ship an action that is narrated but never recorded — it has no consequence and no memory"), a player who reloads (or whose browser reloads for them, e.g. a mobile tab getting evicted from memory) mid-turn has no way to know whether their last action was recorded, lost, or is still in flight.
- Differential: distinct from AXE-2/AXE-4 (both about LEAKED error text) — this is the opposite failure, an ABSENT state where one is badly needed; also distinct from the already-known "empty-narration on marquee social turn" Blocker in the v1 index (that was about a turn resolving with no narration text while otherwise progressing normally) — this is about a RELOAD losing the entire visible turn history down to zero.
- Confidence: M (the observable FE state is confirmed by two directly-comparable screenshots; the root cause — genuine network/reload race vs. a capture-environment engine-restart artifact — is not disambiguated in this pass; recommend a live-UI-driven repro: send a message, reload before the stream completes, WITHOUT restarting the engine process, and confirm whether the session/messages the FE re-fetches from the server still exist).
- Fix: At minimum, add a transitional "reconnecting to your last turn…" state that is shown BEFORE the empty/welcome state is ever rendered, so a truly-lost turn is at least announced rather than silently backfilled with the pristine premiere card; investigate whether the FE's session/message re-fetch on load is racing the server's own persistence of the just-sent message (a genuine reload immediately after a fast local send, before the server has durably saved it, is a plausible root cause independent of the engine-restart timing in this specific capture).

[AXE-6] [Severity: Major] [Effort: <1hr] [Value: Med]
The browser going offline reuses the IDENTICAL "engine unavailable" banner and copy as a genuine server-side outage — misdiagnosing whose connection is actually the problem
- Where: `telemetry/stills/offline-send-attempt__desktop__light.png` (captured via `context.setOffline(True)` per `telemetry/INDEX.md`) shows the exact same top banner text as the real engine-down capture: "Big Brother engine unavailable. / The app couldn't reach the game service." Source: `frontend/static/js/orwellEngineStatus.js:refresh()` — the `catch (_)` branch (network-layer fetch failure, which is exactly what a browser-offline `fetch()` throws) falls into the SAME `show("down", "Big Brother engine unavailable.", "The app couldn't reach the game service.")` call used for a real backend outage; there is no `navigator.onLine`/`offline`/`online` event listener anywhere in the file to distinguish the two cases.
- Problem: These are two meaningfully different situations for the player to act on: "the show is down, wait" (server-side, nothing the player can do) vs. "your own connection dropped" (the player should check their own WiFi/data). Telling a player whose home WiFi just blipped that "Big Brother" (production) is unavailable sends them exactly the wrong troubleshooting signal, and undercuts the in-fiction framing worse than either state alone — the copy asserts a production-side fact ("the app couldn't reach the game service") that isn't true when the real cause is the player's own device being offline.
- Differential: distinct from CA-5 (which flagged the VOCABULARY of this banner) — this is about the banner firing for the WRONG diagnosis entirely, a functional/informational-accuracy defect, not a word-choice one.
- Confidence: H (screenshot-confirmed identical text; source-confirmed absence of any `navigator.onLine` check or `offline`/`online` listener in `orwellEngineStatus.js`).
- Fix: Add a `window.addEventListener('offline', ...)`/`navigator.onLine` check ahead of the health-poll's generic catch branch, and show a distinct, correctly-scoped message when the browser itself reports offline ("Your own connection dropped — reconnecting the moment you're back online") vs. the current copy reserved for when the browser IS online but the server genuinely can't be reached.

[AXE-7] [Severity: Major] [Effort: <1hr] [Value: Med]
`--color-muted: #888` fails WCAG AA text contrast in BOTH themes — measured, not just visually estimated
- Where: `frontend/static/style.css:139` (`--color-muted: #888;`, never overridden by the `:root.light` block at `:181-200`), used via `color: var(--color-muted)` at 16 confirmed selector sites (`grep -c "color-muted)"` = 16) for exactly the roles the code's own comment names: "timestamps, metrics, secondary meta" (`style.css:93`).
- Problem: Computed WCAG relative-luminance contrast (standard sRGB formula): `#888` (136,136,136) against the light theme's `--panel:#fff` (`style.css:183`) = **3.54:1**; against the light theme's `--bg:#f5f5f5` (`:182`) = **3.25:1**; against the dark (default) theme's `--bg:#282c34` (`:100`) = **3.96:1**. All three fail the WCAG 2.1 AA normal-text minimum of **4.5:1** (the app's own text at this size is well under the 18pt/14pt-bold threshold that would qualify for the lower 3:1 "large text" bar). This is systemic — the token is used for real, load-bearing text (timestamps a player might check to understand ordering, metadata counts) across at least 16 sites, in both themes, not a single isolated component.
- Differential: distinct from CA-11 (a single component, the risk badge, flagged visually/qualitatively) and CA-17 (a systemic RISK observation with no computed ratio) — this supplies the actual measured numbers for the specific token CA-17 gestured at, confirming the risk is real rather than theoretical, and identifies the exact token + exact fix.
- Confidence: H (contrast computed directly from the literal hex values in source using the standard WCAG relative-luminance formula, not estimated from a screenshot).
- Fix: Darken `--color-muted` for the light theme (e.g. `#6b7280`/`--color-muted-alt`, independently verified above to pass at 4.84:1 on white) via a `:root.light { --color-muted: ... }` override, and verify/adjust the dark-theme value similarly (a small lightening, e.g. toward `#9aa0a8`, would clear 4.5:1 against `#282c34`). Audit the 16 use-sites after the token change rather than patching each individually.

[AXE-8] [Severity: Minor] [Effort: <1day] [Value: Med]
The legacy `.modal` family (Brain/memory, Cookbook, custom-preset) has no Tab focus trap, unlike the OrwellWindow-migrated `settings-modal`
- Where: `frontend/static/js/ui.js:1219-1260` — the ONE shared observer for the whole `.modal` family (`_promote`, `_trackVisibility`, `_restoreFocus`, the `Escape` arbiter) implements z-ordering, visibility tracking, and focus-RESTORE-on-close, but contains no `Tab`-key handling at all. Confirmed by an exhaustive grep for `'Tab'`/`"Tab"` across every JS file: it appears only in `orwellSheet.js:446`, `orwellWindow.js:888` (`_trapFocus`), and `settings.js:5704` (which explicitly checks `modalEl` — the settings dialog specifically, migrated into the OrwellWindow kit per `settings.js:2603-2611`'s own comments). The three remaining `.modal`-class dialogs in `index.html` — `memory-modal` (`:423`, aria-label "Brain"), `cookbook-modal` (`:1501`, wired live via `modalManager.js:140,720,827` + `slashCommands.js:2606+`), and `custom-preset-modal` (wired via `group.js:154`, `presets.js:431+`) — get none of that.
- Problem: While each of these has `role="dialog"` + `aria-label`, and the shared observer DOES restore focus to the opener on close (good), nothing stops Tab from cycling focus OUT of an open modal and onto background content (the sidebar's session list, "New Chat", etc.) that sits behind the modal's visual backdrop. This differs from the CA steelman's already-verified claim (which specifically checked `orwellWindow.js`'s OWN modal stack, not this separate, older `.modal` family) — so it's new ground, not a contradiction of that finding.
- Confidence: H for the absence of Tab-handling in the shared `.modal` observer (exhaustive grep); M for real-world reachability of `cookbook-modal`/`custom-preset-modal` specifically under `ORWELL_GAME_BUILD=1` (not independently re-verified in this pass — `memory-modal`'s reachability is already flagged as an open question by CA-23, not re-litigated here).
- Fix: Either migrate these three dialogs onto the OrwellWindow kit (consistent with `settings-modal`'s own migration, and the stated direction per CLAUDE.md's Lane F/DWE windowing work — "new FE windows MUST compose the kit"), or add the same `_trapFocus()` Tab-cycling logic `orwellWindow.js:886-...` already implements, generalized into the shared `.modal` observer in `ui.js` so all three benefit at once.

[AXE-9] [Severity: Minor] [Effort: <1hr] [Value: Low]
Heading hierarchy inversion: the Theme window's `h4` dialog title contains `h2` subsections
- Where: `frontend/static/index.html:633` — the Theme window's own title is `<h4>...Theme</h4>` (inside its `modal-header`); its own first-level content sections, nested INSIDE that dialog, are `<h2>Default Themes</h2>` (`:649`), `<h2>Your Themes</h2>` (`:653`), `<h2>Colors</h2>` (`:661`), `<h2>Color Harmony</h2>` (`:720`), `<h2>Font & Layout</h2>` (`:754`), `<h2>Save / Share</h2>` (`:863`). Confirmed reachable/live: `theme-window-browse__desktop__light.png` and `theme-window-customize__desktop__light.png` both show this window actually open in the telemetry capture.
- Problem: A screen-reader user navigating by heading level (a standard, efficient SR technique — the same "landmark/rotor" navigation the CA lane's own steelman cites approvingly elsewhere) encounters an `h2` ("Default Themes") that structurally outranks the `h4` ("Theme") that is its own dialog's title — the outline reads as if "Default Themes" is a MORE important heading than the window it lives inside, and is at the SAME rank as unrelated real top-level page sections elsewhere in the app that also use `h2`. This flattens/confuses the heading outline (WCAG 1.3.1/2.4.6 best practice for heading structure) though it doesn't break the dialog's accessible NAME (which correctly comes from its `aria-label`/title text regardless of heading level).
- Confidence: H (both headings' levels and nesting are read directly from source; reachability confirmed via telemetry).
- Fix: Demote the Theme window's internal section headings to `h5`/`h6` (or restructure so the visible `h4` "Theme" acts as the outline's top for that subtree), OR promote the dialog's own title to `h2` and its subsections to `h3` — either direction restores a monotonic, non-inverted outline. The same audit is worth a quick repeat on Cookbook/Prompt/Brain, which appear to follow the identical `h4`-title-then-`h2`-subsections template.

[AXE-10] [Severity: Minor] [Effort: <1hr] [Value: Low]
The composer's `aria-label` is frozen at the generic "Message input" while its visible placeholder is dynamically swapped to in-fiction copy
- Where: `frontend/static/index.html:1241` — `<textarea id="message" placeholder="Message Orwell..." data-default-placeholder="Message Orwell..." ... aria-label="Message input" ...>`. `frontend/static/js/app.js:2297-2301` documents (and implements, for the responsive-collapse path) that `data-default-placeholder` is SERVER-rendered per build — "Message Orwell…" in the general workspace vs. **"Say or do something…"** in the game build (confirmed live in every started-game telemetry still, e.g. `started-game-empty-chat__desktop__light.png`). No file anywhere sets `aria-label` on `#message` (confirmed by grepping every `setAttribute('aria-label'`/`setAttribute("aria-label"` call site touching the composer — none exist).
- Problem: The single most-used control in the entire game — the composer every player types into for the whole season — presents two different accessible identities depending on modality: sighted users get the in-fiction "Say or do something…" placeholder (good voice work, matches the vision brief), while a screen-reader user hears only the generic, static "Message input" every time they focus it. This is a small but constant, every-turn erosion of immersion specifically for AT users, at the highest-frequency touchpoint in the whole product.
- Confidence: H (both the static HTML and the confirmed absence of any dynamic `aria-label` update are read directly).
- Fix: Set `aria-label` from the SAME per-build value already driving `data-default-placeholder` (e.g. `textarea.setAttribute('aria-label', textarea.dataset.defaultPlaceholder)` once at init, game-build-aware) so the accessible name matches what sighted players actually see.

[AXE-11] [Severity: Minor] [Effort: <1hr] [Value: Low]
Model-picker's empty-search-result text is set to inline `opacity:0.4` — a second, independently-measured contrast failure
- Where: `frontend/static/js/models.js:559` — `empty.style.cssText = 'text-align:center;padding:12px;opacity:0.4;'; empty.textContent = 'No models match "..."';`.
- Problem: Computed contrast for the app's default text color (`--fg`) at 0.4 opacity, composited over its own theme background: light theme (`--fg:#2b2b2b` over `--panel:#fff`) ≈ **2.32:1**; dark theme (`--fg:#9cdef2` over `--bg:#282c34`) ≈ **2.78:1**. Both badly fail WCAG AA (4.5:1) and even fail the lower 3:1 non-text-element minimum — worse than AXE-7's `--color-muted` token, because 0.4 is a steeper dim than the token's own value. This is a second, independent, concretely-measured instance of the SAME systemic pattern CA-17 flagged qualitatively ("muted text roles rely on opacity-dimming... cannot guarantee 4.5:1 uniformly") — corroborating it with hard numbers rather than duplicating it.
- Confidence: H (contrast computed directly from the literal opacity value and the theme's own `--fg`/`--bg`/`--panel` hex values).
- Fix: Replace the inline `opacity:0.4` with a real, contrast-checked color token (following the same `color-mix()`-against-a-token pattern CA-17's own fix recommendation cites for the risk badge elsewhere in the codebase) rather than opacity-dimming the base text color.

## Cross-territory flags

- **AXE-2/AXE-3/AXE-4 are one root-cause family**, not three unrelated bugs: every case is either
  (a) an `HTTPException`/exception-message string reaching a player-facing surface unfiltered, or
  (b) a client-side error-body parser that only recognizes ONE specific JSON shape. A single shared
  fix (an exception-message allowlist/mapper, applied server-side once and client-side once) closes
  all three at once — worth flagging to whoever triages this file so it isn't scheduled as three
  separate tickets.
- **AXE-1 corroborates a THEME the wider audit already found** (per `RANKED_MASTER_V2.md`'s Thesis
  1: "the engine computes it; the player can't feel it") from the opposite direction — here, a
  *keyboard-only player literally cannot reach the built, working feature at all* (choosing a model,
  choosing a theme), which is a stronger claim than "underdelivered" — it's an availability floor
  failure for a whole class of players.
- **AXE-5 (mid-stream reload data loss) should be read alongside `INTEGRATION2-3`** (mid-stream
  disconnect drops the peer-push AND consequence fallback) and the close-out ledger's **A-S3**
  latent ("a stale-409 that can drop a scene's only consequence fold") — three independent lanes
  converging on the same underlying seam (a turn that's in-flight when something interrupts it) from
  different angles. Worth a single, focused fix pass across all three rather than three patches.

## Coverage — where I looked, and what I explicitly did NOT chase to ground

**Looked at:** `frontend/static/index.html` (full heading/landmark/img/form-label sweep),
`frontend/static/style.css` (targeted: `prefers-reduced-motion`/`-transparency`/`-contrast` census,
`--color-muted`/`-alt` definitions + use-sites, `.close-btn`/target-size spot checks),
`models.js`, `theme.js`, `orwellGadgetRail.js`, `orwellWindow.js`, `ui.js`, `modalManager.js`,
`orwellEngineStatus.js`, `orwellNotice.js`, `orwellDecision.js`, `chat.js` (composer/send/error
paths + message-action bars), `chatRenderer.js` (both action-bar builders + game-build filters),
`sessions.js`, `app.js`, `voiceRecorder.js`; backend `frontend/src/orwell_engine.py` (health/error
plumbing end to end), `frontend/routes/chat_helpers.py` (`_enforce_chat_privileges` in full),
`frontend/app.py` (exception-handler census); ~30 telemetry stills + all 4 filmstrip sequences
including the new `reduced-motion-theme-switch` one, cross-read against `telemetry/INDEX.md`'s
documented capture caveats (fake-model artifacts, engine-restart timing) before drawing conclusions.

**Explicitly NOT chased to ground (would need live-UI/network-level verification, not source-only):**
the stale-beat 409 player-facing string (grepped, not found — may not exist as a distinct state, or
may fold into a generic reconcile path this pass's budget didn't trace at the network layer); Diary
Room's "no entries yet" state (couldn't confirm whether DR is a browsable history at all vs. a
composer-mode toggle only); sidebar session-search with zero results (not traced to source); form
labels on the add-model-endpoint (API key/base URL) form (not reached in this pass); a full
axe-core-equivalent contrast sweep of every color pair in every theme (CA-17's own recommendation,
still open — AXE-7/AXE-11 are two hand-computed data points toward it, not the full sweep);
disambiguating AXE-5's root cause (capture-environment engine-restart artifact vs. a genuine
reload/persistence race) would need a live-UI-driven repro without an intervening engine restart.

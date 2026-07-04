# FE-DEEP-2 — Frontend JS/gating exhaustive sweep

Territory: `frontend/static/js/*.js` (all 82 modules, inventoried below), `frontend/static/index.html`,
`frontend/static/css/game-trim.css`, the game-build gating chain (`src/settings.py` ↔ `app.py` ↔
`app.js`/`chat.js`/`slashCommands.js`), and `frontend/routes/*.py` only where it renders/gates UI.

## Module inventory (82 files, 63,521 lines total, `wc -l` desc-sorted)
Largest: `slashCommands.js` 6257, `chat.js` 6244, `settings.js` 5796, `sessions.js` 3241,
`admin.js` 3100, `theme.js` 3074, `chatRenderer.js` 2502, `ui.js` 1347, `orwellWindow.js` 1283,
`markdown.js` 1239, `liquidGlass.js` 1143, `modalSnap.js` 1076, `presets.js` 1085 … down to
`modelSort.js` 33. Full sweep touched all 8 charter categories across this set; deep-read (not
just grepped) 24 of the 82 files where the grep sweep surfaced a lead.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| FE2-1 | Blocker | <1hr | High | "New Chat" (3 entry points) silently detaches the player from their live game session | static/app.js:3197-3262, sidebar-layout.js:166-174 |
| FE2-2 | Major | <1hr | High | markdown.js renders a live "Run code" (Pyodide/server-shell) + "Edit code" button on ANY code fence, ungated by game build | static/js/markdown.js:790-799 |
| FE2-3 | Major | <1hr | High | Model-fallback/provider-fallback toasts leak raw model ids to the player, ungated by game build | static/js/chat.js:2147-2183 |
| FE2-4 | Major | <1hr | High | "Context compacted" toast leaks workspace/LLM vocabulary, ungated, and WILL fire in any long season | static/js/chat.js:2354-2357 |
| FE2-5 | Major | <1hr | High | Self-eviction "Cancel" button assumes success even when its own network request fails | static/js/orwellDecision.js:619-628 |
| FE2-6 | Major | multi-day | Med | Chat history has no pagination/virtualization — full season transcript re-rendered on every load | routes/session_routes.py:752-759, static/js/chat.js:4227-4263 |
| FE2-7 | Minor | <1hr | Med | Window-drag touch handlers use `{passive:true}` (no preventDefault) — page scrolls under a dragged window on mobile | static/js/windowDrag.js:306-328 |
| FE2-8 | Minor | <1hr | Low-Med | `/api/auth/features` is not game-build-aware, so client code keyed off it can mis-hide dropped verticals | routes/auth_routes.py:462-465, src/settings.py:698-713 |
| FE2-9 | Polish | <1hr | Low-Med | No RTL/bidi handling anywhere in message rendering | static/js/chatRenderer.js (whole file), static/js/markdown.js |
| FE2-10 | Polish | <1hr | Low | Unconditional external CDN loads (KaTeX/Mermaid via jsdelivr) contradict the app's own "self-hosted, no external deps" stance | static/index.html:341-347 |
| FE2-11 | Polish | <1hr | Low | Native `alert()`/`prompt()` fallbacks bypass the OrwellNotice/styled-dialog kit | static/js/chatRenderer.js:1008, settings.js:4294,4340, presets.js:458 |
| FE2-12 | Minor | <1hr | Med | `edit-code` (contentEditable code block) shares the same ungate as run-code — doubled surface, same root cause | static/js/chat.js:4820-4829, markdown.js:798 |
| FE2-13 | Polish | <1hr | Low | Icon-rail "Documents" launcher (`#rail-documents`) has no CSS backstop the way every sibling dropped-vertical rail icon does | static/index.html:904, static/app.js:3617-3624 |

---

## FE2-1 [Severity: Blocker] [Effort: <1hr] [Value: High]
"New Chat" (3 redundant entry points) silently detaches the player from their live game session
- **Where:** `static/app.js:3242-3262` (`#sidebar-brand-btn` click handler), `static/app.js:3195-3213`
  (`#rail-new-session`), `static/js/sidebar-layout.js:166-174` (`#sidebar-new-chat-btn`, which just
  proxies to the brand button). All three are wired at boot with no `data-game-build` branch.
- **Problem:** Clicking the "Orwell" sidebar logo, the "New Chat" list item, or the icon-rail "+"
  button — all three ALWAYS visible under the game build (their sidebar-visibility toggles are the
  ones game-trim.css hides from Settings, but the elements themselves default to visible and stay
  that way forever) — runs the generic workspace "start a fresh chat" flow: `deactivateCharacter()`,
  `sessionModule.setCurrentSessionId(null)`, wipes `#chat-history` to `''`, and shows the welcome
  splash (`chatModule.showWelcomeScreen()`), then (via `_createDirectChatFromPreferredModel`) may
  materialize a genuinely new, blank session against the player's preferred model. None of this
  routes through the canonical-game-session machinery (`orwell_game_session.py` / ADR 0008/0012):
  `_convergeOnCanonicalGame()` only runs from `orwellOnboarding.js`'s boot-time `route()`, never on
  this click. A player mid-season who clicks their own game's logo (an extremely natural, low-risk-
  looking action in any chat app) is dropped onto a blank "Orwell — the house is waiting" splash with
  no visible link back to their running game except manually finding it in the Chats sidebar list.
  This directly undermines the ship-gate's #1 concern (F1-F5, "no missing messages... realtime
  mirror parity") and C5 ("chat-is-the-UI... never replace a game-building interaction") — a single
  ambient click can make the entire visible game vanish. Recovery is possible (the real session
  should still be in the Chats list, assuming that section stays populated) but nothing in the UI
  hints that's necessary, and a first-time or anxious player is very likely to think their game/save
  was wiped.
- **Fix:** Under `data-game-build`, either (a) hide `#sidebar-brand-btn`'s/`#rail-new-session`'s/
  `#sidebar-new-chat-btn`'s "new chat" behavior entirely (a single continuous season has no
  legitimate use for a second blank chat) and make the logo click a no-op/refresh, or (b) redirect
  all three handlers through the same canonical-session resolution used at boot
  (`_convergeOnCanonicalGame`) so the click can never leave the player off their live game.

## FE2-2 [Severity: Major] [Effort: <1hr] [Value: High]
markdown.js renders a live "Run code" (Pyodide + server-shell) and "Edit code" button on ANY fenced code block, completely ungated by the game build
- **Where:** `static/js/markdown.js:790-799` (code-fence renderer); executed by
  `static/js/codeRunner.js` (`runJavaScript` → sandboxed iframe eval; `runPython`/`runServer` for
  bash → `POST /api/shell/exec`).
- **Problem:** Every other per-message workspace affordance in this codebase is explicitly gated
  (`document.body.hasAttribute('data-game-build')`) — the msg-action toolbar
  (`chatRenderer.js:1343-1345`, `1552`) strips edit/delete/fork/regen down to just Copy+Re-narrate
  for GM messages and to NOTHING for player messages, with an explicit comment citing the
  anti-sycophancy/EventStore-desync rationale (E93). But the markdown renderer's code-fence handling
  has no such branch at all: any ```python/```js/```bash/```html block — in narration, in a player's
  own OOC message, in a pasted quote — gets a fully wired "▶ Run code" button and a "✎ Edit" pencil
  that makes the code block contentEditable. Clicking Run on `python`/`bash` POSTs to
  `/api/shell/exec`; that router is unmounted under the game build (`app.py:787`,
  `mount_optional(app, "shell", ...)`, "shell" ∈ `GAME_DROP_SET`) so it 404s and prints a confusing
  "(no output)" rather than executing — but `javascript` still runs for real, inside a sandboxed
  `iframe` in the player's own browser tab. Either way, an interactive code-execution console
  materializes inside a Big Brother roleplay the instant any code fence appears — a severe C2/I9
  "workspace wearing a game's clothes" break, and the ONE surface in the whole per-message-action
  system the E93 audit missed.
- **Fix:** Wrap the `runBtn`/`editBtn` construction in `markdown.js:795-798` with the same
  `document.body.hasAttribute('data-game-build')` check every sibling surface already uses; under
  the game build, code fences should render as inert `<pre><code>` with (at most) the Copy button.

## FE2-3 [Severity: Major] [Effort: <1hr] [Value: High]
Model-fallback and provider-fallback stream events show the player raw model ids in a toast, completely ungated
- **Where:** `static/js/chat.js:2147-2158` (`json.type === 'model_fallback'`) and
  `static/js/chat.js:2176-2194` (`json.type === 'fallback'`).
- **Problem:** When the configured narrator model goes offline, `uiModule.showToast(`Model
  ${old_model} offline — switched to ${new_model}`, 5000)` fires unconditionally — no
  `isGameBuild()` check. Immediately below it, the SAME event handler (`fallback`, line 2176) DOES
  correctly re-label the in-bubble role to "Big Brother" under the game build with an explicit
  comment: *"in the game build the sender is the show, never a model name — even a provider fallback
  stays diegetic (the toast above still surfaces the misconfig out-of-fiction)."* That comment shows
  the team consciously decided the ROLE LABEL must never leak a model name, but treated the TOAST as
  an acceptable "out-of-fiction" exception — a judgment call that doesn't hold up against I9 ("No
  engine/tool/app/system talk in anything the player sees"): a Big Brother player has no legitimate
  reason to ever learn "deepseek/deepseek-v4-pro" or "gpt-4o-mini" exist. This is a real, easily
  reachable path (provider outages happen) that undoes the careful work done one line away.
- **Fix:** Gate both toasts behind `!isGameBuild()`; under the game build substitute a generic,
  diegetic-safe line (e.g. "Producers report a brief signal hiccup — picking back up.") or suppress
  the toast entirely, matching the role-label treatment already applied to the bubble.

## FE2-4 [Severity: Major] [Effort: <1hr] [Value: High]
"Context compacted — older messages summarized" toast leaks LLM-context vocabulary and WILL fire in any sufficiently long season
- **Where:** `static/js/chat.js:2354-2357` (`json.type === 'compacted'`).
- **Problem:** Same missing-gate class as FE2-3, but with guaranteed reachability rather than an
  edge case: this fires whenever the backend auto-summarizes older turns because the model's context
  window filled up. Given the game's entire design (0003, "the conversation is the game" — a season
  runs across many in-game days of beat-by-beat, no-montage play with 16 distinct voices), a season
  of normal length WILL eventually hit this. Unlike the fallback toasts (rare/error-path), this is a
  routine, expected event in long-running play — meaning every sufficiently-engaged player will
  eventually see raw "context compacted / summarized" language, the single most on-the-nose
  workspace phrase possible, sitting on top of a Big Brother house. It also compounds FE2-6 below:
  it is indirect evidence that the underlying LLM context is already being silently trimmed for long
  seasons, which is exactly the scaling pressure FE2-6 flags for the DOM/transcript side.
- **Fix:** Gate behind `!isGameBuild()`; replace with nothing, or a soft, diegetic "the house's
  memory of early days blurs a little" cue if the designers want the phenomenon surfaced at all.

## FE2-5 [Severity: Major] [Effort: <1hr] [Value: High]
Self-eviction "Cancel" assumes success even when its own cancel request fails — the player can believe they're safe while the engine still holds the confirmation
- **Where:** `static/js/orwellDecision.js:619-628`.
- **Problem:** The self-evict "Cancel — stay in the house" handler sets `_userDismissed = true` and
  unconditionally calls `removeCard()` AFTER attempting `POST /api/orwell/self-eviction/cancel` —
  but the fetch is wrapped in a `try { … } catch (_) { OrwellReport.fail(...) }` that swallows the
  failure and does NOT branch on it: `removeCard()` runs on the very next line regardless of whether
  the cancel actually reached the engine. Contrast this with the adjacent CONFIRM handler
  (`orwellDecision.js:653-711`), which correctly keeps the card up, re-enables the button, and shows
  a role="alert" error message on any failure — an explicit, careful fail-*safe* pattern. The Cancel
  path is the one binding, irreversible, safety-relevant action in this whole card system (self-
  eviction) and it fails the opposite way: on a network blip the UI silently tells the player
  "you're safe, keep playing" while the engine may still be holding a live self-eviction
  confirmation. `_userDismissed = true` also permanently suppresses any re-arm of this card, so the
  player has no way to discover the mismatch short of the eviction actually happening.
- **Fix:** Only call `removeCard()` (and set `_userDismissed`) inside the `try` block, after
  confirming `r.ok`; on failure, mirror the Confirm button's pattern — keep the card up, show the
  `role="alert"` error, and let the player retry Cancel.

## FE2-6 [Severity: Major] [Effort: multi-day] [Value: Med]
Chat history has no pagination or virtualization — the full season transcript is fetched and rendered on every load
- **Where:** `routes/session_routes.py:752-759` (`GET /history/{sid}` returns
  `{"history": [msg.to_dict() for msg in session.history]}` — no offset/limit param at all);
  `static/js/chat.js:4227-4263` (`softReloadHistory` iterates the entire `data.history` array into
  DOM nodes, no windowing); the equivalent full-history render path used on session select in
  `sessions.js` has the same shape.
- **Problem:** The whole game's core loop is "the conversation is the game" (ADR 0003) with an
  explicit no-montage, beat-by-beat mandate across a full season (premiere → weekly comps/ceremonies
  → jury → finale) with 16 distinct voices and lingering-as-play social runway. That is exactly the
  shape of workload that accumulates thousands of messages in one session over a full playthrough.
  There is no pagination anywhere in the fetch, no truncation, and no DOM virtualization — every
  reload/session-select parses and renders the entire history from message #1. This is the kind of
  gradual, hard-to-notice-in-a-demo defect that would directly justify the owner's "in its current
  form it's unplayable" verdict once a save runs long: page-load time, memory, and scroll perf will
  visibly degrade as a season deepens, hitting hardest exactly on mobile (the charter's other
  explicit concern) where memory budgets are tightest.
- **Fix:** Add `offset`/`limit` (or cursor) support to `GET /history/{sid}`, load the most recent N
  messages by default with "load earlier" on scroll-up, and either virtualize the message list or
  cap in-DOM history with an off-DOM cold-store for older turns. This is explicitly named in the
  charter's render-correctness sweep ("virtualization/absence for long seasons, 1000+ messages") and
  the codebase currently has none.

## FE2-7 [Severity: Minor] [Effort: <1hr] [Value: Med]
Window-drag touch handlers never call `preventDefault` — the page scrolls underneath a dragged OrwellWindow on mobile
- **Where:** `static/js/windowDrag.js:306-328` (`enableTouch` branch: both `touchstart` at line 328
  and `touchmove` at line 325 are registered `{ passive: true }`).
- **Problem:** This is the ONE inconsistent implementation in the window-kit family. Its two
  siblings that also drive touch drags on `.ow-window` surfaces both correctly use
  `{ passive: false }` so they CAN suppress the browser's native touch-scroll:
  `windowResize.js:271-287` (`ev.preventDefault()` at line 275, then `touchmove` added with
  `passive: false` at 284) and `orwellSheet.js:309,348` (`optPassive = {..., passive:false}`). Only
  `windowDrag.js`'s touch path was left `passive: true`, meaning `_onMove` never has the chance to
  block default scrolling. Any player on a touch device who drags a floating OrwellWindow (the cast
  roster gadget, diary room, status panel, etc. — anything using this kit's draggable header) will
  see the window slide under their finger WHILE the page behind it also pans/scrolls, a genuinely
  janky, disorienting mobile interaction that its sibling kit files specifically engineered around.
- **Fix:** Change `windowDrag.js:325,328` to `{ passive: false }` and add `e.preventDefault()` at
  the top of the touch `onMove`/`touchstart` handlers, matching `windowResize.js`'s pattern exactly.

## FE2-8 [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
`/api/auth/features` is not game-build-aware, so any client code keyed off it silently disagrees with the server-side gate
- **Where:** `routes/auth_routes.py:462-465` (`get_features` returns `_load_features()` directly);
  `src/settings.py:698-713` (`load_features()` merges `DEFAULT_FEATURES` with the saved overrides —
  it never calls `game_build_enabled()`/`is_feature_enabled()`); consumed at
  `static/app.js:1416-1432` (`map = { document_editor: ['overflow-doc-btn','rail-documents'], ... }`,
  hides an id only `if (features[key] === false)`).
- **Problem:** `document_editor` is `True` in `DEFAULT_FEATURES` and is a member of `GAME_DROP_SET`,
  so under the game build `is_feature_enabled('document_editor')` is structurally `False` — but
  `GET /api/auth/features` never routes through that function, so it reports `document_editor: true`
  regardless of the build. The only client code gated on this specific flag
  (`rail-documents`/`overflow-doc-btn`) is a real gap in the codebase's otherwise very consistent
  "hide the launcher AND unmount the router" discipline (every sibling dropped vertical — gallery,
  research, calendar, etc. — gets a CSS backstop in `game-trim.css` in addition to this JS check;
  `document_editor` gets neither). In practice the concrete blast radius is small today
  (`overflow-doc-btn` doesn't currently exist in `index.html`, and `#rail-documents` only ever shows
  itself when a document panel/indicator was already open, which the game build's unmounted router
  makes hard to reach) — but the root cause is systemic: this is the ONE feature endpoint any future
  client-gated feature will naturally reach for, and it silently lies about game-build state.
- **Fix:** Have `get_features()` (or `load_features()` itself, when called for the public endpoint)
  intersect its output through `is_feature_enabled()` per key, so the JSON response matches the
  server-side truth the routers already enforce. Cheap, and forecloses the next feature that trusts
  this endpoint from developing the same silent mismatch.

## FE2-9 [Severity: Polish] [Effort: <1hr] [Value: Low-Med]
No RTL/bidi handling anywhere in message rendering
- **Where:** `static/js/chatRenderer.js` (message body/bubble construction) and `static/js/markdown.js`
  — neither sets or reads a `dir` attribute anywhere in either file (`grep dir=` returns nothing).
- **Problem:** The cast is explicitly sourced from "vendored real-name corpora" (CLAUDE.md), and the
  player can type anything, in any script, into the composer or Diary Room. Nothing in the render
  path adds `dir="auto"` to message bodies, so a player writing in Arabic/Hebrew, or narration that
  quotes a name/phrase in an RTL script, renders with forced-LTR punctuation/number ordering inside
  an LTR-fixed bubble — a real internationalization correctness gap for a game whose whole surface
  is prose.
- **Fix:** Add `dir="auto"` to the `.body`/message-content element in `chatRenderer.js`'s bubble
  construction (a one-line, zero-risk addition — `dir="auto"` degrades to normal LTR for all-Latin
  text with no visual change).

## FE2-10 [Severity: Polish] [Effort: <1hr] [Value: Low]
Unconditional external CDN script/stylesheet loads (KaTeX, Mermaid) contradict the app's own "self-hosted, no external deps" stance
- **Where:** `static/index.html:334-347`.
- **Problem:** Line 335's comment reads *"Inter font — self-hosted, no Google dependencies"* directly
  above two `<link>`/`<script>` tags that load `https://cdn.jsdelivr.net/npm/katex@…` and
  `.../mermaid@…` on EVERY page view, unconditionally, with no game-build gate and no lazy/on-demand
  loading gate (they load whether or not the current message contains any math/diagram syntax — in
  the game build, essentially never). This is a small but real inconsistency: math formulas and
  flowcharts are not something a Big Brother narrator would ever emit, so this is dead weight for
  100% of real play, and it silently phones home to a third-party CDN on every load of an app whose
  own deploy story (ADR 0014, local & tunable HTTPS; the one-liner LAN-trusted deploy) is built
  around a self-contained, trust-controlled install.
- **Fix:** Either self-host both libraries next to the already-self-hosted Inter fonts, or defer
  loading them until `markdown.js` actually detects `$$…$$`/```mermaid``` content in a message (the
  file already has the placeholder-substitution machinery to do this lazily), and additionally strip
  them under the game build via the same `dropped_script_srcs` mechanism used for the other unused
  verticals.

## FE2-11 [Severity: Polish] [Effort: <1hr] [Value: Low]
Native `alert()`/`prompt()` fallbacks bypass the OrwellNotice/styled-dialog kit
- **Where:** `static/js/chatRenderer.js:1008` (`alert('Could not start follow-up chat: ' + e.message)`
  — the Deep-Research "Discuss" spinoff button's error path); `static/js/settings.js:4294`
  (`uiModule.showError ? uiModule.showError('Export failed') : alert('Export failed')`, contacts
  export) and `:4340` (contacts import); `static/js/presets.js:458`
  (`name = prompt('Enter a name for this persona:')`).
- **Problem:** `ui.js` explicitly documents (`ui.js:497,578,780`) that it ships a styled
  confirm/prompt replacement specifically so the app never has to fall back to the browser's native
  chrome — a raw OS-styled `alert()`/`prompt()` dialog is the single most jarring possible break of
  immersion available in a browser (it pauses the whole tab, shows the raw origin/URL, uses system
  font). Every one of these call sites is a defensive `... : alert(...)` fallback that should be
  unreachable in practice (`uiModule`/`ui.js` load before every consumer here), which means the
  fallback branch is effectively untested dead code that would surface a native browser dialog inside
  a Big Brother season if `uiModule.showError` were ever undefined/mid-load. The two `settings.js`
  sites and the `chatRenderer.js` site sit behind dropped-vertical features (contacts/deep-research),
  so today's practical exposure is low, but they are exactly the kind of "it'll never happen" branch
  that DOES happen during a real init-order regression.
- **Fix:** Drop the `alert()`/`prompt()` fallback branches entirely (call `uiModule.showError`/
  `uiModule.styledPrompt` unconditionally) so a future init-order bug fails loud in the console
  instead of surfacing a native browser dialog to the player.

## FE2-12 [Severity: Minor] [Effort: <1hr] [Value: Med]
`edit-code` shares the exact same ungated path as `run-code` — a second, distinct workspace affordance on every code fence
- **Where:** `static/js/markdown.js:798` (button markup); dispatch at `static/js/chat.js:4820-4829`
  (`.edit-code` click delegate toggles `contentEditable` on the `<code>` element).
- **Problem:** Distinct from FE2-2's execution concern: this button turns any rendered code block
  into a live, contentEditable text field with no game-build check either. Combined with FE2-2, a
  single code fence in the transcript carries THREE workspace controls (Run / Edit / Copy) with zero
  gating — Copy is harmless, but Edit lets a player silently mutate the DISPLAYED transcript of a
  past beat (with no persistence, but no warning either), which is its own small version of the
  "record-altering action on the played record" problem E93 solved everywhere else in this exact
  file family.
- **Fix:** Same fix location as FE2-2 — gate `editBtn`'s construction in `markdown.js:798` behind
  `!isGameBuild()` alongside `runBtn`.

## FE2-13 [Severity: Polish] [Effort: <1hr] [Value: Low]
Icon-rail "Documents" launcher has no CSS backstop, unlike every sibling dropped-vertical rail icon
- **Where:** `static/index.html:904` (`#rail-documents`, `class="icon-rail-btn rail-dynamic"`,
  `style="display:none"` inline default); `static/css/game-trim.css:14-25` (the rail-icon hide list
  covers `#rail-calendar/#rail-compare/#rail-cookbook/#rail-research/#rail-email/#rail-gallery/
  #rail-archive/#rail-memory/#rail-notes/#rail-tasks` — every dropped-vertical rail icon EXCEPT
  documents); `static/app.js:3617-3624` (`#rail-documents` click handler still exists and calls
  `el('overflow-doc-btn')?.click()`, a button that no longer exists in the current `index.html`).
- **Problem:** This is the direct sibling gap to FE2-8: every other dropped-vertical rail icon gets
  BOTH a CSS backstop and a JS feature-flag hide, but `#rail-documents` relies solely on the (broken,
  per FE2-8) feature-flag path plus its own inline `display:none` default and a runtime toggle keyed
  off a local `documentModule.isPanelOpen()`/`doc-indicator-btn` state that can never legitimately
  become true under the game build (the router is unmounted). Low practical severity today, but it
  is the one visibly missing entry in an otherwise complete, carefully-enumerated CSS list, and its
  click handler is confirmed-dead code pointing at a non-existent button — a small maintenance trap
  for whoever next edits that rail.
- **Fix:** Add `#rail-documents` to the `game-trim.css` rail-icon hide list alongside its 10 siblings
  for defense-in-depth consistent with every other dropped vertical, and delete the dead
  `#rail-documents` click handler (or repoint it now that `#overflow-doc-btn` is gone).

---

## Coverage statement

**Swept (all 8 charter sweeps, against all 82 JS modules + index.html + game-trim.css + the
game-build gating chain in `src/settings.py`/`app.py`):**
1. **Game-build gating** — walked the full chain (`game_build_enabled` → `GAME_KEEP_SET`/
   `GAME_DROP_SET` → `mount_optional` router gating → `GAME_DROP_SCRIPTS` → `game-trim.css` → the
   slash-command `GAME_SLASH_KEEP` gate → the msg-action-toolbar E93 gate). Checked every sidebar
   rail icon, every settings tab, the composer's overflow menu, the per-message action toolbars (both
   AI and user), the mode toggle, the custom-preset/"Prompt"/Group-Chat subsystem (confirmed
   unreachable — no surviving trigger in `index.html`), TTS/voice gating, and the slash-command
   registry (`slashCommands.js`, 6257 lines) end to end. This chain is unusually mature — most
   suspected leaks (documents editor UI, `/export` slash shortcut, model picker, contacts
   import/export) turned out to be correctly gated by at least one of {CSS, JS feature-flag, router
   unmount, `GAME_SLASH_KEEP`}. The two real gaps found are FE2-2/FE2-12 (markdown code-fence
   actions — a genuinely missed surface in an otherwise-complete per-message-action audit) and
   FE2-8/FE2-13 (the one feature-flag endpoint/rail icon without the CSS backstop its siblings have).
2. **State-machine sweep** — enumerated states for the send button (has a `_sendInFlight` guard),
   the decision card (confirm/cancel/dismiss/error/re-arm), the resume-stream path (session-switch-
   mid-stream is explicitly handled), the Escape stack (`escMenuStack.js`, unit-tested, LIFO,
   double-dismiss-safe), and the "New Chat" family — the last one is FE2-1, the strongest finding in
   this sweep.
3. **Error-path sweep** — sampled ~500 swallowed catches across the codebase; traced the highest-
   density files (`chat.js` 48, `orwellOnboarding.js` 44, `orwellHeadshot.js` 18) and found the
   overwhelming majority are deliberate, commented fail-open patterns consistent with the codebase's
   stated philosophy (`OrwellReport.fail(...)` + a user-facing message on virtually every path
   checked). The one asymmetric failure found is FE2-5 (self-evict Cancel fails the opposite way
   from its Confirm sibling).
4. **Lifecycle/leak sweep** — audited every `addEventListener`-without-`removeEventListener` file and
   every `setInterval`/`MutationObserver` instance; all resolve to singleton, app-lifetime pollers/
   observers (by design, not per-instance leaks) — consistent with v1's "setInterval leaks×5" already
   covering this territory, so no new leak findings were added to avoid dilution. FE2-7 (touch-drag
   passive-listener asymmetry) is the one genuine, new lifecycle-adjacent defect found in this pass.
5. **Copy sweep** — grepped every `showToast`/`showError` call across the BB-prefixed modules AND the
   inherited `chat.js`/`settings.js`/`sessions.js` for workspace vocabulary; the BB-prefixed modules
   (orwellCast/Deals/Presence/etc.) are clean. FE2-3/FE2-4 are the real leaks, both in `chat.js`'s
   stream-event handling, both missing a gate that a nearly-identical line one hop away already has.
6. **Kit-conformance sweep** — enumerated every raw `.modal`/`alert`/`confirm`/`prompt` call; the
   dialog kit (`ui.js`) is comprehensive and almost universally used — FE2-11 lists the handful of
   defensive-fallback exceptions.
7. **Render-correctness sweep** — checked history loading/pagination (FE2-6), innerHTML interpolation
   for escaping (spot-checked orwellDecision/Cast/Deals — all correctly escape or use `textContent`),
   and RTL/bidi (FE2-9, a genuine gap).
8. **Mobile-specific sweep** — checked every `touchstart`/`touchmove` file for passive-listener
   correctness (FE2-7 is the one inconsistency in an otherwise-correct pattern) and `visualViewport`
   usage (two complementary, non-conflicting handlers — not a bug).

**Not covered / explicitly out of scope for this lane:** deep narration-fidelity/prompt-engineering
content (separate specialist lanes), cross-window/session consistency races beyond what surfaced
incidentally (orwell-consistency-parity's territory), and a live-browser/Playwright pass (this was a
static-source audit per the charter's token-frugal, grep-then-narrow instruction — no telemetry
bundle was available for this lane to consult).

**On volume:** this pass produced 13 new, source-verified findings across all 8 required sweeps, one
of them (FE2-1) plausibly Blocker-severity and directly on the golden path. The codebase in this
territory is unusually mature — nearly every category the charter explicitly asks about (slash
commands, per-message actions, TTS, dropped-vertical rail icons, reduced-motion, the Escape stack)
already has a deliberate, commented, often unit-tested gate, which is why several avenues that looked
promising on first grep (custom-preset modal, group chat, contacts import/export, the shortcuts
help panel, `#model-select`) resolved to "already correctly handled" rather than new findings. I did
not stop at the first negative result in any of the 8 categories — each one is backed by the specific
mechanism I found and ruled out, listed above, rather than an unsubstantiated "looks fine."

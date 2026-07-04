# FRONTEND-DEEP — Orwell exhaustive pre-ship audit (agent: FRONTEND-DEEP)

Territory: every file in `frontend/static/js/` (94 files enumerated), `frontend/static/index.html`,
`frontend/static/app.js` (pulled in because it implements logic `static/js/settings.js` calls into),
and the CSS design system (`style.css` 41,195 lines + `css/game-trim.css`, `css/responsive-tokens.css`,
`css/orwellHouseThemes.css`, `css/eyeBlink.css`, `css/meshGradient.css`). Read-only; nothing modified.
Grep-then-narrow throughout; `style.css`/`chat.js` were never read end-to-end.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| FEDEEP-1 | Major | <1hr | High | Diary Room composer text survives cancel — can leak into in-character chat | orwellDiaryRoom.js `exitDRMode()` |
| FEDEEP-2 | Major | <1day | High | TTS + Copy-to-clipboard read pre-scrub raw text, bypassing every machinery-leak scrub | chat.js:3296-3298, chatRenderer.js:1305, tts-ai.js `extractPlainText` |
| FEDEEP-3 | Major | <1hr | High | Machinery-aside regex false-positives on ordinary English ("the model", "the system") and can silently delete real narration | markdown.js `_MACHINERY_ASIDE_RE` (~L299-314) |
| FEDEEP-4 | Major | <1hr | High | Casting-photo error copy names "the image model" and sends the player to "Settings" | orwellHeadshot.js:250 |
| FEDEEP-5 | Major | <1day | Med | Engine-status banner leaks raw tool names + raw technical error text to every player, not just admins | orwellEngineStatus.js:111-115 |
| FEDEEP-6 | Major | <1day | Med | ORWELL_TOOL_BEATS carries labels for admin/God-Mode-only tools reachable by the player-facing renderer (cross-territory: backend gate gap) | orwellToolBeats.js:52-67 + frontend/src/tool_security.py |
| FEDEEP-7 | Major | <1day | Med | z-index has no design tokens: 238 raw hardcoded values spanning 60 → 1,000,000 | style.css (whole file) |
| FEDEEP-8 | Minor | <1day | Med | Spacing scale defined but essentially unused (929 hardcoded px vs 6 token uses) | style.css vs css/responsive-tokens.css |
| FEDEEP-9 | Minor | multi-day | Low | `!important` overuse — 1,665 occurrences in one 41k-line stylesheet | style.css |
| FEDEEP-10 | Minor | <1hr | Med | Un-throttled whole-document MutationObserver forces layout reads on every DOM mutation during streaming | orwellScrollBottom.js `watchDecisionCard()` |
| FEDEEP-11 | Polish | <1hr | Low | Native `window.confirm`/`alert` fallback would break immersion on two high-stakes actions | settings.js:1880, 2414 |
| FEDEEP-12 | Minor | <1hr | Low | Orphaned legacy rename dropdown/modal in the DOM with zero wired handlers, duplicating a second, safer rename implementation that also contains a latent raw-model-id leak | index.html:998-1002, 1475; app.js:1545-1600 vs 342-393 |
| FEDEEP-13 | Polish | <1hr | Low | "Sensitive Blur" workspace-legacy privacy setting kept in the game build with out-of-voice copy ("AI output") | index.html:2031-2032; censor.js |
| FEDEEP-14 | Minor | <1hr | Low | "Thinking Process" settings hint shows the player raw `<think>` tag markup | index.html:2026 |
| FEDEEP-15 | Polish | <1hr | Low | `esc()` reimplemented 12 times; one copy (orwellHeadshot.js) silently diverges (drops `'` escaping and the null-guard) | orwellHeadshot.js:179 vs 11 other files |
| FEDEEP-16 | Minor | multi-day | Low | Several 5,800-6,300-line "god files" make the game-build audit surface hard to verify by inspection | settings.js (5796L), slashCommands.js (6257L), chat.js (6244L), admin.js (3100L) |
| FEDEEP-17 | Polish | <1hr | Low | Dead feature path still ships a raw `alert()` with an exception message | chatRenderer.js:1002-1010 |
| FEDEEP-18 | Polish | <1hr | Low | "Sensitive Blur" can visually mangle in-fiction narration text (click-to-reveal chrome mid-bubble) if a player ever enables it | censor.js `_contextCensor` |
| FEDEEP-19 | Minor | <1hr | Low | `_ADMIN_TOOLS`/beat-map maintenance drift risk: `manage_settings` absent from `_ADMIN_SCHEMA_NAMES` (cross-territory note, see FEDEEP-6) | frontend/src/agent_loop.py:554-561 vs 1088-1093 |
| FEDEEP-20 | Polish | <1hr | Low | Composer-draft privacy gate (G17) only protects a refresh *while still in DR mode* — it does not cover FEDEEP-1's exit-without-send gap | orwellComposerDraft.js:1-25 header contract vs orwellDiaryRoom.js `exitDRMode` |

---

## Findings (full schema)

```
[FRONTEND-DEEP-1] [Severity: Major] [Effort: <1hr] [Value: High]
Diary Room composer text survives cancel/exit — can be sent to the house as an in-character line
- Where: frontend/static/js/orwellDiaryRoom.js, `exitDRMode()` (L144-152), invoked from the × button
  (L93/L146), from Escape (L206), and from the post-submit auto-exit (L191). Repro: open the Diary
  Room (sidebar button), type a private confessional, then press Escape or click the × WITHOUT
  sending, then press Enter in the (now house-bound) composer.
- Problem: `enterDRMode()` sets `box.placeholder` and a mode flag but the confessional text the
  player typed lives in `box.value`, which `exitDRMode()` never clears. The pill's own copy promises
  "private & out-of-character; the house never hears this" (L89) and CLAUDE.md's Diary Room model is
  explicit that it "has no in-game pathway to any NPC." Exiting without sending leaves the drafted
  confessional sitting in a now-ordinary, house-bound composer with no visual cue it was ever DR
  content — the very next Enter sends it into the live chat/agent pipeline, which can record it as an
  in-character line or fold it into the social graph. This directly violates I3 (knowledge moves only
  through sanctioned pathways) and the explicit Diary-Room OOC contract. See FEDEEP-20 for why the
  existing refresh-time privacy gate (orwellComposerDraft.js) does not close this specific gap.
- Fix: `exitDRMode()` should clear `box.value` (and dispatch the same `input` event `submitDR`'s
  success path already fires) whenever exiting WITHOUT a successful submit, or — if preserving the
  draft is wanted for convenience — keep `drMode` semantics attached to the draft until the player
  explicitly discards it (e.g. re-arm the pill on next composer focus) rather than silently promoting
  a DR draft to a live chat turn.

[FRONTEND-DEEP-2] [Severity: Major] [Effort: <1day] [Value: High]
TTS and "Copy message" read the pre-scrub raw buffer, bypassing every machinery-leak scrub
- Where: frontend/static/js/chat.js:3296 (`footerTarget.dataset.raw = accumulated`) and :3298
  (`addAITTSButton(footerTarget, accumulated)`); frontend/static/js/chatRenderer.js:1305
  (`uiModule.copyToClipboard(msgElement.dataset.raw || ...)`); frontend/static/js/tts-ai.js:75-100
  (`extractPlainText` only strips `<think>` tags via one regex).
- Problem: markdown.js invests four separate scrub passes (NARR-9/NARR-10/#1047:
  `scrubReasoningPreamble`, `redactRawIds`, `scrubMachineryAsides`, the OOC-wrap detector) to keep
  operator asides, raw `npc:<id>` engine handles, and tool-process chatter out of the RENDERED
  bubble — but only the rendered HTML is scrubbed. The underlying `accumulated` streaming buffer is
  stored verbatim in `dataset.raw` "so copy/TTS work" (chat.js comment at L3295), and both consumers
  read it directly. A reply that leaks a mid-paragraph operator aside or a raw `npc:42` id (the exact
  failure modes #1047/NARR-9/NARR-10 were built to catch) renders CLEAN in the chat bubble but is
  spoken aloud verbatim by TTS and copied verbatim to the clipboard — a structural I9 bypass of every
  scrub investment, reachable through two very ordinary player actions.
- Fix: run `extractPlainText`'s input (and the value written to `dataset.raw`) through the same
  `scrubReasoningPreamble` → `redactRawIds` → `scrubMachineryAsides` pipeline `processWithThinking`
  already applies under `gameBuildSuppressesThinking()`, or expose a `scrubbedText` alongside
  `dataset.raw` and have TTS/copy prefer it in the game build.

[FRONTEND-DEEP-3] [Severity: Major] [Effort: <1hr] [Value: High]
Machinery-aside scrub can false-positive on ordinary English and delete real narration
- Where: frontend/static/js/markdown.js, `_MACHINERY_ASIDE_RE` (~L299-314), consumed by
  `scrubMachineryAsides` (L316), which runs on every reply in the game build (L690).
- Problem: the regex includes the bare alternation `\bthe (?:engine|system|model|front[\s-]?end)\b`
  to catch fourth-wall leaks like "the engine decided…". But "the system" and "the model" are ordinary
  English a Big Brother narrator will plausibly use ("she's gaming the system", "you've become the
  model houseguest", "beat the system to survive the block"). `scrubMachineryAsides` drops the WHOLE
  sentence containing any match (L322-327) — if that sentence is the entire reply (a short, punchy
  eviction-night line, for instance), the player sees an EMPTY bubble, corroborating the prior audit's
  "Blocker: empty-narration on marquee social turn" with a second, distinct root cause: an over-eager
  I9 defense actively deleting legitimate in-fiction prose, not a model failure to generate content.
- Fix: narrow the alternation to require a leak-shaped context (e.g. "the engine/system/model
  decided/says/thinks/knows", or require it co-occur with a first-person operator verb elsewhere in
  the same sentence) rather than matching the bare noun phrase; add a fixture with "the model
  houseguest" / "gaming the system" to the scrub's test suite to lock the false-positive fix in.

[FRONTEND-DEEP-4] [Severity: Major] [Effort: <1hr] [Value: High]
Casting-photo error message names "the image model" and points the player at Settings
- Where: frontend/static/js/orwellHeadshot.js:250, inside `studioGenerate()` (the "Generate 3 studio
  options" flow of the in-fiction cast-photo studio).
- Problem: `msg((d && d.reason) || "Couldn't generate options — check the image model in Settings.")`
  — the fallback error string surfaces the phrase "the image model" (an AI/LLM concept) and directs
  the player to a technical Settings action, in the middle of what is framed as an in-fiction "your
  cast photo" moment. This is a clean I9/C2 violation in an error path exactly of the kind the charter
  asks to hunt: every other surface in this codebase (markdown.js's whole scrub pipeline, the
  `ORWELL_TOOL_BEATS` diegetic relabeling) works hard to keep "model"/"engine" language out of what
  the player reads; this one line puts it back in, unconditionally, whenever the backend omits a
  `reason`.
- Fix: reword the fallback to stay in the production-studio frame ("The photo booth camera jammed —
  try again in a moment.") and drop the "check … in Settings" instruction, or route the real
  diagnostic to an admin-only surface (e.g. `window.OrwellReport`, which is already called on hard
  failure at L252) instead of the player-visible `msg()`.

[FRONTEND-DEEP-5] [Severity: Major] [Effort: <1day] [Value: Med]
Engine-status banner leaks raw tool names and raw technical error text to every player
- Where: frontend/static/js/orwellEngineStatus.js:111-115, inside `refresh()`'s `lastError` branch;
  loaded unconditionally for every session (index.html:2676, no admin gate).
- Problem: this banner is a deliberate, well-documented exception to the "machinery is invisible"
  rule (its own header comment: "the operator ... needs an honest, out-of-character signal"). But the
  degraded-state banner it builds is `show("degraded", "Big Brother engine reported a problem.",
  (le.tool ? le.tool + ": " : "") + le.error)` — this puts the LITERAL engine tool name (e.g.
  "advanceGame", "recordInteraction" — the exact vocabulary `ORWELL_TOOL_BEATS`/markdown.js's
  `_GAME_TOOL_WORDS` exist to hide) and a raw backend error string directly into a banner every
  player sees, not an operator-only one. There is no admin/operator branch — a regular player hitting
  a transient tool failure mid-game sees "recordInteraction: <stack-trace-shaped string>" at the top
  of their screen.
- Fix: keep the honest OOC signal (its existence is correct and intentional) but split the message:
  a player-facing generic line ("Production hit a technical snag — retrying.") always, and the raw
  `tool`/`error` detail gated behind `window._isAdmin` (already used elsewhere, e.g. game-trim.css's
  `body[data-game-build].is-admin #model-select`) or surfaced only via `window.OrwellReport`.

[FRONTEND-DEEP-6] [Severity: Major] [Effort: <1day] [Value: Med]
The player-facing tool-beat map carries labels for admin/God-Mode-only tools (cross-territory)
- Where: frontend/static/js/orwellToolBeats.js:52-67 (`overrideMechanic`, `configureGame`,
  `manageSandbox`, `sandboxHealth`, `manage_settings`, `manage_endpoints`, `manage_tokens`,
  `manage_mcp` all map to a visible "🎛 Control room" chip) — this module is imported by BOTH
  player-facing render paths (chat.js live stream, chatRenderer.js history reload). Cross-referenced
  against frontend/src/tool_security.py: `owner_is_admin_or_single_user()` returns True (i.e. NO
  tools are blocked via `blocked_tools_for_owner`) whenever `not auth.is_configured` — the default
  state of a fresh single-user deployment, which per CLAUDE.md ("one active game per user") is a
  primary target shape for this product.
- Problem: none of these tools are supposed to be reachable from the player channel (registry.ts
  marks them `channel: "admin/God Mode"`), but the FE's OWN player-facing beat map anticipates them
  showing up there, and the backend gate that is supposed to stop it is a denylist that goes empty on
  an unconfigured/single-user deployment. If the underlying agent ever calls one of these tools during
  ordinary play on such a deployment, the player would see a "Control room" chip mid-scene — itself an
  immersion break (it announces an admin-only operation fired), on top of whatever state mutation the
  call performed. `manage_settings` in particular is a REAL, mutating capability ("change ANY real app
  setting... turn tools on/off") and is conspicuously absent from `_ADMIN_SCHEMA_NAMES`
  (agent_loop.py:554-561) even though it IS listed in the separate `_ADMIN_TOOLS` set (agent_loop.py
  :1088-1093) — two overlapping-but-not-identical admin-tool sets is itself a drift risk (FEDEEP-19).
- Fix: (backend, flagged for the engine/security lane) make `blocked_tools_for_owner` fail CLOSED for
  admin-only tools regardless of `auth.is_configured` when `game_build_enabled()` is true — a
  single-player game build should never treat "no auth configured" as "everything is admin". FE-side:
  since `orwellToolBeats.js` is shared code, consider asserting (a unit test) that no `channel:
  "admin/God Mode"` tool name ever appears outside `ORWELL_SILENT_BEATS`, so a future admin tool added
  to the beat map trips a test instead of silently rendering a visible chip.

[FRONTEND-DEEP-7] [Severity: Major] [Effort: <1day] [Value: Med]
z-index has no design tokens — 238 raw hardcoded values from 60 to 1,000,000
- Where: frontend/static/style.css (whole file); contrast with css/responsive-tokens.css, which DOES
  tokenize breakpoints (`--bp-*`), type scale (`--fs-*`), spacing (`--space-*`), and the tap-target
  floor (`--tap-min`) with an enforced lint gate (tests/test_s_responsive_mechanism.py).
- Problem: `grep -c "z-index:\s*[0-9]" style.css` → 238; `grep -c "z-index:\s*var("` → 0. The values
  themselves span 60, 80, 100...300, then jump to 500, 1000, 1200, 9000, 9998-10010, 12000, 99999,
  100002, and finally 1000000 — the classic z-index escalation antipattern (each new "must be on top
  of everything" requirement bumps the ceiling instead of being assigned a layer). Given the app
  composes an OrwellWindow kit, a notice/decision stacking zone, sheets, modals, dropdowns, and a
  gadget rail simultaneously, an undocumented, un-tokenized stacking order is a standing risk that a
  future addition silently sits under (or fights) an existing surface — exactly the class of bug that
  is invisible in isolated review and only shows up when two specific features are open at once.
- Fix: define a `--z-*` scale (e.g. base/dropdown/sticky/modal/notice/toast/critical) in
  responsive-tokens.css alongside the existing tokens, and migrate the highest-traffic surfaces
  (decision card, notice kit, window kit, modals) onto it first; add the same category of lint the
  breakpoint gate already provides.

[FRONTEND-DEEP-8] [Severity: Minor] [Effort: <1day] [Value: Med]
Spacing scale is defined but essentially unused (929 hardcoded pixel values vs 6 token uses)
- Where: css/responsive-tokens.css defines `--space-1` through `--space-6`; frontend/static/style.css
  uses literal pixel padding 929 times and `var(--space-*)` padding only 6 times (margin: 126 literal
  vs 4 tokenized).
- Problem: the codebase clearly has the discipline to build a spacing scale (it did, carefully, with
  a comment contract) but essentially never adopted it in the 41k-line stylesheet that does the actual
  layout work. This is the same "tokens exist, CSS bypasses them" pattern as FEDEEP-7, just for
  spacing instead of z-index — together they show the design system's token layer and its primary
  consumer have drifted apart, which is exactly the "hardcoded value that should be a token"
  instruction in the charter, evidenced at scale rather than as one-off nitpicks.
- Fix: not a full migration ask before ship, but flag it as tech debt and start enforcing token use
  for any NEW rule added post-audit (a lint rule banning literal `px` in `padding`/`margin` outside a
  small allowlist would catch regressions cheaply).

[FRONTEND-DEEP-9] [Severity: Minor] [Effort: multi-day] [Value: Low]
`!important` overuse — 1,665 occurrences in one stylesheet
- Where: frontend/static/style.css (41,195 lines).
- Problem: ~4% of all lines in the main stylesheet carry `!important`. Some are legitimate
  (documented "beats an inline style JS restores" cases, e.g. L628-633), but at this volume it signals
  a long-running specificity war rather than isolated overrides — every new `!important` added to win
  against an existing one compounds the problem, and it makes future CSS changes (e.g. a z-index/
  spacing token migration, FEDEEP-7/8) materially riskier because so many rules already assume they
  win by force rather than by cascade position.
- Fix: not a pre-ship fix (multi-day, high regression risk to attempt blind). Flag for a dedicated
  CSS-debt pass; in the meantime, require any NEW `!important` in review to carry the same kind of
  inline justification comment the codebase already uses in its best examples.

[FRONTEND-DEEP-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
Un-throttled whole-document MutationObserver forces layout reads on every DOM mutation
- Where: frontend/static/js/orwellScrollBottom.js, `watchDecisionCard()` (L215-222) and the
  `reposition()`/`decisionCardVisible()` functions it triggers via `update()` (each calls
  `getBoundingClientRect()`, forcing a synchronous layout).
- Problem: `mo.observe(document.body, { childList: true, subtree: true })` fires `update()` on EVERY
  DOM mutation anywhere on the page with no debounce. During a streaming reply, chat.js/chatRenderer.js
  append/mutate the DOM many times per second (token-by-token or chunk-by-chunk rendering) — each
  mutation now triggers a forced layout read via `getBoundingClientRect()` in both `reposition()` and
  `decisionCardVisible()`. This is layout-thrash-during-streaming, the exact perf pattern mobile
  Safari/low-end Android struggle with, and it is avoidable: the same file's SIBLING problem
  (`watchNewMessages`, L195-209) observes a SCOPED container (`#chat-history`) instead of the whole
  body, and platform.js's own `orwellGameChanged` dispatcher (the codebase's own precedent for "many
  things can fire this, coalesce them") debounces at ~250ms. This observer has neither scoping nor
  debouncing.
- Fix: debounce `update()` inside `watchDecisionCard`'s observer callback (a trailing ~100-150ms
  timer, matching the file's own click-to-scroll animation timings), or narrow the observed subtree
  to the region the decision card can actually mount into (the notice-kit anchor zone) instead of
  `document.body`.

[FRONTEND-DEEP-11] [Severity: Polish] [Effort: <1hr] [Value: Low]
Native `window.confirm`/`alert` fallback would break immersion on two high-stakes actions
- Where: frontend/static/js/settings.js:1880 (hide the Settings cog) and :2414 (season reset), both
  `... : window.confirm(...)` fallbacks for when `window.styledConfirm` is unavailable.
- Problem: both are guarded fallbacks (the primary path uses the in-app `styledConfirm` dialog), so
  the practical exposure is low — but if `styledConfirm` is ever undefined at the moment these fire
  (a load-order regression, a script error upstream), the player sees a bare OS-chrome confirm() box
  mid-immersive-game for an IRREVERSIBLE action ("Reset this season? This cannot be undone."), which
  is about as hard an I9 break as exists, and the fallback text is a shortened, less-informative
  version of the primary dialog's copy ("Reset this season? This cannot be undone." vs. the full
  "...wipes your current game and restarts it from casting...").
- Fix: low-cost belt-and-suspenders — assert `window.styledConfirm` is truthy at module init (a
  console.error / OrwellReport.fail if not, so a load-order regression is caught in testing before it
  reaches a real player), and keep the fallback text byte-identical to the primary dialog's.

[FRONTEND-DEEP-12] [Severity: Minor] [Effort: <1hr] [Value: Low]
Orphaned legacy rename dropdown/modal duplicates a second implementation, and the dead one leaks a raw model id
- Where: frontend/static/index.html:998-1002 (`#session-actions-dropdown` / `#rename-session-option`)
  and :1475-1492 (`#rename-session-modal`); frontend/static/app.js:1545-1600 (`renameSessionModal`'s
  save handler) vs. the ACTUALLY-wired implementation at app.js:342-393 (`_renameCurrentConversation`,
  used by `#topbar-rename-btn`, a click on `#current-meta`, and `#export-rename-btn` per its own
  comment at L339-341) and sessions.js:485-497 (the real per-session dropdown's `renameItem`).
- Problem: `#rename-session-option` has ZERO click handlers anywhere in the codebase (confirmed via
  a full-codebase grep) — clicking it, if it were ever shown, would do nothing. `#rename-session-modal`
  is likewise never opened by any code path found. Both appear to be legacy markup superseded by the
  two implementations that ARE wired. This is dead code/a dead-end control exactly per the charter's
  ask — but it's also LATENT RISK: the dead modal's save handler (app.js:1590) sets
  `el('current-meta').textContent = \`Session: ${meta.name}${meta.model ? ' ' + meta.model.split('/')
  .pop() : ''}${meta.rag ? ' [RAG]' : ''}${ver}\`` — literally "Session: <name> <raw-model-id> [RAG]
  vX.XX" — which would violate ruling E72 ("players never see raw model ids") the moment anyone
  reactivates this path (e.g. by wiring `#rename-session-option`'s click handler, which looks like an
  easy, plausible future fix for the dead menu item).
- Fix: delete the orphaned `#session-actions-dropdown`/`#rename-session-option`/`#rename-session-modal`
  markup and its associated app.js handlers (L1545-1600) entirely — the safe, wired implementation
  already covers every legitimate entry point.

[FRONTEND-DEEP-13] [Severity: Polish] [Effort: <1hr] [Value: Low]
"Sensitive Blur" workspace-legacy privacy setting kept in the game build with out-of-voice copy
- Where: frontend/static/index.html:2031-2032 ("Sensitive Blur — Blur emails, tokens, and secrets in
  AI output"); frontend/static/js/censor.js (the feature itself); css/game-trim.css's own comment
  explicitly says this toggle is KEPT deliberately, alongside Theme/Welcome Message/Text-only
  Emojis/Thinking Process.
- Problem: the hint text says "in AI output" — a direct, unambiguous naming of the underlying LLM
  ("AI") in player-visible Settings copy, which is out of voice for an immersive Big Brother season
  (I9 is about "anything the player sees", and a settings modal is still player-visible even though
  it's OOC chrome). The feature's actual purpose (blurring credential-shaped strings — API keys, JWTs,
  emails) also has essentially no legitimate use case in a fictional game narration that will never
  produce real secrets, so the toggle is functional-but-purposeless clutter in addition to being
  off-voice.
- Fix: at minimum reword the hint to avoid "AI" ("Blur emails, tokens, and secrets in game text"); the
  cheaper long-term answer is to drop the toggle from the game build's kept-set entirely, since the
  game's own narration is never going to legitimately produce a credential.

[FRONTEND-DEEP-14] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Thinking Process" settings hint shows the player raw `<think>` tag markup
- Where: frontend/static/index.html:2026 ("Thinking Process — Show &lt;think&gt; collapsible bars").
- Problem: the hint text renders the literal HTML/XML tag syntax `<think>` to the player in a Settings
  panel copy string. Even granting that this toggle itself is a legitimate, deliberately-kept control
  (per the game-trim.css comment), spelling out the raw tag name is unnecessary developer-facing
  vocabulary bleeding into player-visible copy — a small I9 miss in the same family as FEDEEP-13.
- Fix: reword to "Show the model's reasoning in a collapsible panel" or similar — describe the
  behavior, not the underlying markup.

[FRONTEND-DEEP-15] [Severity: Polish] [Effort: <1hr] [Value: Low]
`esc()` is reimplemented 12 times; one copy silently diverges from the other 11
- Where: frontend/static/js/orwellCastPin.js:136, orwellPresence.js:157, ui.js:686 (the canonical,
  exported version), orwellSheet.js:55, orwellStatusPanel.js:455, orwellGadget.js:141,
  orwellDecision.js:62, orwellNotice.js:131, orwellNightStatus.js:76, settings.js:28 and admin.js:17
  (both correctly delegate to `uiModule.esc`), and orwellHeadshot.js:179 (the outlier).
- Problem: 9 of the 12 copies are byte-for-byte identical (`/[&<>"']/g` with a null/undefined guard,
  including `'` → `&#39;`). orwellHeadshot.js's copy is `String(s).replace(/[&<>"]/g, ...)` — it
  drops the `'` → `&#39;` mapping entirely AND has no `s == null` guard (so `esc(null)` renders the
  string `"null"` instead of an empty string, unlike every other copy). None of orwellHeadshot.js's
  current call sites happen to interpolate into a single-quoted attribute, so this isn't exploitable
  today, but it is exactly the kind of copy-paste drift that turns into a real gap the next time
  someone edits that file's markup without noticing the local `esc` is weaker than the one everybody
  else uses.
- Fix: delete all 12 local copies and import `esc` from ui.js everywhere (it's already exported and
  two files already do this correctly) — a pure DRY fix with no behavior change for 11 of the 12
  sites, and a real bug fix for the 12th.

[FRONTEND-DEEP-16] [Severity: Minor] [Effort: multi-day] [Value: Low]
Several 5,800-6,300-line "god files" make the game-build audit surface hard to verify by inspection
- Where: settings.js (5,796 lines), slashCommands.js (6,257 lines), chat.js (6,244 lines),
  admin.js (3,100 lines) — four of the largest files in the directory, together ~21,400 lines.
- Problem: CLAUDE.md's own mandate is explicit that "a player-facing or admin path isn't done until a
  test proves it returns no Vault data" and that game-trim.css is a "safe, reversible first cut" whose
  comment invites "a deeper code-level prune is a separate pass, to be verified against a running
  instance." Files this large — mixing kept game-build logic with large amounts of CSS-hidden-but-
  still-shipped dropped-vertical logic (settings tabs for tools that are gone, slash commands that are
  refused at dispatch, etc.) — make that verification pass materially harder to do by code review; a
  reviewer has to hold a huge amount of context to be confident a given code path is truly unreachable
  under `ORWELL_GAME_BUILD=1` versus merely CSS-hidden. This is a process/maintainability risk more
  than a functional bug, but it's a direct contributor to why prior review passes under-hunted this
  exact directory.
- Fix: not a pre-ship refactor ask (multi-day, high regression risk under a 14-day deadline) — flagged
  as a structural risk factor worth naming for the post-ship roadmap (the same "deeper code-level
  prune" the game-trim.css comment already calls for).

[FRONTEND-DEEP-17] [Severity: Polish] [Effort: <1hr] [Value: Low]
Dead feature path still ships a raw `alert()` with an exception message
- Where: frontend/static/js/chatRenderer.js:1002-1010, the "Chat about this" follow-up button for
  `/api/research/spinoff/...`.
- Problem: this button belongs to the Deep Research vertical, which is dropped under the game build
  (research.js is in GAME_DROP_SCRIPTS, `#rail-research`/`#tool-research-btn` are hidden by
  game-trim.css), so in practice this code path is very unlikely to fire for a player. But it is still
  shipped, still reachable if `uiModule.showError` is ever undefined, and if it ever fires it puts a
  bare browser `alert()` with a raw `e.message` string in front of the player — the same class of
  immersion break as FEDEEP-11, just in dead-er code.
- Fix: low priority given the feature is otherwise inert under the game build; either delete the
  button's dead-vertical code path entirely (matching the "physically deleted" treatment other
  dropped verticals already received) or at minimum drop the bare `alert()` fallback.

[FRONTEND-DEEP-18] [Severity: Polish] [Effort: <1hr] [Value: Low]
"Sensitive Blur" can visually mangle in-fiction narration if a player ever enables it
- Where: frontend/static/js/censor.js, `_contextCensor()` (L215-302) and the tabular/label-value
  PATTERNS (L49-55).
- Problem: distinct from FEDEEP-13 (which is about the setting's existence/copy) — this is about what
  happens to actual gameplay text if the setting IS turned on. The patterns are reasonably conservative
  (they require a "label\s*[:=]\s*value" or "label" + 2+ spaces + value shape), so ordinary prose
  mentioning "secret" or "password" in a sentence is safe — but any narration that renders a clue,
  code, or twist in a label:value-shaped line (e.g. a producer-note format like "Veto code: 7 4 2" —
  plausible for an in-fiction competition clue) would be wrapped in a `.censored-item` click-to-reveal
  span INSIDE the chat bubble, adding workspace-styled "click to reveal credential" chrome into what
  should be pure in-fiction text.
- Fix: given FEDEEP-13's recommendation to drop the feature from the game build's kept-set, this
  finding becomes moot; short of that, add an exclusion for message bubbles rendered by the game's own
  narrator role (the same way `.setup-guide-no-censor` is already excluded at L152/159/220/309/337).

[FRONTEND-DEEP-19] [Severity: Minor] [Effort: <1hr] [Value: Low]
Two overlapping-but-not-identical "admin tool" sets are a drift risk (cross-territory, backend)
- Where: frontend/src/agent_loop.py — `_ADMIN_SCHEMA_NAMES` (L554-561) and `_ADMIN_TOOLS` (L1088-1093)
  overlap heavily but are not the same set: `manage_settings` and `manage_documents` are only in
  `_ADMIN_TOOLS`; `search_chats` and the four God-Mode tool names
  (`inspectNonVaultState`/`overrideMechanic`/`configureGame`/`manageSandbox`) are only in
  `_ADMIN_SCHEMA_NAMES`.
- Problem: two hand-maintained lists gating the same conceptual boundary ("does the player-facing
  model get this tool schema") will drift the moment one is updated and the other is forgotten — this
  is the direct backend counterpart to FEDEEP-6's FE-side symptom (the beat map assumes any of these
  tools COULD reach the player-facing renderer).
- Fix: (backend/security lane) unify into one canonical admin-tool set consumed by both call sites, or
  add a unit test asserting the two sets are equal (or that one is a documented superset of the other)
  so a future edit to either trips a test instead of silently widening the player-facing schema.

[FRONTEND-DEEP-20] [Severity: Polish] [Effort: <1hr] [Value: Low]
Composer-draft privacy gate only covers "refresh while still in DR mode", not FEDEEP-1's gap
- Where: frontend/static/js/orwellComposerDraft.js (header comment, L1-25) vs.
  frontend/static/js/orwellDiaryRoom.js `exitDRMode()`.
- Problem: orwellComposerDraft.js's own documentation states its F5 privacy gate exists specifically
  because "a restored confessional sitting in a house-bound composer would be sendable to the house —
  the exact leak the Diary Room's 'no in-game pathway to any NPC' contract forbids," and it solves
  that for the REFRESH case by re-entering DR mode before restoring text IF the saved record has
  `drMode: true`. But `exitDRMode()` sets `drMode = false` (and fires `orwell:drmode` with
  `active:false`) the instant the player cancels — before the draft-save debounce (250ms) even fires —
  so the persisted record for a cancelled-but-unsent confessional has `drMode: false` by the time it's
  written. A refresh after cancelling (not just a bare Enter, per FEDEEP-1) restores the confessional
  text into a house-bound composer with no re-arm, which is precisely the scenario this module's own
  comment says must never happen.
- Fix: same root fix as FEDEEP-1 (clear `box.value` on cancel) closes this too; alternatively,
  orwellComposerDraft.js could treat "was in DR mode very recently" as still DR-sensitive rather than
  keying purely off the live `drMode` flag at save time.
```

---

## Coverage notes

**Read closely (full or near-full file read):** orwellDiaryRoom.js, orwellComposerDraft.js (header +
key sections), orwellScrollBottom.js, faviconEye.js, platform.js, orwellToolBeats.js,
orwellEngineStatus.js, censor.js, orwellHeadshot.js (targeted sections), markdown.js (scrub-pipeline
sections, ~L150-760), sessionSync.js.

**Grepped-then-narrowed:** chat.js (raw/dataset.raw, gamechanged dispatch, TTS wiring, alert/confirm),
chatRenderer.js (copy-to-clipboard, cost badge, alert path), settings.js (UI-visibility wiring,
confirm/alert, privacy toggle wiring), app.js (UI_VIS_MAP, rename implementations x2), sessions.js
(session dropdown), slashCommands.js (game-build gating, Math.random easter eggs), slashAutocomplete.js
(gating parity), admin.js (game-build gating — found none, flagged as part of FEDEEP-16), modelPicker.js
(reachability under game-build CSS gating), orwellGadgetRail.js, orwellNotice.js, orwellOnboarding.js,
orwellSeasonProgress.js, orwellFinale.js, windowDrag.js/windowResize.js (listener pairing — clean, no
finding), tts-ai.js, theme.js (spot-checked for Math.random/token usage only).

**Sampled with narrow greps, no deep read (lower confidence there are no further findings):**
adaptiveGlass.js, liquidGlass.js, group.js, modalManager.js, modalSnap.js, presets.js, providers.js,
emojiPicker.js, emojiShortcodes.js, colorPicker.js, dragSort.js, codeRunner.js, fileHandler.js,
keyboard-shortcuts.js, langIcons.js, login_bg.js, orwellAvatar.js, orwellCast.js, orwellCastPin.js,
orwellDeals.js, orwellElements.js, orwellFinalizing.js, orwellLayoutSync.js, orwellNewSeason.js,
orwellNightStatus.js, orwellOocAside.js, orwellPremiereTutorial.js, orwellPresence.js, orwellReport.js,
orwellRetrospective.js, orwellScrollbars.js, orwellSlots.js, orwellStatusPanel.js, search-chat.js,
section-management.js, sidebar-layout.js, signinTransition.js, spinner.js, storage.js,
streamingRenderer.js, streamingSegmenter.js, tileManager.js, tourAutoplay.js, tourHints.js,
voiceRecorder.js, workspace.js, planWindow.js, models.js, modelSort.js, color/hex.js, model/matchKey.js,
markdown/tableRow.js, util/ordinal.js.

**CSS:** style.css — grepped extensively (z-index, `!important`, hardcoded hex vs `var()`, spacing,
`:hover`/`:focus-visible` ratio, touch-target floor) but never read end-to-end per the charter's
instruction; css/game-trim.css read in full; css/responsive-tokens.css read in full;
css/orwellHouseThemes.css, css/eyeBlink.css, css/meshGradient.css glanced (no findings — small, focused
files).

**index.html:** read in targeted sections (Settings > Appearance visibility toggles ~L1960-2055,
the session-actions dropdown ~L995-1010, the rename modal ~L1475-1495, script-tag manifest ~L2630-2680,
game-build attribute wiring). Not read end-to-end (2,685 lines; the settings-tab bodies and the bulk of
the modal markup were only grepped for specific ids).

**Not covered / lower confidence:** a full pass of admin.js's 166KB body (only grepped for game-build
gating and addEventListener counts — FEDEEP-16 flags the file's size as a risk rather than certifying
its contents clean); a full pass of theme.js (144KB, only spot-checked); slashCommands.js's ~20 command
implementations were not each individually read (only the game-build gating mechanism and the
Math.random-based easter eggs were verified). "Ran out of real issues" is NOT claimed — these three
areas in particular warrant a follow-up pass if agent time allows.

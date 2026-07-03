# MICROCOPY / STRING LANE — Orwell exhaustive pre-ship audit

Territory: every player-visible string in the front-end (buttons, headings, placeholders,
tooltips, empty states, error/toast copy, onboarding/casting copy, decision-card prompts,
gadget labels, settings labels, confirmations, reconnect/degraded text, aria-labels) plus the
engine-authored `MOMENT_PROMPTS` (checked; those are LLM system-prompt text, not literal
player-visible strings, so no findings filed against them directly).

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| MICRO-1 | Blocker | <1hr | High | Raw `[Error: …]` injected into the GM's message body | frontend/static/js/chat.js:3058-3069 |
| MICRO-2 | Blocker | <1hr | High | Raw `Error: …` + "try switching to Chat mode" in-fiction | frontend/static/js/chat.js:3547-3562 |
| MICRO-3 | Major | <1hr | High | "Reached the N-step limit" / "Continue the task" leaks the agent loop | frontend/static/js/chat.js:2210-2242 |
| MICRO-4 | Major | <1hr | High | Composer placeholder says "Message Orwell..." all game | frontend/static/index.html:1241 |
| MICRO-5 | Minor | <1hr | Med | Model-picker shows "Select model" + a raw model id every turn (corroboration) | frontend/static/index.html:1244; frontend/static/js/modelPicker.js:824 |
| MICRO-6 | Major | <1day | High | "Choose Your Character" — video-game framing for the cast photo | frontend/static/js/orwellHeadshot.js:604,626-627,354,577,704,728 |
| MICRO-7 | Major | <1hr | High | "No image model is configured — the game plays on without portraits." | frontend/static/js/orwellCast.js:403 |
| MICRO-8 | Major | <1hr | High | "A generation run started recently…" — dev jargon in the roster panel | frontend/static/js/orwellCast.js:407 |
| MICRO-9 | Minor | <1hr | Med | "The portrait service is offline right now." / "The cast list is offline right now." | frontend/static/js/orwellCast.js:411,644,713 |
| MICRO-10 | Major | <1hr | High | "check the image model in Settings" — full machinery exposure mid-casting | frontend/static/js/orwellHeadshot.js:250 |
| MICRO-11 | Minor | <1hr | Med | "The photo service is offline right now." (×3) | frontend/static/js/orwellHeadshot.js:233,253,257,260,264,309 |
| MICRO-12 | Polish | <1hr | Med | Flat, voiceless terse-error family in the headshot studio | frontend/static/js/orwellHeadshot.js:229,271,278,308 |
| MICRO-13 | Minor | <1hr | Med | Dark-house holding card breaks its own voice mid-sentence | frontend/static/js/orwellOnboarding.js:424-426 |
| MICRO-14 | Minor | <1hr | Med | Engine-status banner titles say "engine"/"app"/"game service" | frontend/static/js/orwellEngineStatus.js:90,102,110,122 |
| MICRO-15 | Major | <1hr | High | Raw tool name + backend error string interpolated into a visible banner | frontend/static/js/orwellEngineStatus.js:109,115 |
| MICRO-16 | Major | <1day | High | Same outage voiced two different ways in two widgets | frontend/static/js/orwellStatusPanel.js:212 vs frontend/static/js/orwellEngineStatus.js:90-122 |
| MICRO-17 | Major | <1hr | High | The `((…))`/`ooc:` aside mechanic ships with ZERO discoverability copy | frontend/static/js/orwellChatHint.js:15,31-46 |
| MICRO-18 | Major | multi-day | High | Alliance mechanic has no player-facing surface at all | src/surfaces/tools/registry.ts:53-54; frontend/static/js/orwellToolBeats.js:31-32; frontend/static/js/orwellElements.js:206-210 |
| MICRO-19 | Minor | <1hr | Med | "The board moved… refreshing the latest state" — clinical 409 copy | frontend/static/js/orwellDecision.js:707 |
| MICRO-20 | Polish | <1hr | Med | HUD chrome mixes "Control Room" branding with bare "gadgets"/"floating window" | frontend/static/index.html:1459,1467; frontend/static/js/orwellCastPin.js:108-109; frontend/static/index.html:1753 |
| MICRO-21 | Minor | <1hr | Low | "Diary Room — private & out-of-character" exposes tabletop-RPG jargon | frontend/static/js/orwellDiaryRoom.js:38 |
| MICRO-22 | Polish | <1hr | Med | "No feed connected yet" title vs. "chat model"/"/setup" body — voice + term mismatch | frontend/static/js/orwellOnboarding.js:863-868 |
| MICRO-23 | Polish | <1hr | Low | "Auto-detect (Gemini)" names a commercial AI provider inside in-fiction casting setup | frontend/static/js/orwellOnboarding.js:324 |
| MICRO-24 | Polish | <1hr | Low | Credential-blur reveal tooltips ("api-key"/"credential"/"jwt") ungated by game build | frontend/static/js/censor.js:198 |
| MICRO-25 | Polish | <1hr | Low | "Generating N of M…" / "Requesting…" break the "photo booth" motif | frontend/static/js/orwellCast.js:392,577,582,585 |
| MICRO-26 | Polish | <1hr | Low | `web_search` and `list_models` render the identical beat "📡 Checking the feeds" | frontend/static/js/orwellToolBeats.js:57,63 |
| MICRO-27 | Minor | <1hr | Low | "Danger Zone" reset copy drops the video-game word "level" into BB framing | frontend/static/index.html:2122-2126 |
| MICRO-28 | Polish | <1hr | Low | "Portrait studio unavailable." — no next step, out of step with its sibling copy | frontend/static/js/orwellNewSeason.js:133 |
| MICRO-29 | Polish | <1hr | Low | orwellCastPin "Cast" and gadget-rail "Pinned Cast" are the only two gadgets whose titles don't match their gadget-rail tooltip pattern (minor naming drift) | frontend/static/js/orwellCastPin.js:106-109 vs frontend/static/js/orwellGadgetRail.js:48-49 |

---

## Findings

[MICRO-1] [Severity: Blocker] [Effort: <1hr] [Value: High]
Raw backend error string injected verbatim into the GM's own message bubble
- Where: `frontend/static/js/chat.js:3058-3069` — the generic `else if (json.error)` SSE branch: `errDiv.textContent = \`[Error: ${json.error}]\`;` appended straight into `roundHolder.querySelector('.body')`, with no `isGameBuild()` check.
- Problem: Violates I9 (machinery invisible) about as directly as possible — a transient provider hiccup (timeout, 5xx, rate limit) renders literally as `[Error: <raw provider text>]` inside what the player reads as Big Brother's own voice. The SAME file already has the correct fix for a sibling code path: `chat.js:1678-1693` gates on `isGameBuild()` and substitutes `"Big Brother cuts to a brief technical interlude… hang tight, we'll be right back."` for the raw message, with an explicit comment (`#872 item A`) that a raw error "reads to the player as a literal Big Brother / producer message." This second, identical failure mode was simply never given the same treatment.
- Fix: Route this branch through the same `isGameBuild() ? "Big Brother cuts to a brief technical interlude… hang tight, we'll be right back." : rawErrMsg` pattern already established at line 1690-1692 (factor it into one shared helper so the two call sites can't drift again).

[MICRO-2] [Severity: Blocker] [Effort: <1hr] [Value: High]
Stream-death handler prints `Error: <exception message>` plus a "switch to Chat mode" instruction directly in the AI's bubble
- Where: `frontend/static/js/chat.js:3547-3562` — the `else` branch after a stream dies unexpectedly and auto-recovery declines: `let errMsg = \`Error: ${err.message}\`;` then, if the message mentions "tool"/"auto", appends `'\n\nThis model may not support tools — try switching to Chat mode.'`, and types the whole thing into the narration body via `typewriterInto`.
- Problem: Two compounding leaks in one place — (a) a raw JS exception message (e.g. `Error: Stream closed before completion`) lands inside the fiction, and (b) the literal instruction "try switching to Chat mode" names a workspace mode-toggle that doesn't exist in the player's mental model of the game at all. This is the exact kind of string the mandate calls out by name ("raw errors," "no engine/tool/app/system talk in anything the player sees" — I9) and it is typewritten in, so it visually reads as deliberate narration, not a system aside.
- Fix: Gate with `isGameBuild()` the same way as MICRO-1's fix; in the game build, never append the tool/Chat-mode hint at all (there is no "Chat mode" to switch to in the player's world) — use the same in-fiction interlude line, or a variant ("...the feed cut out mid-scene — say that again and we'll pick it back up").

[MICRO-3] [Severity: Major] [Effort: <1hr] [Value: High]
"Reached the N-step limit — not finished." + button titled "Continue the task" surfaces the agent loop's tool-call budget directly in the chat
- Where: `frontend/static/js/chat.js:2210-2242` — the `rounds_exhausted` branch: `label.textContent = \`Reached the ${json.rounds || ''}-step limit — not finished.\`;` and `contBtn.title = 'Continue the task';`, appended to `#chat-history`. No `isGameBuild()` gate anywhere in this branch, even though the very same function gates a nearby fallback-model tooltip with `if (!isGameBuild())` one screen up (line 2192).
- Problem: This is CLAUDE.md's C1 contradiction made literal — the FE guardrail belts exist because the model under-calls its levers, and this is exactly the kind of heavy, tool-call-dense turn (a ceremony, a marquee scene) most likely to hit the step cap. When it does, the player sees "step limit," a workspace concept, mid-scene — precisely the moment I9 says must never break. It also risks landing right in the middle of the "empty-narration on marquee social turn" blocker already on the tracker, compounding it with a visible machinery banner.
- Fix: Gate the visible copy behind `isGameBuild()`: something like "Big Brother pauses the tape for a beat — pick up where we left off." for the label, and retitle the button "Keep going ▸" / title "Keep the scene going." (The hidden resend prompt sent on click, e.g. "You hit the step limit before finishing…", is already not shown to the player via `_hideUserBubble = true` — leave that as-is, only the visible label/button need the fix.)

[MICRO-4] [Severity: Major] [Effort: <1hr] [Value: High]
The composer placeholder reads "Message Orwell..." for the entire game
- Where: `frontend/static/index.html:1241` — `<textarea id="message" placeholder="Message Orwell..." data-default-placeholder="Message Orwell..." …>`. Confirmed by grep across every FE `.js` file that no game-build swap ever rewrites this placeholder (the only placeholder swap found, `GATE_REASON` in `orwellChatGate.js`, only fires pre-photo).
- Problem: "Orwell" is the app's own workspace/brand name — the one thing the player should never see named, since the fiction has no "Orwell." Every single turn of every game, the empty composer literally invites the player to "Message Orwell," which is a a direct, constant, unavoidable I9 break (worse than most one-off leaks because it's ambient, not an edge case).
- Fix: Swap the placeholder for game build to something in-voice and functional, e.g. `"Say something…"` or `"What do you do?"` — set via the same `data-game-build` attribute check other modules already use (`document.body.hasAttribute('data-game-build')`), applied once at boot alongside the other game-build DOM trims.

[MICRO-5] [Severity: Minor] [Effort: <1hr] [Value: Med] (corroborates a prior "model pill" finding with the exact literal strings)
The in-composer model picker shows "Select model" and then a raw model id every turn
- Where: `frontend/static/index.html:1244` (`<span id="model-picker-label">Select model</span>`); `frontend/static/js/modelPicker.js:824` (`const displayName = modelId ? modelId.split('/').pop() : 'Select model';`). Verified this control is NOT hidden by `data-game-build` in `static/css/game-trim.css` (only `#model-select`, a different, already-hidden element, is trimmed) — it is only conditionally hidden by a container-width media query at `static/style.css:2948` (`@container chatbar (max-width: 260px)`), unrelated to game build.
- Problem: The prior audit pass already flagged "workspace machinery visible (model pill)" as a known issue; this confirms the exact literal text a player sees on a normal-width viewport is not a generic pill but "Select model" and then a raw split-off model id (e.g., a literal string like `deepseek-v4-pro`), i.e. a naked provider/model identifier sitting in the chat input on every single turn.
- Fix: Same remediation as the prior finding, but concretely: hide `#model-picker-wrap` under `body[data-game-build]` in `game-trim.css` (mirroring the existing `#model-select` rule) rather than relying on the narrow-viewport media query as the only hiding mechanism.

[MICRO-6] [Severity: Major] [Effort: <1day] [Value: High]
"Choose Your Character" — the cast-photo CTA uses video-game character-select framing, not casting framing
- Where: `frontend/static/js/orwellHeadshot.js:604,626-627,354,577,704,728` — the button text (`btn.textContent = "Choose Your Character"`), its `aria-label` ("Choose your character — open your cast photo"), and the window/section title reused four more times through the flow. The module's own comment (line 604) calls this a "competition-style… pill," i.e. the author already recognized it as borrowed video-game furniture, not reality-TV language.
- Problem: The vision brief's opening line is "Casting interview that feels like being *cast*, not configured." "Choose Your Character" is the single most recognizable phrase from fighting-game/RPG character-select screens ("Choose Your Fighter"); it directly contradicts the fantasy at exactly the moment (getting your cast photo taken) the brief singles out as needing to feel like being cast, not like booting a game.
- Fix: Rename throughout to something in the producers'/casting voice — e.g. "Your Cast Photo" (which the finished-headshot window title, line 483, already uses — so the fix is also a consistency win) or "Face the Camera." Keep the aria-label in sync.

[MICRO-7] [Severity: Major] [Effort: <1hr] [Value: High]
"No image model is configured — the game plays on without portraits."
- Where: `frontend/static/js/orwellCast.js:403`
- Problem: "image model" is bare ML/workspace vocabulary sitting inside the Cast roster panel's own empty-state copy — a surface the player checks constantly to size up the house. "the game plays on" is also self-referential ("the game," not "the house"/"the season"), reminding the player they're looking at software rather than a show.
- Fix: "Portraits aren't rolling in yet — the house plays on without them." (drop "image model" and "the game" entirely; the fact being conveyed — no portraits will generate — doesn't require naming why to the player).

[MICRO-8] [Severity: Major] [Effort: <1hr] [Value: High]
"A generation run started recently — give it a few minutes, then try again."
- Where: `frontend/static/js/orwellCast.js:407`
- Problem: "generation run" is straight ML-pipeline/dev jargon (the kind of phrase that appears in a training log, not a reality show). This sits in the same backfill-note slot as MICRO-7, so the roster panel alone carries at least two separate machine-learning-jargon strings.
- Fix: "The studio's still developing everyone's photos — check back in a few minutes." (ties into the "photo booth"/studio motif already used elsewhere in the app, e.g. `orwellToolBeats.js`'s `generate_image → '📸 Photo booth'`).

[MICRO-9] [Severity: Minor] [Effort: <1hr] [Value: Med]
"The portrait service is offline right now." / "The cast list is offline right now."
- Where: `frontend/static/js/orwellCast.js:411,644,713`
- Problem: "service…offline" is ops/SRE language applied to two different things (an image generator and a roster fetch) that a player has no reason to think of as "services." Elsewhere the app has already solved this exact problem with a much better metaphor: "the feeds" (`orwellStatusPanel.js`: "Reconnecting to the feed…" / "feed offline"). This module didn't reuse it.
- Fix: "The photo booth's dark for the moment — try again shortly." / "Can't reach the house roster right now — try again shortly." (or reuse "the feeds" language directly: "The feed's down — try again shortly.")

[MICRO-10] [Severity: Major] [Effort: <1hr] [Value: High]
"Couldn't generate options — check the image model in Settings."
- Where: `frontend/static/js/orwellHeadshot.js:250`
- Problem: This is the single worst machinery leak found in the headshot flow — it doesn't just use a dev word, it actively instructs the player to go check "the image model in Settings," naming both the underlying ML concept and the workspace settings surface, during casting (the single most immersion-critical first-impression moment the vision brief calls out by name: "Casting interview that feels like being cast, not configured").
- Fix: "That shot didn't come out — try again in a moment." If the underlying cause is genuinely a missing/broken provider config and an admin action really is required, route that specific detail to the admin-only engine-status banner (which already has a "reach an admin" pathway) rather than putting it in front of the player mid-casting.

[MICRO-11] [Severity: Minor] [Effort: <1hr] [Value: Med]
"The photo service is offline right now." (repeated three times)
- Where: `frontend/static/js/orwellHeadshot.js:233,253,257,260,264,309`
- Problem: Same "…service is offline" pattern as MICRO-9, applied consistently within this file (at least it's internally consistent) but still ops/SRE language that never matches the in-voice copy used elsewhere in the same casting flow (e.g. "Add your cast photo to begin," "Producers are getting the house ready…").
- Fix: Standardize on one in-voice phrase across both files (this one and MICRO-9), e.g. "The photo booth's not answering right now — try again in a bit."

[MICRO-12] [Severity: Polish] [Effort: <1hr] [Value: Med]
Flat, voiceless terse-error family in the headshot studio
- Where: `frontend/static/js/orwellHeadshot.js:229` ("That image couldn't be used — try another."), `:271` ("Couldn't set that option — try again."), `:278` ("Removed."), `:308` ("Couldn't use that one — try again.")
- Problem: Four near-identical, interchangeable "couldn't X — try again" fragments plus a bare "Removed." with no object. None carry any of the producer/show voice established elsewhere in the same flow ("Skip for now," "Pick your favorite — or generate 3 more."). Individually harmless, but together they read like generic form-validation copy dropped into an otherwise carefully-voiced casting sequence.
- Fix: Consolidate into one small, in-voice error vocabulary for this studio, e.g. "That shot didn't take — try another," "That headshot's gone," "Couldn't lock that one in — try again."

[MICRO-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
The dark-house holding card breaks its own voice mid-sentence
- Where: `frontend/static/js/orwellOnboarding.js:424-426` — `mountHolding("The house is dark", "Big Brother will return. The game engine isn't reachable right now — this screen will clear the moment the feeds come back.", …)`
- Problem: The message opens and closes in perfect in-fiction voice ("The house is dark," "Big Brother will return," "the feeds come back") but the middle clause — "The game engine isn't reachable right now" — names the literal backend component by its dev name, right between two sentences that are otherwise doing the voice correctly. It reads like two different authors wrote the same sentence.
- Fix: Drop the middle clause entirely or replace it in-voice: "Big Brother will return. The live feeds are down for a moment — this screen will clear the instant they're back."

[MICRO-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
Engine-status banner titles say "engine"/"app"/"game service"
- Where: `frontend/static/js/orwellEngineStatus.js:90` ("showHolding" wraps "Production is building the house…" — fine), but the down-path at `:102,110,122`: `"Big Brother engine unavailable."` (title, used twice) and `"The app couldn't reach the game service."` / `"The app couldn't reach the game service. The show can't load until it's back."`
- Problem: The SAME module gets the reconnecting/holding cases exactly right in voice ("Reconnecting to Big Brother…", "The live feeds blinked — restoring the connection.") but the hard-down case reverts to bare machinery words: "engine," "app," "game service." A player who hits the hard-down state (arguably the scariest, most confusing moment — the show appears to have stopped) gets the single worst-voiced string in the whole banner family.
- Fix: "Big Brother is off the air." / "We've lost the feed — the show can't come back on until we do." Keep the same severity/urgency, drop every bare noun.

[MICRO-15] [Severity: Major] [Effort: <1hr] [Value: High]
Raw tool name + backend error text interpolated directly into a visible, non-dismissible banner
- Where: `frontend/static/js/orwellEngineStatus.js:109` — `const reason = (d && d.error ? "Reason: " + d.error + " " : "") + …` — and `:115` — `show("degraded", "Big Brother engine reported a problem.", (le.tool ? le.tool + ": " : "") + le.error);`
- Problem: Line 115 is the sharpest finding in this lane: whenever the engine's `lastError` carries a failed tool call, the banner body literally becomes `"<toolName>: <raw error text>"` — e.g. `"recordInteraction: <exception message>"` or `"advanceGame: <exception message>"`. That is an internal engine tool name and a raw backend error string, both landing directly in a top-of-viewport, always-visible banner with no in-fiction translation at all. Line 109 does the same thing for the plain unreachable-engine case (`"Reason: <raw d.error> "`). This banner is explicitly NOT dismissible by design (comment: "an honest outage signal"), so once triggered this text sits on screen until the condition clears.
- Fix: Never surface `le.tool` or the raw `.error`/`.message` text to the player. Show only a severity + a generic in-voice line ("Big Brother's having a technical moment — hang tight."); route the tool name + raw error to the existing admin-only `/admin/status` surface (which the codebase already treats as the correct home for this detail per the G11 failure-ring pattern in `orwellReport.js`).

[MICRO-16] [Severity: Major] [Effort: <1day] [Value: High]
The exact same "engine unreachable" condition is voiced two completely different ways depending on which widget is on screen
- Where: `frontend/static/js/orwellStatusPanel.js:212` ("Reconnecting to the feed…" / "feed offline" — good, in-voice, consistent with the "live feeds" motif) vs. `frontend/static/js/orwellEngineStatus.js:90-122` (see MICRO-14/15 — "engine unavailable," "the app," raw tool/error text)
- Problem: These two widgets can be on screen simultaneously (the House Status gadget and the top banner) and both react to the same underlying outage. One reads as a polished, in-fiction touch; the other reads as a raw dev console. A player who has the status gadget open sees a small, calm "feed offline" tag; if they then look at the top banner for the same outage, they see "Big Brother engine unavailable" and possibly a raw tool/error string. The quality gap between two simultaneous views of the same fact is jarring and breaks the sense of a single, coherent production voice.
- Fix: Extract one shared "outage copy" module/constant (title + body per severity) and have both `orwellStatusPanel.js` and `orwellEngineStatus.js` consume it, so an outage always reads identically no matter which surface the player is looking at.

[MICRO-17] [Severity: Major] [Effort: <1hr] [Value: High]
The `((double parens))` / `ooc:` out-of-character aside — a fully-engineered core mechanic — ships with zero discoverability copy
- Where: `frontend/static/js/orwellChatHint.js:15` ("SHIPPED WITH ZERO ACTIVE TIPS. The system exists and is wired, but the tip REGISTRY below is intentionally empty, so nothing renders by default.") and `:31-46` (the `TIPS = {}` registry, with the OOC tip fully written out but commented out: `'Tip: wrap a message in <code>((double parens))</code> or start it with <code>ooc:</code> to speak to the producers out of character — the house won't hear it.'`)
- Problem: The three-channel model (in-character / out-of-character / player-level) is a first-class, heavily-engineered design (an engine-side pin in the GM prompt, a dedicated FE detector `orwellOocAside.js`, distinct bubble styling in `chatRenderer.js`, a whole comment block explaining "the house does not hear it"). Despite all that investment, a first-time player has NO way to discover this exists — no onboarding step mentions it, no chat-bar hint shows it (the file's own comment says the OLD one-time tip that used to teach it was removed and never replaced), and it isn't in the premiere tutorial (`orwellPremiereTutorial.js`) either. A player who never stumbles onto `((…))` by accident never learns they can ask "what are my options" without it landing in the fiction.
- Fix: Uncomment the pre-written tip entry in `TIPS` (it's a 3-line change, already correctly written and ready to register) and fire it once, e.g. attached to the first premiere beat or the first time the composer gets focus in a live game.

[MICRO-18] [Severity: Major] [Effort: multi-day] [Value: High]
The alliance mechanic (0107) has no player-facing surface at all — no gadget, no decision card, nothing but a chat-only tool-beat chip
- Where: `src/surfaces/tools/registry.ts:53-54` (`formAlliance`, `joinAlliance` — both live, wired `channel:"player"` tools, not stubs — confirmed dispatched in `src/adapters/mcp/McpServer.ts:118-123,319-322`); `frontend/static/js/orwellToolBeats.js:31-32` (`'formAlliance': '👥 Naming an alliance'`, `'joinAlliance': '👥 Joining an alliance'`); the only "Alliances" UI anywhere in the codebase is the demo-only mock in `frontend/static/js/orwellElements.js:206-210` (`title: "Alliances"`, body `"No confirmed alliances yet."`), explicitly marked "NOT shipped in the app" at the top of that file. `frontend/static/js/orwellDecision.js`'s `KIND_TITLE` map has no `form-alliance`/`join-alliance` entry, and `gameStatus.alliancePitches` (referenced in the tool's own description as the source of pending pitches) is never read anywhere in `frontend/static/js/*.js`.
- Problem: Alliances are one of Big Brother's most iconic mechanics, and the engine genuinely supports naming one, banking favor, and accepting a live pitch — but the player has no way to see a pending alliance pitch, no way to know who's in their alliance, and no gadget mirroring the pattern already established for Deals (`orwellDeals.js`, a very similar promise-tracking mechanic that DOES have a dedicated panel). The only text describing what "Alliances" should look like lives in unshipped demo scaffolding.
- Fix: At minimum, surface `gameStatus.alliancePitches` as a decision-card kind (mirroring the existing `houseguests-choice`/`makeDeal` pattern) when an NPC pitch is live, and add an "Your Alliances" gadget to `orwellGadgetRail.js` mirroring `orwellDeals.js`'s structure (title/kind/status, Vault-free) so a formed alliance doesn't disappear into the chat scrollback the moment it's made.

[MICRO-19] [Severity: Minor] [Effort: <1hr] [Value: Med]
"The board moved since this card appeared — refreshing the latest state. Try again in a moment, or decide in conversation."
- Where: `frontend/static/js/orwellDecision.js:707` — the 409/stale-`beatSeq` recovery copy on a decision card
- Problem: "the board" isn't Big Brother vocabulary (it reads like poker/chess table-state language), and "refreshing the latest state" is literal engine/sync jargon ("state" is the exact word CLAUDE.md's own machinery-invisible checklist calls out). This sits right next to two much better-voiced siblings in the same function: "That move isn't legal right now — pick another, or decide in conversation." and "Connection problem — that didn't reach the house. Try again, or decide in conversation." — so the fix is really a consistency pass to match the surrounding lines.
- Fix: "Things moved fast in the house since this came up — here's what's current now. Try again, or just talk it through."

[MICRO-20] [Severity: Polish] [Effort: <1hr] [Value: Med]
HUD chrome mixes the "Control Room" brand with bare "gadgets"/"floating window" vocabulary
- Where: `frontend/static/index.html:1459` (`title="Rearrange gadgets"` / `aria-label="Rearrange gadgets"`), `:1467` (`aria-label="Control-room gadgets"`), `:1753` (settings toggle description: `a "Nightfall" gadget shows who's still up`); `frontend/static/js/orwellCastPin.js:108-109` (`title: "Open the full cast window"`, `title: "Un-pin back to a floating window"`)
- Problem: The rail container itself is nicely branded ("Control Room," "The House"), but the moment you touch one of its own controls (the rearrange button, the collapsed-strip aria-label, a settings description of the very same panel) the vocabulary drops straight to "gadgets" — a UI-kit noun with no in-fiction meaning — and cast-pin calls its own home a "floating window," pure window-manager language. It's the same surface described three different ways.
- Fix: Standardize on one term throughout ("panels," or lean into the "Control Room" branding: "your dials," "the boards") for every aria-label/title/settings-description that currently says "gadget" or "floating window."

[MICRO-21] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Diary Room — private & out-of-character" exposes tabletop-RPG jargon in a tooltip
- Where: `frontend/static/js/orwellDiaryRoom.js:38` — `title/aria-label: "Diary Room — private & out-of-character"`
- Problem: "out-of-character" is a term of art from tabletop/live-action roleplay communities, not something a typical Big Brother-familiar player will recognize on sight. It's technically accurate but jargon relative to the rest of the app's voice, which otherwise avoids naming the OOC concept directly (see MICRO-17 — the whole mechanic is meant to be taught experientially, not labeled).
- Fix: "Diary Room — just between you and the producers" (conveys the same privacy guarantee without the meta-term).

[MICRO-22] [Severity: Polish] [Effort: <1hr] [Value: Med]
"No feed connected yet" title vs. "No chat model is configured yet" body — the copy breaks its own metaphor one line later, and exposes a slash command
- Where: `frontend/static/js/orwellOnboarding.js:863-868` — `mountHolding("No feed connected yet", "No chat model is configured yet, so the house can't speak. " + (admin ? "Open Settings → Add Models (or type /setup) to connect one — casting begins the moment a feed is live." : "Ask your administrator to connect a model — casting begins the moment a feed is live."), …)`
- Problem: The title commits to the "feed" metaphor ("No feed connected yet") that the app uses well elsewhere, then the very next sentence abandons it for "chat model" (dev jargon) before returning to "feed" again at the end of the same sentence. It reads as if two different phrases got pasted together. The admin remedy also parenthetically surfaces a slash command (`/setup`), which is workspace UI leaking into copy aimed at whoever happens to hold admin rights on a self-hosted single-player instance.
- Fix: "No feed connected yet. The house can't speak until one is live. Open Settings → Add Models to connect one — casting begins the moment the feed is up." Drop the `/setup` mention (the "Open Settings" button already does the job) or move it to a genuinely admin-only surface.

[MICRO-23] [Severity: Polish] [Effort: <1hr] [Value: Low]
"Auto-detect (Gemini)" names a commercial AI provider by brand inside the in-fiction casting setup screen
- Where: `frontend/static/js/orwellOnboarding.js:324` — inside `mountSetup()`, titled "Big Brother production setup" / "Pick your season's models," the portrait-model summary falls back to `imgEl.textContent = image || "Auto-detect (Gemini)";`
- Problem: This screen otherwise frames model selection in show language ("the narrator and portrait models that will run your season," "the producers reach out the moment you're ready"), then drops a literal third-party brand name ("Gemini") into the middle of that framing. It's a necessary technical setup step (the player really is picking a real provider), but naming the brand isn't necessary to convey the default.
- Fix: "Auto-detect (studio default)" or just "Auto-detect" — the resolved model name already appears in Settings for anyone who wants the specific brand/model id; this summary line doesn't need to repeat it.

[MICRO-24] [Severity: Polish] [Effort: <1hr] [Value: Low]
Credential-blur reveal tooltips ("api-key"/"credential"/"jwt") are not gated by game build
- Where: `frontend/static/js/censor.js:198` — `span.title = 'Click to reveal ' + match.label;` where `match.label` is one of `'email' | 'api-key' | 'token' | 'credential' | 'private-key' | 'jwt'`
- Problem: This is a general-purpose workspace security feature (blur anything that looks like a secret) that runs unconditionally, including inside the game build and over narration text. It's a low-probability trigger (narration would need to accidentally produce a credential-shaped string), but if it ever fires mid-scene the tooltip that appears is "Click to reveal jwt" or "Click to reveal api-key" — dev/security jargon sitting directly on top of in-fiction prose.
- Fix: Either scope this module out of the game build entirely (there's no reason a Big Brother transcript should ever need credential-blurring) or, if kept as a defensive belt-and-suspenders measure, reword the reveal tooltip to something generic and voice-neutral ("Click to reveal") that doesn't name the detected category.

[MICRO-25] [Severity: Polish] [Effort: <1hr] [Value: Low]
"Generating N of M…" / "Requesting…" use bare progress-indicator language instead of the studio motif established elsewhere
- Where: `frontend/static/js/orwellCast.js:392` ("Requesting…"), `:577,582,585` ("Generating N of M…", "Generating ")
- Problem: The app has already built a nice "photo booth"/studio vocabulary for portrait generation (`orwellToolBeats.js:61`: `generate_image: '📸 Photo booth'`), but the cast roster's own progress labels use flat, generic verbs ("Requesting…", "Generating") that could belong to any image-generation tool anywhere, missing the chance to reinforce the same motif.
- Fix: "Developing your photos…" / "Developing N of M…" (ties to the photo-booth/darkroom framing and reads warmer than a bare progress percentage-style label).

[MICRO-26] [Severity: Polish] [Effort: <1hr] [Value: Low]
`web_search` and `list_models` render the exact same tool-beat label, "📡 Checking the feeds"
- Where: `frontend/static/js/orwellToolBeats.js:57` (`'web_search': '📡 Checking the feeds'`) and `:63` (`'list_models': '📡 Checking the feeds'`)
- Problem: Two functionally unrelated tool calls (an actual web search vs. probing which AI models are configured) collapse to an identical player-visible beat chip. If both fire within the same turn's beat rail, the player sees two indistinguishable "Checking the feeds" chips with no way to tell they were different actions — a small continuity/clarity smudge in an otherwise carefully curated beat table.
- Fix: Give `list_models` its own distinct label (e.g. "🎙 Production check") since it's a setup/administrative probe, not a research action, and arguably shouldn't be advertised as a diegetic beat at all in the game build.

[MICRO-27] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Danger Zone" reset copy drops the video-game word "level" into Big Brother framing
- Where: `frontend/static/index.html:2122-2126` — `<h2>Danger Zone</h2>` / `"Wipe this season and restart it from casting. Your season number stays the same — you restart the current level, you don't skip ahead. Irreversible."`
- Problem: "you restart the current level" borrows platformer/RPG vocabulary ("level") for what the rest of the sentence correctly calls a "season" — a small but avoidable inconsistency in an otherwise clear, well-written warning.
- Fix: "…you restart the current season, you don't skip ahead."

[MICRO-28] [Severity: Polish] [Effort: <1hr] [Value: Low]
"Portrait studio unavailable." has no next step and breaks from its own file's better-voiced siblings
- Where: `frontend/static/js/orwellNewSeason.js:133` — fallback when `OrwellHeadshotStudio` fails to mount: `studioHost.textContent = "Portrait studio unavailable.";`
- Problem: The same file gets error copy right elsewhere in the identical flow ("The house wouldn't open just yet — try again.", "The producers couldn't reach you — try again.", "The feeds wouldn't fast-forward to the finale — try again."), all of which give the player something to do. This one is a flat, dead-end fragment with no retry affordance and no in-fiction framing.
- Fix: "The photo booth's not answering right now — you can add a photo later from Settings."

[MICRO-29] [Severity: Polish] [Effort: <1hr] [Value: Low]
Minor title-consistency drift between the Cast gadget's own strip label and the gadget-rail's label for the same panel
- Where: `frontend/static/js/orwellCastPin.js:106` (`title: "Cast"`) vs. `frontend/static/js/orwellGadgetRail.js:48-49` (`'orwell-cast': 'The Cast'`, `'orwell-cast-pin': 'Pinned Cast'`)
- Problem: The full Cast window is titled "The Cast" from the rail but the same content pinned into the compact rail widget is titled just "Cast" internally (`orwellCastPin.js:106`) even though the rail's OWN label for that exact gadget is "Pinned Cast" — three slightly different names for what a player would reasonably assume is one feature (the cast roster). Low-stakes, but worth a consistency pass alongside the higher-value naming fixes above.
- Fix: Pick one canonical noun phrase ("The Cast") and reuse it verbatim in every title/tooltip/aria-label that refers to the roster panel, reserving "Pinned" only as a qualifier where the docked-vs-floating distinction genuinely matters.

---

## Coverage notes

Read/grepped: `frontend/static/index.html` (full grep pass for placeholder/aria-label/title +
targeted reads of the composer, gadget-rail, settings/danger-zone, and account sections);
every `frontend/static/js/orwell*.js` file (35 files) via full-file reads or targeted greps for
quoted string literals; `frontend/static/js/chat.js` and `chatRenderer.js` via targeted grep +
narrow reads around every error/exhaustion/truncation branch (per the charter's instruction not
to read `chat.js` end-to-end); `frontend/static/js/censor.js` (targeted read); `src/engine/momentPrompts.ts`
(read in full — these are LLM system-prompt text, not literal player-visible strings, so audited
for policy but not filed as microcopy findings); `src/surfaces/tools/registry.ts` and
`src/adapters/mcp/McpServer.ts` (grepped to confirm the alliance tools are live, not stubs) and
`src/ports/GameSession.ts` (grepped to confirm the decision-kind union has no un-covered title
gap in `orwellDecision.js`'s `KIND_TITLE` map — none found). Did NOT exhaustively read
`style.css` per the charter. Did not deep-audit the Settings modal's non-game-toggle rows
(RAG/personas/memories/etc.) since those are hidden under `data-game-build` per `game-trim.css`
and are out of scope for a shipped-game player.

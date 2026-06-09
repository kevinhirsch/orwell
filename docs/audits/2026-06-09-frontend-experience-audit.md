# Orwell front-end & experience audit — 2026-06-09

The experience-focused companion to `2026-06-09-product-audit.md` (which covered architecture,
wiring, game design, and the engine). Scope here: the **player-facing tier** — the first-run and
lifecycle journey, the moment-to-moment play surface and its information design, narration /
immersion / agent reliability, accessibility, mobile, visual craft, and performance. Conducted
as four parallel deep audits, synthesized and de-duplicated here.

Findings that overlap the prior audit's F1–F9 (or its queued items B/C34+) are cross-referenced
— each such entry states what it **adds**; everything else is NEW. Severities are from a
**player-experience** standpoint.

**What's genuinely good (verified):** the inherited base workspace is a mature, accessible,
responsive chat app — 44px tap targets, off-canvas mobile sidebar, 17 `prefers-reduced-motion`
blocks, container queries on the composer. The Diary-Room modal's "Private & out-of-character —
the house never hears this" framing is exactly right. The game-master prompt's AUTHORITY
paragraph is genuinely good anti-sycophancy direction. The onboarding overlay is correctly gated
on `started:false`. The problem, consistently, is that **the game layer inherited none of the
platform's craft and renders almost none of the engine's game.**

## The six systemic findings

1. **The journey has no shape.** There is no opening curtain (the game starts on **dead air** —
   an empty chat the player must prompt into existence), no re-entry beat on resume, no terminal
   state for winning/losing/eviction, and no player-facing way to start a new season. The three
   moments that turn "a chat with a Big Brother prompt" into "a season you live through" are all
   missing, for the same structural reason: narration only ever happens in reaction to a player
   keystroke.
2. **The decision interface is a void.** The engine returns a complete, Vault-free
   `PendingDecisionView` — prompt, legal options, pick count, appeal enums — and a staged
   `finaleView`, and the front-end **renders none of it**. Every binding choice is a prose guess
   with no option list, no pick enforcement, no confirmation, and no visual signal that a binding
   moment is even happening.
3. **The narrator is starved and contaminated.** The system prompt feeds the model **15 names
   and a status word** — while the engine already generates rich Vault-free public personas
   (archetype, strategy style, background, age, appearance, presentation, a ready-made
   `PortraitDescriptor.vibe`) that never reach it. Simultaneously the *entire* generic-assistant
   rulebook (email UIDs, cookbook serving rules, "a failed tool is not a stopping condition —
   improvise") is prepended to every game turn, directly instructing the named failure modes.
4. **The information design forgets the house.** The status HUD shows four lines (week, phase,
   HOH, noms, veto) of a 16-person social game: no roster, no attrition, no jury tracker, no
   "am I on the block?" badge, no portraits, no beat/episode structure in the chat scroll — and
   both HUDs silently vanish whenever the engine hiccups.
5. **The game layer skipped the platform's craft.** The three Orwell HUDs are islands of inline
   CSS with zero media queries, zero reduced-motion handling, zero focus management, and
   mouse-only controls. **Verdict: a full season is not playable on a phone today**, and not
   playable at all by keyboard/screen-reader users.
6. **The game build is cosmetic at the asset layer.** The script-strip removes files that
   `index.html` never references (a no-op) while the real multi-MB inherited bundle
   (`settings.js` 274KB, `chat.js` 251KB, `slashCommands.js` 268KB, `admin.js` 126KB…) parses on
   every load; KaTeX/Mermaid load from a CDN for a game with no math; the landing says "type
   /setup to get started" and the mobile tips advertise web search and Compare mode.

---

## J. The journey (first run → resume → restart → ending)

**J1 · CRITICAL · NEW — No premiere beat: the game opens on dead air.** On onboarding success
the overlay just `el.remove()`s (`orwellOnboarding.js:117-119`) into an **empty chat**; the
game-master prompt attaches only inside `build_chat_context`, i.e. only when the player sends a
message (`chat_helpers.py:553-567`). The defining promise — "from premiere to jury vote" — opens
with the player staring at a blank screen, prompting the game into existence ("uh… hello?").
*Fix:* on game start, push a server-initiated, engine-framed premiere scene as the first
assistant message (the `phase:"premiere"` moment prompt exists — `GameSessionAdapter.ts:219`).
*Acceptance:* immediately after onboarding the chat shows an in-character premiere with no user
input; pytest asserts an opening message exists before any user turn.

**J2 · CRITICAL · NEW (UX) / ties B3·B26/C11·0046·0048 — No terminal state: winning, losing,
and eviction all just stop.** No season-end screen, no "you won / evicted week 6 / the jury
chose X", no retrospective; the HUD cannot represent "season over" (`orwellStatusPanel.js:144-163`).
Best case the season fizzles; worst case (B3 relay) it cannot complete.
*Fix:* season-end terminal card (won / lost / evicted-at-week-N) + guarded new-season CTA (J3),
on top of the queued finale relay/UI fixes; the 0048 retrospective is its natural payoff.
*Acceptance:* reaching any ending renders a terminal screen; HUD reflects "season complete."

**J3 · CRITICAL · OVERLAPS A2/F7 (queued B36/C12/C15) — There is no player-facing "new season"
path at all.** Onboarding mounts only when `started:false` (`orwellOnboarding.js:129-130`), so
once a game exists the *only* restart routes are the unguarded agent `createCharacter` (A2's
data-loss path) or a manual API hit — after which the chat keeps the dead season's transcript
(F7). *Adds to the queue:* B36/C12 guard the wipe but no item adds the **affordance** — a styled
"New season" control with confirm + fresh chat session.
*Acceptance:* a finished/abandoned season offers a guarded new-season flow; first post-restart
turn carries no prior-season messages.

**J4 · MAJOR · NEW — The prerequisite chain dead-ends at "No model selected" right after
authoring.** A fresh install has no LLM endpoint; onboarding never checks model readiness
(`orwellOnboarding.js:129-130`), so the player authors a houseguest, clicks "Enter the house,"
types their first line — and gets *"No model selected for this chat. Open the model picker…"*
(`chat_routes.py:301-305, 480-484`). INTEGRATION.md lists model config as a manual step; the UI
never sequences it.
*Fix:* probe model readiness before mounting onboarding; if absent, a game-branded "connect a
feed source" step; never render the raw model error on a game-active session.
*Acceptance:* fresh install → one guided path (model → character → first scene); the raw "No
model selected" string never renders while onboarding/game is active.

**J5 · MAJOR · NEW — Authoring is two optional words; the one human-authored thing barely
matters.** The form is name (required) + optional free-text archetype + strategy
(`orwellOnboarding.js:70-81`). Spec 0015 calls for identity, backstory, public persona,
archetype lean, and a `NO_NPC_PATHWAY` **private strategy** — none of which have fields (the
engine client accepts only `archetype`/`strategyStyle`/`seed`, `orwell_engine.py:42-51`).
*Fix:* add backstory + "private strategy (only you know this)" wired to the player-knowledge
tag; canonical archetypes as selectable chips with hints (resolves F8b).
*Acceptance:* private strategy round-trips as `NO_NPC_PATHWAY` knowledge; persona appears in the
moment prompt's player framing.

**J6 · MAJOR · NEW — The balanced-stats anti-sycophancy stance is never communicated.** Stats
are derived silently and never shown (`GameSessionAdapter.ts:451-458`); 0015 §5's deliberate
"you can't min-max yourself" guarantee is invisible rather than characterful.
*Fix:* one line of onboarding copy ("Your strengths are drawn from who you are — like every
houseguest, balanced, never invincible. The house plays fair, and so does the game."),
optionally a qualitative leaning ("reads as a social player"), never a number.

**J7 · MAJOR · NEW — No re-entry beat: resume is a frozen transcript.** Nothing pushes a
re-entry scene on return; the legacy ideal ("open on a fresh morning scene, never a recap" —
prior audit H8) has neither half implemented. The player scrolls up to remember where they were,
then pokes the game awake.
*Fix:* on re-open with `game_active`, push one engine-grounded morning/continuation beat
(current phase + recent witnessed events). *Acceptance:* reopening yields one in-character
re-entry scene before any input; references current week/phase; Vault-clean.

**J8 · MAJOR · OVERLAPS F5 (queued C15) — The generic welcome paints first and its tips
advertise dropped verticals.** The workspace welcome renders unconditionally
(`index.html:942-947`) with tips *"Switch to Agent mode for web search and code execution"* and
*"Use Compare mode…"* (`index.html:961-962`) — on the **happy path**, before the async overlay
mounts, and permanently if the engine is down. *Adds:* the exact strings + the paint-ordering
flash. *Acceptance:* no dropped-vertical string renders under the game build; the generic
welcome never paints when onboarding will mount.

**J9 · MINOR · NEW — The login/setup threshold never signals a game** ("First-time setup —
create your admin account", `login.html:334-340`). Game-frame the copy under the game build.

**J10 · MINOR · NEW — No back/edit/confirm in authoring** — one click commits the season; a
typo'd name is permanent (`orwellOnboarding.js:99-117`). Add a review step ("You'll enter as
**Alex**, a strategist. Begin?").

**J11 · MINOR · NEW — The HUD can show "Week 1 / premiere" before any narration exists** —
a HUD describing a season the chat hasn't started. Suppress until J1's premiere is delivered.

**J12 · MINOR · OVERLAPS F7 — Factory reset scrubs the engine but not front-end transcripts**
— the "clean slate" still shows the dead season's chat; on the next game, contamination
resurfaces. Reset must clear/archive game sessions (or J3's fresh-session path covers it).

## U. The play surface & information design

**U1 · CRITICAL · deepens F4 (queued C16 §3) — The `pending` decision view is completely
unconsumed; binding moments have no surface at all.** `AdvanceView.pending` carries
`{kind, by, prompt, options[], appeals?, juror?, pick}` (`GameSession.ts:102-153`, built at
`GameSessionAdapter.ts:335-361`) and **no front-end JS ever reads it** (grep-verified). Specific
consequences beyond F4: no confirmation/review on the most consequential picks of the game; the
engine's `pick: 2` constraint unenforced (ambiguous prose can submit malformed decisions); the
`appeals` enum for `finale-answer` is invisible (players would guess an enum through prose); and
the staged `finaleView` (statements, asking juror, ordered vote reveals — the most cinematic
sequence in the game) has no renderer even where wired.
*Fix:* the **decision card** (full spec in §Specs): rendered on every non-null `pending`; the
only path to `submitDecision`; composer prose never binds. *Acceptance:* a pending nominations
turn renders exactly the engine's options with pick-2 enforcement and an explicit confirm; a
finale drives statement → appeal-picker → ordered reveal through cards.

**U2 · MAJOR · NEW — No "this is binding" signal.** Even a careful player cannot distinguish
role-playing their reasoning aloud from casting a vote — the engine knows (`pending !== null`)
and the FE discards the signal. The decision card *is* the signal: while a `pending` is open the
surface marks the turn as a decision and free text cannot submit it.

**U3 · MAJOR · NEW (extends queued C16 §1) — The status panel forgets 14 of the 16
houseguests.** It renders exactly week/phase/HOH/noms/veto (`orwellStatusPanel.js:92-94,
144-163`). Already-returned, Vault-free, unrendered: the **roster** with active/evicted status
(`getGameState().house[]`, `GameSessionAdapter.ts:459-462`), the player's **own ceremony role**
(derivable from the player card vs `hoh`/`nominees`/`veto.holder` — "am I on the block?" is
currently read by scanning prose), **jury seats** (needs only a `juror` status or public
`juryStart` week), and attrition (16→2). All public ceremony facts a real houseguest sees on the
memory wall; no standing reads, no numbers (0020 holds).
*Fix:* the roster surface (spec in §Specs). *Acceptance:* roster matches `house[]`; player's own
role badged from public facts; jury marked once formed; sentinel sweep clean.

**U4 · MAJOR · NEW (extends F6) — Ceremony beats are visually indistinguishable from chatter.**
Every engine call renders as a generic thread node with raw camelCase names and raw JSON args —
the `_toolLabels` map (`chat.js:1114-1134`) covers `web_search`/`bash`/`python` but **no game
tool**. A nomination ceremony reads identically to a hallway chat; there is no episode/week
divider, no way to scan back to "the week I went up."
*Fix:* diegetic game-tool labels (`advanceGame`→"📺 Production", `submitDecision`→"🗳 Your
move"), hide raw JSON under the game build, and render a full-width **beat divider** ("— 
Nomination Ceremony · Week 3 —") from `AdvanceView.event.beat` + `status` on ceremony advances.
*Acceptance:* a ceremony turn produces a labelled divider; no raw `{` JSON renders for game
tools under the game build.

**U5 · MAJOR · NEW (extends F8c) — The HUDs vanish exactly when the player is anxious.** Both
panels `hidePanel()` on any error (`orwellStatusPanel.js:165-172`, `orwellSocial.js:339-350`)
and `st.week < 1` is indistinguishable from a transient 502 — so an engine hiccup makes the
player's only persistent readout silently blink out and back. *Fix:* distinguish engine-error
(keep last-known values + a subtle offline dot) from no-game (hide); share one poller.
*Acceptance:* an injected 502 leaves the panel visible with stale-state indication.

**U6 · MAJOR · NEW (FE half of D8) — Acting on an NPC approach inverts the direction and is
always the same sentence.** Every approach is the same chip ("wants a word with you") and
clicking it prefills *"I pull ⟨name⟩ aside for a quiet word."* (`orwellSocial.js:260-269`) — the
NPC initiated, but the canned line has the player initiating. The bidirectional-scenes mandate
collapses into one mechanical template. *Fix:* NPC-initiated framing ("⟨Name⟩ catches your eye
and drifts over—") with ≥N varied templates; engine-side pretext variety is queued (D8).

**U7 · MINOR · OVERLAPS F8e — The social pulse is one chip at a time, per-browser.**
`MAX_APPROACHES = 1` (`orwellSocial.js:24`) + localStorage dismissals — a 15-NPC house surfaces
one suitor, and dismissals resurrect across devices. Allow 2–3 concurrent approaches; move
dismissals server-side.

**U8 · MINOR · NEW (ties queued C13) — Two Diary Rooms with different guarantees.** The HUD
modal is correctly framed OOC and records; the in-chat DR the prompt stages (`momentPrompts.ts:
59-60, 95-97`) doesn't record (C13) and carries no "the house never hears this" banner — the
player can't tell which DR they're in. Unify, or banner the chat DR identically.

**U9 · MINOR · NEW — No pacing affordance.** The model decides how many beats to narrate per
turn; a player can't savour a week or blitz to eviction. Minimum fix: a one-beat-per-turn
instruction in the moment prompt (drift-tested), so pacing is at least predictable.

## N. Narration & narrator reliability

**N1 · CRITICAL · NEW — The narrator is fed 15 names and a status word; all NPCs are
voiceless.** `renderGameContext` emits `- Name (active)` per NPC (`momentPrompts.ts:127-140`);
`HouseguestCard` is `{id, name, status}` (`GameSession.ts:23-28`). Meanwhile the engine has
already minted, per NPC, **Vault-free** public facets: archetype, strategyStyle, background
("a bartender who plays as a mastermind"), age, appearance, presentation, and a
`PortraitDescriptor` with a `vibe` field designed for exactly this (`characterFactory.ts:56-66,
180-199, 311-335`) — blessed outward-safe by the existing portrait pipeline. None of it reaches
the prompt. This is the primary engine of "feels like a chatbot wrapper": the house has no faces,
and even engine-initiated approaches arrive personality-free.
*Fix:* a Vault-free `cast` block on `GameStateView` (or a `getCastVoices` read tool) carrying
the public facets; weave one per-NPC line into `renderGameContext` ("Bemir Sason — mastermind,
plays under-the-radar; a bartender; 34, polished and camera-ready"); evicted houseguests drop
out. *Acceptance:* the prompt lists each active NPC's public vibe; sentinel-embedded soul/stat
strings never appear in it (extends E8's production-path sweep); different archetypes ⇒
different descriptors.

**N2 · CRITICAL · NEW — No mechanism or directive for distinct, consistent NPC voices.** Even
with N1's data, nothing instructs differentiation, week-to-week consistency, or the boundary
that NPC biography never exceeds the supplied facets + recorded events (no minted hometowns).
*Fix:* a VOICE-DISTINCTNESS block in `BASE_GAME_MASTER_PROMPT` ("A villain needles; a peacemaker
smooths… Keep each person's voice CONSISTENT across the whole game… Never invent biography
beyond what the context gives you"). Because the public facets are seed-stable, the anchor never
drifts. *Acceptance:* drift test asserts the prompt names the cast fields + consistency rule; a
scripted scene shows different registers per archetype.

**N3 · MAJOR · OVERLAPS F6 (queued C14) — The contamination is the whole rulebook, not one
line.** The GM prompt is *prepended* to `_AGENT_PREAMBLE` ("You are an AI assistant with tool
access… run shell commands… manage memories", `agent_loop.py:62-66`) plus `_AGENT_RULES` — pages
of email-UID discipline, cookbook serving anti-patterns, calendar RRULEs, UI anchor-link rules —
on **every game turn** (`chat_helpers.py:561-567`). *Adds to C14:* don't restyle — **substitute**:
on `game_active` turns assemble a game-specific preamble (one in-fiction tool-calling paragraph +
only game-tool rules) instead of the generic one. *Acceptance:* F6's criterion plus no
email/cookbook/calendar/document rule text in any game-active turn's system messages.

**N4 · MAJOR · OVERLAPS F1 (queued C13) — The prompt advertises levers that don't exist,
including a second competition lever.** `BASE_GAME_MASTER_PROMPT` names `resolveCompetition`
(`momentPrompts.ts:44`) — which has **no client function at all** — alongside `runCompetition`;
a prompt-obedient model picking the advertised lever fails the HOH comp mid-scene with "Unknown
function call" (`tool_schemas.py:1461`). *Adds to C13:* collapse to one comp lever in the prompt
(pairs with B37's single-authority fix); the unreachable `diaryRoom` means the player's own
confessional is narrated-but-never-recorded; the unreachable `socialInitiatives` means the
prompt's "scenes start from EITHER side" pitch is dead.

**N5 · MAJOR · NEW (extends queued C12) — On a tool error, the model is *instructed* to invent
the outcome.** Game tools return `{"error": "engine error: …"}` (`tool_implementations.py:
4505-4719`), and the generic rulebook says *"AFTER A TOOL FAILS… retry with a fix… A failed tool
is not a stopping condition"* (`agent_loop.py:78`) — so a transient engine blip during
`runCompetition` produces a confidently narrated, non-canonical winner by default. *Fix:* the
game preamble (N3) replaces that rule with: outcome-tool errors ⇒ "do not narrate a result; the
feed glitched — try again." *Acceptance:* an injected `runCompetition` error yields a feed-glitch
message, never a named winner.

**N6 · MAJOR · NEW (extends F6) — Raw `npc:7`/JSON reaches the model's own context, not just
the UI.** `format_tool_result` dumps unhandled keys as `**data:** ```json````
(`tool_execution.py:1562-1620`); game payloads (ids, `phase:`, `pick:`) aren't in
`_FORMATTER_HANDLED_KEYS`, so the model is *taught* that `npc:7` is a thing people say.
*Fix:* a game-tool formatter branch that summarizes diegetically and maps ids→names before the
result reaches the model. *Acceptance:* no `npc:\d+`/`phase:`/`pick:` token in a game-active
turn's tool-result text.

**N7 · MAJOR · NEW — Nothing prevents narrating the house from context instead of querying
ground truth.** The GM prompt's "if a fact did not come from the context or a tool you do not
know it" is wording only, and the competing generic rule says *"Don't search for things you
already know"* (`agent_loop.py:70`) — with a whole season's transcript in context, memory is the
cheapest path, and drift (phantom alliances, evicted houseguests still talking) is
sycophancy-by-omission. *Fix:* N3 removes the contradicting rule; add a hard cadence to the GM
prompt ("Begin every turn by reading getGameState; never state week/phase/HOH/nominees from
memory; progress beats only via advanceGame"); optionally a server-side nudge when a ceremony
narration happens with zero game-tool calls. *Acceptance:* "who's HOH?" triggers a state read,
not a context answer.

**N8 · MINOR · NEW — TTS collapses 17 voices into one.** Single provider/browser voice
(`tts-ai.js:4-60`); fine as narration, but a mono-voice "drama" undercuts the cast. Recommend:
document as a known limitation rather than half-building multi-voice now.

**N9 · MINOR · NEW — The Diary Room sounds like the host.** No distinct producer/confessional
register is specced for the `diary-room` moment; the signature intimate BB texture reads as
another host beat. One register clause in the moment fragment ("drop the broadcast voice — this
is the quiet producer booth") + the C13 recording fix.

**Prompt line-edits (for `BASE_GAME_MASTER_PROMPT`):** cut `resolveCompetition` from the lever
manifest; add the VOICE-DISTINCTNESS block (N2); add the ground-truth cadence line (N7); add the
error-handling line (N5); upgrade `renderGameContext`'s roster to per-NPC vibe lines (N1). The
AUTHORITY and VOICE paragraphs are good — keep them.

## A. Accessibility (the systemic gap)

**A1 · CRITICAL · NEW — The onboarding modal has no focus trap, no Escape, no inert
background.** `role="dialog"`/`aria-modal="true"` are set (`orwellOnboarding.js:26-27`) but Tab
walks straight out into the dead chat behind the scrim; every background control stays operable.
Every new keyboard/SR player hits this on their first screen. *Fix:* trap Tab within `.ob-card`;
`inert` the app behind; restore focus on close. *Acceptance:* background unreachable by keyboard
or AT while mounted.

**A2 · MAJOR · NEW — The approach chips and Diary Room are mouse-only.** Approaches are `<div>`s
with a click-listening `<span class="osoc-go">` (`orwellSocial.js:307-334`) — not focusable, no
role, no key handler; the DR dialog has no focus trap/Escape (backdrop click only, `:179`).
Keyboard/SR players cannot initiate NPC scenes at all. *Fix:* real `<button>`s (or
role+tabindex+Enter/Space); trap+Escape on the DR. *Acceptance:* every chip and the DR fully
keyboard-operable; axe-core clean on the social panel.

**A3 · MAJOR · NEW — The status HUD's `aria-live` is ineffective.** The live region's own root
toggles `display:none` and all four fields swap wholesale every 20s poll
(`orwellStatusPanel.js:59, 64, 152-162`) — SR users get nothing, or a full re-read with no sense
of what changed. *Fix:* keep the region in the DOM; announce deltas only ("New nominee: …");
labelled row structure. *Acceptance:* changing only the veto holder announces just that.

**A4 · MAJOR · NEW — Contrast unenforced in the HUDs and across themes.** `opacity:.6`/`.55`
dimming on labels/copy (`orwellStatusPanel.js:65-84`, `orwellSocial.js:92-112`) drops below
WCAG AA on the dark default and far below on light themes; the theme picker applies arbitrary
colors with no AA clamp (`index.html:472-566`). *Fix:* explicit AA-checked colors instead of
opacity dimming; a contrast clamp in the theme apply path. *Acceptance:* HUD text ≥4.5:1 across
shipped themes + a generated light theme.

**A5 · MAJOR · NEW — Streaming narration is a stuttering token stream to screen readers.**
`#chat-history` is `role="log" aria-live="polite"` (`index.html:975`) over token-by-token
streams of multi-paragraph scene prose — continuous interrupting announcements or unpredictable
coalescing, with no completion boundary. *Fix:* stream into an off-live buffer (or `aria-busy`),
announce once on completion. *Acceptance:* each narration announced once, not per-token.

**A6 · MINOR · NEW — Title-only labels and an unmarked decorative loader.** Approach pretexts
live in `title` only (`orwellSocial.js:316`); the boot loader animation (`index.html:228-242`)
lacks `aria-hidden` and a reduced-motion guard. Mirror titles to `aria-label`; hide the loader
from AT.

## M. Mobile — verdict: a full season is NOT playable on a phone today

Three compounding blockers: the HUDs are desktop-fixed widgets overlapping the chat/composer
(M1); touch-draggable panels can be stranded off-screen (M2); and binding decisions/the finale
have no UI even on desktop (U1/B3) — so the phone experience is "read narration, can't reliably
act."

**M1 · CRITICAL · NEW — Fixed-position HUDs overlap the chat and composer; zero media queries
in any game file.** `position:fixed; right:14px; width:220px; z-index:9000` ×2
(`orwellStatusPanel.js:62-64`, `orwellSocial.js:89-91`), colliding with the composer's own
`z-index:9000` mobile machinery (`style.css:831, 973`). On a 390px phone they stack over
narration and tap targets. *Fix:* under a mobile breakpoint, dock the HUDs into the sidebar/a
bottom sheet; never free-float over the composer. *Acceptance:* at 390×844 neither HUD overlaps
the composer or the latest message.

**M2 · MAJOR · NEW — The HUDs opt INTO touch-drag (`mobileSkip: 0`) with no dock and no
post-drag clamp.** `windowDrag.js` skips drag below 768px *unless* `mobileSkip:0` — both HUDs
pass exactly that (`orwellStatusPanel.js:127`, `orwellSocial.js:205`); the viewport clamp runs
only on `resize`, and passive touch handlers compete with page scroll. A player can strand a
panel half off-screen. *Fix:* default `mobileSkip` (no drag on phones — they're docked per M1);
clamp after every drag end.

**M3 · MAJOR · NEW — The onboarding and DR modals don't fit short viewports and the DR is
touch-draggable.** 420px-wide cards with no `max-height`/scroll (`orwellOnboarding.js:31-37`,
`orwellSocial.js:135`) put the submit button below the fold on landscape phones; the DR is
draggable on touch (`orwellSocial.js:210-213`). *Fix:* `max-height:90vh; overflow:auto`;
`mobileSkip` default on the DR. *Acceptance:* onboarding submit reachable at 390×667 landscape.

## V. Visual craft & identity

**V1 · MAJOR · NEW — It looks like a dev workspace with chrome hidden, not a Big Brother
product.** The game build is purely subtractive (`game-trim.css` removes; nothing adds): the
landing is the generic eye logo + "type /setup to get started" (`index.html:943-944`), the
composer says "Message Orwell…" (`:990`), the HUDs are generic monospace slate-blue. Nothing
says *Big Brother* until the LLM speaks. *Fix:* a game-branded hero (season title, house,
"Enter the house" CTA that *is* onboarding), BB-flavored composer placeholder,
production-styled HUD chrome. *Acceptance:* a cold load with no game shows a BB-themed hero.

**V2 · MAJOR · NEW (extends queued C16 §1) — No portraits anywhere, despite the portrait
pipeline being a kept capability.** No portrait/roster endpoint exists (`orwell_routes.py`
serves only state/moment/status/tagline/initiatives/diary-room/new-game); `portraits`/`image_gen`
sit in `GAME_KEEP_SET` (`settings.py:208-211`) with **no game consumer**. The 16-person social
game has no faces. *Adds to C16:* the roster panel should include generated portraits keyed to
the houseguest ids (the engine's `portraitDescriptorFor` / appearance facets exist for exactly
this).

**V3 · MAJOR · NEW — Raw engine enums render as UI labels.** The status panel shows `phase`
verbatim (capitalize-only, `orwellStatusPanel.js:76, 154`) — `veto-ceremony`, `setup` — and the
canned "wants a word with you" is the entire social vocabulary. *Fix:* a phase-enum →
player-label map ("Veto Ceremony", "Move-in day"); no raw enum in any HUD.

**V4 · MINOR · NEW — HUD layout state is fragile** — hardcoded stacked offsets assume a tall
desktop; minimized state doesn't survive reload; only a dragged position persists
(`orwellStatusPanel.js:128-129`).

**V5 · MINOR · NEW — The theme picker ships the full workspace customizer** — syntax/code-block
colors and font drops (`index.html:455-566`) for a game with no code blocks. Prune to a curated
set of season themes under the game build.

## P. Performance & weight

**P1 · MAJOR · NEW — The script-strip is a no-op; the multi-MB inherited bundle ships on every
load.** `strip_dropped_scripts` (`settings.py:311-324`) removes `memory.js`, `rag.js`,
`compare/index.js` etc. — **none of which `index.html` references** (verified against the script
tags at `index.html:2178-2207`). Meanwhile the page parses `settings.js` (274KB), `chat.js`
(251KB), `slashCommands.js` (268KB), `admin.js` (126KB), `sessions.js` (131KB), `theme.js`
(90KB)… on every load, worst on mobile. The dropped verticals' *routes* 404 (0032 tier 1 works)
but their client code cost was never actually removed. *Fix:* a real game-build bundle
(tree-shaken entry importing only the keep-set), or at minimum gate the inherited mega-module
tags through the same flag. *Acceptance:* game-build page weight drops materially; `admin.js`/
`presets.js` absent from a game-build load.

**P2 · MINOR · OVERLAPS F8c/d (queued C18) — Polling never backs off, never pauses, double-
fetches.** Two independent 20s intervals (status + social), the social tick making two serial
fetches, polling forever through errors and in hidden tabs (`orwellStatusPanel.js:20,177`,
`orwellSocial.js:22,342-366`). *Adds to C18:* Page Visibility gating + coalescing `/state` +
`/initiatives` into one call.

**P3 · MINOR · NEW — KaTeX + Mermaid load from a third-party CDN for a game with no math or
diagrams** (`index.html:203-205`) — weight, a privacy/availability dependency, render-blocking
CSS. Drop under the game build.

**P4 · MINOR · OVERLAPS F8a (queued C18) — `game-trim.css` is the one game-build asset the flag
doesn't control.** Mechanism pinned: `strip_dropped_scripts` rewrites `<script>` lines only,
never the `<link>` (`index.html:217`) — so `ORWELL_GAME_BUILD=0` still hides the workspace
chrome it's supposed to restore.

## R. Residual inherited-workspace surface

**R1 · MAJOR · OVERLAPS F5 (queued C15) — Dropped-vertical tips on the happy-path landing.**
Pinned strings: *"Switch to Agent mode for web search and code execution"*, *"Use Compare mode
to test different models side by side"*, "Type /setup, then choose Local models or API"
(`index.html:961-968`) — visible to every mobile player pre-onboarding, permanently if the
engine is down. (Same fix as J8/C15.)

**R2 · MINOR · NEW — Inherited modals and actions remain in the DOM and tab order.** The
Brain/memory modal markup (`index.html:245-441`), the full theme customizer, and a visible
"Save to Documents" export item targeting a dropped vertical survive the trim set
(`game-trim.css:14-63` hides launchers only). A keyboard user can still reach them. *Fix:* add
them to the trim/gate set. *Acceptance:* no dropped-vertical control reachable by keyboard
under the game build.

---

## Specs

### The decision card (U1/U2 — extends queued C16 §3)
Rendered whenever an `advanceGame`/`submitDecision` response carries `pending !== null`
(finale card analogously from `finale`). Sourced entirely from the Vault-free
`PendingDecisionView`:
1. **Beat banner** from `pending.kind` ("Nomination Ceremony", "Power of Veto", "Eviction
   Vote", "Final Statement", "Jury Question", "Your Jury Vote") + `status.week`.
2. **Prompt** — `pending.prompt` verbatim. **Who** — `pending.by`; for `finale-answer`, the
   asking `pending.juror`.
3. **Options** — `pending.options` as selectable chips; for `finale-answer` render
   `pending.appeals`; for `finale-statement` a free-text box.
4. **Pick enforcement** — submit disabled until exactly `pending.pick` selected ("select 2 of
   N").
5. **Review + confirm** — "Nominate ⟨A⟩ and ⟨B⟩? This is binding." before `submitDecision`
   fires.
6. **Prose stays expressive, never binding** — the player may type a speech the model narrates;
   the binding value comes only from the card (the F4 invariant).
7. Sentinel-tested: ids+names+appeal labels only; never a number/standing/off-screen fact.

### The roster / status surface (U3 — extends queued C16 §1)
One Vault-free HUD from `getGameState` + `gameStatus` (both already return everything needed):
header `Week {n} · {phase-label}` + `{active}/16` attrition; **your standing as public facts
only** (HOH / ON THE BLOCK / VETO badges derived by id comparison — no safe/target read,
resolving H3's tension); this week's ceremony (current panel content); the full roster grouped
Active / Jury / Evicted with portraits (V2) and eviction-order trail; player's row pinned.
Jury grouping needs the one tiny engine addition (a `juror` status or public `juryStart`).
Sentinel test required.

### Cast voices (N1/N2 — engine + prompt)
`cast: CastVoiceCard[]` on `GameStateView` (or a `getCastVoices` player tool):
`{id, name, status, archetype, strategyStyle, background, age, appearance, presentation}` —
exactly the public facets + `PortraitDescriptor` fields that already exist
(`characterFactory.ts:56-66, 311-335`); explicitly excludes stats, soul, emotional state,
relationship edges, hidden elements. `renderGameContext` emits one vibe line per active NPC;
the VOICE-DISTINCTNESS prompt block directs distinct, consistent, non-inventing voices.
Boundary proof: extend the dependency-cruiser VAULT set + the E8 sentinel sweep to the cast
surface. Seed-stable facets = a voice anchor that never drifts (soul *evolution* stays hidden —
0041's job).

### The three lifecycle beats (J1/J7/J2)
All three share one mechanism — the server initiating narration instead of waiting for a
keystroke: **premiere** (on `createCharacter` success, narrate the move-in from the premiere
moment prompt), **re-entry** (on session re-open with `game_active`, one fresh-morning beat from
current phase + recent witnessed events — never a recap dump), **terminal** (on
winner/eviction-end, a season-end card: result, week, the new-season CTA, and — post-0048 — the
retrospective/unsealing entry point). Acceptance: each beat appears without user input, is
engine-grounded (week/phase correct), and is Vault-clean.

---

## Cross-reference: how this maps onto the existing queue

- **Absorb into queued items:** C12 ← N5 (error-override rule) + the resume-specific F2 note;
  C13 ← N4 (one comp lever in the prompt; DR recording) + U8; C14 ← N3 (substitute, don't
  restyle) + N6 + N7; C15 ← J8/J9/R1 (exact strings) + J12; C16 ← U1 full card spec + U3 roster
  spec + V2 portraits; C18 ← P2 + P4.
- **Genuinely new work with no queue item:** the lifecycle beats (J1, J7, J2) and J3's
  new-season affordance; J4 model-gate onramp; J5/J6 authoring depth; N1/N2 cast voices (engine
  projection + prompt + FE); U4 beat dividers; U5 HUD resilience; U6/U7 social-surface texture;
  the **accessibility batch** (A1–A6); the **mobile batch** (M1–M3); P1 real game bundle; P3;
  V1 visual identity; V3 enum labels; R2.

## Suggested implementation waves

- **Wave FE-0 — make it a game (highest leverage, mostly small):** N1+N2 cast voices (the data
  exists; one projection + one prompt block), N3 preamble substitution (one swap removes the
  contradiction, the rulebook bleed, and N5/N7's instructed failure modes), J1 premiere beat,
  U1 decision card, U3 roster (+V2 portraits).
- **Wave FE-1 — make it reliable:** N5/N6/N7 (with C12/C14), U5 HUD resilience, J4 model-gate
  onramp, J3 guarded new-season.
- **Wave FE-2 — make it reachable:** A1/A2/A3 (keyboard + SR play), M1/M2/M3 (phone play),
  A4/A5, P1 (the real game bundle — biggest single perf win).
- **Wave FE-3 — make it whole:** J2 terminal state (+0048 hook), J5/J6/J7 authoring + re-entry,
  U4 beat dividers, U6/U7 social texture, V1/V3 identity + labels, P3/P4, R2, the minors.

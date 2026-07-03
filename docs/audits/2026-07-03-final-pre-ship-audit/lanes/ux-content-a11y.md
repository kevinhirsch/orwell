# ORWELL — CONTENT & ACCESSIBILITY LENS — EXHAUSTIVE PRE-SHIP AUDIT (v2)

Agent tag: **CA**. Territory: microcopy/tone/voice + WCAG 2.1 AA. Evidence: telemetry stills at
`scratchpad/audit2/telemetry/` (MANIFEST.md + INDEX.md) cross-checked against
`frontend/static/{index.html,style.css,js/*.js}` source (grep-then-narrow; line-cited).
Dedup discipline: v1's ~41 findings (empty-narration, phantom-houseguest, ceremony-montage,
update_plan leak, casting truncation, beatSeq omission, setInterval leaks, stale welcome card,
workspace-machinery-visible/model-pill/msg-counter/nav, non-binding comp-round buttons,
eviction-vote-not-a-card, concatenated-beat markdown, roster empty-flash, first-name belt,
OOC-aside mis-record, runway vocab, producerVault unseal, empty-edges no-op, dead code,
focus-ring contrast, duplicate isNarrow, "N of 15 met") are **not** re-reported below; several
NEW findings corroborate/extend the same underlying pattern with fresh evidence, which is noted
explicitly where relevant.

## INDEX

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| CA-1 | Blocker | <1hr | High | Raw chatbot system message rendered as "Orwell"'s in-fiction reply | `chat.js:734-738` |
| CA-2 | Major | <1day | High | "not sent" send-failure tag is CSS generated-content only — invisible to AT | `style.css:2634-2649` |
| CA-3 | Major | <1hr | High | Raw model/provider vendor slugs shown verbatim to the player | OOBE wizard, composer pill |
| CA-4 | Major | <1hr | High | "model"/"chat model" technical vocabulary across ≥4 first-run surfaces | holding card, dark-house modal, OOBE |
| CA-5 | Major | <1hr | High | "engine"/"game service" literal dev vocab in error copy, 2 clashing voices at once | engine-down banner + modal |
| CA-6 | Major | <1hr | Med | "AI" spelled out in ≥3 settings/modal surfaces | Settings›Appearance, New Season, Theme›Customize |
| CA-7 | Major | <1hr | Med | "Ask your administrator to connect a model" — wrong deployment framing for a solo player | holding card |
| CA-8 | Major | <1hr | Med | Keyboard-Shortcuts labels are pure chat-workspace vocab; "Delete chat" ambiguously risks season loss with no irreversibility cue | Settings›Shortcuts |
| CA-9 | Major | <1day | High | "Your Deals" gadget shows "A houseguest" placeholder instead of the actual name, for every row | `orwellDeals.js:115` |
| CA-10 | Major | <1hr | Med | `/setup` welcome-screen trigger is a non-interactive `<span>` — keyboard/AT users cannot activate it | `models.js:581`, `index.html:1177`, `slashCommands.js:6172` |
| CA-11 | Major | <1day | Med | Risk badge likely fails contrast in the default frosted/light theme (red-on-light-pink) | `orwellDecision.js:154-161` |
| CA-12 | Major | <1day | Med | Mobile Theme window renders mostly off-screen/cut off above the viewport | `mobile-12-theme-window.png` |
| CA-13 | Minor | <1hr | Med | Settings›Account exposes a raw software version number ("v11.62") to the player | Settings›Account |
| CA-14 | Minor | <1day | Low | Decision-card risk-badge text is not actually folded into the card's `aria-label`, contra the code's own comment | `orwellDecision.js:381` vs `391-392,406` |
| CA-15 | Minor | <1hr | Low | Veto-decision / comp-intent cards omit the "IRREVERSIBLE — BINDING" badge despite identical "no taking it back" copy | `orwellDecision.js:43-59` |
| CA-16 | Minor | <1hr | Low | The single most load-bearing line on a decision card (what's needed to enable Confirm) is styled least legibly (italic, .7 opacity, smallest size) | `orwellDecision.js:202` |
| CA-17 | Minor | <1day | Low | Systemic contrast risk: "muted" text roles use opacity-dimming over a dynamic mesh-gradient wallpaper rather than a fixed contrast-safe token | multiple (`orwellPresence.js`, `orwellDecision.js`, `orwellCast.js`) |
| CA-18 | Minor | <1hr | Low | "Where You Are" panel: a populated present-list sits directly above "No one nearby.", reading as self-contradictory | `orwellPresence.js:171-190` |
| CA-19 | Minor | <1day | Low | Two OOC end-game windows (New Season modal + "Season, Watched Back" retrospective) can render simultaneously with bleed-through text | `retro-untold-story__desktop__light.png` |
| CA-20 | Minor | <1hr | Low | Generic "Confirm — this is binding" doesn't restate the specific stakes (who/what) at the point of commitment | `orwellDecision.js:323-327` |
| CA-21 | Polish | <1hr | Low | Retrospective's win headline uses a bee emoji ("🐝 … won the season") — doesn't read as victory | `retro-untold-story__desktop__light.png` |
| CA-22 | Polish | <1day | Low | "The house stirs" toast ships title-only, no elaborating body in the captured instance | `desktop-17-toast-f00.png` |
| CA-23 | Polish | <1hr | Low | Legacy general-workspace "Brain" memory/skills modal ships unconditionally in `index.html`; verify unreachable under game build | `index.html:424` |
| CA-24 | Minor | <1hr | Low | "Danger Zone" / generic dev-idiom heading in Settings›Account sits beside otherwise well-voiced copy | Settings›Account |
| CA-25 | Polish | <1hr | Low | Sidebar "New Chat"/"Search" labels persist even once a season is underway (corroborates v1's workspace-machinery finding with a fresh, always-visible instance) | `index.html` sidebar |
| CA-26 | Minor | <1day | Low | Send-fail state gives no explicit remedy text ("edit and resend") to a screen-reader user beyond the unannounced tag | `chat.js:717-733` |
| CA-27 | Minor | <1hr | Low | Deals gadget's kind/tag text wraps awkwardly for empty-`terms` deals, compounding the missing-name issue into a confusing 2-line stub row | `orwellDeals.js:118-146` |
| CA-28 | Major | <1day | High | Casting-interview opener echoes a raw `[stub-echo]`/prompt-cue fragment into the narrator's own bubble | casting-interview turn 1 |
| CA-29 | Major | <1day | Med | Jury-question decision card's "Your jury question" heading contradicts its own "(asked by Natalia Matthews)" attribution | `desktop-09-decision-juror-question.png` |

## STEELMAN — what's working (cited so it isn't accidentally "fixed")

- `orwellDecision.js` is a genuinely mature accessibility surface: role="form" + aria-label +
  aria-describedby, tab-order engineering that moves the dismiss × to *last* (WCAG 2.4.3, line
  131-136), a real focus-visible risk skin that is never color-only (line 138-142), explicit
  `aria-label`s on every free-text textarea (goodbye message / opening statement / jury
  question — lines 516, 524, 533), `prefers-reduced-motion` and `prefers-reduced-transparency`
  handling on the same component (lines 105, 227-256), and a 44px minimum on every interactive
  chip/button. This is not a surface that "hasn't been looked at" — findings above (CA-11, 14,
  15, 16) are real but narrow gaps in an otherwise well-executed system.
- `orwellWindow.js`'s modal stack correctly `inert`s every non-top modal (lines 62-133) — so
  CA-19's stacked end-game windows are a **visual clarity** issue, not a focus-trap/AT hazard;
  I checked this specifically before flagging it, to avoid a false a11y claim.
- In-fiction voice lands well in several places: the Diary Room framing ("📓 Diary Room —
  private & out-of-character; the house never hears this." / composer placeholder "Tell the
  producers what you're really thinking..."), the dark-house error's *body* copy ("Big Brother
  will return... this screen will clear the moment the feeds come back"), the OOBE wizard's
  framing sentence ("Big Brother production setup" / "the producers reach out the moment
  you're ready — they go first"), the loading toast ("Producers are getting the house ready...
  (15 houseguests)"), and the Theme picker's on-brand names (`glass`, `the feed`, `telescreen`,
  `room 101`, `memory wall`, `sequester` — genuine 1984/reality-TV vocabulary). The
  retrospective's "🔒 The Untold Story" / "🕵 How the votes really fell" unsealing content is
  exactly the dramatic-irony payoff the vision brief calls the peak moment (I3/I7) landing as
  written.
- `index.html`'s always-hidden live regions (`#chat-history[role=log][aria-live=polite]`,
  `#toast[role=status][aria-live=polite]`, `app-loader[aria-label="Loading the house"]`) and the
  per-gadget visually-hidden `[data-role=announce][aria-live=polite]` pattern (repeated
  correctly across `orwellPresence.js`, `orwellStatusPanel.js`, `orwellFinale.js`,
  `orwellNightStatus.js`) show a consistent, deliberate SR-announcement architecture.

---

## FINDINGS

[CA-1] [Severity: Blocker] [Effort: <1hr] [Value: High]
Raw chatbot system message rendered as "Orwell"'s own in-fiction line
- Where: `frontend/static/js/chat.js:734-738`, delivered via `addMessage('assistant', assistantNote)` at line 731 (`_abortSendKeepMessage`).
- Problem: When no chat session exists yet (a plausible early-game/engine-recovery path), the FE injects this text into the transcript **attributed to the narrator persona itself**: *"No chat session active. You can:\n\n- Open the model picker in the chat box and pick a model\n- Use the `+` button in the model picker to add a model endpoint\n- Use `/help` to see all available commands"*. This is not a banner or toast — it is a message from "Orwell" in the same bubble style as narration. It names "chat session", "model picker", "the `+` button", and `/help` — the single most severe I9 violation found in this pass: the in-fiction narrator voice is made to literally recite app-support copy to the player. Hurts: any player who hits this path (a broken model config, a race on first load) has the illusion shattered completely, mid-conversation, in the narrator's own voice.
- Differential: not a mis-record or a flow bug — it is deliberately-authored fallback copy, so it's squarely a content-voice defect, not a11y or IA.
- Confidence: H (exact string + call site confirmed in source).
- Fix: Route this fallback through the same OOC system-notice mechanism used elsewhere (`orwellNotice.js`'s `system-notice` kind, assertive aria-live, visually distinct from narration) rather than `addMessage('assistant', ...)`. Reframe the copy in-house-voice: "Production's feed just cut out. Pick a channel to reconnect, or type /help." — at minimum, never attribute it to the narrator.

[CA-2] [Severity: Major] [Effort: <1day] [Value: High]
Send-failure status ("not sent") exists only as CSS generated content — invisible to assistive tech
- Where: `frontend/static/style.css:2634-2649` — `.msg-user.msg-unsent .role::after { content: 'not sent'; ... }`. No matching string exists anywhere in the JS/HTML source (`grep -ri "not sent"` outside this one CSS rule).
- Problem: The ONLY visual indicator that a player's message failed to send during an engine outage (see `desktop-27-send-fail-final.png`, the "NOT SENT" pill) is a `::after` pseudo-element's `content` property. Per WCAG 4.1.3 (Status Messages, AA) a status message must be "programmatically determined... without receiving focus"; CSS generated content has historically inconsistent, non-guaranteed exposure to the accessibility tree across browsers/AT and must not be relied on as the sole carrier of meaningful text. A screen-reader user gets no reliable signal their message failed — they'd only notice the text silently reappearing in the composer.
- Differential: mitigated somewhat by the separate top-level engine-status banner (`orwellEngineStatus.js`, confirmed `role/aria-live=alert`) which DOES announce the outage — but that's a one-time/dismissible banner, not a per-message failure signal, so a user who already saw and dismissed it gets nothing on a later failed send.
- Confidence: H (source-confirmed absence of any real text node/aria attribute for this state).
- Fix: Add a genuine text node (visually styled identically) or `aria-label`/`aria-describedby` on the bubble reading "Not sent — edit and resend," and ensure it's inside or referenced by a `role="status"` region so it's announced once, non-disruptively.

[CA-3] [Severity: Major] [Effort: <1hr] [Value: High]
Raw model/provider vendor slugs shown verbatim to the player
- Where: `oobe-setup-wizard__desktop__light.png` — "Narrator model: **fake/echo-stream**" / "Portrait model: **google/gemini-3.1-flash-image**"; the persistent composer toolbar pill also reads "**echo-stream**" instead of "Select model" once one is picked (same screenshot).
- Problem: These are literal vendor+model-ID strings (the kind of string you'd see in an API dashboard) presented as normal reading material to someone being told they're about to be "cast" on Big Brother. This is the single most concrete piece of evidence for contradiction C2 (workspace clothes) in this pass — no in-fiction reframing survives at all here, unlike the surrounding "Big Brother production setup" copy which is otherwise well-voiced.
- Differential: distinct from the already-flagged "model pill" v1 finding (which was about the picker control's presence) — this is about the picker's **label content** displaying a raw slug, and the wizard's body text displaying the raw ID a second time.
- Confidence: H (screenshot-observed, unambiguous).
- Fix: Map provider/model IDs to an in-house display name (e.g., "Narrator: Channel 4 (fast)" or simply omit the ID and show only "connected" / a channel nickname the player set). The composer pill should show a role label ("Narrator feed") not the raw slug.

[CA-4] [Severity: Major] [Effort: <1hr] [Value: High]
"model" / "chat model" technical vocabulary spans the entire first-run and error surface
- Where: `holding-card__desktop__light.png` ("No chat model is configured yet, so the house can't speak..."); `desktop-25-error-engine-down.png` bleed-through ("Production needs a feed source — connect a **model** in Settings..."); `mobile-03-chat-home.png` (same string); OOBE wizard ("Pick your season's **models**").
- Problem: "Model" is an LLM-industry term. It appears in the very first screen an unconfigured player ever sees (the holding card) and recurs in the degraded/engine-down state — i.e., it's not a rare edge case, it's the default first impression and the default failure mode. The surrounding copy in the SAME strings is otherwise well-crafted ("Production needs a feed source", "the house comes alive") — "model" is the one word that breaks the illusion each time.
- Differential: overlaps thematically with v1's generic "workspace machinery visible" finding, but that entry named the *model pill/msg counter/nav* controls, not this specific word recurring in prose copy across 4 distinct strings — corroborating evidence for the same underlying gap, logged separately because the fix (a copy pass) is different from removing/relabeling a UI control.
- Confidence: H.
- Fix: Replace "model"/"chat model" with an in-house synonym established once ("feed", "channel", "narrator link") and apply it consistently across holding card, dark-house modal, OOBE wizard, and Settings.

[CA-5] [Severity: Major] [Effort: <1hr] [Value: High]
"engine" / "game service" literal dev vocabulary in error copy — and two clashing voices fire at once
- Where: top banner (`desktop-27-send-fail-final.png`, `desktop-25-error-engine-down.png`): **"Big Brother engine unavailable. / The app couldn't reach the game service. The show can't load until it's back."** — shown simultaneously with the modal below it: **"The house is dark / Big Brother will return. The game engine isn't reachable right now..."**
- Problem: "Engine", "app", "game service", "load" are all literal software terms — in the SAME error state that the modal handles gracefully ("Big Brother will return... the feeds come back"). Two things are wrong at once: (1) "engine"/"game service"/"app" are exactly the vocabulary I9 forbids, appearing in the very banner that's supposed to be a graceful degradation message; (2) the banner and the modal say the same thing in two different registers (technical vs. in-fiction) at the same time, which reads as inconsistent rather than deliberate layering (e.g., banner for admins, modal for players) since both are visible to the same player simultaneously.
- Differential: this is content/voice, not a duplicate of the "dark house" modal's existence (which is already good and shouldn't be touched) — the finding is specifically the co-present banner's wording.
- Confidence: H (both strings screenshot-confirmed co-occurring).
- Fix: Rewrite the banner in-house voice ("Production lost the feed. Hang tight — the house will come back.") or suppress the banner entirely when the in-fiction modal is already showing the same information, so there's exactly one voice per state.

[CA-6] [Severity: Major] [Effort: <1hr] [Value: Med]
"AI" spelled out literally across ≥3 separate player-facing surfaces
- Where: Settings › Appearance — "Text-only Emojis: Strip emojis from **AI** replies", "Sensitive Blur: Blur emails, tokens, and secrets in **AI** output" (`desktop-14-settings-open.png`); New Season modal AND Settings › Account — "Make **AI** studio portraits" button (`desktop-22-new-season.png`, `desktop-15-settings-account.png`); Theme › Customize advanced colors — "**AI** Chat Bubble" (`index.html` color-row grep, `aria-label`-adjacent `<label>AI Chat Bubble</label>`).
- Problem: Even granting that Settings is legitimately OOC utility chrome, spelling out "AI" repeatedly (rather than "the house"/"narration"/"portraits") is a clean, low-effort, high-visibility tell that undercuts the fiction the moment a curious player opens Settings — which the New Season flow actively invites them to do (portrait generation is a normal per-season step, not a buried admin toggle).
- Confidence: H (4 distinct source/screenshot locations).
- Fix: Global find/replace pass: "AI replies"→"the house's replies", "AI output"→"the feed's output", "Make AI studio portraits"→"Make studio portraits", "AI Chat Bubble"→"Houseguest Chat Bubble".

[CA-7] [Severity: Major] [Effort: <1hr] [Value: Med]
"Ask your administrator to connect a model" — wrong deployment framing for a solo player
- Where: `holding-card__desktop__light.png` — "No chat model is configured yet, so the house can't speak. Ask your administrator to connect a model..."
- Problem: Per CLAUDE.md this is a single-player app (one sandbox per physical-world user); there is no "administrator" separate from the player in the normal deployment the player experiences. This copy reads as enterprise-SaaS boilerplate ("contact your IT admin") pasted into a consumer game, and it's actively confusing/actionable-less for a solo player who has no one else to ask — they ARE the person who needs to open Settings.
- Differential: content/IA, not a real permissions bug — `AUTH_ENABLED=false`/admin-gating exists for the self-hosted deploy model, but the copy doesn't know its audience is usually the same person.
- Confidence: M (holding-card copy could plausibly differ for genuinely multi-tenant/shared deploys, but nothing in the string itself branches on that).
- Fix: "Head to Settings to connect the house's feed — casting begins the moment it's live," dropping "administrator" for the common case, or conditionally branching the copy on whether the current user IS the admin.

[CA-8] [Severity: Major] [Effort: <1hr] [Value: Med]
Keyboard-Shortcuts panel is pure chat-workspace vocabulary; "Delete chat" risks ambiguous, unwarned season loss
- Where: `desktop-15-settings-shortcuts.png` — "Search chats", "New chat", "Favorite chat", "Delete chat", "Toggle sidebar", "Focus chat input", "Open Settings".
- Problem: These labels describe a generic multi-thread chat app, not a Big Brother season. Given "one active game per user" (CLAUDE.md), "chat" and "season" are effectively the same object here — so "Delete chat" is a functionally dangerous label with NONE of the irreversibility signaling that the equivalent action gets elsewhere (compare Settings › Account's "Reset progress... Irreversible." with an explicit red Reset button and confirmation copy). A player skimming keyboard shortcuts could trigger season-loss via `Ctrl+Alt+D` believing it only clears chat clutter.
- Differential: distinct from v1's generic "New Chat" sidebar finding — this is a *risk-bearing* mislabel (a destructive action undersold as routine), not just a tone/vocab nit.
- Confidence: M (labels confirmed; exact runtime behavior of "Delete chat" on a live/only season not directly observed in this telemetry batch — recommend verifying it either blocks/redirects to the guarded reset flow, or is relabeled).
- Fix: If "Delete chat" can delete the only active season, rename it "Reset progress" (matching the Account-tab pattern) and route it through the same confirmation copy; if it's scoped to non-game chats only, rename to make that scope explicit ("Delete this conversation").

[CA-9] [Severity: Major] [Effort: <1day] [Value: High]
"Your Deals" gadget shows generic "A houseguest" instead of the actual name — for every listed deal
- Where: `desktop-05-gadget-deals.png` (and mobile equivalent) — all three deal rows read "A houseguest · FINAL-2 · ACTIVE", "A houseguest · ACTIVE PROTECTION", "A houseguest · ACTIVE INFORMATION". Source: `frontend/static/js/orwellDeals.js:111-116` — `otherParty(deal)` returns `(them && them.name) || "A houseguest"`, and the fallback is firing for 100% of the visible rows.
- Problem: A deal the player personally made is meaningless without knowing WHO it's with — this is player-witnessed information (the player was there when they made it), not Vault-protected content, so there is no in-fiction reason for the name to be withheld. As rendered, the panel is functionally useless: three rows that are indistinguishable from each other apart from deal-kind tags.
- Differential: could be (a) a genuine adapter/plumbing gap where `NamedRef.name` isn't populated for deal parties, or (b) an artifact of this capture's seeded/deterministic data specifically. Either way, the fallback string reaching the player in this telemetry is real, evidenced, reproducible-looking behavior worth a direct fix-or-verify.
- Confidence: M-H (the failure mode is confirmed in source and screenshot; root cause in the live adapter vs. capture-harness data is unconfirmed).
- Fix: Trace why `deal.parties[x].name` is empty for these three rows in `GameSessionAdapter`'s deals projection (`src/ports/GameSession.ts:132`, `NamedRef[]`); if it's a genuine data gap, populate it from the same name-resolution path the Cast gadget uses successfully. Independently, consider a better fallback than "A houseguest" (e.g., "an unnamed houseguest — deal record incomplete") so a future recurrence is visibly a bug, not read as intentional anonymity.

[CA-10] [Severity: Major] [Effort: <1hr] [Value: Med]
`/setup` welcome-screen trigger is a non-interactive `<span>` — unreachable by keyboard/AT
- Where: `frontend/static/index.html:1177` and `frontend/static/js/models.js:581` both emit `<span class="setup-trigger-link" style="...cursor:pointer;text-decoration:underline;" title="Click to launch setup">/setup</span>`; wired only via a document-level `click` delegate in `frontend/static/js/slashCommands.js:6172` (`e.target.closest('.setup-trigger-link')`). No `role="button"`, `tabindex`, or `keydown`/`keypress` handler exists anywhere for this element.
- Problem: This is the single most prominent call-to-action on the empty/pre-game chat screen (styled as an underlined, colored, cursor-pointer "link") — but it is a `<span>`, so it is not in the natural Tab order and has no keyboard-activatable role. A keyboard-only or switch-device user literally cannot click it; their only path is to know, unaided, that they can type the literal text "/setup" into the composer — a fallback that exists but is never surfaced to them since the "link" visually promises click-activation it doesn't deliver. Fails WCAG 2.1.1 (Keyboard) and 4.1.2 (Name, Role, Value — no role exposed as interactive).
- Confidence: H (source-confirmed absence of any keyboard wiring for this element).
- Fix: Change the span to a real `<button class="setup-trigger-link" type="button">` (or add `role="button" tabindex="0"` plus a `keydown` handler for Enter/Space) so it's both clickable and keyboard-operable; the existing click-delegate logic can stay unchanged since `e.target.closest(...)` still matches.

[CA-11] [Severity: Major] [Effort: <1day] [Value: Med]
Risk badge likely fails text contrast in the app's default frosted/light theme
- Where: `frontend/static/js/orwellDecision.js:154-161` — `.odec-risk-badge { color: var(--color-error, #e06c75); background: color-mix(in srgb, var(--color-error,#e06c75) 12%, transparent); border: 1px solid color-mix(...60%...); }`. Visually confirmed in `desktop-09-decision-nominations.png` / `desktop-09-decision-eviction-vote.png` / `desktop-09-decision-final-eviction.png`: the "⚠ IRREVERSIBLE — BINDING" pill renders as medium-red text (`#e06c75`) on a near-white/light-pink chip, inside the app's default light "frosted" card surface.
- Problem: `#e06c75` is a mid-tone red (relative luminance ≈0.30) designed to read clearly against the DARK panel (`#111`) the non-frosted CSS variant targets (line 144-148 comments confirm this is "the eviction-RED MEANING" tuned for a dark surface) — but the frosted/light override (lines 229-256) repaints the card light while the badge's `color`/`background` rules are untouched, since they're scoped to a child selector the frosted block doesn't override. Red-on-near-white commonly lands around 2.5–3:1, below the 4.5:1 text minimum (and likely below the 3:1 UI-component minimum too, depending on the exact tint).
- Differential: this is the SAME badge the source explicitly calls out (line 178-181 comment) as previously fixed for a *different* contrast issue (chip border on dark panel) — i.e., this component has a known history of exactly this class of bug, and the light-theme variant of the badge itself doesn't appear to have had the equivalent pass.
- Confidence: M (visually consistent with a contrast failure across 3 independent screenshots; not pixel-measured).
- Fix: Add a `body.theme-frosted #${CARD_ID} .odec-risk-badge` override that darkens the text (e.g., a near-black or deep maroon) against a saturated (not 12%-tinted) red chip fill, mirroring the "sanctioned system-blue CTA" pattern already used for `.odec-confirm` in the same file (lines 257-262).

[CA-12] [Severity: Major] [Effort: <1day] [Value: Med]
Mobile Theme window renders mostly off-screen, cut off above the viewport
- Where: `telemetry/mobile-12-theme-window.png`.
- Problem: Once opened, the Theme window's title bar and controls sit almost entirely above `y=0` — only a sliver ("Theme" label + two tab-like fragments) is visible at the very top of the viewport; the rest of the window (the swatch grid, "Show all themes") is off-screen with no visible scroll affordance to pull it into view. This compounds the manifest's already-noted discoverability issue ("#tool-theme-btn not directly clickable... reachable only via JS seam") into an actual **unusable** state once opened: a mobile player who does manage to trigger the theme picker cannot see or interact with its content.
- Differential: could be a mid-open-animation capture artifact rather than steady-state — flagged with that caveat, but the manifest's independent note about launch-affordance on the same surface raises confidence this is a real mobile positioning bug, not just a timing fluke.
- Confidence: M.
- Fix: Verify the Theme window's default mobile anchor/position logic (likely the same `OrwellWindow` kit used elsewhere) clamps to the viewport on open; re-capture at steady state (post-animation) to confirm before triage.

[CA-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
Settings › Account exposes a raw software version number to the player
- Where: `desktop-15-settings-account.png` — "Unknown / User · v11.62" in the Account header row.
- Problem: "v11.62" is an internal build/version string with zero in-fiction meaning — it's the kind of detail that belongs in an admin/about screen, not a consumer game's account card, and it sits right next to "Unknown" (an unfriendly fallback for the player's display name — see CA-24 differential note).
- Confidence: H (screenshot-confirmed literal string).
- Fix: Remove the version string from the player-facing Account card (move it to an admin-only "About" surface if needed for support purposes).

[CA-14] [Severity: Minor] [Effort: <1day] [Value: Low]
Decision-card risk-badge text is not actually folded into the card's `aria-label`, contradicting its own code comment
- Where: `frontend/static/js/orwellDecision.js:381` sets `card.setAttribute("aria-label", titleFor(kind, pending.binding))` — title only. Lines 390-392 and 406 comment: *"The badge text rides in the title's aria-label (set via the card's existing aria-label + the visible badge) so colorblind + SR users get the same weight signal..."* — but no code anywhere concatenates the badge text into that aria-label string.
- Problem: A screen-reader user navigating by landmark/rotor (a common efficient SR technique, and exactly what `role="form"` + `aria-label` is designed to support — see the adjacent J4-02 comment about landmark navigation) hears only "Nomination ceremony — your nominations" and NOT "Irreversible — binding" from the landmark's name. They *would* still encounter the risk-badge's `role="note"` text if they read linearly through the card's content (aria-label doesn't hide children from the accessibility tree), so the information isn't fully lost — but the fast landmark-jump path a screen-reader poweruser would use to triage "what kind of decision is this" specifically omits the one piece of information sighted users get instantly from the red skin.
- Differential: a genuine implementation/comment mismatch, not a full SR blackout (the note text is still reachable by linear reading) — hence Minor, not Major.
- Confidence: H (source-confirmed).
- Fix: `card.setAttribute("aria-label", titleFor(...) + (risk ? " — Irreversible, binding" : ""))` so the landmark name itself carries the stakes signal, matching the comment's stated intent.

[CA-15] [Severity: Minor] [Effort: <1hr] [Value: Low]
Veto-decision and comp-intent cards omit the "IRREVERSIBLE — BINDING" badge despite using identical "no taking it back" language
- Where: `frontend/static/js/orwellDecision.js:43-59` (`HIGH_STAKES_KINDS`, deliberately excludes `veto-decision`/`comp-intent`/`comp-round`) vs. the veto-decision card's own note text, screenshot-confirmed in `desktop-09-decision-veto-decision.png`: *"Your choice here is what counts — make it with the buttons. Once you confirm, it's locked in and plays out — there's no taking it back."* — verbatim-identical severity language to the nomination/eviction cards that DO get the badge.
- Problem: The code's own rationale (line 43-48: badge reserved for kinds that "end a houseguest's game... outright") is internally consistent, but the player only sees the PROSE, not the source comment — and the prose asserts the exact same stakes ("no taking it back") on a card with a visually calmer treatment. A player who has learned "the red badge = irreversible" from nominations may under-weight the veto decision, which materially decides who is even eligible for the eviction vote that follows it.
- Confidence: M (source-grounded differential noted; this may be an intentional design line the team is comfortable with, in which case the fix is a copy softening rather than a badge addition).
- Fix: Either add `veto-decision` to `HIGH_STAKES_KINDS` (it gates who stays on the block, arguably as consequential as `replacement` which IS included), or soften the veto-decision's note text to something less absolute ("Once you confirm, the ceremony proceeds with your call") so the visual weight and the copy weight agree.

[CA-16] [Severity: Minor] [Effort: <1hr] [Value: Low]
The single line telling the player what's needed to unlock Confirm is styled with the LEAST legibility on the card
- Where: `frontend/static/js/orwellDecision.js:202` — `.odec-hint { opacity: .7; font-size: var(--ow-fs-caption, .75rem); font-style: italic; ... }`. This is the text rendered by `disabledHintFor()` (lines 329-338), e.g. "Select 2 houseguests to enable Confirm."
- Problem: While Confirm is disabled, this hint is the ONLY copy explaining why — and it's simultaneously the smallest font, the most transparent (30% dimmed), and italicized (each of which independently reduces legibility; stacked, they compound). For a first-timer on a binding, high-stakes card, this is exactly the wrong line to under-style.
- Confidence: M (styling confirmed in source; real-world contrast ratio not pixel-measured, but the combination of all three de-emphasis techniques on the load-bearing string is a legibility concern regardless of the exact ratio).
- Fix: Keep the caption size if desired for hierarchy, but drop to ~85–90% opacity and remove the italic, or promote it to the same weight as `.odec-note` since it's arguably more actionable than the note text sitting beside it.

[CA-17] [Severity: Minor] [Effort: <1day] [Value: Low]
Systemic contrast risk: "muted" text roles rely on opacity-dimming over a dynamic gradient wallpaper
- Where: spot-checked instances — `orwellDecision.js:199` (`.odec-note { opacity: .80; }`), `:202` (`.odec-hint { opacity: .7; }`), `orwellPresence.js` (`.opres-quiet` "No one nearby." styling), Cast gadget's "IN THE HOUSE" caption under each portrait (`desktop-07-gadget-cast.png`).
- Problem: The app paints most surfaces over a `meshGradient.css`-driven animated background whose hue/luminance shifts across themes; text roles that achieve "muted" via `opacity` rather than a fixed, contrast-checked color token cannot guarantee 4.5:1 uniformly, since opacity composites differently depending on what's directly behind that specific element (a card panel vs. a gradient sliver bleeding through a translucent edge). This is a pattern risk across the muted-text family, not one isolated bug.
- Confidence: L-M (a systemic-risk observation grounded in source patterns and the presence of a dynamic wallpaper, not a direct pixel measurement of a specific failing pair).
- Fix: Recommend a dedicated automated contrast sweep (e.g., axe-core or a Playwright + color-contrast script) across every theme × the muted-text class list, and migrate "muted" styling to `color-mix()` against the token itself (as the risk-badge and chip-border rules elsewhere in this same file already do) rather than raw `opacity`.

[CA-18] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Where You Are" panel: a populated present-list sits directly above "No one nearby.", reading as self-contradictory
- Where: `desktop-06-gadget-status.png` et al. — "Living Room — Lola, Michelle, Karl, Vincent, Courtney, Ethan, Hassan, Wade, Mia, Jada, Eliana, Trey, Fabian, Victoria, Asher" immediately followed by italic "*No one nearby.*"; source: `frontend/static/js/orwellPresence.js:171-190` — the header line is "the room you're in + who's with you", the body is "the VISIBLE **nearby** [adjacent] rooms that have people" and falls back to "No one nearby." only when adjacent rooms are empty.
- Problem: The distinction (current room vs. adjacent rooms you could walk to) is correct and intentional per the code comments, but nothing in the VISUAL presentation distinguishes "this is your room" from "this is elsewhere" — both lines read as flat, equal-weight sentences. A first-time player skimming this (central to the "lingering is play"/I7 wayfinding loop) is likely to read "No one nearby" as contradicting the 14 names just listed above it.
- Differential: verified via source that this is NOT a data bug — it's a genuine, working header/body split that simply isn't legible as such without more visual distinction (e.g., a divider, a sub-label like "Nearby rooms:").
- Confidence: M.
- Fix: Add an explicit micro-label before the body line ("Nearby rooms:" ahead of "No one nearby."/the room list) so the two lines read as clearly distinct categories rather than a continuous, seemingly-contradictory sentence.

[CA-19] [Severity: Minor] [Effort: <1day] [Value: Low]
Two OOC end-game windows can render simultaneously with visible bleed-through text
- Where: `retro-untold-story__desktop__light.png` — the "Season, Watched Back" retrospective window's title bar and top-right corner show ghosted/underlying text ("Season Complete", a "Keep this houseguest" pill) from the New Season modal rendering behind/around it.
- Problem: For a sighted player, two OOC windows visibly overlapping with legible fragments of the "other" window bleeding through the frosted-glass edges is confusing about which window is currently live/focused, even though (verified in source, see Steelman) the underlying `inert` stacking correctly disables the non-top window for keyboard/AT purposes. This is a visual-clarity finding, explicitly NOT a focus-trap claim.
- Confidence: M (screenshot-observed; could also be the SAME window's own scroll content bleeding through its own translucency rather than a second window — either reading supports the same fix).
- Fix: Increase the opaque backing / blur radius on the top window so no legible text from beneath survives, or sequence the flow so the New Season modal is dismissed before the retrospective opens (rather than allowing both to coexist).

[CA-20] [Severity: Minor] [Effort: <1hr] [Value: Low]
Generic "Confirm — this is binding" doesn't restate the specific stakes at the point of commitment
- Where: `frontend/static/js/orwellDecision.js:323-327` (`confirmLabelFor`) — every high-stakes kind except `self-evict`/`comp-round` gets the identical literal string "Confirm — this is binding", regardless of whether the player is about to nominate two specific people, evict a specific person, or crown a winner.
- Problem: The vision brief asks for ceremonies to "land as an exclusive set-piece event." The card's TITLE is kind-specific and well-written ("Eviction — cast your vote", "Final 3 — you evict, personally"), but the actual commitment action — the button the player's thumb lands on — reverts to a generic phrase every time, missing a low-cost opportunity to reinforce the specific weight of the choice right where the player commits to it.
- Confidence: M (a polish/opportunity read, not a defect).
- Fix: Interpolate the selection into the confirm label where a single pick exists, e.g. "Confirm — vote to evict Natalia Matthews" / "Confirm — name Ezra Johns" (mirroring the existing per-kind `prefillCueFor` pattern already used elsewhere in the same file for the post-confirm prose cue).

[CA-21] [Severity: Polish] [Effort: <1hr] [Value: Low]
Retrospective win headline's emoji doesn't read as victory
- Where: `retro-untold-story__desktop__light.png` — "🐝 Isabel Fischer won the season (week 13)."
- Problem: A bee emoji ahead of a season-winning headline doesn't carry a "you won" association for most players (compare a trophy 🏆 or crown 👑, both already used elsewhere in the app's own iconography — the nomination flow uses 🏆 for HOH). Reads as a possible wrong-glyph pick rather than intentional motif.
- Confidence: L (could be an intentional "queen bee"/social-strategy motif specific to this winner's edit; flagged for a quick eyeball check).
- Fix: If unintentional, swap for 🏆/👑 to match the HOH icon already established in-app (`desktop-03-chat-home.png`'s "🏆 HOH" wayfinding icon).

[CA-22] [Severity: Polish] [Effort: <1day] [Value: Low]
"The house stirs" toast ships title-only in the captured instance
- Where: `desktop-17-toast-f00.png`/`-f05.png` — a notice card reading only "The house stirs" with a dismiss ×, no body/elaboration text (unlike every other notice/decision card sampled in this pass, which pairs a bold title with 1-2 sentences of context).
- Problem: Ambiguous whether this is intentional atmospheric flavor (a deliberately terse ambient beat) or a house-event notice whose detail line failed to populate — either way, a title with no elaboration under-delivers relative to the rest of the notice family's pattern.
- Confidence: L (this string isn't in the FE static source — it appears to be engine/narration-generated content, so root cause can't be confirmed from FE grep alone).
- Fix: Verify against the engine's house-event notice payload whether a body/detail field was expected but empty for this beat; if title-only is by design, no action needed.

[CA-23] [Severity: Polish] [Effort: <1hr] [Value: Low]
Legacy general-workspace "Brain" memory/skills modal ships unconditionally in `index.html`
- Where: `frontend/static/index.html:424` — `<div class="modal-content memory-modal-content" role="dialog" aria-label="Brain" ...>` with fields like "Skill import URL" (line 499), "Max skills to inject" (line 598), "New memory text" (line 486) — a full agent-memory/skills-authoring UI from the vendored general chat workspace.
- Problem: If any entry point to this modal survives `ORWELL_GAME_BUILD=1` gating, it would be one of the most severe possible C2 violations found in this pass (a raw "inject skills into the AI's memory" authoring panel, aria-labeled simply "Brain", reachable from an in-fiction game). Not confirmed reachable in this telemetry batch — no screenshot shows an entry point, and CLAUDE.md documents `ORWELL_GAME_BUILD` as gating "the reduced surface" — but the markup itself ships unconditionally in the same HTML file the player's build loads.
- Confidence: L (verification-only finding — no direct evidence of reachability in this pass's telemetry).
- Fix: Confirm via a dedicated pass (grep for what actually gates `#close-memory-modal`'s trigger control under `ORWELL_GAME_BUILD`) that no visible/keyboard/URL path reaches this dialog in the game build; if any does, this becomes a Blocker.

[CA-24] [Severity: Minor] [Effort: <1hr] [Value: Low]
Generic dev-idiom heading ("Danger Zone") beside an unfriendly "Unknown" account-name fallback
- Where: `desktop-15-settings-account.png` — "Danger Zone" heading above "Reset progress"; "Unknown / User" as the account display name/role.
- Problem: "Danger Zone" is a widely-recognized GitHub/dev-tool idiom, not itself game-breaking, but it's one more spot where the settings surface reads as borrowed software chrome rather than an in-house voice; "Unknown" as a player's own display-name fallback is a cold, unfriendly default for what should be a personal, "you are a real houseguest" framing moment.
- Confidence: M.
- Fix: Low priority — rename "Danger Zone" to something in-house ("Leave no trace" / "Start over"), and give the account-name fallback a warmer default ("Houseguest" or the player's chosen in-game name if available) instead of "Unknown".

[CA-25] [Severity: Polish] [Effort: <1hr] [Value: Low]
Sidebar "New Chat"/"Search" labels persist as permanent chrome throughout play
- Where: `index.html` sidebar, visible in every single screenshot in this batch (`desktop-03-chat-home.png` onward) — "New Chat", "Search" sit above "Diary Room"/"Cast" (which ARE well-framed) at all times, including deep into an active season.
- Problem: This corroborates v1's already-logged "workspace machinery visible (model pill/msg counter/nav)" finding — logged here only to note that it is not a one-time onboarding artifact but a permanent, always-visible fixture beside otherwise in-fiction nav items ("Diary Room", "Cast"), which sharpens the contrast between the two vocabularies every single time the sidebar is glanced at.
- Confidence: H.
- Fix: (per v1, not re-scoring) — rename to game-framed equivalents once a season exists ("Start a New Season", "Search the House").

[CA-26] [Severity: Minor] [Effort: <1day] [Value: Low]
Send-fail state gives no explicit remedy text to a screen-reader user
- Where: `frontend/static/js/chat.js:717-733` (`_abortSendKeepMessage`).
- Problem: Beyond CA-2's finding that the "not sent" tag itself isn't reliably exposed to AT, even a sighted user gets only a color/tag change with no instructional text — a screen-reader user who does somehow learn the send failed (e.g., via the top-level banner) still isn't told what to do (retry? re-check settings?). The composer text IS restored (good, message-preserving behavior per the code comment), but nothing announces "your message is back in the composer, ready to resend."
- Confidence: M.
- Fix: Pair the restore with a single polite-live-region announcement, e.g. "Message not sent — it's back in your composer" — reusing the existing toast (`#toast[role=status][aria-live=polite]`) infrastructure already in `index.html:2612`.

[CA-27] [Severity: Minor] [Effort: <1hr] [Value: Low]
Deals gadget's kind/tag layout compounds the missing-name bug into confusing stub rows
- Where: `frontend/static/js/orwellDeals.js:118-146` — when `d.terms` is empty (as in all 3 captured rows), the row renders only "{name} · {kind}" plus a right-aligned status tag, with no fallback terms text.
- Problem: Combined with CA-9 (missing names), an empty-terms + missing-name deal row degrades to "A houseguest · FINAL-2 · ACTIVE" — three fragments with no sentence structure, reading as a broken/incomplete UI rather than a deliberately terse one.
- Confidence: M (this is the same underlying data gap as CA-9, but the layout choice of "no terms fallback" independently worsens the degraded case — logged separately since the fix is presentational, not data-plumbing).
- Fix: Add a terms fallback ("no terms recorded") so the row always reads as a complete sentence even before/independent of CA-9's data fix.


[CA-28] [Severity: Major] [Effort: <1day] [Value: High]
Casting-interview opening narration echoes a raw stub/prompt marker into the player-visible bubble
- Where: `stills/casting-interview-turn1__desktop__light.png` — the very first narrator turn a new player sees reads: **"The house settles for a moment. [stub-echo] (Production cue — begin the casting interview now. Reach out"** (truncated mid-sentence in the capture).
- Problem: `[stub-echo]` is an unmistakable internal test-double marker, and "(Production cue — begin the casting interview now. Reach out..." reads exactly like a leaked system/prompt instruction (an operator-aside telling the model what to do next), not narration — appearing as the FIRST THING a brand-new player reads, in the narrator's own voice, on the single most important onboarding turn (the casting interview opener the vision brief calls out as needing to "feel like being cast, not configured").
- Differential: this telemetry batch explicitly uses "a deterministic key-free stack" (MANIFEST.md) with narrator model `fake/echo-stream` (confirmed in the same session's OOBE screenshot) — i.e., this is very likely the **test double narrator echoing its own prompt** rather than a real LLM's output, which would substantially lower real-world severity. However: (1) CLAUDE.md documents a real, current, in-production risk class this pass repeatedly surfaces (C1: "the model under-calls its levers," weaker/local models are a first-class supported deployment target per the multi-provider gateway) — verbatim system-prompt/instruction echoing is a well-known failure mode specifically for smaller/local models, so the RISK this capture exposes is real even if this exact instance is a test artifact; (2) the fact that the fake narrator's canned response is exactly this fragile format is itself worth a look — if that's genuinely the literal prompt template text sent to real models too (with `[stub-echo]` swapped for real content), any real model that echoes rather than transforms its instructions would reproduce this same leak pattern verbatim.
- Confidence: M (mechanism confirmed harmless *for this capture specifically* given the fake narrator; the underlying risk class is well-evidenced by CLAUDE.md's own C1 discussion).
- Fix: (a) Never ship the literal string "Production cue" / stage-direction phrasing as anything the model could plausibly echo verbatim — keep such instructions fully out-of-band (system role, never in a user/assistant turn the model might quote back); (b) add a lightweight FE output filter (alongside the existing `processWithThinking` reasoning-scrub) that strips bracketed debug markers like `[stub-echo]` and parenthetical "(Production cue...)"-style fragments from anything about to render in the public bubble, as a defense-in-depth net against exactly this class of leak from a real, weaker model.

[CA-29] [Severity: Major] [Effort: <1day] [Value: Med]
Jury-question decision card's heading and attribution contradict each other
- Where: `desktop-09-decision-juror-question.png` — card title "Your jury question — ask the finalist" paired with body text "Ask the finalists your juror question. **(asked by Natalia Matthews)**" — Natalia Matthews is a distinct, previously-evicted NPC (seen nominated/evicted earlier in this same telemetry set), not the player.
- Problem: "Your jury question" (2nd person, addressed to the player) directly beside "(asked by Natalia Matthews)" (3rd person, naming someone else) reads as a straightforward contradiction — is this the player's turn, or is the card narrating a DIFFERENT juror's (Natalia's) turn that the player is merely watching? A pivotal, once-per-game endgame moment (I9's "decision cards are HARD STOPS") is exactly where this ambiguity is most costly — a confused player could submit a question believing it's being asked BY Natalia rather than by them.
- Differential: most likely explanation is a reusable "whose turn is it" attribution field that's meant to show up on a *narration* beat announcing which juror is currently up, but got attached to the player's OWN card in this seeded/synthetic capture (a data-wiring mismatch between "whose turn" metadata and "is this MY card" logic) — flagged with that caveat since it may be specific to this capture's seed state rather than universal.
- Confidence: M (screenshot-confirmed contradiction; root cause in the live attribution-binding logic not traced further per token budget).
- Fix: Trace the `pending` decision-view's attribution field for `juror-question` kind (`orwellDecision.js` `titleFor`/render path) — the "(asked by X)" clause should only ever name the CURRENT juror when it is NOT the player, and should be omitted (or replaced with "it's your turn to ask") whenever the card is rendered as the player's own binding decision.

# Live-debug issue ledger — 2026-06-19

Logged from a live play session (real FE + engine, deepseek-v4-pro). Each item is an issue to
resolve. Status: ☐ open · ◐ in progress · ☑ done. Lane: FE (front-end), ENG (engine), OPS (deploy),
COPY (text). This ledger is the authoritative open-items list for this batch.

## Casting / OOBE flow
- **L1 ☐ FE** — The headshot prompt/studio panel renders **under the "orwell" header and gets jumbled** (z-index / layout); it keeps interfering with the logo throughout the headshot step.
- **L2 ☐ FE** — In OOBE, the **"Open settings" button doesn't open settings** — it only closes the modal back to the main chat screen (broken action; looks wrong).
- **L3 ☐ FE** — During the headshot step, the generation **accordion is collapsed by default** after generating your photos. It should not collapse at all, let alone by default.
- **L4 ☐ FE** — After tapping a desired generated headshot it says **"casting headshot set" but the dialog doesn't dismiss or guide you into the game** — only "make another" / "remove" are offered, and it keeps covering the logo; the only escape is collapsing it manually. Selecting a headshot must dismiss the picker and hand off into the game.
- **L5 ☐ FE/ENG** — Once the headshot is selected, **the producers must send the first message to open the game** — the player should NOT be responsible for the first word. The game opens with the producer's opener.

## Thinking / immersion / accordions
- **L6 ◐ FE** *(agent in flight)* — Model **thinking/reasoning was visible as it streamed** in the game build. Thinking must **never** be shown or expanded by default — not even while generating. It is viewable **only** if explicitly enabled in the backend UI, and that is an **admin-only privileged** choice.
- **L7 ☐ FE** — Every inter-message "action" carries an **accordion** that expands to hidden/empty content. Remove all worthless accordions: if there is nothing to expand, render **no** expand affordance.

## Settings / models
- **L8 ☐ FE** — Selecting only deepseek-v4-pro shows **both "1/341 models enabled" and "341/341 models enabled"** — conflicting counters.
- **L9 ☐ FE (decision)** — The **agent/chat switch** in the chat bar has unclear purpose in this game (play is always a hybrid). Decide whether to remove/hide it in the game build. *Recommendation: hide in the game build.*

## Windows / gadget rail / layout
- **L10 ☐ COPY** — The top-right pane reads **"The house"** → should be **"The House"** (capital H).
- **L11 ☐ FE** — The **cast window is too large and not responsively resizeable**. Every window must be resizeable from the **side and corner** on desktop.
- **L12 ☐ FE (feature)** — Allow **pinning the cast window into the right sidebar** (e.g. two small portraits side by side).
- **L13 ☐ FE (feature)** — Allow **drag-reordering the gadgets** in the sidebar rail.
- **L14 ☐ FE** — The **"Where you are" panel should show first names only**, disambiguating duplicates as "First L." (e.g. `Kevin H` only when two Kevins exist; otherwise `Kevin`). Full names are too wordy.

## Cast generation / portraits
- **L15 ☐ FE/ENG** — While watching the cast generate, the **final photo generated, then all photos vanished and the FE lost the backend connection** (required a full page refresh). The backend must stay responsive during generation and report progress; it must never drop the FE.
- **L16 ☐ FE/ENG** — Some cast photos generated in **B&W**. All portraits must be **full color until a houseguest is evicted**, then rendered **B&W/monotone** (the eviction state is the only monochrome).
- **L17 ☐ ENG/FE (feature)** — After the full cast generates, run an **automated pass for look-alikes / mistakes** and **regenerate** offending portraits until the set is distinct and correct.

## Engine / ops
- **L18 ☐ ENG/OPS** — The engine **hangs and requires an FE reload** at `E22 guard: game turn narrated with no engine write - recording a fallback digest. process count = 2`, then 502s for a few seconds. Investigate the E22 fallback-digest path for the hang; determine if it is a specs/perf issue. **Update deploy defaults to recommend better container specs and document recommendations regardless.**

## Characters / content
- **L19 ☐ ENG** — Expand **archetypes & personas** to be richer than a single reductive word.

## Model output
- **L20 ☐ FE/ENG** — **Trailing question marks on deepseek responses are systematically stripped** from the end of messages (recurring — likely systemic in the stream/sanitize path).

## Carried from the prior transcript (related)
- **L21 ☐ ENG/FE** — **Whereabouts cohesion**: NPC + general whereabouts contradict across turns (Garrett "on the couch" → "still to arrive"; player moved to the living room → "still in the kitchen"). The model invents positions instead of grounding to the engine's `whereabouts`, and player movement isn't persisted. Surface whereabouts in the per-turn GAME CONTEXT (the C8-04 ceremony-context pattern) and persist player room moves so the picture stays consistent.
- **L22 ◐ ENG (prompt)** — **Setting must stay fixed to the LA house.** Narration relocated the world to the **player's hometown** (it scraped the player's stated origin and set the scene there). Every season happens in the Big Brother **house in Los Angeles**, full stop — the model must NEVER move the setting to anyone's hometown/backstory (no off-site scenes, no hometown weather/landmarks). Origin colors who a houseguest IS, never WHERE the game happens.
- **L23 ◐ ENG (prompt)** — **Stop re-describing bodily features.** Physical description (hair, build, etc.) is helpful to establish a houseguest in the first few moments, but with cast **headshots** present it is redundant thereafter — past intros the model should describe **demeanor / personality / behavior**, not physical appearance.

---
### Triage (suggested order)
1. **Critical immersion/loss:** L6 (thinking, in flight), L15 (generation drops FE), L18 (engine hang), L20 (stripped `?`), L4/L5 (casting hand-off), L1 (logo overlap).
2. **High-value polish:** L7 (empty accordions), L8 (model counter), L3 (accordion default), L14 (first names), L10 (capital H), L21 (whereabouts).
3. **Features/larger:** L11 (resizeable windows), L12 (pin cast), L13 (drag-reorder), L17 (look-alike pass), L16 (color/B&W), L19 (richer personas), L9 (agent/chat switch decision), L2 (OOBE settings button).

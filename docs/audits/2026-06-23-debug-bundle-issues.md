# Open Issues — 2026-06-23 debug-bundle playtest

Source: live playtest + debug bundle `orwell-debug-2026-06-23T02:39:07Z` (user `rhino`,
session "Casting interview", model `deepseek/deepseek-v4-pro`). Seven issues, root-caused
against `main`. **Two are mandate violations (Vault Wall / no-canon-about-the-player) and are
launch-blockers.** This file is a tracker; each issue should become a spec/queue item or PR.

**Cross-cutting principle (owner ruling, 2026-06-23):** *If the game engine does not have
something that is REQUIRED, it must surface an ERROR immediately.* No defaulting, no
fabrication, no silent fallback for required state — especially anything that would invent
canon about the human player. Issues #1 and #6 are the same ruling.

---

## ISSUE-1 / ISSUE-6 — Engine fabricates canon about the human player ⛔ MANDATE (launch-blocker)

**Severity:** critical — violates "we generate NO canon around the human player" and the
error-on-missing-required ruling.

**Symptom:** the player profile is populated with attributes the player never authored
("devon hale, scrappy"-type content). `"Devon Hale"` is actually an example string in an
extraction prompt (`frontend/src/agent_loop.py:2119`) and `"scrappy"` is a competition tier
word (`src/engine/characterFactory.ts:783`) — both red herrings — but they surfaced the real
bug: the player gets invented attributes.

**Root cause:** `runPlayerOOBE` (`src/engine/characterFactory.ts:655-703`) requires only `name`
and silently fabricates the rest:
- Physical **appearance fabricated from the name hash** — `new SeededRandom(hashSeed(input.name))`
  (`:665`) → `generateAppearance(...)` (`:686`) deals build/complexion/hair/features/look from
  the NPC pools. The human never described their looks; this then feeds the player portrait
  prompt (`portraitDescriptorFor`, `:801`).
- **Archetype defaults to `"floater"`** (`DEFAULT_ARCHETYPE`, `:652`, `:660-661`) and drives the
  player's hidden **stats** (`stats: { ...spec.bias }`, `:684`) and persona (`:696-697`).
- **Background defaults** to a placeholder string (`:685`).

**Fix:**
- Do **not** generate a player appearance — the player has no authored looks; leave empty (or
  require the player to supply it). Player portrait must not be improvised from a name hash.
- A missing required casting field (archetype/strategy/name) must raise an explicit
  casting-incomplete **error** surfaced to the FE — never `DEFAULT_ARCHETYPE`/placeholder.
- FE `createCharacter` finalize fallback must refuse to finalize when required casting fields
  are absent, surfacing the gap instead of letting the engine fill blanks.

**Files:** `src/engine/characterFactory.ts:652-703,801`; FE finalize fallback in
`frontend/src/agent_loop.py` + `frontend/routes/chat_helpers.py` (createCharacter finalize).

---

## ISSUE-2 — Casting-interview content leaked to an NPC ⛔ VAULT WALL (launch-blocker)

**Severity:** critical — Vault Wall breach. Private interview content ("I'm a camp counselor",
revealed only to producers) was known in-game by an NPC ("alisha garner").

**Root cause:** a **prompt-level** leak, not state-level. The engine is clean — private fields
(`privateStrategy`/`motivation`/`interviewNotes`) land only on the player's own houseguest/soul
(`src/engine/characterFactory.ts:666-700`) and `npcVoice` never reads them
(`src/adapters/engine/GameSessionAdapter.ts:824-885`). The leak is in the FE conversation
history: the casting interview is a normal chat and the *same LLM* later voices NPCs. Casting
turns are meant to be excluded via a `phase=="casting"` stamp
(`frontend/routes/chat_helpers.py:2533-2570`, `frontend/core/models.py:101-107`), but exclusion
**depends on every turn being individually stamped** and the stamp can miss at the finalize
boundary (`game_active` is computed once at turn-start, `chat_helpers.py:1634-1635`) or for any
turn persisted without the stamp. An unstamped casting turn stays in context → the NPC-voicing
model has the private fact in its prompt.

**Fix:** make exclusion **structural, not per-message** — once the season is live, exclude every
history turn before the `createCharacter` season-start boundary (by timestamp/sequence), and
treat any unstamped pre-game turn as casting. Strengthen `frontend/tests/test_casting_leak_gate.py`
with an *unstamped* casting turn that must still be excluded. Engine needs no change (don't
weaken it).

**Files:** `frontend/routes/chat_helpers.py:1634-1635,2533-2570`; `frontend/core/models.py:101-107`;
`frontend/tests/test_casting_leak_gate.py`.

---

## ISSUE-3 — Repetitive cast features (red hair / olive skin clustering)

**Severity:** medium — behavioral/visual fidelity.

**Root cause:** skin tone, build, ethnicity, demeanor, and age all have cast-wide spread caps
(`MAX_PER_*`), but **hair, facial features, distinguishing mark, and style do not** — they're
drawn by independent per-NPC `rng.pick()` (`src/engine/deepProfile.ts:202-212`) from ~12-entry
pools, so across 15 NPCs collisions are expected. The live-model authoring path
(`frontend/src/orwell_cast_authoring.py`) re-clusters on its own auburn/olive priors because each
NPC is authored in an isolated call; the 2026-06-23 re-grounding fix
(`GameSessionAdapter.ts:993-1007`) only covers `skinTone`, leaving hair free.

**Fix:** extend the existing `spreadFacet`/`MAX_PER_*` cap to hair (most salient), facial
features, and style — deal them cast-wide instead of per-NPC; optionally widen the pools. For the
LLM path, enforce hair-color spread on write-back in the engine (same place skin tone is
re-grounded).

**Files:** `src/engine/deepProfile.ts:155-212,839-867`; `src/engine/diversityConstants.ts` (cap
pattern to mirror); `src/adapters/engine/GameSessionAdapter.ts:993-1007`;
`frontend/src/orwell_cast_authoring.py:45-78`.

---

## ISSUE-4 — Same NPC, different portrait photos across two browser sessions

**Severity:** high — cross-session/device consistency.

**Root cause:** portraits persist to FE disk keyed by account + role id (both sessions read the
same file) with `?v=<epoch>` cache-busting, but the epoch only rotates on a **new cast**
(different name). When the deeply-authored profile lands mid-season the portrait prompt changes
and the 0065 fingerprint path **re-shoots the PNG in place**
(`frontend/src/orwell_portraits.py:1390-1414`) **without bumping the epoch** — so the URL is
byte-identical and, with `Cache-Control: private, max-age=86400`
(`frontend/routes/orwell_routes.py:868-872`), one browser keeps the old cached face while a fresh
session fetches the re-shot one. The 6× `recordImageBeat` EngineRefusal in the bundle are those
same re-shoots hitting the image budget (wired correctly; budget firing correctly) — a symptom,
not a wiring break.

**Fix:** bump the cache epoch whenever portrait *bytes* are replaced in place
(`_write_portrait`, `orwell_portraits.py:929-951`). Follow-up: gate the move-in shoot until the
NPC is authored so we don't shoot a seeded-floor face that's immediately re-shot.

**Files:** `frontend/src/orwell_portraits.py:929-951,1390-1414`;
`frontend/routes/orwell_routes.py:868-872`.

---

## ISSUE-5 — Typed text disappears, an empty form is submitted

**Severity:** medium — wastes a turn, confuses game state.

**Root cause:** two `keydown` Enter listeners are bound to `#message`
(`frontend/static/app.js:3264` and `app.js:3833`) and **both fire on one Enter press** — handler
#1 uses `stopPropagation()` (not `stopImmediatePropagation()`), which does not stop a sibling
listener on the same element. Handler #1 triggers submit (which clears the textarea at
`frontend/static/js/chat.js:731`); handler #2 then runs against the emptied field → "text
vanishes then empty send." The empty-guard (`chat.js:536`) is bypassed when attachments are
pending.

**Fix (preferred):** delete the duplicate Enter handler at `app.js:3264-3282` (the `:3833` one is
complete). Also capture-and-lock the textarea value at the very top of `handleChatSubmit` before
any `await`.

**Files:** `frontend/static/app.js:3264-3282,3833`; `frontend/static/js/chat.js:533,536,731`.

---

## ISSUE-7 — Time-of-day conflict between chat narration and UI/HUD

**Severity:** medium — narration/state desync (feature 0066).

**Root cause:** the engine is the single source of truth (`LiveSeasonState.timeOfDay`, advanced
per `advanceGame`) and the HUD reads it correctly (`/api/orwell/state` →
`frontend/static/js/orwellNightStatus.js`), but the **narration prompt never injects it** —
`renderGameContext` (`src/engine/momentPrompts.ts:673-875`) emits week/phase/day but **not
`view.timeOfDay`**, though the view carries it. So the LLM improvises time-of-day as flavor and
drifts from the HUD. Secondary: the re-entry fragment hardcodes "open with a fresh morning scene"
(`momentPrompts.ts:593`) regardless of the real clock.

**Fix:** add a time-of-day line to `renderGameContext` ("voice THIS hour; never narrate a
different time of day"), guarded on `view.timeOfDay` being present (absent ⇒ byte-identical);
change the hardcoded "morning" on re-entry to defer to the engine clock. Add a `renderGameContext`
prompt-injection test (none exists today).

**Files:** `src/engine/momentPrompts.ts:593,673-875`; `src/ports/GameSession.ts:57,200`
(view already carries `timeOfDay`/`restStatus`).

---

### Triage summary

| # | Issue | Severity | Tier |
|---|---|---|---|
| 1/6 | Engine fabricates player canon (appearance/archetype/stats) | critical ⛔ | engine + FE |
| 2 | Casting interview leaks to NPC (prompt-level) | critical ⛔ | FE |
| 4 | Portrait differs across sessions (cache epoch) | high | FE |
| 5 | Typed text disappears → empty submit (double Enter handler) | medium | FE |
| 3 | Repetitive cast features (uncapped hair/features) | medium | engine + FE |
| 7 | Time-of-day chat↔HUD desync (narration not pinned) | medium | engine |

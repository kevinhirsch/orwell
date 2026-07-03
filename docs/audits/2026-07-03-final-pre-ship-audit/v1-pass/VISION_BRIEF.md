# ORWELL — VISION BRIEF (Phase 0, final pre-ship audit, T-14 days)

Shared context for every audit agent. Audit AGAINST this; do not re-derive your own.
Reconstructed from the highest-signal artifacts (GM prompt `src/engine/momentPrompts.ts`,
ADRs 0001–0016, the four-mandate block in CLAUDE.md, the BDD `.feature` corpus, the FE
framing/belts in `frontend/routes/chat_helpers.py` + `frontend/src/agent_loop.py`, the
ship-gate `docs/audits/2026-06-27-ship-gate.md`) — NOT from current behavior.

## The core fantasy
You are a real houseguest inside a real season of Big Brother **that does not revolve
around you**. The house schemes, bonds, and betrays off-screen whether or not you are
looking. Your only instrument is conversation. The game is whether you can read a living
social world through partial, distorted information, move it with words, and survive it —
and the win must be EARNED against an engine that is structurally incapable of loving you.

## The emotion it sells
Paranoia braided with intimacy, paid off by dramatic irony. The two peak moments the whole
architecture exists to produce: (1) being genuinely blindsided by a plot you never saw —
and later learning (retrospective/unsealing, 0048) it was real, recorded, and fair all
along; (2) pulling off your own blindside through social play the engine faithfully
recorded but never assisted. Trust formed, tested, betrayed — with receipts.

## A great single session
Casting interview that feels like being *cast*, not configured → premiere where 15
strangers become distinct people → unhurried social runway (lingering IS play; nothing
force-marches the week) → a comp with real stakes resolved by stats+temperature, never
story → a ceremony that lands as an exclusive set-piece event → the lived aftermath
scramble → log off with theories, not certainty. Time moves beat-by-beat, only when the
game moves it (no montage). The player leaves *suspecting* — never knowing.

## THE INVARIANTS (violating any of these = Orwell is no longer Orwell)
- **I1 VAULT WALL.** Secret state never reaches player OR admin, enforced at the
  port/tool boundary in code, never by prompt. Sole sanctioned exception: the quarantined
  out-of-band `producerVault` debug unseal. God Mode is walled too — spoilers ruin the game.
- **I2 THE ENGINE DECIDES.** Every outcome (comps, noms, votes, eviction, jury) comes from
  the deterministic core + seeded randomness. Narration voices results; it never invents,
  alters, foreshadows-as-settled, or protects the player. Flavor is the model's; outcomes
  are the game's. (The GM prompt's "bright line".)
- **I3 KNOWLEDGE MOVES ONLY THROUGH PATHWAYS.** A houseguest (incl. the player) knows only
  what they witnessed or were told; hidden facts diffuse NPC-to-NPC with drift; the player
  may SUSPECT freely but can only KNOW what a recorded pathway delivered.
- **I4 EVERY SCENE HAS CONSEQUENCE.** Action → recorded event → hidden fold into the
  relationship/soul layer → persisted → recalled. An action narrated but never recorded
  has no consequence and no memory — the cardinal implementation sin.
- **I5 NOTHING THINS.** Persisted detail accumulates and deepens across a season and
  across restarts. Non-degradation is a hard property, not an aspiration.
- **I6 PEOPLE MAKE SENSE.** One place at a time; speech scoped to legitimate knowledge;
  stable public persona (which may diverge from the hidden self); ~16 DISTINCT voices.
- **I7 THE HOUSE SCHEMES WITHOUT YOU.** Off-screen NPC-to-NPC life exists, is rich, and
  matters — behavioral fidelity is priority #1; a mechanically-correct but socially-thin
  build is a failure state.
- **I8 THE FEELINGS ARE YOURS.** The engine computes relationship edges both directions
  but never shows a number and never asserts the player's own feelings. Paranoia and
  loyalty are the human's to form from observable behavior only.
- **I9 THE MACHINERY IS INVISIBLE.** No engine/tool/app/system talk in anything the player
  sees; no operator asides; reasoning never in the public bubble (channel split by
  construction); decision cards are HARD STOPS; live-moment-only time discipline; OOC
  glitch complaints never enter the fiction.
- **I10 THE GAME IS FAIR AND REPRODUCIBLE.** Hard eligibility/legality rules never bend;
  seeded RandomnessSource makes seasons replayable-different; one active game per user,
  absolute cross-user isolation.

## Contradictions latent IN the code (each is a standing finding — probe them)
- **C1 Who is the DM?** ADR 0003 says "get out of the model's way"; the build carries ~12
  FE guardrail belts (stall-nudge, auto-record, forced advance, outcome guard, forced
  tool_choice at beats) because the model under-calls its levers. ADR 0016 (GLM-4.7) is
  the bet that a better model needs fewer belts — but the belts now ARE gameplay-critical
  paths. Probe: belts that error-correct (sanctioned) vs. belts that quietly AUTHOR or
  suppress (violation). The measured ~0% spontaneous tool-call rate is the scar.
- **C2 An immersive game wearing a workspace's clothes.** The FE is a vendored general
  chat workspace; `ORWELL_GAME_BUILD=1` gates the reduced surface, but plumbing (model
  pickers, token economy, endpoints, presets) coexists with a fiction that forbids naming
  the machinery. Probe every player-visible surface for workspace bleed-through.
- **C3 The living house vs. the paused world.** Fantasy says the house lives; the owner's
  ruling says pure turn-driven (the house does NOT advance while the player is away — a
  fairness call). The reconciliation is one bounded off-screen tick per player turn.
  Probe: does the fiction ever *claim* time passed that the engine didn't move?
- **C4 Engagement pacing vs. anti-sycophancy.** "Seize the lull" asks the model to judge
  player engagement — a subjective read adjacent to people-pleasing. Probe where pacing
  heuristics could bend outcomes or bury beats.
- **C5 Chat-is-the-UI vs. the HUD ecosystem.** 0022 (rich UI) deliberately deferred; ADR
  0003 says UI may augment but never replace a game-building interaction. The gadget
  rail/windows keep growing. Probe any UI that *replaces* conversation.
- **C6 Spec ceiling ahead of build.** 0087–0104/0107 are drafted, mostly unbuilt
  (opt-in/default-off). Not a defect per se — but probe for half-wired flags/stubs.

## Ship context (from docs/audits/2026-06-27-ship-gate.md — the launch bar)
F1–F5 (FE airtight under multi-window concurrency) + G1–G9 (real-model casting→eviction
golden path) all PASS as of 2026-06-27. Launch-blocker = anything that breaks those on
the golden path. Severity concentrated historically in ONE seam: model↔engine (every CI
gate stubs the LLM). Weigh findings accordingly: a casting/premiere/narration-seam defect
is worth more than its surface size suggests.

---

# AUDIT LOGISTICS (read carefully; token-frugal discipline)

**Repo:** `/home/user/orwell` (main checkout, detached at origin/main). READ-ONLY unless
you are a live agent working in your own worktree. NEVER `git stash`. NEVER modify the
main checkout. Do not run the full test suites (they're CI's job; you're auditing).

**Be token-frugal:** grep/sample first, read narrowly (offset/limit), never read
`frontend/static/style.css` or `chat.js` end-to-end — target your reads. Prefer one
precise finding over ten vague ones, but be EXHAUSTIVE — keep going until you run out of
real issues, then say so explicitly.

**Live stacks (live agents only — each in YOUR OWN worktree):**
- Engine (shared build, own data): `ORWELL_DATA_DIR=<your-scratch-dir> ORWELL_ENGINE_PORT=<your-port> ORWELL_ENGINE_TOKEN=devtoken node /home/user/orwell/dist/main.js` (background).
- FE (your worktree = pristine first-run data): `cd <your-worktree>/frontend && ORWELL_ENGINE_MCP_URL=http://127.0.0.1:<engine-port> ORWELL_ENGINE_TOKEN=devtoken AUTH_ENABLED=false /home/user/orwell/frontend/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port <fe-port>` (background).
- Playwright chromium: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, venv python has playwright.
- Port allocation — JOURNEY: engine 8770 / FE 7010 · ADVERSARIAL: 8771/7011 · A11YPERF: 8772/7012.

**FINDING SCHEMA (exactly this, one per finding):**
```
[<AGENT>-<n>] [Severity: Blocker|Major|Minor|Polish] [Effort: <1hr|<1day|multi-day]
Title
- Where: file:line / screen / flow (+ repro if behavioral)
- Problem: what's wrong; why it hurts the player OR which invariant/contradiction (I1–I10/C1–C6) it violates
- Fix: the specific change (an action, not "improve X")
```

**Output:** write your COMPLETE findings to
`/tmp/claude-0/-home-user-orwell/64f794e3-d262-5650-8a8e-a97d8a6871f0/scratchpad/audit/<agent>.md`
with (1) a compact index table `id | severity | effort | title | where` at top, then
(2) every finding in full schema. Your RETURN MESSAGE to the orchestrator: counts by
severity, your top 5 findings (one line each), any cross-territory flags, and the words
"ran out of real issues" if and only if true. Do NOT paste the whole file back.

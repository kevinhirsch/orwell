# ORWELL — EXHAUSTIVE PRE-SHIP AUDIT v2 (CHARTER)

**Read first:** the shared vision brief at
`/tmp/claude-0/-home-user-orwell/64f794e3-d262-5650-8a8e-a97d8a6871f0/scratchpad/audit/VISION_BRIEF.md`
— it holds the core fantasy, the 10 INVARIANTS (I1–I10), the 6 latent CONTRADICTIONS
(C1–C6), and the ship context. Audit AGAINST it. This charter changes the MANDATE, not the vision.

## THE MANDATE HAS CHANGED — this pass is EXHAUSTIVE, not frugal

The owner's verdict on the current build: **"in its current form it's unplayable"** — problems
span FE↔BE comms, prompt engineering, UI, UX, bugs, mobile, game consistency, immersion, and
features that don't serve the spirit of the game. A prior audit pass was **too shallow** (lanes
returned 2–5 findings and declared "clean" — that is UNDER-HUNTING on a surface this broad, not
evidence of quality). Ships in 14 days.

**Your job: find what the last pass missed, at every level, no matter how small.** The target is
DEPTH and VOLUME. Concretely:
- **Aim for 25–80 findings in your lane.** If you have fewer than ~20, you have not looked hard
  enough — go deeper (more surfaces, more states, more edge cases, more scrutiny of tone/polish).
- **"Ran out of real issues" is only acceptable after you have genuinely exhausted your territory**
  — every screen, every state (loading/empty/error/success/offline/stale), every flow, every
  breakpoint, every phase of the game, every prompt rule, every piece of copy. Say WHERE you looked.
- **Include everything, not just bugs:** UX friction, confusing microcopy, weak empty/error states,
  visual-hierarchy/typography/spacing/color problems, motion that's janky or missing, IA/wayfinding
  gaps, cognitive-load spikes, mobile breakage, immersion breaks, tonal misses, **product gaps**
  (things that should exist and don't), and **spirit gaps** (features that exist but fight or
  under-deliver the vision). Polish-tier findings are wanted — this is a "realize the vision 200%"
  pass, not just a triage.
- **Be concrete and actionable.** No "improve X." Name the file/line/screen and the specific change.
- **Do NOT re-report the ~41 prior findings** (index below) — build past them. You MAY corroborate
  one (two independent hits raise its priority) but spend your effort on NEW ground.

## Prior findings (v1 — dedupe against these; find NEW ones)
Blocker: empty-narration on marquee social turn. Major: phantom-houseguest premiere; ceremony
montage / forced-tool_choice runway collapse; `update_plan` TODO-dashboard leak; casting
max_tokens truncation; write-back beatSeq omission. Minor/Polish: setInterval leaks×5; stale
welcome card; workspace machinery visible (model pill/msg counter/nav); non-binding comp-round
buttons; eviction-vote not a card; concatenated-beat markdown; roster empty-flash; first-name
belt suppression; OOC-aside mis-record; runway readiness vocab; producerVault direct-HTTP unseal;
empty-edges no-op; dead code; focus-ring contrast; duplicate isNarrow; "N of 15 met" counter.

## FINDING SCHEMA (exactly this; one per finding)
```
[<AGENT>-<n>] [Severity: Blocker|Major|Minor|Polish] [Effort: <1hr|<1day|multi-day] [Value: High|Med|Low]
Title
- Where: file:line / screen / flow (+ repro or exact location)
- Problem: what's wrong; who it hurts (player / vision); which invariant/contradiction (I1–I10/C1–C6) if any
- Fix: the specific action
```
`Value` = impact-on-the-shipped-product per unit effort (High = do-it-now). The owner explicitly
wants the "highest-value quickest wins" surfaced, so score it honestly.

## LOGISTICS (token discipline still applies to HOW you work, not how much you find)
- Repo `/home/user/orwell` (READ-ONLY; never modify the main checkout; NEVER `git stash`).
- Do NOT run the full test suites. Do NOT read `style.css`/`chat.js` end-to-end — grep-then-narrow.
- Telemetry (screenshots, filmstrip, DOM-mutation + network logs, transcript) will be captured to
  `/tmp/claude-0/-home-user-orwell/64f794e3-d262-5650-8a8e-a97d8a6871f0/scratchpad/audit2/telemetry/`.
  If your brief says "read the telemetry," start there. If it's not yet present and you need it,
  say so and audit from source + `scratchpad/audit/journey-debug-bundle.json` +
  `scratchpad/audit/shot-desktop-home.png` / `shot-mobile-home.png`.
- Live agents: your OWN git worktree; ports assigned per-agent in your brief. Key-free deterministic
  narrator for UI/layout/motion; the real key (GLM-4.7) is at `scratchpad/.or_key` for behavioral runs
  (NEVER print/log/commit it). Follow SOUL lesson 17's recipe + traps for a real-model stack.
- **OUTPUT:** write your COMPLETE findings (index table first: `id | sev | effort | value | title |
  where`, then every finding in full schema) to
  `/tmp/claude-0/-home-user-orwell/64f794e3-d262-5650-8a8e-a97d8a6871f0/scratchpad/audit2/<agent>.md`.
  RETURN to the orchestrator ONLY: counts by severity, your top 8 one-liners, cross-territory flags,
  and where you looked / what you did NOT cover. Do not paste the whole file back.

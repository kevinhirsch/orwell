# 0037 — Live jury-vote choreography (the interactive finale)

> **Status:** Draft. The **live realization of 0014 §5–6** — the Final 2 finale as an interactive,
> staged sequence inside the running game, not a single auto-resolved winner. The pure jury logic
> (`src/engine/jury.ts` — `juryLean`, `castJuryVote`, `finalePerformance`, `tallyJuryVote`, `runFinale`)
> is **green (0014)** but the live loop ignores almost all of it: `liveSeason.runFinale` hard-codes a
> crude `trust+affinity` comparison, never records eviction **manner**, never surfaces the **statements /
> questions**, never calls **`finalePerformance`**, and announces the winner in **one** beat. 0037 wires
> the built logic into the live loop and adds the missing choreography — the same "built-in-isolation,
> wire-it-live" pattern as **0034 / 0035 / 0036**.
> **Executable spec:** [`0037-live-jury-vote-choreography.feature`](./0037-live-jury-vote-choreography.feature)

## 1. Summary

At Final 2 the live game must stage the finale, not skip to a winner:

1. **Opening statements** — each finalist gives one (the player writes theirs when a finalist).
2. **Question round** — each of the **9 jurors** asks one question; when the player is a finalist they
   **answer every question** (the "Full" choreography), each answer carrying a **structured appeal** the
   engine scores; the NPC finalist's answers are auto-voiced.
3. **The vote** — when the player sits on the **jury** they cast their **own** vote (the other jurors are
   engine-decided); when the player is a finalist all 9 jurors are engine-decided.
4. **Staged reveal** — votes are revealed **one at a time** in the engine's reveal order, then the winner.

The vote stays **engine-decided** (mandate #3): **jury management dominates** — relationship +
**recorded eviction manner** (blindside / betrayal / disrespect / respect) — and the finale **sways close
jurors but never overturns a clear lead**. The finale sway is driven by the player's **engine-legible
structural choices** (which appeal they make to which juror), **never** by the LLM grading prose. The
**last-evicted juror** breaks a tie (0005/0014).

## 2. The three product decisions (resolved)

| Decision | Choice | Consequence |
|---|---|---|
| Player-finalist interactivity | **Full** | Player gives a statement **and** answers **every** juror question; each answer is a binding `submitDecision` carrying an appeal. |
| Finale sway model | **Engine-legible** | The sway is `appealEffect(appeal, rel, manner)` — a structured enum scored by the engine, **bounded** by `JURY_WEIGHTS.finale`. The LLM voices jurors + narrates answers but **never** scores them. |
| Player-as-juror | **Interactive** | When the player is a juror they ask a question (flavor) and **cast their own vote** via `submitDecision`; the other 8 are engine-decided; an illegal vote is rejected. |

## 3. Scope

**In:** record **eviction manner** on each live eviction (so jury management has live effect); drive the
finale as a staged sub-loop in `liveSeason` (statements → questions → vote → one-at-a-time reveal); new
**Vault-free** player decisions (`finale-statement`, `finale-answer`, `juror-vote`) through the existing
`advanceGame` / `submitDecision` seam (0034); the **engine-legible** appeal scoring + bounded finale sway
wired into the live tally via `castJuryVote` / `juryLean` / `finalePerformance` (0014 — reused);
**persist** an in-progress finale so it survives restart (0030); **sentinel-clean** finale surface (0001).

**Out:** the pure jury math (built — 0014; reused, not changed); the front-end UI that renders the
statements/questions/reveal in chat (a small follow-up on the 0032 game build, like 0036's C10 — the
agent can already drive it through the tools); NPC **confessional** content (Vault-only).

## 4. Design

### 4.1 Engine-legible appeals (the anti-sycophancy crux) — `jury.ts`
A small structured enum the player picks per answer; the engine scores it against **that juror's** state.
The LLM voices the exchange but the **number comes from the engine**.

```
type FinaleAppeal = "own-game" | "mend" | "connect" | "discredit-rival"
appealEffect(appeal, rel: JuryRel, manner: EvictionManner): number   // quality in [0,1]
  own-game        : lands with jurors who respect the game (some threat, not betrayed); backfires on the betrayed
  mend            : lands ONLY where there is a grievance (blindsided/betrayed/disrespected) to address; wasted otherwise
  connect         : scales with affinity
  discredit-rival : small generic lift; backfires with a juror loyal to the rival
```
`finalePerformance` (0014) already averages `{ quality }`; the per-juror `quality` is `appealEffect(...)`.
The sway stays bounded by `JURY_WEIGHTS.finale = 0.3` (well below `relationship 1.0` + `manner 0.8`), so a
strong finale tips **close** jurors and **never** overturns a clear lead.

### 4.2 Eviction manner — recorded live (`liveSeason.ts`)
On each `applyEviction`, record, per evictee, an `EvictionManner` toward each **responsible** houseguest
(the HOH who nominated them, and every voter who voted to evict): a houseguest the evictee **trusted**
(`edge(evictee, h).trust > τ`) who moved against them ⇒ **betrayed**; an eviction the evictee did not see
coming (no prior threat read) ⇒ **blindsided**. Stored on the live state, persisted (0030). At the finale
`juryLean(juror, finalist)` reads `manner[juror][finalist]`, so how the finalist treated each juror on the
way out genuinely shapes the vote.

### 4.3 Live finale sub-loop (`liveSeason.ts`)
A `finale` sub-state machine advanced one step per `advance()`:
- **statements**: player-finalist ⇒ `pending: finale-statement` (free-text flavor; no score); NPC ⇒ auto beat.
- **questions**: for each juror question, player-finalist ⇒ `pending: finale-answer { juror }` carrying an
  appeal; NPC-finalist answers auto. The chosen appeal is recorded.
- **vote**: player-juror ⇒ `pending: juror-vote`; all others computed via `castJuryVote` with
  `leanOf = juryLean(edge, manner)` and per-`(juror,finalist)` `perfOf = appealEffect(...)`.
- **reveal**: emit one `finale-reveal` beat per juror in `revealOrder`, then a `finale-result` beat naming
  the winner; tie → last-evicted juror (`tallyJury`, reused).

Binding choices change state **only** through `submitDecision` (0034); illegal choices are rejected.

### 4.4 Outward surface (`GameSession` port + adapter) — Vault-free
`PendingDecisionView.kind` gains `"finale-statement" | "finale-answer" | "juror-vote"`; `AdvanceView`
optionally carries the Vault-free `finale` projection (current stage, the juror asking, the finalists by
name, the reveal-so-far). `SubmitDecisionReq` gains `statement?`, `appeal?` (and reuses `vote?` for the
juror vote). **No leans, no vote tallies, no manner, no souls** ever cross — the player sees names,
prompts, the appeal options, and the reveal as it is narrated. `readsVault: false`; extend the 0001 canary.

## 5. Contracts (stack-agnostic)

```
appealEffect(appeal, rel, manner) -> number in [0,1]          // engine-legible; LLM never grades
recordEvictionManner(evictee, responsible[], rel)             // on each live eviction; persisted (0030)
advanceGame(): AdvanceView                                    // now steps the finale; pauses for finale decisions
submitDecision({ kind:"finale-statement", statement })        // player-finalist opening (flavor)
submitDecision({ kind:"finale-answer", appeal })              // player-finalist answer → bounded sway
submitDecision({ kind:"juror-vote", vote })                   // player-juror vote; illegal rejected
   → tally = castJuryVote per juror (leanOf=juryLean(edge,manner), perfOf=appealEffect); tie→last juror
   → reveal one juror at a time (revealOrder); finished:true + winner at the end
```

## 6. Definition of Done

- [ ] **Staged finale:** at Final 2 the live loop surfaces statements + a per-juror question round + a
      one-at-a-time reveal — not a single auto-resolved winner.
- [ ] **Full interactivity (finalist):** the player gives a statement and answers **every** juror question;
      each is a validated `submitDecision` (never parsed from prose).
- [ ] **Interactive juror:** when the player is a juror they cast their **own** vote; the other 8 are
      engine-decided; an illegal vote is rejected, state unchanged.
- [ ] **Jury management dominates:** across seeds, a finalist who **blindsided/betrayed** jurors wins less;
      recorded eviction manner measurably lowers those jurors' leans (property test).
- [ ] **Engine-legible, anti-sycophantic sway:** a strong finale **sways close jurors but never overturns a
      clear lead** (calibrated, bounded by `JURY_WEIGHTS.finale`); the appeal is a **structured choice** the
      engine scores — the LLM never grades prose into a win (asserted with a seeded fake).
- [ ] **Tally + tie-break:** most votes wins; a tie breaks to the **last-evicted juror** (reused 0014).
- [ ] **Vault-free:** the finale surface is **sentinel-clean** under a populated Vault (extend the 0001
      canary); no leans/tallies/manner leak before the reveal; `readsVault:false`; `npm run test:arch` green.
- [ ] **Persist + recall:** a finale in progress persists and resumes at the exact stage after a restart (0030).
- [ ] **Deterministic:** same seed + same player choices ⇒ identical finale and winner.
- [ ] Name-agnostic `.feature` (roles only — finalist/juror/evictee) added to `cucumber.cjs`; `npm test` green.

## 7. Dependencies & traceability

The **live realization of 0014** (jury & endgame), reusing `jury.ts` (`juryLean`/`castJuryVote`/
`finalePerformance`/`tallyJuryVote`/`runFinale`) and `season.tallyJury` (0005 tie-break) verbatim, wired
through the **0034** `advanceGame`/`submitDecision` seam, persisted by **0030**, under **0001** (Vault Wall),
**0002** (jury leans = relationship signals), and **0021** (isolation). Pairs with **B21/0018** (the lever
manifest must name the finale decisions). Front-end consumption (render statements/questions/reveal in
chat) is a small follow-up on the **0032** game build — the agent can already drive it through the tools.

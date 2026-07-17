# Lane: Game Design Review — Onboarding, Pacing & the Gadget Rail

> Source digest: `game-design-review-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign).
> Lens: onboarding, Day-1, pacing, and the gadget rail. Evidence: 0111/0050/0066/0092/0102 specs,
> `ROAD-TO-MARKET.md`, the owner's 64-message playthrough + `llmIo` records, the gadget-rail registry.

---

## Verdict

The MACHINE held (real seeded HOH the player lost; belts glued 13 unrecorded scenes; $0.32/90min at 64%
cache hit). The SHOW did not. "Narrator doesn't pace itself" decomposes into five fixable defects; none
is "the model is bad at narrating."

## Beat-by-beat diagnosis

- Casting (9 exchanges): genuinely good; Clay has a voice; curiosity needle lands (MSG 17). Dents: MSG 5
  visibly duplicated text; cast-photo ask is the very first beat (chore-first opening).
- Key handoff MSG 17→19: MISSING BEAT — no cast-reveal/key/pack-your-bags moment.
- Champagne circle MSG 19-21: engine met-all-at-toast worked; model delivered ALL 14 intros in one
  ~5,000-char wall. Player verbatim: "Oh my gosh that was so much info I'm probably not going to remember
  it all." Prompt already says "a few at a time... not a flat roll-call" (llmIo record 37) — GLM-4.7
  IGNORES it.
- Cast coherence: record 45 — "Donna Porter — 22 ... retired school principal ... thirty years shaping
  young minds ... widowed mother of three." Cause: cast-genesis committed nothing; 6/15 fell to
  deterministic floor; floor identity welded to authored backstories. (`castingIntake.ts` has an
  age/span coherence scan — player-only today.)
- Voice blur: 4 NPCs same verbatim hot take; Julia's "house is a system" speech twice word-for-word.
- Duplicated-scene bug MSG 23: round 1 streams scene → auto-move belt fires → overseer flags
  advance-desync → reinject-delta → round 2 re-narrates from scratch → FE appends both. reinject-delta
  fired 7x; visible dups 3x (MSG 5, 23, 31). THE "stuttering narrator."
- Teleport MSG 27→29: narrated hallway exit never became `moveTo`; engine whereabouts stayed bedroom-b;
  model obeyed engine truth and contradicted its own prose. 5 presence desyncs re-grounded.
- Roll-call relapse MSG 36-49: six player turns on met/unmet scavenger hunt incl. a literal markdown
  checklist at MSG 45 — despite prompt ban + engine already met-all.
- "What do I do now": MSG 34 player breaks OOC "((when is the HOH compitition))" → "when the moment
  feels right." No beat-sheet fact handed to the narrator.
- First HOH MSG 51-53: right outcome (player lost), rushed staging — one message, no set-piece rounds
  (0006 staging machinery exists, unused here).
- Meltdown MSG 54-63: narrator handled escalating violence well BUT ended "You're being removed from the
  game... You're done here, Kevin" — PURE FICTION. Engine: phase=premiere, playerStatus=active.
  Narration decided a season-terminal outcome with no engine authority. Faithfulness guard DARK all
  session (15 faith:* guard-judge failures; `faithfulness_model` unset).
- Never happened: DR never introduced in-fiction (first appearance = punishment cell); 0102
  recap/cliffhanger never fired (gated on `turnIn`, player never turned in); zero end-of-session hook.

## A. Onboarding & Day-1 (ranked)

- A1 (M) Cursored champagne circle — hand the model 3-5 cast cards per turn structurally (framing
  carries only current cluster + name-stubs); infodump impossible by construction. HIGHEST-LEVERAGE
  change. (Prompt/framing changes stale golden fixture — batch them.)
- A2 (S-M) Fix overseer reinject double-narration: round-2 contract = "continue, never re-open scene"
  (or replace, not append).
- A3 (S) Kill roll-call in narration layer: standing fact "everyone is met, steer to depth" + first
  registered `OrwellChatHint` (registry ships EMPTY today, M4-4).
- A4 (S) Premiere night spine: beat-sheet facts (toast→rooms→mingle→HOH TONIGHT); board+narrator same
  story (M2-3 pre-HOH reframe exists).
- A5 (S-M) NPC cast-card coherence lint: extend player-side age/span scan to all authored/floor-merged
  cards; check merges as a unit.
- A6 (S) Restore handoff beat: key/wall/pack-your-bags + one player answer (seeds callbacks).
- A7 (S) Introduce DR in-fiction post-toast ("nothing said in there reaches the house").
- A8 (M) Stage first HOH as set-piece: 3-4 presentation rounds over the one roll (0006 machinery;
  `stagedTrajectoryNeutral` guards).
- A9 (M) Airtight movement seam: belt catches end-of-turn transitional movement, or model must `moveTo`
  when prose relocates player.
- A10 (M) Close phantom-terminal-outcome hole: (a) `requestProducerRemoval` pending mirroring
  self-eviction confirm shape, or (b) hard prompt rule discipline stays non-terminal unless engine marks
  it. PLUS: faithfulness guard fail-loud when unconfigured; default judge to utility model; surface
  "guard dark" on `/admin/status`.

## B. Pacing & engagement loop

- B1 (S-M) Un-gate the cliffhanger: production proposes bedtime when awake set nearly empty (never
  forces) → `turnIn` recap/hook = natural episode-out. The retention engine exists; it's dead code for a
  new player.
- B2 (S) Front-load first secret drip to Day 1-2 (`secretPacingConstants`; timing not disclosure).
- B3 (S-M) Return cold-open package: M4-3 recap chip + M2-6 game-moment stamps + M4-7 title slates
  ("Week 1 · Day 3 · Nominations loom").
- B4 (S) Per-phase dramatic-stakes facts (nomination morning: "two chairs get names today").
- B5 (S) Comp-intent ritual as anticipation scene.
- B6 Cost datum: $0.32/90min premiere (997k in/88k out, 64% cache hit, 180 ledger turns) — can afford
  richer staging.

## C. Gadget rail (exists: House Status, Your Deals, Where You Are, Nightfall, The Cast, Pinned Cast, The
Finale, Season Recap; + Memory Wall, Dossier, Room Strip, DR composer, decision cards, premiere tutorial,
progress bar, EMPTY hint registry)

- C1 (S) "Tonight"/Week-Ahead roadmap gadget — phase lit on HOH→Noms→Veto→Eviction spine + next named
  beat. Answers MSG 34 without a tutorial. Vault: public cadence only.
- C2 (S-M) Player's Notebook — 100% player-authored freeform + per-HG note fields in Dossier. "The
  engine computes, the feeling is theirs" — notebook = what you THINK vs Memory Wall = what you KNOW.
  Never auto-suggests reads.
- C3 (S-M) Toast Board — premiere-scoped: each cast tile carries that HG's own spoken intro line
  (witnessed beat); retires into Dossier after week 1. Antidote to intro overload.
- C4 (M) Alliance Whiteboard — player-authored suspicion mapping; 0107 verified alliances render
  distinctly (party-to/public only).
- C5 (S) Goodbye-Message Drafts — private drafts pocket pre-filling the goodbye pending (E34; jury
  management).
- C6 (S) Finish M3-6 "every face is a door" BEFORE adding gadgets.

NOT proposed: house-pulse ticker (leaks or lies), relationship meters (feeling is theirs), click-to-move
presence.

## D. Quick wins vs structural bets

Quick wins: A2, A3, A4, A5, A6, A7, A10(b), B2, B4, C1, C5, C6 — consolidate prompt-touching wins into
few PRs (golden re-record each batch).

Structural bets (return order): A1 cursored circle · B1 bedtime→cliffhanger · A8 staged premiere HOH ·
A9 movement seam · A10(a) producer-removal pending · B3 return experience · C2/C4 player-authored layer.

## Meta-observation

Every top defect was invisible to the green suite and visible in ten minutes of transcript. Golden
fixture proves determinism, not FEEL. Institute a "premiere-night read-through" ritual per release: one
fresh premiere transcript against a ten-line checklist (no dup text, intros batched, no roll-call, DR
introduced, hook fired).

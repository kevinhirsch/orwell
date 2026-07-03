# PRODUCT & SPIRIT-GAP AUDIT — Orwell (realize-the-vision-200% pass)

Lane: what's MISSING (product gaps) and what BUILT features UNDER-serve the vision (spirit gaps).
Grounded in: the spec set (`docs/features/README.md`), the ship-gate, the GM prompt
(`src/engine/momentPrompts.ts`), the deploy env (`deploy/orwell-install.sh`), the engine
adapter/port, and the real live playthrough (`scratchpad/audit/journey*.json` — Week-2 state with a
259-event Producer's Vault).

**Headline:** the engine is *far* richer than the shipped game. A huge fraction of the "living house"
and "information is power" texture the vision exists to produce is **built but dark** (default-off
env flags the production deploy never sets), **built but invisible** (no player-facing surface or
affordance), or **specced-not-built** (the episodic/recap/returning-player loop). The four mandates
hold; the *fantasy* is running at maybe 50%.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| PS-1 | Major | <1day | High | Living-house texture ships DARK — 6 built features default-off, deploy enables only CAMPAIGNS | deploy/orwell-install.sh:263; GameSessionAdapter flags |
| PS-2 | Major | multi-day | High | No weekly recap / "previously on" — season has no episodic shape (0102 unbuilt) | 0102 spec; weeklyRecap absent |
| PS-3 | Major | <1day | High | Notoriety (0104) built but invisible — no "your reputation precedes you"; new-season UI silent | orwellNewSeason.js; momentPrompts (no notoriety) |
| PS-4 | Major | <1hr | High | Diary Room producer-invite is a DEAD function — never proactively offered (0013 §5 DoD unmet) | src/engine/diaryRoom.ts:61 (no callers) |
| PS-5 | Major | <1hr | High | Information-as-power core (confide/expose/trade — 0075/0093/0099) has no player affordance; emergent-only ⇒ most players never discover it | registry PLAYER_TOOLS; no FE surface |
| PS-6 | Major | multi-day | Med | Evicted player's endgame is passive spectating — no jury-house play; 0100 is NPC-only + off | momentPrompts "jury"; juryHouse.ts (flag off) |
| PS-7 | Major | <1day | Med | Whole hidden layer (259 events) pays off ONLY at the post-season unseal — a player who never finishes gets zero payoff | 0048; producerVault ratio |
| PS-8 | Major | <1day | Med | Ceremonies montaged into one turn — set-pieces not honored (corroborates J-3) | agent_loop advance chaining |
| PS-9 | Minor | <1day | Med | Off-screen life that DOES surface is generic ("talked strategy with") — texture thin at the player boundary | surfaceInformationTo; journey Surfacing events |
| PS-10 | Minor | <1day | Med | First-timer BB-literacy gap — premiere tutorial shows the rhythm but never explains what HOH/veto/noms/votes DO | orwellPremiereTutorial.js:158 |
| PS-11 | Minor | multi-day | Med | No player journal / theories / "what I know" surface — "log off with theories, with receipts" has no home (0097 frozen) | no journal gadget; 0097 frozen |
| PS-12 | Minor | <1day | Med | No second-season meta-progression the player can SEE — a "Season N" chip, no career/record/trophy of past seasons | orwellSeasonProgress.js |
| PS-13 | Minor | <1hr | Med | README status index drift — 0093/0099 shown "build-ready/unbuilt" but fully wired end-to-end (C6 half-truth) | docs/features/README.md:159,165 |
| PS-14 | Minor | <1day | Med | Returning-player re-entry has no bridge — dropped mid-beat with no "what you missed", worsened by no recap (PS-2) | momentPrompts "re-entry" |
| PS-15 | Minor | <1hr | Low | The `social` moment is the sole container for the entire runway + off-screen half-glimpse — one generic prompt carries the heart of the game | momentPrompts "social" |
| PS-16 | Minor | <1hr | Low | "Wants a word" reduces a bidirectional scene to a HUD chip — a rail item stands in for the NPC actually approaching in conversation (C5) | 0036 socialInitiatives; gadget rail |
| PS-17 | Minor | multi-day | Low | Gadget rail keeps accreting (0054 Phase 2 docks finale/cast/retrospective) — drift toward the dashboard 0022 defers (C5) | 0054 spec |
| PS-18 | Minor | <1day | Med | Secrets-as-levers starved: without secret-pacing (0092, off) learned secrets rarely reach the player, so expose/trade rarely fire | 0092 flag off; 0093/0099 |
| PS-19 | Minor | <1day | Low | Daily-event invariant is felt inverted — montaging collapses days so "1 meaningful event/day" reads as "3 ceremonies/turn" | daily-event invariant vs J-3 |
| PS-20 | Polish | <1hr | Low | Cast panel is portraits+facets only — no per-HG interaction history or "my read" annotation | orwellCast.js |
| PS-21 | Minor | <1day | Med | Time-of-day / nightly sleep economy (0066) — a signature immersion feature — is built and default-off; deploy never enables it | ORWELL_TIME_OF_DAY (off) |
| PS-22 | Minor | <1day | Med | Friendships that curdle over weeks (0087 trajectories) built + off — the house's relationships read as whiplash, not arcs | ORWELL_TRAJECTORIES (off) |
| PS-23 | Minor | <1day | Med | Emergent house-event eruptions (0091 triggers) built + off — the "blow-up you witness" drama never fires in production | ORWELL_TRIGGERS (off) |
| PS-24 | Minor | <1hr | Low | The "I knew it" payoff (secret-pacing drip 0092) — one of the two peak emotions the architecture exists for — is built + off | ORWELL_SECRET_PACING (off) |
| PS-25 | Minor | <1hr | Low | Pre-show ties as time-bombs (0059 §5 surfacing) built + off — seeded prior relationships never detonate for the player | ORWELL_SEEDED_TIE_SURFACING (off) |
| PS-26 | Minor | <1hr | Low | Bluff/deception (0093/0099 `bluff`) is a first-class built lever with zero discoverability — the player is never told they can lie | GameSession.ts SecretLeverDescriptor |
| PS-27 | Polish | <1hr | Low | Post-season is the ONLY place the hidden story opens; an evicted (pre-jury) player waits the whole rest of the season for it | momentPrompts "evicted"/"jury" |
| PS-28 | Minor | <1day | Low | No felt "the house is talking about YOU" — 0101 myth-making (self-gossip) is spec-only; player notability never circles back | 0101 spec-only |
| PS-29 | Polish | <1hr | Low | Reserve twists (0025) fired 0 times in the real run; double-eviction etc. are seeded-rare — a season can be twistless, flattening the format | producerVault twists:[] |
| PS-30 | Minor | <1day | Med | Deal-duration / vague-deal texture (0109) build-ready-not-built — deals lack the "how long" that makes a betrayal land or not | 0109 spec-only |

---

## Findings (full schema)

### [PS-1] [Severity: Major] [Effort: <1day] [Value: High]
Living-house texture ships DARK — six built features are default-off and the production deploy enables only CAMPAIGNS
- **Where:** `deploy/orwell-install.sh:258-263` writes the container `.env` and sets **only**
  `ORWELL_EMBEDDINGS=fastembed` + `ORWELL_CAMPAIGNS=1`. Every other richness flag reads default-off
  in `src/adapters/engine/GameSessionAdapter.ts`: `ORWELL_TIME_OF_DAY` (0066), `ORWELL_TRAJECTORIES`
  (0087), `ORWELL_TRIGGERS` (0091), `ORWELL_SECRET_PACING` (0092), `ORWELL_JURY_HOUSE` (0100),
  `ORWELL_SEEDED_TIE_SURFACING` (0059 §5) — each confirmed default-off in-code, none written by the
  installer.
- **Problem (I7 / mandate #1 behavioral fidelity — the #1 priority):** The vision's living-house
  promise and the two peak emotions the architecture *exists* to produce (being blindsided by a real
  plot; the "I knew it" secret payoff) are the exact things these flags power. They were built
  default-off for a legitimate reason — the seeded calibration gates must stay byte-identical — but
  that engineering discipline has silently become the **shipping configuration**. The owner asked the
  game to "realize its vision 200%"; instead the deploy ships the calibration-safe *floor*. A real
  player on a real install gets: no time-of-day/sleep, no relationship arcs, no emergent eruptions, no
  paced secret reveals, no jury-house society, no pre-show ties surfacing. This is the single
  highest-value gap in the audit: a large tranche of finished, tested product is dark in production.
- **Fix:** Add the vetted flags to the installer's `.env` block (they each already carry an on-run
  calibration re-measurement in their PRs). At minimum enable `ORWELL_TIME_OF_DAY`,
  `ORWELL_TRAJECTORIES`, `ORWELL_TRIGGERS`, `ORWELL_SECRET_PACING`, `ORWELL_JURY_HOUSE`. Gate the
  decision on one heavy-sim run per flag ON (the PRs claim active≥passive holds); make "on in
  production, off in the seeded gate" the explicit posture, documented beside `ORWELL_CAMPAIGNS=1`.

### [PS-2] [Severity: Major] [Effort: multi-day] [Value: High]
No weekly recap / "previously on" — the season has no episodic shape (0102 unbuilt)
- **Where:** Feature `0102-weekly-recap-cliffhanger.md` is build-ready (owner-ruled, redesigned to a
  daily bedtime recap) but **not built** — `weeklyRecap`/`dailyRecap` is absent from
  `GameSessionAdapter` (grep: no match). The only recap that exists is the *post-season* `seasonRecap`.
- **Problem (product gap / retention):** A real BB season is bingeable because it is episodic — each
  HOH-week is a self-contained arc with a cold open, comps, scheming, ceremonies, an eviction, and a
  hook into the next. Orwell crosses the week-seam (eviction resolves → next HOH begins) with **no
  "previously, and here's where it left us" beat**. The player leaves and returns with no re-grounding
  in what they lived; the week just played dissolves into an undifferentiated stream of beats. This is
  most of what makes the format *moreish*, and it is the #1 thing a returning player lacks. It is also
  the natural home for the cliffhanger that makes someone start the next session.
- **Fix:** Build 0102 as specified — a Vault-safe digest stitched from witnessed + already-surfaced
  events, delivered as an in-fiction narrator beat at the episode boundary (R1), with an in-motion,
  no-commitment hook (R2). It reuses `seasonRecap`'s exact source filter, scoped to the week; no new
  write-back, no Vault handle.

### [PS-3] [Severity: Major] [Effort: <1day] [Value: High]
Notoriety (0104) is built but invisible — the "your reputation precedes you" second-season hook is never surfaced
- **Where:** `src/engine/notoriety.ts` is wired (`GameSessionAdapter` folds it via `keepCharacter` in
  the single restart door). But `frontend/static/js/orwellNewSeason.js` copy is only *"Keep = the same
  person, a new cast. Recast = the casting interview runs again."* — no mention of reputation. Grep for
  `notoriety`/`reputation` in `momentPrompts.ts` and `chat_helpers.py`: **zero** hits. The bias is
  Vault-sealed, so the player is never even told in-fiction.
- **Problem (product gap / spirit / second-season motivation):** 0104 is a genuinely compelling
  answer to "why start Season 2" — you return as the same houseguest and a new cast *already has reads
  on you*. But nothing tells the player this exists: the keep/recast choice reads as a cosmetic
  "same face or new face," not "carry your legend forward vs. start clean." The one built mechanic that
  gives the game a career/meta-progression arc is dark to the player who'd choose it. And because the
  new cast's bias is sealed, even in-play the returning player can't *feel* "people have heard of me"
  unless the narrator is separately told to play it (it isn't).
- **Fix:** (1) Rewrite the keep/recast copy to name the stakes: "Keep — you return as [name]; some of
  the new house already have opinions about how you played." (2) Feed the narrator a Vault-safe
  "carriesNotoriety + recognition tier" cue on a same-character return so the premiere plays "aren't
  you the one who…" beats. (3) Consider a one-line season-summary card at recast time.

### [PS-4] [Severity: Major] [Effort: <1hr] [Value: High]
The Diary Room producer-invite is a dead function — the player is never proactively pulled aside
- **Where:** `src/engine/diaryRoom.ts:61` `producerPrompt(beat)` returns an invite at dramatic beats,
  but grep for `producerPrompt` across `src/` + `frontend/` finds **no callers** outside its own module
  and tests. The FE DR (`orwellDiaryRoom.js`) opens on a sidebar button / the player typing "I'm going
  to the DR" only.
- **Problem (I9 / spirit / 0013 §5 Definition-of-Done unmet):** The Diary Room is a *signature* BB
  set-piece and the player's backstage — and 0013 §5 explicitly promises "the engine proactively
  invites the player to the DR at natural dramatic beats… a producer gently pulling the player aside."
  That fantasy never happens: after a blindside, a big move, a shifting position, no producer ever
  says "come talk to me." The player has to remember the DR exists and self-initiate. The confessional
  rhythm that gives BB its emotional processing beat is absent, and a built engine function meant to
  drive it is inert.
- **Fix:** Wire `producerPrompt` into the live agent-loop / moment seam (the same family as the
  re-entry beat) so after `isDramatic` beats (eviction, blindside, nomination as a nominee, big
  position shift) the producers offer a DR aside — a soft, dismissible invite, never a forced stop.

### [PS-5] [Severity: Major] [Effort: <1hr] [Value: High]
Information-as-power (confide / expose / trade — 0075/0093/0099) has no player affordance; emergent-only means most players never find the game's core loop
- **Where:** `src/surfaces/tools/registry.ts:55-57` — `confide`, `exposeSecret`, `tradeSecret` are
  live PLAYER_TOOLS, fully wired (McpServer dispatch + adapter impl at `GameSessionAdapter:6157`). But
  they only fire when the *player naturally says* "everyone should know what they're hiding" / "you can
  tell me" and the model calls the lever. No tooltip, no card, no hint ever tells the player these
  moves exist.
- **Problem (product gap):** "Learned information *is* power — you trade it, hold it over someone, out
  them at the right moment" is, per the 0093 design note, the loop that makes gathering information
  worth a long season. It is now *built* — a real achievement. But it is discoverable only by a player
  who already plays BB like a veteran and phrases the exact move. A first-timer will never learn a
  secret can be weaponized; the game's information-as-power heart stays invisible. (Compounds with
  PS-18: even a veteran rarely *has* a learned secret to wield because the fuel — surfaced secrets —
  is throttled with pacing off.)
- **Fix:** Add lightweight, diegetic surfacing: when the player *holds* a learned secret about a
  houseguest (a `KnowledgeFact` with subject), have the producers (DR) or the narrator occasionally
  note it as leverage ("you know something about them now — that's a card you could play"). Optionally
  a Vault-free "what you've learned" note on the cast panel. Keep the act itself conversational.

### [PS-6] [Severity: Major] [Effort: multi-day] [Value: Med]
The evicted player's endgame is passive spectating — the jury phase has no play for the human
- **Where:** `momentPrompts.ts` "jury" moment: *"From sequester they watch the PUBLIC ceremonies…
  RESULTS only… They cast their own vote at the finale."* The jury-house society (`src/engine/juryHouse.ts`,
  0100) is **NPC-only** and default-off — jurors scheme and hold grudges among themselves, but the
  player-juror doesn't participate.
- **Problem (product gap):** In real BB the jury house is a whole second act — jurors argue, defend
  players, get bitter, are courted by finale speeches. Orwell's evicted player is reduced to reading
  result broadcasts until a single finale vote. For a player eliminated at, say, Final 8, that is a
  long, agency-free tail — a real abandonment-risk stretch. The one system that could make it alive
  (0100) deliberately excludes the player as a graph terminus.
- **Fix:** Give the player-juror *some* social surface in sequester — jury-house conversations with
  fellow evictees (Vault-safe, results-only knowledge), reactions to incoming jurors, the finale
  courting. Even a light version (talk to the last-evicted juror; form a jury read) converts dead time
  into play. Ties to enabling 0100 for the NPC texture around them.

### [PS-7] [Severity: Major] [Effort: <1day] [Value: Med]
The entire hidden layer pays off ONLY at the post-season unseal — back-loaded to a moment many players never reach
- **Where:** `0048` retrospective + `momentPrompts.ts` "post-season"/"evicted"/"jury" all gate the
  hidden story behind a crowned winner ("The hidden story stays SEALED until the season crowns a
  winner"). The live run shows the scale: a **259-event** Producer's Vault by *Week 2* (45 secret
  threads, 41 confessionals, 31 whispers, 25 conflicts…), of which only **8** ever surfaced to the
  player.
- **Problem (I5/mandate #1 / product):** The dramatic-irony payoff — "later learning it was real,
  recorded, and fair all along" — is one of the two peak emotions the whole architecture exists for,
  and it is delivered *only once, only at the very end.* A player who loses interest mid-season, or is
  evicted early and doesn't stick around for the finale, gets **zero** payoff on the richest thing the
  engine built. The hidden layer is a magnificent asset spent in a single terminal beat.
- **Fix:** Meter *some* of the payoff earlier and safely: the weekly recap (PS-2) surfaces
  already-known material; secret-pacing (PS-18/PS-24) drips *newly-earned* reveals mid-season; and a
  per-eviction "here's a little of what you didn't see" is possible for *evicted* houseguests (their
  Vault content can unseal once they're gone, without spoiling live players). Don't hoard the entire
  irony to the finale.

### [PS-8] [Severity: Major] [Effort: <1day] [Value: Med]
Ceremonies are montaged into single turns — set-pieces don't land as exclusive events (corroborates journey J-3)
- **Where:** `frontend/src/agent_loop.py` advance-chaining + L39 stall belts; observed live (journey
  J-3): HOH crown → full nomination ceremony in one turn; veto comp fully resolved in one turn;
  eviction vote→tally→result→goodbye→Week 2→next HOH across one/two turns.
- **Problem (spirit / C3 / vision "a ceremony that lands as an exclusive set-piece"):** The moment
  prompts (nominations, veto, eviction) now go to great length telling the model to play each as a
  *live witnessed set-piece* and never montage — yet the FE advance-chaining still batches multiple
  `advanceGame` calls across ceremony boundaries, so the set-pieces collapse into each other and the
  "lived aftermath scramble / unhurried runway" the vision calls the heart of the game is skipped.
  0106 ("whole-house events are exclusive") addresses the *side-scene* problem but not the
  *montage-multiple-ceremonies-per-turn* problem. This corroborates J-3 from the product angle: the
  single most-produced moments of a BB week are rushed.
- **Fix:** Cap `advanceGame` at one ceremony-boundary crossing per turn; insert a mandatory
  runway/pause beat between set-pieces (HOH → [runway] → noms → [runway] → veto…). This is the same
  fix J-3 flags; escalate its value — it degrades every marquee moment.

### [PS-9] [Severity: Minor] [Effort: <1day] [Value: Med]
The off-screen life that DOES reach the player is generic — "talked strategy with", not juicy specifics
- **Where:** Live run: all 8 player-surfaced events read as *"(overheard, faintly) X formed an
  alliance / talked strategy with Y / grew close…"* — the pathway works, but the payload is a category
  label, not content. `recordOffscreenSceneTexture` (0070) exists to enrich *prose* but the surfaced
  gossip the player gets is still the coarse verb.
- **Problem (I7 texture / mandate #1):** The house schemes richly (259 hidden events) but what
  crosses to the player is bloodless — "someone talked strategy" tells the player nothing to *act* on,
  form a theory about, or feel paranoid over. The half-glimpse is supposed to be *tantalizing*; a
  category verb is not. This is the difference between "this is a living house" and "a ticker of
  vague events."
- **Fix:** When gossip surfaces to the player, carry a distorted *specific* (the 0002 belief with its
  drift) — "you catch that Gina thinks you're the biggest threat" — not just the scene type. Ensure
  0070's enriched texture is what rides the overhear pathway, not the bare `type` string.

### [PS-10] [Severity: Minor] [Effort: <1day] [Value: Med]
First-timer BB-literacy gap — the premiere tutorial shows the *rhythm* but never explains what the roles DO
- **Where:** `frontend/static/js/orwellPremiereTutorial.js:158-166` — the onboarding card gives one
  line ("Talk to anyone, wander any room…") plus an emoji rhythm strip *🏆 HOH → 🔨 Nominations → 💎
  Veto → 🗳️ Eviction* and a "Meet the house" opener. Nothing defines HOH (power + safety), what a
  nomination means (you're at risk), what the veto does (save a nominee), or that everyone-but-HOH-and-
  nominees votes.
- **Problem (product gap / onboarding):** A player who has never watched Big Brother — a large share
  of any new audience — is dropped into a world of jargon with no glossary. They will not understand
  why HOH matters, why being nominated is bad, or how the veto changes the board. The rhythm strip
  *names* the ceremonies but assumes the player already knows the game. The ship-gate weighs onboarding
  heavily ("the first ten minutes").
- **Fix:** Expand the rhythm strip into a one-tap "how the week works" that gives each role a single
  plain sentence ("HOH: this week's boss — safe, and picks who's at risk"). Keep it optional and
  dismissible; the producers can also explain in-fiction during the premiere.

### [PS-11] [Severity: Minor] [Effort: multi-day] [Value: Med]
No player journal / theories / "what I know" surface — "log off with theories, with receipts" has no home
- **Where:** No journal/notes gadget ships (grep: `orwellDiaryRoom.js` is the DR channel, not a
  knowledge surface). The suspicion-ledger feature (0097) that would give the player a hunch-tracking
  scorecard is **FROZEN** (parked, closed not-planned). The cast panel shows facets/portraits only.
- **Problem (product gap / the core fantasy):** The vision is "read a living social world through
  partial, distorted information… log off with theories, not certainty… trust formed, tested,
  betrayed — with receipts." But the player has nowhere to *record* a theory, track what they've
  learned, or later see it confirmed/refuted. Everything the player "knows" lives only in the chat
  scrollback and their own head. For a game whose entire loop is information-gathering, the absence of
  any knowledge surface is a real product hole — and it makes the eventual payoff ("you were right")
  land weaker because there's no recorded hunch to vindicate.
- **Fix:** A lightweight, OOC, player-private "notes/reads" affordance (the DR is the natural home —
  0097's R1 recommends a DR-style surface, not a HUD). It must stay player-knowledge with no NPC
  pathway (0013 §4). Even a freeform notepad that the retrospective can later mark against the truth
  would deliver the "receipts" fantasy. Revisit the 0097 freeze with a DR-scoped scope.

### [PS-12] [Severity: Minor] [Effort: <1day] [Value: Med]
No second-season meta-progression the player can see — a "Season N" chip, but no career, record, or trophy of past seasons
- **Where:** `frontend/static/js/orwellSeasonProgress.js` ships a ≤5px progress bar + a "Season N"
  chip. There is no past-seasons list, no win/loss record, no placement history, no "hall of fame"
  surface (grep for season-history surfaces returns only unrelated files).
- **Problem (product gap / retention):** 0057 frames seasons as levels, and 0104 gives reputation
  continuity — but the player has no *view* of their own arc across seasons. A player who won Season 1
  and placed 3rd in Season 2 sees only "Season 3" with no trophy case, no record, no sense of a career.
  The compelling-reason-to-play-again is weakened when past accomplishments evaporate.
- **Fix:** A small season-history surface (season #, placement, notable result) surfaced at the
  new-season hand-off and re-viewable from the gadget rail. Pairs naturally with PS-3 (notoriety) — the
  record and the reputation are the same story.

### [PS-13] [Severity: Minor] [Effort: <1day] [Value: Med]
README status index drift — 0093/0099 shown "build-ready / not implemented" but are fully wired end-to-end
- **Where:** `docs/features/README.md:159` (0093) & `:165` (0099) both read *"Design note + `.feature`
  (not in `cucumber.cjs`)"* / "Nothing here is implemented." But `exposeSecret`/`tradeSecret` are in
  `registry.ts:56-57` (PLAYER_TOOLS), dispatched in `McpServer.ts:326-331`, and implemented in
  `GameSessionAdapter.ts:6157` (`exposeSecret`), with full port types in `GameSession.ts:400-500`
  including the owner's `bluff` deception direction.
- **Problem (C6 / spirit / process):** The status index is declared the single source of truth
  ("trust the code over prose — it drifts"), yet it under-reports a *built and shipped* headline
  mechanic (secrets-as-power). This is the inverse of the usual over-claim: a real feature is invisible
  in the docs, so nobody surfaces it to the player (see PS-5) or tests it as a golden-path payoff. The
  drift directly causes the discoverability gap.
- **Fix:** Reconcile the index: mark 0093/0099 built with their gate (`confide`/expose boundary tests),
  and audit the rest of the 0093–0104 band for the same built-but-labeled-spec drift.

### [PS-14] [Severity: Minor] [Effort: <1day] [Value: Med]
Returning-player re-entry has no bridge — dropped mid-beat with no "what you missed"
- **Where:** `momentPrompts.ts` "re-entry" instructs *"Open with a fresh in-fiction scene… never an
  out-of-fiction recap dump… Pick up the live thread."* Correct for immersion, but combined with no
  weekly recap (PS-2) and the paused-world model (C3, the house didn't advance while away), the player
  returns to a live phase with zero re-grounding.
- **Problem (product gap / UX):** A player who logs back in after days is dropped into "the house at
  evening, week 2, veto phase" with no reminder of who they'd bonded with, what deal they'd struck, or
  what was brewing. The store *has* all of it; nothing bridges the gap. Real BB gives you "previously
  on"; Orwell gives you a cold open into the middle of a scene you no longer remember.
- **Fix:** The weekly/daily recap (PS-2) is the primary fix; additionally, the re-entry beat can lean
  on a Vault-safe "here's where you left it" cue (your open deals, your last big scene, the current
  board) woven in-fiction before the live thread — the store recalled, not the chat remembered.

### [PS-15] [Severity: Minor] [Effort: <1hr] [Value: Low]
The `social` moment is the sole container for the entire runway + off-screen half-glimpse — one generic prompt carries the heart of the game
- **Where:** `momentPrompts.ts` "social" is a single prompt handling *all* non-ceremony play: "quieter
  beat: conversations, bonding, paranoia, off-screen scheming the player half-glimpses… the lived
  aftermath… the lull."
- **Problem (spirit):** ADR 0003 calls the social runway the heart of the game, yet it has one
  undifferentiated moment fragment doing the work of the post-crown scramble, the mid-week lull, the
  paranoid pre-eviction night, and the routine hangout — each of which has a very different BB texture.
  The set-piece moments get 40-line bespoke prompts; the *heart* gets one paragraph.
- **Fix:** Split the social moment by context (post-power-shift scramble / mid-week lull / pre-vote
  night) with a short bespoke cue each, so the runway gets the same craft the ceremonies now get.

### [PS-16] [Severity: Minor] [Effort: <1hr] [Value: Low]
"Wants a word" reduces a bidirectional scene to a HUD chip — a rail item stands in for the NPC approaching
- **Where:** 0036 `socialInitiatives` → the "Wants a word" gadget (gadget rail). The engine computes
  which NPCs want to approach the player and surfaces them as a HUD list with a coarse bond/probe
  motive.
- **Problem (C5 / I7 spirit):** The "NPCs approach the player" half of bidirectional scenes is one of
  the living-house's best beats — an NPC pulling *you* aside is dramatic. Rendering it as a standing
  rail item ("Mila wants a word") turns an in-fiction approach into a dashboard notification the player
  clicks, which is exactly the "UI replaces a conversation" smell ADR 0003 warns against. The chip is
  useful as a *cue*, but if the NPC never actually walks up in the narration, the HUD *is* the
  interaction.
- **Fix:** Ensure the initiative also drives the narrator to *play* the approach in-fiction (the NPC
  comes to you), with the chip as an ambient hint, not the event itself. Verify the moment seam
  actually voices pending initiatives rather than leaving them as rail-only.

### [PS-17] [Severity: Minor] [Effort: <1hr] [Value: Low]
Gadget rail keeps accreting — 0054 Phase 2 docks finale/cast/retrospective; drift toward the dashboard 0022 defers
- **Where:** `0054-gadget-rail.md` — Phase 1 (HUD gadgets) shipped; Phase 2 docks the finale, cast,
  and retrospective *windows* into the rail. Plus `orwellDeals`, `orwellPresence`, `orwellNightStatus`,
  `orwellSeasonProgress`, `orwellDecision`, etc.
- **Problem (C5 spirit):** ADR 0003 defers the rich UI (0022) on principle — the conversation is the
  game, UI may augment but never replace. The gadget ecosystem is individually justified (each is
  Vault-free, read-only, augments), but collectively it is trending toward the very dashboard 0022
  parks. The finale docked as a panel, the cast as a panel, deals as a panel — the player increasingly
  *reads the game* off the rail rather than *plays it* in chat.
- **Fix:** Hold a periodic "does this rail item replace a conversation or reflect one?" review. Keep
  read-only reflections (deals ledger, status) but resist docking anything the player is meant to
  *experience* (a finale is a set-piece to live, not a panel to open).

### [PS-18] [Severity: Minor] [Effort: <1day] [Value: Med]
Secrets-as-levers is starved — without secret-pacing (0092, off) learned secrets rarely reach the player, so expose/trade rarely fire
- **Where:** 0093/0099 (built, PS-13) consume secrets the player *learned* via confide (0075) or
  gossip (0002). `ORWELL_SECRET_PACING` (0092 — the drip that shapes dormant secrets into paced
  reveals) is default-off and not enabled by the deploy. Live run: 8 surfaced facts of 259 hidden,
  none a juicy learnable secret.
- **Problem (product coherence):** The game built an information-as-power loop (PS-5) and the pacing
  engine that *feeds* it — then shipped the feeder dark. The result is a lever with no ammunition: the
  player can technically expose or trade a secret, but almost never *has* one, so the whole strategic
  layer is theoretical in production.
- **Fix:** Enable `ORWELL_SECRET_PACING` (part of PS-1) so dormant secrets actually drip to the
  player at ~1-2/week, giving the expose/trade/leverage levers real fuel. Pair with PS-5's
  discoverability so the player knows what to do with what they learn.

### [PS-19] [Severity: Minor] [Effort: <1day] [Value: Low]
The daily-event invariant is felt inverted — montaging collapses days so "≥1 meaningful event/day" reads as "3 ceremonies/turn"
- **Where:** The daily-event invariant (spec §12) guarantees each in-game day has a meaningful event;
  the montage behavior (PS-8/J-3) collapses multiple days' events into single turns.
- **Problem (spirit):** The invariant is meant to guarantee a *steady, paced* drip of meaningful
  happenings — one per day. In practice the player experiences the opposite rhythm: long conversational
  stretches, then a turn that fires three ceremonies at once. The pacing the invariant encodes is
  inverted by the advance-chaining.
- **Fix:** Same as PS-8 — one ceremony boundary per turn restores the "a day, an event" cadence the
  invariant intends.

### [PS-20] [Severity: Polish] [Effort: <1hr] [Value: Low]
Cast panel is portraits + facets only — no per-houseguest interaction history or "my read" annotation
- **Where:** `frontend/static/js/orwellCast.js` renders the roster gallery (portraits + public facets
  + jury/evicted status).
- **Problem (product polish):** In a 16-person social game, the player will lose track of who they've
  talked to, what they promised whom, and who they trust. The cast panel could anchor that (per-HG:
  last scene, open deals, "you clocked them as…") but shows only static facets. A small gap that grows
  as the season lengthens and the roster shrinks.
- **Fix:** Add a per-HG detail popover with Vault-free player-knowledge: your open deals with them,
  last interaction, met/not-met — reflecting the record, never asserting a feeling (I8).

### [PS-21] [Severity: Minor] [Effort: <1day] [Value: Med]
In-game time-of-day + the nightly sleep economy (0066) is built and default-off — a signature immersion feature is dark
- **Where:** `ORWELL_TIME_OF_DAY` default-off; not written by the installer. 0066 ships the five-phase
  clock, character-driven bedtimes, the emptying-house presence economy, the player's own bedtime, and
  a hidden sleep→comp penalty.
- **Problem (immersion / product):** Time-of-day is one of the most atmospheric things a house sim can
  have — late-night whispers, the house emptying as people turn in, a player choosing to stay up. It is
  finished and tested behind a flag production never flips. The HUD night-status gadget
  (`orwellNightStatus.js`) exists but has nothing to show. (Sub-case of PS-1, called out for its
  outsized immersion value.)
- **Fix:** Enable `ORWELL_TIME_OF_DAY` in the deploy (per PS-1) after its calibration re-check.

### [PS-22] [Severity: Minor] [Effort: <1day] [Value: Med]
Relationship trajectories (0087 — friendships that curdle over weeks) built + off — the house reads as whiplash, not arcs
- **Where:** `ORWELL_TRAJECTORIES` default-off, not enabled by deploy.
- **Problem (mandate #1 / product):** Without trajectory momentum, off-screen relationships swing
  bond→clash→bond turn to turn (the exact whiplash 0087 was built to fix). A friendship *curdling* over
  weeks is precisely the kind of legible arc that makes the house feel like people, not a coin-flip.
  Shipped dark.
- **Fix:** Enable `ORWELL_TRAJECTORIES` (per PS-1); the PR claims zero-added-rng so the seeded spine is
  unaffected.

### [PS-23] [Severity: Minor] [Effort: <1day] [Value: Med]
Emergent house-event eruptions (0091 triggers) built + off — the "blow-up you witness" never fires in production
- **Where:** `ORWELL_TRIGGERS` default-off, not enabled by deploy.
- **Problem (I7 / mandate #1):** 0091 turns an accumulating volatile secret under strain into an
  emergent public house-event the player *witnesses* (a blow-up, a showmance detonation, a meltdown) —
  exactly the unscripted drama that sells "this IS Big Brother." Off in production, the house never
  spontaneously erupts; every dramatic beat is a scheduled ceremony.
- **Fix:** Enable `ORWELL_TRIGGERS` (per PS-1) after its calibration re-check.

### [PS-24] [Severity: Minor] [Effort: <1hr] [Value: Low]
The "I knew it" payoff (secret-pacing drip 0092) — one of the two peak emotions — is built + off
- **Where:** `ORWELL_SECRET_PACING` default-off.
- **Problem (the core emotion):** The vision names two peak moments; one is the secret payoff. 0092 is
  the pacing layer that makes dormant secrets actually reach the player as paced reveals ("I knew it").
  Dark in production ⇒ that peak emotion rarely triggers. (Overlaps PS-18's ammunition problem.)
- **Fix:** Enable `ORWELL_SECRET_PACING` (per PS-1).

### [PS-25] [Severity: Minor] [Effort: <1hr] [Value: Low]
Pre-show ties as time-bombs (0059 §5 surfacing) built + off — seeded prior relationships never detonate for the player
- **Where:** `ORWELL_SEEDED_TIE_SURFACING` default-off. 0059 seeds hidden pre-game ties; §5's
  surfacing scheduler (showmance spark→bond→visible, the pre-game-TIE discovery) is opt-in and off.
- **Problem (product):** "Two houseguests knew each other before the show" is a classic BB bombshell.
  The engine seeds it and can surface it — but production never turns on the surfacing, so the tie
  stays a Vault curiosity the player only ever sees (if at all) in the post-season unseal.
- **Fix:** Consider enabling `ORWELL_SEEDED_TIE_SURFACING` (per PS-1); at minimum surface it via the
  post-season retrospective reliably.

### [PS-26] [Severity: Minor] [Effort: <1hr] [Value: Low]
Bluff / deception (0093/0099 `bluff`) is a first-class built lever with zero discoverability — the player is never told they can lie
- **Where:** `GameSession.ts:410-421` `SecretLeverDescriptor.bluff` (owner direction 2026-06-27:
  "deception first-class") — the player can expose/trade a *fabricated* secret and the engine never
  tells them if the bluff matched a truth. Fully built; no affordance.
- **Problem (product / spirit):** Bluffing is one of BB's most delicious moves, and Orwell built it
  with the perfect anti-sycophancy property (the engine never confirms whether the lie was true). But
  like PS-5, it is discoverable only by a player who thinks to try it. A signature emergent move with
  no on-ramp.
- **Fix:** Surface it diegetically (producers/DR can note "you could always claim you know something,
  true or not — risky"). Keep the act conversational.

### [PS-27] [Severity: Polish] [Effort: <1hr] [Value: Low]
Post-season is the only place the hidden story opens — an evicted (pre-jury) player waits the whole rest of the season
- **Where:** `momentPrompts.ts` "evicted": "The hidden story stays SEALED until the season crowns a
  winner — offer the PUBLIC recap… never the hidden story, while the house is still playing."
- **Problem (product):** A player evicted at, say, Week 3 (pre-jury) is told to just watch public
  recaps to the finale before *any* hidden payoff. That is a very long dead tail for an early boot.
  (Sub-case of PS-7; called out because the "evicted" path is the harshest instance.)
- **Fix:** For an *evicted* player specifically, consider unsealing *their own* season's already-
  concluded hidden threads incrementally, or offering an earlier "watch to the end for the full story"
  fast-path. Don't strand an early boot in agency-free spectating.

### [PS-28] [Severity: Minor] [Effort: <1day] [Value: Low]
No felt "the house is talking about YOU" — 0101 myth-making is spec-only
- **Where:** `0101-npc-myth-making.md` is spec-only. The player's notable acts don't seed gossip
  legends about themselves that spread, distort, and circle back.
- **Problem (product / the fantasy):** A huge part of the BB paranoia loop is hearing your own
  reputation come back warped ("people are saying you…"). Orwell tracks the player's acts and has the
  diffusion machinery, but nothing turns the player into a *subject* of house gossip. The social world
  observes the player but never *reacts about* them behind their back in a way that returns.
- **Fix:** Build 0101 (it reuses 0002 diffusion with the player as origin) — a high-payoff use of
  existing machinery.

### [PS-29] [Severity: Polish] [Effort: <1hr] [Value: Low]
Reserve twists (0025) fired zero times in the real run — a season can be twistless, flattening the format
- **Where:** Live run `producerVault.twists: []` at Week 2; 0025 fires a seeded, rare twist (e.g.
  double eviction) at a dramatic beat.
- **Problem (product / format fidelity):** Twists (double evictions, resets) are part of what makes a
  BB season feel like an *event*. Seeded-rare means many seasons will have none, reading as a
  flatter-than-broadcast format. (Not a bug — a tuning/product call about how central twists are to the
  fantasy.)
- **Fix:** Product decision — consider guaranteeing at least one production twist per full season (the
  broadcast norm), still seeded as to *which* and *when*.

### [PS-30] [Severity: Minor] [Effort: <1day] [Value: Med]
Negotiated deal duration / vague deals (0109) is build-ready-not-built — deals lack the "how long" that makes a betrayal land (or not)
- **Where:** `0109-deal-duration.md` build-ready (owner edit), amends 0039; not built. Deals today have
  no negotiated horizon beyond the fixed safety/vote scoping.
- **Problem (product / spirit):** "I've got you this week" vs "we're final two" are *completely*
  different promises, and turning on one early vs. honoring it to term is the difference between a
  betrayal that costs the full price and fair game. Without duration, every deal-break is the same
  weight, flattening the game's signature trust-and-betrayal texture — the exact thing the vision
  centers ("trust formed, tested, betrayed — with receipts"). The betrayal-shock scaling that would
  make a broken *early* promise sting is absent.
- **Fix:** Build 0109 as specified — an optional `expiresWeek`/`vague` on a deal, with betrayal-shock
  (0026) scaling by remaining deal life. Byte-identical when unused.

---

## Where I looked / coverage

- **Product-gap sources:** `docs/features/README.md` (full index 0001–0109), the ship-gate
  (`2026-06-27-ship-gate.md`), the vision brief + journey audit, and spot-reads of 0102/0093/0099/0013/
  0054/0048 specs.
- **Spirit-gap sources:** `src/engine/momentPrompts.ts` (all moment fragments — casting→post-season),
  `deploy/orwell-install.sh` (the shipped `.env`), `src/surfaces/tools/registry.ts` +
  `src/ports/GameSession.ts` + `McpServer.ts` + `GameSessionAdapter.ts` (secrets-as-levers wiring
  reality), `src/engine/diaryRoom.ts` (dead producer-invite), and the FE gadget set
  (`orwellPremiereTutorial`, `orwellNewSeason`, `orwellCast`, `orwellDeals`, `orwellSeasonProgress`,
  `orwellDiaryRoom`).
- **Live evidence:** `journey-debug-bundle.json` (Week-2 Producer's Vault — 259 hidden events, 8
  surfaced; the eviction-vote ledger; feature-flag block showing `embeddings=fake`, texture flags
  unset).
- **NOT covered (other lanes / out of scope):** pixel-level visual/motion, a11y, responsive
  breakpoints, consistency/parity races, narration-fidelity model behavior (J-1/J-2/J-10 already own
  the GLM seam). I corroborated J-3 (montage) from the product angle (PS-8/PS-19) — two independent
  hits should raise its priority.
- **Did NOT run** the full test suites or read `style.css`/`chat.js` end-to-end (grep-then-narrow, per
  charter). Did not live-drive a second season to confirm PS-3's notoriety in-play behavior (inferred
  from source: no narrator cue exists).

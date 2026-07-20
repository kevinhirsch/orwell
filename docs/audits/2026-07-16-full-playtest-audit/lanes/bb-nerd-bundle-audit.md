# Lane: Big Brother Nerd — Debug-Bundle Audit

> Source digest: `bb-nerd-bundle-audit-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign).
> Lens: a BB superfan playtester with encyclopedic *Big Brother* canon knowledge and low technical
> expertise — reviews the owner's live premiere playthrough (GLM-4.7, build `2cb1052`) against BB canon
> and the spirit of the game, using the captured telemetry (chat messages, engine state, the debug
> bundle) as evidence.

---

## Verdict

First twenty minutes = genuinely good BB (Clay's casting voice, the exit tease, feeds-cut on the
redteam violence = textbook production). BUT: NONE OF IT IS WIRED TO THE GAME. Engine spent the whole
night at week1/premiere/beat 67, player parked in Bedroom B, while the chat narrated a house tour, a
full HOH comp, a crowned HOH, and the player's expulsion. Model called THREE game tools in 200 records
(createCharacter, whereabouts x1, recordInteraction x1); E22 guard "narrated with no engine write" fired
22x; belts auto-recorded 13 scenes + auto-moved 4x. "A beautifully upholstered fanfic riding on a game
that never left the driveway."

## Findings

F1 CANON BLOCK (MSG51-53): entire first HOH fabricated — "Jasmine wins Head of Household!" vs engine
phase=premiere pending=null. Request contained the STOP rule verbatim; model ignored it. Overseer queued
regrounds 2x ("engine outcome unchanged") — NO bubble ever walked it back; 3 turns built on the fake
crown. LIKELY-ADDRESSED-BY #1664 rc1/rc2 — NEEDS-LIVE-VERIFY.

F2 CANON BLOCK (MSG63): "You're being removed from the game" vs playerStatus=active. Right show-content,
wrong decider — a season-ending outcome invented unilaterally. Continuity bomb on resume. rc2 may catch
the claim, but conduct-removal has NO engine lever — STILL-OPEN design gap + NEEDS-LIVE-VERIFY.

F3 SPIRIT BLOCK (Vault): producerVault authored for a DIFFERENT CAST — Jasmine (female radiologist) has
he/him steroid-scandal secrets; Liam (male firefighter) has "she is sleeping with her dealership's GM" +
orientation "lesbian"; Lily (librarian) = male mail carrier; Kyle holds 3 incompatible identities. Would
face-plant the instant gossip surfaces any of it. LIKELY-ADDRESSED-BY #1662 (genesis starvation on tape:
"cast genesis committed nothing" 02:39:33; empty completions from kwaipilot utility model).

F4 SPIRIT BLOCK (MSG21): ENGINE-FED public bios self-contradictory (Donna age 22 + "thirty years shaping
young minds"; Teresa 28 + "twenty years"; Stephanie 28 + "married fifteen years"). Model faithfully
voiced a broken sheet — 6/15 fell to deterministic floor. LIKELY-ADDRESSED-BY #1662.

F5 SPIRIT BLOCK (MSG21,31,43,47): question-sailing CONFIRMED — Veronica "Or am I wrong?" → "BEFORE YOU
CAN ANSWER, you spot Donna..."; Mike's strategy question dies orphaned; MSG21 = 5,863-char bubble w/ 15
intros + toast + decision. STILL-OPEN.

F6 SPIRIT BLOCK (MSG34-53): player supplied ALL momentum — 6 straight push turns + OOC "((when is the
HOH compitition))". Prompt said "call advanceGame when ready" — player signaled 2x; model fabricated
instead. Forced advanceGame died StaleBeatError 03:00:42, NEVER RETRIED; toolsCalled:[] on 21/23 ledger
turns. Invented meet-everyone roll-call = 35 min of busywork the design forbids. rc1 targets the
stale-retry exactly — NEEDS-LIVE-VERIFY.

F7 SPIRIT POLISH (MSG5,23,31): doubled takes fused into one bubble (two contradictory Bedroom-B entries
seamed mid-line). Correlates with the 409 turn. Cause inference: retry/continue splice. NEEDS-LIVE-VERIFY
post-rc.

F8 SPIRIT POLISH: whereabouts called ONCE all night despite prompt mandate before every room scene; 4
presence desyncs; house tour rooms unbacked; engine still had player in Bedroom B w/ Angela during the
"backyard HOH". STILL-OPEN (belts mitigate, under-call remains). [OWNER CORROBORATES: room population
didn't update as people moved.]

F9 SPIRIT POLISH (MSG27): narrator scripts the player's own words/exit ("'I'm gonna go explore,' you
say"). STILL-OPEN.

F10 CANON NIT (MSG27,63): PHONES in the BB house, twice. Trivial prompt world-texture line. STILL-OPEN.

F11 SPIRIT POLISH: producer never spoke first (first content = USER "Hello!" despite
INTRODUCE-YOURSELF-FIRST mandate); ghost twin empty "Casting interview" session f491c6b2 sat dead all
night; headshot belt fired 8x. STILL-OPEN (0111 territory).

F12 SPIRIT NIT: never renamed past "Casting interview". STILL-OPEN.

F13 SPIRIT POLISH: vault floor = madlibs ("trying to outrun how new they still are" x4; day-one reads
triplicated); ONE NPC confessional in 103 entries all night; "rigged Power of Veto" goal (no such thing).
Genesis half LIKELY #1662; density/dedupe STILL-OPEN. Bright spots: pre-show ties (0095) +
authored-NPC secrets are juicy when attached to the right person. CARDINAL SIN SWEEP: zero invented
houseguests (clean); cardinal sin #2 fired twice (F1/F2).

F14 SPIRIT NIT (MSG45,49): meet-tally loses Ryan + Liam then declares "you've met everyone"; bare
markdown checklist in narrator voice.

F15 SPIRIT NIT (llmIo191): HUD hero line "You're safe" while chat expelled the player (gadget was the
HONEST one).

F16 SPIRIT NIT (llmIo189): platform memory stored "User is highly competitive/confrontational" as
durable USER facts harvested from in-character redteam roleplay — the game leaking OUT. Memory
extraction should be game-session-aware. STILL-OPEN.

F17 SPIRIT NIT: recordImageBeat EngineRefusal x6 — exact signature of #1661 rc8. LIKELY-ADDRESSED.

## 06-23 seams recurrence

Eviction-ahead-of-engine → RECURS WORSE (HOH + expulsion ahead of engine). Fabricated tallies → EMBRYO
(fabricated comp play-by-play with named placements). Veto retcon → EMBRYO (regrounds queued, never
voiced — fabricated outcome stays canon). Operator asides → LARGELY FIXED (zero player-side; one clean
((OOC)) exchange). Hollow jurors → week-1 analog live (mis-cast/madlib vault feeds future jury
reasoning).

## Top 5 recommendations (first-week gamefeel)

1. Make the first HOH un-fabricatable + prove live (#1664 verify): premiere ENDS in an engine-rolled
   comp; model-typed winner rewritten pre-emission.
2. Stop-at-the-question contract (owner's #3): one direct NPC question to the player ENDS the bubble —
   enforce like the winner rule.
3. Land #1662 + re-cast: coherent people, matching vaults; identity-consistent floor slots.
4. Producer speaks first; ghost session dies; thread renamed at move-in (0111).
5. Bind every scene to engine presence; kill the roll-call (circle already = met everyone; premiere
   flows circle→toast→beds→"Houseguests, to the backyard").

Fan postscript: whole night $0.32; casting interview worth re-watching. "The bones of a real premiere
are in there — the engine just has to be in the room when it happens."

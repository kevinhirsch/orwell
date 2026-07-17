# Lane: Presence / Location Parity Deep-Dive

> Source digest: `presence-parity-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign; the
> digest notes "full report in conversation" — this is the working digest).
> Lens: distributed-consistency & two-window parity, applied here to engine-truth ↔ gadget-rail ↔
> narration presence agreement across the same session.

---

HEADLINE: the ENGINE and the GADGET agreed with each other the ENTIRE session. The NARRATION diverged
from both on 19 of 23 turns, in two long phantom arcs: the "Bedroom B trio" (03:01→03:29, 28 min) and
the "HOH comp/assault/custody" arc (03:31→03:56). The owner's "room population did not update" = the
rail being RIGHT against a wrong story — but experienced as two authoritative surfaces contradicting for
~50 minutes with no arbitration cue.

FINDINGS:

PARITY-1 BLOCK: model called `moveTo` 0/200, `whereabouts` 1/200 — the session ran on belt-repaired
ghost positioning. Every engine-reaching player move was FE-belt-issued. The one `whereabouts` call (T5)
produced a graceful retcon — proof the model reconciles when it holds the read.

PARITY-2 BLOCK: `_auto_move_player` pre-filter reads only the PLAYER's message (`_MOVE_SIGNAL_RE`
`agent_loop.py:2400`, gate `:6234-6237`) — missed "follow/explore/meet", defeated by typos ("movining",
"goining"); the narration names destinations precisely but isn't read. NPC belt gates on narration
(`:6247`) — the asymmetry is the bug.

PARITY-3 BLOCK: narrated STATIC room population ("three women already claiming territory") has NO
corrective pathway either direction — extraction contract only accepts explicit walks (22/23 `moves:[]`);
trio stayed engine-kitchen the whole arc while narration had them in Bedroom B.

PARITY-4: presence-desync guard blind to FIRST-NAME staging (`_stages_in_scene`
`chat_helpers.py:1931` full-name only) + never checks the narrated PLAYER location; flagged 5 of ~19
divergent turns.

PARITY-5 LATENT-CONFIRMED: one-line clobber bug — `_handle_stale_beat` ASSIGNS the re-ground stash
(`chat_helpers.py:1115`) where every sibling site APPENDS; ate turn-11's presence directive live.

PARITY-6 CLEAN: the gadget + g15/SSE/poll refresh seams worked as designed all session (`freeze_view`,
`publish_game_updated_after_turn` gated on `beatSeq`, 25s poll floor; D1 freeze = by-design one-turn lag
for off-screen ticks, fails toward omission).

PARITY-7 BLOCK: phantom scenes LAUNDERED into engine truth — 13 auto-record-scene folds + 22 E22
fallbacks + meet-gate marks for encounters engine occupancy says never happened (incl. the drink-throw
fold). `recordInteraction` doesn't validate co-presence. ENGINE TRUTH NOW INTERNALLY INCONSISTENT
(events vs presence); recall will re-inject the contradiction forever. "Never narrated-but-unrecorded"
exists; "never recorded-but-impossible" does not.

PARITY-8 BLOCK: the fabricated-future class — HOH comp/winner/removal narrated with ZERO engine events;
pre-emission guard only corrects claims about DECIDED outcomes, not never-run events; overseer's gentle
next-turn reframes were ignored; session ended in a two-reality fork.

NPC population → rail pathways: engine off-screen ticks YES (one-turn D1 lag, by design); narrated
explicit walks YES (auto-move-npc, worked once); narrated STATIC placements NO PATHWAY AT ALL (the
owner's exact complaint).

FIX LADDER:

- F1 (hours): append-not-assign at `chat_helpers.py:1115`.
- F2 (hours): re-gate player move belt on the NARRATION (like the NPC belt) + widen regex
  (follow/explore/find/hunt/join/visit/check + typo-tolerant stems).
- F3 (hours): first-name staging detection (reuse gadget `_displayNames` disambiguation) + player-location
  clause in the guard.
- F4 (queue item): extend NPC extraction to propose placements for NPCs staged interacting with the
  player in the player's room; OR pre-emission population rewrite to engine present-list (closed-set:
  occupancy is board truth, ADR 0005-safe).
- F5 (queue item): forced `tool_choice=whereabouts` when player signals relocation and round had no
  moveTo/whereabouts.
- F6 (HCI): diegetic rail arbitration line ("the feeds still show you in Bedroom B") when chat↔board
  contradict.
- F7 (design): pre-emission guard clause for UNDECIDED/never-run closed-set events (wins-HOH while no
  pending/result exists ⇒ excise before emission).
- F8 (design): presence-legality invariant at the fold boundary — `recordInteraction`/
  `markHouseguestMet` cross-check `withIds` vs occupancy (don't PERSIST corruption; non-degradation cuts
  both ways).
- F9: split the ledger's `desyncDetected` boolean by class (0112).

Render-family side note: msg23 = two concatenated narrations (stall-nudge re-prompt appended second
visible scene, ONE-NARRATION-PER-TURN breach, `agent_loop.py:6258` comment); msg31 mid-word doubled seam
(`realign_body` splice `chat_routes.py:1800`). Separate ticket; not presence-causal.

export type OutwardChannel = "player" | "admin/God Mode";

/**
 * A tool exposed to an outward channel. `readsVault` is the literal `false`: the
 * type itself forbids registering a Vault-reading tool in these registries, so
 * the capability allowlist cannot grow a Vault reader without a compile error.
 */
export interface ToolDescriptor {
  name: string;
  channel: OutwardChannel;
  readsVault: false;
  description: string;
}

export const PLAYER_TOOLS: readonly ToolDescriptor[] = [
  // Onboarding + per-moment narration framing (Vault-free game-session port).
  { name: "updateCasting", channel: "player", readsVault: false, description: "Record casting-interview answers as they land (0050) — any subset of fields, any number of times pre-game (notes accumulate). Returns where the interview stands: what's on file, what's missing, the engine-picked next step, and whether casting is ready to finalize." },
  { name: "createCharacter", channel: "player", readsVault: false, description: "End the casting interview and start the season (0050): finalizes from everything updateCasting recorded (args may fill gaps or override; the recorded name is required). Returns the Vault-free game state with the player's casting card." },
  { name: "getGameState", channel: "player", readsVault: false, description: "Current Vault-free game state: phase, the player's card, and the house roster (names)." },
  { name: "gameStatus", channel: "player", readsVault: false, description: "Vault-free public status for the status panel: week/phase/HOH/nominees/veto (ceremony-level facts only)." },
  { name: "stateDelta", channel: "player", readsVault: false, description: "WHAT CHANGED since your last beatSeq ({sinceBeatSeq}): the player-visible events appended, the ceremony field diffs (HOH/noms/veto/phase/week), and any finished/winner flip — plus the current board (0065 Part E). Vault-free and O(Δ). An unknown/too-old token returns { fullRefresh: true } (fetch getGameState instead); an up-to-date token returns an empty delta." },
  { name: "playerTagline", channel: "player", readsVault: false, description: "A snarky, state-aware one-line Big Brother hero tagline for the player (Vault-free; reflects current standing)." },
  { name: "finaleView", channel: "player", readsVault: false, description: "Vault-free projection of an in-progress finale for the finale panel: finalists, stage, and the votes revealed so far (null when no finale is staging)." },
  { name: "getMomentPrompt", channel: "player", readsVault: false, description: "The managed system prompt to inject for the current moment (persona + framing; Vault-free)." },
  { name: "getVisibleStateFor", channel: "player", readsVault: false, description: "Visible events + the player's own knowledge." },
  { name: "renderScene", channel: "player", readsVault: false, description: "Narrate a moment from the visible projection." },
  { name: "socialRead", channel: "player", readsVault: false, description: "Honest, Vault-free read of the room or a houseguest; may hint, never names off-screen events." },
  { name: "socialInitiatives", channel: "player", readsVault: false, description: "Which houseguests want to approach the player now (relationship-driven; names + a coarse motive category (bond | probe) the narrator voices in its own words — never a number)." },
  { name: "whereabouts", channel: "player", readsVault: false, description: "Where the player stands in the house (0049): their room, who is in it, and who is in each ADJACENT room — names only, never motives, numbers, or non-adjacent rooms." },
  { name: "moveTo", channel: "player", readsVault: false, description: "The player WALKS to a room they named ({room}). Valid rooms: kitchen, living room, backyard, bedroom A, bedroom B, HOH room, bathroom, storage room (the diary room is its own beat). Name resolution is FORGIVING — case/space/hyphen-insensitive plus natural aliases (\"living room\"/\"lounge\", \"backyard\"/\"yard\", \"HOH\", \"pantry\"); a bare \"bedroom\" resolves to the player's own bedroom — so it never silently fails. The player is a person — they direct their own movement; call this whenever the player heads somewhere, then voice the new room from the returned whereabouts (the engine holds them there; NPCs move around them)." },
  { name: "premiereIntros", channel: "player", readsVault: false, description: "PREMIERE ONLY (#380): the meet-everyone progress — who the player has met and who is STILL to introduce before the first HOH, each with their OBSERVABLE public persona (archetype/strategy/background/age/presentation/demeanor — never the soul, a number, or how the player feels). Drive the introductions from this so nobody is skipped; null outside the premiere." },
  { name: "markHouseguestMet", channel: "player", readsVault: false, description: "PREMIERE ONLY (#380): mark a houseguest ({id}) as INTRODUCED/met the instant they have introduced their public self. Idempotent; the engine tracks who's met so all 15 NPCs are met before the first HOH. Returns the updated meet-everyone progress (null outside the premiere)." },
  { name: "moveHouseguest", channel: "player", readsVault: false, description: "Record a NARRATED houseguest relocation (ADR 0009): an NPC ({id}) walks to a room ({room}) the narration just sent them to, so the board agrees with the prose (no visible historic conflict). Open-set only — never perturbs seeded outcomes. Room resolution is forgiving (like moveTo); a no-op if they are already there; REFUSED (illegal) for the player (use moveTo), an unknown/evicted houseguest, or a non-walkable/unknown room. Primarily the front-end records this FROM the narration; the model need not call it directly." },
  { name: "seasonRecap", channel: "player", readsVault: false, description: "The season's public arc from the event record (0048): reigns, ceremonies, evictions, deals — Vault-free, stores not memory." },
  { name: "seasonRetrospective", channel: "player", readsVault: false, description: "POST-SEASON ONLY (0048): the finished season's unsealed hidden story — off-screen scheming, confessionals, the twists. Returns null while a season is live (gated on the terminal state in code)." },
  { name: "npcVoice", channel: "player", readsVault: false, description: "The knowledge-bounded voicing projection for ONE active houseguest (B65): persona + room/co-presence + what THEY legitimately know + hunches + organic stances (labels, never numbers). The model cannot voice what they never learned." },
  { name: "getPortraitPrompt", channel: "player", readsVault: false, description: "The Vault-free image-generation prompt for ONE houseguest's portrait (0051): built from PUBLIC appearance facets + the per-season photorealistic style anchor. Null pre-game or for an unknown id. No stat/soul/hidden element ever reaches the prompt." },
  { name: "askProducers", channel: "player", readsVault: false, description: "Direct interrogation; never confirms/denies Vault content." },
  { name: "endOfSessionSummary", channel: "player", readsVault: false, description: "Confirms only that updated save(s) exist." },
  // Action tools (0009): request in, Vault-free result out (engine performs them).
  // E20: `resolveCompetition` (caller-supplied stats + seed) is REMOVED — a second, seed-shoppable
  // resolver one call away from the player channel. `runCompetition` is the single outcome authority.
  { name: "recordInteraction", channel: "player", readsVault: false, description: "Record a player-witnessed interaction (the witness set must include the player); returns its id." },
  { name: "runCompetition", channel: "player", readsVault: false, description: "PREVIEW the current competition beat's already-decided winner (the weekly loop crowns the same one when advanceGame resolves the beat — never a second resolver); returns the winner (name) plus the drawn comp's name/format/narrative scaffold — never a stat or score." },
  { name: "surfaceInformationTo", channel: "player", readsVault: false, description: "Move a hidden fact into knowledge via a recorded in-game pathway." },
  { name: "diaryRoom", channel: "player", readsVault: false, description: "Record a player Diary-Room entry: the player's own OOC knowledge, with no in-game pathway to any houseguest." },
  { name: "advanceGame", channel: "player", readsVault: false, description: "Advance the weekly loop by one beat (HOH→noms→veto→ceremony→eviction→finale); stops and returns a pending decision when it's the player's turn to choose." },
  { name: "submitDecision", channel: "player", readsVault: false, description: "Resolve the player's pending binding decision — whatever kind the engine is blocked on; the pending decision itself names its kind and legal options — and continue the loop. (For a confirmed self-eviction (0061), submit { kind: 'self-evict', confirmed: true } — ONLY after the player has explicitly confirmed the raised confirmation.)" },
  { name: "requestSelfEviction", channel: "player", readsVault: false, description: "Step 1 of a player self-eviction (0061): the player expressed an OOC intent to LEAVE/quit. Raise the confirmation (names the irreversible stakes) and change NO state — the house never hears it, and nothing evicts until the player explicitly confirms via submitDecision({ kind:'self-evict', confirmed:true }). FE-driven; never call this off an in-character throwaway line." },
  { name: "cancelSelfEviction", channel: "player", readsVault: false, description: "Cancel a raised self-eviction confirmation (0061): the player decided to stay. Clears the confirmation; they remain ACTIVE and in the house, unchanged." },
  { name: "turnIn", channel: "player", readsVault: false, description: "The player's bedtime lever (ADR 0006): the player CHOOSES to turn in for the night. Ends their night where it stands (an early night ⇒ rested for tomorrow's comp; outlasting the house into late-night ⇒ running on empty) and rolls the house to the next morning. The player is never auto-slept — only this call retires them. FE-driven; a no-op when the clock isn't running." },
  { name: "makeDeal", channel: "player", readsVault: false, description: "Make a deal with a houseguest (safety / vote / final-two / target-other). Tracked as a first-class promise; the engine reconciles it against later binding actions and a broken promise hurts." },
  { name: "recordImageBeat", channel: "player", readsVault: false, description: "Record that an in-character image was shown to the player (0051) — a player-witnessed image-shown event so it has memory ('recorded or it didn't happen'). Returns its id." },
  // FE-driven authoring/pre-warm seams (0058/0065) — NOT model levers (the FE producer-LLM drives them).
  { name: "preSeedCast", channel: "player", readsVault: false, description: "FE-driven (0065): pre-warm the player-INDEPENDENT cast off the season seed BEFORE the casting interview ends, so the FE can deeply author it and the portrait prompts read the finished store. Returns the Vault-free roster + the cast portrait prompts; mints + persists the season seed (which createCharacter then adopts). Idempotent; durable. Not a model lever." },
  { name: "preSeedNextSeason", channel: "player", readsVault: false, description: "FE-driven (0065 advance-warm): pre-warm the NEXT season's cast DURING the current season's finale, off a NEW seed, into a per-user holding store that survives the cutover rotation (preSeedCast is refused mid-season; this is its mid-season counterpart). The ACTIVE season is untouched; the confirmed next-season cutover ADOPTS the held cast. Optionally deep-authors one held houseguest ({ profile }), like recordCastProfile. Returns the Vault-free roster + portrait prompts. Idempotent; durable. Not a model lever." },
  { name: "recordCastProfile", channel: "player", readsVault: false, description: "FE-driven write-back (0058/0065): seal one houseguest's authored §3 profile — the PUBLIC biography + structured physical facet (cross to the player) SPLIT from the HIDDEN secrets/true-goals/weakness/Day-1 read (Vault-sealed). Reports accepted field NAMES only, never a hidden value; refuses a player-mirroring profile. Lands on the pre-warmed cast pre-game, the live house once a season runs. Not a model lever." },
  { name: "recordWorldSnapshot", channel: "player", readsVault: false, description: "FE-driven write-back (0062): freeze the move-in zeitgeist — the PUBLIC, shared real-world flavor the whole cast moved in WITH (an optional subset of public slices: screen/music/sports/news/internet/mood). The FE owns the concrete web-search capture (like the 0051 image port); the engine persists it as the single FROZEN artifact and RECALLS it (never re-searches) all season. Empty slices keep the fallback's value (non-degradation). Public flavor only — no Vault, no game input. Not a model lever." },
];

export const ADMIN_TOOLS: readonly ToolDescriptor[] = [
  { name: "inspectNonVaultState", channel: "admin/God Mode", readsVault: false, description: "Inspect non-Vault game state." },
  { name: "overrideMechanic", channel: "admin/God Mode", readsVault: false, description: "Override a non-Vault mechanic in the sandbox; returns updated non-Vault state." },
  { name: "configure", channel: "admin/God Mode", readsVault: false, description: "Set non-Vault tunables (temperature/relationship config, reserve-twist COUNT — never twist content)." },
  { name: "manageSandbox", channel: "admin/God Mode", readsVault: false, description: "Sandbox lifecycle for this sandbox only (create | reset | save | load)." },
  { name: "sandboxHealth", channel: "admin/God Mode", readsVault: false, description: "Vault-free sandbox health (B58): week/phase, last advance, integrity status, recent faults, circuit state — metadata only, never game content." },
  { name: "advanceToFinale", channel: "admin/God Mode", readsVault: false, description: "DEBUG (L38): fast-forward THIS sandbox's live season to a crowned winner — drives the deterministic loop, auto-resolving the player's pending decisions with legal defaults, so the post-season retrospective (0048) unseals legitimately. Reads NO Vault; returns only a Vault-free summary (winner name, weeks played, the player's final placement)." },
  { name: "setTimeOfDay", channel: "admin/God Mode", readsVault: false, description: "ADR 0006: turn the in-game time-of-day clock + nightly sleep economy ON or OFF at runtime (the FE settings switch flips it here — no engine restart). { enabled: boolean }. A process-global override of the ORWELL_TIME_OF_DAY env default; resets on restart (the FE re-applies the persisted setting on boot). Vault-free." },
];

export function toolsFor(channel: OutwardChannel): readonly ToolDescriptor[] {
  return channel === "player" ? PLAYER_TOOLS : ADMIN_TOOLS;
}

/**
 * Pure infrastructure, NOT game-driving levers — excluded from the agent's lever
 * manifest in the base game-master prompt (0018): `getMomentPrompt` supplies the
 * prompt itself, `endOfSessionSummary` just confirms a save exists.
 */
// (E20: resolveCompetition is gone from the channel entirely — runCompetition has been the single
// competition authority since B37; an un-advertised-but-callable second resolver was still a seam.)
const INFRA_LEVERS: ReadonlySet<string> = new Set(["getMomentPrompt", "endOfSessionSummary", "playerTagline", "finaleView", "getPortraitPrompt", "recordImageBeat",
  // 0065 Part E: `stateDelta` is FE/harness infrastructure (the per-turn "what changed since" feed the
  // FE weaves into the moment context) — NOT a game-driving lever the model pulls. Excluded from the
  // base prompt's lever manifest so the manifest↔registry drift test stays green.
  "stateDelta",
  // 0058/0065: the cast pre-warm + authoring write-back are FE-driven seams (the producer-LLM authors
  // the cast, the FE pre-warms it before portraits), NOT game-driving levers the GM model pulls — so
  // they stay OUT of the base prompt's lever manifest (the manifest↔registry drift test stays green).
  // `preSeedNextSeason` (0065 advance-warm) is the same family: an FE-driven finale-day warm of the NEXT
  // season's cast into the holding store, never a GM lever.
  "preSeedCast", "preSeedNextSeason", "recordCastProfile",
  // 0062: the move-in zeitgeist write-back is an FE-driven seam (the front-end owns the concrete
  // web-search capture and freezes it onto the season), NOT a game-driving lever the GM model pulls —
  // so it stays OUT of the base prompt's lever manifest (the manifest↔registry drift test stays green).
  "recordWorldSnapshot",
  // 0061: `cancelSelfEviction` is the confirmation card's own Cancel action (FE-driven), NOT a model
  // lever. `requestSelfEviction` IS advertised (below): on a clear OOC intent the model raises the
  // confirmation — which changes NO state — and the player's explicit confirm (the card) is what binds.
  "cancelSelfEviction",
  // ADR 0006: `turnIn` is the FE-driven bedtime lever (the "head to bed" affordance that surfaces in
  // the late-night edge cases), NOT an always-on base-manifest model lever — so it stays OUT of the
  // base prompt's lever manifest (the manifest↔registry drift test stays green), like cancelSelfEviction.
  "turnIn",
  // PREMIERE meet-everyone (#380): both are PREMIERE-only levers fully documented in the `premiere`
  // moment fragment (the meet-everyone flow + markHouseguestMet are spelled out there with their
  // who's-left list woven in), NOT always-on base-manifest levers — so they ride the moment, like
  // finaleView rides the finale. Excluding them keeps the base prompt untouched (drift test stays green).
  "premiereIntros", "markHouseguestMet",
  // ADR 0009: `moveHouseguest` records a NARRATED NPC relocation — primarily an FE/belt-driven lever
  // (the model narrates the open texture; the engine records it), NOT an always-on base-manifest model
  // lever, like `turnIn`. Excluding it keeps the base prompt untouched (the manifest↔registry drift test
  // stays green).
  "moveHouseguest"]);

/**
 * The game-driving player levers the agent should know how to pull. This is the
 * single source of truth the base prompt's lever manifest must stay in sync with
 * (0018) — the manifest↔registry drift test fails if any of these is unnamed.
 */
export const PLAYER_AGENT_LEVERS: readonly string[] =
  PLAYER_TOOLS.filter((t) => !INFRA_LEVERS.has(t.name)).map((t) => t.name);

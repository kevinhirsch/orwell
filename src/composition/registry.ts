import { buildEngineCore } from "./engineRoot";
import type { EngineCore } from "./engineRoot";
import { buildOutwardChannels } from "./outwardRoot";
import { InMemoryGameStateRepository } from "../adapters/inmemory/InMemoryGameStateRepository";
import { EngineCommandsAdapter } from "../adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../adapters/engine/GameSessionAdapter";
import { InMemoryKnowledgeService } from "../adapters/inmemory/InMemoryKnowledgeService";
import { InMemoryEventStore } from "../adapters/inmemory/InMemoryEventStore";
import { McpServer } from "../adapters/mcp/McpServer";
import { PLAYER } from "../domain/ids";
import { SeededRandom } from "../adapters/random/SeededRandom";
import { hashSeed } from "../engine/characterFactory";
import {
  DEEP_PROFILE_KIND, STORY_THREAD_KIND, deepProfileVaultId, deepProfileToVaultContent, storyThreadToVaultContent,
} from "../engine/deepProfile";
import { preGameTieToVaultContent, showmanceToVaultContent } from "../engine/seededRelationships";
import type { PlayerSurface } from "../surfaces/player/PlayerSurface";
import type { AdminPort } from "../surfaces/admin/AdminPort";
import type { SummaryService } from "../services/SummaryService";
import type { UserSaveStore } from "../ports/UserSaveStore";
import { SNAPSHOT_VERSION, snapshotCompatible } from "../engine/sessionSnapshot";
import type { SessionSnapshot } from "../engine/sessionSnapshot";

/**
 * Per-user game sandboxes (feature 0021). Each authenticated user gets ONE active
 * game in a fully isolated sandbox — its own engine core (events, Vault, knowledge,
 * relationships), GameSession, outward surfaces, and MCP servers. Many users run
 * at once, each a separate object graph, so NO call on behalf of user A can ever
 * reach user B's state. This is a second isolation axis, orthogonal to the Vault
 * Wall (which still holds inside every sandbox).
 *
 * Lives in the composition layer (it wires the engine root, which holds the Vault);
 * the outward HTTP transport never imports this — it receives a Vault-free resolver.
 */
export interface UserSandbox {
  engine: EngineCore;
  player: PlayerSurface;
  admin: AdminPort;
  summary: SummaryService;
  session: GameSessionAdapter;
  commands: EngineCommandsAdapter;
  mcp: { player: McpServer; admin: McpServer };
  /** Project the live session's PUBLIC facts onto the admin state (B58/audit E5) — roles only. */
  syncAdmin: () => void;
}

function buildUserSandbox(user = "default"): UserSandbox {
  const engine = buildEngineCore();
  const adminState = new InMemoryGameStateRepository({ week: 1, phase: "setup", houseguests: [] });
  const outward = buildOutwardChannels({
    player: PLAYER, events: engine.events, knowledge: engine.knowledge, adminState,
  });
  // A PER-USER rng (B60/audit E12): the command seam's folds/overhears were identical across every
  // sandbox (a shared SeededRandom(1)) — now each user's stream is their own.
  const commands = new EngineCommandsAdapter(
    engine.events, engine.knowledge, engine.relationships, new SeededRandom(hashSeed(`commands:${user}`)),
  );
  const session = new GameSessionAdapter(engine.relationships);
  // Wire the engine-only soul store (0024) into the live session so consequential beats + off-screen
  // scenes deepen each NPC's arc and ground their later voice (the 0041 linchpin).
  session.setSoul(engine.soul);
  // Name resolution for outward prose (non-Vault: names are public): the player surface uses this
  // so socialRead names the houseguest instead of echoing a raw `npc:N` id into the read.
  outward.player.setNameResolver((id) => session.publicName(id));
  // The PLAYER-FACING CONTENT scrub (audit R4-03 / C-01): the visible projection's event/knowledge
  // content also interpolates raw ids + pathway slugs — wire the live public roster so the narrator
  // receives names ("Ada and Bo are getting close"), never `npc:8 and npc:14 are … · more or less#7`.
  outward.visible.setRoster(() => session.publicRoster());
  // Validated references (B39): a recorded interaction may only name LIVING houseguests — the session
  // knows who's still in the house (player + non-evicted NPCs).
  commands.setLivingProvider(() => session.livingIds());
  // House presence (0049): recorded scenes are grounded in the live occupancy — co-present
  // houseguests witness them; occupants of adjacent rooms may overhear (both directions).
  commands.setPresenceProvider(() => session.occupancy());
  // L27/L27b/0024: every recorded social scene is indexed into each houseguest's SEMANTIC recall
  // memory, so later story/narrative is built from the store recalled (ADR 0003), never the chat
  // window. Routed through the session's `recordSceneMemory` — NOT engine.soul.recordToSoul directly —
  // so the summary lands in the houseguest's PERSISTED `soul.memory` mirror too (L27b): the vector
  // index is derived state that `rebuildSoulIndex` re-derives ONLY from the persisted mirror, so a
  // scene recorded N turns ago stays recall-able IN FULL across a restart (it used to vanish on
  // restore — the event record survived but the NPC could no longer recall the scene).
  commands.setSoulMemo((hg, content) => session.recordSceneMemory(hg, content));
  // Per-NPC voicing (B65 / ADR 0003 §8): the session projects ONE houseguest's legitimate
  // knowledge + hunches so the narrator can voice them without inventing or omnisciently leaking.
  session.setNpcKnowledgeProviders({
    known: (id) => engine.knowledge.knownTo(id),
    suspicions: (id) => engine.knowledge.suspicionsOf(id),
  });
  // The season record (0048/B56): the recap reads the PUBLIC record; the retrospective reads the
  // hidden side THROUGH the session's finished-state gate (the one sanctioned Vault seam).
  session.setRecordProviders({
    events: () => engine.events.query(),
    hidden: () => engine.vault.readHidden(),
  });
  // Reserve twists (0025/B53): the loaded schedule is SEALED into the Vault — the audit copy no
  // player or admin surface can reach (0001 holds structurally), and 0048's unsealing payoff.
  session.setOnSeal((reserve) => {
    for (const t of reserve) {
      engine.vault.writeHidden({
        id: `twist:${engine.vault.readHidden({ kind: "reserved-twist" }).length}`,
        kind: "reserved-twist",
        content: `sealed reserve twist: ${t.kind}, fires week ${t.fireAtBeat}`,
      });
    }
  });
  // Deep character profiles (feature 0058): SEAL each NPC's HIDDEN profile + story threads into the
  // Vault — the audit copy no player OR admin surface can reach (0001), and the 0048 unsealing payoff.
  // This is the SAME hidden-seal seam the reserve twists use — engine-only by construction. The
  // SOUL indexing (full-fidelity recall, L27b) is done by the adapter's seedDeepProfiles into each
  // NPC's authoritative soul.memory (so it persists + re-indexes on restore); the PUBLIC facets fold
  // onto the byte-stable Character separately (they cross to the player).
  session.setOnSealProfiles((profiles, threads) => {
    for (const { id, profile } of profiles) {
      engine.vault.writeHidden({
        id: deepProfileVaultId(id), kind: DEEP_PROFILE_KIND, subject: id, content: deepProfileToVaultContent(id, profile),
      });
    }
    for (const t of threads) {
      engine.vault.writeHidden({ id: t.id, kind: STORY_THREAD_KIND, subject: t.sourceId, content: storyThreadToVaultContent(t) });
    }
  });
  // L28b — the AUTHORED write-back re-seals ONE houseguest: REPLACE that subject's prior profile +
  // thread records (idempotent, no stale/duplicated records) via the engine-only Vault upsert.
  session.setOnResealProfile((id, profile, threads) => {
    engine.vault.replaceHidden({ kind: DEEP_PROFILE_KIND, subject: id }, [
      { id: deepProfileVaultId(id), kind: DEEP_PROFILE_KIND, subject: id, content: deepProfileToVaultContent(id, profile) },
    ]);
    engine.vault.replaceHidden(
      { kind: STORY_THREAD_KIND, subject: id },
      threads.map((t) => ({ id: t.id, kind: STORY_THREAD_KIND, subject: t.sourceId, content: storyThreadToVaultContent(t) })),
    );
  });
  // 0059 — SEAL the hidden seeded relationship layer (pre-game ties + showmances) into the Vault: the
  // engine-only audit copy no player OR admin surface can reach (0001), like the reserve twists (0025).
  session.setOnSealSeededRels((rels) => {
    for (let i = 0; i < rels.ties.length; i++) {
      const t = rels.ties[i]!;
      engine.vault.writeHidden({ id: `seeded-tie:${i}`, kind: "seeded-relationship", subject: t.a, content: preGameTieToVaultContent(t) });
    }
    for (let i = 0; i < rels.showmances.length; i++) {
      const s = rels.showmances[i]!;
      engine.vault.writeHidden({ id: `seeded-showmance:${i}`, kind: "seeded-relationship", subject: s.a, content: showmanceToVaultContent(s) });
    }
  });
  // 0059/L40 — a showmance that becomes VISIBLE is a PUBLIC house fact: record it as a player-witnessed
  // (non-hidden) event so it enters the player's knowledge and the narrator may voice the romance.
  session.setOnShowmanceSurfaced((sm) => engine.events.record({
    id: `showmance:${sm.a}:${sm.b}:${engine.events.query().length}`,
    ts: engine.events.query().length,
    type: "house-event",
    initiator: sm.a,
    witnessSet: [PLAYER, sm.a, sm.b],
    hidden: false,
    content: `${sm.aName} and ${sm.bName} have grown close — the house is starting to notice a showmance`,
  }));
  // Weekly-loop beats (0011) are player-witnessed events: record them so they enter the
  // player's knowledge and the durable snapshot (never hidden — the player lived them).
  session.setOnEvent((ev) => engine.events.record({
    id: `season:${engine.events.query().length}`,
    ts: engine.events.query().length,
    type: "house-event",
    initiator: ev.participants[0] ?? PLAYER,
    witnessSet: [PLAYER, ...ev.participants.filter((p) => p !== PLAYER)],
    hidden: false,
    content: ev.content,
  }));
  // One-off witnessed events (a deal made / a promise broken, 0039). Hidden iff the player is NOT
  // a witness — so a player-party deal is their knowledge, never the Vault.
  session.setOnPlayerEvent((content, witnessSet, type = "deal") => {
    const id = `deal:${engine.events.query().length}`;
    engine.events.record({
      id, ts: engine.events.query().length, type,
      initiator: witnessSet[0] ?? PLAYER, witnessSet: [...witnessSet],
      hidden: !witnessSet.includes(PLAYER), content,
    });
    return id;
  });
  const deps = { player: outward.player, admin: outward.admin, summary: outward.summary, commands, session };
  // B58/audit E5: the admin's inspectable state mirrors the LIVE session's public facts (week,
  // phase, roles-only roster) — refreshed on every persisted mutation, never a never-updated stub.
  const syncAdmin = (): void => {
    const core = session.snapshot();
    const prev = adminState.getAdminVisibleState();
    const seat = (id: string): string => (core.live?.evictionOrder ?? []).includes(id) ? "evicted" : "active";
    adminState.setAdminVisibleState({
      ...prev,
      week: core.week,
      phase: core.phase,
      houseguests: core.house
        ? [
            { role: "player", status: seat(core.house.player.id) },
            ...core.house.npcs.map((n) => ({ role: "npc", status: seat(n.id) })),
          ]
        : [],
    });
  };
  return {
    engine,
    player: outward.player,
    admin: outward.admin,
    summary: outward.summary,
    session,
    commands,
    mcp: { player: new McpServer("player", deps), admin: new McpServer("admin/God Mode", deps) },
    syncAdmin,
  };
}

/** Export the user's full durable snapshot: session core + engine detail (events + hidden beliefs + knowledge). */
function exportSnapshot(sb: UserSandbox): SessionSnapshot {
  return {
    ...sb.session.snapshot(),
    snapshotVersion: SNAPSHOT_VERSION,
    events: sb.engine.events.query(),
    relationships: sb.engine.relationships.serialize().edges,
    // The whole knowledge layer (B40) — facts + suspicions + counters — so a restart resumes it.
    knowledge: (sb.engine.knowledge as InMemoryKnowledgeService).serialize(),
    // The Vault's hidden records (B53/audit I7) — sealed twists et al. survive a restart too.
    vault: sb.engine.vault.readHidden(),
  };
}

/**
 * Rebuild a fresh sandbox from a durable snapshot — resume the game, don't reset it. An UNKNOWN
 * (future) schema version is rejected (throws) rather than silently mis-restored (B40/audit C4); a
 * versionless legacy save migrates forward (it simply had no persisted knowledge layer).
 */
function importSnapshot(sb: UserSandbox, snap: SessionSnapshot): void {
  if (!snapshotCompatible(snap)) throw new Error(`incompatible snapshot version: ${snap.snapshotVersion}`);
  sb.session.restore(snap);
  for (const e of snap.events) (sb.engine.events as InMemoryEventStore).restoreRecord(e); // ids/ts/hidden preserved exactly
  sb.engine.relationships.load(snap.relationships);
  if (snap.knowledge) (sb.engine.knowledge as InMemoryKnowledgeService).load(snap.knowledge);
  for (const r of snap.vault ?? []) sb.engine.vault.writeHidden(r); // the producer's secrets resume sealed
}

export class GameSessionRegistry {
  /** Default cap on RESIDENT sandboxes (R4): beyond it, the least-recently-used unloads to disk. */
  private static readonly DEFAULT_MAX_RESIDENT = 64;

  private readonly sandboxes = new Map<string, UserSandbox>();
  private readonly maxResident: number;

  /**
   * An optional durable store (0030) makes the live game survive an engine restart:
   * `sandboxFor` recalls the user's saved game on first build, and every mutation
   * saves it. With no store, the registry is purely in-memory (the prior behavior).
   */
  constructor(private readonly saveStore?: UserSaveStore, opts: { maxResident?: number } = {}) {
    this.maxResident = Math.max(1, opts.maxResident ?? GameSessionRegistry.DEFAULT_MAX_RESIDENT);
  }

  /**
   * Wire the per-user hooks every sandbox needs (B41/B58): the commit hook (checkpoint-then-save),
   * the live admin mirror, the REAL admin reset delegate, the ONE restart door for the player
   * channel, and the Vault-free health provider.
   */
  private wireHooks(user: string, sb: UserSandbox): void {
    const persist = (): void => {
      sb.syncAdmin(); // the admin's inspectable state tracks the live game (B58/E5)
      this.commit(user);
    };
    sb.session.setOnPersist(persist); // save-on-mutation (0030) / checkpoint-then-save (B41)
    sb.commands.setOnPersist(persist);
    sb.admin.setResetDelegate(() => {
      this.resetUser(user); // the admin reset re-onboards the REAL game (B58/E5; B36/C12 route here)
    });
    // ONE sanctioned restart door (audit E1/D1/R1): a confirmed player-channel restart
    // (`createCharacter` + `confirmRestart` — the FE's reset path) converges on the SAME
    // `resetUser` the admin door uses — orchestrator baseline forgotten, dead season's saves
    // rotated, a clean sandbox — and season 2 is created THERE. Two doors, one hinge.
    sb.session.setOnRestart((req) => {
      const fresh = this.resetUser(user);
      return fresh.session.createCharacter(req);
    });
    sb.admin.setHealthProvider(() => this.healthProvider?.(user) ?? null);
    // L38: the God-Mode "fast-forward to finale (debug)" lever DRIVES the live session to a crowned
    // winner (auto-resolving the player's pendings with legal defaults) so the post-season Vault
    // retrospective (0048) opens through its own gate. Vault-free by construction — the session
    // returns only the public summary (winner NAME, weeks, placement); it reads no Vault, and each
    // driven beat commits through the SAME checkpointed `onPersist` a live decision does.
    sb.admin.setFastForwardProvider(() => sb.session.advanceToFinale());
    sb.syncAdmin();
  }

  /** The user's isolated sandbox — created on first use, RESUMED from durable storage on return. */
  sandboxFor(user: string): UserSandbox {
    let sb = this.sandboxes.get(user);
    if (!sb) {
      sb = buildUserSandbox(user);
      if (this.saveStore?.hasSave(user)) {
        const snap = this.saveStore.loadLatest(user);
        // Resume from the durable save — but an incompatible/corrupt snapshot must REJECT into a fresh
        // sandbox (B40/B35), never crash the resume. The bad save is left on disk for inspection.
        if (snap) {
          try {
            importSnapshot(sb, snap); // resume instead of fresh setup (the welcome-overlay fix)
          } catch {
            // G12: a refused resume may already have flooded the shared soul-index lane
            // (`rebuildSoulIndex` runs before the part that threw) — drop the dead graph's
            // queued embeds so they never crowd the fresh sandbox's.
            sb.engine.soul.discardPending();
            sb = buildUserSandbox(user);
          }
        }
      }
      this.wireHooks(user, sb);
      this.sandboxes.set(user, sb);
    } else {
      // LRU touch (R4): Map iteration is insertion-ordered — re-inserting keeps the oldest first.
      this.sandboxes.delete(user);
      this.sandboxes.set(user, sb);
    }
    this.unloadIdle(user);
    return sb;
  }

  /**
   * Idle-sandbox LRU unload (audit R4): resident sandboxes were never evicted — +1.6MB RSS per
   * user, permanently. With a durable store, a sandbox provably rebuilds from its save, so beyond
   * `maxResident` the least-recently-used ones are saved and dropped from memory; their next
   * request resumes from disk. Without a store nothing unloads (an in-memory game has no disk to
   * come back from). The engine is synchronous through every mutation, so an unload can never
   * interleave a half-applied turn.
   */
  private unloadIdle(current: string): void {
    if (!this.saveStore) return;
    while (this.sandboxes.size > this.maxResident) {
      const next = this.sandboxes.entries().next().value;
      if (next === undefined || next[0] === current) return; // never unload the sandbox being served
      this.saveUser(next[0]); // park the latest state before dropping the object graph
      // G12: the parked graph's queued soul-index work is derived state for indexes about to be
      // garbage (the resume re-derives them) — drop it from the shared breathing lane.
      next[1].engine.soul.discardPending();
      this.sandboxes.delete(next[0]);
    }
  }

  /**
   * The per-mutation commit hook. By default it is a blind save-on-mutation (0030). When the runtime
   * wires the orchestrator (B41/audit E3), `setCommit` routes it through a checkpoint-then-save so the
   * fail-closed integrity check (0031) runs on EVERY player turn, not just watcher ticks.
   */
  private commitDelegate?: (user: string) => void;

  /** Route per-mutation persistence through a checkpointed commit (the orchestrator's player-turn). */
  setCommit(fn: (user: string) => void): void {
    this.commitDelegate = fn;
  }

  /** Invoked after every mutation (the wired `onPersist`): the orchestrator's commit, or a blind save. */
  private commit(user: string): void {
    if (this.commitDelegate) this.commitDelegate(user);
    else this.saveUser(user);
  }

  /** Persist the user's current sandbox to durable storage (a no-op without a store). A caller
   *  that already exported the snapshot passes it (R3) — never re-serialize the same state. */
  saveUser(user: string, snap?: SessionSnapshot): void {
    const sb = this.sandboxes.get(user);
    if (sb && this.saveStore) this.saveStore.saveFor(user, snap ?? exportSnapshot(sb));
  }

  /** The user's full in-memory snapshot (session core + engine detail). Orchestrator/0031. */
  snapshot(user: string): SessionSnapshot {
    return exportSnapshot(this.sandboxFor(user));
  }

  /**
   * Replace the user's sandbox with a CLEAN one rebuilt from a snapshot — used to
   * roll back a failed integrity checkpoint (0031) without leaving the aborted
   * advance's events behind. The durable save is untouched by this call.
   */
  restore(user: string, snap: SessionSnapshot): UserSandbox {
    // G12: the rolled-back graph's queued soul-index work dies with it — the clean rebuild
    // below re-floods the shared lane from the snapshot, breathing (one embed per macrotask).
    this.sandboxes.get(user)?.engine.soul.discardPending();
    const sb = buildUserSandbox(user);
    importSnapshot(sb, snap);
    this.wireHooks(user, sb);
    this.sandboxes.set(user, sb);
    return sb;
  }

  /** The users with a live in-memory sandbox (the watcher iterates these). */
  usernames(): string[] {
    return [...this.sandboxes.keys()];
  }

  /** Number of distinct user sandboxes currently held (concurrency visibility). */
  userCount(): number {
    return this.sandboxes.size;
  }

  /**
   * The ONE sanctioned restart door (audit E1/D1/R1): start a fresh game for the user — replaces
   * ONLY their own sandbox (others untouched). Both restart surfaces converge here (the admin's
   * `manageSandbox("reset")` delegate and the player channel's confirmed `createCharacter`), and
   * the reset is COMPLETE: the dead season's durable saves rotate off the live path (so an engine
   * restart can never resurrect it — R1) and the orchestrator forgets its baseline/faults/health
   * via `onReset` (so season 2's first commit isn't a "degradation" against a finished season — E1).
   */
  resetUser(user: string): UserSandbox {
    // G12: the dead season's queued (derived) soul-index work must not crowd the shared
    // breathing lane the new season seeds through — discard it with the sandbox it served.
    this.sandboxes.get(user)?.engine.soul.discardPending();
    this.saveStore?.resetUser?.(user); // rotate the dead season's saves off the live path (R1)
    this.onReset?.(user); // invalidate the orchestrator's baseline/health/rng for this user (E1)
    const sb = buildUserSandbox(user);
    this.wireHooks(user, sb);
    this.sandboxes.set(user, sb);
    return sb;
  }

  /** Reset hook (E1): the runtime wires this to `Orchestrator.forgetUser`. */
  private onReset?: (user: string) => void;

  setOnReset(fn: (user: string) => void): void {
    this.onReset = fn;
  }

  /** Vault-free per-user health (B58/E5+E6) — composed by the runtime over the orchestrator. */
  private healthProvider?: (user: string) => unknown;

  setHealthProvider(fn: (user: string) => unknown): void {
    this.healthProvider = fn;
  }

  /** A Vault-free channel resolver for the HTTP transport (keeps the outward layer Vault-free). */
  resolver(): (channel: "player" | "admin", user: string) => McpServer {
    return (channel, user) => {
      const sb = this.sandboxFor(user);
      return channel === "player" ? sb.mcp.player : sb.mcp.admin;
    };
  }
}

import { buildEngineCore } from "./engineRoot";
import type { EngineCore } from "./engineRoot";
import { buildOutwardChannels } from "./outwardRoot";
import { InMemoryGameStateRepository } from "../adapters/inmemory/InMemoryGameStateRepository";
import { EngineCommandsAdapter } from "../adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../adapters/engine/GameSessionAdapter";
import { McpServer } from "../adapters/mcp/McpServer";
import { PLAYER } from "../domain/ids";
import type { PlayerSurface } from "../surfaces/player/PlayerSurface";
import type { AdminPort } from "../surfaces/admin/AdminPort";
import type { SummaryService } from "../services/SummaryService";
import type { UserSaveStore } from "../ports/UserSaveStore";
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
}

function buildUserSandbox(): UserSandbox {
  const engine = buildEngineCore();
  const adminState = new InMemoryGameStateRepository({ week: 1, phase: "setup", houseguests: [] });
  const outward = buildOutwardChannels({
    player: PLAYER, events: engine.events, knowledge: engine.knowledge, adminState,
  });
  const commands = new EngineCommandsAdapter(engine.events, engine.knowledge, engine.relationships);
  const session = new GameSessionAdapter(engine.relationships);
  // Wire the engine-only soul store (0024) into the live session so consequential beats + off-screen
  // scenes deepen each NPC's arc and ground their later voice (the 0041 linchpin).
  session.setSoul(engine.soul);
  // Validated references (B39): a recorded interaction may only name LIVING houseguests — the session
  // knows who's still in the house (player + non-evicted NPCs).
  commands.setLivingProvider(() => session.livingIds());
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
  return {
    engine,
    player: outward.player,
    admin: outward.admin,
    summary: outward.summary,
    session,
    commands,
    mcp: { player: new McpServer("player", deps), admin: new McpServer("admin/God Mode", deps) },
  };
}

/** Export the user's full durable snapshot: session core + engine detail (events + hidden beliefs). */
function exportSnapshot(sb: UserSandbox): SessionSnapshot {
  return {
    ...sb.session.snapshot(),
    events: sb.engine.events.query(),
    relationships: sb.engine.relationships.serialize().edges,
  };
}

/** Rebuild a fresh sandbox from a durable snapshot — resume the game, don't reset it. */
function importSnapshot(sb: UserSandbox, snap: SessionSnapshot): void {
  sb.session.restore(snap);
  for (const e of snap.events) sb.engine.events.record(e); // ids/ts/hidden preserved exactly
  sb.engine.relationships.load(snap.relationships);
}

export class GameSessionRegistry {
  private readonly sandboxes = new Map<string, UserSandbox>();

  /**
   * An optional durable store (0030) makes the live game survive an engine restart:
   * `sandboxFor` recalls the user's saved game on first build, and every mutation
   * saves it. With no store, the registry is purely in-memory (the prior behavior).
   */
  constructor(private readonly saveStore?: UserSaveStore) {}

  /** The user's isolated sandbox — created on first use, RESUMED from durable storage on return. */
  sandboxFor(user: string): UserSandbox {
    let sb = this.sandboxes.get(user);
    if (!sb) {
      sb = buildUserSandbox();
      if (this.saveStore?.hasSave(user)) {
        const snap = this.saveStore.loadLatest(user);
        if (snap) importSnapshot(sb, snap); // resume instead of fresh setup (the welcome-overlay fix)
      }
      if (this.saveStore) {
        const persist = (): void => this.saveUser(user);
        sb.session.setOnPersist(persist); // save-on-mutation (0030)
        sb.commands.setOnPersist(persist);
      }
      this.sandboxes.set(user, sb);
    }
    return sb;
  }

  /** Persist the user's current sandbox to durable storage (a no-op without a store). */
  saveUser(user: string): void {
    const sb = this.sandboxes.get(user);
    if (sb && this.saveStore) this.saveStore.saveFor(user, exportSnapshot(sb));
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
    const sb = buildUserSandbox();
    importSnapshot(sb, snap);
    if (this.saveStore) {
      const persist = (): void => this.saveUser(user);
      sb.session.setOnPersist(persist);
      sb.commands.setOnPersist(persist);
    }
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

  /** Start a fresh game for the user — replaces ONLY their own sandbox (others untouched). */
  resetUser(user: string): UserSandbox {
    const sb = buildUserSandbox();
    if (this.saveStore) {
      const persist = (): void => this.saveUser(user);
      sb.session.setOnPersist(persist);
      sb.commands.setOnPersist(persist);
    }
    this.sandboxes.set(user, sb);
    return sb;
  }

  /** A Vault-free channel resolver for the HTTP transport (keeps the outward layer Vault-free). */
  resolver(): (channel: "player" | "admin", user: string) => McpServer {
    return (channel, user) => {
      const sb = this.sandboxFor(user);
      return channel === "player" ? sb.mcp.player : sb.mcp.admin;
    };
  }
}

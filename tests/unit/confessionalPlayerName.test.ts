import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { confessionalFor } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// #845 companion — a confessional that names the PLAYER must bake the player's DISPLAY NAME into its
// content, not the bare `player` id. The retrospective scrubber (`humanizeForRetrospective`) deliberately
// resolves COLON-bearing ids only and leaves the bare word `player` as prose (the #845 common-noun guard),
// so the fix is at COMPOSE time — `confessionalFor` applies an optional `nameOf` resolver. Roles only.

describe("0040/#845 — confessionalFor resolves the player id to a display NAME with a nameOf resolver", () => {
  const PLAYER_NAME = "Casey Stormborn"; // a distinctive display name; not from any corpus
  const [A, B] = [npc(1), npc(2)];

  // Build a relationship state where the confessor (A) reads the PLAYER as their biggest threat and an
  // NPC (B) as their closest bond — so the confessional names the player as target and B as ally.
  function relWithPlayerAsTopThreat(): RelationshipModel {
    const rel = new RelationshipModel(0.5);
    rel.edge(A, PLAYER).threat = 1; // player is the clear top threat
    rel.edge(A, B).trust = 0.9;
    rel.edge(A, B).affinity = 0.9; // B is the clear closest bond
    return rel;
  }

  it("bakes the player's NAME (not the token 'player') when the player is the confessor's target", () => {
    const rel = relWithPlayerAsTopThreat();
    const conf = confessionalFor(A, [PLAYER, A, B], rel, {
      rng: new SeededRandom(1),
      nameOf: (id) => (id === PLAYER ? PLAYER_NAME : id === A ? "Confessor One" : "Ally Two"),
    });
    expect(conf.target).toBe(PLAYER); // the engine truth: player IS the target
    expect(conf.content).toContain(PLAYER_NAME);
    // The standalone raw token `player` must NOT appear (a name is baked, never the bare id).
    expect(/\bplayer\b/.test(conf.content)).toBe(false);
    // The confessor's own `[confessional <name>]` prefix is the display name too, never the raw id.
    expect(conf.content).toContain("[confessional Confessor One]");
    expect(conf.content).not.toContain(`[confessional ${A}]`);
  });

  it("an NPC-subject confessional resolves the target/ally to NAMES too", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(A, B).threat = 1; // B is the top threat
    const C = npc(3);
    rel.edge(A, C).trust = 0.9;
    rel.edge(A, C).affinity = 0.9; // C is the closest bond
    const conf = confessionalFor(A, [PLAYER, A, B, C], rel, {
      rng: new SeededRandom(2),
      nameOf: (id) => ({ [B]: "Threat Bee", [C]: "Ally Cee", [A]: "Confessor One" }[id] ?? id),
    });
    expect(conf.target).toBe(B);
    expect(conf.content).toContain("Threat Bee");
    expect(conf.content).toContain("Ally Cee");
    // No raw npc id slug crosses.
    expect(conf.content).not.toContain("npc:");
  });

  it("WITHOUT a nameOf resolver the content is byte-identical to the role-only behavior (back-compat)", () => {
    const rel = relWithPlayerAsTopThreat();
    const withResolver = confessionalFor(A, [PLAYER, A, B], rel, { rng: new SeededRandom(3) });
    // No resolver ⇒ raw ids are baked exactly as before this change.
    expect(withResolver.content).toContain(`[confessional ${A}]`);
    expect(withResolver.content).toContain(PLAYER); // the bare id, since no resolver was given
  });
});

describe("0040/#845 — the LIVE adapter wires nameOf, so producerVaultDump shows the player's NAME", () => {
  const PLAYER_NAME = "Dakota Vale"; // distinctive; not from any corpus

  it("a player-targeted confessional renders with the player NAME and never the bare 'player' token", () => {
    // The full composition (registry) wires the record providers + the onPlayerEvent sink, so a
    // confessional recorded at a live ceremony reaches the EventStore and surfaces in producerVaultDump.
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("conf-player-name");
    const s = sb.session;
    s.createCharacter({ playerName: PLAYER_NAME, seed: 7 });

    // Re-pin every NPC→player threat edge to the top each iteration so the involved confessors read the
    // PLAYER as their biggest threat (the case that exercises the bare `player` id). `rel` is
    // engine-private; reaching it for a test fixture is fine (no production seam).
    const rel = (s as unknown as { rel: RelationshipModel }).rel;
    const pinPlayerAsThreat = (): void => {
      const house = (s as unknown as { house: { npcs: { id: string }[] } | null }).house;
      for (const n of house?.npcs ?? []) rel.edge(n.id, PLAYER).threat = 1;
    };
    for (let i = 0; i < 120; i++) {
      pinPlayerAsThreat();
      const v = s.advanceGame();
      const pending = v.pending;
      if (pending?.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
      else if (pending?.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
      else if (pending?.kind === "nominations") {
        const opts = pending.options.map((o) => o.id);
        s.submitDecision({ kind: "nominations", choice: [opts[0]!, opts[1]!] });
      }
      // Stop once a confessional that targets the player has been recorded into the Vault.
      const dump = s.producerVaultDump();
      const confNow = dump?.hiddenStory.filter((r) => r.type === "Confessional") ?? [];
      if (confNow.some((r) => r.content.includes(PLAYER_NAME))) break;
    }

    // Through the producer-Vault unseal (the ONE sanctioned reveal): every confessional row resolves to a
    // NAME, never the bare `player` token. At least one names the player as the target (the threat pin).
    const dump = s.producerVaultDump();
    expect(dump).not.toBeNull();
    const confRows = dump!.hiddenStory.filter((r) => r.type === "Confessional");
    expect(confRows.length).toBeGreaterThan(0);
    for (const r of confRows) expect(/\bplayer\b/i.test(r.content)).toBe(false);
    expect(confRows.some((r) => r.content.includes(PLAYER_NAME))).toBe(true);
  });
});

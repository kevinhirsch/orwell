import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";

/**
 * End-to-end proof that the weekly loop (0011) is WIRED into the live game: a real
 * per-user sandbox, driven only through the permissioned MCP player channel
 * (createCharacter → advanceGame/submitDecision), plays a full season to a winner —
 * ceremony state and the public status track it, and every beat is recorded as a
 * player-witnessed event. No Vault handle anywhere in this path.
 */
describe("live weekly-loop progression (0011) over the MCP boundary", () => {
  it("plays a started game to a winner, surfacing the player's decisions", async () => {
    const reg = new GameSessionRegistry();
    const player = reg.resolver()("player", "u1");

    // Seed 2: the player survives deep and faces the full range of decisions
    // (votes, nominations as HOH, a replacement, a veto) — a thorough wiring proof.
    await player.callTool("createCharacter", { playerName: "The Player", seed: 2 });

    let sawHoh = false;
    let sawNominees = false;
    let finished = false;
    let winner: { id: string; name: string } | null = null;
    let decisionsMade = 0;

    for (let i = 0; i < 5000 && !finished; i++) {
      const adv = (await player.callTool("advanceGame", {})) as {
        finished: boolean;
        winner: { id: string; name: string } | null;
        pending: { kind: string; options: { id: string }[] } | null;
        status: { hoh: unknown; nominees: unknown[] };
      };
      if (adv.status.hoh) sawHoh = true;
      if (adv.status.nominees.length > 0) sawNominees = true;

      if (adv.pending) {
        const p = adv.pending;
        decisionsMade++;
        if (p.kind === "nominations") {
          await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        } else if (p.kind === "veto-decision") {
          await player.callTool("submitDecision", { kind: "veto-decision", use: false });
        } else if (p.kind === "replacement") {
          await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
        } else {
          await player.callTool("submitDecision", { kind: "eviction-vote", vote: p.options[0]!.id });
        }
      }
      finished = adv.finished;
      winner = adv.winner;
    }

    expect(finished).toBe(true);
    expect(winner).not.toBeNull();
    expect(sawHoh).toBe(true);       // ceremony state tracked the live loop
    expect(sawNominees).toBe(true);
    expect(decisionsMade).toBeGreaterThan(0); // the player faced real decisions

    // The beats were recorded as player-witnessed events in this user's sandbox.
    const sb = reg.sandboxFor("u1");
    const events = sb.engine.events.query();
    expect(events.length).toBeGreaterThan(10);
    expect(events.every((e) => !e.hidden)).toBe(true); // the player lived these — never hidden

    // The public status reflects the finished game (week advanced well past 1).
    const status = (await player.callTool("gameStatus", {})) as { week: number };
    expect(status.week).toBeGreaterThan(1);
  });

  it("survives a restart mid-season — the loop resumes from the durable snapshot", async () => {
    const reg = new GameSessionRegistry();
    const player = reg.resolver()("player", "u2");
    await player.callTool("createCharacter", { playerName: "The Player", seed: 9 });

    // Advance a few beats.
    for (let i = 0; i < 3; i++) {
      const adv = (await player.callTool("advanceGame", {})) as { pending: { kind: string; options: { id: string }[] } | null };
      if (adv.pending) {
        const p = adv.pending;
        const body = p.kind === "nominations"
          ? { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] }
          : p.kind === "veto-decision" ? { kind: "veto-decision", use: false }
          : p.kind === "replacement" ? { kind: "replacement", replacement: p.options[0]!.id }
          : { kind: "eviction-vote", vote: p.options[0]!.id };
        await player.callTool("submitDecision", body);
      }
    }

    const before = (await player.callTool("gameStatus", {})) as { week: number; phase: string };

    // Simulate a restart: a fresh sandbox restored from the durable snapshot.
    const snap = reg.snapshot("u2");
    const reg2 = new GameSessionRegistry();
    reg2.restore("u2", snap);
    const after = (await reg2.resolver()("player", "u2").callTool("gameStatus", {})) as { week: number; phase: string };

    expect(after.week).toBe(before.week);
    expect(after.phase).toBe(before.phase);
  });
});

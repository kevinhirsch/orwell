import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { dayOfWeek } from "../../src/engine/houseEvents";

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
        pending: { kind: string; options: { id: string }[]; appeals?: string[] } | null;
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
        } else if (p.kind === "finale-statement") {
          await player.callTool("submitDecision", { kind: "finale-statement", statement: "I played the best game." });
        } else if (p.kind === "finale-answer") {
          await player.callTool("submitDecision", { kind: "finale-answer", appeal: p.appeals![0]! });
        } else if (p.kind === "juror-vote") {
          await player.callTool("submitDecision", { kind: "juror-vote", vote: p.options[0]!.id });
        } else {
          await player.callTool("submitDecision", { kind: p.kind, vote: p.options[0]!.id });
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
    // The BEATS (house-events) are never hidden; NPC confessionals (0040) ride alongside as Vault-only
    // interiority and are legitimately hidden, so the player-witnessed invariant is asserted on the beats.
    const beats = events.filter((e) => e.type === "house-event");
    expect(beats.length).toBeGreaterThan(0);
    expect(beats.every((e) => !e.hidden)).toBe(true); // the player lived these — never hidden

    // The public status reflects the finished game (week advanced well past 1).
    const status = (await player.callTool("gameStatus", {})) as { week: number };
    expect(status.week).toBeGreaterThan(1);
  });

  it("the public status carries the in-game DAY (E58): 1–5 matching the beat, advancing with the week", async () => {
    const reg = new GameSessionRegistry();
    const player = reg.resolver()("player", "u-day");
    await player.callTool("createCharacter", { playerName: "The Player", seed: 2 });

    let sawWeeklyDay = false;
    let sawHohDay1 = false;
    let sawEvictionDay5 = false;
    let maxWeekWithDay = 0;

    for (let i = 0; i < 5000; i++) {
      const adv = (await player.callTool("advanceGame", {})) as {
        finished: boolean;
        pending: { kind: string; options: { id: string }[]; appeals?: string[] } | null;
      };
      const status = (await player.callTool("gameStatus", {})) as { week: number; phase: string; day: number | null };

      // The day is exactly the canonical beat→day mapping the GM prompt already uses — never invented.
      expect(status.day).toBe(dayOfWeek(status.phase));
      if (status.day !== null) {
        expect(status.day).toBeGreaterThanOrEqual(1);
        expect(status.day).toBeLessThanOrEqual(5);
        sawWeeklyDay = true;
        if (status.phase.toLowerCase().includes("hoh")) sawHohDay1 = true;
        if (status.phase.toLowerCase().includes("evict")) sawEvictionDay5 = true;
        maxWeekWithDay = Math.max(maxWeekWithDay, status.week);
      }

      if (adv.pending) {
        const p = adv.pending;
        if (p.kind === "nominations") {
          await player.callTool("submitDecision", { kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
        } else if (p.kind === "veto-decision") {
          await player.callTool("submitDecision", { kind: "veto-decision", use: false });
        } else if (p.kind === "replacement") {
          await player.callTool("submitDecision", { kind: "replacement", replacement: p.options[0]!.id });
        } else if (p.kind === "finale-statement") {
          await player.callTool("submitDecision", { kind: "finale-statement", statement: "I played the best game." });
        } else if (p.kind === "finale-answer") {
          await player.callTool("submitDecision", { kind: "finale-answer", appeal: p.appeals![0]! });
        } else if (p.kind === "juror-vote") {
          await player.callTool("submitDecision", { kind: "juror-vote", vote: p.options[0]!.id });
        } else {
          await player.callTool("submitDecision", { kind: p.kind, vote: p.options[0]!.id });
        }
      }
      if (adv.finished) break;
    }

    expect(sawWeeklyDay).toBe(true);
    // Beat→day anchors: an HOH beat reads day 1, an eviction beat reads day 5.
    expect(sawHohDay1).toBe(true);
    expect(dayOfWeek("hoh-competition")).toBe(1);
    expect(sawEvictionDay5).toBe(true);
    expect(dayOfWeek("eviction")).toBe(5);
    // The day index recurs week over week — it is not a one-week artifact.
    expect(maxWeekWithDay).toBeGreaterThan(1);

    // Pre-game (a fresh, un-started sandbox) carries no day index.
    const fresh = reg.resolver()("player", "u-day-fresh");
    const pre = (await fresh.callTool("gameStatus", {})) as { day: number | null };
    expect(pre.day).toBeNull();
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
          : { kind: p.kind, vote: p.options[0]!.id };
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

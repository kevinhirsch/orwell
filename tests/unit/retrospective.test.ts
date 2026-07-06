import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature 0048 / B56 — season retrospective & the Vault unsealing. The Wall is ABSOLUTE during
 * play; the retrospective is its one sanctioned, structurally-gated exception (post-season only,
 * this season only). Roles only — no fixture names.
 */
function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
}

function playToEnd(s: GameSessionAdapter): void {
  for (let i = 0; i < 4000; i++) {
    const v = s.advanceGame();
    if (v.pending) resolve(s, v.pending);
    if (v.finished) return;
  }
  throw new Error("the season did not finish within the drive budget");
}

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

const SENTINEL = "SENTINEL-0048-hidden-story";

function plantHidden(sb: ReturnType<GameSessionRegistry["sandboxFor"]>, tag: string): void {
  sb.engine.events.record({
    id: `retro:${tag}`, ts: 8_000_000, type: "conversation",
    initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true,
    content: `${SENTINEL}-${tag}`,
  });
}

describe("0048/B56 — the Vault unsealing is gated on the finished terminal state", () => {
  it("a live season returns null and leaks nothing — the Wall holds in play", () => {
    const { sb } = liveGame("retro-live", 3);
    plantHidden(sb, "live");
    expect(sb.session.seasonRetrospective()).toBeNull();
    const surfaces = JSON.stringify(sb.session.getGameState())
      + JSON.stringify(sb.session.seasonRecap())
      + JSON.stringify(sb.player.getVisibleState());
    expect(surfaces).not.toContain(SENTINEL);
  });

  it("a finished season unseals the hidden story — scheming, confessionals, the twists", () => {
    const { sb } = liveGame("retro-done", 3);
    plantHidden(sb, "done");
    // Seal a twist that will never fire (week 99) — the retrospective must name it as unfired.
    const core = sb.session.snapshot();
    core.live!.reserve = [{ kind: "double-eviction", fireAtBeat: 99 }];
    sb.session.restore(core);
    playToEnd(sb.session);

    const retro = sb.session.seasonRetrospective();
    expect(retro).not.toBeNull();
    expect(retro!.winner).toBeTruthy();
    const story = JSON.stringify(retro!.hiddenStory);
    expect(story).toContain(`${SENTINEL}-done`);            // the planted hidden scene is in the story
    // NPC interiority is included — under its READABLE retrospective label (the raw kind slug is mapped to
    // a plain category word so the FE's "[type] content" row reads as prose, not a debug dump).
    expect(retro!.hiddenStory.some((h) => h.type === "Confessional")).toBe(true);
    // …and no row's label is a raw machine slug: a readable label is Capitalized and carries no slug
    // punctuation (`:`/`_`) nor an all-lowercase-hyphen machine token (`hidden-thread`, `offscreen-event`).
    for (const h of retro!.hiddenStory) {
      expect(h.type).not.toMatch(/[:_]/);
      expect(h.type).not.toMatch(/^[a-z]+(?:-[a-z]+)+$/); // not a raw lowercase-hyphen kind slug
      expect(h.type[0]).toBe(h.type[0]!.toUpperCase());   // a readable, Capitalized category word
    }
    expect(retro!.twists).toEqual([{ kind: "double-eviction", firedWeek: null }]); // the twist that never fired
  });

  it("unsealing is scoped per user — a finished season never opens another user's live one", () => {
    const reg = new GameSessionRegistry();
    const a = reg.sandboxFor("retro-a");
    const b = reg.sandboxFor("retro-b");
    a.session.createCharacter({ playerName: "The Player", seed: 5 });
    b.session.createCharacter({ playerName: "The Player", seed: 6 });
    plantHidden(a, "user-a");
    plantHidden(b, "user-b");
    playToEnd(a.session);

    const retroA = a.session.seasonRetrospective();
    expect(retroA).not.toBeNull();
    expect(JSON.stringify(retroA)).toContain("user-a");
    expect(JSON.stringify(retroA)).not.toContain("user-b"); // cross-user isolation (0021)
    expect(b.session.seasonRetrospective()).toBeNull();      // the live season stays sealed
  });
});

describe("0048/B56 — the recap is the record, not memory", () => {
  it("highlights come from recorded ceremony events and reproduce exactly", () => {
    const { sb } = liveGame("retro-recap", 7);
    playToEnd(sb.session);
    const recap = sb.session.seasonRecap();
    expect(recap.finished).toBe(true);
    expect(recap.winner).toBeTruthy();
    expect(recap.evicted.length).toBe(14); // a 16-cast season's full eviction order
    // Every highlight IS a recorded event's content — nothing invented.
    const recorded = new Set(sb.engine.events.queryAll().filter((e) => !e.hidden).map((e) => e.content));
    expect(recap.highlights.length).toBeGreaterThan(10);
    for (const h of recap.highlights) expect(recorded.has(h), `recorded: ${h}`).toBe(true);
    // Reproducible: the record does not drift between reads.
    expect(sb.session.seasonRecap()).toEqual(recap);
    // Vault-free: no hidden content rides along.
    const hidden = sb.engine.events.queryAll().filter((e) => e.hidden).map((e) => e.content);
    const blob = JSON.stringify(recap);
    for (const c of hidden) expect(blob.includes(c)).toBe(false);
  });
});

describe("SG7/#1030 — the finale jury vote unseals per-juror in the unseal", () => {
  it("a finished season's unseal carries per-juror jury votes for both finalists", () => {
    const { sb } = liveGame("retro-jury", 7);
    playToEnd(sb.session);

    // The retrospective and the producerVault dump share the same unseal render.
    for (const retro of [sb.session.seasonRetrospective(), sb.session.producerVaultDump()]) {
      expect(retro).not.toBeNull();
      const jv = retro!.juryVotes;
      expect(jv).toBeTruthy();
      // Two finalists, each a named ref.
      expect(jv!.finalists.length).toBe(2);
      for (const f of jv!.finalists) expect(f.name.length).toBeGreaterThan(0);
      // Per-juror attribution (mirrors evictionVotes): each juror voted for one of the two finalists.
      expect(jv!.votes.length).toBeGreaterThan(0);
      const finalistNames = new Set(jv!.finalists.map((f) => f.name));
      for (const v of jv!.votes) {
        expect(v.juror.name.length).toBeGreaterThan(0);
        expect(finalistNames.has(v.votedFor.name)).toBe(true);
      }
      // The crowned winner must be the finalist who got the majority of the jury votes.
      const tally = new Map<string, number>();
      for (const v of jv!.votes) tally.set(v.votedFor.name, (tally.get(v.votedFor.name) ?? 0) + 1);
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
      expect(retro!.winner!.name).toBe(top[0]);
    }
  });

  it("a LIVE (unfinished) season's unseal has no jury votes yet (the finale hasn't tallied)", () => {
    const { sb } = liveGame("retro-jury-live", 7);
    // No finale yet ⇒ no jury votes block on the live debug dump.
    expect(sb.session.producerVaultDump()!.juryVotes).toBeUndefined();
  });
});

describe("0048/B56 — finished → new season lifecycle", () => {
  it("the prior season's snapshot stays finished; a fresh game begins cleanly for the same user", () => {
    const reg = new GameSessionRegistry();
    const user = "retro-lifecycle";
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 9 });
    playToEnd(sb.session);
    const archive = reg.snapshot(user); // the finished season, archived by snapshot
    expect(archive.live?.finished).toBe(true);

    // A stray createCharacter without explicit confirmation must NOT wipe the finished season (B36).
    const guarded = sb.session.createCharacter({ playerName: "Someone Else", seed: 10 });
    expect(guarded.player?.name).toBe("The Player");

    // The real new-season path: the admin reset replaces ONLY this user's sandbox.
    const fresh = reg.resetUser(user);
    fresh.session.createCharacter({ playerName: "The Player", seed: 10 });
    const view = fresh.session.getGameState();
    expect(view.started).toBe(true);
    expect(view.week).toBe(1);
    expect(fresh.session.seasonRetrospective()).toBeNull(); // the new season is sealed again
    expect(reg.userCount()).toBe(1);                        // one active game per user (0021)
    expect(archive.live?.finished).toBe(true);              // the archived season is untouched
  });
});

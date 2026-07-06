import { describe, it, expect } from "vitest";
import {
  selectNemesis, NEMESIS, NO_NEMESIS, CAMPAIGN,
  type NemesisCandidate, type NemesisTrack,
} from "../../src/engine/campaigns";
import { npc } from "../../src/domain/ids";

/**
 * Feature 0096 — the PURE nemesis-selection substrate: at most one NPC is elevated into the player's
 * emergent nemesis, and only after a SUSTAINED (not spiked) threat-toward-player read while their
 * drive targets the player. Roles only (a houseguest, a rival, a bystander). Deterministic, no rng —
 * a pure read of already-seeded threat/drive signals. No live wiring here (nothing can perturb
 * calibration from this file).
 */

const cand = (id: ReturnType<typeof npc>, threat: number, targetsPlayer = true): NemesisCandidate => ({
  id, threatTowardPlayer: threat, targetsPlayer,
});

function sustain(id: ReturnType<typeof npc>, ticks: number, threat = NEMESIS.threatThreshold + 0.1): NemesisTrack {
  let track: NemesisTrack = NO_NEMESIS;
  for (let i = 0; i < ticks; i++) {
    track = selectNemesis([cand(id, threat)], track);
  }
  return track;
}

describe("0096 selectNemesis — emerges only from SUSTAINED threat, never a spike", () => {
  it("a single tick above the bar does not yet make a nemesis", () => {
    const track = selectNemesis([cand(npc(1), NEMESIS.threatThreshold + 0.1)], NO_NEMESIS);
    expect(track.current).toBeUndefined();
  });

  it("clearing the bar for fewer than the sustain window still yields no nemesis", () => {
    const track = sustain(npc(1), NEMESIS.sustainTicks - 1);
    expect(track.current).toBeUndefined();
  });

  it("clearing the bar for the full sustain window elevates the candidate to nemesis", () => {
    const track = sustain(npc(1), NEMESIS.sustainTicks);
    expect(track.current).toBe(npc(1));
  });

  it("a one-tick spike that then drops resets the streak — never accumulates across a gap", () => {
    let track = selectNemesis([cand(npc(1), NEMESIS.threatThreshold + 0.1)], NO_NEMESIS);
    track = selectNemesis([cand(npc(1), 0.1, false)], track); // drops well below + re-aims off player
    track = selectNemesis([cand(npc(1), NEMESIS.threatThreshold + 0.1)], track);
    expect(track.current).toBeUndefined(); // needs sustainTicks CONSECUTIVE, the gap reset it
  });

  it("below threshold entirely never elevates anyone, however long the season runs", () => {
    let track: NemesisTrack = NO_NEMESIS;
    for (let i = 0; i < 10; i++) track = selectNemesis([cand(npc(1), CAMPAIGN.threatThreshold)], track);
    expect(track.current).toBeUndefined();
  });

  it("a peaceful house with nobody targeting the player elevates no one", () => {
    let track: NemesisTrack = NO_NEMESIS;
    for (let i = 0; i < 10; i++) {
      track = selectNemesis(
        [cand(npc(1), 0.9, false), cand(npc(2), 0.85, false)], // high threat, but NOT a target drive
        track,
      );
    }
    expect(track.current).toBeUndefined();
  });

  it("targeting the player alone (below threshold) never elevates", () => {
    let track: NemesisTrack = NO_NEMESIS;
    for (let i = 0; i < 10; i++) track = selectNemesis([cand(npc(1), 0.3, true)], track);
    expect(track.current).toBeUndefined();
  });
});

describe("0096 selectNemesis — organic: it can shift, hold, or hand off", () => {
  it("at most one nemesis is ever held, even with multiple qualifying candidates", () => {
    const track = selectNemesis(
      [cand(npc(1), 0.95), cand(npc(2), 0.9)],
      sustain(npc(1), NEMESIS.sustainTicks - 1), // both about to clear together
    );
    const ids = [track.current].filter((x): x is NonNullable<typeof x> => x !== undefined);
    expect(ids.length).toBeLessThanOrEqual(1);
  });

  it("holds the incumbent via hysteresis through a soft dip that stays above threshold - hysteresis", () => {
    const held = sustain(npc(1), NEMESIS.sustainTicks);
    expect(held.current).toBe(npc(1));
    const softened = selectNemesis([cand(npc(1), NEMESIS.threatThreshold - NEMESIS.hysteresis + 0.01)], held);
    expect(softened.current).toBe(npc(1)); // still held — inside the hysteresis band
  });

  it("lapses when the incumbent's threat genuinely drops below the hysteresis floor", () => {
    const held = sustain(npc(1), NEMESIS.sustainTicks);
    const lapsed = selectNemesis([cand(npc(1), 0.1)], held);
    expect(lapsed.current).toBeUndefined();
  });

  it("lapses when the incumbent's drive re-aims off the player, even if threat stays high", () => {
    const held = sustain(npc(1), NEMESIS.sustainTicks);
    const lapsed = selectNemesis([cand(npc(1), 0.95, false)], held);
    expect(lapsed.current).toBeUndefined();
  });

  it("a new rival only takes over once they clearly overtake the incumbent by the handoff margin", () => {
    const held = sustain(npc(1), NEMESIS.sustainTicks);
    // The challenger clears the sustain window too, but only marginally above the incumbent — no handoff.
    let track = held;
    for (let i = 0; i < NEMESIS.sustainTicks; i++) {
      track = selectNemesis(
        [cand(npc(1), NEMESIS.threatThreshold + 0.1), cand(npc(2), NEMESIS.threatThreshold + 0.15)],
        track,
      );
    }
    expect(track.current).toBe(npc(1)); // margin too small — incumbent holds

    // Now the challenger clearly overtakes by more than the handoff margin.
    for (let i = 0; i < NEMESIS.sustainTicks; i++) {
      track = selectNemesis(
        [cand(npc(1), NEMESIS.threatThreshold + 0.1), cand(npc(2), NEMESIS.threatThreshold + 0.3)],
        track,
      );
    }
    expect(track.current).toBe(npc(2));
  });

  it("is deterministic — the same candidates + prior always derive the same track", () => {
    const prior = sustain(npc(1), NEMESIS.sustainTicks - 1);
    const a = selectNemesis([cand(npc(1), NEMESIS.threatThreshold + 0.1)], prior);
    const b = selectNemesis([cand(npc(1), NEMESIS.threatThreshold + 0.1)], prior);
    expect(a).toEqual(b);
  });
});

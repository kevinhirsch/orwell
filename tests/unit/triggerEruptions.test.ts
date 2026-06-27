import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { TRIGGER, ERUPTION_KINDS } from "../../src/engine/triggerConstants";
import { ERUPTION_POOLS } from "../../src/engine/triggers";
import { TRIGGER_WORDINGS } from "../../src/engine/characterFactory";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0091 — the LIVE wiring (adapter + orchestrator): a volatile sealed trigger fires a Vault-safe
 * PUBLIC house event the player witnesses, the sealed wording NEVER reaches the player OR the admin
 * before or after a fire, and a quiet stretch never detonates one (the no-cold-open guarantee).
 * HARD rule: roles only — no names; the cast + the trigger arming are generated/injected structurally.
 */

const USER = "trig";
/** A distinctive sealed volatility (sentinel-like) so a Vault sweep matching it is a real leak, never a
 *  coincidental default. Well inside [strainFloor, 1] so the injected trigger is maximally primed. */
const SEALED_VOLATILITY = 0.917283;

/** A started season with `npc(1)` carrying an ARMED, wound-tight blow-up trigger that names no one. */
function seasonWithArmedTrigger(seed = 4): { reg: GameSessionRegistry } {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(USER);
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed });
  // Inject a known, ARMED trigger on npc(1) + a wound-tight soul, via a snapshot round-trip (the engine's
  // own restore path). The eruption KIND/volatility/detail are sealed engine state — we set them directly so
  // the fire is deterministic to exercise; we never assert on their values crossing any wall (that's the point).
  const snap = sb.session.snapshot();
  const target = snap.house!.npcs[0]!;
  const sealedWording = [...TRIGGER_WORDINGS.keys()][0]!; // "smiles through a grudge they will never forget"
  // A DISTINCTIVE volatility value (a sentinel-like number) so a Vault sweep catching it can never be a
  // coincidental 0.5/0.9 from some unrelated edge — only a genuine leak of the sealed number would match.
  target.character.hiddenElements = [
    { kind: "trigger", detail: sealedWording, eruptionKind: "blow-up", volatility: SEALED_VOLATILITY },
    { kind: "pre-game-tie", detail: "shares a hometown with someone in the house" },
  ];
  target.soul.emotionalState = 0.05; // deep distress
  target.soul.volatility = 0.95;     // wound tight
  sb.session.restore(snap);
  sb.session.setTriggersEnabled(true);
  return { reg };
}

/** Drive the trigger check (with a fresh conflict precipitant on `id`) until it fires; returns the eruption
 *  event's content, or null if it never fired within the budget. */
function fireOnce(reg: GameSessionRegistry, id: EntityId, budget = 2000): string | null {
  const sb = reg.sandboxFor(USER);
  const before = sb.engine.events.query({ type: "house-event" }).length;
  for (let i = 0; i < budget; i++) {
    sb.session.runTriggerEruptions(sb.engine.events, new Map([[id, 1]]));
    const evs = sb.engine.events.query({ type: "house-event" });
    if (evs.length > before) return evs[evs.length - 1]!.content;
  }
  return null;
}

const SEALED_WORDING = [...TRIGGER_WORDINGS.keys()][0]!;
// The genuinely-SEALED fragments the Vault Wall must keep off every surface: the sealed `detail` wording,
// the engine-only volatility NUMBER, and the field-name serializations that would only appear if a hidden
// element object leaked onto a surface. (The bare word "trigger" is NOT sealed — it is an ordinary English
// word that legitimately appears in unrelated prompt instructions and in the PUBLIC eruption event's id.)
const SEALED_FRAGMENTS = ["grudge they will never forget", String(SEALED_VOLATILITY), "eruptionKind", '"volatility"'];

describe("0091 — a volatile houseguest under stress detonates when a spark lands (the live wiring)", () => {
  it("fires a PLAYER-WITNESSED public house event whose content names no sealed trigger wording, no number", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    const content = fireOnce(reg, npc(1));
    expect(content, "a wound-tight, sparked, volatile trigger fires within budget").toBeTruthy();

    // The recorded eruption is a PUBLIC, player-witnessed house event (0002 — ordinary player knowledge).
    const erupt = sb.engine.events.query({ type: "house-event" }).find((e) => e.id.startsWith("trigger:erupt:"))!;
    expect(erupt).toBeTruthy();
    expect(erupt.hidden).toBe(false);
    expect(erupt.witnessSet).toContain(PLAYER);

    // The content is a GENERIC eruption-pool line for `blow-up` — never the sealed wording, never a number.
    const body = content!.split(": ").slice(1).join(": ");
    expect(ERUPTION_POOLS["blow-up"].includes(body)).toBe(true);
    for (const frag of SEALED_FRAGMENTS) expect(content!.includes(frag)).toBe(false);
  });

  it("a CALM houseguest with the SAME trigger does NOT fire (strain below the floor)", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    // Re-strain to CALM via a fresh snapshot round-trip.
    const snap = sb.session.snapshot();
    snap.house!.npcs[0]!.soul.emotionalState = 0.6; // calm, above baseline
    snap.house!.npcs[0]!.soul.volatility = 0.15;
    sb.session.restore(snap);
    sb.session.setTriggersEnabled(true);
    expect(fireOnce(reg, npc(1), 1500)).toBeNull(); // never fires, however many sparks
  });

  it("NO precipitant ⇒ NO fire (the no-cold-open guarantee: a quiet stretch never detonates)", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    // The strained, armed trigger is primed — but with an EMPTY precipitant map, nothing fires.
    const before = sb.engine.events.query({ type: "house-event" }).length;
    for (let i = 0; i < 2000; i++) sb.session.runTriggerEruptions(sb.engine.events, new Map());
    expect(sb.engine.events.query({ type: "house-event" }).length).toBe(before);
  });

  it("the season eruption CAP holds — never more than the configured cap, even over many sparks", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    // Hammer the check with a spark every call; it can fire at most `eruptionCapPerSeason` times (the
    // trigger is one-shot for blow-up? no — blow-up re-arms, but the SEASON cap is absolute).
    for (let i = 0; i < 6000; i++) sb.session.runTriggerEruptions(sb.engine.events, new Map([[npc(1), 1]]));
    const erupts = sb.engine.events.query({ type: "house-event" }).filter((e) => e.id.startsWith("trigger:erupt:"));
    expect(erupts.length).toBeLessThanOrEqual(TRIGGER.eruptionCapPerSeason);
    expect(sb.session.snapshot().eruptionCount).toBe(erupts.length); // the persisted counter matches
  });
});

describe("0091 — the Vault Wall holds: the sealed trigger never reaches the player OR the admin (before+after a fire)", () => {
  const sweepSurfaces = (sb: ReturnType<GameSessionRegistry["sandboxFor"]>): string => {
    sb.syncAdmin();
    return [
      // Every player-facing surface.
      sb.player.produce("player-visible log"),
      sb.player.produce("scene narration"),
      sb.player.produce("NPC dialogue"),
      sb.player.produce("system message"),
      sb.player.produce("end-of-session summary"),
      JSON.stringify(sb.player.assembleNarrationContext("scene")),
      JSON.stringify(sb.player.assembleNarrationContext("dialogue")),
      sb.player.socialRead(),
      sb.player.socialRead(npc(1)),
      // The assembled MOMENT prompt the narrator is handed (the eruption voices through here).
      JSON.stringify(sb.session.getMomentPrompt({})),
      // The NPC voice anchor for the erupter (the model's character card).
      JSON.stringify(sb.session.npcVoice(npc(1))),
      // The Vault-free game-state projection + whereabouts.
      JSON.stringify(sb.session.getGameState()),
      JSON.stringify(sb.session.whereabouts()),
      JSON.stringify(sb.session.gameStatus()),
      // The ADMIN / God-Mode surface (walled from the Vault too — mandate #2).
      JSON.stringify(sb.admin.inspect()),
    ].join("\n---\n");
  };

  it("no sealed trigger wording/number appears on any player or admin surface BEFORE a fire", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    const swept = sweepSurfaces(sb);
    expect(swept.includes(SEALED_WORDING)).toBe(false);
    for (const frag of SEALED_FRAGMENTS) expect(swept.includes(frag)).toBe(false);
  });

  it("AFTER a fire: the eruption is recorded knowledge, but the sealed trigger STILL never appears anywhere", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    const content = fireOnce(reg, npc(1));
    expect(content).toBeTruthy();

    const swept = sweepSurfaces(sb);
    // The sealed trigger attribute that CAUSED the eruption still never surfaces — on player OR admin.
    expect(swept.includes(SEALED_WORDING), "sealed wording never crosses").toBe(false);
    for (const frag of SEALED_FRAGMENTS) {
      expect(swept.includes(frag), `sealed fragment "${frag}" never crosses`).toBe(false);
    }
    // And the recorded eruption EVENT itself carries no sealed wording (only the generic public line).
    const erupt = sb.engine.events.query({ type: "house-event" }).find((e) => e.id.startsWith("trigger:erupt:"))!;
    expect(erupt.content.includes(SEALED_WORDING)).toBe(false);
    // The trigger element is still sealed on the (engine-only) house, marked fired — it never thinned.
    const trig = sb.session.snapshot().house!.npcs[0]!.character.hiddenElements.find((e) => e.kind === "trigger")!;
    expect(trig.detail).toBe(SEALED_WORDING); // the sealed detail is intact (non-degradation)
    expect(trig.fired).toBe(true);            // the fuse is marked spent (monotonic, persisted)
  });
});

describe("0091 — foreseeable in hindsight: the erupter is the one the player could see was strained", () => {
  it("the trigger only fires for a houseguest whose soul is strained (the observable charge)", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    const content = fireOnce(reg, npc(1));
    expect(content).toBeTruthy();
    // The erupter (npc:1) is the wound-tight houseguest — strain is the SAME live-soul state surfaced to the
    // player through behaviour/mood (the plant is paid off, not a deus ex machina). Its soul sits in distress.
    const soul = sb.session.snapshot().house!.npcs[0]!.soul;
    expect(soul.emotionalState).toBeLessThan(0.5); // rattled — the observable charge that gated the fire
  });
});

describe("0091 — persistence: a one-shot fuse stays spent across a save round-trip", () => {
  it("a fired trigger's `fired` flag survives a snapshot→restore and never re-opens the cap", () => {
    const { reg } = seasonWithArmedTrigger();
    const sb = reg.sandboxFor(USER);
    expect(fireOnce(reg, npc(1))).toBeTruthy();
    const firedSnap = sb.session.snapshot();
    expect(firedSnap.eruptionCount).toBeGreaterThanOrEqual(1);

    // Round-trip the save, then resume — the fired flag + the season count come back intact (0007/0030).
    const reg2 = new GameSessionRegistry();
    const sb2 = reg2.sandboxFor(USER);
    sb2.session.restore(firedSnap);
    const trig = sb2.session.snapshot().house!.npcs[0]!.character.hiddenElements.find((e) => e.kind === "trigger")!;
    expect(trig.fired).toBe(true);
    expect(sb2.session.snapshot().eruptionCount).toBe(firedSnap.eruptionCount);
  });
});

describe("0091 — every eruption kind maps to a non-empty public pool (no kind voices the sealed cause)", () => {
  it("each eruption kind has ≥2 generic public lines and none echoes a sealed wording", () => {
    for (const k of ERUPTION_KINDS) {
      expect(ERUPTION_POOLS[k].length).toBeGreaterThanOrEqual(2);
      for (const line of ERUPTION_POOLS[k]) {
        for (const w of TRIGGER_WORDINGS.keys()) expect(line.includes(w)).toBe(false);
      }
    }
  });
});

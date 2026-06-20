import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { MOMENT_PROMPTS, BASE_GAME_MASTER_PROMPT } from "../../src/engine/momentPrompts";
import { npc } from "../../src/domain/ids";

/**
 * PREMIERE / DAY-1 — "nobody knows anyone on day 1" (behavioral fidelity, mandate #1).
 *
 * Same class of bug as the location/casting leaks: the narrator must not voice knowledge a
 * houseguest does not legitimately have yet. On move-in day the houseguests are STRANGERS —
 * each one's own profile rides along as THEIR voice anchor, but no NPC knows another's backstory,
 * relationships, or hidden side until an in-game pathway (witnessed scene / told / gossip, 0002)
 * delivers it. As the season plays, that knowledge ACCRUES and only THEN may be voiced.
 *
 * Roles only — no fixture names.
 */
function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  return { reg, sb };
}

describe("premiere day-1 — the houseguests are strangers", () => {
  it("the game opens in the premiere moment with EVERY houseguest knowing nothing about the others", () => {
    const { sb } = liveGame("day1-blank", 4);
    const view = sb.session.getGameState();
    // The game's first scene is the premiere — its managed fragment frames the strangers tutorial.
    expect(view.moment).toBe("premiere");
    // STRUCTURAL day-1 guarantee: no active houseguest carries ANY learned fact or hunch yet — they
    // have witnessed nothing and been told nothing. Knowledge of each other starts empty (0002).
    for (const hg of view.house) {
      if (hg.status !== "active") continue;
      const voice = sb.session.npcVoice(hg.id)!;
      expect(voice.knows, `npcVoice(${hg.id}) should know nothing on day 1`).toEqual([]);
      expect(voice.suspects, `npcVoice(${hg.id}) should suspect nothing on day 1`).toEqual([]);
    }
  });

  it("one houseguest's voicing projection does NOT carry another houseguest's unlearned backstory", () => {
    const { sb } = liveGame("day1-no-dossier", 7);
    const view = sb.session.getGameState();
    const active = view.house.filter((h) => h.status === "active");
    const speaker = active[0]!;
    const other = active[1]!;
    // The OTHER houseguest's private-to-them backstory facets (their card carries these as THEIR own
    // self to voice; the rest of the cast has NOT learned them on day 1).
    const otherDetails = [other.biography, other.background, other.vocation, other.hometown]
      .filter((x): x is string => !!x && x.length > 0);
    expect(otherDetails.length).toBeGreaterThan(0); // the cast IS deep — there is something to leak

    const voice = sb.session.npcVoice(speaker.id)!;
    // The speaker's KNOWLEDGE-bounded view (what they know + suspect) must not contain the other's
    // unlearned story. A roster line is THAT person's own anchor; it is never a dossier the speaker holds.
    const learned = JSON.stringify({ knows: voice.knows, suspects: voice.suspects });
    for (const detail of otherDetails) {
      expect(learned, `the speaker must not already know the other's "${detail.slice(0, 30)}…"`)
        .not.toContain(detail);
    }
  });

  it("knowledge ACCRUES: once a fact about another reaches a houseguest via a pathway, it is voiceable", () => {
    const { sb } = liveGame("day1-accrues", 5);
    // Before any pathway: the speaker knows nothing about the subject (a genuine stranger, day 1).
    const before = sb.session.npcVoice(npc(1))!;
    expect(before.knows).toEqual([]);

    // An in-game pathway delivers a fact about another houseguest INTO this houseguest's knowledge
    // (the same 0002 seam gossip/telling uses — here, a witnessed origin belief about npc(2)).
    const LEARNED = "npc:2 mentioned they used to coach high-school debate back home";
    sb.engine.knowledge.seedBelief(npc(1), { content: LEARNED, factId: "day1:learned", subject: npc(2) }, "witnessed");

    // Now — and ONLY now — the narrator may voice the speaker knowing that thing about the other.
    const after = sb.session.npcVoice(npc(1))!;
    expect(after.knows.some((k) => k.includes("coach high-school debate"))).toBe(true);
  });
});

describe("premiere day-1 — the prompt framing", () => {
  it("the base prompt scopes NPC↔NPC knowledge: houseguests do not know each other's stories", () => {
    const p = BASE_GAME_MASTER_PROMPT;
    // The grounding rule is named explicitly (the strangers premise + the accrual mechanism).
    expect(p).toMatch(/HOUSEGUESTS DO NOT KNOW EACH OTHER'S STORIES/);
    // A roster line is that person's OWN self, NOT shared knowledge the rest of the cast holds.
    expect(p).toMatch(/NOT shared knowledge/i);
    // Knowledge of others is bounded to what a pathway delivered (witnessed / told / gossip — npcVoice).
    expect(p).toMatch(/witnessed a scene together, someone told them, or it diffused as gossip/i);
    expect(p).toMatch(/STRANGERS who met on\s+move-in day/i);
    // It ACCRUES over the season; only THEN may one houseguest know a thing about another.
    expect(p).toMatch(/familiarity ACCRUES naturally/i);
    expect(p).toMatch(/first meetings, never/i);
  });

  it("the premiere fragment frames everyone-is-a-stranger and the producer-guided tutorial beats", () => {
    const premiere = MOMENT_PROMPTS["premiere"]!;
    // The stranger frame — move-in day, nobody knows anyone, no pre-existing familiarity.
    expect(premiere).toMatch(/EVERYONE IS A STRANGER/);
    expect(premiere).toMatch(/NOBODY KNOWS ANYONE/);
    expect(premiere).toMatch(/meeting\s+for the FIRST TIME/i);
    expect(premiere).toMatch(/Do not write any pre-existing familiarity/i);
    // Producer-guided, light-touch (guidance/pacing, not scripted rails).
    expect(premiere).toMatch(/PRODUCERS|PRODUCTION/);
    expect(premiere).toMatch(/light touch|never scripted rails/i);
    // The four tutorial beats, in order: introductions → champagne/toast → bedroom → settled.
    expect(premiere).toMatch(/\(1\) INTRODUCTIONS/);
    expect(premiere).toMatch(/\(2\) THE TOAST/);
    expect(premiere).toMatch(/champagne/i);
    expect(premiere).toMatch(/\(3\) PICK A BEDROOM/);
    expect(premiere).toMatch(/call moveTo/); // bedroom is a REAL player choice through the presence model
    expect(premiere).toMatch(/\(4\) GETTING SETTLED/);
    // It still lands on the first HOH competition (the premiere's destination).
    expect(premiere).toMatch(/FIRST HEAD OF HOUSEHOLD COMPETITION/);
  });

  it("the woven roster header names the strangers framing at the point of use", () => {
    const { sb } = liveGame("day1-roster", 9);
    const prompt = sb.session.getMomentPrompt({ moment: "premiere" }).systemPrompt;
    // The roster header reinforces: each line is that person's OWN self, not shared knowledge — and on
    // day 1 the houseguests are strangers who just met.
    expect(prompt).toMatch(/that person's OWN self/i);
    expect(prompt).toMatch(/NOT shared knowledge/i);
    expect(prompt).toMatch(/strangers\s+who just met/i);
  });
});

describe("premiere day-1 — the Vault Wall holds (no secret reaches the narrator)", () => {
  it("the premiere system prompt carries no Vault/soul/secret content (sentinel sweep)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("day1-sentinel");
    sb.session.createCharacter({ playerName: "The Player", seed: 13 });

    // Poison every hidden surface with unique sentinels, restore, then prove the premiere prompt —
    // base persona + premiere fragment + the woven Vault-free context — surfaces NONE of them.
    const SENTINELS = {
      vault: "SENTINEL-DAY1-vault-confessional",
      soul: "SENTINEL-DAY1-soul-memory",
      hidden: "SENTINEL-DAY1-hidden-element-motive",
    };
    sb.engine.vault.writeHidden({ id: "day1:v", kind: "confessional", content: SENTINELS.vault });
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.soul.memory.push(SENTINELS.soul);
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: SENTINELS.hidden });
    sb.session.restore(core);

    const prompt = sb.session.getMomentPrompt({ moment: "premiere" }).systemPrompt;
    for (const s of Object.values(SENTINELS)) {
      expect(prompt, `the premiere prompt must not leak ${s}`).not.toContain(s);
    }
    // And no bare aptitude float (a real stat leak) rides along.
    expect(prompt).not.toMatch(/\d\.\d{2,}/);
  });

  it("an NPC's day-1 voicing projection carries no Vault/soul/hidden content (per-NPC sentinel sweep)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("day1-voice-sentinel");
    sb.session.createCharacter({ playerName: "The Player", seed: 21 });
    const SENTINELS = ["SENTINEL-DAY1-V-soul", "SENTINEL-DAY1-V-hidden"];
    const core = sb.session.snapshot();
    core.house!.npcs[0]!.soul.memory.push(SENTINELS[0]!);
    core.house!.npcs[0]!.character.hiddenElements.push({ kind: "secret-motive", detail: SENTINELS[1]! });
    sb.session.restore(core);

    const voice = sb.session.npcVoice(npc(1))!;
    const blob = JSON.stringify(voice);
    for (const s of SENTINELS) expect(blob, `npcVoice leaks ${s}`).not.toContain(s);
    expect(blob).not.toMatch(/trust|threat|affinity|confidence|emotional/i); // labels, never numbers
  });
});

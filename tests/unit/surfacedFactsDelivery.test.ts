import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * SOC-1/4 — surfaced-fact DELIVERY to the per-turn narrator.
 *
 * The engine already anchors facts that reach the player through a real in-game pathway (an NPC
 * confiding, a rumor that diffused all the way to them, an overheard fragment) into the player's
 * `KnowledgeService`. Before this fix those facts were COMPUTED but never handed to the narrator on
 * an ordinary turn's moment prompt — so the model had nothing to voice and would fill the gap by
 * hallucinating. These tests prove the delivery seam: a freshly-surfaced, PATHWAY-anchored fact
 * appears in the per-turn narrator payload, while genuinely hidden / no-pathway (Vault) content
 * never does. Roles only, no fixture names.
 */

const liveGame = (seed: number, user: string) => {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "Player", seed });
  return sb;
};

/** Surface a fact to the player through the SAME anchored `told-by` pathway `registry.setOnConfide`
 *  uses: an NPC first holds the belief (origin), then it surfaces to the player as their knowledge. */
const surfaceToPlayer = (
  sb: ReturnType<GameSessionRegistry["sandboxFor"]>,
  teller: string,
  content: string,
): void => {
  sb.engine.knowledge.seedBelief(
    teller,
    { content, originalContent: content, factId: `t:${content}`, confidence: 0.9, hops: 0, distortion: 0, source: teller },
    "origin",
  );
  const fact = sb.engine.knowledge.surfaceInformationTo(PLAYER, { content, subject: teller }, `told-by:${teller}`);
  expect(fact).not.toBeNull(); // the pathway is anchored — this really became the player's knowledge
};

describe("SOC-1/4 — the player's pathway-surfaced facts reach the per-turn narrator prompt", () => {
  it("a fact an NPC confided reaches the player's ordinary (non-lifecycle) moment prompt", () => {
    const sb = liveGame(5, "soc-deliver");
    const teller = npc(2);
    const FACT = "I am secretly gunning for the HOH next week";
    surfaceToPlayer(sb, teller, FACT);

    // An ORDINARY per-turn moment (NOT re-entry / post-season — those already carried THE RECORD).
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    expect(systemPrompt).toContain("WHAT YOU'VE LEARNED");
    expect(systemPrompt).toContain(FACT);
  });

  it("before any surfacing the block is absent — the prompt stays tight (byte-identical addition)", () => {
    const sb = liveGame(6, "soc-empty");
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    expect(systemPrompt).not.toContain("WHAT YOU'VE LEARNED");
  });

  it("a hidden NPC-to-NPC fact with NO pathway to the player NEVER reaches the prompt (Vault Wall)", () => {
    const sb = liveGame(7, "soc-vault");
    // A genuinely off-screen belief held by an NPC alone — the player was never told and never
    // overheard it, so no pathway ever anchored it to the player's knowledge.
    const SEALED = "SENTINEL-vault-npc-only-scheme";
    sb.engine.knowledge.seedBelief(
      npc(3),
      { content: SEALED, originalContent: SEALED, factId: "sealed:1", confidence: 0.9, hops: 0, distortion: 0, source: npc(3) },
      "origin",
    );
    // Also drop a hidden off-screen EVENT the player never witnessed (the Vault content class).
    sb.engine.events.record({
      id: "soc:hidden", ts: 9_100_000, type: "conversation",
      initiator: npc(3), witnessSet: [npc(3), npc(4)], hidden: true, content: SEALED,
    });

    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    expect(systemPrompt).not.toContain(SEALED);
  });

  it("the player's Diary-Room knowledge (no NPC pathway) is NOT rendered as 'the house told you'", () => {
    const sb = liveGame(8, "soc-dr");
    const DR = "PRIVATE-diary-room-target-note";
    // Diary Room is the player's OWN knowledge but with NO in-game pathway to any NPC — it must not
    // appear in the "reached you through a real pathway" block (it would misframe the OOC channel).
    sb.engine.knowledge.recordDiaryRoom(DR);

    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    // The surfaced-facts block, if present at all, must not carry the DR note.
    const idx = systemPrompt.indexOf("WHAT YOU'VE LEARNED");
    if (idx >= 0) expect(systemPrompt.slice(idx)).not.toContain(DR);
  });

  it("only the most recent few facts ride along — the block stays bounded", () => {
    const sb = liveGame(9, "soc-bound");
    const teller = npc(1);
    for (let i = 0; i < 9; i++) surfaceToPlayer(sb, teller, `surfaced fact number ${i}`);
    const { systemPrompt } = sb.session.getMomentPrompt({ moment: "social" });
    // The oldest surfacings drop out of the bounded window; the freshest are present.
    expect(systemPrompt).toContain("surfaced fact number 8");
    expect(systemPrompt).not.toContain("surfaced fact number 0");
  });
});

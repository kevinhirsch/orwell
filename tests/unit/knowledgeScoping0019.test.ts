import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { SealedFact, WhereaboutsView } from "../../src/ports/GameSession";
import { npc, PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * ADR 0019 — "context is not knowledge", Layers 2 & 3. A houseguest may reference or "recall" only
 * what THAT specific houseguest witnessed or was told through a legitimate in-game pathway. Presence
 * of a fact in the narrator's context window is NOT knowledge. Enforced in CODE at the context-
 * assembly boundary, never by prompt wording.
 *
 *  - Layer 2 bakes each PRESENT houseguest's own `knows/suspects` scope into `renderGameContext` —
 *    a token witnessed only by B appears ONLY under B's labelled block (never in A's, never in the
 *    shared/roster prose), and a producer-only casting token appears NOWHERE (no in-game pathway to
 *    any NPC).
 *  - Layer 3 hands the FE post-hoc guard the full per-fact `knownTo` manifest: a distinctive fact
 *    known only to B, with a `knownTo` set that EXCLUDES A — so a staged A voicing it is dropped.
 *
 * Roles only — no fixture names.
 */

function liveGame(user: string, seed: number) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  // 0111 — close the premiere champagne circle so whereabouts reads normal free-roam presence.
  sb.session.advanceGame();
  return { reg, sb };
}

/** Walk the player until at least one houseguest shares their room; returns that present id (or null). */
function findPresentNpc(sb: ReturnType<typeof liveGame>["sb"]): EntityId | null {
  for (let i = 0; i < 12; i++) {
    const wa: WhereaboutsView | null = sb.session.whereabouts();
    if (wa && wa.present.length) return wa.present[0]!.id;
    const dest = wa?.nearby.find((n) => n.present.length)?.room ?? wa?.nearby[0]?.room;
    if (!dest) return null;
    sb.session.movePlayer(dest);
  }
  const wa = sb.session.whereabouts();
  return wa && wa.present.length ? wa.present[0]!.id : null;
}

/** The per-present-NPC knowledge block of the narration prompt (ADR 0019 Layer 2), sliced out by its
 *  header + indented continuation lines, so a token can be attributed to a specific houseguest's scope. */
function presentKnowledgeBlock(systemPrompt: string): string {
  const lines = systemPrompt.split("\n");
  const start = lines.findIndex((l) => l.startsWith("- WHAT EACH HOUSEGUEST IN THE ROOM LEGITIMATELY KNOWS"));
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end]!)) end++;
  return lines.slice(start, end).join("\n");
}

describe("ADR 0019 Layer 2 — per-present-NPC knowledge is baked into the narration prompt", () => {
  it("a token witnessed only by a PRESENT houseguest appears ONLY under their labelled block — never under another's", () => {
    const { sb } = liveGame("adr0019-l2", 4);
    const presentId = findPresentNpc(sb);
    expect(presentId, "the scene must have a present houseguest to scope").not.toBeNull();
    const B = presentId!;
    const bName = sb.session.snapshot().house!.npcs.find((n) => n.id === B)!.name;

    const TOKEN = "SENTINEL_0019_witnessed_only_by_B_backdoor_token";
    // Plant it into B's knowledge ONLY (a scene B witnessed; nobody else has a pathway).
    sb.engine.knowledge.seedBelief(B, { content: TOKEN, factId: "0019:l2" }, "witnessed");

    const rendered = sb.session.getMomentPrompt({}).systemPrompt;
    // Layer 2: it appears — but ONLY inside the per-present-NPC knowledge block, under B's own label.
    expect(rendered, "B's own knowledge is surfaced under B's scope").toContain(TOKEN);
    const block = presentKnowledgeBlock(rendered);
    expect(block, "the token lives in the sanctioned per-present-NPC block").toContain(TOKEN);
    // It appears only after B's name label — never floating in the roster/whereabouts prose.
    const outsideBlock = rendered.replace(block, "");
    expect(outsideBlock, "B's private knowledge never leaks into the shared/roster prose").not.toContain(TOKEN);
    // And within the block it is attributed to B (their label precedes the token).
    const bLabelIdx = block.indexOf(`· ${bName}`);
    expect(bLabelIdx, "B has a labelled block").toBeGreaterThanOrEqual(0);
    expect(block.indexOf(TOKEN)).toBeGreaterThan(bLabelIdx);
  });

  it("the general HUD view (getGameState) NEVER carries any present houseguest's private knowledge — only the narration prompt does", () => {
    const { sb } = liveGame("adr0019-l2-hud", 4);
    const B = findPresentNpc(sb)!;
    const TOKEN = "SENTINEL_0019_hud_must_stay_clean_token";
    sb.engine.knowledge.seedBelief(B, { content: TOKEN, factId: "0019:hud" }, "witnessed");
    // The narration prompt carries it (Layer 2); the FE-facing HUD view must not.
    expect(sb.session.getMomentPrompt({}).systemPrompt).toContain(TOKEN);
    expect(JSON.stringify(sb.session.getGameState())).not.toContain(TOKEN);
    expect(sb.session.getGameState().presentKnowledge).toBeUndefined();
  });

  it("a producer-only casting token has no in-game pathway to any NPC — it never appears in the prompt at all", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("adr0019-l2-casting");
    const CASTING = "SENTINEL_0019_producer_only_casting_answer_camp_counselor";
    sb.session.createCharacter({
      playerName: "The Player",
      seed: 7,
      motivation: CASTING,
      privateStrategy: CASTING,
      interviewNotes: [CASTING],
    });
    sb.session.advanceGame();
    findPresentNpc(sb);
    expect(sb.session.getMomentPrompt({}).systemPrompt).not.toContain(CASTING);
  });

  it("the per-present-NPC block is Vault-free — no confessional/soul content, no numbers", () => {
    const { sb } = liveGame("adr0019-l2-vaultfree", 5);
    findPresentNpc(sb);
    const VAULTED = "SENTINEL_0019_vault_confessional";
    sb.engine.vault.writeHidden({ id: "0019:v", kind: "confessional", content: VAULTED });
    const block = presentKnowledgeBlock(sb.session.getMomentPrompt({}).systemPrompt);
    expect(block).not.toContain(VAULTED);
    expect(block).not.toMatch(/trust|threat|affinity|emotional modifier/i);
  });
});

describe("ADR 0019 Layer 3 — knowledgeScopeManifest is the full per-fact knownTo manifest", () => {
  it("a distinctive fact known only to B carries a knownTo that INCLUDES B and EXCLUDES A", () => {
    const { sb } = liveGame("adr0019-l3", 6);
    const TOKEN = "SENTINEL_0019_known_only_to_B_final_two_deal_token";
    sb.engine.knowledge.seedBelief(npc(1), { content: TOKEN, factId: "0019:l3" }, "witnessed");

    const manifest: SealedFact[] = sb.session.knowledgeScopeManifest();
    const entry = manifest.find((s) => s.content.includes("final_two_deal_token"));
    expect(entry, "the bounded fact appears in the scope manifest").toBeDefined();
    const bName = sb.session.snapshot().house!.npcs[0]!.name;
    const aName = sb.session.snapshot().house!.npcs[1]!.name;
    expect(entry!.knownTo).toContain(bName); // the holder is in the pathway set
    expect(entry!.knownTo).not.toContain(aName); // a non-holder is NOT — the guard drops A voicing it
  });

  it("a fact the player told ONE houseguest lists BOTH as knownTo (the room-to-room asymmetry the ADR closes)", () => {
    const { sb } = liveGame("adr0019-l3-told", 8);
    const TOKEN = "SENTINEL_0019_i_told_only_you_i_am_gunning_for_hoh_token";
    // The player holds it (they said it) AND surfaces it to B via a legitimate pathway; A never learns it.
    sb.engine.knowledge.seedBelief(PLAYER, { content: TOKEN, factId: "0019:told" }, "witnessed");
    sb.engine.knowledge.seedBelief(npc(1), { content: TOKEN, factId: "0019:told" }, "witnessed");

    const manifest = sb.session.knowledgeScopeManifest();
    const entry = manifest.find((s) => s.content.includes("gunning_for_hoh_token"));
    expect(entry).toBeDefined();
    const bName = sb.session.snapshot().house!.npcs[0]!.name;
    const aName = sb.session.snapshot().house!.npcs[1]!.name;
    expect(entry!.knownTo).toContain(bName);
    expect(entry!.knownTo).not.toContain(aName);
  });

  it("is Vault-free — no hidden confessional/soul content ever reaches the manifest", () => {
    const { sb } = liveGame("adr0019-l3-vaultfree", 3);
    const TOKEN = "SENTINEL_0019_bounded_secret_token";
    const VAULTED = "SENTINEL_0019_l3_vault_confessional";
    sb.engine.knowledge.seedBelief(npc(1), { content: TOKEN, factId: "0019:vf" }, "witnessed");
    sb.engine.vault.writeHidden({ id: "0019:l3v", kind: "confessional", content: VAULTED });
    const blob = JSON.stringify(sb.session.knowledgeScopeManifest());
    expect(blob).toContain("bounded_secret_token");
    expect(blob).not.toContain(VAULTED);
  });

  it("keeps EVERY holder in knownTo even when one learned the fact long ago (no per-holder cap truncation — Greptile #1723)", () => {
    // The regression the reverted per-holder pre-cap would cause: A learned fact X FIRST, then learned
    // many more recent facts (X falls outside A's most-recent window), while B learned X recently. A
    // per-holder cap would slice X off A's list and record knownTo: [B] only — and the FE wall would
    // then wrongly DROP a legitimate A sentence voicing X. The full scan must keep BOTH holders.
    const { sb } = liveGame("adr0019-l3-holders", 2);
    const A = npc(1);
    const B = npc(2);
    const SHARED = "SENTINEL_0019_shared_final_two_pact_token";
    // A learns X first…
    sb.engine.knowledge.seedBelief(A, { content: SHARED, factId: "0019:shared" }, "witnessed");
    // …then A accumulates far more than the voice window of newer, unrelated facts, burying X.
    for (let i = 0; i < 30; i++) {
      sb.engine.knowledge.seedBelief(A, { content: `A_filler_fact_${i}`, factId: `0019:filler:${i}` }, "witnessed");
    }
    // B learns the SAME fact (same factId) recently.
    sb.engine.knowledge.seedBelief(B, { content: SHARED, factId: "0019:shared" }, "witnessed");

    const entry = sb.session.knowledgeScopeManifest().find((s) => s.content.includes("final_two_pact_token"));
    expect(entry, "the shared fact survives in the manifest").toBeDefined();
    const aName = sb.session.snapshot().house!.npcs[0]!.name;
    const bName = sb.session.snapshot().house!.npcs[1]!.name;
    // BOTH holders are in knownTo — a per-holder pre-cap would have dropped A (its early fact sliced off).
    expect(entry!.knownTo).toContain(aName);
    expect(entry!.knownTo).toContain(bName);
  });

  it("returns [] before a game is started", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("adr0019-l3-pregame");
    expect(sb.session.knowledgeScopeManifest()).toEqual([]);
  });

  it("dispatches through McpServer.callTool without being rejected (the FE-wiring gate)", async () => {
    const { sb } = liveGame("adr0019-l3-boundary", 9);
    const TOKEN = "SENTINEL_0019_boundary_bounded_token";
    sb.engine.knowledge.seedBelief(npc(1), { content: TOKEN, factId: "0019:b" }, "witnessed");
    const out = (await sb.mcp.player.callTool("knowledgeScopeManifest", {})) as SealedFact[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((s) => s.content.includes("boundary_bounded_token"))).toBe(true);
  });
});

/**
 * ADR 0019 guardian caveat C1 — the producer-only casting backstop. The genuinely producer-only casting
 * intake (motivation / private strategy / interview notes) lives on the player object and is NEVER
 * seeded into the knowledge layer, so BEFORE this fix neither `sealedFromHouse` (Diary-Room
 * `NO_NPC_PATHWAY` only) nor `knowledgeScopeManifest` (knowledge-layer facts only) carried it. Layer 1
 * removes it from the narrator context, but a STAGED houseguest reciting a casting answer had NO
 * downstream guard to drop it (Layer 1 was its sole, un-backstopped defense — the "camp counselor"
 * leak class that birthed the ADR). The fix: `sealedFromHouse` now also emits the producer-only casting
 * class as GLOBALLY-sealed facts (`knownTo` empty ⇒ NO houseguest may ever voice it), giving the Layer
 * 3 FE guard the defense-in-depth backstop it lacked. TWO guards keep it from false-holding the OPEN set
 * (ADR 0005 #1 / Greptile+CodeRabbit #1763): BACKSTORY is excluded (shareable public bio), and only
 * DISTINCTIVE prose (≥3 words) is sealed (a terse "revenge" would mint a broad single-word signature
 * that hard-drops every sentence carrying that common word all season). Note: casting values below are
 * ≥3-word sentences carrying a searchable token — roles only, no fixture names.
 */
describe("ADR 0019 C1 — producer-only casting content is a globally-sealed backstop in sealedFromHouse", () => {
  function castGame(user: string, casting: { motivation?: string; privateStrategy?: string; backstory?: string; interviewNotes?: string[] }, seed = 11) {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed, ...casting });
    sb.session.advanceGame();
    return { reg, sb };
  }

  it("seals the player's casting MOTIVATION and PRIVATE STRATEGY — each with an EMPTY knownTo", () => {
    const MOTIVE = "my real reason for playing is TOKENC1MOTIVE cold revenge on my ex";
    const STRAT = "my actual gameplan is TOKENC1STRAT to run a hidden spy network quietly";
    const { sb } = castGame("adr0019-c1", { motivation: MOTIVE, privateStrategy: STRAT });
    const sealed: SealedFact[] = sb.session.sealedFromHouse();
    for (const token of ["TOKENC1MOTIVE", "TOKENC1STRAT"]) {
      const entry = sealed.find((s) => s.content.includes(token));
      expect(entry, `casting content is sealed: ${token}`).toBeDefined();
      // Globally sealed — NO houseguest holds a pathway, so any staged speaker voicing it is dropped.
      expect(entry!.knownTo).toEqual([]);
    }
  });

  it("does NOT globally seal the player's BACKSTORY — it is shareable public bio (Greptile #1763 / ADR 0005 #1)", () => {
    // Backstory is shareable: the player tells houseguests where they're from / what they do, so a
    // houseguest they told legitimately references it. A global knownTo:[] seal would DROP that
    // legitimate open-set narration all season — a false hold worse than a missed phantom. Backstory's
    // casting-turn recital is Layer 1's job; any later reference is the pathway model's, never a seal.
    const STORY = "before the show I was secretly TOKENC1BACKSTORY a summer camp counselor for teens";
    const MOTIVE = "my true motivation is TOKENC1BMOTIVE to win it all for my family";
    const { sb } = castGame("adr0019-c1-backstory", { backstory: STORY, motivation: MOTIVE });
    const blob = JSON.stringify(sb.session.sealedFromHouse());
    // The producer-only motivation IS sealed…
    expect(blob).toContain("TOKENC1BMOTIVE");
    // …but the shareable backstory is NOT — the guard must never hold a legitimate shared-bio reference.
    expect(blob).not.toContain("TOKENC1BACKSTORY");
  });

  it("does NOT seal a TERSE producer field — a one/two-word answer can't mint a broad single-word signature (CodeRabbit #1763)", () => {
    // "revenge" / "the money" would otherwise become a single-word FE signature that substring-drops
    // EVERY houseguest sentence carrying that common word for the whole season (ADR 0005 #1 false hold).
    const { sb } = castGame("adr0019-c1-terse", { motivation: "revenge", privateStrategy: "the money" });
    const sealed = sb.session.sealedFromHouse();
    // No DR + only terse casting ⇒ nothing distinctive enough to seal.
    expect(sealed).toEqual([]);
  });

  it("seals the casting INTERVIEW NOTES (folded into the player's own casting soul-memory)", () => {
    const NOTE = "in the interview I admitted TOKENC1NOTE that I truly hate open confrontation";
    const { sb } = castGame("adr0019-c1-notes", { motivation: "I came here to win the whole thing", interviewNotes: [NOTE] });
    const sealed = sb.session.sealedFromHouse();
    const entry = sealed.find((s) => s.content.includes("TOKENC1NOTE"));
    expect(entry, "an interview note is sealed globally").toBeDefined();
    expect(entry!.knownTo).toEqual([]);
  });

  it("is Vault-free — a hidden confessional/soul number never rides along in the sealed casting class", () => {
    const MOTIVE = "my private motivation is TOKENC1VF pure petty long-held revenge";
    const VAULTED = "TOKENC1VAULT vault confessional leak";
    const { sb } = castGame("adr0019-c1-vaultfree", { motivation: MOTIVE });
    sb.engine.vault.writeHidden({ id: "0019:c1v", kind: "confessional", content: VAULTED });
    const blob = JSON.stringify(sb.session.sealedFromHouse());
    expect(blob).toContain("TOKENC1VF");
    expect(blob).not.toContain("TOKENC1VAULT");
    // No hidden numbers (trust/threat/affinity/emotional modifier) ever cross into the sealed class.
    expect(blob).not.toMatch(/trust|threat|affinity|emotional modifier/i);
  });

  it("cross-user isolation — user A's sealed casting content never appears in user B's manifest", () => {
    const A_MOTIVE = "my secret casting answer is TOKENC1USERA to backstab absolutely everyone";
    const reg = new GameSessionRegistry();
    const a = reg.sandboxFor("adr0019-c1-userA");
    a.session.createCharacter({ playerName: "The Player", seed: 3, motivation: A_MOTIVE });
    a.session.advanceGame();
    const b = reg.sandboxFor("adr0019-c1-userB");
    b.session.createCharacter({ playerName: "The Player", seed: 4, motivation: "something completely different for user b entirely" });
    b.session.advanceGame();
    expect(JSON.stringify(a.session.sealedFromHouse())).toContain("TOKENC1USERA");
    expect(JSON.stringify(b.session.sealedFromHouse())).not.toContain("TOKENC1USERA");
  });

  it("adds NOTHING when the player authored no producer-only casting prose (byte-identical to the DR-only class)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("adr0019-c1-empty");
    // A minimal finalize (name + seed carry identity so it starts) with NO motivation/strategy/notes.
    sb.session.createCharacter({ playerName: "The Player", seed: 5, backstory: "" });
    sb.session.advanceGame();
    // No casting prose + no DR ⇒ the sealed set is empty (byte-identical to the pre-C1 DR-only path).
    expect(sb.session.sealedFromHouse()).toEqual([]);
  });

  it("dispatches through McpServer.callTool without being rejected (the FE-wiring gate)", async () => {
    const MOTIVE = "my producer-only boundary answer is TOKENC1BOUNDARY to lie about everything";
    const { sb } = castGame("adr0019-c1-boundary", { motivation: MOTIVE }, 9);
    const out = (await sb.mcp.player.callTool("sealedFromHouse", {})) as SealedFact[];
    expect(Array.isArray(out)).toBe(true);
    const entry = out.find((s) => s.content.includes("TOKENC1BOUNDARY"));
    expect(entry).toBeDefined();
    expect(entry!.knownTo).toEqual([]);
  });

  it("returns [] before a game is started (no casting content, no crash)", () => {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("adr0019-c1-pregame");
    expect(sb.session.sealedFromHouse()).toEqual([]);
  });
});

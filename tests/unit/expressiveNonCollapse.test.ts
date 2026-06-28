import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { PLAYER } from "../../src/domain/ids";

/**
 * ADR 0005 — the expressive-non-collapse gate (engine-side Vitest; the FE rail-correction case (5)
 * is a separate pytest). Dynamism is now a REGRESSION gate the way richness and the Vault sentinel
 * are: the day a sync/consequence patch starts flattening the open set of social/creative play, CI
 * says so.
 *
 * The OPEN set (the meaning/texture/consequence of social & creative play) must be RECORDED
 * losslessly, CONSEQUENCED (a nonzero hidden fold where warranted — never silently dropped for want
 * of a matching enum), RECALLED in full, and remain DISTINGUISHABLE downstream — while the closed-set
 * authority (the AMOUNT of any hidden move) stays engine-owned (anti-sycophancy #3). The 7-way `kind`
 * is the FLOOR; the generative `consequence` descriptor is a superset (additive, backward-compatible).
 *
 * Roles only — NO names asserted (testing rule). These assert the INVARIANTS, not "kind is exactly
 * these 7 values," so the gate survives the generative extension.
 */
describe("ADR 0005 — expressive non-collapse (the open set is recorded, consequenced, recalled, distinguishable)", () => {
  // A deliberately weird, UNCODED player utterance — the kind of edge-case creativity the engine must
  // never normalize into a bucket. Punctuation, casing, an invented ritual, an em-dash: all must
  // survive byte-for-byte (no truncation/canonicalization of the player's words).
  const WEIRD_UTTERANCE =
    "You cornered them by the slop bins and — voice low — proposed a \"midnight oath\": neither of you " +
    "says the word 'veto' aloud until Thursday, sealed by trading the LAST two granola bars. Half a joke, " +
    "half a real test of whether they'll keep a pointless promise… ¿quién sabe? 🫡";

  function freshSandbox(user: string, seed: number) {
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed });
    return sb;
  }

  it("(1) LOSSLESS RECORD — a weird, uncoded utterance is stored as `content` BYTE-EQUAL (no truncation/normalization)", () => {
    const sb = freshSandbox("adr0005-lossless", 501);
    const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;

    sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy", content: WEIRD_UTTERANCE,
    });

    const stored = sb.engine.events.query().find((e) => e.content === WEIRD_UTTERANCE);
    expect(stored).toBeDefined();
    // Byte-equal: the exact string, every glyph (em-dash, accents, emoji, smart quotes) intact.
    expect(stored!.content).toBe(WEIRD_UTTERANCE);
  });

  it("(2a) CONSEQUENCED — a warranted scene folds a NONZERO hidden delta on the right edge", () => {
    const sb = freshSandbox("adr0005-conseq", 502);
    const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;
    const before = { ...sb.engine.relationships.edge(partner, PLAYER) };

    // Warranted: a genuine bonding overture should move how the partner feels about the player.
    sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "bonding", content: WEIRD_UTTERANCE,
    });

    const after = sb.engine.relationships.edge(partner, PLAYER);
    const moved =
      Math.abs(after.trust - before.trust) > 1e-9 ||
      Math.abs(after.affinity - before.affinity) > 1e-9 ||
      Math.abs(after.threat - before.threat) > 1e-9;
    expect(moved).toBe(true); // a nonzero hidden delta on the partner→player edge
  });

  it("(2b) NEVER DROPPED — a scene with NO `kind` and NO descriptor is still RECORDED (not silently discarded for want of an enum)", () => {
    const sb = freshSandbox("adr0005-norail", 503);
    const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;
    const eventsBefore = sb.engine.events.query().length;

    // A novel move that fits NO existing lever — no `kind`, no descriptor. ADR 0005 principle #4:
    // a creative action that fits no lever is a RECORDING gap, not a non-event. It must still land.
    const { eventId } = sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, partner], content: WEIRD_UTTERANCE,
    });

    expect(eventId).toBeTruthy();
    expect(sb.engine.events.query().length).toBeGreaterThan(eventsBefore);
    expect(sb.engine.events.query().some((e) => e.content === WEIRD_UTTERANCE)).toBe(true);
  });

  it("(3) RECALLED IN FULL — the prose is retrievable later via semantic recall, not just its tag", () => {
    const sb = freshSandbox("adr0005-recall", 504);
    const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;

    sb.commands.recordInteraction({
      initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy", content: WEIRD_UTTERANCE,
    });

    // Indexed into the houseguest's semantic recall memory (0024) and recallable on a related cue —
    // the FULL prose comes back, every specific intact (not the `kind` tag, not a flattened digest).
    const recalled = sb.engine.soul.recall(partner, "the midnight oath and the granola bar promise", 5);
    expect(recalled.some((m) => m.content === WEIRD_UTTERANCE)).toBe(true);
    const text = recalled.map((m) => m.content).join("\n");
    expect(text).toContain("midnight oath");
    expect(text).toContain("granola bars");
  });

  it("(4) DISTINGUISHABLE DOWNSTREAM — two DIFFERENT scenes with the SAME `kind` stay distinguishable later (the tag is not the only thing that survives)", () => {
    const sb = freshSandbox("adr0005-distinct", 505);
    const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;

    const sceneA =
      "You confessed, by the storage room, that you've been throwing every comp on purpose to look harmless.";
    const sceneB =
      "You floated a wild plan to flip the whole house on the showmance by leaking a fake final-three.";
    // Two CREATIVE scenes that both, coarsely, classify as the same closed tag (`strategy`).
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy", content: sceneA });
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, partner], kind: "strategy", content: sceneB });

    // If the tag were the only thing that survived, the two would be indistinguishable. They are NOT:
    // each recalls its OWN content on its OWN cue (proof the open-set prose, not just the tag, persists).
    const recallA = sb.engine.soul.recall(partner, "throwing comps to look harmless", 5).map((m) => m.content);
    const recallB = sb.engine.soul.recall(partner, "leaking a fake final-three to flip the house", 5).map((m) => m.content);
    expect(recallA).toContain(sceneA);
    expect(recallB).toContain(sceneB);
    expect(sceneA).not.toBe(sceneB);
    // Both are in the record as DISTINCT events (not collapsed into one tagged row).
    const contents = sb.engine.events.query().map((e) => e.content);
    expect(contents).toContain(sceneA);
    expect(contents).toContain(sceneB);
  });

  describe("(5) GENERATIVE PATH — a `consequence` descriptor refines targeting/direction; absent ⇒ byte-identical to the `kind`-only path", () => {
    it("a descriptor directs the fold to the NAMED edge and the PROPOSED direction (engine owns the amount)", () => {
      const sb = freshSandbox("adr0005-gen-target", 506);
      const others = sb.session.livingIds().filter((id) => id !== PLAYER);
      const target = others[0]!;
      const uninvolved = others[1]!;

      const beforeTarget = { ...sb.engine.relationships.edge(target, PLAYER) };
      const beforeUninvolved = { ...sb.engine.relationships.edge(uninvolved, PLAYER) };

      // The LLM reads the scene: the player rattled `target` (more threatened), naming only that edge.
      sb.commands.recordInteraction({
        initiator: PLAYER,
        witnessSet: [PLAYER, target],
        content: "You stared them down across the kitchen and made it crystal clear they're your next target.",
        consequence: {
          edges: [{ toward: target, direction: "more-threatened", emphasis: "strong" }],
          rationale: "An open threat — they now read the player as dangerous to them specifically.",
        },
      });

      const afterTarget = sb.engine.relationships.edge(target, PLAYER);
      // The proposed DIRECTION followed: the named edge's threat rose.
      expect(afterTarget.threat).toBeGreaterThan(beforeTarget.threat);
      // An edge NOT in the scene / not named is untouched (targeting is honored).
      expect(sb.engine.relationships.edge(uninvolved, PLAYER)).toEqual(beforeUninvolved);
    });

    it("opposite directions move the same edge oppositely — the LLM's read of the scene drives the SIGN", () => {
      const warmRun = freshSandbox("adr0005-gen-warm", 507);
      const coolRun = freshSandbox("adr0005-gen-cool", 507);
      const warmPartner = warmRun.session.livingIds().find((id) => id !== PLAYER)!;
      const coolPartner = coolRun.session.livingIds().find((id) => id !== PLAYER)!;
      const beforeWarm = { ...warmRun.engine.relationships.edge(warmPartner, PLAYER) };
      const beforeCool = { ...coolRun.engine.relationships.edge(coolPartner, PLAYER) };

      warmRun.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, warmPartner], content: "A genuinely warm heart-to-heart.",
        consequence: { edges: [{ toward: warmPartner, direction: "warmer", emphasis: "notable" }] },
      });
      coolRun.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, coolPartner], content: "A cold, dismissive brush-off.",
        consequence: { edges: [{ toward: coolPartner, direction: "cooler", emphasis: "notable" }] },
      });

      // Same scene shape, opposite proposed direction ⇒ affinity moves opposite ways.
      expect(warmRun.engine.relationships.edge(warmPartner, PLAYER).affinity).toBeGreaterThan(beforeWarm.affinity);
      expect(coolRun.engine.relationships.edge(coolPartner, PLAYER).affinity).toBeLessThan(beforeCool.affinity);
    });

    it("emphasis is RELATIVE weight, not a raw magnitude: `strong` moves an edge more than `slight`, but stays bounded (anti-sycophancy)", () => {
      const slightRun = freshSandbox("adr0005-emph-slight", 508);
      const strongRun = freshSandbox("adr0005-emph-strong", 508);
      const slightP = slightRun.session.livingIds().find((id) => id !== PLAYER)!;
      const strongP = strongRun.session.livingIds().find((id) => id !== PLAYER)!;
      const beforeSlight = slightRun.engine.relationships.edge(slightP, PLAYER).affinity;
      const beforeStrong = strongRun.engine.relationships.edge(strongP, PLAYER).affinity;

      slightRun.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, slightP], content: "A small kindness.",
        consequence: { edges: [{ toward: slightP, direction: "warmer", emphasis: "slight" }] },
      });
      strongRun.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, strongP], content: "A profound act of loyalty.",
        consequence: { edges: [{ toward: strongP, direction: "warmer", emphasis: "strong" }] },
      });

      const slightDelta = slightRun.engine.relationships.edge(slightP, PLAYER).affinity - beforeSlight;
      const strongDelta = strongRun.engine.relationships.edge(strongP, PLAYER).affinity - beforeStrong;
      expect(strongDelta).toBeGreaterThan(slightDelta); // relative emphasis is honored…
      expect(strongDelta).toBeGreaterThan(0);
      // …yet bounded: even `strong` cannot pump affinity past its [0,1] clamp (the engine owns the amount).
      expect(strongRun.engine.relationships.edge(strongP, PLAYER).affinity).toBeLessThanOrEqual(1);
    });

    it("a NOVEL move with no `kind` but a descriptor still folds (a creative action never evaporates — principle #4)", () => {
      const sb = freshSandbox("adr0005-novel", 509);
      const partner = sb.session.livingIds().find((id) => id !== PLAYER)!;
      const before = { ...sb.engine.relationships.edge(partner, PLAYER) };

      sb.commands.recordInteraction({
        initiator: PLAYER,
        witnessSet: [PLAYER, partner],
        content: "You invented a goofy secret handshake with them — no enum captures it, but it bonded you.",
        // No `kind` at all — the descriptor alone carries the consequence shape.
        consequence: { edges: [{ toward: partner, direction: "more-trust", emphasis: "notable" }] },
      });

      expect(sb.engine.relationships.edge(partner, PLAYER).trust).toBeGreaterThan(before.trust);
      // …and it was recorded (never dropped).
      expect(sb.engine.events.query().some((e) => e.content.includes("secret handshake"))).toBe(true);
    });

    it("the descriptor's `rationale` is RECORDED (open-set content) but NEVER scored — it moves no hidden number", () => {
      // SAME user-seed in both registries → the SAME per-user fold rng stream, so the ONLY variable
      // is the rationale. The rationale rides the SAME call but is recorded AFTER the fold, drawing no
      // rng — so the hidden delta must be byte-identical whether or not the rationale is present.
      const withRationale = freshSandbox("adr0005-rat", 510);
      const withoutRationale = freshSandbox("adr0005-rat", 510);
      const pA = withRationale.session.livingIds().find((id) => id !== PLAYER)!;
      const pB = withoutRationale.session.livingIds().find((id) => id !== PLAYER)!;
      const RATIONALE = "They now believe the player is the most trustworthy person left in the house.";

      withRationale.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, pA], content: "A trust-building moment.",
        consequence: { edges: [{ toward: pA, direction: "more-trust", emphasis: "notable" }], rationale: RATIONALE },
      });
      withoutRationale.commands.recordInteraction({
        initiator: PLAYER, witnessSet: [PLAYER, pB], content: "A trust-building moment.",
        consequence: { edges: [{ toward: pB, direction: "more-trust", emphasis: "notable" }] },
      });

      // RECORDED: the rationale lands in the record as its own open-set content…
      expect(withRationale.engine.events.query().some((e) => e.content === RATIONALE)).toBe(true);
      expect(withoutRationale.engine.events.query().some((e) => e.content === RATIONALE)).toBe(false);
      // …yet it NEVER influences the magnitude — the trust delta is byte-identical with vs. without it.
      expect(withRationale.engine.relationships.edge(pA, PLAYER).trust)
        .toBeCloseTo(withoutRationale.engine.relationships.edge(pB, PLAYER).trust, 9);
    });

    it("NO REGRESSION — with NO descriptor, the fold is BYTE-IDENTICAL to today's `kind`-only path", () => {
      // Two sandboxes, same user-seed → same per-user fold rng stream. The same `kind` call must
      // produce the identical hidden edge whether or not the generative code path exists around it.
      const a = freshSandbox("adr0005-regress", 511);
      const b = freshSandbox("adr0005-regress", 511);
      const pa = a.session.livingIds().find((id) => id !== PLAYER)!;
      const pb = b.session.livingIds().find((id) => id !== PLAYER)!;

      const content = "A perfectly ordinary alliance chat by the pool.";
      a.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, pa], kind: "alliance", content });
      // `b` supplies an EMPTY descriptor (no edges, no rationale) — must behave exactly like no descriptor.
      b.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, pb], kind: "alliance", content, consequence: {} });

      expect(b.engine.relationships.edge(pb, PLAYER)).toEqual(a.engine.relationships.edge(pa, PLAYER));
    });
  });

  describe("(6) SECRETS AS POWER (0093/0099) — the model proposes WHICH secret/target/prose; the engine owns the MAGNITUDE", () => {
    // Wielding a held secret (leverage / expose / trade) is the same ADR 0005 split: the open set is which
    // secret, which target, and the prose; the closed set is HOW MUCH it moves a read. No number crosses,
    // and the lever's PROSE rides through losslessly while the engine keeps the bounded, seeded amount.
    function learnAbout(sb: ReturnType<typeof freshSandbox>, subject: string): string {
      sb.engine.knowledge.seedBelief(subject, { content: `the truth about ${subject}`, originalContent: "x", factId: `seed:${subject}`, confidence: 0.9, hops: 0, distortion: 0, source: subject }, "origin");
      sb.engine.knowledge.surfaceInformationTo(PLAYER, { content: `the truth about ${subject}`, subject, confidence: 0.85 }, `told-by:${subject}`);
      const f = sb.engine.knowledge.knownTo(PLAYER).find((k) => k.subject === subject)!;
      return f.factId ?? f.id;
    }

    it("an EXPOSE folds a real, bounded consequence (the open-set move is consequenced, never inert) and crosses NO number", () => {
      const sb = freshSandbox("adr0005-expose", 601);
      const subject = sb.session.livingIds().find((id) => id !== PLAYER)!;
      const other = sb.session.livingIds().find((id) => id !== PLAYER && id !== subject)!;
      const before = { ...sb.engine.relationships.edge(other, subject) };
      const f = learnAbout(sb, subject);
      const res = sb.session.exposeSecret({ factId: f })!;
      // The house re-reads the subject (a real fold) — the information actually changed the board.
      const after = sb.engine.relationships.edge(other, subject);
      const moved = Math.abs(after.threat - before.threat) > 1e-9 || Math.abs(after.affinity - before.affinity) > 1e-9;
      expect(moved).toBe(true);
      // …yet the RESULT carries no magnitude — only a Vault-safe narratable phrase (anti-sycophancy).
      expect(JSON.stringify(res)).not.toMatch(/[-+]?\d+\.\d+/);
    });

    it("a TRADE's value is the RECIPIENT's read (the open set), and the engine — not the model — decides if it lands", () => {
      // The SAME secret offered to two recipients with opposite reads of its subject moves the board
      // differently — proof the engine owns the magnitude from the recipient's perspective, not the model.
      const wants = freshSandbox("adr0005-trade-wants", 602);
      const dontcare = freshSandbox("adr0005-trade-dc", 602);
      const subjW = wants.session.livingIds().filter((id) => id !== PLAYER);
      const subjD = dontcare.session.livingIds().filter((id) => id !== PLAYER);
      // Recipient who FEARS the subject + trusts the player ⇒ values it ⇒ accepts.
      const rw = wants.engine.relationships.edge(subjW[1]!, PLAYER); rw.trust = 0.9; rw.affinity = 0.8; rw.threat = 0.05;
      const rws = wants.engine.relationships.edge(subjW[1]!, subjW[0]!); rws.threat = 0.9; rws.affinity = 0.05;
      // Recipient ALLIED with the subject ⇒ the secret is worthless to them; with only LUKEWARM warmth to
      // the player, a worthless trade doesn't clear the bar ⇒ they decline (the value is decisive).
      const rd = dontcare.engine.relationships.edge(subjD[1]!, PLAYER); rd.trust = 0.1; rd.affinity = 0.1; rd.threat = 0.35;
      const rds = dontcare.engine.relationships.edge(subjD[1]!, subjD[0]!); rds.threat = 0.02; rds.affinity = 0.95;

      const fW = learnAbout(wants, subjW[0]!);
      const fD = learnAbout(dontcare, subjD[0]!);
      const accW = (wants.session.tradeSecret({ factId: fW, toNpcId: subjW[1]! }) as { accepted: boolean }).accepted;
      const accD = (dontcare.session.tradeSecret({ factId: fD, toNpcId: subjD[1]! }) as { accepted: boolean }).accepted;
      expect(accW).toBe(true); // the recipient who wanted it took it
      expect(accD).toBe(false); // the recipient who didn't care declined — the engine owns the value
    });

    it("NO REGRESSION — a season with no lever invoked is byte-identical (the expressive gate's secrets-as-power corollary)", () => {
      // The secrets-as-power code adds nothing to the seeded fold path unless a lever is invoked; two
      // identical no-lever runs fold byte-identically (the broader proof is `secretPowerNeutral.test.ts`).
      const a = freshSandbox("adr0005-sp-regress", 603);
      const b = freshSandbox("adr0005-sp-regress", 603);
      const pa = a.session.livingIds().find((id) => id !== PLAYER)!;
      const pb = b.session.livingIds().find((id) => id !== PLAYER)!;
      const content = "An ordinary scheme by the hammock.";
      a.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, pa], kind: "strategy", content });
      b.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, pb], kind: "strategy", content });
      expect(b.engine.relationships.edge(pb, PLAYER)).toEqual(a.engine.relationships.edge(pa, PLAYER));
    });
  });
});

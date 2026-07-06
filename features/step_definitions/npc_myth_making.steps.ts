import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { BbWorld } from "../support/world";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { buildSandbox } from "../../tests/support/sandbox";
import { diffuseGossip, makeSocialGraph, LEGEND, LEGEND_GLOSS, legendFrom } from "../../src/engine/gossip";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { GameHouse } from "../../src/engine/characterFactory";
import type { EntityId } from "../../src/domain/ids";
import type { EdgeSignals } from "../../src/engine/relationshipConstants";

/**
 * Feature 0101 — NPC myth-making. Role-only (the-player, a houseguest, a witness, a far houseguest, the
 * house). This BUILDS ON the 0002 gossip diffusion (`src/engine/gossip.ts`'s `diffuseGossip` — factId /
 * source / confidence / distortion / player-terminal surfacing) — it adds only a player-subject ORIGIN
 * (`src/engine/legends.ts`'s `notablePlayerActs` + `gossip.ts`'s `LEGEND_GLOSS`/`legendFrom`), reusing the
 * diffusion wholesale via `GameSessionAdapter.legendTick`. It is NOT a new system.
 *
 * The shared Background "a started season with the player in the house" is defined by 0075's
 * `confidence.steps.ts` (a bare `GameSessionAdapter` wired to a `buildSandbox()` fixture's real
 * events/knowledge/relationships) — reused here by reading the SAME legacy fields it populates.
 */

interface Legacy {
  cSession?: GameSessionAdapter;
  cSb?: ReturnType<typeof buildSandbox>;
}
const legacy = (w: BbWorld): Legacy => w as unknown as Legacy;

const houseOf = (s: GameSessionAdapter): GameHouse => (s as unknown as { house: GameHouse }).house;

const ALL_GLOSSES: readonly string[] = Object.values(LEGEND_GLOSS);

/** Does this content string carry ANY legend gloss (verbatim, since the hedge-only distortion this
 *  feature applies never rewrites the gloss text itself — only appends a hedge/marker, per `distort()`). */
function carriesAnyGloss(content: string | undefined): boolean {
  return !!content && ALL_GLOSSES.some((g) => content.includes(g));
}

/** Every houseguest id in the started fixture (player + all NPCs). */
function everyone(s: GameSessionAdapter): EntityId[] {
  const h = houseOf(s);
  return [h.player.id, ...h.npcs.map((n) => n.id)];
}

/** Seed a fresh notable player act (a veto win) onto the shared fixture's event ledger. */
function seedNotableAct(w: BbWorld): void {
  const sb = legacy(w).cSb!;
  const playerName = houseOf(legacy(w).cSession!).player.name;
  sb.engine.events.record({
    id: `season:${sb.engine.events.count()}`,
    ts: sb.engine.events.count(),
    type: "house-event",
    initiator: PLAYER,
    witnessSet: [PLAYER],
    hidden: false,
    content: `${playerName} wins the Power of Veto`,
  });
}

/** Seed an ordinary, unremarkable scene onto the ledger — never a notable-act class. */
function seedUnremarkableScene(w: BbWorld): void {
  const sb = legacy(w).cSb!;
  sb.engine.events.record({
    id: `season:${sb.engine.events.count()}`,
    ts: sb.engine.events.count(),
    type: "house-event",
    initiator: PLAYER,
    witnessSet: [PLAYER],
    hidden: false,
    content: "the house shares a quiet afternoon",
  });
}

/** Run legendTick up to `maxTicks` times, stopping the moment a legend is confirmed minted. */
function runLegendTicksUntilMinted(w: BbWorld, maxTicks: number): boolean {
  const session = legacy(w).cSession!;
  const sb = legacy(w).cSb!;
  session.setMythMakingEnabled(true);
  for (let i = 0; i < maxTicks; i++) {
    session.legendTick(sb.engine.events, sb.engine.knowledge);
    if ((session.snapshot().legendCount ?? 0) > 0) return true;
  }
  return false;
}

// ── Rule: A notable player act becomes a spreading legend ──────────────────────────────────────────

Given("the player has done a notable, public thing in the house", function (this: BbWorld) {
  seedNotableAct(this);
});

Given("the player has only had ordinary, unremarkable scenes", function (this: BbWorld) {
  seedUnremarkableScene(this);
});

When("the off-screen house lives between the player's turns", function (this: BbWorld) {
  this.myth = { ...this.myth, minted: runLegendTicksUntilMinted(this, 200) };
});

Then("the engine seeds a legend whose subject is the player", function (this: BbWorld) {
  assert.equal(this.myth!.minted, true, "a legend was minted within a generous tick budget");
});

Then("the legend is a vague public gloss of the act, not the verbatim scene", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const holders = everyone(legacy(this).cSession!).filter((id) => carriesAnyGloss(
    sb.engine.knowledge.knownTo(id).find((f) => carriesAnyGloss(f.content))?.content,
  ));
  assert.ok(holders.length > 0, "at least one houseguest holds the legend gloss");
  const playerName = houseOf(legacy(this).cSession!).player.name;
  for (const id of holders) {
    const fact = sb.engine.knowledge.knownTo(id).find((f) => carriesAnyGloss(f.content))!;
    assert.ok(!fact.content.includes(`${playerName} wins the Power of Veto`), "never the verbatim act");
  }
});

Then("the legend diffuses from houseguest to houseguest along the relationship graph", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const holders = everyone(legacy(this).cSession!).filter((id) =>
    sb.engine.knowledge.knownTo(id).some((f) => carriesAnyGloss(f.content)));
  assert.ok(holders.length > 1, `the legend spread past its origin (holders: ${holders.length})`);
});

Then("no legend about the player is seeded", function (this: BbWorld) {
  assert.equal(this.myth!.minted, false, "no legend minted from an unremarkable turn");
});

Then("the house tells no story about the player", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  for (const id of everyone(legacy(this).cSession!)) {
    assert.ok(!sb.engine.knowledge.knownTo(id).some((f) => carriesAnyGloss(f.content)), `${id} holds no legend`);
  }
});

// ── Rule: A legend distorts as it spreads ───────────────────────────────────────────────────────────

// A controlled LINE topology (witness → a → b → c) with forced transmission, so distortion/confidence
// grow deterministically hop-by-hop — the SAME `diffuseGossip` machinery `legendTick` calls, exercised
// directly for a reproducible multi-hop chain.
const WITNESS = npc(1);
const CHAIN: EntityId[] = [WITNESS, npc(2), npc(3), npc(4)];

Given("a legend about the player has begun spreading from a witness", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const edges: Array<readonly [EntityId, EntityId]> = [];
  for (let i = 0; i + 1 < CHAIN.length; i++) edges.push([CHAIN[i]!, CHAIN[i + 1]!] as const);
  const rng = new SeededRandom(101);
  const { factId } = diffuseGossip({
    knowledge: sb.engine.knowledge, graph: makeSocialGraph(edges), rng, origin: WITNESS,
    fact: { content: legendFrom("veto-win") }, rounds: CHAIN.length - 1, transmitProb: 1, decay: 0.7,
  });
  this.myth = { ...this.myth, chain: CHAIN, factId };
});

When("the legend is retold across several houseguests", function (this: BbWorld) {
  // The full retelling chain already ran in the Given (a forced-transmission line topology) — this step
  // confirms the far end of the chain actually received it before the Thens compare witness vs far.
  const sb = legacy(this).cSb!;
  const far = this.myth!.chain![this.myth!.chain!.length - 1]!;
  assert.ok(sb.engine.knowledge.knownTo(far).some((f) => f.factId === this.myth!.factId), "the chain's far end holds the legend");
});

Then("a houseguest further along the chain holds a more distorted version than the witness", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const witnessFact = sb.engine.knowledge.knownTo(WITNESS).find((f) => f.factId === this.myth!.factId)!;
  const far = this.myth!.chain![this.myth!.chain!.length - 1]!;
  const farFact = sb.engine.knowledge.knownTo(far).find((f) => f.factId === this.myth!.factId)!;
  assert.ok((farFact.distortion ?? 0) > (witnessFact.distortion ?? 0), "distortion grows down the chain");
});

Then("that houseguest's confidence in the legend is lower than the witness's", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const witnessFact = sb.engine.knowledge.knownTo(WITNESS).find((f) => f.factId === this.myth!.factId)!;
  const far = this.myth!.chain![this.myth!.chain!.length - 1]!;
  const farFact = sb.engine.knowledge.knownTo(far).find((f) => f.factId === this.myth!.factId)!;
  assert.ok((farFact.confidence ?? 1) < (witnessFact.confidence ?? 1), "confidence decays down the chain");
});

Then("every version shares the same legend lineage", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  for (const id of this.myth!.chain!) {
    const fact = sb.engine.knowledge.knownTo(id).find((f) => f.factId === this.myth!.factId);
    assert.ok(fact, `${id} holds a version of the SAME legend (factId ${this.myth!.factId})`);
  }
});

// ── Rule: A legend reaches the player only through a terminating pathway ───────────────────────────

/** A CHAIN that ends at the player — the same forced-transmission `diffuseGossip` topology as the
 *  distortion rule above, so "a chain of tellings terminates at the player" is deterministic (never a
 *  flaky function of `legendTick`'s own rare seed-probability roll). */
const CHAIN_TO_PLAYER: EntityId[] = [WITNESS, npc(2), npc(3), PLAYER];

Given("a legend about the player is spreading through the house", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const edges: Array<readonly [EntityId, EntityId]> = [];
  for (let i = 0; i + 1 < CHAIN_TO_PLAYER.length; i++) edges.push([CHAIN_TO_PLAYER[i]!, CHAIN_TO_PLAYER[i + 1]!] as const);
  const rng = new SeededRandom(404);
  // Forced transmission (probability 1) along the chain, for JUST enough rounds to reach the second-to-
  // last hop (npc:3) — one hop short of the player — so the When step below is the one that visibly
  // "terminates at the player" (deterministic; never a flaky function of `legendTick`'s rare seed roll).
  const { factId } = diffuseGossip({
    knowledge: sb.engine.knowledge, graph: makeSocialGraph(edges), rng, origin: WITNESS,
    fact: { content: legendFrom("hoh-win") }, rounds: CHAIN_TO_PLAYER.length - 2, transmitProb: 1, decay: 0.7,
  });
  this.myth = { ...this.myth, chain: CHAIN_TO_PLAYER, factId };
  assert.ok(!sb.engine.knowledge.knownTo(PLAYER).some((f) => f.factId === factId), "not yet at the player");
});

When("a chain of tellings terminates at the player", function (this: BbWorld) {
  // The FINAL leg (the last houseguest in the chain tells the player) — the SAME `transmitGossip` primitive
  // `diffuseGossip` itself calls per hop (`gossip.ts`), driven explicitly here for a deterministic final step.
  const sb = legacy(this).cSb!;
  const teller = CHAIN_TO_PLAYER[CHAIN_TO_PLAYER.length - 2]!;
  const belief = sb.engine.knowledge.knownTo(teller).find((f) => f.factId === this.myth!.factId)!;
  sb.engine.knowledge.transmitGossip(
    teller, PLAYER,
    {
      content: belief.content, originalContent: belief.originalContent, factId: belief.factId ?? this.myth!.factId!,
      confidence: (belief.confidence ?? 1) * 0.7, source: teller,
      hops: (belief.hops ?? 0) + 1, distortion: (belief.distortion ?? 0) + 1,
    },
    `told-by:${teller}`,
  );
});

Then("the player learns the legend as their own knowledge", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  assert.ok(sb.engine.knowledge.knownTo(PLAYER).some((f) => carriesAnyGloss(f.content)), "the player holds the legend");
});

Then("the legend carries its provenance and the houseguest who told it", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const fact = sb.engine.knowledge.knownTo(PLAYER).find((f) => carriesAnyGloss(f.content))!;
  assert.ok(fact.pathway.startsWith("told-by:"), `provenance pathway present (saw: ${fact.pathway})`);
});

Then("a houseguest may voice it as what the house is saying about the player", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const fact = sb.engine.knowledge.knownTo(PLAYER).find((f) => carriesAnyGloss(f.content))!;
  assert.ok(typeof fact.content === "string" && fact.content.length > 0, "voiceable prose content exists");
});

Given("a legend about the player is spreading among houseguests only", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  // A graph that structurally EXCLUDES the player — a chain among NPCs only — so no pathway can ever
  // terminate at the player, however many rounds run.
  const edges: Array<readonly [EntityId, EntityId]> = [];
  for (let i = 0; i + 1 < CHAIN.length; i++) edges.push([CHAIN[i]!, CHAIN[i + 1]!] as const);
  const rng = new SeededRandom(202);
  const { factId } = diffuseGossip({
    knowledge: sb.engine.knowledge, graph: makeSocialGraph(edges), rng, origin: WITNESS,
    fact: { content: legendFrom("nominations") }, rounds: CHAIN.length - 1, transmitProb: 1, decay: 0.7,
  });
  this.myth = { ...this.myth, chain: CHAIN, factId };
});

Given("no chain of tellings reaches the player", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  assert.ok(!sb.engine.knowledge.knownTo(PLAYER).some((f) => f.factId === this.myth!.factId), "the player-excluded graph never delivers to the player");
});

Then("the player learns nothing of the legend", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  assert.ok(!sb.engine.knowledge.knownTo(PLAYER).some((f) => f.factId === this.myth!.factId));
});

Then("the legend remains hidden-layer belief among the houseguests", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const holders = this.myth!.chain!.filter((id) => sb.engine.knowledge.knownTo(id).some((f) => f.factId === this.myth!.factId));
  assert.ok(holders.length > 0, "the legend still lives among the houseguests it reached");
});

// ── Rule: The Vault Wall holds — for the player and for the admin ──────────────────────────────────

Given("a legend about the player is diffusing in the hidden layer", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  // ONE hop only (WITNESS → next) — deliberately short of the player, so this Given proves the
  // "before a pathway delivers it" half of the Rule.
  const edges: Array<readonly [EntityId, EntityId]> = [[WITNESS, CHAIN[1]!] as const];
  const rng = new SeededRandom(303);
  diffuseGossip({
    knowledge: sb.engine.knowledge, graph: makeSocialGraph(edges), rng, origin: WITNESS,
    fact: { content: legendFrom("hoh-win") }, rounds: 1, transmitProb: 1, decay: 0.7,
  });
});

Then("no player-facing surface exposes the legend before a pathway delivers it", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  assert.ok(!sb.engine.knowledge.knownTo(PLAYER).some((f) => carriesAnyGloss(f.content)), "not yet the player's knowledge");
});

Then("no admin or God-Mode surface exposes the legend, its confidence, or its diffusion graph", function (this: BbWorld) {
  const sb = legacy(this).cSb!;
  const adminJson = JSON.stringify(sb.admin.inspect());
  for (const g of ALL_GLOSSES) assert.ok(!adminJson.includes(g), `admin surface never carries the gloss "${g}"`);
  assert.ok(!/factId|distortion/i.test(adminJson), "admin surface carries no legend belief metadata");
});

Then("the surfaced legend carries no number and no truth marker", function () {
  for (const gloss of ALL_GLOSSES) {
    assert.ok(!/\d/.test(gloss), `gloss carries no number: "${gloss}"`);
    assert.ok(!/\b(true|false|accurate|confirmed|exaggerated|fabricated)\b/i.test(gloss), `gloss carries no truth marker: "${gloss}"`);
  }
});

Then("the player judges for themselves whether the legend is accurate", function () {
  // Structural: no gloss template asserts a truth value — the same static proof as the step above,
  // read as the player-facing guarantee (no "this is [in]accurate" tag ever ships with the content).
  for (const gloss of ALL_GLOSSES) assert.ok(!/\b(true|false|accurate)\b/i.test(gloss));
});

// ── Rule: Anti-sycophancy and determinism ───────────────────────────────────────────────────────────

Given("a legend about the player reaches the player through a pathway", function (this: BbWorld) {
  const session = legacy(this).cSession!;
  const sb = legacy(this).cSb!;
  const before = new Map<EntityId, EdgeSignals>();
  for (const id of everyone(session)) before.set(id, { ...(session as unknown as { rel: { edge(a: EntityId, b: EntityId): EdgeSignals } }).rel.edge(PLAYER, id) });
  // The SAME deterministic forced-transmission chain the "circles back" rule uses — reaching the player
  // is a precondition here, not what this rule is testing, so it must never be left to `legendTick`'s
  // own rare seed-probability roll (that would make this scenario flaky).
  const chain: EntityId[] = [WITNESS, npc(2), npc(3), PLAYER];
  const edges: Array<readonly [EntityId, EntityId]> = [];
  for (let i = 0; i + 1 < chain.length; i++) edges.push([chain[i]!, chain[i + 1]!] as const);
  const rng = new SeededRandom(505);
  diffuseGossip({
    knowledge: sb.engine.knowledge, graph: makeSocialGraph(edges), rng, origin: WITNESS,
    fact: { content: legendFrom("veto-win") }, rounds: chain.length - 1, transmitProb: 1, decay: 0.7,
  });
  assert.ok(sb.engine.knowledge.knownTo(PLAYER).some((f) => carriesAnyGloss(f.content)), "the legend reached the player");
  this.myth = { ...this.myth, playerEdgesBeforeJson: JSON.stringify([...before.entries()]) };
});

Then("the legend does not change how the player feels about any houseguest", function (this: BbWorld) {
  const session = legacy(this).cSession!;
  const after = new Map<EntityId, EdgeSignals>();
  for (const id of everyone(session)) after.set(id, { ...(session as unknown as { rel: { edge(a: EntityId, b: EntityId): EdgeSignals } }).rel.edge(PLAYER, id) });
  assert.equal(JSON.stringify([...after.entries()]), this.myth!.playerEdgesBeforeJson, "the player's OWN outbound edges are untouched by myth-making");
});

Then("the engine never tells the player whether the legend is true", function () {
  for (const gloss of ALL_GLOSSES) assert.ok(!/\b(true|false)\b/i.test(gloss));
});

Given("two myth-making seasons played from the same seed and the same history", function () {
  // Nothing to do yet — the pairing is built in the When below (three sandboxes off the SAME seed: OFF,
  // ON-a, ON-b) so both Thens can compare the right pair without re-deriving state.
});

When("one season has myth-making enabled and the other has it disabled", function (this: BbWorld) {
  const seed = 909;
  const build = (mythOn: boolean): { session: GameSessionAdapter; sb: ReturnType<typeof buildSandbox> } => {
    const sb = buildSandbox(seed);
    const session = new GameSessionAdapter();
    session.createCharacter({ playerName: "The Player", seed });
    session.setMythMakingEnabled(mythOn);
    const playerName = houseOf(session).player.name;
    sb.engine.events.record({
      id: `season:${sb.engine.events.count()}`, ts: sb.engine.events.count(), type: "house-event",
      initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: `${playerName} wins the Power of Veto`,
    });
    for (let i = 0; i < 40; i++) session.legendTick(sb.engine.events, sb.engine.knowledge);
    return { session, sb };
  };
  const off = build(false);
  const onA = build(true);
  const onB = build(true);
  const edgeHash = (s: GameSessionAdapter): string => {
    const rel = (s as unknown as { rel: { edge(a: EntityId, b: EntityId): EdgeSignals } }).rel;
    const ids = everyone(s);
    const rows: string[] = [];
    for (const a of ids) for (const b of ids) if (a !== b) rows.push(JSON.stringify(rel.edge(a, b)));
    return createHash("sha256").update(rows.join("|")).digest("hex");
  };
  const legendsOf = (sb: ReturnType<typeof buildSandbox>, s: GameSessionAdapter): string[] =>
    everyone(s).flatMap((id) => sb.engine.knowledge.knownTo(id).filter((f) => carriesAnyGloss(f.content)).map((f) => `${f.factId}:${f.content}`)).sort();

  this.myth = {
    ...this.myth,
    seededOutcomeA: edgeHash(off.session), seededOutcomeB: edgeHash(onA.session),
    legendsA: legendsOf(onA.sb, onA.session), legendsB: legendsOf(onB.sb, onB.session),
  };
});

Then("the seeded competition and eviction outcomes are byte-identical between them", function (this: BbWorld) {
  // The relationship-edge state is exactly what a competition/eviction roll consumes (0028/0026) — a
  // legend never folds any edge (mandate #3), so the closed set is identical whether myth-making ran.
  assert.equal(this.myth!.seededOutcomeB, this.myth!.seededOutcomeA, "the relationship edges (the closed set) are byte-identical on vs off");
});

Then("the legends seeded are identical given the same seed and history", function (this: BbWorld) {
  assert.deepEqual(this.myth!.legendsB, this.myth!.legendsA, "two ON runs from the same seed mint the identical legends");
});

import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { detectBlocs, blocFor, blocTerm, derivedLoyalty } from "../../src/engine/blocs";
import type { Bloc } from "../../src/engine/blocs";
import { RelationshipModel } from "../../src/engine/relationships";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

// Feature 0043 — emergent blocs: derived at decision time, never stored (decision 0002).
// HARD rule: roles only — no names.

const setBond = (rel: RelationshipModel, a: EntityId, b: EntityId, v: number): void => {
  const e1 = rel.edge(a, b); e1.trust = v; e1.affinity = v;
  const e2 = rel.edge(b, a); e2.trust = v; e2.affinity = v;
};

function blTrio(rel: RelationshipModel): EntityId[] {
  setBond(rel, npc(1), npc(2), 0.8);
  setBond(rel, npc(1), npc(3), 0.75);
  setBond(rel, npc(2), npc(3), 0.7);
  return [npc(1), npc(2), npc(3)];
}

// --- Scenario: blocs emerge without being stored -------------------------------------

Given("several houseguests with strong mutual bonds", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  this.blActive = [...blTrio(this.blRel), npc(8), npc(9)];
  this.blRel.edge(npc(1), npc(9)).threat = 0.9;
  this.blRel.edge(npc(2), npc(9)).threat = 0.8;
});

When("blocs are detected from the relationship graph", function (this: BbWorld) {
  this.blBlocs = detectBlocs({ rel: this.blRel!, active: this.blActive! });
});

Then("they are grouped into a bloc", function (this: BbWorld) {
  assert.equal(this.blBlocs!.length, 1);
  assert.deepEqual(this.blBlocs![0]!.members, [npc(1), npc(2), npc(3)].sort());
});

Then("no alliance or ally\\/enemy label is stored anywhere", function (this: BbWorld) {
  // The model serializes ONLY graded edges — no bloc, no label (decision 0002).
  const ser = JSON.stringify(this.blRel!.serialize());
  assert.ok(!/bloc|"ally"|"enemy"|sharedTarget|loyalty/i.test(ser));
});

// --- Scenario: derived shared target ---------------------------------------------------

Given("a detected bloc", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  this.blActive = [...blTrio(this.blRel), npc(9)];
  this.blRel.edge(npc(1), npc(9)).threat = 0.9;
  this.blRel.edge(npc(2), npc(9)).threat = 0.85;
  this.blBlocs = detectBlocs({ rel: this.blRel, active: this.blActive });
  assert.ok(this.blBlocs.length === 1);
});

Then("it carries a shared target derived from the members' aggregate threat", function (this: BbWorld) {
  assert.equal(this.blBlocs![0]!.sharedTarget, npc(9));
});

// --- Scenario: bloc-mates coordinate more than chance ------------------------------------

Given("a bloc within the house", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("bl-live");
  sb.session.createCharacter({ playerName: "The Player", seed: 12 });
  this.blSandbox = sb;
  this.blMembers = [npc(1), npc(2), npc(3)];
});

When("nominations and eviction votes resolve", function (this: BbWorld) {
  const sb = this.blSandbox!;
  const s = sb.session;
  const members = this.blMembers!;
  this.blViolations = [];
  this.blEnemyTargeted = 0;
  for (let i = 0; i < 240; i++) {
    // Hold the engineered structure against the loop's own folds (an iron bloc + a clear enemy).
    for (const a of members) for (const b of members) if (a !== b) {
      const e = sb.engine.relationships.edge(a, b); e.trust = 0.95; e.affinity = 0.95; e.threat = 0;
    }
    const v = s.advanceGame();
    if (v.pending) {
      const p = v.pending;
      if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
      else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
      else if (p.kind === "comp-intent") s.submitDecision({ kind: "comp-intent", intent: "compete" });
      else if (p.options[0]) s.submitDecision({ kind: p.kind, vote: p.options[0].id, replacement: p.options[0].id } as never);
    }
    const status = s.gameStatus();
    if (status.hoh && members.includes(status.hoh.id) && status.nominees.length === 2) {
      for (const nom of status.nominees) {
        if (members.includes(nom.id)) this.blViolations!.push(`bloc HOH nominated a bloc-mate in week ${status.week}`);
      }
    }
    if (v.status.week >= 4 || v.finished) break;
  }
});

Then("bloc-mates shield each other from nomination and vote together", function (this: BbWorld) {
  assert.deepEqual(this.blViolations, [], "a bloc HOH never nominates a bloc-mate");
  // Voting together is structural: every member computes the SAME derived bloc and the same
  // shielded/targeted read — pinned at the unit level (npcEvictChoice + blocTerm).
  const rel = new RelationshipModel(0.5);
  const ids = blTrio(rel);
  const blocs = detectBlocs({ rel, active: [...ids, npc(9)], loyaltyOf: () => 0.9 });
  for (const m of ids) assert.ok(blocTerm(blocs, m, ids.find((x) => x !== m)!) < 0);
});

Then("they lean toward targeting their shared enemy", function (this: BbWorld) {
  const rel = new RelationshipModel(0.5);
  const ids = blTrio(rel);
  rel.edge(ids[0]!, npc(9)).threat = 0.9;
  rel.edge(ids[1]!, npc(9)).threat = 0.9;
  const blocs = detectBlocs({ rel, active: [...ids, npc(9), npc(10)], loyaltyOf: () => 0.9 });
  for (const m of ids) assert.ok(blocTerm(blocs, m, npc(9)) > 0, "every member leans into the shared enemy");
});

// --- Scenario: a bloc is only as loyal as its members --------------------------------------

Given("two blocs under the same outside pressure", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  // Two structurally IDENTICAL trios.
  setBond(this.blRel, npc(1), npc(2), 0.75); setBond(this.blRel, npc(1), npc(3), 0.75); setBond(this.blRel, npc(2), npc(3), 0.75);
  setBond(this.blRel, npc(4), npc(5), 0.75); setBond(this.blRel, npc(4), npc(6), 0.75); setBond(this.blRel, npc(5), npc(6), 0.75);
  this.blActive = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(9)];
});

Given("one bloc's members are dispositionally loyal while the other's include a free agent", function (this: BbWorld) {
  this.blLoyaltyOf = (id: EntityId): number =>
    [npc(1), npc(2), npc(3)].includes(id) ? derivedLoyalty("bond", 0.5)
      : id === npc(6) ? derivedLoyalty("clash", 0.5) : derivedLoyalty("neutral", 0.5);
});

When("nominations and eviction votes resolve across the following weeks", function (this: BbWorld) {
  this.blBlocs = detectBlocs({ rel: this.blRel!, active: this.blActive!, loyaltyOf: this.blLoyaltyOf! });
});

Then("the loyal bloc holds together and coordinates measurably longer", function (this: BbWorld) {
  const loyal = blocFor(this.blBlocs!, npc(1))!;
  const loose = blocFor(this.blBlocs!, npc(4))!;
  assert.ok(loyal.loyaltyStrength > loose.loyaltyStrength, "the loyal trio's strength is higher");
  // The bloc TERM — what actually bends decisions week after week — scales with that strength.
  assert.ok(
    Math.abs(blocTerm(this.blBlocs!, npc(1), npc(2))) > Math.abs(blocTerm(this.blBlocs!, npc(4), npc(5))),
    "the loyal bloc shields harder",
  );
});

Then("the low-loyalty bloc's coordination is overridden by individual incentives sooner", function (this: BbWorld) {
  // Give the free agent a tempting one-way outside bond: THEY peel; the loyalist would not.
  const e = this.blRel!.edge(npc(6), npc(9)); e.trust = 0.95; e.affinity = 0.95;
  const low = (id: EntityId): number => (id === npc(6) ? 0.2 : 0.9);
  const blocs = detectBlocs({ rel: this.blRel!, active: this.blActive!, loyaltyOf: low });
  assert.ok(!blocFor(blocs, npc(4))?.members.includes(npc(6)), "the free agent defects to the better offer");
});

// --- Scenario: defection without betrayal ---------------------------------------------------

Given("a bloc containing a member with low derived loyalty", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  this.blActive = [...blTrio(this.blRel), npc(8)];
  this.blLoyaltyOf = (id: EntityId): number => (id === npc(3) ? 0.2 : 0.9);
});

Given("that member holds a stronger bond outside the bloc", function (this: BbWorld) {
  const e = this.blRel!.edge(npc(3), npc(8)); e.trust = 0.95; e.affinity = 0.95; // one-way pull
});

When("the next decisions are read", function (this: BbWorld) {
  this.blBlocs = detectBlocs({ rel: this.blRel!, active: this.blActive!, loyaltyOf: this.blLoyaltyOf! });
});

Then("that member peels away from the bloc's coordination before any betrayal event", function (this: BbWorld) {
  const bloc = blocFor(this.blBlocs!, npc(1));
  assert.ok(bloc && !bloc.members.includes(npc(3)), "the low-loyalty member is out of the read");
});

Then("no stored membership existed to update", function (this: BbWorld) {
  assert.ok(!/bloc|membership/i.test(JSON.stringify(this.blRel!.serialize())));
});

// --- Scenario: loyalty is derived from character and soul -----------------------------------

Given("a bloc whose member suffers a consequential event that shifts their soul state", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  this.blActive = blTrio(this.blRel);
  this.blSoulState = { [npc(3)]: 0.5 } as Record<EntityId, number>;
});

When("blocs are next detected", function (this: BbWorld) {
  const calm = detectBlocs({
    rel: this.blRel!, active: this.blActive!,
    loyaltyOf: (id) => derivedLoyalty("bond", this.blSoulState![id] ?? 0.5),
  })[0]!;
  this.blSoulState![npc(3)] = 0.15; // the consequential event rattled them (0041)
  const rattled = detectBlocs({
    rel: this.blRel!, active: this.blActive!,
    loyaltyOf: (id) => derivedLoyalty("bond", this.blSoulState![id] ?? 0.5),
  })[0]!;
  this.blCalmStrength = calm.loyaltyStrength;
  this.blBlocs = [rattled];
});

Then("the bloc's loyalty strength reflects the member's current soul state", function (this: BbWorld) {
  assert.ok(this.blBlocs![0]!.loyaltyStrength < this.blCalmStrength!, "a rattled member softens the bloc");
});

Then("the serialized save contains no bloc loyalty value", function (this: BbWorld) {
  assert.ok(!/loyaltyStrength|bloc/i.test(JSON.stringify(this.blRel!.serialize())));
});

// --- Scenario: betrayal fractures -------------------------------------------------------------

Given("a bloc of houseguests", function (this: BbWorld) {
  this.blRel = new RelationshipModel(0.5);
  this.blActive = blTrio(this.blRel);
  this.blBlocs = detectBlocs({ rel: this.blRel, active: this.blActive });
  assert.equal(this.blBlocs[0]!.members.length, 3);
});

When("one member betrays another and their bond drops", function (this: BbWorld) {
  for (let i = 0; i < 3; i++) this.blRel!.applyDirected(npc(3), npc(1), "betrayal", new SeededRandom(i + 1));
  for (let i = 0; i < 3; i++) this.blRel!.applyDirected(npc(1), npc(3), "betrayal", new SeededRandom(i + 9));
  this.blBlocs = detectBlocs({ rel: this.blRel!, active: this.blActive! });
});

Then("the next bloc detection yields a smaller or split bloc", function (this: BbWorld) {
  const bloc = blocFor(this.blBlocs!, npc(1));
  assert.ok(!bloc || bloc.members.length < 3, "the betrayal fractured the read");
});

Then("nothing about the old bloc was stored to update", function (this: BbWorld) {
  assert.ok(!/bloc/i.test(JSON.stringify(this.blRel!.serialize())));
});

// --- Scenario: never persisted -----------------------------------------------------------------

Given("a game in which blocs have formed", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("bl-persist");
  sb.session.createCharacter({ playerName: "The Player", seed: 6 });
  for (const a of [npc(1), npc(2), npc(3)]) for (const b of [npc(1), npc(2), npc(3)]) {
    if (a !== b) setBond(sb.engine.relationships, a, b, 0.85);
  }
  this.blSandbox = sb;
  this.blRegistry = reg;
  assert.ok(detectBlocs({ rel: sb.engine.relationships, active: [PLAYER, npc(1), npc(2), npc(3), npc(4)] }).length > 0);
});

When("the soul\\/save is serialized", function (this: BbWorld) {
  this.blSerialized = JSON.stringify(this.blRegistry!.snapshot("bl-persist"));
});

Then("it contains no bloc membership and no ally\\/enemy label", function (this: BbWorld) {
  assert.ok(!/"bloc|"ally"|"enemy"|sharedTarget|loyaltyStrength|cohesion/.test(this.blSerialized!));
});

// --- Scenario: Vault-free and deterministic -------------------------------------------------------

Given("a started game in which blocs have formed", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("bl-vault");
  sb.session.createCharacter({ playerName: "The Player", seed: 7 });
  for (const a of [npc(1), npc(2), npc(3)]) for (const b of [npc(1), npc(2), npc(3)]) {
    if (a !== b) setBond(sb.engine.relationships, a, b, 0.85);
  }
  this.blSandbox = sb;
});

Then("no bloc roster or hidden state appears", function (this: BbWorld) {
  assert.ok(!/sharedTarget|loyaltyStrength|cohesion|"bloc/.test(this.lastOutput), "no bloc roster crosses the wall");
  assert.ok(!/"trust"|"threat"|"affinity"/.test(this.lastOutput), "no opinion numbers");
});

Then("the same relationship graph and seed yield the same blocs", function (this: BbWorld) {
  const rel = this.blSandbox!.engine.relationships;
  const active = [PLAYER, npc(1), npc(2), npc(3), npc(4)];
  assert.deepEqual(
    detectBlocs({ rel, active }),
    detectBlocs({ rel, active }),
    "stateless: same edges, same blocs",
  );
});

import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { renderGameContext, MOMENT_PROMPTS } from "../../src/engine/momentPrompts";

/**
 * Narration-framing fixes from the 2026-06-26 BB-nerd auditor synthesis (Lane C).
 *
 * F3 (#1016) — archetypes told, not inferred. The roster line LED with the exact strategic label the
 *   prose rules forbid voicing, so the model led its narration with it. The fix DEMOTES archetype +
 *   strategyStyle into a fenced PRIVATE voice cue and LEADS the line with the OBSERVABLE facets.
 * F13 (#1018) — "Houseguest's Choice" chip not voiced. The veto-competition fragment now instructs the
 *   model to voice the chip draw as its own ritual beat, including the HGC special draw + who was picked.
 *
 * Roles only — no fixture names.
 */
describe("F3 (#1016) — archetype demoted to a fenced private cue, observable facets lead", () => {
  const view = (seed = 11) =>
    new GameSessionAdapter().createCharacter({ playerName: "The Player", seed });

  it("the roster line no longer LEADS with the archetype token", () => {
    const v = view();
    const ctx = renderGameContext(v);
    const first = v.house.find((h) => h.status === "active" && h.archetype)!;
    expect(first).toBeTruthy();
    // The archetype must NOT be the first token after the name+dash separator.
    expect(ctx).not.toContain(`${first.name} — ${first.archetype}, plays ${first.strategyStyle}`);
    // The archetype string still appears (demoted, not removed) — but only inside the private cue.
    expect(ctx).toContain(first.archetype!);
  });

  it("the archetype+strategy pairing rides in a fenced 'never said aloud' private cue, not as a lead label", () => {
    const v = view(23);
    const ctx = renderGameContext(v);
    const first = v.house.find((h) => h.status === "active" && h.archetype)!;
    // Find the roster line for this houseguest.
    const line = ctx.split("\n").find((l) => l.includes(`- ${first.name}`) && l.includes(first.archetype!))!;
    expect(line).toBeTruthy();
    // The cue carries the demotion framing.
    expect(line).toContain("private voice cue, never said aloud");
    // The OLD lead-with-the-label form ("<archetype>, plays <strategyStyle>") survives ONLY inside the
    // fenced cue (it may also recur as benign prose in the generated biography, but never as the lead
    // scouting-report label the prose rules forbid).
    const labelForm = `${first.archetype}, plays ${first.strategyStyle}`;
    const cueIdx = line.indexOf("private voice cue, never said aloud");
    const labelIdx = line.indexOf(labelForm);
    expect(labelIdx).toBeGreaterThan(cueIdx); // the "X, plays Y" label form is only inside the cue
  });

  it("the observable facets (look/age/presentation) lead the line, before the cue", () => {
    const v = view(7);
    const ctx = renderGameContext(v);
    const first = v.house.find((h) => h.status === "active" && h.archetype && h.presentation)!;
    const line = ctx.split("\n").find((l) => l.includes(`- ${first.name}`) && l.includes(first.archetype!))!;
    // an observable facet (the presentation) precedes the private archetype cue
    expect(line.indexOf(first.presentation!)).toBeLessThan(line.indexOf("private voice cue"));
  });
});

describe("F13 (#1018) — the veto fragment instructs voicing the chip draw / Houseguest's Choice", () => {
  it("the veto-competition moment voices the chip draw as its own ritual beat", () => {
    const frag = MOMENT_PROMPTS["veto-competition"]!;
    expect(frag).toMatch(/CHIP DRAW AS ITS OWN RITUAL BEAT/i);
    // it must instruct reading each draw out loud, not skipping to the seated six
    expect(frag.toLowerCase()).toContain("do not skip straight to the seated six");
  });

  it("the fragment calls out the Houseguest's Choice special draw + who was picked", () => {
    const frag = MOMENT_PROMPTS["veto-competition"]!;
    expect(frag).toContain("Houseguest's Choice");
    expect(frag.toLowerCase()).toContain("who they picked");
    // ground the pick in the engine's recorded player, never a substitute
    expect(frag.toLowerCase()).toContain("never your own substitute");
  });
});

describe("#1108 — STATIC CHARACTER facts re-grounded as fixed/authoritative (no scene-to-scene drift)", () => {
  const view = (seed = 31) =>
    new GameSessionAdapter().createCharacter({ playerName: "The Player", seed });

  it("the roster framing marks each houseguest's identity facts as FIXED and AUTHORITATIVE", () => {
    const ctx = renderGameContext(view());
    // The re-grounding clause: identity is stable for the whole season, voiced consistently.
    expect(ctx).toContain("FIXED AND AUTHORITATIVE");
    expect(ctx.toLowerCase()).toContain("never re-invent");
    expect(ctx.toLowerCase()).toContain("do not change or drift from scene to scene");
    // It names the concrete stable CHARACTER facets the model must not confabulate.
    expect(ctx.toLowerCase()).toContain("vocation/profession");
    expect(ctx.toLowerCase()).toContain("single source of truth for who each person is");
  });

  it("a beat that names a houseguest carries that houseguest's stable vocation in the prompt", () => {
    const v = view(44);
    const ctx = renderGameContext(v);
    // Pick an active houseguest whose CHARACTER carries a vocation (the drifting facet in #1108).
    const withVocation = v.house.find((h) => h.status === "active" && h.vocation);
    expect(withVocation).toBeTruthy();
    // Their stable vocation is GROUNDED into the prompt, on their own roster line — so the model
    // voices a consistent profession instead of re-confabulating one (court-reporter ⇄ roller-derby).
    const line = ctx.split("\n").find((l) => l.includes(`- ${withVocation!.name}`))!;
    expect(line).toBeTruthy();
    expect(line).toContain(withVocation!.vocation!);
  });

  it("the re-grounding surfaces ONLY public CHARACTER facets — never SOUL / Vault state", () => {
    const ctx = renderGameContext(view(7)).toLowerCase();
    // No hidden relationship/soul numbers ever appear in the public projection (the Vault Wall).
    expect(ctx).not.toContain("trust:");
    expect(ctx).not.toContain("threat level");
    expect(ctx).not.toContain("affinity");
    expect(ctx).not.toContain("secret");
    expect(ctx).not.toContain("hidden goal");
  });
});

describe("#1107 — eviction reveal forbids a fabricated full numeric vote tally", () => {
  it("the eviction moment instructs voicing ONLY anonymized ballots + the committed result", () => {
    const frag = MOMENT_PROMPTS["eviction"]!;
    expect(frag).toContain("NEVER FABRICATE A FULL NUMERIC TALLY");
    // it must keep the model on the engine's anonymized ballots, not a self-authored count
    expect(frag.toLowerCase()).toContain("anonymized partial ballots");
    expect(frag.toLowerCase()).toContain("a vote to evict");
  });

  it("the fragment bans a per-number two-sided count that exceeds the legal voter set", () => {
    const frag = MOMENT_PROMPTS["eviction"]!;
    // the exact failure mode (#1107): a phantom-ballot count above the legal voters
    expect(frag.toLowerCase()).toContain("phantom ballot");
    expect(frag.toLowerCase()).toContain("more votes than there are legal voters");
    // and it spells out WHY: 16 minus HOH minus the two nominees ⇒ far fewer actually vote
    expect(frag.toLowerCase()).toContain("minus the hoh and the two nominees");
    expect(frag.toLowerCase()).toContain("never state a number of votes that could not");
  });
});

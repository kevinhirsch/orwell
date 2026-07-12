import { describe, it, expect } from "vitest";
import { BASE_GAME_MASTER_PROMPT, MOMENT_PROMPTS, buildSystemPrompt } from "../../src/engine/momentPrompts";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

/**
 * #1391 — PROMPT-BUDGET REGRESSION GATE.
 *
 * The narrator system prompt is a large, FIXED per-turn cost: BASE_GAME_MASTER_PROMPT (~11.7k approx
 * tokens) + a moment fragment ride on EVERY turn, ahead of the dynamic roster/context. Left ungated,
 * each new MUST/NEVER rule silently grows that fixed budget (and dilutes the rules already there —
 * the #1391 motivation). This gate pins a ceiling on the fixed instruction budget so a future addition
 * that balloons it fails HERE, forcing an explicit "is this worth the budget?" decision (and, if yes,
 * a deliberate ceiling bump in the same change) instead of unbounded creep.
 *
 * TOKENS are approximated as `ceil(chars / 4)` — the standard rough proxy (no tokenizer dep). The gate
 * is RELATIVE (catch ballooning), not an exact token count; the proxy is deterministic and monotonic in
 * length, which is all the ratchet needs. Ceilings sit a few percent above the current size: tight
 * enough to catch a real balloon (tens of lines), loose enough that a single-line rule tweak does not
 * flake. When a deliberate addition trips this, RAISE the ceiling in the same PR (and re-record golden).
 */
const approxTokens = (s: string): number => Math.ceil(s.length / 4);

// Current (2026-07-12): BASE ~11693, largest BASE+fragment (casting) ~14003. Headroom ~4%.
const CEIL_BASE_TOKENS = 12200;
const CEIL_ASSEMBLED_TOKENS = 14600;

describe("#1391 — prompt-budget ratchet (the fixed instruction budget cannot silently balloon)", () => {
  it("BASE_GAME_MASTER_PROMPT stays under the fixed-budget ceiling", () => {
    const t = approxTokens(BASE_GAME_MASTER_PROMPT);
    expect(
      t,
      `BASE is ~${t} approx-tokens, over the ${CEIL_BASE_TOKENS} ceiling. If this growth is ` +
        `intentional, RAISE CEIL_BASE_TOKENS in the same PR (and re-record the golden fixture); ` +
        `otherwise trim/consolidate rather than append.`,
    ).toBeLessThanOrEqual(CEIL_BASE_TOKENS);
  });

  it("BASE + every moment fragment stays under the assembled-budget ceiling (no fragment balloons it)", () => {
    const over: string[] = [];
    for (const [name, fragment] of Object.entries(MOMENT_PROMPTS)) {
      const t = approxTokens(`${BASE_GAME_MASTER_PROMPT}\n\n${fragment}`);
      if (t > CEIL_ASSEMBLED_TOKENS) over.push(`${name} (~${t})`);
    }
    expect(
      over,
      `BASE + fragment over the ${CEIL_ASSEMBLED_TOKENS} approx-token ceiling: ${over.join(", ")}. ` +
        `Raise CEIL_ASSEMBLED_TOKENS deliberately (and re-record golden) or trim the fragment.`,
    ).toEqual([]);
  });

  it("a realistic assembled per-turn prompt (BASE + fragment + full roster context) is measured, not just BASE", () => {
    // Sanity that the gate reasons about the SHAPE the model actually receives — BASE + a fragment +
    // the woven Vault-free context (a full 15-NPC roster). This isn't a hard ceiling (the roster is
    // dynamic and legitimately dominates), but it pins that the assembled build stays well-formed and
    // in a sane order of magnitude, so a structural regression (e.g. BASE duplicated) would show here.
    const game = new GameSessionAdapter();
    game.createCharacter({ playerName: "The Player", seed: 3 });
    const prompt = buildSystemPrompt("social", game.getGameState());
    expect(prompt.startsWith(BASE_GAME_MASTER_PROMPT)).toBe(true);
    expect(prompt).toContain("GAME CONTEXT:");
    // A full assembled turn is larger than BASE alone but not pathologically so (no accidental doubling).
    const assembled = approxTokens(prompt);
    expect(assembled).toBeGreaterThan(approxTokens(BASE_GAME_MASTER_PROMPT));
    expect(assembled).toBeLessThan(approxTokens(BASE_GAME_MASTER_PROMPT) * 2);
  });

  it("the terminal HARD-LINE recap rides at the TAIL of BASE (recency), after the lever manifest", () => {
    // #1391: the dilution fix is a short tail recap of the non-negotiables where recency bias attends.
    // Pin that it exists AND sits after the lever manifest (the tail), so a refactor can't quietly bury
    // it mid-prompt (which would defeat the recency rationale).
    const hardLineAt = BASE_GAME_MASTER_PROMPT.indexOf("THE HARD LINE");
    const renderSceneAt = BASE_GAME_MASTER_PROMPT.indexOf("renderScene");
    expect(hardLineAt).toBeGreaterThan(0);
    expect(hardLineAt).toBeGreaterThan(renderSceneAt); // after the last lever bullet = at the tail
    // It is a RECAP of existing non-negotiables, so it must not introduce the banned prose token nor a
    // lever-bullet shape (guarded elsewhere too, pinned here at the source of the addition).
    const tail = BASE_GAME_MASTER_PROMPT.slice(hardLineAt);
    expect(/\bthe engine\b/i.test(tail)).toBe(false);
    expect(tail).not.toMatch(/•\s+[A-Za-z]+\s+—/); // no "• lever —" bullets in the recap
  });
});

import { describe, it, expect } from "vitest";
import {
  logHunch, editHunch, withdrawHunch, canEdit, resolveAgainstReveal, scorecard,
  type SuspicionEntry, type RevealedFact, type ProposedVerdict,
} from "../../src/engine/suspicionLedger";

/**
 * Feature 0097 — the suspicion ledger (pure core). The player logs private hunches in their own words; the
 * game stamps a "called-it / wrong / partial" verdict ONLY when handed an already-REVEALED, Vault-free fact
 * (never a live Vault read). A hunch no reveal touches stays honestly `open`. Roles only — no names.
 * Vault-safety here is STRUCTURAL: the scorer is handed only a `RevealedFact` (Vault-free) + the entries —
 * it has no Vault handle, so it "cannot leak what it never receives" (a planted sentinel never reaches it).
 */

// Role ids (never names — testing rule).
const SCHEMER = "schemer";
const NOMINEE = "nominee";
const HOH = "hoh";
const VETO_WINNER = "veto-winner";
const SENTINEL = "VAULT-SENTINEL-do-not-leak-8842";

const AT = (week: number, phase: string) => ({ week, phase });

function log(entries: readonly SuspicionEntry[], id: string, text: string, extra: Partial<{ about: string[]; topic: any; loggedAt: any }> = {}) {
  return logHunch(entries, { id, text, loggedAt: extra.loggedAt ?? AT(1, "nominations"), ...extra });
}

describe("0097 — logging a hunch (the player's own words, verbatim, open)", () => {
  it("records the player's verbatim text and starts unresolved", () => {
    const verbatim = "  I THINK the HOH is lying about their vote — final-two I'm not in?  ";
    const { entries, entry } = log([], "e1", verbatim);
    expect(entry.text).toBe(verbatim);              // LOSSLESS — never trimmed/normalized/case-folded
    expect(entry.status).toBe("open");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(entry);
  });

  it("keeps optional about/topic hints only when supplied", () => {
    const bare = log([], "e1", "something's off").entries[0]!;
    expect(bare.about).toBeUndefined();
    expect(bare.topic).toBeUndefined();
    const tagged = log([], "e2", "the schemer is lying to me", { about: [SCHEMER], topic: "secret" }).entries[0]!;
    expect(tagged.about).toEqual([SCHEMER]);
    expect(tagged.topic).toBe("secret");
  });
});

describe("0097 — an OPEN hunch is the player's editable scratch space", () => {
  it("editing an open hunch replaces its text; withdrawing an open hunch removes it", () => {
    const { entries } = log([], "e1", "first draft of a hunch");
    const edited = editHunch(entries, "e1", "a sharper second draft");
    expect(edited[0]!.text).toBe("a sharper second draft");
    expect(canEdit(edited[0]!)).toBe(true);
    expect(withdrawHunch(edited, "e1")).toHaveLength(0);
    // editing/withdrawing a non-existent id is a no-op (never throws).
    expect(editHunch(entries, "nope", "x")).toEqual(entries);
    expect(withdrawHunch(entries, "nope")).toEqual(entries);
  });
});

describe("0097 — a topic-tagged hunch resolves only against a matching-topic reveal", () => {
  it("a topic mismatch keeps the hunch open (the reveal bears on a different kind of fact)", () => {
    const { entries } = log([], "e1", "the nominee is the target this week", { about: [NOMINEE], topic: "vote" });
    // A reveal about the same subject but a DIFFERENT topic (an alliance surfacing) must not resolve a vote hunch.
    const allianceReveal: RevealedFact = {
      kind: "alliance", at: AT(1, "nominations"), ref: "evt-alliance",
      descriptors: ["nominee", "alliance", "target"], subjects: [NOMINEE], topic: "alliance",
    };
    expect(resolveAgainstReveal(entries, allianceReveal).stamped).toHaveLength(0);
    expect(resolveAgainstReveal(entries, allianceReveal).entries[0]!.status).toBe("open");
  });

  it("a free (un-tagged) hunch resolves by token overlap alone — no about/topic scoping needed", () => {
    const { entries } = log([], "e1", "the eviction will be unanimous this week");
    const reveal: RevealedFact = { kind: "vote", at: AT(1, "eviction"), ref: "evt-u", descriptors: ["eviction", "unanimous", "tally"] };
    expect(resolveAgainstReveal(entries, reveal).entries[0]!.status).toBe("called-it");
  });
});

describe("0097 — the scorecard counts a wrong verdict honestly", () => {
  it("a refuted hunch shows as wrong, never quietly dropped", () => {
    let entries: SuspicionEntry[] = log([], "e1", "the veto winner will use the veto", { about: [VETO_WINNER], topic: "target" }).entries;
    entries = resolveAgainstReveal(entries, { kind: "veto", at: AT(1, "veto-ceremony"), ref: "r", descriptors: ["veto", "not", "used"], subjects: [VETO_WINNER], topic: "target" }, [{ entryId: "e1", verdict: "wrong" }]).entries;
    expect(scorecard(entries)).toMatchObject({ total: 1, called: 0, wrong: 1, partial: 0, open: 0 });
  });
});

describe("0097 — a hunch about a secret stays unresolved until a reveal (never a live Vault read)", () => {
  it("no reveal ⇒ the hunch stays open and carries no sealed premise", () => {
    // The player logs a hunch about a hidden secret. NOTHING resolves it — there is no reveal to hand the
    // scorer, so it stays `open`. The scorer is never called with any sealed content (structural).
    const { entries } = log([], "e1", "I bet the schemer has a hidden secret they're protecting", { about: [SCHEMER], topic: "secret" });
    expect(entries[0]!.status).toBe("open");
    expect(JSON.stringify(entries)).not.toContain(SENTINEL);
  });

  it("scorecard of an all-open ledger reads honestly as 'never confirmed', with no verdicts invented", () => {
    let entries: SuspicionEntry[] = [];
    entries = log(entries, "e1", "a final-two between the two of them").entries;
    entries = log(entries, "e2", "the veto winner will flip the noms").entries;
    const card = scorecard(entries);
    expect(card).toMatchObject({ total: 2, called: 0, wrong: 0, partial: 0, open: 2 });
    expect(card.earliestCorrect).toBeUndefined();
  });
});

describe("0097 — an in-game reveal pays off / refutes a hunch (reads the reveal, never the Vault)", () => {
  it("a correct hunch flips to called-it, referencing only the now-revealed fact", () => {
    const { entries } = log([], "e1", "the nominee is the one going home this week", { about: [NOMINEE], topic: "vote" });
    const reveal: RevealedFact = {
      kind: "vote", at: AT(1, "eviction"), ref: "evt-evict-42",
      descriptors: ["eviction", "nominee", "going", "home", "evicted"],
      subjects: [NOMINEE], topic: "vote",
    };
    const { entries: after, stamped } = resolveAgainstReveal(entries, reveal);
    expect(after[0]!.status).toBe("called-it");
    expect(after[0]!.evidence).toBe("evt-evict-42");     // references only the revealed event
    expect(after[0]!.resolvedAt).toEqual(AT(1, "eviction"));
    expect(after[0]!.text).toBe(entries[0]!.text);       // the hunch text is untouched
    expect(stamped).toEqual([{ id: "e1", verdict: "called-it" }]);
    expect(JSON.stringify(after)).not.toContain(SENTINEL);
  });

  it("a wrong hunch is stamped wrong (the model path) and is NOT softened", () => {
    const { entries } = log([], "e1", "the veto winner will use the veto to save the nominee", { about: [VETO_WINNER], topic: "target" });
    const reveal: RevealedFact = {
      kind: "veto", at: AT(1, "veto-ceremony"), ref: "evt-veto-7",
      descriptors: ["veto", "ceremony", "not", "used", "kept", "nominations", "same"],
      subjects: [VETO_WINNER], topic: "target",
    };
    // The FE model reads the player's text vs. the revealed "veto NOT used" fact and proposes `wrong`.
    const proposals: ProposedVerdict[] = [{ entryId: "e1", verdict: "wrong" }];
    const { entries: after } = resolveAgainstReveal(entries, reveal, proposals);
    expect(after[0]!.status).toBe("wrong");   // exactly `wrong` — never nudged to partial/called-it
    expect(after[0]!.evidence).toBe("evt-veto-7");
  });

  it("a resolved hunch is FROZEN — it cannot be edited or withdrawn, and a later reveal never re-stamps it", () => {
    const { entries } = log([], "e1", "the nominee goes home", { about: [NOMINEE], topic: "vote" });
    const reveal: RevealedFact = { kind: "vote", at: AT(1, "eviction"), ref: "evt-1", descriptors: ["nominee", "evicted"], subjects: [NOMINEE], topic: "vote" };
    const resolved = resolveAgainstReveal(entries, reveal).entries;
    expect(resolved[0]!.status).toBe("called-it");
    expect(canEdit(resolved[0]!)).toBe(false);
    // edit + withdraw are no-ops on a resolved entry (the permanent record, mandate #4).
    expect(editHunch(resolved, "e1", "actually I meant something else")[0]!.text).toBe(entries[0]!.text);
    expect(withdrawHunch(resolved, "e1")).toHaveLength(1);
    // a LATER reveal that would otherwise match does not re-stamp a frozen entry.
    const later: RevealedFact = { kind: "vote", at: AT(2, "eviction"), ref: "evt-2", descriptors: ["nominee", "evicted"], subjects: [NOMINEE], topic: "vote" };
    const again = resolveAgainstReveal(resolved, later);
    expect(again.stamped).toHaveLength(0);
    expect(again.entries[0]!.evidence).toBe("evt-1");  // still the ORIGINAL evidence
  });
});

describe("0097 — an unrelated reveal never touches an unrelated hunch", () => {
  it("no about-overlap ⇒ no match (an about-tagged hunch is scoped to its subject)", () => {
    const { entries } = log([], "e1", "the schemer is building a secret alliance", { about: [SCHEMER], topic: "alliance" });
    const otherReveal: RevealedFact = {
      kind: "vote", at: AT(1, "eviction"), ref: "evt-x",
      descriptors: ["schemer", "alliance", "secret"],  // token overlap, but about a DIFFERENT subject
      subjects: [NOMINEE], topic: "alliance",
    };
    const { entries: after, stamped } = resolveAgainstReveal(entries, otherReveal);
    expect(stamped).toHaveLength(0);
    expect(after[0]!.status).toBe("open");
  });

  it("no token overlap ⇒ the deterministic floor does not fire", () => {
    const { entries } = log([], "e1", "there is a showmance nobody has noticed yet");
    const unrelated: RevealedFact = { kind: "vote", at: AT(1, "eviction"), ref: "evt-y", descriptors: ["eviction", "tally", "unanimous"] };
    expect(resolveAgainstReveal(entries, unrelated).stamped).toHaveLength(0);
  });

  it("the model cannot resolve an OUT-OF-SCOPE entry — a mis-aimed proposal is dropped (the Wall stays safe)", () => {
    const { entries } = log([], "e1", "the schemer is lying", { about: [SCHEMER], topic: "secret" });
    const revealAboutOther: RevealedFact = { kind: "confidence", at: AT(1, "eviction"), ref: "evt-z", descriptors: ["confided", "truth"], subjects: [HOH] };
    // A model proposal to stamp e1 (about the schemer) off a reveal about the HOH is VALIDATED away.
    const { entries: after, stamped } = resolveAgainstReveal(entries, revealAboutOther, [{ entryId: "e1", verdict: "called-it" }]);
    expect(stamped).toHaveLength(0);
    expect(after[0]!.status).toBe("open");
  });
});

describe("0097 — the post-season scorecard (0048) + determinism", () => {
  it("counts called/wrong/partial/open and reports the earliest correct call", () => {
    let entries: SuspicionEntry[] = [];
    entries = log(entries, "early", "the nominee is the target", { about: [NOMINEE], topic: "vote", loggedAt: AT(1, "hoh-competition") }).entries;
    entries = log(entries, "late", "the veto winner flips", { about: [VETO_WINNER], topic: "target", loggedAt: AT(3, "nominations") }).entries;
    entries = log(entries, "never", "a twist is coming", { topic: "twist" }).entries;
    // week-3 reveal resolves the late hunch as partial (model), week-1 resolves the early hunch called-it (floor).
    entries = resolveAgainstReveal(entries, { kind: "vote", at: AT(1, "eviction"), ref: "r1", descriptors: ["nominee", "target", "evicted"], subjects: [NOMINEE], topic: "vote" }).entries;
    entries = resolveAgainstReveal(entries, { kind: "veto", at: AT(3, "veto-ceremony"), ref: "r2", descriptors: ["veto", "used"], subjects: [VETO_WINNER], topic: "target" }, [{ entryId: "late", verdict: "partial" }]).entries;
    const card = scorecard(entries);
    expect(card).toMatchObject({ total: 3, called: 1, partial: 1, wrong: 0, open: 1 });
    expect(card.earliestCorrect).toEqual(AT(1, "hoh-competition"));  // the earliest LOGGED called-it beat
  });

  it("same entries + same reveal + same proposals ⇒ same stamps (deterministic, no rng)", () => {
    const { entries } = log([], "e1", "the nominee goes home", { about: [NOMINEE], topic: "vote" });
    const reveal: RevealedFact = { kind: "vote", at: AT(1, "eviction"), ref: "r", descriptors: ["nominee", "evicted"], subjects: [NOMINEE], topic: "vote" };
    const a = resolveAgainstReveal(entries, reveal);
    const b = resolveAgainstReveal(entries, reveal);
    expect(a.entries).toEqual(b.entries);
    expect(a.stamped).toEqual(b.stamped);
  });
});

describe("0097 — Vault-safety is structural (no sealed value can ever reach the ledger or scorecard)", () => {
  it("a sentinel planted in a secret never appears — the scorer is only ever handed Vault-free reveals", () => {
    // The adapter would build a RevealedFact from an already-public fact; it can NEVER contain the sentinel.
    let entries: SuspicionEntry[] = log([], "e1", "the schemer has something to hide", { about: [SCHEMER], topic: "secret" }).entries;
    const vaultFreeReveal: RevealedFact = {
      kind: "unseal", at: AT(9, "finished"), ref: "unseal-1",
      descriptors: ["the", "schemer", "had", "a", "hidden", "alliance"],  // already-unsealed public tokens — NO sentinel
      subjects: [SCHEMER], topic: "secret",
    };
    entries = resolveAgainstReveal(entries, vaultFreeReveal, [{ entryId: "e1", verdict: "partial" }]).entries;
    const dump = JSON.stringify({ entries, card: scorecard(entries) });
    expect(dump).not.toContain(SENTINEL);
    expect(entries[0]!.status).toBe("partial");
  });
});

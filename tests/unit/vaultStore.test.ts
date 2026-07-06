import { describe, it, expect } from "vitest";
import { InMemoryVaultStore } from "../../src/adapters/inmemory/InMemoryVaultStore";
import { npc } from "../../src/domain/ids";

// The engine-only Vault store: write hidden records, read them back with optional
// kind/subject filters. (Roles only; content is opaque here.)
describe("InMemoryVaultStore — write + filtered read", () => {
  function seeded(): InMemoryVaultStore {
    const v = new InMemoryVaultStore();
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x", subject: npc(1) });
    v.writeHidden({ id: "b", kind: "hidden-attribute", content: "y", subject: npc(2) });
    v.writeHidden({ id: "c", kind: "confessional", content: "z", subject: npc(1) });
    v.writeHidden({ id: "d", kind: "reserved-twist", content: "w" });
    return v;
  }

  it("no filter returns everything written", () => {
    expect(seeded().readHidden()).toHaveLength(4);
  });

  it("filters by kind", () => {
    const r = seeded().readHidden({ kind: "hidden-attribute" });
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("filters by subject", () => {
    const r = seeded().readHidden({ subject: npc(1) });
    expect(r.map((x) => x.id).sort()).toEqual(["a", "c"]);
  });

  it("filters by kind AND subject together", () => {
    const r = seeded().readHidden({ kind: "confessional", subject: npc(1) });
    expect(r.map((x) => x.id)).toEqual(["c"]);
  });

  it("returns empty for a subject with no records", () => {
    expect(seeded().readHidden({ subject: npc(99) })).toEqual([]);
  });
});

// PERSIST-12: writeHidden() under a re-used id must never silently accumulate duplicates — an
// identical re-seal is a no-op, and a genuinely evolved re-seal upserts in place. Non-degradation
// (the current truth for an id is always present) without a growing pile of stale duplicates.
describe("InMemoryVaultStore — writeHidden duplicate-id guard (PERSIST-12)", () => {
  it("an IDENTICAL re-seal of the same id is an idempotent no-op (no duplicate record)", () => {
    const v = new InMemoryVaultStore();
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x", subject: npc(1) });
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x", subject: npc(1) });
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x", subject: npc(1) });
    expect(v.readHidden()).toHaveLength(1);
  });

  it("a re-seal of the SAME id with DIFFERENT content upserts in place — never a second record", () => {
    const v = new InMemoryVaultStore();
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "closeted", subject: npc(1) });
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "out", subject: npc(1) });
    const records = v.readHidden();
    expect(records).toHaveLength(1); // no duplicate — the store never holds two records under one id
    expect(records[0]!.content).toBe("out"); // the current truth wins, nothing silently lost
  });

  it("distinct ids never collide — an unrelated record is untouched by another id's re-seal", () => {
    const v = new InMemoryVaultStore();
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x", subject: npc(1) });
    v.writeHidden({ id: "b", kind: "hidden-attribute", content: "y", subject: npc(2) });
    v.writeHidden({ id: "a", kind: "hidden-attribute", content: "x2", subject: npc(1) });
    const r = v.readHidden();
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.id === "b")!.content).toBe("y");
    expect(r.find((x) => x.id === "a")!.content).toBe("x2");
  });
});

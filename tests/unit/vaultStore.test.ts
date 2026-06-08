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

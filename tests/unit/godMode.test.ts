import { describe, it, expect } from "vitest";
import { InMemoryGameStateRepository } from "../../src/adapters/inmemory/InMemoryGameStateRepository";
import { AdminPort } from "../../src/surfaces/admin/AdminPort";
import { ADMIN_TOOLS } from "../../src/surfaces/tools/registry";

function admin(): AdminPort {
  return new AdminPort(new InMemoryGameStateRepository({
    week: 1, phase: "nominations",
    houseguests: [{ role: "HOH", status: "active" }, { role: "nominee", status: "active" }],
  }));
}

describe("0016 — God Mode (admin) over non-Vault state", () => {
  it("inspect returns week/phase/roster/config", () => {
    const v = admin().inspect();
    expect(v.week).toBe(1);
    expect(v.phase).toBe("nominations");
    expect(Array.isArray(v.houseguests)).toBe(true);
    expect("config" in v).toBe(true);
  });

  it("override mutates non-Vault state and is reflected on inspect", () => {
    const a = admin();
    a.overrideMechanic({ mechanic: "phase", value: "veto-ceremony" });
    expect(a.inspect().phase).toBe("veto-ceremony");
  });

  it("configure stores tunables (reserve-twist COUNT, not content)", () => {
    const a = admin();
    const v = a.configure({ reserveTwists: 2, temperature: 0.4 });
    expect((v.config as Record<string, unknown>).reserveTwists).toBe(2);
    expect((v.config as Record<string, unknown>).temperature).toBe(0.4);
  });

  it("manageSandbox reset restores the initial state", () => {
    const a = admin();
    a.overrideMechanic({ mechanic: "phase", value: "eviction" });
    a.manageSandbox("reset");
    expect(a.inspect().phase).toBe("nominations");
  });

  it("sandboxes are isolated — acting on one leaves another unchanged", () => {
    const a = admin();
    const b = admin();
    a.overrideMechanic({ mechanic: "phase", value: "eviction" });
    a.configure({ reserveTwists: 3 });
    expect(b.inspect().phase).toBe("nominations");
    expect((b.inspect().config as Record<string, unknown>).reserveTwists).toBeUndefined();
  });

  it("the admin allowlist has NO Vault reader (every entry readsVault:false; no reveal/twist tool)", () => {
    for (const t of ADMIN_TOOLS) expect(t.readsVault).toBe(false);
    expect(ADMIN_TOOLS.some((t) => /reveal|hidden|secret|twist|confessional/i.test(t.name))).toBe(false);
  });
});

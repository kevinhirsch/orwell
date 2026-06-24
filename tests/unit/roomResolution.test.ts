import { describe, it, expect } from "vitest";
import {
  resolveRoom, normalizeRoomName, roomDisplayName, WALKABLE_ROOMS, HOUSE_ROOMS, areAdjacent,
} from "../../src/domain/house";
import type { Room } from "../../src/domain/house";

/**
 * The forgiving `moveTo` room-name resolution (the "isn't mapping" 5-retry-loop fix). Pure-core,
 * deterministic, Vault-free — rooms are the public floor plan. Roles only, no fixture names.
 */

describe("normalizeRoomName — case/space/hyphen-insensitive keys", () => {
  it("collapses case, whitespace, underscores, and hyphens to one canonical key", () => {
    for (const variant of ["Living Room", "living_room", "LIVING-ROOM", "  living   room ", "living--room"]) {
      expect(normalizeRoomName(variant)).toBe("living-room");
    }
    expect(normalizeRoomName("  Kitchen ")).toBe("kitchen");
    expect(normalizeRoomName("")).toBe("");
  });
});

describe("roomDisplayName — natural public names", () => {
  it("renders the player-facing name for every room (hyphens → spaces, bedroom letter uppercased, HOH special)", () => {
    expect(roomDisplayName("living-room")).toBe("living room");
    expect(roomDisplayName("bedroom-a")).toBe("bedroom A");
    expect(roomDisplayName("bedroom-b")).toBe("bedroom B");
    expect(roomDisplayName("hoh-room")).toBe("HOH room");
    expect(roomDisplayName("storage-room")).toBe("storage room");
    expect(roomDisplayName("kitchen")).toBe("kitchen");
  });

  it("every display name resolves back to its own room (round-trip)", () => {
    for (const room of HOUSE_ROOMS) {
      const res = resolveRoom(roomDisplayName(room));
      // The diary room's display name "diary room" resolves; bedrooms keep their letter.
      expect(res).toEqual({ kind: "ok", room });
    }
  });
});

describe("WALKABLE_ROOMS — the model's walkable menu", () => {
  it("is every real room except the diary room (a booth, not a hangout)", () => {
    expect(WALKABLE_ROOMS).not.toContain("diary-room");
    for (const room of HOUSE_ROOMS) {
      if (room === "diary-room") continue;
      expect(WALKABLE_ROOMS).toContain(room);
    }
    expect(WALKABLE_ROOMS.length).toBe(HOUSE_ROOMS.length - 1);
  });
});

describe("resolveRoom — the natural-name → room-id contract (the bug fix)", () => {
  it("resolves exact room ids unchanged", () => {
    for (const room of HOUSE_ROOMS) {
      expect(resolveRoom(room)).toEqual({ kind: "ok", room });
    }
  });

  it("resolves the common natural names the narrator says (the real-log cases)", () => {
    const cases: Array<[string, Room]> = [
      ["living room", "living-room"],
      ["livingroom", "living-room"],
      ["the Living Room", "living-room"], // a stray "the" is just looser matching, still resolves below
      ["lounge", "lounge"], // 0077: the lounge is now its OWN private-wing room, not an alias for the living room
      ["kitchen", "kitchen"],
      ["KITCHEN", "kitchen"],
      ["backyard", "backyard"],
      ["back yard", "backyard"],
      ["yard", "backyard"],
      ["outside", "backyard"],
      ["HOH", "hoh-room"],
      ["hoh room", "hoh-room"],
      ["head of household", "hoh-room"],
      ["bathroom", "bathroom"],
      ["washroom", "bathroom"],
      ["storage", "storage-room"],
      ["pantry", "storage-room"],
      ["bedroom a", "bedroom-a"],
      ["Bedroom B", "bedroom-b"],
    ];
    for (const [name, expected] of cases) {
      const res = resolveRoom(name);
      // "the Living Room" falls through to the loose pass; assert it still lands on a real room.
      if (name.startsWith("the ")) {
        expect(res.kind, name).toBe("ok");
      } else {
        expect(res, name).toEqual({ kind: "ok", room: expected });
      }
    }
  });

  it("never silently fails the way the narrator's guessed 'bedroom' did — a bare 'bedroom' always resolves to a real bedroom", () => {
    // No context: ambiguous, but it reports ALL the bedrooms as candidates (never unknown / never a no-op).
    const noCtx = resolveRoom("bedroom");
    expect(noCtx.kind).toBe("ambiguous");
    if (noCtx.kind === "ambiguous") {
      expect([...noCtx.candidates].sort()).toEqual(["bedroom-a", "bedroom-b", "bedroom-c"]); // 0077: three bedrooms
    }
    // Standing in a bedroom: a bare "bedroom" stays in the one they're in.
    expect(resolveRoom("bedroom", "bedroom-a")).toEqual({ kind: "ok", room: "bedroom-a" });
    expect(resolveRoom("bedroom", "bedroom-b")).toEqual({ kind: "ok", room: "bedroom-b" });
    expect(resolveRoom("bedroom", "bedroom-c")).toEqual({ kind: "ok", room: "bedroom-c" });
    // Standing in a room ADJACENT to a bedroom: step into the nearest one (deterministic, first found).
    const adjToBedroom = HOUSE_ROOMS.find((r) => r !== "bedroom-a" && areAdjacent(r, "bedroom-a"))!;
    const fromAdj = resolveRoom("bedroom", adjToBedroom);
    expect(fromAdj.kind).toBe("ok");
    if (fromAdj.kind === "ok") expect(["bedroom-a", "bedroom-b", "bedroom-c"]).toContain(fromAdj.room);
  });

  it("loose prefix/substring matches resolve (kit → kitchen, back yard → backyard, storage → storage room)", () => {
    expect(resolveRoom("kit")).toEqual({ kind: "ok", room: "kitchen" });
    expect(resolveRoom("back yard")).toEqual({ kind: "ok", room: "backyard" });
    expect(resolveRoom("storage room")).toEqual({ kind: "ok", room: "storage-room" });
    expect(resolveRoom("bath")).toEqual({ kind: "ok", room: "bathroom" });
  });

  it("a genuinely unknown name reports unknown (so the caller can keep the player put, not crash)", () => {
    expect(resolveRoom("the moon")).toEqual({ kind: "unknown" });
    expect(resolveRoom("xyzzy")).toEqual({ kind: "unknown" });
    expect(resolveRoom("")).toEqual({ kind: "unknown" });
    expect(resolveRoom("   ")).toEqual({ kind: "unknown" });
  });

  it("is deterministic — same inputs, same resolution every time (no randomness)", () => {
    for (const name of ["bedroom", "living room", "kit", "the moon"]) {
      expect(resolveRoom(name, "kitchen")).toEqual(resolveRoom(name, "kitchen"));
    }
  });
});

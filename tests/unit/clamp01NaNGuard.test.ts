import { describe, it, expect } from "vitest";
import { clamp01 } from "../../src/engine/relationshipConstants";
import { RelationshipModel } from "../../src/engine/relationships";
import { evolveEmotion } from "../../src/engine/emotionalArc";
import type { Soul } from "../../src/engine/characterFactory";
import { campaignTilt, ownBallotLean, type Drive } from "../../src/engine/campaigns";
import { deriveTrajectory, type FoldSignal, type Trajectory } from "../../src/engine/trajectory";
import { emotionalModifier } from "../../src/domain/temperatureConstants";
import { InMemoryKnowledgeService } from "../../src/adapters/inmemory/InMemoryKnowledgeService";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { npc } from "../../src/domain/ids";

/**
 * PERSIST-2 / BE-101 — the systemic `clamp01` NaN-passthrough bug. Every `clamp01` written as
 * `Math.max(0, Math.min(1, x))` or the ternary `x < 0 ? 0 : x > 1 ? 1 : x` passes NaN straight
 * through (`Math.min(1, NaN)` is `NaN`; `NaN < 0` / `NaN > 1` are both false) — so a NaN produced
 * upstream (a divide-by-zero, an undefined signal) would clamp to NaN and get written into the
 * PERMANENT relationship/soul layer, corrupting non-degradation (I5) forever.
 *
 * These tests prove: (1) the bug existed (a bare `clamp01(NaN)` is NaN) is now fixed (returns a
 * safe 0), (2) every finite input still clamps EXACTLY as before, and (3) NaN-producing upstream
 * signals can no longer WRITE a NaN into a persisted relationship edge, soul field, campaign,
 * trajectory, or knowledge fact. HARD rule: roles only — no names.
 */

const A = npc(1);
const B = npc(2);

describe("PERSIST-2/BE-101 — clamp01 NaN guard", () => {
  describe("the canonical exported clamp01 (relationshipConstants.ts)", () => {
    it("clamp01(NaN) is a safe 0, never NaN", () => {
      expect(clamp01(NaN)).toBe(0);
      expect(Number.isNaN(clamp01(NaN))).toBe(false);
    });

    it("every finite input clamps EXACTLY as before — only the NaN path changed", () => {
      expect(clamp01(-1)).toBe(0);
      expect(clamp01(0)).toBe(0);
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(1)).toBe(1);
      expect(clamp01(2)).toBe(2 > 1 ? 1 : 2); // sanity: same as Math.max(0, Math.min(1, 2))
      expect(clamp01(2)).toBe(1);
      expect(clamp01(-0.3)).toBe(0);
      expect(clamp01(1.7)).toBe(1);
    });
  });

  describe("a NaN-producing upstream can no longer write NaN into a PERSISTED relationship edge", () => {
    it("applyImpactDirected with a NaN-valued impact leaves the edge finite, not NaN", () => {
      const rel = new RelationshipModel(0.6);
      // Simulate an upstream divide-by-zero / undefined signal producing a NaN delta (e.g. a
      // corrupted campaign/leverage magnitude) reaching the relationship fold directly.
      rel.applyImpactDirected(A, B, { trust: NaN, affinity: NaN, threat: NaN }, { next: () => 0.5 } as any);
      const e = rel.edge(A, B);
      expect(Number.isNaN(e.trust)).toBe(false);
      expect(Number.isNaN(e.affinity)).toBe(false);
      expect(Number.isNaN(e.threat)).toBe(false);
      // The persisted serialize() round-trip stays finite too (the actual save-store path).
      const snap = rel.serialize();
      for (const edge of snap.edges) {
        expect(Number.isNaN(edge.trust)).toBe(false);
        expect(Number.isNaN(edge.affinity)).toBe(false);
        expect(Number.isNaN(edge.threat)).toBe(false);
        expect(Number.isNaN(edge.alignment)).toBe(false);
        expect(Number.isNaN(edge.confidence)).toBe(false);
        expect(Number.isNaN(edge.reliability)).toBe(false);
      }
    });

    it("decay() over an edge never turns confidence into NaN even from a corrupted edge value", () => {
      const rel = new RelationshipModel(0.6);
      rel.applyImpactDirected(A, B, { trust: 0.1 }, { next: () => 0.5 } as any);
      // Force-corrupt the stored edge the way an old NaN-passthrough bug once could have.
      (rel.edge(A, B) as { confidence: number }).confidence = NaN;
      rel.decay(0.3);
      expect(Number.isNaN(rel.edge(A, B).confidence)).toBe(false);
    });
  });

  describe("the soul layer (emotionalArc.ts) — soul.emotionalState/volatility never persist NaN", () => {
    const corrupted = (): Soul => ({
      emotionalBaseline: 0.5,
      volatility: 0.4,
      emotionalState: NaN, // a corrupted upstream read
      emotionalHistory: [],
      memory: [],
    });

    it("evolveEmotion resolves a NaN emotionalState to a finite value, not NaN", () => {
      const s = corrupted();
      evolveEmotion(s, "calm");
      expect(Number.isNaN(s.emotionalState)).toBe(false);
      expect(s.emotionalState).toBeGreaterThanOrEqual(0);
      expect(s.emotionalState).toBeLessThanOrEqual(1);
      // emotionalHistory (the persisted arc, 0007/0030) never accumulates a NaN entry either.
      expect(Number.isNaN(s.emotionalHistory[0])).toBe(false);
    });

    it("a NaN volatility resolves finite too", () => {
      const s: Soul = { emotionalBaseline: 0.5, volatility: NaN, emotionalState: 0.5, emotionalHistory: [], memory: [] };
      evolveEmotion(s, "blindside");
      expect(Number.isNaN(s.volatility)).toBe(false);
    });
  });

  describe("the campaign/drive layer (campaigns.ts) — never folds NaN into a persisted Campaign/Drive", () => {
    it("campaignTilt with a NaN progress input returns a finite tilt, not NaN", () => {
      const tilt = campaignTilt(NaN, 0.5, 0.5, 0.5);
      expect(Number.isNaN(tilt)).toBe(false);
      expect(tilt).toBe(0); // NaN progress clamps to 0, zeroing the product — never NaN-poisons it
    });

    it("ownBallotLean with a NaN drive.intensity (a corrupted persisted Drive) returns a finite lean", () => {
      const drive: Drive = { owner: A, motivation: "target", target: B, intensity: NaN };
      const lean = ownBallotLean(drive, B);
      expect(Number.isNaN(lean)).toBe(false);
      expect(lean).toBe(0);
    });
  });

  describe("the trajectory layer (trajectory.ts) — a corrupted persisted momentum never perpetuates NaN", () => {
    it("deriveTrajectory resolves a NaN prior.momentum to a finite momentum, not NaN", () => {
      // A steady window (no real movement) plus a CORRUPTED prior momentum (as if an old NaN had
      // once been persisted) must decay to a safe, finite value — never keep re-persisting NaN.
      const folds: FoldSignal[] = [{ bondDelta: 0, threatDelta: 0, betrayal: false }];
      const prior: Trajectory = { phase: "steady", momentum: NaN };
      const next = deriveTrajectory(folds, prior);
      expect(Number.isNaN(next.momentum)).toBe(false);
      expect(next.momentum).toBe(0);
    });
  });

  describe("the domain emotional-modifier formula (temperatureConstants.ts) — the ONE soul-swing formula", () => {
    it("emotionalModifier resolves a NaN current-state input to a finite result, not NaN", () => {
      const out = emotionalModifier(NaN, 0, 0);
      expect(Number.isNaN(out)).toBe(false);
    });
  });

  describe("the knowledge layer (InMemoryKnowledgeService) — a fact's confidence never persists as NaN", () => {
    function service(): InMemoryKnowledgeService {
      return new InMemoryKnowledgeService(new InMemoryEventStore());
    }

    it("addSuspicion with a NaN confidence stores a finite (capped) confidence, not NaN", () => {
      const svc = service();
      const s = svc.addSuspicion(A, { content: "a hunch", confidence: NaN });
      expect(Number.isNaN(s.confidence)).toBe(false);
      expect(s.confidence).toBe(0);
    });

    it("seedBelief with a NaN confidence persists a finite confidence, not NaN — and survives serialize/load", () => {
      const svc = service();
      svc.seedBelief(A, { content: "a claim", factId: "f1", confidence: NaN }, "seed");
      const before = svc.knownTo(A)[0]!;
      expect(Number.isNaN(before.confidence)).toBe(false);
      expect(before.confidence).toBe(0);

      // The actual persistence round-trip (0007/0030 non-degradation): serialize → load must never
      // resurrect or reintroduce a NaN.
      const snap = svc.serialize();
      const restored = service();
      restored.load(snap);
      const after = restored.knownTo(A)[0]!;
      expect(Number.isNaN(after.confidence)).toBe(false);
      expect(after.confidence).toBe(0);
    });
  });
});

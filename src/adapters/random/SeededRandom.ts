import type { RandomnessSource } from "../../ports/RandomnessSource";

/** Deterministic mulberry32-based PRNG. Pure: same seed → same stream. */
export class SeededRandom implements RandomnessSource {
  private state: number;

  constructor(seed: number) {
    // Mix so small seeds (1, 2, 3) still yield well-distributed streams.
    this.state = (seed ^ 0x9e3779b9) >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot pick from an empty array");
    return items[this.int(items.length)]!;
  }

  fork(label: string): RandomnessSource {
    let h = this.state >>> 0;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new SeededRandom(h);
  }
}

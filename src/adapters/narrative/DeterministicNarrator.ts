import type { StreamingNarrativePort } from "../../ports/StreamingNarrativePort";
import type { NarrationContext } from "../../ports/NarrativePort";

/**
 * A deterministic, offline narrator for tests + headless/CLI. Like the sync
 * `EchoNarrativePort`, it voices ONLY the Vault-free context it is handed — it has
 * no other input, so it cannot leak Vault data and cannot invent an outcome. It
 * streams the SAME text it would return whole, so `narrateStream` concatenated
 * exactly equals `narrate` (the spec's streaming==full guarantee, 0027 §7).
 */
export class DeterministicNarrator implements StreamingNarrativePort {
  /** Token chunk size for the simulated stream — any value preserves concat==full. */
  constructor(private readonly chunk = 5) {}

  async narrate(context: NarrationContext): Promise<string> {
    return renderDeterministic(context);
  }

  async *narrateStream(context: NarrationContext): AsyncIterable<string> {
    const full = renderDeterministic(context);
    // Fixed-size slices: their concatenation is byte-identical to `full`.
    for (let i = 0; i < full.length; i += this.chunk) {
      yield full.slice(i, i + this.chunk);
    }
  }
}

/** Stable narration derived ONLY from the Vault-free context (never from any store). */
export function renderDeterministic(context: NarrationContext): string {
  const persona = context.systemPrompt ? `${context.systemPrompt.trim()}\n` : "";
  const beats = context.visibleEvents.map((e) => `• ${e.content}`).join(" ");
  const known = context.knowledge.map((k) => `(${k.pathway}) ${k.content}`).join(" ");
  const body = [beats, known].filter(Boolean).join(" | ");
  return `${persona}[${context.mode}] ${body}`.trim();
}

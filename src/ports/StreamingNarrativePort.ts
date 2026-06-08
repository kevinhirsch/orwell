import type { NarrationContext } from "./NarrativePort";

/**
 * The real narrator's contract (feature 0027): an ASYNC, STREAMING `NarrativePort`.
 *
 * It is the single place an LLM touches the game, and it sits behind this port so
 * the core stays pure and the Vault Wall holds **by construction**: the ONLY input
 * is the Vault-free `NarrationContext` (assembled from the visible projection + the
 * managed moment prompt, 0018), so nothing Vault-side is ever in scope to leak.
 *
 * It **voices, it never decides.** Outcomes are settled by the engine
 * (0006/0011/0014) and handed in as already-fixed context; the port returns
 * *text*, never state — so a hallucinated "result" in the prose changes nothing.
 *
 * The synchronous, in-process `NarrativePort` (the projection renderer the player
 * surface uses) is a separate concern; this is the streaming realization the
 * front-end (over MCP, the fold) and headless/CLI/test paths use.
 */
export interface StreamingNarrativePort {
  /** Full narration for the (Vault-free) context. */
  narrate(context: NarrationContext): Promise<string>;
  /** Token-by-token narration for a live UI; the concatenation equals `narrate`. */
  narrateStream(context: NarrationContext): AsyncIterable<string>;
}

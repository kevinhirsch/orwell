import type { NarrativePort, NarrationContext } from "../../ports/NarrativePort";

/**
 * A deliberately MAXIMAL-LEAK narrator: it serialises its entire input context
 * into the output. If the context ever contained Vault data, this would expose
 * it — so passing the Vault-Wall suite with this adapter proves the guarantee
 * holds by construction (the context is Vault-free), not by narrator discretion.
 * The real LLM adapter (feature M5) slots in behind the same `NarrativePort`.
 */
export class EchoNarrativePort implements NarrativePort {
  narrate(context: NarrationContext): string {
    return `NARRATION(${context.mode}) :: ${JSON.stringify(context)}`;
  }
}

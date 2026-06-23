/**
 * Handles direct player interrogation ("is X true?", "is X in the Vault?").
 * It has no Vault handle, so it cannot confirm or deny specific Vault content —
 * it returns a fixed non-committal response (legacy Bible Vault-Wall rule).
 */
export class InterrogationHandler {
  static readonly NONCOMMITTAL =
    "I can't confirm or deny that. You'll find that out through gameplay.";

  ask(_question: string): string {
    return InterrogationHandler.NONCOMMITTAL;
  }
}

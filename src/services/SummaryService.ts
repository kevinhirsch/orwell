/**
 * End-of-session summary. It may confirm ONLY that updated saves exist — never a
 * change description, never Vault section names. A fixed string cannot leak.
 */
export class SummaryService {
  static readonly MESSAGE = "Updated save(s) are available.";

  endOfSession(): string {
    return SummaryService.MESSAGE;
  }
}

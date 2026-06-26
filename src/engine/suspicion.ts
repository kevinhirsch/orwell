/**
 * Feature 0105 — the Vault-safe SUSPICION a houseguest's DRIVE (0086) gives them.
 *
 * A drive's PLAN stays sealed — its intensity, its vote tilt, the whole campaign machinery never crosses
 * to the player. But the threat-READ that MOTIVATES the drive is the houseguest's OWN subjective hunch,
 * and a hunch is meant to surface as behavior (0086 ruling #2: drives surface subtly, through a wary tone,
 * never as data). `driveSuspicion` turns a threat-reading drive into a behavioral hunch string for
 * `npcVoice.suspects`, so the narrator finally has someone SPECIFIC the houseguest is wary of — anchoring
 * 0084's mood ("on edge" → on edge, and here's *who about*) and giving the empty `suspects` layer real
 * content in live play.
 *
 * Pure + deterministic. NEVER a number, NEVER the campaign/plan, NEVER a stated motive — just the wary
 * read, which an observer would infer from behavior anyway. Only THREAT-reading drives produce one:
 * `target` (an offensive read — sizing a rival up) and `self-preserve` (a defensive read — watching their
 * back). `build`/`lay-low`/`win-power` carry no suspicion: warmth, lying low, and ambition are not a wary
 * read of a rival.
 */
import type { Drive } from "./campaigns";

/** The intensity at/above which the read reads as fixated rather than merely watchful (a hunch, not a number). */
const FIXATED = 0.6;

/**
 * The behavioral hunch a houseguest's drive gives them about its subject, or `null` when the drive carries
 * no wary read (no subject, or a non-threat motivation). The subject is pre-resolved to a NAME by the
 * caller — this stays a leaf module (no id→name lookup, no Vault handle).
 */
export function driveSuspicion(drive: Drive, subjectName: string | undefined): string | null {
  if (subjectName === undefined) return null;
  const fixated = drive.intensity >= FIXATED;
  switch (drive.motivation) {
    case "target":
      return fixated ? `has been quietly sizing up ${subjectName}` : `has been keeping a close eye on ${subjectName}`;
    case "self-preserve":
      return fixated ? `has been watching their back around ${subjectName}` : `has a wary feeling about ${subjectName}`;
    default:
      return null; // build / lay-low / win-power: no wary read of a rival
  }
}

/**
 * Clock port (feature 0031; real-time purge 2026-07-10, PO ruling). A monotonic
 * counter the orchestrator uses to stamp off-screen event ids / timestamps and to
 * gate one off-screen tick per player turn. It is NOT wall time: the game NEVER
 * reads the real-world clock and NEVER advances on real-world time — the house
 * lives only on the player's play-clock (the in-game time-of-day, 0066) and moves
 * only between the player's own turns. The old wall-clock `Scheduler` + background
 * watcher were deleted outright so no version can ever run the house in real time.
 */
export interface Clock {
  /** A monotonic, play-driven tick — never wall-clock time. */
  now(): number;
}

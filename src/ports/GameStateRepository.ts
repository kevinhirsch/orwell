/** Admin/God-Mode-visible state. NON-VAULT by construction. */
export interface PublicHouseguest {
  role: string;
  status: string;
}

export interface AdminVisibleState {
  week: number;
  phase: string;
  houseguests: PublicHouseguest[];
  [k: string]: unknown;
}

export interface GameStateRepository {
  getAdminVisibleState(): AdminVisibleState;
}

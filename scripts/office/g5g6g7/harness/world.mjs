// G8-19 (UNI-1414) world seed: users A, B, C, M; org X (W1, W2) owned by A;
// org Y (WY) owned by M, who also joins X/W1 by a test-only SQL insert.
// Contract: g8-contract.md §2-§3.

export const WORLD_FILE = "g8-19-world.json";
export const SQL_MEMBERSHIP_ENV = "G819_ALLOW_SQL_MEMBERSHIP";
export const SQL_MEMBERSHIP_REASON =
  "test seed only: ADR 0032 refuses a second active organization through every API, so M's org X membership is a raw SQL insert (the TestIsolationMatrix shape)";
export const SQL_MEMBERSHIP_BLOCKER =
  "G819_ALLOW_SQL_MEMBERSHIP is not 1: a second active organization cannot be made through the API (ADR 0032)";

/** STEP 1 stub: the signature is final (contract §3), the body lands with T1 STEP 2. */
export async function seedWorld(_opts) {
  throw new Error("seedWorld: not implemented yet (UNI-1414 T1 step 2)");
}

/** STEP 1 stub: the signature is final (contract §3). */
export function loadWorld(_runDir) {
  throw new Error("loadWorld: not implemented yet (UNI-1414 T1 step 2)");
}

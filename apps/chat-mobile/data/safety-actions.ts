// Blocking and unblocking a person (data/safety-api.ts) and what it does to
// the cache: the person's status and the room list, where a blocked DM
// disappears for the one who blocked. Screens reach it through
// data/mutations/safety.ts.
import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "./queries/chat-keys";
import { safetyApi } from "./safety-api";

/** Blocks or unblocks; rejects when the server did not say ok, so the caller can say it failed. */
export async function setBlocked(qc: Pick<QueryClient, "invalidateQueries">, wsId: string, userId: string, blocked: boolean): Promise<void> {
  const ok = blocked ? await safetyApi.block(wsId, userId) : await safetyApi.unblock(wsId, userId);
  await Promise.all([qc.invalidateQueries({ queryKey: chatKeys.blockStatus(wsId, userId) }), qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) })]);
  if (!ok) throw new Error(blocked ? "block refused" : "unblock refused");
}

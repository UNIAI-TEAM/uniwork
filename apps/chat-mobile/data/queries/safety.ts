// Block status for the DM's info and banner and a member's menu
// (data/safety-api.ts). A block or an unblock refreshes the person's status
// and the room list, where a blocked DM disappears for the one who blocked.
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { safetyApi } from "../safety-api";
import { chatKeys } from "./chat-keys";

export const blockStatusOptions = (wsId: string, userId: string) =>
  queryOptions({
    queryKey: chatKeys.blockStatus(wsId, userId),
    queryFn: ({ signal }) => safetyApi.blockStatus(wsId, userId, signal),
    enabled: Boolean(wsId && userId),
    staleTime: 30_000,
  });

/** Blocks or unblocks; rejects when the server did not say ok, so the caller can say it failed. */
export async function setBlocked(qc: Pick<QueryClient, "invalidateQueries">, wsId: string, userId: string, blocked: boolean): Promise<void> {
  const ok = blocked ? await safetyApi.block(wsId, userId) : await safetyApi.unblock(wsId, userId);
  await Promise.all([qc.invalidateQueries({ queryKey: chatKeys.blockStatus(wsId, userId) }), qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) })]);
  if (!ok) throw new Error(blocked ? "block refused" : "unblock refused");
}

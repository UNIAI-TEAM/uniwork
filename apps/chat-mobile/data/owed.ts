// What the phone owes the server for the signed-in person: the unsent
// messages (chat-send.ts), then the queued reads, reactions and votes
// (pending-ops.ts), in every workspace they were made in. The outbox is the
// account's, not the open screen's: a message queued in one workspace goes
// when the network comes back while another is open, or none is. The server's
// unichat_mobile_outbox_flush switch off stops this automatic re-send (a retry
// storm, a bad build hammering one route): what is queued stays queued, on the
// device, until the switch is back on; a send from the composer and its Retry
// still go.
//
// The background drain (data/outbox-drain/) asks two more things of it: whether the person still owes anything
// (owesServer) and a delivery that ends only when nothing is on the wire (deliverOwed), so the time borrowed from the
// OS is let go when the last send answered, not when the last one started.
import type { QueryClient } from "@tanstack/react-query";
import { chatSendDeps, flushAllQueuedSends, sendsSettled, type ChatSendDeps } from "./chat-send";
import { flushAllPendingOps, pendingOpsDeps, type PendingOpsDeps } from "./pending-ops";
import { readMobileFlag } from "./remote-config";
import { useChatSendStore } from "./stores/chat-send-store";
import { usePendingOpsStore } from "./stores/pending-ops-store";

export interface OwedDeps {
  sends: ChatSendDeps;
  ops: PendingOpsDeps;
}

const appDeps: OwedDeps = { sends: chatSendDeps, ops: pendingOpsDeps };

export function flushOwed(qc: QueryClient, userId: string, deps: OwedDeps = appDeps): Promise<void> {
  if (!readMobileFlag(qc, "unichat_mobile_outbox_flush")) return Promise.resolve();
  return Promise.all([flushAllQueuedSends(qc, userId, deps.sends), flushAllPendingOps(qc, userId, deps.ops)]).then(() => undefined);
}

/** flushOwed, then the sends already on the wire (which a flush of the queued ones does not wait for). */
export async function deliverOwed(qc: QueryClient, userId: string, deps: OwedDeps = appDeps): Promise<void> {
  await flushOwed(qc, userId, deps);
  await sendsSettled();
}

/**
 * Something of this person's still waits for the server: a message queued or on the wire, or a read, reaction,
 * vote, edit or delete. A message refused for good waits for the person, not the network, and does not count.
 */
export function owesServer(userId: string): boolean {
  return (
    useChatSendStore.getState().entries.some((entry) => entry.senderId === userId && entry.status !== "failed") ||
    usePendingOpsStore.getState().ops.some((op) => op.userId === userId)
  );
}

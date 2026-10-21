// What the phone owes the server for the signed-in person: the unsent
// messages (chat-send.ts), then the queued reads, reactions and votes
// (pending-ops.ts), in every workspace they were made in. The outbox is the
// account's, not the open screen's: a message queued in one workspace goes
// when the network comes back while another is open, or none is.
import type { QueryClient } from "@tanstack/react-query";
import { chatSendDeps, flushAllQueuedSends, type ChatSendDeps } from "./chat-send";
import { flushAllPendingOps, pendingOpsDeps, type PendingOpsDeps } from "./pending-ops";

export interface OwedDeps {
  sends: ChatSendDeps;
  ops: PendingOpsDeps;
}

const appDeps: OwedDeps = { sends: chatSendDeps, ops: pendingOpsDeps };

export function flushOwed(qc: QueryClient, userId: string, deps: OwedDeps = appDeps): Promise<void> {
  return Promise.all([flushAllQueuedSends(qc, userId, deps.sends), flushAllPendingOps(qc, userId, deps.ops)]).then(() => undefined);
}

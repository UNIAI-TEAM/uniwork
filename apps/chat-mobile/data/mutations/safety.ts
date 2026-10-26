// Blocking, unblocking and reporting. See command.ts for the layer's rule.
import { setBlocked } from "../safety-actions";
import type { ReportBody } from "@/lib/report";
import { safetyApi } from "../safety-api";
import { useCommand } from "./command";

/** Rejects when the server did not say ok; the status and the room list refresh either way. */
export const useBlockUser = (wsId: string) =>
  useCommand("chat.block_user", (qc, { userId, blocked }: { userId: string; blocked: boolean }) => setBlocked(qc, wsId, userId, blocked));

export const useReport = (wsId: string) => useCommand("chat.report", (_qc, body: ReportBody) => safetyApi.report(wsId, body));

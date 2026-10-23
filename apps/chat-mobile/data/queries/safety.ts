// Block status for the DM's info and banner and a member's menu
// (data/safety-api.ts); blocking itself is data/safety-actions.ts.
import { queryOptions } from "@tanstack/react-query";
import { safetyApi } from "../safety-api";
import { chatKeys } from "./chat-keys";

export const blockStatusOptions = (wsId: string, userId: string) =>
  queryOptions({
    queryKey: chatKeys.blockStatus(wsId, userId),
    queryFn: ({ signal }) => safetyApi.blockStatus(wsId, userId, signal),
    enabled: Boolean(wsId && userId),
    staleTime: 30_000,
  });

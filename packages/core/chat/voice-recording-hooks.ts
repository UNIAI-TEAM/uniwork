"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listChatVoiceRecordings } from "../api/endpoints/chat-voice";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";

function voiceRecordingsNeedPoll(
  rows: { status: string }[] | undefined,
): number | false {
  if (!rows?.some((row) => row.status === "PROCESSING" || row.status === "ACTIVE")) {
    return false;
  }
  return 5_000;
}

export function useChatVoiceRecordings(
  workspaceId: string,
  roomId: string,
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.voiceRecordings(workspaceId, roomId),
    queryFn: () => listChatVoiceRecordings(workspaceId, roomId),
    enabled: !!workspaceId && !!roomId && authReady && enabled,
    refetchInterval: (query) => voiceRecordingsNeedPoll(query.state.data),
  });
}

export function useInvalidateChatVoiceRecordings() {
  const qc = useQueryClient();
  return (wsId: string, roomId: string) => {
    void qc.invalidateQueries({ queryKey: chatKeys.voiceRecordings(wsId, roomId) });
  };
}

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { meetingKeys } from "../meetings/hooks";
import { useOptionalMeetingLobbyWS } from "./meeting-lobby-provider";

/** Refreshes in-room data for guest lobby sockets (no workspace membership). */
export function useMeetingLobbySync(meetingId: string, enabled = true) {
  const qc = useQueryClient();
  const lobby = useOptionalMeetingLobbyWS();

  useEffect(() => {
    if (!enabled || !meetingId || !lobby?.client) return;
    const invalidateIfMatch = (payload: unknown, key: readonly unknown[]) => {
      const p = payload as Record<string, string>;
      if (p.meeting_id === meetingId) {
        void qc.invalidateQueries({ queryKey: key });
      }
    };
    const offChat = lobby.client.on("chat.message", (payload) => {
      invalidateIfMatch(payload, meetingKeys.chat(meetingId));
    });
    const offParticipantInvited = lobby.client.on("participant.invited", (payload) => {
      invalidateIfMatch(payload, meetingKeys.participants(meetingId));
    });
    const offParticipantRemoved = lobby.client.on("participant.removed", (payload) => {
      invalidateIfMatch(payload, meetingKeys.participants(meetingId));
    });
    const offRecordingReady = lobby.client.on("recording.ready", (payload) => {
      invalidateIfMatch(payload, meetingKeys.recordings(meetingId));
    });
    return () => {
      offChat();
      offParticipantInvited();
      offParticipantRemoved();
      offRecordingReady();
    };
  }, [enabled, lobby?.client, meetingId, qc]);
}

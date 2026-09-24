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
    const client = lobby?.client;
    if (!enabled || !meetingId || !client) return;
    const invalidateIfMatch = (payload: unknown, key: readonly unknown[]) => {
      const p = payload as Record<string, string>;
      if (p.meeting_id === meetingId) {
        void qc.invalidateQueries({ queryKey: key });
      }
    };
    const offChat = client.on("chat.message", (payload) => {
      invalidateIfMatch(payload, meetingKeys.chat(meetingId));
    });
    const offParticipantInvited = client.on("participant.invited", (payload) => {
      invalidateIfMatch(payload, meetingKeys.participants(meetingId));
    });
    const offParticipantRemoved = client.on("participant.removed", (payload) => {
      invalidateIfMatch(payload, meetingKeys.participants(meetingId));
    });
    // started/stopped drive the REC badge for guests, who have no workspace socket.
    const offRecording = (["recording.started", "recording.stopped", "recording.ready"] as const).map((event) =>
      client.on(event, (payload) => {
        invalidateIfMatch(payload, meetingKeys.recordings(meetingId));
      }),
    );
    return () => {
      offChat();
      offParticipantInvited();
      offParticipantRemoved();
      for (const off of offRecording) off();
    };
  }, [enabled, lobby?.client, meetingId, qc]);
}

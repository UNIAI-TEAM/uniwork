"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { meetingKeys } from "../meetings/hooks";
import { MOTION_TALLY_INVALIDATE_MS, motionKeys } from "../meetings/motion-hooks";
import { createInvalidateScheduler } from "./invalidate-scheduler";
import { useOptionalMeetingLobbyWS } from "./meeting-lobby-provider";

const MOTION_EVENTS = [
  "motion.created",
  "motion.updated",
  "motion.deleted",
  "motion.opened",
  "motion.closed",
] as const;

/**
 * Refreshes in-room data for guest lobby sockets (no workspace membership).
 * Like the workspace socket's sync, nothing invalidates per event: a burst
 * (a chat flurry, a room voting at once) coalesces into one refetch per key.
 */
export function useMeetingLobbySync(meetingId: string, enabled = true) {
  const qc = useQueryClient();
  const lobby = useOptionalMeetingLobbyWS();

  useEffect(() => {
    const client = lobby?.client;
    if (!enabled || !meetingId || !client) return;
    const scheduler = createInvalidateScheduler(qc);
    // One ballot is one event; the tallies need to keep up with people, not rows.
    const tallyScheduler = createInvalidateScheduler(qc, MOTION_TALLY_INVALIDATE_MS);
    const onMeeting = (event: string, ...keys: (readonly unknown[])[]) =>
      client.on(event, (payload: unknown) => {
        const p = payload as Record<string, string> | null;
        if (p?.meeting_id !== meetingId) return;
        for (const key of keys) scheduler.schedule(key);
      });
    const offs = [
      onMeeting("chat.message", meetingKeys.chat(meetingId)),
      onMeeting("participant.invited", meetingKeys.participants(meetingId)),
      onMeeting("participant.removed", meetingKeys.participants(meetingId)),
      // Guests see the secretary/observer chips change without a workspace socket;
      // standing also decides who joins the next voting roll.
      onMeeting("participant.updated", meetingKeys.participants(meetingId), meetingKeys.motions(meetingId)),
      // started/stopped drive the REC badge for guests, who have no workspace socket.
      ...(["recording.started", "recording.stopped", "recording.ready"] as const).map((event) =>
        onMeeting(event, meetingKeys.recordings(meetingId)),
      ),
      // Guests vote too: their tab, badge and vote prompt follow these.
      ...MOTION_EVENTS.map((event) => onMeeting(event, meetingKeys.motions(meetingId))),
      // Someone else's ballot moves the tallies only, never the guest's own roll.
      client.on("motion.ballot_cast", (payload: unknown) => {
        const p = payload as Record<string, string> | null;
        if (p?.meeting_id === meetingId) tallyScheduler.schedule(motionKeys.list(meetingId));
      }),
    ];
    return () => {
      for (const off of offs) off();
      scheduler.dispose();
      tallyScheduler.dispose();
    };
  }, [enabled, lobby?.client, meetingId, qc]);
}

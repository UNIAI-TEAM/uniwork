"use client";

import { useMemo } from "react";
import { useParticipants } from "@uniwork/core/meetings";
import type { MeetingParticipant } from "@uniwork/core/types";

/** Outside the room nothing pushes presence to a guest, so the leave screens ask again this often. */
const PRESENCE_POLL_MS = 15_000;

/**
 * Who is in the room right now, seen from outside it: the participant list's
 * `in_room`, without the viewer (whose own session may take a moment to close).
 */
export function useRoomPresence(
  meetingId: string,
  opts: { enabled: boolean; selfParticipantId: string | null },
): { people: MeetingParticipant[]; all: MeetingParticipant[]; loading: boolean; refetch: () => Promise<MeetingParticipant[]> } {
  const { data, isLoading, refetch } = useParticipants(opts.enabled ? meetingId : "", { refetchInterval: PRESENCE_POLL_MS });
  const people = useMemo(
    () =>
      (data ?? []).filter((p) => p.in_room === true && p.status === "ACTIVE" && p.id !== opts.selfParticipantId),
    [data, opts.selfParticipantId],
  );
  return { people, all: data ?? [], loading: isLoading, refetch: () => refetch().then((r) => r.data ?? []) };
}

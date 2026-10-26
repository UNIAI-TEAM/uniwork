"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-dial-in";
import { meetingKeys } from "./hooks";

/** Under the detail key: meeting.updated / ended refetch the detail, and this with it. */
const dialInKey = (meetingId: string) => [...meetingKeys.detail(meetingId), "dial-in"] as const;

export function useMeetingDialIn(meetingId: string) {
  return useQuery({
    queryKey: dialInKey(meetingId),
    queryFn: () => api.getMeetingDialIn(meetingId),
    enabled: !!meetingId,
  });
}

/** Host or admin draw a new PIN; the answer is the new dial-in line. */
export function useRotateMeetingDialInPin(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rotateMeetingDialInPin(meetingId),
    onSuccess: (dialIn) => {
      // A drifted answer parses to "off" though the PIN did rotate: read the line again instead.
      if (dialIn.enabled) qc.setQueryData(dialInKey(meetingId), dialIn);
      else void qc.invalidateQueries({ queryKey: dialInKey(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

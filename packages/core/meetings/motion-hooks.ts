"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-motions";
import type { BallotChoice, MotionDraftInput } from "../types/meeting";
import { meetingKeys } from "./hooks";

export {
  canSubmitMotion,
  MOTION_DESCRIPTION_MAX_LENGTH,
  MOTION_TITLE_MAX_LENGTH,
  motionDenominator,
  motionsTabState,
  pendingBallot,
  requiredYes,
  tallyPercent,
} from "./motion-utils";

/** The meeting's voting list; guests read it too (X-Guest-Session via rawFetch). */
export function useMeetingMotions(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.motions(meetingId),
    queryFn: () => api.listMeetingMotions(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
}

/**
 * Every motion command refreshes the list and the timeline once the server
 * has answered. None is optimistic: the server decides the roll, the order and
 * whether a ballot counted (already_voted / not_on_roll), and a ballot cannot
 * be taken back.
 */
function useMotionMutation<V, R>(meetingId: string, fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.motions(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useCreateMotion(meetingId: string) {
  return useMotionMutation(meetingId, (body: MotionDraftInput) => api.createMeetingMotion(meetingId, body));
}

export function useUpdateMotion(meetingId: string) {
  return useMotionMutation(
    meetingId,
    ({ motionId, ...patch }: { motionId: string } & Partial<MotionDraftInput> & { position?: number }) =>
      api.updateMeetingMotion(meetingId, motionId, patch),
  );
}

export function useDeleteMotion(meetingId: string) {
  return useMotionMutation(meetingId, (motionId: string) => api.deleteMeetingMotion(meetingId, motionId));
}

export function useOpenMotion(meetingId: string) {
  return useMotionMutation(meetingId, (motionId: string) => api.openMeetingMotion(meetingId, motionId));
}

export function useCloseMotion(meetingId: string) {
  return useMotionMutation(meetingId, (motionId: string) => api.closeMeetingMotion(meetingId, motionId));
}

export function useCastBallot(meetingId: string) {
  return useMotionMutation(meetingId, (v: { motionId: string; choice: BallotChoice }) =>
    api.castMeetingBallot(meetingId, v.motionId, v.choice),
  );
}

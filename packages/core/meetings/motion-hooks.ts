"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import * as api from "../api/endpoints/meeting-motions";
import type { BallotChoice, MeetingMotion, MotionDraftInput } from "../types/meeting";
import { meetingKeys } from "./hooks";
import { withMyBallots } from "./motion-utils";

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

/**
 * Motion query keys. `list` and `myBallots` sit under meetingKeys.motions, so
 * every event and command that invalidates the meeting's motions refreshes
 * both; `motion.ballot_cast` changes only the tallies and targets `list`
 * alone. Voters of a closed motion never change, so they live outside that
 * prefix and are fetched once, when someone opens the result.
 */
export const motionKeys = {
  list: (meetingId: string) => [...meetingKeys.motions(meetingId), "list"] as const,
  myBallots: (meetingId: string) => [...meetingKeys.motions(meetingId), "mine"] as const,
  voters: (meetingId: string, motionId: string) => ["meeting-motion-voters", meetingId, motionId] as const,
};

/**
 * How often a burst of `motion.ballot_cast` may refetch the tallies: a room
 * voting at once sends one event per ballot, and the list only needs to keep
 * up with people, not with every row.
 */
export const MOTION_TALLY_INVALIDATE_MS = 1000;

/**
 * The meeting's voting list with the caller's own roll joined in as
 * `my_ballot`; guests read both too (X-Guest-Session via rawFetch). The list
 * is the same for everyone, the roll is per caller and changes only when a
 * motion opens or the caller votes.
 */
export function useMeetingMotions(meetingId: string, enabled = true) {
  const on = enabled && Boolean(meetingId);
  const { data: ballots } = useQuery({
    queryKey: motionKeys.myBallots(meetingId),
    queryFn: () => api.listMyMotionBallots(meetingId),
    enabled: on,
  });
  const select = useCallback((motions: MeetingMotion[]) => withMyBallots(motions, ballots), [ballots]);
  return useQuery({
    queryKey: motionKeys.list(meetingId),
    queryFn: () => api.listMeetingMotions(meetingId),
    enabled: on,
    select,
  });
}

/**
 * Who chose what on one closed public motion, loaded only while its result is
 * unfolded. A closed motion's ballots are final, so one fetch serves for good.
 */
export function useMotionVoters(meetingId: string, motionId: string, enabled: boolean) {
  return useQuery({
    queryKey: motionKeys.voters(meetingId, motionId),
    queryFn: () => api.getMotionVoters(meetingId, motionId),
    enabled: enabled && Boolean(meetingId) && Boolean(motionId),
    staleTime: Number.POSITIVE_INFINITY,
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

"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as meetings from "../api/endpoints/meetings";
import { taskKeys } from "../tasks/hooks";
import type { Meeting, MeetingChatMessage } from "../types/meeting";

export type {
  CreateMeetingBody,
  MeetingListFilters,
  MeetingToken,
  SummaryTaskItem,
  UpdateMeetingBody,
} from "../api/endpoints/meetings";
export { activityLabelKey, inviteLinkStatus, isJoinAdmitted } from "./status";
export type { InviteLinkUiStatus } from "./status";
export { canEnterScheduledMeeting, isPastScheduledEnd, msUntilScheduledEnd, SCHEDULE_WARN_1_MIN_MS, SCHEDULE_WARN_5_MIN_MS } from "./schedule";

const JOIN_REQUESTS_ROOT = ["meeting-join-requests"] as const;

export const meetingKeys = {
  list: (wsId: string) => ["meetings", wsId] as const,
  stats: (wsId: string) => ["meeting-stats", wsId] as const,
  detail: (meetingId: string) => ["meeting", meetingId] as const,
  notes: (meetingId: string) => ["notes", meetingId] as const,
  participants: (meetingId: string) => ["meeting-participants", meetingId] as const,
  invitations: (meetingId: string) => ["meeting-invitations", meetingId] as const,
  joinRequestsRoot: JOIN_REQUESTS_ROOT,
  joinRequests: (meetingId: string) => [...JOIN_REQUESTS_ROOT, meetingId] as const,
  inviteLinks: (meetingId: string) => ["meeting-invite-links", meetingId] as const,
  activity: (meetingId: string) => ["meeting-activity", meetingId] as const,
  capabilities: (wsId: string) => ["meeting-capabilities", wsId] as const,
  transcript: (meetingId: string) => ["meeting-transcript", meetingId] as const,
  chat: (meetingId: string) => ["meeting-chat", meetingId] as const,
  summary: (meetingId: string) => ["meeting-summary", meetingId] as const,
  recordings: (meetingId: string) => ["meeting-recordings", meetingId] as const,
};

export function splitMeetings(
  list: Meeting[],
  now: Date,
): { upcoming: Meeting[]; past: Meeting[] } {
  const isPast = (m: Meeting) =>
    m.status === "ENDED" || m.status === "CANCELED" || new Date(m.ends_at) < now;
  const upcoming = list
    .filter((m) => !isPast(m))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = list.filter(isPast).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

export function useMeetings(workspaceId: string, filters?: meetings.MeetingListFilters) {
  return useQuery({
    queryKey: filters ? [...meetingKeys.list(workspaceId), filters] : meetingKeys.list(workspaceId),
    queryFn: () => meetings.listMeetings(workspaceId, filters),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  });
}

export function useMeetingStatistics(workspaceId: string) {
  return useQuery({
    queryKey: meetingKeys.stats(workspaceId),
    queryFn: () => meetings.getMeetingStatistics(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useMeeting(meetingId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: meetingKeys.detail(meetingId),
    queryFn: () => meetings.getMeeting(meetingId),
    enabled: !!meetingId && (opts?.enabled ?? true),
  });
}

export function useCreateMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: meetings.CreateMeetingBody) => meetings.createMeeting(workspaceId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.stats(workspaceId) });
    },
  });
}

export function useUpdateMeeting(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: meetings.UpdateMeetingBody) => meetings.updateMeeting(meetingId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useDeleteMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.deleteMeeting(meetingId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.stats(workspaceId) });
    },
  });
}

export function useNotes(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.notes(meetingId),
    queryFn: () => meetings.listNotes(meetingId),
    enabled: !!meetingId,
  });
}

export function useAddNote(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => meetings.addNote(meetingId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.notes(meetingId) }),
  });
}

/** @deprecated Prefer {@link useJoinMeeting}. */
export function useMeetingToken() {
  return useMutation({
    mutationFn: (meetingId: string) => meetings.meetingToken(meetingId),
  });
}

export function useJoinMeeting() {
  return useMutation({
    mutationFn: (args: { meetingId: string } & meetings.JoinMeetingBody) =>
      meetings.joinMeeting(args.meetingId, {
        invite_link_id: args.invite_link_id,
        secret: args.secret,
        display_name: args.display_name,
      }),
  });
}

function invalidateMeeting(qc: ReturnType<typeof useQueryClient>, workspaceId: string, meetingId: string) {
  void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
  void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
  void qc.invalidateQueries({ queryKey: meetingKeys.stats(workspaceId) });
  void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
}

export function useStartMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.startMeeting(meetingId),
    onSuccess: (_d, meetingId) => invalidateMeeting(qc, workspaceId, meetingId),
  });
}

export function useEndMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.endMeeting(meetingId),
    onSuccess: (_d, meetingId) => invalidateMeeting(qc, workspaceId, meetingId),
  });
}

export function useParticipants(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.participants(meetingId),
    queryFn: () => meetings.listParticipants(meetingId),
    enabled: !!meetingId,
  });
}

export function useJoinRequests(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.joinRequests(meetingId),
    queryFn: () => meetings.listJoinRequests(meetingId),
    enabled: !!meetingId,
  });
}

export function useCreateJoinRequest(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { display_name?: string }) => meetings.createJoinRequest(meetingId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.joinRequests(meetingId) }),
  });
}

export function useApproveJoinRequest(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => meetings.approveJoinRequest(requestId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.joinRequests(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
    },
  });
}

export function useRejectJoinRequest(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { requestId: string; reason?: string }) =>
      meetings.rejectJoinRequest(args.requestId, args.reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.joinRequests(meetingId) }),
  });
}

export function useCancelJoinRequest(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => meetings.cancelJoinRequest(requestId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.joinRequests(meetingId) }),
  });
}

export function useCreateInstantMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => meetings.createInstantMeeting(workspaceId, title),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.stats(workspaceId) });
    },
  });
}

export function useInviteParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => meetings.inviteParticipant(meetingId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.invitations(meetingId) });
    },
  });
}

export function useRemoveParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) => meetings.removeParticipant(meetingId, participantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) }),
  });
}

export function useSetParticipantPublish(meetingId: string) {
  return useMutation({
    mutationFn: (args: { participantId: string; enabled: boolean }) =>
      meetings.setParticipantPublish(meetingId, args.participantId, args.enabled),
  });
}

export function useTransferHost(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (newHostUserId: string) => meetings.transferHost(meetingId, newHostUserId),
    onSuccess: () => invalidateMeeting(qc, workspaceId, meetingId),
  });
}

export function useInvitations(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.invitations(meetingId),
    queryFn: () => meetings.listInvitations(meetingId),
    enabled: !!meetingId,
  });
}

export function useRespondInvitation(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { invitationId: string; response: string }) =>
      meetings.respondInvitation(meetingId, args.invitationId, args.response),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.invitations(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
    },
  });
}

export function useInviteLinks(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.inviteLinks(meetingId),
    queryFn: () => meetings.listInviteLinks(meetingId),
    enabled: !!meetingId,
  });
}

export function useCreateInviteLink(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; access_mode: string; expires_at: string; max_uses?: number }) =>
      meetings.createInviteLink(meetingId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.inviteLinks(meetingId) }),
  });
}

export function useRevokeInviteLink(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => meetings.revokeInviteLink(meetingId, linkId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.inviteLinks(meetingId) }),
  });
}

export function useMeetingActivity(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.activity(meetingId),
    queryFn: () => meetings.listMeetingActivity(meetingId),
    enabled: !!meetingId,
  });
}

export function useCancelMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.cancelMeeting(meetingId),
    onSuccess: (_d, meetingId) => invalidateMeeting(qc, workspaceId, meetingId),
  });
}

// ---- D08b: capabilities, transcript, AI summary, recording, calendar ----------

export function useMeetingCapabilities(workspaceId: string) {
  return useQuery({
    queryKey: meetingKeys.capabilities(workspaceId),
    queryFn: () => meetings.getMeetingCapabilities(workspaceId),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTranscript(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.transcript(meetingId),
    queryFn: () => meetings.listTranscript(meetingId),
    enabled: !!meetingId && enabled,
  });
}

export function useAppendTranscript(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { text: string; spokenAt?: string }) =>
      meetings.appendTranscript(meetingId, args.text, args.spokenAt),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.transcript(meetingId) }),
  });
}

export function upsertMeetingChatMessage(
  prev: MeetingChatMessage[] | undefined,
  saved: MeetingChatMessage,
): MeetingChatMessage[] {
  const list = prev ?? [];
  if (list.some((m) => m.id === saved.id)) return list;
  return [...list, saved].sort(
    (a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id.localeCompare(b.id),
  );
}

export function useMeetingChat(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.chat(meetingId),
    queryFn: () => meetings.listMeetingChat(meetingId),
    enabled: !!meetingId && enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useAppendMeetingChat(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => meetings.appendMeetingChat(meetingId, message),
    onSuccess: (saved) => {
      if (saved) {
        qc.setQueryData<MeetingChatMessage[]>(meetingKeys.chat(meetingId), (prev) =>
          upsertMeetingChatMessage(prev, saved),
        );
      }
      void qc.invalidateQueries({ queryKey: meetingKeys.chat(meetingId) });
    },
  });
}

export function useMeetingSummary(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.summary(meetingId),
    queryFn: () => meetings.getMeetingSummary(meetingId),
    enabled: !!meetingId,
    // 404 = no summary yet; that is a state, not an error worth retrying.
    retry: false,
  });
}

export function useCreateMeetingSummary(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: string) => meetings.createMeetingSummary(meetingId, locale),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.summary(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useCreateTasksFromSummary(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: meetings.SummaryTaskItem[]) => meetings.createTasksFromSummary(meetingId, items),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useRecordings(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.recordings(meetingId),
    queryFn: () => meetings.listRecordings(meetingId),
    enabled: !!meetingId && enabled,
  });
}

export function useStartRecording(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => meetings.startRecording(meetingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.recordings(meetingId) }),
  });
}

export function useStopRecording(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => meetings.stopRecording(meetingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.recordings(meetingId) }),
  });
}

export function useMeetingCalendar() {
  return useMutation({
    mutationFn: (meetingId: string) => meetings.fetchMeetingCalendar(meetingId),
  });
}

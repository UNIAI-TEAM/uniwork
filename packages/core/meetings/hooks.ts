"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as meetings from "../api/endpoints/meetings";
import type { Meeting } from "../types/meeting";

export type { CreateMeetingBody, MeetingToken } from "../api/endpoints/meetings";

export const meetingKeys = {
  list: (wsId: string) => ["meetings", wsId] as const,
  detail: (meetingId: string) => ["meeting", meetingId] as const,
  notes: (meetingId: string) => ["notes", meetingId] as const,
  participants: (meetingId: string) => ["meeting-participants", meetingId] as const,
  joinRequests: (meetingId: string) => ["meeting-join-requests", meetingId] as const,
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

export function useMeetings(workspaceId: string) {
  return useQuery({
    queryKey: meetingKeys.list(workspaceId),
    queryFn: () => meetings.listMeetings(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useMeeting(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.detail(meetingId),
    queryFn: () => meetings.getMeeting(meetingId),
    enabled: !!meetingId,
  });
}

export function useCreateMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: meetings.CreateMeetingBody) => meetings.createMeeting(workspaceId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) }),
  });
}

export function useDeleteMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.deleteMeeting(meetingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) }),
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

export function useMeetingToken() {
  return useMutation({
    mutationFn: (meetingId: string) => meetings.meetingToken(meetingId),
  });
}

export function useJoinMeeting() {
  return useMutation({
    mutationFn: (args: { meetingId: string; invite_link_id?: string; secret?: string }) =>
      meetings.joinMeeting(args.meetingId, {
        invite_link_id: args.invite_link_id,
        secret: args.secret,
      }),
  });
}

export function useStartMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.startMeeting(meetingId),
    onSuccess: (_d, meetingId) => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
  });
}

export function useEndMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.endMeeting(meetingId),
    onSuccess: (_d, meetingId) => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
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
    mutationFn: (requestId: string) => meetings.rejectJoinRequest(requestId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.joinRequests(meetingId) }),
  });
}

export function useCreateInstantMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => meetings.createInstantMeeting(workspaceId, title),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) }),
  });
}

export function useInviteParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => meetings.inviteParticipant(meetingId, userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) }),
  });
}

export function useRemoveParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantId: string) => meetings.removeParticipant(meetingId, participantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) }),
  });
}

export function useTransferHost(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (newHostUserId: string) => meetings.transferHost(meetingId, newHostUserId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
  });
}

export function useInvitations(meetingId: string) {
  return useQuery({
    queryKey: ["meeting-invitations", meetingId],
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
      void qc.invalidateQueries({ queryKey: ["meeting-invitations", meetingId] });
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
    },
  });
}

export function useCreateInviteLink(meetingId: string) {
  return useMutation({
    mutationFn: (body: { name: string; access_mode: string; expires_at: string; max_uses?: number }) =>
      meetings.createInviteLink(meetingId, body),
  });
}

export function useRevokeInviteLink(meetingId: string) {
  return useMutation({
    mutationFn: (linkId: string) => meetings.revokeInviteLink(meetingId, linkId),
  });
}

export function useCancelMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) => meetings.cancelMeeting(meetingId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) }),
  });
}

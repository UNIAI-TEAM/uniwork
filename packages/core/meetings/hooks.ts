"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as meetings from "../api/endpoints/meetings";
import type { Meeting } from "../types/meeting";

export type { CreateMeetingBody, MeetingToken } from "../api/endpoints/meetings";

export const meetingKeys = {
  list: (wsId: string) => ["meetings", wsId] as const,
  detail: (meetingId: string) => ["meeting", meetingId] as const,
  notes: (meetingId: string) => ["notes", meetingId] as const,
};

export function splitMeetings(
  list: Meeting[],
  now: Date,
): { upcoming: Meeting[]; past: Meeting[] } {
  const upcoming = list
    .filter((m) => new Date(m.ends_at) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = list
    .filter((m) => new Date(m.ends_at) < now)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
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

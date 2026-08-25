"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { MeetingNoteSchema, MeetingSchema, type Meeting } from "../types";

const MeetingsResponse = z.object({ meetings: z.array(MeetingSchema) });
const MeetingResponse = z.object({ meeting: MeetingSchema });
const NotesResponse = z.object({ notes: z.array(MeetingNoteSchema) });
const TokenResponse = z.object({ token: z.string(), url: z.string() });

export function splitMeetings(
  meetings: Meeting[],
  now: Date,
): { upcoming: Meeting[]; past: Meeting[] } {
  const upcoming = meetings
    .filter((m) => new Date(m.ends_at) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = meetings
    .filter((m) => new Date(m.ends_at) < now)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

export function useMeetings(workspaceId: string) {
  return useQuery({
    queryKey: ["meetings", workspaceId],
    queryFn: () =>
      api.request(`/api/v1/workspaces/${workspaceId}/meetings`, { schema: MeetingsResponse }),
    select: (d) => d.meetings,
    enabled: !!workspaceId,
  });
}

export function useMeeting(meetingId: string) {
  return useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => api.request(`/api/v1/meetings/${meetingId}`, { schema: MeetingResponse }),
    select: (d) => d.meeting,
    enabled: !!meetingId,
  });
}

export function useCreateMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      description?: string;
      starts_at: string;
      ends_at: string;
    }) =>
      api.request(`/api/v1/workspaces/${workspaceId}/meetings`, {
        method: "POST",
        body,
        schema: MeetingResponse,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", workspaceId] }),
  });
}

export function useDeleteMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      api.request(`/api/v1/meetings/${meetingId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", workspaceId] }),
  });
}

export function useNotes(meetingId: string) {
  return useQuery({
    queryKey: ["notes", meetingId],
    queryFn: () => api.request(`/api/v1/meetings/${meetingId}/notes`, { schema: NotesResponse }),
    select: (d) => d.notes,
    enabled: !!meetingId,
  });
}

export function useAddNote(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.request(`/api/v1/meetings/${meetingId}/notes`, { method: "POST", body: { body } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", meetingId] }),
  });
}

export function useMeetingToken() {
  return useMutation({
    mutationFn: (meetingId: string) =>
      api.request(`/api/v1/meetings/${meetingId}/token`, { method: "POST", schema: TokenResponse }),
  });
}

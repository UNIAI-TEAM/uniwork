import { z } from "zod";
import { MeetingNoteSchema, MeetingSchema, type Meeting, type MeetingNote } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const MeetingsResponse = z.object({ meetings: z.array(MeetingSchema) });
const MeetingResponse = z.object({ meeting: MeetingSchema });
const NotesResponse = z.object({ notes: z.array(MeetingNoteSchema) });
const TokenResponse = z.object({ token: z.string(), url: z.string() });
export type MeetingToken = z.infer<typeof TokenResponse>;

export interface CreateMeetingBody {
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
}

const enc = encodeURIComponent;

export async function listMeetings(workspaceId: string): Promise<Meeting[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meetings`);
  return parseWithFallback<{ meetings: Meeting[] }>(raw, MeetingsResponse, { meetings: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/meetings",
  }).meetings;
}

export async function getMeeting(meetingId: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}`);
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "GET /api/v1/meetings/{id}",
  })?.meeting ?? null;
}

export async function createMeeting(workspaceId: string, body: CreateMeetingBody): Promise<Meeting | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meetings`, { method: "POST", body });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/meetings",
  })?.meeting ?? null;
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}`, { method: "DELETE" });
}

export async function listNotes(meetingId: string): Promise<MeetingNote[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/notes`);
  return parseWithFallback<{ notes: MeetingNote[] }>(raw, NotesResponse, { notes: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/notes",
  }).notes;
}

export async function addNote(meetingId: string, body: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/notes`, { method: "POST", body: { body } });
}

/**
 * The room token is the one response that cannot degrade: without it there
 * is no call to join. null tells the room view to show its error state.
 */
export async function meetingToken(meetingId: string): Promise<MeetingToken | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/token`, { method: "POST" });
  return parseWithFallback<MeetingToken | null>(raw, TokenResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/token",
  });
}

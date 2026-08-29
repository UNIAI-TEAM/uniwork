import { z } from "zod";
import {
  ActivityItemSchema,
  InvitationSchema,
  InviteLinkSchema,
  JoinDecisionSchema,
  JoinRequestSchema,
  MeetingNoteSchema,
  MeetingSchema,
  MeetingCapabilitiesSchema,
  MeetingStatisticsSchema,
  MeetingSummarySchema,
  ParticipantSchema,
  RecordingSchema,
  TranscriptSegmentSchema,
  type JoinDecision,
  type Meeting,
  type MeetingActivityItem,
  type MeetingCapabilities,
  type MeetingRecording,
  type MeetingSummary,
  type MeetingTranscriptSegment,
  type MeetingInvitation,
  type MeetingInviteLink,
  type MeetingJoinRequest,
  type MeetingNote,
  type MeetingParticipant,
  type MeetingStatistics,
} from "../../types/meeting";
import { request, requestText } from "../http";
import { parseWithFallback } from "../schema";

export type { MeetingInvitation, MeetingInviteLink } from "../../types/meeting";

const MeetingsResponse = z.object({
  meetings: z.array(MeetingSchema),
  total: z.number().optional(),
});
const MeetingResponse = z.object({ meeting: MeetingSchema });
const NotesResponse = z.object({ notes: z.array(MeetingNoteSchema) });
const TokenResponse = z.object({ token: z.string(), url: z.string() });
export type MeetingToken = z.infer<typeof TokenResponse>;

const ParticipantsResponse = z.object({ participants: z.array(ParticipantSchema) });
const JoinRequestsResponse = z.object({ join_requests: z.array(JoinRequestSchema) });
const InvitationsResponse = z.object({ invitations: z.array(InvitationSchema) });
const InviteLinksResponse = z.object({ invite_links: z.array(InviteLinkSchema) });
const ActivityResponse = z.object({ activity: z.array(ActivityItemSchema) });
const JoinRequestResponse = z.object({ join_request: JoinRequestSchema });

export interface CreateMeetingBody {
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  timezone?: string;
  allow_join_request?: boolean;
  attendee_user_ids?: string[];
}

export interface UpdateMeetingBody {
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  timezone?: string;
  allow_join_request?: boolean;
}

export interface MeetingListFilters {
  status?: string;
  meeting_type?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  host_user_id?: string;
  sort?: string;
}

export interface MeetingListPage {
  meetings: Meeting[];
  total: number;
}

export interface JoinMeetingBody {
  invite_link_id?: string;
  secret?: string;
  display_name?: string;
}

const enc = encodeURIComponent;

function listQuery(filters?: MeetingListFilters): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.status) p.set("status", filters.status);
  if (filters.meeting_type) p.set("meeting_type", filters.meeting_type);
  if (filters.q) p.set("q", filters.q);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  if (filters.host_user_id) p.set("host_user_id", filters.host_user_id);
  if (filters.sort) p.set("sort", filters.sort);
  if (filters.limit !== undefined) p.set("limit", String(filters.limit));
  if (filters.offset !== undefined) p.set("offset", String(filters.offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function listMeetings(workspaceId: string, filters?: MeetingListFilters): Promise<MeetingListPage> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meetings${listQuery(filters)}`);
  const parsed = parseWithFallback<z.infer<typeof MeetingsResponse>>(
    raw,
    MeetingsResponse,
    { meetings: [], total: 0 },
    { endpoint: "GET /api/v1/workspaces/{ws}/meetings" },
  );
  return { meetings: parsed.meetings, total: parsed.total ?? parsed.meetings.length };
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

export async function updateMeeting(meetingId: string, body: UpdateMeetingBody): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}`, { method: "PATCH", body });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "PATCH /api/v1/meetings/{id}",
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

export async function joinMeeting(meetingId: string, body?: JoinMeetingBody): Promise<JoinDecision | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/join`, { method: "POST", body: body ?? {} });
  return parseWithFallback<JoinDecision | null>(raw, JoinDecisionSchema, null, {
    endpoint: "POST /api/v1/meetings/{id}/join",
  });
}

export async function startMeeting(meetingId: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/start`, { method: "POST" });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/start",
  })?.meeting ?? null;
}

export async function endMeeting(meetingId: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/end`, { method: "POST" });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/end",
  })?.meeting ?? null;
}

export async function cancelMeeting(meetingId: string, reason?: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/cancel`, { method: "POST", body: { reason } });
}

export async function listParticipants(meetingId: string): Promise<MeetingParticipant[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/participants`);
  return parseWithFallback<{ participants: MeetingParticipant[] }>(raw, ParticipantsResponse, { participants: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/participants",
  }).participants;
}

export async function listJoinRequests(meetingId: string): Promise<MeetingJoinRequest[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/join-requests`);
  return parseWithFallback<{ join_requests: MeetingJoinRequest[] }>(raw, JoinRequestsResponse, { join_requests: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/join-requests",
  }).join_requests;
}

export async function createJoinRequest(meetingId: string): Promise<MeetingJoinRequest | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/join-requests`, { method: "POST" });
  return parseWithFallback<{ join_request: MeetingJoinRequest } | null>(raw, JoinRequestResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/join-requests",
  })?.join_request ?? null;
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  await request(`/api/v1/meeting-join-requests/${enc(requestId)}/approve`, { method: "POST" });
}

export async function rejectJoinRequest(requestId: string, reason?: string): Promise<void> {
  await request(`/api/v1/meeting-join-requests/${enc(requestId)}/reject`, {
    method: "POST",
    body: reason ? { reason } : {},
  });
}

export async function cancelJoinRequest(requestId: string): Promise<void> {
  await request(`/api/v1/meeting-join-requests/${enc(requestId)}/cancel`, { method: "POST" });
}

const PublicInviteLinkSchema = z.object({
  link_id: z.string(),
  meeting_id: z.string().optional(),
  title: z.string(),
  starts_at: z.string(),
  access_mode: z.string(),
  expired: z.boolean(),
});
export type PublicInviteLink = z.infer<typeof PublicInviteLinkSchema>;

export async function resolveInviteLink(linkId: string, secret: string): Promise<PublicInviteLink | null> {
  const raw = await request("/api/v1/public/meeting-invite-links/resolve", {
    method: "POST",
    body: { link_id: linkId, secret },
  });
  return parseWithFallback<PublicInviteLink | null>(raw, PublicInviteLinkSchema, null, {
    endpoint: "POST /api/v1/public/meeting-invite-links/resolve",
  });
}

export async function createInstantMeeting(workspaceId: string, title?: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meetings/instant`, {
    method: "POST",
    body: { title: title ?? "" },
  });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/meetings/instant",
  })?.meeting ?? null;
}

export async function inviteParticipant(meetingId: string, userId: string) {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invitations`, {
    method: "POST",
    body: { user_id: userId },
  });
  return parseWithFallback(raw, z.object({ participant: ParticipantSchema }), null, {
    endpoint: "POST /api/v1/meetings/{id}/invitations",
  });
}

export async function removeParticipant(meetingId: string, participantId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/participants/${enc(participantId)}`, { method: "DELETE" });
}

export async function transferHost(meetingId: string, newHostUserId: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/host-transfer`, {
    method: "POST",
    body: { new_host_user_id: newHostUserId },
  });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/host-transfer",
  })?.meeting ?? null;
}

export async function listInvitations(meetingId: string): Promise<MeetingInvitation[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invitations`);
  return parseWithFallback<{ invitations: MeetingInvitation[] }>(raw, InvitationsResponse, { invitations: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/invitations",
  }).invitations;
}

export async function respondInvitation(meetingId: string, invitationId: string, response: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/invitations/${enc(invitationId)}/response`, {
    method: "PUT",
    body: { response },
  });
}

export async function listInviteLinks(meetingId: string): Promise<MeetingInviteLink[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invite-links`);
  return parseWithFallback<{ invite_links: MeetingInviteLink[] }>(raw, InviteLinksResponse, { invite_links: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/invite-links",
  }).invite_links;
}

export async function createInviteLink(
  meetingId: string,
  body: { name: string; access_mode: string; expires_at: string; max_uses?: number },
): Promise<{ invite_link: MeetingInviteLink } | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invite-links`, { method: "POST", body });
  return parseWithFallback<{ invite_link: MeetingInviteLink } | null>(
    raw,
    z.object({ invite_link: InviteLinkSchema }),
    null,
    { endpoint: "POST /api/v1/meetings/{id}/invite-links" },
  );
}

export async function revokeInviteLink(meetingId: string, linkId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/invite-links/${enc(linkId)}/revoke`, { method: "POST" });
}

export async function getMeetingStatistics(workspaceId: string): Promise<MeetingStatistics | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meeting-statistics`);
  return parseWithFallback<MeetingStatistics | null>(raw, MeetingStatisticsSchema, null, {
    endpoint: "GET /api/v1/workspaces/{ws}/meeting-statistics",
  });
}

export async function listMeetingActivity(meetingId: string): Promise<MeetingActivityItem[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/activity`);
  return parseWithFallback<{ activity: MeetingActivityItem[] }>(raw, ActivityResponse, { activity: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/activity",
  }).activity;
}

// ---- D08b: capabilities, transcript, AI summary, recording, calendar ----------

const TranscriptResponse = z.object({ segments: z.array(TranscriptSegmentSchema) });
const SummaryResponse = z.object({ summary: MeetingSummarySchema });
const RecordingsResponse = z.object({ recordings: z.array(RecordingSchema) });
const RecordingResponse = z.object({ recording: RecordingSchema });
const TaskIDsResponse = z.object({ task_ids: z.array(z.string()) });

export async function getMeetingCapabilities(workspaceId: string): Promise<MeetingCapabilities> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meeting-capabilities`);
  return parseWithFallback(raw, MeetingCapabilitiesSchema, {}, { endpoint: "getMeetingCapabilities" });
}

export async function listTranscript(meetingId: string): Promise<MeetingTranscriptSegment[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/transcript`);
  return parseWithFallback(raw, TranscriptResponse, { segments: [] }, { endpoint: "listTranscript" }).segments;
}

export async function appendTranscript(meetingId: string, text: string, spokenAt?: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/transcript`, {
    method: "POST",
    body: { text, spoken_at: spokenAt ?? new Date().toISOString() },
  });
}

export async function getMeetingSummary(meetingId: string): Promise<MeetingSummary | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`);
  return parseWithFallback(raw, SummaryResponse, { summary: null }, { endpoint: "getMeetingSummary" }).summary;
}

export async function createMeetingSummary(meetingId: string, locale: string): Promise<MeetingSummary | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary`, { method: "POST", body: { locale } });
  return parseWithFallback(raw, SummaryResponse, { summary: null }, { endpoint: "createMeetingSummary" }).summary;
}

export interface SummaryTaskItem {
  title: string;
  description?: string;
  assignee_id?: string;
  due_date?: string;
}

export async function createTasksFromSummary(meetingId: string, items: SummaryTaskItem[]): Promise<string[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/summary/tasks`, { method: "POST", body: { items } });
  return parseWithFallback(raw, TaskIDsResponse, { task_ids: [] }, { endpoint: "createTasksFromSummary" }).task_ids;
}

export async function listRecordings(meetingId: string): Promise<MeetingRecording[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/recordings`);
  return parseWithFallback(raw, RecordingsResponse, { recordings: [] }, { endpoint: "listRecordings" }).recordings;
}

export async function startRecording(meetingId: string): Promise<MeetingRecording | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/recording/start`, { method: "POST" });
  return parseWithFallback(raw, RecordingResponse, { recording: null }, { endpoint: "startRecording" }).recording;
}

export async function stopRecording(meetingId: string): Promise<MeetingRecording | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/recording/stop`, { method: "POST" });
  return parseWithFallback(raw, RecordingResponse, { recording: null }, { endpoint: "stopRecording" }).recording;
}

/** Fetches the iCalendar text; the caller turns it into a download. */
export async function fetchMeetingCalendar(meetingId: string): Promise<string> {
  return requestText(`/api/v1/meetings/${enc(meetingId)}/calendar.ics`);
}

import { z } from "zod";
import { MeetingNoteSchema, MeetingSchema, JoinDecisionSchema, ParticipantSchema, JoinRequestSchema, type Meeting, type MeetingNote, type JoinDecision, type MeetingParticipant, type MeetingJoinRequest } from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const MeetingsResponse = z.object({ meetings: z.array(MeetingSchema) });
const MeetingResponse = z.object({ meeting: MeetingSchema });
const NotesResponse = z.object({ notes: z.array(MeetingNoteSchema) });
const TokenResponse = z.object({ token: z.string(), url: z.string() });
export type MeetingToken = z.infer<typeof TokenResponse>;

const JoinResponse = JoinDecisionSchema;
const ParticipantsResponse = z.object({ participants: z.array(ParticipantSchema) });
const JoinRequestsResponse = z.object({ join_requests: z.array(JoinRequestSchema) });

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

export async function joinMeeting(
  meetingId: string,
  body?: { invite_link_id?: string; secret?: string },
): Promise<JoinDecision | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/join`, { method: "POST", body: body ?? {} });
  return parseWithFallback<JoinDecision | null>(raw, JoinResponse, null, {
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

export async function approveJoinRequest(requestId: string): Promise<void> {
  await request(`/api/v1/meeting-join-requests/${enc(requestId)}/approve`, { method: "POST" });
}

export async function rejectJoinRequest(requestId: string): Promise<void> {
  await request(`/api/v1/meeting-join-requests/${enc(requestId)}/reject`, { method: "POST" });
}

type PublicInviteLink = {
  link_id: string; title: string; starts_at: string; access_mode: string; expired: boolean;
};

export async function resolveInviteLink(linkId: string, secret: string): Promise<PublicInviteLink | null> {
  const schema = z.object({
    link_id: z.string(), title: z.string(), starts_at: z.string(),
    access_mode: z.string(), expired: z.boolean(),
  });
  const raw = await request("/api/v1/public/meeting-invite-links/resolve", {
    method: "POST", body: { link_id: linkId, secret },
  });
  return parseWithFallback<PublicInviteLink | null>(raw, schema, null, { endpoint: "POST /api/v1/public/meeting-invite-links/resolve" });
}

export async function createInstantMeeting(workspaceId: string, title?: string): Promise<Meeting | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/meetings/instant`, {
    method: "POST", body: { title: title ?? "" },
  });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/workspaces/{ws}/meetings/instant",
  })?.meeting ?? null;
}

export async function inviteParticipant(meetingId: string, userId: string) {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invitations`, {
    method: "POST", body: { user_id: userId },
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
    method: "POST", body: { new_host_user_id: newHostUserId },
  });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/host-transfer",
  })?.meeting ?? null;
}

const InvitationSchema = z.object({
  id: z.string(), meeting_id: z.string(), participant_id: z.string(), response_status: z.string(),
});
export type MeetingInvitation = z.infer<typeof InvitationSchema>;

export async function listInvitations(meetingId: string): Promise<MeetingInvitation[]> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invitations`);
  return parseWithFallback<{ invitations: MeetingInvitation[] }>(raw, z.object({ invitations: z.array(InvitationSchema) }), { invitations: [] }, {
    endpoint: "GET /api/v1/meetings/{id}/invitations",
  }).invitations;
}

export async function respondInvitation(meetingId: string, invitationId: string, response: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/invitations/${enc(invitationId)}/response`, {
    method: "PUT", body: { response },
  });
}

const InviteLinkSchema = z.object({
  id: z.string(), meeting_id: z.string(), name: z.string(), access_mode: z.string(),
  expires_at: z.string(), max_uses: z.number().optional(), used_count: z.number(),
  revoked_at: z.string().optional(), secret: z.string().optional(),
});
export type MeetingInviteLink = z.infer<typeof InviteLinkSchema>;

export async function createInviteLink(
  meetingId: string,
  body: { name: string; access_mode: string; expires_at: string; max_uses?: number },
): Promise<{ invite_link: MeetingInviteLink } | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/invite-links`, { method: "POST", body });
  return parseWithFallback<{ invite_link: MeetingInviteLink } | null>(raw, z.object({ invite_link: InviteLinkSchema }), null, {
    endpoint: "POST /api/v1/meetings/{id}/invite-links",
  });
}

export async function revokeInviteLink(meetingId: string, linkId: string): Promise<void> {
  await request(`/api/v1/meetings/${enc(meetingId)}/invite-links/${enc(linkId)}/revoke`, { method: "POST" });
}

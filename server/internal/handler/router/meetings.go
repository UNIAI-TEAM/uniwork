package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

func registerMeetings(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/meetings", h.ListMeetings, apiOp{
		summary: "List meetings", tags: []string{"meetings"}, sdo: sdo.MeetingListSDO{}, auth: true,
	})
	r.Get("/workspaces/{workspaceID}/meeting-statistics", h.MeetingStatistics, apiOp{
		summary: "Meeting statistics", tags: []string{"meetings"}, sdo: sdo.MeetingStatisticsSDO{}, auth: true,
	})
	r.Post("/workspaces/{workspaceID}/meetings", h.CreateMeeting, apiOp{
		summary: "Create scheduled meeting", tags: []string{"meetings"},
		sdi: sdi.CreateMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Post("/workspaces/{workspaceID}/meetings/instant", h.CreateInstantMeeting, apiOp{
		summary: "Create instant meeting", tags: []string{"meetings"},
		sdi: sdi.CreateInstantMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}", h.GetMeeting, apiOp{
		summary: "Get meeting", tags: []string{"meetings"}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Patch("/meetings/{meetingID}", h.UpdateMeeting, apiOp{
		summary: "Update meeting", tags: []string{"meetings"},
		sdi: sdi.PatchMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Delete("/meetings/{meetingID}", h.DeleteMeeting, apiOp{
		summary: "Cancel a scheduled meeting", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/start", h.StartMeeting, apiOp{
		summary: "Start meeting", tags: []string{"meetings"}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/end", h.EndMeeting, apiOp{
		summary: "End meeting", tags: []string{"meetings"}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/cancel", h.CancelMeeting, apiOp{
		summary: "Cancel scheduled meeting", tags: []string{"meetings"},
		sdi: sdi.CancelMeetingSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/host-transfer", h.TransferHost, apiOp{
		summary: "Transfer host", tags: []string{"meetings"},
		sdi: sdi.HostTransferSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/notes", h.ListNotes, apiOp{
		summary: "List notes", tags: []string{"meetings"}, sdo: sdo.NoteListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/notes", h.CreateNote, apiOp{
		summary: "Add note", tags: []string{"meetings"}, sdi: sdi.CreateNoteSDI{}, sdo: sdo.NoteSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/token", h.MeetingToken, apiOp{
		summary: "Mint LiveKit token (deprecated; uses admission)", tags: []string{"meetings"},
		sdo: sdo.MeetingTokenSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/participants", h.ListParticipants, apiOp{
		summary: "List participants", tags: []string{"meetings"}, sdo: sdo.ParticipantListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/invitations", h.InviteParticipant, apiOp{
		summary: "Invite a workspace member", tags: []string{"meetings"},
		sdi: sdi.InviteParticipantSDI{}, sdo: sdo.ParticipantListSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/invitations", h.ListInvitations, apiOp{
		summary: "List invitations", tags: []string{"meetings"}, sdo: sdo.InvitationListSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/invitations/{invitationID}/response", h.RespondInvitation, apiOp{
		summary: "RSVP", tags: []string{"meetings"}, sdi: sdi.InvitationResponseSDI{}, sdo: sdo.InvitationListSDO{}, auth: true,
	})
	r.Delete("/meetings/{meetingID}/participants/{participantID}", h.RemoveParticipant, apiOp{
		summary: "Remove participant", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/invite-links", h.ListInviteLinks, apiOp{
		summary: "List invite links", tags: []string{"meetings"}, sdo: sdo.InviteLinkListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/invite-links", h.CreateInviteLink, apiOp{
		summary: "Create invite link", tags: []string{"meetings"},
		sdi: sdi.CreateInviteLinkSDI{}, sdo: sdo.InviteLinkSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/invite-links/{linkId}/revoke", h.RevokeInviteLink, apiOp{
		summary: "Revoke invite link", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/join-requests", h.ListJoinRequests, apiOp{
		summary: "List join requests", tags: []string{"meetings"}, sdo: sdo.JoinRequestListSDO{}, auth: true,
	})
	r.Post("/meeting-join-requests/{requestId}/approve", h.ApproveJoinRequest, apiOp{
		summary: "Approve join request", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meeting-join-requests/{requestId}/reject", h.RejectJoinRequest, apiOp{
		summary: "Reject join request", tags: []string{"meetings"},
		sdi: sdi.RejectJoinRequestSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/activity", h.MeetingActivity, apiOp{
		summary: "Audit activity", tags: []string{"meetings"}, sdo: sdo.ActivityListSDO{}, auth: true,
	})
	r.Get("/workspaces/{workspaceID}/meeting-capabilities", h.MeetingCapabilities, apiOp{
		summary: "Which optional meeting features (AI, recording) this server offers", tags: []string{"meetings"},
		sdo: sdo.MeetingCapabilitiesSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/transcript", h.ListTranscript, apiOp{
		summary: "List transcript segments", tags: []string{"meetings"}, sdo: sdo.TranscriptListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/transcript", h.AppendTranscript, apiOp{
		summary: "Append a transcript segment (live captions)", tags: []string{"meetings"},
		sdi: sdi.AppendTranscriptSDI{}, sdo: sdo.TranscriptSegmentSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/chat", h.ListChatMessages, apiOp{
		summary: "List persisted in-room chat messages", tags: []string{"meetings"}, sdo: sdo.ChatListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/chat", h.AppendChatMessage, apiOp{
		summary: "Send an in-room chat message", tags: []string{"meetings"},
		sdi: sdi.AppendChatSDI{}, sdo: sdo.ChatMessageSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/summary", h.GetMeetingSummary, apiOp{
		summary: "Latest AI summary", tags: []string{"meetings"}, sdo: sdo.MeetingSummarySDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/summary", h.CreateSummary, apiOp{
		summary: "Generate AI summary from transcript and notes", tags: []string{"meetings"},
		sdi: sdi.CreateSummarySDI{}, sdo: sdo.MeetingSummarySDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/summary/tasks", h.CreateSummaryTasks, apiOp{
		summary: "Create tasks from summary action items", tags: []string{"meetings"},
		sdi: sdi.SummaryTasksSDI{}, sdo: sdo.TaskIDListSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/recordings", h.ListRecordings, apiOp{
		summary: "List recordings", tags: []string{"meetings"}, sdo: sdo.RecordingListSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/recording/start", h.StartRecording, apiOp{
		summary: "Start recording", tags: []string{"meetings"}, sdo: sdo.RecordingSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/recording/stop", h.StopRecording, apiOp{
		summary: "Stop recording", tags: []string{"meetings"}, sdo: sdo.RecordingSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/calendar.ics", h.MeetingCalendar, apiOp{
		summary: "iCalendar file for the meeting", tags: []string{"meetings"}, auth: true,
	})
}

func registerPublicMeetings(r api, h Routes, credentialLimit, joinLimit, lobbyWSLimit func(http.Handler) http.Handler) {
	r.With(credentialLimit).Post("/public/meeting-invite-links/resolve", h.ResolveInviteLink, apiOp{
		summary: "Resolve invite link", tags: []string{"meetings"},
		sdi: sdi.ResolveInviteLinkSDI{}, sdo: sdo.PublicInviteLinkSDO{},
	})
	r.With(joinLimit).Post("/meetings/{meetingID}/join", h.JoinMeeting, apiOp{
		summary: "Evaluate admission and issue join credential", tags: []string{"meetings"},
		sdi: sdi.JoinMeetingSDI{}, sdo: sdo.JoinDecisionSDO{},
	})
	r.With(credentialLimit).Post("/meetings/{meetingID}/join-requests", h.CreateJoinRequest, apiOp{
		summary: "Request to join (member or guest)", tags: []string{"meetings"},
		sdi: sdi.CreateJoinRequestSDI{}, sdo: sdo.JoinRequestListSDO{},
	})
	r.With(credentialLimit).Post("/meeting-join-requests/{requestId}/cancel", h.CancelJoinRequest, apiOp{
		summary: "Cancel own join request (member or guest)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{},
	})
	r.With(lobbyWSLimit).Get("/meetings/{meetingID}/lobby-ws", h.MeetingLobbyWS, apiOp{})
	r.Post("/integrations/livekit/webhook", h.LiveKitWebhook, apiOp{
		summary: "LiveKit webhook (signature required)", tags: []string{"integrations"},
		sdo: sdo.StatusSDO{},
	})
}

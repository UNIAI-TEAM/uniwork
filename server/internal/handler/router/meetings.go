package router

import (
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// liveKitWebhookPath is the webhook route under /api/v1; router.go exempts
// it from the global rate limiter by this exact path.
const liveKitWebhookPath = "/integrations/livekit/webhook"

// summaryLimit wraps POST /meetings/{id}/summary only: the ai-meeting-summary
// bucket router.go builds (UNI-1853 M9). minutesOrg names the meeting's
// organization so minutesFlag (meeting_minutes, UNI-2003) honours its
// overrides.
func registerMeetings(r api, h Routes, summaryLimit, minutesOrg, minutesFlag func(http.Handler) http.Handler) {
	r.Get("/workspaces/{workspaceID}/meetings", h.ListMeetings, apiOp{
		summary: "List meetings", tags: []string{"meetings"}, sdi: sdi.ListMeetingsSDI{}, sdo: sdo.MeetingListSDO{}, auth: true,
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
	r.Post("/meetings/{meetingID}/extend", h.ExtendMeeting, apiOp{
		summary: "Extend scheduled end while in progress", tags: []string{"meetings"},
		sdi: sdi.ExtendMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/cancel", h.CancelMeeting, apiOp{
		summary: "Cancel scheduled meeting", tags: []string{"meetings"},
		sdi: sdi.CancelMeetingSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/restore", h.RestoreMeeting, apiOp{
		summary: "Restore a cancelled meeting", tags: []string{"meetings"},
		sdi: sdi.RestoreMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
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
	r.Post("/meetings/{meetingID}/participants/{participantID}/publish", h.SetParticipantPublish, apiOp{
		summary: "Lock or unlock a participant's microphone or screen share (host)", tags: []string{"meetings"},
		sdi: sdi.SetParticipantPublishSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Patch("/meetings/{meetingID}/participants/{participantID}", h.PatchParticipant, apiOp{
		summary: "Set a participant's standing or secretary role (host)", tags: []string{"meetings"},
		sdi: sdi.PatchParticipantSDI{}, sdo: sdo.ParticipantSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/attendance", h.GetAttendance, apiOp{
		summary: "Attendance roll: suggestions merged with clerk marks", tags: []string{"meetings"},
		sdo: sdo.AttendanceSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/attendance/{participantID}", h.MarkAttendance, apiOp{
		summary: "Mark one participant's attendance (clerk)", tags: []string{"meetings"},
		sdi: sdi.MarkAttendanceSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Delete("/meetings/{meetingID}/attendance/{participantID}", h.ClearAttendanceMark, apiOp{
		summary: "Return a participant to the automatic suggestion (clerk)", tags: []string{"meetings"},
		sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/attendance/finalize", h.FinalizeAttendance, apiOp{
		summary: "Finalize attendance (clerk)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/attendance/reopen", h.ReopenAttendance, apiOp{
		summary: "Reopen finalized attendance (clerk)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/motions", h.CreateMotion, apiOp{
		summary:     "Draft a vote item (clerk)",
		description: "Tạo nội dung ở trạng thái DRAFT, xếp cuối danh sách. Cuộc họp phải chưa kết thúc và chưa bị hủy.",
		tags:        []string{"meetings"},
		sdi:         sdi.CreateMotionSDI{},
		sdo:         sdo.MotionSDO{},
		auth:        true,
	})
	r.Patch("/meetings/{meetingID}/motions/{motionID}", h.UpdateMotion, apiOp{
		summary: "Edit or reorder a draft vote item (clerk)", tags: []string{"meetings"},
		sdi: sdi.PatchMotionSDI{}, sdo: sdo.MotionSDO{}, auth: true,
	})
	r.Delete("/meetings/{meetingID}/motions/{motionID}", h.DeleteMotion, apiOp{
		summary: "Delete a draft vote item (clerk)", tags: []string{"meetings"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/motions/{motionID}/open", h.OpenMotion, apiOp{
		summary:     "Open voting and snapshot the roll (clerk)",
		description: "Chỉ khi cuộc họp đang diễn ra; mỗi lúc một nội dung. Cử tri = thành viên có mặt hoặc đến muộn lúc mở.",
		tags:        []string{"meetings"},
		sdo:         sdo.MotionSDO{},
		auth:        true,
	})
	r.Post("/meetings/{meetingID}/motions/{motionID}/close", h.CloseMotion, apiOp{
		summary: "Close voting and count the result (clerk)", tags: []string{"meetings"}, sdo: sdo.MotionSDO{}, auth: true,
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
		summary: "List transcript segments (newest page first; ?before= older, ?after= delta)", tags: []string{"meetings"},
		sdi: sdi.MeetingFeedSDI{}, sdo: sdo.TranscriptListSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/scribe", h.SetMeetingScribe, apiOp{
		summary:     "Switch the AI scribe off or on for one meeting",
		description: "Chủ trì hoặc quản trị workspace; cuộc họp SCHEDULED hoặc IN_PROGRESS. Mặc định bật; đang họp thì thư ký được gỡ khỏi phòng hoặc gọi vào ngay. Ghi audit meeting.scribe_toggled và phát scribe.updated.",
		tags:        []string{"meetings"}, sdi: sdi.SetMeetingScribeSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/participants/{participantID}/shared-mic", h.SetParticipantSharedMic, apiOp{
		summary:     "Mark or unmark a participant as the room's shared microphone (clerk)",
		description: "Chủ tọa, thư ký hoặc quản trị workspace; cuộc họp SCHEDULED hoặc IN_PROGRESS. Server ghi shared_mic_at và đặt attribute LiveKit uw.shared_mic (người tham gia không tự đặt được); thư ký AI tách người nói trên mic đó. Ghi audit meeting.shared_mic_toggled và phát participant.updated.",
		tags:        []string{"meetings"}, sdi: sdi.SetSharedMicSDI{}, sdo: sdo.ParticipantSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/speaker-labels", h.ListSpeakerLabels, apiOp{
		summary:     "List the speaker labels of a meeting's transcript, assigned or not",
		description: "Ai đọc được transcript thì đọc được nhãn. Nhãn chưa gán có assigned_name trống.",
		tags:        []string{"meetings"}, sdo: sdo.SpeakerLabelListSDO{}, auth: true,
	})
	r.Put("/meetings/{meetingID}/speaker-labels/{speakerLabelID}", h.AssignSpeakerLabel, apiOp{
		summary:     "Assign a speaker label to a member or a free name (clerk)",
		description: "Một trong user_id hoặc name; không gửi cả hai thì bỏ gán. 422 assignee_not_member khi user_id không phải thành viên workspace. Ghi audit meeting.speaker_label_assigned và phát speaker_label.updated.",
		tags:        []string{"meetings"}, sdi: sdi.AssignSpeakerLabelSDI{}, sdo: sdo.SpeakerLabelSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/transcript", h.AppendTranscript, apiOp{
		summary: "Append a transcript segment (live captions)", tags: []string{"meetings"},
		sdi: sdi.AppendTranscriptSDI{}, sdo: sdo.TranscriptSegmentSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/summary", h.GetMeetingSummary, apiOp{
		summary:     "Latest AI summary",
		description: "Bản tóm tắt mới nhất (null khi chưa có): tóm tắt và kết luận. Việc đề xuất đọc ở GET .../action-items.",
		tags:        []string{"meetings"}, sdo: sdo.MeetingSummarySDO{}, auth: true,
	})
	r.With(summaryLimit).Post("/meetings/{meetingID}/summary", h.CreateSummary, apiOp{
		summary: "Generate AI summary from transcript and notes", tags: []string{"meetings"},
		description: "Chủ trì, thư ký hoặc admin workspace (clerk). Mỗi cuộc họp chỉ chạy một lần tóm tắt tại một thời điểm. " +
			"Việc AI đề xuất thay các việc AI còn chờ xử lý; việc đã giao, đã bỏ qua, việc thêm tay giữ nguyên. " +
			"Lỗi: 403 not_meeting_clerk, 403 entitlement_required (gói không có meeting.ai_summary), 402 ai_quota_exceeded, " +
			"409 summary_no_source / summary_in_progress, 429 rate_limited (bucket ai-meeting-summary: 6 lượt/phút/người, Retry-After) " +
			"hoặc ai_rate_limited (fields.retry_after), 502 ai_failed, 503 ai_not_configured, 504 ai_timeout.",
		sdi: sdi.CreateSummarySDI{}, sdo: sdo.MeetingSummarySDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/evidence", h.MeetingEvidence, apiOp{
		summary: "The cited lines behind a summary's decisions and action items", tags: []string{"meetings"},
		description: "Mọi thành viên workspace. Đọc các đoạn transcript, ghi chú, tin nhắn mà kết luận hoặc việc dẫn làm căn cứ " +
			"(evidence của GET .../summary và GET .../action-items). Căn cứ không thuộc cuộc họp hoặc đã xoá thì vắng. " +
			"Lỗi: 400 khi refs sai dạng hoặc quá 20.",
		sdi: sdi.MeetingEvidenceSDI{}, sdo: sdo.MeetingEvidenceSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/action-items", h.ListActionItems, apiOp{
		summary: "Action items of the meeting (pending, converted, dismissed)", tags: []string{"meetings"},
		description: "Mọi thành viên workspace. Trạng thái suy ra: DISMISSED khi đã bỏ qua, CONVERTED khi task còn tồn tại, " +
			"còn lại PENDING (task bị xoá thì việc về chờ xử lý). Gợi ý người và hạn chỉ có với việc chờ xử lý.",
		sdo: sdo.MeetingActionItemsSDO{}, auth: true,
	})
	r.Get("/meetings/{meetingID}/carried-over-items", h.ListCarriedOverItems, apiOp{
		summary: "Open tasks carried over from earlier meetings of the same project", tags: []string{"meetings"},
		description: "Mọi thành viên workspace. Việc đã giao mà task chưa xong (nhóm trạng thái khác done/cancelled) từ các cuộc họp " +
			"ENDED khác cùng workspace và dự án, bắt đầu trước cuộc họp này (giờ thực tế nếu có, không thì theo lịch). " +
			"Sắp theo hạn, không hạn xếp cuối, tối đa 100. Cuộc họp không có dự án → items rỗng.",
		sdo: sdo.MeetingCarriedOverItemsSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/action-items", h.AddActionItem, apiOp{
		summary: "Add an action item by hand (clerk)", tags: []string{"meetings"},
		description: "Cuộc họp IN_PROGRESS hoặc ENDED, không thì 409 invalid_meeting_state. Việc tay không bị thay khi tạo lại tóm tắt.",
		sdi:         sdi.AddActionItemSDI{}, sdo: sdo.MeetingActionItemSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/action-items/convert", h.ConvertActionItems, apiOp{
		summary: "Turn pending action items into tasks (clerk)", tags: []string{"meetings"},
		description: "Tạo task cho 1–50 việc đang chờ xử lý trong một giao dịch: lỗi ở bất kỳ việc nào thì không task nào được tạo. " +
			"assignee_id/due_date gửi lên là giá trị cuối (null = không gán / không hạn). 404 action_item_not_found và " +
			"409 action_item_not_pending liệt kê fields.action_item_ids; 409 active_duplicate_task cũng vậy.",
		sdi: sdi.ConvertActionItemsSDI{}, sdo: sdo.ConvertActionItemsSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/action-items/{actionItemID}/dismiss", h.DismissActionItem, apiOp{
		summary: "Dismiss a pending action item (clerk)", tags: []string{"meetings"},
		description: "Chỉ từ chờ xử lý, không thì 409 action_item_not_pending. Lý do không bắt buộc, tối đa 500 ký tự.",
		sdi:         sdi.DismissActionItemSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	r.Post("/meetings/{meetingID}/action-items/{actionItemID}/restore", h.RestoreActionItem, apiOp{
		summary: "Restore a dismissed action item (clerk)", tags: []string{"meetings"},
		description: "Chỉ từ đã bỏ qua, không thì 409 action_item_not_dismissed.",
		sdo:         sdo.StatusSDO{}, auth: true,
	})
	minutes := r.With(minutesOrg, minutesFlag)
	minutes.Get("/meetings/{meetingID}/minutes", h.GetMeetingMinutes, apiOp{
		summary: "The meeting's minutes (a UniNote page) and whether they are finalized", tags: []string{"meetings"},
		description: "Mọi thành viên workspace. minutes null khi chưa lập, hoặc trang đã bị xoá hay vào thùng rác. " +
			"edited_since_finalized: nội dung trang được lưu sau phiên bản đã chốt. 404 feature_disabled khi cờ meeting_minutes tắt.",
		sdo: sdo.MeetingMinutesSDO{}, auth: true,
	})
	minutes.Post("/meetings/{meetingID}/minutes", h.CreateMeetingMinutes, apiOp{
		summary: "Make the minutes page from the meeting's data (clerk)", tags: []string{"meetings"},
		description: "Cuộc họp ENDED, không thì 409 invalid_meeting_state; đã có biên bản còn sống → 409 minutes_exist. " +
			"Tạo trang ở gốc workspace (cả workspace xem, chủ trì và thư ký hiện tại sửa, người lập quản lý) và ghi vào cuộc họp " +
			"trong một giao dịch. Số liệu lấy từ bảng, diễn giải từ tóm tắt mới nhất. 403 not_meeting_clerk.",
		sdi: sdi.CreateMinutesSDI{}, sdo: sdo.MeetingMinutesSDO{}, auth: true,
	})
	minutes.Post("/meetings/{meetingID}/minutes/finalize", h.FinalizeMeetingMinutes, apiOp{
		summary: "Finalize the minutes as a document version (clerk with edit)", tags: []string{"meetings"},
		description: "Tạo một phiên bản tài liệu và ghi id của nó vào cuộc họp trong cùng giao dịch; chốt lại sau khi sửa thay id. " +
			"Nội dung chưa đổi so với phiên bản gần nhất thì ghi phiên bản đó. 403 not_meeting_clerk, 403 minutes_edit_required, " +
			"409 minutes_missing.",
		sdo: sdo.MeetingMinutesSDO{}, auth: true,
	})
	minutes.Post("/meetings/{meetingID}/minutes/reopen", h.ReopenMeetingMinutes, apiOp{
		summary: "Reopen finalized minutes as a draft (clerk with edit)", tags: []string{"meetings"},
		description: "Xoá thông tin chốt trên cuộc họp; phiên bản vẫn ở lịch sử tài liệu. Như chốt: 403 minutes_edit_required, 409 minutes_missing.",
		sdo:         sdo.MeetingMinutesSDO{}, auth: true,
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
	// Every client in a room refetches the roster, the chat history, the vote
	// items and the recordings list, and a formal meeting often sits behind one
	// office NAT: these reads live on the global budget only (per signed-in
	// user, per address for guests), not the 60/min credential one, or a refused
	// refetch hides a participant, a message or an open vote.
	r.Get("/meetings/{meetingID}/participants", h.ListParticipants, apiOp{
		summary: "List participants (member or active guest)", tags: []string{"meetings"}, sdo: sdo.ParticipantListSDO{},
	})
	r.Get("/meetings/{meetingID}/chat", h.ListChatMessages, apiOp{
		summary: "List persisted in-room chat messages (member or active guest; newest page first; ?before= older, ?after= delta)", tags: []string{"meetings"},
		sdi: sdi.MeetingFeedSDI{}, sdo: sdo.MeetingChatListSDO{},
	})
	r.With(joinLimit).Post("/meetings/{meetingID}/chat", h.AppendChatMessage, apiOp{
		summary: "Send an in-room chat message (member or active guest)", tags: []string{"meetings"},
		sdi: sdi.AppendChatSDI{}, sdo: sdo.MeetingChatMessageSDO{},
	})
	r.Get("/meetings/{meetingID}/motions", h.ListMotions, apiOp{
		summary:     "List vote items (member or active guest)",
		description: "Người không phải clerk không thấy DRAFT; result chỉ có khi CLOSED. Phiếu của người gọi ở /my-ballots, ai chọn gì ở /motions/{motionID}/voters.",
		tags:        []string{"meetings"},
		sdo:         sdo.MotionListSDO{},
	})
	r.Get("/meetings/{meetingID}/my-ballots", h.ListMyBallots, apiOp{
		summary:     "List my own ballots (member or active guest)",
		description: "Một dòng cho mỗi nội dung người gọi có tên trong danh sách cử tri chốt lúc mở; choice chỉ có với phiếu công khai đã bỏ.",
		tags:        []string{"meetings"},
		sdo:         sdo.MyBallotListSDO{},
	})
	r.Get("/meetings/{meetingID}/motions/{motionID}/voters", h.ListMotionVoters, apiOp{
		summary:     "List who chose what on a closed public vote (member or active guest)",
		description: "voters là null khi nội dung đang mở hoặc bỏ phiếu kín; nội dung nháp trả 404 với người không phải clerk.",
		tags:        []string{"meetings"},
		sdo:         sdo.MotionVotersSDO{},
	})
	r.With(joinLimit).Post("/meetings/{meetingID}/motions/{motionID}/ballot", h.CastBallot, apiOp{
		summary: "Cast a ballot (member or active guest on the roll)", tags: []string{"meetings"},
		sdi: sdi.CastBallotSDI{}, sdo: sdo.StatusSDO{},
	})
	r.Get("/meetings/{meetingID}/recordings", h.ListRecordings, apiOp{
		summary: "List shared recordings (member or active guest)", tags: []string{"meetings"}, sdo: sdo.RecordingListSDO{},
	})
	r.With(credentialLimit).Get("/meetings/{meetingID}/recordings/{recordingID}/playback-url", h.GetMeetingRecordingPlaybackURL, apiOp{
		summary:     "Get meeting recording playback URL",
		description: "URL presigned ngắn hạn để phát MP4 trực tiếp (stream/seek) thay vì tải qua proxy.",
		tags:        []string{"meetings"},
		sdo:         sdo.MeetingRecordingPlaybackSDO{},
	})
	r.With(credentialLimit).Get("/meetings/{meetingID}/recordings/{recordingID}/content", h.StreamMeetingRecording, apiOp{
		summary:     "Stream meeting recording",
		description: "Phát bản ghi cuộc họp (MP4) qua proxy S3 cho thành viên hoặc khách đang tham gia.",
		tags:        []string{"meetings"},
	})
	r.Post(liveKitWebhookPath, h.LiveKitWebhook, apiOp{
		summary: "LiveKit webhook (signature required)", tags: []string{"integrations"},
		sdo: sdo.StatusSDO{},
	})
}

// registerMeetingAgent mounts the scribe agent's routes (spec
// 2026-10-20-meeting-scribe-agent-design §7.1, ADR 0037). agentAuth is
// RequireMeetingAgentToken: only a uwma_ token for this meeting passes, never
// a session JWT. agentLimit is the meeting-agent budget (600/min per token
// under a per-address ceiling); the global limiter skips these paths
// (isMeetingAgentPath) because one agent pod serves many meetings from one
// address.
func registerMeetingAgent(r api, h Routes, agentAuth, agentLimit func(http.Handler) http.Handler) {
	a := r.With(agentLimit, agentAuth)
	a.Post("/meetings/{meetingID}/agent/started", h.MeetingAgentStarted, apiOp{
		summary:     "Scribe agent joined the room",
		description: "Token uwma_ của cuộc họp. Lần chạy chuyển ACTIVE; lần chạy đã đóng trả 409 (agent nên rời phòng).",
		tags:        []string{"meeting-agent"}, sdi: sdi.AgentStartedSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
	a.Get("/meetings/{meetingID}/agent/context", h.MeetingAgentContext, apiOp{
		summary:     "Keyterm context for the scribe agent",
		description: "Token uwma_ của cuộc họp. Tiêu đề, tên workspace và dự án, tên người được mời/tham gia, locale; không có email.",
		tags:        []string{"meeting-agent"}, sdo: sdo.MeetingAgentContextSDO{}, auth: true,
	})
	a.Post("/meetings/{meetingID}/agent/segments", h.MeetingAgentSegments, apiOp{
		summary:     "Store final transcript segments from the scribe agent",
		description: "Token uwma_ của cuộc họp. Tối đa 50 đoạn, mỗi đoạn ≤ 4.000 ký tự; chống trùng theo segment_id; nhận khi IN_PROGRESS hoặc ENDED ≤ 10 phút. speech_ms cộng vào phút ghi lời (meeting.transcription).",
		tags:        []string{"meeting-agent"}, sdi: sdi.AppendAgentSegmentsSDI{}, sdo: sdo.MeetingAgentSegmentsSDO{}, auth: true,
	})
	a.Post("/meetings/{meetingID}/agent/extract", h.MeetingAgentExtract, apiOp{
		summary:     "Live action items from the newest transcript",
		description: "Token uwma_ của cuộc họp. Đọc các đoạn sau con trỏ, hỏi AI và thêm việc LIVE vào Việc sau họp (lọc trùng tiêu đề). Thiếu cờ, quyền gói hay tín dụng AI thì không thêm gì và trả skipped.",
		tags:        []string{"meeting-agent"}, sdo: sdo.MeetingAgentExtractSDO{}, auth: true,
	})
	a.Post("/meetings/{meetingID}/agent/finished", h.MeetingAgentFinished, apiOp{
		summary:     "Scribe agent run finished",
		description: "Token uwma_ của cuộc họp. Lần chạy chuyển FINISHED và chốt phút ghi lời; gọi lại không tính thêm.",
		tags:        []string{"meeting-agent"}, sdi: sdi.AgentFinishedSDI{}, sdo: sdo.StatusSDO{}, auth: true,
	})
}

// isMeetingAgentPath matches /api/v1/meetings/{meetingID}/agent/....
func isMeetingAgentPath(p string) bool {
	rest, ok := strings.CutPrefix(p, "/api/v1/meetings/")
	if !ok {
		return false
	}
	_, tail, ok := strings.Cut(rest, "/")
	return ok && strings.HasPrefix(tail, "agent/")
}

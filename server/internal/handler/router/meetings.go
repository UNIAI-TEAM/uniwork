package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: meetings — schedule, notes, LiveKit token. Requires Bearer.
//
//	GET    /api/v1/workspaces/{workspaceID}/meetings
//	POST   /api/v1/workspaces/{workspaceID}/meetings
//	GET    /api/v1/meetings/{meetingID}
//	PATCH  /api/v1/meetings/{meetingID}
//	DELETE /api/v1/meetings/{meetingID}
//	GET    /api/v1/meetings/{meetingID}/notes
//	POST   /api/v1/meetings/{meetingID}/notes
//	POST   /api/v1/meetings/{meetingID}/token
func registerMeetings(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/meetings", h.ListMeetings, apiOp{
		summary:     "List meetings",
		description: "Các cuộc họp trong workspace.",
		tags:        []string{"meetings"},
		sdo:         sdo.MeetingListSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/meetings", h.CreateMeeting, apiOp{
		summary:     "Create meeting",
		description: "Lên lịch cuộc họp. starts_at và ends_at là RFC3339.",
		tags:        []string{"meetings"},
		sdi:         sdi.CreateMeetingSDI{},
		sdo:         sdo.MeetingSDO{},
		auth:        true,
	})
	r.Get("/meetings/{meetingID}", h.GetMeeting, apiOp{
		summary:     "Get meeting",
		description: "Trả một cuộc họp nếu người gọi là thành viên workspace.",
		tags:        []string{"meetings"},
		sdo:         sdo.MeetingSDO{},
		auth:        true,
	})
	r.Patch("/meetings/{meetingID}", h.UpdateMeeting, apiOp{
		summary:     "Update meeting",
		description: "Sửa tiêu đề, mô tả hoặc lịch. Key bỏ trống giữ nguyên.",
		tags:        []string{"meetings"},
		sdi:         sdi.PatchMeetingSDI{},
		sdo:         sdo.MeetingSDO{},
		auth:        true,
	})
	r.Delete("/meetings/{meetingID}", h.DeleteMeeting, apiOp{
		summary:     "Delete meeting",
		description: "Xóa cuộc họp và ghi chú kèm theo.",
		tags:        []string{"meetings"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Get("/meetings/{meetingID}/notes", h.ListNotes, apiOp{
		summary:     "List meeting notes",
		description: "Ghi chú gắn với cuộc họp.",
		tags:        []string{"meetings"},
		sdo:         sdo.NoteListSDO{},
		auth:        true,
	})
	r.Post("/meetings/{meetingID}/notes", h.CreateNote, apiOp{
		summary:     "Add meeting note",
		description: "Thêm ghi chú vào cuộc họp.",
		tags:        []string{"meetings"},
		sdi:         sdi.CreateNoteSDI{},
		sdo:         sdo.NoteSDO{},
		auth:        true,
	})
	r.Post("/meetings/{meetingID}/token", h.MeetingToken, apiOp{
		summary:     "Mint LiveKit room token",
		description: "Cấp JWT người tham gia phòng họp. Trả 503 nếu LiveKit chưa cấu hình.",
		tags:        []string{"meetings"},
		sdo:         sdo.MeetingTokenSDO{},
		auth:        true,
	})
}

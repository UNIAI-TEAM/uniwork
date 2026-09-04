package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: chat — user lookup, rooms, messages, and LiveKit voice tokens.
//
//	GET  /api/v1/workspaces/{workspaceID}/chat/users/lookup
//	POST /api/v1/chat/voice/token
//	GET  /api/v1/workspaces/{workspaceID}/chat/room
//	POST /api/v1/workspaces/{workspaceID}/chat/room
//	GET  /api/v1/workspaces/{workspaceID}/chat/rooms
//	POST /api/v1/workspaces/{workspaceID}/chat/dm
//	POST /api/v1/workspaces/{workspaceID}/chat/groups
//	POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/leave
//	POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members
//	GET  /api/v1/workspaces/{workspaceID}/chat/messages
//	POST /api/v1/workspaces/{workspaceID}/chat/messages
//	GET  /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages
//	POST /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages
func registerChat(r api, h Routes, chatWriteLimit, chatTypingLimit func(http.Handler) http.Handler) {
	r.Get("/workspaces/{workspaceID}/chat/users/lookup", h.LookupChatUser, apiOp{
		summary:     "Lookup chat user",
		description: "Tìm thành viên cùng tổ chức theo email hoặc user_id để bắt đầu DM.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatUserLookupSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/users/{userID}/block", h.GetChatBlockStatus, apiOp{
		summary:     "Get chat block status",
		description: "Trạng thái chặn tin nhắn giữa caller và peer.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatBlockStatusSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/users/{userID}/block", h.BlockChatUser, apiOp{
		summary:     "Block chat user",
		description: "Chặn nhắn tin DM với thành viên trong tổ chức.",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/chat/users/{userID}/block", h.UnblockChatUser, apiOp{
		summary:     "Unblock chat user",
		description: "Gỡ chặn tin nhắn DM với thành viên.",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/chat/voice/token", h.MintChatVoiceToken, apiOp{
		summary:     "Mint chat voice token",
		description: "Cấp token LiveKit cho cuộc gọi thoại trong phòng chat.",
		tags:        []string{"chat"},
		sdi:         sdi.MintChatVoiceTokenSDI{},
		sdo:         sdo.MeetingTokenSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/room", h.GetWorkspaceChatRoom, apiOp{
		summary:     "Get workspace chat room",
		description: "Trạng thái phòng chat workspace.",
		tags:        []string{"chat"},
		sdo:         sdo.WorkspaceChatRoomSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/room", h.EnsureWorkspaceChatRoom, apiOp{
		summary:     "Ensure workspace chat room",
		description: "Tạo hoặc lấy phòng chat workspace.",
		tags:        []string{"chat"},
		sdi:         sdi.EnsureWorkspaceChatRoomSDI{},
		sdo:         sdo.WorkspaceChatRoomSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms", h.ListChatRooms, apiOp{
		summary:     "List chat rooms",
		description: "Danh sách phòng DM và nhóm của thành viên trong tổ chức.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatRoomDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/dm", h.ResolveDM, apiOp{
		summary:     "Resolve DM room",
		description: "Tìm hoặc tạo phòng DM 1:1 trong tổ chức (có thể khác workspace).",
		tags:        []string{"chat"},
		sdi:         sdi.ResolveDMSDI{},
		sdo:         sdo.ChatRoomDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/groups", h.CreateChatGroup, apiOp{
		summary:     "Create group chat",
		description: "Tạo hoặc lấy phòng nhóm chat.",
		tags:        []string{"chat"},
		sdi:         sdi.CreateGroupSDI{},
		sdo:         sdo.ChatRoomDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/leave", h.LeaveChatRoom, apiOp{
		summary:     "Leave chat room",
		description: "Rời phòng DM hoặc nhóm.",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/members", h.InviteChatGroupMembers, apiOp{
		summary:     "Invite group members",
		description: "Mời thêm thành viên vào nhóm chat.",
		tags:        []string{"chat"},
		sdi:         sdi.InviteGroupMembersSDI{},
		sdo:         sdo.ChatRoomDTO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/messages", h.ListWorkspaceChatMessages, apiOp{
		summary:     "List workspace chat messages",
		description: "Danh sách tin nhắn phòng workspace (cursor: before RFC3339).",
		tags:        []string{"chat"},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages", h.SendWorkspaceChatMessage, apiOp{
		summary:     "Send workspace chat message",
		description: "Gửi tin nhắn vào phòng workspace.",
		tags:        []string{"chat"},
		sdi:         sdi.SendChatMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages", h.ListChatRoomMessages, apiOp{
		summary:     "List chat room messages",
		description: "Danh sách tin nhắn phòng DM/nhóm.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages", h.SendChatRoomMessage, apiOp{
		summary:     "Send chat room message",
		description: "Gửi tin nhắn vào phòng DM/nhóm.",
		tags:        []string{"chat"},
		sdi:         sdi.SendChatMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/reactions", h.ToggleChatMessageReaction, apiOp{
		summary:     "Toggle chat message reaction",
		description: "Thêm hoặc gỡ biểu cảm trên tin nhắn.",
		tags:        []string{"chat"},
		sdi:         sdi.ToggleChatReactionSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/invite", h.SignalChatVoiceInvite, apiOp{
		summary:     "Signal voice call invite",
		description: "Báo cuộc gọi thoại đến thành viên phòng chat.",
		tags:        []string{"chat"},
		sdi:         sdi.VoiceSignalSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/accept", h.SignalChatVoiceAccept, apiOp{
		summary:     "Signal voice call accept",
		description: "Báo người nhận đã nghe máy cuộc gọi thoại.",
		tags:        []string{"chat"},
		sdi:         sdi.VoiceSignalSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/voice/hangup", h.SignalChatVoiceHangup, apiOp{
		summary:     "Signal voice call hangup",
		description: "Kết thúc cuộc gọi thoại cho mọi người. Trong nhóm chỉ người gọi (caller) được gọi endpoint này.",
		tags:        []string{"chat"},
		sdi:         sdi.VoiceSignalSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.With(chatTypingLimit).Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/typing", h.SignalChatTyping, apiOp{
		summary:     "Signal typing indicator",
		description: "Báo đang nhập tin trong phòng chat.",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}

package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: chat — Matrix user lookup, workspace room, and LiveKit voice tokens.
//
//	GET  /api/v1/chat/users/lookup
//	POST /api/v1/chat/voice/token
//	GET  /api/v1/workspaces/{workspaceID}/chat/room
//	POST /api/v1/workspaces/{workspaceID}/chat/room
func registerChat(r api, h Routes) {
	r.Get("/chat/users/lookup", h.LookupChatUser, apiOp{
		summary:     "Lookup chat user",
		description: "Tìm người dùng theo email hoặc user_id để bắt đầu DM.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatUserLookupSDO{},
		auth:        true,
	})
	r.Post("/chat/voice/token", h.MintChatVoiceToken, apiOp{
		summary:     "Mint chat voice token",
		description: "Cấp token LiveKit cho cuộc gọi thoại DM trong phòng Matrix.",
		tags:        []string{"chat"},
		sdi:         sdi.MintChatVoiceTokenSDI{},
		sdo:         sdo.MeetingTokenSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/room", h.GetWorkspaceChatRoom, apiOp{
		summary:     "Get workspace chat room",
		description: "Trạng thái phòng Matrix của workspace.",
		tags:        []string{"chat"},
		sdo:         sdo.WorkspaceChatRoomSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/room", h.EnsureWorkspaceChatRoom, apiOp{
		summary:     "Ensure workspace chat room",
		description: "Tạo hoặc lấy phòng Matrix của workspace.",
		tags:        []string{"chat"},
		sdi:         sdi.EnsureWorkspaceChatRoomSDI{},
		sdo:         sdo.WorkspaceChatRoomSDO{},
		auth:        true,
	})
}

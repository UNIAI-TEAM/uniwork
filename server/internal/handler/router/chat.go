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
//	GET    /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members
//	POST   /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members
//	PATCH  /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members/{userID}
//	DELETE /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/members/{userID}
//	GET  /api/v1/workspaces/{workspaceID}/chat/messages
//	POST /api/v1/workspaces/{workspaceID}/chat/messages
//	GET  /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/search
//	GET  /api/v1/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/around/{messageID}
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
	r.Get("/workspaces/{workspaceID}/chat/nicknames", h.ListChatNicknames, apiOp{
		summary:     "List chat nicknames",
		description: "Biệt danh cá nhân mà caller đặt cho thành viên trong tổ chức.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatNicknameMapSDO{},
		auth:        true,
	})
	r.Put("/workspaces/{workspaceID}/chat/users/{userID}/nickname", h.SetChatNickname, apiOp{
		summary:     "Set chat nickname",
		description: "Đặt hoặc xóa biệt danh cá nhân cho một thành viên (chỉ caller thấy).",
		tags:        []string{"chat"},
		sdi:         sdi.SetChatNicknameSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/gifs/search", h.SearchChatGifs, apiOp{
		summary:     "Search chat GIFs",
		description: "Tìm GIF qua Tenor cho composer chat; không có TENOR_API_KEY thì trả catalog mặc định.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatGifListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/gifs/trending", h.TrendingChatGifs, apiOp{
		summary:     "Trending chat GIFs",
		description: "GIF nổi bật từ Tenor cho composer chat.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatGifListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/stickers/search", h.SearchChatStickers, apiOp{
		summary:     "Search chat stickers",
		description: "Tìm sticker minh họa qua Tenor; cần TENOR_API_KEY.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatGifListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/stickers/trending", h.TrendingChatStickers, apiOp{
		summary:     "Trending chat stickers",
		description: "Sticker nổi bật từ Tenor cho composer chat.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatGifListSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/media/status", h.GetChatMediaStatus, apiOp{
		summary:     "Chat media library status",
		description: "Tenor đã cấu hình trên server hay đang dùng catalog offline.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatMediaStatusSDO{},
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
	r.Get("/workspaces/{workspaceID}/chat/voice/pending", h.ListPendingChatVoiceInvites, apiOp{
		summary:     "List pending chat voice invites",
		description: "Cuộc gọi đang đổ chuông mà callee có thể bỏ lỡ khi offline.",
		tags:        []string{"chat"},
		sdo:         sdo.PendingVoiceInviteSDO{},
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
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/members", h.ListChatRoomMembers, apiOp{
		summary:     "List chat room members",
		description: "Danh sách thành viên phòng chat kèm role và trạng thái cấm gửi.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatRoomMemberDTO{},
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
	r.Patch("/workspaces/{workspaceID}/chat/rooms/{roomID}", h.PatchChatRoom, apiOp{
		summary:     "Update chat room settings",
		description: "Đổi tên phòng hoặc cấu hình quyền thành viên (admin).",
		tags:        []string{"chat"},
		sdi:         sdi.PatchChatRoomSDI{},
		sdo:         sdo.ChatRoomMemberPermissionsDTO{},
		auth:        true,
	})
	r.Patch("/workspaces/{workspaceID}/chat/rooms/{roomID}/members/{userID}", h.PatchChatRoomMember, apiOp{
		summary:     "Update chat room member",
		description: "Thăng/giáng admin phòng hoặc cấm/bỏ cấm gửi tin.",
		tags:        []string{"chat"},
		sdi:         sdi.PatchChatRoomMemberSDI{},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Delete("/workspaces/{workspaceID}/chat/rooms/{roomID}/members/{userID}", h.RemoveChatRoomMember, apiOp{
		summary:     "Remove chat room member",
		description: "Kick khỏi nhóm hoặc xóa khỏi workspace (phòng workspace).",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
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
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/search", h.SearchChatRoomMessages, apiOp{
		summary:     "Search chat room messages",
		description: "Tìm tin nhắn văn bản trong phòng chat (không đánh dấu đã đọc).",
		tags:        []string{"chat"},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/around/{messageID}", h.ListChatRoomMessagesAround, apiOp{
		summary:     "List chat messages around message",
		description: "Lấy tin nhắn quanh một tin cụ thể để nhảy tới vị trí tìm kiếm.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/voice", h.SendChatVoiceMessage, apiOp{
		summary:     "Send chat voice message",
		description: "Tải tin nhắn thoại WebM, Ogg hoặc MP4 lên phòng chat; tối đa 4 MiB và 120 giây.",
		tags:        []string{"chat"},
		sdi:         sdi.SendChatVoiceMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/voice", h.StreamChatVoiceMessage, apiOp{
		summary:     "Stream chat voice message",
		description: "Stream nội dung tin nhắn thoại riêng tư sau khi kiểm tra quyền phòng.",
		tags:        []string{"chat"},
		auth:        true,
	})
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/file", h.SendChatFileMessage, apiOp{
		summary:     "Send chat file message",
		description: "Tải tệp (JPEG, PNG, GIF, WebP, PDF, text) lên phòng chat; tối đa 25 MiB. Lưu trên object storage (MinIO/S3).",
		tags:        []string{"chat"},
		sdi:         sdi.SendChatFileMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/file", h.StreamChatFileMessage, apiOp{
		summary:     "Stream chat file message",
		description: "Tải nội dung tệp đính kèm sau khi kiểm tra quyền phòng.",
		tags:        []string{"chat"},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}", h.GetChatRoomMessage, apiOp{
		summary:     "Get chat room message",
		description: "Lấy một tin nhắn trong phòng (realtime patch, không refetch cả trang).",
		tags:        []string{"chat"},
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
		description: "Gửi tin nhắn hoặc bình chọn vào phòng DM/nhóm.",
		tags:        []string{"chat"},
		sdi:         sdi.SendChatMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/poll/vote", h.VoteChatPollMessage, apiOp{
		summary:     "Vote on chat poll",
		description: "Bỏ phiếu trên tin nhắn bình chọn.",
		tags:        []string{"chat"},
		sdi:         sdi.VoteChatPollSDI{},
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
	r.With(chatWriteLimit).Patch("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}", h.EditChatMessage, apiOp{
		summary:     "Edit chat message",
		description: "Sửa nội dung tin nhắn văn bản của chính mình.",
		tags:        []string{"chat"},
		sdi:         sdi.EditChatMessageSDI{},
		sdo:         sdo.ChatMessageDTO{},
		auth:        true,
	})
	r.With(chatWriteLimit).Delete("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}", h.DeleteChatMessage, apiOp{
		summary:     "Delete chat message",
		description: "Xóa mềm tin nhắn của chính mình.",
		tags:        []string{"chat"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/messages/{messageID}/pin", h.ToggleChatMessagePin, apiOp{
		summary:     "Toggle chat message pin",
		description: "Ghim hoặc bỏ ghim tin nhắn trong phòng.",
		tags:        []string{"chat"},
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

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatThreads mounts first-class thread routes behind chat_work_hub.
func registerChatThreads(r api, h Routes, flagMW, chatWriteLimit func(http.Handler) http.Handler) {
	r.Group(func(th api) {
		th.Use(flagMW)
		th.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages", h.ListChatThreadMessages, apiOp{
			summary:     "List thread messages",
			description: "Tin gốc và các câu trả lời trong thread (một cấp).",
			tags:        []string{"chat"},
			sdo:         sdo.ChatMessageDTO{},
			auth:        true,
		})
		th.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages", h.SendChatThreadMessage, apiOp{
			summary:     "Reply in thread",
			description: "Gửi câu trả lời vào thread; không chèn dòng chính.",
			tags:        []string{"chat"},
			sdi:         sdi.SendChatMessageSDI{},
			sdo:         sdo.ChatMessageDTO{},
			auth:        true,
		})
		th.Post("/workspaces/{workspaceID}/chat/threads/{messageID}/follow", h.FollowChatThread, apiOp{
			summary:     "Follow chat thread",
			description: "Theo dõi hoặc bỏ mute thread.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		th.Delete("/workspaces/{workspaceID}/chat/threads/{messageID}/follow", h.UnfollowChatThread, apiOp{
			summary:     "Unfollow chat thread",
			description: "Mute thread (giữ dòng follower).",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		th.Post("/workspaces/{workspaceID}/chat/threads/{messageID}/read", h.MarkChatThreadRead, apiOp{
			summary:     "Mark chat thread read",
			description: "Cập nhật last_read_at cho caller trên thread.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		th.Get("/workspaces/{workspaceID}/chat/threads", h.ListChatThreads, apiOp{
			summary:     "List followed chat threads",
			description: "Thread caller đang theo dõi; ?unread=1 chỉ chưa đọc.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatThreadListSDO{},
			auth:        true,
		})
	})
}

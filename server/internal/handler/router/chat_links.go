package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatLinks mounts message↔task link routes behind chat_work_hub.
func registerChatLinks(r api, h Routes, flagMW, chatWriteLimit func(http.Handler) http.Handler) {
	r.Group(func(lk api) {
		lk.Use(flagMW)
		lk.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages/{messageID}/tasks", h.CreateTaskFromChatMessage, apiOp{
			summary:     "Create task from chat message",
			description: "Tạo task từ tin nhắn; gắn liên kết created_from; tùy chọn đồng bộ thread.",
			tags:        []string{"chat"},
			sdi:         sdi.CreateTaskFromMessageSDI{},
			sdo:         sdo.TaskDTO{},
			auth:        true,
		})
		lk.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages/{messageID}/links", h.CreateChatMessageLink, apiOp{
			summary:     "Link chat message to entity",
			description: "Gắn tin nhắn với task đã có (mentions).",
			tags:        []string{"chat"},
			sdi:         sdi.CreateChatMessageLinkSDI{},
			sdo:         sdo.ChatMessageLinkDTO{},
			auth:        true,
		})
		lk.Get("/workspaces/{workspaceID}/chat/messages/{messageID}/links", h.ListChatMessageLinks, apiOp{
			summary:     "List chat message links",
			description: "Danh sách liên kết của một tin nhắn.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatMessageLinkListSDO{},
			auth:        true,
		})
		lk.With(chatWriteLimit).Delete("/workspaces/{workspaceID}/chat/messages/{messageID}/links/{linkID}", h.DeleteChatMessageLink, apiOp{
			summary:     "Unlink chat message",
			description: "Gỡ một liên kết khỏi tin nhắn.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		lk.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync", h.SyncChatThreadTask, apiOp{
			summary:     "Sync chat thread with task",
			description: "Nối thread với task để đồng bộ bình luận hai chiều.",
			tags:        []string{"chat"},
			sdi:         sdi.SyncThreadTaskSDI{},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		lk.With(chatWriteLimit).Delete("/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync", h.UnsyncChatThreadTask, apiOp{
			summary:     "Unsync chat thread from task",
			description: "Gỡ nối thread↔task.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
	})
}

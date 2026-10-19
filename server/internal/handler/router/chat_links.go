package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatLinks mounts message↔task link routes.
func registerChatLinks(r api, h Routes, chatWriteLimit func(http.Handler) http.Handler) {
	r.Group(func(lk api) {
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
		lk.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/message-links", h.ListChatRoomMessageLinks, apiOp{
			summary:     "List links of many chat messages",
			description: "Danh sách liên kết của nhiều tin nhắn trong một phòng (message_ids=a,b,…; tối đa 200).",
			tags:        []string{"chat"},
			sdo:         sdo.ChatMessageLinkListSDO{},
			auth:        true,
		})
		lk.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/link-previews", h.ListChatRoomLinkPreviews, apiOp{
			summary:     "List link previews of many chat messages",
			description: "Thẻ xem trước liên kết (ADR 0035) của nhiều tin trong một phòng (message_ids=a,b,…; tối đa 200): tiêu đề, mô tả, tên trang và ảnh đã lưu trong kho UniWork (URL đã ký). Chỉ tin đã có thẻ.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatLinkPreviewListSDO{},
			auth:        true,
		})
		lk.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/linked-tasks", h.ListChatRoomLinkedTasks, apiOp{
			summary:     "List tasks linked from a chat room",
			description: "Các task được gắn từ tin nhắn của phòng, mỗi task một lần, gắn gần nhất trước, kèm tổng số. Chỉ task của workspace trên URL.",
			tags:        []string{"chat"},
			sdi:         sdi.ListChatRoomLinkedTasksSDI{},
			sdo:         sdo.ChatRoomLinkedTaskListSDO{},
			auth:        true,
		})
		lk.Get("/workspaces/{workspaceID}/chat/rooms/{roomID}/shared-summary", h.GetChatRoomSharedSummary, apiOp{
			summary:     "Summarize media shared in a chat room",
			description: "Số ảnh, GIF, video, tệp, liên kết, tin thoại trên dòng tin chính của phòng và tối đa 6 ảnh mới nhất (URL đã ký), không cần tải lịch sử.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatRoomSharedSummarySDO{},
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

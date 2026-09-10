package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatChannels mounts channel routes behind chat_work_hub.
func registerChatChannels(r api, h Routes, flagMW, chatWriteLimit func(http.Handler) http.Handler) {
	r.Group(func(ch api) {
		ch.Use(flagMW)
		ch.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/channels", h.CreateChatChannel, apiOp{
			summary:     "Create chat channel",
			description: "Tạo kênh public hoặc private; tùy chọn gắn Project.",
			tags:        []string{"chat"},
			sdi:         sdi.CreateChatChannelSDI{},
			sdo:         sdo.ChatRoomDTO{},
			auth:        true,
		})
		ch.Get("/workspaces/{workspaceID}/chat/channels", h.ListChatChannels, apiOp{
			summary:     "List chat channels",
			description: "scope=mine|discoverable; lọc project_id và q.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatChannelListSDO{},
			auth:        true,
		})
		ch.Patch("/workspaces/{workspaceID}/chat/channels/{roomID}", h.UpdateChatChannel, apiOp{
			summary:     "Update chat channel",
			description: "Đổi tên, topic, visibility, project_id (null = gỡ).",
			tags:        []string{"chat"},
			sdi:         sdi.UpdateChatChannelSDI{},
			sdo:         sdo.ChatRoomDTO{},
			auth:        true,
		})
		ch.Post("/workspaces/{workspaceID}/chat/channels/{roomID}/join", h.JoinChatChannel, apiOp{
			summary:     "Join public chat channel",
			description: "Tham gia kênh public; private trả 404.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatRoomDTO{},
			auth:        true,
		})
		ch.Post("/workspaces/{workspaceID}/chat/channels/{roomID}/archive", h.ArchiveChatChannel, apiOp{
			summary:     "Archive chat channel",
			description: "Lưu trữ kênh (không áp dụng kênh mặc định).",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		ch.Delete("/workspaces/{workspaceID}/chat/channels/{roomID}/archive", h.UnarchiveChatChannel, apiOp{
			summary:     "Unarchive chat channel",
			description: "Khôi phục kênh đã lưu trữ.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		ch.Get("/workspaces/{workspaceID}/projects/{projectID}/chat/channels", h.ListProjectChatChannels, apiOp{
			summary:     "List project chat channels",
			description: "Kênh gắn một Project mà caller được thấy.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatChannelListSDO{},
			auth:        true,
		})
	})
}

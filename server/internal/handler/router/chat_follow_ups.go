package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatFollowUps mounts personal follow-up routes behind chat_work_hub.
func registerChatFollowUps(r api, h Routes, flagMW, chatWriteLimit func(http.Handler) http.Handler) {
	r.Group(func(fu api) {
		fu.Use(flagMW)
		fu.Get("/workspaces/{workspaceID}/chat/follow-ups", h.ListChatFollowUps, apiOp{
			summary:     "List chat follow-ups",
			description: "Danh sách FollowUp cá nhân trong workspace; mặc định chỉ open.",
			tags:        []string{"chat"},
			sdo:         sdo.ChatFollowUpListSDO{},
			auth:        true,
		})
		fu.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages/{messageID}/follow-ups", h.CreateChatFollowUp, apiOp{
			summary:     "Create chat follow-up",
			description: "Đánh dấu tin nhắn thành FollowUp cá nhân (idempotent theo user+message).",
			tags:        []string{"chat"},
			sdi:         sdi.CreateChatFollowUpSDI{},
			sdo:         sdo.ChatFollowUpSDO{},
			auth:        true,
		})
		fu.With(chatWriteLimit).Patch("/workspaces/{workspaceID}/chat/follow-ups/{followUpID}", h.PatchChatFollowUp, apiOp{
			summary:     "Patch chat follow-up",
			description: "Sửa note/due_at hoặc completed; due_at=null để xoá hạn.",
			tags:        []string{"chat"},
			sdi:         sdi.PatchChatFollowUpSDI{},
			sdo:         sdo.ChatFollowUpSDO{},
			auth:        true,
		})
		fu.With(chatWriteLimit).Delete("/workspaces/{workspaceID}/chat/follow-ups/{followUpID}", h.DeleteChatFollowUp, apiOp{
			summary:     "Delete chat follow-up",
			description: "Xoá FollowUp của chính người gọi.",
			tags:        []string{"chat"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		})
		fu.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/follow-ups/{followUpID}/task", h.ConvertChatFollowUpToTask, apiOp{
			summary:     "Convert follow-up to task",
			description: "Tạo task từ tin neo rồi đánh dấu FollowUp hoàn thành.",
			tags:        []string{"chat"},
			sdi:         sdi.CreateTaskFromMessageSDI{},
			sdo:         sdo.TaskDTO{},
			auth:        true,
		})
	})
}

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatForward mounts message forwarding (UNI-1908 F1).
func registerChatForward(r api, h Routes, chatWriteLimit func(http.Handler) http.Handler) {
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages/{messageID}/forward", h.ForwardChatMessage, apiOp{
		summary:     "Forward chat message",
		description: "Chuyển tiếp một tin (chữ, ảnh, tệp, tin thoại, sticker/GIF) tới 1–10 cuộc trò chuyện người gọi gửi được. Tất cả hoặc không: một phòng bị từ chối thì không phòng nào nhận. Bản sao mang forwarded_from (người gửi gốc, không có phòng nguồn).",
		tags:        []string{"chat"},
		sdi:         sdi.ForwardChatMessageSDI{},
		sdo:         sdo.ForwardChatMessageSDO{},
		auth:        true,
	})
}

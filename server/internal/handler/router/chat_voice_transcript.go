package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerChatVoiceTranscript mounts the on-demand voice transcript (UNI-1908 F2).
func registerChatVoiceTranscript(r api, h Routes, chatWriteLimit func(http.Handler) http.Handler) {
	r.With(chatWriteLimit).Post("/workspaces/{workspaceID}/chat/messages/{messageID}/transcript", h.TranscribeChatVoiceMessage, apiOp{
		summary:     "Transcribe chat voice message",
		description: "Trả bản chép của tin nhắn thoại người gọi đọc được. Lần đầu chép qua AI (tính vào hạn mức AI của tổ chức) và lưu lại; các lần sau trả bản đã lưu, không tính thêm. Trong lúc người khác đang chép lần đầu, trả 409 chat_transcript_pending: thử lại sau giây lát. Lỗi có mã khác: ai_disabled, cloud_unavailable (chưa cấu hình dịch vụ chép), ai_quota_exceeded, ai_provider_error, chat_message_not_voice.",
		tags:        []string{"chat"},
		sdo:         sdo.ChatVoiceTranscriptSDO{},
		auth:        true,
	})
}

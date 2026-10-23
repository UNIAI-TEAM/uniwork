package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai — the AI gateway's HTTP surface (F-09): Ask UNI, its
// conversations, and usage. Requires Bearer. Every read runs as the caller;
// there is no way to ask on someone else's behalf.
//
//	GET    /api/v1/workspaces/{workspaceID}/ai/capabilities
//	POST   /api/v1/workspaces/{workspaceID}/ai/attachments
//	DELETE /api/v1/workspaces/{workspaceID}/ai/attachments/{fileID}
//	POST   /api/v1/workspaces/{workspaceID}/ai/ask
//	POST   /api/v1/workspaces/{workspaceID}/ai/ask/stream
//	GET    /api/v1/workspaces/{workspaceID}/ai/conversations
//	GET    /api/v1/ai/conversations/{conversationID}/messages
//	DELETE /api/v1/ai/conversations/{conversationID}
//	PATCH  /api/v1/ai/conversations/{conversationID}
//	PUT    /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback
//	DELETE /api/v1/ai/conversations/{conversationID}/messages/{messageID}/feedback
//	GET    /api/v1/workspaces/{workspaceID}/ai/usage
//	GET    /api/v1/orgs/{orgID}/ai/usage
//	GET    /api/v1/orgs/{org}/ai/ask-models
//	PUT    /api/v1/orgs/{org}/ai/ask-models
func registerAI(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/ai/capabilities", h.AiCapabilities, apiOp{
		summary:     "AI capabilities",
		description: "enabled=false khi server không có provider (client ẩn nút); quota token AI của tổ chức trong tháng.",
		tags:        []string{"ai"},
		sdo:         sdo.AiCapabilitiesSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/ai/attachments", h.UploadAiAttachment, apiOp{
		summary: "Upload a file for an Ask UNI question",
		description: "Tải một file lên để gắn vào câu hỏi Hỏi UNI kế tiếp (multipart, field file, tối đa 20 MiB; ảnh PNG/JPEG/GIF/WebP, PDF, DOCX, XLSX, PPTX, ODT, TXT, CSV, Markdown; loại xét theo nội dung). " +
			"File chưa thuộc câu hỏi nào cho tới khi câu hỏi gửi đi; không gửi thì tự dọn sau 24 giờ. Người tải lên là người duy nhất đọc, gắn hoặc hủy file. " +
			"403 ai_attachments_unavailable khi cờ ask_uni_attachments hoặc ask_uni_agent tắt, 413 too_large hoặc file_too_large, 415 file_type_rejected.",
		tags: []string{"ai"},
		sdi:  sdi.UploadAiAttachmentSDI{},
		sdo:  sdo.AiAttachmentUploadSDO{},
		auth: true,
	})
	r.Delete("/workspaces/{workspaceID}/ai/attachments/{fileID}", h.CancelAiAttachment, apiOp{
		summary:     "Cancel an Ask UNI file",
		description: "Bỏ file đã tải lên mà chưa có câu hỏi nào nhận. Chỉ người tải lên; file của người khác, của workspace khác, hoặc đã gắn vào câu hỏi → 404. Hủy lại vẫn 204.",
		tags:        []string{"ai"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/ai/ask", h.AskUni, apiOp{
		summary:     "Ask UNI",
		description: "Một lượt hỏi, chỉ đọc, trả lời có trích dẫn [S1]… tới dữ liệu người gọi được xem. 402 ai_quota_exceeded, 429 ai_rate_limited, 503 ai_disabled.",
		tags:        []string{"ai"},
		sdi:         sdi.AskUniSDI{},
		sdo:         sdo.AskUniSDO{},
		auth:        true,
	})
	r.Post("/workspaces/{workspaceID}/ai/ask/stream", h.AskUniStream, apiOp{
		summary: "Ask UNI (stream)",
		description: "Như Ask UNI nhưng trả text/event-stream. Frame: event run, step, delta, citations, done hoặc error (data chỉ có mã). " +
			"Lỗi trước sự kiện đầu tiên trả JSON như POST …/ai/ask (402, 429 kèm Retry-After, 503); sau đó là event error. Cứ 15 giây có dòng `: ping`.",
		tags:     []string{"ai"},
		sdi:      sdi.AskUniSDI{},
		produces: "text/event-stream",
		auth:     true,
	})
	r.Post("/workspaces/{workspaceID}/ai/chat/catch-up", h.ChatCatchUp, apiOp{
		summary:     "Chat CatchUp",
		description: "Tóm tắt tin chưa đọc trong phòng hoặc thread (C-13.7). Gợi ý action item; không tự tạo task. 402/429/503 như Ask UNI.",
		tags:        []string{"ai"},
		sdi:         sdi.ChatCatchUpSDI{},
		sdo:         sdo.ChatCatchUpSDO{},
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/ai/conversations", h.ListAiConversations, apiOp{
		summary:     "My conversations",
		description: "20 hội thoại gần nhất của chính người gọi trong workspace; có q thì tìm theo tiêu đề (gấp dấu), tối đa 50.",
		tags:        []string{"ai"},
		sdi:         sdi.ListAiConversationsSDI{},
		sdo:         sdo.AiConversationListSDO{},
		auth:        true,
	})
	r.Get("/ai/conversations/{conversationID}/messages", h.ListAiMessages, apiOp{
		summary:     "Conversation messages",
		description: "Chủ hội thoại; người khác → 404.",
		tags:        []string{"ai"},
		sdo:         sdo.AiMessageListSDO{},
		auth:        true,
	})
	r.Delete("/ai/conversations/{conversationID}", h.DeleteAiConversation, apiOp{
		summary:     "Delete conversation",
		description: "Xóa hẳn hội thoại và tin nhắn; chủ hội thoại; người khác → 404.",
		tags:        []string{"ai"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
	r.Patch("/ai/conversations/{conversationID}", h.RenameAiConversation, apiOp{
		summary:     "Rename conversation",
		description: "Chủ hội thoại đổi tiêu đề (1–80 ký tự sau khi cắt khoảng trắng); người khác → 404, tiêu đề sai → 400. Không ghi audit: lịch sử hội thoại AI là dữ liệu riêng của người dùng.",
		tags:        []string{"ai"},
		sdi:         sdi.AiRenameConversationSDI{},
		sdo:         sdo.AiConversationDTO{},
		auth:        true,
	})
	r.Put("/ai/conversations/{conversationID}/messages/{messageID}/feedback", h.SetAiFeedback, apiOp{
		summary:     "Rate an Ask UNI answer",
		description: "Mỗi người một đánh giá cho mỗi câu trả lời; gửi lại thì thay đánh giá cũ. Chỉ chủ hội thoại, chỉ tin của trợ lý; ngoài ra → 404. rating không phải up/down, reason lạ hoặc note quá 500 ký tự → 400. Không ghi audit.",
		tags:        []string{"ai"},
		sdi:         sdi.AiFeedbackSDI{},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Delete("/ai/conversations/{conversationID}/messages/{messageID}/feedback", h.ClearAiFeedback, apiOp{
		summary:     "Withdraw my rating",
		description: "Gỡ đánh giá của người gọi; chưa có đánh giá vẫn trả 204. Chủ hội thoại, tin của trợ lý; ngoài ra → 404.",
		tags:        []string{"ai"},
		status:      http.StatusNoContent,
		auth:        true,
	})
	r.Get("/workspaces/{workspaceID}/ai/usage", h.WorkspaceAiUsage, apiOp{
		summary:     "Workspace AI usage",
		description: "Tổng hợp theo ngày × capability × actor_kind. Query from, to (RFC3339 hoặc YYYY-MM-DD; mặc định 30 ngày). Owner/admin workspace.",
		tags:        []string{"ai"},
		sdo:         sdo.AiUsageSDO{},
		auth:        true,
	})
	r.Get("/orgs/{org}/ai/ask-models", h.GetOrgAskModels, apiOp{
		summary:     "Ask UNI models of an organization",
		description: "Các model Claude tổ chức đang bật cho Hỏi UNI (sắp theo chữ cái); chưa chỉnh thì là bộ mặc định (haiku, sonnet). Thành viên tổ chức.",
		tags:        []string{"ai"},
		sdo:         sdo.AskModelsSDO{},
		auth:        true,
	})
	r.Put("/orgs/{org}/ai/ask-models", h.SetOrgAskModels, apiOp{
		summary:     "Set the Ask UNI models of an organization",
		description: "Owner/admin tổ chức thay bộ model được chọn rõ; thiếu models, null hoặc khóa lạ -> 400 ([] = chỉ Tự động), thành viên thường -> 403. Tự động (model mặc định của nền tảng) luôn dùng được, không theo công tắc này. Không đổi gì thì không ghi audit; có đổi thì ghi organization.ask_models_changed.",
		tags:        []string{"ai"},
		sdi:         sdi.AskModelsSDI{},
		sdo:         sdo.AskModelsSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/ai/usage", h.OrganizationAiUsage, apiOp{
		summary:     "Organization AI usage",
		description: "Như trên, mọi workspace của tổ chức, có workspace_id trên mỗi dòng. Owner/admin tổ chức.",
		tags:        []string{"ai"},
		sdo:         sdo.AiUsageSDO{},
		auth:        true,
	})
}

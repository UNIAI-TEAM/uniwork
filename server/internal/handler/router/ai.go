package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai — the AI gateway's HTTP surface (F-09): Ask UNI, its
// conversations, and usage. Requires Bearer. Every read runs as the caller;
// there is no way to ask on someone else's behalf.
//
//	GET    /api/v1/workspaces/{workspaceID}/ai/capabilities
//	POST   /api/v1/workspaces/{workspaceID}/ai/ask
//	GET    /api/v1/workspaces/{workspaceID}/ai/conversations
//	GET    /api/v1/ai/conversations/{conversationID}/messages
//	DELETE /api/v1/ai/conversations/{conversationID}
//	GET    /api/v1/workspaces/{workspaceID}/ai/usage
//	GET    /api/v1/orgs/{orgID}/ai/usage
func registerAI(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/ai/capabilities", h.AiCapabilities, apiOp{
		summary:     "AI capabilities",
		description: "enabled=false khi server không có provider (client ẩn nút); quota token AI của tổ chức trong tháng.",
		tags:        []string{"ai"},
		sdo:         sdo.AiCapabilitiesSDO{},
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
	r.Get("/workspaces/{workspaceID}/ai/conversations", h.ListAiConversations, apiOp{
		summary:     "My conversations",
		description: "20 hội thoại gần nhất của chính người gọi trong workspace.",
		tags:        []string{"ai"},
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
	r.Get("/workspaces/{workspaceID}/ai/usage", h.WorkspaceAiUsage, apiOp{
		summary:     "Workspace AI usage",
		description: "Tổng hợp theo ngày × capability × actor_kind. Query from, to (RFC3339 hoặc YYYY-MM-DD; mặc định 30 ngày). Owner/admin workspace.",
		tags:        []string{"ai"},
		sdo:         sdo.AiUsageSDO{},
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

package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// uniworkChatErrs is the shared error list of the three UniWork AI routes
// (G6-03a, contract-p0 §4): they answer the same codes whatever credential
// mounted them.
const uniworkChatErrs = " 400 invalid_request (vai trò system/developer, lượt sai dạng, tool_call_id lạ), " +
	"403 entitlement_required / office_capability_off (fields.capability = ai_uniwork hoặc ai_uniwork_<format>), " +
	"404 tài liệu không đọc được, 409 conversation_expired, " +
	"413 payload_too_large (body > 1 MiB) / ai_tool_result_too_large, " +
	"429 ai_uniwork_busy (Retry-After: 5) hoặc ai_rate_limited, 502 ai_provider_error, 503 ai_disabled, 504 ai_provider_timeout."

// tag: ai — the UniWork AI façade (G6-03a): one agent turn per call, with the
// conversation held by the server. The client sends the new question, or the
// tool results of the call the server just made; it never sends history (rule
// 7). Every answer carries X-UniWork-AI-Conversation (A12); stream=true
// answers one SSE chunk then [DONE] (A14). Both routes take the session
// credential (web bearer or desktop device token); the frame token's own
// route is registered in office_frame_ai.go.
//
//	POST /api/v1/orgs/{orgID}/ai/uniwork/chat/completions
//	POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions
func registerAIUniwork(r api, h Routes) {
	r.Post("/orgs/{orgID}/ai/uniwork/chat/completions", h.AiUniworkChatCompletions, apiOp{
		summary: "UniWork AI chat, one turn in an organization",
		description: "Một lượt UniWork AI cho phiên (web hoặc app desktop): câu hỏi mới của người dùng, " +
			"hoặc kết quả công cụ trả cho tool call server vừa phát. Hội thoại do server giữ — client gửi id " +
			"ở header X-UniWork-AI-Conversation và nhận id của lượt ở mọi câu trả lời; không gửi header nghĩa là " +
			"bắt đầu hội thoại mới cho cùng (người dùng, tổ chức, module). Module của tệp cục bộ đi trong body " +
			"(trường module, tùy chọn)." + uniworkChatErrs,
		tags: []string{"ai"},
		sdi:  sdi.AiUniworkChatCompletionsSDI{},
		sdo:  sdo.AiUniworkChatCompletionsSDO{},
		auth: true,
	})
	r.Post("/documents/{documentID}/ai/uniwork/chat/completions", h.AiUniworkDocumentChatCompletions, apiOp{
		summary: "UniWork AI chat, one turn for a document",
		description: "Một lượt UniWork AI cho tài liệu UniWork mở trên app desktop (OQ-P2, A10): tổ chức, " +
			"workspace và module suy từ tài liệu (trường module trong body bị bỏ qua), quyền đọc được kiểm lại " +
			"mỗi request — mất quyền thì hội thoại của người đó cho tài liệu bị dọn và lượt bị từ chối." + uniworkChatErrs,
		tags: []string{"ai"},
		sdi:  sdi.AiUniworkChatCompletionsSDI{},
		sdo:  sdo.AiUniworkChatCompletionsSDO{},
		auth: true,
	})
}

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// uniworkChatErrs is the shared error list of the three UniWork AI routes
// (G6-03a, contract-p0 §4; G6-03b §2.3): they answer the same codes whatever
// credential mounted them.
const uniworkChatErrs = " 400 invalid_request (vai trò system/developer, lượt sai dạng, tool_call_id lạ, lượt tool-result thiếu header X-UniWork-AI-Run), " +
	"402 credits_exhausted (fields.meter = ai.tokens), " +
	"403 entitlement_required / office_capability_off (fields.capability = ai_uniwork hoặc ai_uniwork_<format>), " +
	"404 tài liệu không đọc được, 409 conversation_expired / run_limit_reached (fields.limit = model_calls | tool_rounds) / run_expired, " +
	"413 payload_too_large (body > 1 MiB) / ai_tool_result_too_large, " +
	"429 ai_uniwork_busy (Retry-After: 5) hoặc ai_rate_limited (bucket ai-uniwork: 60 lượt/phút/người, Retry-After: 60), " +
	"502 ai_provider_error, 503 ai_disabled, 504 ai_provider_timeout."

// uniworkRunWire is the run id on the wire (G6-03b §2). The server names the
// run of a turn on every answer of that run, an error answer included, and the
// client sends the id back on every later turn (tool result, retry, next
// question). A refusal that precedes the run — 402, 403, 404, 409
// conversation_expired, or the 429 of the limiter, which runs first — names no
// run, and the client keeps the id it already holds (Q6).
const uniworkRunWire = " Mọi câu trả lời của một run mang header X-UniWork-AI-Run (ULID của run) — kể cả câu trả lời lỗi 429/409/402/502/504 " +
	"khi run đã tồn tại; client gửi lại id đó ở mọi lượt tiếp theo (tool result, retry, câu hỏi tiếp), và một lượt tool-result thiếu header là 400 invalid_request. " +
	"Lượt bị từ chối trước khi run tồn tại (402, 403, 404, 409 conversation_expired, 429 của limiter) không mang header run; client giữ id đang có."

// tag: ai — the UniWork AI façade (G6-03a): one agent turn per call, with the
// conversation held by the server. The client sends the new question, or the
// tool results of the call the server just made; it never sends history (rule
// 7). Every answer carries X-UniWork-AI-Conversation (A12) and, from G6-03b,
// the run's X-UniWork-AI-Run (A3); stream=true answers one SSE chunk then
// [DONE] (A14). Both routes take the session credential (web bearer or desktop
// device token); the frame token's own route is registered in
// office_frame_ai.go. On the ai-uniwork bucket, one 60/min budget per person
// across the three routes (G6-03b §5.1).
//
//	POST /api/v1/orgs/{orgID}/ai/uniwork/chat/completions
//	POST /api/v1/documents/{documentID}/ai/uniwork/chat/completions
func registerAIUniwork(r api, h Routes, limiter func(http.Handler) http.Handler) {
	r.With(limiter).Post("/orgs/{orgID}/ai/uniwork/chat/completions", h.AiUniworkChatCompletions, apiOp{
		summary: "UniWork AI chat, one turn in an organization",
		description: "Một lượt UniWork AI cho phiên (web hoặc app desktop): câu hỏi mới của người dùng, " +
			"hoặc kết quả công cụ trả cho tool call server vừa phát. Hội thoại do server giữ — client gửi id " +
			"ở header X-UniWork-AI-Conversation và nhận id của lượt ở mọi câu trả lời; không gửi header nghĩa là " +
			"bắt đầu hội thoại mới cho cùng (người dùng, tổ chức, module). Module của tệp cục bộ đi trong body " +
			"(trường module, tùy chọn)." + uniworkRunWire + uniworkChatErrs,
		tags: []string{"ai"},
		sdi:  sdi.AiUniworkChatCompletionsSDI{},
		sdo:  sdo.AiUniworkChatCompletionsSDO{},
		auth: true,
	})
	r.With(limiter).Post("/documents/{documentID}/ai/uniwork/chat/completions", h.AiUniworkDocumentChatCompletions, apiOp{
		summary: "UniWork AI chat, one turn for a document",
		description: "Một lượt UniWork AI cho tài liệu UniWork mở trên app desktop (OQ-P2, A10): tổ chức, " +
			"workspace và module suy từ tài liệu (trường module trong body bị bỏ qua), quyền đọc được kiểm lại " +
			"mỗi request — mất quyền thì hội thoại của người đó cho tài liệu bị dọn và lượt bị từ chối." + uniworkRunWire + uniworkChatErrs,
		tags: []string{"ai"},
		sdi:  sdi.AiUniworkChatCompletionsSDI{},
		sdo:  sdo.AiUniworkChatCompletionsSDO{},
		auth: true,
	})
}

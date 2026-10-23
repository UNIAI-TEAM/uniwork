package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai — BYOK pass-through proxy for the web host (UNI-1008, ADR 0029).
// The client speaks the vendor's wire format; the server injects the
// caller's stored key, picks the endpoint from its provider table and
// streams the vendor's bytes back. Requires Bearer; 60/min per person.
//
//	POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/chat/completions
//	POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/messages
//	POST /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/generate
//	GET  /api/v1/orgs/{orgID}/ai/byok/{aiProvider}/models
func registerAIBYOK(r api, h Routes, limit func(http.Handler) http.Handler) {
	const errs = " Lỗi: 403 entitlement_required (gói thiếu office.ai_byok), 404 credential_missing, 400 provider_not_supported / base_url_refused / invalid_request, 424 provider_auth_failed (nhà cung cấp từ chối khóa), 429 (giới hạn tốc độ hoặc của nhà cung cấp), 502 provider_unreachable. Lỗi khác của nhà cung cấp chuyển nguyên trạng thái và thân (đã che khóa)."
	b := r.With(limit)
	b.Post("/orgs/{orgID}/ai/byok/{aiProvider}/chat/completions", h.AiByokChatCompletions, apiOp{
		summary:     "BYOK proxy: OpenAI chat completions",
		description: "Nhà cung cấp giao thức openai-compatible. Thân OpenAI nguyên bản (≤ 16 MiB), stream=true trả SSE." + errs,
		tags:        []string{"ai"},
		sdi:         sdi.AiByokChatCompletionsSDI{},
		sdo:         sdo.AiByokVendorSDO{},
		auth:        true,
	})
	b.Post("/orgs/{orgID}/ai/byok/{aiProvider}/messages", h.AiByokMessages, apiOp{
		summary:     "BYOK proxy: Anthropic messages",
		description: "Nhà cung cấp giao thức anthropic. Thân Messages nguyên bản (≤ 16 MiB)." + errs,
		tags:        []string{"ai"},
		sdi:         sdi.AiByokMessagesSDI{},
		sdo:         sdo.AiByokVendorSDO{},
		auth:        true,
	})
	b.Post("/orgs/{orgID}/ai/byok/{aiProvider}/generate", h.AiByokGenerate, apiOp{
		summary:     "BYOK proxy: Gemini generate",
		description: "Nhà cung cấp giao thức gemini. {model, stream, request}; request là GenerateContentRequest nguyên bản (≤ 16 MiB)." + errs,
		tags:        []string{"ai"},
		sdi:         sdi.AiByokGenerateSDI{},
		sdo:         sdo.AiByokVendorSDO{},
		auth:        true,
	})
	b.Get("/orgs/{orgID}/ai/byok/{aiProvider}/models", h.AiByokModels, apiOp{
		summary:     "BYOK proxy: vendor model list",
		description: "Danh sách model của nhà cung cấp, JSON nguyên bản." + errs,
		tags:        []string{"ai"},
		sdo:         sdo.AiByokVendorSDO{},
		auth:        true,
	})
}

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai — the UniWork cloud tools for Office (GO-A7, ADR 0029): search,
// image generation, media analysis and transcription, paid in the
// organization's ai.tokens credits. Requires Bearer (web session or desktop
// device). Each tool call is limited to 20 per minute per signed-in person.
// Media arrives as bytes; the server never fetches a URL for these routes.
//
//	GET  /api/v1/orgs/{orgID}/ai/cloud
//	POST /api/v1/orgs/{orgID}/ai/cloud/search
//	POST /api/v1/orgs/{orgID}/ai/cloud/images
//	POST /api/v1/orgs/{orgID}/ai/cloud/media/analyze
//	POST /api/v1/orgs/{orgID}/ai/cloud/transcribe
func registerAICloud(r api, h Routes, toolLimit func(http.Handler) http.Handler) {
	const errs = " 403 entitlement_required (gói thiếu office.ai_cloud), 402 credits_exhausted, 503 cloud_unavailable, 502 ai_provider_error, 429 khi vượt 20 lần/phút."
	r.Get("/orgs/{orgID}/ai/cloud", h.AiCloudStatus, apiOp{
		summary:     "Office cloud AI status",
		description: "Công cụ AI đám mây nào dùng được và credit ai.tokens của kỳ. Thành viên tổ chức luôn nhận 200: gói thiếu office.ai_cloud → enabled=false, reason=entitlement_required.",
		tags:        []string{"ai"},
		sdo:         sdo.AiCloudStatusSDO{},
		auth:        true,
	})
	r.Group(func(tools api) {
		tools = tools.With(toolLimit)
		tools.Post("/orgs/{orgID}/ai/cloud/search", h.AiCloudSearch, apiOp{
			summary:     "Office cloud search",
			description: "Tìm web hoặc ảnh; 500 token-equivalent mỗi lần." + errs,
			tags:        []string{"ai"},
			sdi:         sdi.AiCloudSearchSDI{},
			sdo:         sdo.AiCloudSearchSDO{},
			auth:        true,
		})
		tools.Post("/orgs/{orgID}/ai/cloud/images", h.AiCloudImages, apiOp{
			summary:     "Office cloud image generation",
			description: "Tạo ảnh từ mô tả và tối đa 4 ảnh tham chiếu; 4000 token-equivalent mỗi ảnh. Body ≤ 44 MiB." + errs,
			tags:        []string{"ai"},
			sdi:         sdi.AiCloudImageSDI{},
			sdo:         sdo.AiCloudImageSDO{},
			auth:        true,
		})
		tools.Post("/orgs/{orgID}/ai/cloud/media/analyze", h.AiCloudAnalyzeMedia, apiOp{
			summary:     "Office cloud media analysis",
			description: "Phân tích 1..4 tệp (tổng ≤ 25 MiB) theo yêu cầu; tính token thật. Chỉ nhận image/png, jpeg, webp, gif; audio/mpeg, wav, mp4, webm; video/mp4, webm; application/pdf — loại khác, hoặc loại mô hình không đọc được, trả 422 media_unsupported." + errs,
			tags:        []string{"ai"},
			sdi:         sdi.AiCloudAnalyzeSDI{},
			sdo:         sdo.AiCloudTextSDO{},
			auth:        true,
		})
		tools.Post("/orgs/{orgID}/ai/cloud/transcribe", h.AiCloudTranscribe, apiOp{
			summary:     "Office cloud transcription",
			description: "Chuyển âm thanh (≤ 25 MiB) thành văn bản; 1000 token-equivalent mỗi phút bắt đầu, tính theo thời lượng nhà cung cấp báo hoặc ước lượng từ dung lượng tệp." + errs,
			tags:        []string{"ai"},
			sdi:         sdi.AiCloudTranscribeSDI{},
			sdo:         sdo.AiCloudTextSDO{},
			auth:        true,
		})
	})
}

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// officeFrameAILimits are the per-person budgets of the frame AI routes: the
// same buckets and numbers as GO-A7's session routes (ADR 0029 D6).
type officeFrameAILimits struct {
	credentials, byok, cloud func(http.Handler) http.Handler
}

// tag: ai — GO-A7's AI routes on the web Office frame token (UNI-1014,
// CONTRACT C16, ADR 0029 D9). The frame calls them itself, same origin, with
// `Authorization: Bearer <frame token>` and no cookie; a session token is
// refused. Behind the frame auth (the token's document must be {documentID},
// the token module's office_*_web flag must be on), each request rechecks
// that the token's user may still view the document, then runs GO-A7's
// handlers for the token's user and organization: the same entitlement
// (office.ai_byok / office.ai_cloud), credits, audit, errors and per-person
// rate-limit buckets as the /orgs/{orgID}/ai/... session routes, which share
// the budget. Credentials are the person's own rows in the organization, so
// view access is enough for PUT/DELETE too. SSE passes through unchanged.
//
//	GET    /api/v1/office-frame/documents/{documentID}/ai/credentials
//	PUT    /api/v1/office-frame/documents/{documentID}/ai/credentials/{aiProvider}
//	DELETE /api/v1/office-frame/documents/{documentID}/ai/credentials/{aiProvider}
//	POST   /api/v1/office-frame/documents/{documentID}/ai/byok/{aiProvider}/chat/completions
//	POST   /api/v1/office-frame/documents/{documentID}/ai/byok/{aiProvider}/messages
//	POST   /api/v1/office-frame/documents/{documentID}/ai/byok/{aiProvider}/generate
//	GET    /api/v1/office-frame/documents/{documentID}/ai/byok/{aiProvider}/models
//	GET    /api/v1/office-frame/documents/{documentID}/ai/cloud
//	POST   /api/v1/office-frame/documents/{documentID}/ai/cloud/search
//	POST   /api/v1/office-frame/documents/{documentID}/ai/cloud/images
//	POST   /api/v1/office-frame/documents/{documentID}/ai/cloud/media/analyze
//	POST   /api/v1/office-frame/documents/{documentID}/ai/cloud/transcribe
func registerOfficeFrameAI(r api, h Routes, flags *featureflag.Service, frameAuth func(http.Handler) http.Handler, limits officeFrameAILimits) {
	if frameAuth == nil {
		frameAuth = frameAuthNotFound
	}
	const frame = "Khung Office web, chỉ token khung (Bearer); token phải của đúng {documentID}, người dùng của token còn quyền xem tài liệu (kiểm lại mỗi request), cờ module của token bật. Người dùng và tổ chức lấy từ token. "
	const credErrs = " 503 ai_credentials_unavailable khi máy chủ chưa cấu hình AI_CREDENTIAL_KEY."
	const byokErrs = " Lỗi: 403 entitlement_required (gói thiếu office.ai_byok), 404 credential_missing, 400 provider_not_supported / base_url_refused / invalid_request, 424 provider_auth_failed, 429 (giới hạn 60/phút/người chung với route phiên, hoặc của nhà cung cấp), 502 provider_unreachable."
	const cloudErrs = " 403 entitlement_required (gói thiếu office.ai_cloud), 402 credits_exhausted, 503 cloud_unavailable, 502 ai_provider_error, 429 khi vượt 20 lần/phút/người (chung với route phiên)."
	// Auth first so the flags and the budgets see the token's user.
	f := r.With(frameAuth, mw.RequireFeatureFlag(flags, "documents"))
	const base = "/office-frame/documents/{documentID}/ai"

	cred := f.With(limits.credentials)
	cred.Get(base+"/credentials", h.OfficeFrameAiCredentialsList, apiOp{
		summary:     "Frame: list my AI provider keys",
		description: frame + "Như GET /orgs/{orgID}/ai/credentials cho tổ chức của token: chỉ key_hint, không bao giờ trả khóa." + credErrs,
		tags:        []string{"ai"}, sdo: sdo.AICredentialListSDO{}, auth: true,
	})
	cred.Put(base+"/credentials/{aiProvider}", h.OfficeFrameAiCredentialSave, apiOp{
		summary:     "Frame: save my AI provider key",
		description: frame + "Như PUT /orgs/{orgID}/ai/credentials/{aiProvider}: tạo (201) hoặc thay (200); cần office.ai_byok (403 entitlement_required); 400 provider_not_supported, 400 base_url_refused." + credErrs,
		tags:        []string{"ai"}, sdi: sdi.SaveAICredentialSDI{}, sdo: sdo.AICredentialSDO{}, auth: true,
	})
	cred.Delete(base+"/credentials/{aiProvider}", h.OfficeFrameAiCredentialDelete, apiOp{
		summary:     "Frame: delete my AI provider key",
		description: frame + "Như DELETE /orgs/{orgID}/ai/credentials/{aiProvider}: không cần quyền gói; 404 credential_missing khi chưa lưu." + credErrs,
		tags:        []string{"ai"}, status: http.StatusNoContent, auth: true,
	})

	byok := f.With(limits.byok)
	byok.Post(base+"/byok/{aiProvider}/chat/completions", h.OfficeFrameAiByokChatCompletions, apiOp{
		summary:     "Frame: BYOK proxy, OpenAI chat completions",
		description: frame + "Thân OpenAI nguyên bản (≤ 16 MiB), stream=true trả SSE." + byokErrs,
		tags:        []string{"ai"}, sdi: sdi.AiByokChatCompletionsSDI{}, sdo: sdo.AiByokVendorSDO{}, auth: true,
	})
	byok.Post(base+"/byok/{aiProvider}/messages", h.OfficeFrameAiByokMessages, apiOp{
		summary:     "Frame: BYOK proxy, Anthropic messages",
		description: frame + "Thân Messages nguyên bản (≤ 16 MiB)." + byokErrs,
		tags:        []string{"ai"}, sdi: sdi.AiByokMessagesSDI{}, sdo: sdo.AiByokVendorSDO{}, auth: true,
	})
	byok.Post(base+"/byok/{aiProvider}/generate", h.OfficeFrameAiByokGenerate, apiOp{
		summary:     "Frame: BYOK proxy, Gemini generate",
		description: frame + "{model, stream, request}; request là GenerateContentRequest nguyên bản (≤ 16 MiB)." + byokErrs,
		tags:        []string{"ai"}, sdi: sdi.AiByokGenerateSDI{}, sdo: sdo.AiByokVendorSDO{}, auth: true,
	})
	byok.Get(base+"/byok/{aiProvider}/models", h.OfficeFrameAiByokModels, apiOp{
		summary:     "Frame: BYOK proxy, vendor model list",
		description: frame + "Danh sách model của nhà cung cấp, JSON nguyên bản." + byokErrs,
		tags:        []string{"ai"}, sdo: sdo.AiByokVendorSDO{}, auth: true,
	})

	f.Get(base+"/cloud", h.OfficeFrameAiCloudStatus, apiOp{
		summary:     "Frame: Office cloud AI status",
		description: frame + "Như GET /orgs/{orgID}/ai/cloud: công cụ nào dùng được và credit ai.tokens của kỳ; gói thiếu office.ai_cloud → enabled=false, reason=entitlement_required.",
		tags:        []string{"ai"}, sdo: sdo.AiCloudStatusSDO{}, auth: true,
	})
	tools := f.With(limits.cloud)
	tools.Post(base+"/cloud/search", h.OfficeFrameAiCloudSearch, apiOp{
		summary:     "Frame: Office cloud search",
		description: frame + "Tìm web hoặc ảnh; 500 token-equivalent mỗi lần." + cloudErrs,
		tags:        []string{"ai"}, sdi: sdi.AiCloudSearchSDI{}, sdo: sdo.AiCloudSearchSDO{}, auth: true,
	})
	tools.Post(base+"/cloud/images", h.OfficeFrameAiCloudImages, apiOp{
		summary:     "Frame: Office cloud image generation",
		description: frame + "Tạo ảnh từ mô tả và tối đa 4 ảnh tham chiếu; 4000 token-equivalent mỗi ảnh. Body ≤ 44 MiB." + cloudErrs,
		tags:        []string{"ai"}, sdi: sdi.AiCloudImageSDI{}, sdo: sdo.AiCloudImageSDO{}, auth: true,
	})
	tools.Post(base+"/cloud/media/analyze", h.OfficeFrameAiCloudAnalyzeMedia, apiOp{
		summary:     "Frame: Office cloud media analysis",
		description: frame + "Phân tích 1..4 tệp (tổng ≤ 25 MiB); tính token thật; loại tệp ngoài danh sách trả 422 media_unsupported." + cloudErrs,
		tags:        []string{"ai"}, sdi: sdi.AiCloudAnalyzeSDI{}, sdo: sdo.AiCloudTextSDO{}, auth: true,
	})
	tools.Post(base+"/cloud/transcribe", h.OfficeFrameAiCloudTranscribe, apiOp{
		summary:     "Frame: Office cloud transcription",
		description: frame + "Chuyển âm thanh (≤ 25 MiB) thành văn bản; 1000 token-equivalent mỗi phút bắt đầu." + cloudErrs,
		tags:        []string{"ai"}, sdi: sdi.AiCloudTranscribeSDI{}, sdo: sdo.AiCloudTextSDO{}, auth: true,
	})
}

// frameAuthNotFound stands in for the frame auth when the server has no
// frame token service: every frame route answers 404.
func frameAuthNotFound(http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"not found"}}`))
	})
}

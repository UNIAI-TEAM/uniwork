package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: ai-credentials — the caller's own AI provider keys for the Office web
// host (UNI-1008, ADR 0029).
//
//	GET    /api/v1/orgs/{orgID}/ai/credentials
//	PUT    /api/v1/orgs/{orgID}/ai/credentials/{aiProvider}
//	DELETE /api/v1/orgs/{orgID}/ai/credentials/{aiProvider}
//
// Personal rows inside one organization; a non-member gets 404. No answer
// carries a key. limit is the per-identity budget (30/min).
func registerAICredentials(r api, h Routes, limit func(http.Handler) http.Handler) {
	r.With(limit).Get("/orgs/{orgID}/ai/credentials", h.ListAICredentials, apiOp{
		summary:     "List my AI provider keys",
		description: "Khóa AI riêng của người gọi trong tổ chức (chỉ key_hint, không bao giờ trả khóa) và danh sách nhà cung cấp có thể thêm. 503 ai_credentials_unavailable khi máy chủ chưa cấu hình AI_CREDENTIAL_KEY.",
		tags:        []string{"ai-credentials"},
		sdo:         sdo.AICredentialListSDO{},
		auth:        true,
	})
	r.With(limit).Put("/orgs/{orgID}/ai/credentials/{aiProvider}", h.SaveAICredential, apiOp{
		summary:     "Save my AI provider key",
		description: "Tạo (201) hoặc thay (200) khóa của một nhà cung cấp. Cần quyền gói office.ai_byok (403 entitlement_required); 400 provider_not_supported, 400 base_url_refused.",
		tags:        []string{"ai-credentials"},
		sdi:         sdi.SaveAICredentialSDI{},
		sdo:         sdo.AICredentialSDO{},
		auth:        true,
	})
	r.With(limit).Delete("/orgs/{orgID}/ai/credentials/{aiProvider}", h.DeleteAICredential, apiOp{
		summary:     "Delete my AI provider key",
		description: "Xóa khóa đã lưu; xóa không cần quyền gói. 404 credential_missing khi chưa lưu.",
		tags:        []string{"ai-credentials"},
		status:      http.StatusNoContent,
		auth:        true,
	})
}

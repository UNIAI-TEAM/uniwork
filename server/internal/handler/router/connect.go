package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: connect — the web side of the MCP connector (ADR 0031): consent, a
// person's connected apps, an organization's grants and its switch. Requires
// Bearer; the OAuth protocol routes are in mcp.go, outside the api wrapper.
//
//	GET    /api/v1/auth/connect/attempts/{attemptID}
//	POST   /api/v1/auth/connect/attempts/{attemptID}
//	GET    /api/v1/me/connected-apps
//	DELETE /api/v1/me/connected-apps/{grantID}
//	GET    /api/v1/orgs/{org}/connected-apps
//	DELETE /api/v1/orgs/{org}/connected-apps/{grantID}
//	GET    /api/v1/orgs/{org}/mcp-policy
//	PUT    /api/v1/orgs/{org}/mcp-policy
//	PUT    /api/v1/orgs/{org}/mcp-policy/write
func registerConnect(v1 api, h Routes) {
	tags := []string{"connect"}
	v1.Get("/auth/connect/attempts/{attemptID}", h.McpConsent, apiOp{
		summary:     "Show MCP consent",
		description: "Đọc yêu cầu kết nối của client AI và phát token CSRF mới; GET không phê duyệt.",
		tags:        tags, sdo: sdo.McpConsentSDO{}, auth: true,
	})
	v1.Post("/auth/connect/attempts/{attemptID}", h.McpConsentCommand, apiOp{
		summary:     "Approve or cancel MCP consent",
		description: "Đồng ý (chọn tổ chức) hoặc hủy; trả URL quay lại client AI.",
		tags:        tags, sdi: sdi.McpConsentSDI{}, sdo: sdo.McpConsentResultSDO{}, auth: true,
	})
	v1.Get("/me/connected-apps", h.MyConnectedApps, apiOp{
		summary:     "List my connected AI apps",
		description: "Grant MCP đang hiệu lực của chính người dùng.",
		tags:        tags, sdo: sdo.McpGrantListSDO{}, auth: true,
	})
	v1.Delete("/me/connected-apps/{grantID}", h.RevokeMyConnectedApp, apiOp{
		summary:     "Revoke my connected AI app",
		description: "Thu hồi grant và mọi token của nó.",
		tags:        tags, sdo: sdo.StatusSDO{}, auth: true,
	})
	v1.Get("/orgs/{org}/connected-apps", h.OrgConnectedApps, apiOp{
		summary:     "List the organization's connected AI apps",
		description: "Owner/admin: mọi grant MCP trong tổ chức.",
		tags:        tags, sdo: sdo.McpGrantListSDO{}, auth: true,
	})
	v1.Delete("/orgs/{org}/connected-apps/{grantID}", h.RevokeOrgConnectedApp, apiOp{
		summary:     "Revoke a connected AI app in the organization",
		description: "Owner/admin thu hồi một grant.",
		tags:        tags, sdo: sdo.StatusSDO{}, auth: true,
	})
	v1.Get("/orgs/{org}/mcp-policy", h.OrgMcpPolicy, apiOp{
		summary:     "Read the MCP connector switch",
		description: "Owner/admin: trạng thái connector và URL /mcp.",
		tags:        tags, sdo: sdo.McpPolicySDO{}, auth: true,
	})
	v1.Put("/orgs/{org}/mcp-policy", h.SetOrgMcpPolicy, apiOp{
		summary:     "Turn the MCP connector on or off",
		description: "Owner/admin bật/tắt connector; tắt chặn ngay, không xóa grant.",
		tags:        tags, sdi: sdi.McpPolicySDI{}, sdo: sdo.McpPolicySDO{}, auth: true,
	})
	v1.Put("/orgs/{org}/mcp-policy/write", h.SetOrgMcpWritePolicy, apiOp{
		summary:     "Turn write access for AI apps on or off",
		description: "Owner/admin: cho phép ứng dụng AI đã kết nối tạo và sửa (ADR 0033). Cần connector đang bật.",
		tags:        tags, sdi: sdi.McpWritePolicySDI{}, sdo: sdo.McpPolicySDO{}, auth: true,
	})
}

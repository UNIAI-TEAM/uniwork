package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: drive - Google Drive connector (UNI-2172): OAuth 2.0 connection
// management, refresh, and disconnect (card B2 / UNI-2178).
//
//	POST   /api/v1/workspaces/{workspaceID}/drive-connections/google/start
//	GET    /api/v1/workspaces/{workspaceID}/drive-connections
//	DELETE /api/v1/workspaces/{workspaceID}/drive-connections/{connectionID}
//	GET    /api/v1/drive-connections/google/callback
func registerDriveConnections(r api, h Routes, flags *featureflag.Service, connectLimit func(http.Handler) http.Handler) {
	d := r.With(mw.RequireFeatureFlag(flags, "drive_connector"))
	d.With(connectLimit).Post("/workspaces/{workspaceID}/drive-connections/google/start", h.StartDriveGoogleOAuth, apiOp{
		summary: "Start Google Drive OAuth 2.0 connection",
		description: "Phát hành URL consent OAuth 2.0 cua Google Drive (scope `openid`, `email`, `drive.file`) cho thành viên workspace " +
			"và đat cookie HttpOnly nonce trên path callback. Khi truyền `reconnect_connection_id`, state niêm phong khóa vào đúng kết nối và `google_sub` cũ (spec §5.2).",
		tags: []string{"drive"}, sdi: sdi.StartDriveGoogleOAuthSDI{}, sdo: sdo.DriveOAuthStartSDO{}, auth: true,
	})
	d.Get("/workspaces/{workspaceID}/drive-connections", h.ListDriveConnections, apiOp{
		summary: "List caller's Google Drive connections",
		description: "Danh sách kết nối Google Drive (`active` và `needs_reconnect`) của người gọi trong tổ chức của workspace, " +
			"kèm `linked_file_count` số tệp đang liên kết vào việc trong workspace hiện tại (spec §5.3).",
		tags: []string{"drive"}, sdo: sdo.DriveConnectionListSDO{}, auth: true,
	})
	d.Delete("/workspaces/{workspaceID}/drive-connections/{connectionID}", h.DisconnectDriveConnection, apiOp{
		summary: "Disconnect a Google Drive connection",
		description: "Ngắt kết nối Google Drive của người gọi trong tổ chức của workspace, xóa token, chuyển refresh token sang hàng đợi thu hồi `drive_grant_revocations` " +
			"và đánh dấu `drive_file_access` của kết nối đó là `disconnected` (spec §5.3).",
		tags: []string{"drive"}, sdo: sdo.StatusSDO{}, auth: true,
	})
}

func registerDriveGoogleCallback(r api, h Routes, credentialLimit func(http.Handler) http.Handler) {
	r.With(credentialLimit).Get("/drive-connections/google/callback", h.CompleteDriveGoogleOAuth, apiOp{
		summary: "Complete Google Drive OAuth 2.0 callback",
		description: "Đích redirect OAuth 2.0 của Google Drive. Kiểm tra state niêm phong và cookie nonce, đổi authorization code lấy token, " +
			"xác minh `id_token` bằng OIDC (`email_verified`), kiểm tra scope `drive.file` và trả về trang HTML nhỏ gửi `postMessage({type: \"uniwork:drive-oauth\", ok, code})` về cửa sổ mở (spec §5.2). " +
			"`code` là một trong `connected`, `reconnected`, `consent_required`, `scope_not_granted`, `account_mismatch`, `state_invalid`, `retry_connect`, `blocked_by_workspace_admin`, `access_denied`, `provider_error`. " +
			"Giới hạn 60 yêu cầu mỗi phút theo địa chỉ.",
		tags:     []string{"drive"},
		sdi:      sdi.DriveGoogleCallbackSDI{},
		produces: "text/html",
	})
}

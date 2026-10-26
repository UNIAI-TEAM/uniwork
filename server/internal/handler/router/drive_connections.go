package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: drive - Google Drive connector (UNI-2172): OAuth 2.0 connection
// management, refresh, disconnect, picker token, and file references
// (cards B2 / UNI-2178, B4 / UNI-2180).
//
//	POST   /api/v1/workspaces/{workspaceID}/drive-connections/google/start
//	GET    /api/v1/workspaces/{workspaceID}/drive-connections
//	DELETE /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}
//	POST   /api/v1/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token
//	GET    /api/v1/drive-connections/google/callback
//	POST   /api/v1/workspaces/{workspaceID}/drive-files
//	GET    /api/v1/workspaces/{workspaceID}/drive-files
//	GET    /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}
//	DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}
//	POST   /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access
//	PUT    /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access
//	POST   /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind
//	GET    /api/v1/tasks/{taskID}/drive-files
//	DELETE /api/v1/tasks/{taskID}/drive-files/{driveFileID}
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
	d.Delete("/workspaces/{workspaceID}/drive-connections/{driveConnectionID}", h.DisconnectDriveConnection, apiOp{
		summary: "Disconnect a Google Drive connection",
		description: "Ngắt kết nối Google Drive của người gọi trong tổ chức của workspace, xóa token, chuyển refresh token sang hàng đợi thu hồi `drive_grant_revocations` " +
			"và đánh dấu `drive_file_access` của kết nối đó là `disconnected` (spec §5.3).",
		tags: []string{"drive"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	d.Post("/workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token", h.GetDrivePickerToken, apiOp{
		summary: "Get short-lived Google Picker token",
		description: "Phát hành `access_token` ngắn hạn (scope `drive.file`) từ kết nối Google Drive `active` của chính người gọi để trình duyệt mở Google Picker (spec §7.1, §17.5). " +
			"Không bao giờ trả về `refresh_token`. Từ chối 403 `forbidden` với phiên desktop native, 404 nếu kết nối không tồn tại hoặc thuộc người khác, " +
			"409 `drive_reconnect_required` khi refresh thất bại vì token đã bị thu hồi hoặc hết hạn, và 503 `drive_unavailable` khi Google lỗi tạm thời.",
		tags: []string{"drive"}, sdo: sdo.DrivePickerTokenSDO{}, auth: true,
	})
	d.Post("/workspaces/{workspaceID}/drive-files", h.LinkDriveFiles, apiOp{
		summary: "Link Google Drive files to workspace or task",
		description: "Liên kết 1..20 tệp Google Drive vào workspace (và tùy chọn gắn vào công việc `task_id` trong cùng workspace) bằng kết nối `active` của chính người gọi (spec §7.2, §6.3). " +
			"Mỗi tệp được kiểm tra qua Google Drive `files.get` trong transaction độc lập và trả kết quả từng tệp (`linked`, `already_linked` hoặc `error` kèm `error_code` = `not_found_or_not_shared`, `auth_failed`, `provider_unavailable`).",
		tags: []string{"drive"}, sdi: sdi.LinkDriveFilesSDI{}, sdo: sdo.DriveFileLinkResultsSDO{}, auth: true,
	})
	d.Get("/workspaces/{workspaceID}/drive-files", h.ListDriveFiles, apiOp{
		summary: "List caller's Google Drive file references",
		description: "Danh sách tệp Google Drive mà người gọi có dòng `drive_file_access` trong workspace (visibility gate §7.6a: thư viện là của riêng mỗi người dùng), " +
			"kèm trạng thái đọc của người xem (`viewer_access`), số việc đang gắn (`used_in_count`) và tóm tắt số việc đã tạo từ tệp (`tasks_created`, spec §7.6, §8.8).",
		tags: []string{"drive"}, sdi: sdi.ListDriveFilesSDI{}, sdo: sdo.DriveFileListSDO{}, auth: true,
	})
	d.Get("/workspaces/{workspaceID}/drive-files/{driveFileID}", h.GetDriveFile, apiOp{
		summary: "Get a Google Drive file reference",
		description: "Chi tiết tệp Google Drive đã liên kết trong workspace (spec §7.6a, §7.7, §8.8), gồm danh sách công việc đang gắn mà người gọi có quyền xem (`used_in_tasks`) " +
			"và tối đa 10 lần tạo công việc từ tài liệu (`task_creations`). Trả 404 nếu người gọi không thấy tệp qua thư viện cá nhân hoặc qua công việc có gắn tệp.",
		tags: []string{"drive"}, sdo: sdo.DriveFileSDO{}, auth: true,
	})
	d.Delete("/workspaces/{workspaceID}/drive-files/{driveFileID}", h.UnlinkDriveFile, apiOp{
		summary: "Unlink a Google Drive file reference from workspace",
		description: "Bỏ liên kết tệp Google Drive khỏi workspace (`deleted_at = NOW()`) và gỡ toàn bộ liên kết công việc (`drive_file_task_links`) trong cùng transaction (spec §7.7). " +
			"Chỉ người đang gắn kết nối (`bound_by`), người liên kết ban đầu (`created_by`) hoặc quản trị viên workspace/tổ chức được phép thực hiện.",
		tags: []string{"drive"}, sdo: sdo.StatusSDO{}, auth: true,
	})
	d.Post("/workspaces/{workspaceID}/drive-files/{driveFileID}/access", h.GrantDriveFileAccess, apiOp{
		summary: "Grant caller's read access to a linked Google Drive file",
		description: "Ghi nhận quyền đọc `drive_file_access` của người gọi trên tệp Google Drive đã liên kết sau khi người gọi chọn tệp trong Google Picker `setFileIds` (spec §7.4, §6.3, W4 gaps §3). " +
			"Dùng cho trạng thái `unknown` hoặc `lost`; nếu dòng đã `granted` thì trả về 200 idempotent. Nếu người gọi là `bound_by` trên dòng `lost` và chọn kết nối khác thì đồng thời đổi kết nối gắn của tệp như `/rebind`.",
		tags: []string{"drive"}, sdi: sdi.GrantDriveFileAccessSDI{}, sdo: sdo.DriveFileSDO{}, auth: true,
	})
	d.Put("/workspaces/{workspaceID}/drive-files/{driveFileID}/access", h.ChangeDriveFileReadAccount, apiOp{
		summary: "Switch caller's read account on a linked Google Drive file",
		description: "Đổi kết nối Google Drive đọc riêng của người gọi trên dòng `drive_file_access` đang `granted` mà không thay đổi `connection_id` gắn của tệp (spec §6.3, W4 gaps §3). " +
			"Trả 409 `use_rebind` nếu người gọi là `bound_by` của tệp (dùng `POST .../rebind` để đổi tài khoản gắn).",
		tags: []string{"drive"}, sdi: sdi.GrantDriveFileAccessSDI{}, sdo: sdo.DriveFileSDO{}, auth: true,
	})
	d.Post("/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind", h.RebindDriveFile, apiOp{
		summary: "Rebind a Google Drive file reference to another connection",
		description: "Đổi kết nối Google Drive gắn của tệp (`drive_files.connection_id` và `bound_by`) sang kết nối `active` của người gọi và cập nhật dòng `drive_file_access` của người gọi (spec §6.2, §6.3, §7.7). " +
			"Giữ nguyên các dòng `drive_file_access` của thành viên khác.",
		tags: []string{"drive"}, sdi: sdi.RebindDriveFileSDI{}, sdo: sdo.DriveFileSDO{}, auth: true,
	})
	d.Get("/tasks/{taskID}/drive-files", h.ListTaskDriveFiles, apiOp{
		summary: "List Google Drive files attached to a task",
		description: "Danh sách thẻ tệp Google Drive đang gắn với công việc (spec §7.3, §8.8), kèm trạng thái đọc của người xem (`viewer_access`), URL mở Google Drive (`open_url`), " +
			"cờ quyền (`can_remove_from_task`, `can_propose`, `can_ask`) và tóm tắt công việc đã tạo từ tệp (`tasks_created`).",
		tags: []string{"drive"}, sdo: sdo.DriveTaskFileListSDO{}, auth: true,
	})
	d.Delete("/tasks/{taskID}/drive-files/{driveFileID}", h.RemoveTaskDriveFile, apiOp{
		summary:     "Detach a Google Drive file from a task",
		description: "Gỡ tệp Google Drive khỏi công việc (chỉ xóa dòng `drive_file_task_links`, giữ nguyên bản ghi `drive_files` trong thư viện của những người có `drive_file_access`; spec §7.3, §7.7).",
		tags:        []string{"drive"}, sdo: sdo.StatusSDO{}, auth: true,
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

package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// tag: documents — UNI-1305 item C, the documents home "other sources": files
// that live in Chat, Tasks, Meetings and Email Hub. Behind the `documents`
// flag like every documents route; each row and each byte passes the owning
// domain's own read gate.
//
//	GET  /api/v1/workspaces/{workspaceID}/documents/sources
//	GET  /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/download
//	POST /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/save
//	POST /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/office/frame-token (UNI-1869)
func registerDocumentSources(r api, h Routes, flags *featureflag.Service) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))

	d.Get("/workspaces/{workspaceID}/documents/sources", h.ListDocumentSources, apiOp{
		summary: "List files from other sources",
		description: "Tệp nằm ở Chat, Công việc, Cuộc họp và Email Hub mà người gọi được đọc theo đúng quyền của từng nơi: kênh riêng/tin nhắn riêng chỉ thành viên, " +
			"đính kèm công việc theo thành viên workspace (không gồm ảnh dán trong mô tả), bản ghi cuộc họp đã xong, email chỉ hộp thư của chính người gọi. " +
			"Lọc source/type/q (q không phân biệt hoa thường và dấu: \"hop dong\" tìm được \"Hợp đồng\"); mới nhất trước, cursor keyset ổn định qua mọi nguồn. " +
			"Mỗi dòng có can_save: false nghĩa là định dạng hoặc dung lượng không thể thành tài liệu. " +
			"Lỗi: 400 invalid_request (source/type/q/cursor/limit sai), 403 member_deactivated | organization_suspended | agent, 404 workspace không thuộc người gọi.",
		tags: []string{"documents"},
		sdi:  sdi.ListDocumentSourcesSDI{},
		sdo:  sdo.DocumentSourceListSDO{},
		auth: true,
	})
	d.Get("/workspaces/{workspaceID}/documents/sources/{sourceFileID}/download", h.DownloadDocumentSource, apiOp{
		summary: "Download a file from another source",
		description: "Stream bytes của tệp nguồn sau khi kiểm quyền như danh sách rồi mở qua chính đường đọc của Chat/Công việc/Cuộc họp/Email Hub. " +
			"Luôn Content-Disposition: attachment, X-Content-Type-Options: nosniff; Content-Length đặt khi nguồn biết độ dài chính xác. Bản ghi cuộc họp lớn: dùng thêm /meetings/{meetingID}/recordings/{recordingID}/playback-url để phát trực tiếp. " +
			"Lỗi: 404 not_found cho mọi trường hợp không được đọc hoặc không tồn tại (không lộ tệp có thật hay không), 403 member_deactivated | organization_suspended.",
		tags:     []string{"documents"},
		produces: "application/octet-stream",
		auth:     true,
	})
	d.Post("/workspaces/{workspaceID}/documents/sources/{sourceFileID}/save", h.SaveDocumentSource, apiOp{
		summary: "Save a source file as a document",
		description: "Sao chép bytes của tệp nguồn thành một tài liệu tệp mới (bản sao, không tham chiếu tệp gốc) dưới parent_id (thư mục hoặc trang) hoặc gốc. " +
			"Cùng đường tạo với upload: kiểm parent, dung lượng, audit + outbox document.created trong một transaction. Idempotency-Key replay trả tài liệu đã tạo. Body có thể rỗng. " +
			"Lỗi: 404 not_found (tệp nguồn không đọc được hoặc không tồn tại, parent không thấy được hoặc ở workspace khác), " +
			"422 source_not_saveable (can_save=false: định dạng ngoài danh sách tài liệu tệp hoặc quá dung lượng; trả trước khi đọc byte), " +
			"422 document_parent_kind | document_too_deep (parent không nhận con loại này hoặc quá sâu), 413 file_too_large, 415 unsupported_media_type, " +
			"403 member_deactivated | organization_suspended | thiếu quyền sửa parent.",
		tags:   []string{"documents"},
		sdi:    sdi.SaveSourceFileSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
	d.Post("/workspaces/{workspaceID}/documents/sources/{sourceFileID}/office/frame-token", h.MintSourceOfficeFrameToken, apiOp{
		summary: "Mint a view-only Office frame token for a source file",
		description: "Host page only: kiểm quyền như đường tải tệp nguồn (thành viên workspace, rồi dòng qua cổng đọc của chính nơi chứa) và trả token máy chủ ký (10 phút) chỉ-xem, " +
			"ràng buộc tệp nguồn, nơi chứa, workspace, tổ chức, người gọi và module suy từ định dạng đã lưu (ofs1.). Không đọc byte nào (email không tốn IMAP lúc cấp token). " +
			"Token chỉ mở được /api/v1/office-frame/sources/* của chính tệp đó; mọi route /api/v1/office-frame/documents/* (kể cả uploads/versions/commit) từ chối nó với 401. " +
			"403 feature_disabled khi cờ module của tổ chức tắt; " +
			"404 not_found khi tệp không đọc được, không tồn tại hoặc định dạng không module nào mở (không lộ tệp có thật hay không).",
		tags:   []string{"documents"},
		sdo:    sdo.OfficeFrameSourceTokenSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
}

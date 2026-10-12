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
func registerDocumentSources(r api, h Routes, flags *featureflag.Service) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"))

	d.Get("/workspaces/{workspaceID}/documents/sources", h.ListDocumentSources, apiOp{
		summary: "List files from other sources",
		description: "Tệp nằm ở Chat, Công việc, Cuộc họp và Email Hub mà người gọi được đọc theo đúng quyền của từng nơi: kênh riêng/tin nhắn riêng chỉ thành viên, " +
			"đính kèm công việc theo thành viên workspace, bản ghi cuộc họp đã xong, email chỉ hộp thư của chính người gọi. Lọc source/type/q; mới nhất trước, cursor keyset ổn định qua mọi nguồn.",
		tags: []string{"documents"},
		sdi:  sdi.ListDocumentSourcesSDI{},
		sdo:  sdo.DocumentSourceListSDO{},
		auth: true,
	})
	d.Get("/workspaces/{workspaceID}/documents/sources/{sourceFileID}/download", h.DownloadDocumentSource, apiOp{
		summary: "Download a file from another source",
		description: "Stream bytes của tệp nguồn sau khi kiểm quyền như danh sách rồi mở qua chính đường đọc của Chat/Công việc/Cuộc họp/Email Hub. " +
			"Luôn Content-Disposition: attachment, X-Content-Type-Options: nosniff. Không được đọc hoặc không tồn tại -> 404 như nhau.",
		tags:     []string{"documents"},
		produces: "application/octet-stream",
		auth:     true,
	})
	d.Post("/workspaces/{workspaceID}/documents/sources/{sourceFileID}/save", h.SaveDocumentSource, apiOp{
		summary: "Save a source file as a document",
		description: "Sao chép bytes của tệp nguồn thành một tài liệu tệp mới (bản sao, không tham chiếu tệp gốc) dưới parent_id (thư mục hoặc trang) hoặc gốc. " +
			"Cùng đường tạo với upload: kiểm parent, dung lượng, audit + outbox document.created trong một transaction. Idempotency-Key replay trả tài liệu đã tạo.",
		tags:   []string{"documents"},
		sdi:    sdi.SaveSourceFileSDI{},
		sdo:    sdo.DocumentSDO{},
		status: http.StatusCreated,
		auth:   true,
	})
}

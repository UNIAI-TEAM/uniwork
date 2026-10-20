package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// registerPageExport is the UniNote page export (UNI-2004), behind the
// `documents` and `page_export` flags evaluated at the document's
// organization (r is the FlagOrganization-wrapped docs mount):
//
//	POST /api/v1/documents/{documentID}/export
//
// limit is the route's own budget: one export holds an engine worker (and,
// for pdf, a headless browser) for seconds, so it is one counter per person
// across every page.
func registerPageExport(r api, h Routes, flags *featureflag.Service, limit func(http.Handler) http.Handler) {
	d := r.With(mw.RequireFeatureFlag(flags, "documents"), mw.RequireFeatureFlag(flags, "page_export"), limit)
	d.Post("/documents/{documentID}/export", h.ExportDocumentPage, apiOp{
		summary: "Export a UniNote page as DOCX or PDF",
		description: "Quyền xem trang là đủ. Body {format: docx|pdf}; office-engine dựng DOCX từ nội dung trang (tiêu đề, đoạn, danh sách, bảng, đánh dấu, liên kết, ảnh) và PDF từ chính DOCX đó bằng bộ dựng Docs; trả thẳng byte tệp (Content-Disposition theo tiêu đề trang) và ghi nhật ký truy cập export. " +
			"Tài liệu không phải trang -> 422 page_export_not_page; format khác -> 400; không có engine -> 503 office_not_configured; engine chưa có bộ dựng PDF -> 409 engine_incompatible; quá hạn -> 504 engine_timeout; cờ page_export tắt -> 404 feature_disabled.",
		tags: []string{"documents"}, sdi: sdi.ExportDocumentPageSDI{}, produces: "application/octet-stream", auth: true,
	})
}

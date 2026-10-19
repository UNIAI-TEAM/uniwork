// Package featureflags is the catalogue of flag keys this server evaluates
// and the organization-scoped override provider (spec F-11 §7).
//
// The evaluation machinery — providers, hashing, eval context — lives in
// pkg/featureflag and knows nothing about which flags exist. This package is
// where a key is declared, documented, marked public to the frontend and
// given a review date; TestFlagsAreReviewed fails when one is left past it.
package featureflags

import (
	"context"
	"time"

	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Flag is one catalogue entry.
type Flag struct {
	Key         string
	Description string
	Default     bool
	// Public flags are published to the web client through GET /api/v1/config.
	Public bool
	Owner  string
	// ReviewAt is the date the flag must be deleted or extended (§7.3).
	ReviewAt time.Time
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// catalogue is the ordered list; a flag not here evaluates to the caller's
// default and cannot be overridden from the console.
var catalogue = []Flag{
	{Key: "agents_assignee", Description: "Hiện agent trong picker assignee của task", Default: false, Public: true, Owner: "tasks", ReviewAt: day(2026, 12, 5)},
	{Key: "admin_quota", Description: "Màn hình Quota trong console admin khi spec subscription chưa đủ dữ liệu", Default: false, Public: false, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "rum_sampling", Description: "Cho phép web gửi web-vitals về POST /api/v1/rum", Default: true, Public: true, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "meeting_ai_summary", Description: "Bật tóm tắt cuộc họp bằng AI theo tổ chức (pilot)", Default: false, Public: true, Owner: "meetings", ReviewAt: day(2026, 12, 5)},
	{Key: "debug_trace_full_sampling", Description: "Lấy mẫu trace 100% cho tổ chức đang điều tra sự cố", Default: false, Public: false, Owner: "platform", ReviewAt: day(2026, 12, 5)},
	{Key: "chat_work_hub", Description: "Kênh hạng nhất gắn Project, khám phá và tham gia (C-13)", Default: true, Public: true, Owner: "chat", ReviewAt: day(2026, 12, 31)},
	{Key: "documents", Description: "Tài liệu trong workspace: page, tệp, phiên bản (UNI-679); mặc định bật", Default: true, Public: true, Owner: "documents", ReviewAt: day(2026, 12, 31)},
	{Key: "office_engine", Description: "Master switch for opening Office files in the web frame (UNI-822; default on, FF_OFFICE_ENGINE=false is the kill switch)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_docx", Description: "Cho phép mở tệp DOCX trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_xlsx", Description: "Cho phép mở tệp XLSX trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_pptx", Description: "Cho phép mở tệp PPTX trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_pdf", Description: "Cho phép mở tệp PDF trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_markdown", Description: "Cho phép mở tệp Markdown trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_html", Description: "Cho phép mở tệp HTML trong khung Office trên web; cần office_engine đang bật (UNI-941, tắt riêng một định dạng)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 31)},
	{Key: "office_docs_web", Description: "Mở DOCX trên web bằng trình soạn genoffice Docs trong iframe cùng origin, token khung ngắn hạn theo một tài liệu (UNI-1013; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	{Key: "office_pdf_web", Description: "Mở tệp PDF trên web bằng module genoffice trong iframe cùng origin, token khung theo một tài liệu (UNI-1014; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	{Key: "office_markdown_web", Description: "Mở tệp Markdown trên web bằng module genoffice trong iframe cùng origin, token khung theo một tài liệu (UNI-1014; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	{Key: "office_html_web", Description: "Mở tệp HTML trên web bằng module genoffice trong iframe cùng origin, token khung theo một tài liệu (UNI-1014; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	{Key: "office_slides_web", Description: "Mở tệp PPTX trên web bằng module genoffice trong iframe cùng origin, token khung theo một tài liệu (UNI-1015; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	{Key: "office_sheets_web", Description: "Mở tệp XLSX trên web bằng module genoffice trong iframe cùng origin, token khung theo một tài liệu (UNI-1016; mặc định bật từ 2026-10-09, override tổ chức/người dùng tắt được; chưa cài bundle thì báo máy chủ chưa thiết lập, kèm mở trong UniWork Office và tải xuống)", Default: true, Public: true, Owner: "office", ReviewAt: day(2026, 12, 5)},
	// Office G5/G6 app capabilities (plan X-03). A flag hides a capability;
	// it never grants one - permission stays in the services. Overrides
	// resolve user > organization > global through the same evaluator
	// GET /api/v1/config uses.
	{Key: "office_sync_feed", Description: "Office sync: read the change feed for this organization (desktop app and the web S6 bar). Hides the capability only; grants nothing", Default: true, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_sync_write", Description: "Office sync kill switch: stops dispatching new save intents; the queue, drafts and reconciliation are kept. Hides the capability only; grants nothing", Default: true, Public: false, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_offline_library", Description: "Office offline library: issue and renew offline leases and pin documents for offline use. Hides the capability only; grants nothing", Default: false, Public: false, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork", Description: "UniWork AI kill switch for Office (BYOK is unaffected); keep it off for organizations with real data until G6-D2 closes. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_docx", Description: "UniWork AI per-format capability for DOCX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_xlsx", Description: "UniWork AI per-format capability for XLSX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_pptx", Description: "UniWork AI per-format capability for PPTX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_pdf", Description: "UniWork AI per-format capability for PDF; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_markdown", Description: "UniWork AI per-format capability for Markdown; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_html", Description: "UniWork AI per-format capability for HTML; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_txt_open", Description: "Open .txt files and other-source .txt files through the web markdown frame in plain mode (UNI-1813; default off until UNI-1905 lands in the frame pin). Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "graph", Description: "Work Graph: marker đánh dấu node bẩn cho tổ chức này, worker chiếu (C-11). Bật rồi chạy graph-rebuild --org", Default: false, Public: false, Owner: "graph", ReviewAt: day(2027, 1, 31)},
	{Key: "graph_ui", Description: "Work Graph: section Liên quan và dòng thời gian trên trang việc (C-11)", Default: false, Public: true, Owner: "graph", ReviewAt: day(2027, 1, 31)},
	{Key: "mcp_connector", Description: "Connector MCP: client AI bên ngoài (Claude, ChatGPT, Gemini) đọc task và cuộc họp (UNI-1308)", Default: false, Public: true, Owner: "platform", ReviewAt: day(2027, 1, 31)},
	{Key: "mcp_connector_write", Description: "Connector MCP: tool ghi (tạo, sửa task, dự án, cuộc họp, tài liệu) cho grant có scope write (UNI-1567, ADR 0033)", Default: false, Public: true, Owner: "platform", ReviewAt: day(2027, 3, 31)},
}

// Catalogue returns a copy of the declared flags.
func Catalogue() []Flag {
	out := make([]Flag, len(catalogue))
	copy(out, catalogue)
	return out
}

// Lookup finds a flag by key.
func Lookup(key string) (Flag, bool) {
	for _, f := range catalogue {
		if f.Key == key {
			return f, true
		}
	}
	return Flag{}, false
}

// EvaluateFrontendPublicFlags evaluates every public key for the request's
// context. A nil service yields every public flag at its default, which is
// what a deployment without a flag file or database gets.
func EvaluateFrontendPublicFlags(ctx context.Context, flags *featureflag.Service) map[string]bool {
	out := make(map[string]bool, len(catalogue))
	for _, f := range catalogue {
		if !f.Public {
			continue
		}
		out[f.Key] = flags.IsEnabled(ctx, f.Key, f.Default)
	}
	return out
}

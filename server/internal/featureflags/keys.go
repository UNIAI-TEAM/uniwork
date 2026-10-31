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
	// Mobile flags are published to UniChat mobile under mobile_flags of
	// GET /api/v1/config, evaluated for the caller like the public ones. They
	// are the phone's remote kill switches: a binary in a store cannot be
	// recalled, so a feature it ships can still be turned off here.
	Mobile bool
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
	{Key: "meeting_minutes", Description: "Biên bản cuộc họp là trang UniNote: lập, chốt, bỏ chốt (UNI-2003)", Default: false, Public: true, Owner: "meetings", ReviewAt: day(2027, 1, 18)},
	{Key: "meeting_scribe", Description: "Thư ký AI vào phòng họp: ghi lời từng người, phụ đề cả phòng (UNI-2023, ADR 0045). Chỉ bật cho tổ chức khi đã có thỏa thuận xử lý dữ liệu với nhà cung cấp STT", Default: false, Public: false, Owner: "meetings", ReviewAt: day(2027, 1, 18)},
	{Key: "meeting_transcription", Description: "Tải file ghi âm cuộc họp lên và ghi lời theo lô qua AssemblyAI (UNI-2001). Chỉ bật ngoài nội bộ khi đã có thỏa thuận xử lý dữ liệu với AssemblyAI và hồ sơ chuyển dữ liệu ra nước ngoài (spec §7.5)", Default: false, Public: false, Owner: "meetings", ReviewAt: day(2027, 1, 18)},
	{Key: "meeting_caption_translate", Description: "Phụ đề dịch Việt ↔ Anh trong phòng họp: thư ký AI dịch đoạn lời qua ai.Gateway khi có người chọn ngôn ngữ khác (UNI-2028). Cần cờ meeting_scribe", Default: false, Public: false, Owner: "meetings", ReviewAt: day(2027, 1, 18)},
	{Key: "meeting_dial_in", Description: "Gọi vào họp bằng điện thoại: số tổng đài + mã PIN theo cuộc họp qua LiveKit SIP (UNI-2029); cần MEETING_SIP_ENABLED và hạ tầng SIP (UNI-2030)", Default: false, Public: false, Owner: "meetings", ReviewAt: day(2027, 1, 18)},
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
	{Key: "office_ai_uniwork", Description: "UniWork AI kill switch for Office; keep it off for organizations with real data until G6-D2 closes. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_docx", Description: "UniWork AI per-format capability for DOCX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_xlsx", Description: "UniWork AI per-format capability for XLSX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_pptx", Description: "UniWork AI per-format capability for PPTX; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_pdf", Description: "UniWork AI per-format capability for PDF; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_markdown", Description: "UniWork AI per-format capability for Markdown; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "office_ai_uniwork_html", Description: "UniWork AI per-format capability for HTML; needs office_ai_uniwork on. Hides the capability only; grants nothing", Default: false, Public: true, Owner: "office", ReviewAt: day(2027, 3, 31)},
	{Key: "graph", Description: "Work Graph: marker đánh dấu node bẩn cho tổ chức này, worker chiếu (C-11). Bật rồi chạy graph-rebuild --org", Default: false, Public: false, Owner: "graph", ReviewAt: day(2027, 1, 31)},
	{Key: "graph_ui", Description: "Work Graph: section Liên quan và dòng thời gian trên trang việc (C-11)", Default: false, Public: true, Owner: "graph", ReviewAt: day(2027, 1, 31)},
	{Key: "mcp_connector", Description: "Connector MCP: client AI bên ngoài (Claude, ChatGPT, Gemini) đọc task và cuộc họp (UNI-1308)", Default: false, Public: true, Owner: "platform", ReviewAt: day(2027, 1, 31)},
	{Key: "mcp_connector_write", Description: "Connector MCP: tool ghi (tạo, sửa task, dự án, cuộc họp, tài liệu) cho grant có scope write (UNI-1567, ADR 0033)", Default: false, Public: true, Owner: "platform", ReviewAt: day(2027, 3, 31)},
	{Key: "page_export", Description: "Xuất trang UniNote ra DOCX/PDF qua office-engine (UNI-2004); tắt thì ẩn mục xuất và route trả 404. PDF cần bộ dựng Docs (Chromium + bundle, UNIWORK_DOCS_PDF_ASSETS) trong ảnh engine; thiếu thì engine không báo export_pdf, menu ẩn Xuất PDF (GET .../export) và route vẫn trả 409 engine_incompatible, DOCX vẫn chạy", Default: false, Public: true, Owner: "documents", ReviewAt: day(2027, 1, 18)},
	// UniChat mobile (UNI-2053). On by default: FF_UNICHAT_MOBILE_CALLS=false
	// (or an organization/user override) hides calling on every installed
	// phone at its next config read, incoming calls included.
	{Key: "unichat_mobile_calls", Description: "UniChat mobile: gọi thoại/video, cả màn cuộc gọi đến native trên Android; tắt là kill switch ẩn và ngừng nhận cuộc gọi trên mọi bản đã cài (UNI-2053)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	// Calls on an iPhone ring through CallKit and PushKit (docs/adr/0038): without them a locked
	// iPhone plays one short sound and keeps "X đang gọi" after the call ends. Off by default; an
	// iPhone's unichat_mobile_calls reads off while this is off (MobileFlagsFor), and the push
	// consumer sends no ring to an iPhone (PushConsumer.SetMobileCallsIOS). On, an iPhone with a
	// PushKit token gets VoIP pushes (push_apns.go); turn it on once the APNs key is on the server
	// and the CallKit build has passed the device checklist.
	{Key: "unichat_mobile_calls_ios", Description: "UniChat mobile: gọi điện trên iPhone; bật thì iPhone có token PushKit đổ chuông qua CallKit (VoIP push thẳng tới APNs), tắt (mặc định) thì iPhone không hiện nút gọi và không nhận push đổ chuông (UNI-2053, ADR 0038)", Default: false, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	// The phone's other risky subsystems (UNI-2053 audit "remote-config-thin"): each is on by default and
	// read by the app through useMobileFlag / readMobileFlag; FF_<KEY>=false, FF_<KEY>=N% (by user id) or a
	// console override turns one off for everyone, a share of people, an organization or one person.
	{Key: "unichat_mobile_media_upload", Description: "UniChat mobile: gửi ảnh và tệp; tắt thì ẩn ảnh/tệp trong menu đính kèm (tin đã xếp hàng vẫn gửi) (UNI-2053)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	{Key: "unichat_mobile_voice_messages", Description: "UniChat mobile: ghi và gửi tin thoại; tắt thì ẩn nút ghi âm của ô soạn tin (UNI-2053)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	{Key: "unichat_mobile_ai_catch_up", Description: "UniChat mobile: \"Bắt kịp nhanh\" bằng AI trên danh sách chat; tắt thì ẩn banner (UNI-2053)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	{Key: "unichat_mobile_outbox_flush", Description: "UniChat mobile: tự gửi lại tin và thao tác đang chờ (khi có mạng lại, về foreground, socket nối lại); tắt thì chúng nằm yên trên máy, gửi từ ô soạn tin và nút Thử lại vẫn chạy (UNI-2053)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	{Key: "unichat_mobile_background_send", Description: "UniChat mobile: gửi tiếp tin và thao tác đang chờ khi app đã rời màn hình (iOS xin thêm thời gian lúc rời app và task nền theo lịch; Android job WorkManager chạy khi có mạng, kể cả khi mạng có lại lúc app ở nền); tắt thì chúng chờ tới lần mở app sau (UNI-2141)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	{Key: "unichat_mobile_chat_sync", Description: "UniChat mobile: đồng bộ chat theo nhật ký thay đổi (GET .../chat/sync, ADR 0039 nháp): reconnect và mỗi phút yên lặng chỉ đọc phần đã đổi; tắt thì reconnect refetch mọi timeline đang hiện như trước (UNI-2071)", Default: true, Mobile: true, Owner: "chat", ReviewAt: day(2027, 4, 30)},
	// The conversation's message list on FlashList 2 (audit timeline-flatlist): off by default keeps the tuned
	// inverted FlatList; FF_UNICHAT_MOBILE_TIMELINE_RECYCLED=N% puts a share of people (by user id) on the recycled
	// list, the A/B the nightly's frame numbers and Sentry's slow and frozen frames decide. Each conversation reads it
	// once when shown, so turning it off takes effect at the next room opened.
	{Key: "unichat_mobile_timeline_recycled", Description: "UniChat mobile: danh sách tin của một phòng chạy trên FlashList 2 (tái chế ô, đo chiều cao từng ô); tắt (mặc định) giữ FlatList đảo ngược; bật theo % người dùng để A/B hiệu năng cuộn (UNI-2053)", Default: false, Mobile: true, Owner: "chat", ReviewAt: day(2027, 3, 31)},
	{Key: "ask_uni_agent", Description: "Hỏi UNI chạy như agent tự tra cứu bằng tool chỉ đọc (UNI-1962, P1); tắt thì giữ luồng P0", Default: false, Public: false, Owner: "ai", ReviewAt: day(2027, 1, 31)},
	{Key: "ask_uni_stream", Description: "Hỏi UNI dùng dock mới và luồng stream SSE thay cho panel cũ (UNI-2015, P2); tắt thì giữ panel cũ và POST …/ai/ask. Chỉ chuyển giao diện, server không chặn route stream", Default: false, Public: true, Owner: "ai", ReviewAt: day(2027, 2, 28)},
	{Key: "ask_uni_attachments", Description: "Hỏi UNI nhận file gắn vào câu hỏi (UNI-2119); tắt thì ẩn nút tải file và server từ chối", Default: false, Public: false, Owner: "ai", ReviewAt: day(2027, 3, 31)},
	{Key: "ask_uni_actions", Description: "Hỏi UNI đề xuất thay đổi ghi (task, bình luận, tin nhắn…) để người dùng xác nhận (UNI-2148, P3); tắt thì vòng agent không gửi tool ghi và các route đề xuất trả 403 ai_actions_disabled", Default: false, Public: true, Owner: "ai", ReviewAt: day(2027, 4, 30)},
	{Key: "ask_uni_office", Description: "Ask UNI drafts Office files (Ask UNI × Office spec): offers list_templates, create_office_document and save_attachment_template and lets their proposals apply; off hides them and refuses those Applies. Hides the capability only; grants nothing", Default: false, Public: false, Owner: "ai", ReviewAt: day(2027, 4, 30)},
	{Key: "ask_uni_memory", Description: "Hỏi UNI có bộ nhớ riêng của từng người (UNI-2156, P4): đề xuất nhớ khi người dùng xác nhận, màn Bộ nhớ, nhập từ AI khác; tắt thì không có khối bộ nhớ trong prompt, không có tool propose_memory, mọi route bộ nhớ trả 403 ai_memory_disabled", Default: false, Public: true, Owner: "ai", ReviewAt: day(2027, 5, 31)},
	{Key: "ask_uni_thinking", Description: "Hỏi UNI cho thấy cách suy luận (UNI-2148): bật suy nghĩ thích ứng của model Anthropic, stream phần tóm tắt suy nghĩ và chạy prompt @8–@11 có một câu dẫn trước mỗi lần tra cứu; tốn thêm token output. Tắt thì giữ @4–@7, không suy nghĩ", Default: false, Public: false, Owner: "ai", ReviewAt: day(2027, 4, 30)},
	{Key: "drive_connector", Description: "Connector Google Drive: kết nối, liên kết tệp, UNI đề xuất việc (UNI-2172, ADR 0047); mặc định bật khi server có OAuth Drive, FF_DRIVE_CONNECTOR=false là công tắc tắt", Default: true, Public: true, Owner: "work", ReviewAt: day(2027, 4, 30)},
}

// EvaluateMobileFlags evaluates every mobile key for the request's context,
// the same way EvaluateFrontendPublicFlags does for the web: a nil service
// yields each at its catalogue default.
func EvaluateMobileFlags(ctx context.Context, flags *featureflag.Service) map[string]bool {
	out := make(map[string]bool)
	for _, f := range catalogue {
		if f.Mobile {
			out[f.Key] = flags.IsEnabled(ctx, f.Key, f.Default)
		}
	}
	return out
}

// mobilePlatformGates: a mobile switch that on one platform also needs a
// platform switch on. The phone reads only the first key, so the platform's
// answer is folded into it here and no installed build needs to know.
var mobilePlatformGates = map[string]map[string]string{
	"unichat_mobile_calls": {"ios": "unichat_mobile_calls_ios"},
}

// MobileFlagsFor is EvaluateMobileFlags for a phone on os (X-Client-OS:
// "ios", "android"; anything else, including none, gets no platform gate):
// a switch with a platform gate reads on only when its gate is on too. The
// header is the client's word, which is enough to hide a capability; a flag
// never grants a permission.
func MobileFlagsFor(ctx context.Context, flags *featureflag.Service, os string) map[string]bool {
	out := EvaluateMobileFlags(ctx, flags)
	for key, gates := range mobilePlatformGates {
		if gate, ok := gates[os]; ok {
			out[key] = out[key] && out[gate]
		}
	}
	return out
}

// ForPerson returns a check of one catalogue flag for a person in an
// organization, evaluated the way GET /api/v1/config evaluates it for that
// person's client (user > organization > global overrides, then FF_* env and
// the flag file). It is for server-side work done on someone's behalf with no
// request behind it, such as a push. A key missing from the catalogue reads
// false; a nil service reads the catalogue default.
func ForPerson(flags *featureflag.Service, key string) func(ctx context.Context, userID, organizationID string) bool {
	def := false
	if f, ok := Lookup(key); ok {
		def = f.Default
	}
	return func(ctx context.Context, userID, organizationID string) bool {
		ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: organizationID})
		return flags.IsEnabled(ctx, key, def)
	}
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

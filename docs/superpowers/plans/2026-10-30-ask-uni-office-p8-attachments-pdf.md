# Hỏi UNI soạn tệp Office — kế hoạch 8: tệp đính kèm ở module khác (Phần 1c) và đọc chữ PDF Implementation Plan

> **Trạng thái:** in-progress — chủ sản phẩm duyệt 2026-10-30; đã triển khai trên nhánh, chờ PR; kế hoạch 8 (Phần 1c và đọc PDF) của spec Hỏi UNI soạn tệp Office; issue UNI-2307 (con của UNI-415).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hỏi UNI tìm và đọc được tệp đính kèm ở công việc, chat và Email Hub (với kiểm quyền của module sở hữu tệp), và đọc được chữ trong PDF ở cả `get_document`, tệp đính kèm lẫn chỉ mục tìm kiếm.

**Architecture:** Chữ PDF do Office engine đọc bằng pdfium (`readPdfText` đã có), qua một job `extract_text:pdf` mới trên đường `extract_text` mà Drive đang dùng; grant của job nay ghi đích danh một tài liệu UniWork (`document_id`) hoặc một tệp Drive. Phía server, đường đọc tệp của `get_document` (Phần 1a) tách thành một bộ đọc dùng chung theo loại tệp (văn bản, Office, PDF); `get_document`, công cụ đọc tệp đính kèm mới và bộ lập chỉ mục (Phần 1b, chỉ phần PDF) cùng gọi nó. Phần 1c đi qua `DocumentSourceService`, dịch vụ đã liệt kê và mở tệp của chat, công việc, cuộc họp, Email Hub bằng cổng quyền của từng module (mọi từ chối thành `not_found`); Hỏi UNI có thêm hai công cụ đọc `list_attachments` và `get_attachment`, chỉ cho Hỏi UNI, không cho MCP connector.

**Tech Stack:** Go (`server/internal/service`, `server/internal/office`, sqlc), TypeScript (`apps/office-engine`, `packages/office-contracts`, vitest), tài liệu Markdown.

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` §6 Phần 1 ("Đọc nội dung tệp" — phần PDF, và "Tệp đính kèm ở các module khác (phần 1c)"), §7.2, §7.11. Báo cáo đánh giá §1 (`docs/ask-uni-documents-assessment.md`, chưa commit, thuộc phiên khác — chỉ đọc). Số dòng trong kế hoạch lấy ở develop `3a349102c`.

## Global Constraints

- Không gửi tệp ra ngoài: PDF chỉ đi tới Office engine nội bộ (Q4-A, ADR 0021). Không OCR (spec §Ngoài phạm vi; engine `capability.ts:53-63`): PDF quét trả một ghi chú, không đoán chữ.
- Trần đọc một tệp 20 MiB (`mcpOfficeReadBytes = askMaxAttachmentsBytes`, `mcp_tools_office.go:13`; `office.MaxExtractInputBytes`, `extract.go:45`). Trần chữ đưa model 16.000 ký tự và dòng báo cắt (`mcpMaxItemRunes`, `mcp_tools.go:79`). Trần chữ chỉ mục 20.000 ký tự (`maxSearchContentRunes`).
- Mọi lần đọc tệp Office hay PDF giữ khe đọc tệp chung của tiến trình (`AskUNIService.fileReads`, `askuni.go:107`; `takeSlot`, `askuni_turn_files.go:64`) và luôn trả khe.
- Công cụ đọc không ghi gì: không dòng `audit_events`, không dòng `outbox_events`. `agentTools()` giữ thứ tự cố định (tiền tố prompt cache, `TestAskAgentToolBytesAreStable`); công cụ mới thêm vào cuối nhóm tài liệu, sau `list_templates`.
- Kiểm quyền đi qua dịch vụ sở hữu: tài liệu qua `DocumentService`, tệp đính kèm qua `DocumentSourceService` (`document_sources.go`), luôn với `Human(tc.ActorID)` của người hỏi và `tc.WorkspaceID` — model không bao giờ chọn workspace. Từ chối và vắng mặt trả cùng một câu `not_found`.
- Chat và Email Hub không mở cho MCP connector (ADR 0031 §4): công cụ tệp đính kèm chỉ ở Hỏi UNI, không là phương thức của `McpToolService`.
- Chữ trong tệp đính kèm là chữ của người khác: `agentItem.Foreign = true` (lượt có nó không tự áp dụng, `TestAskUniTaintedTurnNeverAutoApplies`).
- Hợp đồng engine đổi theo kiểu cộng thêm, cùng repo (không fork, không pin lại): job cũ (`extract_text` docx/xlsx/pptx với `drive_file_id`) chạy như trước.
- Không migration. Truy vấn sqlc sửa vẫn ràng buộc tenant như cũ (`TestEveryQueryNamesItsTenant`).
- Không chạy toàn bộ `go test`, quét cả package hay `make check` trước khi xong mọi task; dùng `-run` (Go) và tên tệp test (vitest). CI chạy toàn bộ trên PR. DB test: `TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable'`.
- Mã và comment tiếng Anh; tài liệu `docs/` tiếng Việt. Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không nhắc tên ClickUp.

## Ruling của người lập kế hoạch

- **P1 — chữ PDF do Office engine đọc.** Spec §6 ghi `attachtext.ReadPDF`, nhưng hàm đó chỉ đếm và cắt trang (`attachtext/pdf.go:60`); pdfcpu không có API đọc chữ. Thư viện Go thuần (ví dụ `ledongthuc/pdf`) yếu với font CID/ToUnicode, tức phần lớn PDF tiếng Việt, và thêm một bộ phân tích tệp chưa được kiểm. Engine đã có pdfium và `readPdfText` (`packages/office-engine/src/pdf/extract.ts:100`), phía Go đã có client `ExtractText` (`office/extract.go:81`). Giá nếu sai: nơi không bật engine (`OFFICE_ENGINE_URL` rỗng) không đọc được PDF; ghi chú nói rõ điều đó.
- **P2 — grant `extract_text` ghi đúng một đối tượng.** Hoặc `drive_file_id` (Drive, như cũ) hoặc `document_id`: id tài liệu thư viện, hay id tệp nguồn `<source>:<row id>` (`document_sources.go:36-37`). Engine coi id là nhãn mờ; nó không đọc DB.
- **P3 — Phần 1c đi qua `DocumentSourceService`.** Dịch vụ này đã chạy lại cổng của module hai lần (SQL liệt kê, rồi Open của module), ẩn mọi từ chối thành `not_found`, và chỉ nhận người (`gate`, `document_sources.go:386-398`). Không viết đường mở thứ hai.
- **P4 — cuộc họp không có tệp để đọc.** Tệp nguồn của cuộc họp là bản ghi hình, không thuộc bộ đuôi tài liệu (`documentSourceAllExts`), nên `list_attachments` không bao giờ trả tệp cuộc họp. Biên bản, tóm tắt, transcript đã đọc được bằng `get_meeting`, `get_meeting_transcript`. Mô tả công cụ nói rõ.
- **P5 — người đã tắt AI.** Tệp mà người gửi hay người tải lên (chủ là người) đã tắt xử lý AI (`users.ai_opt_out_at`, `ai_opt_out.go`) không bao giờ tới model: `list_attachments` bỏ dòng đó, `get_attachment` trả ghi chú và không mở bytes. Áp cho mọi nguồn có chủ là người, không chỉ chat.
- **P6 — không cờ mới.** Hai công cụ cần `ask_uni_agent` (như mọi công cụ đọc) và cờ `documents` (cờ của bề mặt tệp nguồn, `router/document_sources.go:22`). Giá nếu sai: thêm cờ sau, nhỏ.
- **P7 — chỉ mục không thử lại khi engine vắng.** Engine chưa cấu hình hay lỗi: chữ PDF để rỗng, không trả lỗi cho outbox, để một engine treo không giữ làn chậm 60 giây mỗi tệp. Sau khi bật hay sửa engine, ops chạy lại `document-text-reindex` (runbook). Giá nếu sai: một lần engine chập chờn làm vài PDF không tìm được tới lần chạy lại.
- **P8 — trích dẫn tệp đính kèm.** `Kind: "document"` (client đã biết loại này); `Href` là nơi tệp nằm (trang công việc, phòng chat, thread email); `Key = Href + "#" + id tệp nguồn` để hai tệp cùng chỗ không trùng nguồn.
- **P9 — lọc theo nơi chứa chỉ ở service.** `DocumentSourceFilter.ParentID` và bốn truy vấn nhận lọc này; route HTTP không đổi (không API mới, không ca isolation mới).
- **P10 — trang PDF.** Engine nối chữ các trang bằng ký tự `\f` (mỗi trang một đoạn, trang không có chữ là đoạn rỗng); server dựng `[page N]` cho model và nối liền cho chỉ mục. Ký tự `\f` có sẵn trong chữ trang bị bỏ trước khi nối.

## Review Focus

1. Thành viên hỏi về tệp trong phòng chat riêng mình không ở, hay tệp đính kèm thư của người khác, bằng id lấy được ở đâu đó: trả `not_found`, không lộ tên hay chữ (test ở Task 5).
2. Người gửi tệp đã tắt AI: tệp không hiện trong `list_attachments`, `get_attachment` không đọc bytes (test ở Task 5).
3. PDF quét, PDF có mật khẩu, PDF hỏng, engine chưa bật hay đang lỗi: lời gọi vẫn thành công với ghi chú đúng; chỉ mục để rỗng, không thử lại, không sập tiến trình (test ở Task 2 và Task 3).
4. Tệp đính kèm lớn hơn 20 MiB (thư 25 MiB): từ chối trước khi mở bytes, khe đọc luôn được trả kể cả khi Open lỗi (test ở Task 5).
5. Model đưa id tài liệu thư viện cho `get_attachment`, hay id tệp nguồn cho `get_document`: trả `not_found` rõ ràng, không đọc nhầm (test ở Task 5).

---

### Task 1: Office engine đọc chữ PDF (`extract_text:pdf`)

**Files:**
- Modify: `packages/office-contracts/src/results.ts:110` (`extractTextFormats` thêm `"pdf"`); `packages/office-contracts/src/operations.ts` nếu bảng định dạng–thao tác ở `:12`/`:30` liệt kê định dạng của `extract_text`
- Modify: `apps/office-engine/src/grants.ts:121-149` (luật đối tượng của `extract_text`)
- Modify: `apps/office-engine/src/worker/handlers.ts` (handler mới cạnh `extractText` `:448`; bảng `HANDLERS` `:466-483`)
- Modify: `apps/office-engine/src/capability.ts:123-133` (hàng `extract_text` gồm `pdf`)
- Modify: `packages/office-engine/src/pdf/index.ts` (xuất `PdfOpenError`, `FPDF_ERR_PASSWORD`, `FPDF_ERR_SECURITY` nếu chưa xuất)
- Modify: `server/internal/office/extract.go` (`ExtractFormatPDF`; trường mới của `ExtractTextRequest`), `server/internal/office/grant.go:108-124` (`validateServiceGrant`)
- Create: `server/internal/office/testdata/grant-parity-extract-document.json`
- Test: `apps/office-engine/src/grants.test.ts`, `apps/office-engine/src/worker/handlers.test.ts`, `apps/office-engine/src/capability.test.ts`, `packages/office-contracts/src/results.test.ts`, `server/internal/office/grant_test.go`, `server/internal/office/extract_test.go`

**Interfaces:**
- Produces (Go): `const ExtractFormatPDF ExtractFormat = ExtractFormat(FormatPDF)`; `ExtractTextRequest` thêm `DocumentID string` và `ActorKind string` (rỗng = `"human"`). `ExtractText` nhận đúng một trong `DriveFileID`/`DocumentID` (cả hai hay không cái nào → lỗi, không gọi engine); grant mang `DocumentID` hay `DriveFileID` tương ứng, cái kia `""`. Kết quả PDF: `ExtractTextResult.Text` là các trang nối bằng `\f`.
- Produces (engine): handler `"extract_text:pdf"`; job hoàn tất trả `result: { text, truncated, format: "pdf" }`.

- [x] **Step 1: Viết test đỏ.**
  - `grants.test.ts`: grant `extract_text` với `document_id: "01DOC…"`, `drive_file_id: ""` → nhận; có cả hai → `malformed` field `drive_file_id`; không cái nào → `malformed`. Fixture parity mới `grant-parity-extract-document.json` (như `grant-parity-extract.json` nhưng `document_id` có giá trị, `drive_file_id: ""`, `actor_kind: "system"`, `format: "pdf"`) → parse ra đúng các trường.
  - `handlers.test.ts`: `extract_text:pdf` trên `docs/office/g0/fixtures/files/pdf/pdf-text-editable.pdf` → `ok`, `result.format === "pdf"`, `result.text.split("\f")` dài 2, đoạn đầu chứa `"Bao cao tong hop nam 2026"`, `truncated === false`; `pdf-scanned-page.pdf` → `ok`, mọi đoạn rỗng; `pdf-password-4spaces.pdf` → `{ ok: false, code: "engine_result_invalid", reason: "password_required" }`; `pdf-corrupt.pdf` → `reason: "corrupted"`.
  - `capability.test.ts`: `extract_text` cho `pdf` là `supported: true`.
  - `grant_test.go`: `TestExtractGrantParityDocument` đọc fixture mới, `SignGrant` cho ra đúng `token`, `VerifyGrant` nhận; grant có cả `DocumentID` lẫn `DriveFileID` → `ErrGrantInvalid`. Token của fixture sinh một lần bằng `SignGrant` với `key` của fixture (không commit chương trình sinh).
  - `extract_test.go`: `ExtractText` với `Format: ExtractFormatPDF, DocumentID: "d1", ActorKind: "system"` gửi grant có `document_id: "d1"`, `drive_file_id` vắng, `actor_kind: "system"`, `format: "pdf"` (engine giả dùng httptest như các test sẵn có); request có cả `DriveFileID` và `DocumentID` → lỗi, không request nào tới engine.

- [x] **Step 2: Chạy, thấy đỏ.** `pnpm --filter @uniwork/office-engine-app exec vitest run src/grants.test.ts src/worker/handlers.test.ts src/capability.test.ts`, `pnpm --filter @uniwork/office-contracts exec vitest run src/results.test.ts`, `cd server && go test ./internal/office -run 'TestExtractGrantParity|TestExtractText' -count=1` → FAIL.

- [x] **Step 3: Cài đặt engine.** Handler `extractPdfText(message)`: `loadPdf()`, `readPdfText(bytes, { charBudget: MAX_EXTRACT_CODE_POINTS })` (không bao giờ truyền mật khẩu); bỏ `\f` trong chữ từng trang, nối các trang bằng `\f`; nếu chữ vượt `MAX_EXTRACT_CODE_POINTS` code point hay `MAX_EXTRACT_UTF8_BYTES` byte (hằng của `packages/office-engine/src/node/convert/extract.ts`) thì cắt ở ranh giới code point và đặt `truncated`. `PdfOpenError` có `detail` là `FPDF_ERR_PASSWORD` hay `FPDF_ERR_SECURITY` → `password_required`; số khác → `corrupted`; `"heap"` → ném lại (lỗi engine). Grant: `extract_text` đòi đúng một trong `drive_file_id`, `document_id` khác rỗng; trả về giữ cả hai trường (cái không dùng là `""`). Sửa comment `extract.go:20-35` (Drive và tài liệu UniWork).

- [x] **Step 4: Chạy lại, thấy xanh** (các lệnh Step 2).

- [x] **Step 5: Commit** `feat(office): the engine reads the text layer of a PDF`.

### Task 2: `get_document` đọc PDF qua bộ đọc tệp dùng chung

**Files:**
- Create: `server/internal/service/file_content.go`
- Modify: `server/internal/service/mcp_tools_documents.go` (`GetDocument` `:183-232`, `officeDocument` `:238-287`, các ghi chú `:228-235`, mô tả công cụ MCP `get_document` `:668`)
- Modify: `server/internal/service/mcp_tools.go` (trường `pdf` của `McpToolService`, `SetPDFText`)
- Modify: `server/internal/service/askuni_agent_tools.go:183` (mô tả `get_document` thêm pdf)
- Modify: `server/cmd/server/main.go` (`mcpTools.SetPDFText(driveExtractor)` cạnh `askUNI.SetReadTools(mcpTools)` `:930`)
- Test: `server/internal/service/mcp_tools_documents_test.go`, `server/internal/service/file_content_test.go` (mới)

**Interfaces:**
- Consumes: `office.ExtractTextRequest` (`DocumentID`, `ActorKind`, `ExtractFormatPDF`), `office.ErrExtractUnavailable`, `*office.ExtractUnreadableError` (Task 1); `DriveOfficeExtractor` (`drive_content.go:92-97`).
- Produces (dùng ở Task 3, Task 5):
  - `type fileReadKind int` với `fileReadNone`, `fileReadText`, `fileReadOffice`, `fileReadPDF`;
  - `func fileKindOf(mimeType, filename string) (kind fileReadKind, extractMIME string)` — `mcpTextFile` → text; `mcpOfficeMIME` → office (kèm MIME); đuôi `.pdf` hay MIME `application/pdf` → pdf; còn lại none;
  - `func fileReadLimit(kind fileReadKind) int64` — text `mcpTextReadBytes+1`, office/pdf `mcpOfficeReadBytes+1`;
  - `type fileContent struct { Format, Content, Note string; Truncated bool }`;
  - `type fileSubject struct { OrganizationID, WorkspaceID, ActorID, DocumentID string }` — người đọc và đối tượng ghi vào grant;
  - `func (s *McpToolService) fileContentOf(ctx context.Context, kind fileReadKind, extractMIME string, raw []byte, sub fileSubject) fileContent` — làm việc trên bytes đã đọc (người gọi đọc và giữ khe); text như `mcpFileText`, office như `officeDocument` hiện nay, pdf qua `s.pdf`;
  - `func pdfPageTexts(text string) []string` (tách `\f`); `func pdfModelText(pages []string, truncated bool) (string, bool)` — mỗi trang có chữ thành `[page N]\n<chữ>`, nối bằng `\n\n`, cắt ở `mcpMaxItemRunes` với `mcpItemCut`; `func pdfIndexText(pages []string) string` — nối trang có chữ bằng `\n`, dừng ở `maxSearchContentRunes` rune;
  - `func (s *McpToolService) SetPDFText(x DriveOfficeExtractor)`.
- Ghi chú mới (tiếng Anh, cạnh các ghi chú cũ): `mcpPDFNote` = "only the text layer of this PDF is shown, page by page; images, scans and layout are not"; `mcpPDFNoTextNote` = "this PDF has no text layer (a scan or pictures only) and text recognition is not supported, so only its name and type are shown"; `mcpPDFUnavailableNote` = "PDF text cannot be read on this server, so only its name and type are shown"; `mcpNotTextNote` thêm `pdf` vào danh sách định dạng đọc được.

- [x] **Step 1: Viết test đỏ** (thế giới `newMcpToolWorld`, `x.docs(t)`; một `fakePDFText` trong test cài `DriveOfficeExtractor`, ghi lại request nhận được):
  - `TestGetDocumentReadsAPDF`: tải `report.pdf`; fake trả `"Trang một\fTrang hai"` → `Format = "extracted"`, `Content` chứa `"[page 1]\nTrang một"` và `"[page 2]\nTrang hai"`, `Note = mcpPDFNote`; request có `Format: ExtractFormatPDF`, `DocumentID` = id tài liệu, `ActorID` = người gọi, `ActorKind` rỗng hay `"human"`, `len(Content)` = cỡ tệp; một dòng `download` trong nhật ký truy cập như tệp Office.
  - `TestGetDocumentPDFNotes`: fake trả `"\f\f"` → `mcpPDFNoTextNote`; `&office.ExtractUnreadableError{Reason: "password_required"}` → `mcpOfficeUnreadableNote`; `office.ErrExtractUnavailable` → `mcpFileBusyNote`; không gọi `SetPDFText` → `mcpPDFUnavailableNote`; PDF > 20 MiB (kích thước khai qua `filesfake` như Task 2 kế hoạch 7) → `mcpOfficeTooLargeNote`, fake không được gọi. Mọi ca: lời gọi không lỗi, khe đọc được trả (sau test, `len(s.ask.fileReads) == 0`).
  - `TestPDFModelTextCutsAtTheItemCap` (`file_content_test.go`): 3 trang × 9.000 ký tự → kết quả ≤ `mcpMaxItemRunes` rune, kết thúc bằng `mcpItemCut`, `Truncated`; `pdfIndexText` cùng đầu vào ≤ `maxSearchContentRunes` rune và không chứa `[page`.
  - Các test DOCX/XLSX/PPTX/text hiện có của `get_document` vẫn xanh (bộ đọc dùng chung không đổi hành vi cũ).

- [x] **Step 2: Chạy, thấy đỏ.** `cd server && TEST_DATABASE_URL=… go test ./internal/service -run 'TestGetDocument|TestPDFModelText|TestMCP' -count=1` → FAIL ở test mới.

- [x] **Step 3: Cài đặt.** Viết `file_content.go`; `GetDocument` gọi `fileKindOf`, giữ khe cho office/pdf (như `officeDocument` nay), đọc `fileReadLimit(kind)` byte qua `fileRead`, rồi `fileContentOf`. Lỗi khi đọc bytes vẫn là `mcpFileBusyNote` và một dòng log có `document_id`. Sửa mô tả `get_document` ở MCP và ở Hỏi UNI (pdf đọc được theo trang). Nối `SetPDFText` trong `main.go` (`driveExtractor` là interface nil khi engine tắt).

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `go test ./internal/service -run 'TestAskAgentToolBytesAreStable|TestMCPReadToolsDoNotMutate' -count=1` và `go test ./internal/handler -run TestIsolationMCP -count=1`.

- [x] **Step 5: Commit** `feat(ask-uni): get_document reads the text layer of a PDF`.

### Task 3: Chỉ mục tìm kiếm đọc PDF

**Files:**
- Modify: `server/internal/service/document_text_index.go` (`NewDocumentTextIndexer` `:36`, `unindexableMIMEPrefixes` `:109`, `read` `:112-160`, `fileTextIndexMIME` `:197-210`, comment `Index` `:64-71`)
- Modify: `server/cmd/server/main.go:522`
- Modify: `server/cmd/document-text-reindex/` chỉ khi test của nó dựng indexer
- Test: `server/internal/service/document_text_index_test.go`

**Interfaces:**
- Consumes: `fileKindOf`, `pdfPageTexts`, `pdfIndexText` (Task 2); `ExtractFormatPDF`, `ActorKind` (Task 1).
- Produces: `func NewDocumentTextIndexer(docs *DocumentService, ask *AskUNIService, pdf DriveOfficeExtractor) *DocumentTextIndexer` (`pdf` nil → PDF lập chỉ mục rỗng). Request của PDF: `ActorKind: "system"`, `ActorID: "document_text_index"`, `DocumentID` = id tài liệu, tổ chức và workspace của tài liệu.

- [x] **Step 1: Viết test đỏ** (dùng `fakePDFText` của Task 2):
  - `TestTextIndexMakesPDFsSearchable`: tải `hop-dong.pdf`; fake trả `"Mở đầu\fĐiều khoản bảo hành 24 tháng"` → sau `Index`, `content_text` chứa `"Điều khoản bảo hành 24 tháng"` và không chứa `"[page"`; `x.searchIDs(t, x.p, "bao hanh 24 thang")` có id tệp; request của fake có `ActorKind: "system"`, `ActorID: "document_text_index"`.
  - `TestTextIndexDoesNotRetryWithoutTheEngine`: fake trả `office.ErrExtractUnavailable` → `Index` trả `nil`, `content_text = ''`; indexer dựng với `pdf == nil` → `nil`, fake không bao giờ được gọi; `ExtractUnreadableError` → `nil`, chữ rỗng.
  - Sửa `TestTextIndexClearsWhatItCannotRead`: bỏ ca PDF (nay đọc được); giữ HTML, DOCX hỏng, > 20 MiB.

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./internal/service -run 'TestTextIndex' -count=1` → FAIL.

- [x] **Step 3: Cài đặt.** Bỏ `application/pdf` khỏi `unindexableMIMEPrefixes`; trong `read`, sau khi mở version và đọc bytes (vẫn giữ khe, vẫn `recover`), loại `fileReadPDF` gọi `x.pdf.ExtractText` rồi `pdfIndexText(pdfPageTexts(text))`; mọi lỗi của engine (vắng, chưa cấu hình, không đọc được) → chữ rỗng, `nil` (ruling P7), một dòng log chỉ có id. Sửa comment `Index` và `fileTextIndexMIME` (PDF nay đọc được, HTML vẫn không). `main.go`: truyền `driveExtractor`.

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `go test ./cmd/document-text-reindex -count=1`.

- [x] **Step 5: Commit** `feat(documents): the text index reads PDFs through the office engine`.

### Task 4: Danh sách tệp nguồn lọc theo nơi chứa

**Files:**
- Modify: `server/pkg/db/queries/document_sources.sql` (bốn truy vấn `:27`, `:162`, `:280`, `:386`); `make sqlc`
- Modify: `server/internal/service/document_sources.go` (`DocumentSourceFilter` `:118-132`, `documentSourceQuery` `:184-195`, `List`, `query`)
- Test: `server/internal/service/document_sources_test.go`

**Interfaces:**
- Produces: `DocumentSourceFilter.ParentID string` — rỗng là không lọc; có giá trị thì chỉ giữ tệp ở phòng chat có id đó (`room_id`), ở công việc có id đó (`t.id`, gồm tệp của mọi bình luận của công việc), ở cuộc họp có id đó (`mt.id`), ở thread email có id đó (`th.id`). Mỗi truy vấn thêm `AND (sqlc.narg(parent_id)::text IS NULL OR <cột> = sqlc.narg(parent_id)::text)`. Route HTTP không đọc tham số này (ruling P9).

- [x] **Step 1: Viết test đỏ** `TestDocumentSourcesFilterByParent` (cảnh `newSourceScene`): công việc A có một tệp trên công việc và một tệp trên bình luận, công việc B có một tệp; phòng chat R1, R2 mỗi phòng một tệp → `List(..., ParentID: A)` trả đúng hai tệp của A; `ParentID: R1` trả đúng tệp của R1; `ParentID` của một phòng riêng người xem không ở → trang rỗng; `ParentID` của công việc ở tổ chức khác → trang rỗng; `ParentID: ""` → như cũ (cùng số dòng với test liệt kê đang có).

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./internal/service -run 'TestDocumentSources' -count=1` → FAIL.

- [x] **Step 3: Cài đặt** như Interfaces; `make sqlc`.

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `go test ./migrations -run TestEveryQueryNamesItsTenant -count=1` và `go test ./internal/handler -run 'DocumentSource' -count=1`.

- [x] **Step 5: Commit** `feat(documents): source files can be listed by the task, room or thread that holds them`.

### Task 5: Hỏi UNI liệt kê và đọc tệp đính kèm

**Files:**
- Create: `server/internal/service/askuni_source_files.go`
- Modify: `server/internal/service/askuni.go` (trường `sources *DocumentSourceService`, `SetDocumentSources`)
- Modify: `server/internal/service/askuni_agent_tools.go` (đăng ký hai công cụ sau `list_templates` `:190`)
- Modify: `server/cmd/server/main.go` (dựng một `DocumentSourceService`, truyền cho `askUNI.SetDocumentSources` và cho handler deps `DocumentSources` cạnh `AskUNI` `:978`, để `router.go:243` không dựng cái thứ hai)
- Test: `server/internal/service/askuni_source_files_test.go` (mới), `server/internal/service/askuni_agent_tools_test.go` (`TestAskAgentToolsStayInTheAskedWorkspace` `:148`, `TestAskAgentToolsRespectVisibility` `:222`), `server/internal/service/mcp_tools_test.go`

**Interfaces:**
- Consumes: `DocumentSourceService.List`, `.ViewSource`, `.Open` (`document_sources.go:197`, `:312`, `:294`), `ParentID` (Task 4); `fileKindOf`, `fileReadLimit`, `fileContentOf`, `fileSubject` (Task 2); `loadAIOptOuts` (`ai_opt_out.go`); `takeSlot`; `documentsOn` (`mcp_tools_documents.go:84`); `readTool`, `strArg`, `withText`, `moreNote`, `agentArgs`, `s.base`.
- Produces:
  - `func (s *AskUNIService) SetDocumentSources(d *DocumentSourceService)`;
  - công cụ `list_attachments`, mô tả: "Files attached to tasks (and their comments), chat messages and emails in this workspace that the user may open: Word, Excel, PowerPoint, PDF, Markdown, HTML and text files, newest first, 50 at a time. Meeting recordings are not listed; get_meeting and get_meeting_transcript read a meeting. Open a row with get_attachment." Tham số: `source` ("chat", "task", "email", "meeting" hay "" cho mọi nguồn), `parent_id` (id công việc, phòng chat hay thread email; "" cho mọi nơi), `query` (chữ trong tên tệp; ""), `type` (docx, xlsx, pptx, pdf, md, html, txt hay ""), `cursor`;
  - công cụ `get_attachment`, mô tả: "The text of one attached file from list_attachments: a text file's text, an Office file's text read paragraph by paragraph, slide by slide or row by row, a PDF's text page by page (no formatting, no scans). Up to 20 MiB." Tham số: `attachment_id` (id từ `list_attachments`);
  - mỗi dòng của `list_attachments`: `agentItem{Kind: "document", ID: <id nguồn>, Key, Href, Title: <tên tệp>, Text: "ID: …\nIn: <loại nơi chứa> <tên nơi chứa>\nSize: <byte>\nUpdated: <RFC3339>"}`, `Foreign = true`; trang sau → `moreNote` với cursor;
  - `get_attachment`: một `agentItem` cùng `Kind`/`ID`/`Key`/`Href`, `Text = withText(fields, content)`, `Body = content`, `Foreign = true`; `fields` gồm `ID`, `File: <tên> (<mime>)`, `In: …`, và `Note` khi có;
  - `Href` theo nơi chứa: chat `base+"/chat?room="+Parent.ID`; công việc `base+"/tasks/"+Parent.Ref`; email `base+"/email?thread="+Parent.ID+"&account="+Parent.Ref`; `Key = Href + "#" + ID` (ruling P8);
  - ghi chú mới: `askAttachmentOptOutNote` = "the person who shared this file declined AI processing, so its content is not read".
- Thứ tự trong `get_attachment`: cờ `documents` → `ViewSource` (lỗi → trả nguyên `not_found`) → chủ là người và đã tắt AI → ghi chú, dừng → `fileKindOf` none → `mcpNotTextNote`, dừng → `SizeBytes > mcpOfficeReadBytes` → `mcpOfficeTooLargeNote`, dừng → `takeSlot` (mọi loại, vì email đọc cả thân vào bộ nhớ) → `Open` → đọc tối đa `fileReadLimit(kind)` byte → đóng → `fileContentOf` với `fileSubject{DocumentID: <id nguồn>}`. Lỗi khi mở hay đọc sau khi lookup thành công → `mcpFileBusyNote`, không lỗi lời gọi.

- [x] **Step 1: Viết test đỏ** (`newAgentWorld`, `runAgentTool`; seed tệp nguồn như `document_sources_test.go`, tệp công việc có bytes thật qua đường tải tệp đính kèm của `TaskService` mà `task_attachments_test.go` dùng):
  - `TestAskListsAttachmentsOfATask`: công việc có `bao-gia.docx` → `list_attachments` với `parent_id` = id công việc trả một dòng, `Title = "bao-gia.docx"`, `Foreign`, `Href` kết thúc bằng `"/tasks/"+taskID`.
  - `TestAskReadsATaskAttachment`: `get_attachment` của DOCX có câu "Đơn hàng tháng 10" → `Body` chứa câu đó, `Foreign`; một PDF với `fakePDFText` → `Body` chứa `"[page 1]"`, request của fake có `DocumentID` = `"task:"+rowID`.
  - `TestAskAttachmentRefusals`: tệp trong phòng chat riêng người hỏi không ở → `not_found`; tệp đính kèm thư của người khác → `not_found`; id của công việc ở workspace khác cùng tổ chức, ở tổ chức khác, id không có, id tài liệu thư viện (không có `:`) → `not_found`; `get_document` với một id tệp nguồn (`"task:"+rowID`) → `not_found`; cờ `documents` tắt → `errMcpDocumentsUnavailable` như `list_templates`.
  - `TestAskAttachmentHonoursAIOptOut`: tệp chat của người đã đặt `ai_opt_out_at` → không có trong `list_attachments`; `get_attachment` trả `askAttachmentOptOutNote`, không đọc bytes (số lần mở của kho tệp không đổi).
  - `TestAskAttachmentTooLargeIsNotOpened`: dòng nguồn khai `size_bytes` 21 MiB → `mcpOfficeTooLargeNote`, không đọc bytes; khe trống sau lời gọi; một ca Open lỗi sau lookup (bytes đã xóa khỏi kho) → `mcpFileBusyNote`, khe trống.
  - `TestAskAttachmentToolsWriteNothing`: sau `list_attachments` và `get_attachment`, số dòng `audit_events`, `outbox_events` không đổi.
  - `TestAskAttachmentToolsAreNotOnTheConnector` (`mcp_tools_test.go`): danh sách công cụ MCP không có `list_attachments`, `get_attachment`.
  - Thêm ca `get_attachment` vào `TestAskAgentToolsStayInTheAskedWorkspace` và một ca phòng riêng vào `TestAskAgentToolsRespectVisibility`.

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./internal/service -run 'TestAskListsAttachments|TestAskReadsATaskAttachment|TestAskAttachment|TestAskAgentTools' -count=1` → FAIL.

- [x] **Step 3: Cài đặt** như Interfaces. `sources == nil` (chưa nối) → lỗi máy chủ như `errAskReadsNotWired`, không phải lỗi của model. Dòng bị bỏ vì người gửi tắt AI làm trang ngắn hơn 50: chấp nhận, vẫn trả cursor.

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `go test ./internal/service -run 'TestAskAgentToolBytesAreStable|TestAskUniLoopNeverRunsAWriteCommand|TestAskUniTaintedTurnNeverAutoApplies|TestMCPReadToolsDoNotMutate' -count=1` và `go test ./internal -run 'TestActorConstructedOnlyInService' -count=1`.

- [x] **Step 5: Commit** `feat(ask-uni): read files attached to tasks, chat and email`.

### Task 6: Tài liệu đóng vòng

**Files:**
- Modify: `docs/ops/RUNBOOK_DOCUMENTS.md` (mục "Chỉ mục chữ của tệp", dòng `:226`)
- Modify: `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` (dòng trạng thái `:3`; §6 Phần 1 "Đọc nội dung tệp" thay `ReadPDF` bằng Office engine, ghi ruling P1)
- Modify: kế hoạch này (dòng trạng thái)

- [x] **Step 1: Sửa runbook:** PDF nay được lập chỉ mục khi Office engine chạy; engine tắt hay lỗi thì chữ PDF để rỗng, không thử lại; sau khi bật hay sửa engine, chạy lại `document-text-reindex` theo các bước sẵn có. PDF quét vẫn không có chữ (không OCR).
- [x] **Step 2: Sửa spec và kế hoạch:** spec ghi kế hoạch 8 (issue, "đã triển khai trên nhánh, chờ PR"); kế hoạch đổi dòng trạng thái tương tự. Không sửa `docs/ask-uni-documents-assessment.md` (thuộc phiên khác).
- [x] **Step 3: Chạy** `node --test scripts/governance.test.mjs scripts/no-plan-literal.test.mjs` → pass.
- [x] **Step 4: Commit** `docs: plan 8 of Ask UNI drafting Office files on its branch`.

## Đã cố ý bỏ ra ngoài

- OCR cho PDF quét; sửa XLS/ODT (spec §Ngoài phạm vi).
- Tệp đính kèm câu hỏi (kéo vào khung Hỏi UNI) trên nhà cung cấp không đọc PDF gốc (OpenAI-compatible, Ollama): vẫn từ chối rõ như spec Hỏi UNI đính kèm; không đổi sang đọc chữ qua engine.
- Ảnh, tệp nén, CSV và ODT ở module khác: bề mặt tệp nguồn chỉ nhận bộ đuôi tài liệu (`documentSourceAllExts`); mở rộng bộ này là việc khác.
- `search` không trả tệp đính kèm; `list_attachments` có `query` theo tên.
- MCP connector không đọc tệp đính kèm (ADR 0031 §4).
- Chất lượng chữ trên PDF tiếng Việt dùng font CID chưa đo bằng fixture riêng; fixture có sẵn chỉ có tiêu đề có dấu.
- Eval sống của luồng mới: chỉ khi chủ sản phẩm đồng ý.
- Sửa kèm: lệnh `document-text-reindex` nay phát qua `service.RequestFileTextIndex` (luật arch: chỉ `internal/service` đặt tên actor; PR #535 đã merge khi test arch này còn đỏ). Hành vi không đổi.

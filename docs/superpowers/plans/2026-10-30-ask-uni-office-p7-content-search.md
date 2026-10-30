# Hỏi UNI soạn tệp Office — kế hoạch 7: tìm theo nội dung tệp (Phần 1b) Implementation Plan

> **Trạng thái:** in-progress — đã triển khai trên nhánh, chờ PR; chủ sản phẩm duyệt 2026-10-30; kế hoạch 7 (Phần 1b) của spec Hỏi UNI soạn tệp Office; issue UNI-2305 (con của UNI-415).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tìm kiếm tài liệu (`search` của Hỏi UNI, MCP connector và ô tìm của Tài liệu) khớp được chữ bên trong tệp DOCX, XLSX, PPTX, ODT, CSV, Markdown và TXT, không chỉ tên tệp.

**Architecture:** Mỗi lần một version tệp được ghi (tải lên, lưu từ trình soạn, khôi phục, sao chép, chuyển định dạng, tải thư mục), cùng giao dịch đó ghi một yêu cầu lập chỉ mục lên outbox. Một consumer ở làn chậm đọc bytes của version, trích chữ bằng `attachtext` (bộ đọc Phần 1a đang dùng), rồi ghi tối đa 20.000 ký tự vào `documents.content_text` và gập vào `search_text`, đúng như trang UniNote đã làm. Truy vấn tìm kiếm hiện có (trigram trên `search_text`, quyền kiểm trong SQL) không đổi; đoạn trích của kết quả lấy quanh chỗ khớp thay vì 160 ký tự đầu, để Hỏi UNI giữ được kết quả khớp sâu trong tệp. Tệp tải lên trước khi triển khai được lập chỉ mục bằng một lệnh chạy một lần.

**Tech Stack:** Go (`server/internal/service`, `server/internal/attachtext`, `server/internal/outbox`, sqlc), một lệnh `server/cmd/`, tài liệu Markdown.

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` §6 Phần 1 ("Tìm theo nội dung tệp (phần 1b)"), §3, §7.2. Số dòng trong kế hoạch lấy ở develop `03edf3699`.

## Global Constraints

- Không AI, không cờ mới (ruling P1 bên dưới). Trích chữ là mã Go cục bộ (`attachtext`); không gửi tệp ra ngoài.
- Không nới phạm vi đọc: kết quả tìm vẫn qua vị từ quyền trong SQL (`document_search.sql`); tài liệu hạn chế mà quản trị chỉ thấy qua `see_all` vẫn chỉ khớp theo tên, đoạn trích rỗng (DOC-05, `document_search.sql:20-25`).
- Mọi truy vấn sqlc mới chạm bảng tenant có `organization_id = $n` hoặc dòng `-- tenant:` (`TestEveryQueryNamesItsTenant`). Không migration.
- Ghi chỉ mục không phải lệnh nghiệp vụ: không tăng `revision`, `content_revision`, `updated_at`; không dòng audit; không ghi nhật ký truy cập tài liệu. Yêu cầu lập chỉ mục đi qua `audit.Recorder.Emit` như `file.thumbnail_requested` (`file_derivative.go:39-49`).
- Consumer đọc tệp ở `outbox.LaneSlow` và giữ chung khe đọc tệp của tiến trình (`AskUNIService.fileReads`, `askuni.go:107`): pod 512 MiB, mỗi lần đọc tới 20 MiB.
- Định dạng lập chỉ mục: DOCX, XLSX, PPTX, ODT, CSV, Markdown, TXT. Không PDF (chưa có kế hoạch đọc PDF), không HTML (spec Tài liệu §HTML: "HTML không được trích xuất vào tìm kiếm/AI"), không tệp > 20 MiB (`mcpOfficeReadBytes`).
- Không chạy toàn bộ `go test`, quét cả package hay `make check` trước khi xong mọi task; dùng `-run`. CI chạy toàn bộ trên PR. DB test: `TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable'`.
- Mã và comment tiếng Anh; tài liệu `docs/` tiếng Việt. Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không nhắc tên ClickUp.

## Ruling của người lập kế hoạch

- **P1 — không cờ.** Phần này không có AI, không đổi quyền, chỉ mục dựng lại được bằng lệnh của Task 4; một cờ chỉ thêm việc vận hành. Sai thì tốn một PR thêm cờ.
- **P2 — chữ tệp nằm ở `content_text`.** Mọi đường đổi tên, di chuyển đã tính `search_text = documentSearchText(title, ContentText)` (`document_tree.go:300`, `document_commit.go:1099`…), nên giữ chữ ở `content_text` làm chỉ mục sống qua đổi tên mà không sửa đường nào. `DocumentSDO` thôi gửi `content_text` cho tệp (Task 2) để payload không phình.
- **P3 — xóa chữ cũ khi có version mới.** `SetDocumentFileVersion` đặt `content_text = ''`; consumer điền lại vài giây sau. Thà tạm không khớp còn hơn khớp chữ của version cũ (ví dụ PDF thay DOCX).
- **P4 — đoạn trích quanh chỗ khớp.** SDO đã mô tả `snippet` là "Đoạn khớp ≤ 160 ký tự khi tìm bằng q" (`sdo/document.go:202`); đổi cho cả trang lẫn tệp.

## Review Focus

1. Tệp tải lên trước khi triển khai: phải tìm được sau khi chạy lệnh của Task 4 một lần (test ở Task 4).
2. Version mới (DOCX thay bằng PDF, hay tệp > 20 MiB) không được giữ chữ của version cũ; yêu cầu cũ đến muộn không ghi đè version mới (test ở Task 1 và Task 2).
3. Quản trị workspace tìm một chữ chỉ có trong thân của tệp hạn chế mình không đọc được: không ra tài liệu đó, đoạn trích rỗng (test ở Task 3).
4. Đổi tên hay di chuyển tệp đã lập chỉ mục: vẫn tìm được theo nội dung (test ở Task 2).
5. Lập chỉ mục không làm tệp nhảy lên đầu danh sách "gần đây" (không đổi `updated_at`), không thêm dòng "tải xuống" vào nhật ký truy cập (test ở Task 2).

---

### Task 1: Mỗi version tệp mới gửi một yêu cầu lập chỉ mục

**Files:**
- Modify: `server/internal/service/document_files.go` (`fileVersionParams` `:650`; thêm `insertFileVersion` cạnh nó; điểm gọi `:529`)
- Modify: các điểm gọi `q.InsertDocumentVersion(ctx, fileVersionParams(...))`: `document_commit.go:1079-1084`, `document_copy.go:289`, `document_copy_convert.go:190`, `document_upload_sessions.go:1311`, `document_folder_upload_complete.go:693`
- Modify: `server/internal/service/document_commit.go` (`pointAtNewFileVersion` `:1088-1107`: `searchText` tính từ `""`)
- Modify: `server/pkg/db/queries/document_files.sql` (`SetDocumentFileVersion` `:10-27`: thêm `content_text = ''`); chạy `make sqlc`
- Modify: `server/internal/outbox/catalogue.go` (cạnh `file.thumbnail_requested` `:454`), `docs/events/CATALOGUE.md` (cạnh `:82`)
- Modify: `server/internal/arch_test.go`
- Test: `server/internal/service/document_text_index_test.go` (mới)

**Interfaces:**
- Produces: hằng `topicDocumentTextIndexRequested = "document.text_index_requested"`; dòng catalogue `{Topic: "document.text_index_requested", Version: 1, Payload: []string{"document_id", "version_id", "organization_id", "workspace_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox}`; `func insertFileVersion(ctx context.Context, q *db.Queries, actor Actor, params db.InsertDocumentVersionParams) (db.DocumentVersion, error)` — chèn version rồi `auditRecorder.Emit` một event topic trên, `OrganizationID`/`WorkspaceID` của version, payload bốn id. Actor của event là actor của lệnh, như `auditRecorder.Record` ở `pointAtNewFileVersion`.

- [x] **Step 1: Viết test đỏ** trong `document_text_index_test.go`, dùng thế giới `newMcpToolWorld` + `x.docs(t)` + `x.textFile` (`mcp_tools_documents_test.go:29,141`) và `officeFile` (`:549`):
  - `TestFileVersionsRequestTheirTextIndex`: sau `CreateFileDocument` một DOCX → đúng một dòng `outbox_events` topic `document.text_index_requested` có `document_id` và `version_id` = `file_version_id` của tài liệu. Tải version mới bằng `CommitFileVersion` (`document_commit.go:416`, như `document_commit_*_test.go`) → thêm một dòng với `version_id` mới. `CopyDocument` (`document_copy.go:78`) tệp đó → một dòng cho bản sao. `RestoreDocumentVersion` (`document_versions.go:339`) về version 1 → thêm một dòng.
  - `TestNewFileVersionClearsTheIndexedText`: đặt tay `content_text = 'chữ cũ'`, `search_text` gồm chữ đó (SQL trong test); tải version mới → `content_text = ''`, `search_text = documentSearchText(title, "")`.
  - Trong `server/internal/arch_test.go`, `TestFileVersionsInsertThroughInsertFileVersion`: quét `internal/service/*.go` (trừ `_test.go`); chuỗi `fileVersionParams(` chỉ được xuất hiện trong `document_files.go`, và `InsertDocumentVersion(ctx, fileVersionParams` không xuất hiện ở đâu.

- [x] **Step 2: Chạy, thấy đỏ.** `cd server; TEST_DATABASE_URL=… go test ./internal/service -run 'TestFileVersionsRequestTheirTextIndex|TestNewFileVersionClearsTheIndexedText' -count=1` và `go test ./internal -run TestFileVersionsInsertThroughInsertFileVersion -count=1` → FAIL.

- [x] **Step 3: Cài đặt.** Thêm dòng catalogue ở hai nơi (topic nội bộ như `file.thumbnail_requested`, không vào `packages/core/types/events.ts`). Viết `insertFileVersion`; thay sáu điểm gọi. Sửa `SetDocumentFileVersion` và `pointAtNewFileVersion`. Sửa comment `document_search.go:28-31` và `:260-262` (chữ tệp nay được tìm, qua consumer của Task 2).

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `node --test scripts/events-catalogue.test.mjs` và `go test ./migrations -run TestEveryQueryNamesItsTenant -count=1`.

- [x] **Step 5: Commit** `feat(documents): every new file version requests its text index`.

### Task 2: Consumer lập chỉ mục chữ của tệp

**Files:**
- Create: `server/internal/service/document_text_index.go`
- Modify: `server/pkg/db/queries/document_files.sql` (thêm `SetDocumentFileText`); `make sqlc`
- Modify: `server/cmd/server/main.go` (cạnh `NewFileThumbnailConsumer` `:520`)
- Modify: `server/internal/handler/documents.go:946` (chỉ gửi `content_text` cho trang)
- Modify: `server/internal/attachtext/attachtext.go:1-3` (comment gói: Hỏi UNI không lưu chữ; chỉ mục tài liệu lưu tối đa 20.000 ký tự)
- Test: `server/internal/service/document_text_index_test.go`; test handler của GET tài liệu (thêm vào tệp test handler tài liệu đang có)

**Interfaces:**
- Consumes: topic và payload của Task 1; `mcpOfficeMIME` (`mcp_tools_office.go:26`); `mcpOfficeReadBytes`; `takeSlot` (`askuni_turn_files.go:64`); `DocumentService.openVersionFile` (`document_access.go:245`, không kiểm quyền, không ghi nhật ký truy cập); `LockDocumentByID` (khóa hàng như mọi lệnh tài liệu); `documentSearchText`, `maxSearchContentRunes`.
- Produces:
  - `type DocumentTextIndexer struct` với `func NewDocumentTextIndexer(docs *DocumentService, ask *AskUNIService) *DocumentTextIndexer` (`ask == nil` → khe riêng dung lượng 1);
  - `func (x *DocumentTextIndexer) Index(ctx context.Context, organizationID, documentID, versionID string) error`;
  - consumer: `Name() = "document_text_index"`, `Topics() = []string{topicDocumentTextIndexRequested}`, `DeliveryTimeout() = 60 * time.Second`, `Handle(ctx, outbox.Row) error`;
  - `func fileTextIndexMIME(mimeType, filename string) (string, bool)`: `mcpOfficeMIME` trước; rồi `.md`/`.markdown` → `text/markdown`, `.txt` → `text/plain`; HTML, PDF, còn lại → `false`;
  - `func fileIndexText(d attachtext.Doc) string`: nối `Label` (khi `Text` rỗng) và `Text` của từng `Part` bằng `\n`, dừng ở `maxSearchContentRunes` rune, không cắt giữa một rune;
  - query `-- name: SetDocumentFileText :execrows`: `UPDATE documents SET content_text = $content_text, search_text = $search_text WHERE id = $id AND organization_id = $organization_id AND workspace_id = $workspace_id AND kind = 'file' AND file_version_id = $file_version_id` (không đụng `revision`, `updated_at`).

- [x] **Step 1: Viết test đỏ** (cùng thế giới Task 1; gọi `Index` trực tiếp, không chạy dispatcher):
  - `TestTextIndexMakesOfficeFilesSearchable`: DOCX có câu "Điều khoản bảo hành 24 tháng" ở đoạn thứ 12 (sau 300 ký tự) → `Index` → `content_text` chứa câu đó; `x.searchIDs(t, x.p, "bao hanh 24 thang")` có id tệp. Làm lại với XLSX (ô B7) và PPTX (slide 3).
  - `TestTextIndexWritesNoBusinessChange`: sau `Index`, `revision`, `content_revision`, `updated_at` như trước; số dòng `audit_events`, `document_access_logs` của tài liệu như trước.
  - `TestTextIndexIgnoresAStaleVersion`: tải version 2, rồi `Index(…, versionID của version 1)` → `nil`, không ghi.
  - `TestTextIndexClearsWhatItCannotRead`: PDF, HTML, tệp DOCX hỏng, DOCX > `mcpOfficeReadBytes` (dùng `filesfake` để khai kích thước nếu không muốn sinh 20 MiB) → `content_text = ''`, `search_text = documentSearchText(title, "")`, trả `nil`.
  - `TestTextIndexWaitsForTheFileReadSlot`: giữ khe của `AskUNIService`; `Index` với ctx hết hạn 50 ms → trả lỗi (để outbox thử lại), không ghi gì.
  - `TestTextIndexSurvivesRenameAndMove`: sau `Index`, đổi tên rồi di chuyển tệp vào thư mục khác → vẫn tìm được "bao hanh 24 thang".
  - `TestTextIndexIgnoresOtherTenantsAndPages`: `organizationID` sai, id của một trang, id không tồn tại → `nil`, không ghi.
  - Test handler: GET tài liệu tệp đã lập chỉ mục → JSON không có khóa `content_text`; GET trang có `content_text` như trước.

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./internal/service -run 'TestTextIndex' -count=1` → FAIL (chưa có `DocumentTextIndexer`).

- [x] **Step 3: Cài đặt `Index`.** Thứ tự: đọc hàng (`GetDocumentByID`) và version (`GetDocumentVersionByID`); bỏ qua im lặng nếu không còn khớp (khác tổ chức, không phải `file`, `file_version_id` khác `versionID`, đã purge). `SizeBytes` > `mcpOfficeReadBytes` → chữ rỗng, không mở tệp. Ngược lại `takeSlot` (lỗi ctx → trả lỗi), mở bằng `openVersionFile` (reader mang tên tệp đã qua `versionFilename`), xác định MIME bằng `fileTextIndexMIME(version.MimeType.String, tên tệp của reader)`; không lập chỉ mục được → đóng reader, chữ rỗng; được → đọc tối đa `mcpOfficeReadBytes+1`, `attachtext.Extract`; `ErrUnreadable` → chữ rỗng; lỗi kho lưu → trả lỗi. Rồi một giao dịch: `LockDocumentByID`, kiểm lại `file_version_id` và tổ chức, `SetDocumentFileText` với `documentSearchText(hàng đã khóa.Title, chữ)`. `Handle` đọc payload như `FileThumbnailConsumer.Handle` (`file_derivative.go:236-246`). Đăng ký `dispatcher.RegisterLane(outbox.LaneSlow, service.NewDocumentTextIndexer(documentSvc, askUNI))` trong `main.go` (`askUNI` dựng ở `:333`). Sửa handler `:946` thành `readable && doc.Kind == service.DocumentKindPage && doc.ContentText != ""`.

- [x] **Step 4: Chạy lại, thấy xanh**: `-run 'TestTextIndex|TestFileVersionsRequestTheirTextIndex'` và test handler đã thêm; `gofmt`, `go vet ./internal/service ./cmd/server`, `go tool staticcheck ./internal/service`.

- [x] **Step 5: Commit** `feat(documents): a slow-lane consumer indexes the text of file documents`.

### Task 3: Đoạn trích quanh chỗ khớp; Hỏi UNI giữ kết quả khớp trong thân tệp

**Files:**
- Modify: `server/internal/service/document_search.go:801` (đoạn trích của kết quả tìm)
- Modify: `server/internal/service/search_text.go` (thêm `matchSnippet`)
- Test: `server/internal/service/search_text_test.go` (hoặc tệp test đang có của `foldForSearch`), `server/internal/service/document_text_index_test.go`

**Interfaces:**
- Consumes: `foldForSearch` (`search_text.go:15`); `Index` của Task 2 trong test.
- Produces: hằng `documentSnippetRunes = 160`; `func matchSnippet(contentText, query, sqlSnippet string) string`: trả `sqlSnippet` khi `query` rỗng hoặc `sqlSnippet` rỗng (rỗng nghĩa là người tìm không đọc được thân, DOC-05, hoặc thân rỗng); ngược lại tìm `foldForSearch(query)` trong `contentText` đã gập từng rune (giữ bảng vị trí rune gập → rune gốc; một dãy khoảng trắng gập thành một dấu cách, như `foldForSearch`), trả cửa sổ ≤ `documentSnippetRunes` rune quanh chỗ khớp, bắt đầu khoảng 40 rune trước nó, có `…` ở đầu và/hoặc cuối khi cắt; không thấy (khớp ở tên) → `sqlSnippet`.

- [x] **Step 1: Viết test đỏ.**
  - `TestMatchSnippet` (bảng): khớp ở ký tự 500 của một chuỗi tiếng Việt có dấu, query không dấu "bao hanh" → kết quả chứa "bảo hành", ≤ 160 rune, bắt đầu bằng `…`; khớp ở đầu → không có `…` đầu; query rỗng → trả `sqlSnippet`; `sqlSnippet` rỗng → rỗng (dù `contentText` có chữ khớp); không khớp → `sqlSnippet`; chuỗi có `đ`, emoji và xuống dòng không làm lệch vị trí.
  - `TestSearchSnippetShowsTheMatch`: sau `Index` DOCX của Task 2, `x.searchIDs` (`search` của MCP) trả mục có `Excerpt` chứa "bảo hành 24 tháng".
  - `TestAskUniSearchFindsWordsDeepInAFile`: cùng tệp, `agentSearch` của Hỏi UNI (`askuni_agent_tools.go:262`) với câu "điều khoản bảo hành" trả tài liệu đó (trước đây bị `score(title+snippet)` của `searchDocumentSources`, `askuni_sources.go:415-461`, loại vì đoạn trích là 160 ký tự đầu).
  - `TestRestrictedFileBodyStaysHidden`: tệp đã lập chỉ mục, đặt `visibility = restricted`, người tìm là quản trị workspace không có chia sẻ → tìm "bao hanh 24 thang" không ra tệp; tìm theo tên ra tệp với `Snippet` rỗng.

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./internal/service -run 'TestMatchSnippet|TestSearchSnippetShowsTheMatch|TestAskUniSearchFindsWordsDeepInAFile|TestRestrictedFileBodyStaysHidden' -count=1` → FAIL ở ba test đầu.

- [x] **Step 3: Cài đặt.** `matchSnippet` trong `search_text.go`; dòng `:801` thành `Snippet: matchSnippet(r.ContentText, in.Query, r.Snippet)` khi `matchTitle` tắt (tìm theo tên giữ `r.Snippet`).

- [x] **Step 4: Chạy lại, thấy xanh**, cùng các test tìm kiếm đang có: `-run 'Search|Snippet|McpSearch'` của `./internal/service` và `./internal/handler`.

- [x] **Step 5: Commit** `feat(documents): search snippets show the matched words`.

### Task 4: Lập chỉ mục tệp cũ, runbook, đóng vòng

**Files:**
- Create: `server/cmd/document-text-reindex/main.go`, `server/cmd/document-text-reindex/main_test.go`
- Modify: `server/pkg/db/queries/document_files.sql` (thêm `ListFileDocumentsForTextIndex`); `make sqlc`
- Modify: `docs/ops/RUNBOOK_DOCUMENTS.md` (mục mới "Chỉ mục chữ của tệp")
- Modify: `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` (dòng Trạng thái), kế hoạch này (dòng Trạng thái)

**Interfaces:**
- Consumes: topic và payload của Task 1; `audit.NewRecorder().Emit`, `audit.System("document-text-reindex")`.
- Produces: query `-- name: ListFileDocumentsForTextIndex :many` với dòng `-- tenant: system`: `SELECT id, organization_id, workspace_id, file_version_id FROM documents WHERE kind = 'file' AND file_version_id IS NOT NULL AND (sqlc.narg(organization_id)::text IS NULL OR organization_id = sqlc.narg(organization_id)) AND id > $after_id ORDER BY id LIMIT $page_limit`; lệnh `document-text-reindex (--org <id> | --all) [--dry-run] [--batch-size 200]`, chỉ đọc `DATABASE_URL` (khuôn `cmd/graph-rebuild/main.go`), mỗi lô một giao dịch phát một yêu cầu cho mỗi tệp, in `requested=<n>` (hoặc `would request=<n>` khi `--dry-run`). `--org` không tồn tại → lỗi.

- [x] **Step 1: Viết test đỏ** trong `main_test.go` (khuôn `cmd/graph-rebuild/main_test.go`): `TestUsage` (thiếu `--org`/`--all`, cả hai, đối số thừa → lỗi có "usage"); `TestReindexDryRunWritesNothing`; `TestReindexRequestsEveryFileDocument`: hai tệp và một trang trong một tổ chức, một tệp ở tổ chức khác → `--org` phát đúng hai dòng outbox topic `document.text_index_requested` với `version_id` = `file_version_id`; `--all` phát ba; `--batch-size 1` cho cùng kết quả.

- [x] **Step 2: Chạy, thấy đỏ.** `go test ./cmd/document-text-reindex -count=1` → FAIL.

- [x] **Step 3: Cài đặt** lệnh và query.

- [x] **Step 4: Chạy lại, thấy xanh**, cùng `go test ./migrations -run TestEveryQueryNamesItsTenant -count=1` và `go test ./internal -run 'TestFileVersionsInsertThroughInsertFileVersion' -count=1`.

- [x] **Step 5: Runbook.** Mục "Chỉ mục chữ của tệp" trong `RUNBOOK_DOCUMENTS.md`: chữ tệp nằm ở `content_text` (tối đa 20.000 ký tự), consumer `document_text_index` ở làn chậm; khi nào chạy lệnh (một lần sau lần triển khai đầu có tính năng này; sau khi đổi `attachtext`), chạy `--dry-run` trước, theo dõi làn chậm theo `RUNBOOK_OUTBOX.md`; định dạng không được lập chỉ mục (PDF, HTML, > 20 MiB) và lý do.

- [x] **Step 6: Đóng vòng tài liệu.** Spec: dòng Trạng thái thêm kế hoạch 7 (Phần 1b) và câu "Phần 1c và đọc PDF chưa có kế hoạch". Kế hoạch này: "in-progress — đã triển khai trên nhánh, chờ PR".

- [x] **Step 7: Commit** `feat(documents): document-text-reindex requests the index of existing files` và `docs: content search of files in the documents runbook and the plan status`.

- [ ] **Step 8: Việc ra ngoài, controller hỏi chủ sản phẩm trước:** đẩy nhánh; `make issue-pr KEY=<issue>`. Thân PR theo khuôn PR #532; mục "Đã cố ý bỏ ra ngoài": PDF, HTML, tệp > 20 MiB, Phần 1c, việc chạy `document-text-reindex` ở production (chủ sản phẩm hoặc ops chạy sau khi deploy).

### Việc của chủ sản phẩm hoặc ops (không phải code)

1. Sau lần deploy đầu có Phần 1b: chạy `document-text-reindex --all --dry-run`, rồi `--all`, theo runbook.
2. `make issue-done` cho issue của kế hoạch này sau khi PR merge.

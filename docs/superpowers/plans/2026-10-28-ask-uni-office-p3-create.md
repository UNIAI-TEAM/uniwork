# Hỏi UNI tạo tệp Office từ mẫu hoặc tệp trống (kế hoạch 3 — Phần 3) Implementation Plan

> **Trạng thái:** shipped — kế hoạch 3 của spec Hỏi UNI soạn tệp Office; merge vào develop 2026-10-28 qua PR #498 (`0cd5e5ae6`), issue UNI-2261 (con của UNI-415).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng nhờ Hỏi UNI soạn một tệp. Hỏi UNI tìm mẫu trong mục Mẫu văn bản, hoặc dùng tệp người dùng đính kèm, hoặc tạo tệp trống, rồi đưa một thẻ kế hoạch có dàn ý. Người dùng sửa dàn ý nếu cần và bấm "Tạo và mở". Tệp mới của người dùng được tạo và mở trong trình soạn.

**Architecture:**
- Phía server thêm một công cụ đọc `list_templates`.
- Thêm hai công cụ ghi theo ADR 0044, luôn ở mức 2:
  - `create_office_document` tạo tệp mới.
  - `save_attachment_template` lưu tệp đính kèm vào mục Mẫu.
- Tạo từ mẫu là lệnh mới `DocumentService.CreateDocumentFromTemplate`. Lệnh này dùng lại giao dịch của `CreateFileDocument`: claim lại `file_id` của version hiện tại của mẫu, không chép byte. Người hỏi là chủ tệp mới, và các cột `source_*` ghi tệp mới được làm từ mẫu nào.
- Phía web, thẻ đề xuất có thêm:
  - nhãn riêng cho trường và nút;
  - tự mở tài liệu sau khi Apply;
  - hộp "Sửa dàn ý" dùng `ContentEditor` (TipTap + Markdown).

**Tech Stack:** Go (pgx, sqlc), Ask UNI agent tools (`server/internal/service/askuni_*`), TypeScript (React Query, zod), React (`packages/views/ai`), i18n vi/en.

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md`
- §4 bước 1–4; §6 Phần 3; Phần 2, mục "Lưu từ khung chat" (chuyển sang đây).
- §7 quyết định 4, 6, 8, 10, 13; §8.

## Global Constraints

**Công cụ và quyền**
- Công cụ ghi của Hỏi UNI chỉ ghi đề xuất. Chỉ khi người hỏi bấm Apply thì lệnh mới chạy, dưới `service.Human(asker)`, qua cổng ghi chung (ADR 0044). Cả hai công cụ ghi mới **luôn ở mức 2** (`askLevel2`).
- Hỏi UNI không bao giờ ghi vào một mẫu; nó luôn tạo tài liệu mới (spec §7.13). Tệp tạo ra **không** mang dấu "là mẫu", không mang ACL, phạm vi xem hay chia sẻ của mẫu.
- Tệp mới là của người hỏi. Phạm vi mặc định là "chỉ mình tôi" (`restricted`); thẻ cho đổi sang `workspace` trước Apply (spec §7.8).
- `prepare` kiểm hai quyền:
  - quyền **sửa** ở thư mục đích;
  - quyền **đọc** mẫu, hoặc quyền sở hữu tệp đính kèm.
  
  Apply kiểm lại quyền thư mục trong giao dịch.
- Hỏi UNI chỉ đọc và ghi trong workspace đang hỏi. Mọi công cụ tài liệu đóng khi cờ `documents` tắt, như các công cụ tài liệu có sẵn.

**Thứ tự công cụ và cache**
- Thứ tự công cụ là một phần tiền tố cache prompt (`TestAskAgentToolBytesAreStable`). Công cụ mới chỉ thêm ở vị trí kế hoạch ghi. Mọi danh sách cứng trong test cập nhật cùng commit.

**Luật repo**
- Không `FOREIGN KEY`. Query sqlc ràng buộc `organization_id`/`workspace_id`. Audit và outbox ghi trong cùng giao dịch. Kế hoạch này **không** thêm migration hay sự kiện mới: tạo tệp vẫn ghi `document.created`.
- Chữ giao diện chỉ qua i18n vi/en (`i18next/no-literal-string`), giọng theo `docs/conventions.md` §3. Mỗi tệp `.ts`/`.tsx` tối đa 500 dòng.
- Code comment tiếng Anh. Không nhắc tên ClickUp trong code, test, commit, tài liệu.

**Chạy thử và kiểm**
- Không gọi model, không chạy eval AI thật (cần chủ sản phẩm đồng ý từng lần).
- Chạy test hẹp bằng `-run` hoặc vitest theo tệp. Không chạy `make check` hay toàn bộ `go test` cho tới khi xong mọi kế hoạch của spec; CI chạy toàn bộ.
- DB test: `TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable'`.

**Commit**
- Dạng `feat(ai): …`, `feat(documents): …`, `test(…): …`. Hook tự thêm `Refs: UNI-2261`.
- Cuối thân commit có `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Quyết định của người lập kế hoạch (chủ sản phẩm có thể bác)

1. **Phần 3 chưa giao việc cho AI trong trình soạn.** Gói giao việc, nhãn "Mở và soạn" / "Mở và dựng" và kiểm "AI trong trình soạn có chạy được không" đều chuyển sang Phần 4. Lý do: chỉ ở Phần 4 chúng mới có tác dụng; một nút "Mở và soạn" mà không giao việc là nói sai.
   - Ở Phần 3, mọi trường hợp dùng nút "Tạo và mở". Đây chính là đường dự phòng của spec ("Tạo và mở để tự soạn").
   - Dàn ý và yêu cầu nằm trong đối số đề xuất đã duyệt, để Phần 4 đọc lại.
   - Danh sách tư liệu (id + đoạn trích) cũng để Phần 4. Chỉ ở đó nó mới được dùng.
2. **Nguồn là một trong ba:** `template_id` (mẫu đã đánh dấu), `attachment_id` (tệp người hỏi đính kèm trong cuộc trò chuyện) hoặc `format` (tệp trống).
   - Định dạng dùng được: `docx`, `xlsx`, `pptx`, `pdf`, `md`, `html` (spec §2.2).
   - Mẫu hay tệp đính kèm ở định dạng khác (txt, csv, odt, ảnh) bị từ chối ở `prepare`.
3. **Tạo từ mẫu dùng lại giao dịch của `CreateFileDocument`**, không chép thân hàm.
   - Lệnh claim lại `file_id` của version hiện tại của mẫu, như `CopyDocument`: không tải byte, không tính thêm dung lượng.
   - Lệnh ghi `source_document_id`, `source_version_id`, `source_revision`, `source_format`, `target_format`, `source_checksum_sha256`. `conversion_reason` để NULL, nên **không cần migration**.
   - Audit dùng `document.created`, `changes.reason = "template"`.
4. **Thư mục đích.** Có `parent_id` thì tệp nằm trong thư mục đó. Không có `parent_id`:
   - phạm vi `restricted` → tệp vào Thư mục của tôi (`destination: my_folder`);
   - phạm vi `workspace` → tệp vào gốc Tài liệu của workspace.
   
   Thẻ hiện chỗ lưu. Thẻ không có bộ chọn thư mục: muốn đổi thư mục thì người dùng nói với Hỏi UNI, và Hỏi UNI đưa thẻ mới.
5. **Tệp đính kèm trong khung chat dùng hai công cụ độc lập.**
   - `save_attachment_template`: thẻ của nó chính là câu hỏi "Lưu vào Mẫu văn bản?".
   - `create_office_document` với `attachment_id`: "Chỉ dùng lần này" là chỉ áp dụng thẻ này.
   - Hai thẻ không tham chiếu nhau (`{{row:N.id}}`), nên bỏ qua thẻ lưu mẫu không chặn tệp làm việc.
   - Cả hai đọc lại byte của tệp đính kèm rồi tải vào Tài liệu. FileService không cho claim một tệp `ai_attachment` vào mục đích `document_file`.
6. **Model thấy id tệp đính kèm.** `ai.AttachedFile` có thêm `ID`, và khối tệp trong prompt in `(attachment_id: <id>)`. Không có cách khác để công cụ ghi gọi đúng tệp.
7. **Nhiều mẫu khớp thì Hỏi UNI liệt kê và hỏi, không đoán.** Luật này nằm trong mô tả công cụ. Không làm giao diện chọn mẫu riêng.
8. **Giới hạn.**
   - `outline` tối đa 16.000 ký tự (`mcpMaxItemRunes`) và bắt buộc khi tạo tệp trống. Có mẫu hoặc tệp đính kèm thì `outline` liệt kê phần sẽ điền và có thể rỗng.
   - `instructions` tối đa 4.000 ký tự.
   - Dàn ý đi nguyên văn vào `preview.body`, không cắt, để luôn sửa được.
9. **Hoàn tác** của cả hai công cụ là chuyển tệp vừa tạo vào thùng rác (`archive_document`), như `create_document`.
10. **Tự mở tài liệu** chỉ khi Apply đúng một thẻ `create_office_document`. Ở chế độ kế hoạch ("Duyệt cả kế hoạch"), dòng đã áp dụng giữ liên kết "Mở" như mọi thẻ khác.
11. **"Sửa dàn ý" là hộp thoại riêng dùng `ContentEditor`** (TipTap v3, `@tiptap/markdown`). Hộp lưu qua luồng sửa đối số có sẵn (`PATCH /api/v1/ai/proposals/{id}`). Form "Sửa" chung vẫn sửa được tên, phạm vi, định dạng và yêu cầu; nó không còn ô dàn ý.

## Review Focus

1. **Mẫu người hỏi không đọc được**, hoặc mẫu ở workspace khác: `prepare` trả `not_found` như mọi tài liệu không thấy, không lộ tiêu đề — test ở Task 3.
2. **Thư mục đích chỉ có quyền xem**: `prepare` từ chối trước khi có thẻ. Nếu quyền bị thu giữa lúc đưa thẻ và lúc Apply, Apply thất bại và không có tài liệu nào được tạo — test ở Task 1 và Task 3.
3. **Mẫu bị bỏ dấu hoặc vào thùng rác sau khi có thẻ**: Apply thất bại rõ ràng (`template_unavailable` hoặc `not_found`), không tạo tài liệu — test ở Task 1.
4. **Mẫu không bao giờ thay đổi**: sau khi tạo và ghi version mới vào tệp làm từ mẫu, mẫu vẫn giữ nguyên version, revision và dấu. Tệp mới không mang dấu, không mang chia sẻ của mẫu — test ở Task 1.
5. **Tệp đính kèm của người khác** hay của workspace khác thì không dùng được (`not_found`). Định dạng không mở được trong trình soạn thì bị từ chối bằng lời rõ ràng — test ở Task 3 và Task 4.

---

### Task 1: Lệnh "tạo từ mẫu" và kiểm quyền tạo trong thư mục

**Files:**
- Create: `server/internal/service/document_from_template.go`, `server/internal/service/document_from_template_test.go`
- Modify: `server/internal/service/document_files.go` (`CreateFileDocumentInput` `:310`, `CreateFileDocument` `:356`): nhánh nguồn là tệp có sẵn
- Modify: `server/internal/service/audit_coverage_test.go` (`TestReusedAuditActionCommandsWriteTheirOwnRows` `:3240`)

**Interfaces:**
- Produces (Task 3 dùng):
  - `type TemplateSourceInfo struct { ID, Title, Format string; Revision int64 }`. `Format` là chuỗi bộ lọc danh sách nhận (`docx`, `xlsx`, `pptx`, `pdf`, `md`, `html`, …).
  - `func (s *DocumentService) TemplateSource(ctx context.Context, actor Actor, workspaceID, templateID string) (TemplateSourceInfo, error)`: chỉ đọc. Kiểm:
    - người gọi là người;
    - đọc được (`authorizeDocument(…, DocumentLevelView)`);
    - cùng workspace;
    - `kind = file`;
    - không có `owner_kind`;
    - không ở thùng rác;
    - còn dấu `template_marked_at`.
    
    Trả về: không đọc được, khác workspace hoặc đã vào thùng rác → `ErrNotFound`; còn đọc được nhưng không còn dấu → `errTemplateUnavailable()`.
  - `func errTemplateUnavailable() error`: `coded(http.StatusConflict, "template_unavailable", "Tài liệu này không còn là mẫu.")`.
  - `type CreateFromTemplateInput struct { TemplateID, ParentID, Destination, Title, Visibility, IdempotencyKey string }`
  - `func (s *DocumentService) CreateDocumentFromTemplate(ctx context.Context, actor Actor, workspaceID string, in CreateFromTemplateInput) (DocumentFileResult, error)`
  - `func (s *DocumentService) CheckCreateIn(ctx context.Context, actor Actor, workspaceID, parentID string) error`: chỉ đọc, không khóa.
    - `parentID == ""` → chỉ `RequireMember`.
    - Khác rỗng → `authorizeParentIn` (`document_pages.go:494`).
    - Trả `nil`, `ErrNotFound` hoặc `ErrForbidden`.

- [ ] **Step 1: Viết test fail** trong `document_from_template_test.go`, trên fixture tài liệu tệp có sẵn của gói service. Tìm fixture bằng `TestDocumentCopyKeepsTheHomeRow` trong `document_copy_test.go`. Mẫu được đánh dấu bằng `MarkDocumentTemplate`.
  - `TestCreateDocumentFromTemplateMakesTheAskersOwnFile`: B tạo từ mẫu của A, với `Destination: "my_folder"`. Kỳ vọng:
    - `ACLOwnerID == B`, `Visibility == "restricted"`, nằm trong Thư mục của B;
    - `TemplateMarkedAt` không có giá trị;
    - `source_document_id`, `source_version_id` trỏ về mẫu và version hiện tại của nó;
    - `file_id` của version 1 bằng `file_id` của version hiện tại của mẫu;
    - dung lượng dùng của tổ chức không đổi;
    - đúng 1 dòng audit `document.created` có `changes.reason == "template"`, và 1 dòng outbox `document.created`.
  - `TestCreateDocumentFromTemplateLeavesTheTemplateAlone`:
    - mẫu có một chia sẻ cho C; tệp mới không có chia sẻ nào;
    - ghi version 2 vào tệp mới;
    - mẫu vẫn giữ `current_version`, `revision`, `template_marked_at` như trước.
  - `TestCreateDocumentFromTemplateRefusesWhatIsNotATemplate`:
    - tài liệu tệp chưa đánh dấu → 409 `template_unavailable`;
    - mẫu đã vào thùng rác → `ErrNotFound`;
    - mẫu `restricted` B không đọc được → `ErrNotFound`;
    - mẫu ở workspace khác → `ErrNotFound`;
    - actor là agent → `ErrForbidden`.
    
    Mỗi trường hợp: số tài liệu của workspace không đổi.
  - `TestCreateDocumentFromTemplateChecksTheFolderInTheTransaction`: B chỉ có `view` ở thư mục X.
    - `CheckCreateIn(B, ws, X)` → `ErrForbidden`;
    - `CreateDocumentFromTemplate` với `ParentID: X` → `ErrForbidden`, không có tài liệu mới;
    - B có `edit` thì thành công.
  - `TestCheckCreateIn`:
    - gốc workspace với thành viên → `nil`;
    - người ngoài workspace → lỗi của `RequireMember`;
    - thư mục B không đọc được → `ErrNotFound`.
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `cd server && TEST_DATABASE_URL=… go test ./internal/service -run '^(TestCreateDocumentFromTemplate.*|TestCheckCreateIn)$'`
  - Kết quả: FAIL (chưa có hàm).
- [ ] **Step 3: Hiện thực.**
  - Thêm vào `CreateFileDocumentInput` một trường không export, ví dụ `fromVersion *templateFileSource`, chỉ đặt bên trong gói service.
  - Khi trường có giá trị, `CreateFileDocument`:
    - bỏ qua `uploadChecked`;
    - dùng tệp đã `resolveUpload` từ `currentFileVersion` của mẫu;
    - bỏ qua `consumeStorage`, như `CopyDocument` (T1-Q9);
    - ghi các cột `source_*` lên `InsertDocument`;
    - thêm `source_document_id`, `source_version_id`, `reason: "template"` vào `changes` của audit.
  
  Phần còn lại của giao dịch đi đường cũ: `BeginIdempotent`, claim, khóa cây và cha, `createHomeRow`, version, audit, outbox. Không chép giao dịch sang tệp mới.
  - Fingerprint idempotency gồm cả `TemplateID`.
  - `CreateDocumentFromTemplate` gọi `TemplateSource` trước giao dịch rồi gọi `CreateFileDocument`. Bên trong giao dịch kiểm lại bằng `authorizeDocumentQ` và dấu mẫu (đọc lại dòng mẫu bằng `q`). Mẫu mất dấu giữa chừng → `errTemplateUnavailable()`.
- [ ] **Step 4: Thêm ca vào `TestReusedAuditActionCommandsWriteTheirOwnRows`.**
  - Ca: `cases["CreateDocumentFromTemplate"]`.
  - Kỳ vọng: đúng một audit `document.created` và một outbox cho tài liệu mới.
- [ ] **Step 5: Chạy lại test.**
  - Lệnh: lệnh ở Step 2, thêm `|TestReusedAuditActionCommandsWriteTheirOwnRows|TestDocumentCopy.*|TestCreateWithMyFolderDestination|TestCreateFileDocumentAsTemplate.*` vào `-run`.
  - Kỳ vọng: PASS.
- [ ] **Step 6: Commit** `feat(documents): create a document from a template without copying its bytes`.

### Task 2: Công cụ đọc `list_templates` và id tệp đính kèm trong prompt

**Files:**
- Modify: `server/internal/service/askuni_agent_tools.go` (`agentTools()` `:149`, sau `list_documents`), thêm `agentListTemplates`
- Modify: `server/internal/service/askuni_agent_tools_test.go` (`agentToolOrder` `:20`), các test dựng request lấy từ danh sách này (`askuni_agent_test.go`, `askuni_agent_actions_test.go`, `askuni_memory_test.go`) nếu chúng đếm công cụ
- Modify: `server/internal/ai/prompts.go` (`AttachedFile` `:879`, `renderAttachedFiles` `:886`), `server/internal/service/askuni_file_plan.go` (dựng `ai.AttachedFile`), cùng snapshot/test byte prompt bị đổi
- Modify: `server/internal/metrics/ai_ask.go` (`askTools` `:25`: thêm `list_documents` và `list_templates`)

**Interfaces:**
- Consumes: `DocumentService.ListTemplateDocuments` (`document_search.go:517`), `McpToolService.documentsOn`.
- Produces (Task 3, 4 dùng): `ai.AttachedFile.ID string` là `ai_attachments.id`. Dòng tên tệp trong prompt có thêm ` (attachment_id: <id>)`.

- [ ] **Step 1: Viết test fail.**
  - `TestAskAgentListTemplates` (`askuni_agent_tools_test.go`), dùng `runAgentTool`:
    - workspace có 2 mẫu docx, 1 mẫu pptx và 1 tài liệu docx không phải mẫu;
    - `{"format":"","cursor":""}` → 3 mục `Kind: "document"`; `Text` của mỗi mục chứa `ID: <id>` và `Format: <format>`;
    - `{"format":"pptx","cursor":""}` → 1 mục;
    - mẫu `restricted` người hỏi không đọc được thì không xuất hiện;
    - cờ `documents` tắt → cùng câu trả lời `list_documents` đưa khi cờ tắt.
  - Thêm `list_templates` vào ca workspace khác của `TestAskAgentToolsStayInTheAskedWorkspace` (`:147`): mẫu ở workspace hai không xuất hiện.
  - `TestRenderAttachedFilesShowsTheAttachmentID` (`server/internal/ai`): một `AttachedFile{ID: "att1", Name: "Bao gia.docx", …}` cho ra dòng chứa `Bao gia.docx (attachment_id: att1)`.
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `go test ./internal/service -run '^(TestAskAgentListTemplates|TestAskAgentToolsStayInTheAskedWorkspace)$'` và `go test ./internal/ai -run '^TestRenderAttachedFilesShowsTheAttachmentID$'`
  - Kết quả: FAIL.
- [ ] **Step 3: Hiện thực.**
  - Khai báo `readTool("list_templates", …)` có hai thuộc tính `format` và `cursor`:
    - `format`: `strArg("docx, xlsx, pptx, pdf, md or html; an empty string lists every format")`;
    - `cursor`: như `list_documents`.
  - Mô tả công cụ, nguyên văn: `"Templates in this workspace's Templates section (Mẫu văn bản), newest first. Use it before create_office_document to find the template the asker means. Filter by format, or pass an empty string for every format."`
  - `agentListTemplates`:
    - kiểm `documentsOn` trước;
    - gọi `s.docs.ListTemplateDocuments(ctx, Human(tc.ActorID), tc.WorkspaceID, ListDocumentsInput{Format, Cursor, Limit: 50})`;
    - định dạng mục như `agentListDocuments`, kèm `moreNote` khi còn trang;
    - định dạng sai → `invalid_args`.
  - `ai.AttachedFile` thêm `ID`; `planAskFiles` điền id dòng `ai_attachments` của tệp.
  - Cập nhật `agentToolOrder`, các danh sách đếm công cụ và byte prompt mong đợi trong test.
- [ ] **Step 4: Chạy lại test.**
  - Lệnh: lệnh ở Step 2, thêm `TestAskAgentToolBytesAreStable|TestAskAgentToolsAreReadOnly|TestAskAgent.*` (service) và `TestRenderAttachedFiles.*|TestAskPrompt.*` (ai).
  - Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(ai): Ask UNI lists the workspace's templates and sees attachment ids`.

### Task 3: Công cụ ghi `create_office_document`

**Files:**
- Create: `server/internal/service/askuni_write_office.go`, `server/internal/service/askuni_write_office_test.go`
- Modify: `server/internal/service/askuni_write_documents.go` (`askDocumentTools()` `:99-117`: thêm công cụ sau `add_document_comment`)
- Modify: `server/internal/service/askuni_actions.go` (`askIDFields` `:178`: `"create_office_document": {}`)
- Modify: `server/internal/service/askuni.go` (`SetOffice`), `server/cmd/server/main.go` (gọi `askUNI.SetOffice(officeSvc)` cạnh `SetDocuments` `:796`)
- Modify: `server/internal/service/askuni_actions_test.go` (`TestAskUniWriteToolCatalogue` `:77`), `server/internal/handler/askuni_proposal_only_test.go` (bộ 14 công cụ → 15), `server/internal/metrics/ai_ask.go` (`askWriteTools` `:34`)

**Interfaces:**
- Consumes:
  - Task 1: `TemplateSource`, `CreateDocumentFromTemplate`, `CheckCreateIn`.
  - Task 2: `ai.AttachedFile.ID`.
  - `DocumentOfficeService.CreateBlankFile` (`document_office_capability.go:313`), `AskUNIService.OpenAttachment` (`askuni_attachments.go:204`), `DocumentService.CreateFileDocument`.
- Produces (Task 4, 5, 6 dùng):
  - `func (s *AskUNIService) SetOffice(o *DocumentOfficeService)`
  - `func (s *AskUNIService) ownAttachment(ctx context.Context, userID, workspaceID, attachmentID string) (AskAttachment, error)`: đọc dòng `ai_attachments` của chính người hỏi, không đọc byte. Không thấy → `ErrNotFound`.
  - `func officeFormatOfMIME(mime string) (string, bool)`: chỉ nhận sáu định dạng `docx|xlsx|pptx|pdf|md|html`.
  - Đối số công cụ (schema JSON tự viết, `additionalProperties: false`, `required: ["title"]`): `title`, `template_id`, `attachment_id`, `format` (enum sáu định dạng), `parent_id`, `visibility` (enum `restricted|workspace`), `instructions`, `outline`.
  - Preview gửi client:
    - `target {kind:"document", title}`;
    - trường nguồn, đúng một trong ba:
      - `template_id`: kiểu `text`, `to` = tiêu đề mẫu;
      - `attachment_id`: kiểu `text`, `to` = tên tệp;
      - `format`: kiểu `enum`, `options` sáu định dạng;
    - `title` (`text`);
    - chỗ lưu, một trong hai:
      - có `parent_id`: trường `parent_id`, kiểu `text`, `to` = tiêu đề thư mục;
      - không có: trường `location`, kiểu `enum`, `options: []`, `to` = `my_folder` hoặc `workspace_root`;
    - `visibility` (`enum`, `options: ["restricted","workspace"]`);
    - `instructions` (`text`), chỉ khi khác rỗng;
    - `body` = `outline` nguyên văn, `body_truncated: false`;
    - `audience.visibility` = `private` hoặc `workspace`.
  - Kết quả Apply: `ObjectID` = id tài liệu mới, `Href` = URL tài liệu như `create_document`. Nghịch đảo là `archive_document`.

- [ ] **Step 1: Viết test fail** trong `askuni_write_office_test.go`, theo cách làm của `askuni_write_documents_test.go`: prepare qua đường đề xuất, Apply qua `ApplyProposal`, Undo qua `UndoProposal`.
  - `TestAskCreateOfficeFromTemplate`: đề xuất từ một mẫu docx. Kỳ vọng:
    - `Level == "l2"`, trường `template_id.to` là tiêu đề mẫu;
    - body là dàn ý, `location.to == "my_folder"`, audience `private`.
    
    Sau Apply:
    - tài liệu mới của người hỏi, `restricted`, trong Thư mục của họ;
    - `source_document_id` = mẫu; mẫu không đổi revision.
    
    Sau Undo: tài liệu mới ở thùng rác.
  - `TestAskCreateOfficeBlank`:
    - `{"title":"Đề xuất","format":"docx","outline":"## Mục 1"}` → Apply tạo một tệp docx trống;
    - `format` có mà `outline` rỗng → `invalid_args` nhắc `outline`.
  - `TestAskCreateOfficeNeedsExactlyOneSource`: không có nguồn nào, hoặc có cả `template_id` và `format` → `invalid_args`.
  - `TestAskCreateOfficeRefusesTemplatesTheAskerCannotUse`:
    - mẫu `restricted` người hỏi không đọc được → `not_found`, preview không chứa tiêu đề mẫu;
    - tài liệu chưa đánh dấu → lỗi `template_unavailable`;
    - mẫu `.txt` → `invalid_args`;
    - mẫu ở workspace khác → `not_found`.
  - `TestAskCreateOfficeNeedsEditOnTheFolder`: thư mục người hỏi chỉ có `view` → `prepare` lỗi `ErrForbidden`, không có đề xuất. Thu quyền `edit` sau khi đề xuất xong → Apply thất bại và số tài liệu không đổi.
  - `TestAskCreateOfficeFromAttachment`:
    - tệp docx người hỏi đính kèm → Apply tạo tài liệu có cùng checksum byte;
    - tệp đính kèm của người khác → `not_found`;
    - tệp `.csv` → `invalid_args`.
  - `TestAskCreateOfficeVisibilityEdit`: `EditProposal` với `{"visibility":"workspace"}`. Kỳ vọng:
    - `location.to == "workspace_root"`, audience `workspace`;
    - Apply tạo tài liệu `workspace` ở gốc.
  - `TestAskCreateOfficeCapsItsText`: `outline` 16.001 ký tự hoặc `instructions` 4.001 ký tự → `invalid_args`.
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `go test ./internal/service -run '^TestAskCreateOffice.*$'`
  - Kết quả: FAIL.
- [ ] **Step 3: Hiện thực công cụ.**
  - Khai báo `ai.Tool{Name: "create_office_document", Kind: ai.ToolWrite, Risk: ai.RiskMedium, Undo: "the asker moves the new file to the trash", …}`.
  - Mô tả công cụ, nguyên văn: `"Create a new Office file (Word, Excel, PowerPoint, PDF, Markdown or HTML) for the asker and open it in the editor. Start from exactly one of: a template from the workspace's Templates section (template_id from list_templates), a file the asker attached in this conversation (attachment_id), or a blank file (format). This always makes a new file; never edit a template itself. If several templates fit, list them and ask which one; do not guess. Give an outline in Markdown. It is required for a blank file: pptx one '## ' heading per slide with its points, docx the table of contents as headings with a line each, xlsx one heading per sheet listing its columns. With a template or an attached file, list the parts you will fill. The file stays private to the asker unless they ask to share it with the workspace."`
  - `prepare`, theo thứ tự:
    1. decode;
    2. giới hạn độ dài;
    3. đúng một nguồn;
    4. `documentsOn`;
    5. kiểm nguồn: `TemplateSource`, hoặc `ownAttachment` + `officeFormatOfMIME`, hoặc format hợp lệ;
    6. `CheckCreateIn(Human(tc.ActorID), tc.WorkspaceID, parent_id)` (tiêu đề thư mục đọc qua `s.reads.document`);
    7. dựng preview như phần Interfaces;
    8. `Read` gồm mẫu và thư mục;
    9. luôn trả `askLevel2`.
  - `apply`, theo nguồn:
    - mẫu → `CreateDocumentFromTemplate`;
    - tệp đính kèm → `OpenAttachment` rồi `CreateFileDocument{Body, Filename: att.Name, …}`;
    - format → `s.office.CreateBlankFile`; `s.office == nil` thì trả lỗi `office_not_configured` có sẵn.
    
    Không có `parent_id` thì `Destination` là `my_folder` với `restricted`, rỗng với `workspace`. Kết quả lấy nghịch đảo bằng `askInverseOrNote(&out, "archive_document", …)`.
  - Cập nhật danh sách công cụ trong `TestAskUniWriteToolCatalogue`, bộ công cụ trong `handler/askuni_proposal_only_test.go`, danh sách nhãn của `metrics/ai_ask.go`.
- [ ] **Step 4: Chạy lại test.**
  - Lệnh: `go test ./internal/service -run '^(TestAskCreateOffice.*|TestAskUniWriteTool.*|TestRowRefsOnlyInIDFields|TestAskUniWriteToolsOnlyWhenOpen|TestAIWriteGateIsShared)$'` và `go test ./internal/handler -run '^(TestAskUniLoopNeverRunsAWriteCommand|TestAskUniOnlyTheAskerDecidesAProposal)$'` và `go build ./cmd/server`
  - Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(ai): Ask UNI proposes a new Office file from a template, an attachment or a blank`.

### Task 4: Công cụ ghi `save_attachment_template`

**Files:**
- Modify: `server/internal/service/askuni_write_office.go`, `server/internal/service/askuni_write_office_test.go`
- Modify: `server/internal/service/askuni_write_documents.go` (sau `create_office_document`), `askuni_actions.go` (`askIDFields`: `"save_attachment_template": {}`), `askuni_actions_test.go`, `handler/askuni_proposal_only_test.go` (→ 16), `metrics/ai_ask.go`

**Interfaces:**
- Consumes (Task 3): `ownAttachment`, `officeFormatOfMIME`, `OpenAttachment`, `CreateFileDocument{Template: true}`.
- Produces:
  - Đối số: `attachment_id` (bắt buộc), `title` (tùy chọn; rỗng thì lấy tên tệp).
  - Preview:
    - `target {kind:"document", title}`;
    - trường `attachment_id` (`text`, `to` = tên tệp) và `title`;
    - `audience.visibility: "workspace"`;
    - mức `l2`.
  - Kết quả Apply là id của mẫu vừa lưu. Nghịch đảo là `archive_document`.

- [ ] **Step 1: Viết test fail.**
  - `TestAskSaveAttachmentTemplate`: tệp pptx người hỏi đính kèm. Kỳ vọng sau Apply:
    - tài liệu ở gốc workspace, phạm vi `workspace`, mức `edit`, người hỏi là chủ;
    - `template_marked_at` có giá trị;
    - xuất hiện trong `ListTemplateDocuments`.
    
    Sau Undo: tài liệu ở thùng rác và rời danh sách mẫu.
  - `TestAskSaveAttachmentTemplateRefuses`:
    - tệp đính kèm của người khác → `not_found`;
    - tệp `.png` → `invalid_args`;
    - cờ `documents` tắt → cùng lỗi như các công cụ tài liệu khác.
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `go test ./internal/service -run '^TestAskSaveAttachmentTemplate.*$'`
  - Kết quả: FAIL.
- [ ] **Step 3: Hiện thực.**
  - Khai báo `ai.Tool{Name: "save_attachment_template", Risk: ai.RiskMedium, Undo: "the asker moves the saved template to the trash", …}`.
  - Mô tả công cụ, nguyên văn: `"Save a file the asker attached in this conversation into the workspace's Templates section, so everyone in the workspace can reuse it. Propose it when the asker attaches a file to use as a template and has not said whether to keep it; the card asks them. To use the file only this once, propose create_office_document with its attachment_id instead."`
  - Cập nhật ba danh sách công cụ cứng như Task 3.
- [ ] **Step 4: Chạy lại test.**
  - Lệnh: lệnh ở Step 2, cộng các lệnh ở Step 4 của Task 3.
  - Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(ai): Ask UNI offers to save an attached file to Templates`.

### Task 5: Thẻ đề xuất trên web — nhãn, nút "Tạo và mở", tự mở tài liệu

**Files:**
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (khối `ai.proposal.*`)
- Modify: `packages/views/ai/ask-uni-proposal-values.ts` (`bodyArg` `:86`, `formatProposalValue` `:40`, hàm mới `applyLabelKey`)
- Modify: `packages/views/ai/ask-uni-proposal-row.tsx` (nhãn nút `:262`, tiêu đề phần thân cho dàn ý)
- Modify: `packages/views/ai/ask-uni-proposal-card.tsx` (`go()` `:47-51`: thêm `onSuccess`, mở tài liệu)
- Test: `packages/views/ai/ask-uni-proposal-card.test.tsx`, `packages/views/ai/ask-uni-proposal-values.test.ts` (tạo nếu chưa có)

**Interfaces:**
- Consumes: preview của Task 3 và Task 4; `paths.workspace(org, ws).document(id)`; `useNavigation().push`; `useOptionalWorkspace()`.
- Produces (Task 6 dùng):
  - `bodyArg("create_office_document") === "outline"`;
  - `function applyLabelKey(tool: string): string` trả:
    - `create_office_document` → `"ai.proposal.apply_create_open"`;
    - `save_attachment_template` → `"ai.proposal.apply_save_template"`;
    - các công cụ khác → `"ai.proposal.apply"`.
- Chữ i18n mới (vi / en):

| Key | vi | en |
| --- | --- | --- |
| `ai.proposal.tool.create_office_document` | "Tạo tệp mới" | "Create a new file" |
| `ai.proposal.tool.save_attachment_template` | "Lưu vào Mẫu văn bản" | "Save to Templates" |
| `ai.proposal.field.template_id` | "Mẫu" | "Template" |
| `ai.proposal.field.attachment_id` | "Tệp đính kèm" | "Attached file" |
| `ai.proposal.field.format` | "Định dạng" | "Format" |
| `ai.proposal.field.parent_id` | "Thư mục" | "Folder" |
| `ai.proposal.field.location` | "Thư mục" | "Folder" |
| `ai.proposal.field.visibility` | "Ai xem được" | "Who can see it" |
| `ai.proposal.field.instructions` | "Yêu cầu" | "Request" |
| `ai.proposal.location.my_folder` | "Thư mục của tôi" | "My folder" |
| `ai.proposal.location.workspace_root` | "Tài liệu của workspace" | "Workspace documents" |
| `ai.proposal.visibility.restricted` | "Chỉ mình tôi" | "Only me" |
| `ai.proposal.visibility.workspace` | "Cả workspace" | "Whole workspace" |
| `ai.proposal.apply_create_open` | "Tạo và mở" | "Create and open" |
| `ai.proposal.apply_save_template` | "Lưu vào Mẫu" | "Save to Templates" |
| `ai.proposal.outline` | "Dàn ý" | "Outline" |

- [ ] **Step 1: Viết test fail.**
  - `formatProposalValue`:
    - `visibility` `"restricted"` → "Chỉ mình tôi";
    - `location` `"my_folder"` → "Thư mục của tôi";
    - `format` `"pptx"` → "PPTX".
  - `applyLabelKey`: ba nhánh như trên.
  - Card, với một đề xuất `create_office_document` đang chờ:
    - nút "Tạo và mở" thay cho "Áp dụng";
    - phần thân có tiêu đề "Dàn ý";
    - Apply thành công với `result.object_id: "d9"` gọi `push("/acme/doi/documents/d9")`;
    - Apply thất bại không điều hướng;
    - đề xuất `create_document` vẫn hiện "Áp dụng" và không điều hướng.
  - Chế độ kế hoạch: "Duyệt cả kế hoạch" có một dòng `create_office_document` thì không gọi `push`.
  - Form "Sửa": tùy chọn của `visibility` hiện "Chỉ mình tôi" / "Cả workspace".
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `cd packages/views && pnpm exec vitest run ai/ask-uni-proposal-card.test.tsx ai/ask-uni-proposal-values.test.ts`
  - Kết quả: FAIL.
- [ ] **Step 3: Hiện thực.**
  - Thêm nhánh `visibility` / `location` / `format` trong `formatProposalValue`. Dùng cùng hàm đó cho nhãn tùy chọn enum trong `ask-uni-proposal-edit.tsx`.
  - Nút Apply dùng `t(applyLabelKey(proposal.tool))`.
  - Card thêm `onSuccess` cho Apply một dòng. Khi `row.tool === "create_office_document"` và `row.result.object_id` khác rỗng, gọi `push(paths.workspace(org, ws).document(row.result.object_id))`.
- [ ] **Step 4: Chạy lại test, typecheck, lint.**
  - Lệnh: lệnh ở Step 2, cộng `pnpm --filter @uniwork/views typecheck`, `pnpm --filter @uniwork/views lint` và `pnpm --filter @uniwork/core exec vitest run i18n`.
  - Kỳ vọng: PASS, lint không cảnh báo.
- [ ] **Step 5: Commit** `feat(ai): plan card labels and opening the new file after Apply`.

### Task 6: Hộp "Sửa dàn ý" dùng TipTap và Markdown

**Files:**
- Create: `packages/views/ai/ask-uni-outline-dialog.tsx`, `packages/views/ai/ask-uni-outline-dialog.test.tsx`
- Modify: `packages/views/ai/ask-uni-proposal-row.tsx` (nút "Sửa dàn ý"), `packages/views/ai/ask-uni-proposal-card.tsx` (nối vào `edit.mutate`), `packages/views/ai/ask-uni-proposal-edit.tsx` / `ask-uni-proposal-values.ts` (form chung bỏ ô thân khi `bodyArg(tool) === "outline"`)
- Modify: `vi.json`, `en.json`:

| Key | vi | en |
| --- | --- | --- |
| `ai.proposal.edit_outline` | "Sửa dàn ý" | "Edit outline" |
| `ai.proposal.outline_save` | "Lưu dàn ý" | "Save outline" |
| `ai.proposal.outline_label` | "Dàn ý của tệp mới" | "Outline of the new file" |

**Interfaces:**
- Consumes:
  - `ContentEditor` từ `../editor` (`content-editor.tsx`): `defaultValue` là Markdown; ref `getMarkdown()`.
  - `bodyArg` (Task 5); `useEditAiProposal` qua card.
- Produces: `function AskUniOutlineDialog(props: { open: boolean; markdown: string; busy: boolean; onOpenChange: (open: boolean) => void; onSave: (markdown: string) => void }): JSX.Element`

- [ ] **Step 1: Viết test fail.**
  - `ask-uni-outline-dialog.test.tsx`:
    - mở hộp → editor có nội dung dàn ý;
    - sửa rồi bấm "Lưu dàn ý" → `onSave` nhận Markdown mới, đã `trim`;
    - không đổi gì mà bấm lưu → không gọi `onSave`, chỉ đóng hộp;
    - `busy` → nút lưu ở trạng thái `aria-disabled`.
  - Card:
    - đề xuất `create_office_document` đang chờ có nút "Sửa dàn ý";
    - lưu gửi `PATCH /api/v1/ai/proposals/{id}` với `{"changes":{"outline":"…"}}`;
    - lỗi `invalid_args` hiện trong hộp và hộp không đóng;
    - form "Sửa" chung của thẻ này không còn ô dàn ý.
  
  Mock transport như các test card có sẵn.
- [ ] **Step 2: Chạy test, thấy fail.**
  - Lệnh: `cd packages/views && pnpm exec vitest run ai/ask-uni-outline-dialog.test.tsx ai/ask-uni-proposal-card.test.tsx`
  - Kết quả: FAIL.
- [ ] **Step 3: Hiện thực.**
  - Hộp thoại dùng primitive `Dialog` của `packages/ui`.
  - `ContentEditor` với `defaultValue={markdown}`, `disableMentions`, không `onUploadFile`, `ariaLabel={t("ai.proposal.outline_label")}`.
  - Nút "Sửa dàn ý" chỉ hiện khi:
    - đề xuất đang chờ;
    - `bodyArg(tool) === "outline"`;
    - `!preview.body_truncated`.
- [ ] **Step 4: Chạy lại test, typecheck, lint, knip.**
  - Lệnh: lệnh ở Step 2, cộng `pnpm --filter @uniwork/views typecheck`, `pnpm --filter @uniwork/views lint` và `pnpm knip`.
  - Kỳ vọng: PASS, không cảnh báo, không export thừa.
- [ ] **Step 5: Commit** `feat(ai): edit a plan card's outline in the rich editor`.

---

**Đóng vòng tài liệu (cùng commit cuối của Task 6, hoặc commit `docs` riêng):**
- Dòng trạng thái của spec ghi kế hoạch 3. Dòng trạng thái của kế hoạch này đổi thành "đã triển khai trên nhánh, chờ PR".
- Khi merge thì đổi thành shipped và thêm một mục vào dòng F-09 của `docs/roadmap/FEATURE_ROADMAP.md`.

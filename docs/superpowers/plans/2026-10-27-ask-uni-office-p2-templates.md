# Mục "Mẫu văn bản" trong Tài liệu (kế hoạch 2 — Phần 2) Implementation Plan

> **Trạng thái:** shipped — kế hoạch 2 của spec Hỏi UNI soạn tệp Office; merge vào develop 2026-10-28 qua PR #491 (`7f427c7f3`), issue UNI-2225 (con của UNI-415).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi workspace có mục "Mẫu văn bản" trong Tài liệu: mọi thành viên tải mẫu lên, đánh dấu một tệp có sẵn là mẫu, bỏ khỏi Mẫu, và thấy mọi mẫu nhóm theo Word, Excel, PowerPoint, khác.

**Architecture:** Mẫu là tài liệu tệp bình thường của workspace có thêm một dấu (ba cột rỗng được trên `documents`, như cách làm "Lưu trữ"). Hai lệnh `MarkDocumentTemplate` / `UnmarkDocumentTemplate` đi qua cổng tài liệu có sẵn, ghi audit và outbox trong cùng giao dịch, phát `document.template_marked` / `document.template_unmarked`. Danh sách mẫu là danh sách phẳng có sẵn với một điều kiện lọc thêm (cách làm của "Gắn sao"). Web thêm một `LibraryView` mới, một màn danh sách nhóm theo định dạng và hai mục trong menu dòng.

**Tech Stack:** Go (Chi, pgx, sqlc), PostgreSQL migration, TypeScript (React Query, zod), React (`packages/views`), i18n vi/en.

**Spec:** `docs/superpowers/specs/2026-10-27-ask-uni-office-design.md` — §6 Phần 2, §7 quyết định 3, 9, 13; §8.

## Global Constraints

- Mẫu là tài liệu **tệp** bình thường của workspace có dấu "là mẫu"; chỉ dùng trong một workspace (Q4). Mục Mẫu văn bản là nguồn mẫu duy nhất, không có quy tắc đặt tên (§7.3).
- Mọi thành viên workspace: tải mẫu mới lên (người tải là chủ), sửa nội dung mẫu, đánh dấu một tài liệu **đã ở phạm vi workspace** là mẫu, **bỏ khỏi Mẫu** bất kỳ mẫu nào. "Xóa" trong mục Mẫu văn bản nghĩa là bỏ khỏi Mẫu (Q5, §7.9).
- Đánh dấu một tài liệu `restricted` là mẫu sẽ mở nó cho cả workspace, nên chỉ người có `manage` làm được, và giao diện nói rõ việc mở rộng phạm vi trước khi làm.
- Chuyển tệp mẫu vào thùng rác và thu hẹp phạm vi xem: theo luật tài liệu hiện có, không đổi.
- Mỗi lần đánh dấu / bỏ dấu: audit + outbox cùng giao dịch, sự kiện mới trong catalogue ba nơi (`docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`), invalidate key danh sách mẫu.
- Luật repo: không `FOREIGN KEY`/`REFERENCES`; index là `CREATE INDEX CONCURRENTLY`, một mình một file migration; tiền tố migration mới là `999<unix-ms>`; cột `*_by` đi cặp với `*_by_kind` (ADR 0007); query sqlc ràng buộc `organization_id`/`workspace_id` bằng tham số.
- Chữ giao diện chỉ qua i18n vi/en (`i18next/no-literal-string`), giọng theo `docs/conventions.md` §3; icon theo `docs/conventions.md` §4, không có prop `strokeWidth`.
- Code comment tiếng Anh. Không nhắc tên ClickUp trong code, test, commit, tài liệu.
- Không gọi model, không chạy eval AI thật.
- Chạy test hẹp bằng `-run` / vitest theo tệp; không chạy `make check` hay toàn bộ `go test` cho tới khi xong mọi kế hoạch của spec (CI chạy toàn bộ).
- DB test: `TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable'` (DB `uniwork_test` dùng chung đang hỏng migrate).
- Commit dạng `feat(documents): …` / `test(documents): …`; hook tự thêm `Refs: UNI-2225`; cuối thân commit có `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Quyết định của người lập kế hoạch (chủ sản phẩm có thể bác)

1. **"Lưu từ khung chat" chuyển sang kế hoạch của Phần 3.** Prompt của Hỏi UNI chỉ cho model thấy tên và chữ của tệp đính kèm (`ai.AttachedFile` không có id), và chưa có đường biến tệp đính kèm đã lưu thành tài liệu. Cả hai việc này Phần 3 cũng cần ("Chỉ dùng lần này", tạo từ mẫu), nên làm một lần ở đó.
2. **Dữ liệu:** ba cột rỗng được `template_marked_at`, `template_marked_by`, `template_marked_by_kind` trên `documents`, có CHECK như `shelved_*`; không thêm bảng.
3. **Không thêm cờ tính năng.** "Lưu trữ" cũng không có cờ riêng, chỉ chạy dưới cờ `documents`; sản phẩm còn đang phát triển.
4. **Mức quyền của workspace trên mẫu:**
   - Đánh dấu tài liệu đã ở phạm vi workspace giữ nguyên `workspace_level` của nó.
   - Đánh dấu tài liệu `restricted` (sau khi người dùng xác nhận) mở nó cho workspace ở mức `edit`.
   - Mẫu tải lên từ mục Mẫu văn bản nằm ở gốc workspace, phạm vi workspace, mức `edit`.
   - Lý do: Q5 muốn mọi thành viên sửa được mẫu. Hạ hay nâng mức của một tài liệu workspace có sẵn thì vẫn là việc của người quản lý nó.
5. **Không đánh dấu được tài liệu đã lưu trữ** (tài liệu lưu trữ là chỉ đọc). Bỏ khỏi Mẫu thì vẫn làm được trên tài liệu đã lưu trữ, để dọn mục.
6. **Tải mẫu lên chỉ đi đường một lượt** (`POST /workspaces/{workspaceID}/documents/files`). Phiên tải nhiều phần bắt buộc có thư mục cha, nên tệp lớn hơn `chunked_upload_threshold_bytes` nhận lời nhắn: tải vào một thư mục rồi đánh dấu là mẫu.
7. **Dấu không vào luồng đồng bộ Office** (`feedDocumentActions`). Khi phạm vi đổi, `document.workspace_access_changed` đã vào luồng.
8. **Thu hẹp phạm vi giữ nguyên dấu.** Danh sách chỉ hiện mẫu người gọi còn đọc được. Bản sao (`CopyDocument`) không mang dấu.

## Review Focus

1. Đánh dấu tài liệu `restricted` mà thiếu xác nhận phải bị từ chối (409 `template_widens_visibility`), không bao giờ mở phạm vi âm thầm — test ở Task 1.
2. Thành viên chỉ có mức xem trên tài liệu workspace vẫn đánh dấu và bỏ được; agent, người ngoài workspace và người không đọc được tài liệu thì bị từ chối, không lộ tài liệu có tồn tại hay không — test ở Task 1.
3. Bấm hai lần hoặc hai người cùng đánh dấu: chỉ một dòng audit, lần sau không lỗi — test ở Task 1.
4. Mẫu vào thùng rác thì rời danh sách, khôi phục thì quay lại còn dấu; bản sao không mang dấu — test ở Task 1 và Task 2.
5. Tệp mẫu lớn hơn ngưỡng tải một lượt thì báo rõ, không âm thầm tải vào Thư mục của tôi — test ở Task 5.

---

### Task 1: Dấu "là mẫu" trên tài liệu, hai lệnh đánh dấu / bỏ, audit và sự kiện

**Files:**
- Create: `server/migrations/999<ms>_documents_template_mark.up.sql` và `.down.sql`
- Create: `server/migrations/999<ms+1>_documents_template_idx.up.sql` và `.down.sql`
- Modify: `server/pkg/db/queries/documents.sql` (hai query mới), rồi `make sqlc` (`server/pkg/db/generated/`)
- Create: `server/internal/service/document_templates.go`, `server/internal/service/document_templates_test.go`
- Modify: `server/internal/audit/actions.go` (cạnh `ActionDocumentShelved`, `:248`)
- Modify: `server/internal/outbox/catalogue.go` (cạnh `document.shelved`, `:353`), `docs/events/CATALOGUE.md` (bảng `:195-203`), `packages/core/types/events.ts` (`:78-79`)
- Modify: `server/internal/service/audit_coverage_test.go` (map `cases` `:1629` và danh sách hành động `:2567`)

**Interfaces:**
- Produces (Task 2, 3 dùng):
  - Cột `documents.template_marked_at TIMESTAMPTZ NULL`, `template_marked_by TEXT NULL`, `template_marked_by_kind TEXT NULL`; sqlc sinh `db.Document.TemplateMarkedAt pgtype.Timestamptz`, `TemplateMarkedBy pgtype.Text`, `TemplateMarkedByKind pgtype.Text`.
  - `type MarkDocumentTemplateInput struct { WidenToWorkspace bool }`
  - `func (s *DocumentService) MarkDocumentTemplate(ctx context.Context, actor Actor, documentID string, in MarkDocumentTemplateInput) (DocumentView, error)`
  - `func (s *DocumentService) UnmarkDocumentTemplate(ctx context.Context, actor Actor, documentID string) (DocumentView, error)`
  - `func errTemplateWidensVisibility() error` — `coded(http.StatusConflict, "template_widens_visibility", …)`.
  - `audit.ActionDocumentTemplateMarked = "document.template_marked"`, `audit.ActionDocumentTemplateUnmarked = "document.template_unmarked"`; sự kiện cùng tên, payload `document_id`, `workspace_id`, `Scope: ScopeWorkspace`, `Delivery: DeliveryOutbox`, `Version: 1`.
  - `func (q *Queries) SetDocumentTemplateMark(ctx, SetDocumentTemplateMarkParams{ID, OrganizationID, WorkspaceID, TemplateMarkedBy, TemplateMarkedByKind}) (db.Document, error)` — chỉ cập nhật khi `template_marked_at IS NULL`, `RETURNING *` (đã có dấu → `pgx.ErrNoRows`). `ClearDocumentTemplateMark` cũng vậy, điều kiện ngược lại.

- [ ] **Step 1: Write the failing tests `TestMarkDocumentTemplate*` in `document_templates_test.go`**

Dựng bằng helper tài liệu có sẵn của package (tệp docx tải lên như `TestMcpGetDocumentReadsOfficeFiles`; thành viên thứ hai như các test favorites). Khẳng định:
- `TestMarkDocumentTemplateOnAWorkspaceFile`: tệp `workspace` ở mức `view`; thành viên thường (mức `view`) đánh dấu → `TemplateMarkedAt` có giá trị, `TemplateMarkedBy` = id người đó, `TemplateMarkedByKind` = `human`. `workspace_level` vẫn là `view`. Có đúng 1 dòng audit `document.template_marked` và 1 dòng outbox cùng topic, payload `{document_id, workspace_id}`.
- `TestMarkDocumentTemplateTwiceAuditsOnce`: gọi hai lần, cả hai không lỗi, vẫn 1 dòng audit.
- `TestMarkRestrictedDocumentTemplateNeedsConfirmation`: tệp `restricted` của chủ. Chủ gọi với `WidenToWorkspace: false` → lỗi có code `template_widens_visibility`, không đổi gì (không audit, `visibility` vẫn `restricted`). Gọi với `true` → `visibility = workspace`, `workspace_level = edit`, có audit `document.workspace_access_changed` và `document.template_marked`.
- `TestMarkRestrictedDocumentTemplateNeedsManage`: người được chia sẻ mức `edit` trên tệp `restricted`, gọi với `true` → `ErrForbidden`.
- `TestMarkDocumentTemplateRefusals`:
  - trang (kind `page`) → lỗi validation;
  - tài liệu đã lưu trữ → code `document_shelved`;
  - agent (`Actor{Kind: audit.KindAgent}`) → `ErrForbidden`;
  - thành viên workspace khác → `ErrNotFound`.
- `TestUnmarkDocumentTemplate`: một thành viên khác (mức `view`) bỏ dấu → các cột về NULL, có 1 audit `document.template_unmarked`; gọi lại không lỗi, không audit thêm; bỏ dấu trên tài liệu đã lưu trữ vẫn được.
- `TestCopiedTemplateIsNotATemplate`: `CopyDocument` một mẫu → bản sao có `TemplateMarkedAt` NULL.
- `TestArchivedTemplateKeepsItsMark`: lưu vào thùng rác rồi khôi phục (lệnh archive/restore có sẵn) → dấu còn nguyên.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable' go test ./internal/service -run '^(TestMarkDocumentTemplate.*|TestMarkRestrictedDocumentTemplate.*|TestUnmarkDocumentTemplate|TestCopiedTemplateIsNotATemplate|TestArchivedTemplateKeepsItsMark)$' -count=1`
Expected: FAIL — không biên dịch được, `MarkDocumentTemplate` chưa có.

- [ ] **Step 3: Write the two migrations**

Tiền tố: `printf '999%s\n' "$(python3 -c 'import time;print(int(time.time()*1000))')"`. File index lấy số đó cộng 1.
- File cột: thêm ba cột; `documents_template_marked_by_kind_check CHECK (template_marked_by_kind IS NULL OR template_marked_by_kind IN ('human','agent','system'))`; `documents_template_mark_shape_check` (ba cột cùng có hoặc cùng NULL). Comment dẫn ADR 0007, như `9991792262447467_documents_shelved.up.sql`. File down bỏ hai CHECK rồi bỏ ba cột.
- File index (chỉ một câu): `CREATE INDEX CONCURRENTLY idx_documents_template ON documents (workspace_id, template_marked_at DESC, id DESC) WHERE template_marked_at IS NOT NULL AND archived_at IS NULL AND owner_id IS NULL;`. File down: `DROP INDEX CONCURRENTLY IF EXISTS idx_documents_template;`.

- [ ] **Step 4: Add `SetDocumentTemplateMark` and `ClearDocumentTemplateMark` to `documents.sql`, run `make sqlc`**

`SetDocumentTemplateMark :one` đặt `template_marked_at = now()` cùng cặp người làm, `WHERE id = @id AND organization_id = @organization_id AND workspace_id = @workspace_id AND template_marked_at IS NULL RETURNING *`. `ClearDocumentTemplateMark :one` đặt cả ba về NULL, `WHERE … AND template_marked_at IS NOT NULL RETURNING *`. Không đổi `revision` hay `updated_at`: dấu là trạng thái thư viện, không phải nội dung.

- [ ] **Step 5: Implement the two commands in `document_templates.go`**

- **`MarkDocumentTemplate`:**
  - Cổng: `s.withDocumentGateLocked(ctx, actor, documentID, "", decideDocumentViewOrAdminister, shelveWriteRefused, fn)`.
  - Kiểm theo thứ tự này trong `fn`:
    1. Agent → `ErrForbidden`, kiểm sau cổng như `FavoriteDocument`.
    2. Thành viên workspace qua `s.ws.RequireMemberQ(ctx, q, doc.WorkspaceID, actor.ID)`.
    3. `doc.OwnerKind.Valid` → `errDocumentOwned()`.
    4. `doc.Kind != DocumentKindFile` → `Invalid("chỉ tệp mới đánh dấu là mẫu được")`.
    5. `doc.Visibility == documentVisibilityRestricted`:
       - thiếu `in.WidenToWorkspace` → `errTemplateWidensVisibility()`;
       - mức dưới `manage`: chỉ có AdminScope → `errBreakGlassRequired()`, còn lại → `ErrForbidden`;
       - đủ điều kiện thì `writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(DocumentLevelEdit)})` và dùng hàng nó trả về.
  - Ghi dấu:
    - `q.SetDocumentTemplateMark`; `pgx.ErrNoRows` là đã có dấu, không audit.
    - Ghi được thì `auditRecorder.Record(ctx, q, audit.Entry{…Action: audit.ActionDocumentTemplateMarked, ResourceType: "document", ResourceID: doc.ID}, audit.Event{Topic: audit.ActionDocumentTemplateMarked, Payload: {"document_id", "workspace_id"}})`.
  - Trả `s.documentView(ctx, q, actor, doc)`.
- **`UnmarkDocumentTemplate`:**
  - Cùng cổng nhưng với `shelveWriteAllowed`.
  - Kiểm như trên, chỉ bỏ phần phạm vi.
  - `ClearDocumentTemplateMark`; `pgx.ErrNoRows` là no-op. Có thay đổi thì audit + sự kiện `document.template_unmarked`.
- **`errTemplateWidensVisibility()`:** viết cạnh `errBreakGlassRequired` (`document_permissions.go:54`), thông điệp tiếng Việt kiểu "đánh dấu là mẫu sẽ mở tài liệu cho cả workspace; hãy xác nhận". Nếu `server/internal/handler/dto/sdo/error_class.go` liệt kê code thì thêm code này vào lớp `conflict`.

- [ ] **Step 6: Register the actions and events in every catalogue**

- `audit/actions.go`: hai hằng ở Interfaces.
- `outbox/catalogue.go`: hai dòng như `document.shelved`, payload `document_id`, `workspace_id`.
- `docs/events/CATALOGUE.md`: hai dòng trong bảng; thêm cả vào danh sách văn xuôi ở `:23` nếu danh sách đó kể các frame workspace của tài liệu.
- `packages/core/types/events.ts`: hai tên.
- `audit_coverage_test.go`: hai case gọi lệnh trên một tệp workspace, và hai tên trong danh sách hành động.

- [ ] **Step 7: Run tests to verify they pass**

Run: lệnh ở Step 2, thêm `|TestEveryAuditedCommandWritesItsRow` vào regex; rồi
`cd server && go test ./migrations -run '^(TestMigration.*|TestNewMigrations.*|TestActorKindOnEveryCreatedBy|TestEveryQueryNamesItsTenant)$' -count=1`
và `node --test scripts/events-catalogue.test.mjs`.
Expected: PASS hết.

- [ ] **Step 8: Format, vet, commit**

Run: `cd server && gofmt -l ./internal ./migrations && go vet ./internal/service ./internal/audit ./internal/outbox`
Expected: gofmt không in gì; vet sạch.

```bash
git add server/migrations server/pkg/db server/internal/service/document_templates.go server/internal/service/document_templates_test.go server/internal/service/audit_coverage_test.go server/internal/audit/actions.go server/internal/outbox/catalogue.go docs/events/CATALOGUE.md packages/core/types/events.ts
git commit -m "feat(documents): mark and unmark a file as a workspace template"
```
(Thêm `server/internal/handler/dto/sdo/error_class.go` nếu Step 5 có sửa.)

---

### Task 2: Danh sách mẫu và tải mẫu lên ở tầng service

**Files:**
- Modify: `server/pkg/db/queries/document_search.sql` (`ListDocumentsPage` `:37`: thêm một `sqlc.narg`), rồi `make sqlc`
- Modify: `server/internal/service/document_search.go` (`ListDocumentsInput` `:55-106`; `ListTemplateDocuments` cạnh `ListFavoriteDocuments` `:496`; `listRowDocument` `:1067` chép ba cột mới)
- Modify: `server/internal/service/document_files.go` (`CreateFileDocumentInput` `:310-325`, `CreateFileDocument` `:349`)
- Test: `server/internal/service/document_templates_test.go`

**Interfaces:**
- Consumes: cột và `SetDocumentTemplateMark`, hằng audit/sự kiện ở Task 1.
- Produces (Task 3 dùng):
  - `func (s *DocumentService) ListTemplateDocuments(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error)` — chỉ người (agent → `ErrForbidden`); sort mặc định như danh sách workspace (cập nhật mới nhất trước); lọc `kind`, `format`, `type`, cursor như favorites.
  - `CreateFileDocumentInput.Template bool`

- [ ] **Step 1: Write the failing tests**

- `TestListTemplateDocuments`:
  - Hai tệp mẫu (docx, xlsx), một tệp thường, một mẫu `restricted` của người khác (người gọi không đọc được).
  - Danh sách của người gọi có đúng hai mẫu đọc được, không có tệp thường.
  - Mẫu vào thùng rác → rời danh sách; khôi phục → quay lại.
  - Agent → `ErrForbidden`.
- `TestListTemplateDocumentsKeepsTheMarkOnRows`: mỗi dòng `listRowDocument` trả về còn `TemplateMarkedAt`.
- `TestCreateFileDocumentAsTemplate`:
  - `CreateFileDocument(…, CreateFileDocumentInput{Template: true, Filename: "bao-gia.docx", Body: …})` không có `ParentID`.
  - Tài liệu ở gốc, `visibility = workspace`, `workspace_level = edit`, `acl_owner_id` = người tải, có dấu.
  - Audit có cả `document.created` và `document.template_marked` (một dòng mỗi loại).
- `TestCreateFileDocumentAsTemplateOnlyAtTheRoot`: `Template: true` kèm `ParentID` hay `Destination: "my_folder"` → lỗi validation, không tạo gì.
- `TestCreateFileDocumentAsTemplateIsIdempotent`: cùng `IdempotencyKey` hai lần → một tài liệu, một audit mỗi loại. Cùng key mà khác `Template` → xung đột fingerprint như các trường khác.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable' go test ./internal/service -run '^(TestListTemplateDocuments.*|TestCreateFileDocumentAsTemplate.*)$' -count=1`
Expected: FAIL — không biên dịch được.

- [ ] **Step 3: Implement**

- **Query.** `ListDocumentsPage` có thêm `sqlc.narg(templates_only)::boolean`. Lọc `(sqlc.narg(templates_only)::boolean IS NOT TRUE OR d.template_marked_at IS NOT NULL)`, đặt cạnh điều kiện favorites (`:165`).
- **Service.**
  - `ListDocumentsInput` có thêm trường không xuất `templates bool`, truyền xuống tham số `TemplatesOnly`.
  - `ListTemplateDocuments` viết theo mẫu `ListFavoriteDocuments`. Bỏ trường `favorites`: một mẫu không cần người gọi gắn sao.
- **`CreateFileDocument`.** Khi `in.Template`:
  - từ chối nếu có `ParentID`/`Destination`;
  - ép phạm vi `workspace`, mức `edit` (`createHomeRow` trả `view` ở gốc, nên đè sau khi gọi nó);
  - cho `template` vào fingerprint idempotency, chỉ khi true, để fingerprint cũ không đổi;
  - đánh dấu bằng `SetDocumentTemplateMark` ngay sau insert, trong cùng giao dịch, và ghi audit + sự kiện thứ hai như Task 1.
  - Có helper ghi dấu dùng chung với `MarkDocumentTemplate` thì gọi lại, đừng chép.

- [ ] **Step 4: Run tests to verify they pass**

Run: lệnh ở Step 2, thêm `|TestMarkDocumentTemplate.*|TestListFavoriteDocuments.*|TestListDocuments.*` (giữ các danh sách có sẵn xanh).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db server/internal/service/document_search.go server/internal/service/document_files.go server/internal/service/document_templates.go server/internal/service/document_templates_test.go
git commit -m "feat(documents): list workspace templates and upload a file as a template"
```

---

### Task 3: HTTP — route, SDI/SDO, ma trận cách ly

**Files:**
- Modify: `server/internal/handler/router/documents.go` — POST/DELETE cạnh favorite `:504/:511`, GET cạnh favorites `:547`, cùng danh sách route ở đầu file `:22-96`.
- Modify: `server/internal/handler/router/routes.go` (trường `Routes`), `server/internal/handler/router.go` (nối handler `:948-987`)
- Create: `server/internal/handler/document_templates.go`, `server/internal/handler/document_templates_test.go`
- Modify: `server/internal/handler/dto/sdi/document.go` — `MarkDocumentTemplateSDI`, `ListTemplateDocumentsSDI`, và trường `template` của `CreateDocumentFileSDI` `:35`.
- Modify: `server/internal/handler/dto/sdo/document.go` — `DocumentDTO` `:41` và DTO dòng danh sách `:211`; builder ở `server/internal/handler/documents.go:~968` và `document_collections.go:~634`.
- Modify: handler tải tệp `CreateDocumentFile` (đọc trường multipart `template`)
- Modify: `server/internal/handler/isolation_matrix_test.go` (bộ giải `{documentID}` `:~690-725`), `server/internal/handler/isolation_world_test.go` (fixture `:773-860`)

**Interfaces:**
- Consumes: `MarkDocumentTemplate`, `UnmarkDocumentTemplate`, `ListTemplateDocuments`, `CreateFileDocumentInput.Template`.
- Produces (Task 4 dùng):
  - `POST /api/v1/documents/{documentID}/template`, thân `{"widen_to_workspace": false}` (có thể bỏ trống) → 200 `{"document": DocumentDTO}`.
  - `DELETE /api/v1/documents/{documentID}/template` → 200 `{"document": DocumentDTO}`.
  - `GET /api/v1/workspaces/{workspaceID}/documents/templates?kind=&format=&type=&cursor=&limit=` → `DocumentListSDO`.
  - Trường multipart `template=true` trên `POST /api/v1/workspaces/{workspaceID}/documents/files`.
  - `DocumentDTO` và DTO dòng có thêm `template_marked_at` (RFC3339) và `template_marked_by`, chỉ có khi có dấu (`omitempty`).
  - Lỗi 409 `template_widens_visibility`.

- [ ] **Step 1: Write the failing handler tests in `document_templates_test.go`**

Theo mẫu test favorites và shelve của package handler, gọi qua router thật:
- POST trên tệp workspace → 200, `document.template_marked_at` có giá trị.
- POST trên tệp `restricted` không có thân → 409 `template_widens_visibility`; có `{"widen_to_workspace":true}` → 200.
- DELETE → 200, `template_marked_at` vắng mặt.
- GET `/workspaces/{ws}/documents/templates` liệt kê mẫu; `type=nope` → 400 `invalid_type` như favorites.
- Multipart có `template=true`, không có `parent_id` → 201, có dấu.
- Không có phiên đăng nhập → 401.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable' go test ./internal/handler -run '^TestDocumentTemplate.*$' -count=1`
Expected: FAIL — route chưa có (404).

- [ ] **Step 3: Implement routes, handlers, DTOs**

- **Handler.**
  - Viết theo `documentShelveCommand` (`document_collections.go:427`): `h.Documents == nil` → 501 `storage_unavailable`; `actor := service.Human(middleware.UserID(r.Context()))`; lỗi đi `h.mapServiceError`.
  - Thân POST đi qua `decode(w, r, &in, maxJSONBody)`, nhận thân rỗng.
  - Handler GET viết theo `listFavoriteDocuments` (`document_collections.go:220`).
- **`apiOp`.** Có `summary`/`description` tiếng Việt và `tags: []string{"documents"}`. Mô tả nói rõ:
  - ai làm được;
  - tài liệu `restricted` cần `widen_to_workspace` và quyền manage;
  - lặp lại không lỗi;
  - tài liệu đã lưu trữ thì không đánh dấu được.
- **SDI/SDO.** Có tag `description` và `example`. Trường `widen_to_workspace` không kết thúc bằng `_id`, nên `TestEveryBodyIDFieldHasAReferenceCase` không cần case mới.
- **Ma trận cách ly.** Hai fixture tệp riêng tạo qua route multipart, như `fileDocument` (`isolation_world_test.go:~860`):
  - `templateDocument`: tệp workspace chưa có dấu, dùng cho POST.
  - `markedTemplateDocument`: tải lên với `template=true`, dùng cho DELETE.
  - Thêm hai nhánh vào bộ giải `{documentID}`, như `shelveDocument` (`:707-712`), để lượt kiểm chứng không làm hỏng trang `"document"` dùng chung.
  - Route GET có `{workspaceID}` nên tự được phủ.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_askdocs_test?sslmode=disable' go test ./internal/handler -run '^(TestDocumentTemplate.*|TestIsolationMatrix|TestIsolationRealtime|TestEveryBodyIDFieldHasAReferenceCase|TestOpenAPI.*)$' -count=1`
Expected: PASS. `TestIsolationMatrix` chạy lâu, có thể vài phút; chạy nền nếu cần.

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler
git commit -m "feat(documents): template routes, DTO fields and isolation fixtures"
```

---

### Task 4: Client lõi — kiểu, endpoint, hook, key, realtime

**Files:**
- Modify: `packages/core/types/document.ts` (schema chi tiết `:140` và dòng `:417`)
- Create: `packages/core/api/endpoints/document-templates.ts`, `packages/core/api/endpoints/document-templates.test.ts`
- Modify: `packages/core/api/endpoints/documents.ts` (`createDocumentFile` `:183`, `CreateDocumentFileMeta`) và test của nó
- Modify: `packages/core/documents/keys.ts` (cạnh `shelved` `:70`)
- Create: `packages/core/documents/hooks-templates.ts`, `packages/core/documents/hooks-templates.test.tsx`
- Modify: `packages/core/realtime/document-events.ts` (nhóm `case` có `"document.shelved"`, `:~58-92`) và `packages/core/realtime/use-realtime-sync.test.tsx`

**Interfaces:**
- Consumes: route và trường ở Task 3.
- Produces (Task 5, 6 dùng):
  - Trường schema `template_marked_at`, `template_marked_by`: `z.string().nullable().optional().catch(undefined)`, như `shelved_at`. Helper `isTemplate(doc: { template_marked_at?: string | null }): boolean` cạnh `isShelved` (`:207`).
  - `listTemplateDocuments(wsId: string, opts?: ListDocumentsBaseOpts): Promise<DocumentList>` — `/api/v1/workspaces/{ws}/documents/templates${listQuery(opts)}`; dữ liệu hỏng thì ném `"document_list_invalid"` như `listFavoriteDocuments`.
  - `markDocumentTemplate(documentId: string, opts?: { widenToWorkspace?: boolean }): Promise<{ document: Document } | null>`, `unmarkDocumentTemplate(documentId: string): Promise<{ document: Document } | null>`. Cả hai qua `parseWithFallback`; `endpoint` là `"POST /api/v1/documents/{id}/template"` / `"DELETE …"`.
  - `CreateDocumentFileMeta.template?: true` → trường form `template=true`, gửi trước phần tệp.
  - `documentKeys.templates(wsId: string, filterKey = "")` nằm dưới `documentKeys.workspace(wsId)`.
  - `useTemplateDocuments(wsId: string, opts?: ListDocumentsBaseOpts)` (infinite, như `useShelvedDocuments` `:250`), `useMarkDocumentTemplate(wsId: string)` (biến `{ documentId: string; widenToWorkspace?: boolean }`), `useUnmarkDocumentTemplate(wsId: string)` (biến `documentId`).
    - `onSuccess`: `setQueryData(documentKeys.detail(wsId, id), …)` rồi invalidate `documentKeys.workspace(wsId)`, như `useShelveDocument` (`:332`).
    - Không cập nhật lạc quan.

- [ ] **Step 1: Write the failing tests**

- `document-templates.test.ts`:
  - mỗi hàm gửi đúng method, đường dẫn và thân;
  - mỗi hàm có một case dữ liệu hỏng chứng minh nó suy giảm chứ không ném (riêng danh sách thì ném `document_list_invalid` như `listFavoriteDocuments`).
- `documents.test.ts`: `createDocumentFile(ws, blob, { visibility: "workspace", template: true })` có `template=true` trong form, đứng trước tệp.
- `hooks-templates.test.tsx`: mutation thành công thì cập nhật chi tiết và invalidate key workspace; lỗi thì không đổi cache.
- `use-realtime-sync.test.tsx`: frame `document.template_marked` và `document.template_unmarked` của workspace đang mở invalidate `documentKeys.workspace(wsId)`; của workspace khác thì không.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/document-templates.test.ts api/endpoints/documents.test.ts documents/hooks-templates.test.tsx realtime/use-realtime-sync.test.tsx`
Expected: FAIL — module chưa có.

- [ ] **Step 3: Implement per Interfaces**

- [ ] **Step 4: Run tests, typecheck, lint**

Run: lệnh Step 2; `pnpm --filter @uniwork/core typecheck`; `pnpm --filter @uniwork/core lint`.
Expected: PASS; lint không cảnh báo.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(documents): client endpoints, hooks and realtime keys for templates"
```

---

### Task 5: Màn "Mẫu văn bản" — điều hướng, danh sách nhóm theo định dạng, tải mẫu lên

**Files:**
- Modify: `packages/views/documents/documents-sidebar.tsx` (`LibraryView` `:25-33`, `NavItem` sau `sharedByMe` `:182`)
- Modify: `packages/views/documents/documents-nav-icons.ts` (`templates: LayoutTemplate`)
- Modify: `packages/views/documents/documents-view-url.ts` (`viewFromSearchParams`: `case "templates"`)
- Modify: `packages/views/documents/use-documents-library.ts` (truy vấn `templates`, thêm vào `sortedOnClient`, `switch (view.kind)` `:~292-322`)
- Create: `packages/views/documents/documents-templates-view.tsx`, `packages/views/documents/documents-templates-view.test.tsx`
- Modify: `packages/views/documents/documents-page-view.tsx` (nhánh `view.kind === "templates"`; file đã 573 dòng, đặt logic mới trong tệp mới)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`; `docs/conventions.md` §2 (một dòng thuật ngữ)
- Test: `packages/views/documents/documents-sidebar.test.tsx`, test của `documents-view-url`

**Interfaces:**
- Consumes: `useTemplateDocuments`, `useCreateDocumentFile` (`packages/core/documents/hooks.ts:144`) với meta `{ visibility: "workspace", template: true }`, `chunkedUploadThreshold` (`packages/core/documents/chunked-upload/threshold.ts:12`), `rowFormat` (`library-rows.ts`), `DocumentsLibraryList`.
- Produces: `LibraryView` có `{ kind: "templates" }`; `DocumentsTemplatesView` (props theo kiểu `DocumentsShelvedViewProps`: `library`, `handlers`, `canUpload: boolean`, `wsId`); khóa i18n bên dưới.

Khóa i18n (vi / en, đúng chữ):
- `documents.home.sidebar.templates`: "Mẫu văn bản" / "Templates"
- `documents.home.view_subtitle.templates`: "Mẫu dùng chung của workspace. Mọi thành viên thêm, sửa và bỏ mẫu được." / "Templates the whole workspace shares. Every member can add, edit and remove them."
- `documents.home.empty.templates_title`: "Chưa có mẫu nào" / "No templates yet"
- `documents.home.empty.templates_description`: "Tải lên báo giá, hóa đơn hay bài trình chiếu mẫu để cả workspace dùng chung." / "Upload a quote, invoice or slide deck template for the whole workspace to use."
- `documents.templates.upload`: "Tải mẫu lên" / "Upload template"
- `documents.templates.group.word`: "Word", `.excel`: "Excel", `.powerpoint`: "PowerPoint", `.other`: "Khác" / "Other"
- `documents.templates.uploaded`: "Đã thêm {{title}} vào Mẫu văn bản" / "Added {{title}} to Templates"
- `documents.templates.upload_failed`: "Không tải mẫu lên được. Chưa có gì thay đổi." / "Couldn't upload the template. Nothing changed."
- `documents.templates.too_large`: "Tệp lớn hơn {{size}} nên không tải thẳng vào Mẫu văn bản được. Hãy tải vào một thư mục rồi đánh dấu là mẫu." / "This file is larger than {{size}}, so it can't go straight into Templates. Upload it to a folder, then mark it as a template."
- `docs/conventions.md` §2: thêm dòng `template` → `mẫu`, tên mục "Mẫu văn bản".

- [ ] **Step 1: Write the failing tests**

- `documents-sidebar.test.tsx`: có mục "Mẫu văn bản" ngay sau "Tôi đã chia sẻ"; bấm gọi `onView({ kind: "templates" })`; `aria-current="page"` khi đang ở view đó.
- Test URL: `?view=templates` ↔ `{ kind: "templates" }` theo cả hai chiều.
- `documents-templates-view.test.tsx`, transport giả qua `@uniwork/core/api/http` như `packages/views/test/setup.ts`:
  - Dòng `docx`, `xlsx`, `pptx`, `pdf` nằm dưới tiêu đề Word, Excel, PowerPoint, Khác theo thứ tự đó; nhóm rỗng không hiện.
  - Danh sách rỗng hiện khối trống với hai khóa `empty.templates_*`.
  - Nút "Tải mẫu lên":
    - chọn tệp nhỏ thì gửi `POST …/documents/files` có `visibility=workspace` và `template=true`, không có `destination`;
    - tệp lớn hơn ngưỡng từ cấu hình thì không gửi gì và hiện thông báo `too_large`;
    - `canUpload={false}` thì không có nút.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uniwork/views exec vitest run documents/documents-sidebar.test.tsx documents/documents-templates-view.test.tsx documents/documents-view-url.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Nhóm theo `rowFormat(row)`: `docx` → word, `xlsx` → excel, `pptx` → powerpoint, mọi thứ khác → other.
- Danh sách tải trọn rồi nhóm phía client, như `starred` (`useLoadInFull`), nên `templates` vào `sortedOnClient`.
- Màn dùng `DocumentsLibraryList` cho mỗi nhóm, `screen="workspace"`.
- Ô tải lên dùng input tệp có sẵn của Tài liệu. Giới hạn đuôi tệp lấy từ `usePublicConfig` (`limits.upload_extensions`).
- Màn dùng `CollectionPageState` và các header shell có sẵn của trang Tài liệu, như các view khác.
- Kiểm `pnpm --filter @uniwork/views lint`: `documents-page-view.tsx` vượt `max-lines` thì rút phần nối view mẫu ra `documents-templates-view.tsx`.

- [ ] **Step 4: Run tests, typecheck, lint, knip**

Run: lệnh Step 2; `pnpm --filter @uniwork/views typecheck`; `pnpm --filter @uniwork/views lint`; `pnpm --filter @uniwork/core exec vitest run i18n`; `node --test scripts/lucide-aliases.test.mjs scripts/i18n-duplicate-keys.test.mjs`; `pnpm knip`.
Expected: PASS; lint không cảnh báo; knip không báo export thừa.

- [ ] **Step 5: Commit**

```bash
git add packages/views packages/core/i18n docs/conventions.md
git commit -m "feat(documents): Templates section with format groups and template upload"
```

---

### Task 6: Menu dòng — "Đánh dấu là mẫu" và "Bỏ khỏi Mẫu"

**Files:**
- Modify: `packages/views/documents/doclist/row-menu.ts` (`RowMenuItemId` `:26-30`, `RowMenuHandlers` `:59`), `packages/views/documents/doclist/row-menu-items.tsx` (icon)
- Create: `packages/views/documents/document-template-widen-dialog.tsx`, `packages/views/documents/use-template-commands.tsx`
- Modify: `packages/views/documents/documents-page-view.tsx` (truyền handler; giữ dưới `max-lines`)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/documents/doclist/row-menu.test.ts`, `packages/views/documents/document-template-widen-dialog.test.tsx`

**Interfaces:**
- Consumes: `useMarkDocumentTemplate`, `useUnmarkDocumentTemplate`, `isTemplate`, `rowLevel` (`row-level.ts`), `isShelved`.
- Produces: `RowMenuItemId` thêm `"mark-template" | "unmark-template"`; `RowMenuHandlers.onMarkTemplate?`, `onUnmarkTemplate?: (doc: DocumentSummaryRow) => void`; `useTemplateCommands(wsId)` trả `{ onMarkTemplate, onUnmarkTemplate, isBusy, dialog }`.

Luật hiện mục (không có handler thì ẩn, như `onShelve`):
- **"mark-template":**
  - dòng là tệp, chưa có dấu, chưa lưu trữ, không ở thùng rác;
  - dòng `workspace` thì mọi mức đọc đều thấy mục;
  - dòng `restricted` chỉ hiện khi `rowLevel(row) === "manage"`, và bấm thì mở hộp xác nhận.
- **"unmark-template":** dòng có dấu, kể cả khi đã lưu trữ.
- Trong màn Mẫu văn bản, "Bỏ khỏi Mẫu" đứng ở vị trí của "Chuyển vào thùng rác" trong menu (Q5: "xóa" là bỏ khỏi Mẫu). Thùng rác thật vẫn ở chỗ cũ cho người có `manage`.

Khóa i18n (vi / en, đúng chữ):
- `documents.templates.mark`: "Đánh dấu là mẫu" / "Mark as template"
- `documents.templates.unmark`: "Bỏ khỏi Mẫu" / "Remove from Templates"
- `documents.templates.marked`: "Đã đánh dấu {{title}} là mẫu" / "Marked {{title}} as a template"
- `documents.templates.unmarked`: "Đã bỏ {{title}} khỏi Mẫu" / "Removed {{title}} from Templates"
- `documents.templates.mark_failed`: "Không đánh dấu được. Chưa có gì thay đổi." / "Couldn't mark it as a template. Nothing changed."
- `documents.templates.unmark_failed`: "Không bỏ khỏi Mẫu được. Chưa có gì thay đổi." / "Couldn't remove it from Templates. Nothing changed."
- `documents.templates.widen.title`: "Mở tài liệu này cho cả workspace?" / "Open this document to the whole workspace?"
- `documents.templates.widen.body`: "Hiện chỉ những người được chia sẻ mới xem được {{title}}. Khi thành mẫu, mọi thành viên workspace sẽ xem và sửa được nó." / "Only people it's shared with can see {{title}} now. As a template, every member of the workspace will be able to view and edit it."
- `documents.templates.widen.confirm`: "Mở cho workspace và đánh dấu" / "Open to workspace and mark"

- [ ] **Step 1: Write the failing tests**

- `row-menu.test.ts`:
  - mỗi luật hiện mục ở trên có một case, gồm cả `restricted` mức `edit` (không thấy "mark-template") và mức `manage` (thấy);
  - dòng đã lưu trữ có dấu thấy "unmark-template", không thấy "mark-template".
- `document-template-widen-dialog.test.tsx`:
  - xác nhận gọi `POST …/template` với `{"widen_to_workspace":true}` đúng một lần, kể cả khi bấm hai lần liền;
  - hủy thì không gửi gì;
  - lỗi thì giữ hộp và hiện `mark_failed`.
- Bấm "Đánh dấu là mẫu" trên dòng `workspace` thì gửi thẳng, không thân, rồi hiện toast `marked`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uniwork/views exec vitest run documents/doclist/row-menu.test.ts documents/document-template-widen-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Hộp xác nhận viết theo `DocumentShelveDialog`: `AlertDialog`, `aria-busy` khi đang gửi, `useRef` chặn bấm đôi. Icon `LayoutTemplate`.
- Lệnh chờ server rồi mới đổi giao diện, không cập nhật lạc quan, theo State Rules.

- [ ] **Step 4: Run tests, typecheck, lint, knip**

Run: lệnh Step 2 cùng `documents/documents-templates-view.test.tsx`; `pnpm --filter @uniwork/views typecheck`; `pnpm --filter @uniwork/views lint`; `pnpm --filter @uniwork/core exec vitest run i18n`; `pnpm knip`.
Expected: PASS.

- [ ] **Step 5: Update this plan's status line and commit**

Sửa dòng `> **Trạng thái:**` của plan này thành "in-progress — đã triển khai trên nhánh, chờ PR".

```bash
git add packages/views packages/core/i18n docs/superpowers/plans/2026-10-27-ask-uni-office-p2-templates.md
git commit -m "feat(documents): mark and remove templates from the document row menu"
```

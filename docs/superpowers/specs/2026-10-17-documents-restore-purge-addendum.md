# Documents — Phụ lục: khôi phục từng mục, xóa vĩnh viễn, Thùng rác chỉ đọc, báo chủ tài liệu

> **Trạng thái:** in-progress — v0.1 hợp đồng, viết 2026-10-17, chưa có dòng code nào. Thẻ: RESTORE-01 (UNI-1843: §1, §2, §3, §5, §6) và TRASH-NOTIFY-01 (UNI-1844: §4); phần web thuộc e6-web. Q-T1..Q-T3 đã chốt (§7).

**Quan hệ:** [Documents C-01](2026-09-08-documents-design.md) (cây, lưu trữ, purge 30 ngày), [phụ lục My Folder](2026-10-16-documents-my-folder-addendum.md) (My Folder không bao giờ vào thùng rác), [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md) (`AdminScope`).
**Nguồn quyết định:** USER-DECISIONS 2026-10-16 15:05 (Q-R1 khôi phục từng mục, chỉ mang theo mục con người đó quản lý; Q-R2 thông báo trong app, không email; Q-R3 người có quyền sửa thấy mục của mình trong Thùng rác, chỉ đọc), người dùng 23:45 (xóa vĩnh viễn từ Thùng rác).
**Hiện trạng:** đọc ở root G5-G7 `10b16375a`.
Phần web (nút, hộp thoại, danh sách) thuộc e6-web; addendum này là hợp đồng server + `packages/core`.

## 0. Hiện trạng (code)

- Chuyển vào thùng rác: `ArchiveDocument` (`document_lifecycle.go:209`) cần quyền quản lý trên MỌI nút của cây
  (`requireManageOnSubtree`), đóng dấu cả cây một `archive_batch_id`, `purge_after = now + 30 ngày`, một audit + outbox
  `document.archived` mỗi nút.
- Khôi phục: `RestoreDocument` (`:418`) khôi phục CẢ batch hoặc không gì (`requireManageOnArchived`), tên trùng → "Tên (n)"
  (`restoreNames`), mục có cha không về → gốc workspace (`DetachDocumentToRoot`).
- Thùng rác (`ListArchivedDocumentsPage`, `document_search.sql:244`): chỉ người quản lý (admin thấy hết trừ My Folder
  của người khác; ACL owner; share `manage`).
- Purge: `purgeOneDocument` (`:1065`) riêng tư, chỉ chạy khi `purge_after < now`; xóa versions, assets, shares, share
  links, access logs, comments (+reactions, mentions, revisions), favorites, hàng document, nhả blob qua
  `files.ReleaseInTx`; audit `document.deleted` với actor `system`.
- Thông báo: `internal/notification` — consumer đọc outbox, `rules.go` ánh xạ topic → rule → `[]Draft`, lane notify.

## 1. Khôi phục từng mục (Q-R1)

`POST /api/v1/documents/{documentID}/restore` đổi ngữ nghĩa (không thêm route):

- R-1. Cổng: người gọi có quyền QUẢN LÝ trên mục `documentID` (cổng hiện tại `decideArchiveRootAccess`; My Folder không
  bao giờ ở thùng rác). Không còn đòi quản lý cả batch.
- R-2. Phạm vi: mục đó + các hậu duệ CÙNG batch, còn trong thùng rác, mà người gọi quản lý. Hậu duệ người gọi không quản lý
  ở lại thùng rác (giữ batch id, giữ `purge_after`). Một hậu duệ được khôi phục mà cha nó không được khôi phục → gốc
  workspace (đường `DetachDocumentToRoot` hiện có) — không thể xảy ra trong cây con liên tục, nhưng giữ quy tắc.
- R-3. Đích của mục gốc: thư mục cha cũ nếu cha đang sống (không trong thùng rác, không bị xóa), nếu không → gốc workspace.
  Tên trùng ở đích → "Tên (n)" như FD-D5.
- R-4. Admin (owner/admin workspace) vẫn khôi phục được cả batch: gọi trên gốc batch với quyền quản lý mọi mục = hành vi
  cũ. Không có tham số "cả batch" riêng.
- R-5. Quyền không đổi (brief §4): chỉ đụng `archived_at/archived_by/purge_after/archive_batch_id` (+ `parent_id` khi
  re-root, + title khi trùng). Shares sống lại.
- R-6. Audit/event: giữ `document.restored` mỗi nút được khôi phục (payload không đổi). Không event mới.
- R-7. Idempotency + khóa: giữ `documentBatchLifecycle` (ledger claim, `LockDocumentTree`).

## 2. Xóa vĩnh viễn từ Thùng rác (user 23:45)

Route mới `POST /api/v1/documents/{documentID}/purge` (SDI rỗng, SDO 204; `apiOp` + mô tả; isoRoutes: cross-tenant
mặc định, fixture `archivedFolder` trong switch `{documentID}` của `isolation_matrix_test.go`).

- P-1. Chỉ cho mục ĐANG trong thùng rác; mục sống → 400 `document_not_in_trash`.
- P-2. Cổng giống khôi phục (R-1): quản lý trên mục; quyền sửa → 403; người chỉ đọc hoặc không thấy → 404.
- P-3. Phạm vi giống R-2: mục + hậu duệ cùng batch còn trong thùng rác mà người gọi quản lý. Hậu duệ còn lại ở thùng rác;
  khi sau này được khôi phục mà cha đã bị xóa → gốc workspace (R-3 đã bao).
- P-4. Dọn dữ liệu phụ thuộc: tách thân xóa của `purgeOneDocument` thành một hàm dùng chung `hardDeleteDocumentTx(ctx, q,
  doc, actor)`; `PurgeExpired` (actor system) và route mới (actor = human) cùng gọi. Không FK, không cascade: versions,
  assets, shares, share links, access logs, comments + reactions + mentions + revisions, favorites, edit locks (kiểm tra
  `document_locks`/EL nếu có bảng), hàng document; blob qua `files.ReleaseInTx` (đếm tham chiếu, không xóa thẳng). Mọi thứ
  trong MỘT transaction với khóa `LockDocumentTree` + `LockDocumentByID`, kiểm tra lại `archived_at` dưới khóa.
- P-5. Work Graph: không ghi tay; projector nhận `document.deleted` như purge hiện tại (ADR 0019). Kiểm tra marker đã xử lý
  `document.deleted`; nếu chưa → ghi rõ trong báo cáo, không tự thêm đường ghi graph.
- P-6. Audit: `document.deleted` mỗi nút, actor human, `reason`/meta `manual_purge: true` để phân biệt với purge hết hạn;
  thêm lệnh vào `audit_coverage_test.go` (lệnh mới `PurgeDocument`, cùng action). Event `document.deleted` (catalogue
  không đổi).
- P-7. Giới hạn: dùng lại `archiveBound`; quá → 400 `folder_too_large` như archive.

## 3. Người có quyền sửa thấy Thùng rác chỉ đọc (Q-R3)

- T-1. "Mục của mình" cho người không quản lý = mục trong thùng rác mà cấp quyền tính như lúc chưa xóa của họ là `edit`
  (workspace_level trên tài liệu không restricted, hoặc share `edit` còn hiệu lực). Không có nhánh "người tạo" (Q-T1 = c): sau khi
  chuyển quyền sở hữu hoặc thu hồi share trên tài liệu restricted, người tạo có thể không còn quyền gì và không được thấy cả tên tài
  liệu; chủ sở hữu luôn có quyền quản lý nên người tạo thông thường vẫn được bao.
- T-2. `ListArchivedDocumentsPage` thêm nhánh thứ tư; mỗi hàng trả `my_level` thật (`edit`) để client tắt Khôi phục/Xóa vĩnh
  viễn. Người quản lý/admin như cũ.
- T-3. Đọc nội dung một mục trong thùng rác: vẫn chỉ quản lý (không mở viewer cho edit holder ở vòng này). Danh sách chỉ
  hiện metadata: tên, loại, người xóa, ngày xóa, hạn purge.
- T-4. Restore/purge của edit holder → 403 (R-1/P-2). Test: danh sách có hàng, `my_level=edit`, hai lệnh 403.

## 4. Báo chủ tài liệu (TRASH-NOTIFY-01, Q-R2)

- N-1. Kind mới `document_trashed_by_other` (kinds.go, titles vi/en, prefs mặc định in-app on / push off,
  `NOTIFICATION_KINDS` core, `kind-tone.test.ts`, i18n `notifications.kind.document_trashed_by_other`).
  vi: "{actor} đã chuyển tài liệu của bạn vào thùng rác, khôi phục trước {date}"; en: "{actor} moved your document to
  trash. Restore it before {date}".
- N-2. Kích hoạt: rule trên topic `document.archived`. Người nhận = `acl_owner_id` của nút khác người xóa (`archived_by`),
  thành viên còn hoạt động. Gộp theo `(archive_batch_id, recipient)`: một thông báo mỗi người mỗi batch, liệt kê mục gốc
  của họ (mục cao nhất trong batch mà họ là owner) + số mục ("và n mục khác"). Group key = batch id + recipient →
  idempotent qua `InsertNotificationDelivery`.
- N-3. Không email (Q-R2). `{date}` = `purge_after` của batch (ngày theo múi giờ người nhận ở client).
- N-4. Bấm thông báo → Thùng rác lọc tới mục (web e6-web). Người nhận là owner nên quản lý được mục → Khôi phục từng mục
  (R-1) giải đúng nỗi đau brief §3.
- N-5. Không thông báo khi xóa vĩnh viễn hay purge hết hạn ở vòng này (Q-T2 = a).

## 5. Client `packages/core`

- `restoreDocument` giữ chữ ký; phản hồi có thể là một phần batch: hook invalidate trash list + list cha cũ + gốc.
- `purgeDocument(id)` + `usePurgeDocument(wsId)` (await server, không optimistic), invalidate trash list key.
- Trash list item: `my_level` lenient đã có; thêm `archived_by` / `purge_after` vào schema nếu chưa có (lenient, optional).
- Mỗi endpoint mới một ca malformed-response.

## 6. Test (đặt tên trong báo cáo)

- RS-1 per-item: B quản lý doc trong thư mục admin xóa → B khôi phục doc → về gốc workspace (thư mục còn trong thùng rác);
  phần còn lại của batch vẫn trong thùng rác.
- RS-2 folder restore chỉ mang hậu duệ người gọi quản lý; RS-3 admin khôi phục cả batch = hành vi cũ; RS-4 tên trùng.
- PG-1 purge dọn mọi bảng phụ thuộc (đếm hàng trước/sau theo document id) + blob ref nhả; PG-2 edit holder 403, không thấy
  404, mục sống 400; PG-3 hậu duệ không quản lý ở lại, restore sau → gốc; PG-4 PurgeExpired vẫn xanh sau refactor.
- TR-1 edit holder thấy hàng `my_level=edit`, không thấy hàng không liên quan; restore/purge 403.
- TR-2 người tạo không còn quyền hiện tại (đã chuyển sở hữu / share restricted bị thu hồi) KHÔNG thấy hàng đó trong Thùng rác.
- NT-1 xóa thư mục chứa 3 doc của C → C nhận MỘT thông báo; người xóa không nhận; chạy lại consumer không nhân đôi.
- Isolation: route purge trong matrix; `TestEveryQueryNamesItsTenant`; audit coverage.

## 7. Quyết định (Advisor 2026-10-17)

- Q-T1 = (c): chỉ cấp `edit` hiệu lực, không có nhánh người tạo (lý do ở T-1); test TR-2.
- Q-T2 = (a): không thông báo khi xóa vĩnh viễn ở vòng này.
- Q-T3 = (a): không có "Dọn sạch thùng rác" ở vòng này.

# Documents — Phụ lục: đổi quyền truy cập hàng loạt cho mọi tài liệu trong thư mục

> **Trạng thái:** in-progress · **Issue:** UNI-2244 (con của UNI-923) · **Ngày:** 2026-10-27 · **Dựng trên:** phụ lục Share SRS (2026-10-15, §6.1 `PUT …/access`), ADR 0037

## 0. Quyết định của người dùng (2026-10-27, UTC+7)

- Cần "thay đổi quyền access nhanh tất cả các file (thuộc quản lý) trong folder, bao gồm cả file trong folder con cháu".
- **Chưa cần kế thừa quyền.** Thư mục vẫn không có ACL (ADR 0037 điểm 2–3 giữ nguyên, không ADR mới). Lệnh này ghi quyền
  lên từng tài liệu tại thời điểm bấm; tài liệu thêm vào sau không tự nhận quyền.
- Hai chế độ: **"Thêm vào quyền đã có"** và **"Thay thế quyền cũ"**.
- **Không giới hạn số tài liệu**: cập nhật hết mọi tài liệu trong cây con mà người bấm có quyền quản lý chia sẻ.
- Thường dưới 1.000 tài liệu: **đếm trước, ít thì chạy trong một transaction, nhiều thì chạy nền**.

## 1. Phạm vi lệnh

- Gốc: một thư mục (`kind='folder'`) người gọi đọc được. Gốc không phải thư mục → 422 `not_a_folder`.
- Tập đích: mọi tài liệu sống (trang, tệp, mọi `kind` khác `folder`) trong cây con, đệ quy qua cả thư mục con và trang
  con. Loại trừ: thư mục (`folder_not_shareable`), Thùng rác, cây My Folder của người khác (`uw_my_folder_foreign_ids`).
- Với từng tài liệu: chỉ ghi khi `DocumentAccess.canAdminister()` của người gọi; còn lại **bỏ qua và đếm**
  (`skipped_not_manageable`), không lỗi, không lộ tên. Tài liệu Work Product đang khoá (409 ở lệnh lẻ) → bỏ qua và đếm
  (`skipped_locked`).
- Không đụng: chủ sở hữu (`acl_owner_id`), quyền ngầm admin/break-glass (không phải dòng share), link chia sẻ
  (`document_share_links`) — v1 không có tuỳ chọn link.

## 2. Hai chế độ

| | `merge` — Thêm vào quyền đã có (mặc định) | `replace` — Thay thế quyền cũ |
|---|---|---|
| Principal trong danh sách | cấp nếu chưa có; đã có thì **lấy mức cao hơn** (không bao giờ hạ) | đặt **đúng** mức đã chọn (có thể hạ) |
| Principal không trong danh sách | giữ nguyên | **gỡ** |
| Dòng workspace gốc (U-SH1) | như mọi principal | thiếu trong danh sách → tài liệu về Riêng tư |
| `level` | bắt buộc, không có gỡ | bắt buộc |

`replace` chạy lại trên cùng thư mục cho cùng kết quả (idempotent) — đây là cách sửa một lô nền dừng giữa chừng.
Allowlist mức, `validateSharePrincipal`, trùng principal, DOC-05 tự cấp (`break_glass_required`) kiểm như §6.1.

## 3. Wire

Mọi route qua wrapper `api` (`router/documents.go`), `apiOp{sdi, sdo}`, `decode`; SDI/SDO có `description` + `example`.

### 3.1 `PUT /api/v1/documents/{folderID}/contents-access`

SDI `UpdateFolderContentsAccessSDI{ mode "merge|replace"; items: [{principal_type "user|workspace|organization";
principal_id; level "view|comment|edit|manage"}] (0–100; rỗng chỉ hợp lệ với replace = gỡ hết share); dry_run bool }`.

1. Kiểm toàn bộ `items` → lỗi bất kỳ: **422 `document_access_rejected`** với `rejected[]` như §6.1, không ghi gì.
2. Mở tx; advisory lock theo `folderID` (`pg_try_advisory_xact_lock`) → đang có lô chạy cho thư mục này: **409
   `folder_access_batch_running`** kèm `batch_id`.
3. Lấy id cây con (CTE đệ quy trên `idx_documents_ws_parent_all`, ràng buộc `workspace_id`).
4. `dry_run`: không ghi; trả **200** `{total, preview}`.
5. `total ≤ FolderContentsAccessSyncMax` (hằng số service, mặc định 500; test ghi đè): ghi ngay trong tx → **200**
   `{batch_id, mode: "sync", total, changed, unchanged, skipped_not_manageable, skipped_locked}`.
6. Lớn hơn: rollback, tạo dòng `document_access_batches` (`status=queued`) → **202** `{batch_id, mode: "background", total}`.

`preview`: `{changed, unchanged, skipped_not_manageable, skipped_locked, losing_users, downgraded_users,
warnings: ["wide_scope"|"downgrade"|"to_private"]}` — chỉ số đếm, không tên tài liệu, không tên người (NFR-04).

### 3.2 `GET /api/v1/documents/{folderID}/contents-access/{batchID}`

Chỉ người tạo lô; người khác / lô của tổ chức khác → 404. SDO `{batch_id, status
"queued|running|completed|failed", total, processed, changed, unchanged, skipped_not_manageable, skipped_locked,
finished_at?}`.

Tham số đường dẫn mới `batchID` dùng lại `pathParamSDI` sẵn có của folder-uploads nếu cùng tên; khác tên thì thêm case.

## 4. Một hàm ghi, hai nhánh

- `applyFolderContentsAccess(ctx, q, actor, folder, ids, mode, items, batchID)` — với mỗi id: khoá dòng tài liệu, đọc
  `DocumentAccess`, bỏ qua nếu không `canAdminister()`/khoá Work Product, tính diff so với share sống rồi ghi bằng
  `applyDocumentShare` / thân thu hồi sẵn có. **Không thêm đường ghi quyền thứ hai.**
- Nhánh sync gọi một lần với cả tập. Worker gọi theo cụm ~200 id, mỗi cụm một tx; trước mỗi cụm kiểm lại tài liệu còn
  trong cây và người gọi còn đọc được thư mục gốc (mất → lô `failed`, phần đã ghi giữ nguyên).
- Phạm vi chụp lúc bấm: dòng lô lưu danh sách id hoặc con trỏ `(id)` trên tập đã sắp; tài liệu thêm sau không tính.
- Worker: một vòng claim (`FOR UPDATE SKIP LOCKED`) thêm vào chuỗi tắt máy ở `server/cmd/server/main.go`, không phải
  goroutine trần. Con trỏ tiến độ lưu sau mỗi cụm → khởi động lại chạy tiếp không ghi lặp.

## 5. Bảng `document_access_batches`

`id` ULID, `organization_id`, `workspace_id`, `folder_id`, `created_by`, `created_by_kind`, `mode`, `items JSONB`,
`status`, `total`, `processed`, các bộ đếm, `cursor_id`, `error_code`, `created_at`, `updated_at`, `finished_at`.
Không FK; mỗi index một file `CREATE INDEX CONCURRENTLY` (claim theo `status, created_at`; tra theo `workspace_id,
folder_id` cho lock/409). Query sqlc ràng buộc `workspace_id` hoặc ghi `-- tenant:` (worker claim: `system`).

## 6. Audit, sự kiện, thông báo

- Mỗi tài liệu đổi: dòng audit + outbox như lệnh lẻ (`document.shared` / `document.unshared` / đổi mức), cùng tx với
  cụm; `metadata{batch_id, via: "folder_contents", folder_id, mode, before_level}` — đủ dữ liệu cho "Hoàn tác lô" sau
  này (v1 không có nút).
- Một dòng audit cho chính lệnh (`document.contents_access_updated`, đối tượng = thư mục, đếm kết quả) khi lô xong;
  thêm vào `audit_coverage_test.go`.
- Sự kiện `document_access_batch.completed` (chỉ id) khi lô nền xong → client làm mới; thêm vào cả ba bản catalogue.
- Thông báo: **một** thông báo cho mỗi người được thêm/nâng quyền mỗi lô ("Bạn được chia sẻ N tài liệu trong thư mục
  X"), gộp theo `batch_id`, gửi khi lô xong. Người bị gỡ/hạ không nhận (như lệnh lẻ). Không thông báo từng tài liệu.

## 7. UI (web + app, cùng lúc)

- Menu thư mục: **"Chia sẻ các tài liệu bên trong…"** (hiện cho mọi người đọc được thư mục). Mở popup Chia sẻ hiện có
  (`share-people-picker.tsx`) ở chế độ hàng loạt: ô chọn chế độ Thêm / Thay thế, danh sách principal, dòng workspace gốc
  luôn hiện ở chế độ Thay thế.
- Bấm Xác nhận → `dry_run` → tóm tắt: "Sẽ đổi 37 tài liệu · bỏ qua 5 bạn không quản lý"; Thay thế thêm "12 người mất
  quyền ở ít nhất một tài liệu", nút destructive "Thay thế quyền". Có `wide_scope`/`to_private` thì hiện cảnh báo.
- 200 → toast kết quả. 202 → thanh tiến độ (poll `GET`, hoặc chờ sự kiện), đóng popup không huỷ lô; toast khi xong.
- Câu cố định: "Áp dụng cho các tài liệu hiện có. Tài liệu thêm sau không tự nhận quyền."
- Chuỗi qua i18n (vi + en), endpoint + schema + test malformed-response trong `packages/core`.

## 8. Test nghiệm thu (tên chốt khi lane land)

Service: merge chỉ nâng không hạ; replace đặt đúng tập và gỡ phần còn lại; replace thiếu dòng workspace → Riêng tư;
bỏ qua tài liệu không quản lý / Work Product khoá và đếm đúng; đệ quy qua thư mục con và trang con; loại Thùng rác và
My Folder của người khác; nhánh sync khi `total ≤ ngưỡng` (tất cả hoặc không khi lỗi), nhánh nền khi lớn hơn (ngưỡng
ghi đè nhỏ), lô nền chạy tiếp sau khởi động lại không ghi lặp; 409 khi lô đang chạy; principal sai → 422 không ghi;
dry-run không ghi không audit. Handler: hai route, 202/200/409/422/404. Isolation matrix: thư mục của A, principal của
A trong body (`isoReferences`), `GET` lô của A. Audit coverage, events catalogue, notification gộp theo lô. Web/app:
popup chế độ hàng loạt, tóm tắt dry-run, tiến độ, toast.

## 9. Chia lane đề xuất

- **BE** (Go): §1–§6, contract trước (SDI/SDO + mã lỗi) để FE dựng fake.
- **FE web** + **FE app** (song song sau contract): §7, cùng endpoint trong `packages/core`.

# folders-unshare — dọn thư mục đang chia sẻ

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — lệnh vận hành một lần của UNI-1974 · **File:** `server/cmd/uniwork-admin/main.go` (`folders-unshare`), `server/internal/service/document_folder_unshare.go`

Từ UNI-1974 thư mục không bao giờ được chia sẻ: không `visibility = 'workspace'`, không dòng `document_shares`, không link công khai;
chỉ tài liệu (page, file) được chia sẻ. Server từ chối mới (422 `folder_not_shareable`) nhưng dữ liệu cũ vẫn còn thư mục đang
chia sẻ. Lệnh này đưa chúng về riêng tư. Một migration không gọi được audit recorder, nên việc dọn là một lệnh: mỗi thư mục một
transaction, đi qua `writeDocumentHomeRow` và `revokeDocumentShareRowWithBatch` (mỗi thay đổi có `audit_events` + `outbox_events`, actor
`system:folder-share-off`).

## Triệu chứng

- Một thư mục cũ vẫn hiện huy hiệu phạm vi chia sẻ hoặc xuất hiện trong "Được chia sẻ với tôi" của người khác sau deploy
  (danh sách đã ẩn thư mục, nhưng dòng DB còn).
- Truy vấn còn kết quả:
  ```sql
  SELECT count(*) FROM documents d
  WHERE d.kind = 'folder' AND d.system_kind IS NULL AND d.owner_id IS NULL
    AND (d.visibility = 'workspace'
         OR EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = d.id AND s.revoked_at IS NULL));
  ```

## Kiểm tra

1. Đếm trước, không ghi gì: `DATABASE_URL=... uniwork-admin folders-unshare --dry-run`
   (in `would unshare N folder(s): X workspace-visible, Y live share(s) revoked`).
2. Tài liệu bên trong thư mục không đổi quyền: mỗi tài liệu giữ visibility và share của riêng nó.

## Khắc phục

1. Chạy một lần sau khi binary UNI-1974 đã chạy trên mọi node: `DATABASE_URL=... uniwork-admin folders-unshare [--batch-size 200]`.
2. Lệnh idempotent: chạy lại sau khi xong in `unshared 0 folder(s)`. Thư mục giữ nguyên mức workspace_level cũ trên dòng
   restricted; các share còn sống bị thu hồi.
3. Không có lệnh ngược. Chia sẻ lại từng tài liệu bên trong từ giao diện nếu cần.

## Leo thang

- Lệnh dừng giữa chừng: chạy lại, các thư mục đã dọn được bỏ qua.
- Lỗi lặp ở một thư mục (khóa, audit): ghi `correlation_id` trong log và chuyển người phụ trách Documents.

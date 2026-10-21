# folders-into-my-folder — đưa thư mục riêng cũ vào My Folder của chủ

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** không có alert — lệnh vận hành một lần của UNI-2055 (ADR 0037 điểm 8) · **File:** `server/cmd/uniwork-admin/main.go` (`folders-into-my-folder`), `server/internal/service/document_folders_into_my_folder.go`

Từ ADR 0037 thư mục ngoài My Folder hiện cho cả workspace; thư mục trong My Folder vẫn riêng tư. Dữ liệu cũ còn thư mục `restricted`
nằm ngoài My Folder (gốc workspace, dưới một trang, hoặc dưới thư mục của người khác): nếu để nguyên, chúng là thư mục "riêng tư giữa
chốn công khai". Lệnh này đưa mỗi thư mục như vậy vào My Folder của `acl_owner_id`, giữ `restricted`, nên chủ không mất tính riêng tư
đã được hứa. Mỗi thư mục một transaction, actor `system:folder-ws-public`, mỗi dòng di chuyển có `audit_events` + `outbox_events`.

Quy tắc của lệnh:

- Đơn vị là thư mục riêng cao nhất của một chủ ngoài mọi cây My Folder. My Folder của chủ được tạo nếu chưa có (cả thành viên đã bị
  vô hiệu hoá hay đã rời tổ chức). Tên trùng trong My Folder lấy hậu tố `(2)`, `(3)`… như một lần di chuyển thường.
- Trong cây của đơn vị, thứ không thuộc chủ được lấy ra trước: thư mục riêng của chủ khác thành một đơn vị riêng (vào My Folder của
  chủ đó); tài liệu của chủ khác, và thư mục đang mở cho workspace, về gốc workspace cùng cây con, quyền giữ nguyên. Tài liệu của
  chính chủ đi theo thư mục, quyền giữ nguyên.
- Thư mục đang mở cho workspace ngoài My Folder là công khai chủ ý (ADR 0037): lệnh không bao giờ đưa nó vào My Folder.
- Thư mục trong Thùng rác cũng được chuyển (khôi phục sẽ về My Folder, không về chỗ công khai); chúng giữ trạng thái lưu trữ.
- Thư mục không có chủ, quá sâu (cây con + My Folder vượt giới hạn độ sâu) hoặc không tạo được My Folder được bỏ qua và in lý do;
  lệnh không dừng vì chúng.

## Triệu chứng

- Còn thư mục riêng tư nằm ngoài My Folder sau khi bật thư mục chung (đếm gần đúng các thư mục cần chuyển; thư mục nằm sâu hơn một
  cấp trong My Folder cũng được đếm nhưng lệnh bỏ qua chúng):
  ```sql
  SELECT count(*) FROM documents d
  WHERE d.kind = 'folder' AND d.system_kind IS NULL AND d.owner_id IS NULL AND d.visibility = 'restricted'
    AND (d.parent_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM documents p WHERE p.id = d.parent_id AND p.system_kind = 'my_folder'));
  ```
- Người dùng báo thư mục của họ "biến mất" khỏi gốc workspace: nó đã vào My Folder của họ (đúng thiết kế).

## Kiểm tra

Thứ tự bắt buộc: **deploy code server → `--dry-run` → chạy thật → bật giao diện web.** Giao diện thư mục chung chỉ bật sau khi lệnh chạy xong.

1. Đếm trước, không ghi gì:
   `DATABASE_URL=... uniwork-admin folders-into-my-folder --dry-run [--organization ORG_ID]`
   in `would move N folder(s) into My Folder (U unit(s)), relocated D document(s) and P public folder(s) to the workspace root, S skipped`
   rồi một dòng `skipped <id>: <lý do>` cho từng thư mục bị bỏ qua, lý do là một trong (`no_owner`, `too_deep`, `my_folder_unavailable: …`, `blocked_by_sub_folder`).
2. Sau khi chạy thật, chạy lại: phải in `moved 0 folder(s)` và không ghi gì (idempotent).
3. Đọc audit: mọi dòng của lần chạy có `actor_id = 'folder-ws-public'`, `action = 'document.moved'`,
   `metadata.reason = 'folders_into_my_folder'` và cùng một `metadata.batch_id` cho cả lần chạy:
   ```sql
   SELECT resource_id, metadata::jsonb->>'unit_id' AS unit, changes
   FROM audit_events
   WHERE actor_id = 'folder-ws-public' AND metadata::jsonb->>'batch_id' = '<batch_id>';
   ```
   `unit_id` là thư mục gốc của đơn vị; `changes` có `parent_id` trước/sau (và `title` nếu bị đánh số).
   My Folder do lệnh tạo (chủ chưa có) có dòng `document.created` với actor là chủ (`metadata.system_kind = 'my_folder'`), nên không nằm trong truy vấn `actor_id = 'folder-ws-public'` ở trên.
4. Tài liệu bên trong không đổi quyền: mỗi tài liệu giữ `visibility`, `workspace_level` và share của riêng nó; chỉ `parent_id` của
   tài liệu thuộc chủ khác đổi (về gốc).

## Khắc phục

1. Sau khi mọi node chạy binary mới: `DATABASE_URL=... uniwork-admin folders-into-my-folder [--batch-size 200] [--organization ORG_ID]`.
2. Thư mục bị bỏ qua: `no_owner` — gán chủ rồi chạy lại; `too_deep` — chủ rút gọn cây hoặc admin di chuyển cây con rồi chạy lại;
   `my_folder_unavailable` — xem log, chạy lại sau khi sửa nguyên nhân.
3. Không cần rollback: không có gì bị xoá. Chủ tự đưa thư mục ra khỏi My Folder khi muốn công khai (hộp thoại xác nhận của web); tài liệu
   đã về gốc workspace vẫn ở gốc và giữ quyền của chúng.
4. Lệnh dừng giữa chừng: chạy lại, các thư mục đã vào My Folder được bỏ qua.

## Leo thang

- Lỗi lặp ở một thư mục (khoá cây, audit, chỉ mục tên): ghi `correlation_id` trong log và chuyển người phụ trách Documents.
- Một người báo mất tài liệu sau lệnh: tìm dòng `document.moved` của tài liệu theo `resource_id` để thấy `parent_id` trước/sau; tài liệu của
  người khác trong thư mục của họ luôn được đưa về gốc workspace, không vào My Folder của người kia.

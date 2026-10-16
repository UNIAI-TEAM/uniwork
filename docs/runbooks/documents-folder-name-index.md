# documents-folder-name-index — index unique tên thư mục INVALID

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** không có alert — runbook vận hành của E6 FD-02 (UNI-1462 PR 2) · **File:** `server/migrations/9991791959562470_documents_folder_name_uidx.{up,down}.sql` (index gốc), `9991792100200003_documents_folder_name_user_uidx` (index hiện hành) và `9991792100200004_documents_drop_folder_name_legacy_idx` (bỏ index gốc)

`idx_documents_folder_name_user_uidx` là ràng buộc DB của FD-02: một thư mục **sống** (`kind = 'folder'`,
`archived_at IS NULL`, `owner_id IS NULL`, `system_kind IS NULL`) của một workspace chỉ giữ một tên dưới một cha, khóa
`lower(title COLLATE "und-x-icu")` trên tiêu đề NFC — "Hợp đồng" = "HỢP ĐỒNG", "Ma" ≠ "Mã" (phụ lục §3.3).
Index này thay `idx_documents_folder_name_uidx` (MYFOLDER-01, UNI-1850): cùng khóa, thêm `system_kind IS NULL` để My Folder
của các thành viên không đụng nhau hay đụng thư mục người dùng tên "My Folder". Migration `9991792100200003` dựng index mới
`CONCURRENTLY`, migration `9991792100200004` mới bỏ index cũ — nên giữa hai bước luôn có một index bảo vệ. Nó là lưới an toàn sau kiểm trước + khóa cây của PR 1. **PR 2 chỉ merge sau khi binary PR 1 đã chạy trên mọi môi
trường**: binary đó chuẩn hóa tiêu đề, kiểm trùng dưới khóa cây, và migration dọn trùng
`9991791949247558_documents_folder_name_dedupe` đã đưa bảng về trạng thái sạch. Mỗi file index là **một câu**
`CREATE UNIQUE INDEX CONCURRENTLY` trong file riêng (CLAUDE.md › Database and Migration Rules).

## Triệu chứng

- Deploy kèm file index không xong: log server có `migration 9991792100200003_documents_folder_name_user_uidx: ...`
  (thường là `duplicate key value violates unique constraint`), và file **không** được ghi `schema_migrations`
  — lần khởi động sau runner chạy lại file rồi lỗi lại; `/readyz` báo check `migrations` cũ hơn binary (503).
- Trong DB: index không tồn tại, hoặc tồn tại với `indisvalid = false` (một lần `CONCURRENTLY` lỗi để lại index INVALID).
- Hiếm: hai thư mục sống trùng tên (index INVALID bị bỏ qua khi lập kế hoạch và có thể thiếu hàng cũ) — xác nhận ở mục 3.

## Kiểm tra

1. Index có mặt và hợp lệ:
   ```sql
   SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
   FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname IN ('idx_documents_folder_name_user_uidx', 'idx_documents_folder_name_uidx');
   ```
   Mong đợi đúng một hàng, `idx_documents_folder_name_user_uidx`; `idx_documents_folder_name_uidx` còn lại nghĩa là migration `9991792100200004` chưa chạy. Không có hàng → file chưa chạy xong (mục 2), hoặc ai đó DROP tay. `indisvalid = false` → ca của runbook này.
2. File đã được ghi chưa — `server/migrations/embed.go`, hàm `Up`: câu file chạy trước, version chỉ ghi sau khi
   câu chạy thành công (khoảng dòng 470–482):
   ```sql
   SELECT version, applied_at FROM schema_migrations WHERE version IN ('9991792100200003_documents_folder_name_user_uidx', '9991792100200004_documents_drop_folder_name_legacy_idx');
   ```
   Không có hàng + index INVALID/không có → build đã lỗi và sẽ được chạy lại ở lần khởi động sau.
3. Còn bản trùng không (lý do số 1 của build lỗi):
   ```sql
   SELECT workspace_id, COALESCE(parent_id, '') AS parent_key,
          lower(title COLLATE "und-x-icu") AS name_key, count(*)
   FROM documents
   WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL AND system_kind IS NULL
   GROUP BY 1, 2, 3 HAVING count(*) > 1;
   ```
4. Collation của môi trường đích: `SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu';` — thiếu thì mọi
   lần build đều lỗi (Leo thang; không tự đổi sang `lower(title)`).
5. Log: `docker compose logs server | grep documents_folder_name`; body `/readyz` (check `migrations`).

## Khắc phục

Theo đúng thứ tự, kiểm lại sau mỗi bước.

1. Chạy lại hai câu dọn trùng dưới đây (idempotent: chạy lại không đổi gì). **Không chép** `9991791949247558_documents_folder_name_dedupe.up.sql`:
   file lịch sử đó chưa biết `system_kind`, sẽ đổi tên My Folder hợp lệ (`system_kind = 'my_folder'`) và cả thư mục gốc thường tên "My Folder"; lịch sử migration đã áp dụng giữ nguyên, không sửa. **Không bao giờ đổi tên hàng hệ thống (`system_kind = 'my_folder'`)** — tên của chúng cố định, và chúng không nằm trong index. Cả hai câu chỉ nhắm đúng tập hàng của index hiện hành (`kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL AND system_kind IS NULL`):
   ```sql
   -- Folder name dedupe for the current index population only: live user
   -- folders (system_kind IS NULL). System rows (My Folder) are never touched.
   -- The oldest row (created_at, id) of each group keeps the name; later ones
   -- take "Tên (n)", n the smallest free number in that parent.

   UPDATE documents
   SET title = normalize(title, NFC)
   WHERE kind = 'folder'
     AND archived_at IS NULL
     AND system_kind IS NULL
     AND normalize(title, NFC) <> title;

   WITH live AS (
     SELECT d.id, d.workspace_id, COALESCE(d.parent_id, '') AS parent_key, d.title,
            lower(d.title COLLATE "und-x-icu") AS name_key, d.created_at
     FROM documents d
     WHERE d.kind = 'folder' AND d.archived_at IS NULL AND d.owner_id IS NULL AND d.system_kind IS NULL
   ),
   ranked AS (
     SELECT l.*,
            row_number() OVER (PARTITION BY l.workspace_id, l.parent_key, l.name_key ORDER BY l.created_at, l.id) AS rn
     FROM live l
   ),
   groups AS (
     SELECT DISTINCT ON (workspace_id, parent_key, name_key)
            workspace_id, parent_key, name_key, title AS base_title
     FROM ranked
     ORDER BY workspace_id, parent_key, name_key, rn
   ),
   free AS (
     SELECT g.workspace_id, g.parent_key, g.name_key, n.n,
            row_number() OVER (PARTITION BY g.workspace_id, g.parent_key, g.name_key ORDER BY n.n) AS slot
     FROM groups g
     CROSS JOIN LATERAL generate_series(
       2, 2 + (SELECT count(*) FROM live l2 WHERE l2.workspace_id = g.workspace_id AND l2.parent_key = g.parent_key)
     ) AS n(n)
     WHERE NOT EXISTS (
       SELECT 1 FROM live l
       WHERE l.workspace_id = g.workspace_id AND l.parent_key = g.parent_key
         AND l.name_key = lower((g.base_title || ' (' || n.n || ')') COLLATE "und-x-icu")
     )
   )
   UPDATE documents d
   SET title = r.title || ' (' || f.n || ')'
   FROM ranked r
   JOIN free f
     ON f.workspace_id = r.workspace_id
    AND f.parent_key = r.parent_key
    AND f.name_key = r.name_key
    AND f.slot = r.rn - 1
   WHERE d.id = r.id AND r.rn > 1;
   ```
2. Bỏ index hỏng (index mới; chỉ bỏ index cũ `idx_documents_folder_name_uidx` khi mục 1 đã có index mới hợp lệ) — ngoài transaction, `DROP INDEX CONCURRENTLY` không chạy được trong transaction:
   ```sh
   psql "$DATABASE_URL" -c 'DROP INDEX CONCURRENTLY IF EXISTS idx_documents_folder_name_user_uidx;'
   ```
3. Chạy lại file index (`9991792100200003`): khởi động lại binary UniWork (runner `Up` chạy mọi file chưa ghi; file index lỗi chưa
   được ghi `schema_migrations`), hoặc trên checkout có mã nguồn: `make migrate-up`.
4. Kiểm lại: mục 1 của Kiểm tra trả đúng một hàng với `indisvalid = t`, `indisready = t`; mục 2 có version
   `9991792100200003_documents_folder_name_user_uidx` và `9991792100200004_documents_drop_folder_name_legacy_idx`.
5. Không sửa `schema_migrations` bằng tay; không tạo index bằng tay (phải để runner ghi version).

## Rollback

Chính sách (review r1a, BE-MF-2): sau khi đã có My Folder, rollback được hỗ trợ **chỉ ở tầng ứng dụng**.

1. Schema additive ở lại: cột `system_kind`, `idx_documents_my_folder_uidx`, `idx_documents_folder_name_user_uidx`. Binary cũ thấy My Folder như thư mục gốc thường.
2. File down của `9991792100200004` dựng lại index cũ `idx_documents_folder_name_uidx` và sẽ lỗi `23505` khi hai My Folder của hai thành viên (hoặc một My Folder cùng một thư mục gốc thường tên "My Folder") cùng nằm trong một workspace. Lỗi đó là chủ ý; không đổi tên hay xóa hàng hệ thống để cho nó qua.
3. Một lần `CREATE INDEX CONCURRENTLY` lỗi để lại `idx_documents_folder_name_uidx` INVALID mà `IF NOT EXISTS` sẽ bỏ qua. Trước mọi lần thử lại:
   ```sql
   SELECT indisvalid FROM pg_index WHERE indexrelid = 'idx_documents_folder_name_uidx'::regclass;
   ```
   ```sh
   psql "$DATABASE_URL" -c 'DROP INDEX CONCURRENTLY IF EXISTS idx_documents_folder_name_uidx;'
   ```

## Leo thang

- Mục 3 vẫn còn hàng sau bước 1, hoặc bước 3 vẫn 23505 → có writer tạo bản trùng ngoài service: gọi owner
  FD-02 (UNI-1462, lead E6/server) kèm `workspace_id`, `parent_key`, `name_key` đọc được; không tắt index để chữa cháy.
- Build lỗi vì lý do khác (hết đĩa, lock timeout, thiếu collation `und-x-icu`) → gọi người giữ hạ tầng; thiếu
  collation là chặn cứng của FD-02.
- PR 1 chưa chạy trên môi trường đó → dừng, không khởi động binary PR 2 (thứ tự phát hành ở đầu runbook).

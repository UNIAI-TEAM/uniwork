# 0023 — FileService giữ `organization_id` cho file theo tenant; NULL chỉ là nhánh avatar cá nhân

**Trạng thái:** accepted (2026-09-26) — quyết định từ spec `docs/superpowers/specs/2026-09-22-shared-file-service-design.md` §4.1/§8.1 và plan §4 T1-Q10 (issue UNI-739), land cùng schema FileService (T1b). Guard tests: `TestNullTenantIsOnlyTheAvatarBranch` + `nullableTenantTables` trong `server/migrations/lint_test.go`, và các test SQL trong `server/migrations/file_service_schema_test.go`.

## Bối cảnh

ADR 0008 đặt `organization_id` là ranh giới tenant: mọi bảng nghiệp vụ tạo sau
migration `065` khai báo cột `TEXT NOT NULL`. FileService (UNI-726) phải phục vụ
cả avatar cá nhân — một file thuộc phạm vi tài khoản người dùng, nằm ngoài mọi
organization, nhưng vẫn cần cùng đường dẫn upload/claim/GC với file tenant.

Đặt `organization_id NOT NULL` sẽ ép avatar vào một tenant giả (không tồn tại)
hoặc cấm avatar hoàn toàn. Để `NULL` tự do lại mở một "tenant mờ": hàng thiếu
tenant có thể bị đọc nhầm là public, hoặc rò sang truy vấn tenant qua
`OR organization_id IS NULL`.

## Quyết định

1. `files`, `file_upload_sessions` và `file_jobs` mang `organization_id TEXT`
   (nullable) với CHECK chặn chuỗi rỗng. NULL là **một nhánh có tên** — scope
   avatar cá nhân — không bao giờ nghĩa là "public" hay "tenant chưa biết".
2. `file_upload_sessions` ghim nhánh bằng CHECK scope: `organization_id IS NULL`
   chỉ hợp lệ khi `purpose = 'user_avatar'` **và** `workspace_id IS NULL`
   **và** `user_id IS NOT NULL`. Mọi purpose khác đòi tenant non-NULL; các
   purpose org+workspace còn đòi `workspace_id` (mirror `files.ScopeShape` trong
   `server/internal/files`).
3. Query tenant không bao giờ viết `organization_id = $t OR organization_id IS
   NULL`. Nhánh identity có query riêng (`GetAvatarFileForUser`) với predicate
   `organization_id IS NULL` rõ ràng cộng điều kiện grant theo user — đọc avatar
   là quyền của chủ tài khoản (và cột `users.avatar_file_id` khi lane identity
   thêm), không phải lỗ hổng của quy tắc tenant.
4. `file_jobs.organization_id` là bản sao tenant của file tại lúc enqueue để
   truy vấn dọn theo org; nó không phải grant ủy quyền.
5. Mọi bảng mới khác vẫn theo ADR 0008 (`TEXT NOT NULL`). Muốn thêm một bảng
   chấp nhận NULL tenant cần ADR mới và dòng trong `nullableTenantTables`.

## Hệ quả

- `server/migrations/lint_test.go` thêm `nullableTenantTables` (lý do kèm tên)
  và `TestNullTenantIsOnlyTheAvatarBranch` ghim: tập bảng chấp nhận NULL là
  đúng ba bảng FileService, và CHECK scope buộc NULL-tenant với
  `purpose = 'user_avatar'` + `user_id IS NOT NULL`.
- SQL test `TestFileServiceNullTenantAvatarBranch` chứng minh trên DB thật:
  session avatar thiếu `user_id` bị chặn, purpose khác với tenant NULL bị chặn,
  đọc avatar chỉ trả về cho user sở hữu session.
- Giá phải trả: `files.organization_id` không tự chứng minh tenant nguyên vẹn
  — ý nghĩa của NULL sống ở `file_upload_sessions` và tầng service. Người viết
  query mới cho `files` phải nhớ quy tắc ở mục 3; reviewer giữ luật này cho
  tới khi scanner query-scope của ADR 0008 land.
- Khi lane identity thêm `users.avatar_file_id`, truy vấn avatar mở rộng sang
  hai nguồn grant (session + cột users) — vẫn qua nhánh query riêng, không qua
  OR NULL trong query tenant.

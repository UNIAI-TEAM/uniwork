# 0008 — Cách ly tenant ở tầng service; `organization_id` trên mọi bảng nghiệp vụ

**Trạng thái:** accepted (2026-09-04) — chấp nhận bởi quangpd trong phiên Giai đoạn 0 (UNI-420). Test giữ luật có đủ từ 2026-10-02 (mục cuối); luật nằm ở `CLAUDE.md` § Database and Migration Rules.

## Bối cảnh

Bản cũ dựa vào 212 policy RLS của Supabase làm hàng rào chính. Kết quả đo được
(`docs/audit/UNIWORK_STABILITY_*`): 26/173 kịch bản fail-closed quá mức (chặn người hợp
lệ), policy khó review, nghiệp vụ dồn vào 312 hàm `SECURITY DEFINER` để "đi vòng" RLS, và
toàn bộ mô hình gắn chặt vào Supabase.

UniWork hiện đã có luật "mọi query lọc theo `workspace_id`; membership chỉ qua
`WorkspaceService.RequireMember`" (`CLAUDE.md` § Database and Migration Rules,
`arch_test.go`). Nhưng có dữ liệu thuộc organization mà không thuộc workspace (gói,
quota, agents, phòng ban, audit toàn org), và Vision §6.1 đòi "0 rò rỉ" có test.

## Quyết định

1. Ranh giới tenant là **organization**. Mọi bảng nghiệp vụ có `organization_id NOT NULL`;
   bảng thuộc workspace có thêm `workspace_id`. Không có bảng nghiệp vụ nào thiếu cả hai.
2. Cách ly thực thi ở **tầng service Go**: mỗi query sqlc nhận `organization_id` (và
   `workspace_id` nếu có) làm tham số bắt buộc; service lấy hai giá trị này từ
   `RequireMember` / `RequireOrgMember`, không từ request body.
3. Handler không bao giờ truyền id tenant thô từ client vào query; id chỉ đi qua service
   sau khi đã kiểm membership.
4. RLS của Postgres **không** là hàng rào chính. Có thể bật như lớp phòng thủ thứ hai cho
   tier on-premise (Giai đoạn E) bằng session variable, nhưng test cách ly phải xanh mà
   không cần RLS.
5. Ma trận cách ly tenant (kế thừa 173 kịch bản của bản cũ, viết lại) chạy trong CI với
   hai organization fixture; thêm bảng mới phải thêm dòng vào ma trận.

## Hệ quả

- `server/migrations/lint_test.go` mở rộng: bảng mới thiếu `organization_id` thì fail
  (danh sách ngoại lệ tường minh: `users`, `refresh_tokens`, bảng hệ thống).
- sqlc: query trên bảng nghiệp vụ không có `organization_id = $n` trong `WHERE` thì
  test tĩnh fail (scanner đọc `server/pkg/db/queries/*.sql`).
- Bảng hiện có (`tasks`, `meetings`, `chat_*`...) cần backfill `organization_id` từ
  workspace; làm trong cùng đợt với ADR 0007.
- Cái giá: mỗi query dài thêm một điều kiện; bù lại cách ly kiểm thử được bằng unit test
  và không phụ thuộc nhà cung cấp DB.

## Test giữ luật (điều kiện để đưa luật vào `CLAUDE.md`)

- `server/migrations/lint_test.go` (cột bắt buộc).
- `server/pkg/db/queries_scope_test.go` (mới): mọi query có điều kiện tenant.
- `server/internal/service/isolation_matrix_test.go` (mới): hai org, mọi endpoint.

## Thực thi (2026-10-02)

Ba guard đã có. Chỗ khác với kế hoạch ở trên được ghi rõ kèm lý do:

- **Cột.** Hết nợ backfill: 18 bảng cũ có `organization_id NOT NULL` lấy từ dòng cha
  (`workspaces`, `chat_rooms`, `meetings`). `meeting_guests` (danh tính khách theo cookie, đứng
  trên mọi tổ chức như `users`) và `meeting_provider_events` (sổ chống trùng webhook như
  `webhook_inbox`) được miễn kèm lý do trong `tenantExemptTables`.
  `TestEveryBusinessTableCarriesOrganizationID` và `TestTenantColumnIsNotNull` giữ.
- **Query.** `server/migrations/query_scope_test.go` (`TestEveryQueryNamesItsTenant`), đặt
  cạnh lint migration vì cần biết bảng nào có cột tenant. Khác kế hoạch ở hai điểm.
  (1) `workspace_id = $n` cũng tính là điều kiện tenant, vì workspace thuộc đúng một tổ
  chức và luật workspace có từ trước. (2) Query đọc theo id hoặc theo dòng cha không có
  tenant trong URL để lọc, ví dụ `/meetings/{id}` khi người gọi thuộc nhiều tổ chức. Những
  query đó ghi lý do bằng một từ trong bộ đóng (`by-id`, `parent x_id`, `self`, `token`,
  `system`, `platform`) để reviewer biết cần kiểm gì ở caller.
- **Ma trận.** `server/internal/handler/isolation_matrix_test.go` chạy ở tầng HTTP chứ không
  ở `internal/service`, và lấy danh sách route từ chính router: route có tham số tenant tự
  được thử, route không có phải được xếp loại trong `isoRoutes` kèm lý do, nếu không test
  đỏ. Hai tổ chức được dựng bằng chính API cộng vài dòng chèn tay ở chỗ chỉ webhook hay
  worker ghi; mọi bảng có `organization_id` phải có ít nhất một dòng của A, trừ ba bảng
  liệt kê kèm lý do trong `isoUnseeded`. Chủ tổ chức B gọi mọi route bằng id của A, gọi
  với id cha của B kèm id con của A, gọi route của mình với id của A trong body
  (`isoReferences`, mỗi trường id trong SDI phải có ca hoặc lý do miễn), lặp lại hai cách
  sau khi chủ B cũng là thành viên của A, và mọi route đó còn được gọi khi chưa đăng
  nhập. Câu trả lời phải là từ chối,
  không chứa chữ hay id nào của A. Hash mọi dòng có `organization_id` của A phải không
  đổi, và không dòng nào của B được trỏ sang A. Mỗi lời từ chối có đối chứng (trừ route
  mà `isoRoutes` ghi lý do không làm được): chủ của
  chính tenant đó gọi cùng route trên dữ liệu của mình (đọc ở lượt `control`, ghi ở lượt
  `write-control` trên tổ chức thứ ba) và không bị từ chối theo cùng cách, nên 403/404
  của B là do kiểm tra tenant chứ không do route hỏng. `TestIsolationRealtime` làm phần
  tương tự cho hai WebSocket, kể cả việc frame gửi vào scope của A không tới socket của B.
- **Migration.** Backfill gộp vào một file (`9991790915600001_tenant_backfill_organization_id`)
  chạy trong một transaction ngầm với `lock_timeout` 5 giây: hoặc cả 18 bảng có cột, hoặc
  không bảng nào, và lần deploy chờ khóa quá lâu thì dừng thay vì chặn ghi.

Lần chạy đầu của ma trận tìm ra và đã sửa:

- token lời mời chấp nhận được bằng tài khoản khác email được mời;
- `DELETE /email-hub/accounts/{id}` xóa thư cache của hộp thư tổ chức khác;
- WebSocket phòng chờ nghe được cuộc họp của bất kỳ ai biết id;
- `/uploads/*` (backend local) trả file FileService của mọi tổ chức không cần đăng nhập;
- dự án và cuộc họp nhận lead hoặc project của tổ chức khác;
- vài route trả 200 hoặc 500 thay vì 404 cho id của tổ chức khác.

Lần review sau đó (OCR, 2026-10-02) tìm thêm và đã sửa:

- lời mời so email bằng chữ thường thô (`ſ` gập thành `s`) và chấp nhận email chưa xác minh;
- khách chưa có link mời vẫn gõ cửa được, và `Evaluate` để lộ trạng thái cuộc họp cho người
  ngoài;
- phòng chờ vẫn cho người đã bị mời ra hoặc bị từ chối nghe tiếp;
- `/uploads/V1/...` (khác hoa thường) lọt qua chặn FileService;
- thu hồi link mời họp không ràng theo cuộc họp trong URL;
- tạo trang con, sao chép tài liệu nhận trang cha của workspace khác khi người gọi thuộc cả
  hai;
- bộ quét query bỏ sót gần hết câu `INSERT`, mọi `ON CONFLICT DO UPDATE` và `sqlc.narg`.

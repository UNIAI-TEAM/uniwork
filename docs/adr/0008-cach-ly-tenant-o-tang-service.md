# 0008 — Cách ly tenant ở tầng service; `organization_id` trên mọi bảng nghiệp vụ

**Trạng thái:** accepted (2026-09-04) — chấp nhận bởi quangpd trong phiên Giai đoạn 0 (UNI-420). Luật tương ứng vào `CLAUDE.md` cùng lúc với test giữ luật (xem mục cuối); đến lúc đó reviewer giữ luật bằng tay theo DoD.

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

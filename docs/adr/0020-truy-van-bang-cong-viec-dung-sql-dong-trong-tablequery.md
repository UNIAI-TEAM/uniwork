# 0020 — Truy vấn view Bảng dựng SQL động trong `pkg/db/tablequery`, không qua sqlc

**Trạng thái:** accepted (2026-09-16) — quangpd duyệt thiết kế view Bảng ngang usf (spec `docs/superpowers/specs/2026-09-16-tasks-table-view-parity-design.md` §3.5, issue UNI-654), trong đó có chọn phân trang cursor như usf. Cách giữ luật (arch test + test builder) là lựa chọn của agent khi viết spec, chờ xác nhận ở review PR2.

## Bối cảnh

Mọi truy vấn của UniWork đi qua sqlc (`server/pkg/db/queries/*.sql`), và ADR 0008 dự
định quét thư mục đó để chắc mỗi query lọc `organization_id`. View Bảng cần sắp xếp
server theo 9 trường cộng mọi thuộc tính tùy chỉnh (JSONB, kiểu khác nhau), hai chiều,
NULLS LAST, keyset cursor trên `(biểu thức sort, created_at, id)`, tìm kiếm nhiều từ,
nhóm theo 5 chiều và cây việc con (dòng gốc = không có cha **hoặc** cha ngoài tập
khớp). Viết bằng sqlc tĩnh nghĩa là hoặc hàng chục query gần giống nhau, hoặc một query
khổng lồ với `CASE` cho mọi tổ hợp — không index được và không đọc được. usf giải bài
này bằng SQL dựng trong Go (`issue_table_rows.go`).

## Quyết định

1. Truy vấn view Bảng (groups, rows, facets) được dựng trong một package duy nhất
   `server/pkg/db/tablequery/`, chạy bằng `pgx` trên transaction service truyền vào.
2. Package chỉ nhận struct đã chuẩn hóa. Mọi giá trị người dùng là tham số `$n`; tên
   cột và biểu thức chỉ lấy từ whitelist khai trong package; không có đường nào nối
   chuỗi từ input vào SQL.
3. Mọi câu sinh ra bắt đầu bằng `t.organization_id = $1 AND t.workspace_id = $2`.
4. Chỉ `server/internal/service/task_table*.go` được import package này; service vẫn
   gọi `RequireMember` trước mọi truy vấn.

## Hệ quả

- `server/internal/arch_test.go` thêm test: import `pkg/db/tablequery` ngoài
  `service/task_table*.go` thì đỏ.
- `server/pkg/db/tablequery/*_test.go` ghim mệnh đề tenant ở mọi câu và việc giá trị
  chỉ đi qua tham số (chuỗi độc hại không xuất hiện trong SQL).
- Scanner query-scope của ADR 0008 khi xuất hiện phải bao cả package này (hoặc dựa vào
  test builder ở trên) — ghi lại để người viết scanner không bỏ sót.
- Sqlc vẫn là mặc định cho mọi truy vấn khác; package này không phải tiền lệ cho SQL
  động ở chỗ khác. Muốn thêm chỗ thứ hai thì cần ADR mới.

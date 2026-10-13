# Documents — Phụ lục: Thư mục nhiều cấp (UNI-1425)

> **Trạng thái:** in-progress — hợp đồng v1.0 (đóng băng), 2026-10-13 — FD-D1..FD-D10 đã ký (FD-D2..FD-D10 ký ~19:05 UTC+7 đúng các khuyến nghị của decision packet `reports/plan-folders/decision-packet.md`, trạng thái signed); §4 là hợp đồng, đổi §4 chỉ qua `decision_required` của Advisor. Lịch sử: v0.1 soạn theo yêu cầu người dùng (~15:35 UTC+7: thêm spec + plan cho UNI-1425 theo cách đã làm với G8/UNI-1331); v0.2 xử lý review FE r1 + BE r1 (`reports/plan-folders/review-{fe,be}-1.md`, bản đối chiếu `reports/plan-folders/fix-r1.md` của Run); v0.3 review delta r2 (trần hàng thật cho CTE lưu trữ, `RepeatableRead` cho `archive-impact`, gate G8-17, dòng S18 của spine G8); v1.0 FD-01 (UNI-1461): ký FD-D2..FD-D10, §4 đóng băng, bỏ nhánh (b)/(c) của FD-D10 ở §3.8, gate G8-17 đóng.

**Issue:** UNI-1425 "Quản lý Folder trong Documents" (FR-01..FR-09, BR-01..BR-10, AC-01..AC-12), cha UNI-923 (FD-D1).
**Quan hệ với thiết kế có sẵn:** Documents C-01 (cây trang, UNI-675) và thư mục `kind=folder` (migration
`9991791776514761_documents_kind_folder`). Phụ lục này **mở rộng** mô hình đó, không thay: một bảng `documents`, quan hệ cha bằng
`parent_id`, không bảng thư mục riêng. Khi phụ lục lệch `CLAUDE.md` hoặc một ADR, `CLAUDE.md`/ADR thắng.
**Plan:** [plan G5-G7](../plans/2026-10-12-office-g5-g6-g7.md) **plan §5.8 E6** (12 thẻ FD-01..FD-12, lane L25..L28, wave
W3..W7; v2.10). **Bằng chứng hiện trạng:** `reports/plan-folders/gap-analysis.md` của Run (mọi dữ kiện có `file:line`).

## 1. Kết quả sản phẩm

Người dùng tổ chức tài liệu trong cây thư mục nhiều cấp: thấy cây ở mục FOLDERS của sidebar, mở/thu từng nhánh, mở một thư mục
bằng URL riêng (cây tự mở tới nó), thấy thư mục con và tài liệu trực tiếp (thư mục trước, sắp theo tên hoặc thời gian), tạo thư
mục ở gốc, trong thư mục con và từ vùng nội dung, đổi tên, di chuyển, xóa có cảnh báo đủ số thư mục con và tài liệu bị ảnh hưởng.
Hai thư mục cùng cha không trùng tên; khi di chuyển vào nơi đã có tên đó, đối tượng được tự đổi tên "Tên (n)" và người dùng được
báo tên mới. Một ô tìm kiếm trả cả thư mục và tài liệu, lọc được Tất cả / Thư mục / Tài liệu, mỗi kết quả kèm đường dẫn. Thay đổi
của người khác (tạo, đổi tên, di chuyển, xóa, khôi phục) hiện ở cây và nội dung mà không cần tải lại trang. FROM ELSEWHERE giữ
nguyên.

## 2. Quyết định

Nguồn câu hỏi và lựa chọn: decision packet. Bảng này là giá trị phụ lục và plan dùng; FD-D2..FD-D10 người dùng đã ký đúng các
giá trị bên dưới (2026-10-13 ~19:05 UTC+7).

| ID | Câu hỏi | Giá trị | Thẻ bị chặn |
| --- | --- | --- | --- |
| FD-D1 | Vào phase UNI-923 hay phase riêng? | **Đã ký 2026-10-13 (qua Advisor): gộp vào UNI-923 thành epic E6** (plan G5-G7 §5.8, mốc P2, wave W3..W7, lane L25..L28) | — |
| FD-D2 | Trần độ sâu | Đã ký 2026-10-13 ~19:05: **20 cấp** (một hằng chung cho thư mục, trang, tệp; trần bảo vệ, không phải "vô hạn") | FD-03, FD-07 |
| FD-D3 | Độ dài tên | Đã ký 2026-10-13 ~19:05: **255 ký tự cho thư mục** (tạo và đổi tên); tài liệu giữ 500; thư mục cũ dài hơn giữ nguyên tới lần đổi tên sau (tự đổi tên "(n)" cũng là một lần đổi tên, §3.3) | FD-02 |
| FD-D4 | Trùng tên thư mục cùng cha | Đã ký 2026-10-13 ~19:05: **không phân biệt hoa thường, phân biệt dấu** ("Hợp đồng" = "HỢP ĐỒNG", ≠ "Hop dong"); khóa so là khóa chuẩn §3.3; chỉ thư mục chưa lưu trữ, cùng workspace, cùng cha (gốc là một cha); thư mục trùng có sẵn: migration đổi tên bản mới hơn thành "Tên (2)", "Tên (3)" | FD-02 |
| FD-D5 | Trùng khi tạo/đổi tên vs khi di chuyển/khôi phục | Đã ký 2026-10-13 ~19:05: **thư mục — tạo/đổi tên: từ chối** 409 `folder_name_taken`, lỗi tại trường. **Di chuyển (thư mục và tài liệu) và khôi phục: tự đổi tên** "Tên (n)", n nhỏ nhất ≥ 2 còn trống, báo tên mới | FD-02, FD-08, FD-09 |
| FD-D6 | Xóa | Đã ký 2026-10-13 ~19:05: **giữ lưu trữ** (thùng rác, khôi phục 30 ngày, worker xóa thật sau đó); chữ trên UI là "Xóa" / "Chuyển vào thùng rác"; cảnh báo ghi **riêng** số thư mục con và số tài liệu, đếm ở server | FD-04, FD-09 |
| FD-D7 | Phạm vi tìm kiếm | Đã ký 2026-10-13 ~19:05: **workspace đang mở**, khớp **theo tên** trong ô tìm của Documents (bảng lệnh ⌘K giữ tìm cả nội dung); mọi tài liệu người dùng đọc được trong workspace đó. Thu hẹp FR-08 ("toàn bộ Document được phân quyền") là đổi phạm vi, chỉ đạt khi ký | FD-05, FD-10 |
| FD-D8 | Desktop cùng phase? | Đã ký 2026-10-13 ~19:05: **hoãn** duyệt thư mục trong hộp thoại UniWork của app (FD-11 làm sau) | FD-11 |
| FD-D9 | Trang Documents gốc (không `?folder`) | Đã ký 2026-10-13 ~19:05: **giữ thư viện hiện tại** (gần đây, nhóm theo thư mục); "nội dung trực tiếp" + thư mục trước + sắp xếp chỉ áp khi mở một thư mục; thư mục gốc thấy ở sidebar | FD-08 |
| FD-D10 | Trùng tên **tài liệu** (trang/tệp) khi tạo, tải lên, đổi tên — gồm G8-17/S18 | Đã ký 2026-10-13 ~19:05: **cho phép trùng** (server không bao giờ trả `folder_name_taken` cho trang/tệp); G8-17 bỏ ca "tên trùng → lỗi tại trường" cho tài liệu, giữ "rỗng/quá dài"; "(n)" chỉ khi di chuyển/khôi phục; dòng S18 của EXPERIENCE-G8 và mockup đã sửa trong FD-01 (§3.8) | FD-02 (G8-17 hết gate) |

## 3. Thiết kế

### 3.1 Mô hình (không bảng mới)

- Thư mục = hàng `documents` có `kind = 'folder'`; không nội dung, không version, không blob (`9991791776514761`). Luật đặt chỗ giữ
  nguyên: thư mục ở gốc hoặc trong thư mục; trang và tệp ở thư mục hoặc trong trang (`document_types.go:41-46`). "Document" của SRS
  = trang hoặc tệp. Trang con trong trang là việc của trang: không hiện ở cây FOLDERS, không tính là "nội dung trực tiếp" của thư
  mục, nhưng tính vào độ sâu và vào số đếm khi xóa.
- Không thêm cột. Tên duy nhất dùng một index unique theo biểu thức (§3.3). Không FK, không cascade (CLAUDE.md); cây con xử lý ở
  service trong một transaction như hiện nay (`ListLiveDocumentSubtreeIDs`, `ArchiveDocumentBatch`).
- Tenant: bảng đã có `organization_id NOT NULL`, `created_by_kind`; query mới mang `workspace_id = $n` hoặc dòng `-- tenant:`
  (`TestEveryQueryNamesItsTenant`). Workspace id là ULID nên khóa index không cần thêm `organization_id`. Membership chỉ qua
  `RequireMember`/`authorize()` có sẵn.

### 3.2 Độ sâu (FD-D2)

- Một hằng `maxDocumentDepth` (20, FD-D2 đã ký) ở `server/internal/service/document_pages.go`; mọi chỗ đang suy từ 5 đọc
  hằng này: kiểm khi tạo (`lockPageParent`), kiểm khi di chuyển (độ sâu đích + chiều cao cây con), vòng lặp tổ tiên
  (`2*maxDocumentDepth`), cắt cây ở API `tree`.
- **Ba** CTE cây con trong `server/pkg/db/queries/document_tree.sql` đang cứng `sub.lvl < 10` và cùng đổi thành tham số
  `sqlc.arg(max_level)` = `2*maxDocumentDepth`: `ListDocumentSubtree` (`:13-30`, di chuyển), `ListLiveDocumentSubtreeIDs`
  (`:202-222`, lưu trữ + số đếm) và `ListDocumentSubtreeNeedingAccessCheck` (`:232-250`, cổng `manage` của lưu trữ). Mọi caller
  (`document_tree.go`, `document_lifecycle.go:83-103,214-235`) truyền cùng một giá trị từ một hàm Go. Thiếu một trong ba thì cây
  11..20 cấp bị lưu trữ cụt (con sâu còn sống dưới cha đã lưu trữ) và cổng quyền bỏ sót nút sâu.
- Mỗi CTE giữ chặn vòng (mức tối đa `max_level`) như hiện nay.
- **Trần hàng thật cho hai CTE lưu trữ (r2).** Hôm nay `ListLiveDocumentSubtreeIDs` sinh **toàn bộ** cây con rồi mới `ORDER BY d.id
  LIMIT max_rows` (`:217-222`), nên LIMIT không chặn chi phí; `lvl < 10` chỉ chặn chiều sâu. Đổi 10 → 40 làm chi phí tỉ lệ kích thước cây.
  FD-03 viết lại câu này để bước đi cây **dừng sau `archiveBound()+1` hàng sống**: `UNION ALL`, lọc `archived_at IS NULL` ở câu
  ngoài bằng join theo khóa chính, **không `ORDER BY` trước `LIMIT`** (Postgres chỉ tính các hàng của CTE đệ quy mà câu ngoài thật sự
  lấy; `ORDER BY` buộc tính hết), id sắp lại ở Go khi cần thứ tự ổn định. `max_level` giữ làm trần chiều sâu và chặn vòng. Nút đã lưu
  trữ trên đường đi vẫn được đi qua (để thấy con sống của nó) nhưng không tính vào trần; số đó bị chặn bởi worker xóa thật 30 ngày.
  `ListDocumentSubtreeNeedingAccessCheck` không đi cây lần hai: nó nhận đúng tập id đã giới hạn (`id = ANY(sqlc.arg(ids))`), nên chỉ
  chạy trên ≤ `archiveBound()` hàng. Nếu EXPLAIN của FD-03 không cho thấy dừng sớm (hàng đọc ~ `archiveBound()+1`, không ~ N), FD-03
  dừng và hỏi Advisor, không lặng lẽ chấp nhận duyệt toàn cây. `ListDocumentSubtree` (di chuyển) giữ lớp chi phí như hôm nay: chặn
  chiều sâu bằng `max_level`, không trần hàng (đổi luật di chuyển cây lớn là ngoài UNI-1425).
- Client không lặp số: `TREE_MAX_LEVEL` đọc từ một hằng duy nhất ở `packages/core/documents/` (chép giá trị hợp đồng FD-01, có test
  so với hằng server qua contract), chuỗi `documents.tree.too_deep` nhận `{{max}}`.
- API cây thêm `?folders_only=true` (sidebar chỉ cần thư mục; giảm payload khi sâu 20 cấp). Không đổi hình dạng node.

### 3.3 Tên (FD-D3, FD-D4, FD-D5, FD-D10)

**Một hàm chuẩn hóa cho mọi đường ghi tiêu đề.** `normalizeDocumentTitle(kind, raw)` = `strings.TrimSpace` + `norm.NFC` + trần
theo loại (thư mục 255 rune, trang/tệp 500), rỗng → 400. Mọi đường ghi tiêu đề vào `documents` gọi nó: tạo trang
(`cleanDocumentTitle`, `document_pages.go:101-110`), tạo tệp và tệp trống (`CreateFileDocument` đang tự TrimSpace,
`document_files.go:318-328`), sao chép (`copyTitle`, `document_copy.go:256-261`), chuyển đổi định dạng, lưu nguồn đổi tên, đổi tên
(PATCH), tự đổi tên khi di chuyển/khôi phục. FD-02 liệt kê từng hàm trong PR và có test "đường ghi không qua helper" (grep trong test).

**Khóa trùng (canonical key).** Khóa = `lower(title COLLATE "und-x-icu")` trên tiêu đề **đã NFC**; một biểu thức SQL duy nhất dùng
ở index, ở query kiểm trước, ở bộ cấp hậu tố và ở migration dọn trùng — Go không tự lowercase. Lý do chọn collation tường minh:
`lower()` theo collation mặc định phụ thuộc `LC_CTYPE` của cluster (cluster `C` chỉ hạ chữ ASCII, "HỢP ĐỒNG" không về "hợp đồng").
FD-02 kiểm `und-x-icu` có trên Postgres CI (`postgres:16`) và trên DB đích (`SELECT 1 FROM pg_collation WHERE collname =
'und-x-icu'`); nếu một đích không có ICU, FD-02 dừng và hỏi Advisor, không lặng lẽ dùng `lower(title)`. Không gấp dấu
(`uw_fold_search` **không** dùng cho khóa trùng: "Ma"/"Mã"/"Mà" là ba từ khác nhau).

**Ràng buộc DB.** `CREATE UNIQUE INDEX CONCURRENTLY idx_documents_folder_name_uidx ON documents (workspace_id,
COALESCE(parent_id, ''), lower(title COLLATE "und-x-icu")) WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL` —
một câu, một file. Trang/tệp không có ràng buộc trùng (FD-D10).

**Dọn dữ liệu cũ (migration dữ liệu, chạy trước index).** (1) Chuẩn hóa NFC mọi tiêu đề thư mục chưa NFC (`normalize(title, NFC)`,
DB UTF8). (2) Trong mỗi nhóm thư mục sống trùng khóa, hàng tạo sớm nhất giữ tên, các hàng sau nhận "Tên (n)" theo
`created_at, id`, n bỏ qua mọi số đã có trong nhóm cùng cha (kể cả "A (2)" có sẵn). Migration idempotent (chạy lại không đổi gì),
không ghi audit (không phải command người dùng); ghi chú phát hành liệt kê số hàng bị đổi. Thư mục **đã lưu trữ** không bị dọn:
lúc khôi phục, luật khôi phục bên dưới xử lý.

**Thứ tự phát hành (hai PR cùng key FD-02).** Runner migration bỏ qua file đã ghi `schema_migrations` (`server/migrations/embed.go:460-482`),
nên "drop index INVALID rồi chạy lại" không tự chạy lại bước dọn. Vì vậy: **PR 1** = helper chuẩn hóa + kiểm trùng trong service
dưới khóa cây (dưới đây) + migration dọn trùng; **PR 2** = file index, chỉ merge sau khi binary của PR 1 đã chạy trên mọi môi
trường (binary đó không còn tạo bản trùng). Runbook `docs/runbooks/documents-folder-name-index.md`: kiểm `pg_index.indisvalid`;
nếu INVALID → chạy lại câu dọn trùng (chép nguyên văn trong runbook, idempotent) → `DROP INDEX CONCURRENTLY` → khởi động lại để
runner chạy lại file index (file index lỗi chưa được ghi `schema_migrations`).

**Tuần tự hóa người ghi.** Mọi lệnh có thể đặt tên một thư mục vào một cha — tạo thư mục, đổi tên thư mục, di chuyển, khôi phục —
lấy khóa cây của workspace (`LockDocumentTree`) **trước** mọi khóa hàng, đúng thứ tự khóa hiện có của move/restore
(`document_tree.go:55-100`, `document_lifecycle.go:449-452`). Đổi tên hiện chỉ khóa hàng (`withDocumentMutation`,
`document_pages.go:575`): với PATCH có `title` trên `kind=folder`, service đọc workspace của tài liệu (không khóa), lấy khóa cây,
rồi mới vào `withDocumentMutation` và kiểm lại `kind`/revision; không bao giờ lấy khóa cây sau khóa hàng (tránh deadlock với move).
Đổi tên trang/tệp không lấy khóa cây (FD-D10: tài liệu được trùng). Hệ quả: kiểm trùng và chọn "(n)" của thư mục chạy tuần tự,
`23505` chỉ còn là lưới an toàn.

**Lưới an toàn `23505`.** Mỗi lần thử ghi tiêu đề có thể va index chạy trong một **SAVEPOINT** (pgx `tx.Begin` lồng); gặp `23505`
của `idx_documents_folder_name_uidx` → `ROLLBACK TO SAVEPOINT`, tính lại n bằng cách **đọc lại** tập tên đang chiếm trong đích tại thời điểm thử lại (query mới, không dùng
kết quả đã đọc trong transaction), thử lại, tối đa 3 lần; hết lần → cả lệnh rollback và
trả 409 `folder_name_taken`, không audit, không outbox, câu trả lời idempotency không ghi. Không statement nào chạy tiếp sau lỗi
mà không quay về savepoint (tránh `25P02`). Với tạo/đổi tên, `23505` → 409 ngay (không đổi tên hộ).

**Tạo / đổi tên thư mục trùng** → 409 `folder_name_taken` (mã mới trong `error_class.go`), `details` không chứa id hay tên của thư
mục kia (có thể là thư mục người gọi không đọc được).

**Di chuyển.** Đích đã có **thư mục** cùng khóa (khi di chuyển thư mục) hoặc **tài liệu** cùng khóa và cùng `kind` (khi di chuyển
trang/tệp) → service đặt tiêu đề "Tên (n)" trong cùng transaction với `MoveDocument`: n nhỏ nhất ≥ 2 chưa dùng trong đích; với
tệp, hậu tố chèn trước phần mở rộng cuối ("Báo cáo (2).docx"). Audit `document.moved` ghi diff `parent_id`, `position` **và**
`title` khi đổi; outbox vẫn `document.moved` (payload chỉ id). SDO của move trả tài liệu sau khi đổi, client đọc `title` mới để báo.

**Trần độ dài của tên sinh ra.** Nếu "Tên (n)" vượt trần của loại (255 thư mục, 500 tài liệu), cắt phần tên gốc theo rune (với tệp:
cắt trước phần mở rộng, giữ phần mở rộng) cho vừa, không bao giờ cắt hậu tố; thư mục cũ dài hơn 255 khi bị tự đổi tên cũng cắt về
255 (tự đổi tên là một lần đổi tên, FD-D3). Cắt không tách cặp surrogate/ký tự tổ hợp (cắt trên chuỗi đã NFC, theo rune, bỏ dấu
tổ hợp treo ở cuối).

**Mọi lần đổi tiêu đề** (đổi tên, tự đổi tên) cập nhật `title` + `search_text` (`documentSearchText`, `document_types.go:162`) +
`revision` trong cùng transaction; không tăng `content_revision` (metadata, G5 `contentBaseCurrent` không coi là xung đột nội dung).

**Khôi phục (`RestoreDocument`).** Dưới khóa cây hiện có (`document_lifecycle.go:449`), **trước** khi xóa `archived_at`:
1. Tính cha cuối cho mọi thành viên batch sẽ thành mục trong một cha sống: gốc batch (về cha cũ, hoặc về gốc khi cha đã mất/đã lưu
   trữ) và mọi thành viên mồ côi sẽ tách về gốc (`DetachDocumentToRoot`, `:330-358`).
2. Cấp tên cuối theo thứ tự ổn định (`parent cuối, position, created_at, id`): so với các mục sống của cha cuối **và** với tên đã cấp
   cho thành viên khác của cùng batch (gồm cặp trùng nội bộ có sẵn trong batch cũ), theo luật "(n)" + trần ở trên.
3. Ghi `parent_id`/`title` mới lên các hàng **khi còn lưu trữ** (`UPDATE … WHERE archived_at IS NOT NULL`, index không áp), rồi mới
   chạy `ClearDocumentArchiveBatch`/`RestoreSingleDocument` — lúc index áp, tên đã sạch.
4. Audit `document.restored` cho từng thành viên mang diff `title`/`parent_id` của chính nó; tất cả hoặc không gì.

**Sao chép:** nếu route copy nhận thư mục, tiêu đề "(bản sao)" vẫn đi qua luật "(n)" + trần (FD-02 kiểm và ghi kết quả).

### 3.4 Xóa (FD-D6)

- Ngữ nghĩa giữ nguyên: lưu trữ cả cây một batch, cần `manage` trên mọi nút, trần 1000 nút (gồm gốc) → `folder_too_large`, khôi
  phục theo batch, worker xóa thật sau 30 ngày. Không thêm xóa cứng.
- Route mới `GET /documents/{documentID}/archive-impact`, cùng thứ tự kiểm với lệnh lưu trữ để không đắt hơn và không lộ hơn lệnh
  đó: (1) quyền `manage` trên gốc qua `authorize()` (không đủ → cùng 403/404 của lệnh lưu trữ); (2) `ListLiveDocumentSubtreeIDs`
  với trần hàng `archiveBound()+1` dừng sớm (§3.2) — quá trần → `{too_large: true, max_nodes: 1000}`, không đếm, không đi kiểm quyền từng nút
  (lệnh lưu trữ cũng từ chối quá trần trước kiểm quyền, nên không lộ thêm); (3) `requireManageOnSubtree` trên đúng tập id đó →
  thiếu một nút → cùng 403 (web: `documents.archive.archive_forbidden`), thân không có số; (4) đếm theo `kind` trên đúng tập id
  đó. Cả (2)–(4) chạy trong **một** transaction `pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}` (như
  `document_comments.go:306`), nên id, quyền và số đến từ một snapshot; dưới `Read Committed` mỗi câu có snapshot riêng và lời hứa này
  không đúng.
- Kết quả: `{folders, documents, total, max_nodes, too_large}`; `folders`/`documents` **không** gồm gốc (gồm trang con trong
  trang); `total` = số hàng lệnh lưu trữ sẽ ghi, **gồm** gốc; chính xác khi ≤ `max_nodes`. Không ghi audit (đọc). Route có
  `{documentID}` (đã có `pathParamSDI`) nên `TestIsolationMatrix` phủ ngay; kèm control (chủ tenant gọi được).
- Chi phí: bước đi cây dừng sau `archiveBound()+1` hàng sống (§3.2, cùng câu với lệnh lưu trữ); kiểm quyền chạy trên tập id đó. FD-04 đo EXPLAIN/latency trên cây rộng (1000 con trực
  tiếp) và sâu (20 cấp).
- UI: hộp thoại "Xóa thư mục" ghi "N thư mục con và M tài liệu sẽ chuyển vào thùng rác, khôi phục được trong 30 ngày"; xác nhận bị
  khóa tới khi số về; `too_large` → thông báo `folder_too_large` thay nút xác nhận.

### 3.5 Tìm kiếm (FD-D7)

- Route có sẵn `GET /workspaces/{workspaceID}/documents?q=` thêm: `kind=document` (= mọi loại trừ `folder`; `kind=folder` đã có),
  `match=title` (so `uw_fold_search(title)` thay vì `search_text`, để "hop dong" thấy "Hợp đồng"), và mỗi hàng kết quả thêm
  `path: [{id, title}]` (từ gốc tới cha trực tiếp). Handler `documentListInput` (`server/internal/handler/document_collections.go:25-40`)
  parse `match`; mapper SDO đưa `path` vào phản hồi. Không `match` → hành vi cũ (client cũ không đổi).
- **Index:** index GIN hiện có chỉ trên `search_text` (`981_documents_search_idx.up.sql`); FD-05 thêm một migration riêng một câu
  `CREATE INDEX CONCURRENTLY idx_documents_title_fold ON documents USING gin (uw_fold_search(title) gin_trgm_ops) WHERE archived_at IS NULL`
  (`uw_fold_search` đã IMMUTABLE), và test EXPLAIN dùng index ở bảng lớn.
- Quyền lọc **trước** LIMIT (cổng hiện có của list), giữ escape LIKE (`escapeLikeQuery`). `path` tính một lần cho cả trang kết quả:
  CTE đi lên theo `parent_id` có `workspace_id = $n` ở cả anchor và bước đệ quy (tổ tiên lạ tenant không bao giờ được nối), chặn
  mức `2*maxDocumentDepth` + chặn vòng; quyền đọc tổ tiên kiểm theo lô (một query cho mọi tổ tiên của trang kết quả, không N+1) và
  `path` **cắt ở tổ tiên đầu tiên người gọi không đọc được**, đúng luật `documentBreadcrumbs` (`document_pages.go:494-519`).
  Trường mới tùy chọn trong SDO; client schema lenient.
- Phạm vi: workspace đang mở, mọi tài liệu người gọi đọc được. Tìm toàn tổ chức: hoãn (§6).

### 3.6 Web

- **URL thư mục là nguồn sự thật duy nhất.** `DocumentsPageView` bỏ `useState` của `folderId` (`documents-page-view.tsx:62`) và
  đọc `useNavigation().searchParams.get("folder")` (adapter có `searchParams`, `packages/views/navigation/types.ts:7-18`; views không
  import `next/*`). Mọi lần đổi thư mục — `goHome`, bấm cây, breadcrumb, kết quả tìm, ⌘K, mở từ hàng — đi qua
  `push(paths…documentsFolder(id))` (về gốc: `push(paths…documents())`), nên Back/Forward đúng. `paths.documentsFolder(id)` là
  builder query-string trên route `documents` có sẵn, không phải trang mới; FD-06 ghi rõ và giữ `consistency.test.ts` xanh (không
  thêm trang Next.js). `apps/web/.../documents/page.tsx` không đổi.
- **`?folder` không dùng được** (không tồn tại, đã lưu trữ, không có quyền, không phải thư mục, khác workspace) → `CollectionPageState`
  lỗi với liên kết về Documents gốc, không danh sách trống; không phân biệt các trường hợp (không lộ tồn tại).
- **Tự mở tổ tiên.** Tập mở = id từ `useDocument(folder).breadcrumbs` (đã tải cho breadcrumb), **gộp** vào `expanded` (không thay — giữ
  nhánh người dùng đã mở), chỉ một lần cho mỗi giá trị `?folder`; cuộn hàng vào tầm nhìn sau khi hàng render. Breadcrumb bị cắt bởi
  tổ tiên không đọc được → mở phần biết được, không lỗi. Người dùng thu một tổ tiên sau khi vào → giữ thu (không mở lại khi refetch).
- **Sidebar FOLDERS:** (+) luôn tạo ở gốc, hộp thoại ghi "Thư mục mới ở Documents (gốc)"; mỗi hàng có nút (...) hiện khi hover
  **và** focus, luôn hiện trên con trỏ thô (≥ 44px), nằm trong mô hình roving focus của hàng; chuột phải và Shift+F10 / phím Menu
  mở cùng menu; `aria-keyshortcuts` của hàng (`document-tree.tsx:91`) cập nhật. Mục: Mở, Thư mục con mới, Đổi tên, Di chuyển tới…,
  Xóa — theo quyền (`canEditDocument`, `manage` cho xóa). Kéo-thả giữ nguyên, thêm toast khi bị chặn vì vòng (hiện im lặng,
  `document-tree.tsx:249`). `document-tree.tsx` đã 429 dòng tính: tách `document-tree-row-menu.tsx` và `use-tree-reveal.ts`
  (trần `max-lines` 500).
- **Vùng nội dung thư mục** (khi có `?folder`; trang gốc theo FD-D9): "Mới → Thư mục" tạo trong thư mục đang mở; thư mục luôn đứng
  trước; sắp theo Tên (A→Z, `Intl.Collator('vi')`) hoặc Cập nhật (mới nhất), lựa chọn nhớ theo người xem qua StorageAdapter, **một
  khóa cho mọi thư mục** (không theo từng thư mục); thêm cột Loại; menu hàng thêm "Thư mục con mới" (với thư mục) và "Đổi tên". Tạo và
  đổi tên dùng hộp thoại có trường tên (trần 255 cho thư mục, lỗi trùng tại trường). Header theo luật shell: `CollectionPageHeader` +
  `CollectionPageState` (đã có). Nội dung lấy bằng list `?parent_id=` có sẵn (`document_collections.go`).
- **Di chuyển tới…:** picker dạng cây thu/mở được (dùng lại `document-tree-model.ts`), có **Documents (gốc)** làm đích (FR-05 gốc ↔
  con); vị trí hiện tại, cây con của chính nó và đích quá sâu (hằng chung) hiện nhưng vô hiệu bằng `aria-disabled` (vẫn focus được,
  đúng hợp đồng nút của CLAUDE.md) kèm **lý do hiện chữ** dưới tên (tooltip không đủ trên cảm ứng); xác nhận → toast "Đã chuyển tới
  {{folder}}" hoặc "Đã chuyển và đổi tên thành {{title}}".
- **Breadcrumb:** quá 4 cấp → giữ gốc, cha trực tiếp và lá, gộp các cấp giữa vào nút "…" mở menu các cấp ẩn (bàn phím được).
- **Hộp thoại xóa:** query `archive-impact` chỉ chạy khi hộp thoại mở (`enabled: open`), `staleTime: 0`, khóa
  `[...documentKeys.workspace(wsId), "archive-impact", id]` (nằm dưới khóa workspace nên invalidation realtime §3.7 phủ); skeleton tới
  khi có số; `too_large` thay nút xác nhận; 403 → thông điệp quyền.
- **Tìm kiếm:** ô tìm nằm trong vùng actions của `CollectionPageHeader`, xuống hàng riêng dưới header ở bề ngang hẹp; gõ ≥ 1 ký tự
  (debounce, bỏ qua khi `isComposing`) chuyển vùng nội dung sang chế độ kết quả, Esc hoặc xóa ô trả lại thư mục đang mở; chip
  Tất cả / Thư mục / Tài liệu là toggle group một lựa chọn (`radiogroup`, mũi tên trái/phải); hàng kết quả: icon loại, tên, đường dẫn
  cắt từ bên trái ("… › Cha › ") với đường dẫn đủ trong `title` và chữ cho trình đọc màn hình; rỗng và lỗi qua `CollectionPageState`.
  Enter trên thư mục → URL thư mục, trên tài liệu → trang tài liệu. Hook: mở rộng `ListDocumentsOpts`
  (`packages/core/api/endpoints/documents-collections.ts:27`) thêm `kind: "document"` và `match`, dùng `useDocumentList`
  (`hooks-collections.ts:39`) — không thêm hook song song.
- **Thông báo kết quả** (SRS §4): toast cho tạo, đổi tên, di chuyển, xóa (chuyển vào thùng rác), khôi phục.
- **Chuỗi:** mọi chuỗi qua `t()` (`i18next/no-literal-string`), khóa vi/en trong `packages/core/i18n/locales/{vi,en}.json`, dùng lại
  khóa `"folder": "Thư mục"` có sẵn, không lặp; en có `_one/_other` cho cả hai số đếm của cảnh báo xóa (vi không số nhiều). FD-01
  thêm vào bảng thuật ngữ `docs/conventions.md`: Folder = Thư mục, Subfolder = Thư mục con, New folder = Thư mục mới, Rename = Đổi
  tên, Move to = Di chuyển tới, Trash = Thùng rác, Path = Đường dẫn. Icon theo `docs/conventions.md` › Icons. Không token màu mới.
- **A11y:** cây giữ vai trò tree/treeitem; hộp thoại có focus trap của primitive; touch target ≥ 44px; `jsx-a11y`.

### 3.7 Realtime, audit, log

- Không sự kiện mới: `document.created`, `document.updated`, `document.moved`, `document.archived`, `document.restored` đã có trong
  ba bản catalogue (`packages/core/types/events.ts:68-70`, `docs/events/CATALOGUE.md:161`), payload chỉ id.
- **Client chưa tiêu thụ ba sự kiện cây:** `use-realtime-sync.ts:312-318` chỉ invalidate `documentKeys.workspace` cho created/updated/…;
  `document.moved`/`archived`/`restored` rơi vào `default: break` (`:366`), nên di chuyển/xóa/khôi phục của người khác không làm mới
  cây, nội dung thư mục, kết quả tìm. FD-06 thêm ba case vào nhánh invalidate khóa workspace (test trong `use-realtime-sync.test.tsx`);
  không patch cache (ADR 0015 chỉ cho `task.updated`). Tự đổi tên khi di chuyển đến client qua `document.moved` → refetch.
- Mọi command đổi trạng thái đi qua `audit.Recorder` cùng transaction như hiện nay; không thêm action audit (đổi tên khi di chuyển/khôi
  phục ghi trong diff của `document.moved`/`document.restored`).
- Log chỉ id (không tiêu đề thư mục — tiêu đề có thể chứa tên người/khách hàng), `scripts/no-pii-log.test.mjs`.

### 3.8 Desktop (FD-D8) và G8-17

Hoãn duyệt: hộp thoại UniWork của app vẫn chỉ tệp (`client.ts:230`, `parse.ts:127`). Khi làm (FD-11, lane L23 sau G8-17): bỏ
`kind=file`, duyệt theo `parent_id` + breadcrumb, hiện đường dẫn trong kết quả tìm (trường `path` của §3.5), tạo tài liệu vào thư
mục đang mở. Không đổi frame protocol.

G8-17 (tạo/tải lên/đổi tên tài liệu từ app) **không** là người dùng `folder_name_taken`: G8-17 chỉ ghi trang/tệp, và theo FD-D10 (a, đã ký)
server cho trùng tên tài liệu. Hợp đồng chéo (plan G5-G7 thẻ G8-17, không còn gate): tên rỗng → lỗi tại trường (`uwDocNameEmpty`), quá 500 → lỗi tại trường (`uwDocNameTooLong`, khóa đã ship ở G8-17); tên trùng tài
liệu khác → được. **Spine:** EXPERIENCE-G8 S18 và mockup `account-library.html` đã sửa trong FD-01 (bỏ ca "tên trùng → lỗi tại
trường" cho tài liệu, bỏ hai khung mockup S18 "tên trùng", khóa `uwDocNameTaken` ghi "không dùng cho tài liệu"). Tài liệu đang mở bị
tự đổi tên do di chuyển ở web → tiêu đề desktop đổi theo `document.moved` của feed G5 hoặc làm mới metadata khi focus, và Lưu sau đó
không thành xung đột nội dung (§3.3, không tăng `content_revision`).

## 4. Hợp đồng v1.0 (đóng băng; không có file hợp đồng riêng)

| Mục | Giá trị |
| --- | --- |
| Mã lỗi mới | `folder_name_taken` 409 (tạo, đổi tên thư mục; di chuyển/khôi phục chỉ khi hết 3 lần thử "(n)"); không bao giờ cho trang/tệp |
| Mã lỗi dùng lại | `document_too_deep` 422, `document_cycle` 422, `document_parent_kind` 422, `folder_too_large` 422, 403 forbidden của `requireManageOnSubtree` (client: `documents.archive.archive_forbidden`) |
| Route mới | `GET /documents/{documentID}/archive-impact` → `DocumentArchiveImpactSDO{folders, documents, total, max_nodes, too_large}` (§3.4) |
| Tham số mới | list: `kind=document`, `match=title`; tree: `folders_only` |
| Trường SDO mới | `DocumentSummaryDTO.path[]` `{id, title}` (tùy chọn) |
| Hằng | `maxDocumentDepth` (FD-D2), CTE `max_level = 2*maxDocumentDepth`, trần tên thư mục 255 / tài liệu 500 (FD-D3), 3 lần thử "(n)" |
| Khóa trùng | `lower(title COLLATE "und-x-icu")` trên tiêu đề NFC; thư mục sống, cùng workspace, cùng `COALESCE(parent_id,'')` |
| Luật hậu tố | "Tên (n)"; tệp: trước phần mở rộng cuối; n nhỏ nhất ≥ 2 còn trống trong đích; cắt tên gốc cho vừa trần, không cắt hậu tố |
| Khóa | Lệnh đặt tên thư mục vào cha: `LockDocumentTree` trước khóa hàng; ghi tên trong SAVEPOINT |
| URL | `/{org}/{ws}/documents?folder=<id>` (nguồn sự thật của thư mục đang mở) |
| Realtime | client invalidate khóa workspace cho `document.moved`, `document.archived`, `document.restored` |

## 5. Ma trận FR/BR/AC → thẻ

| Yêu cầu | Thẻ |
| --- | --- |
| FR-01, AC-02, AC-03 | FD-03 (cây sâu, `folders_only`), FD-07 (sidebar), FD-08 (nội dung) |
| FR-02, AC-01 | FD-02 (tên), FD-03 (độ sâu), FD-07 ((+) gốc, thư mục con mới), FD-08 (Mới → Thư mục) |
| FR-03, AC-04, AC-12, BR-09 | FD-02 (đổi tên trùng), FD-04 (số đếm), FD-07/FD-08 (menu), FD-09 (cảnh báo) |
| FR-04, AC-07 | FD-02 ("(n)" tài liệu), FD-09 (picker, vị trí hiện tại) |
| FR-05, AC-05, AC-06, BR-05 | FD-02 ("(n)" thư mục, khôi phục), FD-03 (độ sâu), FD-07 (kéo-thả), FD-09 (picker, gốc là đích) |
| FR-06, AC-08 | FD-06 (builder URL, realtime), FD-07 (URL là nguồn sự thật, tự mở cha, cuộn), FD-09 (breadcrumb rút gọn) |
| FR-07 | FD-08 (FD-D9) |
| FR-08, AC-09 | FD-05 (API, index), FD-06 (client), FD-10 (UI) — phạm vi workspace khi ký FD-D7 |
| FR-09, AC-10, BR-08, BR-10 | FD-12 (hồi quy; không cần code) |
| BR-01 | FD-03 |
| BR-02, BR-03, BR-04, BR-07 | Đã có; FD-12 khẳng định lại |
| BR-06, AC-11 | FD-02 (DB + service), FD-06, FD-08 |
| Mục 4 UX (thông báo kết quả, cuộn, không bắt tạo thư mục) | FD-07, FD-08, FD-09 |
| Thay đổi của người khác hiện ngay (cộng tác) | FD-06 (realtime), FD-12 (hai phiên) |
| Desktop parity | FD-11 (hoãn theo FD-D8) |

## 6. Hoãn (có lý do)

- **Tìm toàn tổ chức** (mọi workspace): route và URL của D theo workspace; tìm chéo workspace cần một route mới + cổng quyền
  theo nhiều workspace. Hoãn tới khi Product cần (FD-D7).
- **Duyệt thư mục trên desktop** (FD-11): không chặn web; G8-16/G8-17 đang sửa cùng file fork (lane L23).
- **Phân quyền thư mục, thừa kế quyền, chia sẻ chéo workspace**: SRS mục 6 ngoài phạm vi; giữ luật hiện tại (không thừa kế, chỉ
  chép `visibility` khi tạo).
- **Xóa cứng ngay**: giữ thùng rác 30 ngày (FD-D6).
- **Chọn nhiều + di chuyển hàng loạt**, kéo-thả từ vùng nội dung vào cây: SRS không yêu cầu.
- **Hỏi "Thay thế / Giữ cả hai" khi trùng**: SRS chọn mặc định đổi tên "(n)".

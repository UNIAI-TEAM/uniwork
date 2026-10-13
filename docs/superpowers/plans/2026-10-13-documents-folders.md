# Documents — Thư mục nhiều cấp (UNI-1425) — Plan

> **Trạng thái:** in-progress — plan v0.1 (bản nháp), 2026-10-13: 12 thẻ FD-01..FD-12, chờ review FE + BE của Advisor và chờ người dùng ký FD-D1..FD-D8. Chưa triển khai, chưa tạo sub-issue.

**Issue:** UNI-1425 "Quản lý Folder trong Documents". **Thiết kế:** [phụ lục thư mục](../specs/2026-10-13-documents-folders-addendum.md)
v0.1 (`§n` trong plan này trỏ vào phụ lục đó). **Hiện trạng:** `reports/plan-folders/gap-analysis.md` của Run G5-G7.
**Quyết định:** `reports/plan-folders/decision-packet.md` (FD-D1..FD-D8).

## 1. Cách đọc và hai cách dùng plan

Khuôn thẻ giống plan G5-G7 (`2026-10-12-office-g5-g6-g7.md` plan §5): dòng đầu **`<mã> <tên>`** — `Repo · Owner · Phụ thuộc ·
Wave` (+ `*hitl*`), rồi Đầu vào (khi cần), Sản phẩm, File, Test, AC, **Gate**. "AC" ghi mã AC của UNI-1425; "FR/BR" ghi yêu
cầu được thẻ đóng. Cỡ: S = 1, M = 2, L = 3 (cột "Cỡ" ở plan §3).

- **Phase riêng (khuyến nghị FD-D1):** plan này là plan của phase; UNI-1425 là issue cha; wave W0..W4 và lane L25..L28 như dưới;
  không nằm trong mốc P0–P3 của G5-G7.
- **Gộp vào UNI-923:** chép §2–§3 thành plan G5-G7 **§5.8 E6 — Thư mục Documents (UNI-1425)**; wave dời +3 (W0 → W3 … W4 → W7);
  lane giữ L25..L28; thêm FD-01..FD-12 vào mốc P2 (§6.5 plan G5-G7); dòng Migration của §6.3 plan G5-G7 nối hai migration FD-02 sau
  G8-07; dòng `openapi.go`/`router.go` thêm FD-04, FD-05; `audit_coverage_test.go`/`isolation_matrix_test.go` thêm FD-02, FD-04.

Repo: chỉ **D** (`UNIAI-TEAM/uniwork`), trừ FD-11 (**F**, hoãn). Luật repo áp mọi thẻ: plan G5-G7 §4 phần D (migration không FK,
index CONCURRENTLY một câu một file, `organization_id`, audit + outbox cùng transaction, SDI/SDO + `pathParamSDI`, isolation matrix,
malformed-response test, log không PII, `t()` + glossary, test cục bộ chỉ file bị ảnh hưởng, suite trên cloud runner).

## 2. Thẻ

**FD-01 Hợp đồng thư mục** — D (tài liệu) · Coordinator + Lead D · — · W0 · *hitl*
- Sản phẩm: ghi quyết định đã ký FD-D1..FD-D8 vào phụ lục §2 (cột "đã ký"); chốt phụ lục §4 thành hợp đồng v1.0 (mã
  `folder_name_taken`, route `archive-impact`, tham số `kind=document`/`match=title`/`folders_only`, trường `path[]`, hằng độ sâu và
  trần tên, luật hậu tố "(n)", URL `?folder=`); thêm thuật ngữ thư mục vào bảng vi–en của `docs/conventions.md` (phụ lục §3.6);
  nếu FD-D1 = gộp: chép plan vào plan G5-G7 §5.8 theo plan §1.
- File: `docs/superpowers/specs/2026-10-13-documents-folders-addendum.md`, `docs/conventions.md`, (gộp) `docs/superpowers/plans/2026-10-12-office-g5-g6-g7.md`.
- Test: review BE + FE + Advisor; `node --test scripts/governance.test.mjs` (dòng Trạng thái). AC: nền cho mọi AC. Gate: FD-D1..FD-D8.

**FD-02 Server: tên thư mục — trần, trùng, tự đổi tên "(n)"** — D · Lead D · FD-01, FD-03 · W2
- Đầu vào: `cleanDocumentTitle` trim + trần 500 (`server/internal/service/document_pages.go:101-110`); không ràng buộc trùng;
  `copyTitle` (`document_copy.go:256-261`); khôi phục batch + `DetachDocumentToRoot` (`document_lifecycle.go:330-358`).
- Sản phẩm: chuẩn hóa NFC mọi tiêu đề ghi; trần 255 cho thư mục (tạo, đổi tên), 500 cho tài liệu (§3.3); migration dữ liệu
  `999<ms>_documents_folder_name_dedupe` (đổi tên trùng cũ theo `created_at, id`) rồi `999<ms>_documents_folder_name_uidx` (một câu
  `CREATE UNIQUE INDEX CONCURRENTLY`, biểu thức §3.3); query `FolderNameTaken`/`NextFreeTitleSuffix` mang `workspace_id = $n`; tạo/đổi
  tên trùng → 409 `folder_name_taken` (cả khi bắt `23505`), `details` không lộ thư mục kia; di chuyển thư mục/tài liệu và khôi phục
  đụng tên → "Tên (n)" trong cùng transaction (tệp: trước phần mở rộng), audit diff có `title`; mã lỗi mới vào `error_class.go`;
  SDI ghi trần theo loại; runbook ngắn cho index INVALID (§3.3) trong `docs/runbooks/`.
- File: `server/migrations/999<ms>_*` (2 cặp up/down), `server/pkg/db/queries/document_tree.sql` (+ `make sqlc`),
  `server/internal/service/{document_pages,document_tree,document_lifecycle,document_copy}.go` (+ test),
  `server/internal/handler/dto/sdi/document.go`, `server/internal/handler/dto/sdo/error_class.go`, `docs/runbooks/documents-folder-name-index.md`.
- Test: tạo hai thư mục "Hợp đồng" và "HỢP ĐỒNG" cùng cha → 409; "Hop dong" cạnh "Hợp đồng" → được; cùng tên ở cha khác → được;
  cùng tên với thư mục đã lưu trữ → được; hai lệnh tạo đồng thời → một 201 + một 409; đổi tên thành tên đang có → 409; thư mục người
  gọi không đọc được cùng tên → 409 không chứa id/tên kia; 256 ký tự thư mục → 400, tài liệu 500 → được; di chuyển thư mục vào đích có
  "A", "A (2)" → "A (3)"; di chuyển "Báo cáo.docx" vào đích có cùng tên → "Báo cáo (2).docx"; tài liệu cùng tên khác `kind` → giữ tên;
  khôi phục đụng tên → "(n)"; dedupe migration trên dữ liệu trùng dựng sẵn → giữ hàng cũ nhất, index tạo được; audit `document.moved`
  có diff `title`; `lint_test.go`, `TestEveryQueryNamesItsTenant`, `audit_coverage_test.go`.
  AC: AC-11, AC-05, AC-07 (phần "(n)"). FR/BR: FR-02 (tên), FR-04, FR-05 (trùng), BR-06. Gate: FD-D3, FD-D4, FD-D5.

**FD-03 Server: độ sâu và cây** — D · Lead D · FD-01 · W1
- Đầu vào: `maxDocumentDepth = 5` (`document_pages.go:33-34`), CTE `lvl < 10` (`document_tree.sql:13-30`), cắt cây
  (`document_tree.go:363`), vòng tổ tiên `2*maxDocumentDepth` (`document_pages.go:413,497`).
- Sản phẩm: hằng theo FD-D2 dùng ở mọi chỗ trên; CTE nhận tham số mức; `GET .../documents/tree?folders_only=true` (SDI + handler);
  hằng xuất cho client qua hợp đồng (FD-06 chép).
- File: `server/internal/service/{document_pages,document_tree}.go` (+ test), `server/pkg/db/queries/document_tree.sql`,
  `server/internal/handler/{document_collections.go,dto/sdi/document.go}`.
- Test: tạo chuỗi đúng trần → được, trần + 1 → `document_too_deep`; di chuyển cây con chiều cao h vào độ sâu d với d + h = trần →
  được, +1 → từ chối; cây trả đủ trần cấp; `folders_only` không trả trang/tệp; chặn vòng giữ nguyên. AC: AC-01, AC-05.
  FR/BR: FR-01, BR-01. Gate: FD-D2.

**FD-04 Server: số đếm khi xóa thư mục** — D · Lead D · FD-01 · W2
- Sản phẩm: `GET /documents/{documentID}/archive-impact` → `DocumentArchiveImpactSDO{folders, documents, total, max_nodes}` (§3.4),
  cùng cổng `manage` của lưu trữ (từ chối → cùng 403, không số); route qua wrapper `api` + `apiOp{sdi, sdo}`, SDO có
  `description` + `example`; `isoRoutes` có control.
- File: `server/internal/service/document_lifecycle.go` (+ test), `server/internal/handler/document_lifecycle*.go`,
  `server/internal/handler/router/documents.go`, `dto/sdo/document.go`, `server/internal/handler/isolation_routes_test.go`.
- Test: thư mục có 2 thư mục con, 3 trang, 1 tệp, 1 trang con trong trang → `{folders:2, documents:5}`; cây sâu hơn 5 cấp đếm đủ;
  nút đã lưu trữ không đếm; thiếu `manage` một nút → 403, thân không có số; tenant khác → 404/403 không lộ;
  `TestIsolationMatrix`. AC: AC-12. FR/BR: FR-03, BR-09. Gate: FD-D6.

**FD-05 Server: tìm kiếm có đường dẫn** — D · Lead D · FD-01 · W1
- Đầu vào: list `?q=` trên `search_text` (`document_search.sql:51-52`), `?kind=folder` (`document_search.go:257`), SDO không có
  đường dẫn (`dto/sdo/document.go:168-190`).
- Sản phẩm: `kind=document`, `match=title` (`uw_fold_search(title)`), `path[]` cho mỗi hàng tính theo lô, cắt ở tổ tiên không đọc
  được (§3.5); SDI/SDO + example.
- File: `server/pkg/db/queries/document_search.sql` (+ sqlc), `server/internal/service/document_search.go` (+ test),
  `server/internal/handler/dto/{sdi,sdo}/document.go`.
- Test: `q=hop dong&match=title` thấy thư mục "Hợp đồng" và tài liệu "Hợp đồng A", không thấy tài liệu chỉ có chữ đó trong nội
  dung; `kind=folder` chỉ thư mục, `kind=document` không có thư mục; `path` đúng thứ tự gốc → cha; tổ tiên bị hạn chế → `path` dừng
  trước nó, không lộ tiêu đề; một trang 50 kết quả = số query cố định (không N+1); tenant khác không lộ. AC: AC-09.
  FR/BR: FR-08. Gate: FD-D7.

**FD-06 Core: client thư mục** — D · Lead D (FE) · FD-01 · W1
- Sản phẩm: endpoint + schema lenient + malformed test cho `archive-impact`, `path[]`, tham số tìm mới, `folders_only`; hook
  `useDocumentArchiveImpact`, `useDocumentSearch` (key theo `wsId`); `paths.documentsFolder(id)`; hằng độ sâu + trần tên dùng
  chung; ánh xạ `folder_name_taken` trong `document-error-message.ts`; khóa i18n vi/en của toàn epic (một lần, các thẻ views dùng lại).
- File: `packages/core/api/endpoints/documents-collections.ts` (+ test), `packages/core/documents/hooks-collections.ts` (+ test),
  `packages/core/paths/paths.ts` (+ test), `packages/core/i18n/locales/{vi,en}.json`, `packages/views/documents/document-error-message.ts`.
- Test: phản hồi hỏng của từng endpoint mới → giá trị dự phòng, không throw; `path` thiếu → `[]`; key có `wsId`; parity vi↔en;
  `consistency.test.ts` của paths xanh. AC: góp AC-08, AC-09, AC-11, AC-12. Gate: không (code theo hợp đồng FD-01).

**FD-07 Views: sidebar FOLDERS** — D · Lead D (FE) · FD-03, FD-06 · W2
- Đầu vào: cây (`packages/views/documents/document-tree.tsx`), (+) tạo trong thư mục đang mở (`documents-page-view.tsx:88`),
  `expanded` khởi tạo rỗng (`document-tree.tsx:192`), chặn vòng không báo (`:249`).
- Sản phẩm: (+) luôn tạo ở gốc (hộp thoại tên); menu (...) mỗi hàng (Mở, Thư mục con mới, Đổi tên, Di chuyển tới…, Xóa) theo quyền,
  mở bằng chuột, chuột phải và bàn phím; vào bằng `?folder=` → mở mọi tổ tiên + cuộn tới hàng; toast khi kéo-thả bị chặn vì vòng
  hoặc quá sâu (số trần từ hằng); tải cây với `folders_only`.
- File: `packages/views/documents/{document-tree.tsx,document-tree-model.ts,documents-sidebar.tsx,documents-page-view.tsx}` (+ test),
  `apps/web/app/[orgSlug]/[workspaceSlug]/documents/page.tsx` (đọc `?folder`).
- Test: thư mục sâu 7 cấp mở qua URL → 6 tổ tiên mở, hàng có `aria-current` và nằm trong tầm nhìn; (+) ở trong thư mục vẫn tạo ở gốc;
  menu đủ 5 mục với quyền edit, chỉ "Mở" với quyền view; bàn phím mở menu; kéo vào con → toast; `jsx-a11y`. AC: AC-01, AC-02, AC-06,
  AC-08 (phần cây). FR/BR: FR-01, FR-02, FR-03, FR-06. Gate: FD-D2 (số trần).

**FD-08 Views: nội dung thư mục** — D · Lead D (FE) · FD-06 · W2
- Đầu vào: `CREATE_TYPES` không có folder (`documents-create.ts:13`), không xếp thư mục trước, không sắp xếp, không cột Loại
  (`documents-library-list.tsx:150-155`), đổi tên chỉ ở lá breadcrumb.
- Sản phẩm: "Mới → Thư mục" (trong thư mục đang mở); thư mục trước; sắp Tên/Cập nhật (nhớ qua StorageAdapter); cột Loại; menu hàng
  thêm "Thư mục con mới", "Đổi tên"; hộp thoại tạo/đổi tên dùng chung (trần 255, lỗi `folder_name_taken` tại trường, rỗng → lỗi tại
  trường); toast kết quả tạo/đổi tên.
- File: `packages/views/documents/{documents-create.ts,documents-home-create.tsx,documents-library-list.tsx,documents-library-row.tsx,library-rows.ts,documents-library-toolbar.tsx}`,
  dialog mới `folder-name-dialog.tsx` (+ test).
- Test: thư mục đứng trước tài liệu ở cả hai kiểu sắp; sắp Tên theo `vi` ("Ă" sau "A"); tạo trùng → lỗi tại trường, hộp thoại giữ
  nội dung; 256 ký tự → không gửi; con trực tiếp only (không hiện cháu); `CollectionPageState` khi rỗng. AC: AC-01, AC-03, AC-04,
  AC-11 (UI). FR/BR: FR-02, FR-03, FR-07. Gate: FD-D3, FD-D5.

**FD-09 Views: Di chuyển tới, breadcrumb, cảnh báo xóa** — D · Lead D (FE) · FD-04, FD-06, FD-07 · W3
- Đầu vào: picker phẳng ẩn đích không hợp lệ (`folder-picker-dialog.tsx:43`), vị trí hiện tại chỉ chọn sẵn
  (`use-library-row-dialogs.tsx:127`), breadcrumb `flex-wrap` (`documents-library-toolbar.tsx:123`), cảnh báo một tổng số
  (`document-archive-dialog.tsx:153-163`).
- Sản phẩm: picker dạng cây (dùng `document-tree-model.ts`), vị trí hiện tại + cây con của chính nó + đích quá sâu hiện và vô hiệu có
  lý do; toast "Đã chuyển tới …" / "Đã chuyển và đổi tên thành …" (đọc `title` trả về); breadcrumb rút gọn cấp giữa (§3.6); hộp
  thoại xóa dùng `archive-impact` (số thư mục con + số tài liệu, chữ "Xóa"/"thùng rác" theo FD-D6).
- File: `packages/views/documents/{folder-picker-dialog.tsx,use-library-row-dialogs.tsx,documents-library-toolbar.tsx,document-archive-dialog.tsx}` (+ test).
- Test: không chọn được vị trí hiện tại; di chuyển trùng tên → toast có tên mới; breadcrumb 7 cấp → gốc, "…", cha, lá, menu "…" đủ
  cấp ẩn, bàn phím được; cảnh báo hiện đúng hai số từ server, xác nhận khóa tới khi có số, 403 → thông điệp quyền. AC: AC-05,
  AC-06, AC-07, AC-08, AC-12. FR/BR: FR-03, FR-04, FR-05, FR-06. Gate: FD-D5, FD-D6.

**FD-10 Views: tìm kiếm thống nhất** — D · Lead D (FE) · FD-05, FD-06 · W2
- Sản phẩm: ô tìm trong header Documents (debounce, chờ IME), chip Tất cả / Thư mục / Tài liệu, kết quả icon loại + tên + đường
  dẫn; chọn thư mục → `?folder=`, tài liệu → trang tài liệu; bảng lệnh ⌘K: thư mục → `?folder=` (không mở trang chi tiết), hiện
  đường dẫn.
- File: `packages/views/documents/` (thành phần tìm mới + test), `packages/views/search/search-command.tsx` (+ test).
- Test: gõ "hop dong" → thư mục và tài liệu có đường dẫn; chip Thư mục chỉ thư mục; Enter thư mục → URL thư mục; ⌘K chọn thư mục
  không mở chi tiết; rỗng → `CollectionPageState`. AC: AC-09. FR/BR: FR-08. Gate: FD-D7.

**FD-11 Fork: duyệt thư mục trong hộp thoại UniWork (hoãn)** — F · Lead F · FD-02, FD-03, FD-05 · W3
- Đầu vào: `kind=file` (`apps/shell/src/main/uniwork-docs/client.ts:230`), bỏ dòng không phải tệp (`parse.ts:127`), danh sách phẳng
  (`UniworkOpenDialog.tsx:285-316`).
- Sản phẩm: duyệt theo `parent_id` + breadcrumb, đường dẫn trong kết quả tìm, tạo tài liệu vào thư mục đang mở (nối G8-17); i18n
  21 locale; seam L9/L10 (rebase sau G8-16/G8-17).
- Test: mở thư mục 3 cấp, quay lại bằng breadcrumb; tìm hiện đường dẫn; parity 21 locale. AC: AC-08, AC-09 (desktop).
  Gate: FD-D8 (khuyến nghị hoãn).

**FD-12 Nghiệm thu thư mục** — D · QA · FD-02, FD-03, FD-04, FD-05, FD-07, FD-08, FD-09, FD-10 · W4
- Sản phẩm: `e2e/documents-folders.spec.ts` theo AC-01..AC-12 trên app thật; hồi quy FR-09/AC-10 (di chuyển tài liệu rồi FROM
  ELSEWHERE vẫn liệt kê, version + bình luận còn, id không đổi); bảng nghiệm thu AC → lệnh → kết quả → artifact; ảnh chụp light/dark
  vi/en của sidebar, nội dung thư mục, picker, cảnh báo xóa, tìm kiếm (Tester visual, chấm chất lượng UI).
- Test: suite trên cloud runner (e2e + `make check` tương đương); hàng chưa chạy = BLOCKED, không PASS. AC: AC-01..AC-12.
  Gate: không.

## 3. Song song, lane, đường găng

| Lane | Owner | Khu vực | Thẻ (thứ tự merge) |
| --- | --- | --- | --- |
| L25 Folders server | Lead D (BE) | `service/document_{pages,tree,lifecycle,copy}.go`, `document_tree.sql`, migration | FD-03 → FD-02 → FD-04 |
| L26 Folders search | Lead D (BE) | `document_search.{go,sql}`, SDO tìm kiếm | FD-05 |
| L27 Folders web | Lead D (FE) | `packages/core/{api,documents,paths,i18n}`, `packages/views/documents`, `packages/views/search` | FD-06 → FD-07 → FD-08 → FD-10 → FD-09 |
| L28 Folders QA | QA | `e2e/documents-folders.spec.ts`, bảng nghiệm thu | FD-12 |
| (L9/L10 fork, hoãn) | Lead F | F `uniwork-docs`, `UniworkOpenDialog.tsx` | FD-11 |

Seam: `router/documents.go`, `openapi.go`, `isolation_routes_test.go`, `audit_coverage_test.go`, `error_class.go`,
`dto/sdo/document.go` — L25 và L26 merge nối tiếp qua root, rebase giải conflict; `{vi,en}.json` chỉ FD-06 thêm khóa của epic (thẻ
views sau chỉ sửa câu qua review). Migration FD-02 xếp sau mọi migration đang mở của root khi merge (đổi tên `999<ms>` khi rebase).

| Wave | Thẻ (song song) |
| --- | --- |
| W0 | FD-01 |
| W1 | FD-03 · FD-05 · FD-06 |
| W2 | FD-02 · FD-04 · FD-07 · FD-08 · FD-10 |
| W3 | FD-09 · (FD-11 khi FD-D8 = làm) |
| W4 | FD-12 |

Đường găng (5 thẻ): FD-01 → FD-06 → FD-07 → FD-09 → FD-12 và FD-01 → FD-03 → FD-07 → FD-09 → FD-12; nhánh server
FD-01 → FD-03 → FD-02 → FD-12 ngắn hơn một bước. Cỡ: FD-01 S, FD-02 L, FD-03 M,
FD-04 S, FD-05 M, FD-06 M, FD-07 M, FD-08 M, FD-09 M, FD-10 M, FD-11 M, FD-12 M = 23 điểm (21 khi hoãn FD-11) — khoảng nửa G8.

## 4. Ma trận AC

| AC | Thực thi | Góp |
| --- | --- | --- |
| AC-01 | FD-03, FD-07, FD-08, FD-12 | FD-02 |
| AC-02 | FD-07, FD-12 | FD-03 |
| AC-03 | FD-08, FD-12 | — |
| AC-04 | FD-08, FD-12 | FD-02 |
| AC-05 | FD-02, FD-03, FD-09, FD-12 | — |
| AC-06 | FD-07, FD-09, FD-12 | — |
| AC-07 | FD-02, FD-09, FD-12 | — |
| AC-08 | FD-07, FD-09, FD-12 | FD-06, FD-11 |
| AC-09 | FD-05, FD-10, FD-12 | FD-06, FD-11 |
| AC-10 | FD-12 | — |
| AC-11 | FD-02, FD-08, FD-12 | FD-06 |
| AC-12 | FD-04, FD-09, FD-12 | FD-06 |

## 5. Rủi ro

| Rủi ro | Cách giảm |
| --- | --- |
| Index unique CONCURRENTLY fail vì bản trùng chen vào giữa dedupe và index (binary cũ) | Deploy binary có kiểm trùng trước migration index; runbook FD-02 (drop INVALID, chạy lại) |
| Nâng trần độ sâu làm cây/CTE chậm | `folders_only`, CTE có tham số mức, test hiệu năng cây 20 cấp × 1000 nút trong FD-03 |
| Tự đổi tên khi di chuyển làm người dùng bất ngờ | Toast ghi tên mới (FD-09); audit diff `title` |
| Đếm khi xóa lộ cấu trúc ẩn | Cổng `manage` như lệnh lưu trữ, 403 không số (§3.4) |
| G8-17 (tạo từ app) lệch luật tên | Dùng chung `folder_name_taken` + trần (phụ lục §4); review chéo khi G8-17 merge |

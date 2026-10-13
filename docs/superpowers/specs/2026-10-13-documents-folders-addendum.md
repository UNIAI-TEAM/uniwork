# Documents — Phụ lục: Thư mục nhiều cấp (UNI-1425)

> **Trạng thái:** in-progress — phụ lục v0.1, soạn 2026-10-13 theo yêu cầu người dùng (~15:35 UTC+7: thêm spec + plan cho UNI-1425 theo cách đã làm với G8/UNI-1331). Bản nháp chờ review FE + BE và chờ người dùng ký FD-D1..FD-D8 (decision packet `reports/plan-folders/decision-packet.md` của Run). Giá trị ghi "khuyến nghị" ở §2 **chưa ký**; không triển khai trước khi ký.

**Issue:** UNI-1425 "Quản lý Folder trong Documents" (FR-01..FR-09, BR-01..BR-10, AC-01..AC-12). Chưa có issue cha; FD-D1
quyết định nó vào phase UNI-923 (G5-G7) hay thành phase riêng.
**Quan hệ với thiết kế có sẵn:** Documents C-01 (cây trang, UNI-675) và thư mục `kind=folder` (migration
`9991791776514761_documents_kind_folder`). Phụ lục này **mở rộng** mô hình đó, không thay: một bảng `documents`, quan hệ cha bằng
`parent_id`, không bảng thư mục riêng. Khi phụ lục lệch `CLAUDE.md` hoặc một ADR, `CLAUDE.md`/ADR thắng.
**Plan:** [plan thư mục](../plans/2026-10-13-documents-folders.md) (12 thẻ FD-01..FD-12, viết để gộp vào plan G5-G7 thành §5.8 E6
hoặc chạy như phase riêng). **Bằng chứng hiện trạng:** `reports/plan-folders/gap-analysis.md` của Run (mọi dữ kiện có `file:line`).

## 1. Kết quả sản phẩm

Người dùng tổ chức tài liệu trong cây thư mục nhiều cấp: thấy cây ở mục FOLDERS của sidebar, mở/thu từng nhánh, mở một thư mục
bằng URL riêng (cây tự mở tới nó), thấy thư mục con và tài liệu trực tiếp (thư mục trước, sắp theo tên hoặc thời gian), tạo thư
mục ở gốc, trong thư mục con và từ vùng nội dung, đổi tên, di chuyển, xóa có cảnh báo đủ số thư mục con và tài liệu bị ảnh hưởng.
Hai thư mục cùng cha không trùng tên; khi di chuyển vào nơi đã có tên đó, đối tượng được tự đổi tên "Tên (n)" và người dùng được
báo tên mới. Một ô tìm kiếm trả cả thư mục và tài liệu, lọc được Tất cả / Thư mục / Tài liệu, mỗi kết quả kèm đường dẫn. FROM
ELSEWHERE giữ nguyên.

## 2. Quyết định cần ký (khuyến nghị, **chưa ký**)

Nguồn câu hỏi và lựa chọn: decision packet. Bảng này là giá trị phụ lục và plan dùng nếu người dùng ký đúng khuyến nghị; ký khác
thì sửa phụ lục và các thẻ có ghi gate tương ứng.

| ID | Câu hỏi | Khuyến nghị | Thẻ bị chặn |
| --- | --- | --- | --- |
| FD-D1 | Vào phase UNI-923 hay phase riêng? | **Phase riêng** "Documents — Thư mục" (UNI-1425 làm issue cha), plan riêng, chạy cùng Run/đội G5-G7 như một nhóm lane song song, không nằm trong mốc P0–P3 | Không chặn code; quyết định nơi ghi plan + sub-issue |
| FD-D2 | Trần độ sâu | **Nâng lên 20 cấp** (một hằng chung cho thư mục, trang, tệp; trần bảo vệ, không phải "vô hạn") | FD-03, FD-07 |
| FD-D3 | Độ dài tên | **255 ký tự cho thư mục** (tạo và đổi tên); tài liệu giữ 500; thư mục cũ dài hơn giữ nguyên tới lần đổi tên sau | FD-02 |
| FD-D4 | Trùng tên thư mục cùng cha | **Không phân biệt hoa thường, phân biệt dấu** ("Hợp đồng" = "HỢP ĐỒNG", ≠ "Hop dong"); so sau trim + chuẩn hóa NFC; chỉ thư mục chưa lưu trữ, cùng workspace, cùng cha (gốc là một cha); thư mục trùng có sẵn: migration đổi tên bản mới hơn thành "Tên (2)", "Tên (3)" | FD-02 |
| FD-D5 | Trùng khi tạo/đổi tên vs khi di chuyển/khôi phục | **Tạo/đổi tên: từ chối** 409 `folder_name_taken`, lỗi tại trường. **Di chuyển (thư mục và tài liệu) và khôi phục: tự đổi tên** "Tên (n)", n nhỏ nhất ≥ 2 còn trống, báo tên mới | FD-02, FD-08, FD-09 |
| FD-D6 | Xóa | **Giữ lưu trữ** (thùng rác, khôi phục 30 ngày, worker xóa thật sau đó); chữ trên UI là "Xóa" / "Chuyển vào thùng rác"; cảnh báo ghi **riêng** số thư mục con và số tài liệu, đếm ở server | FD-04, FD-09 |
| FD-D7 | Phạm vi tìm kiếm | **Workspace đang mở**, khớp **theo tên** trong ô tìm của Documents (bảng lệnh ⌘K giữ tìm cả nội dung); mọi tài liệu người dùng đọc được trong workspace đó | FD-05, FD-10 |
| FD-D8 | Desktop cùng phase? | **Hoãn** duyệt thư mục trong hộp thoại UniWork của app (FD-11 làm sau); G8-17 dùng chung luật tên/mã lỗi của phụ lục này | FD-11 |

## 3. Thiết kế

### 3.1 Mô hình (không bảng mới)

- Thư mục = hàng `documents` có `kind = 'folder'`; không nội dung, không version, không blob (`9991791776514761`). Luật đặt chỗ giữ
  nguyên: thư mục ở gốc hoặc trong thư mục; trang và tệp ở thư mục hoặc trong trang (`document_types.go:41-46`). "Document" của SRS
  = trang hoặc tệp. Trang con trong trang là việc của trang: không hiện ở cây FOLDERS, không tính là "nội dung trực tiếp" của thư
  mục, nhưng tính vào độ sâu và vào số đếm khi xóa.
- Không thêm cột. Tên duy nhất dùng một index unique theo biểu thức (§3.3). Không FK, không cascade (CLAUDE.md); cây con xử lý ở
  service trong một transaction như hiện nay (`ListLiveDocumentSubtreeIDs`, `ArchiveDocumentBatch`).
- Tenant: bảng đã có `organization_id NOT NULL`, `created_by_kind`; query mới mang `workspace_id = $n` hoặc dòng `-- tenant:`
  (`TestEveryQueryNamesItsTenant`). Membership chỉ qua `RequireMember`/`authorize()` có sẵn.

### 3.2 Độ sâu (FD-D2)

- Một hằng `maxDocumentDepth` (20 nếu ký khuyến nghị) ở `server/internal/service/document_pages.go`; mọi chỗ đang suy từ 5 đọc
  hằng này: kiểm khi tạo (`lockPageParent`), kiểm khi di chuyển (độ sâu đích + chiều cao cây con), vòng lặp tổ tiên
  (`2*maxDocumentDepth`), cắt cây ở API `tree`, và CTE `ListDocumentSubtree` (đang cứng `lvl < 10`: đổi thành tham số
  `sqlc.arg(max_level)` = `2*maxDocumentDepth`). Lỗi giữ `document_too_deep` (422).
- Client không lặp số: `TREE_MAX_LEVEL` đọc từ một hằng duy nhất ở `packages/core/documents/` (chép giá trị hợp đồng FD-01, có test
  so với hằng server qua contract), chuỗi `documents.tree.too_deep` nhận `{{max}}`.
- API cây thêm `?folders_only=true` (sidebar chỉ cần thư mục; giảm payload khi sâu 20 cấp). Không đổi hình dạng node.

### 3.3 Tên thư mục (FD-D3, FD-D4, FD-D5)

- Chuẩn hóa: `strings.TrimSpace` (đã có) + `norm.NFC` cho mọi tiêu đề ghi vào `documents` (tạo, đổi tên, di chuyển có đổi tên,
  khôi phục có đổi tên, sao chép). Rỗng → 400 như hiện tại. Thư mục: > 255 rune → 400 `Invalid` (thông điệp có số 255); tài liệu
  giữ 500. SDI ghi trần theo loại.
- Ràng buộc DB: `CREATE UNIQUE INDEX CONCURRENTLY idx_documents_folder_name_uidx ON documents (workspace_id, COALESCE(parent_id,
  ''), lower(title)) WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL` — một câu, một file (lint migration).
  `lower()` trong index và trong query kiểm trước là **một** biểu thức, nên Go và Postgres không thể lệch nhau; không gấp dấu (tiếng
  Việt "Ma"/"Mã"/"Mà" là ba từ khác nhau).
- Dữ liệu cũ: migration dữ liệu chạy **trước** file index: trong mỗi nhóm trùng (cùng khóa trên), hàng tạo sớm nhất giữ tên, các
  hàng sau thành "Tên (2)", "Tên (3)"… theo `created_at, id` (bỏ qua số đã dùng). Migration không ghi audit (không phải command của
  người dùng); ghi chú phát hành liệt kê số hàng bị đổi. Nếu file index thất bại vì một bản trùng chen vào lúc deploy (binary cũ
  chưa chặn), index ở trạng thái INVALID: runbook FD-02 = `DROP INDEX CONCURRENTLY` rồi chạy lại hai file.
- Tạo / đổi tên thư mục trùng → 409 `folder_name_taken` (mã mới trong `error_class.go`, `details` không chứa id hay tên của thư mục
  kia — thư mục kia có thể là thư mục người gọi không đọc được). Bắt cả vi phạm unique `23505` của index (hai lệnh đồng thời) và
  trả cùng mã.
- Di chuyển: nếu đích đã có **thư mục** cùng khóa (khi di chuyển thư mục) hoặc **tài liệu** cùng `lower(title)` và cùng `kind`
  (khi di chuyển trang/tệp), service đặt tiêu đề mới "Tên (n)" trong **cùng transaction** với `MoveDocument`: n nhỏ nhất ≥ 2 chưa
  dùng trong đích; với tệp, hậu tố chèn trước phần mở rộng ("Báo cáo (2).docx"). Va chạm `23505` khi ghi → thử n kế tiếp (tối đa
  vài lần, rồi 409). Audit `document.moved` ghi diff `parent_id`, `position` **và** `title` khi đổi; outbox vẫn `document.moved`
  (payload chỉ id), không thêm sự kiện. SDO của move trả tài liệu sau khi đổi (đã có), client đọc `title` mới để báo.
- Không trùng ở tài liệu ngoài lúc di chuyển: tạo/tải lên/đổi tên tài liệu không bị chặn trùng (SRS chỉ ràng thư mục, BR-06).
- Khôi phục (`RestoreDocument`): gốc của batch về cha cũ (hoặc về gốc khi cha đã mất, `DetachDocumentToRoot`) mà đụng tên → "(n)"
  trong cùng transaction, audit `document.restored` ghi tiêu đề mới.
- Sao chép: nếu route copy nhận thư mục, tiêu đề "(bản sao)" vẫn đi qua luật "(n)" (FD-02 kiểm và ghi kết quả).

### 3.4 Xóa (FD-D6)

- Ngữ nghĩa giữ nguyên: lưu trữ cả cây một batch, cần `manage` trên mọi nút, trần 1000 nút → `folder_too_large`, khôi phục theo
  batch, worker xóa thật sau 30 ngày. Không thêm xóa cứng.
- Route mới `GET /documents/{documentID}/archive-impact` → `{folders, documents, total, max_nodes}`: đếm mọi hậu duệ còn sống
  (cùng `ListLiveDocumentSubtreeIDs`, không giới hạn 5 cấp, gồm trang con). Cổng giống lệnh lưu trữ: không đủ `manage` trên mọi nút
  → cùng 403 mà lệnh lưu trữ trả (`requireManageOnSubtree`, `document_lifecycle.go:76-103`; web hiện chuỗi `documents.archive.archive_forbidden`), không trả số, để số đếm không lộ phần cây người gọi không thấy. Không ghi audit (đọc). Route có
  `{documentID}` nên `TestIsolationMatrix` phủ ngay; kèm control (chủ tenant gọi được).
- UI: hộp thoại "Xóa thư mục" ghi "N thư mục con và M tài liệu sẽ chuyển vào thùng rác, khôi phục được trong 30 ngày"; xác nhận bị
  khóa tới khi số về; `total > max_nodes` → thông báo `folder_too_large` thay nút xác nhận.

### 3.5 Tìm kiếm (FD-D7)

- Route có sẵn `GET /workspaces/{workspaceID}/documents?q=` thêm: `kind=document` (= mọi loại trừ `folder`; `kind=folder` đã có),
  `match=title` (so `uw_fold_search(title)` thay vì `search_text`, để "hop dong" thấy "Hợp đồng" như hiện nay), và mỗi hàng kết quả
  thêm `path: [{id, title}]` (từ gốc tới cha trực tiếp). `path` tính một lần cho cả trang kết quả (CTE đi lên theo `parent_id`, có
  `workspace_id = $n`) và **cắt ở tổ tiên đầu tiên người gọi không đọc được**, đúng luật của `documentBreadcrumbs`
  (`document_pages.go:494-519`). Trường mới tùy chọn trong SDO; client schema lenient.
- Phạm vi: workspace đang mở, mọi tài liệu người gọi đọc được (cổng hiện có của list). Tìm toàn tổ chức: hoãn (§6).

### 3.6 Web

- **URL thư mục:** trang Documents nhận `?folder=<id>`; `packages/core/paths` thêm builder `documentsFolder(id)` (không thêm trang
  Next.js mới, nên `consistency.test.ts` không đổi luật). Mở URL → tải thư mục, cây mở mọi tổ tiên (từ `breadcrumbs` của thư mục) và
  cuộn hàng đang chọn vào tầm nhìn. Bảng lệnh ⌘K: chọn thư mục → URL thư mục, không mở trang chi tiết.
- **Sidebar FOLDERS:** (+) luôn tạo ở gốc; mỗi hàng có menu (...) khi hover/focus (và chuột phải): Mở, Thư mục con mới, Đổi tên,
  Di chuyển tới…, Xóa — theo quyền (`canEditDocument`, `manage` cho xóa). Kéo-thả giữ nguyên, thêm toast khi bị chặn vì vòng.
- **Vùng nội dung thư mục:** "Mới → Thư mục" tạo trong thư mục đang mở; thư mục luôn đứng trước; sắp theo Tên (A→Z, so theo
  `Intl.Collator('vi')`) hoặc Cập nhật (mới nhất), lựa chọn nhớ theo người xem (StorageAdapter); thêm cột Loại; menu hàng thêm
  "Thư mục con mới" (với thư mục) và "Đổi tên". Tạo và đổi tên dùng hộp thoại có trường tên (trần 255, lỗi trùng tại trường).
  Header theo luật shell: `CollectionPageHeader` + `CollectionPageState` (đã có).
- **Trang chủ Documents** (gốc, không `?folder`) giữ danh sách thư viện hiện tại (gần đây, nhóm theo thư mục) — SRS §4 giữ nguyên
  cấu trúc sidebar; "nội dung trực tiếp" áp khi một thư mục được mở.
- **Di chuyển tới…:** picker dạng cây thu/mở được (dùng lại model cây), vị trí hiện tại và cây con của chính nó hiện nhưng vô hiệu
  (có lý do), đích quá sâu vô hiệu; xác nhận → toast "Đã chuyển tới {{folder}}" hoặc "Đã chuyển và đổi tên thành {{title}}".
- **Breadcrumb:** quá 4 cấp → giữ gốc, cha trực tiếp và lá, gộp các cấp giữa vào nút "…" mở menu các cấp ẩn (bàn phím được).
- **Tìm kiếm:** ô tìm trong header Documents, chip lọc Tất cả / Thư mục / Tài liệu, kết quả hiện icon loại, tên, đường dẫn rút
  gọn; Enter trên thư mục → URL thư mục, trên tài liệu → trang tài liệu.
- **Chuỗi:** mọi chuỗi qua `t()` (`i18next/no-literal-string`), khóa vi/en trong `packages/core/i18n/locales/{vi,en}.json`;
  FD-01 thêm vào bảng thuật ngữ `docs/conventions.md`: Folder = Thư mục, Subfolder = Thư mục con, Move to = Di chuyển tới,
  Trash = Thùng rác, Breadcrumb path = Đường dẫn. Icon theo `docs/conventions.md` › Icons (lucide tên chuẩn).
- **A11y:** cây giữ vai trò tree/treeitem hiện có; menu (...) mở bằng bàn phím (Shift+F10 / phím Menu) trên hàng đang focus;
  hộp thoại có focus trap của primitive; touch target ≥ 44px.

### 3.7 Realtime, audit, log

- Không sự kiện mới: `document.created`, `document.updated`, `document.moved`, `document.archived`, `document.restored` đã có trong
  ba bản catalogue, payload chỉ id; hook hiện có invalidate key workspace. Mọi command đổi trạng thái đi qua `audit.Recorder` cùng
  transaction như hiện nay; không thêm action audit (đổi tên khi di chuyển ghi trong diff của `document.moved`).
- Log chỉ id (không tiêu đề thư mục — tiêu đề có thể chứa tên người/khách hàng), `scripts/no-pii-log.test.mjs`.

### 3.8 Desktop (FD-D8)

Hoãn: hộp thoại UniWork của app vẫn chỉ tệp (`client.ts:230`, `parse.ts:127`). Khi làm (FD-11): bỏ `kind=file`, duyệt theo
`parent_id` + breadcrumb, hiện đường dẫn trong kết quả tìm (trường `path` của §3.5), tạo tài liệu vào thư mục đang mở (G8-17).
Không đổi frame protocol.

## 4. Hợp đồng (FD-01 chốt mục này thành v1.0 của phụ lục, không tạo file hợp đồng riêng)

| Mục | Giá trị |
| --- | --- |
| Mã lỗi mới | `folder_name_taken` 409 (tạo, đổi tên thư mục; di chuyển/khôi phục chỉ khi hết lần thử "(n)") |
| Mã lỗi dùng lại | `document_too_deep` 422, `document_cycle` 422, `document_parent_kind` 422, `folder_too_large` 422, 403 forbidden của `requireManageOnSubtree` (client: `documents.archive.archive_forbidden`) |
| Route mới | `GET /documents/{documentID}/archive-impact` (SDO `DocumentArchiveImpactSDO`) |
| Tham số mới | list: `kind=document`, `match=title`; tree: `folders_only` |
| Trường SDO mới | `DocumentSummaryDTO.path[]` `{id, title}` (tùy chọn) |
| Hằng | `maxDocumentDepth` (FD-D2), trần tên thư mục 255 (FD-D3), số lần thử "(n)" |
| Luật hậu tố | "Tên (n)"; tệp: trước phần mở rộng cuối; n nhỏ nhất ≥ 2 còn trống trong đích; đếm theo `lower(title)` |
| URL | `/{org}/{ws}/documents?folder=<id>` |

## 5. Ma trận FR/BR/AC → thẻ

| Yêu cầu | Thẻ |
| --- | --- |
| FR-01, AC-02, AC-03 | FD-03 (cây sâu, `folders_only`), FD-07 (sidebar), FD-08 (nội dung) |
| FR-02, AC-01 | FD-02 (tên), FD-03 (độ sâu), FD-07 ((+) gốc, thư mục con mới), FD-08 (Mới → Thư mục) |
| FR-03, AC-04, AC-12, BR-09 | FD-02 (đổi tên trùng), FD-04 (số đếm), FD-07/FD-08 (menu), FD-09 (cảnh báo) |
| FR-04, AC-07 | FD-02 ("(n)" tài liệu), FD-09 (picker, vị trí hiện tại) |
| FR-05, AC-05, AC-06, BR-05 | FD-02 ("(n)" thư mục), FD-03 (độ sâu), FD-07 (kéo-thả), FD-09 (picker) |
| FR-06, AC-08 | FD-06 (URL), FD-07 (tự mở cha, cuộn), FD-09 (breadcrumb rút gọn) |
| FR-07 | FD-08 |
| FR-08, AC-09 | FD-05 (API), FD-06 (client), FD-10 (UI) |
| FR-09, AC-10, BR-08, BR-10 | FD-12 (hồi quy; không cần code) |
| BR-01 | FD-03 |
| BR-02, BR-03, BR-04, BR-07 | Đã có; FD-12 khẳng định lại |
| BR-06, AC-11 | FD-02 (DB + service), FD-06, FD-08 |
| Mục 4 UX (thông báo kết quả, cuộn, không bắt tạo thư mục) | FD-07, FD-08, FD-09 |
| Desktop parity | FD-11 (hoãn theo FD-D8) |

## 6. Hoãn (có lý do)

- **Tìm toàn tổ chức** (mọi workspace): route và URL của D theo workspace; tìm chéo workspace cần một route mới + cổng quyền
  theo nhiều workspace. Hoãn tới khi Product cần (FD-D7).
- **Duyệt thư mục trên desktop** (FD-11): không chặn web; G8-16/G8-17 đang sửa cùng file fork (seam L9/L10 của plan G5-G7).
- **Phân quyền thư mục, thừa kế quyền, chia sẻ chéo workspace**: SRS mục 6 ngoài phạm vi; giữ luật hiện tại (không thừa kế, chỉ
  chép `visibility` khi tạo).
- **Xóa cứng ngay**: giữ thùng rác 30 ngày (FD-D6).
- **Chọn nhiều + di chuyển hàng loạt**, kéo-thả từ vùng nội dung vào cây: SRS không yêu cầu.
- **Hỏi "Thay thế / Giữ cả hai" khi trùng**: SRS chọn mặc định đổi tên "(n)".

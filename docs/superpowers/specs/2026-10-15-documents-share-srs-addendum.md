# Documents — Phụ lục: căn chỉnh Chia sẻ & quyền truy cập theo SRS Share v1.0

> **Trạng thái:** in-progress — v1.0, viết 2026-10-15. Chỉ là đối chiếu, hợp đồng và kế hoạch sửa; chưa có dòng code nào. Nguồn yêu cầu: "SRS — Chức năng chia sẻ và quản lý quyền truy cập tài liệu" v1.0 (đề xuất nghiệp vụ, user gửi 2026-10-15, file ngoài repo). Mọi quyết định đã chốt 2026-10-15: sáu câu ở mục 1.1, các câu mục 10 theo đề xuất (user: "theo đề xuất"). Phần agent (SH-S4/SH-W4) theo ADR 0010 và chờ hạ tầng `action_proposals` của agent runtime.

**Quan hệ:** [Documents C-01 §4](2026-09-08-documents-design.md) (bảng quyền gốc), [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md) (DOC-05/G8-18: `view < comment < edit < manage`, `AdminScope`, `canAdminister()`, break-glass), [phụ lục truy cập](2026-10-15-documents-access-addendum.md) (DOC-02/06/07). Phụ lục này **thay** mặc định `workspace` khi tạo (DOC-01, ký 2026-10-14 14:30) và hướng của DOC-02 (mục 4); mọi luật khác của hai phụ lục trên giữ nguyên. Khi lệch `CLAUDE.md` hoặc ADR, `CLAUDE.md`/ADR thắng.
**Hiện trạng:** `file:line` đọc ở root `54b1eca8c`. DOC-05 (a) server và (b) web nằm trên `feature/UNI-1413-g8-18-doc-05-{server,web}`, **chưa** là tổ tiên của root (server đi trước root 36 commit, web 21); mọi tên DOC-05 dưới đây là hợp đồng của phụ lục mức quyền.

## 0. Đối chiếu SRS ↔ hiện trạng

### 0.1 Đã đáp ứng (giữ nguyên, chỉ thêm test nghiệm thu nếu thiếu)

| SRS | Hiện trạng | Nguồn |
| --- | --- | --- |
| BR-01, §3.1 — share đồng thời cho Person/Workspace/Organization | ba `principal_type` | `service/document_shares.go:135-165` (`validateSharePrincipal`) |
| BR-02/03, UC08/10/11 — cộng dồn, mức cao nhất thắng, quyền cá nhân không ghi đè quyền nhóm | resolver lấy `max` qua mọi nguồn | `service/document_permissions.go:131-177` |
| BR-05/06, UC16/17, AC16 — membership động | share nhóm áp cho thành viên hiệu lực **lúc đọc** (`shareAppliesTo`) | `document_permissions.go:185+` |
| BR-09, UC15, AC11 — share không di chuyển tài liệu | share chỉ là dòng `document_shares` | — |
| BR-11, UC12, AC07 — thu hồi một nguồn không xóa nguồn khác | thu hồi một dòng; mức tính lại lúc đọc | `document_shares.go` `RevokeDocumentShare` |
| BR-12, UC19, AC17 — kiểm quyền ở mọi thao tác | mọi route đi qua `authorizeDocument`/`withDocumentMutation` | `document_permissions.go:290-485` |
| Q08 — không share cho người ngoài tổ chức | `422 principal_not_in_organization` | `document_shares.go:31-33` |
| FR-12, UC14, AC10 — public link theo chính sách tổ chức, chặn cả API | công tắc tổ chức + entitlement `documents.public_links` ở mọi lệnh link và mọi lần đọc công khai; chỉ xem; hạn 1–90 ngày (mặc định 7); tối đa 5 link sống; thu hồi được | `service/document_links.go:21-36, 63-80`; SDI `dto/sdi/document.go:251` |
| Q01, Q13, Q14 — mức Comment; admin không đọc tài liệu riêng tư; không Deny | DOC-05/G8-18 (chưa merge) | phụ lục mức quyền §1, §4 |
| FR-14 (phần chính) — audit cấp/thu hồi kèm mức trước/sau, principal | `document.shared` (`Changes{level}` trước→sau, `principal_type/id`), `document.share_revoked` | `document_shares.go:104-124, 186-210` |

### 0.2 Lệch — cần sửa

| # | SRS | Hiện trạng | Sửa ở |
| --- | --- | --- | --- |
| L1 | Bỏ Visibility như nguồn quyền độc lập; quyền Workspace quản lý trong danh sách (§1.3, §4.2, BR-07, BR-10, Q05) | `visibility=workspace` ngầm cấp **edit** cho mọi thành viên hiệu lực (`document_permissions.go:142-143`), quản lý ở khối Visibility riêng (`share-dialog.tsx:383-388, 404-476`); share cho chính workspace chứa tài liệu vẫn tạo được → hai nguồn trùng nhau | Mục 3 |
| L2 | BR-07, Q04 — tài liệu không tự có quyền theo nơi lưu | gốc rỗng = `workspace` (`document_pages.go:234-236`); DOC-02 giữ mặc định đó | Mục 4 |
| L3 | FR-02..FR-05 — một ô tìm chung, chọn nhiều, quyền chung + quyền riêng, tổng kết, đánh dấu đã có quyền; NFR-04 tìm phía server | mỗi lần một principal: Select loại → Select đối tượng (`share-dialog.tsx:281-381`); người chỉ lấy từ các trang `useOrgMembers` đã tải (`:83, 92-95`), không tìm phía server | Mục 5, 6.2 |
| L4 | FR-06, Q16 — chia sẻ theo lô | chỉ có `POST …/shares` từng principal | Mục 6.1 |
| L5 | BR-04, AC13 — cấp lại cho đối tượng đã có quyền: người dùng chọn cập nhật hay giữ | server **âm thầm thay** mức cũ, kể cả hạ mức (`document_shares.go:77-90`) | Mục 6.1 (`on_existing`) |
| L6 | FR-08/09, UC12, UC20 — đổi mức tại dòng, xem trước kết quả, báo "A vẫn xem được qua Workspace" | mỗi dòng chỉ có nút Thu hồi (`share-dialog.tsx:253-269`), không đổi mức tại chỗ, không xem trước | Mục 5.2, 6.1 (`dry_run`) |
| L7 | FR-07, UC11, NFR-03 — nguồn quyền + quyền thực tế, cảnh báo chồng chéo | dòng người có `effective_level` + **một** `effective_via` (`document_shares.go:214-225`, `share-dialog.tsx:247-251`) | Mục 6.3 |
| L8 | FR-10, AC19 — danh sách Documents thể hiện phạm vi chia sẻ | không có; DOC-02 chỉ thêm huy hiệu "Hạn chế" | Mục 7 |
| L9 | FR-13 — thông báo khi được chia sẻ trực tiếp | không có kind `document_shared` (`notification/kinds.go:12-56`) | Mục 8 |
| L10 | FR-11, AC20 — "Lưu tại" tách khỏi "Chia sẻ" và "Liên kết Project" | chưa có liên kết tài liệu ↔ Project có cấu trúc (phụ lục truy cập §0.3); tài liệu thuộc Work Product lấy quyền qua resolver (§13.4) | Mục 5.3, Q-S7 |
| L11 | FR-14 — trường `Result: Thành công/Thất bại` | audit ghi trong cùng tx với thay đổi (ADR 0009/0012), lệnh thất bại không để lại dòng | Q-S4 |
| L12 | Q17 — hạn chế Manage cho cả Organization | `manage` cấp được cho mọi `principal_type` | Q-S1 |

## 1. Quyết định

### 1.1 Đã chốt (user, 2026-10-15)

| Mã | Câu hỏi SRS | Chốt |
| --- | --- | --- |
| U-SH1 | L1 — mô hình Visibility | **Dòng Workspace gốc**: giữ cột `documents.visibility`, thêm mức cho nó, UI hiện như một dòng trong danh sách quyền; bỏ khối Visibility (mục 3) |
| U-SH2 | Q04 — mặc định khi tạo | **Riêng tư**: tài liệu mới ở gốc không có dòng Workspace gốc; chỉ chủ sở hữu (mục 4) |
| U-SH3 | Q16 — lô có đối tượng lỗi | **Tất cả hoặc không**: một đối tượng lỗi → không lưu gì, báo từng đối tượng lỗi (mục 6.1) |
| U-SH4 | Q06 — người không quản lý thấy gì | **Chỉ quyền của mình** (+ nguồn của mình); trên danh sách Documents thấy loại phạm vi và số lượng, không thấy tên (mục 5.2, 7) |
| U-SH5 | Q-S6 — agent với tài liệu riêng tư | Agent tự chạy là **đối tượng được share** (như một người); mức Nhận xét/Chỉnh sửa nghĩa là agent được **đề xuất** bình luận/bản sửa, người có quyền tương ứng xác nhận rồi mới ghi — đúng [ADR 0010](../../adr/0010-ai-khong-ghi-truc-tiep-de-xuat-xac-nhan-thuc-thi.md), không ghi trực tiếp (user chốt lại 2026-10-15, bỏ phương án ghi trực tiếp và bản nháp ADR 0035) (mục 6.6) |
| U-SH6 | Agent có được Quản lý không | **Không**, tối đa Chỉnh sửa |

### 1.2 Theo SRS, không cần hỏi lại

Q02 cộng dồn (đã đúng) · Q03 Person View không ghi đè Workspace Edit (đã đúng) · Q05 Restricted không còn là cấu hình riêng (U-SH1) · Q07 membership động (đã đúng) · Q08 không có khách ngoài tổ chức (đã đúng) · Q09 Project không là principal · Q10 public link chỉ View (đã đúng) · Q13 theo DOC-05 · Q14 không Deny · Q15 kế thừa thư mục đặc tả riêng (share vẫn không kế thừa, C-01 §4) · Q18 offline theo SRS Offline/Sync (Office lease giữ luật phụ lục mức quyền §1).

## 2. Thuật ngữ (vi/en)

| Khái niệm | vi | en | Ghi chú |
| --- | --- | --- | --- |
| dòng Workspace gốc | **Workspace "{{name}}"** + nhãn phụ "Nơi lưu" | Workspace "{{name}}" · "Home" | nguồn quyền của mọi thành viên workspace chứa tài liệu; lưu ở `visibility` + `workspace_level` |
| riêng tư | **Riêng tư** | Private | trạng thái hiển thị, **không** phải cấu hình: không có dòng Workspace gốc, không share sống, không link sống (BR-10). Thay chữ "Hạn chế"/"Restricted" ở mọi bề mặt người dùng; giá trị wire `restricted` giữ nguyên |
| mức | Chỉ xem / Nhận xét / Chỉnh sửa / Quản lý | View / Comment / Edit / Manage | khóa `documents.share.level_*` (thêm `comment` do DOC-05 (b)) |
| nguồn quyền | Trực tiếp / Qua Workspace "X" / Qua tổ chức / Chủ sở hữu / Quản trị viên / Truy cập khẩn cấp / Theo kết quả công việc | Direct / Via workspace "X" / Via organization / Owner / Admin / Emergency access / Via work product | |

W-card chép hai dòng đầu vào `docs/conventions.md` (glossary) cùng commit với chuỗi.

## 3. Dòng Workspace gốc (U-SH1)

**Lưu trữ:** migration `999<ms>_documents_workspace_level.up.sql` thêm `workspace_level TEXT NOT NULL DEFAULT 'edit'` + CHECK `('view','comment','edit')` vào `documents`. Nghĩa: chỉ có hiệu lực khi `visibility = 'workspace'`; khi `restricted` cột bị bỏ qua. Mặc định `'edit'` làm migration **trung tính về quyền**: mọi dòng có sẵn giữ đúng `edit` như `document_permissions.go:142-143` hôm nay. Không có `manage` cho dòng gốc (Q-S1). Không index mới (cột không lọc riêng).

**Đọc quyền (một nơi, nhiều chỗ gọi):**
- `resolveLevelInTenant` `document_permissions.go:142-143`: `best = DocumentLevel(doc.WorkspaceLevel)` thay `DocumentLevelEdit`, `via=member`.
- `listRowAccess` `document_list_access.go:58-59` (và change feed dùng lại, `document_changes_feed.go:342`): cùng thay.
- Lọc theo mức tối thiểu: nhánh `member_visible` của `document_search.sql:34, 73, 173, 204` và `document_changes.sql:34` hôm nay chỉ kiểm `d.visibility = 'workspace'`, đủ cho `min=view`. Khi gọi với `min > view` (`shareLevelsFor`, `document_search.go:220-229`), thêm vị từ `d.workspace_level = ANY(sqlc.arg(share_levels))` vào nhánh đó. Thẻ code grep mọi lời gọi `memberVisible` (`document_search.go:127, 189, 213`) để không bỏ sót.
- Chỗ chỉ cần "đọc được" (chat link preview, Work Graph, task views: `chat*.sql`, `graph*.sql`, `task_views.sql`, `document_sources.sql`, `document_mentions.sql`) **không đổi**: mọi `workspace_level` đều ≥ view.
- Agent: giữ luật hôm nay (`document_permissions.go:120-126`): thấy tài liệu có dòng gốc ở mức `view`, không thấy tài liệu riêng tư.
- DOC-05: `AdminScope` vẫn khóa theo `visibility = restricted` = "không có dòng gốc". Không đổi hợp đồng phụ lục mức quyền.

**Ghi:**
- `PUT …/access` (mục 6.1) với principal `workspace` = `doc.workspace_id`: `level` ∈ view/comment/edit → `visibility='workspace', workspace_level=level`; `level=null` (thu hồi) → `visibility='restricted'`. Mở rộng (riêng tư → có dòng gốc) theo luật DOC-05: admin chỉ có `AdminScope` bị `403 break_glass_required`.
- **Gộp trùng (BR-04, L1):** `POST …/shares` và `PUT …/access` với principal `workspace` = workspace chứa tài liệu **không** chèn dòng `document_shares`; chúng ghi vào dòng gốc. Share sống có sẵn cho chính workspace gốc (dữ liệu cũ) được hiện **gộp** vào dòng gốc với mức `max(workspace_level nếu có, share.level)`; lần ghi đầu tiên vào dòng gốc thu hồi share đó trong cùng tx (có audit). Không migration dữ liệu.
- `PATCH /documents/{id}` `visibility` (client cũ, desktop/fork) giữ nguyên nghĩa: `workspace` bật dòng gốc với `workspace_level` đang lưu, `restricted` tắt.
- Audit: action mới `document.workspace_access_changed` (`Changes{visibility, workspace_level}` trước→sau, `Metadata{batch_id?}`) cho mọi lần đổi dòng gốc (kể cả qua `PATCH`), topic outbox cùng tên ở 3 nơi catalogue (`document_id`, `workspace_id`; `ScopeWorkspace`), client invalidate như `document.updated` đổi visibility hôm nay. Change feed coi sự kiện này như đổi `visibility` hiện có (thẻ code đọc lại `document_changes_feed.go` để giữ đúng hành vi xóa khỏi feed khi mất quyền).

## 4. Mặc định Riêng tư khi tạo (U-SH2)

**Server:** ở `document_pages.go:234-236` và nhánh tương ứng của tạo tệp / tệp trống (`document_files.go:377-386`, `document_office_capability.go:284-300`), gốc với `visibility` rỗng → `restricted` (thay `workspace`). Dưới cha: `visibility` rỗng vẫn **kế thừa cha** (cả `workspace_level` của cha), như luật C-01 §4. Tài liệu mới tạo luôn ghi `workspace_level` (cha, hoặc `'view'` khi bật ở gốc — Q-S3). Bản sao giữ `visibility`/`workspace_level` của nguồn (`document_copy.go:178`, `document_copy_convert.go:156`). Tài liệu thuộc Work Product không đổi (`CreateOwnedDocumentInTx`). Không đụng dữ liệu cũ.

**Tác động phải chấp nhận (ghi rõ để nghiệm thu):**
- Thành viên khác **không thấy** tài liệu mới ở gốc trong thư viện/cây/tìm kiếm cho tới khi được chia sẻ.
- Agent, Ask UNI, AI context, Work Graph projection theo luật "agent không thấy tài liệu riêng tư" → tài liệu mới ở gốc vô hình với agent cho tới khi có dòng gốc (Q-S6).
- Admin workspace (DOC-05) chỉ có `AdminScope` trên mọi tài liệu mới ở gốc; đọc nội dung cần break-glass.
- Client cũ (tab chưa tải lại, desktop/fork) tạo không gửi `visibility` → ra riêng tư theo server; không cần capability cho riêng thay đổi mặc định.

**DOC-02 đảo chiều** (thay phụ lục truy cập §1; ghi chú đã thêm ở đó):
- Công tắc **"Chia sẻ với workspace"** (thay "Hạn chế"), mặc định **tắt** mỗi lần mở; bật → gửi `visibility:"workspace"` (+ `workspace_level` theo Q-S3). Vai trò a11y, bề mặt và cơ chế capability `documents.create_visibility` cho route tệp giữ như phụ lục truy cập §1 (`F-01`, `F-03`, `F-11`).
- Trong cha có dòng gốc: công tắc hiện **bật và khóa** với gợi ý "Thư mục này đang chia sẻ với workspace nên tài liệu mới cũng vậy"; trong cha riêng tư: tắt, bật được.
- Bỏ toast "Đã tạo ở chế độ Hạn chế" (mọi lần tạo đều riêng tư, toast sẽ thành nhiễu); nút "Chia sẻ" trên màn tài liệu là đường chính. `?share=1` vẫn giữ cho lối "Tạo rồi chia sẻ" nếu W-card muốn dùng.
- Huy hiệu hàng "Hạn chế" thay bằng huy hiệu phạm vi (mục 7).
- Chuỗi: `documents.home.create.share_workspace_toggle` "Chia sẻ với workspace" / "Share with workspace"; `…_hint` "Mọi thành viên của workspace này sẽ {{level}} tài liệu mới" / "Everyone in this workspace can {{level}} new documents"; `…_inherited` như trên. Sửa `documents.share.visibility_restricted_hint` không còn cần (khối Visibility bị bỏ) — xóa khóa cùng thẻ W.

## 5. Popup Chia sẻ mới (SH-01..09, §4.1)

Thay `share-dialog.tsx` (477 dòng) bằng vỏ hộp + ba file con (luật 500 dòng): `share-add-section.tsx`, `share-access-list.tsx`, `share-links-section.tsx` (có sẵn). Mount và cổng theo phụ lục truy cập §2.5 (`canAdministerDocument`, `ShareDialogTarget`).

### 5.1 Khu vực 1 — Thêm người hoặc nhóm (FR-02..06)

- **Một ô tìm** (combobox có nhãn, `aria-autocomplete="list"`) gọi `GET …/share-candidates?q=` (mục 6.2), debounce 250 ms, tải thêm khi cuộn; kết quả **nhóm** theo Người / Workspace / Tổ chức với tiêu đề nhóm; mỗi hàng có tên + loại + biểu tượng; hàng đã có quyền trực tiếp có nhãn "Đã có quyền: {{level}}" (FR-02 quy tắc 4); chọn Workspace/Tổ chức có dòng phụ "Toàn bộ thành viên của …" (FR-02 quy tắc 5).
- Chọn → chip trong vùng người nhận; không chọn trùng; bỏ chip bằng nút `×` có nhãn; vùng chip cuộn khi nhiều (`max-h`, không tràn hộp — NFR-03); đếm "Đã chọn {{count}}".
- **Quyền chung** (Select, mặc định **Chỉ xem**, tối đa mức người gọi được cấp theo Q-S1) áp cho mọi chip chưa có quyền riêng (FR-04).
- **"Thiết lập quyền riêng"** mở danh sách chip thành bảng (tên · loại · Select mức); đổi một hàng không đổi hàng khác; tổng kết trực tiếp "3 Chỉnh sửa · 7 Chỉ xem" (`role="status"`). Đổi quyền chung **không** ghi đè hàng đã đặt riêng; nút "Áp dụng cho tất cả" hỏi xác nhận khi sẽ thay quyền riêng (FR-04 đề xuất UX).
- **Đã có quyền trực tiếp (BR-04):** chip của đối tượng đã có share sống hiện lựa chọn "Cập nhật thành {{level}}" / "Giữ {{current}}" (mặc định Giữ) → gửi `on_existing`.
- Bấm **Chia sẻ** → gọi `PUT …/access` với `dry_run:true`; nếu phản hồi có cảnh báo (phạm vi rộng Workspace/Tổ chức — SH-14; quyền thực tế khác quyền chọn do quyền nhóm — FR-06 quy tắc 5; hạ quyền) thì mở bước xác nhận liệt kê cảnh báo; xác nhận → gọi lại không `dry_run`. Không cảnh báo → gửi thẳng.
- Kết quả: thành công → xóa chip, toast "Đã chia sẻ cho {{count}} đối tượng", danh sách quyền làm mới; lô bị từ chối (U-SH3) → giữ nguyên chip, đánh dấu đỏ **từng** chip lỗi kèm lý do (chữ, không chỉ màu), không lưu gì, không toast thành công (FR-06 quy tắc 1-3).
- Chờ server, không lạc quan (State Rules): nút `aria-disabled` + `<Spinner />`.

### 5.2 Khu vực 2 — Quản lý quyền truy cập (FR-07..09)

- Thứ tự: Chủ sở hữu (không có dropdown — FR-08 quy tắc 4; nút "Chuyển quyền sở hữu" của DOC-06) → dòng Workspace gốc (nhãn "Nơi lưu") → Người → Workspace khác → Tổ chức → (DOC-05) "Truy cập khẩn cấp đang mở". Danh sách dài có ô lọc tại chỗ khi > 20 dòng (NFR-04).
- Mỗi dòng: tên, loại, **Select mức** (đổi tại chỗ) và "Thu hồi". Dòng người hiện "Quyền thực tế: {{level}}" khi khác mức trực tiếp, và nút mở **chi tiết nguồn** (danh sách `sources`, mục 6.3). Cảnh báo `direct_below_group` (UC11): "{{name}} vẫn có quyền {{level}} qua {{source}}" ngay dưới dòng.
- Đổi mức / thu hồi → `dry_run` trước; hộp xác nhận hiện **kết quả dự kiến** (FR-08 bước 5, FR-09 bước 4): với người: "Sau khi thu hồi, {{name}} vẫn {{level}} qua {{source}}" hoặc "{{name}} sẽ không còn quyền truy cập"; với Workspace/Tổ chức: "{{count}} thành viên sẽ mất quyền, trừ người có nguồn khác" (UC20). Sau khi lưu, toast dùng đúng câu đó ở thì quá khứ (FR-09 yêu cầu: "Đã thu hồi quyền chỉnh sửa trực tiếp. A vẫn có thể xem tài liệu thông qua Workspace.").
- **Người không quản lý (U-SH4):** hộp mở được (thay `manage_only` ở `share-dialog.tsx:182-185`) nhưng chỉ có thẻ "Quyền của bạn: {{level}}" + danh sách nguồn của chính họ; không Khu vực 1, không danh sách người khác, không link.

### 5.3 Khu vực 3 — Truy cập bằng liên kết (FR-12)

Giữ `share-links-section.tsx`; thêm dòng chính sách: "Tổ chức cho phép / không cho phép liên kết công khai" (đọc từ setting đã có) và nút tới cài đặt chỉ cho người có quyền đổi. Đầu hộp có dòng thông tin **"Lưu tại: Workspace {{name}}"** tách khỏi phần chia sẻ (FR-11, §4.2 quy tắc 3).

## 6. Hợp đồng wire

Mọi route mới qua wrapper `api` trong `router/documents.go`, `apiOp{sdi, sdo, …}`, `decode(w, r, &in, limit)`; SDI/SDO có `description` + `example`.

### 6.1 `PUT /api/v1/documents/{documentID}/access` — ghi theo lô, tất cả hoặc không

> **Dựng trên UNI-1641** (lane `doc-share_local`, nhánh `feature/UNI-1641-batch-share`, đang ở stage visual, chưa vào root): lane đó thêm `POST …/shares/batch` (chỉ người, một mức chung, 1–50 id, tất cả hoặc không, `422 principal_not_in_organization` kèm `principal_ids`), tách thân share thành helper `applyDocumentShare` dùng chung, và component `share-people-picker.tsx` (tìm, chip, chọn nhiều). SH-S2 **dùng lại** helper và cách kiểm-hết-rồi-mới-ghi đó cho `PUT …/access`; SH-W1 dùng lại `share-people-picker.tsx` làm ô tìm người của Khu vực 1 (mở rộng thêm nhóm Workspace/Tổ chức/Agent). `POST …/shares/batch` giữ nguyên cho client đã dùng nó; web chuyển sang `PUT …/access` khi SH-W1 vào. `shareDocumentInTx` ở dưới = `applyDocumentShare` của UNI-1641 (một helper, không tách lần hai).

SDI `UpdateDocumentAccessSDI{ items: [{ principal_type "user|workspace|organization"; principal_id ULID; level *string "view|comment|edit|manage; null = thu hồi"; on_existing *string "update (mặc định khi đổi mức tại dòng) | keep" }] (1–100); dry_run bool }`.
- Cổng: `withDocumentAdministerMutation` (DOC-05 `canAdminister()`); một tx, khóa dòng tài liệu một lần.
- Kiểm **toàn bộ** trước khi ghi: allowlist mức (gồm Q-S1), `validateSharePrincipal`, không trùng principal trong lô, DOC-05 tự cấp (`break_glass_required`), Work Product (`409`). Có lỗi bất kỳ → **422 `document_access_rejected`** với `rejected: [{index, principal_type, principal_id, code}]` (`code` ∈ `principal_not_in_organization`, `level_not_allowed`, `duplicate_principal`, `break_glass_required`), không ghi gì (U-SH3). Mã không phân lớp có chủ đích (như `owner_target_not_member`, phụ lục truy cập §4.2): thêm vào khối chú thích "Deliberately unclassified" ở `dto/sdo/error_class.go` và `unclassified` của bộ quét DOC-05.
- Ghi từng mục bằng thân share theo tx `shareDocumentInTx` (phụ lục truy cập §3.1, tách ở thẻ nào merge trước) hoặc dòng gốc (mục 3); `on_existing=keep` với principal đã có share sống → bỏ qua mục đó (kết quả `kept`). Audit/outbox như lệnh lẻ, thêm `Metadata{batch_id}` (ULID mỗi lần gọi).
- SDO `DocumentAccessUpdateSDO{ batch_id; results: [{index, status: "granted|updated|revoked|kept|unchanged"}]; preview: DocumentAccessPreviewDTO }`. Với `dry_run:true`: không ghi, không audit, trả `preview` + `warnings`.
- `DocumentAccessPreviewDTO{ users: [{user_id, before:{level, via}, after:{level, via}}] (chỉ principal `user` trong lô); groups: [{principal_type, principal_id, member_count, losing_count}] (đếm bằng một câu SQL, không trả tên — NFR-04); warnings: [{code: "wide_scope|direct_below_group|downgrade", index}] }`.
- Route cũ `POST/DELETE …/shares` và `PATCH` visibility **giữ** (client cũ, desktop/fork); `POST …/shares` thêm hai thay đổi: gộp dòng gốc (mục 3) và luật Q-S1. Hành vi "cấp lại thay mức cũ" của route cũ giữ nguyên (client cũ không có `on_existing`); web mới chỉ dùng `PUT …/access`.

### 6.2 `GET /api/v1/documents/{documentID}/share-candidates?q=&cursor=&limit=`

- Cổng `authorizeDocumentViewOrAdminister` + `canAdminister()`; người không quản lý → `403`.
- Trả trang (mặc định 20, tối đa 50) gồm: người (thành viên **đang hoạt động** của tổ chức tài liệu, khớp `display_name`/email bằng `uw_fold_search`), workspace của tổ chức, và chính tổ chức; mỗi mục `{principal_type, principal_id, name, secondary, direct_level|null, is_home_workspace bool}`; `next_cursor`. Không trả agent. Query sqlc mới ràng buộc `organization_id` (`TestEveryQueryNamesItsTenant`).

### 6.3 `GET /documents/{documentID}/shares` (đã có) — thêm trường

- `home_workspace: {workspace_id, workspace_name, level|null}` (mục 3; gộp share trùng).
- Dòng `user`: `sources: [{via, principal_type?, principal_id?, level}]` — mọi nguồn đang có hiệu lực (trực tiếp, workspace gốc, workspace khác, tổ chức, chủ sở hữu, quản trị viên, break-glass, Work Product); `effective_level` giữ. `warnings: ["direct_below_group"]` khi mức trực tiếp < mức thực tế.
- `my_sources` cho **mọi** người gọi đọc được; người không `canAdminister()` chỉ nhận `my_level` + `my_sources` (U-SH4).
- Tính `sources` trong service (`DocumentAccessList`, `document_shares.go:244+`) bằng cùng `shareAppliesTo` của resolver, không thêm đường tính quyền thứ hai.

### 6.4 Danh sách tài liệu — phạm vi chia sẻ (FR-10)

`DocumentSummaryDTO` (list, recent, shared-with-me, children) thêm `share_scope: {home_workspace bool; users int; workspaces int; organization bool; public_link bool}` — tính bằng **một** câu tổng hợp cho cả trang (`document_shares` sống + link sống + cột dòng gốc), ràng buộc `organization_id`. Trả cho mọi người đọc được dòng đó (chỉ loại + số, không tên — U-SH4). Agent không nhận trường này.

### 6.5 Isolation, catalogue, kiểm thử hợp đồng

- `isoRoutes`: `PUT …/access`, `GET …/share-candidates` có control (owner của B trên tài liệu của B). `isoReferences`: `UpdateDocumentAccessSDI.items[].principal_id` (người/workspace của A trong lô của B → 422 `document_access_rejected` không lộ tên) — thẻ code kiểm bộ quét `TestEveryBodyIDFieldHasAReferenceCase` có duyệt trường lồng trong mảng không; nếu không, mở rộng bộ quét hoặc thêm case tường minh, ghi lý do.
- `pathParamSDI`: không cần case mới (`documentID` có sẵn).
- Catalogue 3 nơi: `document.workspace_access_changed`. `audit/actions.go` + `audit_coverage_test.go`: action `document.workspace_access_changed`.
- `packages/core/api/endpoints/documents*.ts`: hàm + schema + case malformed cho `share-candidates`, `access` (kể cả `rejected`, `preview`), `home_workspace`, `sources`, `my_sources`, `share_scope`.

### 6.6 Agent là đối tượng được share (U-SH5, U-SH6; theo ADR 0010)

- `principal_type = "agent"` cho `PUT …/access`, `POST …/shares`, `share-candidates` (agent của tổ chức, kiểm qua `workspace_agent_members`/`RequireAgentMember` của một workspace trong tổ chức); mức `view | comment | edit`, `manage` → `level_not_allowed`. CHECK `document_shares.principal_type` mở thêm `agent` (migration `999<ms>_`).
- Resolver: actor `agent` lấy mức cao nhất giữa (a) luật hôm nay — tài liệu có dòng gốc → `view` (share Workspace/Tổ chức cho agent cũng tối đa `view`) — và (b) share **trực tiếp** cho agent đó (đến `edit`). Tài liệu riêng tư không có share trực tiếp → agent vẫn không thấy.
- Kiểm thêm mỗi lần agent đọc hoặc tạo đề xuất: người khởi chạy lượt chạy (hoặc owner của agent) đọc được tài liệu (ADR 0010 điểm 6); thiếu → từ chối như không có quyền.
- **Ghi = đề xuất (ADR 0010 điểm 1–4):** agent không gọi lệnh ghi nghiệp vụ. Với share `comment` agent tạo đề xuất bình luận/trả lời; với `edit` agent tạo thêm đề xuất sửa nội dung (bản sửa kèm `revision` đã đọc). Đề xuất nằm trong `action_proposals` (`proposed → confirmed | rejected → executed | failed`, `created_by_kind=agent`). Người xác nhận phải giữ mức tương ứng trên tài liệu lúc xác nhận (Nhận xét cho đề xuất bình luận, Chỉnh sửa cho đề xuất sửa); bước `executed` do `DocumentService` chạy với actor là **người xác nhận**, `confirmed_by` = người đó, audit ghi cả agent đề xuất. Đề xuất sửa có `revision` lệch lúc xác nhận → `failed` (`document_version_conflict`), agent đề xuất lại. Mỗi lần thực thi là một phiên bản mới, hoàn tác bằng khôi phục phiên bản (điểm 5). Ngoại lệ tự chạy của điểm 3 (rủi ro thấp + policy tổ chức) **không** bật cho tài liệu trong phạm vi này.
- UI: picker có nhóm **Agent** (biểu tượng `MODULE_ICONS` của agent + chữ "Agent"); dòng agent trong danh sách quyền chỉ có Chỉ xem / Nhận xét / Chỉnh sửa; huy hiệu phạm vi đếm agent vào "người" hay nhóm riêng — chọn **nhóm riêng** "{{count}} agent" để người dùng thấy rõ AI có quyền. Đề xuất của agent hiện trong tài liệu (gợi ý sửa / bình luận chờ duyệt) với nút "Áp dụng" / "Bỏ qua" cho người đủ mức, và trong Hộp việc của người quản lý tài liệu.
- Isolation: agent của tổ chức A trong lô của B → `422` (`isoReferences` cùng trường `principal_id`).

## 7. Huy hiệu phạm vi trên danh sách (FR-10, SH-13)

- Một component `DocumentShareScopeBadge` trong `packages/views/documents/` đọc `share_scope` và `visibility`; dùng ở thư viện, cây, kết quả tìm kiếm, "Được chia sẻ với tôi".
- Nhãn (biểu tượng + chữ, không chỉ màu): **Riêng tư** (không gì cả) · **{{count}} người** · **Workspace** · **Tổ chức** · **Nhiều phạm vi** (≥ 2 nhóm trong {người, workspace (gốc hoặc khác), tổ chức}) · thêm dấu **Liên kết công khai** cạnh nhãn khi `public_link`. Không chỉ hiện nguồn hẹp nhất.
- Tooltip / `aria-describedby` liệt kê đủ: ví dụ "Workspace Kinh doanh · Workspace HR · 5 người · Liên kết công khai" (tên workspace gốc lấy từ ngữ cảnh; tên workspace khác **không** có trong `share_scope` → hiện "{{count}} workspace khác").
- Thay huy hiệu "Hạn chế" của W-DOC02 (`F-14`): W-DOC02 không làm huy hiệu; thẻ SH-W2 là chủ sở hữu duy nhất.

## 8. Thông báo khi được chia sẻ (FR-13)

- Kind mới `document_shared` (đồng bộ đủ nơi như phụ lục mức quyền §4: `notification/kinds.go`, `prefs.go` push bật, `titles.go` + test, `push_consumer.go`, `packages/core/types/notification.ts`, renderer `packages/views/notifications/*`).
- Nguồn: `document.shared` với principal `user` **và** mức thực tế của người nhận **tăng** so với trước lệnh (service ghi `Metadata{notify: true}`/payload id-only `notify_user_id` — thẻ code chọn cách phù hợp luật ids-only; mức trước tính trong tx). Không gửi khi: share Workspace/Tổ chức (FR-13 quy tắc 2), người nhận đã có mức ≥ từ nguồn khác (quy tắc 3), hạ mức/thu hồi (Q-S2), lô bị từ chối (không có gì commit — quy tắc 1).
- Rule kiểm lại `DocumentReadChecker.CanReadDocument` lúc gửi; liên kết mở tài liệu, cổng đọc chạy lại khi mở (quy tắc 5).
- Tiêu đề: `"{{actor}} đã chia sẻ tài liệu “{{document}}” với bạn. Quyền: {{level}}."` / `"{{actor}} shared “{{document}}” with you ({{level}})."`; ngắn: `"Tài liệu được chia sẻ"` / `"Document shared"`. `group_key = document:{id}:shared`.

## 9. Tác động lên thẻ đã lên kế hoạch

| Thẻ | Thay đổi |
| --- | --- |
| DOC-05 (a) server | Không đổi hợp đồng. SH-S1 rebase lên (a) (cùng chạm `document_permissions.go`, `document_list_access.go`, `document_search.go`/`.sql`, `document_shares.go`) |
| DOC-05 (b) web | Không đổi hợp đồng. SH-W1 viết lại `share-dialog.tsx` **sau** khi (b) merge, giữ: mức `comment`, `selfShareError`, mục break-glass, `DocumentLockedCard` |
| S-DOC02 / W-DOC02 | Đảo theo mục 4: mặc định riêng tư, công tắc "Chia sẻ với workspace", bỏ toast + huy hiệu "Hạn chế". S-DOC02 gộp với SH-S1 (cùng chạm đường tạo) |
| S-DOC06 / W-DOC06 | Không đổi; dòng chủ sở hữu trong danh sách mới giữ nút "Chuyển quyền sở hữu" |
| S-DOC07 / W-DOC07 | Không đổi; mục "Yêu cầu truy cập" đặt trong Khu vực 2. Duyệt yêu cầu dùng `shareDocumentInTx` chung với `PUT …/access` |
| G8-18 "Chia sẻ quyền Xem rồi gửi" | Giữ `POST …/shares` từng người (không cần lô); không đổi |

## 10. Quyết định theo đề xuất (user chốt 2026-10-15: "theo đề xuất")

- **Q-S1 (SRS Q17) — Manage cho nhóm:** chốt: **chặn Manage cho Tổ chức và cho dòng Workspace gốc** (tối đa Chỉnh sửa; `level_not_allowed`), **cho phép** Manage cho Workspace khác kèm cảnh báo `wide_scope`. Share Manage cũ cho tổ chức giữ hiệu lực (không sửa dữ liệu), dropdown dòng đó hiện mức hiện có nhưng không chọn lại được Manage.
- **Q-S2 (SRS Q12) — Thông báo nâng/hạ/thu hồi:** chốt: **chỉ báo khi được cấp mới hoặc nâng mức** (mục 8); hạ mức và thu hồi không báo.
- **Q-S3 — Mức của dòng gốc khi bật "Chia sẻ với workspace" lúc tạo:** chốt: **Chỉ xem** (khớp SRS "mặc định View"; người tạo nâng lên Chỉnh sửa trong hộp Chia sẻ).
- **Q-S4 (FR-14 Result=Thất bại):** chốt: **không** ghi lệnh thất bại vào `audit_events` (ADR 0009/0012: audit đi cùng thay đổi trong tx); lần từ chối có trong access log của request (`correlation_id`). Muốn có dòng "thất bại" thì cần ADR mới cho một bảng nhật ký riêng.
- **Q-S5 (SRS Q11) — Nhiều public link:** chốt: **giữ tối đa 5 link sống** như hôm nay.
- ~~Q-S6~~ — **đã chốt** (U-SH5, U-SH6). Ghi chú: AI chạy thay người dùng (Ask UNI với `ActorID = UserID` ở `askuni_sources.go:68`, AI trong editor Office, connector MCP theo ADR 0031/0033) đọc đúng quyền của người dùng nên không bị ảnh hưởng bởi mặc định riêng tư; chỉ agent tự chạy cần share (mục 6.6).
- **Q-S7 (FR-11, AC20) — Tài liệu thuộc Work Product:** quyền đi qua resolver của sản phẩm (§13.4), không phải "liên kết Project". Chốt: **giữ**, hiện như nguồn "Theo kết quả công việc" trong `sources`; "liên kết Project" có cấu trúc để sau (SRS §2.2).
- **Q-S8 — Agent nhận quyền qua share nhóm:** chốt: share Workspace (kể cả dòng gốc) và Tổ chức cho agent tối đa **Chỉ xem**; quyền đề xuất bình luận/sửa của agent chỉ đến từ share trực tiếp cho agent đó (mục 6.6).

## 11. Tách thẻ code và thứ tự

| Thẻ | Lane | Phạm vi chính | Phụ thuộc |
| --- | --- | --- | --- |
| **SH-S1** (UNI-1780) model + mặc định | server | migration `workspace_level`; resolver, `listRowAccess`, search/changes `member_visible` + mức; gốc rỗng → `restricted` (3 route tạo); gộp share trùng dòng gốc; `PATCH` visibility; audit/outbox `document.workspace_access_changed`; gộp S-DOC02 (trường `visibility` cho route tệp + capability) | DOC-05 (a) merged |
| **SH-S2** (UNI-1781) lô + xem trước + nguồn | server | `PUT …/access` (+`dry_run`, preview, warnings, Q-S1), `GET …/share-candidates`, `sources`/`my_sources`/`home_workspace` trong `GET …/shares`, `shareDocumentInTx` (nếu S-DOC07 chưa tách), isolation, error_class | SH-S1; UNI-1641 (`applyDocumentShare`, `/shares/batch`) đã vào root |
| **SH-S3** (UNI-1782) phạm vi + thông báo | server | `share_scope` trong `DocumentSummaryDTO`; kind `document_shared` đủ nơi | SH-S1 (song song SH-S2, khác file trừ catalogue/notification — merge tuần tự) |
| **SH-W1** (UNI-1784) popup Chia sẻ | web | mục 5 (ba khu vực, tách file), endpoints + hooks + malformed test, locales vi/en, glossary | DOC-05 (b) và UNI-1641 (`share-people-picker.tsx`) đã vào root; hợp đồng SH-S2 (làm trên fake được) |
| **SH-W2** (UNI-1785) huy hiệu phạm vi + W-DOC02 đảo | web | mục 7; công tắc "Chia sẻ với workspace" (mục 4) | SH-S1 (công tắc), SH-S3 (huy hiệu) |
| **SH-W3** (UNI-1786) Inbox `document_shared` | web | renderer + test | SH-S3 |
| **SH-S4** (UNI-1783) agent là đối tượng share | server | mục 6.6: `principal_type=agent`, resolver agent, kiểm người khởi chạy, loại đề xuất tài liệu (bình luận, sửa nội dung) trong `action_proposals` + thực thi bằng actor người xác nhận, test ADR 0010 (runtime không ghi nghiệp vụ, không đặt `accepted`) | hạ tầng `action_proposals` của agent runtime (ADR 0010; chưa có trong cây); SH-S2 |
| **SH-W4** (UNI-1787) agent trong popup Chia sẻ + duyệt đề xuất | web | nhóm Agent trong picker, dòng agent (tối đa Chỉnh sửa), huy hiệu "{{count}} agent", hiện đề xuất của agent trong tài liệu với "Áp dụng"/"Bỏ qua" | SH-S4, SH-W1 |
| **SH-E2E** (UNI-1788) | e2e | `e2e/documents-share.spec.ts` (cloud runner): AC01–AC20 luồng thật | tất cả |

Thứ tự merge: DOC-05 (a)+(b) lockstep, UNI-1641 (batch share), UNI-1645 (khóa sửa) theo Run → SH-S1 → SH-S2 ∥ SH-S3 → SH-W1 ∥ SH-W2 → SH-W3 → SH-S4 → SH-W4 (chờ `action_proposals`) → SH-E2E; DOC-06/07 theo phụ lục truy cập, rebase sau SH-S2 khi chạm `document_shares.go`. Web làm song song trên fake nhưng chỉ merge sau thẻ server tương ứng. Issue UniAI: sub-issue của UNI-923 (phase G5-G7), UNI-1780..UNI-1788, tạo 2026-10-15.

## 12. Nghiệm thu (SRS §13 → test)

| SRS AC | Kiểm ở |
| --- | --- |
| AC01–AC03 (1 người View; 10 người View; 3 Edit + 7 View) | Go `service/document_access_batch_test.go` (mới); vitest `share-add-section.test.tsx` |
| AC04–AC05 (Workspace View, Organization Edit) | Go cùng file (+ Q-S1: Organization Manage → 422) |
| AC06, AC12 (Org Edit + Person View; nhiều nguồn) | Go `sources`/`warnings` trong `document_shares_test.go`; vitest `share-access-list.test.tsx` cảnh báo `direct_below_group` |
| AC07 (thu hồi Person Edit, còn Workspace View) | Go preview `dry_run`; vitest câu toast FR-09 |
| AC08 (thu hồi hết) | Go: không dòng gốc, không share, không link → `share_scope` = riêng tư; admin vẫn `AdminScope` (DOC-05) |
| AC09 (không Manage → từ chối) | Go: `PUT …/access`, `share-candidates` → 403 |
| AC10, AC14, AC15, AC17 | đã có test link/share; thêm vitest: lỗi lô không có toast thành công (U-SH3) |
| AC11 (share sang workspace khác không di chuyển) | Go: `workspace_id` không đổi |
| AC13 (cấp trùng) | Go: `on_existing=keep` → `kept`, không dòng mới; principal trùng trong lô → 422 `duplicate_principal`; share cho workspace gốc → không chèn `document_shares` |
| AC16 (rời Workspace) | test sẵn có của `shareAppliesTo` + dòng gốc |
| AC18 (audit) | `audit_coverage_test.go` + kiểm `batch_id`, `document.workspace_access_changed` |
| AC19 (phạm vi trên danh sách) | Go `share_scope`; vitest `document-share-scope-badge.test.tsx` |
| AC20 (liên kết Project không cấp quyền) | không có liên kết Project có cấu trúc; DOC7-A07 giữ "mở URL không tạo share" |
| Mặc định riêng tư (U-SH2) | Go `document_create_visibility_test.go` (sửa DOC2-A02: gốc rỗng → `restricted`); migration trung tính `TestWorkspaceLevelMigrationIsRightsNeutral` |
| Visual | `tester_visual` 9 tiêu chí cho popup mới (3 khu vực, bảng quyền riêng, hộp xác nhận xem trước), huy hiệu phạm vi sáng/tối, công tắc "Chia sẻ với workspace" |

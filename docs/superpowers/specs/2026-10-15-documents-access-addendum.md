# Documents — Phụ lục: "Hạn chế" một chạm khi tạo (DOC-02), chuyển quyền sở hữu tài liệu (DOC-06) và xin quyền truy cập (DOC-07)

> **Trạng thái:** in-progress — v1.4, viết 2026-10-15, sửa theo review r1, r2 và r3 cùng ngày (UNI-1629 DOC-02, UNI-1630 DOC-06, UNI-1631 DOC-07); **c0 (2026-10-19): hợp đồng thực thi S-DOC07 đọc lại ở root `73d2b5038` và sửa `file:line` cũ trong toàn phụ lục — xem §9**. Chỉ là hợp đồng và luật; chưa có dòng code nào. Giá trị đã ký: DOC-01..07 ký 2026-10-14 14:30 UTC+7 (`USER-DECISIONS.md` của Run: "ok theo đề xuất đi"). Mọi chỗ "chọn" bên dưới là quyết định nằm **trong** các luật đã ký và có lý do đi kèm; điểm thật sự chưa quyết nằm ở mục 8. **Sửa 2026-10-15 15:10 UTC+7 (quyết định của người dùng, Q4):** mỗi (tài liệu, người xin) chỉ có một yêu cầu đang chờ — gửi lại khi đang chờ bị từ chối `409 access_request_pending`; sau khi bị từ chối phải đợi 1 giờ mới xin lại (`429 access_request_cooldown`); luật "gộp, nâng mức, nhắc lại sau 24 giờ" đã bỏ.

**Vì sao một file:** ba thẻ cùng chạm vào một chỗ — ai giữ quyền quản lý (`manage`) một tài liệu và người không đọc được thì thấy gì — nên đọc chung một bảng luật. Cả ba dùng cổng `canAdminister()` của DOC-05 và thẻ khóa `DocumentLockedCard` đã đặt chỗ sẵn ở [phụ lục mức quyền §4](2026-10-14-documents-permission-levels-addendum.md).
**Quan hệ:** [Documents C-01 §4](2026-09-08-documents-design.md) (bảng quyền gốc; phụ lục này chỉ **thêm**, không đổi dòng nào của §4), [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md) (thang `view < comment < edit < manage`, `AdminScope`, `canAdminister()`, break-glass, `DocumentLockedCard`), [phụ lục thư mục](2026-10-13-documents-folders-addendum.md) (luồng tạo một chạm không hỏi tên, menu "Mới"), [quyền workspace](2026-08-27-workspace-permissions-design.md). Khi lệch `CLAUDE.md` hoặc ADR, `CLAUDE.md`/ADR thắng.
**Hiện trạng:** mọi `file:line` dưới đây **đã được đọc lại ở root `73d2b5038` (c0, 2026-10-19)** — bảng đối chiếu dòng cũ/mới ở §9.0. Ghi chú gốc: đọc ở root `72b53366d`; đã đọc lại ở `e6cd81726` (vòng sửa r1): trong các file phụ lục trích, chỉ `packages/core/i18n/locales/{vi,en}.json` đổi (khóa AI chèn phía trên, các dòng documents lùi **+3**); mọi file server/views/core khác giữ nguyên dòng.
**Vòng sửa r1 (2026-10-15):** xử lý review BE (`R1-n`) và FE (`F-n`); mỗi chỗ sửa ghi mã phát hiện trong ngoặc.
**Vòng sửa r2 (2026-10-15):** review FE r2 (`N-01..N-04`) và BE r2 (`R2-1..R2-3`); lối vào cho admin thuần ở mục 2.5 mới.
**Nguồn quyết định:** bản dump issue UniAI (`reports/e6-web/doc020607/issues/UNI-16xx.json`) chưa có lúc viết (CLI `uniai` không có trên bro); phụ lục dựa trên dòng quyết định 14:30 và phụ lục mức quyền §4. Khi dump về, mục nào mâu thuẫn với dump thì dump thắng và phụ lục được sửa ở vòng review.

## 0. Hiện trạng (ở 72b53366d)

### 0.1 DOC-02 — visibility lúc tạo

| Dữ kiện | Nguồn |
| --- | --- |
| Cột `documents.visibility` mặc định `'workspace'`, CHECK `('workspace','restricted')` | `server/migrations/948_documents.up.sql:16, 49-50` |
| Thành viên hiệu lực của workspace nhận `edit` trên tài liệu `workspace`; `restricted` bỏ dòng này | `server/internal/service/document_permissions.go:142-143` |
| Route tạo trang/thư mục **đã nhận** `visibility` (`workspace` mặc định / `restricted`) | SDI `server/internal/handler/dto/sdi/document.go:21`; kiểm giá trị `service/document_pages.go:165-169`; rỗng = kế thừa cha, ở gốc = `workspace` `:223-236` (`CreatePageInput` `:64-79`) |
| Route tải tệp multipart **không** có trường `visibility`: tệp luôn `workspace` ở gốc, kế thừa cha khi có cha | SDI `dto/sdi/document.go:32-36`; `service/document_files.go:282-295` (input), `:377-386`; handler đọc form `handler/documents.go:225-239` |
| Route tạo tệp trống (docx/xlsx/pptx/md/html/pdf) **không** có `visibility` | SDI `dto/sdi/office.go:45-49`; `service/document_office_capability.go:284-289, 300`; route `handler/router/documents.go:289-292`; client `packages/core/api/endpoints/documents-blank.ts:12-16` |
| Web tạo một chạm, không hỏi tên (quyết định 2026-10-12): trang, sáu loại tệp, thư mục — không gửi `visibility` | `packages/views/documents/documents-create.ts:39-64` (trang/tệp), `:67-92` (thư mục) |
| Bề mặt tạo: thẻ tạo trên trang chủ Tài liệu và menu "Mới" | `packages/views/documents/documents-home-create.tsx:78-128` (`CreateCards`), `:130-187` (`CreateMenu`) |
| Đổi visibility sau khi tạo chỉ có trong hộp Chia sẻ (cần `manage`) | `packages/views/documents/share-dialog.tsx:152-163, 404-470` |
| Gợi ý hiện tại của "Hạn chế" ghi "người quản lý xem được" — lệch DOC-05 (admin không đọc nội dung tài liệu hạn chế) | `packages/core/i18n/locales/vi.json:8479-8480`, `en.json:8484-8485` (ở `e6cd81726`: `vi.json:8482-8483`, `en.json:8487-8488`) |
| `GET /api/v1/config` không có object `capabilities`; capability đi qua map `work_management_capabilities` (catalogue Go, đã có cả mục ngoài Work Management như `desktop.host`), client đọc bằng `capabilityState()` — mục vắng = `unavailable` (`capability_unknown`) | `server/internal/handler/dto/sdo/common.go:44-52`; `server/internal/workcapability/catalogue.go:24-64`; `packages/core/api/endpoints/config.ts:35-44`; `packages/core/capabilities/registry.ts:14-28`, `types.ts:3-12` |
| Giá trị enum lạ ở service dùng `Invalid(msg)` → `mapServiceError` trả `400 invalid_request` **không** có `fields`; repo không có mã `validation_failed` | `service/errors.go:190-194`; `handler/auth.go:146-152`; `service/document_pages.go:117-121` |
| Bề mặt tạo khác: thả tệp (`use-drop-upload.ts`) và menu "Mới" trên hàng cây (`document-tree-row-menu.tsx`) — không gửi `visibility` | `packages/views/documents/use-drop-upload.ts`, `document-tree-row-menu.tsx` (grep `visibility`: không có) |
| Hộp Chia sẻ mở từ `document-actions-menu.tsx` (state `panel === "share"`, chỉ khi `canManage` = `my_level === "manage"`), không có tham số URL nào mở nó; mục menu "Chia sẻ" cũng chỉ khi `canManage`. Bên trong hộp, `canManage` lại chặn cả câu `GET …/shares` lẫn nội dung (`manage_only`) | `packages/views/documents/document-actions-menu.tsx:69, 80-83, 139-145`; `share-dialog.tsx:75, 78, 182` |
| Khi `GET /documents/{id}` bị từ chối (`permission`), màn tài liệu trả sớm một trạng thái lỗi; `DocumentActionsMenu` chỉ được dựng khi đã có dữ liệu tài liệu (`N-01`) | `packages/views/documents/document-detail-view.tsx:92-104` (403), `:157-164` (menu) |

### 0.2 DOC-06 — chủ sở hữu tài liệu

| Dữ kiện | Nguồn |
| --- | --- |
| "Chủ sở hữu" của tài liệu là cột `acl_owner_id` (người, không phải agent/system) | `migrations/948_documents.up.sql:27`; `aclOwnerFor` `service/document_owner.go:186-193` |
| `acl_owner_id` gán lúc tạo trang, tệp, tài liệu thuộc Work Product; bản sao giữ ACL owner của nguồn | `service/document_pages.go:273`; `service/document_files.go:403`; `service/document_owner.go:135`; `service/document_copy.go:182`, `document_copy_convert.go:160` |
| ACL owner chỉ có `manage` khi **đang là thành viên hiệu lực** của workspace chứa tài liệu (`RequireMemberQ` trước, rồi mới xét `acl_owner_id`) | `service/document_permissions.go:131-145` |
| Không có lệnh nào đổi `acl_owner_id`: `UpdateDocument` chỉ nhận `title/icon/visibility/content`; không có câu sqlc `UPDATE … acl_owner_id` | `service/document_pages.go:552-556`; `server/pkg/db/queries/documents.sql` (chỉ `INSERT` ở `:10, :25`) |
| Danh sách truy cập trả `acl_owner` (kèm mức hiệu lực, người đã vô hiệu hóa ra `none`) cho người `manage` | `service/document_shares.go:244-258, 303-310` |
| Vô hiệu hóa thành viên tổ chức không đụng tài liệu: giữ mọi dòng, các cổng từ chối từ request kế tiếp → tài liệu `restricted` của người đó **không còn ai `manage` theo ACL owner** (chỉ còn ws owner/admin, mà sau DOC-05 họ chỉ có `AdminScope`) | `service/organization_members.go:201-286`; route `handler/router/organizations.go:89-95` |
| Hộp thoại vô hiệu hóa trên web là một xác nhận đơn | `packages/views/settings/components/org-members-section.tsx:89-97, 243-249` |
| Glossary: "chủ sở hữu" / Owner; "chuyển quyền sở hữu" / Transfer ownership (đang dùng cho tổ chức) | `docs/conventions.md:173, 175` |
| Archive cho phép ws admin hoặc ACL owner là thành viên | `service/document_lifecycle.go:122` |

### 0.3 DOC-07 — người không đọc được tài liệu

| Dữ kiện | Nguồn |
| --- | --- |
| **Chưa có liên kết có cấu trúc** giữa task/meeting và tài liệu: không bảng nối, editor chỉ có mention `member/agent/squad/task/project/all` và chip liên kết `task/project`. "Liên kết tài liệu từ task/meeting" hôm nay là URL tài liệu dán vào mô tả/bình luận/ghi chú | `packages/views/editor/extensions/mention-suggestion.tsx:43`; `packages/views/editor/utils/link-handler.ts:95, 113-116` |
| Người không đọc được → `ErrNotFound` (404, không lộ tồn tại); đọc được nhưng thiếu mức → 403 | `service/document_permissions.go:376-392`; `GetDocument` `service/document_pages.go:503-505` |
| Web: 403 (`errorClass === "permission"`) → "đã bị thu hồi quyền"; 404 (`missing`) → "Không tìm thấy tài liệu" (cố ý không lộ id có tồn tại) (`F-12`) | `packages/views/documents/document-detail-view.tsx:92-104` (403), `:106-121` (404); ánh xạ `packages/core/documents/errors.ts:44-55` |
| Ghi chú và chat của meeting hiển thị **chữ thường**: không qua editor, không có liên kết bấm được (`meeting-notes-section.tsx`, `meeting-room-chat-tab.tsx` không import `content-editor`/`link-handler`); chỉ `content-editor.tsx` và `link-hover-card.tsx` gọi `link-handler.ts`, mà entity map của nó chỉ có `tasks`/`projects` | `packages/views/meetings/meeting-notes-section.tsx:2-15`, `meeting-room-chat-tab.tsx:2-17`; `packages/views/editor/utils/link-handler.ts:93-116` |
| Thông báo: port duy nhất của rule tài liệu là **đọc** (`DocumentReadChecker{CanReadDocument, FilterDocumentReaders}`), gắn qua `SetDocumentReaders` ở `main.go` | `server/internal/notification/rules.go:43-51`; `consumer.go:51-55`; `server/cmd/server/main.go:493` |
| `ShareDocument` tự mở tx và tự khóa dòng tài liệu (`withDocumentViewOrAdministerMutationLocked`); chỉ nhận `view/edit/manage` | `service/document_shares.go:105-125`; `service/document_permissions.go:583-700` |

### 0.4 Phụ thuộc DOC-05 chưa có trong cây (`R1-5`)

> **Cập nhật ở c0 (root `73d2b5038`, 2026-10-19):** DOC-05 thẻ (a) **đã có** trong cây — `canAdminister()`, `AdminScope`, `decideDocument*`/`authorizeDocument*`, `withDocument*MutationLocked`, `break_glass_required` đều đọc được (`service/document_permissions.go`). Chỉ `withDocumentAdministerMutation` còn thiếu (S-DOC07 thêm, §9). Bảng dưới đây là hiện trạng đã ghi ở `72b53366d`; xem §9 để biết seam đã đổi thế nào.

| Dữ kiện | Nguồn |
| --- | --- |
| `canAdminister()`, `AdminScope`, `withDocumentAdministerMutation`, `authorizeDocumentViewOrAdminister`, mã `break_glass_required` **không tồn tại** ở `72b53366d` lẫn `e6cd81726` (grep `server/` + `packages/`: 0 kết quả); chúng chỉ có trong phụ lục mức quyền §4 | `2026-10-14-documents-permission-levels-addendum.md:144-173` |
| Nhánh thẻ (a) DOC-05 server (`feature/UNI-1413-g8-18-doc-05-server`) không phải tổ tiên của root này | `git merge-base --is-ancestor` = false |
| Hệ quả: S-DOC06 và S-DOC07 **bị chặn cứng** tới khi thẻ (a) merge vào root; mọi tên DOC-05 trong phụ lục này là hợp đồng của phụ lục mức quyền, không phải code đọc được hôm nay | mục 6 |
| Không có khái niệm xin quyền (`access_request`, `requestAccess`) ở server lẫn web; `DocumentLockedCard` chưa tồn tại (chỉ được đặt chỗ ở phụ lục mức quyền §4) | grep toàn repo; `2026-10-14-documents-permission-levels-addendum.md:188` |
| Cấp share: allowlist mức, principal phải là thành viên đang hoạt động của tổ chức; cấp lại cùng principal **thay** mức cũ (kể cả hạ mức) | `service/document_shares.go:105-125, 172-181, 318-360` |
| Thông báo: không có kind `document_shared` dù spec C-01 §6.2 liệt kê | `server/internal/notification/kinds.go:12-56` |
| Sự kiện `document.shared` phát ở `ScopeWorkspace`, payload chỉ id | `server/internal/outbox/catalogue.go:258` |
| Purge tài liệu xóa dữ liệu phụ thuộc trong cùng tx (bình luận, yêu thích…) | `service/document_lifecycle.go:1004-1006, 1243-1268` |

## 1. DOC-02 — giữ mặc định workspace, "Hạn chế" một chạm khi tạo

> **Thay thế một phần (2026-10-15, SRS Share v1.0, quyết định U-SH2):** mặc định khi tạo ở gốc đổi thành **riêng tư**; công tắc đảo thành **"Chia sẻ với workspace"**, bỏ toast "Đã tạo ở chế độ Hạn chế" và huy hiệu "Hạn chế" — xem [phụ lục căn chỉnh SRS Share §4, §7](2026-10-15-documents-share-srs-addendum.md). Phần còn đúng của mục này: hợp đồng `visibility` ở ba route tạo, idempotency, capability `documents.create_visibility`, vai trò a11y của công tắc và các bề mặt không có công tắc.

Luật đã ký: **mặc định vẫn là `workspace`** (DOC-01/03/04 đúng trong code, không đổi); lúc tạo có một nút "Hạn chế" bấm một lần là tài liệu mới sinh ra ở `restricted`.

**Quy tắc:**
- Ai: người tạo được tài liệu ở chỗ đó (thành viên hiệu lực của workspace, có `edit` trên cha nếu có cha — luật tạo hiện hành, không đổi). Không cần `manage`: người tạo trở thành ACL owner (`manage`) ngay khi tạo, nên chọn `restricted` lúc tạo không cấp thêm quyền cho ai.
- Server: ba route tạo (trang/thư mục, tệp multipart, tệp trống) cùng nhận `visibility` tùy chọn với **cùng một nghĩa**: `restricted` hoặc `workspace` được ghi đúng như gửi; rỗng = kế thừa cha, ở gốc = `workspace` (giữ nguyên nghĩa đã có ở `document_pages.go:223-236`, mở rộng cho tệp). Giá trị khác → `400 invalid_request` (service `Invalid(...)`, như route trang hôm nay `document_pages.go:165-169`; không có `fields`) (`R1-2`).
- Agent và system không tạo qua các route này (`document_files.go:311-314`); tài liệu thuộc Work Product đi qua seam riêng (`CreateOwnedDocumentInTx`), **không** nhận `visibility` từ request.
- Idempotency: `visibility` đã nằm trong fingerprint của tạo trang (`document_pages.go:198-199`); thẻ server **thêm** `visibility` vào fingerprint của tạo tệp và tạo tệp trống, nên cùng `Idempotency-Key` với visibility khác → `idempotency_payload_mismatch`. Để retry đang bay qua lúc deploy không lệch, `visibility` rỗng **không** thêm phần tử vào fingerprint (cùng mẹo "chỉ thư mục thêm kind" ở `:200-204`).
- Audit: dòng `document.created` hiện có đã ghi `visibility` (`document_pages.go:282`, `document_files.go:418-420`) — không thêm action.

**Trạng thái & UI (web):**
- Một công tắc **"Hạn chế"** (biểu tượng ổ khóa + chữ) có ở ba bề mặt, mỗi nơi đúng role của nó (`F-01`):
  - **menu "Mới" (`CreateMenu`, Base UI `DropdownMenu`):** mục đầu menu là `DropdownMenuCheckboxItem` (`packages/ui/components/ui/dropdown-menu.tsx:168`; role `menuitemcheckbox` + `aria-checked`) với `closeOnClick={false}`, để bật xong vẫn ở trong menu và chọn loại; không đặt `button` trong `role="menu"` (phá roving focus/typeahead);
  - **hàng thẻ tạo (`CreateCards`) và hộp tải tệp (`document-upload-dialog.tsx`):** `button` có `aria-pressed`.
  Mặc định **tắt** mỗi lần mở menu/trang (không nhớ giữa các lần — chọn, vì mặc định đã ký là `workspace`; nhớ trạng thái sẽ âm thầm biến mặc định thành `restricted` cho người đó).
- Khi bật: mọi lệnh tạo kế tiếp từ bề mặt đó (trang, sáu loại tệp, thư mục, tải tệp) gửi `visibility: "restricted"`; khi tắt không gửi trường (server kế thừa cha / mặc định `workspace`).
- **Bề mặt tạo không có công tắc (`F-11`):** thả tệp (`use-drop-upload.ts`) và menu "Mới" trên hàng cây (`document-tree-row-menu.tsx`) **không bao giờ** gửi `visibility` (kế thừa cha; ở gốc = `workspace`). Lý do: thả tệp không có chỗ cho một bước chọn, và tạo dưới một hàng cây là tạo trong thư mục đó nên kế thừa là đúng nghĩa; muốn hạn chế thì dùng menu "Mới"/thẻ tạo hoặc đổi trong hộp Chia sẻ.
- Trong thư mục cha `restricted`: công tắc hiện **bật và khóa** (`aria-disabled="true"`, vẫn trong thứ tự tab) với gợi ý "Thư mục này đang Hạn chế nên tài liệu mới cũng Hạn chế"; client không gửi trường (server kế thừa).
- Sau khi tạo ở `restricted`: toast "Đã tạo ở chế độ Hạn chế" kèm hành động "Chia sẻ"; tài liệu vẫn mở ngay như luồng một chạm hiện tại. **Cơ chế (`F-02`):** toast sống ở tầng app (sonner), sống qua lần điều hướng; hành động "Chia sẻ" gọi `useNavigation().push(paths…document(id) + "?share=1")`. `document-actions-menu.tsx` (nơi giữ `ShareDialog`, `:139-145`) đọc `searchParams.get("share") === "1"`, mở `panel = "share"` khi `canManage` (người tạo là ACL owner nên luôn đủ), rồi `replace` bỏ tham số khỏi địa chỉ để tải lại/sao chép URL không mở lại hộp. Không có `canManage` → bỏ qua tham số im lặng. (`?share=1` giữ cổng `canManage` vì chỉ người tạo dùng nó; cổng mount của hộp đổi sang `canAdministerDocument` ở mục 2.5, `N-01`.)
- Thư viện, cây, kết quả tìm kiếm: hàng `restricted` có huy hiệu ổ khóa + chữ "Hạn chế" (không chỉ dùng màu). **Chủ sở hữu: W-DOC02** (phát hành trước); W-DOC05 dùng lại nếu cần, không thêm bản thứ hai (`F-14`).
- Tạo vẫn **chờ server** như hôm nay (tạo không lạc quan — luật State Rules); công tắc không đổi luồng đó.
- Sửa gợi ý "Hạn chế" cho khớp DOC-05: "Chỉ chủ sở hữu và người được chia sẻ xem được." (không còn "người quản lý xem được").

**Trường hợp biên:**
- Cha bị chuyển sang `restricted` trong lúc menu đang mở: server kế thừa theo dòng cha đã khóa trong tx (`lockPageParent`), nên tài liệu mới đúng theo cha lúc ghi; UI không cần biết trước.
- Bật "Hạn chế" khi tạo **trong** thư mục `workspace`: tài liệu con `restricted` trong cha `workspace` là hợp lệ (đã đúng hôm nay với trang).
- Gửi `visibility: "workspace"` dưới cha `restricted`: giữ nghĩa route trang hiện hành (giá trị gửi thắng); web không bao giờ gửi giá trị này dưới cha `restricted`. Có nên chặn ở server hay không là câu hỏi mở Q1 (mục 8).
- Server cũ chưa có trường `visibility` ở route tệp: Go decode bỏ qua trường lạ của JSON và form, nên tệp ra `workspace` — **không an toàn về quyền**. Vì vậy web chỉ hiện công tắc "Hạn chế" cho tệp khi server đã khai báo hỗ trợ qua mục capability `documents.create_visibility` trong `work_management_capabilities` của `GET /api/v1/config` (mục 4.1, `R1-4`/`F-03`). Đọc bằng `capabilityState(config, "documents.create_visibility")`: `available` → hiện cho tệp; vắng/lạ/`unavailable` (server cũ, config lỗi, đang tải) → **ẩn cho tệp**, trang/thư mục vẫn hiện (route đó đã nhận `visibility`).

**Chuỗi (`F-09`: khóa snake_case dưới namespace có sẵn — `documents.home.create.*` là nơi chuỗi tạo đang sống, `vi.json` `documents.home.create` ở `:8723` của `72b53366d`, `:8726` ở `e6cd81726` (+3, `N-04`); placeholder `{{param}}`):**

| Vị trí | Khóa | vi | en |
| --- | --- | --- | --- |
| Công tắc | `documents.home.create.restricted_toggle` | `"Hạn chế"` | `"Restricted"` |
| Mô tả cho trình đọc màn hình / tooltip | `documents.home.create.restricted_toggle_hint` | `"Tài liệu mới chỉ chủ sở hữu và người được chia sẻ xem được"` | `"New documents are visible only to the owner and people it's shared with"` |
| Công tắc khóa trong cha hạn chế | `documents.home.create.restricted_inherited` | `"Thư mục này đang Hạn chế nên tài liệu mới cũng Hạn chế"` | `"This folder is restricted, so new documents are too"` |
| Toast sau khi tạo | `documents.home.create.created_restricted`, `documents.home.create.share_action` | `"Đã tạo ở chế độ Hạn chế"` · `"Chia sẻ"` | `"Created as restricted"` · `"Share"` |
| Gợi ý visibility (sửa khóa có sẵn) | `documents.share.visibility_restricted_hint` | `"Chỉ chủ sở hữu và người được chia sẻ xem được."` | `"Only the owner and people it's shared with can read it."` |
| Huy hiệu hàng | `documents.library.restricted_badge` | `"Hạn chế"` | `"Restricted"` |

**A11y:** trong menu là `menuitemcheckbox` + `aria-checked`; ở thẻ tạo và hộp tải tệp là `button` + `aria-pressed`; nhãn chữ luôn hiện (không chỉ biểu tượng); trạng thái khóa dùng `aria-disabled` (luật primitive), gợi ý nối bằng `aria-describedby`; mục tiêu chạm ≥ 44px trên con trỏ thô; toast có hành động bàn phím tới được.

## 2. DOC-06 — chuyển quyền sở hữu từng tài liệu và hàng loạt khi vô hiệu hóa thành viên

Luật đã ký: chuyển chủ sở hữu **từng tài liệu**, và **chuyển hàng loạt** khi vô hiệu hóa một thành viên. Cổng quyền là `canAdminister()` của DOC-05 (phụ lục mức quyền §4: "DOC-05 chỉ dành cho DOC-06 cổng `canAdminister()`").

### 2.1 Chuyển từng tài liệu

**Ai được chuyển:** người gọi có `access.canAdminister()` (= `Level ≥ manage` **hoặc** `AdminScope`) trên tài liệu, qua cổng bao ngoài `withDocumentAdministerMutation` của DOC-05. Mirror web: `canAdministerDocument` (thêm cạnh `canManageDocument` ở `packages/core/permissions/rules.ts:530`, đọc `my_level` + `admin_scope`, cite cổng Go).

**Ai được nhận:**
- người (human), là thành viên **đang hoạt động** của tổ chức (`deactivated_at IS NULL`) **và** thành viên hiệu lực của workspace chứa tài liệu (vì ACL owner chỉ có `manage` khi qua `RequireMemberQ`, `document_permissions.go:131-145`; chuyển cho người ngoài workspace sẽ tạo ra một tài liệu không ai quản lý) → nếu không: `422 owner_target_not_member`;
- không phải agent (agent không bao giờ giữ ACL, `aclOwnerFor`) → `422 owner_target_not_member`;
- người nhận = chủ hiện tại → `200`, không ghi gì (idempotent, không audit, không thông báo).

**Chặn tự cấp (DOC-05):** người gọi chỉ có `AdminScope` (`Level < manage`) chuyển quyền sở hữu tài liệu `restricted` **cho chính mình** → `403 break_glass_required` (cùng luật "admin không tự share" ở phụ lục mức quyền §4). Chuyển cho người khác được.

**Chủ cũ:** body có `previous_owner_level` ∈ `edit` (mặc định) | `comment` | `view` | `none`. Khác `none` → trong cùng tx tạo/cập nhật một share `user` cho chủ cũ ở mức đó qua thân share theo tx (`shareDocumentInTx`, tách từ `ShareDocument` — mục 3.1; có audit `document.shared` và outbox), **chỉ nâng, không hạ** share sẵn có của chủ cũ. Chủ cũ đã bị vô hiệu hóa → bỏ qua bước share (không lỗi). `comment` chỉ hợp lệ khi thẻ DOC-05/G8-18 server đã vào (xem mục 6). Chọn mặc định `edit`: chuyển chủ là bàn giao trách nhiệm, không phải thu hồi quyền làm việc; người gọi muốn cắt hẳn thì chọn `none`.

**Không chuyển được:** tài liệu thuộc Work Product (`owner_kind` có giá trị) → `409 document_owned_by_work_product` (resolver của sản phẩm quyết, §13.4). Tài liệu đã archive: chuyển được (cổng DOC-05 cho người `canAdminister()` qua archive) — để người kế nhiệm khôi phục được.

**Ghi:** trong một tx: khóa dòng tài liệu, kiểm lại cổng, `UPDATE documents SET acl_owner_id = $new, updated_by = <người gọi>, updated_by_kind = 'human', updated_at = now() … WHERE id = $1 AND organization_id = $2 AND workspace_id = $3` (ghi cặp `updated_by`/`updated_by_kind` như mọi UPDATE khác của `documents.sql:84-96, 112-130` — ADR 0007 (`R1-9`); **không** tăng `revision` nội dung — `revision` là base của autosave; đổi chủ không đổi nội dung), share chủ cũ nếu có qua thân share theo tx (`shareDocumentInTx`, mục 3.1 "Duyệt", `R1-15`), audit + outbox.

### 2.2 Chuyển hàng loạt khi vô hiệu hóa thành viên

**Ai:** owner/admin tổ chức — đúng cổng `requireAdmin` của `OrganizationMemberService.Deactivate` (`organization_members.go:207-224`; admin không thao tác trên admin khác, chỉ owner làm được). Không đi qua `RequireMember` của workspace từng tài liệu: đây là thao tác cấp tổ chức trên siêu dữ liệu, không đọc nội dung.

**Phạm vi:** mọi tài liệu của tổ chức có `acl_owner_id = <thành viên>` và `owner_kind IS NULL`, ở mọi workspace, kể cả đã archive chưa purge. Thành viên có thể đang hoạt động hoặc đã bị vô hiệu hóa (để xử lý tài liệu "mồ côi" của những người đã vô hiệu hóa trước khi có tính năng này).

**Người nhận:** một người, thành viên đang hoạt động của tổ chức, khác thành viên nguồn. Theo từng tài liệu:
- người nhận không phải thành viên hiệu lực của workspace chứa tài liệu → **bỏ qua**, lý do `recipient_not_member`;
- người nhận = người gọi **và** tài liệu `restricted` **và** người gọi không có `Level ≥ manage` trên tài liệu đó (chỉ có quyền admin) → **bỏ qua**, lý do `self_restricted` (DOC-05: admin không tự trao quyền đọc nội dung tài liệu hạn chế; muốn kiểm tra thì dùng break-glass; muốn nhận thì nhờ owner/admin khác chuyển);
- còn lại → chuyển, `previous_owner_level` luôn `none` (thành viên nguồn đang bị vô hiệu hóa hoặc rời việc; giữ share cho người đó là cấp quyền cho tài khoản sắp/đã khóa — chọn).

**Thứ tự và tính nguyên tử (chọn):** chuyển hàng loạt là **một route riêng**, không nhét vào body của `deactivate`. Lý do: (1) dùng được cả trước lẫn sau khi vô hiệu hóa và cho thành viên đã vô hiệu hóa từ trước; (2) `Deactivate` giữ đúng một trách nhiệm và một bảng audit; (3) lỗi chuyển không chặn việc khóa tài khoản (khóa tài khoản là việc an ninh, phải xong trước). Hộp thoại vô hiệu hóa trên web gọi **deactivate trước**, rồi gọi chuyển hàng loạt; chuyển thất bại thì hiện lỗi kèm "Thử lại" và hàng thành viên đã vô hiệu hóa có mục "Chuyển tài liệu" để làm lại sau.

**Giới hạn lô:** mỗi lần gọi chuyển tối đa **500** tài liệu (trong một tx, theo thứ tự `id`); còn nữa thì phản hồi `has_more: true` kèm `cursor`, client gọi tiếp với `cursor` đó tới khi hết. Chọn 500 để một tx giữ khóa dòng ngắn và số dòng outbox/audit mỗi tx có chặn trên.

**Khóa, con trỏ và `has_more` (`R1-10`, chọn):**
- Câu chọn lô dùng `FOR UPDATE` thường, `ORDER BY id`, **không** `SKIP LOCKED`: một lệnh chuyển song song (admin khác, hoặc lần thử lại) làm lô này **chờ** thay vì bỏ qua dòng. Khóa lấy theo thứ tự `id` nên hai lệnh hàng loạt không khóa chéo nhau; lệnh từng tài liệu chỉ khóa một dòng.
- Con trỏ: dòng bị **bỏ qua** (`recipient_not_member`, `self_restricted`) vẫn có `acl_owner_id = nguồn`, nên lệnh không thể chỉ "chọn lại những gì còn khớp" (sẽ lặp mãi trên các dòng bị bỏ). Lô chọn `id > cursor`; `cursor` là chuỗi mờ (server ghi `id` cuối của lô; tên không kết thúc bằng `_id` vì nó không trỏ một dòng để tra — chỉ là ranh giới so sánh trong cùng tổ chức, câu vẫn ràng buộc `organization_id`). Đợt mới không gửi `cursor`.
- `has_more` **không** suy từ "trang đủ 500" (ở READ COMMITTED, `LIMIT … FOR UPDATE` có thể trả ít hơn `LIMIT` khi một dòng đổi chủ trong lúc chờ khóa): sau khi ghi, cùng tx chạy `EXISTS (… acl_owner_id = nguồn AND owner_kind IS NULL AND id > <id cuối của lô>)`. Nhờ vậy một lệnh song song không thể làm vòng lặp dừng sớm.

**Ghi:** mỗi tài liệu chuyển: `UPDATE acl_owner_id`, một dòng audit `document.owner_transferred` (để lịch sử của từng tài liệu có dòng này) với `Metadata{from_user_id, previous_owner_level: "none", bulk_id}` (bộ khóa chung ở mục 4.2, `R2-3`), và một dòng outbox `document.owner_transferred`. Mỗi lần gọi: một dòng audit `document.owners_bulk_transferred` (`ResourceType=organization_member`, `ResourceID=<thành viên nguồn>`, `Metadata{bulk_id, to_user_id, transferred, skipped:{recipient_not_member, self_restricted}}`) và một dòng outbox `document.owners_bulk_transferred` cho người nhận (thông báo gộp). `bulk_id` là ULID sinh mỗi lần gọi đầu; client gửi lại `bulk_id` ở các lần gọi tiếp của cùng một đợt (`has_more`) để thông báo gộp vào một dòng.

### 2.3 Trạng thái, trường hợp biên

| Trường hợp | Hành vi |
| --- | --- |
| Chủ sở hữu đã bị vô hiệu hóa, chưa ai chuyển | Không đổi gì tự động. Tài liệu `workspace` vẫn sửa được bởi thành viên; tài liệu `restricted` chỉ còn người có share `manage` và admin (`AdminScope`: quản lý được, không đọc). Admin chuyển từng tài liệu (2.1) hoặc hàng loạt (2.2) bất cứ lúc nào |
| "Người quản lý cuối cùng" | Không có khái niệm chặn: ws owner/admin luôn `canAdminister()` (DOC-05), nên tài liệu không bao giờ mất người quản lý. Chuyển không thể làm tài liệu mất chủ (người nhận phải là thành viên hiệu lực) |
| Người nhận bị vô hiệu hóa / rời workspace giữa lúc chọn và lúc gửi | Kiểm lại trong tx → `422 owner_target_not_member` (từng tài liệu) hoặc bỏ qua `recipient_not_member` (hàng loạt) |
| Thành viên nguồn được kích hoạt lại sau khi đã chuyển | Không trả lại tự động; admin chuyển lại nếu cần |
| Tài liệu thuộc Work Product | Từng tài liệu → 409; hàng loạt không chọn (`owner_kind IS NULL`) |
| Bản sao của tài liệu | Giữ ACL owner của nguồn lúc sao (`document_copy.go:182`); chuyển chủ bản gốc không chuyển bản sao |
| Hai admin chuyển cùng lúc | Khóa dòng tài liệu trong tx; người sau thấy chủ mới, nếu khác người nhận của mình thì vẫn ghi đè (thao tác quản trị, có audit); hàng loạt: lô chờ khóa, dòng đã đổi chủ không còn khớp nguồn nên không đếm; `has_more` tính bằng `EXISTS` nên vòng lặp không dừng sớm (`R1-10`) |
| Khác tổ chức | Mọi câu truy vấn ràng buộc `organization_id`; id của tổ chức khác → 404, không lộ |

### 2.4 UI và chuỗi

- **Hộp Chia sẻ (`share-dialog.tsx`):** dòng chủ sở hữu (đã có `acl_owner` trong `GET …/shares`) thêm nút "Chuyển quyền sở hữu" khi `canAdministerDocument` (admin thuần tới được hộp này qua lối vào ở mục 2.5, `N-01`). Mở hộp con: chọn người (picker thành viên của workspace, loại agent, loại người đã vô hiệu hóa), chọn quyền giữ lại cho chủ cũ (mặc định "Chỉnh sửa"), xác nhận. Lỗi `break_glass_required` hiện câu riêng.
- **Hộp vô hiệu hóa (`org-members-section.tsx`):** khi mở hộp, gọi `GET …/document-ownership` lấy số tài liệu. Trạng thái của lần gọi này (`F-04`):
  - **đang tải:** `<Spinner />` trong bước, nút "Vô hiệu hóa" vẫn bấm được (vô hiệu hóa là việc an ninh, không chờ số đếm);
  - **lỗi / mất mạng:** cảnh báo nội tuyến "Chưa đếm được tài liệu…" kèm "Thử lại"; vẫn vô hiệu hóa được, lựa chọn chuyển coi như "Để sau";
  - **0 tài liệu:** không hiện bước chuyển;
  - **> 0:** hiện bước "Chuyển tài liệu cho" (picker thành viên tổ chức, mặc định để trống) với lựa chọn "Để sau".
  Sau khi deactivate thành công và có người nhận: gọi chuyển hàng loạt (lặp khi `has_more`, gửi lại `bulk_id` + `cursor`), hiện tiến độ và kết quả (số đã chuyển, số bỏ qua kèm lý do).
- **Mục "Chuyển tài liệu" trên hàng đã vô hiệu hóa (`F-04`, chọn):** danh sách thành viên **không** trả số tài liệu theo hàng (gọi đếm cho từng hàng là N lần gọi). Vì vậy mục này hiện trên **mọi** hàng đã vô hiệu hóa (người gọi là owner/admin đủ quyền với hàng đó); mở ra là cùng bước trên, gọi `GET …/document-ownership`, và khi đếm = 0 thì hiện "{{name}} không còn sở hữu tài liệu nào." thay cho picker. Không thêm trường vào SDO thành viên.
- **Chờ server, không lạc quan (`F-06`):** chuyển từng tài liệu, chuyển hàng loạt đều là thay đổi quyền → mutation chờ phản hồi, nút xác nhận `aria-disabled` + `<Spinner />` trong lúc chờ. Thành công từng tài liệu: invalidate `documentKeys.detail(wsId, id)` (kéo theo `shares` vì là con của khóa chi tiết, `keys.ts`) và các list gốc của workspace (`documentKeys.workspace(wsId)`); hàng loạt: invalidate `documentKeys.all` (nhiều workspace) sau **mỗi** lần gọi thành công, không chờ lần cuối — lô đã commit thì tab đang mở phải thấy ngay dù lô sau lỗi (`N-03`; rẻ: admin hiếm khi mở màn tài liệu lúc đó).
- Thông báo cho người nhận (mục 4.4).

Khóa i18n (`F-09`): snake_case dưới namespace có sẵn — `documents.share.*` (hộp Chia sẻ đã có `acl_owner`, `level_*`…) và `org.members.*` (đã có `deactivate_title`, `deactivate_body`…).

| Vị trí | Khóa | vi | en |
| --- | --- | --- | --- |
| Nút trên dòng chủ sở hữu | `documents.share.owner.transfer_button` | `"Chuyển quyền sở hữu"` | `"Transfer ownership"` |
| Tiêu đề hộp | `documents.share.owner.transfer_title` | `"Chuyển quyền sở hữu “{{document}}”"` | `"Transfer ownership of “{{document}}”"` |
| Nhãn picker | `documents.share.owner.new_owner_label` | `"Chủ sở hữu mới"` | `"New owner"` |
| Quyền giữ lại cho chủ cũ | `documents.share.owner.previous_level_label` + `documents.share.owner.previous_level_none` | `"Quyền của {{name}} sau khi chuyển"` · `"Không giữ quyền"` | `"{{name}}'s access after the transfer"` · `"No access"` |
| Ghi chú | `documents.share.owner.transfer_note` | `"Chủ sở hữu mới quản lý được tài liệu: chia sẻ, đổi chế độ hiển thị và chuyển vào thùng rác."` | `"The new owner can manage the document: share it, change who can see it and move it to trash."` |
| Nút xác nhận / thành công | `documents.share.owner.transfer_confirm`, `documents.share.owner.transferred` | `"Chuyển"` · `"Đã chuyển quyền sở hữu cho {{name}}"` | `"Transfer"` · `"Ownership transferred to {{name}}"` |
| Lỗi người nhận | `documents.share.owner.target_not_member` | `"{{name}} chưa là thành viên của workspace này nên không thể làm chủ sở hữu."` | `"{{name}} isn't a member of this workspace, so they can't own this document."` |
| Lỗi tự nhận (admin) — dùng đúng thuật ngữ của nút DOC-05 `documents.breakGlass.openButton` ("Mở truy cập khẩn cấp (24 giờ)" / "Open emergency access (24h)", phụ lục mức quyền §4 bảng chuỗi) (`F-10`) | `documents.share.owner.self_transfer_error` | `"Quản trị viên không thể tự nhận quyền sở hữu tài liệu hạn chế. Hãy nhờ một quản trị viên khác chuyển, hoặc mở truy cập khẩn cấp để kiểm tra."` | `"Admins can't take ownership of a restricted document themselves. Ask another admin to transfer it, or open emergency access to inspect it."` |
| Bước trong hộp vô hiệu hóa | `org.members.transfer_docs.title`, `.body`, `.recipient_label`, `.later` | `"Chuyển tài liệu"` · `"{{name}} đang là chủ sở hữu của {{count}} tài liệu."` · `"Chuyển cho"` · `"Để sau"` | `"Transfer documents"` · `"{{name}} owns {{count}} documents."` · `"Transfer to"` · `"Later"` |
| Đang đếm / lỗi đếm / không còn tài liệu (`F-04`) | `org.members.transfer_docs.count_loading`, `.count_failed`, `.none` | `"Đang đếm tài liệu…"` · `"Chưa đếm được tài liệu. Bạn vẫn vô hiệu hóa được và chuyển tài liệu sau."` · `"{{name}} không còn sở hữu tài liệu nào."` | `"Counting documents…"` · `"Couldn't count the documents. You can still deactivate and transfer them later."` · `"{{name}} doesn't own any documents."` |
| Tiến độ / kết quả | `org.members.transfer_docs.progress`, `.done`, `.skipped_not_member`, `.skipped_self`, `.failed`, `.retry` | `"Đang chuyển tài liệu…"` · `"Đã chuyển {{count}} tài liệu cho {{name}}."` · `"{{count}} tài liệu ở workspace mà {{name}} chưa tham gia chưa được chuyển."` · `"{{count}} tài liệu hạn chế không thể chuyển cho chính bạn."` · `"Chưa chuyển được tài liệu. Tài khoản đã được vô hiệu hóa; bạn có thể thử lại."` · `"Thử lại"` | `"Transferring documents…"` · `"Transferred {{count}} documents to {{name}}."` · `"{{count}} documents in workspaces {{name}} hasn't joined weren't transferred."` · `"{{count}} restricted documents can't be transferred to yourself."` · `"Couldn't transfer the documents. The account is deactivated; you can try again."` · `"Try again"` |
| Mục trên hàng đã vô hiệu hóa | `org.members.transfer_docs.action` | `"Chuyển tài liệu"` | `"Transfer documents"` |

Các chuỗi đếm dùng plural i18next (`_one`/`_other`) theo quy ước locale hiện có.

**Glossary (`R1-13`, `F-10`) — chốt nội dung ở đây, W-DOC06 chép nguyên văn vào `docs/conventions.md`:** dòng tổ chức `transfer ownership` (`conventions.md:175`, "the former owner becomes `admin`") và `owner (UI label)` (`:173`) **giữ nguyên**; thêm hai dòng riêng ngay sau `:175`:

| Concept | vi | en | Note |
| --- | --- | --- | --- |
| document owner (ACL) | **chủ sở hữu** (tài liệu) | Owner | `documents.share.acl_owner`; người giữ `acl_owner_id` — quản lý tài liệu khi còn là thành viên hiệu lực của workspace; khác vai trò `owner` của tổ chức/workspace |
| transfer document ownership | **chuyển quyền sở hữu** (tài liệu) | Transfer ownership | `documents.share.owner.*`; ngay lập tức, không có bước chấp nhận; chủ cũ giữ mức đã chọn (mặc định Chỉnh sửa) hoặc không giữ gì — khác `org.transfer.*` |

Vòng này không sửa `docs/conventions.md` vì hợp đồng của vòng chỉ cho sửa phụ lục và dòng trỏ §4.

**A11y:** picker là combobox có nhãn; tiến độ hàng loạt trong `role="status"` (`aria-live="polite"`); kết quả bỏ qua là chữ, không chỉ màu; nút "Thử lại" tới được bằng bàn phím; focus trả về nút mở hộp khi đóng.

### 2.5 Lối vào hộp Chia sẻ cho admin thuần (`N-01`, dùng chung DOC-06 và DOC-07)

**Vấn đề:** chuyển quyền sở hữu (2.4) và duyệt yêu cầu (3.4) nằm trong `ShareDialog`, gác bởi `canAdministerDocument` (= `my_level === "manage"` **hoặc** `admin_scope`). Nhưng hôm nay hộp chỉ được mount khi `canManage` (`document-actions-menu.tsx:69, 139-145`), mục menu "Chia sẻ" cũng vậy (`:80-83`), và bên trong hộp `canManage` chặn cả câu `GET …/shares` (`share-dialog.tsx:75, 78, 182`). Admin thuần (`AdminScope`, `Level < manage`) — chính là người xử lý tài liệu `restricted` "mồ côi" của DOC-06 và người nhận thông báo dự phòng của DOC-07 — không bao giờ tới được hai hành động đó.

**Admin thuần đến màn tài liệu theo hai đường, mỗi đường một lối vào:**

| Đường | Màn hiện ra | Lối vào |
| --- | --- | --- |
| Không có grant break-glass: `GET /documents/{id}` → `403 document_restricted` (DOC-05) | Nhánh `permission` của `document-detail-view.tsx:92-104` — W-DOC05 thay bằng `DocumentLockedCard variant="admin"`; **không** có `DocumentActionsMenu` (chỉ dựng khi có dữ liệu, `:157-164`) | Thẻ khóa `admin` thêm nút phụ **"Quản lý truy cập"** cạnh nút break-glass. Nút mở `ShareDialog` với đích dựng từ `GET /documents/{id}/admin-summary` (DOC-05, cổng `canAdminister()`, chỉ siêu dữ liệu: id, tên, loại, visibility, ACL owner — không nội dung). Nút chỉ hiện khi `admin-summary` trả 200 |
| Có grant break-glass còn hạn: `GET /documents/{id}` → 200, `my_level="view"`, `admin_scope=true` | Màn tài liệu chỉ xem, có `DocumentActionsMenu` | Đổi cổng mount `ShareDialog` (`:139`) và mục menu "Chia sẻ" (`:80-83`) từ `canManage` sang `canAdministerDocument(doc)`; các mục khác của menu (`archive`, `restore`, `logs`) giữ nguyên cổng hiện hành — đổi chúng là việc của W-DOC05. Khối `if` ở `:80-83` hiện đẩy cả `share` lẫn `logs`: tách khối ra, chỉ `share` chuyển sang `canAdministerDocument`, `logs` ở lại cổng cũ |

**Đích của hộp:** `ShareDialogProps.doc` (`share-dialog.tsx:45-50`, hôm nay `Document`) nới thành kiểu `ShareDialogTarget = Pick<Document, "id" | "visibility" | "owner_kind" | "organization_id" | "revision" | "archived_at"> & { my_level?: DocumentAccessLevel | ""; admin_scope?: boolean }` — đúng các trường hộp thật sự đọc (`share-dialog.tsx:75-84, 135, 146, 156, 297`: `id`, `my_level`, `owner_kind`, `organization_id` cho dòng/picker "tổ chức", `revision` làm nền khóa lạc quan khi lưu `visibility`, `visibility`) cộng `archived_at` cho luật archive của `?access=requests` (mục 3.4); `title`/`kind` bỏ vì hộp không đọc. `my_level` là trường **tùy chọn** và nới thêm `""`: union `DocumentAccessLevel` hiện tại (`packages/core/types/document.ts:22-23, 114`) chỉ có `view | edit | manage`, mà `""` là giá trị DOC-05 trả cho `AdminScope` thuần — nới ở kiểu đích, không đụng kiểu `Document`. `Document` thỏa sẵn (cấu trúc), thẻ khóa dựng đích từ `admin-summary` với `my_level: ""`, `admin_scope: true`. `admin-summary` của DOC-05 chưa liệt kê `owner_kind`, `organization_id`, `revision`, `archived_at`: S-DOC06 thêm cả bốn vào SDO `admin-summary` (siêu dữ liệu, không nội dung; `owner_kind` để hộp ẩn nút chuyển với tài liệu thuộc Work Product thay vì chờ `409`; `archived_at` để thẻ khóa áp luật archive ở mục 3.4) nếu thẻ (a) chưa có. `canAdministerDocument` nhận `ShareDialogTarget` (không phải `Document`) vì đích của thẻ khóa có `my_level: ""`.

**Cổng từng hành động trong hộp (mirror web cite cổng Go; luật DOC-05 "admin quản lý nhưng không đọc nội dung tài liệu hạn chế" giữ nguyên — hộp không bao giờ hiện hay tải nội dung):**

| Hành động trong `ShareDialog` | Cổng web | Cổng Go | Chủ |
| --- | --- | --- | --- |
| Mount hộp, tải `GET …/shares` (gồm `acl_owner`, `pending_access_requests`) | `canAdministerDocument` | `authorizeDocumentViewOrAdminister` + `canAdminister()` (DOC-05 #3) | W-DOC06 (thẻ web nào merge trước làm; thẻ sau dùng lại) |
| Nút "Chuyển quyền sở hữu" trên dòng chủ | `canAdministerDocument && !owner_kind`; khi chỉ có `admin_scope` và tài liệu `restricted`, picker loại chính người gọi (server vẫn chặn `403 break_glass_required` → `self_transfer_error`) | `withDocumentAdministerMutation` (mục 2.1) | W-DOC06 |
| Mục "Yêu cầu truy cập", Duyệt / Từ chối | `canAdministerDocument` | `withDocumentAdministerMutation` (mục 4.3) | W-DOC07 |
| Thêm/thu hồi share, liên kết công khai, thu hẹp `workspace → restricted` | `canAdministerDocument`; tự share → `selfShareError` | DOC-05 #1, #2, #5 | W-DOC05 (DOC5-A04/W03); W-DOC06/07 không đổi các điều khiển này |
| Mở rộng `restricted → workspace` | chỉ `canManage`; với `admin_scope` thuần lựa chọn `aria-disabled` kèm gợi ý | `403 break_glass_required` cho `AdminScope` thuần (DOC-05 #5) | W-DOC05 |

Khi người mở hộp chỉ có `admin_scope`, đầu hộp có một dòng ghi chú `documents.share.admin_scope_note` để họ biết vì sao không thấy nội dung.

**Tham số URL:** `?access=requests` (mục 3.4) được đọc ở **cả hai** lối vào — `document-actions-menu.tsx` (cổng `canAdministerDocument`) và thẻ khóa `admin` (sau khi `admin-summary` trả 200) — nên liên kết thông báo của người quản lý luôn mở được hộp. `?share=1` (mục 1) giữ cổng `canManage`.

| Vị trí | Khóa | vi | en |
| --- | --- | --- | --- |
| Nút trên thẻ khóa `admin` | `documents.share.admin_manage_button` | `"Quản lý truy cập"` | `"Manage access"` |
| Ghi chú đầu hộp khi chỉ có `admin_scope` | `documents.share.admin_scope_note` | `"Bạn quản lý tài liệu này với vai trò quản trị viên. Nội dung tài liệu vẫn được ẩn."` | `"You manage this document as an admin. Its content stays hidden."` |

**A11y:** nút "Quản lý truy cập" là `button` thật, đứng sau nút break-glass trong thứ tự tab; ghi chú `admin_scope_note` nối vào hộp bằng `aria-describedby`.

## 3. DOC-07 — xin quyền truy cập từ liên kết task/meeting: không tự cấp, thẻ khóa, người quản lý duyệt

Luật đã ký: **không tự cấp quyền** khi người dùng mở tài liệu qua liên kết trong task/meeting; hiện **`DocumentLockedCard variant="member"`**; người dùng gửi yêu cầu; **người quản lý duyệt**.

**Ràng buộc từ hiện trạng (mục 0.3):** chưa có liên kết có cấu trúc task/meeting → tài liệu, và 404 hôm nay cố ý không phân biệt "không tồn tại" với "không có quyền". Phụ lục giữ nguyên tính không lộ đó: thẻ khóa và phản hồi xin quyền **giống hệt nhau** dù tài liệu có tồn tại hay không, thuộc tổ chức khác hay không.

### 3.1 Luật

- **Không tự cấp:** mở một URL tài liệu (từ task, meeting, chat hay bất cứ đâu) không bao giờ tạo share. Chỉ hành động "Duyệt" của người quản lý mới tạo share (qua đường `ShareDocument` có audit).
- **Thẻ khóa thay cho trang 404 của tài liệu:** với người đã đăng nhập, khi `GET /documents/{id}` trả 404 (không tồn tại, không có quyền, hoặc khác tổ chức), màn hình tài liệu hiện `DocumentLockedCard variant="member"` với câu trung tính "có thể không tồn tại hoặc bạn chưa có quyền" và nút "Xin quyền truy cập". Thẻ **không** hiện tiêu đề, chủ sở hữu hay workspace của tài liệu (server không trả gì). 403 (đọc được nhưng thiếu mức, hoặc vừa bị thu hồi) giữ màn "đã bị thu hồi" hiện có; admin với `403 document_restricted` thấy `variant="admin"` (DOC-05). Mở từ Hộp việc giữ `DocumentInboxState` hiện có.
- **Ai được gửi:** người (human) đã đăng nhập. Agent → `403 forbidden` (agent không phải principal của share). Người đã bị vô hiệu hóa ở tổ chức của tài liệu không phân biệt được với "tài liệu không tồn tại": nhận cùng `202`, không lưu gì.
- **Phản hồi đồng nhất (không lộ tồn tại):** `POST /documents/{documentID}/access-requests` trả `202 {"status":"sent"}` cho mọi id hợp lệ về cú pháp, trừ hai ngoại lệ ngay dưới đây chỉ chạm tới yêu cầu của chính người gửi, sau cùng một lượng việc (tra cứu theo id có `organization_id`), dù: tài liệu không tồn tại; thuộc tổ chức khác; người gửi không phải thành viên đang hoạt động của tổ chức tài liệu; tài liệu thuộc Work Product; tài liệu đã archive; người gửi **đã** đọc được (trường hợp này client không hiện thẻ nên hiếm). Chỉ khi tài liệu tồn tại, cùng tổ chức với một membership đang hoạt động của người gửi, chưa archive, không thuộc Work Product và người gửi chưa đạt mức xin, server mới xét tiếp yêu cầu **của chính người gửi** trên tài liệu đó: đang chờ → `409 access_request_pending`; vừa bị từ chối chưa đủ 1 giờ → `429 access_request_cooldown`; còn lại thì **lưu** một yêu cầu `pending` và thông báo người quản lý (mục "Một yêu cầu chờ" và "Xin lại" bên dưới). Hai lỗi này **không** lộ tồn tại: chúng chỉ xuất hiện sau khi người gửi đã qua mọi điều kiện ở trên, và chỉ dựa trên dòng do chính người gửi tạo — người gửi chưa từng gửi thì luôn nhận `202`, nên id không tồn tại, của tổ chức khác hay tài liệu mà người gửi chưa từng xin đều cho cùng một phản hồi `202`. Không có route nào cho người gửi đọc lại trạng thái yêu cầu của mình (một route như vậy sẽ thành cách dò tồn tại); kết quả đến qua thông báo, và hai lỗi trên mang đủ thông tin để thẻ khóa hiện đúng trạng thái.
- **Mức xin:** `requested_level` ∈ `view` (mặc định) | `edit`; thêm `comment` khi thẻ DOC-05/G8-18 server đã vào. Lời nhắn tùy chọn ≤ 500 ký tự sau `strings.TrimSpace`.
- **Ngữ cảnh nguồn (task/meeting):** body có cặp tùy chọn `source_kind` (`task`|`meeting`) + `source_id` (gọi chung là "nguồn"). Web điền khi người dùng bấm URL tài liệu nội bộ trong mô tả/bình luận task (liên kết gắn `?from=task:<id>`). **Seam (`R1-14`, `F-05`):** `link-handler.ts` không biết host nào đang hiện editor, nên W-DOC07 thêm một context `EditorLinkContext {kind: "task" | "meeting", id}` trong `packages/views/editor/` (provider + hook), do host đặt: `packages/views/tasks/detail/components/task-detail-editors.tsx` (mô tả) và `packages/views/tasks/detail/components/comment-editor.tsx` (bình luận task); `content-editor.tsx` đọc context và nhờ `link-handler.ts` gắn `from` vào đường dẫn tài liệu nội bộ (chỉ đường dẫn `/documents/{id}`, không đụng liên kết khác). Màn tài liệu đọc `from`, giữ trong state của thẻ khóa, rồi `replace` bỏ `from` khỏi địa chỉ để sao chép/chia sẻ URL không mang id task. **Meeting hoãn:** ghi chú và chat meeting hôm nay là chữ thường, không có liên kết bấm được (mục 0.3), nên không có điểm gắn `from=meeting`; hợp đồng server vẫn nhận `source_kind=meeting` để không phải đổi wire khi meeting có liên kết. Phạm vi này là câu hỏi mở Q5 (mục 8). Server chỉ giữ `source` khi người gửi **đọc được** task/meeting đó qua cổng của chính nó (`TaskService`/`MeetingService` authorize) **và** nó cùng tổ chức với tài liệu; nếu không, `source` bị bỏ **im lặng** (không lỗi — lỗi sẽ thành cách dò task). Người quản lý thấy "từ công việc/cuộc họp X" chỉ khi chính họ đọc được nguồn đó (kiểm lúc đọc danh sách); nếu không, chỉ thấy "từ một liên kết".
- **Ai duyệt:** người có `canAdminister()` trên tài liệu (ACL owner, share `manage`, hoặc ws owner/admin với `AdminScope` — DOC-05 cho phép admin chia sẻ cho **người khác**). Người gửi không tự duyệt yêu cầu của mình (nếu người gửi là admin với `AdminScope` thì đã có đường break-glass; yêu cầu do admin tự gửi và tự duyệt → `403 break_glass_required`).
- **Người nhận thông báo yêu cầu:** ACL owner (nếu đang là thành viên hiệu lực) và mọi người có share `user` mức `manage` còn hiệu lực; nếu tập này rỗng → ws owner/admin của workspace chứa tài liệu. Không bao giờ thông báo cho chính người gửi.
- **Duyệt:** người duyệt chọn mức `granted_level` (mặc định = `requested_level`, được chọn thấp hơn hoặc cao hơn, tối đa `edit`; muốn `manage` thì dùng hộp Chia sẻ). Trong một tx: khóa yêu cầu (`FOR UPDATE`), kiểm còn `pending` và chưa hết hạn, kiểm cổng duyệt, rồi gọi thân share **theo tx** cho principal `user` = người gửi. `ShareDocument` hôm nay tự mở tx và tự khóa dòng tài liệu (`document_shares.go:105-125` → `withDocumentViewOrAdministerMutationLocked`, `document_permissions.go:583-700`), nên không gọi lồng được: S-DOC07 tách phần thân thành `shareDocumentInTx(ctx, q, actor, doc, access, in)` (kiểm level, `validateSharePrincipal`, revoke-rồi-insert, audit `document.shared` + outbox), `ShareDocument` gọi lại hàm này bên trong `withDocumentViewOrAdministerMutationLocked`; duyệt yêu cầu và chuyển chủ (mục 2.1) gọi nó trong tx của mình, sau khi đã khóa dòng tài liệu — một tx, một lần khóa (`R1-15`). Luật duyệt **chỉ nâng**: nếu người gửi đã có mức ≥ `granted_level` (vừa được ai đó chia sẻ) thì không đổi share, yêu cầu vẫn đóng `approved` với `share_id` rỗng. `validateSharePrincipal` từ chối (người gửi vừa bị vô hiệu hóa) → yêu cầu đóng `cancelled`, trả `422 principal_not_in_organization`. (Đóng `cancelled` rồi trả lỗi nghĩa là tx phải **commit** dòng `cancelled` trước khi trả 422: service ghi trạng thái, commit, rồi trả `CodedError` — không trả lỗi từ trong callback tx, vì callback lỗi sẽ rollback.)
- **Từ chối:** đóng `declined`, lời nhắn tùy chọn của người từ chối **không** gửi cho người xin (chọn: tránh trao đổi riêng tư qua hệ thống quyền; người từ chối muốn giải thích thì nhắn trực tiếp). Người xin nhận thông báo "đã từ chối".
- **Một yêu cầu chờ cho mỗi (tài liệu, người gửi) (quyết định 2026-10-15, Q4):** khi yêu cầu trước của người gửi trên tài liệu đó còn `pending` (chưa hết hạn), lần gửi mới bị **từ chối** `409 access_request_pending`: không đổi dòng nào, không nâng mức, không đổi lời nhắn, không audit, không outbox, không thông báo. Muốn đổi mức hay lời nhắn thì chờ yêu cầu cũ được xử lý hoặc hết hạn. Server là nguồn sự thật: cờ trên thiết bị (mục 3.4) chỉ để hiển thị, và `409` này đưa thẻ khóa sang trạng thái "Đã gửi yêu cầu" dù cờ đã mất.
- **Xin lại sau khi bị từ chối (quyết định 2026-10-15, Q4):** yêu cầu `declined` chỉ cho gửi yêu cầu mới sau `decided_at + 1 giờ`. Sớm hơn → `429 access_request_cooldown` với `fields.retry_after_seconds` (số giây còn lại, làm tròn lên, ≥ 1) và header `Retry-After` cùng giá trị (cùng cách `ai_rate_limited` dùng `Fields` để đặt `Retry-After`, `handler/ai_uniwork.go:127-134`, helper `uniworkRetryAfter` ở `:154`); không đổi dòng nào, không thông báo. Cooldown tính từ lần từ chối **gần nhất** của cặp (tài liệu, người gửi). Từ chối vẫn **không** gửi lời nhắn tới người xin (chỉ thông báo "đã từ chối"); thời điểm được xin lại hiện trên thẻ khóa nhờ `retry_after_seconds`. Yêu cầu hết hạn (30 ngày) không trả lời không phải là từ chối: người xin được gửi lại ngay; chờ 1 giờ chỉ sau khi bị từ chối rõ ràng.
- **Hết hạn và các trạng thái đóng khác:** yêu cầu `pending` quá **30 ngày** coi như `expired` khi đọc/duyệt (không cần worker; tính bằng `expires_at`). Duyệt yêu cầu đã hết hạn → `409 access_request_closed`. Yêu cầu `expired`, `cancelled` (và `approved`, ví dụ quyền bị thu hồi sau đó) **không** có cooldown: người xin gửi lại ngay, dòng hết hạn được làm mới thành yêu cầu mới (mục 5), dòng `cancelled`/`approved` giữ nguyên lịch sử và một dòng mới được chèn.
- **Giới hạn tần suất:** `POST …/access-requests` có limiter riêng theo người: `mw.RateLimitByIdentityBucket(d.Redis, "doc-access-request", 20, time.Hour, proxies, bearerUser(d.Minter))` (như bucket `ai-byok` ở `router.go:226`) — **một** ngân sách cho mỗi người trên mọi tài liệu. Không dùng `mw.RateLimitByIdentity`: nó khóa bộ đếm theo `r.URL.Path` (`middleware/ratelimit.go:96-98`), nên mỗi `documentID` sẽ là một ngân sách mới (20/giờ **mỗi tài liệu**) (`R1-8`; tiền lệ bucket ở `handler/router/router.go:198-208`). Cùng cơ chế fail-open 100ms của limiter hiện có.

### 3.2 Trạng thái

| Trạng thái (`status`) | Vào khi | Ra khi |
| --- | --- | --- |
| `pending` | Lần gửi hợp lệ khi người gửi không có yêu cầu `pending` chưa hết hạn và không còn trong cooldown (mới, hoặc sau `expired`/`cancelled`/`approved`/`declined` + 1 giờ). Trong lúc `pending`, mọi lần gửi mới của cùng người trên tài liệu đó → `409 access_request_pending` | duyệt / từ chối / hết hạn / hủy |
| `approved` | Người quản lý duyệt (có hoặc không tạo share mới) | — (cuối); không cooldown, xin lại được ngay |
| `declined` | Người quản lý từ chối; ghi `decided_at` | — (cuối); **cooldown 1 giờ** tính từ `decided_at`, trong thời gian đó gửi mới → `429 access_request_cooldown`; sau đó xin lại bằng dòng mới |
| `expired` | `expires_at ≤ now()` lúc đọc | — (cuối, suy ra; cột lưu vẫn `pending` tới khi có lệnh ghi chạm vào); không cooldown, gửi lại làm mới dòng này thành yêu cầu mới |
| `cancelled` | Duyệt/từ chối trên tài liệu đã archive, hoặc người xin đã bị vô hiệu hóa lúc duyệt. (Người xin đã đủ mức lúc duyệt thì là `approved`, không phải `cancelled`) | — (cuối); không cooldown |

Archive tài liệu: các yêu cầu `pending` không bị sửa lúc archive (archive không chạm bảng này để giữ tx archive gọn); danh sách yêu cầu loại tài liệu đã archive, và duyệt/từ chối trên tài liệu đã archive → `409 access_request_closed` (ghi `cancelled`). Purge: xóa các dòng yêu cầu của tài liệu trong tx purge (`purgeOneDocument`, `document_lifecycle.go:1243-1268`, gọi `hardDeleteDocumentTx` `:1277` với danh sách dọn dẹp phụ thuộc ở `:1326-1385`; thêm một hàm xóa vào danh sách đó — không FK, dọn bằng service).

### 3.3 Trường hợp biên

| Trường hợp | Hành vi |
| --- | --- |
| Tài liệu `restricted` được liên kết từ một task người xin **thấy được** | Thẻ khóa `member`; `source` hợp lệ được giữ; người quản lý thấy nguồn nếu chính họ đọc được task. Thấy task không cho quyền gì trên tài liệu |
| Tài liệu `workspace`, người xin ở workspace khác cùng tổ chức | Như trên (share vượt workspace trong tổ chức là hợp lệ, `shareAppliesTo`) |
| Id thuộc tổ chức khác / không tồn tại / người xin đã vô hiệu hóa | Cùng thẻ, cùng `202`, không lưu, không thông báo |
| Tài liệu thuộc Work Product | Cùng `202`, không lưu (quyền do resolver của sản phẩm; chia sẻ là 409) |
| Đã có yêu cầu chờ (chưa hết hạn) của chính người gửi | `409 access_request_pending`; không đổi dòng, không nâng mức, không thông báo. Thẻ khóa chuyển sang "Đã gửi yêu cầu", không có nút gửi |
| Yêu cầu của người gửi bị từ chối chưa đủ 1 giờ | `429 access_request_cooldown` + `fields.retry_after_seconds` + `Retry-After`; không đổi dòng, không thông báo. Thẻ khóa hiện thời điểm được xin lại |
| Yêu cầu bị từ chối quá 1 giờ, hoặc hết hạn, hoặc bị hủy | `202`, dòng mới (dòng `pending` hết hạn được làm mới tại chỗ), thông báo người quản lý |
| Hai lần gửi của cùng người cùng lúc | Chỉ lần thắng chỉ mục duy nhất `pending` được lưu và thông báo; lần kia nhận `409 access_request_pending` (không bao giờ có hai dòng chờ) |
| Người xin vừa được chia sẻ trong lúc chờ | Duyệt → `approved` không đổi share (chỉ nâng). Màn của người xin làm mới nhờ `document.access_request_decided` (`ScopeUser`, tới người xin dù ở workspace nào) → invalidate `documentKeys.detail(wsId, id)` mà thẻ khóa đang theo dõi. **Không** dựa vào `document.shared`: topic đó là `ScopeWorkspace` (`outbox/catalogue.go:258`), người xin ở workspace khác (dòng trên) không nhận. Share do người khác cấp **ngoài** luồng xin quyền tới người xin khác workspace chỉ qua lần tải kế tiếp (nút "Thử mở lại" trên thẻ, hoặc tải lại trang) (`F-07`) |
| Hai người quản lý duyệt/từ chối cùng lúc | Khóa dòng yêu cầu; người sau nhận `409 access_request_closed` |
| Không còn người nhận thông báo (không ACL owner, không share `manage`, workspace không còn owner/admin) | Lưu yêu cầu; không thông báo; vẫn hiện trong danh sách khi một người quản lý mở hộp Chia sẻ |
| Người duyệt chỉ có `AdminScope` | Duyệt được cho người khác (không đọc nội dung); tự duyệt yêu cầu của chính mình → `403 break_glass_required` |
| Liên kết công khai (`/public/documents/{token}`) | Không đổi; không có thẻ khóa, không xin quyền (người ẩn danh) |

### 3.4 UI và chuỗi

- **`DocumentLockedCard variant="member"`** (component dùng chung do thẻ DOC-05 web tạo; nếu DOC-07 web vào trước thì DOC-07 tạo component với cả hai biến thể và DOC-05 dùng lại): biểu tượng ổ khóa, tiêu đề, thân trung tính, chọn mức ("Xem" / "Chỉnh sửa", thêm "Bình luận" khi có), ô lời nhắn tùy chọn (bộ đếm `{{count}}/500`), nút "Gửi yêu cầu", nút "Thử mở lại" (refetch `documentKeys.detail`), nút "Quay lại". Sau khi gửi: trạng thái "Đã gửi yêu cầu" (thay nút bằng dòng trạng thái, **không còn nút gửi** — mức và lời nhắn hiện chỉ đọc); trạng thái này giữ trên thiết bị qua `StorageAdapter` (khóa theo document id, 24 giờ) — chỉ là tiện ích hiển thị, **server là nguồn sự thật**: `409 access_request_pending` cũng đặt lại cờ và chuyển thẻ sang trạng thái này (cờ mất do đổi thiết bị/hết 24 giờ không cho gửi đè được). **Xóa cờ (`F-08`):** khi nhận `document.access_request_decided` cho tài liệu đó (duyệt hoặc từ chối), và khi `GET /documents/{id}` thành công. **Sau khi bị từ chối:** thẻ trở lại biểu mẫu gửi; nếu bấm gửi trong 1 giờ đầu, server trả `429 access_request_cooldown` và thẻ hiện "bạn có thể xin lại sau {{minutes}} phút" (từ `fields.retry_after_seconds`, làm tròn lên) với nút gửi `aria-disabled` tới hết thời gian đó (`aria-disabled` giữ nút trong thứ tự tab, như hợp đồng a11y của primitive); nút bật lại khi đếm xong, không cần tải lại.
- **Trạng thái lỗi của thẻ (`F-13`):** `409 access_request_pending` → trạng thái `already_pending` (không phải lỗi); `429` có `code = access_request_cooldown` → `cooldown`; `429` không có `code` (limiter 20/giờ) → `rate_limited`; mất mạng / 5xx → `send_failed` kèm "Thử lại", giữ nguyên mức và lời nhắn đã gõ; lời nhắn > 500 bị chặn ở client (`message_too_long`, nút gửi `aria-disabled`) trước khi tới server.
- **Phía người quản lý:** hộp Chia sẻ có mục "Yêu cầu truy cập" (đếm số chờ) liệt kê: tên người xin, mức xin, lời nhắn, nguồn (nếu đọc được), thời điểm; mỗi hàng có chọn mức + "Duyệt" / "Từ chối". Thông báo Hộp việc mở thẳng mục này (`?access=requests`, đọc rồi `replace` bỏ tham số như `?share=1` ở mục 1). Cổng là `canAdministerDocument`, đọc ở **hai** lối vào của mục 2.5 — `document-actions-menu.tsx` và thẻ khóa `variant="admin"` — vì người nhận dự phòng (ws owner/admin) thường chỉ có `AdminScope` và không có `DocumentActionsMenu` (`N-01`). Không có `canAdministerDocument` → bỏ tham số im lặng. **Mở đúng mục (`N-02`):** hộp mở với mục "Yêu cầu truy cập" được cuộn vào tầm nhìn và focus đặt lên heading của mục (`tabIndex={-1}`); danh sách rỗng (đã có người xử lý) → mục hiện `documents.access_request.none_pending`; tài liệu đã archive → màn archive bình thường, tham số bị bỏ và hộp không mở (ở thẻ khóa `admin`, dấu hiệu archive đến từ `archived_at` của `admin-summary`, mục 2.5; danh sách loại tài liệu đã archive, duyệt sẽ là `409`, mục 3.2). Danh sách thư viện/cây không đổi.
- **Chờ server, không lạc quan (`F-06`):** gửi yêu cầu, duyệt, từ chối đều chờ phản hồi; nút đang bấm `aria-disabled` + `<Spinner />`. Khóa query mới `documentKeys.accessRequests(wsId, id)` = `[...documentKeys.detail(wsId, id), "access-requests"]` (con của khóa chi tiết như `shares`, `keys.ts`). Duyệt/từ chối thành công → invalidate `accessRequests` + `shares` của tài liệu; `409 access_request_closed` → hiện `closed` và invalidate `accessRequests`.

| Vị trí | Khóa (`documents.access_request.*` / `notifications.*`, `F-09`) | vi | en |
| --- | --- | --- | --- |
| Thẻ khóa — tiêu đề, thân | `locked_title`, `locked_body` | `"Bạn chưa mở được tài liệu này"` · `"Tài liệu có thể không tồn tại, hoặc bạn chưa có quyền xem. Bạn có thể gửi yêu cầu tới người quản lý tài liệu."` | `"You can't open this document"` · `"It may not exist, or you don't have access yet. You can ask the people who manage it."` |
| Chọn mức, lời nhắn, bộ đếm | `level_label`, `message_label`, `message_placeholder`, `message_counter` | `"Quyền cần xin"` · `"Lời nhắn (không bắt buộc)"` · `"Vì sao bạn cần tài liệu này?"` · `"{{count}}/500"` | `"Access you need"` · `"Message (optional)"` · `"Why do you need this document?"` · `"{{count}}/500"` |
| Nút gửi / đang gửi / đã gửi | `send`, `sending`, `sent` | `"Gửi yêu cầu"` · `"Đang gửi…"` · `"Đã gửi yêu cầu. Bạn sẽ nhận thông báo khi người quản lý trả lời."` | `"Request access"` · `"Sending…"` · `"Request sent. You'll be notified when someone responds."` |
| Đã có yêu cầu đang chờ (cờ cục bộ hoặc `409 access_request_pending`) | `already_pending` | `"Yêu cầu của bạn đang chờ người quản lý trả lời."` | `"Your request is waiting for a manager to respond."` |
| Mới bị từ chối, chưa xin lại được (`429 access_request_cooldown`) | `cooldown` | `"Yêu cầu trước đã bị từ chối. Xin lại được sau {{minutes}} phút."` | `"Your earlier request was declined. You can ask again in {{minutes}} min."` |
| Thử mở lại (`F-07`) | `retry_open` | `"Thử mở lại"` | `"Try opening again"` |
| Lỗi gửi (mạng/5xx/429) | `send_failed`, `rate_limited` | `"Chưa gửi được yêu cầu. Hãy thử lại."` · `"Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau ít phút."` | `"Couldn't send the request. Try again."` · `"You've sent a lot of requests. Try again in a few minutes."` |
| Lời nhắn quá dài | `message_too_long` | `"Lời nhắn tối đa 500 ký tự."` | `"Message must be 500 characters or fewer."` |
| Mục trong hộp Chia sẻ | `section_title`, `row_source`, `row_source_unknown`, `approve`, `decline`, `approved`, `declined`, `closed` | `"Yêu cầu truy cập ({{count}})"` · `"Từ {{source}}"` · `"Từ một liên kết"` · `"Duyệt"` · `"Từ chối"` · `"Đã cấp quyền {{level}} cho {{name}}"` · `"Đã từ chối yêu cầu của {{name}}"` · `"Yêu cầu này đã được xử lý hoặc đã hết hạn."` | `"Access requests ({{count}})"` · `"From {{source}}"` · `"From a link"` · `"Approve"` · `"Decline"` · `"Access granted to {{name}} ({{level}})"` (`F-15`) · `"Declined {{name}}'s request"` · `"This request was already handled or has expired."` |
| Mục rỗng khi mở từ `?access=requests` (`N-02`) | `none_pending` | `"Không còn yêu cầu nào đang chờ."` | `"No requests are waiting."` |
| Thông báo cho người quản lý | `notifications.kind.document_access_requested` (+ `_untitled`), `notifications.kindTitle.document_access_requested` | `"{{actor}} xin quyền truy cập tài liệu “{{document}}”."` · `"{{actor}} xin quyền truy cập một tài liệu."` · ngắn: `"Yêu cầu truy cập tài liệu"` | `"{{actor}} requested access to “{{document}}”."` · `"{{actor}} requested access to a document."` · short: `"Document access request"` |
| Thông báo cho người xin | `notifications.kind.document_access_approved`, `notifications.kind.document_access_declined`, `kindTitle.*` | `"{{actor}} đã cấp cho bạn quyền truy cập “{{document}}”."` · `"Yêu cầu truy cập tài liệu của bạn đã bị từ chối."` · ngắn: `"Đã được cấp quyền"` / `"Yêu cầu bị từ chối"` | `"{{actor}} gave you access to “{{document}}”."` · `"Your request to access a document was declined."` · short: `"Access granted"` / `"Request declined"` |

Thông báo "từ chối" **không** chứa tiêu đề tài liệu (người xin chưa từng đọc được tiêu đề; renderer không có quyền đọc tài liệu cho người đó). Thông báo "đã cấp" có tiêu đề vì lúc render người nhận đã đọc được.

**A11y:** thẻ khóa là `section` có heading thật (không phải `StepperTitle`), nút chính là hành động đầu tiên trong thứ tự tab sau heading; trạng thái "Đã gửi" trong `role="status"`; ô lời nhắn có nhãn và bộ đếm nối `aria-describedby`; lỗi trường đọc được bằng trình đọc màn hình; biểu tượng ổ khóa `aria-hidden` kèm chữ.

## 4. Hợp đồng wire

Mọi route REST đăng ký qua wrapper `api` trong `server/internal/handler/router/documents.go` (nhóm `registerDocuments`, sau `mw.RequireFeatureFlag(flags, "documents")` ở `:69`), có `apiOp{summary, description, tags, sdi, sdo, auth: true}`; SDI ở `server/internal/handler/dto/sdi/document.go`, SDO ở `dto/sdo/document.go`, có `description` + `example`. JSON body qua `decode(w, r, &in, limit)`.

### 4.1 DOC-02

| Route | Thay đổi |
| --- | --- |
| `POST /api/v1/workspaces/{workspaceID}/documents` | Không đổi (đã có `visibility`); sửa mô tả: `"workspace (mặc định) hoặc restricted; rỗng = kế thừa cha"` |
| `POST /api/v1/workspaces/{workspaceID}/documents/files` (multipart) | Thêm trường form `visibility` (`formData:"visibility"`, tùy chọn, `workspace`/`restricted`, phải đứng **trước** phần `file` như `parent_id`/`title`) vào `CreateDocumentFileSDI` (`dto/sdi/document.go:32-36`); `CreateFileDocumentInput.Visibility` |
| `POST /api/v1/workspaces/{workspaceID}/documents/files/blank` | Thêm `Visibility *string \`json:"visibility" description:"workspace hoặc restricted; bỏ trống = kế thừa cha, ở gốc = workspace" example:"restricted"\`` vào `CreateBlankDocumentFileSDI` (`dto/sdi/office.go:45-49`); `BlankFileInput.Visibility` chuyển xuống `CreateFileDocumentInput` |
| `GET /api/v1/config` | Không đổi SDO. Thêm **một mục** vào catalogue `server/internal/workcapability/catalogue.go:24-64`: `"documents.create_visibility": {Status: Available}` (+ `catalogue_test.go`); nó tự đi ra trong `work_management_capabilities` (`config.go:44-52`). Client: thêm `"documents.create_visibility"` vào union `WorkManagementCapability` (`packages/core/capabilities/types.ts:3-12`) và đọc bằng `capabilityState()` — schema đã có (`config.ts:38`, `.catch({})`), mục vắng = `unavailable`/`capability_unknown` → ẩn công tắc cho tệp (`R1-4`, `F-03`). Không tạo object `capabilities` mới (client `ConfigSchema` là `z.object` thường, sẽ cắt khóa lạ) |

Lỗi: giá trị `visibility` lạ → `400 invalid_request` (không `fields`; như route trang hôm nay) (`R1-2`). Không có route, sự kiện, kind thông báo, audit action hay dòng isolation mới (trường mới không phải `_id`). Không có feature flag mới (mặc định không đổi; mục capability chỉ để tương thích phiên bản, không cấp quyền).

### 4.2 DOC-06

| Method & path | SDI | SDO | Cổng |
| --- | --- | --- | --- |
| `PUT /api/v1/documents/{documentID}/owner` | `TransferDocumentOwnerSDI{ user_id string (ULID, bắt buộc) "ULID người nhận, thành viên hiệu lực của workspace chứa tài liệu" ex "01J8X4USER0N1P2Q3R4S5T6U7V8"; previous_owner_level *string "edit (mặc định), comment, view hoặc none" ex "edit" }` | `DocumentOwnerSDO{ document_id, acl_owner_id, previous_owner_id, previous_owner_share_id (rỗng khi none/bỏ qua) }` | `withDocumentAdministerMutation` → `canAdminister()` |
| `GET /api/v1/orgs/{org}/members/{userID}/document-ownership` | — | `MemberDocumentOwnershipSDO{ user_id, total int, workspaces: [{workspace_id, workspace_name, count}] }` — chỉ đếm, không tiêu đề | owner/admin tổ chức (`OrganizationService.RequireMember` + vai trò, như `requireAdmin`) |
| `POST /api/v1/orgs/{org}/members/{userID}/document-ownership` | `TransferMemberDocumentsSDI{ to_user_id string (ULID, bắt buộc); bulk_id *string (ULID của đợt, gửi lại ở các lần tiếp); cursor *string (mờ, lấy từ phản hồi trước; bỏ trống ở lần đầu) }` | `MemberDocumentsTransferSDO{ bulk_id, transferred int, skipped: {recipient_not_member int, self_restricted int}, has_more bool, cursor string (rỗng khi hết) }` (mục 2.2, `R1-10`) | như trên; admin không thao tác trên admin khác (luật P6, `organization_members.go:221-224`) |

Ví dụ:

```json
PUT /api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/owner
{"user_id": "01J8X4USER0N1P2Q3R4S5T6U7V8", "previous_owner_level": "edit"}
→ 200 {"document_id": "01J8X4DOC0N1P2Q3R4S5T6U7", "acl_owner_id": "01J8X4USER0N1P2Q3R4S5T6U7V8", "previous_owner_id": "01J8X4K2M0N1P2Q3R4S5T6U7V8", "previous_owner_share_id": "01J8X4SHAREN1P2Q3R4S5T6U7"}

POST /api/v1/orgs/acme/members/01J8X4K2M0N1P2Q3R4S5T6U7V8/document-ownership
{"to_user_id": "01J8X4USER0N1P2Q3R4S5T6U7V8"}
→ 200 {"bulk_id": "01J8X4BULK0N1P2Q3R4S5T6U7", "transferred": 497, "skipped": {"recipient_not_member": 3, "self_restricted": 0}, "has_more": true, "cursor": "01J8X4DOCZN1P2Q3R4S5T6U7"}

POST /api/v1/orgs/acme/members/01J8X4K2M0N1P2Q3R4S5T6U7V8/document-ownership
{"to_user_id": "01J8X4USER0N1P2Q3R4S5T6U7V8", "bulk_id": "01J8X4BULK0N1P2Q3R4S5T6U7", "cursor": "01J8X4DOCZN1P2Q3R4S5T6U7"}
→ 200 {"bulk_id": "01J8X4BULK0N1P2Q3R4S5T6U7", "transferred": 12, "skipped": {"recipient_not_member": 0, "self_restricted": 0}, "has_more": false, "cursor": ""}
```

**Tên route (`R2-2`, quyết định của lead):** hai route cấp tổ chức dùng `{org}` = **slug** tổ chức, như mọi route thành viên anh em: `PATCH /orgs/{org}/members/{userID}`, `POST /orgs/{org}/members/{userID}/deactivate`, `…/reactivate` (`server/internal/handler/router/organizations.go:15-19` trong khối chú thích route, deactivate đăng ký ở `:89`). Handler phân giải bằng `orgIDFromSlug` (`server/internal/handler/organization_members.go:31-38`, `GetBySlug` với người gọi), rồi mới gọi service bằng ULID tổ chức. Không dùng `{orgID}` (ULID) dù `/orgs/{orgID}/office/capabilities` (`organizations.go:116`) có tiền lệ: client của mục thành viên chỉ cầm `orgSlug` (`packages/core/api/endpoints/organization-members.ts:28, 59, 69`; `organization-tab.tsx:56` truyền `orgSlug` cho `OrgMembersSection`), nên `{org}` không cần prop mới và không cần thêm `organization-tab.tsx` vào owned paths.

Lỗi:

| HTTP | `code` | Khi | `error_class` |
| --- | --- | --- | --- |
| 404 | (chung) | Tài liệu/thành viên không thấy được, khác tổ chức | `missing` |
| 403 | `forbidden` | Đọc được nhưng không `canAdminister()`; không phải owner/admin tổ chức | `permission` |
| 403 | `break_glass_required` | Admin chỉ có `AdminScope` tự nhận tài liệu `restricted` (từng tài liệu) | `permission` (đã đăng ký bởi DOC-05) |
| 409 | `document_owned_by_work_product` | Tài liệu thuộc Work Product | (đã có, `unclassified`) |
| 422 | `owner_target_not_member` | Người nhận không phải người/không đang hoạt động/không là thành viên hiệu lực của workspace (từng tài liệu); người nhận hàng loạt không phải thành viên đang hoạt động của tổ chức hoặc trùng thành viên nguồn | **không phân lớp, có chủ đích** (`R1-1`): thêm tên mã vào khối chú thích "Deliberately unclassified codes" của `handler/dto/sdo/error_class.go:86-177` với lý do "(422) hộp chọn người hiện lỗi ngay trên picker; không phải mất quyền (`permission`) hay xung đột trạng thái (`conflict`)", và vào `unclassified` của `TestErrorClassTable` khi bộ quét DOC-05 có. Không thêm lớp: bảy lớp là tập đóng (`error_class.go:9-84`; client `packages/core/api/http.ts:24-32`, `packages/core/types/document.ts:45-54`; `docs/parity/documents-api/index.json:150-158`) |
| 400 | `invalid_request` | `previous_owner_level` lạ; `bulk_id` không phải ULID; `cursor` không phải ULID (service `Invalid(...)` → `mapServiceError`, không `fields`) (`R1-2`) | — (không phân lớp như hôm nay) |

Sự kiện (thêm ở **ba** nơi: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`; chỉ id):

| Topic | Payload | Scope | Client |
| --- | --- | --- | --- |
| `document.owner_transferred` | `document_id`, `workspace_id`, `bulk_id` (tùy chọn, chỉ lệnh hàng loạt) | `ScopeWorkspace` | invalidate khóa chi tiết + danh sách truy cập của tài liệu, các list gốc của workspace |
| `document.owners_bulk_transferred` | `organization_id`, `user_id` (người nhận), `bulk_id` | `ScopeUser` | invalidate list tài liệu của người nhận; nguồn của thông báo gộp |

Audit (`server/internal/audit/actions.go` + `service/audit_coverage_test.go`) — **một** bộ khóa cho cả hai lệnh (`R2-3`; mục 2.2 trỏ về đây): `document.owner_transferred` (`ResourceType=document`, `Changes{acl_owner_id: before→after}`, `Metadata{from_user_id, previous_owner_level, bulk_id?}` — `from_user_id` = chủ cũ, luôn có; `previous_owner_level` luôn có, lệnh hàng loạt ghi `none`; `bulk_id` chỉ khi đi từ lệnh hàng loạt), `document.owners_bulk_transferred` (`ResourceType=organization_member`, `Metadata{bulk_id, to_user_id, transferred, skipped:{recipient_not_member, self_restricted}}`). `audit_coverage_test.go` không ghim khóa metadata, nên DOC6-A01/A04 kiểm chúng.

Thông báo (kind mới, đồng bộ đủ nơi như phụ lục mức quyền §4: `notification/kinds.go`, `prefs.go`, `titles.go` + test, `push_consumer.go`, `packages/core/types/notification.ts`, renderer `packages/views/notifications/*`):
- `document_owner_transferred` — từ `document.owner_transferred` của lệnh **từng tài liệu**, gửi chủ mới.
- `document_owners_bulk_transferred` — từ `document.owners_bulk_transferred`, gửi người nhận đợt, `group_key = document_owner_bulk:{bulk_id}` để các lần gọi tiếp của cùng đợt gộp vào một dòng.
- **Phân biệt mà payload vẫn chỉ có id (chọn):** lệnh hàng loạt vẫn phát `document.owner_transferred` cho từng tài liệu (realtime cần để client làm mới), nhưng payload có thêm khóa tùy chọn `bulk_id` (một id — hợp lệ với luật ids-only); rule thông báo của `document_owner_transferred` **bỏ qua** dòng có `bulk_id`. Catalogue khai `bulk_id` là khóa tùy chọn của topic.
- **Kiểm lại người nhận lúc gửi (`R1-6`):** `document_owner_transferred` dùng port đọc **sẵn có** `DocumentReadChecker.CanReadDocument` (`notification/rules.go:43-51`): chủ mới là ACL owner, thành viên hiệu lực → đọc được; nếu không đọc được (vừa rời workspace) thì không gửi. `document_owners_bulk_transferred` không gắn một tài liệu, không có tiêu đề tài liệu → chỉ kiểm người nhận còn là thành viên đang hoạt động qua `OrgMemberChecker` sẵn có (`rules.go:34-37`). S-DOC06 **không** cần port mới.
- Push mặc định **tắt** cho cả hai (không gấp). Tiêu đề: `"{{actor}} đã chuyển cho bạn quyền sở hữu tài liệu “{{document}}”."` / `"{{actor}} transferred ownership of “{{document}}” to you."`; gộp: `"{{actor}} đã chuyển cho bạn quyền sở hữu các tài liệu của {{name}}."` / `"{{actor}} transferred {{name}}'s documents to you."`.

Isolation (ADR 0008):
- `isoRoutes` (`server/internal/handler/isolation_routes_test.go`): thêm cả ba route; `PUT …/owner` có control (owner của B chuyển tài liệu của chính B); `GET/POST /orgs/{org}/members/{userID}/document-ownership` có control trong tổ chức của B (harness đã thay `{org}` bằng slug của tenant, `isolation_matrix_test.go:559-577`).
- `isoReferences` (`isolation_references_test.go`): `TransferDocumentOwnerSDI.user_id` (đưa id người của A vào tài liệu của B → `422 owner_target_not_member`, không lộ tên), `TransferMemberDocumentsSDI.to_user_id` (người của A làm người nhận trong tổ chức B → 422), `TransferMemberDocumentsSDI.bulk_id` → **miễn** (chốt, `R1-12`): thêm `isoRefFieldExempt["TransferMemberDocumentsSDI.bulk_id"] = "server-generated correlation id of one bulk transfer, never resolved to a row"` (`isolation_references_test.go:390-432`). `cursor` không kết thúc bằng `_id` nên bộ quét không đòi case; nó chỉ là ranh giới `id >` trong câu đã ràng buộc `organization_id` của tổ chức trên path.
- `pathParamSDI` (`router/openapi.go`): **không** cần case mới. Khóa của hàm là tên tham số nối bằng dấu phẩy (`openapi.go:109-116`); `PUT /documents/{documentID}/owner` dùng case `documentID` sẵn có, hai route tổ chức dùng case `"org,userID"` sẵn có (`openapi.go:212-216`, "Slug tổ chức" + "ULID thành viên"). Nếu thẻ code đổi tên tham số (ví dụ `{orgID}`), `buildOpenAPI` báo lỗi lúc khởi động (`openapi.go:74-78`) cho tới khi có case `"orgID,userID"` — vì vậy giữ đúng `{org}` + `{userID}` (`R2-2`).

### 4.3 DOC-07

| Method & path | SDI | SDO | Cổng |
| --- | --- | --- | --- |
| `POST /api/v1/documents/{documentID}/access-requests` | `CreateDocumentAccessRequestSDI{ requested_level *string "view (mặc định), comment hoặc edit" ex "view"; message *string "≤ 500 ký tự sau trim" ex "Mình cần xem để chuẩn bị họp thứ Hai"; source_kind *string "task hoặc meeting; đi cùng source_id" ex "task"; source_id *string "ULID công việc/cuộc họp có chứa liên kết" ex "01J8X4TASK0N1P2Q3R4S5T6U7" }` (trường phẳng, xem mục Isolation) | `202 DocumentAccessRequestSentSDO{ status: "sent" }` — như vậy cho mọi lần gửi hợp lệ cú pháp, **trừ** `409 access_request_pending` và `429 access_request_cooldown` (chỉ khi người gửi có yêu cầu của chính mình đang chờ / vừa bị từ chối, bảng lỗi bên dưới) | đăng nhập, human; limiter `doc-access-request` 20/giờ/người |
| `GET /api/v1/documents/{documentID}/access-requests` | — | `DocumentAccessRequestListSDO{ requests: [{ id, requester_id, requester_name, requested_level, message, source: {kind, id, title} \| null, created_at, expires_at }] }` — chỉ `pending` chưa hết hạn | `authorizeDocumentViewOrAdminister` + `canAdminister()` (người đọc thường → `requests: []`) |
| `POST /api/v1/documents/{documentID}/access-requests/{requestID}/approve` | `ApproveDocumentAccessRequestSDI{ level *string "view, comment hoặc edit; mặc định = mức xin" ex "view" }` | `DocumentAccessRequestDecisionSDO{ id, status: "approved", share_id (rỗng khi người xin đã đủ mức) }` | `withDocumentAdministerMutation` |
| `POST /api/v1/documents/{documentID}/access-requests/{requestID}/decline` | — | `DocumentAccessRequestDecisionSDO{ id, status: "declined" }` | `withDocumentAdministerMutation` |

`GET /documents/{documentID}/shares` (đã có) thêm `pending_access_requests int` cho người `canAdminister()` để hộp Chia sẻ hiện số mà không cần gọi thêm. `source.title` chỉ có khi người gọi đọc được nguồn; ngược lại `source` = `null`.

Ví dụ:

```json
POST /api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/access-requests
{"requested_level": "view", "message": "Mình cần xem để chuẩn bị họp thứ Hai", "source_kind": "task", "source_id": "01J8X4TASK0N1P2Q3R4S5T6U7"}
→ 202 {"status": "sent"}

POST /api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/access-requests/01J8X4AREQ0N1P2Q3R4S5T6U7/approve
{"level": "view"}
→ 200 {"id": "01J8X4AREQ0N1P2Q3R4S5T6U7", "status": "approved", "share_id": "01J8X4SHAREN1P2Q3R4S5T6U7"}
```

Lỗi:

| HTTP | `code` | Khi | `error_class` |
| --- | --- | --- | --- |
| 202 | — | Mọi lần gửi hợp lệ cú pháp mà không rơi vào hai dòng 409/429 dưới đây (kể cả không lưu) | — |
| 403 | `forbidden` | Agent gửi yêu cầu; người đọc được nhưng không `canAdminister()` duyệt/từ chối | `permission` |
| 403 | `break_glass_required` | Admin chỉ có `AdminScope` duyệt yêu cầu của chính mình | `permission` |
| 404 | (chung) | Duyệt/từ chối/danh sách: tài liệu hoặc `requestID` không thấy được, yêu cầu thuộc tài liệu khác | `missing` |
| 409 | `access_request_closed` | Yêu cầu không còn `pending`, đã hết hạn, hoặc tài liệu đã archive | thêm `"access_request_closed": "conflict"` vào `errorClassByCode` + `TestErrorClassTable`; `docs/parity/documents-api/index.json` không đổi vì mẫu theo lớp, `conflict` đã có mẫu (lớp có sẵn: yêu cầu xung đột với trạng thái server; đường phục hồi của client là tải lại danh sách — đúng nghĩa `conflict`) |
| 409 | `access_request_pending` | Người gửi đã có yêu cầu `pending` chưa hết hạn trên tài liệu này (chỉ sau khi qua mọi điều kiện đủ để được lưu, mục 3.1; không đổi dòng, không audit, không thông báo) | thêm `"access_request_pending": "conflict"` vào `errorClassByCode` + `TestErrorClassTable` (yêu cầu xung đột với trạng thái server; client chuyển thẻ sang `already_pending` thay vì báo lỗi) |
| 429 | `access_request_cooldown` | Yêu cầu trước của người gửi bị từ chối chưa đủ 1 giờ (`now() < decided_at + 1h`). Có `fields: {"retry_after_seconds": <int ≥ 1>}` và header `Retry-After` cùng giá trị; handler đọc khóa này (helper riêng, không dùng `uniworkRetryAfter` vốn đọc `retry_after`) | **không phân lớp, có chủ đích** — như `ai_rate_limited` (`dto/sdo/error_class.go:97`): đây không phải từ chối hạn ngạch hay quyền; thêm vào chú thích `unclassified` của `error_class.go` + bộ quét DOC-05 khi có |
| 400 | `invalid_request` | `requested_level`/`level` lạ (gồm `manage`), `message` > 500, `source_kind` lạ, `source_id` không phải ULID, chỉ có một trong cặp `source_kind`/`source_id` (service `Invalid(...)`, không `fields`) (`R1-2`). Lỗi cú pháp vẫn là lỗi (không phải `202`): nó chỉ phụ thuộc body, không phụ thuộc tài liệu, nên không lộ tồn tại | — |
| 422 | `principal_not_in_organization` | Duyệt khi người xin không còn là thành viên đang hoạt động (yêu cầu → `cancelled`) | **không phân lớp, có chủ đích** — mã đã có (`service/document_shares.go:33-35`), không nằm trong `errorClassByCode`, và phụ lục mức quyền (`:173`) xếp nó vào `unclassified` của bộ quét DOC-05; thẻ này không thêm lớp (`R1-3`) |
| 429 | (limiter, không có `code`) | Vượt 20/giờ/người trên mọi tài liệu (Q4: giữ nguyên). Client phân biệt với `access_request_cooldown` bằng `code` | — |

Sự kiện (ba nơi catalogue; chỉ id):

| Topic | Payload | Scope | Client |
| --- | --- | --- | --- |
| `document.access_requested` | `document_id`, `workspace_id`, `request_id` | `ScopeWorkspace` (như `document.shared`; chỉ id) | invalidate danh sách yêu cầu + `GET …/shares` của tài liệu |
| `document.access_request_decided` | `document_id`, `workspace_id`, `request_id`, `user_id` (người xin) | `ScopeUser` (người xin) | invalidate chi tiết tài liệu (để màn thẻ khóa tải lại khi được duyệt) |

Khi duyệt có tạo share, `document.shared` hiện có cũng phát (đường `ShareDocument`).

Audit (`audit/actions.go` + `audit_coverage_test.go`): `document.access_requested` (`Actor` người xin, `ResourceType=document`, `Metadata{request_id, requested_level, source_kind?, has_message}` — **không** ghi nội dung lời nhắn vào audit; lời nhắn nằm trong bảng yêu cầu), `document.access_request_approved` (`Changes{status}`, `Metadata{request_id, granted_level, share_id?}`), `document.access_request_declined`. Lần gửi không lưu (mục 3.1) **không** ghi audit (không có thay đổi trạng thái nghiệp vụ), và `409 access_request_pending` / `429 access_request_cooldown` cũng không ghi audit, outbox hay thông báo. Không còn nhánh "gửi lại khi đang chờ có đổi mức/lời nhắn" (đã bỏ theo Q4): mỗi lần `document.access_requested` là một yêu cầu mới (kể cả khi dòng `pending` hết hạn được làm mới tại chỗ — vẫn một audit, một outbox, một thông báo, dùng `request_id` của dòng đó).

Thông báo (kind mới, đủ nơi như 4.2): `document_access_requested` (từ `document.access_requested`, người nhận theo mục 3.1, `group_key = document:{id}:access_requests`, push **bật** — người xin đang chờ), `document_access_approved` và `document_access_declined` (từ `document.access_request_decided`, người xin, push bật cho approved, tắt cho declined). Rule kiểm lại quyền người nhận lúc gửi: người quản lý phải còn `canAdminister()` (admin chỉ có `AdminScope` vẫn nhận và thấy tiêu đề, vì DOC-05 cho admin thấy tên tài liệu hạn chế); người xin bị từ chối không bao giờ thấy tiêu đề (dùng biến thể không tiêu đề).

**Port mới cho kiểm `canAdminister()` (`R1-6`):** port sẵn có chỉ là **đọc** (`DocumentReadChecker`, `rules.go:43-51`), mà admin chỉ có `AdminScope` là người phải giữ trong khi `CanReadDocument` = false. S-DOC07 thêm:
- `notification/rules.go`: `type DocumentAdministerChecker interface { FilterDocumentAdministrators(ctx context.Context, documentID string, userIDs []string) ([]string, error) }` (trả tập con còn `canAdminister()` lúc gửi); `env.docAdmins`;
- `notification/consumer.go`: `func (c *Consumer) SetDocumentAdministrators(d DocumentAdministerChecker)`; chưa gắn → rule `document_access_requested` không gửi gì (fail closed, như `SetDocumentReaders`);
- `DocumentService.FilterDocumentAdministrators` (service, `document_permissions.go`: cùng phép tính quyền mà cổng dùng, sau DOC-05 là `canAdminister()`);
- `server/cmd/server/main.go`: `notifConsumer.SetDocumentAdministrators(documentSvc)` cạnh `:474`.
`document_access_approved` dùng port đọc sẵn có (người xin vừa được cấp thì đọc được; không đọc được → không gửi). `document_access_declined` không kiểm đọc: biến thể không tiêu đề, chỉ kiểm người xin còn là thành viên đang hoạt động (`OrgMemberChecker`). Resource URL: người quản lý → tài liệu kèm `?access=requests`; người xin được duyệt → tài liệu.

Isolation:
- `isoRoutes`: thêm cả bốn route. `POST …/access-requests` là route "trả lời đồng nhất": với id của A, B nhận `202 {"status":"sent"}` giống hệt control của B (B không có dòng yêu cầu nào trên tài liệu của A, nên `409`/`429` không bao giờ xuất hiện ở đây) và **không** có dòng nào của A đổi hash (bảng yêu cầu của A không thêm dòng, outbox/audit/notification của A không thêm dòng) — `isoSpec` cần một chế độ "uniform 202" (chấp nhận 202 thay 403/404 với điều kiện thân phản hồi bằng control và không lộ chuỗi/id của A); ghi lý do trong `isoRoutes`. Ba route còn lại: refusal 403/404 bình thường, control là người quản lý của B trên tài liệu của B.
- Seed một dòng `document_access_requests` của tenant A trong `server/internal/handler/isolation_world_test.go` (không đưa vào `isoUnseeded`).
- `isoReferences`: `CreateDocumentAccessRequestSDI.source_id` (task/meeting của A gửi kèm yêu cầu trên tài liệu của B → `202`, nguồn bị bỏ, không lưu id của A: kiểm dòng yêu cầu của B có `source_id` rỗng). Trường để **phẳng** (`source_kind` + `source_id`, không lồng `source{kind,id}`) có chủ đích, để `TestEveryBodyIDFieldHasAReferenceCase` thấy trường `_id` mà không phải đổi bộ quét.
- Mục 3.1 dùng tên "`source`" cho cặp `source_kind`/`source_id`; SDO danh sách trả `source: {kind, id, title} | null` (SDO không chịu luật quét `_id` của body).
- `pathParamSDI`: thêm case `requestID` (`"ULID yêu cầu truy cập tài liệu"`, ví dụ `01J8X4AREQ0N1P2Q3R4S5T6U7`).

Feature flag: không thêm. Tất cả nằm sau cờ `documents` sẵn có.

### 4.4 Tóm tắt thông báo mới

| Kind | Từ topic | Người nhận | `group_key` | Push mặc định |
| --- | --- | --- | --- | --- |
| `document_owner_transferred` | `document.owner_transferred` (không có `bulk_id`) | chủ mới | `document:{id}:owner` | tắt |
| `document_owners_bulk_transferred` | `document.owners_bulk_transferred` | người nhận đợt | `document_owner_bulk:{bulk_id}` | tắt |
| `document_access_requested` | `document.access_requested` | người quản lý (mục 3.1) | `document:{id}:access_requests` | bật |
| `document_access_approved` | `document.access_request_decided` (approved) | người xin | `document:{id}:access_decided` | bật |
| `document_access_declined` | `document.access_request_decided` (declined) | người xin | `document:{id}:access_decided` | tắt |

## 5. Migration

**DOC-02: không có migration. DOC-06: câu sqlc mới + một migration index (không đổi bảng). DOC-07: một bảng + hai index.** (`R1-7`)

**DOC-06** dùng cột `acl_owner_id` sẵn có, không đổi bảng. Câu sqlc mới trong `server/pkg/db/queries/documents.sql`:
- `TransferDocumentACLOwner` (từng tài liệu) — `UPDATE documents SET acl_owner_id = sqlc.arg(new_owner), updated_by = sqlc.arg(updated_by), updated_by_kind = sqlc.arg(updated_by_kind), updated_at = now() WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND workspace_id = sqlc.arg(workspace_id) AND owner_kind IS NULL RETURNING *` (cặp `updated_by`/`updated_by_kind` như `UpdateDocumentContent`/`UpdateDocumentFields` ở `documents.sql:84-96, 112-130`, `R1-9`);
- `TransferDocumentACLOwnerFrom` (hàng loạt) — cùng câu trên, thêm `AND acl_owner_id = sqlc.arg(from_owner)`: dòng đã đổi chủ trong lúc chờ khóa cho 0 dòng và không được đếm;
- `ListMemberOwnedDocumentsForTransfer` — `SELECT id, workspace_id, visibility … WHERE organization_id = sqlc.arg(organization_id) AND acl_owner_id = sqlc.arg(owner) AND owner_kind IS NULL AND id > sqlc.arg(after) ORDER BY id LIMIT sqlc.arg(page) FOR UPDATE` (không `SKIP LOCKED`, `after = ''` ở lô đầu; mục 2.2, `R1-10`);
- `MemberOwnsDocumentsAfter` — `SELECT EXISTS (SELECT 1 FROM documents WHERE organization_id = sqlc.arg(organization_id) AND acl_owner_id = sqlc.arg(owner) AND owner_kind IS NULL AND id > sqlc.arg(after))` → `has_more`;
- `CountMemberOwnedDocumentsByWorkspace` — `… WHERE organization_id = sqlc.arg(organization_id) AND acl_owner_id = sqlc.arg(owner) AND owner_kind IS NULL GROUP BY workspace_id`.
Cả năm ràng buộc `organization_id = sqlc.arg(...)` (`TestEveryQueryNamesItsTenant`). Truy vấn theo `acl_owner_id` cần index: **một** migration chỉ một câu `CREATE INDEX CONCURRENTLY idx_documents_org_acl_owner ON documents (organization_id, acl_owner_id, id) WHERE owner_kind IS NULL AND acl_owner_id IS NOT NULL;` (thêm `id` để lô `id > after ORDER BY id` đi thẳng trên index) trong file `999<unix-ms>_documents_acl_owner_index.up.sql` riêng (+ `.down.sql` `DROP INDEX CONCURRENTLY`).

**DOC-07:** bảng mới, file `999<unix-ms>_document_access_requests.up.sql`:

```sql
-- Document access requests (DOC-07, UNI-1631). No FK (ADR 0001): document,
-- requester, decider and share are resolved in service code; purge deletes
-- a document's rows in its own transaction.
CREATE TABLE document_access_requests (
  id               TEXT PRIMARY KEY,               -- util.NewID() ULID
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  created_by       TEXT NOT NULL,                  -- the requester
  created_by_kind  TEXT NOT NULL,
  requested_level  TEXT NOT NULL,
  message          TEXT NOT NULL DEFAULT '',
  source_kind      TEXT,
  source_id        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  granted_level    TEXT,
  share_id         TEXT,
  decided_by       TEXT,
  decided_by_kind  TEXT,
  decided_at       TIMESTAMPTZ,                    -- the 1h re-request cooldown counts from here (declined)
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_access_requests_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_access_requests_decided_by_kind_check
    CHECK (decided_by_kind IS NULL OR decided_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_access_requests_level_check
    CHECK (requested_level IN ('view', 'comment', 'edit')
       AND (granted_level IS NULL OR granted_level IN ('view', 'comment', 'edit'))),
  CONSTRAINT document_access_requests_status_check
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT document_access_requests_source_pair_check
    CHECK ((source_kind IS NULL) = (source_id IS NULL)
       AND (source_kind IS NULL OR source_kind IN ('task', 'meeting'))),
  CONSTRAINT document_access_requests_message_len_check
    CHECK (char_length(message) <= 500)
);
```

- `expired` không phải giá trị lưu (suy ra từ `expires_at`), nên CHECK không có nó.
- `comment` có trong CHECK ngay từ đầu (mức đã ký ở G8-D3); service chỉ nhận `comment` khi thẻ DOC-05/G8-18 server đã vào.
- Index, mỗi câu một file `CONCURRENTLY` riêng:
  - `999<ms>_document_access_requests_pending_unique.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_document_access_requests_one_pending ON document_access_requests (document_id, created_by) WHERE status = 'pending';` (một yêu cầu chờ cho mỗi cặp — cũng là chỗ thi hành luật "một yêu cầu chờ" khi hai lần gửi chạy song song; yêu cầu hết hạn vẫn `pending` trong cột nên lệnh gửi lại trên dòng hết hạn **làm mới** dòng đó thành yêu cầu mới — nhánh `DO UPDATE` của upsert bên dưới chỉ chạy khi dòng đã hết hạn và làm mới `created_at`, `expires_at`, `requested_level`, `message`, nguồn — thay vì chèn dòng mới; audit và thông báo như lần gửi đầu; dòng `pending` còn hạn thì không bị đụng tới và lần gửi nhận `409 access_request_pending`);
  - `999<ms>_document_access_requests_doc_index.up.sql`: `CREATE INDEX CONCURRENTLY idx_document_access_requests_doc ON document_access_requests (organization_id, document_id, status, created_at);`.
- Câu sqlc mới (`server/pkg/db/queries/document_access_requests.sql`), mỗi câu có `organization_id = sqlc.arg(...)` hoặc `workspace_id = sqlc.arg(...)`: `UpsertPendingDocumentAccessRequest`, `GetDocumentAccessRequestForUpdate` (`organization_id` + `document_id` + `id`), `ListPendingDocumentAccessRequests`, `CountPendingDocumentAccessRequests`, `DecideDocumentAccessRequest`, `GetLatestDeclinedDocumentAccessRequest` (`organization_id` + `document_id` + `created_by`, `status = 'declined'`, `ORDER BY decided_at DESC LIMIT 1`; nguồn của cooldown 1 giờ, đi theo `idx_document_access_requests_doc`), `DeleteDocumentAccessRequests` (purge). (Q4: câu `MarkDocumentAccessRequestNotified` và cột `notified_at` đã bỏ — chúng chỉ phục vụ luật nhắc lại 24 giờ; thông báo đầu tiên của mỗi yêu cầu do outbox `document.access_requested` trong cùng tx phát ra, nên không cần cột ghi lại.) Không cần dòng `-- tenant:`. **Upsert (`R1-11`, sửa theo Q4):** đích xung đột `(document_id, created_by)` không có cột tenant, nên bộ quét (`migrations/query_scope_test.go:202-218`, `needsTenant`) chỉ cho qua khi câu có vị từ tenant có tham số — đặt nó trong `DO UPDATE … WHERE`:

```sql
-- name: UpsertPendingDocumentAccessRequest :one
INSERT INTO document_access_requests (
  id, organization_id, workspace_id, document_id, created_by, created_by_kind,
  requested_level, message, source_kind, source_id, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(document_id),
  sqlc.arg(created_by), sqlc.arg(created_by_kind), sqlc.arg(requested_level), sqlc.arg(message),
  sqlc.narg(source_kind), sqlc.narg(source_id), sqlc.arg(expires_at)
)
ON CONFLICT (document_id, created_by) WHERE status = 'pending' DO UPDATE
SET requested_level = EXCLUDED.requested_level,   -- refresh an expired request as a new one
    message = EXCLUDED.message,
    source_kind = EXCLUDED.source_kind,
    source_id = EXCLUDED.source_id,
    created_at = now(),
    expires_at = EXCLUDED.expires_at,
    updated_at = now()
WHERE document_access_requests.organization_id = sqlc.arg(organization_id)
  AND document_access_requests.expires_at <= now()   -- a live pending row is never touched
RETURNING *;
```

  **Sửa ở w1 (2026-10-19):** mọi mốc thời gian của câu này đi qua **đồng hồ service**, không phải `now()` của Postgres — `created_at`/`updated_at` = `sqlc.arg(now)`, vế `WHERE` của `DO UPDATE` là `expires_at <= sqlc.arg(now)`, và `List`/`Count` lọc `expires_at > sqlc.arg(now)`. Lý do: test A03 (làm mới dòng hết hạn) và A09 (cooldown) chạy trên `DocumentService.SetClock`; `now()` trong SQL sẽ bỏ qua đồng hồ đó.

  **Thứ tự trong service (Q4):** trong một tx, sau khi qua mọi điều kiện đủ để lưu (mục 3.1): (1) `GetLatestDeclinedDocumentAccessRequest` — nếu `now() < decided_at + 1 giờ` thì trả `429 access_request_cooldown` (`retry_after_seconds` = số giây còn lại làm tròn lên), không ghi gì; (2) `UpsertPendingDocumentAccessRequest` — không trả dòng nào (xung đột với dòng `pending` còn hạn, gồm cả lần thua trong cuộc đua hai lần gửi song song) thì map `pgx.ErrNoRows` thành `409 access_request_pending`, không ghi gì; có dòng (chèn mới hoặc làm mới dòng hết hạn) thì ghi audit + outbox trong cùng tx. Hai bước đọc/ghi đều có `organization_id`; cooldown 1 giờ và hạn 30 ngày là hằng trong service (không biến môi trường, `scripts/env-example.test.mjs` không đổi).
- Bảng mới tự rơi vào `TestNewTablesCarryOrganizationID` / `TestEveryBusinessTableCarriesOrganizationID` / `TestTenantColumnIsNotNull` (đã khai `organization_id TEXT NOT NULL`) và `TestActorKindOnEveryCreatedBy` (có `created_by_kind`); thêm hàm xóa vào luồng purge (mục 3.2).
- `.down.sql` cho mỗi file (`DROP TABLE` / `DROP INDEX CONCURRENTLY`), tiền tố `999<unix-ms>` theo `TestMigrationPrefixesSortTheSameAsStringsAndNumbers`.

## 6. Tách thẻ code (không code ở vòng này)

Thứ tự đã ký (14:30): phụ lục trước → server (xếp sau e6-server FD-02/FD-04) → web (xếp sau e6-web FD-08). Mỗi DOC một cặp thẻ server/web, hợp đồng trước + fake cho web.

| Thẻ | Lane | Issue | Owned paths (chính) | Phụ thuộc |
| --- | --- | --- | --- | --- |
| **S-DOC02** | e6-server | UNI-1629 | `dto/sdi/document.go` (`CreateDocumentFileSDI`), `dto/sdi/office.go` (`CreateBlankDocumentFileSDI`), `service/document_files.go` (`CreateFileDocumentInput`, `:377-386`), `service/document_office_capability.go` (`BlankFileInput`, `CreateBlankFile`), `handler/documents.go:225-239`, router mô tả, `server/internal/workcapability/{catalogue.go,catalogue_test.go}` (mục `documents.create_visibility`), test | Không phụ thuộc DOC-05. Nhỏ: làm trước |
| **W-DOC02** | e6-web | UNI-1629 | `packages/views/documents/{documents-home-create.tsx,documents-create.ts,document-upload-dialog.tsx}`, huy hiệu hàng, `packages/views/documents/document-actions-menu.tsx` (`?share=1`), `packages/core/api/endpoints/{documents.ts,documents-blank.ts}` (+ malformed test), `packages/core/capabilities/{types.ts,registry.test.ts}` + `packages/core/api/endpoints/config.test.ts` (mục `documents.create_visibility`: vắng → ẩn, `available` → hiện), `packages/core/documents/hooks*.ts`, huy hiệu hàng `restricted` (chủ sở hữu duy nhất, `F-14`), locales vi/en | S-DOC02 (hoặc fake: trường `visibility` trong body + mục capability `documents.create_visibility`) |
| **S-DOC06** | e6-server | UNI-1630 | `service/document_owner_transfer.go` (mới), `service/organization_member_documents.go` (mới, gọi DocumentService trong tx của nó — cùng tầng service), `pkg/db/queries/documents.sql` (5 câu, mục 5, `R2-1`), migration index, router (`router/organizations.go`: hai route `{org}` dùng case `pathParamSDI` `"org,userID"` sẵn có; `router/documents.go`: `PUT …/owner`) + SDI/SDO, các trường `owner_kind`, `organization_id`, `revision`, `archived_at` trong SDO `admin-summary` nếu thẻ (a) chưa có (mục 2.5), catalogue 3 nơi, audit, notification kinds + rules (port đọc sẵn có, không port mới — mục 4.2), isolation (`isoRefFieldExempt` cho `bulk_id`), chú thích unclassified `owner_target_not_member` trong `error_class.go`; dùng `shareDocumentInTx` (do S-DOC07 tách, hoặc thẻ nào merge trước thì tách — mục 3.1) | **Thẻ (a) DOC-05 server** (mục 0.4: chưa có trong cây) (cần `canAdminister()`, `withDocumentAdministerMutation`, `break_glass_required`). Nếu DOC-05 chưa vào: chặn — không viết bản tạm dùng `manage` (sẽ phải sửa lại cổng) |
| **W-DOC06** | e6-web | UNI-1630 | `packages/views/documents/{share-dialog.tsx, owner-transfer-dialog.tsx (mới)}`, lối vào admin thuần (mục 2.5, `N-01`): `document-actions-menu.tsx` (cổng mount + mục menu "Chia sẻ" → `canAdministerDocument`), `ShareDialogTarget`, nút "Quản lý truy cập" trên `DocumentLockedCard variant="admin"` (`document-locked-card.tsx`, của W-DOC05), `packages/views/settings/components/org-members-section.tsx` + bước chuyển tài liệu (component mới), `packages/core/permissions/rules.ts` (`canAdministerDocument`), endpoints + hooks + malformed test, renderer thông báo, locales, glossary `docs/conventions.md` (hai dòng đã chốt ở mục 2.4) | S-DOC06 hợp đồng (fake trả SDO mục 4.2); W-DOC05 (`admin_scope` trong schema client, `DocumentLockedCard variant="admin"`, hook `admin-summary`) |
| **S-DOC07** | e6-server | UNI-1631 | `service/document_access_requests.go` (mới), migration bảng + 2 index, `pkg/db/queries/document_access_requests.sql`, router + SDI/SDO + limiter bucket `doc-access-request`, catalogue 3 nơi, audit, notification kinds + rules + port `DocumentAdministerChecker` (`notification/{rules.go,consumer.go}`, `DocumentService.FilterDocumentAdministrators`, `server/cmd/server/main.go` cạnh `:474`, `R1-6`), `service/document_shares.go` (tách `shareDocumentInTx`, `R1-15`), `purgeOneDocument`, isolation (chế độ "uniform 202" trong `isoSpec`), `error_class` (`access_request_closed` và `access_request_pending` → `conflict`; `access_request_cooldown` không phân lớp), helper đặt `Retry-After` từ `fields.retry_after_seconds`, `pathParamSDI` `requestID` | **Thẻ (a) DOC-05 server** (cổng duyệt `canAdminister()`; mục 0.4: chưa có trong cây); share mức `comment` theo DOC-05. `document_shares.go` cũng là file của thẻ (a): S-DOC07 tách hàm **sau** khi (a) merge, rebase trên (a) |
| **W-DOC07** | e6-web | UNI-1631 | `DocumentLockedCard` (`variant="member"`; tạo component nếu W-DOC05 chưa có), `document-detail-view.tsx:106-121` (404 → thẻ khóa cho người đã đăng nhập; 403 giữ `:92-104`), màn mở tài liệu Office tương ứng, mục "Yêu cầu truy cập" trong `share-dialog.tsx` + `?access=requests` ở cả hai lối vào của mục 2.5 (`document-actions-menu.tsx` và thẻ khóa `admin`, `N-01`/`N-02`; lối vào do thẻ web merge trước làm, thẻ sau dùng lại), `documentKeys.accessRequests` (`packages/core/documents/keys.ts`), gắn `?from=task:<id>` qua `EditorLinkContext` mới trong `packages/views/editor/` + `content-editor.tsx` + `utils/link-handler.ts`, host `packages/views/tasks/detail/components/{task-detail-editors.tsx,comment-editor.tsx}` (meeting hoãn — Q5), endpoints + malformed test, renderer 3 kind, locales | S-DOC07 hợp đồng (fake: `POST` trả 202, có kịch bản `409 access_request_pending` và `429 access_request_cooldown` + `retry_after_seconds`; list/approve/decline theo SDO mục 4.3); W-DOC05 nếu dùng chung component |

**Thứ tự phát hành:** S-DOC02 → W-DOC02 (web chỉ bật công tắc cho tệp khi mục `documents.create_visibility` là `available`; nút cho trang/thư mục bật được ngay vì route đó đã nhận `visibility`). DOC-05 (a)+(b) lockstep → S-DOC06 + S-DOC07 (song song, khác file; cùng chạm `audit/actions.go`, `outbox/catalogue.go`, `events.ts`, `CATALOGUE.md`, `notification/*`, `isolation_*_test.go`, `error_class.go`, `service/document_shares.go` (`shareDocumentInTx`: thẻ merge trước tách, thẻ sau dùng lại) — merge tuần tự, người merge sau rebase) → W-DOC06 + W-DOC07. Web có thể làm song song với server trên fake, nhưng chỉ merge vào root sau thẻ server tương ứng. Không cần feature flag mới: route mới vô hại khi web chưa dùng; thẻ khóa chỉ thay màn 404 (không mở thêm dữ liệu).

## 7. Bảng AC

| AC | Given / When / Then | Loại test · file |
| --- | --- | --- |
| DOC2-A01 | Cho thành viên workspace, khi tạo trang/thư mục/tệp/tệp trống với `visibility=restricted` ở gốc, thì tài liệu `restricted`, người tạo là ACL owner (`manage`), thành viên khác không thấy trong list/tree/search và `GET` trả 404 | Go · `service/document_create_visibility_test.go` (mới) |
| DOC2-A02 | Cho tạo **không** gửi `visibility`, khi ở gốc thì `workspace`; khi dưới cha `restricted` thì `restricted` (cả ba route) | Go · cùng file |
| DOC2-A03 | Cho cùng `Idempotency-Key`, khi gửi lại với `visibility` khác thì `idempotency_payload_mismatch`; khi gửi lại y hệt (kể cả `visibility` rỗng như trước deploy) thì replay | Go · cùng file |
| DOC2-A04 | Cho `visibility` lạ, thì `400 invalid_request` (JSON và multipart, cả ba route; `R1-2`) | Go · `handler/documents_test.go` |
| DOC2-A05 | `GET /api/v1/config` có `work_management_capabilities["documents.create_visibility"].status = "available"` | Go · `workcapability/catalogue_test.go`, `handler/config_test.go` |
| DOC2-W01 | Trong menu "Mới" công tắc là `menuitemcheckbox` + `aria-checked`, bấm không đóng menu; ở thẻ tạo và hộp tải tệp là `button` + `aria-pressed`; mặc định tắt mỗi lần mở; bật rồi tạo bất kỳ loại nào gửi `visibility:"restricted"`; tắt thì không gửi trường; thả tệp và menu hàng cây không gửi trường; mục tiêu chạm ≥ 44px trên con trỏ thô (`F-01`, `F-11`, `F-13`) | vitest · `packages/views/documents/documents-home-create.test.tsx` (mới) |
| DOC2-W02 | Trong thư mục `restricted`, nút bật + `aria-disabled` + gợi ý kế thừa; không gửi trường | vitest · cùng file |
| DOC2-W03 | Toast "Đã tạo ở chế độ Hạn chế" có hành động "Chia sẻ" điều hướng tới tài liệu mới với `?share=1`; `document-actions-menu.tsx` mở hộp Chia sẻ rồi `replace` bỏ tham số; không `canManage` thì bỏ qua (`F-02`). Config thiếu mục `documents.create_visibility` (hoặc lạ) thì công tắc ẩn cho tệp, còn cho trang/thư mục (`F-03`) | vitest · cùng file, `document-actions-menu.test.tsx`, `packages/core/api/endpoints/config.test.ts` |
| DOC6-A01 | Cho người `manage` (hoặc admin `AdminScope`), khi chuyển cho thành viên hiệu lực của workspace, thì `acl_owner_id` đổi, `updated_by`/`updated_by_kind` là người gọi (`R1-9`), chủ mới `manage`, chủ cũ có share mức đã chọn (mặc định `edit`, chỉ nâng) trong **cùng** tx (`shareDocumentInTx`), một audit `document.owner_transferred` với `Metadata{from_user_id, previous_owner_level}` (`R2-3`), một outbox, một thông báo cho chủ mới; `revision` không đổi | Go · `service/document_owner_transfer_test.go` (mới) |
| DOC6-A02 | Người nhận không phải thành viên workspace / đã vô hiệu hóa / agent → `422 owner_target_not_member`; người chỉ `edit` → 403; tài liệu Work Product → 409; người ngoài → 404 | Go · cùng file |
| DOC6-A03 | Admin chỉ `AdminScope` tự nhận tài liệu `restricted` → `403 break_glass_required`; chuyển cho người khác → 200 và phản hồi không có `content` | Go · cùng file |
| DOC6-A04 | Cho thành viên (đang hoạt động hoặc đã vô hiệu hóa) sở hữu tài liệu ở nhiều workspace, khi owner/admin tổ chức chuyển hàng loạt, thì tài liệu ở workspace người nhận tham gia được chuyển (không share cho nguồn), còn lại đếm `recipient_not_member`; người nhận = người gọi trên tài liệu `restricted` không có `manage` đếm `self_restricted`; > 500 thì `has_more` + `cursor` và gọi tiếp hết, kể cả khi > 500 dòng bị bỏ qua (không lặp mãi); một lệnh chuyển song song trên cùng thành viên nguồn không làm vòng lặp dừng sớm (`has_more` theo `EXISTS`, `R1-10`); mỗi tài liệu một audit (`Metadata{from_user_id, previous_owner_level:"none", bulk_id}`, `R2-3`) + outbox có `bulk_id`, một audit tổng, một thông báo gộp | Go · `service/organization_member_documents_test.go` (mới) |
| DOC6-A05 | Admin tổ chức chuyển tài liệu của một admin khác → 403 (luật P6); thành viên thường → 403; `GET …/document-ownership` chỉ trả đếm theo workspace | Go · cùng file |
| DOC6-A06 | Isolation: ba route trong `isoRoutes` có control; `user_id`/`to_user_id` của A → 422 không lộ; `TransferMemberDocumentsSDI.bulk_id` trong `isoRefFieldExempt` (`R1-12`); `owner_target_not_member` không có `error_class` (`R1-1`); `TestEveryQueryNamesItsTenant` xanh với 5 câu mới (`R2-1`); hai route tổ chức dùng `{org}` slug và `pathParamSDI` `"org,userID"` sẵn có (`R2-2`); migration index lint xanh | Go · `handler/isolation_*_test.go`, `migrations/lint_test.go`, `migrations/query_scope_test.go` |
| DOC6-W01 | Dòng chủ sở hữu có nút "Chuyển quyền sở hữu" chỉ khi `canAdministerDocument`; hộp con chọn người (không agent, không người đã vô hiệu hóa), mức giữ lại mặc định "Chỉnh sửa"; lỗi `owner_target_not_member` và `break_glass_required` hiện đúng câu. **Admin thuần (`N-01`):** `my_level=""`, `admin_scope=true` — thẻ khóa `admin` có "Quản lý truy cập", mở hộp từ `admin-summary`, thấy nút chuyển (picker loại chính mình trên tài liệu `restricted`) và ghi chú `admin_scope_note`, không có nội dung; break-glass `my_level="view"` + `admin_scope=true` → menu có "Chia sẻ" và hộp mount; `my_level="edit"` không `admin_scope` → không mount | vitest · `packages/views/documents/owner-transfer-dialog.test.tsx` (mới), `document-actions-menu.test.tsx`, `document-locked-card.test.tsx`, `packages/core/permissions/rules.documents.test.ts` |
| DOC6-W02 | Hộp vô hiệu hóa: đang đếm → spinner, nút vô hiệu hóa vẫn bấm được; lỗi đếm → cảnh báo + "Thử lại", vẫn vô hiệu hóa được; 0 → không có bước; > 0 → chọn người nhận hoặc "Để sau"; deactivate trước rồi chuyển, lặp `has_more` với `bulk_id` + `cursor`; lỗi chuyển hiện "Thử lại" và tài khoản vẫn đã vô hiệu hóa; **mọi** hàng đã vô hiệu hóa có "Chuyển tài liệu", mở ra đếm = 0 thì hiện câu `none` (`F-04`); nút xác nhận `aria-disabled` khi đang chờ (`F-06`) | vitest · `packages/views/settings/components/org-members-section.test.tsx` |
| DOC7-A01 | Cho người đã đăng nhập không đọc được tài liệu cùng tổ chức, khi `POST …/access-requests`, thì `202 {"status":"sent"}`, một dòng `pending`, audit `document.access_requested`, outbox, thông báo cho ACL owner + share `manage` (hoặc ws owner/admin khi không có ai); admin chỉ có `AdminScope` vẫn nhận (port `DocumentAdministerChecker`), người quản lý vừa bị thu hồi `manage` không nhận (`R1-6`) | Go · `service/document_access_requests_test.go` (mới) |
| DOC7-A02 | Cho id không tồn tại, của tổ chức khác, tài liệu Work Product, tài liệu đã archive, người xin đã vô hiệu hóa, hoặc người xin đã đọc được — thì phản hồi **byte-giống** DOC7-A01, không dòng, không audit, không outbox, không thông báo | Go · cùng file |
| DOC7-A03 | Cho người đã có yêu cầu `pending` chưa hết hạn trên tài liệu, khi gửi lại (cùng hoặc khác mức/lời nhắn), thì `409 access_request_pending`: vẫn một dòng, `requested_level`/`message` không đổi, không audit, không outbox, không thông báo; hai lần gửi song song → một `202`, một `409`, một dòng; sau `expires_at` gửi lại → `202`, dòng được làm mới (mức/lời nhắn mới) và thông báo lại | Go · cùng file |
| DOC7-A04 | Người `canAdminister()` duyệt → share `user` mức chọn (chỉ nâng; người xin đã đủ mức thì `share_id` rỗng), `document.shared` + `document.access_request_decided`, audit approve, thông báo người xin; từ chối → `declined`, thông báo không có tiêu đề tài liệu | Go · cùng file |
| DOC7-A05 | Duyệt/từ chối yêu cầu đã đóng, hết hạn, hoặc trên tài liệu đã archive → `409 access_request_closed`; hai người duyệt cùng lúc → một 200, một 409; người xin vừa bị vô hiệu hóa → `422 principal_not_in_organization` và yêu cầu `cancelled`; admin `AdminScope` tự duyệt yêu cầu của mình → `403 break_glass_required`; người chỉ `edit` → 403 | Go · cùng file |
| DOC7-A06 | `source` task/meeting người xin đọc được → giữ; không đọc được hoặc khác tổ chức → bỏ im lặng; người quản lý không đọc được nguồn thấy `source: null` | Go · cùng file |
| DOC7-A07 | Mở URL tài liệu **không bao giờ** tạo share (không có đường tự cấp): mọi đường đọc trả 404 trước và sau khi gửi yêu cầu cho tới khi duyệt | Go · cùng file |
| DOC7-A08 | Isolation: bốn route trong `isoRoutes` (POST ở chế độ "uniform 202": thân bằng control, không hash nào của A đổi); dòng seed của A; `source_id` của A không lưu; purge xóa dòng yêu cầu; limiter bucket `doc-access-request` 20/giờ là **một** ngân sách cho mọi tài liệu (yêu cầu thứ 21 trên tài liệu **khác** vẫn 429, `R1-8`); `TestEveryQueryNamesItsTenant` xanh với upsert (`R1-11`) | Go · `handler/isolation_*_test.go`, `service/document_lifecycle_test.go`, `handler/router/ratelimit_test.go` |
| DOC7-A09 | Cho yêu cầu bị từ chối ở `decided_at`, khi gửi lại trước `decided_at + 1 giờ` thì `429 access_request_cooldown` với `fields.retry_after_seconds` = số giây còn lại làm tròn lên (≥ 1) và header `Retry-After` cùng giá trị, không dòng/audit/outbox/thông báo mới; ở đúng `decided_at + 1 giờ` trở đi thì `202` và một dòng `pending` mới (dòng `declined` còn nguyên); cooldown tính từ lần từ chối gần nhất; thông báo "từ chối" vẫn không có lời nhắn của người từ chối. Người **khác** hoặc tài liệu **khác** của cùng người không bị cooldown | Go · cùng file (đồng hồ giả) |
| DOC7-A10 | Cho yêu cầu `expired`, `cancelled` hoặc `approved` (rồi bị thu hồi), khi người xin gửi lại ngay thì `202` và yêu cầu mới, không `409`/`429` (chỉ `declined` có cooldown); `409`/`429` chỉ xảy ra sau điều kiện đủ để lưu: người gửi chưa từng gửi (id không tồn tại, của tổ chức khác, Work Product, đã archive, đã vô hiệu hóa) luôn nhận `202` byte-giống DOC7-A01 | Go · cùng file |
| DOC7-W01 | Người đã đăng nhập mở tài liệu 404 thấy `DocumentLockedCard variant="member"`, **không** có tiêu đề, chủ sở hữu hay workspace; chọn mức, lời nhắn ≤ 500 có bộ đếm, gửi → "Đã gửi yêu cầu" (`role="status"`); 429 không `code` → `rate_limited`, mất mạng/5xx → `send_failed` giữ nội dung đã gõ; `409 access_request_pending` → trạng thái `already_pending` (không nút gửi) kể cả khi cờ cục bộ đã mất; `429 access_request_cooldown` → `cooldown` với `{{minutes}}` làm tròn lên từ `retry_after_seconds`, nút gửi `aria-disabled` tới hết giờ rồi bật lại không cần tải lại; cờ "đã gửi" xóa khi nhận `document.access_request_decided` hoặc tải thành công (`F-08`); 403 thường vẫn màn "đã bị thu hồi", 403 `document_restricted` → `variant="admin"`; mở từ Hộp việc vẫn `DocumentInboxState`; nút ≥ 44px trên con trỏ thô (`F-13`) | vitest · `packages/views/documents/document-locked-card.test.tsx` (mới), `document-detail-view.test.tsx` |
| DOC7-W02 | Hộp Chia sẻ hiện "Yêu cầu truy cập ({{count}})" cho người `canAdminister()`; duyệt/từ chối chờ server rồi invalidate `documentKeys.accessRequests` + `shares` (`F-06`); `409 access_request_closed` hiện câu "đã được xử lý" và tải lại danh sách; thông báo Hộp việc mở `?access=requests` với mục được focus; danh sách rỗng → `none_pending`; tài liệu archive → không mở hộp, tham số bị bỏ (`N-02`); **admin thuần (`N-01`):** `?access=requests` trên thẻ khóa `admin` mở hộp từ `admin-summary` ở mục yêu cầu, duyệt/từ chối được; người không `canAdministerDocument` → tham số bỏ im lặng | vitest · `share-dialog.test.tsx`, `document-actions-menu.test.tsx`, `document-locked-card.test.tsx`, `packages/views/notifications/*.test.ts` |
| DOC7-W03 | Bấm URL tài liệu nội bộ trong mô tả hoặc bình luận task (host đặt `EditorLinkContext {kind:"task", id}`) gắn `?from=task:<id>`; liên kết không phải tài liệu không bị đổi; màn tài liệu đọc `from` rồi `replace` bỏ nó khỏi địa chỉ; thẻ khóa gửi `source_kind`/`source_id` từ giá trị đã đọc. Meeting hoãn (Q5) (`R1-14`, `F-05`) | vitest · `packages/views/editor/utils/link-handler.test.ts`, `packages/views/tasks/detail/components/task-detail-editors.test.tsx`, `document-detail-view.test.tsx` |
| DOC-E2E | Luồng thật: A tạo tài liệu "Hạn chế" một chạm → B mở URL từ một task → thẻ khóa → xin quyền → A nhận thông báo, duyệt → B mở được; admin vô hiệu hóa A, chuyển tài liệu cho C → C quản lý được | e2e · `e2e/documents-access.spec.ts` (mới, chạy trên cloud runner) |

## 8. Test và câu hỏi mở

**Go (Postgres thật, `-race`):** `document_create_visibility_test.go`, `document_owner_transfer_test.go`, `organization_member_documents_test.go`, `document_access_requests_test.go` (mới, mục 7); cập nhật `audit_coverage_test.go` (5 action mới), `notification/kinds_test.go` + `titles` test (5 kind), `handler/dto/sdo/error_class_test.go` (`access_request_closed` và `access_request_pending` → `conflict`; `access_request_cooldown` không phân lớp, như `ai_rate_limited`; `owner_target_not_member` và `principal_not_in_organization` trong `unclassified` khi bộ quét DOC-05 có), `workcapability/catalogue_test.go` (`documents.create_visibility`), `notification/*_test.go` (port `DocumentAdministerChecker`: admin chỉ `AdminScope` nhận, người bị thu hồi không nhận; chưa gắn port → không gửi), `handler/isolation_routes_test.go` + `isolation_references_test.go` + `isolation_world_test.go` (`TestIsolationMatrix`, `TestEveryBodyIDFieldHasAReferenceCase`), `migrations/lint_test.go` + `query_scope_test.go` (`TestEveryQueryNamesItsTenant`) + `tenant_schema_test.go`, `handler/router/ratelimit_test.go` (limiter mới), `handler/router/catalogue_test.go` (route mới có SDI/SDO).
**Repo contracts:** `scripts/events-catalogue.test.mjs` (4 topic mới, `bulk_id` là khóa id), `scripts/env-example.test.mjs` (không có biến mới).
**core/views vitest:** `packages/core/api/endpoints/config.test.ts` (mục `documents.create_visibility` vắng/lạ → `unavailable`), `packages/core/api/endpoints/documents.test.ts` (malformed cho `visibility` trả về, `DocumentOwnerSDO`, `MemberDocumentsTransferSDO`, `DocumentAccessRequestListSDO`, `pending_access_requests`; `MemberDocumentsTransferSDO.cursor` lạ → rỗng, vòng lặp dừng), `packages/core/permissions/rules.documents.test.ts` (`canAdministerDocument`), các file views ở mục 7, `packages/views/notifications/{kind-tone,notification-title,resource-href}.test.ts` (5 kind), parity locale vi/en (`i18n/parity.test.ts`).
**E2E:** `e2e/documents-access.spec.ts` (cloud runner). **Visual:** `tester_visual` 9 tiêu chí cho nút "Hạn chế" + toast, hộp chuyển quyền sở hữu, bước chuyển tài liệu trong hộp vô hiệu hóa, `DocumentLockedCard variant="member"`, mục "Yêu cầu truy cập", nút "Quản lý truy cập" trên thẻ khóa `admin` và ghi chú `admin_scope_note` (`N-01`); huy hiệu "Hạn chế" và biểu tượng ổ khóa đọc được ở cả sáng và tối (`F-13`).

**Câu hỏi mở (chỉ điểm chưa quyết; không mở lại quyết định 14:30):**
- **Q1 — Con rộng hơn cha:** route tạo trang hiện cho phép tạo con `workspace` dưới cha `restricted` khi gửi `visibility` tường minh (`document_pages.go:223-236`), trong khi chú thích tạo tệp nói "trang hạn chế không bao giờ có tệp hiển thị cho cả workspace" (`document_files.go:383-384`). Phụ lục giữ nghĩa route trang và áp cho tệp (web không bao giờ gửi giá trị này). Có muốn server **chặn** (`422`) con rộng hơn cha ở cả ba route không? Đổi hành vi route trang nên cần người quyết.
- **Q2 — Mặc định quyền giữ lại cho chủ cũ (DOC-06 từng tài liệu):** phụ lục chọn `edit`. Nếu sản phẩm muốn "chuyển là mất quyền" thì đổi mặc định thành `none` (không đổi hợp đồng, chỉ đổi giá trị mặc định).
- **Q3 — Bắt buộc chuyển khi vô hiệu hóa:** phụ lục cho "Để sau" (vô hiệu hóa không bị chặn bởi việc chọn người nhận). Có muốn bắt buộc chọn người nhận khi thành viên còn tài liệu `restricted` không?
- **Q4 — Thời hạn yêu cầu và giới hạn tần suất (DOC-07) — ĐÃ QUYẾT bởi người dùng, 2026-10-15 15:10 UTC+7** ("q4 nếu bị bỏ qua thì 1h sau có thể xin lại, nếu file đã có lượt xin của user đó thì k đc xin tiếp nếu req trước chưa xử lý"). Giá trị: yêu cầu hết hạn sau **30 ngày** (giữ); **một yêu cầu chờ cho mỗi (tài liệu, người xin)** — gửi lại khi còn chờ → `409 access_request_pending`, không gộp, không nâng mức; **bị từ chối thì 1 giờ sau (`decided_at + 1h`) mới xin lại** — sớm hơn → `429 access_request_cooldown` + `retry_after_seconds`; hết hạn hoặc bị hủy xin lại ngay; **20 yêu cầu/giờ/người** (giữ). Luật nhắc lại sau 24 giờ và cột `notified_at` đã bỏ. Không còn điểm mở nào ở Q4. (Cách hiểu "bị bỏ qua = bị từ chối" là của phụ lục: yêu cầu hết hạn 30 ngày không có cooldown, vì chưa ai từ chối.)
- **Q5 — Nguồn "meeting" (DOC-07, mới ở vòng r1, `R1-14`/`F-05`):** ghi chú và chat meeting hôm nay là chữ thường, không có liên kết bấm được (mục 0.3), nên web không có chỗ gắn `?from=meeting:<id>`. **Đề xuất mặc định:** giao DOC-07 với nguồn `task` thôi; thẻ khóa và xin quyền vẫn chạy cho URL tài liệu dán ở meeting (người dùng sao chép/mở URL → thẻ khóa, chỉ không có dòng "từ cuộc họp X" cho người quản lý); hợp đồng server giữ `source_kind=meeting` để thẻ sau (khi meeting có liên kết bấm được) chỉ cần đặt `EditorLinkContext {kind:"meeting"}`. Phương án khác: thêm liên kết bấm được cho ghi chú/chat meeting trong DOC-07 (lớn hơn, chạm `packages/views/meetings/`). Cần sản phẩm chọn vì câu đã ký nói "liên kết task/meeting".

## 9. S-DOC07 — hợp đồng thực thi trên root 73d2b5038 (c0)

> **Thẻ này (c0, 2026-10-19, UNI-1631):** chỉ hợp đồng — không code, không migration, không câu sqlc, không test chạy. Mọi `file:line` dưới đây đọc ở root `73d2b5038` (`chore: merge RETENTION-02 … (UNI-1921, dbd78836f) into the G5-G7 root`) và **đã thay chỗ** cho các dòng cũ sai (ghi ở §9.0). Thẻ code phải đọc lại dòng trước khi sửa; số dòng ở đây là seam để tìm, không phải hợp đồng.

### 9.0 Sửa `file:line` cũ trong phụ lục này

| Chỗ | Cũ (72b53366d) | Mới (73d2b5038) |
| --- | --- | --- |
| §0.3 cổng đọc | `document_permissions.go:290-298`, `document_pages.go:441-442` | `document_permissions.go:376-392`, `document_pages.go:503-505` |
| §0.3 port đọc | `rules.go:32-40`, `main.go:474` | `rules.go:43-51`, `main.go:493` |
| §0.3 `ShareDocument` | `document_shares.go:53-62`, `document_permissions.go:429-460` | `document_shares.go:105-125`, `document_permissions.go:583-700` |
| §0.4 cấp share | `document_shares.go:53-58, 66-80, 135-165` | `document_shares.go:105-125, 172-181, 318-360` |
| §0.4/§3.3/§3.1 sự kiện | `outbox/catalogue.go:257` | `:258` |
| §0.4 purge | `document_lifecycle.go:1007, 1060-1076` | `:1004-1006, 1243-1268` |
| §2.1/§5 cặp ghi `documents` | `documents.sql:71-84, 99-110` | `:84-96, 112-130` |
| §3.1 `Retry-After` | `ai_uniwork.go:122-134` | `:127-134` (+ `uniworkRetryAfter` `:154`) |
| §3.1 limiter | `router.go:219`, `ratelimit.go:96-100`, `router.go:191-201` | `router.go:226`, `ratelimit.go:96-98`, `router.go:198-208` |
| §3.1 duyệt | `document_shares.go:53-62` → `withDocumentMutation` | `document_shares.go:105-125` → `withDocumentViewOrAdministerMutationLocked` |
| §4.2/§4.4 port đọc | `rules.go:32-40`, `rules.go:28-30` | `rules.go:43-51`, `rules.go:34-37` |
| §4.3 bảng lớp | `error_class.go:66-125`, `:9-64`, `:78` | `error_class.go:86-177`, `:9-84`, `:97` |
| §4.3 mã principal | `document_shares.go:31-33` | `:33-35` |
| §6 isolation | `isolation_matrix_test.go:523-531`, `isolation_references_test.go:348-380` | `isolation_matrix_test.go:559-577`, `isolation_references_test.go:390-432` |
| §6 openapi | `openapi.go:107-116`, `:210-214` | `openapi.go:109-116`, `:212-216` |

### 9.1 Seam check (PRESENT / MOVED / MISSING)

`docs/` và `packages/` của root đã đổi nhiều so với `72b53366d`; seam của S-DOC07 nay:

| Tên trong phụ lục | Trạng thái ở `73d2b5038` | File:line |
| --- | --- | --- |
| `DocumentAccess{Level,Via,AdminScope}`, `canAdminister()`, `ErrDocumentRestricted`, `errBreakGlassRequired()` | PRESENT | `service/document_permissions.go:22-27, 32, 36-46, 54` |
| `decideDocumentAccess` / `decideDocumentContent` / `decideDocumentViewOrAdminister` / `decideDocumentAdminister` | PRESENT | `document_permissions.go:376, 394, 406, 418` |
| `authorizeDocumentViewOrAdminister` / `authorizeDocumentAdminister` / `authorizeDocumentGate` | PRESENT | `document_permissions.go:454, 460, 463` |
| `effectiveLevel`; gán `AdminScope` | PRESENT | `document_permissions.go:101`; `:180-260` (`best.AdminScope = adminScope` `:257`) |
| `withDocumentMutation`, `withDocumentMutationOnShelved`, `withFileSaveMutation` | PRESENT | `document_permissions.go:583, 592, 605` |
| `withDocumentMutationLocked`, `withDocumentViewOrAdministerMutationLocked`, `withDocumentGateLocked` | PRESENT | `document_permissions.go:638, 651, 658` |
| `isGateRefusal` | PRESENT | `document_permissions.go:356` |
| **`withDocumentAdministerMutation`** | **MISSING — S-DOC07 tạo** | chỗ đứng: cạnh `withDocumentViewOrAdministerMutationLocked` `document_permissions.go:651` |
| `shareDocumentInTx` | **MISSING — S-DOC07 tách** | thân nằm trong `ShareDocument` `document_shares.go:105-125` |
| `applyDocumentShare` / `applyDocumentShareWithBatch` / `requireDocumentACLChange` / `refuseAdminSelfShare` / `validateSharePrincipal` / `validShareLevel` | PRESENT | `document_shares.go:192, 196, 66, 84, 318, 172` |
| `errDocumentOwned()` / `errPrincipalNotInOrganization()` | PRESENT | `document_shares.go:29, 33` |
| `notifyOnUserShare`, `mergeDocumentShareIntoHomeRow`, `homeWorkspaceShareRow` | PRESENT | `document_shares.go:147, 281, 302` |
| `DocumentAccessList` / `DocumentAccessOverview` | PRESENT | `document_shares.go:481, 461` |
| audit `document.shared` (`Metadata` có nguồn) | PRESENT | `document_shares.go:244-260` |
| `DocumentReadChecker{CanReadDocument, FilterDocumentReaders}` + `SetDocumentReaders` | PRESENT | `notification/rules.go:43-51`; `consumer.go:55`; `service.go:42`; `digest.go:45` |
| `env` struct của rule (thêm field `docAdmins` được) | PRESENT | `notification/rules.go:100` |
| Wiring `SetDocumentReaders` | MOVED | `cmd/server/main.go:493` (`:507` `notifSvc`, `:511` `digest`) |
| **`DocumentAdministerChecker` / `SetDocumentAdministrators` / `env.docAdmins`** | **MISSING — S-DOC07 tạo** | `notification/rules.go`, `consumer.go` |
| Rule `document_access_requested` / `_approved` / `_declined` | **MISSING — S-DOC07 tạo** | cạnh `ruleDocumentBreakGlassGranted` `rules.go:611` / `ruleDocumentShared` `:650` |
| Kind `document_access_requested` / `_approved` / `_declined` (hằng + `Kinds`) | PRESENT (đăng ký bởi thẻ web, commit `360d4c6a5`) | `kinds.go:57-59`, `Kinds` `:78` |
| Tiêu đề vi/en + nhãn inbox 3 kind | PRESENT | `titles.go:44-46, 78-80, 118-120, 131-133` |
| **Push mặc định cho 3 kind** | **MISSING — S-DOC07 thêm** | danh sách `push := …` `notification/prefs.go:23-28` (hiện chỉ có `document_shared`, `document_break_glass`, `document_edit_*`) |
| **Deep link push `?access=requests`** | **MISSING — S-DOC07 thêm** | `push_consumer.go:168-200` (`documentResourceURL`; nhánh `access=break_glass` ở `:194-199` là mẫu) |
| `errorClassByCode` (7 lớp) + `ErrorClassFor` | PRESENT | `dto/sdo/error_class.go:9-84, 180-183` |
| `document_restricted` / `break_glass_required` | PRESENT | `error_class.go:66, 67` |
| Khối "Deliberately unclassified codes" | MOVED | `error_class.go:86-177` |
| `TestErrorClassTable` `want` / `unclassified` / danh sách file quét | PRESENT | `error_class_test.go:19-60, 70-129, 141-150` |
| `uniworkRetryAfter` / `uniworkRetrySeconds` (đọc `retry_after`) | PRESENT — **không dùng lại** | `handler/ai_uniwork.go:154, 169` |
| `RateLimitByIdentityBucket` (có mã lỗi riêng) / `RateLimitByIdentity` (khóa theo `r.URL.Path`) | PRESENT | `middleware/ratelimit.go:109, 96-98` |
| Nhóm `documents` + tiền lệ bucket | PRESENT | `router/router.go:270-273`; tiền lệ `:198-208, 226-232` |
| `pathParamSDI` | PRESENT — **không cần case mới** | `router/openapi.go:109`; **`case "documentID,requestID"` đã có** `:492-496` |
| `isoSpec` / `isoRoutes` / `isoParam` / `isoReferences` / `isoRefFieldExempt` | PRESENT | `isolation_routes_test.go:36-67, 181`; `isolation_matrix_test.go:480-491, 559`; `isolation_references_test.go:96-103, 390-432` |
| `purgeOneDocument` / `hardDeleteDocumentTx` + danh sách xóa phụ thuộc | PRESENT — **S-DOC07 thêm một hàm xóa** | `document_lifecycle.go:1243, 1277, 1326-1385` |
| `DocumentService.clock` / `SetClock` / `now()` | PRESENT (dùng cho đồng hồ giả A09) | `document_types.go:135-170`; ctor `:158` |
| `CreateDocumentSDI.Visibility` … capability `documents.create_visibility` (S-DOC02) | PRESENT (đã vào root) | `sdi/document.go:22, 35`; `sdi/office.go:50`; `workcapability/catalogue.go:67` |
| **Toàn bộ code `access_request` ở `server/`** | **MISSING** (chỉ có 3 tên kind) | grep `server/`: 0 kết quả khác `kinds.go` |
| **DOC-06 server** (`document-ownership`, `TransferDocumentACLOwner*`) | **MISSING** (S-DOC06 không nằm trong root này) | — |
| `audit.ActionDocument*`; `audit_coverage_test.go` | PRESENT — **S-DOC07 thêm action + dòng bảng** | `audit/actions.go:150, 154`; `service/audit_coverage_test.go` |

**Hệ quả:** §0.4 của phụ lục ("DOC-05 chưa có trong cây") **đã cũ**; nay chỉ `withDocumentAdministerMutation` là thiếu. S-DOC07 **không còn bị chặn** bởi thẻ (a).

### 9.2 Wire vs web đã merge (W-DOC07)

Web đã merge (`feature/UNI-1631-w-doc07`, `8363703e252bf40a115dd9fdde1396ad5c2d7100`) và chạy trên mock theo hợp đồng — nên bảng này so **server dự kiến** với **web đã đóng băng**:

| # | Điểm | Web hôm nay | Hợp đồng server | Bên nào đổi |
| --- | --- | --- | --- | --- |
| 1 | `pending_access_requests` trên `GET …/shares` | Không đọc trường này; đếm từ danh sách | §4.3 yêu cầu có | **Server** thêm (một câu đếm); web có thể bỏ qua — không phải điều kiện |
| 2 | `source` khi không đọc được | `SourceSchema` đòi `kind`+`id`, `title` mặc định `""`; chấp nhận `null` | `source: null` khi không đọc được | Không đổi (khớp) |
| 3 | Mức khi duyệt | Nút chỉ cho mức ≥ `requested_level` (RW7-03) | §3.1 cho thấp hơn hoặc cao hơn, tối đa `edit` | Server theo phụ lục; web hẹp hơn (không lỗi) — câu hỏi Advisor |
| 4 | `comment` | `DocumentAccessRequestLevel` có `comment`, chỉ hiện khi được xin | CHECK + service nhận `comment` (DOC-05 đã vào) | Không đổi |
| 5 | `?from=task:<ULID>` | Đã merge (`EditorLinkContext`); thẻ khóa gửi `source_kind`/`source_id` (`document-locked-card-member.tsx:106-107`) | Chỉ nhận `source_kind`/`source_id` phẳng | Không đổi |
| 6 | Mã lỗi | `access_request_pending` (409), `access_request_cooldown` (429 + `fields.retry_after_seconds`), `access_request_closed` (409); 429 không mã → `rate_limited` | §4.3 khớp từng mã | Không đổi |
| 7 | `share_id` khi người xin đã đủ mức | `catch("").default("")` | Chuỗi rỗng | Không đổi |
| 8 | `202` | `SentSchema {status}` | `202 {"status":"sent"}` | Không đổi |
| 9 | RW7-01..RW7-10 (phần còn lại) | Thuần web (nhãn, thứ tự, icon) | — | Không đổi |

### 9.3 RW7-01 — realtime: cùng thẻ hay thẻ đổi W-DOC07?

**Đề xuất: cùng thẻ S-DOC07.** Hai topic `document.access_requested` / `document.access_request_decided` thuộc S-DOC07 ở cả ba bản catalogue, nên thêm chúng vào `catalogue.go` + `CATALOGUE.md` + `packages/core/types/events.ts` là một lần sửa ba chỗ — `scripts/events-catalogue.test.mjs` chỉ xanh khi ba bản khớp. Phần client (invalidate `documentKeys.accessRequests`/`shares` khi `requested`, `detail` khi `decided`, và gọi `clearDocumentAccessRequestSent`) đặt trong `packages/core/realtime/document-events.ts` (60 dòng code, còn chỗ) chứ **không** trong `use-realtime-sync.ts` (468/500 dòng code). Không có test hiện có nào khẳng định việc **thiếu** hai case này, nên thêm là an toàn.

**Phương án khác (thẻ W-DOC07 đổi):** chỉ hợp lý nếu muốn giữ mọi thay đổi `packages/core/` trong một thẻ FE; nhưng khi đó catalogue ba bản lệch nhau giữa hai thẻ, và `events-catalogue.test.mjs` đỏ ở thẻ nào chạm trước. Rủi ro cao hơn lợi ích.

### 9.4 Tách thực thi (tối đa 2 worker song song)

Thứ tự: **w1** trước (bảng + câu sqlc là hợp đồng biên dịch cho cả hai), rồi **w2** và **w3** song song.

| | w1 — dữ liệu & gửi yêu cầu | w2 — duyệt/từ chối & thông báo |
| --- | --- | --- |
| Đường sở hữu | `server/migrations/999<ms>_document_access_requests*.{up,down}.sql`, `server/pkg/db/queries/document_access_requests.sql`, `server/internal/service/document_access_requests.go`, `server/internal/service/document_lifecycle.go` (thêm hàm xóa vào danh sách purge) | `server/internal/service/document_shares.go` (tách `shareDocumentInTx`), `server/internal/service/document_permissions.go` (`withDocumentAdministerMutation` + `FilterDocumentAdministrators`), `server/internal/notification/{rules,consumer,prefs,push_consumer}.go`, `server/cmd/server/main.go` |
| Giao diện chốt trước | `CreateDocumentAccessRequest(ctx, actor, documentID string, in AccessRequestInput) (AccessRequestResult, error)`; `ListPendingAccessRequests`, `CountPendingAccessRequests`; hằng `AccessRequestStatus*`, `AccessRequestSourceKind*` | `ApproveDocumentAccessRequest(ctx, actor, documentID, requestID string, grantedLevel string)`, `DeclineDocumentAccessRequest(ctx, actor, documentID, requestID, message string)`; `FilterDocumentAdministrators(ctx, documentID string, userIDs []string) ([]string, error)` |
| Ghi chú | `AccessRequestResult` mang `Status` + `RetryAfterSeconds` để handler dựng `202`/`409`/`429` byte-giống nhau | `shareDocumentInTx(ctx, q, actor, doc, access, in)` nhận `q` đã ở trong tx; `withDocumentAdministerMutation` = `withDocumentGateLocked(..., decideDocumentAdminister, shelve, fn)` |

**w3 (thẻ nối, sau w1/w2)** — handler/router/wire: `handler/dto/sdi/document.go`, `handler/dto/sdo/document.go` (+`pending_access_requests`), `handler/document_access_requests.go` (mới), `handler/router/documents.go`, `handler/router/router.go` (bucket `doc-access-request` 20/giờ), `handler/dto/sdo/error_class.go` + `error_class_test.go`, `handler/isolation_*_test.go`, `handler/router/ratelimit_test.go`, ba bản catalogue + `packages/core/realtime/document-events.ts`.

**w1 đã làm (2026-10-19, nhánh `feature/UNI-1631-s-doc07`):**
- Bảng + hai index: `server/migrations/9991792383300001_document_access_requests.{up,down}.sql`, `9991792383300002_document_access_requests_pending_unique.{up,down}.sql`, `9991792383300003_document_access_requests_doc_index.{up,down}.sql` (đúng DDL §5, kể cả 6 CHECK; `tenantExemptTables` không đổi).
- Câu sqlc: `server/pkg/db/queries/document_access_requests.sql` (7 câu, mỗi câu có `organization_id = sqlc.arg(...)`); sqlc sinh `server/pkg/db/generated/document_access_requests.sql.go` + `DocumentAccessRequest` trong `models.go:607`.
- Service: `server/internal/service/document_access_requests.go` — `CreateDocumentAccessRequest` `:222`, `DocumentAccessRequestInput` `:76`, `DocumentAccessRequestResult{Status}` `:86`, `errAccessRequestPending` `:94`, `errAccessRequestCooldown(remaining)` `:103`, `SetAccessRequestSources(tasks, meetings)` `:132`, hằng `AccessRequestStatus{Pending,Approved,Declined,Cancelled}` `:33-38`, `AccessRequestSent` `:42`, `AccessRequestSourceKind{Task,Meeting}` `:48-51`, `accessRequestPendingTTL`/`accessRequestCooldown`/`accessRequestMessageMax` `:57-61`. Hai port hẹp nằm trên `DocumentService` (`document_types.go:160-161`) — **w2/w3 phải gọi `SetAccessRequestSources(taskSvc, meetingSvc)` trong `main.go`**, chưa gắn thì nguồn bị bỏ im lặng (fail closed).
- Purge: `DeleteDocumentAccessRequests` trong danh sách dọn dẹp của `hardDeleteDocumentTx` (`document_lifecycle.go:1381-1386`).
- Audit: `ActionDocumentAccessRequested` (`audit/actions.go:224`) + ca trong `audit_coverage_test.go` (`f.documentAccessRequest`).
- Catalogue: **cả hai** topic `document.access_requested` (ScopeWorkspace) và `document.access_request_decided` (ScopeUser) ở cả ba bản — `outbox/catalogue.go:312-313`, `CATALOGUE.md:169-170`, `packages/core/types/events.ts:86-87` — theo "Lead corrections" của packet c0 (sửa §9.4 ở dòng dưới: hàng `decided` thuộc w1, w3 chỉ làm nửa client).
- Test: `server/internal/service/document_access_requests_test.go` (A01, A02/A10, A03, A06, A07, A09) + một subtest purge trong `document_lifecycle_test.go`.
- **w3 còn nợ:** seed một dòng `document_access_requests` của tenant A trong `handler/isolation_world_test.go` (hoặc lý do trong `isoUnseeded`); ánh xạ agent → `403 forbidden` (service trả `ErrForbidden` trần, `mapServiceError` đã cho 403 `forbidden`).

**w2 đã làm (2026-10-19, cùng nhánh):**
- `server/internal/service/document_access_requests_decide.go` — toàn bộ mặt người quản lý: `DocumentAccessRequestSource` `:33`, `DocumentAccessRequestView` `:42`, `DocumentAccessRequestDecision` `:54`, `errAccessRequestClosed` `:64`, `ListDocumentAccessRequests` `:73`, `CountPendingDocumentAccessRequests` `:187`, `ApproveDocumentAccessRequest` `:207`, `DeclineDocumentAccessRequest` `:219`, `decideDocumentAccessRequest` `:228`, `validateGrantedLevel` `:325`, `grantRaisesLevel` `:341`, `recordApprovedRequest` `:357`, `recordDeclinedRequest` `:396`, `closeRequestCancelled` `:427`, `cancelRequestRow` `:445`, `FilterDocumentAdministrators` `:458`, `topicDocumentAccessRequestDecided` `:28`.
- `server/internal/service/document_permissions.go:658` — `withDocumentAdministerMutation` = `withDocumentGateLocked(..., decideDocumentAdminister, shelve, fn)`, cùng thứ tự khóa với các sibling.
- `server/internal/service/document_shares.go:105` — `ShareDocument` gọi `shareDocumentInTx` `:118` bên trong `withDocumentViewOrAdministerMutationLocked`; thân share (kiểm level, `requireDocumentACLChange`, `validateSharePrincipal`, `refuseAdminSelfShare`, notify, revoke-rồi-insert, audit `document.shared` + outbox) nay nằm ở `:129-152` và approve dùng lại trong tx của chính nó.
- `server/internal/audit/actions.go:229-230` — `ActionDocumentAccessRequestApproved` / `ActionDocumentAccessRequestDeclined`; ca `documentAccessRequestDecision` trong `audit_coverage_test.go` (dùng chung fixture với ca `_requested`).
- `server/pkg/db/queries/document_access_requests.sql:78` — câu thứ 8 `GetDocumentAccessRequest` (`:one`, không khóa): rule `decided` đọc trạng thái mà không lấy row lock ngoài tx.
- `server/internal/notification/rules.go` — port `DocumentAdministerChecker` `:53`, `env.docAdmins` `:111`, hai hàng `rules` `:140-141`, `ruleDocumentAccessRequested` `:755`, `documentManagerCandidates` `:826`, `workspaceAdminCandidates` `:855`, `ruleDocumentAccessRequestDecided` `:869`.
- `server/internal/notification/consumer.go:61` — `SetDocumentAdministrators`.
- `server/internal/notification/prefs.go:29` — push mặc định bật cho `document_access_requested` và `document_access_approved`, tắt cho `_declined`.
- `server/internal/notification/push_consumer.go:197-205` — deep link `?access=requests` cho `document_access_requested`.
- `server/cmd/server/main.go:494` — `notifConsumer.SetDocumentAdministrators(documentSvc)`; `:499` — `documentSvc.SetAccessRequestSources(taskSvc, meetingSvc)`.
- Test: `server/internal/service/document_access_requests_decide_test.go` (A04 duyệt/từ chối/chỉ-nâng, A05 đóng-hết-hạn-archive, cổng 403/404/422, hai người duyệt song song, A07 nửa duyệt, list + count + `FilterDocumentAdministrators`, cooldown bàn giao sang w1) và `server/internal/notification/document_access_test.go` (người nhận yêu cầu, dự phòng ws owner/admin, port chưa gắn, duyệt/từ chối tới người xin, deep link, push mặc định).
- **Sai khác so với chữ ký chốt:** không có. `DocumentAccess` là đúng tên kiểu cho tham số thứ ba của `CountPendingDocumentAccessRequests` (nó là thứ callback `withDocument*Locked` nhận).
- **w3 vẫn còn nợ:** handler/router/limiter/SDI-SDO/`error_class`/isolation + nửa client realtime như bảng dưới.
- **w2 còn nợ:** không.

**File hai thẻ cùng chạm — w1/w2 phải nói trước:** `audit/actions.go` + `service/audit_coverage_test.go` (w1 ghi action `document.access_requested`, w2 ghi `document.access_request_approved`/`_declined` — **cách ly bằng hằng số khác tên, một người sửa bảng**), `outbox/catalogue.go` + `CATALOGUE.md` + `events.ts` (w1 ghi **cả hai** topic — xem "Lead corrections" trong packet c0: hàng phải về cùng thẻ phát sự kiện đầu tiên, nếu không `TestRealtimeConsumerIgnoresTopicsOutsideTheCatalogue` đỏ; w3 chỉ thêm nửa client), `notification/*` (chỉ w2), `document_shares.go`/`document_permissions.go` (chỉ w2), `document_lifecycle.go` (chỉ w1).

### 9.5 Kế hoạch test đỏ-trước cho DOC7-A01..A10

| AC | Test đỏ trước | Ghi chú |
| --- | --- | --- |
| A01, A02, A10 | `service/document_access_requests_test.go` — dựng hai tổ chức + tài liệu `restricted`; gọi `CreateDocumentAccessRequest` với id sai/tổ chức khác/Work Product/archive/người xin đã vô hiệu hóa/người xin đã đọc được | A02/A10 so **byte** của `AccessRequestResult` giữa các ca (không chỉ mã) |
| A03 | cùng file — hai goroutine gửi song song cùng (tài liệu, người gửi) | kỳ vọng đúng một `202`, một `409 access_request_pending`, một dòng; dựa vào chỉ mục unique `pending` |
| A04, A05 | cùng file — duyệt/từ chối: yêu cầu đã đóng, hết hạn, tài liệu archive; hai người duyệt song song; người xin vừa bị vô hiệu hóa (`422 principal_not_in_organization` + dòng `cancelled` đã **commit**) | hai approver song song: một 200, một `409 access_request_closed` |
| A06 | cùng file — `source_kind` task/meeting: người xin đọc được → giữ; không đọc được/khác tổ chức → bỏ im lặng | port `TaskService`/`MeetingService` qua interface hẹp, không import chéo |
| A07 | cùng file — sau khi gửi yêu cầu, mọi đường đọc vẫn 404 tới lúc duyệt | chứng minh "không tự cấp" |
| A09 | cùng file + `SetClock` (`document_types.go:135-170`) — từ chối ở `T`, gửi lại ở `T+59m` → `429` với `retry_after_seconds == 60`; ở `T+1h` → `202` | cooldown tính từ lần từ chối gần nhất; người khác/tài liệu khác không dính |
| A08 | `handler/isolation_*_test.go` — bốn route vào `isoRoutes`; `POST` chạy chế độ "uniform 202" (thân bằng control, không hash nào của A đổi) | **cần `isoSpec.mixedOK`** (hoặc một chế độ tương đương) cho lượt mixed: `POST` với tài liệu của B + thân của A trả `202` (không phải từ chối) và `attack` coi `<500` là đạt |
| A08 (tiếp) | `migrations/query_scope_test.go` `TestEveryQueryNamesItsTenant` với câu upsert; `handler/router/ratelimit_test.go` — yêu cầu thứ 21 trên **tài liệu khác** vẫn `429` | upsert phải mang vị từ tenant dạng `sqlc.arg(organization_id)` để qua bộ quét |
| A08 (purge) | `service/document_lifecycle_test.go` — purge xóa dòng yêu cầu | không FK; thêm vào danh sách `document_lifecycle.go:1326-1385` |
| A01/A04 (thông báo) | `notification/*_test.go` — port `DocumentAdministerChecker`: admin chỉ `AdminScope` nhận; người vừa bị thu hồi `manage` không nhận; chưa gắn port → không gửi (fail closed) | mẫu ở `ruleDocumentBreakGlassGranted` `rules.go:611` |

### 9.6 Điểm mở

**Kỹ thuật (tôi đã chọn, ghi để review):**
1. `withDocumentAdministerMutation(ctx, actor, documentID, treeWorkspaceID string, shelve shelveGate, fn)` = `withDocumentGateLocked(..., decideDocumentAdminister, shelve, fn)`; lỗi: `ErrNotFound` (không đọc được và không `AdminScope`), `ErrForbidden` (đọc được nhưng dưới `manage`), `409 document_owned_by_work_product` (từ `requireDocumentACLChange`), `document_archived`/`document_shelved` (từ gate). Khóa: khóa cây trước, rồi khóa dòng tài liệu — cùng thứ tự mọi `withDocument*MutationLocked` hiện có.
2. `pending_access_requests` thêm vào `DocumentAccessSDO` (§9.2 #1): một câu đếm, chỉ khi `manage`/`admin_scope`.
3. Limiter dùng `RateLimitByIdentityBucket` với mã mặc định `rate_limited` (web phân biệt bằng **vắng** `code`) — khớp Q4 và §4.3.
4. `isoSpec` cần thêm trường cho lượt mixed của route `POST` (đề xuất tên `mixedOK` kèm lý do) — nếu không, lượt mixed coi `202` là thất bại.

**Sản phẩm / Advisor:**
- **Q5** (nguồn meeting) — không đổi ở c0; hợp đồng server vẫn nhận `source_kind=meeting`.
- **RW7-03** — web chỉ cho duyệt mức ≥ mức đã xin; phụ lục cho phép thấp hơn. Chọn một: giữ phụ lục (server rộng hơn, không lỗi) hay siết web theo phụ lục.
- **RW7-01** — cùng thẻ (§9.3) hay thẻ W-DOC07 đổi.

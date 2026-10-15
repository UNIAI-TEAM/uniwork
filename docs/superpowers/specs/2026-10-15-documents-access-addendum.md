# Documents — Phụ lục: "Hạn chế" một chạm khi tạo (DOC-02), chuyển quyền sở hữu tài liệu (DOC-06) và xin quyền truy cập (DOC-07)

> **Trạng thái:** in-progress — v1.0, viết 2026-10-15 (UNI-1629 DOC-02, UNI-1630 DOC-06, UNI-1631 DOC-07). Chỉ là hợp đồng và luật; chưa có dòng code nào. Giá trị đã ký: DOC-01..07 ký 2026-10-14 14:30 UTC+7 (`USER-DECISIONS.md` của Run: "ok theo đề xuất đi"). Mọi chỗ "chọn" bên dưới là quyết định nằm **trong** các luật đã ký và có lý do đi kèm; điểm thật sự chưa quyết nằm ở mục 8.

**Vì sao một file:** ba thẻ cùng chạm vào một chỗ — ai giữ quyền quản lý (`manage`) một tài liệu và người không đọc được thì thấy gì — nên đọc chung một bảng luật. Cả ba dùng cổng `canAdminister()` của DOC-05 và thẻ khóa `DocumentLockedCard` đã đặt chỗ sẵn ở [phụ lục mức quyền §4](2026-10-14-documents-permission-levels-addendum.md).
**Quan hệ:** [Documents C-01 §4](2026-09-08-documents-design.md) (bảng quyền gốc; phụ lục này chỉ **thêm**, không đổi dòng nào của §4), [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md) (thang `view < comment < edit < manage`, `AdminScope`, `canAdminister()`, break-glass, `DocumentLockedCard`), [phụ lục thư mục](2026-10-13-documents-folders-addendum.md) (luồng tạo một chạm không hỏi tên, menu "Mới"), [quyền workspace](2026-08-27-workspace-permissions-design.md). Khi lệch `CLAUDE.md` hoặc ADR, `CLAUDE.md`/ADR thắng.
**Hiện trạng:** mọi `file:line` dưới đây đọc ở root `72b53366d`; thẻ code phải đọc lại dòng trước khi sửa.
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
| Gợi ý hiện tại của "Hạn chế" ghi "người quản lý xem được" — lệch DOC-05 (admin không đọc nội dung tài liệu hạn chế) | `packages/core/i18n/locales/vi.json:8479-8480`, `en.json:8484-8485` |

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
| Người không đọc được → `ErrNotFound` (404, không lộ tồn tại); đọc được nhưng thiếu mức → 403 | `service/document_permissions.go:290-298`; `GetDocument` `service/document_pages.go:441-442` |
| Web: 404 → "Không tìm thấy tài liệu" (cố ý không lộ id có tồn tại); 403 → "đã bị thu hồi quyền" | `packages/views/documents/document-detail-view.tsx:92-104, 106-121`; ánh xạ `packages/core/documents/errors.ts:44-55` |
| Không có khái niệm xin quyền (`access_request`, `requestAccess`) ở server lẫn web; `DocumentLockedCard` chưa tồn tại (chỉ được đặt chỗ ở phụ lục mức quyền §4) | grep toàn repo; `2026-10-14-documents-permission-levels-addendum.md:188` |
| Cấp share: allowlist mức, principal phải là thành viên đang hoạt động của tổ chức; cấp lại cùng principal **thay** mức cũ (kể cả hạ mức) | `service/document_shares.go:53-58, 66-80, 135-165` |
| Thông báo: không có kind `document_shared` dù spec C-01 §6.2 liệt kê | `server/internal/notification/kinds.go:12-56` |
| Sự kiện `document.shared` phát ở `ScopeWorkspace`, payload chỉ id | `server/internal/outbox/catalogue.go:257` |
| Purge tài liệu xóa dữ liệu phụ thuộc trong cùng tx (bình luận, yêu thích…) | `service/document_lifecycle.go:1007, 1060-1076` |

## 1. DOC-02 — giữ mặc định workspace, "Hạn chế" một chạm khi tạo

Luật đã ký: **mặc định vẫn là `workspace`** (DOC-01/03/04 đúng trong code, không đổi); lúc tạo có một nút "Hạn chế" bấm một lần là tài liệu mới sinh ra ở `restricted`.

**Quy tắc:**
- Ai: người tạo được tài liệu ở chỗ đó (thành viên hiệu lực của workspace, có `edit` trên cha nếu có cha — luật tạo hiện hành, không đổi). Không cần `manage`: người tạo trở thành ACL owner (`manage`) ngay khi tạo, nên chọn `restricted` lúc tạo không cấp thêm quyền cho ai.
- Server: ba route tạo (trang/thư mục, tệp multipart, tệp trống) cùng nhận `visibility` tùy chọn với **cùng một nghĩa**: `restricted` hoặc `workspace` được ghi đúng như gửi; rỗng = kế thừa cha, ở gốc = `workspace` (giữ nguyên nghĩa đã có ở `document_pages.go:223-236`, mở rộng cho tệp). Giá trị khác → `422 validation_failed` (`fields.visibility`).
- Agent và system không tạo qua các route này (`document_files.go:311-314`); tài liệu thuộc Work Product đi qua seam riêng (`CreateOwnedDocumentInTx`), **không** nhận `visibility` từ request.
- Idempotency: `visibility` đã nằm trong fingerprint của tạo trang (`document_pages.go:198-199`); thẻ server **thêm** `visibility` vào fingerprint của tạo tệp và tạo tệp trống, nên cùng `Idempotency-Key` với visibility khác → `idempotency_payload_mismatch`. Để retry đang bay qua lúc deploy không lệch, `visibility` rỗng **không** thêm phần tử vào fingerprint (cùng mẹo "chỉ thư mục thêm kind" ở `:200-204`).
- Audit: dòng `document.created` hiện có đã ghi `visibility` (`document_pages.go:282`, `document_files.go:418-420`) — không thêm action.

**Trạng thái & UI (web):**
- Một nút bật/tắt **"Hạn chế"** (biểu tượng ổ khóa + chữ, `aria-pressed`) đặt ở đầu menu "Mới" (`CreateMenu`) và ở hàng thẻ tạo (`CreateCards`), cũng có trong hộp tải tệp (`document-upload-dialog.tsx`). Mặc định **tắt** mỗi lần mở menu/trang (không nhớ giữa các lần — chọn, vì mặc định đã ký là `workspace`; nhớ trạng thái sẽ âm thầm biến mặc định thành `restricted` cho người đó).
- Khi bật: mọi lệnh tạo kế tiếp từ bề mặt đó (trang, sáu loại tệp, thư mục, tải tệp) gửi `visibility: "restricted"`; khi tắt không gửi trường (server kế thừa cha / mặc định `workspace`).
- Trong thư mục cha `restricted`: nút hiện **bật và khóa** (`aria-disabled="true"`, vẫn trong thứ tự tab) với gợi ý "Thư mục này đang Hạn chế nên tài liệu mới cũng Hạn chế"; client không gửi trường (server kế thừa).
- Sau khi tạo ở `restricted`: toast "Đã tạo ở chế độ Hạn chế" kèm hành động "Chia sẻ" mở `share-dialog.tsx` của tài liệu mới; tài liệu vẫn mở ngay như luồng một chạm hiện tại.
- Thư viện, cây, kết quả tìm kiếm: hàng `restricted` có huy hiệu ổ khóa + chữ "Hạn chế" (không chỉ dùng màu) — nếu thẻ DOC-05 web chưa thêm thì thẻ DOC-02 web thêm.
- Sửa gợi ý "Hạn chế" cho khớp DOC-05: "Chỉ chủ sở hữu và người được chia sẻ xem được." (không còn "người quản lý xem được").

**Trường hợp biên:**
- Cha bị chuyển sang `restricted` trong lúc menu đang mở: server kế thừa theo dòng cha đã khóa trong tx (`lockPageParent`), nên tài liệu mới đúng theo cha lúc ghi; UI không cần biết trước.
- Bật "Hạn chế" khi tạo **trong** thư mục `workspace`: tài liệu con `restricted` trong cha `workspace` là hợp lệ (đã đúng hôm nay với trang).
- Gửi `visibility: "workspace"` dưới cha `restricted`: giữ nghĩa route trang hiện hành (giá trị gửi thắng); web không bao giờ gửi giá trị này dưới cha `restricted`. Có nên chặn ở server hay không là câu hỏi mở Q1 (mục 8).
- Server cũ chưa có trường `visibility` ở route tệp: Go decode bỏ qua trường lạ của JSON và form, nên tệp ra `workspace` — **không an toàn về quyền**. Vì vậy web chỉ hiện nút "Hạn chế" cho tệp khi server đã khai báo hỗ trợ (mục 4.1, cờ `capabilities.create_visibility` trong `GET /api/v1/config` hoặc phát hành lockstep, xem mục 6).

**Chuỗi (khóa i18next dưới `documents.create.*`, placeholder `{{param}}`):**

| Vị trí | Khóa | vi | en |
| --- | --- | --- | --- |
| Nút bật/tắt | `restrictedToggle` | `"Hạn chế"` | `"Restricted"` |
| Mô tả cho trình đọc màn hình / tooltip | `restrictedToggleHint` | `"Tài liệu mới chỉ chủ sở hữu và người được chia sẻ xem được"` | `"New documents are visible only to the owner and people it's shared with"` |
| Nút khóa trong cha hạn chế | `restrictedInherited` | `"Thư mục này đang Hạn chế nên tài liệu mới cũng Hạn chế"` | `"This folder is restricted, so new documents are too"` |
| Toast sau khi tạo | `createdRestricted`, `shareAction` | `"Đã tạo ở chế độ Hạn chế"` · `"Chia sẻ"` | `"Created as restricted"` · `"Share"` |
| Gợi ý visibility (sửa khóa có sẵn) | `documents.share.visibility_restricted_hint` | `"Chỉ chủ sở hữu và người được chia sẻ xem được."` | `"Only the owner and people it's shared with can read it."` |
| Huy hiệu hàng | `documents.library.restrictedBadge` | `"Hạn chế"` | `"Restricted"` |

**A11y:** nút là `button` có `aria-pressed`, nhãn chữ luôn hiện (không chỉ biểu tượng); trạng thái khóa dùng `aria-disabled` (luật primitive), gợi ý nối bằng `aria-describedby`; mục tiêu chạm ≥ 44px trên con trỏ thô; toast có hành động bàn phím tới được.

## 2. DOC-06 — chuyển quyền sở hữu từng tài liệu và hàng loạt khi vô hiệu hóa thành viên

Luật đã ký: chuyển chủ sở hữu **từng tài liệu**, và **chuyển hàng loạt** khi vô hiệu hóa một thành viên. Cổng quyền là `canAdminister()` của DOC-05 (phụ lục mức quyền §4: "DOC-05 chỉ dành cho DOC-06 cổng `canAdminister()`").

### 2.1 Chuyển từng tài liệu

**Ai được chuyển:** người gọi có `access.canAdminister()` (= `Level ≥ manage` **hoặc** `AdminScope`) trên tài liệu, qua cổng bao ngoài `withDocumentAdministerMutation` của DOC-05. Mirror web: `canAdministerDocument` (thêm cạnh `canManageDocument` ở `packages/core/permissions/rules.ts:530`, đọc `my_level` + `admin_scope`, cite cổng Go).

**Ai được nhận:**
- người (human), là thành viên **đang hoạt động** của tổ chức (`deactivated_at IS NULL`) **và** thành viên hiệu lực của workspace chứa tài liệu (vì ACL owner chỉ có `manage` khi qua `RequireMemberQ`, `document_permissions.go:131-145`; chuyển cho người ngoài workspace sẽ tạo ra một tài liệu không ai quản lý) → nếu không: `422 owner_target_not_member`;
- không phải agent (agent không bao giờ giữ ACL, `aclOwnerFor`) → `422 owner_target_not_member`;
- người nhận = chủ hiện tại → `200`, không ghi gì (idempotent, không audit, không thông báo).

**Chặn tự cấp (DOC-05):** người gọi chỉ có `AdminScope` (`Level < manage`) chuyển quyền sở hữu tài liệu `restricted` **cho chính mình** → `403 break_glass_required` (cùng luật "admin không tự share" ở phụ lục mức quyền §4). Chuyển cho người khác được.

**Chủ cũ:** body có `previous_owner_level` ∈ `edit` (mặc định) | `comment` | `view` | `none`. Khác `none` → trong cùng tx tạo/cập nhật một share `user` cho chủ cũ ở mức đó qua đường share hiện có (`ShareDocument` nội bộ, có audit `document.shared` và outbox), **chỉ nâng, không hạ** share sẵn có của chủ cũ. Chủ cũ đã bị vô hiệu hóa → bỏ qua bước share (không lỗi). `comment` chỉ hợp lệ khi thẻ DOC-05/G8-18 server đã vào (xem mục 6). Chọn mặc định `edit`: chuyển chủ là bàn giao trách nhiệm, không phải thu hồi quyền làm việc; người gọi muốn cắt hẳn thì chọn `none`.

**Không chuyển được:** tài liệu thuộc Work Product (`owner_kind` có giá trị) → `409 document_owned_by_work_product` (resolver của sản phẩm quyết, §13.4). Tài liệu đã archive: chuyển được (cổng DOC-05 cho người `canAdminister()` qua archive) — để người kế nhiệm khôi phục được.

**Ghi:** trong một tx: khóa dòng tài liệu, kiểm lại cổng, `UPDATE documents SET acl_owner_id = $new, updated_at = now() … WHERE id = $1 AND organization_id = $2 AND workspace_id = $3` (**không** tăng `revision` nội dung — `revision` là base của autosave; đổi chủ không đổi nội dung), share chủ cũ nếu có, audit + outbox.

### 2.2 Chuyển hàng loạt khi vô hiệu hóa thành viên

**Ai:** owner/admin tổ chức — đúng cổng `requireAdmin` của `OrganizationMemberService.Deactivate` (`organization_members.go:207-224`; admin không thao tác trên admin khác, chỉ owner làm được). Không đi qua `RequireMember` của workspace từng tài liệu: đây là thao tác cấp tổ chức trên siêu dữ liệu, không đọc nội dung.

**Phạm vi:** mọi tài liệu của tổ chức có `acl_owner_id = <thành viên>` và `owner_kind IS NULL`, ở mọi workspace, kể cả đã archive chưa purge. Thành viên có thể đang hoạt động hoặc đã bị vô hiệu hóa (để xử lý tài liệu "mồ côi" của những người đã vô hiệu hóa trước khi có tính năng này).

**Người nhận:** một người, thành viên đang hoạt động của tổ chức, khác thành viên nguồn. Theo từng tài liệu:
- người nhận không phải thành viên hiệu lực của workspace chứa tài liệu → **bỏ qua**, lý do `recipient_not_member`;
- người nhận = người gọi **và** tài liệu `restricted` **và** người gọi không có `Level ≥ manage` trên tài liệu đó (chỉ có quyền admin) → **bỏ qua**, lý do `self_restricted` (DOC-05: admin không tự trao quyền đọc nội dung tài liệu hạn chế; muốn kiểm tra thì dùng break-glass; muốn nhận thì nhờ owner/admin khác chuyển);
- còn lại → chuyển, `previous_owner_level` luôn `none` (thành viên nguồn đang bị vô hiệu hóa hoặc rời việc; giữ share cho người đó là cấp quyền cho tài khoản sắp/đã khóa — chọn).

**Thứ tự và tính nguyên tử (chọn):** chuyển hàng loạt là **một route riêng**, không nhét vào body của `deactivate`. Lý do: (1) dùng được cả trước lẫn sau khi vô hiệu hóa và cho thành viên đã vô hiệu hóa từ trước; (2) `Deactivate` giữ đúng một trách nhiệm và một bảng audit; (3) lỗi chuyển không chặn việc khóa tài khoản (khóa tài khoản là việc an ninh, phải xong trước). Hộp thoại vô hiệu hóa trên web gọi **deactivate trước**, rồi gọi chuyển hàng loạt; chuyển thất bại thì hiện lỗi kèm "Thử lại" và hàng thành viên đã vô hiệu hóa có mục "Chuyển tài liệu" để làm lại sau.

**Giới hạn lô:** mỗi lần gọi chuyển tối đa **500** tài liệu (trong một tx, theo thứ tự `id`); còn nữa thì phản hồi `has_more: true`, client gọi tiếp tới khi hết (lệnh idempotent: tài liệu đã chuyển không còn khớp `acl_owner_id = nguồn`). Chọn 500 để một tx giữ khóa dòng ngắn và số dòng outbox/audit mỗi tx có chặn trên.

**Ghi:** mỗi tài liệu chuyển: `UPDATE acl_owner_id`, một dòng audit `document.owner_transferred` (để lịch sử của từng tài liệu có dòng này) với `Metadata{bulk_id, from_user_id}`, và một dòng outbox `document.owner_transferred`. Mỗi lần gọi: một dòng audit `document.owners_bulk_transferred` (`ResourceType=organization_member`, `ResourceID=<thành viên nguồn>`, `Metadata{bulk_id, to_user_id, transferred, skipped:{recipient_not_member, self_restricted}}`) và một dòng outbox `document.owners_bulk_transferred` cho người nhận (thông báo gộp). `bulk_id` là ULID sinh mỗi lần gọi đầu; client gửi lại `bulk_id` ở các lần gọi tiếp của cùng một đợt (`has_more`) để thông báo gộp vào một dòng.

### 2.3 Trạng thái, trường hợp biên

| Trường hợp | Hành vi |
| --- | --- |
| Chủ sở hữu đã bị vô hiệu hóa, chưa ai chuyển | Không đổi gì tự động. Tài liệu `workspace` vẫn sửa được bởi thành viên; tài liệu `restricted` chỉ còn người có share `manage` và admin (`AdminScope`: quản lý được, không đọc). Admin chuyển từng tài liệu (2.1) hoặc hàng loạt (2.2) bất cứ lúc nào |
| "Người quản lý cuối cùng" | Không có khái niệm chặn: ws owner/admin luôn `canAdminister()` (DOC-05), nên tài liệu không bao giờ mất người quản lý. Chuyển không thể làm tài liệu mất chủ (người nhận phải là thành viên hiệu lực) |
| Người nhận bị vô hiệu hóa / rời workspace giữa lúc chọn và lúc gửi | Kiểm lại trong tx → `422 owner_target_not_member` (từng tài liệu) hoặc bỏ qua `recipient_not_member` (hàng loạt) |
| Thành viên nguồn được kích hoạt lại sau khi đã chuyển | Không trả lại tự động; admin chuyển lại nếu cần |
| Tài liệu thuộc Work Product | Từng tài liệu → 409; hàng loạt không chọn (`owner_kind IS NULL`) |
| Bản sao của tài liệu | Giữ ACL owner của nguồn lúc sao (`document_copy.go:182`); chuyển chủ bản gốc không chuyển bản sao |
| Hai admin chuyển cùng lúc | Khóa dòng tài liệu trong tx; người sau thấy chủ mới, nếu khác người nhận của mình thì vẫn ghi đè (thao tác quản trị, có audit); hàng loạt: dòng đã đổi chủ không còn khớp nguồn nên bị bỏ |
| Khác tổ chức | Mọi câu truy vấn ràng buộc `organization_id`; id của tổ chức khác → 404, không lộ |

### 2.4 UI và chuỗi

- **Hộp Chia sẻ (`share-dialog.tsx`):** dòng chủ sở hữu (đã có `acl_owner` trong `GET …/shares`) thêm nút "Chuyển quyền sở hữu" khi `canAdministerDocument`. Mở hộp con: chọn người (picker thành viên của workspace, loại agent, loại người đã vô hiệu hóa), chọn quyền giữ lại cho chủ cũ (mặc định "Chỉnh sửa"), xác nhận. Lỗi `break_glass_required` hiện câu riêng.
- **Hộp vô hiệu hóa (`org-members-section.tsx`):** trước khi xác nhận, gọi `GET …/document-ownership` lấy số tài liệu; nếu > 0 hiện bước "Chuyển tài liệu cho" (picker thành viên tổ chức, mặc định để trống) với lựa chọn "Để sau". Sau khi deactivate thành công và có người nhận: gọi chuyển hàng loạt (lặp khi `has_more`), hiện tiến độ và kết quả (số đã chuyển, số bỏ qua kèm lý do). Hàng thành viên đã vô hiệu hóa còn tài liệu thì có mục "Chuyển tài liệu" mở cùng bước này.
- Thông báo cho người nhận (mục 4.4).

| Vị trí | Khóa | vi | en |
| --- | --- | --- | --- |
| Nút trên dòng chủ sở hữu | `documents.owner.transferButton` | `"Chuyển quyền sở hữu"` | `"Transfer ownership"` |
| Tiêu đề hộp | `documents.owner.transferTitle` | `"Chuyển quyền sở hữu “{{document}}”"` | `"Transfer ownership of “{{document}}”"` |
| Nhãn picker | `documents.owner.newOwnerLabel` | `"Chủ sở hữu mới"` | `"New owner"` |
| Quyền giữ lại cho chủ cũ | `documents.owner.previousLevelLabel` + `documents.owner.previousLevelNone` | `"Quyền của {{name}} sau khi chuyển"` · `"Không giữ quyền"` | `"{{name}}'s access after the transfer"` · `"No access"` |
| Ghi chú | `documents.owner.transferNote` | `"Chủ sở hữu mới quản lý được tài liệu: chia sẻ, đổi chế độ hiển thị và chuyển vào thùng rác."` | `"The new owner can manage the document: share it, change who can see it and move it to trash."` |
| Nút xác nhận / thành công | `documents.owner.transferConfirm`, `documents.owner.transferred` | `"Chuyển"` · `"Đã chuyển quyền sở hữu cho {{name}}"` | `"Transfer"` · `"Ownership transferred to {{name}}"` |
| Lỗi người nhận | `documents.owner.targetNotMember` | `"{{name}} chưa là thành viên của workspace này nên không thể làm chủ sở hữu."` | `"{{name}} isn't a member of this workspace, so they can't own this document."` |
| Lỗi tự nhận (admin) | `documents.owner.selfTransferError` | `"Quản trị viên không thể tự nhận quyền sở hữu tài liệu hạn chế. Hãy nhờ một quản trị viên khác chuyển, hoặc dùng Truy cập khẩn cấp để kiểm tra."` | `"Admins can't take ownership of a restricted document themselves. Ask another admin to transfer it, or use Emergency access to inspect it."` |
| Bước trong hộp vô hiệu hóa | `org.members.transferDocs.title`, `.body`, `.recipientLabel`, `.later` | `"Chuyển tài liệu"` · `"{{name}} đang là chủ sở hữu của {{count}} tài liệu."` · `"Chuyển cho"` · `"Để sau"` | `"Transfer documents"` · `"{{name}} owns {{count}} documents."` · `"Transfer to"` · `"Later"` |
| Tiến độ / kết quả | `org.members.transferDocs.progress`, `.done`, `.skippedNotMember`, `.skippedSelf`, `.failed`, `.retry` | `"Đang chuyển tài liệu…"` · `"Đã chuyển {{count}} tài liệu cho {{name}}."` · `"{{count}} tài liệu ở workspace mà {{name}} chưa tham gia chưa được chuyển."` · `"{{count}} tài liệu hạn chế không thể chuyển cho chính bạn."` · `"Chưa chuyển được tài liệu. Tài khoản đã được vô hiệu hóa; bạn có thể thử lại."` · `"Thử lại"` | `"Transferring documents…"` · `"Transferred {{count}} documents to {{name}}."` · `"{{count}} documents in workspaces {{name}} hasn't joined weren't transferred."` · `"{{count}} restricted documents can't be transferred to yourself."` · `"Couldn't transfer the documents. The account is deactivated; you can try again."` · `"Try again"` |
| Mục trên hàng đã vô hiệu hóa | `org.members.transferDocs.action` | `"Chuyển tài liệu"` | `"Transfer documents"` |

Các chuỗi đếm dùng plural i18next (`_one`/`_other`) theo quy ước locale hiện có. Glossary: thêm dòng "document owner | **chủ sở hữu** (tài liệu) | Owner" và mở rộng dòng "transfer ownership" ở `docs/conventions.md:175` cho tài liệu (không có bước chấp nhận; chủ cũ giữ quyền đã chọn) — việc của thẻ web.

**A11y:** picker là combobox có nhãn; tiến độ hàng loạt trong `role="status"` (`aria-live="polite"`); kết quả bỏ qua là chữ, không chỉ màu; nút "Thử lại" tới được bằng bàn phím; focus trả về nút mở hộp khi đóng.

## 3. DOC-07 — xin quyền truy cập từ liên kết task/meeting: không tự cấp, thẻ khóa, người quản lý duyệt

Luật đã ký: **không tự cấp quyền** khi người dùng mở tài liệu qua liên kết trong task/meeting; hiện **`DocumentLockedCard variant="member"`**; người dùng gửi yêu cầu; **người quản lý duyệt**.

**Ràng buộc từ hiện trạng (mục 0.3):** chưa có liên kết có cấu trúc task/meeting → tài liệu, và 404 hôm nay cố ý không phân biệt "không tồn tại" với "không có quyền". Phụ lục giữ nguyên tính không lộ đó: thẻ khóa và phản hồi xin quyền **giống hệt nhau** dù tài liệu có tồn tại hay không, thuộc tổ chức khác hay không.

### 3.1 Luật

- **Không tự cấp:** mở một URL tài liệu (từ task, meeting, chat hay bất cứ đâu) không bao giờ tạo share. Chỉ hành động "Duyệt" của người quản lý mới tạo share (qua đường `ShareDocument` có audit).
- **Thẻ khóa thay cho trang 404 của tài liệu:** với người đã đăng nhập, khi `GET /documents/{id}` trả 404 (không tồn tại, không có quyền, hoặc khác tổ chức), màn hình tài liệu hiện `DocumentLockedCard variant="member"` với câu trung tính "có thể không tồn tại hoặc bạn chưa có quyền" và nút "Xin quyền truy cập". Thẻ **không** hiện tiêu đề, chủ sở hữu hay workspace của tài liệu (server không trả gì). 403 (đọc được nhưng thiếu mức, hoặc vừa bị thu hồi) giữ màn "đã bị thu hồi" hiện có; admin với `403 document_restricted` thấy `variant="admin"` (DOC-05). Mở từ Hộp việc giữ `DocumentInboxState` hiện có.
- **Ai được gửi:** người (human) đã đăng nhập. Agent → `403 forbidden` (agent không phải principal của share). Người đã bị vô hiệu hóa ở tổ chức của tài liệu không phân biệt được với "tài liệu không tồn tại": nhận cùng `202`, không lưu gì.
- **Phản hồi đồng nhất (không lộ tồn tại):** `POST /documents/{documentID}/access-requests` **luôn** trả `202 {"status":"sent"}` cho mọi id hợp lệ về cú pháp, sau cùng một lượng việc (tra cứu theo id có `organization_id`), dù: tài liệu không tồn tại; thuộc tổ chức khác; người gửi không phải thành viên đang hoạt động của tổ chức tài liệu; tài liệu thuộc Work Product; tài liệu đã archive; người gửi **đã** đọc được (trường hợp này client không hiện thẻ nên hiếm); hoặc đã có yêu cầu đang chờ. Chỉ khi tài liệu tồn tại, cùng tổ chức với một membership đang hoạt động của người gửi, chưa archive, không thuộc Work Product và người gửi chưa đạt mức xin, server mới **lưu** một yêu cầu `pending` và thông báo người quản lý. Không có route nào cho người gửi đọc lại trạng thái yêu cầu của mình (một route như vậy sẽ thành cách dò tồn tại); kết quả đến qua thông báo.
- **Mức xin:** `requested_level` ∈ `view` (mặc định) | `edit`; thêm `comment` khi thẻ DOC-05/G8-18 server đã vào. Lời nhắn tùy chọn ≤ 500 ký tự sau `strings.TrimSpace`.
- **Ngữ cảnh nguồn (task/meeting):** body có cặp tùy chọn `source_kind` (`task`|`meeting`) + `source_id` (gọi chung là "nguồn"). Web điền khi người dùng bấm URL tài liệu trong mô tả/bình luận task hoặc ghi chú/chat meeting (liên kết nội bộ gắn `?from=task:<id>` / `?from=meeting:<id>`, xem mục 6). Server chỉ giữ `source` khi người gửi **đọc được** task/meeting đó qua cổng của chính nó (`TaskService`/`MeetingService` authorize) **và** nó cùng tổ chức với tài liệu; nếu không, `source` bị bỏ **im lặng** (không lỗi — lỗi sẽ thành cách dò task). Người quản lý thấy "từ công việc/cuộc họp X" chỉ khi chính họ đọc được nguồn đó (kiểm lúc đọc danh sách); nếu không, chỉ thấy "từ một liên kết".
- **Ai duyệt:** người có `canAdminister()` trên tài liệu (ACL owner, share `manage`, hoặc ws owner/admin với `AdminScope` — DOC-05 cho phép admin chia sẻ cho **người khác**). Người gửi không tự duyệt yêu cầu của mình (nếu người gửi là admin với `AdminScope` thì đã có đường break-glass; yêu cầu do admin tự gửi và tự duyệt → `403 break_glass_required`).
- **Người nhận thông báo yêu cầu:** ACL owner (nếu đang là thành viên hiệu lực) và mọi người có share `user` mức `manage` còn hiệu lực; nếu tập này rỗng → ws owner/admin của workspace chứa tài liệu. Không bao giờ thông báo cho chính người gửi.
- **Duyệt:** người duyệt chọn mức `granted_level` (mặc định = `requested_level`, được chọn thấp hơn hoặc cao hơn, tối đa `edit`; muốn `manage` thì dùng hộp Chia sẻ). Trong một tx: khóa yêu cầu (`FOR UPDATE`), kiểm còn `pending` và chưa hết hạn, kiểm cổng duyệt, rồi gọi phần thân của `ShareDocument` cho principal `user` = người gửi — **chỉ nâng**: nếu người gửi đã có mức ≥ `granted_level` (vừa được ai đó chia sẻ) thì không đổi share, yêu cầu vẫn đóng `approved` với `share_id` rỗng. `validateSharePrincipal` từ chối (người gửi vừa bị vô hiệu hóa) → yêu cầu đóng `cancelled`, trả `422 principal_not_in_organization`.
- **Từ chối:** đóng `declined`, lời nhắn tùy chọn của người từ chối **không** gửi cho người xin (chọn: tránh trao đổi riêng tư qua hệ thống quyền; người từ chối muốn giải thích thì nhắn trực tiếp). Người xin nhận thông báo "đã từ chối".
- **Một yêu cầu chờ cho mỗi (tài liệu, người gửi):** gửi lại khi đang chờ → cập nhật `requested_level` lên mức cao hơn nếu có và lời nhắn mới, **không** thông báo lại trong 24 giờ kể từ thông báo trước (chống spam); vẫn `202`.
- **Hết hạn:** yêu cầu `pending` quá **30 ngày** coi như `expired` khi đọc/duyệt (không cần worker; tính bằng `expires_at`). Duyệt yêu cầu đã hết hạn → `409 access_request_closed`. Người xin gửi lại được sau đó.
- **Giới hạn tần suất:** `POST …/access-requests` có limiter riêng theo người (`mw.RateLimitByIdentity`, 20/giờ, khóa theo user đã xác thực), cùng cơ chế fail-open 100ms của limiter hiện có.

### 3.2 Trạng thái

| Trạng thái (`status`) | Vào khi | Ra khi |
| --- | --- | --- |
| `pending` | Lần gửi hợp lệ đầu tiên | duyệt / từ chối / hết hạn / hủy |
| `approved` | Người quản lý duyệt (có hoặc không tạo share mới) | — (cuối) |
| `declined` | Người quản lý từ chối | — (cuối) |
| `expired` | `expires_at ≤ now()` lúc đọc | — (cuối, suy ra; cột lưu vẫn `pending` tới khi có lệnh ghi chạm vào) |
| `cancelled` | Duyệt/từ chối trên tài liệu đã archive, hoặc người xin đã bị vô hiệu hóa lúc duyệt. (Người xin đã đủ mức lúc duyệt thì là `approved`, không phải `cancelled`) | — (cuối) |

Archive tài liệu: các yêu cầu `pending` không bị sửa lúc archive (archive không chạm bảng này để giữ tx archive gọn); danh sách yêu cầu loại tài liệu đã archive, và duyệt/từ chối trên tài liệu đã archive → `409 access_request_closed` (ghi `cancelled`). Purge: xóa các dòng yêu cầu của tài liệu trong tx purge (`purgeOneDocument`, `document_lifecycle.go:1060-1076`, thêm một hàm xóa — không FK, dọn bằng service).

### 3.3 Trường hợp biên

| Trường hợp | Hành vi |
| --- | --- |
| Tài liệu `restricted` được liên kết từ một task người xin **thấy được** | Thẻ khóa `member`; `source` hợp lệ được giữ; người quản lý thấy nguồn nếu chính họ đọc được task. Thấy task không cho quyền gì trên tài liệu |
| Tài liệu `workspace`, người xin ở workspace khác cùng tổ chức | Như trên (share vượt workspace trong tổ chức là hợp lệ, `shareAppliesTo`) |
| Id thuộc tổ chức khác / không tồn tại / người xin đã vô hiệu hóa | Cùng thẻ, cùng `202`, không lưu, không thông báo |
| Tài liệu thuộc Work Product | Cùng `202`, không lưu (quyền do resolver của sản phẩm; chia sẻ là 409) |
| Đã có yêu cầu chờ | `202`, gộp vào yêu cầu cũ, không thông báo lại trong 24 giờ |
| Người xin vừa được chia sẻ trong lúc chờ | Duyệt → `approved` không đổi share (chỉ nâng); realtime `document.shared` làm client của người xin tải lại và mở được tài liệu |
| Hai người quản lý duyệt/từ chối cùng lúc | Khóa dòng yêu cầu; người sau nhận `409 access_request_closed` |
| Không còn người nhận thông báo (không ACL owner, không share `manage`, workspace không còn owner/admin) | Lưu yêu cầu; không thông báo; vẫn hiện trong danh sách khi một người quản lý mở hộp Chia sẻ |
| Người duyệt chỉ có `AdminScope` | Duyệt được cho người khác (không đọc nội dung); tự duyệt yêu cầu của chính mình → `403 break_glass_required` |
| Liên kết công khai (`/public/documents/{token}`) | Không đổi; không có thẻ khóa, không xin quyền (người ẩn danh) |

### 3.4 UI và chuỗi

- **`DocumentLockedCard variant="member"`** (component dùng chung do thẻ DOC-05 web tạo; nếu DOC-07 web vào trước thì DOC-07 tạo component với cả hai biến thể và DOC-05 dùng lại): biểu tượng ổ khóa, tiêu đề, thân trung tính, chọn mức ("Xem" / "Chỉnh sửa", thêm "Bình luận" khi có), ô lời nhắn tùy chọn (bộ đếm `{{count}}/500`), nút "Gửi yêu cầu", nút "Quay lại". Sau khi gửi: trạng thái "Đã gửi yêu cầu" (thay nút bằng dòng trạng thái); trạng thái này giữ theo phiên trên thiết bị qua `StorageAdapter` (khóa theo document id, 24 giờ) — chỉ là tiện ích hiển thị, server không dựa vào.
- **Phía người quản lý:** hộp Chia sẻ có mục "Yêu cầu truy cập" (đếm số chờ) liệt kê: tên người xin, mức xin, lời nhắn, nguồn (nếu đọc được), thời điểm; mỗi hàng có chọn mức + "Duyệt" / "Từ chối". Thông báo Hộp việc mở thẳng mục này (`?access=requests`). Danh sách thư viện/cây không đổi.

| Vị trí | Khóa (`documents.accessRequest.*` / `notifications.*`) | vi | en |
| --- | --- | --- | --- |
| Thẻ khóa — tiêu đề, thân | `lockedTitle`, `lockedBody` | `"Bạn chưa mở được tài liệu này"` · `"Tài liệu có thể không tồn tại, hoặc bạn chưa có quyền xem. Bạn có thể gửi yêu cầu tới người quản lý tài liệu."` | `"You can't open this document"` · `"It may not exist, or you don't have access yet. You can ask the people who manage it."` |
| Chọn mức, lời nhắn, bộ đếm | `levelLabel`, `messageLabel`, `messagePlaceholder`, `messageCounter` | `"Quyền cần xin"` · `"Lời nhắn (không bắt buộc)"` · `"Vì sao bạn cần tài liệu này?"` · `"{{count}}/500"` | `"Access you need"` · `"Message (optional)"` · `"Why do you need this document?"` · `"{{count}}/500"` |
| Nút gửi / đang gửi / đã gửi | `send`, `sending`, `sent` | `"Gửi yêu cầu"` · `"Đang gửi…"` · `"Đã gửi yêu cầu. Bạn sẽ nhận thông báo khi người quản lý trả lời."` | `"Request access"` · `"Sending…"` · `"Request sent. You'll be notified when someone responds."` |
| Lỗi gửi (mạng/5xx/429) | `sendFailed`, `rateLimited` | `"Chưa gửi được yêu cầu. Hãy thử lại."` · `"Bạn đã gửi nhiều yêu cầu. Hãy thử lại sau ít phút."` | `"Couldn't send the request. Try again."` · `"You've sent a lot of requests. Try again in a few minutes."` |
| Lời nhắn quá dài | `messageTooLong` | `"Lời nhắn tối đa 500 ký tự."` | `"Message must be 500 characters or fewer."` |
| Mục trong hộp Chia sẻ | `sectionTitle`, `rowSource`, `rowSourceUnknown`, `approve`, `decline`, `approved`, `declined`, `closed` | `"Yêu cầu truy cập ({{count}})"` · `"Từ {{source}}"` · `"Từ một liên kết"` · `"Duyệt"` · `"Từ chối"` · `"Đã cấp quyền {{level}} cho {{name}}"` · `"Đã từ chối yêu cầu của {{name}}"` · `"Yêu cầu này đã được xử lý hoặc đã hết hạn."` | `"Access requests ({{count}})"` · `"From {{source}}"` · `"From a link"` · `"Approve"` · `"Decline"` · `"Gave {{name}} {{level}} access"` · `"Declined {{name}}'s request"` · `"This request was already handled or has expired."` |
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
| `GET /api/v1/config` | Thêm `capabilities.create_visibility: true` (cờ cộng thêm) để web chỉ bật nút "Hạn chế" cho tệp khi server đã nhận trường (client cũ bỏ qua trường lạ) |

Lỗi: `422 validation_failed` (`fields.visibility`). Không có route, sự kiện, kind thông báo, audit action hay dòng isolation mới (trường mới không phải `_id`). Không có feature flag mới (mặc định không đổi; cờ capability chỉ để tương thích phiên bản).

### 4.2 DOC-06

| Method & path | SDI | SDO | Cổng |
| --- | --- | --- | --- |
| `PUT /api/v1/documents/{documentID}/owner` | `TransferDocumentOwnerSDI{ user_id string (ULID, bắt buộc) "ULID người nhận, thành viên hiệu lực của workspace chứa tài liệu" ex "01J8X4USER0N1P2Q3R4S5T6U7V8"; previous_owner_level *string "edit (mặc định), comment, view hoặc none" ex "edit" }` | `DocumentOwnerSDO{ document_id, acl_owner_id, previous_owner_id, previous_owner_share_id (rỗng khi none/bỏ qua) }` | `withDocumentAdministerMutation` → `canAdminister()` |
| `GET /api/v1/orgs/{orgID}/members/{userID}/document-ownership` | — | `MemberDocumentOwnershipSDO{ user_id, total int, workspaces: [{workspace_id, workspace_name, count}] }` — chỉ đếm, không tiêu đề | owner/admin tổ chức (`OrganizationService.RequireMember` + vai trò, như `requireAdmin`) |
| `POST /api/v1/orgs/{orgID}/members/{userID}/document-ownership` | `TransferMemberDocumentsSDI{ to_user_id string (ULID, bắt buộc); bulk_id *string (ULID của đợt, gửi lại ở các lần tiếp) }` | `MemberDocumentsTransferSDO{ bulk_id, transferred int, skipped: {recipient_not_member int, self_restricted int}, has_more bool }` | như trên; admin không thao tác trên admin khác (luật P6, `organization_members.go:221-224`) |

Ví dụ:

```json
PUT /api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/owner
{"user_id": "01J8X4USER0N1P2Q3R4S5T6U7V8", "previous_owner_level": "edit"}
→ 200 {"document_id": "01J8X4DOC0N1P2Q3R4S5T6U7", "acl_owner_id": "01J8X4USER0N1P2Q3R4S5T6U7V8", "previous_owner_id": "01J8X4K2M0N1P2Q3R4S5T6U7V8", "previous_owner_share_id": "01J8X4SHAREN1P2Q3R4S5T6U7"}

POST /api/v1/orgs/01J8X4ORG0N1P2Q3R4S5T6U7V/members/01J8X4K2M0N1P2Q3R4S5T6U7V8/document-ownership
{"to_user_id": "01J8X4USER0N1P2Q3R4S5T6U7V8"}
→ 200 {"bulk_id": "01J8X4BULK0N1P2Q3R4S5T6U7", "transferred": 500, "skipped": {"recipient_not_member": 3, "self_restricted": 0}, "has_more": true}
```

Lỗi:

| HTTP | `code` | Khi | `error_class` |
| --- | --- | --- | --- |
| 404 | (chung) | Tài liệu/thành viên không thấy được, khác tổ chức | `missing` |
| 403 | `forbidden` | Đọc được nhưng không `canAdminister()`; không phải owner/admin tổ chức | `permission` |
| 403 | `break_glass_required` | Admin chỉ có `AdminScope` tự nhận tài liệu `restricted` (từng tài liệu) | `permission` (đã đăng ký bởi DOC-05) |
| 409 | `document_owned_by_work_product` | Tài liệu thuộc Work Product | (đã có, `unclassified`) |
| 422 | `owner_target_not_member` | Người nhận không phải người/không đang hoạt động/không là thành viên hiệu lực của workspace (từng tài liệu); người nhận hàng loạt không phải thành viên đang hoạt động của tổ chức hoặc trùng thành viên nguồn | thêm `"owner_target_not_member": "validation"` vào `errorClassByCode` (`handler/dto/sdo/error_class.go`) + `TestErrorClassTable` |
| 422 | `validation_failed` | `previous_owner_level` lạ; `bulk_id` không phải ULID | `validation` |

Sự kiện (thêm ở **ba** nơi: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`; chỉ id):

| Topic | Payload | Scope | Client |
| --- | --- | --- | --- |
| `document.owner_transferred` | `document_id`, `workspace_id`, `bulk_id` (tùy chọn, chỉ lệnh hàng loạt) | `ScopeWorkspace` | invalidate khóa chi tiết + danh sách truy cập của tài liệu, các list gốc của workspace |
| `document.owners_bulk_transferred` | `organization_id`, `user_id` (người nhận), `bulk_id` | `ScopeUser` | invalidate list tài liệu của người nhận; nguồn của thông báo gộp |

Audit (`server/internal/audit/actions.go` + `service/audit_coverage_test.go`): `document.owner_transferred` (`ResourceType=document`, `Changes{acl_owner_id: before→after}`, `Metadata{previous_owner_level, bulk_id?}`), `document.owners_bulk_transferred` (`ResourceType=organization_member`, `Metadata` như mục 2.2).

Thông báo (kind mới, đồng bộ đủ nơi như phụ lục mức quyền §4: `notification/kinds.go`, `prefs.go`, `titles.go` + test, `push_consumer.go`, `packages/core/types/notification.ts`, renderer `packages/views/notifications/*`):
- `document_owner_transferred` — từ `document.owner_transferred` của lệnh **từng tài liệu**, gửi chủ mới.
- `document_owners_bulk_transferred` — từ `document.owners_bulk_transferred`, gửi người nhận đợt, `group_key = document_owner_bulk:{bulk_id}` để các lần gọi tiếp của cùng đợt gộp vào một dòng.
- **Phân biệt mà payload vẫn chỉ có id (chọn):** lệnh hàng loạt vẫn phát `document.owner_transferred` cho từng tài liệu (realtime cần để client làm mới), nhưng payload có thêm khóa tùy chọn `bulk_id` (một id — hợp lệ với luật ids-only); rule thông báo của `document_owner_transferred` **bỏ qua** dòng có `bulk_id`. Catalogue khai `bulk_id` là khóa tùy chọn của topic.
- Push mặc định **tắt** cho cả hai (không gấp). Tiêu đề: `"{{actor}} đã chuyển cho bạn quyền sở hữu tài liệu “{{document}}”."` / `"{{actor}} transferred ownership of “{{document}}” to you."`; gộp: `"{{actor}} đã chuyển cho bạn quyền sở hữu các tài liệu của {{name}}."` / `"{{actor}} transferred {{name}}'s documents to you."`.

Isolation (ADR 0008):
- `isoRoutes` (`server/internal/handler/isolation_routes_test.go`): thêm cả ba route; `PUT …/owner` có control (owner của B chuyển tài liệu của chính B); `GET/POST /orgs/{orgID}/members/{userID}/document-ownership` có control trong tổ chức của B.
- `isoReferences` (`isolation_references_test.go`): `TransferDocumentOwnerSDI.user_id` (đưa id người của A vào tài liệu của B → `422 owner_target_not_member`, không lộ tên), `TransferMemberDocumentsSDI.to_user_id` (người của A làm người nhận trong tổ chức B → 422), `TransferMemberDocumentsSDI.bulk_id` (bulk_id là id do server sinh, không trỏ dòng nào: miễn với lý do "opaque correlation id, never resolved to a row" — hoặc case tham chiếu nếu reviewer muốn).
- `pathParamSDI` (`router/openapi.go`): tổ hợp `{orgID}` + `{userID}` cần một case mới nếu chưa có cho đường dẫn này.

### 4.3 DOC-07

| Method & path | SDI | SDO | Cổng |
| --- | --- | --- | --- |
| `POST /api/v1/documents/{documentID}/access-requests` | `CreateDocumentAccessRequestSDI{ requested_level *string "view (mặc định), comment hoặc edit" ex "view"; message *string "≤ 500 ký tự sau trim" ex "Mình cần xem để chuẩn bị họp thứ Hai"; source_kind *string "task hoặc meeting; đi cùng source_id" ex "task"; source_id *string "ULID công việc/cuộc họp có chứa liên kết" ex "01J8X4TASK0N1P2Q3R4S5T6U7" }` (trường phẳng, xem mục Isolation) | `202 DocumentAccessRequestSentSDO{ status: "sent" }` — **luôn** như vậy | đăng nhập, human; limiter `doc-access-request` 20/giờ/người |
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
| 202 | — | Mọi lần gửi hợp lệ cú pháp (kể cả không lưu) | — |
| 403 | `forbidden` | Agent gửi yêu cầu; người đọc được nhưng không `canAdminister()` duyệt/từ chối | `permission` |
| 403 | `break_glass_required` | Admin chỉ có `AdminScope` duyệt yêu cầu của chính mình | `permission` |
| 404 | (chung) | Duyệt/từ chối/danh sách: tài liệu hoặc `requestID` không thấy được, yêu cầu thuộc tài liệu khác | `missing` |
| 409 | `access_request_closed` | Yêu cầu không còn `pending`, đã hết hạn, hoặc tài liệu đã archive | thêm `"access_request_closed": "conflict"` vào `errorClassByCode` + test |
| 422 | `validation_failed` | `requested_level`/`level` lạ (gồm `manage`), `message` > 500, `source.kind` lạ, `source.id` không phải ULID | `validation` |
| 422 | `principal_not_in_organization` | Duyệt khi người xin không còn là thành viên đang hoạt động (yêu cầu → `cancelled`) | (đã có) |
| 429 | (limiter) | Vượt 20/giờ | — |

Sự kiện (ba nơi catalogue; chỉ id):

| Topic | Payload | Scope | Client |
| --- | --- | --- | --- |
| `document.access_requested` | `document_id`, `workspace_id`, `request_id` | `ScopeWorkspace` (như `document.shared`; chỉ id) | invalidate danh sách yêu cầu + `GET …/shares` của tài liệu |
| `document.access_request_decided` | `document_id`, `workspace_id`, `request_id`, `user_id` (người xin) | `ScopeUser` (người xin) | invalidate chi tiết tài liệu (để màn thẻ khóa tải lại khi được duyệt) |

Khi duyệt có tạo share, `document.shared` hiện có cũng phát (đường `ShareDocument`).

Audit (`audit/actions.go` + `audit_coverage_test.go`): `document.access_requested` (`Actor` người xin, `ResourceType=document`, `Metadata{request_id, requested_level, source_kind?, has_message}` — **không** ghi nội dung lời nhắn vào audit; lời nhắn nằm trong bảng yêu cầu), `document.access_request_approved` (`Changes{status}`, `Metadata{request_id, granted_level, share_id?}`), `document.access_request_declined`. Lần gửi không lưu (mục 3.1) **không** ghi audit (không có thay đổi trạng thái nghiệp vụ). Gửi lại khi đang chờ có đổi mức/lời nhắn: ghi `document.access_requested` với `Metadata{request_id, updated: true}`.

Thông báo (kind mới, đủ nơi như 4.2): `document_access_requested` (từ `document.access_requested`, người nhận theo mục 3.1, `group_key = document:{id}:access_requests`, push **bật** — người xin đang chờ), `document_access_approved` và `document_access_declined` (từ `document.access_request_decided`, người xin, push bật cho approved, tắt cho declined). Rule kiểm lại quyền người nhận lúc gửi: người quản lý phải còn `canAdminister()` (admin chỉ có `AdminScope` vẫn nhận và thấy tiêu đề, vì DOC-05 cho admin thấy tên tài liệu hạn chế); người xin bị từ chối không bao giờ thấy tiêu đề (dùng biến thể không tiêu đề). Resource URL: người quản lý → tài liệu kèm `?access=requests`; người xin được duyệt → tài liệu.

Isolation:
- `isoRoutes`: thêm cả bốn route. `POST …/access-requests` là route "trả lời đồng nhất": với id của A, B nhận `202 {"status":"sent"}` giống hệt control của B và **không** có dòng nào của A đổi hash (bảng yêu cầu của A không thêm dòng, outbox/audit/notification của A không thêm dòng) — `isoSpec` cần một chế độ "uniform 202" (chấp nhận 202 thay 403/404 với điều kiện thân phản hồi bằng control và không lộ chuỗi/id của A); ghi lý do trong `isoRoutes`. Ba route còn lại: refusal 403/404 bình thường, control là người quản lý của B trên tài liệu của B.
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

**DOC-02, DOC-06:** không có migration (dùng cột `visibility`, `acl_owner_id` sẵn có). DOC-06 thêm câu sqlc, không đổi schema:
- `TransferDocumentACLOwner` — `UPDATE documents SET acl_owner_id = sqlc.arg(new_owner), updated_at = now() WHERE id = $ AND organization_id = sqlc.arg(organization_id) AND workspace_id = sqlc.arg(workspace_id) AND owner_kind IS NULL RETURNING *`;
- `ListMemberOwnedDocumentsForTransfer` — `SELECT id, workspace_id, visibility … WHERE organization_id = $ AND acl_owner_id = $ AND owner_kind IS NULL ORDER BY id LIMIT $ FOR UPDATE SKIP LOCKED`;
- `CountMemberOwnedDocumentsByWorkspace` — `… WHERE organization_id = $ AND acl_owner_id = $ AND owner_kind IS NULL GROUP BY workspace_id`.
Cả ba ràng buộc `organization_id = $n` (`TestEveryQueryNamesItsTenant`). Truy vấn theo `acl_owner_id` cần index: **một** migration chỉ một câu `CREATE INDEX CONCURRENTLY idx_documents_org_acl_owner ON documents (organization_id, acl_owner_id) WHERE owner_kind IS NULL AND acl_owner_id IS NOT NULL;` trong file `999<unix-ms>_documents_acl_owner_index.up.sql` riêng (+ `.down.sql` `DROP INDEX CONCURRENTLY`).

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
  decided_at       TIMESTAMPTZ,
  notified_at      TIMESTAMPTZ,
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
  - `999<ms>_document_access_requests_pending_unique.up.sql`: `CREATE UNIQUE INDEX CONCURRENTLY idx_document_access_requests_one_pending ON document_access_requests (document_id, created_by) WHERE status = 'pending';` (một yêu cầu chờ cho mỗi cặp; yêu cầu hết hạn vẫn `pending` trong cột nên lệnh gửi lại trên dòng hết hạn **cập nhật** dòng đó thành yêu cầu mới — `UPDATE … SET created_at, expires_at, requested_level, message, notified_at` — thay vì chèn dòng mới; audit ghi như lần gửi đầu);
  - `999<ms>_document_access_requests_doc_index.up.sql`: `CREATE INDEX CONCURRENTLY idx_document_access_requests_doc ON document_access_requests (organization_id, document_id, status, created_at);`.
- Câu sqlc mới (`server/pkg/db/queries/document_access_requests.sql`), mỗi câu có `organization_id = $n` hoặc `workspace_id = $n`: `UpsertPendingDocumentAccessRequest`, `GetDocumentAccessRequestForUpdate` (`organization_id` + `document_id` + `id`), `ListPendingDocumentAccessRequests`, `CountPendingDocumentAccessRequests`, `DecideDocumentAccessRequest`, `DeleteDocumentAccessRequests` (purge). Không cần dòng `-- tenant:`.
- Bảng mới tự rơi vào `TestNewTablesCarryOrganizationID` / `TestEveryBusinessTableCarriesOrganizationID` / `TestTenantColumnIsNotNull` (đã khai `organization_id TEXT NOT NULL`) và `TestActorKindOnEveryCreatedBy` (có `created_by_kind`); thêm hàm xóa vào luồng purge (mục 3.2).
- `.down.sql` cho mỗi file (`DROP TABLE` / `DROP INDEX CONCURRENTLY`), tiền tố `999<unix-ms>` theo `TestMigrationPrefixesSortTheSameAsStringsAndNumbers`.

## 6. Tách thẻ code (không code ở vòng này)

Thứ tự đã ký (14:30): phụ lục trước → server (xếp sau e6-server FD-02/FD-04) → web (xếp sau e6-web FD-08). Mỗi DOC một cặp thẻ server/web, hợp đồng trước + fake cho web.

| Thẻ | Lane | Issue | Owned paths (chính) | Phụ thuộc |
| --- | --- | --- | --- | --- |
| **S-DOC02** | e6-server | UNI-1629 | `dto/sdi/document.go` (`CreateDocumentFileSDI`), `dto/sdi/office.go` (`CreateBlankDocumentFileSDI`), `service/document_files.go` (`CreateFileDocumentInput`, `:377-386`), `service/document_office_capability.go` (`BlankFileInput`, `CreateBlankFile`), `handler/documents.go:225-239`, router mô tả, `GET /config` capability, test | Không phụ thuộc DOC-05. Nhỏ: làm trước |
| **W-DOC02** | e6-web | UNI-1629 | `packages/views/documents/{documents-home-create.tsx,documents-create.ts,document-upload-dialog.tsx}`, huy hiệu hàng, `packages/core/api/endpoints/{documents.ts,documents-blank.ts}` (+ malformed test), `packages/core/documents/hooks*.ts`, locales vi/en | S-DOC02 (hoặc fake: trường `visibility` trong body + capability `create_visibility`) |
| **S-DOC06** | e6-server | UNI-1630 | `service/document_owner_transfer.go` (mới), `service/organization_member_documents.go` (mới, gọi DocumentService trong tx của nó — cùng tầng service), `pkg/db/queries/documents.sql` (3 câu), migration index, router + SDI/SDO, catalogue 3 nơi, audit, notification kinds, isolation, `error_class` | **Thẻ (a) DOC-05 server** (cần `canAdminister()`, `withDocumentAdministerMutation`, `break_glass_required`). Nếu DOC-05 chưa vào: chặn — không viết bản tạm dùng `manage` (sẽ phải sửa lại cổng) |
| **W-DOC06** | e6-web | UNI-1630 | `packages/views/documents/{share-dialog.tsx, owner-transfer-dialog.tsx (mới)}`, `packages/views/settings/components/org-members-section.tsx` + bước chuyển tài liệu (component mới), `packages/core/permissions/rules.ts` (`canAdministerDocument`), endpoints + hooks + malformed test, renderer thông báo, locales, glossary `docs/conventions.md` | S-DOC06 hợp đồng (fake trả SDO mục 4.2); W-DOC05 (`admin_scope` trong schema client) |
| **S-DOC07** | e6-server | UNI-1631 | `service/document_access_requests.go` (mới), migration bảng + 2 index, `pkg/db/queries/document_access_requests.sql`, router + SDI/SDO + limiter, catalogue 3 nơi, audit, notification kinds + rules, `purgeOneDocument`, isolation (chế độ "uniform 202" trong `isoSpec`), `error_class`, `pathParamSDI` `requestID` | **Thẻ (a) DOC-05 server** (cổng duyệt `canAdminister()`); share mức `comment` theo DOC-05 |
| **W-DOC07** | e6-web | UNI-1631 | `DocumentLockedCard` (`variant="member"`; tạo component nếu W-DOC05 chưa có), `document-detail-view.tsx:106-121` (404 → thẻ khóa cho người đã đăng nhập), màn mở tài liệu Office tương ứng, mục "Yêu cầu truy cập" trong `share-dialog.tsx`, gắn `?from=task:<id>`/`?from=meeting:<id>` khi bấm URL tài liệu nội bộ trong editor của task/meeting (`packages/views/editor/utils/link-handler.ts`), endpoints + malformed test, renderer 3 kind, locales | S-DOC07 hợp đồng (fake: `POST` luôn 202; list/approve/decline theo SDO mục 4.3); W-DOC05 nếu dùng chung component |

**Thứ tự phát hành:** S-DOC02 → W-DOC02 (web chỉ bật nút cho tệp khi `create_visibility`; nút cho trang/thư mục bật được ngay vì route đó đã nhận `visibility`). DOC-05 (a)+(b) lockstep → S-DOC06 + S-DOC07 (song song, khác file; cùng chạm `audit/actions.go`, `outbox/catalogue.go`, `events.ts`, `CATALOGUE.md`, `notification/*`, `isolation_*_test.go`, `error_class.go` — merge tuần tự, người merge sau rebase) → W-DOC06 + W-DOC07. Web có thể làm song song với server trên fake, nhưng chỉ merge vào root sau thẻ server tương ứng. Không cần feature flag mới: route mới vô hại khi web chưa dùng; thẻ khóa chỉ thay màn 404 (không mở thêm dữ liệu).

## 7. Bảng AC

| AC | Given / When / Then | Loại test · file |
| --- | --- | --- |
| DOC2-A01 | Cho thành viên workspace, khi tạo trang/thư mục/tệp/tệp trống với `visibility=restricted` ở gốc, thì tài liệu `restricted`, người tạo là ACL owner (`manage`), thành viên khác không thấy trong list/tree/search và `GET` trả 404 | Go · `service/document_create_visibility_test.go` (mới) |
| DOC2-A02 | Cho tạo **không** gửi `visibility`, khi ở gốc thì `workspace`; khi dưới cha `restricted` thì `restricted` (cả ba route) | Go · cùng file |
| DOC2-A03 | Cho cùng `Idempotency-Key`, khi gửi lại với `visibility` khác thì `idempotency_payload_mismatch`; khi gửi lại y hệt (kể cả `visibility` rỗng như trước deploy) thì replay | Go · cùng file |
| DOC2-A04 | Cho `visibility` lạ, thì `422 validation_failed` `fields.visibility` (JSON và multipart) | Go · `handler/documents_test.go` |
| DOC2-W01 | Nút "Hạn chế" có `aria-pressed`, mặc định tắt mỗi lần mở; bật rồi tạo bất kỳ loại nào gửi `visibility:"restricted"`; tắt thì không gửi trường | vitest · `packages/views/documents/documents-home-create.test.tsx` (mới) |
| DOC2-W02 | Trong thư mục `restricted`, nút bật + `aria-disabled` + gợi ý kế thừa; không gửi trường | vitest · cùng file |
| DOC2-W03 | Toast "Đã tạo ở chế độ Hạn chế" có hành động "Chia sẻ" mở hộp Chia sẻ của tài liệu mới; server thiếu `create_visibility` thì nút ẩn cho tệp, còn cho trang/thư mục | vitest · cùng file |
| DOC6-A01 | Cho người `manage` (hoặc admin `AdminScope`), khi chuyển cho thành viên hiệu lực của workspace, thì `acl_owner_id` đổi, chủ mới `manage`, chủ cũ có share mức đã chọn (mặc định `edit`, chỉ nâng), một audit `document.owner_transferred`, một outbox, một thông báo cho chủ mới; `revision` không đổi | Go · `service/document_owner_transfer_test.go` (mới) |
| DOC6-A02 | Người nhận không phải thành viên workspace / đã vô hiệu hóa / agent → `422 owner_target_not_member`; người chỉ `edit` → 403; tài liệu Work Product → 409; người ngoài → 404 | Go · cùng file |
| DOC6-A03 | Admin chỉ `AdminScope` tự nhận tài liệu `restricted` → `403 break_glass_required`; chuyển cho người khác → 200 và phản hồi không có `content` | Go · cùng file |
| DOC6-A04 | Cho thành viên (đang hoạt động hoặc đã vô hiệu hóa) sở hữu tài liệu ở nhiều workspace, khi owner/admin tổ chức chuyển hàng loạt, thì tài liệu ở workspace người nhận tham gia được chuyển (không share cho nguồn), còn lại đếm `recipient_not_member`; người nhận = người gọi trên tài liệu `restricted` không có `manage` đếm `self_restricted`; > 500 thì `has_more` và gọi tiếp hết; mỗi tài liệu một audit + outbox có `bulk_id`, một audit tổng, một thông báo gộp | Go · `service/organization_member_documents_test.go` (mới) |
| DOC6-A05 | Admin tổ chức chuyển tài liệu của một admin khác → 403 (luật P6); thành viên thường → 403; `GET …/document-ownership` chỉ trả đếm theo workspace | Go · cùng file |
| DOC6-A06 | Isolation: ba route trong `isoRoutes` có control; `user_id`/`to_user_id` của A → 422 không lộ; `TestEveryQueryNamesItsTenant` xanh với 3 câu mới; migration index lint xanh | Go · `handler/isolation_*_test.go`, `migrations/lint_test.go`, `migrations/query_scope_test.go` |
| DOC6-W01 | Dòng chủ sở hữu có nút "Chuyển quyền sở hữu" chỉ khi `canAdministerDocument`; hộp con chọn người (không agent, không người đã vô hiệu hóa), mức giữ lại mặc định "Chỉnh sửa"; lỗi `owner_target_not_member` và `break_glass_required` hiện đúng câu | vitest · `packages/views/documents/owner-transfer-dialog.test.tsx` (mới), `packages/core/permissions/rules.documents.test.ts` |
| DOC6-W02 | Hộp vô hiệu hóa hiện số tài liệu, chọn người nhận hoặc "Để sau"; deactivate trước rồi chuyển, lặp `has_more`; lỗi chuyển hiện "Thử lại" và tài khoản vẫn đã vô hiệu hóa; hàng đã vô hiệu hóa có "Chuyển tài liệu" | vitest · `packages/views/settings/components/org-members-section.test.tsx` |
| DOC7-A01 | Cho người đã đăng nhập không đọc được tài liệu cùng tổ chức, khi `POST …/access-requests`, thì `202 {"status":"sent"}`, một dòng `pending`, audit `document.access_requested`, outbox, thông báo cho ACL owner + share `manage` (hoặc ws owner/admin khi không có ai) | Go · `service/document_access_requests_test.go` (mới) |
| DOC7-A02 | Cho id không tồn tại, của tổ chức khác, tài liệu Work Product, tài liệu đã archive, người xin đã vô hiệu hóa, hoặc người xin đã đọc được — thì phản hồi **byte-giống** DOC7-A01, không dòng, không audit, không outbox, không thông báo | Go · cùng file |
| DOC7-A03 | Gửi lại khi đang chờ → vẫn 202, một dòng, nâng mức nếu cao hơn, không thông báo lại trong 24 giờ; sau `expires_at` gửi lại → dòng được làm mới và thông báo lại | Go · cùng file |
| DOC7-A04 | Người `canAdminister()` duyệt → share `user` mức chọn (chỉ nâng; người xin đã đủ mức thì `share_id` rỗng), `document.shared` + `document.access_request_decided`, audit approve, thông báo người xin; từ chối → `declined`, thông báo không có tiêu đề tài liệu | Go · cùng file |
| DOC7-A05 | Duyệt/từ chối yêu cầu đã đóng, hết hạn, hoặc trên tài liệu đã archive → `409 access_request_closed`; hai người duyệt cùng lúc → một 200, một 409; người xin vừa bị vô hiệu hóa → `422 principal_not_in_organization` và yêu cầu `cancelled`; admin `AdminScope` tự duyệt yêu cầu của mình → `403 break_glass_required`; người chỉ `edit` → 403 | Go · cùng file |
| DOC7-A06 | `source` task/meeting người xin đọc được → giữ; không đọc được hoặc khác tổ chức → bỏ im lặng; người quản lý không đọc được nguồn thấy `source: null` | Go · cùng file |
| DOC7-A07 | Mở URL tài liệu **không bao giờ** tạo share (không có đường tự cấp): mọi đường đọc trả 404 trước và sau khi gửi yêu cầu cho tới khi duyệt | Go · cùng file |
| DOC7-A08 | Isolation: bốn route trong `isoRoutes` (POST ở chế độ "uniform 202": thân bằng control, không hash nào của A đổi); dòng seed của A; `source_id` của A không lưu; purge xóa dòng yêu cầu; limiter 20/giờ | Go · `handler/isolation_*_test.go`, `service/document_lifecycle_test.go`, `handler/router/ratelimit_test.go` |
| DOC7-W01 | Người đã đăng nhập mở tài liệu 404 thấy `DocumentLockedCard variant="member"` (không tiêu đề), chọn mức, lời nhắn ≤ 500 có bộ đếm, gửi → "Đã gửi yêu cầu" (`role="status"`); 403 vẫn màn "đã bị thu hồi"; mở từ Hộp việc vẫn `DocumentInboxState` | vitest · `packages/views/documents/document-locked-card.test.tsx` (mới), `document-detail-view.test.tsx` |
| DOC7-W02 | Hộp Chia sẻ hiện "Yêu cầu truy cập ({{count}})" cho người `canAdminister()`; duyệt/từ chối cập nhật danh sách; `409 access_request_closed` hiện câu "đã được xử lý"; thông báo Hộp việc mở `?access=requests` | vitest · `share-dialog.test.tsx`, `packages/views/notifications/*.test.ts` |
| DOC7-W03 | Bấm URL tài liệu nội bộ trong mô tả/bình luận task hoặc ghi chú meeting gắn `?from=task:<id>` / `?from=meeting:<id>`; thẻ khóa gửi `source_kind`/`source_id` từ tham số đó | vitest · `packages/views/editor/utils/link-handler.test.ts` |
| DOC-E2E | Luồng thật: A tạo tài liệu "Hạn chế" một chạm → B mở URL từ một task → thẻ khóa → xin quyền → A nhận thông báo, duyệt → B mở được; admin vô hiệu hóa A, chuyển tài liệu cho C → C quản lý được | e2e · `e2e/documents-access.spec.ts` (mới, chạy trên cloud runner) |

## 8. Test và câu hỏi mở

**Go (Postgres thật, `-race`):** `document_create_visibility_test.go`, `document_owner_transfer_test.go`, `organization_member_documents_test.go`, `document_access_requests_test.go` (mới, mục 7); cập nhật `audit_coverage_test.go` (5 action mới), `notification/kinds_test.go` + `titles` test (5 kind), `handler/dto/sdo/error_class_test.go` (`owner_target_not_member`, `access_request_closed`), `handler/isolation_routes_test.go` + `isolation_references_test.go` + `isolation_world_test.go` (`TestIsolationMatrix`, `TestEveryBodyIDFieldHasAReferenceCase`), `migrations/lint_test.go` + `query_scope_test.go` (`TestEveryQueryNamesItsTenant`) + `tenant_schema_test.go`, `handler/router/ratelimit_test.go` (limiter mới), `handler/router/catalogue_test.go` (route mới có SDI/SDO).
**Repo contracts:** `scripts/events-catalogue.test.mjs` (4 topic mới, `bulk_id` là khóa id), `scripts/env-example.test.mjs` (không có biến mới).
**core/views vitest:** `packages/core/api/endpoints/documents.test.ts` (malformed cho `visibility` trả về, `DocumentOwnerSDO`, `MemberDocumentsTransferSDO`, `DocumentAccessRequestListSDO`, `pending_access_requests`), `packages/core/permissions/rules.documents.test.ts` (`canAdministerDocument`), các file views ở mục 7, `packages/views/notifications/{kind-tone,notification-title,resource-href}.test.ts` (5 kind), parity locale vi/en (`i18n/parity.test.ts`).
**E2E:** `e2e/documents-access.spec.ts` (cloud runner). **Visual:** `tester_visual` 9 tiêu chí cho nút "Hạn chế" + toast, hộp chuyển quyền sở hữu, bước chuyển tài liệu trong hộp vô hiệu hóa, `DocumentLockedCard variant="member"`, mục "Yêu cầu truy cập".

**Câu hỏi mở (chỉ điểm chưa quyết; không mở lại quyết định 14:30):**
- **Q1 — Con rộng hơn cha:** route tạo trang hiện cho phép tạo con `workspace` dưới cha `restricted` khi gửi `visibility` tường minh (`document_pages.go:223-236`), trong khi chú thích tạo tệp nói "trang hạn chế không bao giờ có tệp hiển thị cho cả workspace" (`document_files.go:383-384`). Phụ lục giữ nghĩa route trang và áp cho tệp (web không bao giờ gửi giá trị này). Có muốn server **chặn** (`422`) con rộng hơn cha ở cả ba route không? Đổi hành vi route trang nên cần người quyết.
- **Q2 — Mặc định quyền giữ lại cho chủ cũ (DOC-06 từng tài liệu):** phụ lục chọn `edit`. Nếu sản phẩm muốn "chuyển là mất quyền" thì đổi mặc định thành `none` (không đổi hợp đồng, chỉ đổi giá trị mặc định).
- **Q3 — Bắt buộc chuyển khi vô hiệu hóa:** phụ lục cho "Để sau" (vô hiệu hóa không bị chặn bởi việc chọn người nhận). Có muốn bắt buộc chọn người nhận khi thành viên còn tài liệu `restricted` không?
- **Q4 — Thời hạn yêu cầu và giới hạn tần suất (DOC-07):** 30 ngày, nhắc lại sau 24 giờ, 20 yêu cầu/giờ/người là giá trị chọn; cần sản phẩm xác nhận hoặc đổi số.

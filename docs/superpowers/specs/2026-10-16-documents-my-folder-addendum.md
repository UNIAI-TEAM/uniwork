# Documents — Phụ lục: Thư mục của tôi (My Folder) và danh sách "Tôi đã chia sẻ"

> **Trạng thái:** in-progress — v0.1 hợp đồng, viết 2026-10-16, chưa có dòng code nào. Nguồn: gói quyết định 2026-10-16 §6 SỬA LẠI (người dùng ~16:00, thay Q-S2 và phần chọn thư mục của Q-S1) và yêu cầu "Tôi đã chia sẻ" (người dùng 16:08). Thẻ: MYFOLDER-01 (UNI-1850), SHAREDBYME-01 (UNI-1851); phần web SAVE-01 (UNI-1847, docs-src_local), phần desktop (app-uniwork_local). Mọi mục đã chốt 2026-10-16 theo đề xuất của Advisor.

**Quan hệ:** [Documents C-01](2026-09-08-documents-design.md) (cây, tạo, lưu trữ), [phụ lục Share SRS](2026-10-15-documents-share-srs-addendum.md) (SH-S1: riêng tư mặc định, `workspace_level`, kế thừa quyền thư mục cha), [phụ lục mức quyền](2026-10-14-documents-permission-levels-addendum.md) (`AdminScope`, break-glass).
**Hiện trạng:** đọc ở `feature/UNI-1780-sh-s1-workspace-level` @`153889bdf` (SH-S1 + root `89262b63b`). Code MYFOLDER-01 đi sau khi SH-S1 vào root.

## 1. Mô hình

- **Đánh dấu hệ thống.** Cột mới `documents.system_kind TEXT NULL CHECK (system_kind IN ('my_folder'))`. `my_folder` chỉ hợp lệ khi `kind = 'folder'`, `parent_id IS NULL`, `owner_kind IS NULL` (CHECK cùng migration). Không dùng `owner_kind` (đó là sở hữu của Kết quả công việc, §13 C-01, và kéo theo quyền qua chủ sở hữu).
- **Một dòng mỗi (workspace, thành viên).** `CREATE UNIQUE INDEX CONCURRENTLY idx_documents_my_folder_uidx ON documents (workspace_id, acl_owner_id) WHERE system_kind = 'my_folder'` (một file migration riêng). Không lọc `archived_at`: My Folder không bao giờ vào thùng rác (§3).
- **Hàng My Folder:** `kind='folder'`, `parent_id NULL`, `visibility='restricted'`, `workspace_level='view'` (vô hiệu khi restricted), `acl_owner_id = created_by = thành viên`, `created_by_kind='human'`, `title = 'My Folder'` (giá trị lưu trữ cố định; client hiển thị nhãn theo ngôn ngữ từ `system_kind`, §5), `organization_id` của workspace.
- **Tên thư mục trùng.** Chỉ mục duy nhất tên thư mục hiện có `idx_documents_folder_name_uidx (workspace_id, COALESCE(parent_id,''), lower(title)) WHERE kind='folder' AND archived_at IS NULL AND owner_id IS NULL` sẽ chặn My Folder thứ hai ở gốc. Thay bằng chỉ mục cùng biểu thức thêm `AND system_kind IS NULL` (tạo mới CONCURRENTLY, rồi xóa cũ CONCURRENTLY — hai file riêng), và `requireFreeFolderName` bỏ qua hàng có `system_kind`. Người dùng vẫn tạo được thư mục gốc tên "My Folder" của riêng họ.
- **Migration:** không FK, có `organization_id` sẵn (bảng `documents`), mọi chỉ mục CONCURRENTLY một mình một file, tiền tố `999<unix-ms>_`. Không backfill.

## 2. Tạo lười, idempotent (ensure)

- `DocumentService.EnsureMyFolder(ctx, actor Actor, wsID) (Document, created bool, error)`: `RequireMember` (người ngoài → 404 như route tài liệu khác; thành viên bị vô hiệu → 403 như cổng hiện có); **chỉ `Human`** — agent nhận `ErrForbidden` (ADR 0010: agent không tạo tài liệu). Trong một tx: `LockDocumentTree(ws)` → đọc `(workspace_id, acl_owner_id, system_kind='my_folder')` → có thì trả về; chưa có thì chèn hàng §1, ghi audit + outbox, trả `created=true`. Chỉ mục duy nhất là lưới an toàn khi hai node đua nhau (lỗi unique → đọc lại và trả hàng đã có).
- **Route:** `POST /api/v1/workspaces/{workspaceID}/documents/my-folder` → 200 `DocumentSDO` (cả khi vừa tạo lẫn khi đã có; body rỗng; không cần `Idempotency-Key` vì tự idempotent). Client gọi khi mở mục sub-nav "Thư mục của tôi". **Không** tạo lười trong GET.
- **Audit/sự kiện:** dùng lại `document.created` (audit `Action` hiện có, metadata thêm `system_kind: "my_folder"`) và frame `document.created` ids-only như mọi lần tạo — không có sự kiện mới, không đụng ba catalogue. Thêm lệnh vào `audit_coverage_test.go` (`TestReusedAuditActionCommandsWriteTheirOwnRows`). Lần gọi không tạo: không audit, không outbox.
- **Thành viên rời/được thêm lại:** không hook mới. Hàng ở lại như mọi tài liệu restricted (chỉ admin qua `AdminScope`/break-glass); vào lại workspace → ensure tìm thấy đúng hàng cũ theo `(workspace_id, acl_owner_id)`.

## 3. Bảo vệ thư mục (chính hàng My Folder)

Mã lỗi mới `my_folder_locked` (409, `error_class: conflict`, thêm vào `mapServiceError` và quét lớp lỗi). Từ chối trên **chính** hàng My Folder:
- Vào thùng rác / archive (`archiveRootGate`), khôi phục không áp dụng.
- Đổi tên/biểu tượng (PATCH `title`/`icon`), đổi `visibility`, đổi mức hàng workspace (PATCH, share cho workspace của chính nó).
- Chia sẻ, liên kết công khai, chuyển chủ sở hữu, break-glass (Đã chốt 2026-10-16: break-glass trên chính hàng My Folder từ chối 409 `my_folder_locked` vì thư mục không có nội dung).
- Di chuyển chính nó (`document_tree.go` move), và đặt nó làm con của tài liệu khác.
Tài liệu **bên trong** My Folder: chia sẻ, đổi tên, di chuyển ra ngoài/vào trong, vào thùng rác như thường. Tạo con trong My Folder đi qua `lockPageParent` như mọi thư mục (cần quyền edit = chỉ chủ). Lưu trữ cả cây (archive thư mục cha) không áp dụng vì My Folder luôn ở gốc.

## 4. Đích mặc định khi tạo ở Documents Home

**Đã chốt 2026-10-16: client nói rõ đích (`destination: "my_folder"`), server không đổi nghĩa của "bỏ `parent_id`" (bỏ `parent_id` vẫn là tạo ở gốc).** Lý do: bỏ `parent_id` hôm nay nghĩa là tạo ở gốc với mọi client (MCP chỉ đọc, desktop FD-11, API, test); đổi ngầm sang My Folder làm vỡ các client đó và các test tạo ở gốc.

- Trường mới `destination` (chuỗi, tùy chọn) trên **cả ba** route tạo: `POST /workspaces/{ws}/documents` (JSON `CreateDocumentSDI`), `POST /workspaces/{ws}/documents/files` (multipart field), `POST /workspaces/{ws}/documents/files/blank` (JSON). Giá trị duy nhất: `"my_folder"`. Đi cùng `parent_id` → 400 `invalid_destination`; giá trị lạ → 400 `invalid_destination`.
- `destination:"my_folder"`: trong **cùng tx tạo**, ensure My Folder của người gọi (§2, không audit thêm nếu đã có), rồi tạo con dưới nó qua đường `lockPageParent` như một `parent_id` thường → kế thừa `restricted` (SH-S1). Trả `DocumentSDO` của tài liệu mới (có `parent_id` = id My Folder).
- Fingerprint idempotency của tạo trang/file thêm `destination` (một lần thử lại đúng khóa trả lại cùng tài liệu).
- Không `destination`, không `parent_id`: gốc như hiện nay (giữ cho API/desktop cũ). Web (SAVE-01): Home gửi `destination:"my_folder"` cho Mới / tải lên / thả file / file trắng khi không đứng trong thư mục; trong thư mục gửi `parent_id` như nay. Desktop: lần "Lưu lên UniWork" đầu cho tab chưa gắn gửi `destination:"my_folder"`; "Lưu bản sao" giữ chọn thư mục FD-11.
- Đổi tên lần lưu đầu là việc của client (PATCH `title`), server không đổi.

## 5. Hiển thị

- `system_kind` (`"my_folder"` | vắng) thêm vào `DocumentDTO`, nút cây (`DocumentTreeNodeDTO`), hàng danh sách; client: enum lỏng (`z.string()` → thu hẹp, `default` trong `switch`), nhãn i18n `documents.my_folder.title` (vi "Thư mục của tôi", en "My Folder", 21 locale do lane web), không hiển thị `title` lưu trữ.
- Cây/Home của chủ: My Folder hiện như thư mục gốc, xếp đầu (client sắp).
- **Admin (Đã chốt 2026-10-16; sửa bởi MF-V7 — UNI-1891, Advisor 2026-10-18):** theo quyết định 3 của Advisor, admin không thấy nội dung My Folder người khác ngoài phạm vi admin hiện có. Dưới `seeAll` (owner/admin workspace), My Folder của thành viên khác **và mọi hậu duệ** bị loại khỏi cây/danh sách/tìm kiếm/thùng rác/gần đây, báo cáo truy cập và snapshot change-feed (không liệt kê, không đếm, không `title`, không id); mở theo id giữ nguyên (403). My Folder của chính người gọi và một hậu duệ được chia sẻ rõ ràng cho người gọi không đổi.

## 6. SHAREDBYME-01 — "Tôi đã chia sẻ"

- Tham số mới trên route danh sách hiện có: `GET /api/v1/workspaces/{workspaceID}/documents?shared_by_me=true` (cùng phân trang/sắp xếp/`DocumentListItem` như danh sách phẳng; kết hợp `parent_id` → 400 `invalid_filter` — Đã chốt 2026-10-16).
- Lọc: `acl_owner_id = người gọi` VÀ `archived_at IS NULL` VÀ `owner_id IS NULL` VÀ `system_kind IS NULL` VÀ (có ít nhất một `document_shares` còn hiệu lực cho người/nhóm **hoặc** `visibility = 'workspace'`). Liên kết công khai **không** tính (Đã chốt 2026-10-16). Hàng workspace sau SH-S1 = `visibility='workspace'` ở bất kỳ mức nào.
- SQL: mệnh đề tenant `workspace_id = $n` (người gọi qua `RequireMember`), `TestEveryQueryNamesItsTenant`. Không thêm route → isolation: thêm biến thể truy vấn `shared_by_me=true` vào `isoRoutes` của route danh sách (B gọi với ws của A → 404, kiểm soát: chủ A thấy hàng của mình).
- Client: hàm endpoint + schema + case phản hồi hỏng trong `api/endpoints/documents-collections.test.ts`; hook `useSharedByMe(wsId)` với khóa `documentKeys` có `wsId`; sự kiện `document.shared` / `document.share_revoked` / `document.workspace_access_changed` đã làm mới gốc workspace nên không cần khóa realtime mới.

## 7. Nghiệm thu (test)

| Mã | Kiểm | Nơi |
|---|---|---|
| MF-1 | ensure lần đầu tạo đúng hàng §1, lần sau trả cùng id, không audit lần 2; hai lời gọi đồng thời → một hàng | service |
| MF-2 | agent → forbidden; người ngoài → 404; thành viên bị vô hiệu → 403 | service + handler |
| MF-3 | `destination:"my_folder"` trên ba route tạo → con của My Folder, `restricted`; cùng `parent_id` → 400; replay idempotency → cùng tài liệu | service + handler |
| MF-4 | mọi thao tác §3 trên My Folder → 409 `my_folder_locked`; tài liệu bên trong chia sẻ/di chuyển/vào thùng rác được | service |
| MF-5 | thư mục gốc tên "My Folder" của người dùng tạo được; hai thành viên mỗi người một My Folder | service + migration |
| MF-6 | `system_kind` trên DTO/cây/danh sách; client enum lỏng + malformed | handler + core |
| MF-7 | admin không thấy My Folder người khác trong cây/danh sách/tìm kiếm | service |
| MF-7b | dưới `seeAll`, My Folder người khác và mọi hậu duệ bị loại khỏi cây/danh sách/tìm kiếm/thùng rác/gần đây + báo cáo truy cập + snapshot change-feed (không id, không `title`); mở theo id → 403; My Folder của mình và hậu duệ được chia sẻ cho mình không đổi | service + handler |
| MF-8 | isolation: route ensure (B gọi ws của A → 404; chủ A → 200), `destination` không phải `_id` nên không cần `isoReferences` | handler |
| SB-1 | `shared_by_me` trả đúng tập (share người, share nhóm, workspace; không: chỉ link, archived, owned, My Folder, của người khác) | service |
| SB-2 | tenant + isolation biến thể truy vấn; client malformed | handler + core |

## 8. Ngoài phạm vi

Đổi tên lần lưu đầu (client), hộp thoại Lưu (SAVE-01), 21 locale (web), RESTORE-01/TRASH-NOTIFY-01/ARCHIVE-01, chuyển My Folder khi thành viên rời.

# Google Drive — Chia sẻ tham chiếu tệp Drive trong UniWork (Mức 1)

> **Trạng thái:** in-progress · **Issue:** UNI-2273 (con của UNI-923) · **Ngày:** 2026-10-28 · **Dựng trên:** spec Google Drive connector (2026-10-26), phụ lục Share SRS (2026-10-15), ADR 0047

## 1. Phạm vi và phi mục tiêu

- **Mục tiêu (Mức 1):** Cho phép chia sẻ **tham chiếu tệp Google Drive** (`drive_files`) ngay trong UniWork qua hộp thoại Chia sẻ dùng chung của Tài liệu — tới từng thành viên (`user`), nhóm/workspace khác hoặc toàn tổ chức (`workspace`, `organization`), và chính workspace chứa tệp (`workspace = drive_file.workspace_id`). Người nhận thấy tệp trong mục **Tài liệu › Google Drive**, thấy người đã chia sẻ, trạng thái quyền đọc trên Google Drive tính từ **kết nối của chính người nhận** (`has_access` / `no_access` / `unknown`), nút **Cho UniWork đọc tệp** (Picker) và liên kết **Mở / Xin quyền truy cập trên Google Drive**.
- **Phi mục tiêu (Mức 1):**
  - **Không ghi quyền lên Google Drive:** Server không bao giờ gọi `permissions.create` hay sửa ACL trên Google Drive thay ai.
  - **Không sao chép byte tệp vào UniWork:** Tệp Drive vẫn chỉ là dòng tham chiếu ở bảng `drive_*` (ADR 0047 Quyết định 1).
  - **Không bao giờ đọc nội dung qua kết nối của người khác:** Mọi lượt đọc nội dung cho AI (`drive_content.ReadForAI`) chỉ dùng dòng `drive_file_access` của chính người yêu cầu (ADR 0047 Quyết định 2).
  - **Không có liên kết công khai (`document_share_links`) hay break-glass (`document_break_glass_grants`) cho tham chiếu Drive:** Liên kết chia sẻ ra ngoài và quyền truy cập nội dung thuộc về Google Drive.
- **Mức 2:** Việc tùy chọn cấp quyền trên Google Drive bằng `permissions.create` dưới scope `drive.file` được khảo sát riêng ở spike **UNI-2274**; không thiết kế trong spec này.

## 2. Mô hình quyền chia sẻ tham chiếu và trải nghiệm người nhận

### 2.1 Ai được chia sẻ, cho ai, ở mức nào, ai được thu hồi

| Câu hỏi | Quy tắc ở Mức 1 |
| --- | --- |
| **Ai được chia sẻ / quản lý chia sẻ (`can_share`)** | Người liên kết ban đầu (`created_by`), người đang giữ kết nối gắn (`bound_by`), hoặc `owner`/`admin` hiệu lực của workspace (gồm cả `owner`/`admin` tổ chức qua `WorkspaceService.RequireMember`) — khớp hàm `canManageDriveFile` (`server/internal/service/drive_files.go:421`) đang quyết định `can_unlink` và `can_rebind`. |
| **Chia sẻ cho ai (`principal_type`)** | Ba loại đối tượng khớp hoàn toàn với hộp thoại Chia sẻ của Tài liệu (`document_shares`):<br>1. `user` — thành viên đang hoạt động của tổ chức (`organization_members.deactivated_at IS NULL`).<br>2. `workspace` — workspace bất kỳ trong cùng tổ chức (`workspaces.organization_id = orgID`); khi `principal_id = drive_file.workspace_id` thì hiển thị như dòng **Workspace "{{name}}" · Nơi lưu**.<br>3. `organization` — toàn bộ tổ chức (`principal_id = drive_file.organization_id`). |
| **Mức quyền (`level`)** | Chỉ một mức **`view`** (*Chỉ xem tham chiếu*); `level: null` trong `PUT` để thu hồi. Không có `comment`/`edit`/`manage` vì nội dung và quyền sửa nằm trên Google Drive. |
| **Ai được thu hồi (unshare)** | 1. Người có `can_share` thu hồi bất kỳ dòng `drive_file_shares` nào của tệp (qua `PUT …/shares` với `level: null` hoặc `DELETE …/shares/{shareID}`).<br>2. Chính người nhận của một dòng `principal_type = 'user'` (`principal_id = actor.ID`) được tự gỡ dòng chia sẻ trực tiếp của mình qua `DELETE …/shares/{shareID}` ("Bỏ khỏi danh sách được chia sẻ").<br>3. Khi tệp bị bỏ liên kết khỏi workspace (`DELETE …/drive-files/{driveFileID}`), mọi dòng `drive_file_shares` sống của tệp được thu hồi trong cùng transaction. |
| **Người xem không có `can_share`** | Mở được hộp thoại Chia sẻ ở chế độ chỉ đọc (như U-SH4 của Tài liệu): chỉ thấy nguồn chia sẻ của chính mình (`my_sources`: Trực tiếp / Qua Workspace / Qua Tổ chức / Do bạn liên kết), không thấy danh sách người nhận khác. |

### 2.2 Người nhận thấy gì

Khi một thành viên được chia sẻ tham chiếu tệp Drive (trực tiếp, qua workspace hoặc qua tổ chức), họ thấy tệp trong **Tài liệu › Google Drive** và mở được trang chi tiết 4.2 (`/{org}/{ws}/documents/drive/{driveFileID}`):

1. **Metadata tham chiếu:** Tên tệp (`name`), loại và biểu tượng (`mime_type`, `icon_kind`), người sửa lần cuối trên Drive (`drive_modified_by_display`, `drive_modified_at`), chủ sở hữu trên Drive (`owner_display`), người liên kết (`created_by_name`), và **người đã chia sẻ trong UniWork** (`shared_by_name`, `shared_at`).
2. **Trạng thái quyền đọc Google của chính người xem (`viewer_access`)** — chỉ tính từ kết nối của chính người xem:
   - `has_access` (wire `viewer_access = "granted"`): người xem có dòng `drive_file_access.state = 'granted'` trên một kết nối `drive_connections` đang hoạt động của chính họ. Hiện *"Bạn mở bằng: `<viewer_account_email>`"*; bật **Tạo việc từ tài liệu** và **Hỏi UNI**.
   - `unknown` (wire `viewer_access = "unknown"`): người xem chưa có dòng `drive_file_access` cho tệp này (kể cả khi người xem chưa kết nối Google Drive lần nào hoặc đã kết nối nhưng chưa chọn tệp qua Picker). Hiện khối hướng dẫn + nút **Cho UniWork đọc tệp** (mở Google Picker `setFileIds`) + liên kết **Mở / Xin quyền truy cập trên Google Drive**.
   - `no_access` (wire `viewer_access = "lost"` hoặc `"connection_lost"`, hoặc sau khi Picker / `POST …/access` báo `drive_file_not_accessible`): kết nối đã từng cấp của người xem không còn đọc được tệp trên Google Drive (404 `notFound` / 403 `insufficientFilePermissions`) hoặc kết nối bị ngắt/hết hạn. Hiện cảnh báo rõ lý do + nút **Cho UniWork đọc tệp** / **Kết nối lại** + liên kết **Xin quyền truy cập trên Google Drive**.
3. **Liên kết mở tệp / xin quyền truy cập trên Google Drive (`open_url`):**
   - **URL chính xác:** Dựng bởi `BuildDriveOpenURL(webViewLink, externalFileID, viewerEmail)` (`server/internal/service/drive_files_views.go:21`): lấy `drive_files.web_view_link` đã chuẩn hóa (hoặc fallback `https://drive.google.com/open?id=<external_file_id>`), gắn `?authuser=<viewer_account_email>` **chỉ khi** người xem có dòng `drive_file_access` mang email của chính họ; khi `viewer_access = "unknown"` thì giữ nguyên URL gốc không có `authuser` (không bao giờ gắn `bound_account_email` của người chia sẻ vào `open_url` của người nhận).
   - **Vì sao an toàn:**
     1. Host được kiểm chặt trong tập trắng `docs.google.com` và `drive.google.com` với giao thức `https://`, không userinfo, không cổng lạ (cả lúc lưu metadata lẫn ở IPC `openOnGoogle` của desktop), chặn tuyệt đối `javascript:`, `data:` và open redirect.
     2. Mở trực tiếp ở tab trình duyệt mới (`target="_blank" rel="noopener noreferrer"`, hoặc `shell.openExternal` trên desktop), không đi qua bất kỳ route redirect nào của server (`TestOnlyBrowserFlowsRedirect`) và không đính kèm JWT UniWork hay OAuth token trong URL.
     3. Nếu tài khoản Google đang đăng nhập trên trình duyệt của người nhận chưa có quyền trên Google Drive, chính trang chuẩn của Google Drive hiển thị màn hình *"You need access / Request access"* để người nhận gửi yêu cầu thẳng trên Google cho chủ tệp — UniWork không giữ vai trò trung gian cấp quyền.

## 3. Mô hình dữ liệu và dọn dẹp vòng đời

### 3.1 Bảng mới `drive_file_shares`

Migration `999<unix-ms>_drive_file_shares.up.sql` (kèm `.down.sql` `DROP TABLE IF EXISTS drive_file_shares;`):

```sql
CREATE TABLE drive_file_shares (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  drive_file_id    TEXT NOT NULL,
  principal_type   TEXT NOT NULL,
  principal_id     TEXT NOT NULL,
  level            TEXT NOT NULL DEFAULT 'view',
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL DEFAULT 'human',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  revoked_by_kind  TEXT,

  CONSTRAINT drive_file_shares_ids_nonempty
    CHECK (
      id <> ''
      AND organization_id <> ''
      AND workspace_id <> ''
      AND drive_file_id <> ''
      AND principal_id <> ''
      AND created_by <> ''
    ),
  CONSTRAINT drive_file_shares_principal_type_check
    CHECK (principal_type IN ('user', 'workspace', 'organization')),
  CONSTRAINT drive_file_shares_level_check
    CHECK (level IN ('view')),
  CONSTRAINT drive_file_shares_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT drive_file_shares_revoked_by_kind_check
    CHECK (revoked_by_kind IS NULL OR revoked_by_kind IN ('human', 'agent', 'system'))
);
```

- Không `FOREIGN KEY` / `REFERENCES` (ADR 0001, `TestNewMigrationsHaveNoForeignKeys`).
- Có `organization_id TEXT NOT NULL` (ADR 0008, `TestNewTablesCarryOrganizationID`) và cặp `created_by` + `created_by_kind` (ADR 0007, `TestActorKindOnEveryCreatedBy`).
- Không có cột object storage (`TestDriveTablesCarryNoObjectStorageColumns`).
- Thêm `"drive_file_shares"` vào `tenantExportIncludedTables` (`server/internal/service/tenant_export_tables.go`) để gói xuất dữ liệu tổ chức và job xóa tổ chức (`tenantDeleteTables`) tự động bao gồm bảng này.

### 3.2 Các index (mỗi index một file migration `CONCURRENTLY` riêng)

1. `999<ms+1>_drive_file_shares_live_uidx`:
   `CREATE UNIQUE INDEX CONCURRENTLY idx_drive_file_shares_live_uidx ON drive_file_shares (drive_file_id, principal_type, principal_id) WHERE revoked_at IS NULL;` — tối đa một dòng chia sẻ đang sống cho mỗi `(drive_file_id, principal_type, principal_id)`.
2. `999<ms+2>_drive_file_shares_file_live_idx`:
   `CREATE INDEX CONCURRENTLY idx_drive_file_shares_file_live_idx ON drive_file_shares (organization_id, workspace_id, drive_file_id, created_at ASC, id ASC) WHERE revoked_at IS NULL;` — đọc danh sách quyền của một tệp (`GET …/shares`) và đếm số đối tượng được chia sẻ.
3. `999<ms+3>_drive_file_shares_recipient_live_idx`:
   `CREATE INDEX CONCURRENTLY idx_drive_file_shares_recipient_live_idx ON drive_file_shares (organization_id, workspace_id, principal_type, principal_id, created_at DESC, drive_file_id) WHERE revoked_at IS NULL;` — lọc danh sách tệp được chia sẻ với người xem trong workspace (`GET /workspaces/{workspaceID}/drive-files`).

### 3.3 Dọn dẹp trong code service (không có FK cascade)

- **Khi bỏ liên kết tham chiếu (`DriveFileService.Unlink`):** Trong cùng transaction đang khóa `drive_files FOR UPDATE`, gọi `RevokeDriveFileSharesByFile` đặt `revoked_at = now(), revoked_by = actor.ID, revoked_by_kind = actor.Kind` cho mọi dòng sống của `drive_file_id`.
- **Khi thành viên rời tổ chức (`OrganizationMemberService.Leave`) hoặc bị xóa khỏi workspace (`WorkspaceService.RemoveMember`) hay xóa tài khoản:**
  - Với dòng `principal_type = 'user'`: thu hồi mềm (`revoked_at = now(), revoked_by = targetUserID, revoked_by_kind = 'system'`) các dòng `drive_file_shares` sống của `user_id` trong tổ chức (khi rời tổ chức / xóa tài khoản) hoặc trong workspace đó (khi bị gỡ khỏi workspace, trừ khi người đó là `owner`/`admin` tổ chức vẫn giữ quyền thành viên ngầm).
  - Với thành viên bị vô hiệu hóa (`organization_members.deactivated_at IS NOT NULL`, F-03): giữ nguyên dòng (cổng `RequireMember` đã chặn; khi kích hoạt lại thì khôi phục nguyên trạng).
  - Với dòng nhóm (`workspace`, `organization`): đánh giá tư cách thành viên hiệu lực **lúc đọc** qua `WorkspaceService.RequireMember` / danh sách workspace hiệu lực của người gọi (như BR-05/06 của `document_shares`), nên người rời nhóm tự động mất quyền nhìn thấy ngay lập tức.

## 4. Hợp đồng API (Routes, SDI/SDO, Cổng quyền, 403/404)

Mọi route đăng ký trong `server/internal/handler/router/drive_connections.go` dưới nhóm `d := r.With(mw.RequireFeatureFlag(flags, "drive_connector"))`, qua wrapper `api` (`apiOp{sdi, sdo, auth: true}`) và `decode(w, r, &in, maxJSONBody)`.

### 4.1 Cổng hiển thị tham chiếu (`requireVisibleDriveFile` mở rộng)

Một thành viên workspace (`WorkspaceService.RequireMember(ctx, workspaceID, actor.ID)`) được phép thấy `drive_files` `f` (còn sống, `unlinked_at IS NULL`) khi thỏa **ít nhất một** trong ba điều kiện:
1. Có dòng trong `drive_file_access` cho `(f.id, actor.ID)` (bất kể `state`).
2. Có dòng sống trong `drive_file_shares` (`revoked_at IS NULL`) khớp với người gọi:
   - `principal_type = 'user' AND principal_id = actor.ID`, hoặc
   - `principal_type = 'organization' AND principal_id = ws.OrganizationID`, hoặc
   - `principal_type = 'workspace'` và `principal_id` thuộc tập workspace trong tổ chức mà `actor.ID` là thành viên hiệu lực (lấy qua query thành viên hoặc `member.Role` cho chính `ws.ID`).
3. Xem được ít nhất một công việc chưa xóa đang gắn tệp qua `drive_file_task_links` (`loadVisibleTasksByFileIDs`).

Không thỏa cả ba → trả **`ErrNotFound` (404)** đồng nhất như khi `driveFileID` không tồn tại. Kiểm tra `canManageDriveFile` chạy **sau** cổng hiển thị này: người xem thấy tệp (qua điều kiện 1/2/3) nhưng không có `canManageDriveFile` gọi lệnh ghi chia sẻ → nhận **`ErrForbidden` (403)**; người không thấy tệp gọi bất kỳ route nào của tệp → nhận **`404`** (không lộ tệp có tồn tại hay không).

### 4.2 Các route mới và mở rộng

1. **`GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/shares`**
   - Cổng: `RequireMember` + `requireVisibleDriveFile` (sai → 404).
   - SDO `DriveFileSharesSDO`:
     - `can_manage bool`: kết quả `canManageDriveFile(actor.ID, member, fileRow)`.
     - `home_workspace *DriveFileHomeWorkspaceShareDTO`: `{workspace_id, workspace_name, shared bool, share_id?, granted_by?, granted_at?}` (dòng `principal_type = 'workspace' AND principal_id = ws.ID`).
     - `shares []DriveFileShareDTO`: `{id, principal_type, principal_id, principal_name, principal_subtitle, level: "view", created_by, created_by_kind, created_by_name, created_at}` — chỉ trả khi `can_manage = true`; khi `can_manage = false` trả mảng rỗng `[]` (không lộ danh sách người nhận cho người chỉ xem, khớp U-SH4).
     - `my_sources []DriveFileAccessSourceDTO`: `{via: "linked_by|direct|workspace|organization|task", label, share_id?}` — nguồn để người đang xem thấy tệp (kể cả `share_id` của dòng trực tiếp để người nhận tự gỡ).
2. **`GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/share-candidates?q=&cursor=&limit=`**
   - Cổng: `RequireMember` + `requireVisibleDriveFile` (sai → 404) + `canManageDriveFile` (sai → 403).
   - SDI `ListDriveFileShareCandidatesSDI{ Q, Cursor, Limit }` (mặc định 20, tối đa 50).
   - SDO `DriveFileShareCandidatesSDO{ items: []DocumentShareCandidateDTO, next_cursor *string }` — tái dùng cấu trúc ứng viên của Tài liệu (`user` hoạt động trong tổ chức, `workspace` cùng tổ chức, và `organization`), với `direct_level` = `"view"` nếu đã có dòng sống trong `drive_file_shares`, ngược lại `""`.
3. **`PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/shares`** (chia sẻ / thu hồi theo lô, tất cả hoặc không)
   - Cổng: `RequireMember` + `requireVisibleDriveFile` (sai → 404) + `canManageDriveFile` (sai → 403). Khóa dòng `GetActiveDriveFileByIDForUpdate`.
   - SDI `UpdateDriveFileSharesSDI`:
     - `items []DriveFileShareBatchItemSDI` (1..100): `{principal_type: "user|workspace|organization", principal_id: string, level: *string ("view" hoặc null để thu hồi), on_existing: *string ("update"|"keep")}`.
     - `dry_run bool`.
   - Kiểm tra toàn bộ `items` trước khi ghi:
     - `level` khác `"view"` và khác `null` → lỗi mục `level_not_allowed`.
     - Trùng `(principal_type, principal_id)` trong cùng lô → lỗi mục `duplicate_principal`.
     - Đối tượng không thuộc tổ chức `ws.OrganizationID` (hoặc `user` đã `deactivated_at IS NOT NULL`) → lỗi mục `principal_not_in_organization`.
     - Có bất kỳ mục lỗi nào → trả **422 `drive_file_share_rejected`** kèm `fields.rejected = [{index, principal_type, principal_id, code}]`, không ghi dòng nào (U-SH3).
   - Với `dry_run = true`: không ghi DB, không ghi audit/outbox; trả 200 kèm `preview: {groups: [{principal_type, principal_id, member_count}], warnings: [{index, code: "wide_scope"}]}` (cảnh báo `wide_scope` khi chia sẻ cho `workspace` hoặc `organization`).
   - Với `dry_run = false`: sinh `batch_id = util.NewID()`, chèn/thu hồi các dòng `drive_file_shares` trong một transaction, ghi audit + outbox cho từng thay đổi thực sự (`status: "granted" | "revoked" | "kept" | "unchanged"`).
   - SDO `UpdateDriveFileSharesSDO{ batch_id string, results: []DriveFileShareItemResultDTO, preview: DriveFileSharePreviewDTO }`.
4. **`DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/shares/{shareID}`**
   - Cổng: `RequireMember` + `requireVisibleDriveFile` (sai → 404); tìm dòng `drive_file_shares` sống theo `(ws.OrganizationID, ws.ID, driveFileID, shareID)` (không có → 404). Cho phép khi `canManageDriveFile` **hoặc** (`share.PrincipalType == "user" && share.PrincipalID == actor.ID`); ngược lại → 403.
   - SDO: `sdo.StatusSDO{Status: "ok"}`.
   - `pathParamSDI` (`server/internal/handler/router/openapi.go`): thêm case `"workspaceID,driveFileID,shareID"` với `WorkspaceID`, `DriveFileID`, `ShareID` (mô tả + example ULID).
5. **Mở rộng `GET /api/v1/workspaces/{workspaceID}/drive-files` và `DriveFileDTO`:**
   - `ListDriveFilesSDI` thêm query `scope string` (`"all"` mặc định khi không lọc `connection_id` | `"mine"` chỉ dòng có `drive_file_access` | `"shared"` chỉ dòng có `drive_file_shares` sống khớp người gọi; khi truyền `connection_id` thì luôn lọc trên `drive_file_access.connection_id` của kết nối đó).
   - `DriveFileDTO` (`server/internal/handler/dto/sdo/drive.go`) thêm:
     - `can_share bool` (`canManageDriveFile`)
     - `uniwork_share_scope string` (`"private"` | `"workspace"` | `"organization"` | `"restricted"`)
     - `uniwork_shared_count int` (tổng số dòng `drive_file_shares` sống của tệp)
     - `shared_by_id *string`, `shared_by_name *string`, `shared_at *string` (người và thời điểm chia sẻ gần nhất tới người xem).

## 5. Cách tính trạng thái quyền đọc (`viewer_access`) của người nhận

1. **Nguồn dữ liệu duy nhất:** `LEFT JOIN drive_file_access va ON va.drive_file_id = f.id AND va.organization_id = f.organization_id AND va.workspace_id = f.workspace_id AND va.user_id = viewer_user_id` nối với `LEFT JOIN drive_connections vc ON vc.id = va.connection_id AND vc.organization_id = f.organization_id AND vc.user_id = va.user_id`.
2. **Không bao giờ dùng kết nối của người chia sẻ hay dò ngầm tài khoản khác:**
   - Nếu `va.id IS NULL`: trả ngay `viewer_access = "unknown"` (trạng thái UI `unknown`), `viewer_connection_id = null`, `viewer_account_email = ""`, `open_url = BuildDriveOpenURL(f.web_view_link, f.external_file_id, "")`. **Không gọi Google Drive API** khi `va.id IS NULL`, kể cả khi người nhận có kết nối Google khác trong `drive_connections` (vì dưới scope `drive.file`, token chưa qua Picker cho tệp đó luôn bị Google từ chối `404/403`, và ADR 0047 cấm lặng lẽ thử tài khoản khác).
   - Nếu `va.state = 'granted'` và `vc` đang hoạt động (`disconnected_at IS NULL AND auth_failed_at IS NULL`): trả `viewer_access = "granted"` (trạng thái UI `has_access`), `viewer_account_email = vc.google_email`.
   - Nếu `va.state = 'lost'`: trả `viewer_access = "lost"` (trạng thái UI `no_access`).
   - Nếu `va.state = 'granted'` nhưng `vc` đã ngắt hoặc `auth_failed_at IS NOT NULL`: trả `viewer_access = "connection_lost"` (trạng thái UI `no_access` / cần kết nối lại).
3. **Khi nào kiểm tra với Google, bộ đệm (caching) và hạn mức (rate limits):**
   - Lệnh chia sẻ `PUT …/shares` chỉ ghi bảng `drive_file_shares` trong Postgres (0 lời gọi Google API).
   - Khi mở danh sách 4.1 hoặc chi tiết 4.2: chỉ các dòng mà chính người xem đã có `viewer_access = "granted"` và `metadata_refreshed_at` quá **10 phút** (`driveMetadataRefreshInterval`) mới chạy làm mới cơ hội qua `ClaimDriveFileMetadataRefresh` bằng **kết nối `va.connection_id` của chính người xem**. Nếu Google trả `notFound` / `insufficientFilePermissions` / `forbidden`, `maybeRecordAccessLost` chuyển dòng `drive_file_access` của người xem sang `'lost'`.
   - Khi người nhận ở trạng thái `unknown` hoặc `lost` bấm **Cho UniWork đọc tệp**: trình duyệt mở Google Picker với `setFileIds([external_file_id])` bằng token ngắn hạn từ `POST …/picker-token` của kết nối người nhận chọn, sau đó gọi `POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access {connection_id}`. Lúc này server gọi `files.get` đúng 1 lần bằng kết nối của người nhận: thành công → `UpsertDriveFileAccessGranted` (`viewer_access = "granted"`); Google báo không có quyền → trả `404 drive_file_not_accessible` và UI hiện thông báo `no_access` kèm liên kết **Xin quyền truy cập trên Google Drive**.

## 6. Audit và sự kiện Outbox

| Action (`server/internal/audit/actions.go`) | Resource | Khi nào ghi | Metadata bắt buộc | Outbox event (ids-only) |
| --- | --- | --- | --- | --- |
| `drive_file.shared` (`ActionDriveFileShared`) | `drive_file` (`driveFileID`) | Chèn mới một dòng `drive_file_shares` trong `PUT …/shares` | `share_id`, `principal_type`, `principal_id`, `level` (`"view"`), `batch_id`, `external_file_id`, `drive_file_name` | `drive_file.shared` v1 `{drive_file_id, workspace_id, share_id}` (`ScopeWorkspace`) |
| `drive_file.unshared` (`ActionDriveFileUnshared`) | `drive_file` (`driveFileID`) | Thu hồi một dòng `drive_file_shares` qua `PUT …/shares` (`level: null`) hoặc `DELETE …/shares/{shareID}` | `share_id`, `principal_type`, `principal_id`, `prev_level` (`"view"`), `batch_id` (nếu từ `PUT`), `external_file_id`, `drive_file_name` | `drive_file.unshared` v1 `{drive_file_id, workspace_id, share_id}` (`ScopeWorkspace`) |

- Ghi trong cùng transaction với thay đổi qua `audit.Recorder.Record(ctx, qtx, ...)` (ADR 0009, ADR 0012).
- Thêm cả hai topic `drive_file.shared` và `drive_file.unshared` (payload `["drive_file_id", "share_id", "workspace_id"]`, không có `Patch`) vào cả ba bản catalogue: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts` (`scripts/events-catalogue.test.mjs`).
- Thêm cả hai action vào `server/internal/service/audit_coverage_test.go` (`TestEveryAuditedCommandWritesItsRow`).
- Lịch sử hoạt động của tệp (`GET /workspaces/{ws}/resources/drive_file/{id}/history`): `AuthorizeDriveFileHistory` dùng chung cổng hiển thị §4.1, nên người nhận được chia sẻ xem được lịch sử hoạt động của tệp; người không có quyền nhận 404 trước khi đọc `audit_events`.

## 7. Ma trận cách ly tenant (`TestIsolationMatrix`)

1. **Seed (`server/internal/handler/isolation_world_test.go`):**
   - Khi dựng tenant `tn`, chèn 1 dòng `drive_file_shares` sống (`tn.ids["driveFileShare"]`) cho `tn.ids["driveFile"]` (chia sẻ cho `tn.peerID`) và 1 dòng `tn.ids["driveFileShareDelete"]` để bảng `drive_file_shares` luôn có dữ liệu của tổ chức A trong mọi lượt kiểm tra hash trước/sau.
2. **Tham số đường dẫn & `isoRoutes` (`isolation_matrix_test.go`, `isolation_routes_test.go`):**
   - Trong `isolation_matrix_test.go`: ở `switch param` cho `"{shareID}"`, nếu đường dẫn chứa `"/drive-files/"` thì trả `tn.get(t, "driveFileShare")` (còn dưới `"/documents/"` giữ `tn.get(t, "documentShare")`).
   - Bốn route mới đều nằm dưới `/api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/…` nên tự động thuộc lớp `isoScoped`.
   - Trong `isolation_routes_test.go`:
     - `PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/shares`: cấu hình body control hợp lệ `{items: [{principal_type: "user", principal_id: tn.ids["outsider"], level: "view"}]}`.
     - `DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/shares/{shareID}`: thêm vào `isoDestructiveLast` (hoặc trỏ `{shareID}` tới `driveFileShareDelete`) để `GET …/shares` chạy trước khi dòng bị thu hồi.
3. **`isoReferences` (`server/internal/handler/isolation_references_test.go`):**
   - Trường `DriveFileShareBatchItemSDI.principal_id` kết thúc bằng `_id` nên bắt buộc có case trong `isoReferences` (`TestEveryBodyIDFieldHasAReferenceCase`):
     - Case 1 (`what: "share user"`): `PUT …/drive-files/{driveFileID}/shares` với `principal_type: "user"`, `principal_id: isoRef("peer")` (`wantAttackStatus: 422`).
     - Case 2 (`what: "share workspace"`): `PUT …/drive-files/{driveFileID}/shares` với `principal_type: "workspace"`, `principal_id: isoRef("workspace")` (`wantAttackStatus: 422`).
     - Case 3 (`what: "share organization"`): `PUT …/drive-files/{driveFileID}/shares` với `principal_type: "organization"`, `principal_id: isoRef("organization")` (`wantAttackStatus: 422`).
   - Cả 3 case đều phải bị từ chối ở cả lượt cross-tenant lẫn lượt **member-of-both** (chủ của B đồng thời là thành viên của A không thể gắn workspace A, tổ chức A hay thành viên chỉ thuộc A vào tệp Drive của B).

## 8. Giao diện Web (`packages/core`, `packages/views`)

1. **Tái sử dụng hộp thoại Chia sẻ (`packages/views/documents/drive/drive-share-dialog.tsx`):**
   - Không viết hộp thoại tìm kiếm/chọn đối tượng thứ hai. Dựng `DriveShareDialog` tái sử dụng `ShareCandidatePicker`, danh sách chip, hộp xác nhận `dry_run` (`warningSentence`) và các hàng hiển thị đối tượng (`ShareAccessRows`) từ `packages/views/documents/share-*.tsx`:
     - Khóa mức chọn ở `Chỉ xem` (`view`), ẩn bảng "Thiết lập quyền riêng" nhiều mức, ẩn Khu vực 3 (`ShareLinksSection`), `ShareDialogBreakGlassSection` và `AccessRequestsSection`.
     - Dưới tiêu đề hộp thoại hiển thị câu giải thích cố định: *"Chia sẻ trong UniWork giúp đồng nghiệp thấy liên kết tệp này. Quyền xem và sửa nội dung vẫn do Google Drive kiểm soát."*
   - Lối mở: nút **Chia sẻ** trên thanh tiêu đề trang chi tiết 4.2 (`DriveFileDetailView`) và trong menu hành động dòng của bảng 4.1 (`DriveLibraryTable`).
2. **Nơi hiển thị các tham chiếu được chia sẻ:**
   - **Sidebar Tài liệu › Google Drive (`DriveSidebarSection`):** Hiện mục **Google Drive** khi `driveAvailable` và người xem có ≥ 1 kết nối **hoặc** `total_count > 0` từ `GET /workspaces/{ws}/drive-files` (nhờ vậy người chưa kết nối Google Drive nhưng được đồng nghiệp chia sẻ tệp vẫn thấy mục **Google Drive** ở sidebar).
   - **Màn danh sách 4.1 (`DriveLibraryListView` ở chế độ Tất cả tài khoản `?view=drive`):**
     - Thêm thanh lọc phạm vi (segmented pills): **Tất cả** (`scope=all`, mặc định) · **Của tôi** (`scope=mine`) · **Được chia sẻ với tôi** (`scope=shared`, đồng bộ URL `?view=drive&scope=shared`).
     - Trên bảng `DriveLibraryTable`: dòng tệp được chia sẻ hiện phụ đề *"Do {{name}} chia sẻ"* dưới tên tệp; cột **Mở bằng tài khoản** hiện email kết nối của người xem (khi `granted`) hoặc nhãn *"Chưa cấp quyền đọc"* kèm liên kết mở nhanh; cột **Quyền truy cập** hiện cả huy hiệu phạm vi UniWork (`Riêng tư` / `Workspace` / `Tổ chức` / `Đã chia sẻ`).
   - **Trang chi tiết 4.2 (`DriveFileDetailView` & `DriveViewerAccessBlock`):**
     - Khi `viewer_access` là `unknown` hoặc `lost`: khối `DriveViewerAccessBlock` hiện rõ trạng thái của người xem, nút chính **Cho UniWork đọc tệp** (mở Picker `setFileIds`, hoặc mở bước kết nối OAuth tại chỗ nếu chưa có kết nối) và nút phụ **Xin quyền truy cập trên Google Drive** (`open_url`, mở tab mới).
3. **Realtime & Query keys (`packages/core/drive-library/keys.ts`, `packages/core/realtime/drive-events.ts`):**
   - Thêm `driveLibraryKeys.shares(wsId, driveFileId)` và `driveLibraryKeys.shareCandidates(wsId, driveFileId, q)` dưới tiền tố `driveKeys.workspace(wsId)`.
   - `driveFrameKeys` đã bắt mọi sự kiện `type.startsWith("drive_file.")` → cả `drive_file.shared` và `drive_file.unshared` tự động làm mới danh sách 4.1, chi tiết 4.2 và hộp thoại Chia sẻ đang mở.
4. **Chuỗi i18n (`packages/core/i18n/locales/vi.json`, `en.json`):**
   - Thêm khóa dưới `driveLibrary.share.*` (`title`, `explainer`, `scope_all`, `scope_mine`, `scope_shared`, `shared_by`, `empty_shared_title`, `empty_shared_description`, `request_google_access`, `remove_my_share`) và `audit.actions.drive_file.shared` / `unshared`.

## 9. Tương đương trên ứng dụng Desktop (`uniwork-office`)

Các file cần cập nhật trên fork `/home/ubuntu/projects/uniwork-office`:

1. **Hợp đồng IPC & Main client:**
   - `apps/shell/src/shared/uniwork-drive-api.ts`: thêm trường `canShare`, `uniworkShareScope`, `uniworkSharedCount`, `sharedById`, `sharedByName`, `sharedAt` vào `DriveFile`; thêm `scope?: 'all' | 'mine' | 'shared'` vào `DriveFileListQuery`; thêm 4 kênh IPC `getShares`, `listShareCandidates`, `updateShares`, `revokeShare`.
   - `apps/shell/src/main/uniwork-drive/client.ts`, `parse.ts`, `wiring.ts` và `apps/shell/src/preload/index.ts`: nối 4 lệnh mới tới các route `/workspaces/{ws}/drive-files/{id}/shares*` qua `createUniworkSend` (không nhận token Google).
2. **Renderer (`DriveList.tsx`, `DrivePanel.tsx`, `uniwork-share/`):**
   - `apps/shell/src/renderer/src/uniwork-home/DriveList.tsx`: thêm bộ lọc `Tất cả` / `Của tôi` / `Được chia sẻ với tôi` khi xem nút Google Drive gốc; hiển thị dòng phụ *"Do {name} chia sẻ"* và huy hiệu phạm vi chia sẻ UniWork. (Hook `useDocumentsHomeDrive` đã probe `listFiles(limit: 1)` khi `connections.length === 0`, nên người nhận chưa kết nối Google tự động thấy mục Google Drive khi có tệp được chia sẻ.)
   - `apps/shell/src/renderer/src/uniwork-home/DrivePanel.tsx`: thêm nút **Chia sẻ** mở hộp thoại chia sẻ tham chiếu Drive (tái sử dụng `ShareCandidatePicker`, `ShareAddSection`, `ShareAccessList` trong `apps/shell/src/renderer/src/uniwork-share/` với chế độ `drive_file` chỉ mức `view`, ẩn phần link công khai / break-glass / access requests); ở khối `data-drive-viewer` khi `unknown` hoặc `lost`, thêm nút **Xin quyền truy cập trên Google Drive** gọi `onOpenOnGoogle(file.id)` cạnh nút **Cho UniWork đọc tệp** (chuyển sang web).
   - `apps/shell/src/renderer/src/i18n/uniwork-home/*.ts`: thêm khóa `uhDriveScopeAll`, `uhDriveScopeMine`, `uhDriveScopeShared`, `uhDriveSharedBy`, `uhDriveShareBtn`, `uhDriveShareExplainer`, `uhDriveRequestGoogleAccess` đủ 21 ngôn ngữ (`tests/i18n-key-parity.test.ts`).

## 10. Kiểm thử giữ luật và chia việc cho các worker song song

### 10.1 Tên test giữ luật

- **Migration & Schema (`server/migrations/`):** `TestNewMigrationsHaveNoForeignKeys`, `TestNewMigrationsCreateIndexesConcurrently`, `TestNewTablesCarryOrganizationID`, `TestActorKindOnEveryCreatedBy`, `TestDriveTablesCarryNoObjectStorageColumns`, `TestEveryQueryNamesItsTenant`, `TestTenantExportClassifiesEveryTenantTable`.
- **Service (`server/internal/service/drive_files_share_test.go`):**
  - `TestDriveFileShareGrantAndRevokeToUserWorkspaceAndOrganization`
  - `TestDriveFileShareRecipientSeesOwnViewerAccessNeverSharersConnection`
  - `TestDriveFileShareUnknownViewerTriggersZeroGoogleAPICalls`
  - `TestDriveFileShareRejectedBatchRollsBackAllItems`
  - `TestDriveFileShareNonManagerSeesOnlyOwnSourcesAndCanRemoveSelf`
  - `TestDriveFileUnlinkAndMemberLeaveRevokeLiveShares`
- **Handler, Isolation & Audit (`server/internal/handler/drive_files_test.go`, `isolation_*_test.go`, `audit_coverage_test.go`):**
  - `TestDriveFileSharesHTTPLifecycleAndPrivacy` (404 khi không thấy tệp, 403 khi không `can_share`, 200 `shares: []` cho người nhận không quản lý, `open_url` của người nhận `unknown` không chứa `bound_account_email`).
  - `TestIsolationMatrix` + `TestEveryBodyIDFieldHasAReferenceCase` (3 case `isoReferences` cho `user`, `workspace`, `organization`).
  - `TestEveryAuditedCommandWritesItsRow` (`drive_file.shared`, `drive_file.unshared`) + `scripts/events-catalogue.test.mjs`.
- **Web & Desktop:**
  - `packages/core/api/endpoints/drive-library.test.ts` (malformed response cho 4 endpoint mới).
  - `packages/views/documents/drive/drive-share-dialog.test.tsx`, `drive-library-list-view.test.tsx`, `drive-file-detail-view.test.tsx`.
  - Fork `uniwork-office`: `apps/shell/tests/uniwork-drive-share.test.ts`, `uniwork-documents-home-drive-panel.test.ts`.

### 10.2 Chia việc song song (4 worker tasks sau khi chốt contract)

| Task | Lane | Nội dung | Độ lớn |
| --- | --- | --- | --- |
| **T1 — BE Schema + Contract + Service** | `drive-be` | 4 migration (`drive_file_shares` + 3 index `CONCURRENTLY`), sqlc `drive_file_shares.sql` + cập nhật `drive_files.sql`, SDI/SDO + `openapi.go` + catalogue x3, service `drive_files_share.go` + cập nhật `ListMine`/`Get`/`Unlink`/lifecycle, `tenant_export_tables.go`, unit/service tests + `audit_coverage_test.go`. | **M** (~450 dòng Go/SQL + test) |
| **T2 — BE Handler + Isolation Matrix** | `drive-be` (song song sau T1 contract) | Handler methods trong `server/internal/handler/drive_files.go`, `router_test.go`, `TestDriveFileSharesHTTPLifecycleAndPrivacy`, seed `isolation_world_test.go` + `isolation_matrix_test.go` + `isolation_routes_test.go` + 3 case `isoReferences`. | **S–M** (~250 dòng Go) |
| **T3 — Web Core + Views** | `drive-fe` (song song sau T1 contract) | Endpoint + zod schema + malformed tests (`packages/core`), hooks + keys + realtime test, `DriveShareDialog` tái sử dụng `share-*.tsx`, pill lọc `Tất cả / Của tôi / Được chia sẻ với tôi` ở 4.1, nút Chia sẻ & liên kết Xin quyền truy cập ở 4.2, `vi.json`/`en.json` + `docs/conventions.md`. | **M** (~400 dòng TS/TSX + test) |
| **T4 — Desktop Fork Parity** | `drive-desktop` (song song sau T1 contract) | `uniwork-drive-api.ts`, `main/uniwork-drive/{client,parse,wiring}.ts`, `preload`, lọc phạm vi ở `DriveList.tsx`, nút Chia sẻ + Xin quyền truy cập ở `DrivePanel.tsx`, chế độ Drive trong `uniwork-share/`, 21 file locale + Vitest. | **M** (~400 dòng TS/TSX + test) |

## 11. Thay đổi ADR 0047 và Câu hỏi mở

### 11.1 Cập nhật ADR (`docs/adr/0047-*.md`)

Trong `docs/adr/0047-google-drive-chi-tham-chieu-doc-bang-ket-noi-cua-chinh-nguoi-dung.md`, **Quyết định 1–4** (gồm Quyết định 2: *"Nội dung Drive chỉ được đọc bằng kết nối của chính người yêu cầu… UniWork không chia sẻ tệp trên Drive thay ai"*) **giữ nguyên hoàn toàn**. Hai câu mô tả hệ quả cũ cần cập nhật vì Mức 1 cho phép chia sẻ tham chiếu trong UniWork:
1. Ở `## Bối cảnh` (dòng 8): *"Mỗi người chỉ thấy tham chiếu Drive của chính mình trong Tài liệu; tệp gắn vào việc hiện dạng thẻ cho ai xem được việc (Q6); quyền đọc nội dung thật nằm ở ACL của Google."*
2. Ở `## Hệ quả` gạch đầu dòng 1 (dòng 25): *"- Màn Tài liệu có nút Google Drive riêng thay vì trộn vào danh sách tài liệu, và nút đó chỉ liệt kê tệp của chính người xem (không có danh sách cấp workspace); Type filter và tìm kiếm Documents không thấy tệp Drive. Cái giá: hai chỗ hiện "tệp", nhưng không có đường nào vô tình áp quyền UniWork lên tệp Drive."*

Theo quy ước ở `docs/adr/README.md` (mẫu sửa đổi tại chỗ của ADR 0037 dòng 40 khi mở rộng một hệ quả mà giữ nguyên các quyết định cốt lõi, hoặc tách ADR 0048 mới theo mẫu 0031→0033), đề xuất thêm đoạn **Sửa đổi 2026-10-28 (UNI-2273 — Chia sẻ tham chiếu Mức 1)** ngay dưới Quyết định 1 và Hệ quả 1 của ADR 0047 (hoặc thành file `docs/adr/0048-chia-se-tham-chieu-google-drive-trong-uniwork.md` nếu muốn tách số ADR riêng):

> **Sửa đổi 2026-10-28 (UNI-2273 — Chia sẻ tham chiếu Mức 1):** Tham chiếu `drive_files` có thể được chia sẻ chỉ-xem (`drive_file_shares`) trong UniWork cho thành viên, workspace hoặc tổ chức qua hộp thoại Chia sẻ dùng chung. Chia sẻ này chỉ mở cổng nhìn thấy **metadata tham chiếu** trong mục **Tài liệu › Google Drive** (kèm danh sách cấp workspace khi chia sẻ cho workspace/tổ chức) và trang 4.2; nó **không** cấp quyền trên Google Drive và **không** thay đổi Quyết định 2: mỗi người nhận vẫn chỉ thấy trạng thái quyền đọc từ `drive_file_access` của chính mình, đọc nội dung AI bằng kết nối của chính mình, và tự mở Google Picker hoặc xin quyền trên Google Drive khi chưa có quyền.

### 11.2 Câu hỏi mở cho User / Advisor (kèm khuyến nghị)

| # | Câu hỏi | Khuyến nghị |
| --- | --- | --- |
| **Q1** | **Ai được phép chia sẻ tham chiếu (`can_share`)?** (a) Chỉ người quản lý tham chiếu (`created_by`, `bound_by`, hoặc `owner`/`admin` workspace/tổ chức — khớp `canManageDriveFile`), hay (b) bất kỳ người nhận nào đã có `drive_file_access = granted`? | **Khuyến nghị (a):** Giữ đúng `canManageDriveFile` như `can_unlink`/`can_rebind` và `canAdminister` của Tài liệu, tránh việc người nhận xem tiếp tục chia sẻ rộng ra toàn tổ chức ngoài ý muốn của người liên kết. |
| **Q2** | **Nơi hiển thị tham chiếu được chia sẻ trên Web và Desktop:** (a) Nằm trong mục **Tài liệu › Google Drive** với bộ lọc `Tất cả / Của tôi / Được chia sẻ với tôi`, hay (b) trộn cả vào mục **Được chia sẻ với tôi** (`?view=shared`) của Documents? | **Khuyến nghị (a):** Giữ trong mục **Google Drive** (và hiện mục Google Drive ở sidebar ngay khi có tệp được chia sẻ dù chưa kết nối tài khoản Google). Cách này giữ đúng Quyết định 1 của ADR 0047 là không trộn `drive_files` vào danh sách/bộ lọc của `documents`. |
| **Q3** | **Đối tượng nhóm trong hộp thoại Chia sẻ:** Giữ đúng 3 loại `user \| workspace \| organization` của hộp thoại Chia sẻ Tài liệu hiện có, hay thêm `department` (phòng ban)? | **Khuyến nghị giữ 3 loại `user \| workspace \| organization`:** Tái sử dụng 100% `ShareCandidatePicker` và `ShareAccessList` hiện có của Tài liệu trên cả web và desktop mà không sinh mô hình nhóm thứ hai. |
| **Q4** | **Thông báo (Notification) khi chia sẻ tham chiếu Drive:** Có gửi thông báo in-app cho từng `principal_type = 'user'` mới được chia sẻ (như `document_shared`), hay ở Mức 1 chỉ phát sự kiện realtime `drive_file.shared`? | **Khuyến nghị có gửi thông báo cho `principal_type = 'user'` mới được thêm** (không gửi cho chính người bấm và không gửi hàng loạt khi chia sẻ cho cả `workspace`/`organization`), giúp đồng nghiệp biết ngay khi được chia sẻ tệp Drive. |
| **Q5** | **Hình thức cập nhật ADR:** Ghi mục **Sửa đổi 2026-10-28 (UNI-2273)** ngay trong ADR 0047 + `docs/adr/README.md` (theo mẫu sửa đổi ADR 0037 của UNI-2074), hay tạo file ADR 0048 mới? | **Khuyến nghị sửa đổi tại chỗ trong ADR 0047 (mẫu ADR 0037):** Vì cả 4 quyết định cốt lõi của ADR 0047 đều giữ nguyên và chỉ mở rộng Hệ quả 1 từ "chỉ cá nhân + thẻ công việc" sang "cá nhân + thẻ công việc + chia sẻ tham chiếu trong UniWork". |

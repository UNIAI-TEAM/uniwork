# UniWork — Sửa thông tin workspace: mô tả, icon, slug, tiền tố mã task

> **Trạng thái:** in-progress — đã triển khai trên nhánh, chờ review/PR

**Ngày:** 2026-10-14
**Issue:** chưa có. Tạo issue UniAI trước khi mở nhánh `feature/UNI-nnn-…` (luật "No issue, no code").
**Spec liên quan:** `2026-08-27-settings-design.md` (§6.3, §8.3 — v1 chỉ sửa tên, cố ý không đổi slug).

## 1. Mục tiêu

Owner/admin của workspace tự đặt danh tính workspace — tên, mô tả, icon, URL, tiền tố mã task —
mà không làm gãy link cũ hay mã task cũ.

Thành công khi:

- Đổi slug xong, link cũ (bookmark, link trong chat/tài liệu, link trong email đã gửi) vẫn mở đúng
  workspace và tự chuyển sang URL mới.
- Đổi tiền tố xong, mọi task hiện mã mới (`MKT-12`), nhưng tra `TASK-12` vẫn ra đúng task.
- Icon và mô tả mới hiện ngay cho mọi thành viên qua realtime, ở switcher, trang chọn workspace và
  tab Cài đặt.

## 2. Hiện trạng (2026-10-14)

- Tab **Cài đặt › Workspace** (`packages/views/settings/components/workspace-tab.tsx`) cho
  owner/admin sửa **tên** bằng autosave. Member thường thấy read-only.
- `PATCH /api/v1/workspaces/{workspaceID}` chỉ nhận `name`.
  `WorkspaceService.Update` (`server/internal/service/workspace.go`) kiểm tra quyền owner/admin, ghi
  audit `workspace.updated` và phát event `workspace.updated` (ids-only) qua outbox.
- Client **chưa xử lý** `workspace.updated`: người khác chỉ thấy tên mới khi tự tải lại trang.
- Cột hiện có trên `workspaces`: `slug`, `name`, `organization_id`, `matrix_room_id`, `task_prefix`,
  `task_counter`. `task_prefix` chưa có trong `WorkspaceDTO`.
- Mã task được **tính lúc đọc** từ `task_prefix` hiện tại + `number`
  (`server/internal/handler/task.go`, `toTaskDTO`). `ListTasksByIdentifier`
  (`server/pkg/db/queries/tasks.sql`) tra theo tiền tố không phân biệt hoa/thường, trả nhiều dòng,
  rồi service lọc theo quyền thành viên.
- Slug được tra ở `GetBySlugs` (HTTP) và `ResolveSlugs` (WebSocket handshake).
- Switcher (`packages/views/layout/workspace-switcher.tsx`) hiện ô chữ cái đầu của tên.
- Project đã có icon emoji (`projects.icon TEXT`, `ProjectIconField` + `EmojiPicker` của
  `packages/ui/components/common/emoji-picker.tsx`).
- Avatar người dùng đi theo FileService: `Upload` → `ClaimInTx` → `ReleaseInTx` file cũ →
  `ResolveMany` (presign) khi trả DTO, cộng một dòng trong `file_references.go` để GC không xoá nhầm
  (`server/internal/service/avatar_fs.go`). FileService luôn được nối trong
  `server/cmd/server/main.go`; server thoát nếu khởi tạo lỗi.

## 3. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Thêm 4 trường sửa được: mô tả, icon, slug, tiền tố mã task. Tên giữ như hiện tại. |
| D2 | Slug cũ được **redirect** sang slug mới. Slug cũ bị giữ vĩnh viễn trong org: workspace khác không lấy được; chính workspace đó được quay lại. |
| D3 | Mã task cũ vẫn tra được sau khi đổi tiền tố. |
| D4 | Icon: emoji **hoặc** ảnh upload. Tối đa một trong hai tại một thời điểm. |
| D5 | Mô tả hiện ở tab Cài đặt, trang chọn workspace (`workspace-picker-view.tsx`) và dropdown của `WorkspaceSwitcher`. |
| D6 | Quyền: owner hoặc admin của workspace (cùng cổng với tên). Member chỉ xem. |
| D7 | Mô tả: văn bản thuần, tối đa 500 ký tự, autosave như tên. |
| D8 | Slug và tiền tố: nút "Đổi" mở dialog xác nhận nói rõ hậu quả. Không autosave. |
| D9 | Tiền tố: 2–10 ký tự `A-Z0-9`, bắt đầu bằng chữ, lưu chữ hoa. Không bắt buộc duy nhất. |
| D10 | Lưu slug cũ và tiền tố cũ trong **một bảng `workspace_aliases`** có cột `kind` (phương án A). |

## 4. Mô hình dữ liệu

Migration mới đặt tên `999<unix-ms>_<name>`. Không FK, không cascade. Mỗi index một file,
`CONCURRENTLY`.

**4.1 Cột mới trên `workspaces`**

```sql
ALTER TABLE workspaces
  ADD COLUMN description  TEXT NOT NULL DEFAULT '',
  ADD COLUMN icon_emoji   TEXT,
  ADD COLUMN icon_file_id TEXT,
  ADD CONSTRAINT workspaces_one_icon CHECK (icon_emoji IS NULL OR icon_file_id IS NULL);
```

`icon_file_id` nằm ở migration riêng, cùng đợt với purpose `workspace_icon`:
`TestEveryFileIDColumnHasAReferenceSource` đòi mọi cột `*_file_id` có nguồn tham chiếu ngay khi
migration thêm nó. Purpose mới cũng cần một migration thay hai CHECK của `file_upload_sessions`
(`file_upload_sessions_purpose_check`, `file_upload_sessions_scope_matches_purpose`, bản hiện hành
ở `9991791800000000_data_subject_requests.up.sql`): thêm `workspace_icon` vào danh sách purpose
và vào nhánh org + workspace.

**4.2 Bảng `workspace_aliases`**

```sql
CREATE TABLE workspace_aliases (
  id              TEXT PRIMARY KEY,          -- ULID, util.NewID()
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('slug','task_prefix')),
  value           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Không có `created_by`: người đổi đã nằm trong `audit_events`, nên bảng không cần cặp `_kind`
(ADR 0007).

**4.3 Index (mỗi cái một migration)**

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_workspace_aliases_slug
  ON workspace_aliases (organization_id, value) WHERE kind = 'slug';
```

```sql
CREATE INDEX CONCURRENTLY idx_workspace_aliases_task_prefix
  ON workspace_aliases (upper(value)) WHERE kind = 'task_prefix';
```

**4.4 Bất biến**

1. Một slug trong org thuộc về tối đa một workspace, tính cả `workspaces.slug` **lẫn** alias
   `kind='slug'`. Hai unique index nằm ở hai bảng, nên service kiểm tra chéo trong transaction sau
   `pg_advisory_xact_lock` theo org. `CreateInOrg` cũng lấy lock này và từ chối slug đang là alias
   của workspace khác.
2. Đổi slug A→B: thêm alias A. Nếu B là alias của chính workspace này thì xoá alias B.
3. Đổi tiền tố P→Q: thêm alias P nếu chưa có cho workspace này. Xoá alias Q của workspace này nếu
   có. So sánh không phân biệt hoa/thường. Alias tiền tố không cần duy nhất.
4. `icon_emoji` và `icon_file_id` không cùng có giá trị (`workspaces_one_icon`).
5. Mô tả tối đa 500 rune, kiểm tra ở service.

**4.5 Tenant (ADR 0008):** `workspace_aliases` có `organization_id NOT NULL` ngay từ migration đầu.
Mọi query sqlc mới lọc theo `organization_id` hoặc `workspace_id`, hoặc mang dòng `-- tenant:` hợp
lệ.

## 5. Backend

**5.1 `PATCH /api/v1/workspaces/{workspaceID}`**

`sdi.PatchWorkspaceSDI` thêm các trường con trỏ tuỳ chọn, có `description` và `example`:
`description`, `icon_emoji`, `slug`, `task_prefix` (cùng `name` đã có). Trường `nil` = không đổi.
Cả 5 trường `nil` → 400. Response giữ `WorkspaceSDO`.

`UpdateWorkspaceInput` có 5 trường con trỏ. `WorkspaceService.Update` giữ cổng owner/admin và
kiểm tra từng trường:

- `name`: như hiện tại (trim, 1–100 rune).
- `description`: trim, tối đa 500 rune, được phép rỗng.
- `icon_emoji`: `""` = xoá emoji. Có giá trị: 1–16 rune, không chứa khoảng trắng; đặt emoji, đặt
  `icon_file_id = NULL`, `ReleaseInTx` file cũ. Shortcut: không kiểm tra đó có thật là emoji;
  nâng cấp nếu người dùng lạm dụng ô này.
- `slug`: `ValidateSlug`. Lấy advisory lock theo org. Từ chối 409 nếu slug là alias của workspace
  khác. Cập nhật; vi phạm unique → `ErrConflict` (409). Áp dụng bất biến 4.4.2.
- `task_prefix`: upper-case, khớp `^[A-Z][A-Z0-9]{1,9}$`. Áp dụng bất biến 4.4.3.

Mọi thay đổi trong **một transaction** và **một dòng audit** `workspace.updated`, `Changes` là diff
các trường đã đổi. Trường gửi lên bằng giá trị hiện tại thì không tính là đổi; không có trường nào
đổi thì không ghi audit, không phát event. Event `workspace.updated` giữ nguyên payload ids-only,
nên `docs/events/CATALOGUE.md`, `catalogue.go` và `events.ts` không đổi.

**5.2 sqlc (`server/pkg/db/queries/workspaces.sql`)**

- `UpdateWorkspaceName` → thay bằng `UpdateWorkspaceProfile`:
  `COALESCE(sqlc.narg(...), col)` cho `name`, `description`, `slug`, `task_prefix`, lọc
  `id` + `organization_id`.
- `SetWorkspaceIcon(id, organization_id, icon_emoji, icon_file_id)`: ghi cả hai cột.
- `InsertWorkspaceAlias`, `DeleteWorkspaceAlias(organization_id, workspace_id, kind, value)`
  (so sánh `upper()` cho `task_prefix`).
- `GetWorkspaceSlugAliasOwner(organization_id, value)`.
- `GetWorkspaceBySlugAlias(org_slug, value)`: trả cùng shape với `GetWorkspaceBySlugs`.
- `ListTasksByIdentifier`: khớp `upper(w.task_prefix) = upper($prefix)` **hoặc** tồn tại alias
  `kind='task_prefix'` của workspace đó với `upper(value) = upper($prefix)`.
- `FileGCWorkspaceIconRefTenants(ids)`: cho registry tham chiếu file (5.4).

**5.3 Tra cứu theo alias**

- `GetBySlugs` và `ResolveSlugs`: không thấy slug hiện tại → thử `GetWorkspaceBySlugAlias`. Kiểm
  tra thành viên giữ nguyên, nên người ngoài vẫn nhận 404 và alias không làm lộ sự tồn tại.
- `WorkspaceView` trả slug **hiện tại**; client dựa vào đó để redirect (6.2).

**5.4 Ảnh icon**

- Purpose mới `WorkspaceIcon` trong `server/internal/files/registry.go`: `ScopeOrgWorkspace`,
  `imageMIMETypes`, `MaxBytes: 2 << 20`, `ReadMode: ReadPresign`.
- `POST /api/v1/workspaces/{workspaceID}/icon` (POST như `POST /me/avatar`): multipart field `file`, `http.MaxBytesReader` như
  `server/internal/handler/avatar.go`. `WorkspaceService.UploadIcon`: cổng owner/admin →
  `files.Upload` → transaction {`ClaimInTx`, `SetWorkspaceIcon(emoji = NULL, file = mới)`,
  `ReleaseInTx` file cũ, audit} → lỗi thì `CancelUpload`.
- `DELETE /api/v1/workspaces/{workspaceID}/icon`: `RemoveIcon` đặt cả hai cột `NULL`, release file
  cũ, audit.
- Đăng ký `workspaces.icon_file_id` trong `server/internal/service/file_references.go` (provider +
  `FileGCWorkspaceIconRefTenants`).
- Cả hai route đăng ký qua wrapper `api` trong `server/internal/handler/router/` với `apiOp`.

**5.5 DTO**

`sdo.WorkspaceDTO` thêm `description`, `icon_emoji`, `icon_url` (presign lúc trả DTO qua
`ResolveMany`, rỗng nếu không có ảnh hoặc presign lỗi), `task_prefix`.

## 6. Client

**6.1 `packages/core`**

- `WorkspaceSchema` (`packages/core/types/workspace.ts`) thêm `description`, `icon_emoji`,
  `icon_url`, `task_prefix`, viết dễ dãi (`.nullish()` / `.catch("")`) để response thiếu trường vẫn
  parse được.
- `patchWorkspace(wsId, body)`: body thành
  `Partial<{ name; description; icon_emoji; slug; task_prefix }>`. `usePatchWorkspace` nhận cả body.
- Mới: `uploadWorkspaceIcon(wsId, file)` (FormData như `uploadAvatar`), `removeWorkspaceIcon(wsId)`
  và hai hook mutation. Thành công thì invalidate `workspaceKeys.list()` và tiền tố `["workspace"]`.
- `packages/core/realtime/use-realtime-sync.ts`: case `workspace.updated` → invalidate
  `workspaceKeys.list()` và tiền tố `["workspace"]`.

**6.2 Redirect slug cũ**

Trong `DashboardGuard` (`packages/views/layout/dashboard-guard.tsx`): khi `workspace.slug !== wsSlug`
thì `replace` sang `pathname` với đoạn thứ hai (slug workspace trong `/{orgSlug}/{wsSlug}/…`)
được thay bằng `workspace.slug`, giữ phần đường dẫn phía sau và query. Áp dụng cho người mở link cũ và cho người đang ở trong workspace lúc admin đổi slug
(realtime refetch → server trả slug mới → tự chuyển).

**6.3 Component `WorkspaceIcon`** (`packages/views/layout/workspace-icon.tsx`)

Thứ tự hiển thị: ảnh (`icon_url`) → emoji → chữ cái đầu của tên. `<img onError>` rơi về emoji hoặc
chữ cái. Kích thước theo prop, giữ class của ô chữ cái hiện tại để không lệch layout. Dùng ở
switcher, trang chọn workspace và tab Cài đặt.

**6.4 Tab Cài đặt › Workspace** (`workspace-tab.tsx`, tách file khi gần giới hạn 500 dòng)

1. **Icon**: preview + ba nút "Chọn emoji" (`EmojiPicker` lazy như `ProjectIconField`), "Tải ảnh lên"
   (input file ẩn), "Xoá icon".
2. **Tên**: giữ nguyên.
3. **Mô tả**: `Textarea`, autosave bằng `useAutoSave`, đếm ký tự trên 500.
4. **URL**: hiện URL + nút "Đổi" mở `Dialog`: ô nhập slug (chuẩn hoá bằng
   `packages/views/workspace/slug.ts`), cảnh báo "Link cũ sẽ tự chuyển sang link mới". Lưu xong thì
   điều hướng sang URL mới.
5. **Tiền tố mã task**: hiện tiền tố + nút "Đổi" mở `Dialog`: xem trước `TASK-12 → MKT-12`, ghi
   chú "mã cũ vẫn tìm được".
6. **Tổ chức**: giữ nguyên.

Member thường chỉ thấy giá trị read-only, không có nút và không có `SettingsSaveState`.

**6.5 Hiển thị mô tả**

`workspace-picker-view.tsx` và dropdown của `WorkspaceSwitcher` thêm dòng phụ
`text-caption text-muted-foreground`, một dòng, `truncate`. Mô tả rỗng thì không render.

**6.6 i18n**

Khoá mới trong `settings.workspace.*` (vi + en) ở `packages/core/i18n/locales/`, theo glossary và
giọng văn trong `docs/conventions.md`. Mọi text JSX trong `packages/views/` đi qua `t()`.

## 7. Xử lý lỗi và ca biên

| Tình huống | Server | Client |
|---|---|---|
| Sai định dạng (slug, tiền tố, mô tả > 500, emoji quá dài) | 400 `Invalid` | Lỗi inline dưới ô; dialog không đóng |
| Slug trùng workspace khác trong org (hiện tại hoặc alias) | 409 `ErrConflict` | Inline: "URL này đã được dùng trong tổ chức" |
| Không phải owner/admin | 403 | UI đã ẩn nút; nếu vẫn tới thì `toastApiError` |
| Ảnh quá 2 MiB / sai loại | 413 / 415 (như avatar) | Toast "Ảnh tối đa 2 MB" / "Chỉ PNG, JPEG, GIF, WebP" |
| Upload xong nhưng transaction lỗi | `CancelUpload`, 500 | Toast lỗi chung; icon giữ như cũ |
| Lỗi khác | 500 | `toastApiError` |

Ca biên:

1. **Đổi về giá trị hiện tại**: không ghi gì, không tạo alias, không audit.
2. **Hai admin đổi slug cùng lúc**: advisory lock theo org xếp hàng hai request; request sau thấy
   trạng thái mới. Tên và mô tả vẫn last-write-wins như hiện tại.
3. **Vòng lặp redirect**: không xảy ra. Alias luôn trỏ về slug hiện tại, guard chỉ `replace` khi
   khác URL, và theo bất biến 4.4.1 slug cũ không là slug hiện tại của workspace khác.
4. **WebSocket**: `ResolveSlugs` đi qua alias nên socket đang mở vẫn sống. Sau redirect,
   `WSProvider` nhận `workspaceSlug` mới và kết nối lại.
5. **Ảnh không tải được**: `icon_url` rỗng hoặc `onError` → rơi về emoji rồi chữ cái đầu.
6. **Tiền tố trùng giữa các workspace**: `ListTasksByIdentifier` đã trả nhiều dòng và lọc theo
   quyền thành viên; hành vi giữ nguyên.
7. **Mô tả nhiều dòng**: lưu nguyên văn; switcher và picker hiện một dòng `truncate`.

## 8. Kiểm thử

Viết test thất bại trước rồi mới implement.

**Go — `server/internal/service/workspace_test.go`**

- Từng trường: hợp lệ thì đổi; sai thì 400; cả 5 trường `nil` thì 400; member thường thì 403.
- Slug: A→B tạo alias A; B→A xoá alias A; slug là alias của workspace khác → 409; `CreateInOrg`
  với slug là alias của workspace khác → 409.
- Hai goroutine đổi slug cùng lúc sang cùng giá trị → đúng một bên thành công.
- `GetBySlugs` / `ResolveSlugs` qua alias trả workspace hiện tại; người ngoài vẫn 404.
- Tiền tố: `TASK`→`MKT`, `ListTasksByIdentifier("task", n)` vẫn ra task; quay về `TASK` xoá alias.
- Icon: đặt emoji xoá `icon_file_id` và release file; upload ảnh xoá emoji; `DELETE` xoá cả hai;
  transaction lỗi gọi `CancelUpload` (`server/internal/files/filesfake`).
- Gửi lại giá trị hiện tại → không có dòng audit mới.

**Go — test hợp đồng đã có**

- `server/internal/service/audit_coverage_test.go`: không thêm dòng. `UploadIcon` và `RemoveIcon` ghi lại action `workspace.updated` (diff `icon`), action này đã có ca kiểm tra.
- `server/internal/service/file_references_test.go`: `workspaces.icon_file_id` được đăng ký.
- `isolation_world_test.go`: seed một dòng `workspace_aliases` của org A bằng cách đổi slug qua API.
  Hai route icon mới tự được `TestIsolationMatrix` phủ vì path chứa `{workspaceID}`.
- `server/migrations/lint_test.go`, `query_scope_test.go`, `tenant_schema_test.go`: phải pass,
  không sửa.

**TypeScript — `packages/core`**

- `api/endpoints/workspaces.test.ts`: ca malformed-response cho `patchWorkspace` (body mới),
  `uploadWorkspaceIcon`, `removeWorkspaceIcon`; `WorkspaceSchema` mới vẫn parse response thiếu
  trường.
- `realtime/use-realtime-sync.test.tsx`: `workspace.updated` invalidate `["workspaces"]` và
  `["workspace"]`.

**TypeScript — `packages/views`** (mock transport, không mock `next/*`)

- `settings/components/workspace-tab.test.tsx`: autosave mô tả; dialog slug (409 inline, thành công
  thì điều hướng); dialog tiền tố (xem trước); menu icon; member thường read-only.
- `layout/workspace-icon.test.tsx`: thứ tự ảnh → emoji → chữ cái; `onError` rơi về chữ cái.
- `layout/dashboard-guard.test.tsx`: slug khác URL → `replace` giữ phần sau và query; slug khớp →
  không gọi.
- Test của `workspace-switcher` và `workspace-picker-view`: có dòng mô tả; mô tả rỗng thì không
  render.

**E2E — `e2e/workspace-settings.spec.ts`** (mới): admin đổi slug → mở URL cũ → về URL mới.
Tra mã task cũ sau khi đổi tiền tố do `TestGetTaskByIdentifierAfterPrefixChange` (Go) giữ: e2e chưa
có đường UI rẻ nào tra mã task.

Ngưỡng coverage chỉ tăng.

## 9. Thứ tự giao

1. **Pha 1 — mô tả + icon + realtime**: migration 4.1, `PATCH` nhận `description` / `icon_emoji`,
   route icon, `WorkspaceIcon`, mô tả ở switcher và picker, case `workspace.updated`.
2. **Pha 2 — tiền tố mã task**: migration 4.2 + hai index 4.3, `task_prefix` trong `PATCH` và DTO,
   `ListTasksByIdentifier` qua alias, dialog tiền tố.
3. **Pha 3 — slug**: advisory lock (cả trong `CreateInOrg`), `slug` trong `PATCH`, tra cứu alias ở
   `GetBySlugs` / `ResolveSlugs`, redirect trong `DashboardGuard`, dialog URL, E2E.

Mỗi pha giao được độc lập; pha sau chỉ dựa vào schema của pha trước.

## 10. Ngoài phạm vi và nợ đã biết

- Ngoài phạm vi: đổi slug organization; xoá hoặc lưu trữ workspace; lịch sử chỉnh sửa hiển thị cho
  người dùng (audit đã ghi); crop/resize ảnh icon phía client.
- Nợ đã biết: slug cũ bị giữ vĩnh viễn, nên admin đổi slug liên tục có thể giữ nhiều slug trong org.
  Nâng cấp khi cần bằng giới hạn số alias `kind='slug'` mỗi workspace.

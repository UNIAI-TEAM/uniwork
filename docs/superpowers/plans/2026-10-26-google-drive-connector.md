# Connector Google Drive — Implementation Plan

> **Trạng thái:** in-progress — plan nháp, chờ người dùng ký duyệt spec `docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` (hitl gate); chưa cắt thẻ triển khai.

**Goal:** Người dùng kết nối Google Drive (nhiều tài khoản), liên kết tệp vào việc trên web và thấy cùng danh sách ở app desktop; UNI đọc tệp bằng quyền của chính người yêu cầu, đề xuất việc, người duyệt rồi việc được tạo.

**Architecture:** Server Go giữ token (secretbox), gọi Drive REST trực tiếp bằng `net/http` như Calendar; bảng riêng `drive_connections`, `drive_files`, `drive_file_access`, `drive_file_task_links`, `drive_task_proposals`, `drive_task_proposal_links` (không phải `documents`, ADR nháp 0038). Endpoint đề xuất theo mẫu `meeting_summary_tasks.go` + `ai.Gateway`. Web: `packages/core/drive` + `packages/views` (Picker, thẻ Drive, hộp duyệt, mục Google Drive). Desktop (fork `uniwork-office`): nút Google Drive ở sidebar Tài liệu qua cùng API, không giữ token Google, chuyển sang trình duyệt/web cho Picker, kết nối, tạo việc, Hỏi UNI.

**Tech Stack:** Go (Chi, pgx/sqlc, `golang.org/x/oauth2`), Next.js + TanStack Query + zod, Google Picker JS; Electron (fork).

**Issue:** UNI-2172. Thẻ triển khai là sub-issue của UNI-2172, cắt sau khi người dùng duyệt (một thẻ mỗi nhiệm vụ dưới đây, giữ mã nhiệm vụ trong tiêu đề).

---

## Quy ước

- Mã nhiệm vụ: `S` spike, `E` phụ thuộc ngoài, `B` server, `W` web, `D` desktop (fork), `Q` kiểm thử/ra mắt. Ước lượng là ngày-người (d) cho một người quen repo.
- Mỗi nhiệm vụ B/W/D theo TDD: test thất bại trước, rồi mã, rồi `make check` phạm vi hẹp ở lane; bộ đầy đủ chỉ trước PR vào `develop`.
- Màn prototype ghi trong ngoặc: 1.1 … 4.2 (tiêu đề artboard trong `canvas.json`).
- Lane: B và W thuộc lane repo `uniwork`; D thuộc lane fork `uniwork-office`. Web và desktop **ra cùng đợt** (QĐ 15): Q3 chỉ đóng khi cả hai qua.

## Đồ thị phụ thuộc

```
E1 ─────────────────────────────────────────────┐ (brand verification, song song)
S1  S2  S3  S4  S5 ──► (kết quả ghi vào spec, đổi nhiệm vụ nếu cần)
B1 ─► B2 ─► B3 ─► B4 ─► B5 ─► B6 ─► B7
           │            │      └─► B8
           │            └─► W3 ─► W4 ─► W5
           └─► W1 ─► W2            └─► W6 ─► W7
B4 ─► W8 ─► W9
B4 ─► B10 ─► D1 ─► D2 ─► D3 ─► D4      (D3 cũng chờ W2, W8)
B8 ─► W10
B1..B8, W1..W10, D1..D4 ─► Q1 ─► Q2 ─► Q3
```

## Pha 0 — Spike và phụ thuộc ngoài (làm trước, song song)

### E1 — Dự án Google Cloud, OAuth client Drive, brand verification (phụ thuộc ngoài)
- Tạo client OAuth "UniWork Drive" (web), bật Drive API + Picker API, developer key giới hạn referrer, lấy project number.
- Màn consent: tên, logo, domain đã xác minh, privacy policy + terms URL công khai, scope `openid email drive.file`.
- Nộp brand verification. **Thời gian chờ: vài phút đến 2–3 ngày làm việc** (QĐ 14); trong lúc chờ dùng chế độ Testing (≤ 100 test user).
- Không xin scope restricted nào (không CASA).
- Người làm: chủ tài khoản Google Cloud của tổ chức (người dùng/ops). Ước lượng: 0,5d công + thời gian chờ Google.
- Xong khi: bốn giá trị env có trong secret store của staging; trạng thái verification ghi vào spec §5.1.

### S1 — Chọn thư mục có cấp quyền cho tệp con dưới `drive.file`? (QĐ 3) — 0,5d
- Tài khoản thử, Picker với `DocsView().setIncludeFolders(true).setSelectFolderEnabled(true)`; chọn thư mục; dùng refresh token server gọi `files.list q='<folder>' in parents` và `files.get` tệp con.
- Ghi: thấy/không thấy con, tệp con thêm sau có thấy không. Kết quả chỉ để quyết định roadmap "liên kết thư mục"; v1 không đổi.

### S2 — `setFileIds` chọn sẵn tệp và cấp quyền cho người thứ hai (QĐ 5) — 0,5d
- Tài khoản A chia sẻ tệp cho B. B (kết nối riêng) mở Picker `DocsView().setFileIds(id)`; kiểm Picker hiện đúng tệp, B chọn → server bằng token của B `files.get` thành công.
- Lặp với B **không** có quyền trên Drive: Picker hiện gì (rỗng/lỗi)? → quyết định câu chữ §7.4.
- Lặp cho chip dán URL (§7.5).
- Nếu `setFileIds` không làm được: chuyển §7.4 sang phương án dự phòng (view "Được chia sẻ với tôi" + ô tìm tên), cập nhật spec trước W4.

### S3 — Export, giới hạn, metadata dưới `drive.file` — 0,5d
- Đo `files.export` cho Docs (`text/markdown`), Sheets (`text/csv`), Slides (`text/plain`) trên tài liệu 50 trang; thời gian và kích thước.
- `files.get` trả `shared`, `owners`, `permissions` gì cho tệp do người khác sở hữu (cột "Quyền trên Google Drive", §6.2).
- PDF 10 MiB qua `Attachments` của gateway với provider mặc định.

### S4 — Hình dạng lỗi khi admin Google Workspace chặn app (QĐ 13) — 0,5d
- Workspace thử, chặn app trong Admin console (API controls); ghi `error`/`error_subtype` ở callback và lỗi API 403 → ánh xạ `blocked_by_workspace_admin`.
- `hd` trong id_token với tài khoản Workspace và Gmail (§5.4).

### S5 — Đăng nhập Google trong cửa sổ Electron và đường chuyển giao desktop → web (QĐ 15) — 0,5d
- Thử mở consent Google trong `BrowserWindow`/webview của app: xác nhận Google chặn ("This browser or app may not be secure") như dự kiến.
- Xác nhận đường chuyển giao: app mở `shell.openExternal(<web>/…/settings?tab=integrations&connect=drive)` và `…/documents/drive?pick=1`; web xử lý tham số đó (W1, W8). Ghi cách app biết khi người dùng xong (realtime `drive_connection.changed` / `drive_file.linked` hoặc làm mới khi cửa sổ app lấy lại focus).

## Pha 1 — Server

### B1 — Migration + sqlc: kết nối và chính sách tổ chức — 1d
- Tạo `drive_connections` (§6.1), cột chính sách trên `organizations` (§6.7); index unique một phần, mỗi index một file `CONCURRENTLY`.
- Query sqlc `drive_connections.sql` có `-- tenant: self` hoặc tham số `organization_id`.
- Test: `server/migrations/lint_test.go` (tenant, actor kind), `TestEveryQueryNamesItsTenant`.
- File: `server/migrations/999<ms>_drive_connections.up/down.sql`, `…_drive_connections_user_sub_uidx…`, `…_organizations_drive_policy…`, `server/pkg/db/queries/drive_connections.sql`.

### B2 — OAuth kết nối, refresh, ngắt, chính sách (1.1–1.3, QĐ 4, 13) — 3d
- `server/internal/service/drive_connections.go` (Start, Complete, List, Disconnect), `drive_oauth_refresh.go` (mẫu `email_hub_oauth_refresh.go:19-128`), `drive_policy.go` (đọc/đặt miền + dùng chung, `requireOrgAdmin`).
- Callback ngoài wrapper `api` như `registerEmailHubCallback` (`handler/router/email_hub.go:205-216`), trang HTML `postMessage` `uniwork:drive-oauth`.
- Route: `POST /me/drive-connections/google/start`, `GET /drive-connections/google/callback`, `GET /me/drive-connections`, `DELETE /me/drive-connections/{connectionID}`, `GET|PUT /orgs/{orgID}/drive-policy`, `DELETE /orgs/{orgID}/drive-connections/{connectionID}` (admin ngắt).
- Config + env (5 biến) + `.env.example`; flag `drive_connector` (`keys.go`, `review_at` 2027-04-30); `GET /api/v1/config` báo `drive.available`.
- Audit: `drive_connection.connected|reconnected|refused|auth_failed|disconnected`, `organization.drive_policy_changed`; outbox `drive_connection.changed` (ScopeUser) vào ba catalogue.
- Test: fake Google token endpoint (nonce sai, verifier, không refresh token → `consent_required`, `hd` sai → `domain_not_allowed`, `sub` của người khác → `account_in_use` có/không cho phép, `admin_policy_enforced` → `blocked_by_workspace_admin`), refresh fence hai goroutine, `invalid_grant` → `auth_failed`; `audit_coverage_test.go`; `isoRoutes` (callback `isoPublic`/`reasonProvider`, `/me/*` `isoSelf`); `router_test` rate limit.

### B3 — Client Drive REST + metadata — 1d
- `server/internal/service/drive_api.go`: `filesGet`, `revoke`, ánh xạ lỗi (404/403 → `not_accessible`, 403 domain policy → `blocked_by_workspace_admin`, 401 → refresh rồi `auth_failed`); client 15 s, không theo redirect ra ngoài host Google.
- `server/internal/service/drive_content.go`: `ReadForAI(ctx, requesterID, driveFileID)` — duy nhất gọi `files.export`/`alt=media` (§8.3), tra kết nối qua `drive_file_access` của người yêu cầu.
- Test: bảng định dạng, cắt 200.000 ký tự, PDF thành media part, định dạng khác → `drive_format_unsupported`; `TestDriveContentReadsUseTheCallersConnection`; arch test `TestDriveContentOnlyFromDriveContent`.

### B4 — Tham chiếu: migration, liên kết, danh sách, chi tiết, bỏ, rebind, quyền người xem (2.x, 4.x) — 3d
- Migration `drive_files`, `drive_file_access`, `drive_file_task_links` (§6.2–6.4) + index.
- `service/drive_files.go`: `Link` (khử trùng `already_linked`), `ListWorkspace` (lọc `connection_id`, `linked_by=others`), `Get`, `ListForTask`, `Unlink`, `RemoveFromTask`, `GrantAccess`, `Rebind`, làm mới metadata (≤ 1 lần/10 phút), dựng `open_url` theo §6.3/§7.8.
- `CreateTaskSDI.drive_files` + gọi `Link` trong transaction tạo việc (`service/task.go`).
- Route §7.2–7.7: `POST|GET /workspaces/{workspaceID}/drive-files`, `GET|DELETE /workspaces/{workspaceID}/drive-files/{driveFileID}`, `POST …/{driveFileID}/access`, `POST …/{driveFileID}/rebind`, `GET /tasks/{taskID}/drive-files`, `DELETE /tasks/{taskID}/drive-files/{driveFileID}`, `POST /me/drive-connections/{connectionID}/picker-token`. SDI/SDO có `description`/`example`; `pathParamSDI` cho `connectionID`, `driveFileID`.
- Audit + outbox: `drive_file.linked|access_granted|task_link_added|task_link_removed|unlinked|rebound`; sự kiện `drive_file.linked|access_changed|task_linked|unlinked|updated`.
- Test: quyền (sửa việc, người liên kết/admin), khử trùng giữa hai tài khoản của một người và giữa hai người, thành viên bị vô hiệu hóa, `isoReferences` cho mọi `*_id` trong body, seed `isolation_world_test.go`, events catalogue.

### B5 — Đề xuất việc: capability, prompt, endpoint (3.1–3.3) — 2,5d
- `ai/policy.go` thêm `CapDriveTaskProposals` + policy; `ai/prompts.go` `drive_task_proposals@1` với `OutputSchema` (§8.2), nội dung bọc không tin cậy.
- Migration `drive_task_proposals`, `drive_task_proposal_links`.
- `service/drive_task_proposals.go`: `Propose` (§8.2 bước 1–6), `Duplicates` (tính lại theo dự án/cha), `Discard`. Route `POST /workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals`, `GET|DELETE /workspaces/{workspaceID}/drive-task-proposals/{proposalID}`, `POST …/{proposalID}/duplicates`; rate limit `drive-proposals`.
- Test với fake gateway: id người/nhãn lạ bị bỏ, ngày sai bỏ, vòng `blocked_by` bỏ, basis trống khi trường trống, trùng từ `FindActiveDuplicateTask`, `assignee_drive_access`, 409 `drive_access_required`, audit `drive_file.read` có `google_email`, không nội dung trong log (`scripts/no-pii-log.test.mjs`).

### B6 — Tạo lô từ đề xuất (3.3 → 3.4) — 2d
- `CreateTasksFromProposal` qua `TaskService.CreateManyWith` (`service/task.go:390`): `Before` (khóa lô, đã tạo, workspace của người/dự án/cha/nhãn, trùng theo lô như `refuseSummaryDuplicates`, phụ thuộc trong lô không vòng, kiểm `strip_excerpts`), `After` (`task_dependencies` qua đường `SetDependency`, `drive_file_task_links`, `drive_task_proposal_links`, lô `converted`, audit `drive_task_proposal.tasks_created`, outbox `drive_task_proposal.converted`).
- Route `POST /workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks`.
- Test: 409/410 các ca, `allow_duplicate`, thứ tự khóa, phụ thuộc, strip, isolation (`items[].assignee_id`, `items[].label_ids`, `project_id`, `parent_task_id`).

### B7 — Lưu giữ đề xuất (Q3) — 0,5d
- Job lane chậm mỗi giờ (§8.6), `SKIP LOCKED`, đăng ký trong trình tự tắt của `cmd/server/main.go`; ngắt kết nối/bỏ liên kết chuyển lô `ready` thành `discarded`.
- Test: xóa đúng tập, hai worker không xóa trùng, dòng audit `drive_task_proposal.purged`.

### B8 — Hỏi UNI đọc tệp Drive (3.2) — 1d
- Tool `read_drive_file` trong `service/askuni_agent_tools.go` dùng `drive_content.ReadForAI`; audit `drive_file.read` (`purpose = ask_uni`).
- Test: `TestAskUniToolsAreReadOnly`, người hỏi chưa có quyền → kết quả công cụ không lỗi.

Phụ: **B9 — ADR 0038 accepted + luật CLAUDE.md** (0,25d, trong PR của B3): chuyển ADR ra `docs/adr/`, bảng README, mục Audit and Events của `CLAUDE.md` nêu tên test; `scripts/governance.test.mjs`.

## Pha 2 — Web

### W1 — Core: endpoint, schema, hook (mọi màn) — 1,5d
- `packages/core/api/endpoints/drive.ts` (+ `drive.test.ts` ca malformed cho từng hàm), `packages/core/drive/{keys,hooks}.ts`, `CreateTaskBody.drive_files`; realtime: `drive_file.*`, `drive_connection.changed` trong `use-realtime-sync.ts` + `packages/core/types/events.ts`.
- Test: hook vô hiệu đúng khóa; `knip` sạch.

### W2 — Cài đặt › Tích hợp: kết nối, danh sách tài khoản, ngắt; chính sách tổ chức (1.1, 1.3) — 2d
- Hàng Google Drive ở `packages/views/settings/components/integrations-tab.tsx` (flag + `drive.available`), dùng `packages/views/integrations/use-oauth-popup.ts`; màn "Đã kết nối" với khối "UNI được làm gì"; thẻ từng tài khoản (Mất kết nối · kết nối lại).
- Tham số `?connect=drive` mở luồng kết nối ngay (đường chuyển giao từ desktop, S5).
- Cài đặt tổ chức: khối "Google Drive" (giới hạn tên miền, cho phép dùng chung, danh sách kết nối ngoài miền) ở `organization-tab.tsx`.
- i18n vi/en + thuật ngữ `docs/conventions.md` (§7.9); câu cho mọi mã callback.
- Test: hiện/ẩn theo flag, popup kết quả từng mã, admin-only.

### W3 — Picker (2.2) — 1,5d
- `packages/views/integrations/drive-picker/` (tải script, mở Picker bằng `picker-token`, chọn nhiều, không thư mục, `setFileIds` cho §7.4/§7.5), hỏi tài khoản khi có nhiều kết nối (nhớ qua `StorageAdapter`), hộp xác nhận tên tệp riêng tư (Q6).
- CSP web thêm `apis.google.com`, `docs.google.com` (`apps/web/platform/…`).
- Adapter giả cho test và e2e (không gọi Google).

### W4 — Việc: kẹp giấy, Đính kèm, thẻ Drive, người khác mở (2.1, 2.3, 2.4) — 3d
- `create-task-manual-panel.tsx`: kẹp giấy thành menu "Tải tệp lên" / "Từ Google Drive" (N tài khoản); chip tệp Drive trong nháp; gửi `drive_files`.
- `attachments-section.tsx`: nút "Thêm tệp" (menu), danh sách Drive sau tệp tải lên, hiện khi một trong hai có mục; thẻ Drive với Mở trên Google Drive / Tạo việc từ tài liệu / Hỏi UNI / ⋯ (Xem trong Tài liệu, Bỏ liên kết).
- Khối `viewer_access = unknown|lost|connection_lost` (2.4) và ghi chú trích đoạn riêng tư dưới mô tả.
- Test: views test (transport mock), a11y (`aria-disabled` cho nút bị khóa), i18n literal lint.

### W5 — Dán URL Drive (QĐ 8) — 1d
- Mở rộng Tiptap nhận URL Drive khi dán, chip "Liên kết tệp Google Drive này vào việc?" → Picker `setFileIds` (W3).
- Test: các dạng URL, URL không phải Drive không có chip.

### W6 — Agent mode gửi tệp Drive (3.1) — 1,5d
- `create-task-agent-panel.tsx`: chip tệp Drive, dự án, "Task con của", dòng tài khoản đọc; "Gửi cho agent" → `task-proposals`; không có tệp Drive → giữ `agent_unavailable`.
- Nút "Tạo việc từ tài liệu" (thẻ Drive, 4.2, Hỏi UNI) dùng cùng hook.

### W7 — Hộp duyệt + toast (3.3, 3.4) — 3d
- `packages/views/tasks/drive-proposals/review-dialog.tsx` (+ tách thành phần dưới 500 dòng): trường cả lô, từng việc, basis "UNI · …", trùng (Bỏ việc này / Vẫn tạo), "Bị chặn bởi", người phụ trách chưa có quyền Drive, công tắc bỏ trích đoạn, dựng mô tả, "Tạo N việc".
- Toast "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>" + "Xem <cha>"; không nhánh hiển thị riêng ở các kiểu xem.
- Test: hộp duyệt đủ trạng thái; e2e ở Q1.

### W8 — Tài liệu › Google Drive và trang tệp (4.1, 4.2) — 2,5d
- `documents-sidebar.tsx`: nút Google Drive dưới "Thư mục của tôi" (hiện khi có kết nối), con theo tài khoản + "Người khác liên kết".
- Màn danh sách Drive (cột §7.6), "Liên kết tệp", "Quản lý kết nối"; tham số `?pick=1` mở Picker ngay (đường chuyển giao từ desktop).
- Trang `/documents/drive/{driveFileID}` (builder `packages/core/paths/`, `consistency.test.ts`): thuộc tính, Đang dùng ở, Gắn vào việc, Hoạt động, Bỏ liên kết (xác nhận), Liên kết lại bằng tài khoản khác.

### W9 — Hỏi UNI với tệp Drive (3.2) — 1d
- Chip ngữ cảnh trong `ask-uni-panel.tsx`, dòng tài khoản đọc, trích dẫn mở trên Google, gợi ý "Tạo việc từ tài liệu này".

### W10 — Cập nhật trang tích hợp đã lên kế hoạch và thuật ngữ — 0,25d
- `integrations-tab.tsx` comment `PLANNED` yêu cầu dòng roadmap: thêm dòng roadmap Drive; rà `docs/conventions.md`.

## Pha 3 — Desktop (fork `uniwork-office`, lane fork)

Các nhiệm vụ D dùng API từ B4 và B10 (không cần B5–B8). Chi tiết tệp và khóa ở §17 của spec (đối chiếu fork `659b5e8b0`); đường dẫn tính từ `apps/shell/`. Lane fork theo luật fork hiện hành (eslint phạm vi đã chạm, đọc CI fork sau push).

### B10 — Server cho desktop (repo `uniwork`) — 0,5d
- `server/internal/service/office_app_capabilities.go`: thêm trường `drive_connector` (flag `drive_connector` bật cho tổ chức **và** provider Drive sẵn sàng) vào `GET /orgs/{orgID}/office/capabilities`.
- SDO tệp Drive có `can_unlink` (người liên kết hoặc admin) để app và web ẩn nút đúng.
- `picker-token` từ chối phiên desktop: `TestDrivePickerTokenRefusesDesktopSession`.
- Phụ thuộc: B4. Test: `office_app_capabilities_test.go`, isolation không đổi.

### D1 — Client + IPC Drive trong main/preload — 1,5d
- Kênh mới trong `src/shared/home-api.ts` (cạnh `UNIWORK_DOC_CHANNELS`, `:1795`): `uniwork-drive:list-connections`, `:list-files`, `:get-file`, `:unlink`, `:open-on-google`; kiểu trong `HomeApi` (`:1156`); preload (`src/preload/index.ts`, mẫu `:1134-1160`, `asUniworkResult`); `ipcMain.handle` trong `src/main/uniwork-docs/wiring.ts` (hoặc `src/main/uniwork-drive/wiring.ts` theo mẫu `uniwork-work/wiring.ts:80-89`); client qua `createUniworkSend` (`src/main/uniwork-docs/client.ts:445-470`).
- `open-on-google`: main lấy `open_url` từ server, kiểm `https` + host `docs.google.com`/`drive.google.com`, `shell.openExternal`; renderer không truyền URL.
- Capability: đọc `drive_connector` từ cache `uniwork-sync/capability/cache.ts`.
- Test (Vitest, node): host lạ bị từ chối, lỗi mạng → kết quả `network`, phản hồi hỏng không ném (cùng tinh thần `parseWithFallback`).

### D2 — Sidebar + danh sách Drive (4.1 trên app) — 2d
- `documents-home-model.ts`: id `google-drive`, nguồn `drive`, mục con động theo kết nối (không thêm vào bảng tĩnh cho từng email); nhánh loader (`:422/451/489`).
- `DocumentsHome.tsx`: mục dưới "Thư mục của tôi", icon trong `SubNavIcon`, bảng cột §17.2, "Mất kết nối · kết nối lại", trạng thái offline "Cần kết nối mạng…", làm mới khi focus; không toggle offline trên dòng Drive.
- Test: `tests/uniwork-documents-home-model.test.ts` (hiện/ẩn theo capability + kết nối, lọc tài khoản, "Người khác liên kết"), `tests/uniwork-documents-home-ui.test.ts` (jsdom: chọn mục, offline, mất kết nối).

### D3 — Panel chi tiết + bỏ liên kết + chuyển giao (4.2 trên app, Q9) — 2d
- Panel phải mới trong DocumentsHome theo bố cục `UniworkDocInfoPanel.tsx` (§17.3); "Bỏ liên kết" với hộp xác nhận, ẩn khi `can_unlink = false`.
- `src/main/uniwork-work/wiring.ts` `webPathOf` + `WorkWebTarget` (`src/shared/uniwork-work-api.ts:174-177`): đích `drive-pick`, `drive-connect`, `drive-file` (`action` `propose`|`ask`|không); nút Thêm từ Google Drive, Kết nối lại, Tạo việc từ tài liệu, Hỏi UNI, việc trong "Đang dùng ở".
- Test: `webPathOf` từng đích (id sai → `null`), panel đủ trường, bỏ liên kết gọi IPC và làm mới.
- Phụ thuộc web: W2 (`?connect=drive`), W8 (`?pick=1`, `?propose=1`, `?ask=1`).

### D4 — i18n 21 ngôn ngữ + checklist app — 1d
- Khóa §17.6 trong `src/renderer/src/i18n/uniwork-home/zh.ts` và 20 locale; vi/en lấy từ web `drive.*`; `tests/i18n-key-parity.test.ts`.
- Chạy app thật (Windows; mac theo backlog): nút hiện/ẩn, danh sách, mở trình duyệt đúng `authuser`, chuyển giao, offline; ảnh vào báo cáo lane (Q2).

Ước lượng desktop: B10 0,5d (lane uniwork) + D1–D4 6,5d (lane fork).

## Pha 4 — Kiểm thử và ra mắt

### Q1 — E2E web (Picker giả) — 1,5d
- `e2e/drive-connector.spec.ts`: kết nối (fake OAuth server trong môi trường test) → liên kết từ hộp tạo việc → đề xuất (fake gateway) → hộp duyệt → tạo lô → Kanban + toast; người thứ hai thấy `unknown`; bỏ liên kết ở 4.2.
- Contrast/focus của màn mới không làm hỏng năm spec onboarding.

### Q2 — Checklist thủ công trên Google thật (staging, test user) — 1d
- Consent chỉ `drive.file`; Picker nhiều tài khoản; `authuser`; thu hồi ở myaccount.google.com → "Mất kết nối"; admin Workspace chặn; tên miền; dùng chung; người thứ hai "Cho UniWork đọc tệp"; desktop: nút Drive, mở trình duyệt, chuyển giao kết nối/chọn tệp, offline ẩn nút.
- Ghi bằng chứng (ảnh, video ngắn) vào báo cáo lane.

### Q3 — Ra mắt — 0,5d
- Bật `drive_connector` cho tổ chức nội bộ → pilot → toàn bộ; runbook `docs/runbooks/drive-connector.md` + alert; trạng thái spec/plan → `shipped`.
- Điều kiện: E1 xong (verification đã duyệt, hoặc chấp nhận màn "unverified" cho pilot nội bộ ≤ 100 test user), web và desktop cùng qua Q2.

## Tổng ước lượng

| Pha | Ngày-người |
| --- | --- |
| Spike S1–S5 | 2,5 |
| Server B1–B9 | 14,25 |
| Web W1–W10 | 17,25 |
| Server cho desktop B10 | 0,5 |
| Desktop D1–D4 (lane fork) | 6,5 |
| Kiểm thử/ra mắt Q1–Q3 | 3 |
| **Tổng** | **44** |

Đường găng: E1 (thời gian chờ Google) song song với B1 → B2 → B4 → B5 → B6 → W7 → Q1 → Q3. Desktop không nằm trên đường găng: D1 bắt đầu sau B4 + B10, D3 chờ W2 và W8; với hai lane (uniwork, fork) chạy song song, lịch khoảng 4–5 tuần.

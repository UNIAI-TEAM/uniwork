# Connector Google Drive — Implementation Plan

> **Trạng thái:** in-progress — plan nháp, chờ người dùng ký duyệt spec `docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` (hitl gate); chưa cắt thẻ triển khai.

**Goal:** Người dùng kết nối Google Drive (nhiều tài khoản), liên kết tệp vào việc trên web và thấy cùng danh sách ở app desktop; UNI đọc tệp bằng quyền của chính người yêu cầu, đề xuất việc, người duyệt rồi việc được tạo.

**Architecture:** Server Go giữ token (secretbox), gọi Drive REST trực tiếp bằng `net/http` như Calendar; bảng riêng `drive_connections`, `drive_files`, `drive_file_access`, `drive_file_task_links`, `drive_task_proposals`, `drive_task_proposal_links` (không phải `documents`, ADR nháp 0038). Endpoint đề xuất theo mẫu `meeting_summary_tasks.go` + `ai.Gateway`. Web: `packages/core/drive` + `packages/views` (Picker, thẻ Drive, hộp duyệt, mục Google Drive). Desktop (fork `uniwork-office`): nút Google Drive ở sidebar Tài liệu qua cùng API, không giữ token Google, chuyển sang trình duyệt/web cho Picker, kết nối, tạo việc, Hỏi UNI.

**Tech Stack:** Go (Chi, pgx/sqlc, `golang.org/x/oauth2`, `go-oidc`), Next.js + TanStack Query + zod, Google Picker JS; Electron + Vitest (fork).

**Issue:** UNI-2172. Thẻ triển khai là sub-issue của UNI-2172, cắt sau khi người dùng duyệt (một thẻ mỗi nhiệm vụ, giữ mã nhiệm vụ trong tiêu đề).

---

## Quy ước

- Mã: `S` spike, `E` phụ thuộc ngoài, `B` server, `W` web, `D` desktop (fork), `Q` kiểm thử/ra mắt. Ước lượng là ngày-người (d) cho một người quen repo.
- Mỗi nhiệm vụ B/W/D theo TDD: test thất bại trước, rồi mã; lane chạy test đúng tệp; bộ đầy đủ chỉ trước PR vào `develop`.
- Màn prototype ghi trong ngoặc: 1.1 … 4.2 (tiêu đề artboard trong `canvas.json`).
- Lane: B và W thuộc lane repo `uniwork`; D thuộc lane fork `uniwork-office`. Web và desktop **ra cùng đợt** (QĐ 15): Q3 chỉ đóng khi cả hai qua Q2.
- Mỗi W tự thêm endpoint, schema (`parseWithFallback` + ca malformed) và hook mà màn của nó dùng — không có nhiệm vụ "core trước" riêng, vì `pnpm knip` không cho export chưa có người dùng.

## Phụ thuộc

| Nhiệm vụ | Cần xong trước |
| --- | --- |
| E1, S1–S6 | — (làm ngay, song song) |
| B1 | — |
| B2 | B1 |
| B3 | B2 |
| B4 | B3 |
| B5 | B4 |
| B6 | B5 |
| B7 | B5 |
| B8 | B3, B4 (DOCX/XLSX/PPTX cần B11) |
| B9 | B3 (cùng PR) |
| B10 | B4 |
| B11 | S6, B3 |
| W1 | B2 |
| W3 | B4, W1, S2 |
| W4 | W3 |
| W5 | W4 |
| W6 | B5, W4 |
| W7 | B6, W6 |
| W8 | B4, W3 |
| W9 | B8, W8 |
| W10 | — |
| D1 | B10 |
| D2 | D1 |
| D3 | D2, W1, W8 |
| D4 | D3 |
| Q1 | W1–W9 |
| Q2 | Q1, D4, E1 |
| Q3 | Q2 |

Đường găng: B1 → B2 → B3 → B4 → B5 → B6 → W7 → Q1 → Q2 → Q3, song song với thời gian chờ Google ở E1. Desktop (B10 → D1…D4) chạy song song ở lane fork, chỉ chờ W1 và W8 cho bước chuyển giao.

## Pha 0 — Spike và phụ thuộc ngoài (làm trước, song song)

### E1 — Dự án Google Cloud, OAuth client Drive, brand verification (phụ thuộc ngoài)
- Tạo client OAuth "UniWork Drive" (web), bật Drive API + Picker API, developer key giới hạn referrer, lấy project number.
- Màn consent: tên, logo, domain đã xác minh, privacy policy + terms URL công khai, scope `openid email drive.file`.
- Nộp brand verification. **Thời gian chờ: vài phút đến 2–3 ngày làm việc** (QĐ 14); trong lúc chờ dùng chế độ Testing (≤ 100 test user). Không xin scope restricted nào (không CASA).
- Người làm: chủ tài khoản Google Cloud của tổ chức (người dùng/ops). 0,5d công + thời gian chờ Google.
- Xong khi: năm giá trị env có trong secret store của staging; trạng thái verification ghi vào spec §5.1.

### S1 — Chọn thư mục có cấp quyền cho tệp con dưới `drive.file`? (QĐ 3) — 0,5d
- Tài khoản thử, Picker cho chọn thư mục; dùng refresh token server gọi `files.list q='<folder>' in parents` và `files.get` tệp con; tệp con thêm sau có thấy không.
- Kết quả chỉ để quyết định roadmap "liên kết thư mục"; v1 không đổi.

### S2 — `setFileIds`, view Picker và quyền cho người thứ hai (QĐ 5) — 0,5d
- A chia sẻ tệp cho B; B (kết nối riêng) mở Picker `DocsView().setFileIds(id)` → Picker hiện đúng tệp, B chọn → server bằng token của B `files.get` thành công.
- B **không** có quyền trên Drive: Picker hiện gì → câu chữ §7.4.
- Xác nhận các view "tệp của tôi", "được chia sẻ với tôi", Bộ nhớ dùng chung (`setEnableDrives`) dưới `drive.file`, `setLocale('vi')`, và chip dán URL (§7.5).
- Không làm được: chuyển §7.4 sang phương án dự phòng (view "được chia sẻ với tôi" + ô tìm tên), sửa spec trước W3.

### S3 — Export, giới hạn, metadata dưới `drive.file` — 0,5d
- Đo `files.export` cho Docs (`text/markdown`), Sheets (`text/csv`), Slides (`text/plain`) trên tài liệu 50 trang.
- `files.get` trả `shared`, `owners`, `permissions`, `lastModifyingUser`, `driveId` gì cho tệp của người khác và tệp trong Bộ nhớ dùng chung (§6.2).
- PDF 10 MiB ở `Attachments` của gateway với provider mặc định.

### S4 — Hình dạng lỗi Google (QĐ 13) — 0,5d
- Workspace thử chặn app trong Admin console: ghi `error`/`error_subtype` ở callback và `reason` của lỗi API.
- Ghi `reason` thật cho: tệp chưa cấp cho app (`appNotAuthorizedToFile`), mất quyền, hạn mức (`rateLimitExceeded`/`userRateLimitExceeded` ở 403 và 429). Bảng §5.7 sửa theo kết quả.
- Người dùng bỏ tick `drive.file` ở consent thì phản hồi token trả scope gì.

### S6 — office-engine trích văn bản DOCX/XLSX/PPTX (Q8) — 0,5d
- Engine hôm nay chưa có thao tác trích văn bản (handler: `open/edit/serialize:xlsx|pdf`, `serialize:md|html`, `convert:xls|odt`, `export:docx`; `apps/office-engine/src/worker/handlers.ts`). Xem `@uniwork/office-engine` đã có bộ đọc DOCX/PPTX/XLSX nào dùng lại được, hay cần thư viện mới (catalog, `pnpm audit`).
- Đo thời gian trích trên tệp 20 MiB mỗi loại; xác nhận trả văn bản inline trong trạng thái job cuối (≤ 1 MiB) không vướng giới hạn khung, không cần đích output (spec §8.3a).
- Kết quả ghi vào spec §8.3a trước B11.

### S5 — Đăng nhập Google trong Electron và đường chuyển giao desktop → web (QĐ 15) — 0,5d
- Mở consent Google trong `BrowserWindow` của app: xác nhận Google chặn ("This browser or app may not be secure").
- Xác nhận đường chuyển giao: `openWeb` tới `…/settings?tab=integrations&connect=drive` và `…/documents?view=drive&pick=1`; web chỉ đặt focus, người dùng bấm (spec §7.11); app làm mới khi cửa sổ lấy lại focus.

## Pha 1 — Server

### B1 — Migration + sqlc: kết nối và hàng đợi thu hồi — 1d
- `drive_connections` (§6.1; unique không điều kiện `(organization_id, user_id, google_sub)`, index `google_sub` một phần), `drive_grant_revocations` (§6.8, có `generation`, `refresh_token_enc`, `attempt_id`, `attempt_started_at`, `resolved_at`, hai cột bằng chứng `last_*`; `tenantExemptTables` có lý do); mỗi index một file `CONCURRENTLY`.
- Query `server/pkg/db/queries/drive_connections.sql` ràng buộc `organization_id` bằng tham số.
- Test: `server/migrations/lint_test.go`, `TestEveryQueryNamesItsTenant`.

### B2 — OAuth kết nối, refresh, ngắt, vòng đời (1.1–1.3, QĐ 4, 13) — 4,5d
- `server/internal/service/drive_connections.go` (Start, Complete, List, Disconnect), `drive_oauth_refresh.go` (mẫu `email_hub_oauth_refresh.go:19-128`). Không có chính sách tổ chức (Q1, Q2 chốt): không kiểm `hd`, không chặn tài khoản Google dùng chung.
- Start/list theo workspace (`RequireMember` → tổ chức, spec §5.2); state niêm phong có nonce OIDC, `target_connection_id`, `expected_sub`.
- Callback: ngoài nhóm có phiên nhưng đăng ký qua wrapper `api` với `apiOp` (HTML) và limiter credential, như `registerEmailHubCallback` (`handler/router/email_hub.go:200-216`); xác minh id_token bằng `go-oidc` như `server/internal/auth/google.go:24-73` (issuer, audience = client Drive, hạn, nonce, `email_verified`); từ chối thiếu `drive.file` (`scope_not_granted`), sai tài khoản khi kết nối lại (`account_mismatch`); hồi sinh dòng cũ theo `(org, user, sub)`; **không thu hồi token khi thay**; ngắt kết nối chuyển refresh token mã hóa sang `drive_grant_revocations` trong transaction; job thu hồi ba trạng thái (chờ → đang thu hồi → xong) với lease theo dòng và kết quả chỉ ghi vào đúng `(generation, attempt_id)`, upsert khi ngắt theo bảng chuyển trạng thái §5.3b, và callback điều phối bằng khóa toàn cục `drive_grant:<google_sub>`; callback trả `retry_connect` khi dòng đang thu hồi hoặc `last_attempt_started_at` hay `last_resolved_at` muộn hơn lúc nó bắt đầu đổi code, và không bao giờ xóa yêu cầu đã bắt đầu gọi Google; bỏ cuộc sau 24 giờ có cảnh báo `DriveRevocationAbandoned` + runbook (spec §5.3, §5.3b, §6.8).
- Vòng đời §5.3a: ngắt trong transaction rời tổ chức, vô hiệu hóa, xóa tài khoản; trong transaction đóng tổ chức và `closeQ` dùng cho chuyển tổ chức (`organization_close.go:19-47`), thu hồi sau commit (`:106-128`).
- Route: `POST /workspaces/{workspaceID}/drive-connections/google/start`, `GET /drive-connections/google/callback`, `GET /workspaces/{workspaceID}/drive-connections`, `DELETE /workspaces/{workspaceID}/drive-connections/{driveConnectionID}`.
- Config + env (5 biến) + `.env.example`; flag `drive_connector` (`keys.go`, `review_at` 2027-04-30); `GET /api/v1/config` báo `drive.available`.
- Audit + outbox: `drive_connection.connected|reconnected|refused|auth_failed|disconnected` (metadata `google_email` + `google_sub`, actor người UniWork — hai danh tính, Q2); `drive_connection.changed` (ScopeUser) vào ba catalogue.
- Test: fake Google token + JWKS endpoint (nonce cookie/OIDC sai, issuer/audience/hạn sai, không refresh token, thiếu scope, hai người UniWork cùng một `sub` đều kết nối được và audit ghi hai danh tính, ngắt của một người không thu hồi khi người kia còn giữ, `admin_policy_enforced`, sai tài khoản khi kết nối lại), kết nối lại cùng `sub` không gọi revoke, ngắt khi còn/không còn chủ sống khác, tranh chấp thu hồi ↔ callback cùng `sub` (cùng và khác tổ chức; thu hồi bị giữ giữa lúc đếm và gọi Google; callback đổi code trước rồi thu hồi chen giữa; Google xử lý revoke rồi mất phản hồi; Google thành công rồi transaction ghi kết quả lỗi; thứ tự t1 lần thử → t2 callback đổi code → t3 Google revoke → t4 ghi `last_resolved_at` → t5 callback lưu bị từ chối; hai worker cùng dòng, kết quả trễ, kết nối lại → ngắt lần nữa → worker thứ ba bị giữ), ngắt → khởi động lại → worker thu hồi bằng token đã lưu, hủy yêu cầu khi còn chủ sống xóa token, `TestDriveRevocationTokenOnlyRevokes`, ngắt → kết nối lại giữ id, refresh fence hai goroutine, `invalid_grant`; mỗi sự kiện vòng đời; tài khoản cũ thuộc hai tổ chức chỉ thấy kết nối của tổ chức trong đường dẫn; `audit_coverage_test.go`; `isoRoutes` (callback `isoPublic`/`reasonProvider`); rate limit trong `router_test`.

### B3 — Client Drive REST, ánh xạ lỗi, đọc nội dung — 1d
- `server/internal/service/drive_api.go`: `filesGet`, `revoke`, ánh xạ lỗi theo `reason` (spec §5.7: `appNotAuthorizedToFile` → `drive_grant_required`, `domainPolicy` → admin chặn, mất quyền → `drive_file_not_accessible` + ghi `lost`, hạn mức/5xx → `drive_unavailable` không đổi trạng thái); client 15 s, không theo redirect ra ngoài host Google.
- `server/internal/service/drive_content.go`: `ReadForAI(ctx, requester, workspaceID, driveFileID)` — duy nhất gọi `files.export`/`alt=media` (§8.3), tra kết nối qua `drive_file_access` của người yêu cầu, từ chối tệp ngoài workspace. Nhánh DOCX/XLSX/PPTX (tải ≤ 20 MiB trong bộ nhớ → engine) nằm ở B11.
- Test: bảng định dạng, cắt 200.000 ký tự, PDF thành media part, `drive_format_unsupported`, từng `reason` của S4; `TestDriveContentReadsUseTheCallersConnection`; arch test `TestDriveContentOnlyFromDriveContent`.

### B4 — Tham chiếu: migration, liên kết, danh sách của tôi, chi tiết, bỏ, rebind, quyền người xem (2.x, 4.x) — 4d
- Migration `drive_files` (có `bound_by`, `drive_id`, `drive_modified_by_display`, `sharing_state`), `drive_file_access`, `drive_file_task_links` (§6.2–6.4) + index.
- `service/drive_files.go`: `Link` (advisory lock `(workspace_id, external_file_id)`; người gọi đã có dòng truy cập → `already_linked` với email của chính họ; chưa có → thêm dòng `granted`, trả `linked`, không lộ người khác; luật ghi đè §6.3), `ListMine` (chỉ tệp người gọi có dòng `drive_file_access`, lọc `connection_id` theo dòng truy cập; spec §7.6, §7.6a), `Get` (cổng §7.6a: có dòng truy cập **hoặc** xem được một việc gắn tệp, không thì 404; + `can_unlink`, `can_rebind`, `viewer_account_email`, `bound_by_id`, `bound_by_name`, `created_by_name`; thẻ và 4.2 hiện tài khoản gắn theo `bound_by`), `ListForTask` (cổng đọc việc, mọi người xem được việc), `ListForTask`, `Unlink`, `RemoveFromTask`, `GrantAccess`, `ChangeReadAccount` (`PUT …/access`), `Rebind` (kết nối phải thuộc người gọi, chỉ đổi dòng truy cập của người gọi, đặt `bound_by`), `use_rebind` khi người giữ kết nối gắn đổi tài khoản đọc, làm mới metadata bằng kết nối của người đang xem (≤ 1 lần/10 phút), dựng `open_url` §7.8.
- `CreateTaskSDI.drive_files` + gọi `Link` trong transaction tạo việc (`service/task.go`); một tệp lỗi → cả lệnh lỗi kèm chỉ số tệp.
- Route §7.2–7.7: `POST|GET /workspaces/{workspaceID}/drive-files`, `GET|DELETE /workspaces/{workspaceID}/drive-files/{driveFileID}`, `POST|PUT …/{driveFileID}/access`, `POST …/{driveFileID}/rebind`, `GET /tasks/{taskID}/drive-files`, `DELETE /tasks/{taskID}/drive-files/{driveFileID}`, `POST /workspaces/{workspaceID}/drive-connections/{driveConnectionID}/picker-token`. SDI/SDO có `description`/`example`; `pathParamSDI` cho `driveConnectionID`, `driveFileID`.
- Audit + outbox: `drive_file.linked|access_granted|access_changed|access_lost|unlinked|rebound` (resource `drive_file`), `task.drive_file_linked|drive_file_unlinked` (resource `task`); sự kiện `drive_file.linked|access_changed|task_linked|unlinked|updated`.
- Isolation (spec §13): ánh xạ thật cho `{driveConnectionID}`, `{driveFileID}` trong ma trận (`isolation_matrix_test.go:503-516`, phân loại mixed-ID), seed own/foreign mỗi bảng, `isoReferences` cho mọi `*_id` trong body, miễn có lý do cho `external_file_id(s)`.
- Test luật thấy §7.6a: danh sách chỉ của mình (admin không thấy tệp của người khác), thẻ trên việc cho khách/người theo dõi xem được việc, 4.2 → 404 khi không có dòng truy cập và không xem được việc nào gắn tệp, "Đang dùng ở" chỉ việc thấy được, người thứ hai liên kết cùng tệp nhận `linked` không lộ email người đầu. Quyền (sửa việc, người liên kết/`bound_by`/admin), khử trùng giữa hai tài khoản của một người (dòng truy cập không đổi, token đọc vẫn là tài khoản cũ) và giữa hai người, A liên kết rồi admin B rebind (dòng của A vẫn trỏ kết nối của A; token đọc của từng người đúng chủ), người liên kết gốc mất quyền rồi chọn lại bằng tài khoản khác, `PUT access` của `bound_by` → 409 `use_rebind`, mất quyền của kết nối gắn phát `drive_file.updated` cho workspace (người thứ hai đang mở 4.2 được làm mới), thành viên bị vô hiệu hóa, events catalogue.

### B5 — Đề xuất việc: capability, prompt, endpoint, cổng lô (3.1–3.3) — 3d
- `ai/policy.go` thêm `CapDriveTaskProposals` + policy; `ai/prompts.go` `drive_task_proposals@1` với `OutputSchema` (§8.2), nội dung bọc không tin cậy.
- Migration `drive_task_proposals` (§6.5, `items` NULL được, `status_changed_at`), `drive_task_proposal_links` (§6.6 đủ cột, có `external_file_id`, unique `(proposal_id, item_index)`, index `(workspace_id, external_file_id, created_at)` một file `CONCURRENTLY`).
- `service/drive_task_proposals.go`: `Propose` (§8.2 bước 1–6, kiểm lại trong transaction theo thứ tự khóa §8.2b), `Duplicates`, `Discard` (`items = NULL`); cổng lô §8.2a dùng chung cho mọi route `{proposalID}`. Route `POST /workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals`, `GET|DELETE /workspaces/{workspaceID}/drive-task-proposals/{proposalID}`, `POST …/{proposalID}/duplicates`; rate limit `drive-proposals`; `pathParamSDI` + ánh xạ ma trận cho `{proposalID}`.
- Test với fake gateway: id lạ, ngày sai, vòng `blocked_by`, basis trống, trùng, `assignee_drive_access`, 409 `drive_access_required`, `TestDriveProposalOnlyItsRequester` (cùng workspace khác người → 404 ở cả bốn route), tranh chấp: giữ lượt AI giả rồi ngắt kết nối / bỏ liên kết → không có lô `ready`; audit `drive_file.read` có `google_email`; không nội dung trong log (`scripts/no-pii-log.test.mjs`).

### B6 — Tạo lô từ đề xuất + "đã tạo việc từ tài liệu" (3.3 → 3.4, Q5) — 3,25d
- `setDependencyTx(ctx, q, …)` trong `service/task_graph.go`: nhận `q` của transaction và hai việc đã xác thực, dùng chung kiểm vòng và dựng sự kiện với `SetDependency` (`:236-305`), không tự mở transaction.
- `CreateTasksFromProposal` qua `TaskService.CreateManyWith` (`service/task.go:390`): `Before` (cổng §8.2a, khóa §8.2b, nguồn còn sống, đã tạo, workspace của người/dự án/cha/nhãn, trùng theo lô như `refuseSummaryDuplicates`, phụ thuộc trong lô không vòng), `task.created` có `metadata.source = "drive_task_proposal"`, `After` (`setDependencyTx`, `drive_file_task_links`, `drive_task_proposal_links` (có `external_file_id`), lô `converted` + `items = NULL`, audit `drive_task_proposal.tasks_created`, outbox `drive_task_proposal.converted`).
- Route `POST /workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks`.
- "Đã tạo việc từ tài liệu" (spec §8.8): `tasks_created` trên `Get` và từng thẻ của `ListForTask`, `task_creations` (nhóm theo `proposal_id`, ≤ 10 lần) trên `Get`, `prior_creations` trên phản hồi đề xuất; đọc `drive_task_proposal_links` theo `(workspace_id, external_file_id)`, chỉ việc người xem thấy được; `drive_task_proposal.converted` vô hiệu khóa Drive của workspace.
- Test: 409/410, `allow_duplicate`, thứ tự khóa, phụ thuộc, **rollback toàn phần** khi bước phụ thuộc lỗi (không việc, cạnh, liên kết, audit, outbox nào còn), trích đoạn trong mô tả việc còn nguyên sau khi lô bị xóa (Q3), "đã tạo việc": đếm đúng sau khi lô bị job xóa, còn sau bỏ liên kết rồi liên kết lại, ẩn việc người xem không thấy, isolation (`items[].assignee_id`, `items[].label_ids`, `project_id`, `parent_task_id`).

### B7 — Lưu giữ đề xuất (Q3) — 0,5d
- Job lane chậm mỗi giờ (§8.6): mỗi vòng một transaction `DELETE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 500)`; đăng ký trong trình tự tắt của `cmd/server/main.go`; metric `drive_task_proposals_purged_total`, không audit mỗi vòng (mẫu `document_retention_sweep.go`).
- Test: xóa đúng tập (hết hạn, đã xử lý), hai worker không xóa trùng.

### B8 — Hỏi UNI chế độ tạm thời với focus `drive_file` (3.2, Q10) — 2,75d
- Focus `drive_file` trong `service/askuni_context.go` (tệp thuộc workspace của lượt hỏi, người hỏi `granted`); nạp nội dung một lần ở lượt đầu qua `drive_content.ReadForAI` (PDF ở `Attachments` lượt đầu); chạy ở cả đường mặc định và đường agent (`ask_uni_agent`).
- Chế độ `transient` (spec §9): `AskUniSDI` (`handler/dto/sdi/ai.go:9-18`) thêm `transient`, `transcript` có giới hạn; service bỏ qua tạo hội thoại, tin nhắn, trích dẫn ở cả đường mặc định (`askuni.go:259`, `:336`, `:609-636`) và đường agent (`askuni_agent.go:327`), dùng `transcript` làm `History` không tin cậy, trích dẫn chỉ trong phản hồi, kiểm lại focus và đọc lại tệp mỗi yêu cầu; audit `drive_file.read` (`purpose = ask_uni`).
- Test: `TestAskUniDriveFocusIsNotPersisted` (hai câu hỏi liên tiếp, flag `ask_uni_agent` tắt và bật, không dòng hội thoại/tin nhắn/trích dẫn nào), `transient` + `conversation_id` → 400, route stream (`ai_stream.go`) ở chế độ tạm thời: frame `run` có `conversation_id` rỗng, người dùng dừng giữa chừng không để lại dòng nào, focus `drive_file` thiếu `transient` → 400, bản chép quá giới hạn → 400, người hỏi chưa có quyền → câu trả lời nói rõ, không lỗi; cả hai trạng thái flag `ask_uni_agent`; văn bản và PDF; `TestAskUniToolsAreReadOnly` và `TestAskAgentToolsAreReadOnly` vẫn qua (không thêm tool).

### B9 — ADR 0038 accepted + luật CLAUDE.md — 0,25d (cùng PR với B3)
- Chuyển ADR ra `docs/adr/`, bảng README, mục Audit and Events của `CLAUDE.md` nêu tên test; `scripts/governance.test.mjs`.

### B11 — Trích văn bản DOCX/XLSX/PPTX qua office-engine (Q8) — 4d
- Engine (`apps/office-engine/`): thao tác `extract_text` cho `docx`, `xlsx` (trang tính đầu → CSV), `pptx` (chữ slide + ghi chú); kết quả inline trong trạng thái job cuối (≤ 1 MiB), không đích output, thư mục job dọn như mọi job; hàng capability; hợp đồng `@uniwork/office-contracts`. Thư viện theo S6.
- Go: hợp đồng `server/internal/office/contract.go` (thao tác, grant scope `drive_extract` mang `drive_file_id` + workspace thay `DocumentID`, không `InputObjectKey`), `drive_content.ReadForAI` nhánh Office: tải bằng kết nối của người yêu cầu, `Submit` với `InputSource` trong bộ nhớ, chờ `Status` tối đa 60 s, lỗi `drive_extract_unavailable` (503) và lớp lỗi mở của engine (mật khẩu, hỏng → 422).
- Test: engine (vitest) ba định dạng + tệp hỏng/mật khẩu + vượt 1 MiB bị cắt; Go với engine giả: thành công, hết hạn, engine tắt, `TestDriveOfficeExtractWritesNoObject`; B5/B8 thêm một ca DOCX.

### B10 — Server cho desktop — 1d
- Trường `drive_connector` (flag cho tổ chức/người **và** provider Drive sẵn sàng) trong `service/office_app_capabilities.go` (inject trạng thái provider vào service), SDO `handler/dto/sdo/office_capabilities.go` và ánh xạ ở `handler/office_capabilities.go:35-42`.
- `picker-token` từ chối phiên desktop (`middleware/auth.go:37-45`, `:95-101` đã phân biệt): `TestDrivePickerTokenRefusesDesktopSession`; phiên web vẫn được.
- Test HTTP: `drive_connector` với flag tắt/bật, provider có/không, override theo người.

## Pha 2 — Web

### W1 — Cài đặt › Tích hợp: kết nối, tài khoản, ngắt (1.1, 1.3) — 3d
- Endpoint/schema/hook kết nối trong `packages/core/api/endpoints/drive.ts` + `packages/core/drive/` (ca malformed); `drive.available` vào schema config công khai + `EMPTY_CONFIG`; `packages/core/realtime/drive-events.ts` + một lời gọi trong `use-realtime-sync.ts` + `packages/core/types/events.ts`.
- Hàng Google Drive ở `packages/views/settings/components/integrations-tab.tsx` (flag + `drive.available`) qua `use-oauth-popup.ts`; màn "Đã kết nối" với khối "UNI được làm gì", thẻ từng tài khoản (Mất kết nối · kết nối lại, Ngắt kết nối), **Kết nối thêm tài khoản**; câu cho mọi mã callback.
- `?connect=drive` chỉ chọn tab và đặt focus vào hàng Drive, rồi xóa khỏi URL (spec §7.11).
- i18n vi/en + thuật ngữ `docs/conventions.md` (§7.9).
- Test: hiện/ẩn theo flag, từng mã kết quả popup, popup bị chặn, nhiều tài khoản, tham số URL không mở popup.

### W2 — (bỏ) Chính sách tổ chức
- Bỏ theo Q1, Q2 (2026-10-26): không có cài đặt tên miền hay tài khoản dùng chung. Giữ mã W2 để số nhiệm vụ không đổi.

### W3 — Picker (2.2) — 1,5d
- `packages/views/integrations/drive-picker/` (tải script, `picker-token`, chọn nhiều, không thư mục, view theo S2, `setLocale`, `setFileIds`), bước chọn tài khoản (tài khoản hỏng bị khóa) với câu "UniWork chỉ được quyền với tệp bạn chọn…", hộp xác nhận tên tệp khi gắn vào việc (Q6, "Tên tệp sẽ hiện cho người xem được việc này"), trạng thái lỗi §7.10 (script không tải, token lỗi).
- Adapter giả cho test và e2e (không gọi Google). Không đổi header web (không có CSP trang).

### W4 — Việc: kẹp giấy, Đính kèm, thẻ Drive, người khác mở (2.1, 2.3, 2.4) — 4,25d
- Giao diện theo thiết kế đã duyệt (Q4: prototype 2.1, 2.3).
- `create-task-manual-panel.tsx`: kẹp giấy thành menu "Tải tệp lên" / "Từ Google Drive" (N tài khoản) chỉ khi Drive khả dụng; chip Drive trong nháp; gửi `drive_files`; lỗi một tệp giữ nháp và đánh dấu chip.
- `attachments-section.tsx`: hàng tiêu đề "Đính kèm" + "Thêm tệp" luôn có khi người xem thêm được, thân rỗng `attachments_empty`, hai danh sách tải độc lập; en "Upload" → "Add file".
- Thẻ Drive (Mở trên Google Drive / Tạo việc từ tài liệu / Hỏi UNI / ⋯ Xem trong Tài liệu, Bỏ liên kết), bốn trạng thái người xem (§7.4), dòng "Đã tạo N việc từ tài liệu" (§8.8), icon loại tệp mở rộng `document-type-icon.tsx`.
- Khóa locale `audit.actions.task.drive_file_*`, `resources.drive_file`; dòng Hoạt động.
- Test: views test (transport mock), `aria-disabled`, rỗng/lỗi/đang tải, i18n literal lint.

### W5 — Dán URL Drive (QĐ 8) — 1d
- Mở rộng Tiptap nhận URL Drive khi dán, chip "Liên kết tệp Google Drive này vào việc?" → Picker `setFileIds` (W3); câu gợi ý mới (§7.5).
- Test: các dạng URL, URL khác không có chip.

### W6 — Agent mode gửi tệp Drive + cảnh báo tạo lại (3.1, Q5) — 2d
- `create-task-agent-panel.tsx`: có chip Drive → hàng "Tạo bởi UNI" thay `AgentPicker`, không đòi `selectedAgent`, ẩn nút độ ưu tiên/hạn/tải tệp; dự án, "Task con của", dòng tài khoản đọc; trạng thái chờ "UNI đang đọc tài liệu…" + Hủy, câu lỗi §8.2.
- Popover "Tạo việc từ tài liệu" (thẻ Drive, 4.2, Hỏi UNI; spec §8.1): dòng tài khoản đọc, prompt tùy chọn, **Gửi cho agent**; dùng cùng hook. `?propose=1` mở popover này.
- Cảnh báo tạo lại (spec §8.8) ở popover và agent panel khi `tasks_created.count > 0`: câu cảnh báo, **Xem các việc đã tạo**, nút chính **Vẫn gửi cho UNI**; hộp duyệt (W7) hiện dòng `prior_creations`.
- Test: không có chip → hành vi cũ; có chip → gửi được khi không có agent nào; có/không có việc đã tạo → có/không cảnh báo, cảnh báo không chặn gửi.

### W7 — Hộp duyệt + toast (3.3, 3.4) — 4d
- `packages/views/tasks/drive-proposals/` (tách dưới 500 dòng mỗi tệp): trường cả lô + dòng phụ, từng việc (công tắc có nhãn), basis "UNI · …" (`text-warning`), trùng (Bỏ việc này / Vẫn tạo, tính lại khi đổi dự án/cha), "Bị chặn bởi", người phụ trách chưa có quyền Drive, dựng mô tả (mục tiêu + checklist + trích đoạn + liên kết; không cảnh báo, không tùy chọn bỏ trích đoạn — Q3), "Tạo N việc" / "Chọn ít nhất 1 việc", đóng hộp hỏi "Bỏ đề xuất này?".
- Toast "Đã tạo N việc từ <tài liệu>, là sub-task của <cha>" + "Xem <cha>".
- Truy cập §8.7: bẫy focus, sheet trên màn nhỏ, `aria-live`, 44px.
- Test: đủ trạng thái hộp duyệt; e2e ở Q1.

### W8 — Tài liệu › Google Drive của tôi và trang tệp (4.1, 4.2) — 4d
- `LibraryView` thêm `{kind: "drive", account}`; URL `…/documents?view=drive[&account=…]` + builder `packages/core/paths/` (`consistency.test.ts`); `?pick=1` chỉ đặt focus vào nút "Thêm từ…".
- `documents-sidebar.tsx`: nút Google Drive dưới "Thư mục của tôi" (ẩn khi flag `documents` tắt hoặc chưa kết nối), con theo tài khoản (không có "Người khác liên kết", Q6), `aria-current`.
- Màn danh sách chỉ tệp của người xem (bảng `table`, cột §7.6 gồm "Đã tạo việc", tiêu đề/dòng phụ "Chỉ bạn thấy danh sách này", "Thêm từ Google Drive" / "Thêm từ <email>", `CollectionPageState` rỗng/lỗi).
- Thẻ trên việc và 4.2 hiện tài khoản gắn theo `bound_by` (spec §6.2), kèm "(gắn lại bởi <tên>)" khi khác người liên kết.
- Trang `documents/drive/[driveFileId]/page.tsx`: Tài khoản gắn (theo `bound_by`, kèm hậu tố gắn lại) + Bạn mở bằng, Đang dùng ở, Gắn vào việc, khối "Việc đã tạo từ tài liệu" (§8.8), Hoạt động (`useResourceHistory(wsId, "drive_file", id)`), Bỏ liên kết (xác nhận, `can_unlink`), Liên kết lại (`can_rebind`), `?propose=1` / `?ask=1` chỉ mở UI.
- Test: views test từng trạng thái §7.10; 404 của 4.2 hiện như tài liệu không tồn tại.

### W9 — Hỏi UNI với tệp Drive (3.2) — 3d
- `drive_file` vào `AskUniPanelFocus.kind` (`packages/core/ai/store.ts`), khóa `ai.ask_about_drive_file`, mở bằng `useAskUniOpener`; chip ngữ cảnh, dòng tài khoản đọc, chân panel "…cuộc trò chuyện này không được lưu"; chế độ tạm thời: bản chép trong store của core (không qua `useAiMessages(conversationId)` của `ask-uni-thread.tsx`), endpoint gửi `transient` + `transcript` mỗi câu hỏi (schema + case malformed), hợp đồng stream spec §9 (`ai-stream.ts:25` nhận `conversation_id` rỗng; `use-ask-uni-stream.ts` không ghi/vô hiệu `aiKeys.messages` khi `done`, `stop()` không thăm lại 1.500 ms), ẩn phản hồi/tạo lại, cửa sổ trượt 20 lượt/32.000 ký tự, đóng panel/đổi focus/chọn lịch sử/hội thoại mới xóa bản chép; không thêm mục vào danh sách lịch sử; test hai câu hỏi, dừng giữa chừng, lượt thứ 21 trượt cửa sổ, đổi focus; trích dẫn trỏ tới trang 4.2; gợi ý "Tạo việc từ tài liệu này".

### W10 — Roadmap và thuật ngữ — 0,25d
- Dòng roadmap cho Drive (comment `PLANNED` của `integrations-tab.tsx` yêu cầu); rà `docs/conventions.md`.

## Pha 3 — Desktop (fork `uniwork-office`, lane fork)

Đối chiếu fork `659b5e8b0`; đường dẫn tính từ `apps/shell/`. Lane fork theo luật fork hiện hành (eslint phạm vi đã chạm, đọc CI fork sau push).

### D1 — Client + IPC Drive trong main/preload — 1,5d
- Kênh mới trong `src/shared/home-api.ts` (cạnh `UNIWORK_DOC_CHANNELS`, `:1795`): `uniwork-drive:list-connections`, `:list-files`, `:get-file`, `:unlink`, `:open-on-google`; kiểu trong `HomeApi` (`:1156`); preload (`src/preload/index.ts`, mẫu `:1134-1160`, `asUniworkResult`); kênh thêm `uniwork-drive:get-history` (route lịch sử audit theo resource `drive_file`); `ipcMain.handle` trong `src/main/uniwork-drive/wiring.ts` theo mẫu `uniwork-work/wiring.ts:80-89`; client qua `createUniworkSend` (`src/main/uniwork-docs/client.ts:445-470`).
- `open-on-google`: main lấy `open_url` từ server, kiểm `https` + host `docs.google.com`/`drive.google.com`, `shell.openExternal`; renderer không truyền URL.
- Capability `drive_connector` tùy chọn trong `parseCapabilities` (thiếu = `false`), `false` ở `NEVER_READ_CAPABILITIES` và khi quá hạn (`uniwork-sync/capability/cache.ts`).
- Test (Vitest, node): host lạ bị từ chối, lỗi mạng → `network`, phản hồi hỏng không ném, body capability thiếu trường vẫn hợp lệ.

### D2 — Sidebar + danh sách Drive (4.1 trên app) — 2d
- `documents-home-model.ts`: id `google-drive`, nguồn `drive`, mục con động theo kết nối (không có "Người khác liên kết"); nhánh loader (`:422/451/489`).
- `DocumentsHome.tsx`: mục dưới "Thư mục của tôi", icon trong `SubNavIcon`, bảng cột §17.2 (gồm "Đã tạo việc"), "Mất kết nối · kết nối lại", rỗng/lỗi như web, offline "Cần kết nối mạng…" trong phiên đã thấy nút, ẩn khi khởi động lạnh offline, làm mới khi focus; không toggle offline trên dòng Drive.
- Test: `tests/uniwork-documents-home-model.test.ts` (hiện/ẩn theo capability + kết nối, lọc tài khoản), `tests/uniwork-documents-home-ui.test.ts` (jsdom: chọn mục, offline hai trường hợp, mất kết nối).

### D3 — Panel chi tiết + bỏ liên kết + chuyển giao (4.2 trên app, Q9) — 2,25d
- Panel phải mới trong DocumentsHome theo bố cục `UniworkDocInfoPanel.tsx` (§17.3): Tài khoản gắn (theo `bound_by`, khóa `uhDriveReboundBy`), Bạn mở bằng, khối "Việc đã tạo từ tài liệu" (§8.8), …; cảnh báo tạo lại trước khi chuyển sang web để tạo việc; "Bỏ liên kết" với hộp xác nhận, ẩn khi `can_unlink = false`.
- `webPathOf` + `WorkWebTarget` (`src/shared/uniwork-work-api.ts:174-177`): đích `drive-pick` (`/documents?view=drive&pick=1[&account=]`), `drive-connect`, `drive-file` (`action` `propose`|`ask`|không).
- Test: `webPathOf` từng đích (id sai → `null`), panel đủ trường, bỏ liên kết gọi IPC và làm mới.

### D4 — i18n 21 ngôn ngữ + chạy app thật — 1d
- Khóa §17.6 trong `src/renderer/src/i18n/uniwork-home/zh.ts` và 20 locale; vi/en lấy từ web `drive.*`; `tests/i18n-key-parity.test.ts`.
- Chạy app thật (Windows; mac theo backlog): nút hiện/ẩn, danh sách, mở trình duyệt đúng `authuser`, chuyển giao, offline; ảnh vào báo cáo lane.

## Pha 4 — Kiểm thử và ra mắt

### Q1 — E2E web (Picker giả) — 1,5d
- `e2e/drive-connector.spec.ts`: kết nối (fake OAuth) → liên kết từ hộp tạo việc → đề xuất (fake gateway) → hộp duyệt → tạo lô → Kanban + toast; người thứ hai thấy `unknown`; danh sách 4.1 của người thứ hai không có tệp của người đầu cho tới khi họ cho UniWork đọc; tạo lần hai hiện cảnh báo và khối "Việc đã tạo"; bỏ liên kết ở 4.2 làm mới thẻ trên việc đang mở.
- Tương phản/focus màn mới; năm spec onboarding vẫn qua.

### Q2 — Checklist thủ công trên Google thật (staging, test user) — 1d
- Consent chỉ `drive.file`; bỏ tick scope; Picker nhiều tài khoản và Bộ nhớ dùng chung; UNI đọc DOCX, XLSX, PPTX thật trên Drive; `authuser`; thu hồi ở myaccount.google.com → "Mất kết nối"; admin Workspace chặn; Gmail cá nhân và tài khoản Workspace đều kết nối được; hai người UniWork một tài khoản Google; người thứ hai "Cho UniWork đọc tệp"; desktop: nút Drive, mở trình duyệt, chuyển giao kết nối/chọn tệp, offline.
- Bằng chứng (ảnh, video ngắn) vào báo cáo lane.

### Q3 — Ra mắt — 0,5d
- Bật `drive_connector` cho tổ chức nội bộ → pilot → toàn bộ; runbook `docs/runbooks/drive-connector.md` + alert; trạng thái spec/plan → `shipped`.
- Điều kiện: E1 xong (verification đã duyệt, hoặc chấp nhận màn "unverified" cho pilot nội bộ ≤ 100 test user), web và desktop cùng qua Q2.

## Tổng ước lượng

| Pha | Ngày-người |
| --- | --- |
| Spike S1–S6 | 3 |
| Server B1–B11 | 25,25 |
| Web W1–W10 | 23 |
| Desktop D1–D4 (lane fork) | 6,75 |
| Kiểm thử/ra mắt Q1–Q3 | 3 |
| **Tổng** | **61** |

E1 không tính (công 0,5d + thời gian chờ Google). Với một lane `uniwork` hai người (BE + FE) và một lane fork, lịch khoảng 6 tuần (B11 chạy song song với B5–B6 nếu có người thứ ba); đường găng ở mục Phụ thuộc.

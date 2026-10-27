# Runbook — Ra mắt Connector Google Drive (Q3, UNI-2200)

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-27 · **Thành phần:** `DriveConnectionService`, `DriveFileService`, `DriveContentService`, `DriveTaskProposalService`, `DriveProposalRetentionSweeper` trong tiến trình API (`server/internal/service/drive_*.go`) · **Liên quan:** ADR 0047, spec `docs/superpowers/specs/2026-10-26-google-drive-connector-design.md`, plan `docs/superpowers/plans/2026-10-26-google-drive-connector.md`, [`docs/runbooks/drive-connector.md`](../runbooks/drive-connector.md), UNI-2172, UNI-2200

Theo quyết định người dùng 2026-10-27 (Amendment A1), connector Google Drive **không triển khai theo từng tổ chức pilot**: khi phát hành lên production, tính năng được **bật cho toàn bộ người dùng ngay lúc deploy**, và cờ `drive_connector` chỉ giữ vai trò công tắc ngắt khẩn cấp (kill switch).

---

## (a) Điều kiện tiên quyết trước khi deploy (`Prerequisites`)

1. **Google Cloud project, OAuth client và Brand Verification (E1, UNI-2174):**
   - Tạo OAuth 2.0 Web Client riêng cho Drive, bật Google Drive API và Google Picker API, tạo Picker API key (giới hạn HTTP referrer) và lấy Project Number (`app_id`) theo đúng hướng dẫn tại [`docs/runbooks/drive-connector.md`](../runbooks/drive-connector.md) (`docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` §5.1, `docs/superpowers/plans/2026-10-26-google-drive-connector.md` §E1).
   - Authorised redirect URI đăng ký chính xác từng ký tự: `{API_PUBLIC_URL}/api/v1/drive-connections/google/callback` (`.env.example:278`, `server/internal/config/config.go:364-366`).
   - OAuth consent screen chỉ yêu cầu các scope `openid`, `email` và `https://www.googleapis.com/auth/drive.file` (`server/internal/service/drive_google.go`, `docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` §5.1) và đã hoàn tất **Brand Verification** ở trạng thái *In production* (tránh giới hạn 100 test user và hạn refresh token 7 ngày của chế độ *Testing*, `docs/superpowers/plans/2026-10-26-google-drive-connector.md` §E1).
2. **Trang Chính sách quyền riêng tư (`/privacy#google-drive`) đã lên production:**
   - Mục `#google-drive` bằng cả tiếng Việt và tiếng Anh trên trang `/privacy` công khai nêu rõ phạm vi `drive.file`, cách đọc nội dung qua kết nối của chính người yêu cầu, và cam kết tuân thủ *Google API Services User Data Policy* (*Limited Use*) (`apps/web/features/landing/privacy-content.ts:61-67`, `apps/web/features/landing/privacy-content.ts:154-160`, được kiểm tự động bởi `apps/web/features/landing/privacy-content.test.ts:71-78`).
3. **Biến môi trường và Secret trên production (`.env.example:278-293`, [`docs/runbooks/drive-connector.md`](../runbooks/drive-connector.md) › Kiểm tra mục 1):**
   - Khai báo đủ 5 biến trong môi trường/Secret của `uniwork-be`:
     - `GOOGLE_DRIVE_CLIENT_ID` và `GOOGLE_DRIVE_CLIENT_SECRET` (`.env.example:279-280`, `server/internal/config/config.go:525-526`).
     - `GOOGLE_DRIVE_PICKER_API_KEY` và `GOOGLE_DRIVE_APP_ID` (`.env.example:283-284`, `server/internal/config/config.go:527-528`).
     - `DRIVE_CREDENTIAL_KEY`: khóa AES-256-GCM 32 byte mã hóa base64, tạo độc lập hoàn toàn với `EMAIL_HUB_CREDENTIAL_KEY` và `CALENDAR_CREDENTIAL_KEY` (`.env.example:285-288`, `server/cmd/server/main.go:462-471`).
   - `DriveConnectionService.Available()` chỉ trả `true` khi cả `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` và `DRIVE_CREDENTIAL_KEY` đều hợp lệ (`server/internal/service/drive_connections.go:210-243`, `:264-266`). Thiếu hoặc sai khóa, server ghi log cảnh báo `"google drive connector disabled"` (`server/cmd/server/main.go:467-470`) và trả `drive.available: false` trên `GET /api/v1/config` (`server/internal/handler/config.go:36-37`).
   - **Cấm bật giả lập trên production:** `DRIVE_FAKE_PROVIDER` phải để trống (hoặc `0`/`false`). Nếu đặt khác `0`/`false` khi `APP_ENV=production`, `config.Load()` từ chối khởi động tiến trình với lỗi `"DRIVE_FAKE_PROVIDER is refused when APP_ENV=production"` (`.env.example:289-291`, `server/internal/config/config.go:448-449`, `:628-630`). Biến build web `NEXT_PUBLIC_DRIVE_FAKE_PICKER` cũng không bao giờ được đặt trên production (`.env.example:292-293`).

---

## (b) Bật cho toàn bộ người dùng ngay khi deploy (`Turn on for all at deploy`)

- **Khai báo trong mã nguồn:** Cờ `drive_connector` được khai báo tại `server/internal/featureflags/keys.go:114` với `Key: "drive_connector"`, `Default: false`, `Public: true`, `Owner: "work"`, `ReviewAt: day(2027, 4, 30)`.
- **Thứ tự ưu tiên đánh giá cờ (`featureflags.NewService`):**
  1. `DBProvider` (`feature_flag_overrides` trong PostgreSQL, ưu tiên `user` > `organization` > `global`, cache 30 giây và xóa cache tức thì qua sự kiện outbox `flag.updated`; `server/internal/featureflags/db_provider.go:20-33`, `:86-149`).
  2. `EnvProvider` đọc biến môi trường tiền tố `FF_` + `UPPER_SNAKE_CASE(key)` (`server/pkg/featureflag/config.go:17-21`, `:119-162`; `server/pkg/featureflag/env_provider.go:15-26`, `:54-157`).
  3. `StaticProvider` từ file YAML `FEATURE_FLAGS_FILE` nếu có (`server/pkg/featureflag/config.go:12-15`, `:140-151`).
  4. Giá trị `Default` trong `server/internal/featureflags/keys.go:114`.
- **Cách bật cho tất cả mọi người khi deploy:**
  - Đặt biến môi trường trong ConfigMap runtime (`deploy/app/env/uniwork-be.env:185-192`):
    ```dotenv
    FF_DRIVE_CONNECTOR=true
    ```
    (`EnvProvider` nhận `"true"`, `"on"`, `"1"`, `"yes"` không phân biệt hoa thường → `Enabled=true`; `server/pkg/featureflag/env_provider.go:19-21`).
  - Hoặc đặt override `global` trong bảng `feature_flag_overrides` qua Admin API (cần tài khoản có `users.platform_role = 'admin'`, cấp bằng CLI `uniwork-admin grant-platform-role --email <email> --role admin --reason "..."` tại `server/cmd/uniwork-admin/main.go:8`, `:47-75`; lưu ý `uniwork-admin` không có lệnh con thao tác cờ):
    ```sh
    curl -X PUT "$API_PUBLIC_URL/api/v1/admin/flags/drive_connector/overrides" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"scope_type":"global","scope_id":"","enabled":true,"reason":"Ra mắt Google Drive connector toàn hệ thống (UNI-2200)"}'
    ```
    (`server/internal/handler/router/admin.go:31`, `:73`; `server/internal/handler/admin_flags.go:53-73`; `server/internal/service/admin_flags.go:68-136`).
- **Kiểm tra sau khi bật:**
  - `GET /api/v1/config` trả về `"flags": { ..., "drive_connector": true }` và `"drive": { "available": true }` (`server/internal/handler/config.go:36-37`, `server/internal/handler/dto/sdo/drive.go:4-6`).
  - Với app desktop (`uniwork-office`), `GET /api/v1/orgs/{orgID}/office/capabilities` trả `"drive_connector": true` (`server/internal/service/office_app_capabilities.go:64-72`, `:117-119`, `server/internal/handler/dto/sdo/office_capabilities.go:20`).

---

## (c) Cờ `drive_connector` làm công tắc ngắt khẩn cấp (`Kill switch & Rollback`)

Khi cần ngắt khẩn cấp tính năng Google Drive trên toàn hệ thống, tắt cờ `drive_connector` mà không cần rollback binary hay migration.

### Cách tắt khẩn cấp (Kill switch OFF)

1. **Cách nhanh nhất (không cần restart pod, có hiệu lực ngay trên mọi replica):** Gọi Admin API (hoặc bấm trên màn `/admin/flags`) đặt override `global` = `false` với `reason` tối thiểu 10 ký tự (`server/internal/service/admin.go:69-74`, `server/internal/service/admin_flags.go:92-136`):
   ```sh
   curl -X PUT "$API_PUBLIC_URL/api/v1/admin/flags/drive_connector/overrides" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"scope_type":"global","scope_id":"","enabled":false,"reason":"Tắt khẩn cấp Google Drive connector để xử lý sự cố"}'
   ```
   Lệnh này ghi `admin_actions` + `audit_events` (`action = 'flag.override_set'`) trong một transaction và phát sự kiện outbox `flag.updated` để mọi pod xóa cache `DBProvider` ngay lập tức (`server/internal/service/admin_flags.go:126-131`, `:179-192`; `server/internal/featureflags/db_provider.go:28`, `:123-134`).
   > **Lưu ý về độ ưu tiên:** Vì `DBProvider` tra cứu theo thứ tự `user` → `organization` → `global` (`server/internal/featureflags/db_provider.go:30-33`, `:86-121`), cần kiểm tra `GET /api/v1/admin/flags/drive_connector/overrides` (`server/internal/handler/router/admin.go:30`) để bảo đảm không còn dòng override `user` hay `organization` nào mang `enabled: true`; nếu có, xóa chúng bằng `DELETE /api/v1/admin/flags/drive_connector/overrides` (`server/internal/handler/router/admin.go:32`, `:74`).
2. **Qua biến môi trường (khi không có override trong DB):** Đặt `FF_DRIVE_CONNECTOR=false` trong `deploy/app/env/uniwork-be.env` và khởi động lại `uniwork-be` (`server/pkg/featureflag/env_provider.go:22`).

### Trải nghiệm người dùng và hành vi hệ thống khi cờ tắt

- **Trên API:**
  - `GET /api/v1/config` trả `flags.drive_connector: false` và `drive.available: false` (`server/internal/handler/config.go:36-37`).
  - `GET /api/v1/orgs/{orgID}/office/capabilities` trả `drive_connector: false` cho app desktop (`server/internal/service/office_app_capabilities.go:117-119`, cache phía client tối đa `ttl_seconds = 300` tại `:14`).
  - Toàn bộ 18 route đã xác thực dưới `/workspaces/{workspaceID}/drive-connections*`, `/workspaces/{workspaceID}/drive-files*`, `/tasks/{taskID}/drive-files*`, `/workspaces/{workspaceID}/drive-task-proposals*` đều đi qua middleware `mw.RequireFeatureFlag(flags, "drive_connector")` (`server/internal/handler/router/drive_connections.go:35-36`) cộng kiểm tra ở tầng service (`server/internal/service/drive_connections.go:70-72`, `:285-291`) và trả ngay HTTP **404** `{"error":{"code":"feature_disabled","message":"feature is disabled"}}` (`server/internal/middleware/feature_flag.go:36-51`).
  - Tạo công việc kèm `drive_files` (`POST /api/v1/workspaces/{workspaceID}/tasks`) bị từ chối với 404 `feature_disabled` và rollback toàn bộ giao dịch tạo việc (`server/internal/service/drive_files_link.go:125-140`).
  - Route callback công khai `GET /api/v1/drive-connections/google/callback` kiểm tra `flagEnabledForMember` và trả kết quả popup `provider_error` (`reason="feature_disabled"`) mà không đổi code lấy token và không ghi DB (`server/internal/service/drive_connections.go:510-512`).
- **Trên giao diện Web và Desktop:**
  - Hook `useDriveAvailable()` đọc `useFlag("drive_connector", false) && Boolean(config.drive?.available)` (`packages/views/settings/components/drive-integration-row.tsx:29-34`). Khi cờ tắt:
    - **Cài đặt › Tích hợp:** Ẩn hàng Google Drive; nếu URL đang có `?integration=drive`, trang tự gỡ query param và quay về danh sách tích hợp (`packages/views/settings/components/integrations-tab.tsx:116-137`).
    - **Tài liệu (Sidebar & Danh sách 4.1):** Ẩn mục Google Drive trên sidebar; nếu đang mở `?view=drive`, `DriveLibraryListView` tự gỡ `view`, `account`, `pick` khỏi URL và chuyển về danh sách Tài liệu (`packages/views/documents/drive/drive-library-list-view.tsx:164-190`).
    - **Trang chi tiết tệp Drive (4.2 `/documents/drive/{driveFileId}`):** Hiển thị màn hình không tìm thấy (`CollectionPageState` với tiêu đề `driveLibrary.detail.not_found.title` và nút quay lại Tài liệu) và không gọi API lấy tệp (`packages/views/documents/drive/drive-file-detail-view.tsx:111`, `:127-130`, `:172-188`).
    - **Công việc (Hộp tạo việc & Chi tiết việc):** Ẩn mục "Từ Google Drive" trong menu đính kèm, tắt nhận diện chip khi dán link Drive, và không truy vấn danh sách thẻ Drive trên việc (`packages/views/tasks/detail/components/attachments-section.tsx:85`, `:89-96`).

### Dữ liệu hiện có, hàng đợi nền và nhật ký audit khi cờ tắt

- **Không xóa bất kỳ dữ liệu nào (`no data deletion`):**
  - Các bảng `drive_connections`, `drive_files`, `drive_file_access`, `drive_file_task_links`, `drive_task_proposals`, `drive_task_proposal_links` giữ nguyên toàn bộ bản ghi. Các công việc đã tạo từ đề xuất trước đó là `tasks` bình thường trong workspace nên hiển thị và hoạt động nguyên vẹn (`docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` §0 Q3, §10).
- **Hàng đợi thu hồi grant (`drive_grant_revocations`) và dọn dẹp vòng đời vẫn chạy bình thường:**
  - Worker nền `DriveConnectionService.RunWorkers` (quét `drive_grant_revocations` mỗi 2 giây và dọn bằng chứng đã giải quyết quá 24 giờ mỗi 1 giờ) cùng consumer outbox `drive-grant-revocation` trên lane `provider` chỉ kiểm tra `RevocationAvailable()` (`s.box != nil && s.tokenRevoker() != nil`), **không** phụ thuộc vào cờ `drive_connector` (`server/internal/service/drive_connections.go:258-260`, `server/internal/service/drive_oauth_revoke.go:93-96`, `:167-186`, `:228-231`).
  - Các sự kiện vòng đời tài khoản (rời tổ chức, bị vô hiệu hóa, đóng tổ chức, xóa tài khoản) vẫn ngắt kết nối trong DB và thu hồi grant tại Google sau commit ngay cả khi cờ đang tắt (`server/internal/service/account_deletion.go:156`, `:211`; `docs/superpowers/specs/2026-10-26-google-drive-connector-design.md` §5.3a).
  - Worker dọn lô đề xuất hết hạn/đã xử lý `DriveProposalRetentionSweeper.Run` (mỗi 1 giờ, xóa tối đa 500 dòng/vòng `WHERE expires_at < now() OR status <> 'ready'`) vẫn chạy bình thường mà không kiểm tra cờ (`server/internal/service/drive_proposal_retention_sweep.go:108-158`).
- **Audit (`audit_events`):**
  - Bảng `audit_events` là bất biến (append-only, ADR 0012); mọi dòng lịch sử `drive_connection.*`, `drive_file.*`, `task.drive_file_*`, `drive_task_proposal.*` (`server/internal/audit/actions.go:319-335`) được giữ nguyên.

### Cách bật lại (Re-enable) và ngày rà soát cờ (`review_at`)

- **Bật lại sau khi khắc phục sự cố:**
  - Nếu trước đó đặt override `global` = `false` trong DB trong khi `FF_DRIVE_CONNECTOR=true` đã có trong env: xóa override `global` để hệ thống đọc lại `FF_DRIVE_CONNECTOR=true`:
    ```sh
    curl -X DELETE "$API_PUBLIC_URL/api/v1/admin/flags/drive_connector/overrides" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"scope_type":"global","scope_id":"","reason":"Khôi phục Google Drive connector sau khi xử lý xong sự cố"}'
    ```
    (`server/internal/handler/router/admin.go:32`, `:74`; `server/internal/service/admin_flags.go:139-174`). Hoặc gọi `PUT /api/v1/admin/flags/drive_connector/overrides` với `"enabled": true`.
  - Nếu tắt bằng `FF_DRIVE_CONNECTOR=false`: đổi lại thành `FF_DRIVE_CONNECTOR=true` và rollout/restart `uniwork-be`.
- **`review_at`:** Hiện tại `drive_connector` có `ReviewAt: day(2027, 4, 30)` (`server/internal/featureflags/keys.go:114`), được kiểm bởi `TestFlagsAreReviewed` (`server/internal/featureflags/keys_test.go`). Trước hoặc vào ngày `2027-04-30`, **owner `"work"` cùng chủ sản phẩm (Product Owner)** quyết định trong một PR riêng: hoặc đổi `Default: true` trong `keys.go` và gia hạn `ReviewAt` để giữ cờ làm kill switch dài hạn (như `office_engine` tại `keys.go:51`), hoặc gỡ bỏ cờ nếu không còn cần công tắc riêng. Không sửa `keys.go` trong đợt ra mắt này.

---

## (d) Những gì cần theo dõi sau khi ra mắt (`What to watch after launch`)

### 1. Chỉ số Prometheus (`server/internal/metrics/drive.go`, `server/internal/metrics/registry.go:117-118`)

| Metric | Loại & Nhãn | Ý nghĩa | Ngưỡng / Tín hiệu cần chú ý |
| --- | --- | --- | --- |
| `drive_token_refresh_failures_total` | Counter (không nhãn) | Số lần đổi refresh token lấy access token với Google thất bại (`server/internal/metrics/drive.go:19-22`, gọi tại `server/internal/service/drive_oauth_refresh.go:129-131`) | Tăng > 10 trong 15 phút kích hoạt alert `DriveTokenRefreshFailuresHigh` |
| `drive_revocation_abandoned_total` | Counter (không nhãn) | Số dòng trong `drive_grant_revocations` thử lại suốt 24 giờ không thành công và bị bỏ cuộc, xóa `refresh_token_enc` (`server/internal/metrics/drive.go:23-26`, gọi tại `server/internal/service/drive_oauth_revoke.go:282-284`) | > 0 kích hoạt ngay alert `DriveRevocationAbandoned` |
| `drive_task_proposals_total{result}` | CounterVec (`result`) | Kết quả mỗi lần gọi `POST .../task-proposals` (`server/internal/metrics/drive.go:27-30`). Các giá trị `result` trong code (`server/internal/service/drive_task_proposals.go:397-468`, `:675`, `:970-1011`; `server/internal/handler/drive_task_proposals_test.go:538`): `created`, `invalid_request`, `access_required`, `grant_required`, `blocked_by_admin`, `file_not_accessible`, `auth_failed`, `format_unsupported`, `extract_unavailable`, `drive_unavailable`, `drive_error`, `ai_quota_exceeded`, `ai_rate_limited`, `ai_error` | `drive_unavailable`, `extract_unavailable` hoặc `ai_error` tăng cao = lỗi kết nối Google API, `office-engine` hoặc AI Gateway |
| `drive_task_proposals_purged_total` | Counter (không nhãn) | Tổng số dòng `drive_task_proposals` đã xử lý hoặc quá hạn 7 ngày được `DriveProposalRetentionSweeper` dọn mỗi giờ (`server/internal/metrics/drive.go:31-34`, `server/internal/service/drive_proposal_retention_sweep.go:43-47`, `:203-215`) | Tăng đều mỗi giờ sau khi có người tạo hoặc hủy đề xuất |

Ngoài bốn metric riêng trên, các lời gọi LLM sinh đề xuất việc đi qua `ai.Gateway` với capability `drive_task_proposals` và prompt `drive_task_proposals@2` (`server/internal/ai/policy.go:51`, `server/internal/ai/prompts.go:55`), nên được đo trực tiếp trên `uniwork_ai_calls_total{capability="drive_task_proposals",status}` và `uniwork_ai_latency_ms{capability="drive_task_proposals"}` (xem [`RUNBOOK_AI.md`](RUNBOOK_AI.md) › Số cần nhìn). Các hành động audit đếm trên `uniwork_audit_events_total{action=~"drive_.*|task.drive_file_.*"}` (`server/internal/audit/actions.go:319-335`).

### 2. Cảnh báo trong `deploy/alerts.yml` và đề xuất bổ sung

- **Đã có trong `deploy/alerts.yml` (`deploy/alerts.yml:550-569`):**
  1. `DriveRevocationAbandoned` (Sev 3): `sum(increase(drive_revocation_abandoned_total[15m])) > 0` → runbook [`docs/runbooks/DriveRevocationAbandoned.md`](../runbooks/DriveRevocationAbandoned.md).
  2. `DriveTokenRefreshFailuresHigh` (Sev 3): `sum(increase(drive_token_refresh_failures_total[15m])) > 10` → runbook [`docs/runbooks/DriveTokenRefreshFailuresHigh.md`](../runbooks/DriveTokenRefreshFailuresHigh.md).
- **Chưa có alert riêng cho luồng đọc nội dung / đề xuất việc (`drive_task_proposals_total`):**
  - Không sửa `deploy/alerts.yml` trong đợt này (mọi rule trong `deploy/alerts.yml` bị ràng buộc 1-1 với `docs/runbooks/<AlertName>.md` và bảng trong `docs/runbooks/README.md` qua `scripts/alerts-runbooks.test.mjs:53-88`).
  - **Đề xuất follow-up sau khi có số liệu baseline production:**
    - `DriveTaskProposalErrorsHigh` (Sev 3): cảnh báo khi tỷ lệ `sum(increase(drive_task_proposals_total{result=~"drive_unavailable|extract_unavailable|drive_error|ai_error"}[15m])) / sum(increase(drive_task_proposals_total[15m])) > 0.2` (với tổng số lượt ≥ 10 trong 15 phút) để phát hiện sớm lỗi Google Drive API, `office-engine` (`extract_text`) hoặc AI Gateway.

### 3. Log JSON và truy vấn kiểm tra nhanh

Log của server không bao giờ chứa email, tên tệp, token hay nội dung tài liệu (`server/internal/service/drive_connections.go:166`, `server/internal/service/drive_content.go:157-158`, được giữ bởi `scripts/no-pii-log.test.mjs`). Các thông điệp log cần chú ý:

| Log message (`msg`) | Mức | Trường đi kèm | Ý nghĩa & Nguồn |
| --- | --- | --- | --- |
| `"google drive connector disabled"` | `WARN` | `err` | `DRIVE_CREDENTIAL_KEY` có đặt nhưng không giải mã được 32 byte (`server/cmd/server/main.go:467-470`) |
| `"drive oauth callback failed"` | `WARN` | `code`, `reason`, `user_id` | Callback OAuth không thành công (`state_invalid`, `scope_not_granted`, `account_mismatch`, `retry_connect`, `blocked_by_workspace_admin`, `access_denied`, `provider_error`; `server/internal/service/drive_connections.go:487-488`) |
| `"drive mark auth failed"` / `"… begin"` / `"… audit"` / `"… commit"` | `WARN` | `connection_id`, `err` | Lỗi DB khi đánh dấu kết nối `needs_reconnect` (`server/internal/service/drive_oauth_refresh.go:168`, `:186`, `:208`, `:212`) |
| `"drive grant revocation attempt failed; will retry after lease"` | `WARN` | `code`, `generation`, `attempts` | Thu hồi token tại Google lỗi tạm thời (`unseal_failed`, `timeout`, `provider_revoke_failed`), sẽ thử lại sau khi hết lease 2 phút (`server/internal/service/drive_oauth_revoke.go:296-300`, `:439-450`) |
| `"drive grant revocation abandoned after 24h"` | `ERROR` | `code="DriveRevocationAbandoned"`, `generation`, `attempts`, `last_error` | Bỏ cuộc thu hồi grant sau 24 giờ thử lại (`server/internal/service/drive_oauth_revoke.go:285-290`) |
| `"drive record file access lost failed"` / `"drive record file metadata refresh failed"` | `WARN` | `drive_file_id`, `err` | Lỗi ghi trạng thái mất quyền hoặc cập nhật metadata phụ trợ (`server/internal/service/drive_content.go:467`, `:478`) |
| `"drive task proposal retention sweep"` | `INFO` / `WARN` | `purged` hoặc `err` | Kết quả lượt dọn mỗi giờ của `DriveProposalRetentionSweeper` (`server/internal/service/drive_proposal_retention_sweep.go:123-125`) |

### 4. Các lane Outbox mà Google Drive sử dụng (`RUNBOOK_OUTBOX.md`)

- **Lane `provider` (`outbox.LaneProvider`):**
  - Consumer `drive-grant-revocation` (`server/internal/service/drive_oauth_revoke.go:74-91`, đăng ký tại `server/cmd/server/main.go:479`) lắng nghe topic `drive_connection.changed`. Khi một kết nối bị ngắt (`disconnected_at` khác NULL), consumer này gọi `processOneRevocationForConsumer` để thu hồi refresh token tại Google ngay sau sự kiện, song song với vòng quét định kỳ 2 giây của `DriveConnectionService.RunWorkers` (`server/internal/service/drive_oauth_revoke.go:167-186`).
- **Lane `realtime` (mặc định qua `dispatcher.Register(realtimeConsumer)`, `server/cmd/server/main.go:485-486`):**
  - Phát các sự kiện realtime chỉ mang ID (`server/internal/outbox/catalogue.go:411-420`, `packages/core/types/events.ts`):
    - Scope `user` (`ScopeUser`): `drive_connection.changed` (`connection_id`, `user_id`), `drive_file.access_changed` (`drive_file_id`, `workspace_id`, `user_id`).
    - Scope `workspace` (`ScopeWorkspace`): `drive_file.linked`, `drive_file.task_linked`, `drive_file.unlinked`, `drive_file.updated`, `drive_task_proposal.converted`.
  - Vì `drive_connection.changed` có một consumer trên lane `provider` (`drive-grant-revocation`) và một consumer trên lane `realtime` (`realtimeConsumer`), topic `drive_connection.changed` được claim trên lane chậm hơn là **`provider`** và chạy đồng thời cả hai consumer (`CLAUDE.md` › Audit and Events, `docs/ops/RUNBOOK_OUTBOX.md:22-25`). Sáu topic `drive_file.*` và `drive_task_proposal.converted` chỉ có consumer realtime (và `graph_marker`) nên chạy thẳng trên lane **`realtime`**.

---

## (e) Hạn mức Google API (`Google quota`)

Mọi hạn mức truy vấn của Google Drive API v3 (tổng số request mỗi phút trên toàn project và mỗi người dùng) cùng Google Picker API đều được hiển thị và quản lý trực tiếp trong **Google Cloud Console › APIs & Services › Enabled APIs & services › Google Drive API (và Google Picker API) › Quotas & System Limits** (không suy đoán hay ghi cứng con số trong tài liệu; kiểm tra trực tiếp trên trang Quotas của project production trước khi mở rộng quy mô). Phía UniWork đã giảm tải gọi Google bằng cách chỉ làm mới metadata tệp tối đa 10 phút một lần khi đọc danh sách/chi tiết (`driveMetadataRefreshInterval`, `server/internal/service/drive_files.go:22-24`) và giới hạn tạo đề xuất việc ở mức 10 lượt / 10 phút / người dùng (`drive-proposals`, `server/internal/handler/router/router.go:288`). Khi Google trả HTTP 429 hoặc 403 với `reason` thuộc nhóm giới hạn tốc độ (`rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `dailyLimitExceeded`, `sharingRateLimitExceeded`), `classifyDriveHTTPError` phân loại thành `DriveErrorClassUnavailable` với `RateLimited: true` và **`MarkAccessLost: false`** (`server/internal/service/drive_api.go:602-609`, `:652-659`), được `DriveErrToCodedError` ánh xạ thành HTTP **429 `drive_unavailable`** (`server/internal/service/drive_api.go:715-725`) mà **không** đánh dấu mất quyền tệp hay ngắt kết nối của người dùng; nếu tỷ lệ HTTP 429 `drive_unavailable` hoặc biểu đồ sử dụng trên trang *Quotas & System Limits* tiến sát ngưỡng của project, ops gửi yêu cầu tăng hạn mức (*Edit Quotas* › *Request quota increase*) ngay trên trang đó của Google Cloud Console.

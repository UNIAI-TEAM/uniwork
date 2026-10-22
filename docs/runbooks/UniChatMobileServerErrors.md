# UniChatMobileServerErrors — một bản UniChat mobile nhận 5xx trên 5 % request

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_http_client_requests_total`

## Triệu chứng

- Alert `UniChatMobileServerErrors` bật cho một cặp `client_version` (version store, như `0.3.0`) và `client_update`
  (id bản OTA máy đang chạy, `embedded` khi là bundle trong binary): trên 5 % request của bản đó nhận 5xx suốt 10 phút,
  với ít nhất 0,05 request/giây.
- Người dùng bản đó thấy "Không tải được tin · Thử lại", phòng trống, gửi tin kẹt "Đang gửi"; các bản khác bình thường.
- `ApiErrorRateHigh` không bật (tổng 5xx của API vẫn thấp): lỗi chỉ ở một bản app.

## Kiểm tra

1. Bản nào và từ khi nào? Explore:
   ```promql
   sum by (client_version, client_update, status_class) (rate(uniwork_http_client_requests_total{platform="mobile"}[15m]))
   ```
   Một `client_update` mới (OTA vừa phát) là nghi phạm số một; một `client_version` mới là bản store vừa lên. `other`
   gom những giá trị vượt ngân sách nhãn (16 version, 24 update mỗi tiến trình; giá trị không ai gửi trong 24 giờ nhường
   chỗ cho giá trị mới), sai dạng, hay đến từ request chưa xác thực (route công khai như `/config`, đăng nhập: chỉ request
   đã xác thực mới được đặt tên bản build) — xem log ở bước 2. Dashboard **UniWork · UniChat mobile** có panel tỷ lệ 5xx
   theo bản build.
2. Route nào? Log truy cập có `client_platform=mobile`, `client_version`, `client_update_id` trên mỗi dòng:
   Loki `{container=~".*server.*"} | json | client_update_id = "<id>" | status >= 500`, đếm theo `path`.
3. Bản OTA đó là gì: GitHub → Actions → "UniChat mobile OTA update", summary của run ghi group và id bản Android;
   `cd apps/chat-mobile && eas update:view <group>` cho message và commit. Bản store: tag `chat-mobile-v<version>`.
4. Server vừa deploy? Panel **Bản build đang chạy** (`uniwork_build_info`). Server mới đổi một hợp đồng (trường SDO,
   route, mã lỗi) mà bản app cũ còn gọi kiểu cũ thì mọi `client_update` của một version cùng lỗi; một OTA làm hỏng hợp
   đồng thì chỉ `client_update` đó lỗi.
5. Sentry của app: release `com.uniworkos.chat@<version>+<build>.ota.<id>` (mỗi bản OTA một release) — breadcrumb
   `api` cho thấy request nào trả 5xx ngay trước lỗi.

## Khắc phục

- Lỗi do bản OTA: dừng nó. Đang rollout dở thì `eas update:revert-update-rollout --group <group>`; đã 100 % thì phát lại
  bản trước (`eas update:republish --group <group trước> --private-key-path <khoá>`) hoặc
  `eas update:roll-back-to-embedded --channel production` — runbook `unichat-mobile-release.md` › Khắc phục. Bản sửa
  phát lại với `critical` để máy áp dụng sau một phút ở nền (hay lúc quay lại sau ≥ 10 phút).
- Lỗi do bản store: halt staged rollout ("UniChat mobile promote" › `halt`), sửa bằng OTA nếu chỉ là JS; nếu không,
  bản store mới. Bản cũ hỏng hẳn: `UNICHAT_MOBILE_MIN_SUPPORTED_VERSION` buộc cập nhật — chỉ khi bản mới đã có trên store.
- Lỗi do server vừa deploy: rollback server (runbook `ApiErrorRateHigh` › Khắc phục), rồi sửa server để nhận cả hai
  dạng tới khi bản app cũ hết (hợp đồng API giữ tương thích ngược, root `CLAUDE.md` › API Compatibility).
- Một tính năng hỏng (gọi): tắt bằng kill switch `unichat_mobile_calls` thay vì chờ bản mới.

## Leo thang

- Chưa hạ dưới 5 % sau 30 phút, hay bản lỗi là bản đa số người dùng đang chạy → gọi on-call backend và người giữ bản
  phát hành mobile (kênh `#uniwork-incident`), kèm `client_version`, `client_update`, route và trace id.
- Mất dữ liệu (tin gửi không tới, outbox bị xoá) → incident Sev 1, ghi vào `docs/ops/incidents/`.

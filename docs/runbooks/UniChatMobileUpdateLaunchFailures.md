# UniChatMobileUpdateLaunchFailures — máy UniChat mobile không khởi động được một bản OTA

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_events_total{event="ota_launch"}`

## Triệu chứng

- Alert `UniChatMobileUpdateLaunchFailures` bật cho một `os` và `client_version`: trong 1 giờ, ít nhất 3 lần máy của bản
  đó không chạy được một bản OTA. `result="emergency"`: trình khởi động của expo-updates hỏng và máy chạy bundle nhúng
  trong binary; `result="failed_update"`: tệp của bản OTA không tải hay không kiểm chữ ký được và máy chạy bản trước nó.
- Người dùng thường **không thấy gì**: app vẫn mở, chỉ là bản cũ. Bản sửa lỗi phát qua OTA không tới họ; một bản
  `critical` cứ tải rồi không áp dụng được.
- Số đếm đến từ chính máy lần mở sau đó (`apps/chat-mobile/data/release/launch-health.ts`, gửi khi đã đăng nhập và người
  dùng không tắt thống kê ẩn danh), nên là cận dưới. `client_update` của sự kiện là bản máy **đang chạy** (thường là
  `embedded`), không phải bản hỏng.

## Kiểm tra

1. Bản OTA nào hỏng? Sentry → Issues, lọc `ota_failure:emergency` hoặc `ota_failure:failed_update` (issue
   `OtaLaunchError`, mỗi bản OTA và mỗi OS một issue): tag `failed_update_id` là id bản OTA, `failed_update_code` là mã
   log của expo-updates (`UpdateFailedToLoad`, `AssetsFailedToLoad`, `UpdateHasInvalidSignature`,
   `UpdateCodeSigningError`…), extra `reason` là lời của expo-updates khi là emergency launch.
2. Bản đó ở kênh nào, rollout bao nhiêu: `cd apps/chat-mobile && eas update:list --branch <kênh> --platform <os> --json`
   rồi `eas update:view <group> --json` chứa id đó. Job summary của "UniChat mobile OTA update" cũng ghi id bản Android.
3. Phân loại theo mã:
   - `UpdateHasInvalidSignature` / `UpdateCodeSigningError`: bản OTA ký bằng khoá không khớp chứng chỉ trong binary
     (xoay chứng chỉ mà chưa có bản store mới, hay `EAS_UPDATE_PRIVATE_KEY` sai) — mọi máy của binary đó đều từ chối.
   - `AssetsFailedToLoad` / `UpdateFailedToLoad`: asset thiếu hay hỏng khi tải (mạng chập chờn thì lẻ tẻ; một asset
     thiếu thì đều đặn trên mọi máy).
   - emergency launch với mã `Unknown`: cơ sở dữ liệu của expo-updates hay thư mục update hỏng trên máy; nhiều máy cùng
     lúc thì nghi bản OTA.
4. Job `chat-mobile-release-health.yml` (mỗi giờ) đã thấy chưa: summary ghi `launch failures` của bản OTA đó, và nếu nó
   còn đang rollout thì đã revert.

## Khắc phục

- Bản OTA còn rollout dở: job sức khoẻ tự revert khi ≥ 2 máy báo (ngưỡng `UNICHAT_HEALTH_LAUNCH_FAILURE_MIN_USERS`).
  Chưa thì chạy tay: Actions → "UniChat mobile rollback" (`chat-mobile-rollback.yml`) → `action: revert-rollout`,
  `channel`, `platform`, `reason`.
- Bản OTA đã 100 %: cùng workflow, `action: republish-previous` (phát lại bản trước, ký bằng khoá của CI) hoặc
  `roll-back-to-embedded` (`runtime_version` của bản hỏng). Không cần khoá trên máy ai.
- Lỗi ký: sửa `EAS_UPDATE_PRIVATE_KEY` của Environment `chat-mobile-update` cho khớp
  `apps/chat-mobile/certs/eas-update-certificate.pem`, rồi phát lại bản sửa qua "UniChat mobile OTA update".
- Lẻ tẻ một máy (đĩa đầy, mạng): không làm gì; alert tự tắt khi dưới 3 lần một giờ.

## Leo thang

- Bản hỏng đã tới đa số máy của một kênh production, hoặc lỗi ký trên mọi máy → người giữ bản phát hành mobile (kênh
  `#uniwork-incident`), kèm `failed_update_id`, kênh và link issue Sentry. Runbook phát hành:
  `docs/runbooks/unichat-mobile-release.md` › Khắc phục.

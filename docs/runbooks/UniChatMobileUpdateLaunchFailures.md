# UniChatMobileUpdateLaunchFailures — máy UniChat mobile không khởi động được một bản OTA

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_events_total{event="ota_launch"}`

## Triệu chứng

- Alert `UniChatMobileUpdateLaunchFailures` bật cho một `os` và `client_version`: trong 1 giờ, ít nhất 3 lần máy của bản
  đó không chạy được một bản OTA. `result="emergency"`: trình khởi động của expo-updates hỏng và máy chạy bundle nhúng
  trong binary; `result="failed_update"`: một bản OTA đã tải về (hay đã chạy lần trước) mà lần mở này máy lại chạy bản
  cũ hơn — expo-updates đánh dấu nó hỏng (crash trước màn đầu) và bỏ qua.
- Người dùng thường **không thấy gì**: app vẫn mở, chỉ là bản cũ. Bản sửa lỗi phát qua OTA không tới họ; một bản
  `critical` cứ tải rồi không áp dụng được.
- Số đếm đến từ chính máy lần mở sau đó (`apps/chat-mobile/data/release/launch-health.ts`, gửi khi đã đăng nhập và người
  dùng không tắt thống kê ẩn danh), nên là cận dưới. `client_update` của sự kiện là bản máy **đang chạy** (thường là
  `embedded`), không phải bản hỏng.

## Kiểm tra

1. Bản OTA nào hỏng? Sentry → Issues, lọc `ota_failure:emergency` hoặc `ota_failure:failed_update` (issue
   `OtaLaunchError`, mỗi bản OTA và mỗi OS một issue): tag `failed_update_id` là id bản OTA, `failed_update_evidence` là
   điều đã chỉ ra nó, extra `reason` là lời của expo-updates khi là emergency launch. expo-updates 57 không ghi log nào
   nêu id một bản bị bỏ qua trên Android (chỉ iOS có một dòng warn), nên app tự giữ trên máy bản nó chạy và bản
   expo-updates báo đã tải cho lần mở sau (`apps/chat-mobile/lib/ota-launch.ts`).
2. Bản đó ở kênh nào, rollout bao nhiêu: `cd apps/chat-mobile && eas update:list --branch <kênh> --platform <os> --json`
   rồi `eas update:view <group> --json` chứa id đó. Job summary của "UniChat mobile OTA update" cũng ghi id bản Android.
3. Phân loại theo `failed_update_evidence`:
   - `skipped`: máy đã tải bản đó cho lần mở sau, rồi lần mở sau chạy bản cũ hơn — bản đó crash trước màn đầu (lỗi
     JS lúc khởi động) hay tệp của nó không nạp được. Nhiều máy cùng bản thì là lỗi của bản OTA: xem crash của release
     `….ota.<id>` (có khi trống vì crash trước khi Sentry khởi).
   - `rolled_back`: lần mở trước chạy được bản đó, lần này chạy bản cũ hơn — bản đó crash trước màn đầu ở lần mở thứ hai.
   - `marked_failed`: dòng log iOS `markFailedLaunchForUpdate` nêu bản đó.
   - emergency launch với `none`: cơ sở dữ liệu của expo-updates hay thư mục update hỏng trên máy; nhiều máy cùng lúc
     thì nghi bản OTA.
   - Lỗi chữ ký (khoá ký không khớp chứng chỉ trong binary) không làm máy bỏ một bản đã tải — bản đó không bao giờ tải
     xong; dấu hiệu là bản OTA mới không có phiên nào trên kênh, và log `UpdateCodeSigningError` khi gỡ lỗi một máy.
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

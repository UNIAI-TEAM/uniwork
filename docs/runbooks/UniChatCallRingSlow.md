# UniChatCallRingSlow — máy Android của một bản UniChat đổ chuông chậm

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (nhóm `uniwork-app-builds`) · **Metric:** `uniwork_mobile_event_duration_seconds{event="call_ring"}`

## Triệu chứng

- Alert `UniChatCallRingSlow` bật cho một `client_version`: trong 1 giờ, 95 % cuộc gọi (ít nhất 20) đổ chuông trên máy
  Android sau hơn 5 giây kể từ lúc server gọi. Người gọi nghe chuông chờ lâu, hay gác máy trước khi máy kia kịp reo.
- Thời gian đo từ `expires_at` của push trừ cửa sổ chuông 60 s (giờ server) tới lúc máy đăng thông báo đổ chuông (giờ
  máy), nên gồm cả chặng Expo → FCM → máy và độ lệch đồng hồ của máy. Đường native (`result="native"`,
  `NativeCallPush.kt`, không cần JavaScript) được đếm khi app mở lại; đường JavaScript (`result="app"`) đếm ngay.

## Kiểm tra

1. Bản nào, đường nào? Explore:
   ```promql
   sum by (client_version, result) (rate(uniwork_mobile_events_total{event="call_ring"}[1h]))
   histogram_quantile(0.5, sum by (client_version, le) (rate(uniwork_mobile_event_duration_seconds_bucket{event="call_ring"}[1h])))
   ```
   Tỷ lệ `app` tăng so với `native` nghĩa là đường native không chạy (bản thiếu `UniChatMessagingService` trong
   manifest, `RingConfig` chưa được ghi): kiểm `android-manifest.test.ts › messagingServices` ở tag của bản đó.
2. p50 thấp mà p95 cao: một nhóm máy chậm — OEM chặn chạy nền (Xiaomi, Oppo, vivo; Cài đặt › Thông báo của app có dòng
   hướng dẫn), hay Android hạ ưu tiên FCM của app (app nhận push ưu tiên cao mà không hiện thông báo). Mọi máy đều
   chậm: chặng Expo/FCM — trang trạng thái của Expo Push và Firebase, receipt lỗi ở log `expo push receipts`.
3. Server có chậm gửi không: tuổi dòng outbox chưa gửi (`uniwork_outbox_pending_age_seconds`, `docs/ops/RUNBOOK_OUTBOX.md`; log trường `lane` cho lane `push`); một
   hàng `chat.voice.invite_received` nằm lâu trong outbox làm mọi máy chậm như nhau.

## Khắc phục

- Lane `push` nghẽn: theo `docs/ops/RUNBOOK_OUTBOX.md` (consumer chậm, provider lỗi).
- Đường native hỏng trong một binary: halt staged rollout (runbook `unichat-mobile-release.md` › Khắc phục) và phát bản
  sửa; trong lúc chờ, đường JavaScript vẫn đổ chuông, chỉ chậm hơn.
- Expo Push chậm kéo dài: báo nhà cung cấp; cuộc gọi vẫn tới, không tắt `unichat_mobile_calls` vì chậm.

## Leo thang

- p95 trên 15 giây quá 1 giờ, hoặc mọi bản cùng chậm → on-call backend và người giữ bản phát hành mobile (kênh
  `#uniwork-incident`), kèm `client_version`, tỷ lệ `native`/`app` và tuổi outbox.

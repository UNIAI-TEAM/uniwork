# RealtimeSlowEvictions — hub realtime đuổi nhiều client chậm

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* (panel **Message drop / slow eviction**)

## Triệu chứng

- Alert `RealtimeSlowEvictions`: hơn 25 kết nối WebSocket bị đuổi trong 10 phút, kéo dài 5 phút.
- Mỗi client có hàng đợi gửi 256 frame. Khi hàng đầy, hub đóng kết nối đó. Client tự nối lại rồi tải lại dữ liệu, nên người dùng thấy màn hình chớp, bảng hoặc phòng chat tải lại, có lúc mất trạng thái "đang gõ".
- Một vài lần đuổi mỗi ngày là bình thường, do mạng di động hoặc máy ngủ. Đuổi hàng loạt cho thấy có quá nhiều frame dồn tới cùng lúc.

## Kiểm tra

1. Có gì vừa phát ra quá nhiều frame không?
   ```promql
   topk(5, sum by (event_type) (rate(uniwork_realtime_events_sent_total[5m])))
   sum(uniwork_realtime_active_connections)
   rate(uniwork_realtime_messages_dropped_total[5m])
   ```
   Một `event_type` vọt lên (thường là sự kiện phòng họp như lobby, điểm danh, presence khi phòng đông) là nguồn gây ra.
2. Có cuộc họp đông đang diễn ra không? Điểm danh, lobby và chat trong phòng phát frame tới mọi người trong phòng.
3. BE có thiếu CPU không? `rate(process_cpu_seconds_total[5m])` so với limit trong `deploy/app/uniwork/values.yaml`. Khi CPU bị throttle, frame gửi chậm và hàng đợi đầy nhanh hơn.
4. Hub không ghi log khi đuổi client (cũng không có dòng `ws client disconnected` cho client bị đuổi); chỉ có counter. Client bị đuổi tự nối lại, nên dòng `ws client connected` (kèm `workspace_id`, `user_id`) dồn dập cho biết workspace nào bị ảnh hưởng: `kubectl -n uniwork logs deploy/uniwork-be --since=15m | grep 'ws client connected'`.

## Khắc phục

- Một loại sự kiện phát quá dày: gom hoặc giảm tần suất phát ở service đó (debounce, gửi ids thay cho từng thay đổi nhỏ). Sửa bằng PR.
- BE bị throttle CPU: nâng `be.resources.limits.cpu`. Không tăng `be.replicaCount`; ADR 0025 chỉ cho một replica cho tới khi có leader lock.
- Đuổi hàng loạt trùng lúc deploy hoặc restart: đó là client nối lại đồng loạt và sẽ tự hết. Không cần xử lý.

## Leo thang

- Đuổi kéo dài kèm [RealtimePublishSlow](RealtimePublishSlow.md) hoặc [OutboxLagHigh](OutboxLagHigh.md): nâng sev 2.
- Lặp lại ở mỗi cuộc họp lớn: mở issue perf (fan-out trong phòng họp, G8 trong bản đánh giá).

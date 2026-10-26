# MeetingDialInRefusedCalls — nhiều cuộc gọi điện thoại vào họp bị từ chối

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Nền:** `docs/runbooks/livekit-sip.md` §7, UNI-1995 (#24); `server/internal/service/meeting_dial_in.go`

## Triệu chứng

- Alert `MeetingDialInRefusedCalls`: hơn 10 cuộc gọi trong 10 phút vào được `livekit-sip` (PIN khớp một rule) nhưng bị
  server UniWork ngắt máy vì rule đó không phải rule hiện tại của một cuộc họp đang diễn ra: PIN đã đổi, cuộc họp đã
  kết thúc nhưng rule chưa kịp xoá, rule lạ không cuộc họp nào trỏ tới, hoặc người gọi chủ trì đã gỡ.
- Một trunk phục vụ mọi tổ chức, nên đây là dấu hiệu có người dò PIN: mỗi lần trúng một rule còn sống là một lần gõ cửa
  vào cuộc họp của tổ chức khác. Người dùng không thấy gì; chủ trì có thể thấy nhiều "Điện thoại ••• xxxx" lạ trong hàng chờ.
- Lần nhập sai PIN hoàn toàn (không khớp rule nào) **không tới** UniWork: `livekit-sip`/SBC từ chối trước khi vào phòng.
  Số đó lấy ở `livekit-sip`/SBC (Kiểm tra, bước 3).

## Kiểm tra

1. Nhịp từ chối và nhịp gõ cửa:
   ```promql
   sum by (event) (increase(uniwork_meetings_total{event=~"dial_in_call_refused|dial_in_call_knocked|dial_in_rule_conflict"}[10m]))
   ```
   `dial_in_call_knocked` tăng cùng lúc ở nhiều cuộc họp khác tổ chức: ai đó đang trúng PIN thật.
2. Rule còn sống: `lk sip dispatch list` — so với
   `SELECT id, dial_in_pin, sip_dispatch_rule_id FROM meetings WHERE sip_dispatch_rule_id IS NOT NULL;`. Rule `uniwork …`
   không dòng nào trỏ tới mà quá 1 phút: vòng quét dọn chưa được (log `meeting dial-in: stray rule not deleted`).
3. Số gọi và số lần sai PIN ở `livekit-sip`/SBC: log `livekit-sip` (mức `info`) ghi mỗi cuộc gọi bị từ chối kèm số gọi
   đến; SBC/nhà mạng có CDR theo caller ID. Tìm một vài số gọi lặp lại nhiều lần trong vài phút.
4. Log `uniwork-be`: `meeting dial-in: caller not dropped` (ngắt máy lỗi — người gọi có thể còn trong phòng ở trạng thái
   bị giữ).

## Khắc phục

- Một vài caller ID dò PIN: chặn các số đó ở SBC/nhà mạng; bật (hoặc hạ ngưỡng) giới hạn tốc độ theo caller ID ở SBC
  (≤ 10 cuộc/phút/số, ≤ 100 cuộc/giờ/số) và giới hạn số lần sai PIN trong một cuộc gọi (3 lần rồi ngắt).
- Nghi PIN của một cuộc họp đang diễn ra đã lộ: chủ trì/admin bấm "Đổi mã PIN" trên trang chi tiết; người đang trong
  phòng không bị ngắt.
- Rule lạ còn sống: `lk sip dispatch delete <SDR_…>`.
- Dò trên diện rộng mà chưa chặn được ở SBC: tắt cờ `meeting_dial_in` (toàn cục trong `/admin`) — vòng quét 15 giây xoá
  rule của mọi cuộc họp; bật lại khi SBC đã chặn.

## Leo thang

- Có người gọi nghe được cuộc họp trước khi được duyệt, hoặc chủ trì báo người gọi lạ được nhận nhầm: sự cố bảo mật
  Sev 1 — tắt cờ `meeting_dial_in` ngay, báo nhóm meetings và người phụ trách bảo mật.
- SBC, trunk, nhà mạng: ops (UNI-2030).

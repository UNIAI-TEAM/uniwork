# MeetingScribeRunsSilent — thư ký AI trong phòng mà không có lời thoại

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.1, §6.1; ADR 0038; benchmark UNI-1995 #1

## Triệu chứng

- Alert `MeetingScribeRunsSilent`: ít nhất 2 lần chạy thư ký đang `ACTIVE`, phòng có người, mà 3 phút không có dòng transcript nào, và đó là ít nhất một nửa số lần chạy như vậy, kéo dài 10 phút.
- Gauge `uniwork_meeting_scribe_runs{state="active|silent"}` do vòng quét 15 giây của BE đặt (mọi replica đặt cùng số toàn hệ thống; alert đọc `max`).
- Đây là kiểm tra phía server, không dựa vào metric của agent: nó bắt được cả lỗi STT, token agent bị từ chối (404 ở `/agent/segments`) và đường gửi đoạn bị chặn.

## Kiểm tra

1. Có đi cùng `MeetingScribeSttErrors` không: nếu có, theo runbook đó trước.
2. Agent gửi đoạn có bị từ chối không:
   ```promql
   sum by (status) (rate(uniwork_http_requests_total{route="/api/v1/meetings/{meetingID}/agent/segments"}[10m]))
   ```
   404 hàng loạt: token bị từ chối (JWT_SECRET của BE đổi, hoặc lần chạy đã đóng quá cửa sổ xả 10 phút). Agent tự rời phòng khi gặp 404 và sweep gửi lần chạy mới; nếu 404 vẫn kéo dài, xem log BE. 409: cuộc họp đã kết thúc hoặc thư ký đang tắt.
3. Lần chạy im lặng trong DB:
   ```sql
   SELECT r.id, r.meeting_id, r.started_at, r.segments, r.updated_at
   FROM meeting_scribe_runs r
   WHERE r.status = 'ACTIVE' AND r.started_at < now() - interval '3 minutes'
     AND NOT EXISTS (SELECT 1 FROM meeting_transcript_segments s
                     WHERE s.meeting_id = r.meeting_id AND s.created_at > now() - interval '3 minutes')
   ORDER BY r.started_at LIMIT 20;
   ```
4. Log agent của một cuộc họp: `kubectl -n uniwork logs deploy/uniwork-meeting-agent --since=15m | grep <meeting_id>` (chỉ id, không có lời nói).
5. Một phòng im lặng thật (mọi người tắt mic, xem trình chiếu) là bình thường; alert chỉ bật khi nhiều phòng cùng im.

## Khắc phục

- Lỗi STT: theo `MeetingScribeSttErrors`.
- 404 vì JWT_SECRET đổi: agent tự rời phòng, sweep gửi agent mới với token mới trong vòng một phút; không cần làm gì nếu số 404 giảm.
- Agent treo (log không có dòng mới, `scribe_jobs_running` không đổi): `kubectl -n uniwork rollout restart deploy/uniwork-meeting-agent`; pod cũ drain tới 4 giờ.
- Cần tắt ngay: tắt cờ `meeting_scribe` trong `/admin`.

## Leo thang

- Kéo dài quá 30 phút trong giờ họp: nâng sev 2, gọi on-call backend.
- Không tìm ra nguyên nhân ở STT, token hay agent: mở issue con của UNI-1995 kèm truy vấn ở bước 3 (chỉ id).

# MeetingScribeCapacityHigh — worker thư ký AI gần hết sức chứa

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.1, §4.6; ADR 0038; dashboard *UniWork · Meetings AI*

## Triệu chứng

- Alert `MeetingScribeCapacityHigh`, khi một trong hai dấu hiệu kéo dài 10 phút:
  - worker ít tải nhất (`lk_agents_worker_load`, do LiveKit Agents tự đo) trên 60% trong khi còn cuộc họp đang ghi. Worker từ chối job mới khi quá 70% (`load_threshold` trong `apps/meeting-agent/agent.py`);
  - server gọi thư ký mà 60 giây không worker nào nhận job (`uniwork_meetings_total{event="scribe_no_capacity"}`, sweep hỏi LiveKit `ListDispatch`).
- Khi không worker nào nhận: cuộc họp mới chưa có thư ký. Sweep gửi lại dispatch mỗi 60 giây **không đếm là lỗi**, trong tối đa 10 phút kể từ lúc mở lần chạy; quá 10 phút thì lần gọi lại đếm như lỗi, lần thứ ba lần chạy thành `FAILED` và **10 phút** sau mới thử lại (`scribeRetryAfter`). Trong lúc chờ, phòng hiện chip lỗi và quay về phụ đề Web Speech; cuộc họp mất phần transcript từ lúc mở tới lúc có worker.
- Hay gặp lúc đầu giờ (9:00, 14:00): nhiều cuộc họp bắt đầu cùng phút. Thường đi kèm `MeetingScribeCannotJoin` (alert đó cũng đếm `scribe_no_capacity`).

## Kiểm tra

1. Tải và số job từng pod:
   ```promql
   max by (nodename) (lk_agents_worker_load)
   sum by (nodename) (lk_agents_active_job_count)
   sum(scribe_jobs_running)
   ```
   Một pod rất cao, pod khác thấp: job dồn lệch (LiveKit chọn worker theo tải báo lên), chờ vài phút. Mọi pod cao: thiếu pod. Tải thấp mà vẫn có `scribe_no_capacity`: không có worker nào đăng ký `agent_name=uniwork-scribe` (pod không chạy, sai khóa LiveKit), xem `MeetingScribeCannotJoin.md` bước 2 và 5.
2. HPA đã chạm trần chưa: `kubectl -n uniwork get hpa uniwork-meeting-agent` — `REPLICAS` bằng `MAXPODS` (mặc định `meetingAgent.maxReplicas: 6`) là hết chỗ; thấp hơn mà pod mới `Pending`: node pool hết CPU (`kubectl -n uniwork describe pod -l app.kubernetes.io/name=uniwork-meeting-agent | grep -A5 Events`).
3. Có cuộc họp đã bị bỏ lỡ chưa:
   ```promql
   sum(increase(uniwork_meetings_total{event=~"scribe_failed|scribe_dispatched|scribe_no_capacity"}[15m])) by (event)
   ```
   ```sql
   SELECT count(*) FROM meeting_scribe_runs WHERE status = 'FAILED' AND updated_at > now() - interval '30 minutes';
   ```
4. Tải cao vì CPU thật hay vì job treo: `kubectl -n uniwork top pod -l app.kubernetes.io/name=uniwork-meeting-agent`. Số job cao mà CPU thấp: job không đóng (phòng đã trống mà agent chưa rời), xem log `job done`.

## Khắc phục

- Thêm sức chứa ngay: `kubectl -n uniwork scale deploy/uniwork-meeting-agent --replicas=<n>` chỉ có tác dụng nếu HPA cho phép; cách đúng là nâng `meetingAgent.maxReplicas` (và `minReplicas` cho giờ cao điểm) trong `deploy/app/uniwork/values.yaml` rồi `helm upgrade`. Mỗi pod giữ 4 CPU / 8 GiB; kiểm node pool còn chỗ trước.
- Cuộc họp đang chờ (`scribe_no_capacity`) tự có thư ký ở lần gửi lại kế tiếp khi đã có chỗ; lần chạy đã `FAILED` tự được gọi lại sau 10 phút. Không cần làm gì thêm cho chúng.
- Đã bật `meetingAgent.keda`: kiểm `ScaledObject` (`kubectl -n uniwork get scaledobject`) có đang scale theo `sum(scribe_jobs_running)` và trần `maxReplicas` của nó.
- Không restart pod đang có job để "giải phóng" chỗ: pod drain tới 4 giờ và các cuộc họp đang ghi mất phần còn lại.
- Sau sự cố: ghi số job mỗi pod lúc 70% tải vào `values.yaml` (thay ước lượng 10–25 job/pod của LiveKit) và tính lại `maxReplicas` cho số cuộc họp đồng thời lớn nhất cần phục vụ.

## Leo thang

- Hết chỗ quá 15 phút trong giờ làm việc, hoặc node pool không thêm được pod: nâng sev 1 với nhóm hạ tầng (node pool `pool-app`).
- Tải cao mà CPU thấp (job treo): gọi on-call backend, kèm log agent `--since=1h`.
- Giới hạn phiên mới mỗi phút của AssemblyAI (lỗi 1008 trong log `stt failed`) cũng chặn giờ cao điểm dù còn pod: báo chủ sản phẩm nâng hạn mức với nhà cung cấp (S0 results §1 mục 5b).

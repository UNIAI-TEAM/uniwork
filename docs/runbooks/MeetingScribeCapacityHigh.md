# MeetingScribeCapacityHigh — worker thư ký AI gần hết sức chứa

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.1, §4.6; ADR 0038; dashboard *UniWork · Meetings AI*

## Triệu chứng

- Alert `MeetingScribeCapacityHigh`: worker ít tải nhất (`lk_agents_worker_load`, do LiveKit Agents tự đo) đã trên 60% suốt 10 phút trong khi còn cuộc họp đang ghi. Worker từ chối job mới khi quá 70% (`load_threshold` trong `apps/meeting-agent/agent.py`).
- Khi mọi worker từ chối: cuộc họp mới không có thư ký. Server gọi lại mỗi 60 giây; lần thứ ba thì lần chạy thành `FAILED` và **10 phút** sau mới thử lại (`scribeRetryAfter`), nên một cuộc họp tràn mất khoảng 13 phút đầu transcript. Phòng hiện chip lỗi và quay về phụ đề Web Speech.
- Hay gặp lúc đầu giờ (9:00, 14:00): nhiều cuộc họp bắt đầu cùng phút. Thường đi kèm `MeetingScribeCannotJoin`.

## Kiểm tra

1. Tải và số job từng pod:
   ```promql
   max by (nodename) (lk_agents_worker_load)
   sum by (nodename) (lk_agents_active_job_count)
   sum(scribe_jobs_running)
   ```
   Một pod rất cao, pod khác thấp: job dồn lệch (LiveKit chọn worker theo tải báo lên), chờ vài phút. Mọi pod cao: thiếu pod.
2. HPA đã chạm trần chưa: `kubectl -n uniwork get hpa uniwork-meeting-agent` — `REPLICAS` bằng `MAXPODS` (mặc định `meetingAgent.maxReplicas: 6`) là hết chỗ; thấp hơn mà pod mới `Pending`: node pool hết CPU (`kubectl -n uniwork describe pod -l app.kubernetes.io/name=uniwork-meeting-agent | grep -A5 Events`).
3. Có cuộc họp đã bị bỏ lỡ chưa:
   ```promql
   sum(increase(uniwork_meetings_total{event=~"scribe_failed|scribe_dispatched"}[15m])) by (event)
   ```
   ```sql
   SELECT count(*) FROM meeting_scribe_runs WHERE status = 'FAILED' AND updated_at > now() - interval '30 minutes';
   ```
4. Tải cao vì CPU thật hay vì job treo: `kubectl -n uniwork top pod -l app.kubernetes.io/name=uniwork-meeting-agent`. Số job cao mà CPU thấp: job không đóng (phòng đã trống mà agent chưa rời), xem log `job done`.

## Khắc phục

- Thêm sức chứa ngay: `kubectl -n uniwork scale deploy/uniwork-meeting-agent --replicas=<n>` chỉ có tác dụng nếu HPA cho phép; cách đúng là nâng `meetingAgent.maxReplicas` (và `minReplicas` cho giờ cao điểm) trong `deploy/app/uniwork/values.yaml` rồi `helm upgrade`. Mỗi pod giữ 4 CPU / 8 GiB; kiểm node pool còn chỗ trước.
- Cuộc họp đã `FAILED` trong lúc thiếu chỗ tự được gọi lại sau 10 phút; không cần làm gì thêm cho chúng khi đã có chỗ.
- Không restart pod đang có job để "giải phóng" chỗ: pod drain tới 4 giờ và các cuộc họp đang ghi mất phần còn lại.
- Sau sự cố: ghi số job mỗi pod lúc 70% tải vào `values.yaml` (thay ước lượng 10–25 job/pod của LiveKit) và tính lại `maxReplicas` cho số cuộc họp đồng thời lớn nhất cần phục vụ.

## Leo thang

- Hết chỗ quá 15 phút trong giờ làm việc, hoặc node pool không thêm được pod: nâng sev 1 với nhóm hạ tầng (node pool `pool-app`).
- Tải cao mà CPU thấp (job treo): gọi on-call backend, kèm log agent `--since=1h`.
- Giới hạn phiên mới mỗi phút của AssemblyAI (lỗi 1008 trong log `stt failed`) cũng chặn giờ cao điểm dù còn pod: báo chủ sản phẩm nâng hạn mức với nhà cung cấp (S0 results §1 mục 5b).

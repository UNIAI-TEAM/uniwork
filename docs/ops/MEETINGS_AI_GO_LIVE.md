# Checklist: bật Meetings AI cho tổ chức khách hàng

> **Trạng thái:** in-progress — chưa mục nào được tích cho production (UNI-1995). Pháp lý và bên xử lý phụ: [`MEETINGS_AI_COMPLIANCE.md`](MEETINGS_AI_COMPLIANCE.md).

**Luật:** không bật cờ `meeting_scribe`, `meeting_transcription`, `meeting_caption_translate`
(và tóm tắt AI `meeting_ai_summary`, `meeting_minutes` khi `AI_PROVIDER` là một nhà cung cấp
nước ngoài) cho **bất kỳ tổ chức nào ngoài nội bộ UniWork** — qua `/admin`, `FF_*` hay override —
trước khi mọi dòng dưới đây được tích, có người và ngày. Người bật cờ đầu tiên cho khách ghi
link tới bản checklist đã tích trong lý do của thao tác admin (`reason`, lưu ở `admin_actions`).
Mỗi dòng ghi bằng chứng (link hợp đồng, PR, ảnh chụp dashboard, kết quả lệnh), không chỉ dấu tích.

## 1. Pháp lý

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 1.1 | DPA với **AssemblyAI** đã ký, có điều khoản chuyển dữ liệu quốc tế và thời hạn giữ cho cả streaming lẫn file | chủ sản phẩm + pháp chế | | [ ] |
| 1.2 | DPA / điều khoản dữ liệu với **nhà cung cấp LLM** đang dùng (`AI_PROVIDER`, hiện Anthropic) đã ký | chủ sản phẩm + pháp chế | | [ ] |
| 1.3 | Hồ sơ đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài theo Luật 91/2025/QH15 đã lập và nộp | pháp chế | | [ ] |
| 1.4 | Danh sách bên xử lý phụ (`MEETINGS_AI_COMPLIANCE.md` §2) đã công bố cho khách; điều khoản/chính sách quyền riêng tư đã cập nhật | chủ sản phẩm | | [ ] |
| 1.5 | Mục 1 của `MEETINGS_AI_COMPLIANCE.md` (căn cứ xử lý, sinh trắc học, chế tài) không còn dòng "pháp chế xác nhận" | pháp chế | | [ ] |
| 1.6 | Người dự họp, kể cả khách và người gọi điện vào, được báo việc ghi lời trước khi lời của họ được ghi (issue #2) | builder | | [ ] |

## 2. Vùng xử lý

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 2.1 | Vùng đã chọn (Mỹ hoặc EU) và ghi vào ADR 0038 mục "Bổ sung 2026-10-23" | chủ sản phẩm | | [ ] |
| 2.2 | `AI_MEETING_TRANSCRIBE_BASE_URL` của BE trỏ vùng đó (`deploy/app/env/uniwork-be.env`) | ops | | [ ] |
| 2.3 | Agent ghi lời trực tiếp cũng dùng vùng đó (`SCRIBE_STT_BASE_URL` trong Helm `meetingAgent`, issue #15; trước khi biến này có, agent luôn dùng endpoint Mỹ: chỉ chọn được vùng Mỹ) | ops | | [ ] |
| 2.4 | Model `universal-3-6-pro` có ở endpoint streaming của vùng đã chọn (một phiên thử thật, ghi vào S0 results) | ops | | [ ] |

## 3. Hạ tầng

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 3.1 | LiveKit server production (dùng chung với lms-core) **≥ v1.13.5** | ops | `livekit-server --version` | [ ] |
| 3.2 | Không worker nào đăng ký vào LiveKit dùng chung mà không đặt `agent_name` (nó sẽ tự vào mọi phòng, S0 §3) | ops | | [ ] |
| 3.3 | Image `uniwork-meeting-agent` được build và pin digest trong lần rollout (`MEETING_AGENT_DIGEST` trong `target/rollout.env` của Jenkins production); `meeting-agent-verify` (pip-audit + build) xanh trên commit đó | ops | | [ ] |
| 3.4 | Secret `uniwork-meeting-agent` (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ASSEMBLYAI_API_KEY`) tồn tại; key AssemblyAI là tài khoản trả phí | ops | | [ ] |
| 3.5 | `meetingAgent.livekitUrl` và `meetingAgent.egress.livekit.cidrs` đặt đúng (runbook `MeetingScribeCannotJoin`); `meetingAgent.enabled=true`, `MEETING_SCRIBE_ENABLED=true` trên BE | ops | | [ ] |
| 3.6 | Workflow `Meeting Scribe Nightly` xanh 7 đêm liên tiếp trên `develop` | builder | | [ ] |
| 3.7 | Sức chứa: số job mỗi pod ở 70% tải đã đo, `maxReplicas` tính từ số cuộc họp đồng thời cao nhất cần phục vụ, ghi vào `values.yaml` | ops | | [ ] |
| 3.8 | Hạn mức phiên STT mới mỗi phút của AssemblyAI (giờ cao điểm đầu giờ) đã thỏa thuận bằng văn bản | chủ sản phẩm | | [ ] |

## 4. Chất lượng

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 4.1 | Bộ đánh giá STT (`apps/meeting-agent/eval/README.md`) chạy trên 2–5 giờ cuộc họp thật, cả `live` và `batch`, ra **Đạt** ở ngưỡng mặc định (hoặc ngưỡng chủ sản phẩm ghi rõ) | chủ sản phẩm | `report.md` | [ ] |
| 4.2 | S0 results §1 mục 3, 5b, 6 đã điền: WER theo lát cắt, p95 độ trễ phụ đề, tỉ lệ phiên STT / giây nói đối chiếu hóa đơn đầu tiên | chủ sản phẩm | | [ ] |

## 5. Quan sát

| # | Việc | Ai | Bằng chứng | Xong |
|---|---|---|---|---|
| 5.1 | Prometheus production scrape được pod agent: `scribe_jobs_running`, `scribe_stt_errors_total`, `lk_agents_worker_load` có dữ liệu | ops | | [ ] |
| 5.2 | Dashboard *UniWork · Meetings AI* (`deploy/grafana/dashboards/meetings-ai.json`) có trên Grafana production | ops | | [ ] |
| 5.3 | Alert `MeetingScribeCannotJoin`, `MeetingScribeCapacityHigh`, `MeetingAutoSummaryFailing` và alert lỗi STT (issue #1) đã nạp và đi tới on-call | ops | | [ ] |

## 6. Ký duyệt

| Vai trò | Người | Ngày |
|---|---|---|
| Chủ sản phẩm | | |
| Pháp chế | | |
| Ops | | |

Tắt khẩn cấp (không cần checklist): `MEETING_SCRIBE_ENABLED=false` trên BE hoặc tắt cờ trong
`/admin`; phòng quay về phụ đề Web Speech (runbook `MeetingScribeCannotJoin`).

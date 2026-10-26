# MeetingAutoSummaryFailing — tóm tắt tự động sau họp thất bại hàng loạt

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Nền:** spec `docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md` §4.5 (D16); `server/internal/service/meeting_auto_summary.go`; dashboard *UniWork · Meetings AI*

## Triệu chứng

- Alert `MeetingAutoSummaryFailing`: hơn 20% lượt tóm tắt tự động trong 1 giờ kết thúc bằng `auto_summary_failed` (có ít nhất 5 lượt), kéo dài 15 phút.
- Chủ trì nhận thông báo "tự tóm tắt cuộc họp" thay vì tóm tắt; trang cuộc họp không có tóm tắt và không có việc cần làm được rút. Tóm tắt bấm tay cũng có thể lỗi theo nếu nguyên nhân là model.
- Không mất dữ liệu: transcript, ghi chú và chat vẫn còn; chủ trì bấm "Tóm tắt" lại được khi lỗi hết.

## Kiểm tra

1. Lỗi vì đâu (cùng nhãn với tóm tắt bấm tay):
   ```promql
   sum by (reason) (increase(uniwork_meeting_summary_errors_total[1h]))
   ```
   `provider`, `timeout`, `rate_limited`: nhà cung cấp model. `quota`: tổ chức hết tín dụng AI. `not_configured`: server không có provider (`AI_PROVIDER`). `parse`, `empty`: model trả sai dạng (đổi model hoặc prompt gần đây?). `store`: lỗi DB khi lưu.
2. Lượt gọi model của tóm tắt:
   ```promql
   sum by (status) (increase(uniwork_ai_calls_total{capability="meeting_summarization"}[1h]))
   ```
   `failed` tăng cùng lúc ở các capability khác: sự cố provider chung, xem thêm `UniworkAiModelErrors` và `docs/ops/RUNBOOK_AI.md`.
3. Thất bại không qua model (gói, công tắc): `auto_summary_failed` tăng mà `uniwork_meeting_summary_errors_total` đứng yên. Đó là tổ chức không có quyền gói `meeting.ai_summary`, gói hết hạn, hoặc tắt "Tóm tắt tự động" sau khi cuộc họp đã xếp hàng. Một tổ chức lớn đổi gói có thể tự kéo tỉ lệ lên; kiểm trong DB:
   ```sql
   -- One reminder per meeting that got none (Recorder.Emit: an outbox row, no audit row).
   SELECT organization_id, count(*) FROM outbox_events
   WHERE topic = 'meeting.auto_summary_failed' AND created_at > now() - interval '1 hour'
   GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
   ```
4. Hàng đợi có kẹt không: `SELECT count(*), max(attempts), min(due_at) FROM meeting_auto_summaries;` Dòng có `attempts` = 3 và `due_at` cũ: node chết giữa chừng nhiều lần (xem log `meetings: auto summary`).
5. Log server: `kubectl -n uniwork logs deploy/uniwork-be --since=1h | grep 'auto summary'` — chỉ có id cuộc họp và lỗi, không có nội dung.

## Khắc phục

- Provider lỗi hoặc chậm: làm theo `docs/ops/RUNBOOK_AI.md` "Khi có sự cố" (đổi model qua `AI_MODEL_*`, tăng `AI_TIMEOUT_SECONDS` nếu là `timeout`). Cuộc họp đã nhắc chủ trì không tự chạy lại; chủ trì bấm "Tóm tắt" khi provider ổn.
- `quota`: báo tổ chức đó (owner/admin) mua thêm tín dụng; không phải sự cố hệ thống.
- `not_configured` trên toàn hệ thống: biến `AI_PROVIDER`/khóa của BE bị mất trong lần deploy gần nhất; khôi phục env và restart BE.
- `parse`/`empty` sau một lần đổi model hoặc prompt: quay lại model/prompt trước (`server/internal/ai/prompts.go`), rồi mở issue.
- Cần dừng ngay mà không ảnh hưởng tóm tắt bấm tay: tắt cờ `meeting_ai_summary` cho tổ chức bị ảnh hưởng trong `/admin`, hoặc tổ chức tự tắt "Tóm tắt tự động" trong cài đặt cuộc họp.

## Leo thang

- Mọi tổ chức đều lỗi quá 30 phút trong giờ làm việc: nâng sev 2, gọi on-call backend.
- Lỗi do nhà cung cấp model kéo dài: báo người quản lý tài khoản provider; xem xét chuyển `AI_PROVIDER` theo `docs/ops/RUNBOOK_AI.md`.
- Nghi lỗi dữ liệu (`store`) hoặc hàng đợi kẹt không tự hết: gọi on-call DB.

# UniworkAiRunSecondsHigh — p95 tuổi run UniWork AI vượt 64 giây

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có panel cho series này: đọc `histogram_quantile(0.95, sum by (le) (rate(uniwork_ai_uniwork_run_seconds_bucket[30m])))` bằng Explore · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiRunSecondsHigh`: p95 `uniwork_ai_uniwork_run_seconds` (tuổi run tại mỗi lượt trả lời) vượt 64 giây liên tục 30 phút.
- Run dài bất thường: upstream chậm, vòng tool-result lặp (trần 10 lượt model, 8 vòng tool, A3) hoặc người dùng giữ run lâu.

## Kiểm tra

1. `UniworkAiLatencyP95High` cùng lúc? Upstream chậm làm run dài.
2. `run_limit_reached` (409, `fields.limit`) tăng: run chạm trần lượt/vòng.
3. Lượt cuối của run = độ dài run; gần 0 liên tục (ngược lại) là client mở run mới mỗi lượt (xem [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)).
4. Không đọc nội dung hội thoại để tìm nguyên nhân; chỉ dùng id, đếm và thời lượng.

## Khắc phục

- Xử lý nguyên nhân upstream chậm trước.
- Vòng tool lặp: chuyển model hoặc báo owner instruction pack (G6-14); không tăng trần A3.

## Leo thang

Kéo dài quá 2 giờ không do upstream: báo owner AI server (G6-03b) kèm biểu đồ p50/p95 và số `run_limit_reached`.

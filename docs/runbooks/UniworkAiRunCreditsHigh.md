# UniworkAiRunCreditsHigh — p95 token của run UniWork AI vượt 64.000

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` (ngưỡng pending G7-D1) · **Dashboard:** chưa có panel cho series này: đọc `histogram_quantile(0.95, sum by (le) (rate(uniwork_ai_uniwork_run_credits_bucket[30m])))` bằng Explore (chi phí USD có trên Grafana *UniWork · AI*) · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `UniworkAiRunCreditsHigh`: p95 `uniwork_ai_uniwork_run_credits` (token run đã tiêu sau mỗi lượt) vượt 64 000 liên tục 30 phút.
- Chi phí mỗi run cao bất thường; thường đi cùng `AiCostSpike` khi kéo dài.

## Kiểm tra

1. `AiCostSpike` có kêu không; ai tiêu: `topk(10, sum by (organization_id) (increase(uniwork_ai_cost_usd_total[1h])))` (chỉ khi ≤ 1000 tổ chức).
2. Prompt/instruction pack đổi (`prompt_id` `office_uniwork_ai@1`) hoặc tài liệu rất lớn trong ngữ cảnh?
3. Vòng tool lặp: `UniworkAiRunSecondsHigh` cùng lúc.
4. Quota `ai.tokens` của tổ chức đầu bảng có đặt không (`uniwork_ai_calls_total{status="rejected"}`).

## Khắc phục

- Một tổ chức lạm dụng: hạ quota `ai.tokens` theo `AiCostSpike`.
- Prompt phình ra: hoàn tác thay đổi instruction pack theo version (pack bất biến theo version).
- Cần dừng ngay: tắt flag `office_ai_uniwork`.

## Leo thang

Chi phí 1 giờ vượt ngưỡng sev 1 của `AiCostSpike`: theo `AiCostSpike`; ngoài ra báo owner AI server (G6-03b).

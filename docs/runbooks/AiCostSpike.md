# AiCostSpike — chi phí AI 1 giờ gấp 3 lần trung bình 7 ngày

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · AI* · **Nền:** [`docs/ops/RUNBOOK_AI.md`](../ops/RUNBOOK_AI.md)

## Triệu chứng

- Alert `AiCostSpike`: `sum(increase(uniwork_ai_cost_usd_total[1h])) > 3 * (sum(increase(uniwork_ai_cost_usd_total[7d])) / 168)` và chi phí giờ qua > 1 USD (sàn để không kêu khi mới bật AI).
- Không có triệu chứng phía người dùng — đây là alert tiền. Nếu cùng lúc `uniwork_ai_calls_total{status="failed"}` tăng thì có thể là retry vòng lặp gọi provider.
- Panel **Chi phí USD mỗi giờ** trên *UniWork · AI* có cột cao bất thường.

## Kiểm tra

1. Ai tiêu? Panel **Top 10 tổ chức theo chi phí (24h)**:
   ```promql
   topk(10, sum by (organization_id) (increase(uniwork_ai_cost_usd_total[1h])))
   ```
   (label `organization_id` chỉ có khi ≤ 1.000 tổ chức; ngoài mức đó dùng bảng `ai_usage_events`.)
2. Model nào? `sum by (provider, model) (increase(uniwork_ai_cost_usd_total[1h]))` — một model đắt (tier cao) xuất hiện đột ngột = ai đó đổi `AI_MODEL_<CAPABILITY>` hoặc `ai_model_rates` bị nhập sai giá.
3. Lượt gọi hay giá? `sum(increase(uniwork_ai_calls_total[1h]))` tăng cùng nhịp → nhiều lượt gọi hơn; không tăng → giá/token mỗi lượt tăng (prompt dài hơn, đổi model).
4. SQL:
   ```sql
   SELECT organization_id, capability, model, count(*), sum(cost_usd), sum(input_tokens + output_tokens)
   FROM ai_usage_events WHERE created_at > now() - interval '1 hour'
   GROUP BY 1, 2, 3 ORDER BY 5 DESC LIMIT 20;
   ```
5. Quota có bảo vệ không? Tổ chức đứng đầu có `rejected` chưa (`uniwork_ai_calls_total{status="rejected"}`)? Chưa → quota `ai.tokens` của tổ chức đó quá cao hoặc chưa đặt; xem `/admin/organizations/<id>` (màn hình quota sau flag `admin_quota`).
6. Vừa deploy? `uniwork_build_info` — thay đổi prompt/retry trong code có thể nhân số token.

## Khắc phục

- Một tổ chức lạm dụng → hạ quota `ai.tokens` của tổ chức qua billing/entitlement hoặc tắt flag `meeting_ai_summary` cho tổ chức đó ở `/admin/flags` (ghi lý do ≥ 10 ký tự); tệ hơn thì tạm khoá tổ chức.
- Model sai → sửa `AI_MODEL_<CAPABILITY>` về model trong allowlist mặc định, restart API. Giá sai → sửa `ai_model_rates`, chi phí đã ghi không đổi (kế toán xử lý sau).
- Bug retry/loop → hotfix; trong lúc chờ, bỏ key provider và restart: client tự ẩn tính năng AI, không lỗi 500.
- Tăng thật do nhiều người dùng → nâng ngưỡng bằng cách chờ 7 ngày trung bình tự lên; không sửa rule.

## Leo thang

- Chi phí 1 giờ > 100 USD hoặc không tìm ra nguồn trong 1 giờ → nâng sev 1, bỏ key provider để dừng chảy máu, báo người giữ hợp đồng provider.
- Liên quan hóa đơn khách hàng (quota sai) → báo người phụ trách billing trước khi sửa dữ liệu.

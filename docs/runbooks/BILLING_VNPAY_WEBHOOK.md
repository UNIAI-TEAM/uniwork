# BILLING_VNPAY_WEBHOOK — webhook billing VNPay (IPN) dead letter hoặc không áp gói

> **Trạng thái:** shipped · **Sev:** 2 · **Rule:** `deploy/alerts.yml` · **Metric:** `uniwork_billing_webhook_dead_total` · **Nền:** [`docs/superpowers/plans/2026-10-05-c04-vnpay-integration-guide.md`](../superpowers/plans/2026-10-05-c04-vnpay-integration-guide.md)

## Triệu chứng

- Alert `BILLING_VNPAY_WEBHOOK`: `sum(increase(uniwork_billing_webhook_dead_total[15m])) > 0`.
- Owner đã trả trên VNPay nhưng tab Thanh toán không đổi gói / không có hóa đơn mới.
- Hàng `webhook_inbox` ở `DEAD_LETTER` với `provider = vnpay` (hoặc `stripe` / `payos` trên cùng worker billing).

## Kiểm tra

1. IPN URL trên portal VNPay = `{API_PUBLIC_URL}/api/v1/billing/webhooks/vnpay` (HTTPS, gọi được từ internet; local cần tunnel ngrok).
2. Env: `BILLING_PROVIDER=vnpay`, `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `API_PUBLIC_URL` khớp sandbox/production.
3. Tra intent: `SELECT id, status, amount, plan_id, expires_at FROM billing_payment_intents WHERE provider_txn_ref = '<vnp_TxnRef>'`.
4. Tra inbox: `SELECT id, status, attempt_count, last_error FROM webhook_inbox WHERE provider = 'vnpay' ORDER BY received_at DESC LIMIT 20`.
5. Log server tại thời điểm IPN: tìm `vnpay webhook apply` hoặc `trace_id` từ response VNPay (`RspCode=99` = apply thất bại trong tx S1).

## Khắc phục

| Nguyên nhân | Hành động |
|-------------|-----------|
| Chữ ký / TMN / amount lệch | Sửa `VNPAY_*`; không trả `RspCode=00` khi apply fail (S1). |
| IPN không tới | Sửa tunnel / firewall; restart API sau khi đổi `API_PUBLIC_URL`. |
| Intent `expired`, đã trả trong 72h | Sửa lỗi apply, replay từ payload inbox hoặc gọi lại IPN từ VNPay nếu portal hỗ trợ. |
| Row DEAD sau bug code | Hotfix, deploy; replay inbox `PENDING` hoặc `ApplyProviderEvent` từ payload đã lưu (idempotent khi intent `completed`). |
| DEAD, amount/plan khớp, ngoài grace 72h | Ticket support: đối chiếu merchant portal, hoàn tiền / `ChangePlan` thủ công có audit. |

Sau khi xử lý, counter `uniwork_billing_webhook_dead_total` không tăng thêm; org owner thấy gói và hóa đơn đúng.

## Leo thang

- Nhiều org cùng lúc hoặc dead letter liên tục > 1 giờ → sev 1, kiểm tra deploy/config chung (secret, URL IPN).
- Chỉ một intent lẻ → sev 2, xử lý theo bảng trên; ghi `correlation_id` vào ticket.
- Không replay hàng loạt khi chưa xác định nguyên nhân chữ ký/amount — tránh ghi nhầm subscription.

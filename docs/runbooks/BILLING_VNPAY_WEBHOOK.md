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
4. Tra inbox: `SELECT id, status, attempt_count, last_error FROM webhook_inbox WHERE provider = 'vnpay' ORDER BY received_at DESC LIMIT 20`. Lỗi áp dụng không phải lệch tiền vẫn để lại hàng `PENDING` kèm payload IPN. Worker thử lại; hết lượt thì hàng thành `DEAD_LETTER`.
5. Log server tại thời điểm IPN: tìm `billing webhook queued for retry`, `vnpay webhook apply`, hoặc `RspCode` `99`. Phản hồi luôn là HTTP 200 JSON `{"RspCode","Message"}`.

## Khắc phục

| Nguyên nhân | Hành động |
|-------------|-----------|
| Chữ ký / TMN / amount lệch | Sửa `VNPAY_*`. Chữ ký sai trả `RspCode` `97`; lệch số tiền trả `04` và commit. Lỗi áp dụng khác được xếp hàng `PENDING` rồi ack `00` để VNPay ngừng gọi lại; worker thử lại từ payload. |
| IPN không tới | Sửa tunnel / firewall; restart API sau khi đổi `API_PUBLIC_URL`. |
| Intent `expired`, khách đã trả đúng số tiền | Apply nhận IPN: intent thành `completed`, có hóa đơn, gói đổi, `RspCode` `00`. Không cần sửa tay. |
| Intent `expired`, số tiền lệch | Intent chuyển `failed`, `RspCode` `04`, gói không đổi. Đối chiếu merchant portal rồi hoàn tiền thủ công. |
| Row DEAD sau bug code | Hotfix, deploy; replay inbox `PENDING` hoặc `ApplyProviderEvent` từ payload đã lưu (idempotent khi intent `completed`). |

Sau khi xử lý, counter `uniwork_billing_webhook_dead_total` không tăng thêm; org owner thấy gói và hóa đơn đúng.

## Leo thang

- Nhiều org cùng lúc hoặc dead letter liên tục > 1 giờ → sev 1, kiểm tra deploy/config chung (secret, URL IPN).
- Chỉ một intent lẻ → sev 2, xử lý theo bảng trên; ghi `correlation_id` vào ticket.
- Không replay hàng loạt khi chưa xác định nguyên nhân chữ ký/amount — tránh ghi nhầm subscription.

-- VNPay QueryDr/refund need the original vnp_OrderInfo and vnp_TransactionDate (PayDate).
ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS provider_order_info TEXT;
ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS provider_pay_date TEXT;

UPDATE billing_payment_intents pi
SET provider_order_info = 'UniWork ' || p.code
FROM plans p
WHERE pi.plan_id = p.id
  AND pi.provider = 'vnpay'
  AND (pi.provider_order_info IS NULL OR btrim(pi.provider_order_info) = '');

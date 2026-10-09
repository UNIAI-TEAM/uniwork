-- Admin manual refund (C-04): record hoàn tiền trên portal VNPay, không gọi API refund tự động.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'refunded'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_provider_ref TEXT;

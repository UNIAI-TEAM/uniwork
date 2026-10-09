-- Partial VNPay refund: track pending amount and cumulative refunded total.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN (
    'draft', 'open', 'paid', 'void', 'uncollectible',
    'refund_pending', 'partial_refund_pending', 'refunded'
  ));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_refunded BIGINT NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS partial_refund_amount BIGINT;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'refund_pending', 'refunded'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ;

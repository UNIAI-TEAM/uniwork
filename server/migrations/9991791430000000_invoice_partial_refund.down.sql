UPDATE invoices SET status = 'paid', partial_refund_amount = NULL
WHERE status = 'partial_refund_pending';

ALTER TABLE invoices DROP COLUMN IF EXISTS partial_refund_amount;
ALTER TABLE invoices DROP COLUMN IF EXISTS amount_refunded;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'refund_pending', 'refunded'));

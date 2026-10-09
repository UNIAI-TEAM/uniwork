ALTER TABLE invoices DROP COLUMN IF EXISTS refund_provider_ref;
ALTER TABLE invoices DROP COLUMN IF EXISTS refunded_at;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible'));

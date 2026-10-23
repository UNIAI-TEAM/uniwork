ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_confirm_reason TEXT;

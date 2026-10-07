-- C-04: who started checkout (org owner flow); copied to invoice on IPN success.
ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS created_by_kind TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS initiated_by TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS initiated_by_kind TEXT;

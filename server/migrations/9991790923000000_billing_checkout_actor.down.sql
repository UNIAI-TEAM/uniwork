ALTER TABLE invoices DROP COLUMN IF EXISTS initiated_by_kind;
ALTER TABLE invoices DROP COLUMN IF EXISTS initiated_by;
ALTER TABLE billing_payment_intents DROP COLUMN IF EXISTS created_by_kind;
ALTER TABLE billing_payment_intents DROP COLUMN IF EXISTS created_by;

ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS provider_bank_code TEXT;
ALTER TABLE billing_payment_intents ADD COLUMN IF NOT EXISTS provider_transaction_no TEXT;

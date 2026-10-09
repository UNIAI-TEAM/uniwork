ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

UPDATE invoices i SET payment_intent_id = pick.intent_id
FROM (
  SELECT DISTINCT ON (i2.id) i2.id AS invoice_id, pi.id AS intent_id
  FROM invoices i2
  JOIN billing_payment_intents pi ON pi.organization_id = i2.organization_id
    AND pi.subscription_id = i2.subscription_id
    AND pi.provider = i2.provider
    AND pi.status = 'completed'
    AND pi.amount = i2.amount_paid
  WHERE i2.payment_intent_id IS NULL
  ORDER BY i2.id, COALESCE(pi.completed_at, pi.created_at) DESC
) pick
WHERE i.id = pick.invoice_id AND i.payment_intent_id IS NULL;

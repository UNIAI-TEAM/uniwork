-- Invoices are written by BillingService from provider events (C-04). The
-- table lands with the schema so the provider adapter has somewhere to write.
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_invoice_id TEXT,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
  amount_due BIGINT NOT NULL,
  amount_paid BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'VND',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  hosted_url TEXT,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DOC-005 §3.1 / C-01 §14.3 (G1-03, UNI-677): the idempotency ledger learns
-- what payload a key was bound to. Nullable on purpose: rows written before
-- this column (and every legacy caller that passes no fingerprint) stay NULL,
-- which means "unknown", never "matches" - a caller that binds a fingerprint
-- refuses to replay such a row (service.BeginIdempotent). Values are
-- versioned ("v1:<sha256 hex>") so a later canonical form can coexist.
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

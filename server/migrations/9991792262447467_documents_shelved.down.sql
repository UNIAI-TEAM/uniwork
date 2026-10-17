ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_shelved_shape_check,
    DROP CONSTRAINT IF EXISTS documents_shelved_by_kind_check,
    DROP COLUMN IF EXISTS shelved_at,
    DROP COLUMN IF EXISTS shelved_by,
    DROP COLUMN IF EXISTS shelved_by_kind,
    DROP COLUMN IF EXISTS shelve_batch_id;

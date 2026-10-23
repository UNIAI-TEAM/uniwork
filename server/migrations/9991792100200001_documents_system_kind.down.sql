ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_system_kind_shape_check,
    DROP CONSTRAINT IF EXISTS documents_system_kind_check,
    DROP COLUMN IF EXISTS system_kind;

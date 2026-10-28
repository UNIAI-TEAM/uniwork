ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_template_mark_shape_check,
    DROP CONSTRAINT IF EXISTS documents_template_marked_by_kind_check,
    DROP COLUMN IF EXISTS template_marked_at,
    DROP COLUMN IF EXISTS template_marked_by,
    DROP COLUMN IF EXISTS template_marked_by_kind;

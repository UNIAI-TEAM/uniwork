-- Templates (UNI-2225): a template is an ordinary workspace file document
-- carrying a mark. The three columns are set together or not at all;
-- template_marked_by_kind is the attribution pair of template_marked_by
-- (ADR 0007). The mark is library state, not content: it never moves the
-- document's revision.
ALTER TABLE documents
    ADD COLUMN template_marked_at TIMESTAMPTZ NULL,
    ADD COLUMN template_marked_by TEXT NULL,
    ADD COLUMN template_marked_by_kind TEXT NULL,
    ADD CONSTRAINT documents_template_marked_by_kind_check
        CHECK (template_marked_by_kind IS NULL
            OR template_marked_by_kind IN ('human', 'agent', 'system')),
    ADD CONSTRAINT documents_template_mark_shape_check
        CHECK (
            (template_marked_at IS NULL AND template_marked_by IS NULL
                AND template_marked_by_kind IS NULL)
            OR (template_marked_at IS NOT NULL AND template_marked_by IS NOT NULL
                AND template_marked_by_kind IS NOT NULL)
        );

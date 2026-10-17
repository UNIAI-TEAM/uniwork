-- ARCHIVE-01 (UNI-1845; addendum §1): the shelved state - an item done with
-- its work is kept forever, read-only, out of the regular lists. "archive"
-- in code already means the trash, so the code name is shelved. All four
-- columns are set together or not at all; shelved_by_kind is the attribution
-- pair of shelved_by (ADR 0007). No purge_after: shelved is never swept.
ALTER TABLE documents
    ADD COLUMN shelved_at TIMESTAMPTZ NULL,
    ADD COLUMN shelved_by TEXT NULL,
    ADD COLUMN shelved_by_kind TEXT NULL,
    ADD COLUMN shelve_batch_id TEXT NULL,
    ADD CONSTRAINT documents_shelved_by_kind_check
        CHECK (shelved_by_kind IS NULL
            OR shelved_by_kind IN ('human', 'agent', 'system')),
    ADD CONSTRAINT documents_shelved_shape_check
        CHECK (
            (shelved_at IS NULL AND shelved_by IS NULL
                AND shelved_by_kind IS NULL AND shelve_batch_id IS NULL)
            OR (shelved_at IS NOT NULL AND shelved_by IS NOT NULL
                AND shelved_by_kind IS NOT NULL AND shelve_batch_id IS NOT NULL)
        );

-- MYFOLDER-01 (UNI-1850; addendum §1): marks a system-managed document row.
-- Today only 'my_folder' exists (one personal root folder per workspace and
-- member). It is valid only on a root, non-owned folder: kind = 'folder',
-- parent_id IS NULL and owner_kind IS NULL (which documents_owner_pair_check
-- already pairs with owner_id IS NULL).
ALTER TABLE documents
    ADD COLUMN system_kind TEXT NULL
        CONSTRAINT documents_system_kind_check
            CHECK (system_kind IS NULL OR system_kind IN ('my_folder')),
    ADD CONSTRAINT documents_system_kind_shape_check
        CHECK (system_kind IS NULL
            OR (kind = 'folder' AND parent_id IS NULL AND owner_kind IS NULL));

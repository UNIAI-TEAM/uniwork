-- file_id is the FileService reference the migrated export pipeline writes;
-- object_key still serves rows the legacy path completed during the change
-- window (plan §7 step 2). No REFERENCES: the lint forbids it and the file's
-- lifecycle belongs to FileService, not to this schema.
ALTER TABLE audit_exports ADD COLUMN file_id TEXT;

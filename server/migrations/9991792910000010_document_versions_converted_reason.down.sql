-- Rewrite any converted_version rows to upload before restoring the 984 CHECK.
UPDATE document_versions SET reason = 'upload' WHERE reason = 'converted_version';

ALTER TABLE document_versions DROP CONSTRAINT document_versions_reason_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_reason_check
  CHECK (reason IN ('manual', 'auto', 'restore', 'upload', 'agent'));

ALTER TABLE document_versions DROP COLUMN IF EXISTS converted_from_checksum;
ALTER TABLE document_versions DROP COLUMN IF EXISTS converted_from_version;

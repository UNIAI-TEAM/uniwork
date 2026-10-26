-- UNI-2213 (C5): a converted OOXML version of a legacy document (.doc/.xls/.ppt
-- -> .docx/.xlsx/.pptx) is appended onto the same document with
-- reason = 'converted_version' and the source version's ordinal + SHA-256
-- checksum recorded on the new version row.
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS converted_from_version INTEGER;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS converted_from_checksum TEXT;

ALTER TABLE document_versions DROP CONSTRAINT document_versions_reason_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_reason_check
  CHECK (reason IN ('manual', 'auto', 'restore', 'upload', 'agent', 'converted_version'));

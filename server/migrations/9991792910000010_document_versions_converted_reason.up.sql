-- UNI-2213 (C5): a converted OOXML version of a legacy document (.doc/.xls/.ppt
-- -> .docx/.xlsx/.pptx) is appended onto the same document with
-- reason = 'converted_version' and the source version's ordinal + SHA-256
-- checksum recorded on the new version row.
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS converted_from_version INTEGER;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS converted_from_checksum TEXT;

--
-- The widened CHECK goes in NOT VALID so adding it takes only a brief lock
-- (no scan of the document_versions table under ACCESS EXCLUSIVE); the next
-- migration validates it in its own transaction, where the scan only holds
-- SHARE UPDATE EXCLUSIVE.
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_reason_check;
ALTER TABLE document_versions ADD CONSTRAINT document_versions_reason_check
  CHECK (reason IN ('manual', 'auto', 'restore', 'upload', 'agent', 'converted_version')) NOT VALID;

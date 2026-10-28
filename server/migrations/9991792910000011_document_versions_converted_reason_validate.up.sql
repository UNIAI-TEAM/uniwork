-- Second half of document_versions_converted_reason: validate the CHECK added
-- NOT VALID. Its own file so the scan runs in its own transaction and holds
-- only SHARE UPDATE EXCLUSIVE, never the ACCESS EXCLUSIVE of the ADD above.
ALTER TABLE document_versions VALIDATE CONSTRAINT document_versions_reason_check;

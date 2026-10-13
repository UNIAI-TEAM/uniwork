-- Second half of documents_kind_folder: validate the CHECK added NOT VALID.
-- Its own file so the scan runs in its own transaction and holds only
-- SHARE UPDATE EXCLUSIVE, never the ACCESS EXCLUSIVE of the ADD above.
ALTER TABLE documents VALIDATE CONSTRAINT documents_kind_check;

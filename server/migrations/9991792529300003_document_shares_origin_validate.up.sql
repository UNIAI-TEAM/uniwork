-- Second half of document_shares_origin: validate the CHECK added NOT VALID.
-- Its own file so the scan runs in its own transaction and holds only
-- SHARE UPDATE EXCLUSIVE, never the ACCESS EXCLUSIVE of the ADD above.
ALTER TABLE document_shares VALIDATE CONSTRAINT document_shares_origin_check;

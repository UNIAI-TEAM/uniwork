ALTER TABLE document_shares
  DROP CONSTRAINT document_shares_origin_check,
  DROP COLUMN origin;

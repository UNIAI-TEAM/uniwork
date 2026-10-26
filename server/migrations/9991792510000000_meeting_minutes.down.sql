ALTER TABLE meetings
  DROP COLUMN minutes_finalized_version_id,
  DROP COLUMN minutes_finalized_by,
  DROP COLUMN minutes_finalized_at,
  DROP COLUMN minutes_document_id;

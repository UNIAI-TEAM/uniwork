-- A meeting's minutes are a UniNote page it references (UNI-2003, spec
-- meeting follow-through §5.2, D12). Finalizing records the document version
-- taken at that moment; reopening clears the three finalized columns and the
-- version stays in the page's history. No foreign keys (repo rule): a page
-- deleted or in the trash reads as no minutes.
ALTER TABLE meetings
  ADD COLUMN minutes_document_id TEXT,
  ADD COLUMN minutes_finalized_at TIMESTAMPTZ,
  ADD COLUMN minutes_finalized_by TEXT,
  ADD COLUMN minutes_finalized_version_id TEXT;

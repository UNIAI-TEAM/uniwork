-- OQ-P1 (a1) rolling-deploy guard (G5-07, BE-I1-4): the previous binary's
-- content writes do not name content_revision, so during a rolling deploy the
-- column would keep the revision of the last content change while revision
-- advanced - and a stale base would be accepted (content_revision <= base <=
-- revision) after that write: a silent lost update. This trigger moves
-- content_revision with any revision bump that changes a content-bearing
-- column (the page content and its extracted text columns, content_saved_at,
-- and the file version pointer), so the column is right whatever binary wrote
-- the row. The current binary's queries keep their explicit SET; the trigger
-- assigns the same value they do and never bumps twice.
--
-- The trigger lives alone in this file on purpose: nothing else changes the
-- documents table, so the down migration drops exactly it (and its function).
CREATE OR REPLACE FUNCTION documents_content_revision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_revision := NEW.revision;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS documents_content_revision_guard ON documents;
CREATE TRIGGER documents_content_revision_guard
  BEFORE UPDATE ON documents
  FOR EACH ROW
  WHEN (NEW.revision IS DISTINCT FROM OLD.revision
    AND (NEW.content IS DISTINCT FROM OLD.content
      OR NEW.content_text IS DISTINCT FROM OLD.content_text
      OR NEW.content_bytes IS DISTINCT FROM OLD.content_bytes
      OR NEW.content_saved_at IS DISTINCT FROM OLD.content_saved_at
      OR NEW.file_version_id IS DISTINCT FROM OLD.file_version_id))
  EXECUTE FUNCTION documents_content_revision_guard();

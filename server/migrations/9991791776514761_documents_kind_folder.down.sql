-- Folders cannot survive the old constraint: their children re-root and the
-- folder rows go, so the narrower CHECK can come back.
UPDATE documents SET parent_id = NULL
WHERE parent_id IN (SELECT id FROM documents WHERE kind = 'folder');
DELETE FROM documents WHERE kind = 'folder';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check
  CHECK (kind IN ('page', 'file'));

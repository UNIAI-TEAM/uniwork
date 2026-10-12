-- Folders (GO-D1): a document of kind `folder` holds pages, files and other
-- folders. It never carries content (documents_content_kind_check already
-- admits only pages there) and never gets a version or a file blob - the
-- service refuses those routes on a folder.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check
  CHECK (kind IN ('page', 'file', 'folder'));

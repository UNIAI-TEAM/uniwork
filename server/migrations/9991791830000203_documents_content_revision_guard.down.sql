-- Rollback of 9991791830000203: drop the trigger (and ONLY the trigger - it
-- was the file's whole content) and its function, leaving every explicit SET
-- in the queries as the only writer of content_revision.
DROP TRIGGER IF EXISTS documents_content_revision_guard ON documents;
DROP FUNCTION IF EXISTS documents_content_revision_guard();

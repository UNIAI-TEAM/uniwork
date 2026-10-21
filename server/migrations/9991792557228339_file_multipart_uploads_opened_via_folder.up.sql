-- Folder upload (UNI-2052): a large file of a folder batch runs the BIGUP-S1
-- multipart session with opened_via 'folder'. The standalone upload-session
-- routes answer not_found for it (only the batch completes it), and it does
-- not count toward the four open sessions a person may hold one by one. Like
-- 'workspace' it names no document until it completes.
ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_opened_via_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_opened_via_check CHECK (
    opened_via IN ('workspace', 'version', 'frame', 'folder')
);

ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_frame_scope_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_frame_scope_check CHECK (
    (opened_via = 'frame' AND token_document_id IS NOT NULL AND document_id = token_document_id)
    OR (opened_via = 'version' AND document_id IS NOT NULL AND token_document_id IS NULL)
    OR (opened_via IN ('workspace', 'folder') AND document_id IS NULL AND token_document_id IS NULL)
);

-- Sessions of the value being removed would fail the narrower checks.
DELETE FROM file_multipart_uploads WHERE opened_via = 'folder';

ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_frame_scope_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_frame_scope_check CHECK (
    (opened_via = 'frame' AND token_document_id IS NOT NULL AND document_id = token_document_id)
    OR (opened_via = 'version' AND document_id IS NOT NULL AND token_document_id IS NULL)
    OR (opened_via = 'workspace' AND document_id IS NULL AND token_document_id IS NULL)
);

ALTER TABLE file_multipart_uploads DROP CONSTRAINT file_multipart_uploads_opened_via_check;
ALTER TABLE file_multipart_uploads ADD CONSTRAINT file_multipart_uploads_opened_via_check CHECK (
    opened_via IN ('workspace', 'version', 'frame')
);

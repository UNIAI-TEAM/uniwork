-- Folder upload (UNI-2052): the server content route (the target of a store
-- that cannot presign) records the ETag it answered, the quoted SHA-256 of the
-- stored bytes, so COMPLETE can match the ETag the client sends back. A file
-- whose target is a presigned PUT keeps it NULL: its bytes are verified
-- through the FileService provider output instead.
--
-- upload_attempt counts how often COMPLETE dropped a file's upload because
-- the bytes did not match the plan (size_mismatch) or were gone: the file
-- stays pending and the next target is minted afresh. It is part of the
-- FileService operation id of a presigned target, so the new intent never
-- finds the dropped one.
ALTER TABLE document_folder_upload_files ADD COLUMN content_etag TEXT;
ALTER TABLE document_folder_upload_files ADD COLUMN upload_attempt INTEGER NOT NULL DEFAULT 0;

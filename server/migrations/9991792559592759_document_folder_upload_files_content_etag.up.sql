-- Folder upload (UNI-2052): the server content route (the target of a store
-- that cannot presign) records the ETag it answered, the quoted SHA-256 of the
-- stored bytes, so COMPLETE can match the ETag the client sends back. A file
-- whose target is a presigned PUT keeps it NULL: its bytes are verified
-- through the FileService provider output instead.
ALTER TABLE document_folder_upload_files ADD COLUMN content_etag TEXT;

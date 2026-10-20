-- UNI-2039 S3: where a share came from, so the access report can say "sent in
-- Chat" without inferring it. Existing rows are read as direct; the chat
-- document-share path writes chat. No channel name is stored: the report
-- reader may not be in that channel. No foreign key and no index (the report
-- reads shares by document, which the live-share index already serves).
ALTER TABLE document_shares
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'direct',
  ADD CONSTRAINT document_shares_origin_check CHECK (origin IN ('direct', 'chat'));

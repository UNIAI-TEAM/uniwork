-- UNI-2039 S3: where a share came from, so the access report can say "sent in
-- Chat" without inferring it. Existing rows are read as direct; the chat
-- document-share path writes chat. No channel name is stored: the report
-- reader may not be in that channel. No foreign key and no index here (the report
-- reads live shares by document through the live-share index; its all-rows read
-- has the *_changed_idx indexes of UNI-2039 r1 F1).
-- The CHECK is added NOT VALID, so the table (it keeps every revoked share) is
-- not scanned under ACCESS EXCLUSIVE; the next file validates it (UNI-2039 r1 F4).
ALTER TABLE document_shares
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'direct',
  ADD CONSTRAINT document_shares_origin_check CHECK (origin IN ('direct', 'chat')) NOT VALID;

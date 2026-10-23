-- The documents behind a document_changed notification (UNI-2056
-- DOC-CHANGE-NOTIFY): one row per (notification, document), so a command over
-- 50 documents is one inbox row with 50 entries here, and a later command
-- folded into the same open notification adds its documents without counting
-- one twice. The consumer writes it in the notification's own transaction;
-- the reader re-checks document access on every read, so a row never proves
-- access by itself.
--
-- title_snapshot is set only for verb deleted: the document row is gone when
-- the notice is read, so the title taken at the purge is the only name left.
-- No FOREIGN KEY (migration lint): notification and document are joined in
-- service code, and the row outlives a purged document by design.
CREATE TABLE notification_documents (
  organization_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  title_snapshot  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notification_documents_ids_nonempty
    CHECK (organization_id <> '' AND notification_id <> '' AND document_id <> ''),
  PRIMARY KEY (notification_id, document_id)
);

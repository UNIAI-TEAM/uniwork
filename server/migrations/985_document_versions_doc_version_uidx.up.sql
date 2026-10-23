-- One row per (document, version) ordinal (C-01 §3.2; UNI-675).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_document_versions_doc_version
  ON document_versions (document_id, version);

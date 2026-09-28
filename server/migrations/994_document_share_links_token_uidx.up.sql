-- Token-hash lookup for anonymous link resolution (C-01 §3.5; UNI-675).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_document_share_links_token
  ON document_share_links (token_hash);

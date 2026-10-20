CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_link_previews_org_url
  ON chat_link_previews (organization_id, url_hash);

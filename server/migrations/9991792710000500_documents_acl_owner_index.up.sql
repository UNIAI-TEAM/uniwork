-- DOC-06b (UNI-2092, addendum §5): the bulk owner transfer lists, counts and
-- checks has_more by (organization_id, acl_owner_id) in id order; id is in the
-- key so a batch's `id > after ORDER BY id` walks the index directly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_org_acl_owner ON documents (organization_id, acl_owner_id, id) WHERE owner_kind IS NULL AND acl_owner_id IS NOT NULL;

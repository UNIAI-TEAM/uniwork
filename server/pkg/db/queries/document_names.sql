-- Document and folder names (E6 FD-02, appendix §3.3). One expression is the
-- canonical duplicate key - lower(title COLLATE "und-x-icu") over the NFC
-- title - and it appears once, here. The folder create and rename pre-check,
-- the "(n)" allocator of a move and a restore, and the dedupe migration all
-- compare that same key, so "same name" cannot drift between them. Go never
-- lowercases: both the candidate keys and the keys already held come back from
-- this query.

-- The name keys of the caller's candidate titles, one row per title in the
-- order given, each with whether a live document of the same kind under the
-- same parent already holds that key. archived_at and owner_id keep the rule
-- to live, tree-standing rows; the parent is COALESCE(parent_id, '') so the
-- root is one parent. exclude_id is the row being renamed or moved: it never
-- collides with itself.
-- name: ListDocumentNameKeys :many
WITH candidates AS (
  SELECT t.ord, lower(t.title COLLATE "und-x-icu") AS key
  FROM unnest(sqlc.arg(titles)::text[]) WITH ORDINALITY AS t(title, ord)
)
SELECT c.ord::int4 AS ord, c.key AS key,
  EXISTS (
    SELECT 1
    FROM documents d
    WHERE d.organization_id = sqlc.arg(organization_id)
      AND d.workspace_id = sqlc.arg(workspace_id)
      AND d.kind = sqlc.arg(kind)
      AND d.archived_at IS NULL
      AND d.owner_id IS NULL
      AND d.system_kind IS NULL
      AND d.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
      AND d.id IS DISTINCT FROM sqlc.narg(exclude_id)::text
      AND lower(d.title COLLATE "und-x-icu") = c.key
  ) AS taken
FROM candidates c
ORDER BY c.ord;

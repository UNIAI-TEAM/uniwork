-- Folder name dedupe (E6 FD-02, UNI-1462 PR 1; appendix §3.3). Two data
-- fixes, in this order, so the unique index of PR 2 builds on a clean table:
--
--   1. every live folder title is composed (NFC), because the duplicate key
--      lower(title COLLATE "und-x-icu") compares composed text;
--   2. in each group of live folders sharing the key of one workspace under
--      one parent, the oldest row (created_at, id) keeps the name and the
--      later ones take "Tên (n)", n the smallest free number in that parent
--      - a number an existing "Tên (2)" already holds is skipped, and the
--      numbers this run hands out do not collide with each other.
--
-- Not reversible (a data fix cannot know which of two equal names came
-- first), no audit row (this is not a user command), no index and no foreign
-- key. Idempotent: a second run finds single-row groups and composed titles
-- and changes nothing.

UPDATE documents
SET title = normalize(title, NFC)
WHERE kind = 'folder'
  AND archived_at IS NULL
  AND normalize(title, NFC) <> title;

WITH live AS (
  SELECT d.id, d.workspace_id, COALESCE(d.parent_id, '') AS parent_key, d.title,
         lower(d.title COLLATE "und-x-icu") AS name_key, d.created_at
  FROM documents d
  WHERE d.kind = 'folder' AND d.archived_at IS NULL AND d.owner_id IS NULL
),
ranked AS (
  SELECT l.*,
         row_number() OVER (PARTITION BY l.workspace_id, l.parent_key, l.name_key ORDER BY l.created_at, l.id) AS rn
  FROM live l
),
-- One representative per group: every member shares the key, so the names it
-- builds ("Tên (n)") collide or not together.
groups AS (
  SELECT DISTINCT ON (workspace_id, parent_key, name_key)
         workspace_id, parent_key, name_key, title AS base_title
  FROM ranked
  ORDER BY workspace_id, parent_key, name_key, rn
),
-- The free numbers of each group, in order: every number the parent does not
-- already use. A parent can hold at most one live row per number it uses, so
-- its own row count bounds the search.
free AS (
  SELECT g.workspace_id, g.parent_key, g.name_key, n.n,
         row_number() OVER (PARTITION BY g.workspace_id, g.parent_key, g.name_key ORDER BY n.n) AS slot
  FROM groups g
  CROSS JOIN LATERAL generate_series(
    2, 2 + (SELECT count(*) FROM live l2 WHERE l2.workspace_id = g.workspace_id AND l2.parent_key = g.parent_key)
  ) AS n(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM live l
    WHERE l.workspace_id = g.workspace_id AND l.parent_key = g.parent_key
      AND l.name_key = lower(g.base_title || ' (' || n.n || ')') COLLATE "und-x-icu"
  )
)
UPDATE documents d
SET title = r.title || ' (' || f.n || ')'
FROM ranked r
JOIN free f
  ON f.workspace_id = r.workspace_id
 AND f.parent_key = r.parent_key
 AND f.name_key = r.name_key
 AND f.slot = r.rn - 1
WHERE d.id = r.id AND r.rn > 1;

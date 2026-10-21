-- UNI-1999 (meeting follow-through đợt 4, spec §5.1): catch-up copy before
-- meeting_summary_task_links is dropped, shipped one release after UNI-1998
-- so old servers kept working through that rollout (review R1 S1). While
-- UNI-1998 rolled out, an old server could still run after 9991792494400001
-- had copied the links: it stored summaries without action-item rows and
-- wrote new links.
--
-- 0. A meeting's latest summary with no row at all (an old server stored it)
--    gets its AI rows as step 1 of 9991792494400001 made them, each carrying
--    the task of its oldest live link. As the server does when it stores a
--    summary (spec §7.1), an item whose title (case and spacing aside)
--    matches a row the meeting already has, or an earlier item of the same
--    summary, makes no row, so a dismissed item does not come back. The
--    pending rows of the summary it replaced are kept: a migration deletes
--    nothing a person may be looking at.
--
-- Then every live link (its task still exists) whose task no action item
-- carries yet is copied again, with the rules of steps 1-2:
--
-- 1. The link's item is still a pending AI row of the same summary (same
--    title; a summary the new server stored numbers its rows itself, so the
--    title, not the position, finds it): each link picks the first such
--    row, and each row takes the oldest link that picked it, so two links
--    never race for one row. A dismissed row is left alone.
-- 2. Every live link still not carried by a row becomes a row from the
--    summary's item, as 9991792494400001 did for older summaries.
--
-- Idempotent: step 0 skips a summary that has rows; once a link's task is on
-- a row, steps 1-2 do not see it again, and the row ids are derived from the
-- summary item or the link. Titles are trimmed of ASCII whitespace as Go's
-- strings.TrimSpace stored them (btrim alone trims spaces only).
WITH latest AS (
  SELECT DISTINCT ON (meeting_id) id, meeting_id, organization_id, action_items, created_at
  FROM meeting_summaries
  ORDER BY meeting_id, created_at DESC, id DESC
),
live_links AS (
  SELECT DISTINCT ON (l.summary_id, l.item_index)
    l.summary_id, l.item_index, l.task_id, l.created_by, l.created_at
  FROM meeting_summary_task_links l
  JOIN tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
  ORDER BY l.summary_id, l.item_index, l.created_at, l.id
),
items AS (
  SELECT s.id AS summary_id, s.meeting_id, s.organization_id, s.created_at,
         (e.ord - 1)::int AS item_index, e.item,
         btrim(e.item->>'title', E' \t\n\r\x0B\x0C') AS title
  FROM latest s
  -- CASE branches run in order: a value that is not JSON is never cast.
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN NOT pg_input_is_valid(s.action_items, 'jsonb') THEN '[]'::jsonb
      WHEN jsonb_typeof(s.action_items::jsonb) = 'array' THEN s.action_items::jsonb
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS e(item, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM meeting_action_items i WHERE i.organization_id = s.organization_id AND i.summary_id = s.id
  )
),
fresh AS (
  SELECT DISTINCT ON (i.summary_id, lower(regexp_replace(i.title, '\s+', ' ', 'g'))) i.*
  FROM items i
  WHERE jsonb_typeof(i.item) = 'object'
    AND COALESCE(i.title, '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM meeting_action_items k
      WHERE k.organization_id = i.organization_id AND k.meeting_id = i.meeting_id
        AND lower(regexp_replace(btrim(k.title, E' \t\n\r\x0B\x0C'), '\s+', ' ', 'g')) = lower(regexp_replace(i.title, '\s+', ' ', 'g'))
    )
  ORDER BY i.summary_id, lower(regexp_replace(i.title, '\s+', ' ', 'g')), i.item_index
)
INSERT INTO meeting_action_items (
  id, organization_id, workspace_id, meeting_id, source, summary_id, position,
  title, owner_text, due_text, task_id, converted_at, converted_by,
  created_by, created_by_kind, created_at, updated_at
)
SELECT
  -- The id step 1 of 9991792494400001 gives the same item.
  '01K80ACTN0' || upper(substr(md5(f.summary_id || ':' || f.item_index), 1, 16)),
  f.organization_id, m.workspace_id, f.meeting_id, 'AI', f.summary_id, f.item_index,
  f.title,
  COALESCE(btrim(f.item->>'owner', E' \t\n\r\x0B\x0C'), ''), COALESCE(btrim(f.item->>'due', E' \t\n\r\x0B\x0C'), ''),
  ll.task_id, ll.created_at, ll.created_by,
  'meeting_summary', 'system', f.created_at, f.created_at
FROM fresh f
JOIN meetings m ON m.id = f.meeting_id AND m.organization_id = f.organization_id
LEFT JOIN live_links ll ON ll.summary_id = f.summary_id AND ll.item_index = f.item_index
ON CONFLICT (id) DO NOTHING;

WITH live AS (
  SELECT DISTINCT ON (l.summary_id, l.item_index)
    l.id, l.organization_id, l.summary_id, l.item_index, l.task_id, l.created_by, l.created_at
  FROM meeting_summary_task_links l
  JOIN tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
  WHERE NOT EXISTS (
    SELECT 1 FROM meeting_action_items i WHERE i.organization_id = l.organization_id AND i.task_id = l.task_id
  )
  ORDER BY l.summary_id, l.item_index, l.created_at, l.id
),
picks AS (
  SELECT DISTINCT ON (live.summary_id, live.item_index)
    i.id AS item_id, live.id AS link_id, live.task_id, live.created_by, live.created_at
  FROM live
  JOIN meeting_summaries s ON s.id = live.summary_id AND s.organization_id = live.organization_id
  JOIN meeting_action_items i ON i.organization_id = live.organization_id AND i.summary_id = live.summary_id
    AND i.source = 'AI' AND i.dismissed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = i.task_id AND t.organization_id = i.organization_id)
    -- CASE branches run in order: a value that is not JSON is never cast.
    AND i.title = btrim(CASE
      WHEN NOT pg_input_is_valid(s.action_items, 'jsonb') THEN NULL
      WHEN jsonb_typeof(s.action_items::jsonb) = 'array' THEN s.action_items::jsonb -> live.item_index ->> 'title'
    END, E' \t\n\r\x0B\x0C')
  ORDER BY live.summary_id, live.item_index, i.position, i.id
),
targets AS (
  SELECT DISTINCT ON (item_id) item_id, task_id, created_by, created_at
  FROM picks
  ORDER BY item_id, created_at, link_id
)
UPDATE meeting_action_items i
SET task_id = targets.task_id, converted_at = targets.created_at, converted_by = targets.created_by, updated_at = now()
FROM targets
WHERE i.id = targets.item_id;

INSERT INTO meeting_action_items (
  id, organization_id, workspace_id, meeting_id, source, summary_id, position,
  title, owner_text, due_text, task_id, converted_at, converted_by,
  created_by, created_by_kind, created_at, updated_at
)
SELECT
  -- 26 characters, a prefix of its own (step 1 of 9991792494400001 uses
  -- 01K80ACTN0) and a hash of the link, so a re-run names the same row.
  '01K80ACTN1' || upper(substr(md5(l.id), 1, 16)),
  l.organization_id, m.workspace_id, l.meeting_id, 'AI', l.summary_id, l.item_index,
  btrim(e.item->>'title', E' \t\n\r\x0B\x0C'),
  COALESCE(btrim(e.item->>'owner', E' \t\n\r\x0B\x0C'), ''), COALESCE(btrim(e.item->>'due', E' \t\n\r\x0B\x0C'), ''),
  l.task_id, l.created_at, l.created_by,
  'meeting_summary', 'system', s.created_at, s.created_at
FROM meeting_summary_task_links l
JOIN tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
JOIN meetings m ON m.id = l.meeting_id AND m.organization_id = l.organization_id
JOIN meeting_summaries s ON s.id = l.summary_id AND s.organization_id = l.organization_id
CROSS JOIN LATERAL (SELECT CASE
  WHEN NOT pg_input_is_valid(s.action_items, 'jsonb') THEN NULL
  WHEN jsonb_typeof(s.action_items::jsonb) = 'array' THEN s.action_items::jsonb -> l.item_index
END AS item) e
WHERE NOT EXISTS (
    SELECT 1 FROM meeting_action_items i WHERE i.organization_id = l.organization_id AND i.task_id = l.task_id
  )
  AND jsonb_typeof(e.item) = 'object'
  AND COALESCE(btrim(e.item->>'title', E' \t\n\r\x0B\x0C'), '') <> ''
ON CONFLICT (id) DO NOTHING;

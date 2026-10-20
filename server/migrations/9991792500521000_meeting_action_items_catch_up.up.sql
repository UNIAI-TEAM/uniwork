-- UNI-1999 (meeting follow-through đợt 4, spec §5.1): catch-up copy before
-- meeting_summary_task_links is dropped. While đợt 3 rolled out, an old
-- server could still run after 9991792494400001 had copied the links, and
-- write new ones. Every live link (its task still exists) whose task no
-- action item carries yet is copied again here, with the rules of steps 1-2:
--
-- 1. The link's item is still a pending AI row of the same summary (same
--    title; a summary the new server stored numbers its rows itself, so the
--    title, not the position, finds it): that row takes the task of the
--    oldest such link. A dismissed row is left alone.
-- 2. Every live link still not carried by a row becomes a row from the
--    summary's item, as 9991792494400001 did for older summaries.
--
-- Idempotent: once a link's task is on a row, neither statement sees it
-- again, and the row id of step 2 is derived from the link id.
WITH live AS (
  SELECT DISTINCT ON (l.summary_id, l.item_index)
    l.organization_id, l.summary_id, l.item_index, l.task_id, l.created_by, l.created_at
  FROM meeting_summary_task_links l
  JOIN tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
  WHERE NOT EXISTS (
    SELECT 1 FROM meeting_action_items i WHERE i.organization_id = l.organization_id AND i.task_id = l.task_id
  )
  ORDER BY l.summary_id, l.item_index, l.created_at, l.id
),
targets AS (
  SELECT DISTINCT ON (live.summary_id, live.item_index)
    i.id AS item_id, live.task_id, live.created_by, live.created_at
  FROM live
  JOIN meeting_summaries s ON s.id = live.summary_id AND s.organization_id = live.organization_id
  JOIN meeting_action_items i ON i.organization_id = live.organization_id AND i.summary_id = live.summary_id
    AND i.source = 'AI' AND i.dismissed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = i.task_id AND t.organization_id = i.organization_id)
    -- CASE branches run in order: a value that is not JSON is never cast.
    AND i.title = btrim(CASE
      WHEN NOT pg_input_is_valid(s.action_items, 'jsonb') THEN NULL
      WHEN jsonb_typeof(s.action_items::jsonb) = 'array' THEN s.action_items::jsonb -> live.item_index ->> 'title'
    END)
  ORDER BY live.summary_id, live.item_index, i.position, i.id
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
  btrim(e.item->>'title'),
  COALESCE(btrim(e.item->>'owner'), ''), COALESCE(btrim(e.item->>'due'), ''),
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
  AND COALESCE(btrim(e.item->>'title'), '') <> ''
ON CONFLICT (id) DO NOTHING;

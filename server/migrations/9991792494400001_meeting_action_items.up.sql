-- UNI-1998 (meeting follow-through, đợt 3): the action items of a meeting as
-- rows with a stable id that live with the meeting, not with one summary.
-- meeting_summaries stays append-only and keeps the model's answer verbatim.
-- A row's state is derived, never stored: DISMISSED when dismissed_at is set,
-- otherwise CONVERTED when task_id names a task that still exists (tasks are
-- hard-deleted, nothing cascades), otherwise PENDING. source: AI (a summary
-- proposed it), MANUAL (a clerk typed it), LIVE (the AI scribe pulled it out
-- during the meeting; no writer until UNI-2025).
CREATE TABLE meeting_action_items (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  meeting_id       TEXT NOT NULL,
  source           TEXT NOT NULL,
  summary_id       TEXT NULL,
  position         INT  NOT NULL,
  title            TEXT NOT NULL,
  owner_text       TEXT NOT NULL DEFAULT '',
  due_text         TEXT NOT NULL DEFAULT '',
  task_id          TEXT NULL,
  converted_at     TIMESTAMPTZ NULL,
  converted_by     TEXT NULL,
  dismissed_at     TIMESTAMPTZ NULL,
  dismissed_by     TEXT NULL,
  dismiss_reason   TEXT NOT NULL DEFAULT '',
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_action_items_source_check CHECK (source IN ('AI', 'MANUAL', 'LIVE')),
  CONSTRAINT meeting_action_items_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);

-- Backfill (spec §5.1). A "live" link is one whose task still exists, as
-- ListLiveMeetingSummaryTaskLinks reads it; per item the oldest live link
-- wins (an item converted again after its first task was deleted has its
-- oldest link on the deleted task).
--
-- 1. Every item of each meeting's latest summary becomes an AI row, carrying
--    the task of its oldest live link when it has one.
-- 2. Every live link of an older summary becomes a row with its task, so no
--    converted item is lost and no pending item of an old summary comes back.
-- A stored array that is not an array, or an item with a blank title, makes
-- no row.
WITH latest AS (
  SELECT DISTINCT ON (meeting_id) id, meeting_id
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
         (latest.id IS NOT NULL) AS is_latest
  FROM meeting_summaries s
  LEFT JOIN latest ON latest.id = s.id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.action_items::jsonb) = 'array' THEN s.action_items::jsonb ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS e(item, ord)
)
INSERT INTO meeting_action_items (
  id, organization_id, workspace_id, meeting_id, source, summary_id, position,
  title, owner_text, due_text, task_id, converted_at, converted_by,
  created_by, created_by_kind, created_at, updated_at
)
SELECT
  -- Deterministic 26-character id, as migration 131 seeds statuses: a fixed
  -- prefix and a hash of the item's place, so a re-run names the same row.
  '01K80ACTN0' || upper(substr(md5(i.summary_id || ':' || i.item_index), 1, 16)),
  i.organization_id, m.workspace_id, i.meeting_id, 'AI', i.summary_id, i.item_index,
  btrim(i.item->>'title'),
  COALESCE(btrim(i.item->>'owner'), ''), COALESCE(btrim(i.item->>'due'), ''),
  ll.task_id, ll.created_at, ll.created_by,
  'meeting_summary', 'system', i.created_at, i.created_at
FROM items i
JOIN meetings m ON m.id = i.meeting_id AND m.organization_id = i.organization_id
LEFT JOIN live_links ll ON ll.summary_id = i.summary_id AND ll.item_index = i.item_index
WHERE jsonb_typeof(i.item) = 'object'
  AND COALESCE(btrim(i.item->>'title'), '') <> ''
  AND (i.is_latest OR ll.task_id IS NOT NULL);

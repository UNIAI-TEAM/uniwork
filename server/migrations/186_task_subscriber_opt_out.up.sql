ALTER TABLE task_subscribers
  ADD COLUMN unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN opt_out_scope TEXT CHECK (opt_out_scope IN ('task', 'subtree'));

-- Assignment becomes an automatic follow rule with this migration. The old
-- delete-based unsubscribe path retained no opt-out history, so every current
-- assignee intentionally starts from the new default-follow state.
INSERT INTO task_subscribers (
  organization_id,
  workspace_id,
  task_id,
  actor_type,
  actor_id,
  reason
)
SELECT
  organization_id,
  workspace_id,
  id,
  CASE WHEN assignee_kind = 'agent' THEN 'agent' ELSE 'member' END,
  assignee_id,
  'assignee'
FROM tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT (workspace_id, task_id, actor_type, actor_id) DO NOTHING;

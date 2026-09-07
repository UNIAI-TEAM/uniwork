INSERT INTO task_statuses (
  id, organization_id, workspace_id, key, name, description, category,
  color, is_system, position, created_by, created_by_kind
)
SELECT
  '01K4F05STS' || upper(substr(md5(w.id || ':' || s.key), 1, 16)),
  w.organization_id, w.id, s.key, s.name, s.description, s.key,
  s.color, true, s.position, w.created_by, 'system'
FROM workspaces w
CROSS JOIN (VALUES
  ('backlog', 'Backlog', 'Parked work.', '#6b7280', 0::float8),
  ('todo', 'Todo', 'Queued for work.', '#6b7280', 1024::float8),
  ('in_progress', 'In Progress', 'Actively being worked on.', '#f59e0b', 2048::float8),
  ('in_review', 'In Review', 'Waiting on human review.', '#22c55e', 3072::float8),
  ('done', 'Done', 'Completed.', '#3b82f6', 4096::float8),
  ('blocked', 'Blocked', 'Stalled on a dependency.', '#ef4444', 5120::float8),
  ('cancelled', 'Cancelled', 'Decided not to do.', '#6b7280', 6144::float8)
) AS s(key, name, description, color, position)
ON CONFLICT (workspace_id, key) DO NOTHING;

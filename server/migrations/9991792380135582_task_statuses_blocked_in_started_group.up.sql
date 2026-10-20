-- Blocked joins the "started" group (UniAI's grouping): its statuses move into
-- that group's position band, below done.
UPDATE task_statuses SET position = position - 1536 WHERE category = 'blocked';

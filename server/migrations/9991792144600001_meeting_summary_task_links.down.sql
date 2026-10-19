-- The index is dropped in its own file: DROP INDEX CONCURRENTLY cannot share
-- a file with another statement.
DROP TABLE IF EXISTS meeting_summary_task_links;

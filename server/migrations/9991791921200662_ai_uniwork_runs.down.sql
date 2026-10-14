-- The two indexes are dropped in their own files: DROP INDEX CONCURRENTLY
-- cannot share a file with another statement.
DROP TABLE IF EXISTS ai_uniwork_runs;

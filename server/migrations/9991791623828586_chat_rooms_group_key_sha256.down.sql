-- No-op: a digest cannot be turned back into the member list, and the code
-- before this migration already wrote digest keys for new groups.
SELECT 1;

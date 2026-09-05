-- The assignee foreign key is not restored: rows assigned to an agent would
-- make the ALTER fail, and the application owns the relationship anyway.
ALTER TABLE chat_messages DROP COLUMN IF EXISTS sender_kind;
ALTER TABLE meetings DROP COLUMN IF EXISTS created_by_kind;
ALTER TABLE task_comments DROP COLUMN IF EXISTS origin, DROP COLUMN IF EXISTS author_kind;
ALTER TABLE tasks DROP COLUMN IF EXISTS assignee_kind, DROP COLUMN IF EXISTS created_by_kind;

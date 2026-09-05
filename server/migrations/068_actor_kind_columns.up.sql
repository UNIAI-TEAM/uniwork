-- ADR 0007: every "who" column carries its kind. Existing rows were all
-- written by people, so the default backfills them as human.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  ADD COLUMN IF NOT EXISTS assignee_kind TEXT NOT NULL DEFAULT 'human' CHECK (assignee_kind IN ('human', 'agent'));
-- An agent can be the assignee, so assignee_id no longer points only at users.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_id_fkey;
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS author_kind TEXT NOT NULL DEFAULT 'human' CHECK (author_kind IN ('human', 'agent', 'system')),
  ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system'));
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS sender_kind TEXT NOT NULL DEFAULT 'human' CHECK (sender_kind IN ('human', 'agent', 'system'));

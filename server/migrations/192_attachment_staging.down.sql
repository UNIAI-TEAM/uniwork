DELETE FROM attachments WHERE task_id IS NULL AND comment_id IS NULL;
ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_binding_check,
  DROP COLUMN IF EXISTS expires_at,
  ADD CONSTRAINT attachments_check CHECK (task_id IS NOT NULL OR comment_id IS NOT NULL);

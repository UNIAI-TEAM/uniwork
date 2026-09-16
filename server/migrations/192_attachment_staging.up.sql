ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_check,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD CONSTRAINT attachments_binding_check CHECK (
    (task_id IS NULL AND comment_id IS NULL AND expires_at IS NOT NULL)
    OR (expires_at IS NULL AND (task_id IS NOT NULL OR comment_id IS NOT NULL))
  );

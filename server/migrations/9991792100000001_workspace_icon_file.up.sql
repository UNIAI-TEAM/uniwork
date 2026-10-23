-- The uploaded workspace icon (spec 2026-10-14 §4.1), a file of purpose
-- workspace_icon. A workspace shows an emoji or a file, never both.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS icon_file_id TEXT,
  ADD CONSTRAINT workspaces_one_icon CHECK (icon_emoji IS NULL OR icon_file_id IS NULL);

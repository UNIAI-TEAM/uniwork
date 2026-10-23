ALTER TABLE organizations
  DROP COLUMN IF EXISTS push_previews_hidden_by,
  DROP COLUMN IF EXISTS push_previews_hidden_at;

ALTER TABLE users DROP COLUMN IF EXISTS push_previews_hidden_at;

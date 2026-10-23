-- What a workspace says about itself (spec 2026-10-14 §4.1): a short
-- description shown under its name, and an emoji icon. The uploaded image
-- icon comes in its own migration with its file purpose.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon_emoji  TEXT;

-- The organization's AI scribe policy (UNI-1995 access, issue #16):
-- on      the scribe joins every meeting unless its host switches it off (the
--         behaviour before this column, and the default);
-- opt_in  a new meeting starts with the scribe off; its host turns it on when
--         scheduling or in the room;
-- off     the scribe never joins a meeting of the organization.
ALTER TABLE meeting_settings
  ADD COLUMN IF NOT EXISTS scribe_policy TEXT NOT NULL DEFAULT 'on';
ALTER TABLE meeting_settings DROP CONSTRAINT IF EXISTS meeting_settings_scribe_policy_check;
ALTER TABLE meeting_settings ADD CONSTRAINT meeting_settings_scribe_policy_check
  CHECK (scribe_policy IN ('on', 'opt_in', 'off'));

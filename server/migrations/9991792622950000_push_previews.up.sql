-- Whether a chat push shows the message's words (audit "Security & privacy",
-- push-preview-plaintext): the text of a push passes through Expo, FCM and
-- APNs and sits on a lock screen. A person hides it for themselves; an owner
-- or admin hides it for the whole organization, which wins. NULL means shown,
-- the default; the push then says only that a message arrived and from whom.
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_previews_hidden_at TIMESTAMPTZ;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS push_previews_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_previews_hidden_by TEXT;

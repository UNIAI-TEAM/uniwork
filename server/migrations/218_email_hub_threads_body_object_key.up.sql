-- Optional object-storage key for cached message bodies (S3). Inline body_text/body_html stay empty when set.
ALTER TABLE email_hub_threads
  ADD COLUMN IF NOT EXISTS body_object_key TEXT NOT NULL DEFAULT '';

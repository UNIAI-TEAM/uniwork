ALTER TABLE email_hub_threads
  ADD COLUMN IF NOT EXISTS imap_labels TEXT[] NOT NULL DEFAULT '{}';

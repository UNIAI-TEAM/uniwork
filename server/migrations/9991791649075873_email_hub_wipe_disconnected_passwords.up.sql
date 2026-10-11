-- UNI-1106: disconnecting a mailbox now wipes its app password. Mailboxes
-- disconnected before that still hold a decryptable one; nothing reads it.
UPDATE email_hub_accounts
SET password_enc = ''
WHERE disconnected_at IS NOT NULL
  AND password_enc <> '';

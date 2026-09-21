CREATE UNIQUE INDEX CONCURRENTLY idx_email_hub_threads_account_folder_uid
  ON email_hub_threads (account_id, folder, imap_uid);

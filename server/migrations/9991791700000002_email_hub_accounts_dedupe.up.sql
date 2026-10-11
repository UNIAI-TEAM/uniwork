-- UNI-1202: before the unique index on a live mailbox address can build, each
-- (organization, owner, address) keeps only its oldest live row. The others
-- are disconnected the way Disconnect does it. Their cache goes here too,
-- because no job cleans up a disconnected mailbox. This follows
-- cleanUpDisconnectedEmailHubAccount: queued sends are cancelled, then
-- attachments, AI summaries and threads are deleted. Bodies already in object
-- storage stay for the file GC, as they do after Disconnect. It is one
-- statement because the CTEs share one snapshot, and without foreign keys the
-- order of the deletes does not matter.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, user_id, lower(email_address)
    ORDER BY created_at, id
  ) AS rn
  FROM email_hub_accounts
  WHERE disconnected_at IS NULL
), dup AS (
  UPDATE email_hub_accounts a
  SET disconnected_at = now(), password_enc = '',
      credential_version = a.credential_version + 1, updated_at = now()
  FROM ranked r
  WHERE a.id = r.id AND r.rn > 1
  RETURNING a.id, a.organization_id
), cancelled AS (
  UPDATE email_hub_scheduled_sends s
  SET status = 'cancelled'
  FROM dup
  WHERE s.account_id = dup.id
    AND s.organization_id = dup.organization_id
    AND s.status IN ('pending', 'failed')
), attachments AS (
  DELETE FROM email_hub_attachments
  WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup)
), summaries AS (
  DELETE FROM email_hub_thread_ai_summaries
  WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup)
)
DELETE FROM email_hub_threads
WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup);

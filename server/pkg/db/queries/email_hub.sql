-- name: CreateEmailHubAccount :one
INSERT INTO email_hub_accounts (
  id, user_id, organization_id, email_address, provider,
  imap_host, imap_port, smtp_host, smtp_port, password_enc
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
RETURNING *;

-- name: ListEmailHubAccountsByUser :many
SELECT *
FROM email_hub_accounts
WHERE user_id = $1
  AND organization_id = $2
  AND disconnected_at IS NULL
ORDER BY created_at ASC;

-- name: GetEmailHubAccount :one
SELECT *
FROM email_hub_accounts
WHERE id = $1
  AND user_id = $2
  AND organization_id = $3
  AND disconnected_at IS NULL;

-- name: GetEmailHubAccountByID :one
SELECT *
FROM email_hub_accounts
WHERE id = $1;

-- name: DisconnectEmailHubAccount :exec
UPDATE email_hub_accounts
SET disconnected_at = now(), updated_at = now()
WHERE id = $1
  AND user_id = $2
  AND organization_id = $3
  AND disconnected_at IS NULL;

-- name: UpdateEmailHubAccountSyncState :exec
UPDATE email_hub_accounts
SET sync_state = $2, updated_at = now()
WHERE id = $1;

-- name: UpsertEmailHubThread :one
INSERT INTO email_hub_threads (
  id, account_id, organization_id, folder, imap_uid, message_id,
  subject, snippet, from_addr, from_name, to_addrs, sent_at,
  is_read, is_starred, has_attachments, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now()
)
ON CONFLICT (account_id, folder, imap_uid) DO UPDATE SET
  message_id = EXCLUDED.message_id,
  subject = EXCLUDED.subject,
  snippet = EXCLUDED.snippet,
  from_addr = EXCLUDED.from_addr,
  from_name = EXCLUDED.from_name,
  to_addrs = EXCLUDED.to_addrs,
  sent_at = EXCLUDED.sent_at,
  is_read = email_hub_threads.is_read OR EXCLUDED.is_read,
  is_starred = EXCLUDED.is_starred,
  has_attachments = EXCLUDED.has_attachments,
  synced_at = now()
RETURNING *;

-- name: ListEmailHubThreads :many
SELECT *
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3
ORDER BY sent_at DESC
LIMIT $4;

-- name: GetEmailHubThread :one
SELECT *
FROM email_hub_threads
WHERE id = $1
  AND account_id = $2
  AND organization_id = $3;

-- name: ListEmailHubThreadsPendingBody :many
SELECT *
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3
  AND NOT body_cached
ORDER BY sent_at DESC
LIMIT $4;

-- name: UpdateEmailHubThreadBody :one
UPDATE email_hub_threads
SET body_text = $2,
    body_html = $3,
    body_cached = true,
    synced_at = now()
WHERE id = $1
RETURNING *;

-- name: InvalidateEmailHubThreadBody :exec
UPDATE email_hub_threads
SET body_text = NULL,
    body_html = NULL,
    body_cached = false
WHERE id = $1;

-- name: InvalidateEmailHubEmptyBodies :exec
UPDATE email_hub_threads
SET body_text = NULL,
    body_html = NULL,
    body_cached = false,
    synced_at = now()
WHERE account_id = $1
  AND organization_id = $2
  AND body_cached = true
  AND COALESCE(body_html, '') = ''
  AND COALESCE(body_text, '') = '';

-- name: PatchEmailHubThreadSnippet :exec
UPDATE email_hub_threads
SET snippet = $2,
    synced_at = now()
WHERE id = $1;

-- name: CountEmailHubThreads :one
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE NOT is_read)::bigint AS unread
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3;

-- name: DeleteEmailHubThreadsForAccount :exec
DELETE FROM email_hub_threads
WHERE account_id = $1;

-- name: UpdateEmailHubThreadRead :one
UPDATE email_hub_threads
SET is_read = $2, synced_at = now()
WHERE id = $1
  AND account_id = $3
  AND organization_id = $4
RETURNING *;

-- name: UpdateEmailHubThreadStarred :one
UPDATE email_hub_threads
SET is_starred = $2, synced_at = now()
WHERE id = $1
  AND account_id = $3
  AND organization_id = $4
RETURNING *;

-- name: ListEmailHubAccountsConnected :many
SELECT *
FROM email_hub_accounts
WHERE disconnected_at IS NULL
ORDER BY updated_at ASC
LIMIT $1;

-- name: ListEmailHubThreadUIDsByFolder :many
SELECT imap_uid
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3;

-- name: DeleteEmailHubThreadsNotInUIDs :exec
DELETE FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3
  AND NOT (imap_uid = ANY($4::integer[]));

-- name: DeleteEmailHubThreadsInFolder :exec
DELETE FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND folder = $3;

-- name: DeleteEmailHubThread :exec
DELETE FROM email_hub_threads
WHERE id = $1
  AND account_id = $2
  AND organization_id = $3;

-- name: ListEmailHubStarredThreads :many
SELECT *
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND is_starred = true
ORDER BY sent_at DESC
LIMIT $3;

-- name: CountEmailHubStarredThreads :one
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE NOT is_read)::bigint AS unread
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND is_starred = true;

-- name: ListEmailHubThreadsPage :many
SELECT t.*
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND (
    (sqlc.arg('folder') = 'STARRED' AND t.is_starred = true)
    OR (sqlc.arg('folder') <> 'STARRED' AND t.folder = sqlc.arg('folder'))
  )
  AND (NOT sqlc.arg('unread_only') OR NOT t.is_read)
  AND (NOT sqlc.arg('has_attachments_only') OR t.has_attachments)
  AND (
    sqlc.arg('from_filter') = ''
    OR t.from_addr ILIKE '%' || sqlc.arg('from_filter') || '%'
    OR COALESCE(t.from_name, '') ILIKE '%' || sqlc.arg('from_filter') || '%'
  )
  AND (
    sqlc.arg('query') = ''
    OR t.subject ILIKE '%' || sqlc.arg('query') || '%'
    OR t.snippet ILIKE '%' || sqlc.arg('query') || '%'
    OR t.from_addr ILIKE '%' || sqlc.arg('query') || '%'
    OR COALESCE(t.from_name, '') ILIKE '%' || sqlc.arg('query') || '%'
    OR COALESCE(t.body_text, '') ILIKE '%' || sqlc.arg('query') || '%'
  )
  AND (
    sqlc.narg('before_sent_at')::timestamptz IS NULL
    OR t.sent_at < sqlc.narg('before_sent_at')::timestamptz
    OR (
      t.sent_at = sqlc.narg('before_sent_at')::timestamptz
      AND t.id < sqlc.arg('before_id')
    )
  )
ORDER BY t.sent_at DESC, t.id DESC
LIMIT sqlc.arg('limit_val');

-- name: DeleteEmailHubAttachmentsForThread :exec
DELETE FROM email_hub_attachments
WHERE thread_id = $1;

-- name: DeleteEmailHubAttachmentsForAccount :exec
DELETE FROM email_hub_attachments
WHERE account_id = $1;

-- name: CreateEmailHubAttachment :one
INSERT INTO email_hub_attachments (
  id, thread_id, account_id, organization_id, filename, mime_type, size_bytes, part_id
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: ListEmailHubAttachments :many
SELECT *
FROM email_hub_attachments
WHERE thread_id = $1
  AND account_id = $2
  AND organization_id = $3
ORDER BY created_at ASC;

-- name: GetEmailHubAttachment :one
SELECT *
FROM email_hub_attachments
WHERE id = $1
  AND thread_id = $2
  AND account_id = $3
  AND organization_id = $4;

-- name: CreateEmailHubScheduledSend :one
INSERT INTO email_hub_scheduled_sends (
  id, workspace_id, account_id, organization_id, user_id, payload, send_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: ListDueEmailHubScheduledSends :many
SELECT *
FROM email_hub_scheduled_sends
WHERE status = 'pending'
  AND send_at <= now()
ORDER BY send_at ASC
LIMIT $1;

-- name: MarkEmailHubScheduledSendSent :exec
UPDATE email_hub_scheduled_sends
SET status = 'sent',
    sent_at = now(),
    last_error = NULL
WHERE id = $1;

-- name: MarkEmailHubScheduledSendFailed :exec
UPDATE email_hub_scheduled_sends
SET status = 'failed',
    last_error = $2
WHERE id = $1;

-- name: ListEmailHubPendingScheduledSends :many
SELECT *
FROM email_hub_scheduled_sends
WHERE workspace_id = $1
  AND account_id = $2
  AND user_id = $3
  AND status = 'pending'
ORDER BY send_at ASC;

-- name: CancelEmailHubScheduledSend :execrows
UPDATE email_hub_scheduled_sends
SET status = 'cancelled'
WHERE id = $1
  AND workspace_id = $2
  AND account_id = $3
  AND user_id = $4
  AND status = 'pending';

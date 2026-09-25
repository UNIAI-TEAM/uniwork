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
  is_read, is_starred, has_attachments, imap_labels, conversation_key, synced_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now()
)
ON CONFLICT (account_id, folder, imap_uid) DO UPDATE SET
  message_id = EXCLUDED.message_id,
  conversation_key = CASE
    WHEN EXCLUDED.conversation_key <> '' THEN EXCLUDED.conversation_key
    ELSE email_hub_threads.conversation_key
  END,
  subject = EXCLUDED.subject,
  snippet = EXCLUDED.snippet,
  from_addr = EXCLUDED.from_addr,
  from_name = EXCLUDED.from_name,
  to_addrs = EXCLUDED.to_addrs,
  sent_at = EXCLUDED.sent_at,
  is_read = email_hub_threads.is_read OR EXCLUDED.is_read,
  is_starred = EXCLUDED.is_starred,
  has_attachments = EXCLUDED.has_attachments,
  imap_labels = CASE
    WHEN cardinality(EXCLUDED.imap_labels) > 0 THEN EXCLUDED.imap_labels
    ELSE email_hub_threads.imap_labels
  END,
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

-- name: ListEmailHubConversationMessages :many
SELECT *
FROM email_hub_threads
WHERE account_id = $1
  AND organization_id = $2
  AND conversation_key = $3
  AND conversation_key <> ''
ORDER BY sent_at ASC
LIMIT $4;

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
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND (
    (
      sqlc.arg('label_filter') <> ''
      AND sqlc.arg('label_filter') = ANY(t.imap_labels)
      AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
    )
    OR (
      sqlc.arg('label_filter') = ''
      AND (
        (sqlc.arg('folder') = 'SNOOZED' AND t.folder = 'INBOX' AND t.snoozed_until IS NOT NULL AND t.snoozed_until > now())
        OR (sqlc.arg('folder') = 'STARRED' AND t.is_starred = true)
        OR (
          sqlc.arg('folder') NOT IN ('STARRED', 'SNOOZED')
          AND t.folder = sqlc.arg('folder')
          AND (
            sqlc.arg('folder') <> 'INBOX'
            OR t.snoozed_until IS NULL
            OR t.snoozed_until <= now()
          )
        )
      )
    )
  );

-- name: ListEmailHubDistinctImapLabels :many
SELECT DISTINCT label::text AS label
FROM email_hub_threads t, unnest(t.imap_labels) AS label
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
ORDER BY label ASC;

-- name: SumEmailHubInboxUnreadByUser :one
SELECT COALESCE(SUM(unread_ct), 0)::bigint AS unread
FROM (
  SELECT count(*) FILTER (WHERE NOT t.is_read) AS unread_ct
  FROM email_hub_accounts a
  INNER JOIN email_hub_threads t ON t.account_id = a.id AND t.organization_id = a.organization_id
  WHERE a.user_id = $1
    AND a.organization_id = $2
    AND a.disconnected_at IS NULL
    AND t.folder = 'INBOX'
    AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
  GROUP BY a.id
) s;

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

-- name: UpdateEmailHubThreadSnooze :one
UPDATE email_hub_threads
SET snoozed_until = sqlc.narg('snoozed_until')::timestamptz,
    synced_at = now()
WHERE id = sqlc.arg('id')
  AND account_id = sqlc.arg('account_id')
  AND organization_id = sqlc.arg('organization_id')
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

-- name: ListEmailHubInboxConversationPage :many
SELECT t.*
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND t.id IN (
    SELECT DISTINCT ON (partition_key) s.id
    FROM (
      SELECT
        t2.id,
        CASE WHEN t2.conversation_key = '' THEN t2.id ELSE t2.conversation_key END AS partition_key,
        t2.sent_at
      FROM email_hub_threads t2
      WHERE t2.account_id = sqlc.arg('account_id')
        AND t2.organization_id = sqlc.arg('organization_id')
        AND (
          (
            t2.folder = 'INBOX'
            AND (t2.snoozed_until IS NULL OR t2.snoozed_until <= now())
            AND t2.conversation_key = ''
          )
          OR (
            CASE WHEN t2.conversation_key = '' THEN t2.id ELSE t2.conversation_key END IN (
              SELECT CASE WHEN conversation_key = '' THEN id ELSE conversation_key END
              FROM email_hub_threads
              WHERE account_id = sqlc.arg('account_id')
                AND organization_id = sqlc.arg('organization_id')
                AND folder = 'INBOX'
                AND (snoozed_until IS NULL OR snoozed_until <= now())
            )
          )
        )
    ) s
    ORDER BY s.partition_key, s.sent_at DESC, s.id DESC
  )
  AND (NOT sqlc.arg('unread_only') OR EXISTS (
    SELECT 1 FROM email_hub_threads u
    WHERE u.account_id = t.account_id
      AND u.organization_id = t.organization_id
      AND u.folder = 'INBOX'
      AND NOT u.is_read
      AND (
        CASE WHEN u.conversation_key = '' THEN u.id ELSE u.conversation_key END
      ) = CASE WHEN t.conversation_key = '' THEN t.id ELSE t.conversation_key END
  ))
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

-- name: CountEmailHubInboxConversations :one
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE conv_unread)::bigint AS unread
FROM (
  SELECT
    bool_or(NOT is_read) AS conv_unread
  FROM email_hub_threads
  WHERE account_id = sqlc.arg('account_id')
    AND organization_id = sqlc.arg('organization_id')
    AND folder = 'INBOX'
    AND (snoozed_until IS NULL OR snoozed_until <= now())
  GROUP BY CASE WHEN conversation_key = '' THEN id ELSE conversation_key END
) grouped;

-- name: ListEmailHubConversationMessageCounts :many
SELECT
  conversation_key,
  count(*)::int AS message_count,
  bool_or(NOT is_read AND folder = 'INBOX') AS inbox_unread
FROM email_hub_threads
WHERE account_id = sqlc.arg('account_id')
  AND organization_id = sqlc.arg('organization_id')
  AND conversation_key <> ''
  AND conversation_key = ANY(sqlc.arg('conversation_keys')::text[])
GROUP BY conversation_key;

-- name: ListEmailHubThreadsPage :many
SELECT t.*
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND (
    (
      sqlc.arg('label_filter') <> ''
      AND sqlc.arg('label_filter') = ANY(t.imap_labels)
      AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
    )
    OR (
      sqlc.arg('label_filter') = ''
      AND (
        (sqlc.arg('folder') = 'SNOOZED' AND t.folder = 'INBOX' AND t.snoozed_until IS NOT NULL AND t.snoozed_until > now())
        OR (sqlc.arg('folder') = 'STARRED' AND t.is_starred = true)
        OR (
          sqlc.arg('folder') NOT IN ('STARRED', 'SNOOZED')
          AND t.folder = sqlc.arg('folder')
          AND (
            sqlc.arg('folder') <> 'INBOX'
            OR t.snoozed_until IS NULL
            OR t.snoozed_until <= now()
          )
        )
      )
    )
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
ORDER BY
  CASE WHEN sqlc.arg('folder') = 'SNOOZED' THEN t.snoozed_until END ASC NULLS LAST,
  t.sent_at DESC,
  t.id DESC
LIMIT sqlc.arg('limit_val');

-- name: ListEmailHubThreadsSearchPage :many
SELECT t.*
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND t.folder = ANY(sqlc.arg('folders')::text[])
  AND (NOT sqlc.arg('unread_only') OR NOT t.is_read)
  AND (NOT sqlc.arg('has_attachments_only') OR t.has_attachments)
  AND (
    sqlc.arg('from_filter') = ''
    OR t.from_addr ILIKE '%' || sqlc.arg('from_filter') || '%'
    OR COALESCE(t.from_name, '') ILIKE '%' || sqlc.arg('from_filter') || '%'
  )
  AND (
    t.subject ILIKE '%' || sqlc.arg('query') || '%'
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

-- name: CountEmailHubThreadsSearch :one
SELECT count(*)::bigint AS total
FROM email_hub_threads t
WHERE t.account_id = sqlc.arg('account_id')
  AND t.organization_id = sqlc.arg('organization_id')
  AND t.folder = ANY(sqlc.arg('folders')::text[])
  AND (NOT sqlc.arg('unread_only') OR NOT t.is_read)
  AND (NOT sqlc.arg('has_attachments_only') OR t.has_attachments)
  AND (
    sqlc.arg('from_filter') = ''
    OR t.from_addr ILIKE '%' || sqlc.arg('from_filter') || '%'
    OR COALESCE(t.from_name, '') ILIKE '%' || sqlc.arg('from_filter') || '%'
  )
  AND (
    t.subject ILIKE '%' || sqlc.arg('query') || '%'
    OR t.snippet ILIKE '%' || sqlc.arg('query') || '%'
    OR t.from_addr ILIKE '%' || sqlc.arg('query') || '%'
    OR COALESCE(t.from_name, '') ILIKE '%' || sqlc.arg('query') || '%'
    OR COALESCE(t.body_text, '') ILIKE '%' || sqlc.arg('query') || '%'
  );

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
WHERE id = $1
  -- A user cancel that lands mid-send stays cancelled; it must not resurface
  -- as a retryable failure.
  AND status = 'pending';

-- name: ListEmailHubOpenScheduledSends :many
-- Open = still the user's concern: pending (waiting to go out) or failed (the
-- worker gave up; the user must retry or dismiss). Failed rows come first.
SELECT *
FROM email_hub_scheduled_sends
WHERE workspace_id = $1
  AND account_id = $2
  AND user_id = $3
  AND status IN ('pending', 'failed')
ORDER BY (status = 'failed') DESC, send_at ASC;

-- name: CancelEmailHubScheduledSend :execrows
UPDATE email_hub_scheduled_sends
SET status = 'cancelled'
WHERE id = $1
  AND workspace_id = $2
  AND account_id = $3
  AND user_id = $4
  AND status IN ('pending', 'failed');

-- name: RetryEmailHubScheduledSend :execrows
UPDATE email_hub_scheduled_sends
SET status = 'pending', send_at = now(), last_error = NULL
WHERE id = $1
  AND workspace_id = $2
  AND account_id = $3
  AND user_id = $4
  AND status = 'failed';

-- name: GetEmailHubThreadAiSummary :one
SELECT *
FROM email_hub_thread_ai_summaries
WHERE thread_id = $1
  AND locale = $2
  AND organization_id = $3;

-- name: UpsertEmailHubThreadAiSummary :one
INSERT INTO email_hub_thread_ai_summaries (
  id, organization_id, thread_id, account_id, locale, source_fingerprint,
  summary, key_points, action_items, needs_reply, reply_hint, model,
  created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
ON CONFLICT (thread_id, locale) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  account_id = EXCLUDED.account_id,
  source_fingerprint = EXCLUDED.source_fingerprint,
  summary = EXCLUDED.summary,
  key_points = EXCLUDED.key_points,
  action_items = EXCLUDED.action_items,
  needs_reply = EXCLUDED.needs_reply,
  reply_hint = EXCLUDED.reply_hint,
  model = EXCLUDED.model,
  created_by = EXCLUDED.created_by,
  created_by_kind = EXCLUDED.created_by_kind,
  updated_at = now()
RETURNING *;

-- name: DeleteEmailHubThreadAiSummariesForThread :exec
DELETE FROM email_hub_thread_ai_summaries
WHERE thread_id = $1;

-- name: DeleteEmailHubThreadAiSummariesForAccount :exec
DELETE FROM email_hub_thread_ai_summaries
WHERE account_id = $1;

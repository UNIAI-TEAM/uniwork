-- Notifications (F-07). Every query is keyed by user_id: a notification is
-- the recipient's, and no endpoint reads another person's.

-- name: UpsertNotification :one
-- The merge: an open (unread, unarchived) row for the same (user, group) is
-- bumped instead of duplicated; uidx_notifications_open_group is the target.
-- count > 1 on the returned row tells the caller it merged.
INSERT INTO notifications (
  id, user_id, organization_id, workspace_id, kind, group_key,
  resource_type, resource_id, actor_kind, actor_id, title_key, params, correlation_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND archived_at IS NULL
DO UPDATE SET
  count = notifications.count + 1,
  params = EXCLUDED.params,
  actor_kind = EXCLUDED.actor_kind,
  actor_id = EXCLUDED.actor_id,
  correlation_id = EXCLUDED.correlation_id,
  updated_at = now()
RETURNING *;

-- name: InsertNotificationDelivery :execrows
INSERT INTO notification_deliveries (event_id, user_id) VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: GetNotification :one
SELECT * FROM notifications WHERE id = $1;

-- name: ListNotifications :many
-- Cursor on the ULID id (time-ordered), newest first.
SELECT * FROM notifications
WHERE user_id = $1
  AND archived_at IS NULL
  AND (sqlc.narg('workspace_id')::text IS NULL OR workspace_id = sqlc.narg('workspace_id')::text)
  AND (NOT sqlc.arg('unread_only')::bool OR read_at IS NULL)
  AND (sqlc.narg('before')::text IS NULL OR id < sqlc.narg('before')::text)
ORDER BY id DESC
LIMIT sqlc.arg('limit_n');

-- name: CountUnreadNotificationsByWorkspace :many
SELECT COALESCE(workspace_id, '')::text AS workspace_id, count(*)::bigint AS unread
FROM notifications
WHERE user_id = $1 AND read_at IS NULL AND archived_at IS NULL
GROUP BY workspace_id;

-- name: MarkNotificationsRead :execrows
UPDATE notifications SET read_at = now(), updated_at = now()
WHERE user_id = $1 AND id = ANY(sqlc.arg('ids')::text[]) AND read_at IS NULL;

-- name: MarkAllNotificationsRead :many
UPDATE notifications SET read_at = now(), updated_at = now()
WHERE user_id = $1 AND read_at IS NULL AND archived_at IS NULL
  AND (sqlc.narg('workspace_id')::text IS NULL OR workspace_id = sqlc.narg('workspace_id')::text)
RETURNING id;

-- name: MarkNotificationsUnread :execrows
-- A row whose group already has an open row, or a newer row reopened in the
-- same call, stays read: reopening it would break uidx_notifications_open_group.
UPDATE notifications n SET read_at = NULL, updated_at = now()
WHERE n.user_id = $1 AND n.id = ANY(sqlc.arg('ids')::text[]) AND n.read_at IS NOT NULL
  AND (n.archived_at IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM notifications o
    WHERE o.user_id = n.user_id AND o.group_key = n.group_key AND o.id <> n.id
      AND o.archived_at IS NULL
      AND (o.read_at IS NULL OR (o.id = ANY(sqlc.arg('ids')::text[]) AND o.id > n.id))
  ));

-- name: ArchiveNotifications :execrows
UPDATE notifications SET archived_at = now(), updated_at = now()
WHERE user_id = $1 AND id = ANY(sqlc.arg('ids')::text[]) AND archived_at IS NULL;

-- name: UnarchiveNotifications :execrows
-- An unread row comes back read when its group already has an open row (a
-- later event opened one while it sat archived), or a newer row of its group
-- comes back unread in the same call: uidx_notifications_open_group allows one.
UPDATE notifications n SET archived_at = NULL, updated_at = now(),
  read_at = CASE WHEN n.read_at IS NULL AND EXISTS (
    SELECT 1 FROM notifications o
    WHERE o.user_id = n.user_id AND o.group_key = n.group_key AND o.id <> n.id
      AND o.read_at IS NULL
      AND (o.archived_at IS NULL OR (o.id = ANY(sqlc.arg('ids')::text[]) AND o.id > n.id))
  ) THEN now() ELSE n.read_at END
WHERE n.user_id = $1 AND n.id = ANY(sqlc.arg('ids')::text[]) AND n.archived_at IS NOT NULL;

-- name: ListChatMessageRooms :many
SELECT id, room_id FROM chat_messages WHERE id = ANY(sqlc.arg('ids')::text[]) AND deleted_at IS NULL;

-- name: CountOwnedNotifications :one
SELECT count(*)::bigint FROM notifications WHERE user_id = $1 AND id = ANY(sqlc.arg('ids')::text[]);

-- name: ListExistingTaskIDs :many
SELECT id FROM tasks WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: ListExistingMeetingIDs :many
SELECT id FROM meetings WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: ListNotificationPreferences :many
SELECT * FROM notification_preferences WHERE user_id = $1;

-- name: ListNotificationPreferencesByUsers :many
SELECT * FROM notification_preferences WHERE user_id = ANY(sqlc.arg('user_ids')::text[]);

-- name: UpsertNotificationPreference :exec
INSERT INTO notification_preferences (user_id, kind, in_app, push, email, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (user_id, kind) DO UPDATE SET
  in_app = EXCLUDED.in_app, push = EXCLUDED.push, email = EXCLUDED.email, updated_at = now();

-- name: UpsertPushSubscription :one
INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, last_used_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (endpoint) WHERE revoked_at IS NULL DO UPDATE SET
  user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
  user_agent = EXCLUDED.user_agent, last_used_at = now()
RETURNING *;

-- name: ListActivePushSubscriptions :many
SELECT * FROM push_subscriptions WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokePushSubscription :exec
UPDATE push_subscriptions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokePushSubscriptionByEndpoint :execrows
UPDATE push_subscriptions SET revoked_at = now()
WHERE user_id = $1 AND endpoint = $2 AND revoked_at IS NULL;

-- name: MarkNotificationPushed :exec
UPDATE notifications SET pushed_at = now() WHERE id = $1 AND pushed_at IS NULL;

-- name: ListDigestCandidateUsers :many
SELECT DISTINCT n.user_id FROM notifications n
WHERE n.digested_at IS NULL AND n.read_at IS NULL AND n.archived_at IS NULL AND n.created_at > $1;

-- name: ListUndigestedNotifications :many
SELECT * FROM notifications
WHERE user_id = $1 AND digested_at IS NULL AND read_at IS NULL AND archived_at IS NULL AND created_at > $2
ORDER BY workspace_id NULLS FIRST, kind, created_at DESC;

-- name: MarkNotificationsDigested :exec
UPDATE notifications SET digested_at = now() WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: ListMeetingsStartingBetween :many
SELECT * FROM meetings
WHERE status = 'SCHEDULED' AND starts_at > $1 AND starts_at <= $2;

-- name: ListMeetingReminderRecipients :many
-- The host plus every participant who accepted the invitation.
SELECT DISTINCT p.user_id::text AS user_id
FROM meeting_participants p
JOIN meeting_invitations i ON i.participant_id = p.id
WHERE p.meeting_id = $1 AND p.user_id IS NOT NULL AND p.removed_at IS NULL AND i.response_status = 'ACCEPTED'
UNION
SELECT host_user_id FROM meetings WHERE id = $1;

-- name: CreateChatReminder :exec
INSERT INTO chat_reminders (
  message_id, organization_id, workspace_id, room_id, created_by, created_by_kind,
  repeat, timezone, remind_at, next_fire_at
) VALUES (
  $1, $2, $3, $4, $5, 'human', $6, $7, $8, $8
);

-- name: ClaimDueChatReminders :many
-- tenant: system
-- The reminder worker's claim: due rows, oldest first, locked for the
-- transaction that emits chat.reminder.due and advances them. SKIP LOCKED
-- lets a second pod take the next rows instead of waiting on these.
SELECT r.message_id, r.organization_id, r.workspace_id, r.room_id, r.repeat, r.timezone,
  r.remind_at, r.occurrence, r.next_fire_at,
  (m.id IS NULL OR m.deleted_at IS NOT NULL)::boolean AS message_gone
FROM chat_reminders r
LEFT JOIN chat_messages m ON m.id = r.message_id
WHERE r.next_fire_at IS NOT NULL AND r.next_fire_at <= $1
ORDER BY r.next_fire_at
LIMIT $2
FOR UPDATE OF r SKIP LOCKED;

-- name: AdvanceChatReminder :exec
-- tenant: by-id
-- NULL next_fire_at retires the reminder (one-shot fired, message deleted).
UPDATE chat_reminders
SET occurrence = $2, next_fire_at = $3, updated_at = now()
WHERE message_id = $1;

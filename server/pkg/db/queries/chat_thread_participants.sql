-- name: ListChatThreadParticipants :many
-- The three most recent distinct repliers of each thread root, newest first
-- (the faces on the thread pill, UNI-1908 F5). Walks idx_chat_messages_thread.
SELECT root.id::text AS thread_root_id, p.sender_id
FROM unnest(sqlc.arg(root_ids)::text[]) AS root(id)
CROSS JOIN LATERAL (
  SELECT m.sender_id, max(m.created_at) AS last_at
  FROM chat_messages m
  WHERE m.thread_root_id = root.id
    AND m.room_id = sqlc.arg(room_id)
    AND m.workspace_id = sqlc.arg(workspace_id)
    AND m.deleted_at IS NULL
  GROUP BY m.sender_id
  ORDER BY last_at DESC, m.sender_id
  LIMIT 3
) p
ORDER BY root.id, p.last_at DESC, p.sender_id;

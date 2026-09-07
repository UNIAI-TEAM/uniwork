CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_messages_room_sender_client_msg_id
  ON chat_messages (room_id, sender_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL;

-- UNI-1686: deleting a task now drops its chat links in the same transaction.
-- Links left behind by tasks deleted before that point go here.
DELETE FROM chat_thread_task_links l
WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = l.task_id);

DELETE FROM chat_message_links l
WHERE l.target_type = 'task'
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = l.target_id);

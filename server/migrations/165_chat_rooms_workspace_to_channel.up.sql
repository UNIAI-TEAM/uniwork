UPDATE chat_rooms
   SET kind = 'channel', visibility = 'public', is_default = true,
       name = CASE WHEN name = '' THEN 'chung' ELSE name END
 WHERE kind = 'workspace';

UPDATE chat_rooms
   SET kind = 'workspace', visibility = 'private', is_default = false
 WHERE is_default = true AND kind = 'channel';

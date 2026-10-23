-- When a notification actually reached a phone (a push service accepted it
-- for an Expo token), as distinct from pushed_at, which also marks a push the
-- consumer dropped on purpose (the person was reading the room, no device,
-- the calls switch off). Reading a room tells the person's Android phones to
-- clear it from the tray only when one of the rows it closed has this set, so
-- a read in an active web chat wakes no phone for a tray entry that never
-- existed. NULL means no phone was shown it.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS phone_pushed_at TIMESTAMPTZ;

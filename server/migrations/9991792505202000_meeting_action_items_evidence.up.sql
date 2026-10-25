-- The input lines an AI item rests on (UNI-2002, spec meeting follow-through
-- §7.2): a JSON array of {"kind": "segment"|"note"|"chat", "id"}. Manual
-- items, and every item stored before this column, have none.
ALTER TABLE meeting_action_items ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]';

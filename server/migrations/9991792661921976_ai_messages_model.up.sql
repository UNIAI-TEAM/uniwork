-- Ask UNI: the catalogue key of the model a person chose for an answer; '' for Auto and for every row before this column.
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';

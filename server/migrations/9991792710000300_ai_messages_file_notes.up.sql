-- Ask UNI (UNI-2119): on an answer, the files of its turn that were read only in part, as a JSON list of {name, unit, read, total}; '[]' when none.
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS file_notes TEXT NOT NULL DEFAULT '[]';

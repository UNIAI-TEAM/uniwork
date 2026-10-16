-- A binary without the column replays every assistant row as a turn, and a
-- provider refuses an empty one: give notice rows the text such a binary stored.
UPDATE ai_messages SET content = 'Chưa đủ dữ liệu trong workspace để trả lời.' WHERE notice IS NOT NULL AND content = '';
ALTER TABLE ai_messages DROP COLUMN IF EXISTS notice;

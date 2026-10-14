-- G8-07 §3 (UNI-1402): a launch ticket may carry the comment the page was
-- opened on, so the desktop shell can send comments.reveal for it after the
-- editor is ready. Optional: NULL keeps the pre-G8 behaviour (open the
-- document only). No FOREIGN KEY (CLAUDE.md) - the service proves the comment
-- belongs to the ticket's document before it writes the column.
ALTER TABLE office_launch_sessions ADD COLUMN comment_id TEXT;

-- Who may read a meeting's AI content (UNI-1995 access, issue #4): the
-- verbatim transcript, the AI summary, its evidence lines and the live
-- catch-up are for the host, the clerks, the invited and admitted
-- participants and the workspace admins. ai_content_shared_at set means the
-- host or a clerk shared that content with the whole workspace; NULL (the
-- default, and every meeting before this column) keeps it to those people.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS ai_content_shared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_content_shared_by TEXT;

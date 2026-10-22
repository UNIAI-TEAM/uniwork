-- Declining AI processing (Apple 5.1.2(i)): a person who withdrew their
-- consent, or never gave it and said no, keeps their own messages out of every
-- AI request, whoever makes it (another member's catch-up, Ask UNI, a call
-- summary). NULL means not declined: the person agreed, or was never asked.
ALTER TABLE users ADD COLUMN ai_opt_out_at TIMESTAMPTZ;

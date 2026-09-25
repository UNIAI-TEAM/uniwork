ALTER TABLE email_hub_threads
  ADD COLUMN IF NOT EXISTS conversation_key TEXT NOT NULL DEFAULT '';

-- Group existing rows by normalized subject until sync refreshes Message-ID keys.
UPDATE email_hub_threads t
SET conversation_key = 'subj:' || t.account_id || ':' || lower(
  trim(both from regexp_replace(
    regexp_replace(
      regexp_replace(trim(t.subject), '^(re|fwd):\s*', '', 'i'),
      '^(re|fwd):\s*', '', 'i'
    ),
    '^(re|fwd):\s*', '', 'i'
  ))
)
WHERE t.conversation_key = ''
  AND trim(t.subject) <> '';

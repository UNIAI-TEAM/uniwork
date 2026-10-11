-- Cached bodies were run through a blind quoted-printable "repair" (decoding
-- "id=12345" into control bytes) and stored without charset conversion, so
-- non-UTF-8 text lost its accented letters. Mark every cached body stale so
-- prefetch or the next open fetches it again from IMAP. body_object_key is
-- kept on purpose: the object key is deterministic per thread, so a refetch
-- overwrites it, and thread deletion still finds and removes it.
-- A Sent row written after an SMTP send is kept: its UID is the send's unix
-- second, not a real IMAP UID, so its body (stored as composed) cannot be
-- fetched again.
UPDATE email_hub_threads
SET body_text = NULL,
    body_html = NULL,
    body_cached = false
WHERE body_cached
  AND NOT (folder = 'SENT' AND imap_uid = (floor(extract(epoch FROM sent_at))::bigint & 2147483647));

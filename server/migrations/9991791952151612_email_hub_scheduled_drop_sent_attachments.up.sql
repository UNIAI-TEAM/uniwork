-- UNI-1624: a scheduled send now drops its attachments (base64 in payload)
-- once it is sent or cancelled. Rows that settled before that still carry
-- them; nothing reads a settled row's payload.
UPDATE email_hub_scheduled_sends
SET payload = payload - 'attachments'
WHERE status IN ('sent', 'cancelled')
  AND payload ? 'attachments';

CREATE INDEX CONCURRENTLY email_hub_scheduled_sends_due_idx
  ON email_hub_scheduled_sends (send_at)
  WHERE status = 'pending';

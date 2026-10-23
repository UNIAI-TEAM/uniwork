-- G12/G9 (UNI-936): the undelivered set (PENDING/PROCESSING) stays small while
-- DONE rows pile up until retention. Serves the oldest-pending lag gauge as
-- one probe and the dispatcher's claim in created_at order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_events_open ON outbox_events (created_at) WHERE status IN ('PENDING', 'PROCESSING');

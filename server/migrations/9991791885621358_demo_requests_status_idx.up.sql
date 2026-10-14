CREATE INDEX CONCURRENTLY idx_demo_requests_status_created ON demo_requests (status, created_at DESC, id DESC);

-- The open chat reports: the console's queue banner (AdminChatReportQueue)
-- and the scrape-time gauges behind UniChatReportFiled / UniChatReportOverdue
-- (metrics.ChatReportQueueCollector) read count(*) and min(created_at) of
-- them on every scrape, so the read follows the open backlog, not every
-- report ever filed. CONCURRENTLY, alone in this file (Database and Migration
-- Rules: an index never shares a migration).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_reports_open
  ON chat_reports (created_at)
  WHERE status = 'open';

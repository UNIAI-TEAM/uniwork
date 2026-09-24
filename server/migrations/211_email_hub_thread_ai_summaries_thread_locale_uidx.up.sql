CREATE UNIQUE INDEX CONCURRENTLY email_hub_thread_ai_summaries_thread_locale_uidx
  ON email_hub_thread_ai_summaries (thread_id, locale);

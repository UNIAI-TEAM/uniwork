-- UNI-1999 (meeting follow-through đợt 4, spec §5.1): nothing reads or writes
-- meeting_summary_task_links since UNI-1998, and 9991792500521000 copied the
-- links an old server may still have written. The table goes, with its index.
DROP TABLE IF EXISTS meeting_summary_task_links;

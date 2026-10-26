-- The AI's prose restatement of an item and the priority the meeting
-- signalled (meeting_summary@6, meeting_live_items@2): the task composer
-- prefills both. '' means none; manual items and every item stored before
-- these columns have neither. suggested_priority is low|medium|high|urgent.
ALTER TABLE meeting_action_items
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN suggested_priority TEXT NOT NULL DEFAULT '';

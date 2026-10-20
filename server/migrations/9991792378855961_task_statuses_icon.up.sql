-- A custom status may draw another category's glyph; '' keeps its own.
ALTER TABLE task_statuses
  ADD COLUMN icon TEXT NOT NULL DEFAULT ''
  CHECK (icon IN ('', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'));

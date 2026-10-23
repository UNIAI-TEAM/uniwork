-- A built-in status an admin has renamed, recoloured or re-iconed shows its
-- own values instead of the localized defaults.
ALTER TABLE task_statuses ADD COLUMN customized BOOLEAN NOT NULL DEFAULT FALSE;

-- Whole-table object-locator uniqueness (spec 9.5): the same storage object
-- must never back two rows, across tenants and across deleted tombstones.
-- COALESCE keeps local rows (bucket NULL) inside the key.
CREATE UNIQUE INDEX CONCURRENTLY uidx_files_locator
  ON files (storage, COALESCE(bucket, ''), object_key);

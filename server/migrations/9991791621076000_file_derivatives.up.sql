-- FileService derivatives (spec 2026-09-22 §276, H15/UNI-1088): one row per
-- derived object, such as a chat photo's thumbnail. The derived object is an
-- ordinary files row staged under its source's purpose and scope; this table
-- is the technical link, not a business reference. The collector holds a
-- derivative while its source is not deleted, then takes it. No foreign keys
-- (migration rules).
CREATE TABLE file_derivatives (
  source_file_id    TEXT NOT NULL,
  variant           TEXT NOT NULL,
  file_id           TEXT NOT NULL,
  processor_version INTEGER NOT NULL,
  organization_id   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_file_id, variant),
  CONSTRAINT file_derivatives_variant_check CHECK (variant IN ('thumb')),
  CONSTRAINT file_derivatives_processor_version_positive CHECK (processor_version > 0)
);
